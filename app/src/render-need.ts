import type { DB, Look } from '../server/schema.ts';
import { hiddenLookIds } from './rating.ts';

/**
 * Which looks need a try-on of their current composition. Shared by the
 * server (render queue, catch-up after a pause) and the site, so a swapped
 * or covered piece is re-rendered by itself once generation can run.
 */

type RenderDb = Pick<DB, 'looks' | 'capsules' | 'jobs' | 'results' | 'profile'>;

/** Generation cannot run: a rejected identity is paused, or there is no base photo. */
export const rendersPaused = (db: Pick<DB, 'profile'>) => Boolean(db.profile.identity?.disabledReason) || !db.profile.basePhotoIds.length;

/** A try-on of the current composition is queued or running, or waits on a pause that still holds. */
export function renderPending(db: RenderDb, look: Look) {
  const paused = rendersPaused(db);
  return db.jobs.some(
    (j) => (j.kind ?? 'tryon') === 'tryon' && j.lookId === look.id && j.lookVersion === look.version && (j.state === 'queued' || j.state === 'running' || (j.state === 'needs_data' && paused)),
  );
}

/** A try-on of the current composition already failed: it is not retried by itself (no endless loop). */
const failed = (db: RenderDb, look: Look) => db.jobs.some((j) => (j.kind ?? 'tryon') === 'tryon' && j.lookId === look.id && j.lookVersion === look.version && j.state === 'error');

/** Visible looks whose current composition has no try-on and none on the way. */
export function looksNeedingRender(db: RenderDb): Look[] {
  const hidden = hiddenLookIds(db);
  const rendered = new Set(db.results.map((r) => `${r.lookId}:${r.lookVersion}`));
  return db.looks.filter((l) => !hidden.has(l.id) && Object.values(l.slots).some((refs) => refs.length) && !rendered.has(`${l.id}:${l.version}`) && !renderPending(db, l) && !failed(db, l));
}
