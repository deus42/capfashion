import path from 'node:path';
import type { DB, Item, Job, Look, Photo, PhotoKind, ReworkReason, SlotKey, SlotRef, Slots, SnapshotSlot } from './schema.ts';
import { CATEGORIES, ITEM_STATUSES, MEASURE_KEYS, PHOTO_KINDS, REWORK_REASONS, SEASONS, SLOT_KEYS } from './schema.ts';
import type { Store } from './store.ts';
import { HttpError, bump, findOr404, newId, now } from './store.ts';
import { saveUpload } from './media.ts';

type Body = Record<string, unknown>;
export interface Ctx {
  store: Store;
  projectRoot: string;
  drain: () => void;
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const SLOT_TEXT: Record<SlotKey, string> = { top: 'Верх', layer: 'Верхній шар', bottom: 'Низ', shoes: 'Взуття', accessories: 'Аксесуари' };

function pick<T extends object>(target: T, body: Body, fields: (keyof T & string)[]) {
  for (const f of fields) {
    if (!(f in body)) continue;
    const v = body[f];
    (target as Record<string, unknown>)[f] = typeof v === 'string' ? v.trim().slice(0, 2000) || undefined : v;
  }
}

function sameSlots(a: Slots, b: Slots) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cleanSlots(raw: unknown): Slots {
  const out = { top: [], layer: [], bottom: [], shoes: [], accessories: [] } as Slots;
  const src = (raw ?? {}) as Record<string, unknown>;
  for (const k of SLOT_KEYS) {
    const list = Array.isArray(src[k]) ? (src[k] as SlotRef[]) : [];
    out[k] = list
      .filter((r) => r && ['item', 'need', 'product'].includes(r.kind) && typeof r.id === 'string')
      .map((r) => ({ kind: r.kind, id: r.id }));
  }
  return out;
}

function setLookSlots(look: Look, slots: Slots, note?: string) {
  if (sameSlots(look.slots, slots)) return false;
  look.version += 1;
  look.slots = slots;
  look.versions.push({ version: look.version, slots, at: now(), note });
  return true;
}

/** Freezes the exact selection, photos and texts at queue time. */
export function snapshotSlots(db: DB, slots: Slots): SnapshotSlot[] {
  const out: SnapshotSlot[] = [];
  for (const slot of SLOT_KEYS) {
    for (const ref of slots[slot]) {
      if (ref.kind === 'item') {
        const item = findOr404(db.items, ref.id, 'Річ');
        const photos = item.photoIds.slice(0, 2).map((pid) => findOr404(db.photos, pid, 'Фото').path);
        const details = [item.color, item.brand, item.model, item.fit, item.composition].filter(Boolean).join(', ');
        out.push({ slot, kind: 'item', id: item.id, title: item.title, description: details || item.observation || '', owned: item.status !== 'inactive', photoPaths: photos });
      } else if (ref.kind === 'need') {
        const need = findOr404(db.needs, ref.id, 'Потреба');
        out.push({ slot, kind: 'need', id: need.id, title: need.title, description: need.description, owned: false, photoPaths: [] });
      } else {
        const p = findOr404(db.products, ref.id, 'Товар');
        const photo = p.photoId ? [findOr404(db.photos, p.photoId, 'Фото').path] : [];
        out.push({ slot, kind: 'product', id: p.id, title: `${p.brand} ${p.model}`.trim(), description: [p.composition, p.fit].filter(Boolean).join(', '), owned: false, photoPaths: photo });
      }
    }
  }
  return out;
}

function createJob(db: DB, look: Look, basePhotoIds: string[], instructions: string, retryOf?: string, frozen?: Job['snapshot']): Job {
  const basePaths = basePhotoIds.map((id) => findOr404(db.photos, id, 'Базове фото').path);
  const snapshot = frozen ?? { lookName: look.name, slots: snapshotSlots(db, look.slots), basePhotoIds, basePhotoPaths: basePaths };
  const job: Job = { id: newId('J'), lookId: look.id, lookVersion: frozen ? (db.jobs.find((j) => j.id === retryOf)?.lookVersion ?? look.version) : look.version, snapshot, instructions, state: 'queued', origin: 'site', retryOf, createdAt: now() };
  if (!snapshot.basePhotoIds.length) {
    job.state = 'needs_data';
    job.stateNote = 'Немає базового фото. Додай 2–3 фото спереду в «Мій профіль» або вибери фото в Примірці.';
  } else if (!snapshot.slots.length) {
    job.state = 'needs_data';
    job.stateNote = 'В образі немає жодної речі — додай верх, низ чи взуття.';
  }
  db.jobs.push(job);
  return job;
}

const ITEM_SLOT: Record<Item['category'], SlotKey> = { outerwear: 'layer', knitwear: 'top', shirts: 'top', tees: 'top', trousers: 'bottom', shorts: 'bottom', shoes: 'shoes', accessories: 'accessories' };

function packshotJob(db: DB, target: { itemId?: string; needId?: string }, instructions = '', retryOf?: string, frozen?: Job['snapshot']): Job {
  let snapshot = frozen;
  if (!snapshot && target.itemId) {
    const item = findOr404(db.items, target.itemId, 'Річ');
    const photos = item.photoIds.slice(0, 3).map((pid) => findOr404(db.photos, pid, 'Фото').path);
    const description = [item.color, item.brand, item.model, item.fit, item.observation].filter(Boolean).join('; ');
    snapshot = { lookName: item.title, slots: [{ slot: ITEM_SLOT[item.category], kind: 'item', id: item.id, title: item.title, description, owned: true, photoPaths: photos }], basePhotoIds: [], basePhotoPaths: [] };
  } else if (!snapshot && target.needId) {
    const need = findOr404(db.needs, target.needId, 'Потреба');
    snapshot = { lookName: need.title, slots: [{ slot: ITEM_SLOT[need.category], kind: 'need', id: need.id, title: need.title, description: need.description, owned: false, photoPaths: [] }], basePhotoIds: [], basePhotoPaths: [] };
  }
  if (!snapshot) throw new HttpError(400, 'Не вказано річ для packshot');
  const job: Job = { id: newId('J'), kind: 'packshot', itemId: target.itemId, needId: target.needId, lookVersion: 0, snapshot, instructions, state: 'queued', origin: 'site', retryOf, createdAt: now() };
  db.jobs.push(job);
  return job;
}

function replaceRefs(db: DB, match: (r: SlotRef) => boolean, replacement: SlotRef, note: string) {
  for (const look of db.looks) {
    const next = cleanSlots(look.slots);
    let changed = false;
    for (const k of SLOT_KEYS) {
      next[k] = next[k].map((r) => {
        if (!match(r)) return r;
        changed = true;
        return replacement;
      });
      const seen = new Set<string>();
      next[k] = next[k].filter((r) => (seen.has(`${r.kind}:${r.id}`) ? false : (seen.add(`${r.kind}:${r.id}`), true)));
    }
    if (changed && setLookSlots(look, next, note)) {
      look.rev += 1;
      look.updatedAt = now();
    }
  }
}

function history(item: Item, action: string, note?: string) {
  item.history.push({ at: now(), action, note });
}

export async function upload(ctx: Ctx, query: URLSearchParams, buf: Buffer, filename: string) {
  const kind = (query.get('kind') ?? 'item') as PhotoKind;
  if (!PHOTO_KINDS.includes(kind) || kind === 'source') throw new HttpError(400, 'Невідомий тип фото');
  const id = newId('P');
  const saved = await saveUpload(ctx.projectRoot, ctx.store.dataDir, id, buf);
  const itemId = query.get('item');
  const productId = query.get('product');
  return ctx.store.mutate((db) => {
    const photo: Photo = { id, kind, path: saved.path, originalPath: saved.originalPath, originalName: path.basename(filename || 'upload').slice(0, 200), source: 'upload', meetsStandard: kind === 'base' ? null : undefined, createdAt: now() };
    db.photos.push(photo);
    if (kind === 'base') {
      db.profile.basePhotoIds.push(id);
      db.profile.rev += 1;
    }
    if (itemId) {
      const item = findOr404(db.items, itemId, 'Річ');
      item.photoIds.push(id);
      bump(item, undefined);
      history(item, 'photo_added', `${kind}: ${photo.originalName}`);
    }
    if (productId) {
      const p = findOr404(db.products, productId, 'Товар');
      p.photoId = id;
      bump(p, undefined);
    }
    return photo;
  });
}

type Handler = (ctx: Ctx, params: string[], body: Body) => unknown;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, pattern: string, h: Handler) => routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), h]);

