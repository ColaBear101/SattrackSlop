/* A browser-less world for the client code: a fetch that routes /api/* to whatever plays the API and everything else
 * to a scripted CelesTrak and mirror, a clock, and a storage that can be spied on or made to fail. */
import { createApi, type Env } from '../../server/app.js';
import { createApiClient, type ApiClient } from '../../src/lib/net/api';
import { createBreaker, type Breaker } from '../../src/lib/net/breaker';
import type { TleCtx } from '../../src/lib/net/tle-source';
import type { HistoryCtx } from '../../src/lib/net/history-source';
import type { FetchLike, Store } from '../../src/lib/net/types';
import { TEST_ENV, fakeClock, scripted, text, type Clock, type Script } from '../server/helpers/harness.js';
import type { FetchFn } from '../../server/lib/upstream.js';

export const API_BASE = 'http://localhost';          // 9 characters: Elysia needs at least four to find the path

export interface MemoryStore extends Store {
  data: Map<string, string>;
  reads: string[];
  writes: string[];
  removes: string[];
}

export function memoryStore(init: Record<string, string> = {}, o: { failWrites?: boolean; failReads?: boolean } = {}): MemoryStore {
  const data = new Map(Object.entries(init));
  const s: MemoryStore = {
    data, reads: [], writes: [], removes: [],
    getItem(k) { s.reads.push(k); if (o.failReads) throw new DOMException('blocked', 'SecurityError'); return data.has(k) ? data.get(k)! : null; },
    setItem(k, v) { if (o.failWrites) throw new DOMException('quota', 'QuotaExceededError'); s.writes.push(k); data.set(k, v); },
    removeItem(k) { s.removes.push(k); data.delete(k); }
  };
  return s;
}

export type ApiHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export interface World {
  clock: Clock;
  fetch: FetchLike;
  /** every URL asked, in order, and what kind it was */
  calls: Array<{ url: string; init?: RequestInit }>;
  apiCalls: () => string[];
  directCalls: () => string[];
  store: MemoryStore;
  api: ApiClient;
  breaker: Breaker;
}

/** `api` plays whatever answers /api/* (default: a host with no API, answering as a static site does); `upstream` is what
 *  the direct fetches reach. */
export function makeWorld(o: {
  api?: ApiHandler;
  upstream?: Script;
  store?: MemoryStore;
  clock?: Clock;
  apiTimeoutMs?: { tle?: number; history?: number };
} = {}): World {
  const clock = o.clock ?? fakeClock(Date.UTC(2026, 8, 13, 0, 0, 0));
  const direct = scripted(o.upstream ?? {});
  const calls: World['calls'] = [];
  const api: ApiHandler = o.api ?? (() => text('Not Found', 404));
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith(API_BASE + '/api/')) return api(url, init);
    return direct(url, init, calls.length);
  };
  const client = createApiClient({ base: API_BASE, fetch, timeoutMs: o.apiTimeoutMs });
  return {
    clock, fetch, calls,
    apiCalls: () => calls.filter(c => c.url.startsWith(API_BASE + '/api/')).map(c => c.url),
    directCalls: () => calls.filter(c => !c.url.startsWith(API_BASE + '/api/')).map(c => c.url),
    store: o.store ?? memoryStore(), api: client, breaker: createBreaker(clock.now)
  };
}

export function tleCtx(w: World, over: Partial<TleCtx> = {}): TleCtx {
  return { fetch: w.fetch, now: w.clock.now, storage: w.store, pinned: false, isCustom: false, api: w.api, breaker: w.breaker, directTimeoutMs: 40, ...over };
}
export function historyCtx(w: World, over: Partial<HistoryCtx> = {}): HistoryCtx {
  return { fetch: w.fetch, now: w.clock.now, storage: w.store, isCustom: false, api: w.api, breaker: w.breaker, directTimeoutMs: 40, ...over };
}

/** The real API app as the thing /api/* reaches, with its own scripted upstream - client and server end to end, in process. */
export function realApi(upstream: Script, env: Env = {}, clock?: Clock): { handler: ApiHandler; upstreamCalls: string[]; clock: Clock } {
  const c = clock ?? fakeClock(Date.UTC(2026, 8, 13, 0, 0, 0));
  const upstreamCalls: string[] = [];
  const h = scripted(upstream);
  const fetchFn: FetchFn = async (url, init) => { upstreamCalls.push(url); return h(url, init, upstreamCalls.length); };
  const app = createApi({ ...TEST_ENV, ...env }, { fetch: fetchFn, now: c.now });
  return { handler: (url, init) => app.handle(new Request(url, init)), upstreamCalls, clock: c };
}

/** Wrap a context so that every property the code reads is recorded, in order. */
export function spy<T extends object>(ctx: T): { ctx: T; reads: string[] } {
  const reads: string[] = [];
  return { ctx: new Proxy(ctx, { get(t, k, r) { reads.push(String(k)); return Reflect.get(t, k, r); } }), reads };
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
