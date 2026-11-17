import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DB } from './schema.ts';
import { SCHEMA_VERSION, emptySlots, validateDb } from './schema.ts';
import { createStore } from './store.ts';
import { dispatch, snapshotSlots } from './routes.ts';
import { buildPrompt } from './runner.ts';

const at = '2026-11-17T00:00:00.000Z';

function fixture(): DB {
  const slots = { ...emptySlots(), bottom: [{ kind: 'item' as const, id: 'W-1' }], top: [{ kind: 'need' as const, id: 'N-1' }] };
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    updatedAt: at,
    photos: [
      { id: 'P-1', kind: 'source', path: 'assets/photos/a.jpeg', originalName: 'a.jpeg', source: 'chat-2026-11-14', createdAt: at },
      { id: 'P-2', kind: 'source', path: 'assets/photos/b.jpeg', originalName: 'b.jpeg', source: 'chat-2026-11-14', createdAt: at },
    ],
    items: [
      { id: 'W-1', rev: 1, category: 'trousers', title: 'Navy chinos', status: 'needs_confirmation', photoIds: ['P-1', 'P-2'], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
      { id: 'W-2', rev: 1, category: 'trousers', title: 'Navy chinos (дубль)', status: 'needs_confirmation', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
    ],
    needs: [{ id: 'N-1', rev: 1, title: 'Молочна футболка', category: 'tees', priority: 'core', description: 'однотонна', why: '', fitCheck: '', status: 'open', origin: 'source', createdAt: at, updatedAt: at }],
    products: [],
    looks: [{ id: 'L-1', rev: 1, capsuleId: 'C-1', name: 'Look', slots, version: 1, versions: [{ version: 1, slots, at }], favorite: false, origin: 'source', createdAt: at, updatedAt: at }],
    capsules: [{ id: 'C-1', rev: 1, name: 'Urban', season: 'all', description: '', situations: [], favorite: false, lookIds: ['L-1'], origin: 'source', createdAt: at, updatedAt: at }],
    jobs: [],
    results: [],
    comparisons: [],
    profile: {
      rev: 1,
      basePhotoIds: [],
      measurements: { height: { value: null }, chest: { value: null }, waist: { value: null }, hips: { value: null }, shoulders: { value: null }, sleeve: { value: null }, inseam: { value: null }, foot: { value: null } },
      knownSizes: [],
      preferences: { comfort: '', materials: '', fit: '', branding: '' },
    },
    settings: { codexModel: 'test-model', reasoningEffort: 'medium', tailscaleLogin: '' },
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capfashion-test-'));
  const store = createStore(dir, fixture);
  let drained = 0;
  const ctx = { store, projectRoot: dir, drain: () => void drained++ };
  const call = (method: string, p: string, body: Record<string, unknown> = {}) => dispatch(ctx, method, p, body) as Promise<any>;
  return { dir, store, call, drained: () => drained };
}

test('fixture is valid and seeds an atomic file with a previous-valid backup', async () => {
  assert.equal(validateDb(fixture()), null);
  const { dir, store, call } = setup();
  store.read();
  assert.ok(fs.existsSync(path.join(dir, 'db.json')));
  await call('PATCH', '/api/items/W-1', { rev: 1, color: 'navy' });
  assert.ok(fs.existsSync(path.join(dir, 'db.prev.json')), 'backup of last valid version');
  assert.equal(store.read().revision, 2);
});

test('corrupt db falls back to the last valid copy without destroying data (A11)', async () => {
  const { dir, store, call } = setup();
  await call('PATCH', '/api/items/W-1', { rev: 1, color: 'navy' });
  await call('PATCH', '/api/items/W-1', { rev: 2, brand: 'X' });
  fs.writeFileSync(path.join(dir, 'db.json'), '{ broken');
  const db = store.read();
  assert.equal(store.recovered(), true);
  assert.equal(db.items[0].color, 'navy');
});

test('stale revision is rejected instead of silently overwriting (A11)', async () => {
  const { call } = setup();
  await call('PATCH', '/api/items/W-1', { rev: 1, title: 'A' });
  await assert.rejects(call('PATCH', '/api/items/W-1', { rev: 1, title: 'B' }), (e: any) => e.status === 409);
});

test('confirm, edit and inactive status persist with history (A02)', async () => {
  const { store, call } = setup();
  await call('PATCH', '/api/items/W-1', { rev: 1, status: 'confirmed', size: 'W32 L32' });
  await call('PATCH', '/api/items/W-1', { rev: 2, status: 'inactive' });
  const item = store.read().items[0];
  assert.equal(item.status, 'inactive');
  assert.equal(item.size, 'W32 L32');
  assert.deepEqual(item.history.map((h) => h.action), ['status:confirmed', 'status:inactive']);
});

test('merge keeps sources and repoints looks; split moves photos (A02)', async () => {
  const { store, call } = setup();
  const merged = await call('POST', '/api/items/merge', { ids: ['W-1', 'W-2'], title: 'Navy chinos' });
  let db = store.read();
  assert.equal(db.items.find((i) => i.id === 'W-1')!.mergedInto, merged.id);
  assert.equal(db.items.find((i) => i.id === 'W-1')!.status, 'inactive');
  const look = db.looks[0];
  assert.deepEqual(look.slots.bottom, [{ kind: 'item', id: merged.id }]);
  assert.equal(look.version, 2, 'composition change creates a new look version');
  const part = await call('POST', `/api/items/${merged.id}/split`, { photoIds: ['P-2'] });
  db = store.read();
  assert.deepEqual(db.items.find((i) => i.id === merged.id)!.photoIds, ['P-1']);
  assert.equal(part.splitFrom, merged.id);
});

test('cross-capsule combination saves as a separate look; renaming does not bump version (A04)', async () => {
  const { call } = setup();
  const look = await call('POST', '/api/looks', { name: 'Мікс', slots: { bottom: [{ kind: 'item', id: 'W-2' }] } });
  assert.equal(look.capsuleId, null);
  const renamed = await call('PATCH', `/api/looks/${look.id}`, { rev: 1, name: 'Мікс 2' });
  assert.equal(renamed.version, 1);
  const changed = await call('PATCH', `/api/looks/${look.id}`, { rev: 2, slots: { bottom: [{ kind: 'item', id: 'W-1' }] } });
  assert.equal(changed.version, 2);
  assert.equal(changed.versions.length, 2);
});

test('job without base photo needs data; job snapshot is frozen; retry links (A05, A06)', async () => {
  const { store, call } = setup();
  const missing = await call('POST', '/api/jobs', { lookId: 'L-1' });
  assert.equal(missing.state, 'needs_data');
  const job = await call('POST', '/api/jobs', { lookId: 'L-1', basePhotoIds: ['P-1'], instructions: 'погляд у камеру' });
  assert.equal(job.state, 'queued');
  assert.equal(job.snapshot.slots.length, 2);
  assert.deepEqual(job.snapshot.basePhotoPaths, ['assets/photos/a.jpeg']);
  await call('PATCH', '/api/items/W-1', { rev: 1, title: 'Змінена назва' });
  const frozen = store.read().jobs.find((j) => j.id === job.id)!;
  assert.equal(frozen.snapshot.slots.find((s) => s.id === 'W-1')!.title, 'Navy chinos', 'snapshot does not follow later edits');
  await store.mutate((db) => {
    db.jobs.find((j) => j.id === job.id)!.state = 'error';
  });
  const retry = await call('POST', `/api/jobs/${job.id}/retry`, {});
  assert.equal(retry.retryOf, job.id);
  assert.ok(store.read().jobs.some((j) => j.id === job.id), 'previous attempt kept');
});

test('rework review creates a linked retry with the reason; accept clears it (A06, A07)', async () => {
  const { store, call } = setup();
  const job = await call('POST', '/api/jobs', { lookId: 'L-1', basePhotoIds: ['P-1'] });
  await store.mutate((db) => {
    const j = db.jobs.find((x) => x.id === job.id)!;
    j.state = 'done';
    j.resultId = 'R-1';
    db.results.push({ id: 'R-1', jobId: j.id, lookId: 'L-1', lookVersion: 1, imagePath: 'r.png', tool: 't', model: 'm', prompt: 'p', sources: [], usedItemPhotos: true, review: 'pending', favorite: false, createdAt: at });
  });
  await assert.rejects(call('POST', '/api/results/R-1/review', { decision: 'rework' }), (e: any) => e.status === 400);
  const out = await call('POST', '/api/results/R-1/review', { decision: 'rework', reason: 'face', note: 'очі' });
  assert.equal(out.result.review, 'rework');
  assert.equal(out.retry.retryOf, job.id);
  assert.match(out.retry.instructions, /обличчя не схоже — очі/);
  await call('PATCH', '/api/results/R-1', { favorite: true, note: 'краща' });
  assert.equal(store.read().results[0].favorite, true);
});

test('purchase moves the product into the wardrobe and updates looks (A08, A09)', async () => {
  const { store, call } = setup();
  const p1 = await call('POST', '/api/products', { needId: 'N-1', store: 'Tower', brand: 'B', model: 'Tee', price: '19.9', currency: 'EUR' });
  await call('POST', '/api/products', { needId: 'N-1', store: 'Tower', brand: 'C', model: 'Tee 2' });
  let db = store.read();
  assert.equal(db.needs.length, 1, 'alternatives do not duplicate the need');
  assert.equal(db.products.filter((p) => p.status === 'purchased').length, 0);
  const item = await call('POST', `/api/products/${p1.id}/purchase`, { size: 'M' });
  db = store.read();
  assert.equal(item.status, 'confirmed');
  assert.equal(item.size, 'M');
  assert.equal(db.needs[0].status, 'covered');
  assert.deepEqual(db.looks[0].slots.top, [{ kind: 'item', id: item.id }]);
  assert.equal(db.products.find((p) => p.id !== p1.id)!.status, 'option', 'other alternative stays an option');
});

test('prompt carries the frozen outfit and the image standard', () => {
  const db = fixture();
  const job = { id: 'J', lookId: 'L-1', lookVersion: 1, snapshot: { lookName: 'Look', slots: snapshotSlots(db, db.looks[0].slots), basePhotoIds: ['P-1'], basePhotoPaths: ['assets/photos/a.jpeg'] }, instructions: '', state: 'queued' as const, origin: 'site' as const, createdAt: at };
  const prompt = buildPrompt(job, '/tmp/x/result.png');
  assert.match(prompt, /\/tmp\/x\/result\.png/);
  assert.match(prompt, /#FFFFFF/);
  assert.match(prompt, /eyes looking into the camera/);
  assert.match(prompt, /Navy chinos/);
});