// ── Wardrobe ───────────────────────────────────────────────────────────────
on('POST', '/api/items', (ctx, _p, b) =>
  ctx.store.mutate((db) => {
    const category = str(b.category) as Item['category'];
    if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Вибери категорію');
    const at = now();
    const item: Item = { id: newId('W'), rev: 1, category, title: str(b.title, 200) || 'Нова річ', status: 'confirmed', photoIds: [], origin: 'manual', history: [{ at, action: 'created', note: 'Додано власником' }], createdAt: at, updatedAt: at };
    pick(item, b, ['color', 'brand', 'model', 'composition', 'fit', 'size']);
    db.items.push(item);
    return item;
  }),
);

on('PATCH', '/api/items/:id', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const item = findOr404(db.items, id, 'Річ');
    bump(item, b.rev);
    const before = item.status;
    pick(item, b, ['title', 'color', 'brand', 'model', 'composition', 'fit', 'size']);
    if (b.category && CATEGORIES.includes(b.category as never)) item.category = b.category as Item['category'];
    if (b.status && ITEM_STATUSES.includes(b.status as never)) item.status = b.status as Item['status'];
    if (Array.isArray(b.photoIds)) item.photoIds = (b.photoIds as string[]).filter((pid) => db.photos.some((p) => p.id === pid));
    if (!item.title) throw new HttpError(400, 'Назва не може бути порожньою');
    history(item, before !== item.status ? `status:${item.status}` : 'edited');
    return item;
  }),
);

