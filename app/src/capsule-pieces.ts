import type { Capsule, Category, DB, Look, SlotKey, SlotRef, Slots } from '../server/schema.ts';
import { hiddenLookIds } from './rating.ts';

/**
 * A capsule is a fashion style plus a closed set of pieces (owner, 20.11; spec
 * 2026-11-20-capsule-system-design.md): ten garments (top, layer, bottom), and
 * apart from them up to three pairs of shoes and three accessories. The set may
 * hold owned items and purchases still to buy. Until a capsule's set is saved,
 * it is read from the pieces its visible looks use. Shared by the server and the site.
 */
export const CAPSULE_LIMITS = { garments: 10, shoes: 3, accessories: 3 } as const;
export const MAX_BASE_PIECES = 2;

export type PieceGroup = keyof typeof CAPSULE_LIMITS;
export type PieceRole = 'top' | 'layer' | 'bottom' | 'shoes' | 'accessories';

type PieceDb = Pick<DB, 'items' | 'needs' | 'products'>;

const SLOT_ORDER: SlotKey[] = ['layer', 'top', 'bottom', 'shoes', 'accessories'];
const GARMENT_ROLES = ['top', 'layer', 'bottom'] as const;
const DEFAULT_ROLE: Record<Category, PieceRole> = {
  outerwear: 'layer', knitwear: 'top', shirts: 'top', tees: 'top', trousers: 'bottom', shorts: 'bottom', shoes: 'shoes', accessories: 'accessories',
};

export const pieceGroup = (category: Category): PieceGroup =>
  category === 'shoes' ? 'shoes' : category === 'accessories' ? 'accessories' : 'garments';

export const pieceKey = (r: SlotRef) => `${r.kind}:${r.id}`;

/** A shop product stands for its purchase: the set keeps the purchase, a look may show the chosen product. */
export function normalizePiece(db: Pick<DB, 'products'>, ref: SlotRef): SlotRef {
  if (ref.kind !== 'product') return { kind: ref.kind, id: ref.id };
  const product = db.products.find((p) => p.id === ref.id);
  return product ? { kind: 'need', id: product.needId } : { kind: ref.kind, id: ref.id };
}

export function pieceCategory(db: PieceDb, ref: SlotRef): Category | undefined {
  const r = normalizePiece(db, ref);
  if (r.kind === 'item') return db.items.find((i) => i.id === r.id)?.category;
  if (r.kind === 'need') return db.needs.find((n) => n.id === r.id)?.category;
  return undefined;
}

/** The looks a capsule shows: hidden ones are history, not part of its set. */
export function visibleCapsuleLooks(db: DB, c: Pick<Capsule, 'lookIds'>): Look[] {
  const hidden = hiddenLookIds(db);
  return c.lookIds
    .map((id) => db.looks.find((l) => l.id === id))
    .filter((l): l is Look => l !== undefined && !hidden.has(l.id));
}

function uniquePieces(db: Pick<DB, 'products'>, refs: SlotRef[]): SlotRef[] {
  const seen = new Set<string>();
  const out: SlotRef[] = [];
  for (const r of refs) {
    const n = normalizePiece(db, r);
    if (seen.has(pieceKey(n))) continue;
    seen.add(pieceKey(n));
    out.push(n);
  }
  return out;
}

const slotPieces = (slots: Slots) => SLOT_ORDER.flatMap((k) => slots[k]);

/** The capsule's set: saved pieces, or — until it is saved — every piece its visible looks use. */
export function capsulePieceRefs(db: DB, c: Capsule): SlotRef[] {
  if (c.pieces) return uniquePieces(db, c.pieces);
  return uniquePieces(db, visibleCapsuleLooks(db, c).flatMap((l) => slotPieces(l.slots)));
}

/** The combinations formula: (tops × bottoms + dresses) × (layers + 1) × shoes. */
export function capsuleCombinations(r: { top: number; layer: number; bottom: number; shoes: number; dresses?: number }): number {
  return (r.top * r.bottom + (r.dresses ?? 0)) * (r.layer + 1) * r.shoes;
}

export interface CapsulePiece {
  ref: SlotRef;
  category?: Category;
  group: PieceGroup;
  /** Where the piece is worn: the slot it fills most often in the capsule's looks, else its category's usual one. */
  role: PieceRole;
  /** Visible looks of this capsule that use it. */
  looks: number;
  owned: boolean;
  base: boolean;
}

