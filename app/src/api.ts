import type { DB } from '../server/schema.ts';
export type * from '../server/schema.ts';

export interface RunnerState {
  running: boolean;
  currentJobId: string | null;
  lastError: string | null;
  codexBin?: string;
}

export interface AppState {
  db: DB;
  runner: RunnerState;
  recovered: boolean;
  dataDir: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || `Помилка ${res.status}`);
  return data as T;
}

/** Accounts mode signs people in with Google; the owner's local site has no accounts. */
export interface SessionUser { id: string; name: string; email: string; image: string | null; owner: boolean }
export interface Session { mode: 'local' | 'accounts'; user: SessionUser | null }
export async function getSession(): Promise<Session> {
  return parse(await fetch('/api/session', { cache: 'no-store' }));
}

export async function getState(): Promise<AppState> {
  return parse(await fetch('/api/state', { cache: 'no-store' }));
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-capsula': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse<T>(res);
}

/** Accounts mode converts big or HEIC photos in the browser; the owner's local site keeps original bytes (owner rule). */
let convertUploads = false;
export const setUploadConversion = (on: boolean) => { convertUploads = on; };

/** A JPEG of at most 2560 px from what the browser can decode (Safari decodes HEIC); otherwise the file as it is. */
async function browserJpeg(file: File): Promise<File> {
  const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!heic && file.size < 4 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export async function uploadFile(original: File, params: Record<string, string>) {
  const file = convertUploads ? await browserJpeg(original) : original;
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/upload?${qs}`, {
    method: 'POST',
    headers: { 'x-capsula': '1', 'x-filename': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  return parse<{ id: string }>(res);
}

export async function getLog(jobId: string) {
  return parse<{ log: string }>(await fetch(`/api/jobs/${encodeURIComponent(jobId)}/log`));
}

export const thumb = (p: string, w = 720) => `/thumb/${p.split('/').map(encodeURIComponent).join('/')}?w=${w}`;
export const media = (p: string) => `/media/${p.split('/').map(encodeURIComponent).join('/')}`;
