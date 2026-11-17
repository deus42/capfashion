import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DB } from './schema.ts';
import { SCHEMA_VERSION, emptySlots, validateDb } from './schema.ts';
import { createStore } from './store.ts';
import { stateView } from './state-view.ts';
import { createJob, dispatch, queueMissingRenders, snapshotSlots } from './routes.ts';
import { sameIdentity, verifyReferenceFiles } from './identity.ts';
import { MAX_IMAGE_REFS, buildPrompt, createRunner, pickRefs } from './runner.ts';
import { analyzePrompt, applyAnalyze, applyIntake, intakePrompt } from './analysis.ts';
import { hiddenLookIds, isCapsuleHidden, sameLook } from '../src/rating.ts';
import { importInspiration } from './inspiration.ts';
import { createHash } from 'node:crypto';
import { changedCoreSlots, groupLookVariations } from '../src/look-variation.ts';
import { looksNeedingRender } from '../src/render-need.ts';
import { isComplete, missingInfo, purchaseRanking } from '../src/lib.ts';

const at = '2026-11-17T00:00:00.000Z';

test('hidden personal attempts stay in history but never reach site covers, gallery or result links', () => {
  const db = fixture();
  const result = { id: 'R-hide', jobId: 'J-hide', lookId: 'L-1', lookVersion: 1, imagePath: 'bad.png', tool: 'test', model: 'test', prompt: 'private prompt', sources: [], usedItemPhotos: true, review: 'rework' as const, favorite: false, createdAt: at, hiddenAt: at };
  db.results.push(result, { ...result, id: 'R-show', hiddenAt: undefined });
  db.jobs.push({ id: 'J-hide', lookId: 'L-1', resultId: 'R-hide', lookVersion: 1, snapshot: { lookName: 'Look', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'done', origin: 'import', createdAt: at });
  db.comparisons.push({ id: 'CMP-hide', resultA: 'R-hide', resultB: 'R-show', note: '', favorite: false, createdAt: at });
  const view = stateView(db);
  assert.deepEqual(view.results.map((r) => r.id), ['R-show']);
  assert.equal(view.jobs[0].resultId, undefined);
  assert.equal(view.comparisons.length, 0);
  assert.equal('prompt' in view.results[0], false);
  assert.equal(db.results.length, 2, 'retained local history is not deleted');
  assert.equal(db.jobs[0].resultId, 'R-hide', 'the stored attempt link remains');
  assert.equal(db.comparisons.length, 1);
});

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

test('reference import verifies bytes, deduplicates and preserves wardrobe and base photos', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capfashion-inspiration-'));
  try {
    const dir = path.join(root, '.local/data');
    fs.mkdirSync(path.join(root, 'assets/references'), { recursive: true });
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FuoAAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(path.join(root, 'assets/references/a.png'), bytes);
    const store = createStore(dir, fixture);
    const before = store.read();
    const asset = { path: 'assets/references/a.png', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, source_url: 'https://example.com/a.png', title: 'Olive Casual' };
    assert.equal((await importInspiration(store, root, [asset, asset], 'Archived chat')).added.length, 1);
    assert.equal((await importInspiration(store, root, [asset], 'Archived chat')).added.length, 0);
    const db = store.read();
    assert.deepEqual(db.items, before.items);
    assert.deepEqual(db.profile, before.profile);
    assert.deepEqual(db.looks, before.looks);
    assert.deepEqual(db.jobs, before.jobs);
    const p = db.photos.find((p) => p.inspiration)!;
    assert.equal(p.inspiration!.title, 'Olive Casual');
    assert.deepEqual(fs.readFileSync(path.join(root, p.path)), bytes);
    await assert.rejects(importInspiration(store, root, [{ ...asset, sha256: 'wrong' }], ''), /checksum/);
    await assert.rejects(importInspiration(store, root, [{ ...asset, source_url: 'javascript:alert(1)' }], ''), /HTTPS/);
    fs.writeFileSync(path.join(root, 'outside.png'), bytes);
    await assert.rejects(importInspiration(store, root, [{ ...asset, path: 'outside.png' }], ''), /outside/);
    assert.equal(store.read().photos.length, before.photos.length + 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('outfit groups count core changes, ignore accessories and avoid similarity chains', () => {
  const a = fixture().looks[0];
  const withRef = (l: typeof a, slot: 'top' | 'shoes' | 'accessories', id: string) => ({ ...l, id: l.id + id, slots: { ...l.slots, [slot]: [{ kind: 'need' as const, id }] } });
  const belt = withRef(a, 'accessories', 'belt');
  const shoe = withRef(a, 'shoes', 'shoe');
  const topAndShoe = withRef(shoe, 'top', 'polo');
  assert.equal(changedCoreSlots(a, belt).length, 0);
  assert.equal(changedCoreSlots(a, shoe).length, 1);
  assert.equal(changedCoreSlots(a, topAndShoe).length, 2);
  const groups = groupLookVariations([a, belt, shoe, topAndShoe]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].variants.length, 2);
  assert.equal(groups[1].primary.id, topAndShoe.id);
});

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
  const out = await call('POST', '/api/results/R-1/review', { decision: 'rework', reason: 'proportions', note: 'плечі' });
  assert.equal(out.result.review, 'rework');
  assert.equal(out.retry.retryOf, job.id);
  assert.match(out.retry.instructions, /змінені пропорції тіла — плечі/);
  // «Це я? — Ні»: the face is hidden from the site and the same references are not re-run.
  const face = await call('POST', '/api/results/R-1/review', { decision: 'rework', reason: 'face' });
  assert.equal(face.retry, undefined);
  assert.ok(store.read().results[0].hiddenAt);
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
  assert.match(prompt, /preserve the original head angle/);
  assert.match(prompt, /Navy chinos/);
});

test('runner processes packshot and try-on jobs in parallel without chat (A13)', async () => {
  const { dir, store, call } = setup();
  const fake = path.join(dir, 'fake-codex.sh');
  fs.writeFileSync(
    fake,
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -C) d="$2"; shift;; -o) o="$2"; shift;; esac; shift; done\ncat >/dev/null\nsleep 0.3\nprintf "PNG" > "$d/result.png"\necho \'{"status":"done","notes":"fake"}\' > "$o"\n',
    { mode: 0o755 },
  );
  const runner = createRunner(store, dir, fake);
  const pk = await call('POST', '/api/packshots', { itemIds: ['W-1'] });
  assert.equal(pk.created, 1);
  const again = await call('POST', '/api/packshots', { itemIds: ['W-1'] });
  assert.equal(again.created, 0, 'no duplicate while one is queued');
  await call('POST', '/api/jobs', { lookId: 'L-1', basePhotoIds: ['P-1'] });
  await runner.drain();
  const db = store.read();
  const item = db.items.find((i) => i.id === 'W-1')!;
  const packshot = db.photos.find((p) => p.id === item.packshotId)!;
  assert.equal(packshot.kind, 'packshot');
  assert.deepEqual(item.photoIds, ['P-1', 'P-2'], 'originals untouched');
  assert.equal(db.results.length, 1);
  assert.ok(db.jobs.every((j) => j.state === 'done'));
  const prompt = fs.readFileSync(path.join(dir, 'jobs', pk.jobIds[0], 'prompt.txt'), 'utf8');
  assert.match(prompt, /packshot/);
  assert.match(prompt, /Navy chinos/);
});

