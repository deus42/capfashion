import type { Look, SlotKey } from '../server/schema.ts';
import { pieceDifference, sameLook } from './rating.ts';

const CORE: SlotKey[] = ['top', 'layer', 'bottom', 'shoes'];
export const changedCoreSlots = (a: Look, b: Look) => CORE.filter((slot) => {
  const key = (look: Look) => look.slots[slot].map((r) => `${r.kind}:${r.id}`).sort().join('|');
  return key(a) !== key(b);
});

/**
 * Owner's same-look rule (identical or one piece different, accessories
 * included) against each group's representative, avoiding chains.
 */
const coreKeys = (look: Look) => new Set(CORE.flatMap((slot) => look.slots[slot].map((r) => `${r.kind}:${r.id}`)));
/** One look shown as variants (owner, 19.11): the same look by the owner's rule, or one core piece different ignoring accessories. */
export function sameVariant(a: Look, b: Look) {
  if (sameLook(a, b)) return true;
  const ca = coreKeys(a);
  const cb = coreKeys(b);
  return ca.size >= 3 && cb.size >= 3 && pieceDifference(ca, cb) <= 1;
}

export function groupLookVariations(looks: Look[]) {
  const groups: { primary: Look; variants: Look[] }[] = [];
  for (const look of looks) {
    const group = groups.find((g) => sameVariant(g.primary, look));
    if (group) group.variants.push(look);
    else groups.push({ primary: look, variants: [] });
  }
  return groups;
}
