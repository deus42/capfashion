import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, HttpError } from './store.ts';
import { buildSeed } from './seed.ts';
import { createRunner } from './runner.ts';
import { dispatch, upload } from './routes.ts';
import { CONTENT_TYPES, MAX_UPLOAD_BYTES, prewarm, resolveAllowed, snapWidth, thumbnail } from './media.ts';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(APP_DIR, '..');
const DATA_DIR = path.resolve(process.env.CAPFASHION_DATA_DIR || path.join(PROJECT_ROOT, '.local', 'app-data'));
const DIST = path.join(APP_DIR, 'dist');
const PORT = Number(process.env.PORT || 4317);
const HOST = '127.0.0.1';

const store = createStore(DATA_DIR, () => buildSeed(PROJECT_ROOT, DATA_DIR));
const runner = createRunner(store, PROJECT_ROOT);
const ctx = { store, projectRoot: PROJECT_ROOT, drain: () => void runner.drain() };

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/**
 * Local Mac requests use a loopback Host. Anything else must come through
 * `tailscale serve`, which injects the tailnet identity header; only the
 * owner's login is accepted. The server itself never listens beyond loopback.
 */
const PROXY_HEADERS = ['tailscale-user-login', 'tailscale-headers-info', 'x-forwarded-for', 'forwarded'];

/**
 * Trusted without a login: plain loopback requests, and requests from the
 * private exmachina gateway (https://capfashion.exmachina), which verifies the
 * owner's Tailscale identity itself and forwards with a loopback Host and
 * X-Forwarded-Host. `tailscale serve` requests carry the tailnet hostname and
 * identity headers and are checked below.
 */
function authorize(req: http.IncomingMessage): string | null {
  const host = req.headers.host ?? '';
  const fwdHost = req.headers['x-forwarded-host'];
  const localForward = fwdHost === undefined || LOOPBACK_HOST.test(String(fwdHost));
  const proxied = PROXY_HEADERS.some((h) => h in req.headers);
  if (LOOPBACK_HOST.test(host) && localForward && !proxied) return null;
  const login = String(req.headers['tailscale-user-login'] ?? '').toLowerCase();
  const allowed = (process.env.CAPFASHION_TAILSCALE_LOGIN || store.read().settings.tailscaleLogin || '').toLowerCase();
  if (!allowed) return 'Віддалений доступ вимкнено: у налаштуваннях не вказано Tailscale-логін власника';
  if (!login || login !== allowed) return 'Доступ дозволено лише власнику через Tailscale';
  return null;
}

const acceptsGzip = (req?: http.IncomingMessage) => /\bgzip\b/.test(String(req?.headers['accept-encoding'] ?? ''));

function send(res: http.ServerResponse, status: number, data: unknown, req?: http.IncomingMessage) {
  const body = JSON.stringify(data ?? { ok: true });
  const headers: http.OutgoingHttpHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Accept-Encoding' };
  if (body.length > 2048 && acceptsGzip(req)) {
    res.writeHead(status, { ...headers, 'content-encoding': 'gzip' });
    res.end(zlib.gzipSync(body, { level: 6 }));
    return;
  }
  res.writeHead(status, headers);
  res.end(body);
}

/** The UI does not need prompts or snapshots of finished non-try-on jobs; keep polling light. */
function stateView(db: ReturnType<typeof store.read>) {
  return {
    ...db,
    results: db.results.map(({ prompt: _p, ...r }) => r),
    jobs: db.jobs.map((j) => ((j.kind ?? 'tryon') === 'tryon' ? j : { ...j, snapshot: { lookName: j.snapshot.lookName, slots: [], basePhotoIds: [], basePhotoPaths: [] } })),
  };
}