on('POST', '/api/items/merge', (ctx, _p, b) =>
  ctx.store.mutate((db) => {
    const ids = Array.isArray(b.ids) ? (b.ids as string[]) : [];
    if (ids.length < 2) throw new HttpError(400, 'Для обʼєднання потрібно щонайменше дві речі');
    const sources = ids.map((id) => findOr404(db.items, id, 'Річ'));
    const at = now();
    const merged: Item = {
      id: newId('W'),
      rev: 1,
      category: sources[0].category,
      title: str(b.title, 200) || sources[0].title,
      status: 'needs_confirmation',
      photoIds: [...new Set(sources.flatMap((s) => s.photoIds))],
      observation: sources.map((s) => `${s.id}: ${s.observation ?? ''}`).join(' · '),
      confirmedFact: sources.map((s) => s.confirmedFact).filter(Boolean).join(' ') || undefined,
      origin: 'merge',
      mergedFrom: ids,
      history: [{ at, action: 'merged', note: `Обʼєднано з ${ids.join(', ')}` }],
      createdAt: at,
      updatedAt: at,
    };
    db.items.push(merged);
    for (const s of sources) {
      s.status = 'inactive';
      s.mergedInto = merged.id;
      bump(s, undefined);
      history(s, 'merged_into', merged.id);
    }
    replaceRefs(db, (r) => r.kind === 'item' && ids.includes(r.id), { kind: 'item', id: merged.id }, `Обʼєднання речей → ${merged.id}`);
    return merged;
  }),
);

