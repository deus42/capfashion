// One-time move of the owner's local site into their production account.
//
//   node scripts/import-user.ts pack <out-dir>
//     On the Mac, from the project: refuses while a job is queued or running, then lays out <out-dir> as an
//     account folder: db.json with paths relative to the account, media/ (without the thumbnail cache), jobs/,
//     the photos the database uses from assets/photos/, and manifest.json with every file's SHA-256.
//   node scripts/import-user.ts verify <dir>
//     Rehashes every file against <dir>/manifest.json: nothing missing, nothing extra, every hash equal.
//   node scripts/import-user.ts apply <staged-dir> <data-dir> <email> [--replace]
//     On the server with the service stopped (deploy/README.md): verifies the staged folder, finds the account
//     by email in <data-dir>/app.sqlite (sign in once first), copies into users/<id>.importing, verifies the
//     copy, keeps any previous folder as users/<id>.before-import-<time> and moves the import into place.
//     An account that already has photos, pieces or looks is left alone unless --replace is given.
//
// Uploading the staged folder to the server is a separate step the owner approves at the time.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { validateDb } from '../app/server/schema.ts';
import type { DB } from '../app/server/schema.ts';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'manifest.json';
/** Folders of an account that stored paths may point into. */
const ACCOUNT_PREFIXES = ['media/', 'jobs/', 'assets/photos/'];
const SAFE_ID = /^[A-Za-z0-9_-]{6,64}$/;

interface Manifest {
  createdAt: string;
  counts: Record<string, number>;
  files: Record<string, { size: number; sha256: string }>;
}

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Every file under dir, as forward-slash paths relative to dir. */
function listFiles(dir: string, rel = ''): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const p = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) return listFiles(dir, p);
    if (d.isFile()) return [p];
    return fail(`Not a plain file: ${p}`);
  });
}

/** Copies one file, as a copy-on-write clone where the file system allows it. */
function copy(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);
}

/** Calls fn on every string in the value, replacing each with what fn returns. */
function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

const counts = (db: DB) => ({ photos: db.photos.length, items: db.items.length, looks: db.looks.length, capsules: db.capsules.length, results: db.results.length, jobs: db.jobs.length });

function pack(out: string) {
  const dataDir = path.resolve(process.env.CAPSULA_DATA_DIR || path.join(PROJECT_ROOT, '.local', 'app-data'));
  const prefix = `${path.relative(PROJECT_ROOT, dataDir).split(path.sep).join('/')}/`;
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')) as DB;
  const busy = db.jobs.filter((j) => j.state === 'queued' || j.state === 'running');
  if (busy.length) fail(`Wait for ${busy.length} queued or running jobs to finish first.`);
  if (fs.existsSync(out) && fs.readdirSync(out).length) fail(`${out} is not empty.`);

  // Local paths are relative to the project (".local/app-data/media/…"); an account's are relative to its folder.
  const moved = mapStrings(db, (s) => (s.startsWith(prefix) ? s.slice(prefix.length) : s)) as DB;
  // The local site always shows Ukrainian; an account without a language would follow the browser instead.
  moved.profile.language ??= 'uk';
  const problem = validateDb(moved);
  if (problem) fail(`The database does not validate: ${problem}`);

  const referenced = new Set<string>();
  const outside = new Set<string>();
  mapStrings(moved, (s) => {
    if (/\s/.test(s) || s.includes('..')) return s;
    if (ACCOUNT_PREFIXES.some((p) => s.startsWith(p))) referenced.add(s);
    else if (/^[\w.-]+\/[^:]*\.(jpe?g|png|webp|heic|json|txt|log)$/i.test(s)) outside.add(s);
    return s;
  });
  if (outside.size) fail(`Paths outside the account folders:\n${[...outside].slice(0, 10).join('\n')}`);

  fs.mkdirSync(out, { recursive: true });
  let copied = 0;
  for (const top of ['media', 'jobs']) {
    const from = path.join(dataDir, top);
    if (!fs.existsSync(from)) continue;
    for (const rel of listFiles(from)) {
      if (top === 'media' && rel.startsWith('thumbs/')) continue; // rebuilt on demand under the new paths
      copy(path.join(from, rel), path.join(out, top, rel));
      copied += 1;
    }
  }
  const missing: string[] = [];
  for (const rel of referenced) {
    if (!rel.startsWith('assets/photos/')) {
      if (!fs.existsSync(path.join(out, rel))) missing.push(rel);
      continue;
    }
    const from = path.join(PROJECT_ROOT, rel);
    if (!fs.existsSync(from)) missing.push(rel);
    else if (!fs.existsSync(path.join(out, rel))) (copy(from, path.join(out, rel)), (copied += 1));
  }
  fs.writeFileSync(path.join(out, 'db.json'), JSON.stringify(moved, null, 2));

  const manifest: Manifest = { createdAt: new Date().toISOString(), counts: counts(moved), files: {} };
  for (const rel of listFiles(out).sort()) {
    const file = path.join(out, rel);
    manifest.files[rel] = { size: fs.statSync(file).size, sha256: sha256(file) };
  }
  fs.writeFileSync(path.join(out, MANIFEST), JSON.stringify(manifest, null, 2));
  const bytes = Object.values(manifest.files).reduce((n, f) => n + f.size, 0);
  console.log(JSON.stringify({ out, ...manifest.counts, files: Object.keys(manifest.files).length, megabytes: Math.round(bytes / 1024 ** 2), copied, missing: missing.length }));
  if (missing.length) console.log(`Already missing in the local site (left as they are):\n${missing.join('\n')}`);
}

