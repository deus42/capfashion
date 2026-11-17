import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { validIdentity } from './schema.ts';
import type { Job } from './schema.ts';

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
