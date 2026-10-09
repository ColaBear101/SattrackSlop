/* The decay history of one object: `createHistorySource(ctx)` gives `{cached, history}`, the successors of
 * Lifetime.cached and Lifetime.history (legacy/earth/lifetime.js 339-379), with the API in front of the direct fetch.
 *
 *   cached(norad)   the 12 hour hist:<n> copy, or null
 *   history(norad)  {P, why} exactly as Lifetime.history answered, or null when it refuses to ask:
 *                     1. only a NORAD number (one to five digits) is put in a URL or used as a storage key
 *                     2. a custom orbit has no history and is never asked for one
 *                     3. the hist:<n> copy, if it is under 12 hours old
 *                     4. one shared request for concurrent callers (the endpoint can take over a minute, so a couple of
 *                        clicks must not queue several)
 *                     5. the API; then the direct fetch (75 s) when the API is absent or cannot help
 *
 * `why` keeps the names the decay page speaks in (verification/verify-lifetime.js): null for a history, otherwise
 * timeout, unreachable, http (with status), unreadable, empty, outside (with rows). The first four are failures a
 * reader may retry; the last two are answers.
 *
 * Where the API said "no answer inside its deadline" (504) that IS the answer: asking the same slow endpoint again
 * from the browser would be another minute for the same silence. Every other way the API cannot help - it is absent,
 * rate-limited, or reports an error from CelesTrak (which may be refusing the server's address, not the reader's) -
 * falls through to the direct fetch.
 */
import type { HistoryRow } from '../../../shared/api-types';
import type { PlotRow } from '../../../shared/plot';
import { isNoradId } from '../../../shared/tle';
import { tripsBreaker, type ApiClient } from './api';
import type { Breaker } from './breaker';
import { fetchDirectHistory, type HistoryOutcome } from './direct';
import { HIST_TTL, type FetchLike, type Store } from './types';

export type { HistoryOutcome } from './direct';

export interface HistoryCtx {
  fetch: FetchLike;
  now: () => number;
  storage: Store | null;
  /** the entry is an orbit the reader designed */
  isCustom: boolean;
  api: ApiClient | null;
  breaker: Breaker;
  /** deadline of the direct fetch (default 75 s) */
  directTimeoutMs?: number;
}

export interface HistorySource {
  cached(norad: unknown): PlotRow[] | null;
  history(norad: unknown): Promise<HistoryOutcome | null>;
}

/** JSON has no NaN: the API sends a row with no eccentricity as null, and a freshly read page has NaN there. */
const revive = (rows: HistoryRow[]): PlotRow[] => rows.map(r => ({ t: r.t, sma: r.sma, ecc: r.ecc === null ? NaN : r.ecc }));

export function createHistorySource(ctx: HistoryCtx): HistorySource {
  const inflight = new Map<string, Promise<HistoryOutcome>>();

  function cached(norad: unknown): PlotRow[] | null {
    if (!isNoradId(norad) || ctx.isCustom) return null;
    try {
      const c = JSON.parse((ctx.storage && ctx.storage.getItem('hist:' + norad)) || 'null');
      if (c && c.P && c.P.length && (ctx.now() - c.at) < HIST_TTL) return c.P;
    } catch { /* no storage, or not JSON */ }
    return null;
  }

  /** The hist:<n> copy of a history, thinned. `at` is when the history was fetched. */
  function remember(satnum: string, at: number, P: PlotRow[]): void {
    /* Keep the cache small - some objects carry 3700 points and localStorage is a per-origin budget. Thin the old
       end, keep the recent end intact, since that is what the fit actually uses. */
    const keep = P.length > 700
      ? P.filter((_, i) => i % Math.ceil(P.length / 500) === 0 || i >= P.length - 250)
      : P;
    try { ctx.storage && ctx.storage.setItem('hist:' + satnum, JSON.stringify({ at, P: keep })); } catch { /* full or blocked */ }
  }

  async function fetchHistory(satnum: string): Promise<HistoryOutcome> {
    if (ctx.api && !ctx.breaker.isOpen()) {
      const got = await ctx.api.history(String(Number(satnum)));       // the numeric value: one URL per object
      if (got.kind === 'ok') {
        const a = got.data;
        if (a.status === 'none') return { P: null, why: a.why, rows: a.rows };
        const P = revive(a.P);
        /* the server's fetch instant, never later than now: a clock running ahead must not make a history look younger */
        remember(satnum, Math.min(a.at, ctx.now()), P);
        return { P, why: null };
      }
      if (got.why === 'api_error' && got.error === 'upstream_timeout') return { P: null, why: 'timeout' };
      if (tripsBreaker(got)) ctx.breaker.trip();
    }
    const out = await fetchDirectHistory(satnum, { fetch: ctx.fetch, timeoutMs: ctx.directTimeoutMs });
    if (out.P) remember(satnum, ctx.now(), out.P);
    return out;
  }

  async function history(norad: unknown): Promise<HistoryOutcome | null> {
    if (!isNoradId(norad) || ctx.isCustom) return null;
    const satnum = String(norad);
    const hit = cached(satnum);
    if (hit) return { P: hit, why: null };
    const running = inflight.get(satnum);
    if (running) return running;                                       // share one request
    const p = fetchHistory(satnum).finally(() => { inflight.delete(satnum); });
    inflight.set(satnum, p);
    return p;
  }

  return { cached, history };
}
