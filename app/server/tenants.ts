// Tenants (production spec 2026-11-20-capsula-production.md §5): every account has its own folder with the same
// locked JSON store, media and job folders the single-user site uses. Local mode keeps one tenant — the owner's
// existing data in the project — exactly as before; accounts mode opens `<data>/users/<userId>/` per signed-in user.
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './schema.ts';
import { MEASURE_KEYS, SCHEMA_VERSION } from './schema.ts';
import { createStore, now, type Store } from './store.ts';
import { createRunner, type Limiter } from './runner.ts';

export type Runner = ReturnType<typeof createRunner>;
export interface Tenant {
  id: string;
  /** Root that stored media paths are relative to. */
  root: string;
  store: Store;
  runner: Runner;
  ctx: { store: Store; projectRoot: string; drain: () => void };
}

/** A new account's wardrobe: empty, valid, nothing seeded from anyone else's data. */
export function emptyDb(): DB {
  const at = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    updatedAt: at,
    photos: [], items: [], needs: [], products: [], looks: [], capsules: [], jobs: [], results: [], comparisons: [],
    profile: {
      rev: 1,
      basePhotoIds: [],
      measurements: Object.fromEntries(MEASURE_KEYS.map((k) => [k, { value: null }])) as DB['profile']['measurements'],
      knownSizes: [],
      preferences: { comfort: '', materials: '', fit: '', branding: '' },
    },
    settings: { codexModel: 'gpt-6.1-sol', reasoningEffort: 'medium', tailscaleLogin: '' },
  } as DB;
}

/** Account ids come from the auth database; anything else is refused before it can name a folder. */
const SAFE_ID = /^[A-Za-z0-9_-]{6,64}$/;

export function createTenants(opts: { projectRoot: string; dataDir: string; seed: () => DB; limiter?: Limiter; codexBin?: string }) {
  const cache = new Map<string, Tenant>();

  function open(id: string, root: string, dataDir: string, seed: () => DB): Tenant {
    const store = createStore(dataDir, seed);
    const runner = createRunner(store, root, opts.codexBin, { limiter: opts.limiter });
    const tenant: Tenant = { id, root, store, runner, ctx: { store, projectRoot: root, drain: () => void runner.drain() } };
    // A run stopped by a restart continues when its account is opened again.
    void runner.recover().then((n) => (n > 0 ? runner.drain() : undefined)).catch(() => undefined);
    return tenant;
  }

  /** The owner's single local site: the project folder and its existing data. */
  function local(): Tenant {
    let t = cache.get('local');
    if (!t) cache.set('local', (t = open('local', opts.projectRoot, opts.dataDir, opts.seed)));
    return t;
  }

  const userRoot = (userId: string) => {
    if (!SAFE_ID.test(userId)) throw new Error('Unsafe account id');
    return path.join(opts.dataDir, 'users', userId);
  };

  function forUser(userId: string): Tenant {
    let t = cache.get(userId);
    if (!t) {
      const root = userRoot(userId);
      cache.set(userId, (t = open(userId, root, root, emptyDb)));
    }
    return t;
  }

  /** Account deletion: the queue stops and the whole folder goes. */
  function remove(userId: string) {
    const root = userRoot(userId);
    cache.get(userId)?.runner.stop();
    cache.delete(userId);
    fs.rmSync(root, { recursive: true, force: true });
  }

  return { local, forUser, remove, userRoot };
}
