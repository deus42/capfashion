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

export async function uploadFile(file: File, params: Record<string, string>) {
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
