/* A fixed-window rate limiter, by hand. The platform's firewall is the real one; this keeps one noisy client
 * from spending the whole upstream budget when there is none in front. (elysia-rate-limit is out: it keys on
 * Bun's requestIP, which the Node adapter does not have.)
 */

export interface Limiter {
  /** Count one request from `who` against `route`. `max` of 0 means no limit. */
  take(route: string, who: string, max: number): { ok: boolean; retryAfterS: number };
}

export function createLimiter(now: () => number, windowMs = 60_000, maxKeys = 10_000): Limiter {
  const win = new Map<string, { start: number; n: number }>();
  return {
    take(route, who, max) {
      if (max <= 0) return { ok: true, retryAfterS: 0 };
      const t = now(), key = route + '|' + who;
      let w = win.get(key);
      if (!w || t - w.start >= windowMs) {
        if (win.size >= maxKeys) {                       // make room: drop what has expired, then the oldest
          for (const [k, v] of win) if (t - v.start >= windowMs) win.delete(k);
          for (const k of win.keys()) { if (win.size < maxKeys) break; win.delete(k); }
        }
        w = { start: t, n: 0 };
        win.set(key, w);
      }
      w.n++;
      return { ok: w.n <= max, retryAfterS: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
    }
  };
}

/** Who is asking. Behind a proxy we trust (TRUST_PROXY), the right-most x-forwarded-for entry: the one our own
 *  proxy appended, which the client cannot forge. Without one, every client shares a single bucket - the safe
 *  default, since an x-forwarded-for from the open internet is whatever the sender typed. */
export function clientKey(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return 'unknown';
  const xff = headers.get('x-forwarded-for');
  if (!xff) return 'unknown';
  const last = xff.split(',').pop()!.trim().slice(0, 64);
  return last || 'unknown';
}
