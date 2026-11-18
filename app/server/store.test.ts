import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DB } from './schema.ts';
import { SCHEMA_VERSION, emptySlots, validateDb } from './schema.ts';
import { createStore } from './store.ts';
import { stateView } from './state-view.ts';
import { createJob, dispatch, queueMissingRenders, snapshotSlots, upload } from './routes.ts';
import { sameIdentity, verifyReferenceFiles } from './identity.ts';
import { MAX_IMAGE_REFS, buildPrompt, createRunner, pickRefs } from './runner.ts';
import { analyzePrompt, applyAnalyze, applyIntake, intakePrompt } from './analysis.ts';
import { hiddenLookIds, isCapsuleHidden, sameLook } from '../src/rating.ts';
import { importInspiration } from './inspiration.ts';
import { createHash } from 'node:crypto';
import { changedCoreSlots, groupLookVariations } from '../src/look-variation.ts';
import { looksNeedingRender } from '../src/render-need.ts';
import { isComplete, itemPlacements, itemVerdict, missingInfo, purchaseRanking, wardrobeCapsule } from '../src/lib.ts';
import { applyShopSearch, shopSearchPrompt } from './shop-search.ts';
import { MAX_OPEN_REPLACEMENTS, adviceDue, advisePrompt, applyAdvice, itemsToRate, seenRevs } from './advisor.ts';

const at = '2026-11-17T00:00:00.000Z';
const SAMPLE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FuoAAAAASUVORK5CYII=', 'base64');

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

test('a look requires one capsule and moving it preserves its identity and versions (A04)', async () => {
  const { store, call } = setup();
  await store.mutate((db) => {
    db.capsules.push({ ...db.capsules[0], id: 'C-2', name: 'Інша', lookIds: [] });
    db.capsules.push({ ...db.capsules[0], id: 'C-old', name: 'Перенесена', lookIds: [], redirectCapsuleIds: ['C-2'] });
  });
  await assert.rejects(call('POST', '/api/looks', { name: 'Мікс' }), /Вибери капсулу/);
  await assert.rejects(call('POST', '/api/looks', { capsuleId: 'C-old' }), /Капсулу вже перенесено/);
  const look = await call('POST', '/api/looks', { capsuleId: 'C-1', name: 'Мікс', slots: { bottom: [{ kind: 'item', id: 'W-2' }] } });
  assert.equal(look.capsuleId, 'C-1');
  await assert.rejects(call('PATCH', '/api/capsules/C-1', { lookIds: [] }), /Переносити образ/);
  const moved = await call('PATCH', `/api/looks/${look.id}`, { rev: 1, name: 'Мікс 2', capsuleId: 'C-2' });
  assert.equal(moved.version, 1);
  assert.deepEqual(moved.versions, look.versions);
  assert.deepEqual(store.read().capsules.filter((c) => c.lookIds.includes(look.id)).map((c) => c.id), ['C-2']);
  const changed = await call('PATCH', `/api/looks/${look.id}`, { rev: 2, slots: { bottom: [{ kind: 'item', id: 'W-1' }] } });
  assert.equal(changed.version, 2);
  assert.equal(changed.versions.length, 2);
});

