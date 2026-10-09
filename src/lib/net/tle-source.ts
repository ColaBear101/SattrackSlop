/* The current element set for one object: `fetchLiveTle(norad, ctx)`, the successor of legacy fetchTLE
 * (legacy/index.html 11486-11524), with the API in front of the direct fetches.
 *
 * The order is a contract, and every step is a refusal to ask anyone anything:
 *
 *   1. digits         only a NORAD number (one to five digits) is ever put in a URL or used as a storage key
 *   2. custom orbit   an orbit the reader designed is nobody's object: CelesTrak would be asked for a number that
 *                     belongs to no one, and were it ever a real one the reply would be adopted as "newer" and the
 *                     reader's orbit silently replaced. Never fetched, no probes, nothing written.
 *   3. ?tle=embedded  the assignment snapshot is pinned to the embedded sets on purpose: no request of any kind,
 *                     not even a probe of the API
 *   4. tle:<n> cache  three hours from the instant it was fetched, validated AGAIN with tleOk (a record that could
 *                     never have arrived over the network was once trusted the moment it was in localStorage)
 *   5. the API        one request for every visitor; its answer carries the instant it was fetched, so an element set
 *                     does not look younger for having passed through its cache
 *   6. direct         the sources themselves, as the page always asked them
 *
 * Results keep the legacy shapes: `{l1, l2, src, at}`, `{src, gone: true, at}` (a withdrawal - an answer, not
 * cached), or null (nothing usable; the caller's own retry spacing applies).
 *
 * The API is treated as unavailable - and the direct fetches take over - on a network error, a reply that is not
 * JSON, one without the x-gt-api header, a 404 or 5xx, a rate limit, or a record that does not pass tleOk. The
 * circuit breaker then leaves it alone for ten minutes, except when the API answered as itself and said the
 * sources are down (502/504): that is not a reason to stop asking it about the next object.
 */
import { isNoradId, tleOk } from '../../../shared/tle';
import { tripsBreaker, type ApiClient } from './api';
import type { Breaker } from './breaker';
import { fetchDirectTle, type GoneTle, type LiveTle } from './direct';
import { TLE_TTL, type FetchLike, type Store } from './types';

export type { GoneTle, LiveTle } from './direct';
export type TleResult = LiveTle | GoneTle | null;

export interface TleCtx {
  fetch: FetchLike;
  now: () => number;
  /** localStorage, or null where there is none */
  storage: Store | null;
  /** ?tle=embedded: the assignment snapshot */
  pinned: boolean;
  /** the entry is an orbit the reader designed */
  isCustom: boolean;
  /** null: no API to ask (VITE_API=off, or no base) */
  api: ApiClient | null;
  breaker: Breaker;
  /** per-source deadline of the direct fetches (default 8 s) */
  directTimeoutMs?: number;
}

export async function fetchLiveTle(norad: unknown, ctx: TleCtx): Promise<TleResult> {
  /* 1. The second layer: only a NORAD number is ever put in a URL or used as a storage key. refreshTLE's custom flag
     is the first layer; this one holds if that is ever bypassed, and it also keeps a number from a stored or typed
     source out of the query. */
  if (!isNoradId(norad)) return null;
  const satnum = String(norad);
  if (ctx.isCustom) return null;                                   // 2
  if (ctx.pinned) return null;                                     // 3

  /* 4 */
  const key = 'tle:' + satnum;
  try {
    const c: LiveTle | null = JSON.parse((ctx.storage && ctx.storage.getItem(key)) || 'null');   // whatever is stored: tleOk decides
    if (c && isFinite(c.at) && (ctx.now() - c.at) < TLE_TTL) {
      if (tleOk(c, satnum)) return c;
      /* Poisoned or truncated. Drop it rather than return it and rather than leave it to be rejected again on every
         refresh for the life of the session. */
      try { ctx.storage && ctx.storage.removeItem(key); } catch { /* blocked */ }
    }
  } catch { /* no storage, or not JSON */ }

  /* 5 */
  if (ctx.api && !ctx.breaker.isOpen()) {
    const got = await ctx.api.tle(String(Number(satnum)));         // the numeric value: "01804" and "1804" are one object
    if (got.kind === 'ok') {
      const a = got.data;
      /* `at` is the server's fetch instant; a clock running ahead of ours must not make a set look younger than now. */
      const at = Math.min(a.at, ctx.now());
      if (a.status === 'gone') return { src: a.src, gone: true, at };
      const rec = { l1: a.l1, l2: a.l2, src: a.src, at };
      if (tleOk(rec, satnum)) {
        try { ctx.storage && ctx.storage.setItem(key, JSON.stringify(rec)); } catch { /* full or blocked */ }
        return rec;
      }
      /* a well-formed answer that is not a usable element set for this number: believe nothing it says */
    } else if (tripsBreaker(got)) {
      ctx.breaker.trip();
    }
  }

  /* 6 */
  const rec = await fetchDirectTle(satnum, { fetch: ctx.fetch, now: ctx.now, timeoutMs: ctx.directTimeoutMs });
  if (rec && !('gone' in rec)) {
    try { ctx.storage && ctx.storage.setItem(key, JSON.stringify(rec)); } catch { /* full or blocked */ }
  }
  return rec;
}