on('POST', '/api/items/:id/split', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const item = findOr404(db.items, id, 'Річ');
    const photoIds = (Array.isArray(b.photoIds) ? (b.photoIds as string[]) : []).filter((p) => item.photoIds.includes(p));
    if (!photoIds.length || photoIds.length === item.photoIds.length) throw new HttpError(400, 'Вибери частину фото для окремої речі');
    const at = now();
    const part: Item = { id: newId('W'), rev: 1, category: item.category, title: str(b.title, 200) || `${item.title} (окрема)`, status: 'needs_confirmation', photoIds, observation: item.observation, origin: 'split', splitFrom: item.id, history: [{ at, action: 'split', note: `Відокремлено від ${item.id}` }], createdAt: at, updatedAt: at };
    item.photoIds = item.photoIds.filter((p) => !photoIds.includes(p));
    bump(item, b.rev);
    history(item, 'split', `Фото ${photoIds.join(', ')} → ${part.id}`);
    db.items.push(part);
    return part;
  }),
);

// ── Capsules & looks ───────────────────────────────────────────────────────
on('PATCH', '/api/capsules/:id', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const c = findOr404(db.capsules, id, 'Капсула');
    bump(c, b.rev);
    pick(c, b, ['name', 'description']);
    if (!c.name) throw new HttpError(400, 'Назва не може бути порожньою');
    if (typeof b.favorite === 'boolean') c.favorite = b.favorite;
    if (b.season && SEASONS.includes(b.season as never)) c.season = b.season as typeof c.season;
    if (Array.isArray(b.situations)) c.situations = (b.situations as string[]).map((s) => String(s).trim()).filter(Boolean);
    if (Array.isArray(b.lookIds)) c.lookIds = (b.lookIds as string[]).filter((l) => db.looks.some((x) => x.id === l));
    return c;
  }),
);

on('POST', '/api/looks', (ctx, _p, b) =>
  ctx.store.mutate((db) => {
    const capsuleId = str(b.capsuleId) || null;
    if (capsuleId) findOr404(db.capsules, capsuleId, 'Капсула');
    const slots = cleanSlots(b.slots);
    const at = now();
    const look: Look = { id: newId('L'), rev: 1, capsuleId, name: str(b.name, 120) || 'Мій образ', note: str(b.note), slots, version: 1, versions: [{ version: 1, slots, at }], favorite: false, origin: 'owner', createdAt: at, updatedAt: at };
    db.looks.push(look);
    if (capsuleId) {
      const c = db.capsules.find((x) => x.id === capsuleId)!;
      c.lookIds.push(look.id);
      bump(c, undefined);
    }
    return look;
  }),
);

on('PATCH', '/api/looks/:id', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const look = findOr404(db.looks, id, 'Образ');
    bump(look, b.rev);
    pick(look, b, ['name', 'note']);
    if (typeof b.favorite === 'boolean') look.favorite = b.favorite;
    if (b.slots) setLookSlots(look, cleanSlots(b.slots), str(b.versionNote));
    if (!look.name) throw new HttpError(400, 'Назва не може бути порожньою');
    return look;
  }),
);

// ── Try-on queue ───────────────────────────────────────────────────────────
on('POST', '/api/jobs', async (ctx, _p, b) => {
  const job = await ctx.store.mutate((db) => {
    const look = findOr404(db.looks, str(b.lookId) ?? '', 'Образ');
    const base = Array.isArray(b.basePhotoIds) ? (b.basePhotoIds as string[]) : db.profile.basePhotoIds;
    return createJob(db, look, base, str(b.instructions) ?? '');
  });
  if (b.run) ctx.drain();
  return job;
});

on('POST', '/api/jobs/:id/retry', async (ctx, [id], b) => {
  const job = await ctx.store.mutate((db) => {
    const prev = findOr404(db.jobs, id, 'Завдання');
    if (prev.state === 'queued' || prev.state === 'running') throw new HttpError(409, 'Завдання ще виконується');
    if (prev.kind === 'packshot') return packshotJob(db, { itemId: prev.itemId, needId: prev.needId }, [prev.instructions, str(b.instructions)].filter(Boolean).join('\n'), prev.id, prev.snapshot);
    const look = findOr404(db.looks, prev.lookId ?? '', 'Образ');
    const extra = str(b.instructions);
    const instructions = [prev.instructions, extra].filter(Boolean).join('\n');
    return createJob(db, look, prev.snapshot.basePhotoIds, instructions, prev.id, prev.origin === 'import' ? undefined : prev.snapshot);
  });
  if (b.run) ctx.drain();
  return job;
});