test('wardrobe capsule follows readiness and item placement counts each look once', () => {
  const db = fixture();
  const look = db.looks[0];
  assert.deepEqual(wardrobeCapsule(db).lookIds, [], 'a purchase still needed');
  look.slots = { ...emptySlots(), bottom: [{ kind: 'item', id: 'W-1' }], top: [{ kind: 'item', id: 'W-2' }] };
  assert.deepEqual(wardrobeCapsule(db).lookIds, [look.id]);
  const usage = itemPlacements(db, 'W-2');
  assert.deepEqual(usage.capsules.map((c) => c.id), ['C-1', 'my-wardrobe']);
  assert.deepEqual(usage.looks.map((l) => l.id), [look.id]);
  db.items.find((i) => i.id === 'W-2')!.status = 'inactive';
  assert.deepEqual(wardrobeCapsule(db).lookIds, [], 'ready list follows changes to the wardrobe');
  db.items.find((i) => i.id === 'W-2')!.status = 'confirmed';
  db.looks = db.looks.map((l) => ({ ...l, disliked: true }));
  assert.deepEqual(wardrobeCapsule(db).lookIds, [], 'disliked looks stay out of the ready list');
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
  const other = db.products.find((p) => p.id !== p1.id)!;
  await assert.rejects(call('POST', `/api/products/${other.id}/purchase`, {}), /уже закрито/, 'a closed purchase cannot be bought twice');
  // «Скасувати покупку»: the variant returns, the item leaves, the look gets the purchase back.
  await call('POST', `/api/products/${p1.id}/unpurchase`, {});
  db = store.read();
  assert.equal(db.products.find((p) => p.id === p1.id)!.status, 'option');
  assert.equal(db.items.some((i) => i.id === item.id), false);
  assert.equal(db.needs[0].status, 'open');
  assert.deepEqual(db.looks[0].slots.top, [{ kind: 'need', id: 'N-1' }]);
  assert.equal(validateDb(db), null);
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
  fs.writeFileSync(path.join(dir, 'fixture.png'), SAMPLE_PNG);
  fs.writeFileSync(
    fake,
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -C) d="$2"; shift;; -o) o="$2"; shift;; esac; shift; done\ncat >/dev/null\nsleep 0.3\ncp "$d/../../fixture.png" "$d/result.png"\necho \'{"status":"done","notes":"fake"}\' > "$o"\n',
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
  const style = path.join(dir, 'media', 'packshot-style', 'upper.png');
  fs.mkdirSync(path.dirname(style), { recursive: true });
  fs.writeFileSync(style, SAMPLE_PNG);
  fs.writeFileSync(path.join(dir, 'fixture.png'), SAMPLE_PNG);
  fs.writeFileSync(
    fake,
    '#!/bin/sh\nschema=""\nwhile [ $# -gt 0 ]; do case "$1" in -C) d="$2"; shift;; -o) o="$2"; shift;; --output-schema) schema="$2"; shift;; esac; shift; done\ncat >/dev/null\nif [ -n "$schema" ]; then echo \'{"status":"done","reason":"","garments":[{"title":"Біла оксфорд-сорочка","category":"shirts","color":"білий","notes":"комір на ґудзиках","duplicateOf":""},{"title":"Темно-сині чіноси","category":"trousers","color":"темно-синій","notes":"","duplicateOf":"W-1"}]}\' > "$o"; else cp "$d/../../fixture.png" "$d/result.png"; echo \'{"status":"done"}\' > "$o"; fi\n',
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
  const shirtJob = db.jobs.find((j) => j.itemId === shirt.id)!;
  const shirtPrompt = fs.readFileSync(path.join(dir, 'jobs', shirtJob.id, 'prompt.txt'), 'utf8');
  assert.ok(shirtPrompt.includes(JSON.stringify([path.join(dir, 'assets/photos/a.jpeg'), style])));
  assert.match(shirtPrompt, /LAST image is a studio style reference only/);
  assert.match(shirtPrompt, /rounded shoulders/);
  const chinosJob = db.jobs.find((j) => j.itemId === 'W-1')!;
  assert.equal(chinosJob.state, 'done', 'a matching upload fills a missing cover');
  assert.match(fs.readFileSync(path.join(dir, 'jobs', chinosJob.id, 'prompt.txt'), 'utf8'), /shaped waistband/);
});

