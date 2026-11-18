import type { Capsule, Category, DB, Item, Job, Look, MeasureKey, Need, Result, Season, SlotKey, SlotRef } from './api.ts';
import { hiddenLookIds } from './rating.ts';
import { groupLookVariations } from './look-variation.ts';

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

/**
 * The look's picture: an accepted try-on, else one awaiting the owner's check.
 * A rejected try-on (not the owner's face) is never shown; the look shows its
 * pieces instead (owner, 17.11). Rejected attempts stay in the archive.
 */
export function coverForLook(db: DB, look: Look): Result | undefined {
  const rs = resultsForLook(db, look.id);
  // A try-on awaiting the owner's check shows only when it was made with the current, active face reference.
  const face = db.profile.identity && !db.profile.identity.disabledReason ? db.profile.identity.face?.sha256 : undefined;
  const current = (r: Result) => Boolean(face) && db.jobs.find((j) => j.id === r.jobId)?.snapshot.identity?.face?.sha256 === face;
  return rs.find((r) => r.review === 'accepted') ?? rs.find((r) => r.review === 'pending' && current(r));
}

/** A try-on of this look is being made right now (a queued one is not shown as work in progress). */
export const lookBusy = (db: DB, lookId: string) => db.jobs.some((j) => (j.kind ?? 'tryon') === 'tryon' && j.lookId === lookId && j.state === 'running');

/** The look's picture job: running, or also waiting when the owner just asked for it. */
export const lookJob = (db: DB, lookId: string, includeQueued = false) =>
  db.jobs.filter((j) => (j.kind ?? 'tryon') === 'tryon' && j.lookId === lookId && (j.state === 'running' || (includeQueued && j.state === 'queued'))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

const FALLBACK_SECONDS: Record<string, number> = { tryon: 140, packshot: 80, intake: 25, analyze: 60, shopsearch: 320, advise: 240 };

/** How long a job of this kind usually takes here: the median of the last 20 finished ones (owner, 18.11). */
export function expectedSeconds(db: DB, kind: Job['kind']) {
  const k = kind ?? 'tryon';
  const recent = db.jobs
    .filter((j) => (j.kind ?? 'tryon') === k && j.state === 'done' && j.startedAt && j.finishedAt)
    .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!))
    .slice(0, 20)
    .map((j) => (new Date(j.finishedAt!).getTime() - new Date(j.startedAt!).getTime()) / 1000)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  return recent.length >= 3 ? recent[Math.floor(recent.length / 2)] : FALLBACK_SECONDS[k] ?? 120;
}

/** Real progress of one job: share of its usual time (never 100% before it ends) and what is left. */
export function jobProgress(db: DB, job: Job, now = Date.now()) {
  if (job.state !== 'running' || !job.startedAt) return { pct: 0, label: 'у черзі' };
  const total = expectedSeconds(db, job.kind);
  const elapsed = Math.max(0, (now - new Date(job.startedAt).getTime()) / 1000);
  const left = total - elapsed;
  const label = left <= 5 ? 'майже готово' : left < 60 ? 'ще < 1 хв' : `ще ≈ ${Math.ceil(left / 60)} хв`;
  return { pct: Math.min(0.96, elapsed / total), label };
}

