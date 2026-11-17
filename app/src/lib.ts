import type { Category, DB, Job, Look, MeasureKey, Result, Season, SlotKey, SlotRef } from './api.ts';

export const CATEGORY_LABEL: Record<Category, string> = {
  outerwear: 'Верхній одяг',
  knitwear: 'Худі й трикотаж',
  shirts: 'Сорочки й поло',
  tees: 'Футболки',
  trousers: 'Штани',
  shorts: 'Шорти',
  shoes: 'Взуття',
  accessories: 'Аксесуари',
};

export const SEASON_LABEL: Record<Season, string> = { all: 'Усі сезони', warm: 'Тепло', transitional: 'Міжсезоння', cold: 'Холод' };

export const SLOT_LABEL: Record<SlotKey, string> = { top: 'Верх', layer: 'Шар', bottom: 'Низ', shoes: 'Взуття', accessories: 'Аксесуари' };

/** Which wardrobe categories fit each outfit slot. */
export const SLOT_CATEGORIES: Record<SlotKey, Category[]> = {
  top: ['tees', 'shirts', 'knitwear'],
  layer: ['outerwear', 'knitwear', 'shirts'],
  bottom: ['trousers', 'shorts'],
  shoes: ['shoes'],
  accessories: ['accessories'],
};

export const JOB_LABEL: Record<Job['state'], string> = { queued: 'У черзі', running: 'В роботі', done: 'Готово', needs_data: 'Потрібні дані', error: 'Помилка' };
export const JOB_TONE: Record<Job['state'], string> = { queued: '', running: 'info', done: 'ok', needs_data: 'warn', error: 'bad' };
export const REVIEW_LABEL: Record<Result['review'], string> = { pending: 'На перевірці', accepted: 'Прийнято', rework: 'Переробити' };
export const REVIEW_TONE: Record<Result['review'], string> = { pending: 'warn', accepted: 'ok', rework: 'bad' };
export const REASON_LABEL = { face: 'Обличчя', proportions: 'Пропорції', garment: 'Річ', background: 'Фон / кадр', other: 'Інше' } as const;

export const MEASURES: { key: MeasureKey; label: string; how: string }[] = [
  { key: 'height', label: 'Зріст', how: 'Без взуття, спиною до стіни, від підлоги до верхівки.' },
  { key: 'chest', label: 'Груди', how: 'По найширшій частині грудей під пахвами, стрічка горизонтально.' },
  { key: 'waist', label: 'Талія', how: 'Там, де носиш пояс штанів, без втягування живота.' },
  { key: 'hips', label: 'Стегна', how: 'По найширшій частині сідниць, ноги разом.' },
  { key: 'shoulders', label: 'Плечі', how: 'Ззаду від кісточки одного плеча до іншого.' },
  { key: 'sleeve', label: 'Довжина рукава', how: 'Від шва плеча до кісточки зап’ястя, рука трохи зігнута.' },
  { key: 'inseam', label: 'Внутрішній шов', how: 'Від паху до підлоги по внутрішній стороні ноги, без взуття.' },
  { key: 'foot', label: 'Довжина стопи', how: 'Стоячи, від п’ятки до найдовшого пальця.' },
];

export type RefKind = 'owned' | 'candidate' | 'need' | 'product';
export const REF_KIND_LABEL: Record<RefKind, string> = { owned: 'Твоя річ', candidate: 'Кандидат', need: 'Бажаний тип', product: 'Товар магазину' };

export interface ResolvedRef {
  ref: SlotRef;
  title: string;
  kind: RefKind;
  category?: Category;
  /** Clean catalogue image: packshot, concept or product photo. */
  art?: string;
  photo?: string;
  missing?: boolean;
  inactive?: boolean;
}

export function resolveRef(db: DB, ref: SlotRef): ResolvedRef {
  if (ref.kind === 'item') {
    const it = db.items.find((i) => i.id === ref.id);
    if (!it) return { ref, title: ref.id, kind: 'candidate', missing: true };
    const photo = it.photoIds.map((id) => db.photos.find((p) => p.id === id)?.path).find(Boolean);
    const art = it.packshotId ? db.photos.find((p) => p.id === it.packshotId)?.path : undefined;
    return { ref, title: it.title, kind: it.status === 'confirmed' ? 'owned' : 'candidate', category: it.category, art, photo, inactive: it.status === 'inactive' };
  }
  if (ref.kind === 'need') {
    const n = db.needs.find((x) => x.id === ref.id);
    const art = n?.conceptPhotoId ? db.photos.find((p) => p.id === n.conceptPhotoId)?.path : undefined;
    return { ref, title: n?.title ?? ref.id, kind: 'need', category: n?.category, art, missing: !n };
  }
  const p = db.products.find((x) => x.id === ref.id);
  const photo = p?.photoId ? db.photos.find((ph) => ph.id === p.photoId)?.path : undefined;
  const cat = p ? db.needs.find((n) => n.id === p.needId)?.category : undefined;
  return { ref, title: p ? `${p.brand} ${p.model}`.trim() : ref.id, kind: 'product', category: cat, art: photo, photo, missing: !p };
}

export function resultsForLook(db: DB, lookId: string) {
  return db.results.filter((r) => r.lookId === lookId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Best image to show for a look: accepted first, else newest. */
export function coverForLook(db: DB, look: Look): Result | undefined {
  const rs = resultsForLook(db, look.id);
  return rs.find((r) => r.review === 'accepted') ?? rs.find((r) => r.review !== 'rework') ?? rs[0];
}

export function capsuleCover(db: DB, lookIds: string[]) {
  const looks = lookIds.map((id) => db.looks.find((l) => l.id === id)).filter((l): l is Look => Boolean(l));
  const all = looks.flatMap((l) => resultsForLook(db, l.id));
  return all.find((r) => r.review === 'accepted') ?? all.find((r) => r.review === 'pending') ?? undefined;
}

export function looksUsing(db: DB, kind: SlotRef['kind'], id: string) {
  return db.looks.filter((l) => Object.values(l.slots).some((refs) => refs.some((r) => r.kind === kind && r.id === id)));
}

export function piecesOf(db: DB, slots: Look['slots']): ResolvedRef[] {
  return (['layer', 'top', 'bottom', 'shoes', 'accessories'] as SlotKey[]).flatMap((k) => slots[k].map((r) => resolveRef(db, r)));
}

export function itemArt(db: DB, itemId: string) {
  const it = db.items.find((i) => i.id === itemId);
  if (!it) return {};
  const art = it.packshotId ? db.photos.find((p) => p.id === it.packshotId)?.path : undefined;
  const photo = it.photoIds.map((id) => db.photos.find((p) => p.id === id)?.path).find(Boolean);
  return { art, photo };
}

export function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}