test('item photo uploads fill a missing cover once and rejected outputs preserve the current cover', async () => {
  const { dir, store, call } = setup();
  const ctx = { store, projectRoot: dir, drain: () => {} };
  const params = new URLSearchParams({ kind: 'item', item: 'W-2' });
  await upload(ctx, params, SAMPLE_PNG, 'first.png');
  await upload(ctx, params, SAMPLE_PNG, 'second.png');
  assert.equal(store.read().jobs.filter((j) => j.itemId === 'W-2').length, 1);
  const fake = path.join(dir, 'fake-codex.sh');
  fs.writeFileSync(path.join(dir, 'fixture.png'), SAMPLE_PNG);
  const script = (reply: string, save: string) => `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -C) d="$2"; shift;; -o) o="$2"; shift;; esac; shift; done\ncat >/dev/null\n${save}\nprintf '%s' '${reply}' > "$o"\n`;
  const copyPng = 'cp "$d/../../fixture.png" "$d/result.png"';
  fs.writeFileSync(fake, script('{"status":"done"}', copyPng), { mode: 0o755 });
  const runner = createRunner(store, dir, fake);
  await runner.drain();
  const packshotId = store.read().items.find((i) => i.id === 'W-2')!.packshotId;
  assert.ok(packshotId);
  await upload(ctx, params, SAMPLE_PNG, 'third.png');
  assert.equal(store.read().jobs.filter((j) => j.itemId === 'W-2').length, 1, 'evidence does not replace an existing cover');

  for (const [reply, save] of [['{"status":"error","reason":"Still flat"}', copyPng], ['{"status":"done"}', 'printf "not an image" > "$d/result.png"']]) {
    fs.writeFileSync(fake, script(reply, save));
    const retry = await call('POST', '/api/packshots', { itemIds: ['W-2'] });
    await runner.drain();
    const db = store.read();
    assert.equal(db.jobs.find((j) => j.id === retry.jobIds[0])!.state, 'error');
    assert.equal(db.items.find((i) => i.id === 'W-2')!.packshotId, packshotId);
  }
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
  assert.equal(db.jobs.filter((j) => j.kind !== 'advise').length, 0, 'only the advisor run queued by the deletes is left');
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
  const { store, call } = setup();
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
  assert.deepEqual(r, { looks: 1, queued: 0, waiting: 0 }, 'pictures update only when the owner asks');
  assert.equal(db.needs[0].status, 'covered');
  assert.equal(db.needs[0].coveredByItem, tee.id);
  assert.deepEqual(db.needs[0].coveredLookIds, ['L-1']);
  assert.deepEqual(db.looks[0].slots.top, [{ kind: 'item', id: tee.id }]);
  assert.equal(db.looks[0].version, 2);
  assert.ok(!db.jobs.some((j) => j.lookId === 'L-1'), 'no automatic try-on');
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

test('changing a look\'s pieces does not re-render by itself; «Оновити» makes one try-on of the newest pieces', async () => {
  const { store, call, drained } = setup();
  await store.mutate((db) => {
    db.profile.basePhotoIds = ['P-1'];
    db.items.push({ id: 'W-T', rev: 1, category: 'tees', title: 'Tee', status: 'confirmed', photoIds: [], origin: 'manual', history: [], createdAt: at, updatedAt: at });
  });
  let look = store.read().looks[0];
  await call('PATCH', '/api/looks/L-1', { rev: look.rev, slots: { ...look.slots, top: [{ kind: 'item', id: 'W-T' }] } });
  let db = store.read();
  assert.equal(db.jobs.filter((j) => j.lookId === 'L-1').length, 0, 'the owner decides when to update the picture');
  look = db.looks[0];
  await call('PATCH', '/api/looks/L-1', { rev: look.rev, slots: { ...look.slots, top: [{ kind: 'need', id: 'N-1' }] } });
  const job = await call('POST', '/api/jobs', { lookId: 'L-1', run: true });
  db = store.read();
  assert.equal(job.lookVersion, 3, '«Оновити» renders the newest pieces');
  assert.ok(drained() > 0);
  await call('PATCH', '/api/looks/L-1', { rev: db.looks[0].rev, name: 'Renamed' });
  assert.equal(store.read().jobs.filter((j) => j.lookId === 'L-1').length, 1, 'renaming does not re-render');
  // «Речі змінено → Ні» is kept on the look for its current version only; a later change asks again.
  look = store.read().looks[0];
  await call('PATCH', '/api/looks/L-1', { rev: look.rev, keptVersion: look.version });
  look = store.read().looks[0];
  assert.equal(look.keptVersion, 3);
  assert.equal(look.version, 3, 'keeping the picture is not a new version');
  await call('PATCH', '/api/looks/L-1', { rev: look.rev, slots: { ...look.slots, top: [{ kind: 'item', id: 'W-T' }] } });
  look = store.read().looks[0];
  assert.notEqual(look.keptVersion, look.version, 'new pieces bring the question back');
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
test('«Знайти» searches the shops for a recommendation and saves dated variants with a match score; «Мої бренди» saves a clean list', async () => {
  const { dir, store, call } = setup();
  const prof = await call('PATCH', '/api/profile', { rev: store.read().profile.rev, brands: ['Levi’s', ' Tom Tailor ', 'Levi’s', ''] });
  assert.deepEqual(prof.brands, ['Levi’s', 'Tom Tailor']);
  const shops = await call('PATCH', '/api/profile', { rev: prof.rev, location: ' Tower Center Rijeka ', stores: ['Buzz Sneakers', ' Buzz Sneakers ', ''] });
  assert.equal(shops.location, 'Tower Center Rijeka');
  assert.deepEqual(shops.stores, ['Buzz Sneakers']);
  const job = await call('POST', '/api/needs/N-1/search', {});
  const prompt = shopSearchPrompt(store.read(), job);
  assert.match(prompt, /«Tower Center Rijeka»/);
  assert.match(prompt, /Owner's stores \(check these first\): Buzz Sneakers/);
  assert.match(prompt, /Levi’s, Tom Tailor/);
  // Article numbers leave the name the owner sees and go to sku.
  const scratch = fixture();
  const coded = applyShopSearch(scratch, { ...job, needId: 'N-1' }, { status: 'done', reason: '', products: [{ store: 'Buzz', brand: 'Adidas', model: 'Handball Spezial Shadow Brown (JQ1740)', url: 'https://example.com/a', imageUrl: '', price: '109.99', currency: 'EUR', inTower: true, size: '', matchScore: 10, matchNote: '' }] });
  const cp = scratch.products.find((x) => x.id === coded.created[0])!;
  assert.equal(cp.model, 'Handball Spezial Shadow Brown');
  assert.equal(cp.sku, 'JQ1740');
  assert.equal(job.kind, 'shopsearch');
  await assert.rejects(call('POST', '/api/needs/N-1/search', {}), /Пошук уже йде/);
  const fake = path.join(dir, 'fake-codex.sh');
  const reply = { status: 'done', reason: '', products: [
    { store: 'Tom Tailor', brand: 'Tom Tailor', model: 'Basic T-shirt off-white', url: 'https://www.tom-tailor.eu/p/1', imageUrl: '', price: '19,99', currency: 'EUR', inTower: true, size: 'M', matchScore: 8.6, matchNote: 'Молочний колір і щільна бавовна, як просили.' },
    { store: 'Somewhere', brand: 'X', model: 'Tee', url: 'http://insecure.example/p', imageUrl: '', price: '', currency: '', inTower: false, size: '', matchScore: 5, matchNote: '' },
  ] };
  fs.writeFileSync(fake, `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--search" ] && touch "${dir}/searched"; done\nwhile [ $# -gt 0 ]; do case "$1" in -o) o="$2"; shift;; esac; shift; done\ncat >/dev/null\necho '${JSON.stringify(reply)}' > "$o"\n`, { mode: 0o755 });
  await createRunner(store, dir, fake).drain();
  const db = store.read();
  assert.ok(fs.existsSync(path.join(dir, 'searched')), 'the shop search runs with live web search');
  assert.equal(db.jobs.find((j) => j.id === job.id)!.stateNote, 'Знайдено варіантів: 1', 'an insecure link is not saved');
  const p = db.products.find((x) => x.needId === 'N-1')!;
  assert.equal(p.price, 19.99);
  assert.equal(p.matchScore, 9);
  assert.equal(p.towerAvailability, 'confirmed');
  assert.equal(p.recommendedSize, 'M');
  assert.match(p.checkedAt ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(validateDb(db), null);
});

test('the advisor rates items and looks, proposes looks only on «Додати», turns a replacement into a purchase; runs after changes, once at a time, and weekly', async () => {
  const { dir, store, call } = setup();
  await store.mutate((db) => {
    const add = (id: string, category: 'tees' | 'shoes', title: string) => db.items.push({ id, rev: 1, category, title, status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    add('W-S', 'shoes', 'Brown suede sneakers');
    add('W-T', 'tees', 'White tee');
    add('W-T2', 'tees', 'Milk tee');
    add('W-LOGO', 'tees', 'Big logo tee');
    db.items.push({ id: 'W-G', rev: 1, category: 'accessories', title: 'Окуляри в черепаховій оправі', status: 'confirmed', photoIds: [], origin: 'manual', history: [], createdAt: at, updatedAt: at });
    db.looks[0].slots = { ...emptySlots(), top: [{ kind: 'item', id: 'W-T' }], bottom: [{ kind: 'item', id: 'W-1' }], shoes: [{ kind: 'item', id: 'W-S' }] };
  });
  // A rating queues one advice; more changes share it.
  await call('POST', '/api/looks/L-1/rating', { rating: 'like' });
  await call('POST', '/api/capsules/C-1/rating', { rating: 'like' });
  let db = store.read();
  assert.equal(db.jobs.filter((j) => j.kind === 'advise').length, 1);
  assert.equal(adviceDue(db), false, 'one is already waiting');
  const job = db.jobs.find((j) => j.kind === 'advise')!;
  assert.match(advisePrompt(db, job, []), /rate ONLY these ids now: .*W-LOGO/);
  const reply = {
    status: 'done', reason: '',
    items: [
      { id: 'W-T', score: 8.4, note: 'Чиста база.', replace: '', replaceWith: '' },
      { id: 'W-LOGO', score: 4, note: 'Логотип кричить.', replace: 'великий логотип', replaceWith: 'Однотонна темно-синя футболка' },
    ],
    looks: [{ id: 'L-1', score: 7, weakItem: 'W-T', swapTo: 'W-T2', why: 'Молочна тепліша.' }],
    newLooks: [
      { name: 'Без капсули', capsuleId: '', top: ['W-LOGO'], layer: [], bottom: ['W-2'], shoes: ['W-S'], accessories: [], why: '' },
      { name: 'Майже той самий', capsuleId: 'C-1', top: ['W-T2'], layer: [], bottom: ['W-1'], shoes: ['W-S'], accessories: [], why: '' },
      { name: 'Новий', capsuleId: 'C-1', top: ['W-LOGO'], layer: [], bottom: ['W-2'], shoes: ['W-S'], accessories: ['W-G'], why: 'Вводить дубль чиносів.' },
    ],
    newCapsules: [],
    newNeeds: [
      { capsuleId: 'C-1', title: 'Тепла куртка', category: 'outerwear', why: 'Капсулі бракує теплого шару.' },
      { capsuleId: 'C-1', title: 'Молочна футболка', category: 'tees', why: 'Повтор відкритої покупки.' },
    ],
  };
  const fake = path.join(dir, 'fake-codex.sh');
  fs.writeFileSync(fake, `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) o="$2"; shift;; esac; shift; done\ncat >/dev/null\necho '${JSON.stringify(reply)}' > "$o"\n`, { mode: 0o755 });
  await createRunner(store, dir, fake).drain();
  db = store.read();
  assert.equal(db.jobs.find((j) => j.id === job.id)!.state, 'done');
  assert.equal(db.items.find((i) => i.id === 'W-T')!.rating!.score, 8);
  const logo = db.items.find((i) => i.id === 'W-LOGO')!;
  assert.equal(logo.rating!.replace, 'великий логотип');
  const replacement = db.needs.find((n) => n.replaces === 'W-LOGO')!;
  assert.equal(replacement.status, 'open');
  assert.equal(replacement.category, 'tees');
  assert.deepEqual(db.looks[0].advice!.swap, { from: 'W-T', to: 'W-T2' });
  const gaps = db.needs.filter((n) => n.forCapsule === 'C-1');
  assert.deepEqual(gaps.map((n) => n.title), ['Тепла куртка'], 'a capsule gap becomes one purchase; an open purchase is not repeated');
  const open = db.suggestions!.filter((s) => s.status === 'open');
  assert.deepEqual(open.map((s) => s.name), ['Новий'], 'near-copies and looks without a capsule are skipped');
  assert.equal(db.looks.length, 1, 'nothing enters a capsule before «Додати»');
  assert.equal(validateDb(db), null);
  // «Додати» puts the look into its capsule; «Ні» on a swap never offers it again.
  const added = await call('POST', `/api/suggestions/${open[0].id}/accept`, {});
  db = store.read();
  const newLook = db.looks.find((l) => `/looks/${l.id}` === added.href)!;
  assert.equal(newLook.capsuleId, 'C-1');
  assert.equal(Object.values(newLook.slots).flat().some((r) => r.id === 'W-G'), false, 'never eyewear in a look');
  assert.ok(db.capsules[0].lookIds.includes(newLook.id));
  await assert.rejects(call('POST', `/api/suggestions/${open[0].id}/reject`, {}), /вже розглянуто/);
  await call('POST', '/api/looks/L-1/advice', { accept: false });
  db = store.read();
  assert.equal(db.looks[0].advice!.swap, undefined);
  assert.deepEqual(db.looks[0].advice!.rejected, ['W-T>W-T2']);
  // Declining the replacement keeps the item for good.
  await call('DELETE', `/api/needs/${replacement.id}`);
  assert.equal(store.read().items.find((i) => i.id === 'W-LOGO')!.rating!.kept, true);
  // The weekly review is due seven days after the last one.
  db = store.read();
  assert.equal(adviceDue(db), false);
  assert.equal(adviceDue(db, Date.now() + 8 * 24 * 60 * 60 * 1000), true);
  assert.equal(validateDb(db), null);
});

test('round 5: eyewear stays out of «Підібрати»; advice is stamped with what it saw, never replaces the owner\'s own picks, fills free places, and undo brings a retired item back', async () => {
  const { store, call } = setup();
  const item = (id: string, category: 'tees' | 'shoes' | 'accessories' | 'shirts', title: string, origin: 'candidate' | 'manual' = 'candidate') =>
    ({ id, rev: 1, category, title, status: 'confirmed' as const, photoIds: [], origin, history: [], createdAt: at, updatedAt: at });
  await store.mutate((db) => {
    db.items.push(item('W-S', 'shoes', 'White sneakers'), item('W-G', 'accessories', 'Окуляри в черепаховій оправі'), item('W-POLO', 'shirts', 'Червоне поло', 'manual'));
    db.items.push(item('W-A', 'tees', 'Logo tee A'), item('W-B', 'tees', 'Logo tee B'), item('W-C', 'tees', 'Logo tee C'), item('W-D', 'tees', 'Logo tee D'), item('W-NEW', 'tees', 'Plain tee'));
  });
  // «Підібрати» never lists or uses glasses.
  let db = store.read();
  const job = { id: 'J-an', kind: 'analyze' as const, lookVersion: 0, snapshot: { lookName: 'x', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
  assert.doesNotMatch(analyzePrompt(db, job, []), /W-G/);
  await store.mutate((d) => {
    const id = applyAnalyze(d, job, { status: 'done', reason: '', name: 'Тест', description: '', looks: [{ name: 'З окулярами', occasion: '', season: 'all', why: '', top: ['W-A'], layer: [], bottom: ['W-1'], shoes: ['W-S'], accessories: ['W-G'] }] });
    const look = d.looks.find((l) => l.capsuleId === id)!;
    assert.equal(Object.values(look.slots).flat().some((r) => r.id === 'W-G'), false);
  });
  // Ratings carry the revision the advisor saw: an edit made meanwhile is rated again.
  db = store.read();
  const seen = seenRevs(db);
  const advise = { id: 'J-adv', kind: 'advise' as const, lookVersion: 0, snapshot: { lookName: 'Порадник', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
  const logo = (id: string, score: number) => ({ id, score, note: 'Логотип.', replace: 'великий логотип', replaceWith: `Однотонна футболка ${id}` });
  await store.mutate((d) => {
    d.items.find((i) => i.id === 'W-S')!.rev += 1;
    applyAdvice(d, advise, {
      status: 'done', reason: '',
      items: [{ id: 'W-S', score: 8, note: 'База.', replace: '', replaceWith: '' }, { id: 'W-POLO', score: 5, note: 'Яскраве.', replace: 'червоний домінує', replaceWith: 'Бордове поло' }, logo('W-A', 3), logo('W-B', 4), logo('W-C', 5), logo('W-D', 6)],
      looks: [{ id: 'L-1', score: 9.46, weakItem: '', swapTo: '', why: 'Гармонійно.' }], newLooks: [], newCapsules: [], newNeeds: [],
    }, seen);
  });
  db = store.read();
  assert.ok(itemsToRate(db).some((i) => i.id === 'W-S'), 'edited during the run → rated again');
  const polo = db.items.find((i) => i.id === 'W-POLO')!;
  assert.equal(polo.rating!.replace, undefined, 'a piece the owner added himself is never «варто замінити»');
  assert.equal(db.looks[0].advice!.score, 9.5, 'look scores keep one decimal');
  const open = () => store.read().needs.filter((n) => n.replaces && n.status === 'open');
  assert.equal(open().length, MAX_OPEN_REPLACEMENTS);
  assert.deepEqual(open().map((n) => n.replaces), ['W-A', 'W-B', 'W-C'], 'lowest scores take the places');
  // Declining one frees a place for W-D on the next run, even though W-D is not rated again; the declined title never returns.
  const declined = open()[0];
  await call('DELETE', `/api/needs/${declined.id}`);
  assert.deepEqual(store.read().declinedNeeds, [declined.title]);
  await store.mutate((d) => void applyAdvice(d, advise, { status: 'done', reason: '', items: [], looks: [], newLooks: [], newCapsules: [], newNeeds: [{ capsuleId: 'C-1', title: declined.title, category: 'tees', why: 'x' }] }));
  assert.deepEqual(open().map((n) => n.replaces), ['W-B', 'W-C', 'W-D']);
  assert.ok(!store.read().needs.some((n) => n.forCapsule && n.title === declined.title), 'a declined purchase is not proposed again');
  // «Ні» on «варто замінити»: kept, its purchase withdrawn (with its finished search), rated again, advice queued.
  await store.mutate((d) => {
    const n = d.needs.find((x) => x.replaces === 'W-B')!;
    d.jobs.push({ id: 'J-search-B', kind: 'shopsearch', needId: n.id, lookVersion: 0, snapshot: { lookName: 'x', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'done', origin: 'site', createdAt: at });
  });
  await call('POST', '/api/items/W-B/keep');
  assert.ok(!store.read().jobs.some((j) => j.id === 'J-search-B'));
  db = store.read();
  assert.equal(db.items.find((i) => i.id === 'W-B')!.rating!.kept, true);
  assert.ok(!db.needs.some((n) => n.replaces === 'W-B'));
  assert.ok(itemsToRate(db).some((i) => i.id === 'W-B'));
  assert.equal(db.jobs.filter((j) => j.kind === 'advise' && j.state === 'queued').length, 1);
  // «Вже маю» with «Прибрати стару річ», then «Повернути в покупки»: the old item returns to the wardrobe and its looks.
  const need = open().find((n) => n.replaces === 'W-C')!;
  await store.mutate((d) => {
    d.looks[0].slots.top = [{ kind: 'item', id: 'W-C' }];
    d.looks[0].slots.shoes = [{ kind: 'item', id: 'W-S' }];
  });
  await call('POST', `/api/needs/${need.id}/cover`, { itemId: 'W-NEW', retire: true });
  assert.equal(store.read().items.find((i) => i.id === 'W-C')!.status, 'inactive');
  await call('POST', `/api/needs/${need.id}/uncover`);
  db = store.read();
  assert.equal(db.items.find((i) => i.id === 'W-C')!.status, 'confirmed', 'undo brings the retired item back');
  assert.equal(db.needs.find((n) => n.id === need.id)!.retired, undefined);
  // «Це моя річ? — Ні» frees the replacement purchase made for that item.
  const forD = open().find((n) => n.replaces === 'W-D')!;
  await call('PATCH', '/api/items/W-D', { rev: db.items.find((i) => i.id === 'W-D')!.rev, status: 'inactive' });
  assert.ok(!store.read().needs.some((n) => n.id === forD.id));
  // New, edited and merged items queue the advisor too.
  await store.mutate((d) => void (d.jobs = d.jobs.filter((j) => j.kind !== 'advise')));
  await call('POST', '/api/items', { category: 'tees', title: 'Нова футболка' });
  assert.equal(store.read().jobs.filter((j) => j.kind === 'advise').length, 1);
  assert.equal(validateDb(store.read()), null);
});

test('round 5: a dropped shop variant never comes back; open proposals stay until answered; a failed advisor run waits a day', async () => {
  const { store, call } = setup();
  const product = await call('POST', '/api/products', { needId: 'N-1', store: 'Zara', model: 'Milk tee', url: 'https://example.com/tee' });
  await call('DELETE', `/api/products/${product.id}`);
  let db = store.read();
  assert.deepEqual(db.needs[0].droppedUrls, ['https://example.com/tee']);
  const search = { id: 'J-s', kind: 'shopsearch' as const, needId: 'N-1', lookVersion: 0, snapshot: { lookName: 'x', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
  assert.match(shopSearchPrompt(db, search), /Already found.*https:\/\/example\.com\/tee/);
  await store.mutate((d) => void applyShopSearch(d, search, { status: 'done', reason: '', products: [{ store: 'Zara', model: 'Milk tee', sku: '', url: 'https://example.com/tee', imageUrl: '', price: '', currency: 'EUR', inTower: false, size: '', matchScore: 8, matchNote: 'x' }] } as never));
  assert.equal(store.read().products.length, 0, 'the dropped link is not saved again');
  // An unanswered proposal survives the next run while its pieces are owned.
  await store.mutate((d) => {
    d.items.push({ id: 'W-S', rev: 1, category: 'shoes', title: 'Sneakers', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    d.suggestions = [{ id: 'A-1', kind: 'look', status: 'open', name: 'Старий', why: '', capsuleId: 'C-1', looks: [{ name: 'Старий', why: '', slots: { ...emptySlots(), top: [{ kind: 'item', id: 'W-2' }], bottom: [{ kind: 'item', id: 'W-1' }], shoes: [{ kind: 'item', id: 'W-S' }] } }], jobId: 'J-0', createdAt: at }];
  });
  const advise = { id: 'J-adv', kind: 'advise' as const, lookVersion: 0, snapshot: { lookName: 'Порадник', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
  await store.mutate((d) => void applyAdvice(d, advise, { status: 'done', reason: '', items: [], looks: [], newLooks: [], newCapsules: [], newNeeds: [] }));
  assert.deepEqual(store.read().suggestions!.map((s) => s.id), ['A-1']);
  // With the places full, a proposal for a piece that has no look yet replaces the oldest unanswered one.
  await store.mutate((d) => {
    d.items.push({ id: 'W-NEW', rev: 1, category: 'tees', title: 'Нове поло', status: 'confirmed', photoIds: [], origin: 'manual', history: [], createdAt: at, updatedAt: at });
    d.items.push({ id: 'W-S2', rev: 1, category: 'shoes', title: 'Loafers', status: 'confirmed', photoIds: [], origin: 'candidate', history: [], createdAt: at, updatedAt: at });
    const old = d.suggestions![0];
    d.suggestions!.push({ ...old, id: 'A-2', createdAt: '2026-11-17T01:00:00.000Z' }, { ...old, id: 'A-3', createdAt: '2026-11-17T02:00:00.000Z' });
  });
  await store.mutate((d) => void applyAdvice(d, advise, { status: 'done', reason: '', items: [], looks: [], newCapsules: [], newNeeds: [], newLooks: [{ name: 'З новим', capsuleId: 'C-1', top: ['W-NEW'], layer: [], bottom: ['W-1'], shoes: ['W-S2'], accessories: [], why: 'Нова річ.' }] }));
  assert.deepEqual(store.read().suggestions!.filter((s) => s.status === 'open').map((s) => s.name).sort(), ['З новим', 'Старий', 'Старий']);
  assert.ok(!store.read().suggestions!.some((s) => s.id === 'A-1'), 'the oldest unanswered proposal made room');
  // After a failed run the weekly check waits a day instead of retrying every hour.
  await store.mutate((d) => void d.jobs.push({ ...advise, id: 'J-fail', state: 'error', finishedAt: new Date().toISOString() }));
  db = store.read();
  assert.equal(adviceDue(db), false);
  assert.equal(adviceDue(db, Date.now() + 25 * 60 * 60 * 1000), true);
});

test('round 6: a found replacement is not proposed again; stale replacements go; a new piece\'s proposal comes first; outfits are checked; look edits re-rate; «Ні» survives a merge', async () => {
  const { store, call } = setup();
  const item = (id: string, category: 'tees' | 'shoes' | 'accessories' | 'shirts' | 'outerwear', title: string, origin: 'candidate' | 'manual' = 'candidate') =>
    ({ id, rev: 1, category, title, status: 'confirmed' as const, photoIds: [], origin, history: [], createdAt: at, updatedAt: at });
  await store.mutate((d) => {
    d.items.push(item('W-S', 'shoes', 'Sneakers'), item('W-A', 'tees', 'Logo tee A'), item('W-NEW', 'tees', 'Plain tee'), item('W-J', 'outerwear', 'Jacket'), item('W-G', 'accessories', 'Окуляри'));
  });
  const advise = { id: 'J-adv', kind: 'advise' as const, lookVersion: 0, snapshot: { lookName: 'Порадник', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
  const empty = { status: 'done', reason: '', items: [], looks: [], newLooks: [], newCapsules: [], newNeeds: [] };
  const logoA = { id: 'W-A', score: 3, note: 'Логотип.', replace: 'великий логотип', replaceWith: 'Однотонна футболка' };
  await store.mutate((d) => void applyAdvice(d, advise, { ...empty, items: [logoA] }));
  const needA = store.read().needs.find((n) => n.replaces === 'W-A')!;
  // «Вже маю» without retiring the old piece: the next run does not make the same purchase again; undo leaves one open.
  await call('POST', `/api/needs/${needA.id}/cover`, { itemId: 'W-NEW' });
  await store.mutate((d) => void applyAdvice(d, advise, { ...empty, items: [logoA] }));
  assert.equal(store.read().needs.filter((n) => n.replaces === 'W-A').length, 1);
  await call('POST', `/api/needs/${needA.id}/uncover`);
  assert.equal(store.read().needs.filter((n) => n.replaces === 'W-A' && n.status === 'open').length, 1);
  // A piece never closes the purchase that replaces it.
  await assert.rejects(call('POST', `/api/needs/${needA.id}/cover`, { itemId: 'W-A' }), /та сама річ/);
  // «Ні» while its search runs: the purchase waits; the next run withdraws it and gives its look a new version.
  await store.mutate((d) => {
    d.jobs.push({ id: 'J-search-A', kind: 'shopsearch', needId: needA.id, lookVersion: 0, snapshot: { lookName: 'x', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running', origin: 'site', createdAt: at });
    d.looks[0].slots.top = [{ kind: 'need', id: needA.id }];
  });
  await call('POST', '/api/items/W-A/keep');
  assert.ok(store.read().needs.some((n) => n.id === needA.id), 'kept while its search runs');
  await store.mutate((d) => void (d.jobs.find((j) => j.id === 'J-search-A')!.state = 'done'));
  const before = store.read().looks[0].version;
  await store.mutate((d) => void applyAdvice(d, advise, empty));
  let db = store.read();
  assert.ok(!db.needs.some((n) => n.id === needA.id), 'withdrawn on the next run');
  assert.equal(db.looks[0].version, before + 1, 'the look that used it gets a new version');
  assert.deepEqual(db.looks[0].slots.top, []);
  // A proposal for a piece with no look comes before the older ones (Home shows two); bad outfits are rejected, glasses dropped.
  await store.mutate((d) => {
    d.items.push(item('W-FRESH', 'shirts', 'Linen shirt', 'manual'));
    d.suggestions = [{ id: 'A-1', kind: 'look', status: 'open', name: 'Старий', why: '', capsuleId: 'C-1', looks: [{ name: 'Старий', why: '', slots: { ...emptySlots(), top: [{ kind: 'item', id: 'W-A' }], bottom: [{ kind: 'item', id: 'W-1' }], shoes: [{ kind: 'item', id: 'W-S' }] } }], jobId: 'J-0', createdAt: at }];
  });
  await store.mutate((d) => void applyAdvice(d, advise, { ...empty, newLooks: [
    { name: 'З новою', capsuleId: 'C-1', top: ['W-FRESH'], layer: [], bottom: ['W-2'], shoes: ['W-S'], accessories: ['W-G'], why: '' },
    { name: 'Куртка внизу', capsuleId: 'C-1', top: ['W-NEW'], layer: [], bottom: ['W-J'], shoes: ['W-S'], accessories: [], why: '' },
    { name: 'Зникла річ', capsuleId: 'C-1', top: ['W-GONE'], layer: [], bottom: ['W-1'], shoes: ['W-S'], accessories: [], why: '' },
  ] }));
  db = store.read();
  assert.deepEqual(db.suggestions!.filter((s) => s.status === 'open').map((s) => s.name), ['З новою', 'Старий']);
  assert.deepEqual(db.suggestions![0].looks[0].slots.accessories, [], 'glasses are left out, the outfit stays');
  // Changing a look's pieces queues the advisor; a score for the version it saw is not current.
  await store.mutate((d) => void (d.jobs = d.jobs.filter((j) => j.kind !== 'advise')));
  const seen = seenRevs(store.read());
  const look = store.read().looks[0];
  await call('PATCH', '/api/looks/L-1', { rev: look.rev, slots: { top: [{ kind: 'item', id: 'W-NEW' }], bottom: [{ kind: 'item', id: 'W-1' }], shoes: [{ kind: 'item', id: 'W-S' }] } });
  assert.equal(store.read().jobs.filter((j) => j.kind === 'advise').length, 1);
  await store.mutate((d) => void applyAdvice(d, advise, { ...empty, looks: [{ id: 'L-1', score: 9.2, weakItem: '', swapTo: '', why: 'x' }] }, seen));
  db = store.read();
  assert.notEqual(db.looks[0].advice!.version, db.looks[0].version, 'a look edited during the run is scored again');
  // «Так» on the advisor's swap queues it too.
  await store.mutate((d) => {
    d.jobs = d.jobs.filter((j) => j.kind !== 'advise');
    const l = d.looks[0];
    l.advice = { score: 8, why: 'x', version: l.version, swap: { from: 'W-1', to: 'W-2' } };
  });
  await call('POST', '/api/looks/L-1/advice', { accept: true });
  assert.equal(store.read().jobs.filter((j) => j.kind === 'advise').length, 1);
  // «Ні» on «варто замінити» survives a merge; glasses never go into «Ще образ».
  const merged = await call('POST', '/api/items/merge', { ids: ['W-A', 'W-NEW'] });
  assert.equal(store.read().items.find((i) => i.id === merged.id)!.rating!.kept, true);
  await assert.rejects(call('POST', '/api/analyze', { itemIds: ['W-G'] }), /Окуляри/);
  // The item line: no verdict for glasses; the reason reads as part of the sentence.
  await store.mutate((d) => {
    d.items.find((i) => i.id === 'W-G')!.rating = { score: 9, note: 'x', rev: 1, at };
    d.items.find((i) => i.id === 'W-J')!.rating = { score: 4, note: 'x', replace: 'Великий логотип на спині.', replaceWith: 'Однотонна куртка', rev: 1, at };
  });
  db = store.read();
  assert.equal(itemVerdict(db, db.items.find((i) => i.id === 'W-G')!), null);
  assert.equal(itemVerdict(db, db.items.find((i) => i.id === 'W-J')!)!.line, '4/10 · варто замінити: великий логотип на спині');
  assert.equal(validateDb(db), null);
});

test('round 6: a dropped product stays dropped under another link or with tracking parameters', async () => {
  const { store, call } = setup();
  const product = await call('POST', '/api/products', { needId: 'N-1', store: 'Zara', model: 'Milk tee', url: 'https://example.com/tee?utm_source=x' });
  await call('DELETE', `/api/products/${product.id}`);
  const search = { id: 'J-s', kind: 'shopsearch' as const, needId: 'N-1', lookVersion: 0, snapshot: { lookName: 'x', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: '', state: 'running' as const, origin: 'site' as const, createdAt: at };
  const found = (store: string, model: string, url: string) => ({ store, brand: '', model, sku: '', url, imageUrl: '', price: '', currency: 'EUR', inTower: false, size: '', matchScore: 8, matchNote: 'x' });
  await store.mutate((d) => void applyShopSearch(d, search, { status: 'done', reason: '', products: [
    found('Zara', 'Milk tee', 'https://www.example.com/tee/?color=2'),
    found('Zara', 'Milk tee', 'https://zara.com/milk-tee-123'),
    found('Mango', 'Ecru tee', 'https://mango.com/ecru'),
  ] } as never));
  assert.deepEqual(store.read().products.map((p) => p.model), ['Ecru tee']);
});
