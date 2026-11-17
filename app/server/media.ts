import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpError } from './store.ts';

const run = promisify(execFile);

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function detectImageType(buf: Buffer): 'jpg' | 'png' | 'heic' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis)$/.test(buf.toString('latin1', 8, 12))) return 'heic';
  return null;
}

/**
 * Stores an uploaded original untouched. HEIC (iPhone) gets an extra JPEG
 * display copy made with macOS `sips`; the original is kept.
 */
export async function saveUpload(projectRoot: string, dataDir: string, id: string, buf: Buffer) {
  if (buf.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Файл більший за 40 МБ');
  const type = detectImageType(buf);
  if (!type) throw new HttpError(415, 'Підтримуються JPEG, PNG, HEIC і WebP');
  const dir = path.join(dataDir, 'media', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const original = path.join(dir, `${id}.${type}`);
  fs.writeFileSync(original, buf, { flag: 'wx' });
  let display = original;
  if (type === 'heic') {
    display = path.join(dir, `${id}.jpg`);
    try {
      await run('sips', ['-s', 'format', 'jpeg', original, '--out', display]);
    } catch {
      throw new HttpError(422, 'Не вдалося конвертувати HEIC у JPEG (sips)');
    }
  }
  return {
    path: path.relative(projectRoot, display),
    originalPath: display === original ? undefined : path.relative(projectRoot, original),
  };
}

/** Lazily builds a cached JPEG thumbnail for any allowed image. */
export async function thumbnail(projectRoot: string, dataDir: string, key: string, relPath: string, size = 720) {
  const dir = path.join(dataDir, 'media', 'thumbs');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${key.replace(/[^\w.-]/g, '_')}-${size}.jpg`);
  const src = path.join(projectRoot, relPath);
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) return out;
  await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', String(size), src, '--out', out]);
  return out;
}

/** Only these project folders may be served or attached to Codex jobs. */
export function allowedRoots(projectRoot: string, dataDir: string) {
  return [path.join(projectRoot, 'assets', 'photos'), path.join(dataDir, 'media'), path.join(projectRoot, 'output', 'prototypes')].map((p) => path.resolve(p) + path.sep);
}

export function resolveAllowed(projectRoot: string, dataDir: string, relPath: string) {
  const abs = path.resolve(projectRoot, relPath);
  if (!allowedRoots(projectRoot, dataDir).some((root) => abs.startsWith(root))) throw new HttpError(403, 'Шлях поза дозволеними каталогами');
  return abs;
}

export const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
