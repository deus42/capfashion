// Shared data contract for the site, the Codex runner and agent imports.
// Every write goes through validateDb before it reaches disk.

export const SCHEMA_VERSION = 1;

export const CATEGORIES = ['outerwear', 'knitwear', 'shirts', 'tees', 'trousers', 'shorts', 'shoes', 'accessories'] as const;
export type Category = (typeof CATEGORIES)[number];

export const ITEM_STATUSES = ['needs_confirmation', 'confirmed', 'inactive'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const PHOTO_KINDS = ['source', 'base', 'item', 'label', 'detail', 'product', 'packshot'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export const SLOT_KEYS = ['top', 'layer', 'bottom', 'shoes', 'accessories'] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export const SEASONS = ['all', 'warm', 'transitional', 'cold'] as const;
export type Season = (typeof SEASONS)[number];

export const JOB_STATES = ['queued', 'running', 'done', 'needs_data', 'error'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const REVIEW_STATES = ['pending', 'accepted', 'rework'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REWORK_REASONS = ['face', 'proportions', 'garment', 'background', 'other'] as const;
export type ReworkReason = (typeof REWORK_REASONS)[number];

export const MEASURE_KEYS = ['height', 'chest', 'waist', 'hips', 'shoulders', 'sleeve', 'inseam', 'foot'] as const;
export type MeasureKey = (typeof MEASURE_KEYS)[number];

export interface HistoryEntry {
  at: string;
  action: string;
  note?: string;
}

export interface Photo {
  id: string;
  kind: PhotoKind;
  /** Display copy, relative to the project root. */
  path: string;
  /** Untouched original when the display copy was converted (HEIC → JPEG). */
  originalPath?: string;
  originalName: string;
  source: 'chat-2026-11-14' | 'upload' | 'generated';
  observation?: string;
  /** Owner's check against the base-photo standard; null = not checked. */
  meetsStandard?: boolean | null;
  note?: string;
  createdAt: string;
}

export interface Item {
  id: string;
  rev: number;
  category: Category;
  title: string;
  color?: string;
  brand?: string;
  model?: string;
  composition?: string;
  fit?: string;
  size?: string;
  status: ItemStatus;
  photoIds: string[];
  observation?: string;
  confirmedFact?: string;
  origin: 'candidate' | 'purchase' | 'manual' | 'split' | 'merge' | 'intake';
  mergedFrom?: string[];
  mergedInto?: string;
  splitFrom?: string;
  purchasedFromProduct?: string;
  /** Generated catalogue image (reconstruction, not evidence). */
  packshotId?: string;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface Need {
  id: string;
  rev: number;
  title: string;
  category: Category;
  priority: 'core' | 'optional';
  description: string;
  why: string;
  fitCheck: string;
  status: 'open' | 'covered';
  origin: 'source' | 'agent' | 'owner';
  sourceNote?: string;
  coveredByItem?: string;
  /** Generated concept image of the desired type. */
  conceptPhotoId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  rev: number;
  needId: string;
  store: string;
  brand: string;
  model: string;
  sku?: string;
  url?: string;
  photoId?: string;
  composition?: string;
  fit?: string;
  price?: number | null;
  currency?: string;
  recommendedSize?: string;
  sizeBasis?: string;
  onlineAvailability: 'unknown' | 'in_stock' | 'out_of_stock';
  towerAvailability: 'unknown' | 'confirmed' | 'not_found';
  checkedAt?: string;
  sources?: string;
  status: 'option' | 'chosen' | 'purchased';
  purchasedItemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlotRef {
  kind: 'item' | 'need' | 'product';
  id: string;
}

export type Slots = Record<SlotKey, SlotRef[]>;

export interface LookVersion {
  version: number;
  slots: Slots;
  at: string;
  note?: string;
}

export interface Look {
  id: string;
  rev: number;
  capsuleId: string | null;
  name: string;
  note?: string;
  slots: Slots;
  version: number;
  versions: LookVersion[];
  favorite: boolean;
  origin: 'source' | 'agent' | 'owner';
  sourceNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Capsule {
  id: string;
  rev: number;
  /** 'selection' = outfits picked by the analyzer from owned items only. */
  kind?: 'capsule' | 'selection';
  name: string;
  season: Season;
  description: string;
  situations: string[];
  favorite: boolean;
  lookIds: string[];
  origin: 'source' | 'agent' | 'owner';
  sourceNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotSlot {
  slot: SlotKey;
  kind: SlotRef['kind'];
  id: string;
  title: string;
  description: string;
  owned: boolean;
  photoPaths: string[];
}

export interface Job {
  id: string;
  /** Missing kind means a try-on (records created before packshots). */
  kind?: 'tryon' | 'packshot' | 'intake' | 'analyze';
  lookId?: string;
  /** intake: uploaded photos to recognise. */
  inputPhotoIds?: string[];
  /** intake: wardrobe candidates created from the photo. */
  createdItemIds?: string[];
  /** analyze: the selection created. */
  capsuleId?: string;
  itemId?: string;
  needId?: string;
  photoId?: string;
  lookVersion: number;
  snapshot: {
    lookName: string;
    slots: SnapshotSlot[];
    basePhotoIds: string[];
    basePhotoPaths: string[];
  };
  instructions: string;
  state: JobState;
  stateNote?: string;
  retryOf?: string;
  resultId?: string;
  origin: 'site' | 'import';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  logPath?: string;
}

export interface Result {
  id: string;
  jobId: string;
  lookId: string;
  lookVersion: number;
  imagePath: string;
  tool: string;
  model: string;
  prompt: string;
  sources: string[];
  usedItemPhotos: boolean;
  notes?: string;
  review: ReviewState;
  reviewReason?: ReworkReason;
  reviewNote?: string;
  reviewedAt?: string;
  favorite: boolean;
  note?: string;
  createdAt: string;
}

export interface Comparison {
  id: string;
  resultA: string;
  resultB: string;
  note?: string;
  favorite: boolean;
  createdAt: string;
}

export interface Measurement {
  value: number | null;
  date?: string;
}

export interface KnownSize {
  id: string;
  brand: string;
  category: Category;
  size: string;
  note?: string;
}

export interface Profile {
  rev: number;
  basePhotoIds: string[];
  measurements: Record<MeasureKey, Measurement>;
  knownSizes: KnownSize[];
  preferences: { comfort: string; materials: string; fit: string; branding: string };
}

export interface Settings {
  codexModel: string;
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
  tailscaleLogin: string;
  concurrency?: number;
}

export interface DB {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  photos: Photo[];
  items: Item[];
  needs: Need[];
  products: Product[];
  looks: Look[];
  capsules: Capsule[];
  jobs: Job[];
  results: Result[];
  comparisons: Comparison[];
  profile: Profile;
  settings: Settings;
}

export function emptySlots(): Slots {
  return { top: [], layer: [], bottom: [], shoes: [], accessories: [] };
}

const COLLECTIONS = ['photos', 'items', 'needs', 'products', 'looks', 'capsules', 'jobs', 'results', 'comparisons'] as const;

function isRelativeSafe(p: unknown): boolean {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.split(/[\\/]/).includes('..');
}

/** Returns a human-readable error, or null when the database is valid. */
export function validateDb(db: unknown): string | null {
  if (!db || typeof db !== 'object') return 'База не є обʼєктом';
  const d = db as DB;
  if (d.schemaVersion !== SCHEMA_VERSION) return `Непідтримувана версія схеми: ${String(d.schemaVersion)}`;
  if (typeof d.revision !== 'number') return 'Немає ревізії';
  const ids = new Map<string, Set<string>>();
  for (const c of COLLECTIONS) {
    const list = d[c];
    if (!Array.isArray(list)) return `Колекція ${c} відсутня`;
    const set = new Set<string>();
    for (const e of list as { id: string }[]) {
      if (!e || typeof e.id !== 'string' || !e.id) return `${c}: запис без id`;
      if (set.has(e.id)) return `${c}: повторний id ${e.id}`;
      set.add(e.id);
    }
    ids.set(c, set);
  }
  const has = (c: (typeof COLLECTIONS)[number], id: string) => ids.get(c)!.has(id);
  for (const p of d.photos) {
    if (!PHOTO_KINDS.includes(p.kind)) return `Фото ${p.id}: невідомий тип`;
    if (!isRelativeSafe(p.path)) return `Фото ${p.id}: недозволений шлях`;
    if (p.originalPath && !isRelativeSafe(p.originalPath)) return `Фото ${p.id}: недозволений шлях оригіналу`;
  }
  for (const i of d.items) {
    if (!CATEGORIES.includes(i.category)) return `Річ ${i.id}: невідома категорія`;
    if (!ITEM_STATUSES.includes(i.status)) return `Річ ${i.id}: невідомий статус`;
    if (!i.title?.trim()) return `Річ ${i.id}: порожня назва`;
    for (const pid of i.photoIds) if (!has('photos', pid)) return `Річ ${i.id}: немає фото ${pid}`;
    if (i.packshotId && !has('photos', i.packshotId)) return `Річ ${i.id}: немає packshot`;
  }
  for (const n of d.needs) {
    if (!CATEGORIES.includes(n.category)) return `Потреба ${n.id}: невідома категорія`;
    if (n.conceptPhotoId && !has('photos', n.conceptPhotoId)) return `Потреба ${n.id}: немає концепт-фото`;
  }
  for (const p of d.products) {
    if (!has('needs', p.needId)) return `Товар ${p.id}: немає потреби ${p.needId}`;
    if (p.photoId && !has('photos', p.photoId)) return `Товар ${p.id}: немає фото`;
    if (p.purchasedItemId && !has('items', p.purchasedItemId)) return `Товар ${p.id}: немає речі покупки`;
  }
  const refOk = (r: SlotRef) =>
    (r.kind === 'item' && has('items', r.id)) || (r.kind === 'need' && has('needs', r.id)) || (r.kind === 'product' && has('products', r.id));
  for (const l of d.looks) {
    if (l.capsuleId && !has('capsules', l.capsuleId)) return `Образ ${l.id}: немає капсули`;
    for (const k of SLOT_KEYS) {
      if (!Array.isArray(l.slots?.[k])) return `Образ ${l.id}: немає слота ${k}`;
      for (const r of l.slots[k]) if (!refOk(r)) return `Образ ${l.id}: битий звʼязок ${r.kind}:${r.id}`;
    }
    if (!l.versions.some((v) => v.version === l.version)) return `Образ ${l.id}: немає поточної версії`;
  }
  for (const c of d.capsules) {
    if (!SEASONS.includes(c.season)) return `Капсула ${c.id}: невідомий сезон`;
    for (const lid of c.lookIds) if (!has('looks', lid)) return `Капсула ${c.id}: немає образу ${lid}`;
  }
  for (const j of d.jobs) {
    if (!JOB_STATES.includes(j.state)) return `Завдання ${j.id}: невідомий стан`;
    if ((j.kind ?? 'tryon') === 'tryon' && !(j.lookId && has('looks', j.lookId))) return `Завдання ${j.id}: немає образу`;
    if (j.kind === 'packshot' && !((j.itemId && has('items', j.itemId)) || (j.needId && has('needs', j.needId)))) return `Завдання ${j.id}: немає речі`;
    if (j.photoId && !has('photos', j.photoId)) return `Завдання ${j.id}: немає фото результату`;
    if (j.kind === 'intake' && !(j.inputPhotoIds?.length && j.inputPhotoIds.every((p) => has('photos', p)))) return `Завдання ${j.id}: немає фото для розпізнавання`;
    for (const id of j.createdItemIds ?? []) if (!has('items', id)) return `Завдання ${j.id}: немає створеної речі ${id}`;
    if (j.capsuleId && !has('capsules', j.capsuleId)) return `Завдання ${j.id}: немає підбірки`;
    if (j.retryOf && !has('jobs', j.retryOf)) return `Завдання ${j.id}: немає попередньої спроби`;
    if (j.resultId && !has('results', j.resultId)) return `Завдання ${j.id}: немає результату`;
  }
  for (const r of d.results) {
    if (!has('jobs', r.jobId)) return `Результат ${r.id}: немає завдання`;
    if (!REVIEW_STATES.includes(r.review)) return `Результат ${r.id}: невідомий стан перевірки`;
    if (!isRelativeSafe(r.imagePath)) return `Результат ${r.id}: недозволений шлях`;
  }
  for (const c of d.comparisons) {
    if (!has('results', c.resultA) || !has('results', c.resultB)) return `Порівняння ${c.id}: немає результату`;
  }
  if (!d.profile || !Array.isArray(d.profile.basePhotoIds)) return 'Профіль пошкоджений';
  for (const pid of d.profile.basePhotoIds) if (!has('photos', pid)) return `Профіль: немає базового фото ${pid}`;
  for (const k of MEASURE_KEYS) if (!d.profile.measurements?.[k]) return `Профіль: немає мірки ${k}`;
  if (!d.settings?.codexModel) return 'Налаштування: немає моделі Codex';
  return null;
}