/** Checks dir against a manifest; returns the number of files. */
function verify(dir: string, manifest: Manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'))): number {
  const present = new Set(listFiles(dir).filter((f) => f !== MANIFEST));
  const expected = Object.keys(manifest.files);
  const missing = expected.filter((f) => !present.has(f));
  const extra = [...present].filter((f) => !(f in manifest.files));
  const changed = expected.filter((f) => present.has(f) && sha256(path.join(dir, f)) !== manifest.files[f].sha256);
  if (missing.length || extra.length || changed.length) {
    fail(`${dir} does not match the manifest: ${missing.length} missing, ${extra.length} extra, ${changed.length} changed.\n${[...missing, ...extra, ...changed].slice(0, 10).join('\n')}`);
  }
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')) as DB;
  if (JSON.stringify(counts(db)) !== JSON.stringify(manifest.counts)) fail('Database counts differ from the manifest.');
  return expected.length;
}

function apply(staged: string, dataDir: string, email: string, replace: boolean) {
  const manifest = JSON.parse(fs.readFileSync(path.join(staged, MANIFEST), 'utf8')) as Manifest;
  const files = verify(staged, manifest);
  const auth = new DatabaseSync(path.join(dataDir, 'app.sqlite'), { readOnly: true });
  const row = auth.prepare('SELECT id FROM user WHERE lower(email) = ?').get(email.trim().toLowerCase()) as { id: string } | undefined;
  auth.close();
  if (!row) fail('No account with that email: sign in once with it first.');
  if (!SAFE_ID.test(row!.id)) fail('Unexpected account id.');
  const target = path.join(dataDir, 'users', row!.id);
  const current = path.join(target, 'db.json');
  if (fs.existsSync(current) && !replace) {
    const db = JSON.parse(fs.readFileSync(current, 'utf8')) as DB;
    if (db.photos.length || db.items.length || db.looks.length) fail('The account already has photos, pieces or looks; add --replace to keep them aside and import anyway.');
  }
  const importing = `${target}.importing`;
  fs.rmSync(importing, { recursive: true, force: true });
  for (const rel of Object.keys(manifest.files)) copy(path.join(staged, rel), path.join(importing, rel));
  verify(importing, manifest);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const previous = `${target}.before-import-${stamp}`;
  if (fs.existsSync(target)) fs.renameSync(target, previous);
  fs.renameSync(importing, target);
  const record = path.join(dataDir, 'imports', `${row!.id}-${stamp}.json`);
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(record, JSON.stringify(manifest));
  console.log(JSON.stringify({ account: row!.id, files, ...manifest.counts, previous: fs.existsSync(previous) ? path.basename(previous) : null }));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'pack' && args[0]) pack(path.resolve(args[0]));
else if (command === 'verify' && args[0]) console.log(JSON.stringify({ verified: verify(path.resolve(args[0])) }));
else if (command === 'apply' && args[2]) apply(path.resolve(args[0]), path.resolve(args[1]), args[2], args.includes('--replace'));
else fail('Usage: import-user.ts pack <out-dir> | verify <dir> | apply <staged-dir> <data-dir> <email> [--replace]');
