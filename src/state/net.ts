import { createApiClient, resolveApiBase, type ApiClient } from '../lib/net/api';
import { createBreaker } from '../lib/net/breaker';
import type { TleCtx } from '../lib/net/tle-source';

/* The page's network, wired once: the API client (or none), the circuit breaker that stops the page asking an API
 * that is not there, and the context the element-set fetch is given. Nothing here is reactive; it is plumbing.
 *
 * Until a host is chosen the production deploy has no API, answers /api/* with a plain 404, and the first request
 * trips the breaker: one failed probe per ten minutes, then the direct fetches the page always made. `VITE_API=off`
 * skips even that probe; `VITE_API_BASE` points the client elsewhere. */

export const breaker = createBreaker(() => Date.now());

const base = resolveApiBase({
  VITE_API: import.meta.env.VITE_API as string | undefined,
  VITE_API_BASE: import.meta.env.VITE_API_BASE as string | undefined,
  origin: typeof location !== 'undefined' ? location.origin : ''
});

export const api: ApiClient | null = base ? createApiClient({ base }) : null;

/** What fetchLiveTle is given. `pinned` and `isCustom` are the caller's: they are properties of the page and of the entry. */
export function tleCtx(o: { pinned: boolean; isCustom: boolean }): TleCtx {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* blocked: the code works without it */ }
  return {
    fetch: (url, init) => window.fetch(url, init),
    now: () => Date.now(),
    storage,
    pinned: o.pinned,
    isCustom: o.isCustom,
    api,
    breaker
  };
}
