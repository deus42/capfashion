import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DB } from './schema.ts';
import { SCHEMA_VERSION, emptySlots, validateDb } from './schema.ts';
import { createStore } from './store.ts';
import { dispatch, snapshotSlots } from './routes.ts';
import { buildPrompt, createRunner } from './runner.ts';
import { applyAnalyze, applyIntake } from './analysis.ts';

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
    const job = { id: 'J-an', kind: 'analyze' as const, lookVersion: 0, snapshot: { lookName: '', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: 'на вихідні', state: 'running' as const, origin: 'site' as const, createdAt: at };
    db.jobs.push(job);
    const id = applyAnalyze(db, job, {
      status: 'done', reason: '', name: 'Вихідні', description: 'Легко',
      looks: [
        { name: 'A', occasion: 'прогулянка', season: 'warm', top: ['N-1'], layer: [], bottom: ['W-1'], shoes: ['W-S'], accessories: [], why: 'спокійно' },
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
    '#!/bin/sh\nschema=""\nwhile [ $# -gt 0 ]; do case "$1" in -C) d="$2"; shift;; -o) o="$2"; shift;; --output-schema) schema="$2"; shift;; esac; shift; done\ncat >/dev/null\nif [ -n "$schema" ]; then echo \'{"status":"done","reason":"","name":"Вихідні","description":"","looks":[{"name":"A","occasion":"","season":"all","top":[],"layer":[],"bottom":["W-1"],"shoes":["W-S"],"accessories":[],"why":""},{"name":"B","occasion":"","season":"all","top":[],"layer":[],"bottom":["W-2"],"shoes":["W-S"],"accessories":[],"why":""}]}\' > "$o"; else printf PNG > "$d/result.png"; echo \'{"status":"done"}\' > "$o"; fi\n',
    { mode: 0o755 },
  );
  await store.mutate((db) => {
    db.items.push({ id: 'W-S', rev: 1, category: 'shoes', title: 'Stan Smith', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    db.profile.basePhotoIds = ['P-1'];
  });
  const job = await call('POST', '/api/analyze', {});
  assert.match(job.instructions, /^Тема: /, 'an empty request gets a theme for variety');
  await createRunner(store, dir, fake).drain();
  const db = store.read();
  const sel = db.capsules.find((c) => c.kind === 'selection')!;
  assert.equal(sel.lookIds.length, 2);
  for (const id of sel.lookIds) assert.ok(db.results.some((r) => r.lookId === id), `look ${id} has a render`);
  const again = await call('POST', '/api/renders/missing', {});
  assert.equal(again.queued, 1, 'only the seed look L-1 still lacked a render');
  const twice = await call('POST', '/api/renders/missing', {});
  assert.equal(twice.queued, 0, 'no duplicate jobs while one is queued');
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
        { name: 'b', occasion: '', season: 'all', top: [], layer: [], bottom: ['W-1'], shoes: ['W-B'], accessories: [], why: '' },
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
  assert.match(prompt, /recognisably this person/);
});
