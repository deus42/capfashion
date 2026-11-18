import type { Capsule, DB, Look } from './schema.ts';
import { bump, findOr404, HttpError } from './store.ts';

export function requireParentCapsule(db: DB, id: string | undefined): Capsule {
  if (!id) throw new HttpError(400, 'Вибери капсулу для образу');
  const capsule = findOr404(db.capsules, id, 'Капсула');
  if (capsule.redirectCapsuleIds) throw new HttpError(409, 'Капсулу вже перенесено. Вибери чинну капсулу');
  return capsule;
}

/** Update membership in both directions without changing the look's composition. */
export function placeLook(db: DB, look: Look, capsule: Capsule) {
  for (const other of db.capsules) {
    if (other.id === capsule.id || !other.lookIds.includes(look.id)) continue;
    other.lookIds = other.lookIds.filter((id) => id !== look.id);
    bump(other, undefined);
  }
  if (!capsule.lookIds.includes(look.id)) {
    capsule.lookIds.push(look.id);
    bump(capsule, undefined);
  }
  look.capsuleId = capsule.id;
}