const gzCache = new Map<string, { mtime: number; buf: Buffer }>();
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg']);

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Запит завеликий'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(res: http.ServerResponse, file: string, cache = 'no-cache', req?: http.IncomingMessage) {
  const ext = path.extname(file).toLowerCase();
  const type = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const headers: http.OutgoingHttpHeaders = { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' };
  if (COMPRESSIBLE.has(ext) && acceptsGzip(req)) {
    const mtime = fs.statSync(file).mtimeMs;
    let hit = gzCache.get(file);
    if (!hit || hit.mtime !== mtime) {
      hit = { mtime, buf: zlib.gzipSync(fs.readFileSync(file), { level: 9 }) };
      gzCache.set(file, hit);
    }
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip', vary: 'Accept-Encoding' });
    res.end(hit.buf);
    return;
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  const denied = authorize(req);
  if (denied) return send(res, 403, { error: denied });
  const method = req.method ?? 'GET';

  if (url.pathname.startsWith('/api/')) {
    if (method !== 'GET' && req.headers['x-capfashion'] !== '1') return send(res, 403, { error: 'Запит без заголовка сайту відхилено' });
    if (method === 'GET' && url.pathname === '/api/state') {
      const db = store.read();
      return send(res, 200, { db: stateView(db), runner: runner.state, recovered: store.recovered(), dataDir: path.relative(PROJECT_ROOT, DATA_DIR) }, req);
    }
    if (method === 'GET' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/log')) {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const job = store.read().jobs.find((j) => j.id === id);
      if (!job?.logPath) return send(res, 404, { error: 'Журналу немає' });
      const text = fs.existsSync(path.join(PROJECT_ROOT, job.logPath)) ? fs.readFileSync(path.join(PROJECT_ROOT, job.logPath), 'utf8') : '';
      return send(res, 200, { log: text.slice(-20000) });
    }
    if (method === 'POST' && url.pathname === '/api/upload') {
      const buf = await readBody(req, MAX_UPLOAD_BYTES + 1);
      const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'upload'));
      return send(res, 200, await upload(ctx, url.searchParams, buf, name));
    }
    const raw = method === 'GET' ? Buffer.alloc(0) : await readBody(req, 1024 * 1024);
    let body: Record<string, unknown> = {};
    if (raw.length) {
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new HttpError(400, 'Неправильний JSON');
      }
    }
    return send(res, 200, await dispatch(ctx, method, url.pathname, body), req);
  }

  if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { error: 'Метод не підтримується' });

  if (url.pathname.startsWith('/media/')) {
    const rel = decodeURIComponent(url.pathname.slice('/media/'.length));
    const file = resolveAllowed(PROJECT_ROOT, DATA_DIR, rel);
    if (!fs.existsSync(file)) return send(res, 404, { error: 'Файл не знайдено' });
    return sendFile(res, file, 'private, max-age=3600');
  }

  if (url.pathname.startsWith('/thumb/')) {
    const rel = decodeURIComponent(url.pathname.slice('/thumb/'.length));
    const file = resolveAllowed(PROJECT_ROOT, DATA_DIR, rel);
    if (!fs.existsSync(file)) return send(res, 404, { error: 'Файл не знайдено' });
    const size = snapWidth(Number(url.searchParams.get('w')) || 480);
    const thumb = await thumbnail(PROJECT_ROOT, DATA_DIR, rel, rel, size);
    return sendFile(res, thumb, 'private, max-age=86400');
  }

  const asset = path.resolve(DIST, `.${url.pathname}`);
  if (asset.startsWith(DIST + path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
    return sendFile(res, asset, url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', req);
  }
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) return send(res, 503, { error: 'Інтерфейс не зібрано: запусти npm start' });
  return sendFile(res, index, 'no-cache', req);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e: unknown) => {
    const err = e instanceof HttpError ? e : new HttpError(500, (e as Error)?.message || 'Внутрішня помилка');
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, err.status, { error: err.message, details: err.details });
    else res.end();
  });
});

const interrupted = await runner.recover();
// Warm the thumbnail cache for everything the UI shows, in the background.
{
  const db = store.read();
  prewarm(PROJECT_ROOT, DATA_DIR, [...db.photos.map((p) => p.path), ...db.results.map((r) => r.imagePath)]);
}
server.listen(PORT, HOST, () => {
  console.log(`${new Date().toISOString()} Cap Fashion: http://${HOST}:${PORT}  (дані: ${path.relative(PROJECT_ROOT, DATA_DIR)}, Codex: ${runner.state.codexBin})`);
  // A run was in progress when the server stopped: continue it. Jobs that were only queued wait for "Запустити".
  if (interrupted > 0) {
    console.log(`Продовжую чергу: ${interrupted} перерваних завдань`);
    void runner.drain();
  }
});