on('POST', '/api/packshots', async (ctx, _p, b) => {
  const out = await ctx.store.mutate((db) => {
    const pending = new Set(db.jobs.filter((j) => j.kind === 'packshot' && (j.state === 'queued' || j.state === 'running')).map((j) => j.itemId ?? j.needId));
    const itemIds = b.all ? db.items.filter((i) => i.status !== 'inactive' && !i.packshotId).map((i) => i.id) : Array.isArray(b.itemIds) ? (b.itemIds as string[]) : [];
    const needIds = b.allNeeds ? db.needs.filter((n) => n.status === 'open' && !n.conceptPhotoId).map((n) => n.id) : Array.isArray(b.needIds) ? (b.needIds as string[]) : [];
    const jobs: Job[] = [];
    for (const id of itemIds) if (!pending.has(id)) jobs.push(packshotJob(db, { itemId: id }, str(b.instructions)));
    for (const id of needIds) if (!pending.has(id)) jobs.push(packshotJob(db, { needId: id }, str(b.instructions)));
    return { created: jobs.length, jobIds: jobs.map((j) => j.id) };
  });
  if (b.run) ctx.drain();
  return out;
});

on('POST', '/api/runner/run', (ctx) => {
  ctx.drain();
  return { started: true };
});

const REASON_TEXT: Record<ReworkReason, string> = { face: 'обличчя не схоже', proportions: 'змінені пропорції тіла', garment: 'річ відтворена неточно', background: 'фон або кадр не за стандартом', other: 'інше' };

on('POST', '/api/results/:id/review', async (ctx, [id], b) => {
  const out = await ctx.store.mutate((db) => {
    const r = findOr404(db.results, id, 'Результат');
    const decision = str(b.decision);
    if (decision === 'accepted') {
      r.review = 'accepted';
      r.reviewReason = undefined;
    } else if (decision === 'rework') {
      const reason = str(b.reason) as ReworkReason;
      if (!REWORK_REASONS.includes(reason)) throw new HttpError(400, 'Вкажи причину переробки');
      r.review = 'rework';
      r.reviewReason = reason;
    } else if (decision === 'pending') {
      r.review = 'pending';
    } else throw new HttpError(400, 'Невідоме рішення');
    r.reviewNote = str(b.note);
    r.reviewedAt = now();
    let retry: Job | undefined;
    if (r.review === 'rework') {
      const prev = findOr404(db.jobs, r.jobId, 'Завдання');
      const look = findOr404(db.looks, prev.lookId ?? '', 'Образ');
      const fix = `Переробити: ${REASON_TEXT[r.reviewReason!]}${r.reviewNote ? ` — ${r.reviewNote}` : ''}.`;
      const base = prev.origin === 'import' || !prev.snapshot.basePhotoIds.length ? db.profile.basePhotoIds : prev.snapshot.basePhotoIds;
      retry = createJob(db, look, base, [prev.origin === 'import' ? '' : prev.instructions, fix].filter(Boolean).join('\n'), prev.id, prev.origin === 'import' || !prev.snapshot.slots.length ? undefined : prev.snapshot);
    }
    return { result: r, retry };
  });
  if (out.retry && b.run) ctx.drain();
  return out;
});

on('PATCH', '/api/results/:id', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const r = findOr404(db.results, id, 'Результат');
    if (typeof b.favorite === 'boolean') r.favorite = b.favorite;
    if ('note' in b) r.note = str(b.note);
    return r;
  }),
);

on('POST', '/api/comparisons', (ctx, _p, b) =>
  ctx.store.mutate((db) => {
    const a = findOr404(db.results, str(b.resultA) ?? '', 'Результат A');
    const c = findOr404(db.results, str(b.resultB) ?? '', 'Результат B');
    if (a.id === c.id) throw new HttpError(400, 'Вибери два різні результати');
    const cmp = { id: newId('X'), resultA: a.id, resultB: c.id, note: str(b.note), favorite: Boolean(b.favorite), createdAt: now() };
    db.comparisons.push(cmp);
    return cmp;
  }),
);