test('failed Codex run becomes an explained error and retry links (A13, A06)', async () => {
  const { store, call } = setup();
  const runner = createRunner(store, store.dataDir, '/usr/bin/false');
  const pk = await call('POST', '/api/packshots', { itemIds: ['W-2'] });
  await runner.drain();
  const job = store.read().jobs.find((j) => j.id === pk.jobIds[0])!;
  assert.equal(job.state, 'error');
  assert.match(job.stateNote ?? '', /код/);
  const retry = await call('POST', `/api/jobs/${job.id}/retry`, {});
  assert.equal(retry.kind, 'packshot');
  assert.equal(retry.retryOf, job.id);
});

test('intake recognises garments into candidates and queues their packshots', async () => {
  const { dir, store } = setup();
  const fake = path.join(dir, 'fake-codex.sh');
  fs.writeFileSync(
    fake,
    '#!/bin/sh\nschema=""\nwhile [ $# -gt 0 ]; do case "$1" in -C) d="$2"; shift;; -o) o="$2"; shift;; --output-schema) schema="$2"; shift;; esac; shift; done\ncat >/dev/null\nif [ -n "$schema" ]; then echo \'{"status":"done","reason":"","garments":[{"title":"Біла оксфорд-сорочка","category":"shirts","color":"білий","notes":"комір на ґудзиках","duplicateOf":""},{"title":"Темно-сині чіноси","category":"trousers","color":"темно-синій","notes":"","duplicateOf":"W-1"}]}\' > "$o"; else printf PNG > "$d/result.png"; echo \'{"status":"done"}\' > "$o"; fi\n',
    { mode: 0o755 },
  );
  await store.mutate((db) => {
    db.jobs.push({ id: 'J-in', kind: 'intake', inputPhotoIds: ['P-1'], lookVersion: 0, snapshot: { lookName: 'a.jpeg', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'queued', origin: 'site', createdAt: at });
  });
  await createRunner(store, dir, fake).drain();
  const db = store.read();
  const job = db.jobs.find((j) => j.id === 'J-in')!;
  assert.equal(job.state, 'done');
  assert.equal(job.createdItemIds?.length, 1, 'the duplicate of an unconfirmed candidate becomes extra evidence, not a new item');
  const shirt = db.items.find((i) => i.title === 'Біла оксфорд-сорочка')!;
  assert.equal(shirt.status, 'needs_confirmation');
  assert.deepEqual(shirt.photoIds, ['P-1']);
  assert.ok(!db.items.some((i) => i.title === 'Темно-сині чіноси'));
  assert.ok(db.items.find((i) => i.id === 'W-1')!.status !== 'confirmed', 'no automatic confirmation');
  assert.match(job.stateNote ?? '', /нових речей: 1/);
  assert.ok(job.createdItemIds!.every((id) => db.items.find((i) => i.id === id)!.packshotId), 'packshots generated for new items');
});

test('analyzer keeps only owned items and complete looks (selection)', async () => {
  const { store } = setup();
  await store.mutate((db) => {
    db.items.push({ id: 'W-S', rev: 1, category: 'shoes', title: 'Stan Smith', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    db.items.push({ id: 'W-X', rev: 1, category: 'shoes', title: 'Old shoes', status: 'inactive', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    db.items.push({ id: 'W-J', rev: 1, category: 'outerwear', title: 'Jacket', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    const job = { id: 'J-an', kind: 'analyze' as const, lookVersion: 0, snapshot: { lookName: '', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: 'на вихідні', state: 'running' as const, origin: 'site' as const, createdAt: at };
    db.jobs.push(job);
    const id = applyAnalyze(db, job, {
      status: 'done', reason: '', name: 'Вихідні', description: 'Легко',
      looks: [
        { name: 'A', occasion: 'прогулянка', season: 'warm', top: ['N-1'], layer: ['W-J'], bottom: ['W-1'], shoes: ['W-S'], accessories: [], why: 'спокійно' },
        { name: 'Bad shoes', occasion: '', season: 'warm', top: [], layer: [], bottom: ['W-1'], shoes: ['W-X'], accessories: [], why: '' },
        { name: 'Ghost', occasion: '', season: 'warm', top: [], layer: [], bottom: ['W-404'], shoes: ['W-S'], accessories: [], why: '' },
      ],
    });
    assert.ok(id);
    const cap = db.capsules.find((c) => c.id === id)!;
    assert.equal(cap.kind, 'selection');
    assert.equal(cap.lookIds.length, 1);
    const look = db.looks.find((l) => l.id === cap.lookIds[0])!;
    assert.deepEqual(look.slots.top, [], 'needs (not owned) are dropped');
    assert.deepEqual(look.slots.shoes, [{ kind: 'item', id: 'W-S' }]);
  });
});

test('one upload control: owner photo becomes a base photo, label fills only empty fields', async () => {
  const { store } = setup();
  await store.mutate((db) => {
    db.photos.push({ id: 'P-up', kind: 'item', path: 'assets/photos/up.jpeg', originalName: 'up.jpeg', source: 'upload', createdAt: at });
    db.photos.push({ id: 'P-tag', kind: 'item', path: 'assets/photos/tag.jpeg', originalName: 'tag.jpeg', source: 'upload', createdAt: at });
    db.items.find((i) => i.id === 'W-2')!.brand = 'Known';
    db.items.push({ id: 'W-C', rev: 1, category: 'shoes', title: 'Stan Smith', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    const base = { id: 'J-b', kind: 'intake' as const, inputPhotoIds: ['P-up'], lookVersion: 0, snapshot: { lookName: '', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
    const o1 = applyIntake(db, base, {
      status: 'done', reason: '', photoType: 'person_full_body', singlePerson: true, baseSuitable: false, baseIssues: 'окуляри',
      label: { itemId: '', brand: '', size: '', composition: '' },
      garments: [{ title: 'Білі кеди', category: 'shoes', color: 'білий', notes: '', duplicateOf: 'W-C' }],
    });
    assert.equal(o1.base, 'added_nonstandard');
    assert.deepEqual(db.profile.basePhotoIds, ['P-up']);
    const up = db.photos.find((p) => p.id === 'P-up')!;
    assert.equal(up.kind, 'base');
    assert.equal(up.meetsStandard, false);
    assert.equal(o1.created.length, 1, 'a duplicate of a confirmed item becomes a new candidate, confirmed item untouched');
    assert.deepEqual(db.items.find((i) => i.id === 'W-C')!.photoIds, []);
    const tag = { ...base, id: 'J-t', inputPhotoIds: ['P-tag'] };
    const o2 = applyIntake(db, tag, {
      status: 'done', reason: '', photoType: 'label', singlePerson: false, baseSuitable: false, baseIssues: '',
      label: { itemId: 'W-2', brand: 'Other', size: 'W32 L32', composition: '98% cotton' }, garments: [],
    });
    assert.equal(o2.labelFor, 'W-2');
    const w2 = db.items.find((i) => i.id === 'W-2')!;
    assert.equal(w2.brand, 'Known', 'existing values are not overwritten');
    assert.equal(w2.size, 'W32 L32');
    assert.equal(w2.composition, '98% cotton');
    assert.ok(w2.photoIds.includes('P-tag'));
    assert.equal(db.photos.find((p) => p.id === 'P-tag')!.kind, 'label');
  });
});

test('deleting capsule, look, item and photo cascades without dangling references', async () => {
  const { store, call } = setup();
  const job = await call('POST', '/api/jobs', { lookId: 'L-1', basePhotoIds: ['P-1'] });
  await store.mutate((db) => {
    const j = db.jobs.find((x) => x.id === job.id)!;
    j.state = 'done';
    j.resultId = 'R-1';
    db.results.push({ id: 'R-1', jobId: j.id, lookId: 'L-1', lookVersion: 1, imagePath: 'r.png', tool: 't', model: 'm', prompt: 'p', sources: [], usedItemPhotos: true, review: 'pending', favorite: false, createdAt: at });
  });
  await call('POST', '/api/packshots', { itemIds: ['W-2'] });
  await call('DELETE', '/api/items/W-1');
  let db = store.read();
  assert.ok(!db.items.some((i) => i.id === 'W-1'));
  assert.deepEqual(db.looks[0].slots.bottom, [], 'item removed from the look');
  assert.equal(db.looks[0].version, 2, 'look gets a new version');
  await call('DELETE', '/api/items/W-2');
  db = store.read();
  assert.ok(!db.jobs.some((j) => j.kind === 'packshot'), 'packshot job of deleted item removed');
  await call('DELETE', '/api/capsules/C-1');
  db = store.read();
  assert.equal(db.capsules.length, 0);
  assert.equal(db.looks.length, 0);
  assert.equal(db.results.length, 0, 'renders of deleted looks removed');
  assert.equal(db.jobs.length, 0);
  await call('PATCH', '/api/profile', { rev: db.profile.rev, basePhotoIds: ['P-2'] });
  await store.mutate((d) => {
    d.photos.find((p) => p.id === 'P-2')!.kind = 'base';
  });
  await call('DELETE', '/api/photos/P-2');
  db = store.read();
  assert.deepEqual(db.profile.basePhotoIds, []);
  await assert.rejects(call('DELETE', '/api/photos/P-1'), (e: any) => e.status === 409, 'chat originals are protected');
});

test('a new selection gets a try-on for every look; missing renders are queued once', async () => {
  const { dir, store, call } = setup();
  const fake = path.join(dir, 'fake-codex.sh');
  fs.writeFileSync(
    fake,
    '#!/bin/sh\nschema=""\nwhile [ $# -gt 0 ]; do case "$1" in -C) d="$2"; shift;; -o) o="$2"; shift;; --output-schema) schema="$2"; shift;; esac; shift; done\ncat >/dev/null\nif [ -n "$schema" ]; then echo \'{"status":"done","reason":"","name":"Вихідні","description":"","looks":[{"name":"A","occasion":"","season":"all","top":[],"layer":["W-J"],"bottom":["W-1"],"shoes":["W-S"],"accessories":[],"why":""},{"name":"B","occasion":"","season":"all","top":["W-T"],"layer":[],"bottom":["W-2"],"shoes":["W-S"],"accessories":[],"why":""}]}\' > "$o"; else printf PNG > "$d/result.png"; echo \'{"status":"done"}\' > "$o"; fi\n',
    { mode: 0o755 },
  );
  await store.mutate((db) => {
    db.items.push({ id: 'W-S', rev: 1, category: 'shoes', title: 'Stan Smith', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    db.items.push({ id: 'W-J', rev: 1, category: 'outerwear', title: 'Jacket', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    db.items.push({ id: 'W-T', rev: 1, category: 'tees', title: 'Tee', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    db.profile.basePhotoIds = ['P-1'];
  });
  const job = await call('POST', '/api/analyze', {});
  assert.match(job.instructions, /^Тема: /, 'an empty request gets a theme for variety');
  await createRunner(store, dir, fake).drain();
  const db = store.read();
  const sel = db.capsules.find((c) => c.kind === 'selection')!;
  assert.equal(sel.lookIds.length, 2);
  for (const id of sel.lookIds) assert.ok(db.results.some((r) => r.lookId === id), `look ${id} has a render`);
  assert.ok(!db.results.some((r) => r.lookId === 'L-1'), 'no automatic batch: other looks are not rendered unasked');
  const again = await call('POST', '/api/renders/missing', {});
  assert.equal(again.queued, 1, 'only the seed look L-1 still lacked a render');
  await createRunner(store, dir, fake).drain();
  await store.mutate((d) => {
    const l = d.looks.find((x) => x.id === 'L-1')!;
    l.version += 1;
    l.versions.push({ version: l.version, slots: l.slots, at });
  });
  assert.equal((await call('POST', '/api/renders/missing', {})).queued, 1, 'a changed composition needs a new try-on');
  assert.equal((await call('POST', '/api/renders/missing', {})).queued, 0, 'no duplicate jobs while one is queued');
});

test('analyzer drops near-copies of existing looks and keeps names unique', async () => {
  const { store } = setup();
  await store.mutate((db) => {
    db.items.push(
      { id: 'W-S', rev: 1, category: 'shoes', title: 'Stan Smith', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
      { id: 'W-T', rev: 1, category: 'tees', title: 'Tee', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
      { id: 'W-J', rev: 1, category: 'outerwear', title: 'Jacket', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
    );
    const slots = { ...emptySlots(), top: [{ kind: 'item' as const, id: 'W-T' }], bottom: [{ kind: 'item' as const, id: 'W-1' }], shoes: [{ kind: 'item' as const, id: 'W-S' }] };
    db.looks.push({ id: 'L-old', rev: 1, capsuleId: null, name: 'old', slots, version: 1, versions: [{ version: 1, slots, at }], favorite: false, origin: 'agent', createdAt: at, updatedAt: at });
    db.capsules.push({ id: 'C-s', rev: 1, kind: 'selection', name: 'Вихідні', season: 'all', description: '', situations: [], favorite: false, lookIds: [], origin: 'agent', createdAt: at, updatedAt: at });
    const job = { id: 'J-a', kind: 'analyze' as const, lookVersion: 0, snapshot: { lookName: '', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
    const id = applyAnalyze(db, job, {
      status: 'done', reason: '', name: 'Вихідні', description: '',
      looks: [
        { name: 'copy', occasion: '', season: 'all', top: ['W-T'], layer: ['W-J'], bottom: ['W-1'], shoes: ['W-S'], accessories: [], why: '' },
        { name: 'new', occasion: '', season: 'all', top: [], layer: ['W-J'], bottom: ['W-2'], shoes: ['W-S'], accessories: [], why: '' },
      ],
    })!;
    const cap = db.capsules.find((c) => c.id === id)!;
    assert.equal(cap.name, 'Вихідні · 2');
    assert.deepEqual(cap.lookIds.map((l) => db.looks.find((x) => x.id === l)!.name), ['new']);
  });
});

test('complete-the-look: every look keeps the picked items and adds different pieces', async () => {
  const { store, call } = setup();
  await store.mutate((db) => {
    db.items.push(
      { id: 'W-S', rev: 1, category: 'shoes', title: 'Stan Smith', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
      { id: 'W-B', rev: 1, category: 'shoes', title: 'Boots', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
      { id: 'W-T', rev: 1, category: 'tees', title: 'Tee', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
      { id: 'W-J', rev: 1, category: 'outerwear', title: 'Jacket', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at },
    );
  });
  const job = await call('POST', '/api/analyze', { itemIds: ['W-1'] });
  assert.deepEqual(job.requiredItemIds, ['W-1']);
  assert.match(job.instructions, /Доповнити: Navy chinos/);
  await store.mutate((db) => {
    const j = db.jobs.find((x) => x.id === job.id)!;
    const id = applyAnalyze(db, j, {
      status: 'done', reason: '', name: 'Доповнення: chinos', description: '',
      looks: [
        { name: 'a', occasion: '', season: 'all', top: ['W-T'], layer: [], bottom: ['W-1'], shoes: ['W-S'], accessories: [], why: '' },
        { name: 'missing pick', occasion: '', season: 'all', top: ['W-T'], layer: [], bottom: ['W-2'], shoes: ['W-B'], accessories: [], why: '' },
        { name: 'b', occasion: '', season: 'all', top: [], layer: ['W-J'], bottom: ['W-1'], shoes: ['W-B'], accessories: [], why: '' },
      ],
    })!;
    const names = db.capsules.find((c) => c.id === id)!.lookIds.map((l) => db.looks.find((x) => x.id === l)!.name);
    assert.deepEqual(names, ['a', 'b'], 'looks without the picked item are dropped');
  });
  await call('DELETE', '/api/items/W-1');
  assert.ok(!store.read().jobs.find((x) => x.id === job.id)!.requiredItemIds?.length, 'deleting a picked item keeps the store valid');
});

test('try-on prompt sends original base photos to the image tool before garments, never renders', () => {
  const db = fixture();
  const job = { id: 'J', lookId: 'L-1', lookVersion: 1, snapshot: { lookName: 'Look', slots: snapshotSlots(db, db.looks[0].slots), basePhotoIds: ['P-1'], basePhotoPaths: ['assets/photos/a.jpeg'] }, instructions: '', state: 'queued' as const, origin: 'site' as const, createdAt: at };
  const prompt = buildPrompt(job, '/tmp/x/result.png', { identity: ['/abs/assets/photos/a.jpeg'], garments: ['/abs/assets/photos/b.jpeg'] });
  assert.match(prompt, /referenced_image_paths/);
  const list = JSON.parse(prompt.match(/parameter \(in this order\): (\[[^\]]*\])/)![1]);
  assert.deepEqual(list, ['/abs/assets/photos/a.jpeg', '/abs/assets/photos/b.jpeg'], 'identity first, then garments');
  assert.ok(!/renders\//.test(prompt), 'no generated render is used as a reference');
  assert.match(prompt, /exact facial features/);
});

test('image references never exceed the tool limit and keep identity first', () => {
  const db = fixture();
  const slots = snapshotSlots(db, db.looks[0].slots).map((s, i) => ({ ...s, photoPaths: [`assets/photos/g${i}a.jpeg`, `assets/photos/g${i}b.jpeg`] }));
  const job = { id: 'J', lookId: 'L-1', lookVersion: 1, snapshot: { lookName: 'Look', slots, basePhotoIds: ['P-1'], basePhotoPaths: ['assets/photos/a.jpeg', 'assets/photos/b.jpeg', 'assets/photos/c.jpeg', 'assets/photos/d.jpeg'] }, instructions: '', state: 'queued' as const, origin: 'site' as const, createdAt: at };
  const refs = pickRefs(job, false, (p) => `/abs/${p}`);
  assert.equal(refs.identity.length, 3);
  assert.ok(refs.identity.length + refs.garments.length <= MAX_IMAGE_REFS);
  assert.ok(refs.garments.length >= 1, 'at least one garment reference fits');
  const packshot = pickRefs(job, true, (p) => `/abs/${p}`);
  assert.equal(packshot.identity.length, 0);
  assert.ok(packshot.garments.length <= MAX_IMAGE_REFS);
});

test('pinned original freezes face/body crops and excludes faces from garment photos', () => {
  const db = fixture();
  const file = (p: string) => ({ path: p, sha256: 'a'.repeat(64) });
  db.profile.identity = { sourcePhotoId: 'P-1', original: file('assets/photos/a.jpeg'), face: file('.local/media/face.png'), body: file('.local/media/body.png'), preserveHeadAngle: true, confirmedAt: at };
  db.items[0].tryonReference = { ...file('.local/media/trousers.png'), source: file('assets/photos/b.jpeg') };
  const job = createJob(db, db.looks[0], ['P-2'], '');
  assert.deepEqual(job.snapshot.basePhotoIds, ['P-1']);
  const refs = pickRefs(job, false, (p) => '/abs/' + p);
  assert.deepEqual(refs.identity, ['/abs/.local/media/face.png', '/abs/.local/media/body.png']);
  assert.deepEqual(refs.garments, ['/abs/.local/media/trousers.png']);
  const prompt = buildPrompt(job, '/tmp/result.png', refs);
  assert.match(prompt, /KEEP the original head tilt, rotation, gaze direction/);
  assert.doesNotMatch(prompt, /head level|eyes looking into the camera|Ignore their pose/);
  db.profile.identity.face.path = '.local/media/other-face.png';
  assert.equal(job.snapshot.identity!.face.path, '.local/media/face.png', 'profile edits cannot rewrite past attempts');
  delete db.items[0].tryonReference;
  assert.deepEqual(snapshotSlots(db, db.looks[0].slots)[1].photoPaths, [], 'unreviewed full-person garment images stay out');
  assert.equal(validateDb(db), null);
  db.photos[0].source = 'generated';
  assert.match(validateDb(db)!, /власного оригіналу/);
});

test('pinned reference integrity fails before generation when a file changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capfashion-identity-'));
  try {
    const file = (p: string) => { fs.writeFileSync(path.join(dir, p), p); return { path: p, sha256: createHash('sha256').update(p).digest('hex') }; };
    const db = fixture();
    db.profile.identity = { sourcePhotoId: 'P-1', original: file('original.png'), face: file('face.png'), body: file('body.png'), preserveHeadAngle: true, confirmedAt: at };
    const job = createJob(db, db.looks[0], [], '');
    verifyReferenceFiles(job, (p) => path.join(dir, p));
    fs.writeFileSync(path.join(dir, 'face.png'), 'changed');
    assert.throws(() => verifyReferenceFiles(job, (p) => path.join(dir, p)), /Змінено закріплений файл: face.png/);
    fs.unlinkSync(path.join(dir, 'face.png'));
    assert.throws(() => verifyReferenceFiles(job, (p) => path.join(dir, p)), /ENOENT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('front gaze, hair-only styling and no glasses freeze with original identity sources', () => {
  const db = fixture();
  const file = (p: string) => ({ path: p, sha256: 'b'.repeat(64) });
  db.profile.identity = { sourcePhotoId: 'P-1', original: file(db.photos[0].path), face: file('.local/media/face.png'), body: file('.local/media/body.png'), bodyOriginal: file(db.photos[1].path), hair: { sourcePhotoId: 'P-2', original: file(db.photos[1].path), crop: file('.local/media/hair.png') }, preserveHeadAngle: false, hairstyle: 'Same length and colour, neatly swept back and slightly sideways', noGlasses: true, confirmedAt: at };
  const job = createJob(db, db.looks[0], ['P-2'], '');
  const refs = pickRefs(job, false, (p) => p);
  assert.deepEqual(refs.identity, ['.local/media/face.png', '.local/media/body.png', '.local/media/hair.png']);
  assert.deepEqual(job.snapshot.basePhotoPaths, refs.identity);
  const prompt = buildPrompt(job, '/tmp/control.png', refs);
  assert.match(prompt, /head upright and facing directly forward/);
  assert.match(prompt, /both eyes open and looking straight into the camera/);
  assert.match(prompt, /ORIGINAL HAIR-ONLY crop/);
  assert.match(prompt, /ABSOLUTELY NO GLASSES/);
  assert.doesNotMatch(prompt, /KEEP the original head tilt/);
  assert.equal(validateDb(db), null);
  db.profile.identity.noGlasses = false;
  assert.equal(job.snapshot.identity!.noGlasses, true);
  db.photos[1].source = 'generated';
  assert.match(validateDb(db)!, /статура.*власного оригіналу/);
  delete db.profile.identity.bodyOriginal;
  assert.match(validateDb(db)!, /зачіска.*власного оригіналу/);
});

test('face archive permits only original owner photos and rejected identity cannot start a new or frozen retry', async () => {
  const { store, call, dir } = setup();
  const file = (p: string) => ({ path: p, sha256: 'b'.repeat(64) });
  await store.mutate((db) => {
    db.photos[0].referenceRole = 'face';
    db.photos[0].preserveAsReference = true;
    db.profile.identity = { sourcePhotoId: 'P-1', original: file(db.photos[0].path), face: file('.local/face.png'), body: file('.local/body.png'), preserveHeadAngle: false, disabledReason: 'Обличчя відхилено власником', confirmedAt: at };
  });
  const job = await call('POST', '/api/jobs', { lookId: 'L-1' });
  assert.equal(job.state, 'needs_data');
  assert.match(job.stateNote, /відхилено/);
  const retry = await call('POST', `/api/jobs/${job.id}/retry`);
  assert.equal(retry.state, 'needs_data');
  await store.mutate((db) => { db.jobs.find((j) => j.id === job.id)!.state = 'queued'; });
  const fake = path.join(dir, 'must-not-run.sh'), marker = path.join(dir, 'ran');
  fs.writeFileSync(fake, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  await createRunner(store, dir, fake).drain();
  assert.equal(fs.existsSync(marker), false, 'even an older queued job must not run the rejected setup');
  assert.equal(store.read().results.length, 0);
  const db = store.read();
  db.photos[0].source = 'generated';
  assert.match(validateDb(db)!, /референс обличчя.*власним оригіналом/);
});

test('owner-approved portrait is the sole face and hair source; physique keeps original provenance', () => {
  const db = fixture();
  const file = (p: string) => ({ path: p, sha256: 'b'.repeat(64) });
  db.profile.identity = { sourcePhotoId: 'P-1', original: file(db.photos[0].path), face: file('.local/approved-portrait.png'), approvedPortrait: { approvedAt: at, provisional: true }, body: file('.local/body.png'), bodyOriginal: file(db.photos[1].path), preserveHeadAngle: false, noGlasses: true, confirmedAt: at };
  const job = createJob(db, db.looks[0], ['P-2'], '');
  const refs = pickRefs(job, false, (p) => p);
  assert.deepEqual(refs.identity, ['.local/approved-portrait.png', '.local/body.png']);
  assert.match(buildPrompt(job, '/tmp/control.png', refs), /OWNER-APPROVED PORTRAIT.*ONLY source for facial identity AND hairstyle/);
  assert.doesNotMatch(buildPrompt(job, '/tmp/control.png', refs), /Image 1 is an exact-pixel FACE crop/);
  assert.equal(validateDb(db), null);
  db.profile.identity.approvedPortrait!.approvedAt = '';
  assert.notEqual(validateDb(db), null, 'approval must have a valid date');
  db.profile.identity.approvedPortrait!.approvedAt = at;
  delete db.profile.identity.bodyOriginal;
  assert.notEqual(validateDb(db), null, 'an approved face never waives original physique provenance');
});

test('superseded face or physique blocks frozen retries and already queued jobs', async () => {
  const { store, call, dir } = setup();
  const file = (p: string) => ({ path: p, sha256: 'b'.repeat(64) });
  await store.mutate((db) => {
    db.profile.basePhotoIds = ['P-1'];
    db.profile.identity = { sourcePhotoId: 'P-1', original: file(db.photos[0].path), face: file('.local/old-face.png'), body: file('.local/body.png'), preserveHeadAngle: false, confirmedAt: at };
  });
  const old = await call('POST', '/api/jobs', { lookId: 'L-1' });
  await store.mutate((db) => {
    db.profile.identity!.face = file('.local/approved-portrait.png');
    db.jobs.find((j) => j.id === old.id)!.state = 'error';
  });
  const db = store.read();
  assert.equal(sameIdentity(db.profile.identity, old.snapshot.identity), false);
  const retry = await call('POST', `/api/jobs/${old.id}/retry`);
  assert.equal(retry.state, 'needs_data');
  assert.match(retry.stateNote, /обличчя або статури змінилася/);
  const current = createJob(db, db.looks[0], [], '');
  assert.equal(sameIdentity(db.profile.identity, current.snapshot.identity), true);
  db.profile.identity!.body.sha256 = 'c'.repeat(64);
  assert.equal(sameIdentity(db.profile.identity, current.snapshot.identity), false, 'physique changes also invalidate frozen attempts');
  const fake = path.join(dir, 'must-not-run.sh'), marker = path.join(dir, 'ran');
  fs.writeFileSync(fake, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  await store.mutate((d) => { d.jobs.find((j) => j.id === old.id)!.state = 'queued'; });
  await createRunner(store, dir, fake).drain();
  assert.equal(fs.existsSync(marker), false, 'queued attempts with the old face never reach the generator');
  assert.match(store.read().jobs.find((j) => j.id === old.id)!.stateNote!, /обличчя або статури змінилася/);
});

test('retained uploaded originals survive attempted deletion independently of base selection', async () => {
  const { store, call } = setup();
  await store.mutate((db) => {
    db.photos.push({ id: 'P-selfie', kind: 'base', path: '.local/media/selfie.jpg', originalName: 'selfie.jpg', source: 'upload', preserveAsReference: true, createdAt: at });
    db.profile.basePhotoIds = [];
  });
  await assert.rejects(call('DELETE', '/api/photos/P-selfie'), (e: any) => e.status === 409);
  assert.ok(store.read().photos.some((p) => p.id === 'P-selfie'));
});

test('detaching or splitting a garment source clears its stale crop and keeps the original archive', async () => {
  const { store, call } = setup();
  const crop = { path: '.local/media/trousers.png', sha256: 'a'.repeat(64), source: { path: 'assets/photos/a.jpeg', sha256: 'b'.repeat(64) } };
  await store.mutate((db) => { db.items[0].tryonReference = crop; });
  await call('PATCH', '/api/items/W-1', { photoIds: ['P-2'] });
  assert.equal(store.read().items[0].tryonReference, undefined);
  await store.mutate((db) => { db.items[0].photoIds = ['P-1', 'P-2']; db.items[0].tryonReference = crop; });
  await call('POST', '/api/items/W-1/split', { photoIds: ['P-1'] });
  const db = store.read();
  assert.equal(db.items[0].tryonReference, undefined);
  assert.equal(db.photos.length, 2, 'both originals remain references');
  assert.equal(validateDb(db), null);
});

test('restart re-queues only jobs this runner started, never a job running elsewhere', async () => {
  const { store } = setup();
  const snap = { lookName: 'Look', slots: [], basePhotoIds: ['P-1'], basePhotoPaths: ['assets/photos/a.jpeg'] };
  await store.mutate((db) => {
    db.jobs.push({ id: 'J-own', lookId: 'L-1', lookVersion: 1, snapshot: snap, instructions: '', state: 'running', origin: 'site', createdAt: at, logPath: 'x/jobs/J-own/codex.jsonl' });
    db.jobs.push({ id: 'J-chat', lookId: 'L-1', lookVersion: 1, snapshot: snap, instructions: '', state: 'running', origin: 'site', createdAt: at, stateNote: 'attended elsewhere' });
  });
  const n = await createRunner(store, store.dataDir, '/usr/bin/false').recover();
  assert.equal(n, 1);
  const db = store.read();
  assert.equal(db.jobs.find((j) => j.id === 'J-own')!.state, 'queued');
  assert.equal(db.jobs.find((j) => j.id === 'J-chat')!.state, 'running');
});

const lookWith = (id: string, refs: Partial<Record<'top' | 'layer' | 'bottom' | 'shoes' | 'accessories', string[]>>, extra: Partial<{ favorite: boolean; disliked: boolean; capsuleId: string | null }> = {}) => {
  const slots = emptySlots();
  for (const [k, ids] of Object.entries(refs)) slots[k as 'top'] = ids!.map((x) => ({ kind: 'item' as const, id: x }));
  return { id, rev: 1, capsuleId: null, name: id, slots, version: 1, versions: [{ version: 1, slots, at }], favorite: false, origin: 'agent' as const, createdAt: at, updatedAt: at, ...extra };
};

test("owner's same-look rule: identical or one piece different is the same look; two pieces (accessories too) is a different look", () => {
  const base = lookWith('a', { top: ['T'], bottom: ['B'], shoes: ['S'] });
  assert.ok(sameLook(base, lookWith('b', { top: ['T'], bottom: ['B'], shoes: ['S'] })), 'identical');
  assert.ok(sameLook(base, lookWith('b', { top: ['T'], bottom: ['B'], shoes: ['S2'] })), 'one swap');
  assert.ok(sameLook(base, lookWith('b', { top: ['T'], bottom: ['B'], shoes: ['S'], accessories: ['belt'] })), 'one accessory added');
  assert.ok(!sameLook(base, lookWith('b', { top: ['T'], bottom: ['B'], shoes: ['S2'], accessories: ['belt'] })), 'swap + accessory = two pieces');
  assert.ok(!sameLook(base, lookWith('b', { top: ['T2'], bottom: ['B'], shoes: ['S2'] })), 'two swaps');
});

test('dislike hides the look, its near-copies and a disliked capsule\'s looks; a liked look stays visible', () => {
  const db = fixture();
  db.looks.push(
    lookWith('L-x', { top: ['W-1'], bottom: ['W-2'], shoes: ['W-1'] }, { disliked: true }),
    lookWith('L-near', { top: ['W-1'], bottom: ['W-2'], shoes: ['W-1'], accessories: ['W-2'] }),
    lookWith('L-liked', { top: ['W-1'], bottom: ['W-2'] }, { favorite: true }),
  );
  db.capsules[0].disliked = true;
  const hidden = hiddenLookIds(db);
  assert.deepEqual([...hidden].sort(), ['L-1', 'L-near', 'L-x']);
  assert.ok(isCapsuleHidden(db, db.capsules[0]));
});

test('rating route: like, dislike and clear are exclusive; invalid values are refused', async () => {
  const { store, call } = setup();
  const liked = await call('POST', '/api/looks/L-1/rating', { rating: 'like' });
  assert.equal(liked.favorite, true);
  const disliked = await call('POST', '/api/looks/L-1/rating', { rating: 'dislike' });
  assert.equal(disliked.favorite, false);
  assert.equal(disliked.disliked, true);
  const cleared = await call('POST', '/api/capsules/C-1/rating', { rating: null });
  assert.equal(cleared.disliked, undefined);
  await assert.rejects(call('POST', '/api/looks/L-1/rating', { rating: 'meh' }), /Оцінка/);
  const bad = store.read();
  bad.looks[0].favorite = true;
  assert.match(validateDb(bad) ?? '', /лайк і дизлайк/);
});

test('regeneration is checked against liked and disliked looks; hidden looks get no new renders', async () => {
  const { store } = setup();
  await store.mutate((db) => {
    for (const [id, category] of [['W-S', 'shoes'], ['W-T', 'tees'], ['W-J', 'outerwear'], ['W-K', 'knitwear'], ['W-B', 'shoes']] as const)
      db.items.push({ id, rev: 1, category, title: id, status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    db.looks.push(lookWith('L-no', { top: ['W-T'], layer: ['W-J'], bottom: ['W-1'], shoes: ['W-S'] }, { disliked: true }));
    db.looks.push(lookWith('L-yes', { top: ['W-K'], bottom: ['W-2'], shoes: ['W-B'] }, { favorite: true }));
    const job = { id: 'J-r', kind: 'analyze' as const, lookVersion: 0, snapshot: { lookName: '', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
    const prompt = analyzePrompt(db, job, []);
    assert.match(prompt, /REJECTED[^\n]*\n- W-T, W-J, W-1, W-S/);
    assert.match(prompt, /LIKED[^\n]*\n- W-K, W-2, W-B/);
    const id = applyAnalyze(db, job, {
      status: 'done', reason: '', name: 'Нове', description: '',
      looks: [
        { name: 'rejected again', occasion: '', season: 'all', top: ['W-T'], layer: ['W-J'], bottom: ['W-1'], shoes: ['W-B'], accessories: [], why: '' },
        { name: 'liked again + belt', occasion: '', season: 'all', top: ['W-K'], layer: [], bottom: ['W-2'], shoes: ['W-B'], accessories: ['W-T'], why: '' },
        { name: 'fresh', occasion: '', season: 'all', top: ['W-T'], layer: [], bottom: ['W-2'], shoes: ['W-S'], accessories: [], why: '' },
      ],
    })!;
    assert.deepEqual(db.capsules.find((c) => c.id === id)!.lookIds.map((l) => db.looks.find((x) => x.id === l)!.name), ['fresh']);
    db.profile.basePhotoIds = ['P-1'];
    const queued = queueMissingRenders(db);
    assert.ok(!queued.some((j) => j.lookId === 'L-no'), 'a disliked look is not rendered');
  });
});

test('an upload joined to an existing item names it; the duplicate rule needs matching details, not just type and colour', async () => {
  const { store } = setup();
  await store.mutate((db) => {
    db.photos.push({ id: 'P-belt', kind: 'item', path: 'assets/photos/belt.jpeg', originalName: 'belt.jpeg', source: 'upload', createdAt: at });
    const job = { id: 'J-belt', kind: 'intake' as const, inputPhotoIds: ['P-belt'], lookVersion: 0, snapshot: { lookName: '', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
    assert.match(intakePrompt(db, job, ['belt.jpeg']), /same type and colour alone is NOT enough/);
    const out = applyIntake(db, job, {
      status: 'done', reason: '', photoType: 'garments_only', singlePerson: false, baseSuitable: false, baseIssues: '',
      label: { itemId: '', brand: '', size: '', composition: '' },
      garments: [{ title: 'Штани', category: 'trousers', color: 'синій', notes: '', duplicateOf: 'W-1' }],
    });
    assert.deepEqual(out.attachedTo, ['W-1']);
    assert.match(out.note, /«Navy chinos»/);
    db.jobs.push({ ...job, state: 'done', attachedItemIds: out.attachedTo });
  });
  assert.equal(validateDb(store.read()), null);
});

test('an upload that is an open recommendation leaves the shopping list, replaces the stand-in in looks and re-renders them; undo restores', async () => {
  const { store, call, drained } = setup();
  await store.mutate((db) => {
    db.profile.basePhotoIds = ['P-1'];
    db.photos.push({ id: 'P-tee', kind: 'item', path: 'assets/photos/tee.jpeg', originalName: 'tee.jpeg', source: 'upload', createdAt: at });
    const job = { id: 'J-tee', kind: 'intake' as const, inputPhotoIds: ['P-tee'], lookVersion: 0, snapshot: { lookName: '', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
    const prompt = intakePrompt(db, job, ['tee.jpeg']);
    assert.match(prompt, /N-1 \| футболки \| Молочна футболка/, 'open recommendations are listed for matching');
    assert.match(prompt, /coversNeed/);
    const reply = {
      status: 'done', reason: '', photoType: 'garments_only', singlePerson: false, baseSuitable: false, baseIssues: '',
      label: { itemId: '', brand: '', size: '', composition: '' },
      garments: [
        { title: 'Молочна футболка з емблемою', category: 'tees', color: 'молочний', notes: '', duplicateOf: '', coversNeed: 'N-1' },
        { title: 'Сині штани', category: 'trousers', color: 'синій', notes: '', duplicateOf: '', coversNeed: 'N-1' },
      ],
    };
    const out = applyIntake(db, job, reply);
    const tee = db.items.find((i) => i.title === 'Молочна футболка з емблемою')!;
    assert.deepEqual(out.covers, [{ itemId: tee.id, needId: 'N-1' }], 'only a garment of the same category covers the need');
    db.jobs.push({ ...job, state: 'done', createdItemIds: out.created });
  });
  const tee = store.read().items.find((i) => i.title === 'Молочна футболка з емблемою')!;
  const r = await call('POST', '/api/needs/N-1/cover', { itemId: tee.id });
  let db = store.read();
  assert.deepEqual(r, { looks: 1, queued: 1, waiting: 0 });
  assert.equal(db.needs[0].status, 'covered');
  assert.equal(db.needs[0].coveredByItem, tee.id);
  assert.deepEqual(db.needs[0].coveredLookIds, ['L-1']);
  assert.deepEqual(db.looks[0].slots.top, [{ kind: 'item', id: tee.id }]);
  assert.equal(db.looks[0].version, 2);
  const rerender = db.jobs.find((j) => j.lookId === 'L-1' && j.lookVersion === 2)!;
  assert.equal(rerender.state, 'queued');
  assert.ok(rerender.snapshot.slots.some((s) => s.id === tee.id), 'the new try-on shows the owner\'s item');
  assert.ok(drained() > 0);
  await assert.rejects(call('POST', '/api/needs/N-1/cover', { itemId: tee.id }), /уже закрито/);
  assert.equal(validateDb(db), null);

  await call('POST', '/api/needs/N-1/uncover');
  db = store.read();
  assert.equal(db.needs[0].status, 'open');
  assert.equal(db.needs[0].coveredByItem, undefined);
  assert.deepEqual(db.looks[0].slots.top, [{ kind: 'need', id: 'N-1' }]);

  await call('POST', '/api/needs/N-1/cover', { itemId: tee.id });
  await call('DELETE', `/api/items/${tee.id}`);
  db = store.read();
  assert.equal(db.needs[0].status, 'open', 'deleting the item puts the recommendation back');
  assert.deepEqual(db.looks[0].slots.top, [{ kind: 'need', id: 'N-1' }], 'its looks get the stand-in back instead of a hole');
  assert.equal(validateDb(db), null);
});

test('the runner applies a recommendation match from intake and names it in the status', async () => {
  const { dir, store } = setup();
  const fake = path.join(dir, 'fake-codex.sh');
  fs.writeFileSync(
    fake,
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) o="$2"; shift;; esac; shift; done\ncat >/dev/null\necho \'{"status":"done","reason":"","photoType":"garments_only","singlePerson":false,"baseSuitable":false,"baseIssues":"","label":{"itemId":"","brand":"","size":"","composition":""},"garments":[{"title":"Молочна футболка","category":"tees","color":"молочний","notes":"","duplicateOf":"","coversNeed":"N-1"}]}\' > "$o"\n',
    { mode: 0o755 },
  );
  await store.mutate((db) => {
    db.jobs.push({ id: 'J-in', kind: 'intake', inputPhotoIds: ['P-1'], lookVersion: 0, snapshot: { lookName: 'a.jpeg', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'queued', origin: 'site', createdAt: at });
  });
  await createRunner(store, dir, fake).drain();
  const db = store.read();
  const job = db.jobs.find((j) => j.id === 'J-in')!;
  assert.equal(job.state, 'done');
  assert.match(job.stateNote ?? '', /закриває покупку «Молочна футболка», образів оновлено: 1/);
  assert.equal(db.needs[0].status, 'covered');
  assert.deepEqual(db.looks[0].slots.top, [{ kind: 'item', id: job.createdItemIds![0] }]);
});

test('a try-on waiting on a pause blocks duplicates only while the pause holds', () => {
  const db = fixture();
  db.jobs.push({ id: 'J-wait', lookId: 'L-1', lookVersion: 1, snapshot: { lookName: 'Look', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'needs_data', origin: 'site', createdAt: at });
  assert.deepEqual(looksNeedingRender(db).map((l) => l.id), [], 'still paused (no base photo): the waiting job stands');
  db.profile.basePhotoIds = ['P-1'];
  assert.deepEqual(looksNeedingRender(db).map((l) => l.id), ['L-1'], 'pause lifted: the look needs a fresh try-on');
  db.results.push({ id: 'R-1', jobId: 'J-wait', lookId: 'L-1', lookVersion: 1, imagePath: 'renders/r.png', tool: '', model: '', prompt: '', sources: [], usedItemPhotos: false, review: 'pending', favorite: false, createdAt: at });
  assert.deepEqual(looksNeedingRender(db).map((l) => l.id), [], 'a render of the current composition is enough');
});

test('changing a look\'s pieces queues its new try-on by itself and drops an older one that never started', async () => {
  const { store, call, drained } = setup();
  await store.mutate((db) => {
    db.profile.basePhotoIds = ['P-1'];
    db.items.push({ id: 'W-T', rev: 1, category: 'tees', title: 'Tee', status: 'confirmed', photoIds: [], origin: 'manual', history: [], createdAt: at, updatedAt: at });
  });
  let look = store.read().looks[0];
  await call('PATCH', '/api/looks/L-1', { rev: look.rev, slots: { ...look.slots, top: [{ kind: 'item', id: 'W-T' }] } });
  let db = store.read();
  assert.deepEqual(db.jobs.filter((j) => j.lookId === 'L-1').map((j) => [j.lookVersion, j.state]), [[2, 'queued']]);
  assert.ok(drained() > 0, 'generation starts without pressing anything');
  look = db.looks[0];
  await call('PATCH', '/api/looks/L-1', { rev: look.rev, slots: { ...look.slots, top: [{ kind: 'need', id: 'N-1' }] } });
  db = store.read();
  assert.deepEqual(db.jobs.filter((j) => j.lookId === 'L-1').map((j) => [j.lookVersion, j.state]), [[3, 'queued']], 'only the newest composition is made');
  await call('PATCH', '/api/looks/L-1', { rev: db.looks[0].rev, name: 'Renamed' });
  assert.equal(store.read().jobs.filter((j) => j.lookId === 'L-1').length, 1, 'renaming does not re-render');
});
test('complete looks, the quiet missing line and the next-purchase rating follow the wardrobe', async () => {
  const { store, call } = setup();
  let db = store.read();
  const look = () => store.read().looks[0];
  assert.equal(isComplete(db, look()), false);
  assert.deepEqual(missingInfo(db, look()), { text: 'бракує: молочна футболка', more: 0 });
  assert.equal(purchaseRanking(db)[0].need.id, 'N-1');
  assert.equal(purchaseRanking(db)[0].completes, 1);
  await store.mutate((d) => { d.items.push({ id: 'W-T', rev: 1, category: 'tees', title: 'Молочна футболка', status: 'confirmed', photoIds: [], origin: 'manual', history: [], createdAt: at, updatedAt: at }); });
  await call('POST', '/api/needs/N-1/cover', { itemId: 'W-T' });
  db = store.read();
  assert.equal(isComplete(db, look()), true, 'the owned tee completes the look');
  assert.equal(purchaseRanking(db).length, 0, 'nothing left to buy');
  await call('PATCH', '/api/items/W-T', { rev: db.items.find((i) => i.id === 'W-T')!.rev, status: 'inactive' });
  db = store.read();
  assert.equal(db.needs[0].status, 'open', '«не моя річ» puts the recommendation back');
  assert.equal(isComplete(db, look()), false);
});

test('an inactive item makes a look incomplete; measurements accept a comma and keep their date', async () => {
  const { store, call } = setup();
  await store.mutate((d) => {
    d.looks[0].slots.top = [{ kind: 'item', id: 'W-2' }];
    d.items.find((i) => i.id === 'W-2')!.status = 'inactive';
  });
  const db = store.read();
  assert.equal(isComplete(db, db.looks[0]), false);
  assert.match(missingInfo(db, db.looks[0])!.text, /navy chinos \(дубль\)/i);
  const prof = await call('PATCH', '/api/profile', { rev: store.read().profile.rev, measurements: { chest: { value: '82,5' } } });
  assert.equal(prof.measurements.chest.value, 82.5);
  await store.mutate((d) => { d.profile.measurements.chest.date = '2026-01-01'; });
  const again = await call('PATCH', '/api/profile', { rev: store.read().profile.rev, measurements: { chest: { value: '82.5' } } });
  assert.equal(again.measurements.chest.date, '2026-01-01', 'an unchanged value keeps the day it was measured');
  await assert.rejects(call('PATCH', '/api/profile', { rev: store.read().profile.rev, measurements: { chest: { value: 'abc' } } }), /груди/);
});
