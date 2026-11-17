import type { Look, SlotKey } from '../server/schema.ts';
import { sameLook } from './rating.ts';

const CORE: SlotKey[] = ['top', 'layer', 'bottom', 'shoes'];
export const changedCoreSlots = (a: Look, b: Look) => CORE.filter((slot) => {
  const key = (look: Look) => look.slots[slot].map((r) => `${r.kind}:${r.id}`).sort().join('|');
  return key(a) !== key(b);
});

/**
 * Owner's same-look rule (identical or one piece different, accessories
 * included) against each group's representative, avoiding chains.
 */
export function groupLookVariations(looks: Look[]) {
  const groups: { primary: Look; variants: Look[] }[] = [];
  for (const look of looks) {
    const group = groups.find((g) => sameLook(g.primary, look));
    if (group) group.variants.push(look);
    else groups.push({ primary: look, variants: [] });
  }
  return groups;
}