on('PATCH', '/api/comparisons/:id', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const c = findOr404(db.comparisons, id, 'Порівняння');
    if ('note' in b) c.note = str(b.note);
    if (typeof b.favorite === 'boolean') c.favorite = b.favorite;
    return c;
  }),
);

// ── Shopping ───────────────────────────────────────────────────────────────
on('POST', '/api/needs', (ctx, _p, b) =>
  ctx.store.mutate((db) => {
    const category = str(b.category) as Item['category'];
    if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Вибери категорію');
    const at = now();
    const need = { id: newId('N'), rev: 1, title: str(b.title, 200) || 'Нова потреба', category, priority: b.priority === 'core' ? ('core' as const) : ('optional' as const), description: str(b.description) ?? '', why: str(b.why) ?? '', fitCheck: str(b.fitCheck) ?? '', status: 'open' as const, origin: 'owner' as const, createdAt: at, updatedAt: at };
    db.needs.push(need);
    return need;
  }),
);

on('PATCH', '/api/needs/:id', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const need = findOr404(db.needs, id, 'Потреба');
    bump(need, b.rev);
    pick(need, b, ['title', 'description', 'why', 'fitCheck']);
    if (b.priority === 'core' || b.priority === 'optional') need.priority = b.priority;
    if (b.status === 'open' || b.status === 'covered') need.status = b.status;
    return need;
  }),
);

const PRODUCT_FIELDS = ['store', 'brand', 'model', 'sku', 'url', 'composition', 'fit', 'currency', 'recommendedSize', 'sizeBasis', 'checkedAt', 'sources'] as const;

function productNumbers(target: Record<string, unknown>, b: Body) {
  if ('price' in b) target.price = b.price === '' || b.price === null ? null : Number(b.price);
  if (typeof target.price === 'number' && !Number.isFinite(target.price)) throw new HttpError(400, 'Ціна має бути числом');
  for (const k of ['onlineAvailability', 'towerAvailability'] as const) if (typeof b[k] === 'string') target[k] = b[k];
  if (target.url && !/^https?:\/\//.test(String(target.url))) throw new HttpError(400, 'URL має починатися з http(s)://');
}

on('POST', '/api/products', (ctx, _p, b) =>
  ctx.store.mutate((db) => {
    const need = findOr404(db.needs, str(b.needId) ?? '', 'Потреба');
    const at = now();
    const p = { id: newId('S'), rev: 1, needId: need.id, store: '', brand: '', model: '', onlineAvailability: 'unknown' as const, towerAvailability: 'unknown' as const, status: 'option' as const, createdAt: at, updatedAt: at };
    pick(p, b, [...PRODUCT_FIELDS] as never);
    productNumbers(p as unknown as Record<string, unknown>, b);
    if (!p.store || !p.model) throw new HttpError(400, 'Потрібні магазин і модель');
    db.products.push(p);
    return p;
  }),
);

on('PATCH', '/api/products/:id', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const p = findOr404(db.products, id, 'Товар');
    bump(p, b.rev);
    pick(p, b, [...PRODUCT_FIELDS] as never);
    productNumbers(p as unknown as Record<string, unknown>, b);
    if (b.status === 'option' || b.status === 'chosen') p.status = b.status;
    return p;
  }),
);

