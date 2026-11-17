import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Photo } from './schema.ts';
import type { Store } from './store.ts';
import { now } from './store.ts';
import { detectImageType } from './media.ts';

export interface ReferenceAsset {
  path: string;
  sha256: string;
  bytes: number;
  source_url: string;
  title?: string;
  tags?: string[];
}

/** Import an archived reference pack without intake, item creation or generation. */
export async function importInspiration(store: Store, root: string, assets: ReferenceAsset[], sourceNote: string) {
  const prepared = new Map<string, { photo: Photo; bytes: Buffer }>();
  const referenceRoot = fs.realpathSync(path.join(root, 'assets/references')) + path.sep;
  for (const asset of assets) {
    const source = fs.realpathSync(path.resolve(root, asset.path));
    if (!source.startsWith(referenceRoot)) throw new Error('Reference outside assets/references');
    if (new URL(asset.source_url).protocol !== 'https:') throw new Error('Reference source must use HTTPS');
    const bytes = fs.readFileSync(source);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== asset.sha256 || bytes.length !== asset.bytes) throw new Error(`Reference checksum mismatch: ${asset.path}`);
    const type = detectImageType(bytes);
    if (!type || type === 'heic') throw new Error('Reference must be JPEG, PNG or WebP');
    const id = `I-${hash}`;
    const target = path.join(store.dataDir, 'media/inspiration', `${hash}.${type}`);
    prepared.set(id, {
      bytes,
      photo: {
        id, kind: 'detail', path: path.relative(root, target), originalName: path.basename(source),
        source: 'chat-2026-11-14', createdAt: now(),
        inspiration: { title: asset.title ?? 'Референс із попереднього чату', sourceUrl: asset.source_url, sourceNote, tags: asset.tags ?? [], sha256: hash },
      },
    });
  }
  return store.mutate((db) => {
    const added: string[] = [];
    for (const [id, { photo, bytes }] of prepared) {
      const target = path.join(root, photo.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) {
        if (createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== photo.inspiration!.sha256) throw new Error('Stored reference checksum mismatch');
      } else fs.writeFileSync(target, bytes, { flag: 'wx' });
      if (db.photos.some((p) => p.id === id || p.inspiration?.sha256 === photo.inspiration!.sha256)) continue;
      db.photos.push(photo);
      added.push(id);
    }
    return { added, total: db.photos.filter((p) => p.inspiration).length };
  });
}