/** Looks (visible on the site) that use this piece. */
export function looksUsing(db: DB, kind: SlotRef['kind'], id: string) {
  const hidden = hiddenLookIds(db);
  return db.looks.filter((l) => !hidden.has(l.id) && Object.values(l.slots).some((refs) => refs.some((r) => r.kind === kind && r.id === id)));
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

// Stable: the representative of near-copies does not change as pictures arrive.
const lookScore = (db: DB, l: Look) => (l.favorite ? 8 : 0) + (isComplete(db, l) ? 4 : 0);

/**
 * One card per look: hidden looks are dropped and near-copies (owner's rule:
 * identical or one piece different) fold into the best representative —
 * liked, then with an accepted try-on, then with any try-on. Copies stay in
 * the data. Liked looks come first; otherwise the given order is kept.
 */
export function distinctLooks(db: DB, looks: Look[]): Look[] {
  const hidden = hiddenLookIds(db);
  const visible = looks.filter((l) => !hidden.has(l.id));
  const best = visible.map((l, i) => ({ l, i, s: lookScore(db, l) })).sort((a, b) => b.s - a.s || a.i - b.i).map((e) => e.l);
  const reps = new Set(groupLookVariations(best).map((g) => g.primary.id));
  return rankLooks(db, visible.filter((l) => reps.has(l.id)));
}

/** Recommendations a look still waits for (a shop option counts as its recommendation). */
export function missingNeeds(db: DB, look: Pick<Look, 'slots'>): string[] {
  const ids = Object.values(look.slots).flat().flatMap((r) => (r.kind === 'need' ? [r.id] : r.kind === 'product' ? [db.products.find((p) => p.id === r.id)?.needId ?? r.id] : []));
  return [...new Set(ids)];
}

/** Pieces the owner cannot wear now: recommendations still to buy and items that are inactive, merged away or gone. */
function missingTitles(db: DB, look: Pick<Look, 'slots'>): string[] {
  const gone = Object.values(look.slots).flat().flatMap((r) => {
    if (r.kind !== 'item') return [];
    const it = db.items.find((i) => i.id === r.id);
    return !it || it.status === 'inactive' || it.mergedInto ? [it?.title ?? r.id] : [];
  });
  return [...missingNeeds(db, look).map((id) => db.needs.find((n) => n.id === id)?.title ?? id), ...gone];
}

const hasPieces = (look: Pick<Look, 'slots'>) => Object.values(look.slots).some((refs) => refs.length);

/** Everything in the look is in the wardrobe and in use: it can be worn today. */
export const isComplete = (db: DB, look: Look) => hasPieces(look) && missingTitles(db, look).length === 0;

/** Quiet line under an incomplete look's name (owner, 17.11): what is missing first, then how many more. */
export function missingInfo(db: DB, look: Look): { text: string; more: number } | null {
  if (!hasPieces(look)) return { text: 'порожній образ', more: 0 };
  const m = missingTitles(db, look);
  if (!m.length) return null;
  return { text: `бракує: ${m[0].charAt(0).toLowerCase()}${m[0].slice(1)}`, more: m.length - 1 };
}

/** Liked first, then looks the owner can wear now, then the rest; otherwise the given order (owner, 17.11). */
export const rankLooks = (db: DB, looks: Look[]) =>
  looks.map((l, i) => ({ l, i, full: isComplete(db, l) })).sort((a, b) => Number(b.l.favorite) - Number(a.l.favorite) || Number(b.full) - Number(a.full) || a.i - b.i).map((e) => e.l);

/** How many of a capsule's looks are ready to wear. */
export function capsuleReady(db: DB, c: Capsule) {
  // An empty look just added with «+ Образ» does not count yet.
  const looks = distinctLooks(db, capsuleLooks(db, c.lookIds)).filter(hasPieces);
  return { done: looks.filter((l) => isComplete(db, l)).length, total: looks.length };
}

/** Advisor counts for an item: shown looks with it, how many are complete or liked, capsules it is in. */
export function itemUsage(db: DB, itemId: string) {
  const looks = siteLooks(db).filter((l) => Object.values(l.slots).flat().some((r) => r.kind === 'item' && r.id === itemId));
  const capsules = new Set(looks.map((l) => l.capsuleId).filter(Boolean));
  return { looks: looks.length, complete: looks.filter((l) => isComplete(db, l)).length, liked: looks.filter((l) => l.favorite).length, capsules: capsules.size };
}

/** The item page's quiet line (owner, 18.11): «8/10 · сильна річ · у 5 образах», «гарна, мало образів», «варто замінити: …». */
export function itemVerdict(db: DB, item: Item): { line: string; note: string; kind: 'strong' | 'underused' | 'replace' | 'plain'; need?: Need } | null {
  const r = item.rating;
  if (!r || item.status === 'inactive' || item.mergedInto) return null;
  const n = itemUsage(db, item.id).looks;
  const inLooks = n ? `у ${n} ${n === 1 ? 'образі' : 'образах'}` : 'ще без образів';
  if (r.replace && !r.kept) return { kind: 'replace', line: `${r.score}/10 · варто замінити: ${r.replace}`, note: r.note, need: db.needs.find((x) => x.replaces === item.id && x.status === 'open') };
  if (r.score >= 7 && n <= 1) return { kind: 'underused', line: `${r.score}/10 · гарна, мало образів`, note: r.note };
  if (r.score >= 7) return { kind: 'strong', line: `${r.score}/10 · сильна річ · ${inLooks}`, note: r.note };
  return { kind: 'plain', line: `${r.score}/10 · ${inLooks}`, note: r.note };
}

/** Glasses never go into the owner's looks (owner rule: no eyewear of any kind). */
export const isEyewear = (title: string) => /окуляр|оправ|glasses|eyewear/i.test(title);

/** Advisor proposals still worth showing: open and made only of active owned pieces, never eyewear. */
export function openSuggestions(db: DB) {
  const active = new Set(db.items.filter((i) => i.status !== 'inactive' && !i.mergedInto && !isEyewear(i.title)).map((i) => i.id));
  return (db.suggestions ?? []).filter((s) => s.status === 'open' && s.looks.every((l) => Object.values(l.slots).flat().every((r) => r.kind !== 'item' || active.has(r.id))));
}

/** «Де шукати» (Profile → Магазини): the owner's shopping place; empty means online only. */
export const DEFAULT_LOCATION = 'Tower Center Rijeka, Rijeka, Croatia';
export const shopLocation = (db: DB) => db.profile.location ?? DEFAULT_LOCATION;

/** «4 з 6 готові» / «усі готові» — the quiet capsule line. */
export function readyLine(db: DB, c: Capsule) {
  const { done, total } = capsuleReady(db, c);
  if (!total) return '';
  return done === total ? 'усі готові' : `${done} з ${total} готові`;
}

/** Liked first, then fully ready capsules, then the share of ready looks. */
export const rankCapsules = (db: DB, caps: Capsule[]) =>
  caps
    .map((c, i) => {
      const { done, total } = capsuleReady(db, c);
      return { c, i, full: total > 0 && done === total, share: total ? done / total : 0 };
    })
    .sort((a, b) => Number(b.c.favorite) - Number(a.c.favorite) || Number(b.full) - Number(a.full) || b.share - a.share || a.i - b.i)
    .map((e) => e.c);

/**
 * Next-purchase rating (owner, 17.11): looks it would complete count most,
 * then how much closer it brings the other looks, the owner's liked looks and
 * core priority. Derived from the data, so every purchase or upload re-ranks.
 */
/**
 * The looks the site shows as cards: each visible capsule's looks with near-copies folded inside
 * that capsule (as its page shows them), plus looks outside capsules — one entry per look.
 */
export function siteLooks(db: DB): Look[] {
  const seen = new Set<string>();
  const out: Look[] = [];
  const add = (ls: Look[]) => { for (const l of ls) if (!seen.has(l.id)) { seen.add(l.id); out.push(l); } };
  for (const c of db.capsules) if (!c.disliked) add(distinctLooks(db, capsuleLooks(db, c.lookIds)));
  add(distinctLooks(db, db.looks.filter((l) => !l.capsuleId || !db.capsules.some((c) => c.id === l.capsuleId))));
  return out;
}

export function purchaseRanking(db: DB) {
  const open = db.needs.filter((n) => n.status === 'open');
  const visible = siteLooks(db);
  return open
    .map((n) => {
      // Same cards as everywhere else: the visible looks with near-copies folded once for the whole site.
      const looks = visible.filter((l) => missingNeeds(db, l).includes(n.id));
      let completes = 0;
      let closer = 0;
      let liked = 0;
      for (const l of looks) {
        const m = missingTitles(db, l).length;
        if (m === 1) completes += 1;
        else closer += 1 / m;
        if (l.favorite) liked += 1;
      }
      const looksIn = looks.length;
      return { need: n, looksIn, completes, score: completes * 3 + closer + liked + (n.priority === 'core' ? 0.5 : 0) };
    })
    .sort((a, b) => b.score - a.score || b.looksIn - a.looksIn);
}

export const capsuleLooks = (db: DB, lookIds: string[]) => lookIds.map((id) => db.looks.find((l) => l.id === id)).filter((l): l is Look => Boolean(l));

const KNOWN_BRANDS: [string, RegExp][] = [
  ["Levi's", /levi/i], ['The North Face', /\btnf\b|north face/i], ['Adidas', /adidas|stan smith/i], ['Napapijri', /napapijri/i],
  ['Polo Ralph Lauren', /ralph lauren/i], ['Puma', /\bpuma\b/i], ['Under Armour', /\bua\b|under armour/i], ['Tommy Hilfiger', /tommy/i],
  ['Tom Tailor', /tom tailor/i], ['Nike', /\bnike\b/i], ['Lacoste', /lacoste/i], ['Calvin Klein', /calvin klein/i], ['Hugo Boss', /\bboss\b|\bhugo\b/i],
];

/** Brands seen in the wardrobe (brand field, title or notes), most frequent first — the start of «Мої бренди». */
export function wardrobeBrands(db: Pick<DB, 'items'>): string[] {
  const count = new Map<string, number>();
  for (const i of db.items) {
    if (i.status === 'inactive' || i.mergedInto) continue;
    const text = `${i.brand ?? ''} ${i.title} ${i.observation ?? ''}`;
    for (const [name, re] of KNOWN_BRANDS) if (re.test(text)) count.set(name, (count.get(name) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}