on('POST', '/api/products/:id/purchase', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const p = findOr404(db.products, id, 'Товар');
    if (p.status === 'purchased') throw new HttpError(409, 'Товар уже позначено купленим');
    const need = findOr404(db.needs, p.needId, 'Потреба');
    const at = now();
    const ownPhoto = str(b.photoId);
    const photos = [p.photoId, ownPhoto].filter((x): x is string => Boolean(x) && db.photos.some((ph) => ph.id === x));
    const item: Item = {
      id: newId('W'),
      rev: 1,
      category: need.category,
      title: `${p.brand} ${p.model}`.trim() || need.title,
      brand: p.brand || undefined,
      model: p.model || undefined,
      composition: p.composition,
      fit: p.fit,
      size: str(b.size, 40),
      status: 'confirmed',
      photoIds: photos,
      origin: 'purchase',
      purchasedFromProduct: p.id,
      confirmedFact: 'Куплено власником; фізична посадка не перевірена сайтом.',
      history: [{ at, action: 'purchased', note: `${p.store}${p.sku ? ` · ${p.sku}` : ''}` }],
      createdAt: at,
      updatedAt: at,
    };
    db.items.push(item);
    p.status = 'purchased';
    p.purchasedItemId = item.id;
    bump(p, undefined);
    need.status = 'covered';
    need.coveredByItem = item.id;
    bump(need, undefined);
    replaceRefs(db, (r) => (r.kind === 'need' && r.id === need.id) || (r.kind === 'product' && r.id === p.id), { kind: 'item', id: item.id }, `Куплено: ${item.title}`);
    return item;
  }),
);

// ── Profile & settings ─────────────────────────────────────────────────────
on('PATCH', '/api/profile', (ctx, _p, b) =>
  ctx.store.mutate((db) => {
    const prof = db.profile;
    bump(prof, b.rev);
    if (b.measurements && typeof b.measurements === 'object') {
      for (const k of MEASURE_KEYS) {
        const m = (b.measurements as Record<string, { value: unknown; date?: string }>)[k];
        if (!m) continue;
        const v = m.value === '' || m.value === null || m.value === undefined ? null : Number(m.value);
        if (v !== null && (!Number.isFinite(v) || v <= 0 || v > 300)) throw new HttpError(400, `Неправильне значення мірки: ${k}`);
        prof.measurements[k] = { value: v, date: v === null ? undefined : (str(m.date, 10) ?? now().slice(0, 10)) };
      }
    }
    if (Array.isArray(b.knownSizes)) {
      prof.knownSizes = (b.knownSizes as Record<string, unknown>[])
        .filter((s) => str(s.brand) && str(s.size) && CATEGORIES.includes(s.category as never))
        .map((s) => ({ id: str(s.id) || newId('K'), brand: str(s.brand, 80)!, category: s.category as Item['category'], size: str(s.size, 40)!, note: str(s.note) }));
    }
    if (b.preferences && typeof b.preferences === 'object') {
      const pr = b.preferences as Record<string, unknown>;
      for (const k of ['comfort', 'materials', 'fit', 'branding'] as const) if (typeof pr[k] === 'string') prof.preferences[k] = str(pr[k])!;
    }
    if (Array.isArray(b.basePhotoIds)) prof.basePhotoIds = (b.basePhotoIds as string[]).filter((id) => db.photos.some((p) => p.id === id));
    return prof;
  }),
);

on('PATCH', '/api/photos/:id', (ctx, [id], b) =>
  ctx.store.mutate((db) => {
    const p = findOr404(db.photos, id, 'Фото');
    if ('meetsStandard' in b) p.meetsStandard = b.meetsStandard === null ? null : Boolean(b.meetsStandard);
    if ('note' in b) p.note = str(b.note);
    return p;
  }),
);

on('PATCH', '/api/settings', (ctx, _p, b) =>
  ctx.store.mutate((db) => {
    const s = db.settings;
    if (str(b.codexModel)) s.codexModel = str(b.codexModel, 80)!;
    if (['low', 'medium', 'high', 'xhigh'].includes(b.reasoningEffort as string)) s.reasoningEffort = b.reasoningEffort as typeof s.reasoningEffort;
    if ('tailscaleLogin' in b) s.tailscaleLogin = str(b.tailscaleLogin, 200) ?? '';
    return s;
  }),
);

export async function dispatch(ctx: Ctx, method: string, pathname: string, body: Body) {
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = pathname.match(re);
    if (match) return h(ctx, match.slice(1).map(decodeURIComponent), body);
  }
  throw new HttpError(404, 'Маршрут не знайдено');
}

export { SLOT_TEXT };
