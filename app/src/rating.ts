import type { Capsule, DB, Look } from '../server/schema.ts';

/**
 * Owner ratings and the owner's same-look rule (17.11): two outfits are the
 * same look when they are identical or differ by one piece; two or more
 * different pieces make a different look. Accessories count as pieces.
 * Shared by the server (analyzer, render queue) and the site.
 */

export type Rating = 'like' | 'dislike' | null;

export const ratingOf = (x: Pick<Look | Capsule, 'favorite' | 'disliked'>): Rating => (x.disliked ? 'dislike' : x.favorite ? 'like' : null);

export const lookKeys = (look: Pick<Look, 'slots'>) => new Set(Object.values(look.slots).flat().map((r) => `${r.kind}:${r.id}`));

/** Pieces that differ: a swap, an addition or a removal each counts once. */
export function pieceDifference(a: Set<string>, b: Set<string>) {
  let onlyA = 0;
  let onlyB = 0;
  for (const x of a) if (!b.has(x)) onlyA += 1;
  for (const x of b) if (!a.has(x)) onlyB += 1;
  return Math.max(onlyA, onlyB);
}

export const sameLookKeys = (a: Set<string>, b: Set<string>) => pieceDifference(a, b) <= 1;
export const sameLook = (a: Pick<Look, 'slots'>, b: Pick<Look, 'slots'>) => sameLookKeys(lookKeys(a), lookKeys(b));

type RatedDb = Pick<DB, 'looks' | 'capsules'>;
const hiddenCache = new WeakMap<object, Set<string>>();

/**
 * Looks hidden from the site but kept as finished looks: disliked looks, the
 * looks of a disliked capsule, and near-copies of a disliked look. A liked
 * look is never hidden.
 */
export function hiddenLookIds(db: RatedDb): Set<string> {
  const cached = hiddenCache.get(db.looks);
  if (cached) return cached;
  const hidden = new Set<string>();
  for (const c of db.capsules) if (c.disliked) for (const id of c.lookIds) hidden.add(id);
  const rejected = db.looks.filter((l) => l.disliked).map(lookKeys);
  for (const l of db.looks) {
    if (l.favorite) hidden.delete(l.id);
    else if (l.disliked || rejected.some((r) => sameLookKeys(r, lookKeys(l)))) hidden.add(l.id);
  }
  hiddenCache.set(db.looks, hidden);
  return hidden;
}

/** A capsule is hidden when disliked, or when every one of its looks is hidden (unless liked). */
export function isCapsuleHidden(db: RatedDb, c: Capsule) {
  if (c.disliked) return true;
  if (c.favorite || !c.lookIds.length) return false;
  const hidden = hiddenLookIds(db);
  return c.lookIds.every((id) => hidden.has(id));
}

/** Liked first; otherwise the given order is kept. */
export const byRating = <T extends Pick<Look | Capsule, 'favorite'>>(list: T[]) =>
  list.map((x, i) => ({ x, i })).sort((a, b) => Number(b.x.favorite) - Number(a.x.favorite) || a.i - b.i).map((e) => e.x);
