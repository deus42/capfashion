import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { validIdentity } from './schema.ts';
import type { IdentityReference, Job } from './schema.ts';

/** Frozen retries must not bring back a superseded face, physique or presentation. */
export function sameIdentity(current: IdentityReference | undefined, frozen: IdentityReference | undefined) {
  if (!current) return !frozen;
  if (!frozen) return false;
  const key = (r: IdentityReference) => JSON.stringify([
    r.sourcePhotoId, r.original.path, r.original.sha256,
    r.face.path, r.face.sha256, r.body.path, r.body.sha256,
    r.bodyOriginal?.path, r.bodyOriginal?.sha256,
    r.hair?.crop.path, r.hair?.crop.sha256,
    r.preserveHeadAngle, r.noGlasses, r.hairstyle,
    r.approvedPortrait?.approvedAt, r.approvedPortrait?.provisional,
  ]);
  return key(current) === key(frozen);
}

/** Fail before generation if any frozen original/crop has changed or vanished. */
export function verifyReferenceFiles(job: Job, resolve: (p: string) => string) {
  const ref = job.snapshot.identity;
  if (!ref) return;
  if (!validIdentity(ref)) throw Error('Некоректний закріплений оригінал зовнішності');
  const files = [ref.original, ref.face, ref.body, ...(ref.bodyOriginal ? [ref.bodyOriginal] : []), ...(ref.hair ? [ref.hair.original, ref.hair.crop] : []), ...job.snapshot.slots.flatMap((s) => s.photoHashes ?? [])];
  for (const file of files) {
    const actual = createHash('sha256').update(fs.readFileSync(resolve(file.path))).digest('hex');
    if (actual !== file.sha256) throw Error(`Змінено закріплений файл: ${file.path}; потрібна нова перевірка оригіналу`);
  }
}
