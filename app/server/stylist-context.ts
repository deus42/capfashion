// Read-only briefing for the chat stylist. Read the same data file as the site without starting its store or queue.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiddenLookIds, isCapsuleHidden } from '../src/rating.ts';
import { lookRating, weakPiece } from '../src/lib.ts';
import { refusedPieces, seenCompositions } from '../src/look-memory.ts';
import type { DB } from './schema.ts';

export function stylistContext(db: DB) {
  const hidden = hiddenLookIds(db);
  const capsules = db.capsules.filter(c => c.kind !== 'selection' && !isCapsuleHidden(db, c));
  const looks = db.looks.filter(l => !hidden.has(l.id));
  const { comfort, materials, fit, branding } = db.profile.preferences;
  return {
    updatedAt: db.updatedAt,
    preferences: { comfort, materials, fit, branding },
    capsules: capsules.map(({ id, name, description, periods, situations, lookIds }) =>
      ({ id, name, brief: description, periods, situations, lookIds: lookIds.filter(id => !hidden.has(id)) })),
    looks: looks.map(l => ({
      id: l.id, name: l.name, capsuleId: l.capsuleId, version: l.version, slots: l.slots,
      ownerLiked: l.favorite, advisorScore: lookRating(l),
    })),
    items: db.items.filter(i => i.status !== 'inactive' && !i.mergedInto)
      .map(i => ({
        id: i.id, title: i.title, category: i.category, status: i.status, color: i.color,
        composition: i.composition, fit: i.fit, ownerKeeps: Boolean(i.rating?.kept), weakForNewLooks: weakPiece(i),
      })),
    needs: db.needs.map(({ id, title, category, status, replaces, forCapsule }) =>
      ({ id, title, category, status, replaces, forCapsule })),
    products: db.products.map(({ id, model, needId, status }) => ({ id, model, needId, status })),
    declinedNeeds: db.declinedNeeds ?? [],
    repeatedlyRefusedItems: [...refusedPieces(db, hidden)],
    seenCompositions: seenCompositions(db),
  };
}

if (import.meta.main) {
  const dataDir = process.env.CAPFASHION_DATA_DIR || fileURLToPath(new URL('../../.local/app-data/', import.meta.url));
  try {
    const db: DB = JSON.parse(readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    console.log(JSON.stringify(stylistContext(db)));
  } catch {
    console.error('Не вдалося прочитати локальний каталог. Для персональної поради потрібен актуальний склад образу або капсули.');
    process.exitCode = 1;
  }
}
