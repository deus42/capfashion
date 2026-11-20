// Request limiter: sign-in is limited per address, uploads per account and per address.
// Fixed windows held in memory only; nothing about a request is stored. Behind Cloudflare Tunnel the client's
// address is CF-Connecting-IP, trusted only with TRUST_PROXY=cloudflare and only when the connection itself
// comes from a private address (the tunnel on the same host); the container publishes no public port.
import type http from 'node:http';
import { isIP } from 'node:net';

export interface Rule { limit: number; windowMs: number }

export const RATE_RULES = {
  /** Sign-in, the Google callback, sign-out and invite links, per address. */
  signIn: { limit: 40, windowMs: 10 * 60_000 },
  uploadAccount: { limit: 120, windowMs: 60 * 60_000 },
  uploadAddress: { limit: 240, windowMs: 60 * 60_000 },
} satisfies Record<string, Rule>;

export const RATE_LIMITED = 'Забагато запитів. Спробуй трохи пізніше';

export function createRateLimiter(clock: () => number = Date.now) {
  const windows = new Map<string, { count: number; reset: number }>();
  return {
    /** Counts one request; 0 when it may go ahead, else the seconds until its window resets. */
    take(key: string, rule: Rule): number {
      const at = clock();
      if (windows.size > 10_000) for (const [k, w] of windows) if (w.reset <= at) windows.delete(k);
      let w = windows.get(key);
      if (!w || w.reset <= at) windows.set(key, (w = { count: 0, reset: at + rule.windowMs }));
      if (w.count >= rule.limit) return Math.max(1, Math.ceil((w.reset - at) / 1000));
      w.count += 1;
      return 0;
    },
    get size() {
      return windows.size;
    },
  };
}

const PRIVATE_PEER = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:)/i;

/** The client's address: the socket's own, or Cloudflare's header when the socket is the local tunnel. */
export function clientAddress(req: http.IncomingMessage, trustCloudflare: boolean): string {
  const peer = (req.socket.remoteAddress ?? '').replace(/^::ffff:/i, '');
  if (trustCloudflare && PRIVATE_PEER.test(peer)) {
    const forwarded = String(req.headers['cf-connecting-ip'] ?? '').trim();
    if (isIP(forwarded)) return forwarded;
  }
  return peer || 'unknown';
}