export interface CapsuleSet {
  /** False while the set is still read from the looks. */
  saved: boolean;
  pieces: CapsulePiece[];
  counts: Record<PieceGroup, number>;
  roles: Record<PieceRole, number>;
  combinations: number;
  /** Groups above their limit (a set read from the looks may be). */
  over: PieceGroup[];
}

export function capsuleSet(db: DB, c: Capsule): CapsuleSet {
  const looks = visibleCapsuleLooks(db, c);
  const baseKeys = new Set((c.base ?? []).map((r) => pieceKey(normalizePiece(db, r))));
  const pieces = capsulePieceRefs(db, c).map((ref): CapsulePiece => {
    const key = pieceKey(ref);
    const category = pieceCategory(db, ref);
    const group = category ? pieceGroup(category) : 'garments';
    const slotUse = new Map<SlotKey, number>();
    let used = 0;
    for (const l of looks) {
      let inLook = false;
      for (const k of SLOT_ORDER) {
        if (!l.slots[k].some((r) => pieceKey(normalizePiece(db, r)) === key)) continue;
        slotUse.set(k, (slotUse.get(k) ?? 0) + 1);
        inLook = true;
      }
      if (inLook) used += 1;
    }
    let role: PieceRole = category ? DEFAULT_ROLE[category] : 'top';
    if (group === 'garments') {
      const worn = GARMENT_ROLES.filter((k) => slotUse.has(k)).sort((a, b) => slotUse.get(b)! - slotUse.get(a)!);
      if (worn.length) role = worn[0];
    }
    return { ref, category, group, role, looks: used, owned: ref.kind === 'item', base: baseKeys.has(key) };
  });
  const counts: Record<PieceGroup, number> = { garments: 0, shoes: 0, accessories: 0 };
  const roles: Record<PieceRole, number> = { top: 0, layer: 0, bottom: 0, shoes: 0, accessories: 0 };
  for (const p of pieces) {
    counts[p.group] += 1;
    roles[p.role] += 1;
  }
  const over = (Object.keys(CAPSULE_LIMITS) as PieceGroup[]).filter((g) => counts[g] > CAPSULE_LIMITS[g]);
  return { saved: Boolean(c.pieces), pieces, counts, roles, combinations: capsuleCombinations(roles), over };
}

const GROUP_LIMIT_TEXT: Record<PieceGroup, string> = {
  garments: `до ${CAPSULE_LIMITS.garments} речей одягу`,
  shoes: `до ${CAPSULE_LIMITS.shoes} пар взуття`,
  accessories: `до ${CAPSULE_LIMITS.accessories} аксесуарів`,
};

/** Why a set cannot be saved, or null. Products must already be normalized to their purchase. */
export function pieceSetError(db: PieceDb, pieces: SlotRef[], base: SlotRef[] = []): string | null {
  const keys = new Set<string>();
  const counts: Record<PieceGroup, number> = { garments: 0, shoes: 0, accessories: 0 };
  for (const r of pieces) {
    if (r.kind !== 'item' && r.kind !== 'need') return 'У наборі капсули можуть бути лише речі й покупки';
    const category = pieceCategory(db, r);
    if (!category) return `Набір капсули: немає ${r.kind === 'item' ? 'речі' : 'покупки'} ${r.id}`;
    if (keys.has(pieceKey(r))) return 'Набір капсули: річ повторюється';
    keys.add(pieceKey(r));
    counts[pieceGroup(category)] += 1;
  }
  for (const g of Object.keys(CAPSULE_LIMITS) as PieceGroup[]) {
    if (counts[g] > CAPSULE_LIMITS[g]) return `У капсулі ${GROUP_LIMIT_TEXT[g]}. Що замінити?`;
  }
  if (base.length > MAX_BASE_PIECES) return `База капсули — до ${MAX_BASE_PIECES} речей`;
  for (const r of base) if (!keys.has(pieceKey(r))) return 'База капсули має бути з її набору';
  return null;
}

/** Pieces of a look that are outside the capsule's saved set (none while the set is not saved). */
export function piecesOutsideSet(db: DB, c: Capsule, slots: Slots): SlotRef[] {
  if (!c.pieces) return [];
  const inSet = new Set(c.pieces.map((r) => pieceKey(normalizePiece(db, r))));
  return uniquePieces(db, slotPieces(slots)).filter((r) => !inSet.has(pieceKey(r)));
}
