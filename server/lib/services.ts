/* The cache and the single flight in front of upstream.ts: this is what makes N visitors cost CelesTrak one
 * request. Everything the routes need that has state lives here and is created once per createApi(), so two
 * apps (two tests) never share a cache.
 *
 * The rules, each with a test in tests/server:
 *   - a record is served from memory while less than its TTL has passed since the instant its upstream request
 *     was MADE (`at`); after that the next request asks again;
 *   - concurrent requests for one key share one upstream call;
 *   - forward only: the epoch of the record held (even an expired one) is the floor for the next answer, and an
 *     older set is refused by upstream.fetchTle, so it can never replace what is held;
 *   - what is cached is an ANSWER: an element set, a withdrawal ("gone"), a history, or a history that arrived and
 *     is not usable (`none`). A failure is never cached.
 */
import type { Config } from '../config.js';
import { Flights, Lru, isFresh } from './cache.js';
import { clientKey, createLimiter } from './limit.js';
import { fetchHistory, fetchTle, type Deps, type HistoryFetch, type TleFetch } from './upstream.js';

export type CacheLabel = 'hit' | 'miss' | 'coalesced';
export interface Served<R> { result: R; cache: CacheLabel }

type TleAnswer = Exclude<TleFetch, { kind: 'failed' }>;
type HistoryAnswer = Exclude<HistoryFetch, { kind: 'failed' }>;

export interface Services {
  /** `norad` is canonical (digits, no leading zeros) */
  tle(norad: string): Promise<Served<TleFetch>>;
  history(norad: string): Promise<Served<HistoryFetch>>;
  /** count one request from this client against a route's budget */
  limit(route: 'tle' | 'history', request: Request): { ok: boolean; retryAfterS: number };
}

export function createServices(cfg: Config, deps: Deps): Services {
  const tleCache = new Lru<TleAnswer>(cfg.tleCacheMax);
  const tleFlights = new Flights<TleFetch>();
  const historyCache = new Lru<HistoryAnswer>(cfg.historyCacheMax);
  const historyFlights = new Flights<HistoryFetch>();
  const limiter = createLimiter(deps.now);

  return {
    async tle(norad) {
      const held = tleCache.get(norad);
      if (held && isFresh(held.at, cfg.tleTtlMs, deps.now())) return { result: held, cache: 'hit' };
      const floor = held && held.kind === 'ok' ? held.epoch : null;
      const { promise, shared } = tleFlights.run(norad, async () => {
        const got = await fetchTle(deps, cfg, norad, floor);
        if (got.kind !== 'failed') tleCache.set(norad, got);
        return got;
      });
      return { result: await promise, cache: shared ? 'coalesced' : 'miss' };
    },

    async history(norad) {
      const held = historyCache.get(norad);
      if (held && isFresh(held.at, cfg.historyTtlMs, deps.now())) return { result: held, cache: 'hit' };
      const { promise, shared } = historyFlights.run(norad, async () => {
        const got = await fetchHistory(deps, cfg, norad);
        if (got.kind !== 'failed') historyCache.set(norad, got);
        return got;
      });
      return { result: await promise, cache: shared ? 'coalesced' : 'miss' };
    },

    limit(route, request) {
      const max = route === 'tle' ? cfg.rateTlePerMin : cfg.rateHistoryPerMin;
      return limiter.take(route, clientKey(request.headers, cfg.trustProxy), max);
    }
  };
}
