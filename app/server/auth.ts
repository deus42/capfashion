// Accounts (production spec 2026-11-20-capsula-production.md §4): Google sign-in only, through better-auth with
// Node's built-in SQLite. Sign-up needs an invite link while the beta is closed (`SIGNUP=open` opens it); the
// owner, named by `OWNER_EMAIL`, needs none. Google tokens are never stored. Patterns follow AllCheck's setup,
// without passwords, emails or account linking.
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type http from 'node:http';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { google, verifyGoogleIdToken } from 'better-auth/social-providers';

export const INVITE_COOKIE = 'capsula_invite';
const INVITE_DAYS = 14;
const DEV_SECRET = 'capsula-development-only-secret-not-for-production';

export interface AuthConfig {
  dataDir: string;
  baseURL: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
  ownerEmail?: string;
  openSignup: boolean;
}

export function authConfigFromEnv(env: NodeJS.ProcessEnv, dataDir: string): AuthConfig | null {
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!googleClientId && !googleClientSecret) return null;
  if (!googleClientId || !googleClientSecret) throw new Error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable accounts.');
  const baseURL = new URL(env.BETTER_AUTH_URL?.trim() || 'http://localhost:4317').origin;
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (env.NODE_ENV === 'production' && (!secret || secret.length < 32)) throw new Error('BETTER_AUTH_SECRET (32+ characters) is required in production.');
  return { dataDir, baseURL, secret: secret || DEV_SECRET, googleClientId, googleClientSecret, ownerEmail: env.OWNER_EMAIL?.trim().toLowerCase() || undefined, openSignup: env.SIGNUP === 'open' };
}

function cookieValue(header: string | null | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export interface Invite { code: string; createdAt: string; expiresAt: string; usedBy: string | null; usedAt: string | null; disabled: number }

export async function createAuth(cfg: AuthConfig) {
  const db = new DatabaseSync(path.join(cfg.dataDir, 'app.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS invite (
    code TEXT PRIMARY KEY, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL,
    usedBy TEXT, usedAt TEXT, disabled INTEGER NOT NULL DEFAULT 0)`);

  const validInvite = (code: string | undefined) => {
    if (!code) return null;
    const row = db.prepare('SELECT * FROM invite WHERE code = ?').get(code) as unknown as Invite | undefined;
    return row && !row.usedBy && !row.disabled && row.expiresAt > new Date().toISOString() ? row : null;
  };
  const isOwner = (email: string | null | undefined) => Boolean(cfg.ownerEmail && email?.toLowerCase() === cfg.ownerEmail);
  const requestHeaders = (ctx: unknown) => {
    const c = ctx as { request?: Request; headers?: Headers } | null | undefined;
    return c?.request?.headers ?? c?.headers;
  };
  // Google returns tokens on sign-in; Capsula needs none of them, so none are kept.
  const withoutTokens = (account: Record<string, unknown>) => ({
    data: { ...account, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null },
  });
  const provider = google({ clientId: cfg.googleClientId, clientSecret: cfg.googleClientSecret });

  const options: BetterAuthOptions = {
    appName: 'Capsula',
    baseURL: cfg.baseURL,
    secret: cfg.secret,
    trustedOrigins: [cfg.baseURL],
    database: db,
    session: { expiresIn: 60 * 60 * 24 * 30 },
    advanced: { useSecureCookies: cfg.baseURL.startsWith('https://') },
    account: { accountLinking: { enabled: false } },
    socialProviders: {
      google: {
        clientId: cfg.googleClientId,
        clientSecret: cfg.googleClientSecret,
        prompt: 'select_account',
        accessType: 'online',
        async getUserInfo(tokens) {
          // The ID token is verified, not only decoded; an unverified email never signs in.
          if (!tokens.idToken) return null;
          const profile = await verifyGoogleIdToken({ token: tokens.idToken, audience: cfg.googleClientId });
          if (!profile || profile.email_verified !== true || typeof profile.email !== 'string') return null;
          const info = await provider.getUserInfo(tokens);
          if (!info) return null;
          return { ...info, user: { ...info.user, email: profile.email.trim().toLowerCase(), emailVerified: true } };
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (cfg.openSignup || isOwner(user.email)) return { data: user };
            const code = cookieValue(requestHeaders(ctx)?.get('cookie'), INVITE_COOKIE);
            if (!validInvite(code)) throw new APIError('FORBIDDEN', { message: 'invite_required' });
            return { data: user };
          },
          after: async (user, ctx) => {
            const code = cookieValue(requestHeaders(ctx)?.get('cookie'), INVITE_COOKIE);
            if (code && !isOwner(user.email)) db.prepare('UPDATE invite SET usedBy = ?, usedAt = ? WHERE code = ? AND usedBy IS NULL').run(user.id, new Date().toISOString(), code);
          },
        },
      },
      account: {
        create: { before: async (account) => withoutTokens(account as unknown as Record<string, unknown>) as never },
        update: { before: async (account) => withoutTokens(account as unknown as Record<string, unknown>) as never },
      },
    },
    onAPIError: { errorURL: `${cfg.baseURL}/` },
  };

  const migrations = await getMigrations(options);
  await migrations.runMigrations();
  const auth = betterAuth(options);
  const handler = toNodeHandler(auth);

  return {
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => handler(req, res),
    async userOf(req: http.IncomingMessage) {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return null;
      const { id, name, email, image } = session.user;
      return { id, name, email, image: image ?? null, owner: isOwner(email) };
    },
    validInvite,
    invites: {
      list: () => db.prepare('SELECT * FROM invite ORDER BY createdAt DESC').all() as unknown as Invite[],
      create() {
        const code = randomBytes(12).toString('base64url');
        const at = new Date();
        const expires = new Date(at.getTime() + INVITE_DAYS * 86400_000);
        db.prepare('INSERT INTO invite (code, createdAt, expiresAt) VALUES (?, ?, ?)').run(code, at.toISOString(), expires.toISOString());
        return validInvite(code)!;
      },
      disable: (code: string) => void db.prepare('UPDATE invite SET disabled = 1 WHERE code = ?').run(code),
    },
    /** Removes the account's sign-in records; its wardrobe folder is removed by the caller. */
    deleteUser(userId: string) {
      db.prepare('DELETE FROM session WHERE userId = ?').run(userId);
      db.prepare('DELETE FROM account WHERE userId = ?').run(userId);
      db.prepare('DELETE FROM user WHERE id = ?').run(userId);
    },
    close: () => db.close(),
  };
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;
