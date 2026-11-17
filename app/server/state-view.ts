import type { DB } from './schema.ts';

/** Keep rejected images in local history while removing them from every site view. */
export function stateView(db: DB) {
  const hidden = new Set(db.results.filter((r) => r.hiddenAt).map((r) => r.id));
  return {
    ...db,
    results: db.results.filter((r) => !hidden.has(r.id)).map(({ prompt: _p, ...r }) => r),
    comparisons: db.comparisons.filter((c) => !hidden.has(c.resultA) && !hidden.has(c.resultB)),
    jobs: db.jobs.map((j) => {
      const visible = j.resultId && hidden.has(j.resultId) ? { ...j, resultId: undefined } : j;
      return (j.kind ?? 'tryon') === 'tryon' ? visible : { ...visible, snapshot: { lookName: j.snapshot.lookName, slots: [], basePhotoIds: [], basePhotoPaths: [] } };
    }),
  };
}
