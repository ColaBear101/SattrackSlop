/* The typed client of the data-cache API (server/): an Eden treaty over `Api`, a TYPE-ONLY import - no server code
 * reaches the browser bundle, and a change to a route's schema is a compile error here.
 *
 * What this adds to Eden is the judgement the page needs: "did I just talk to MY API?" A static deploy answers
 * /api/* with a plain-text 404 page (or the app shell), a dev server with nothing behind the proxy answers with its
 * own error, a captive portal answers with HTML. Only a response that carries the x-gt-api header, whose body is
 * the JSON the schema promises, counts. Everything else is "the API is not here", reported as a reason, never
 * thrown: the callers fall back to the direct fetches the page always made.
 */
import type { Api } from '../../../server/app';
import {
  API_HEADER, type HistoryAnswer, type HistoryRow, type Outcome, type TleAnswer, type Tried
} from '../../../shared/api-types';
import { withDeadline } from './deadline';
import type { FetchLike } from './types';

/** Why a reply is not an answer:
 *    network    the request failed (offline, refused, blocked by an extension or CSP, a CORS failure)
 *    timeout    no reply inside the client's deadline
 *    not_ours   a reply without the x-gt-api header: a 404 page, the app shell, a proxy's error, someone else's server
 *    not_json   the header, but not JSON
 *    shape      JSON that is not what the schema promises
 *    api_error  the API itself said no: `error` is its code (rate_limited, upstream_unavailable, ...) */
export type DownWhy = 'network' | 'timeout' | 'not_ours' | 'not_json' | 'shape' | 'api_error';
export interface ApiDown { kind: 'down'; why: DownWhy; status?: number; error?: string; tried?: Tried[] }
export type ApiReply<T> = { kind: 'ok'; data: T } | ApiDown;

export interface ApiClient {
  tle(norad: string): Promise<ApiReply<TleAnswer>>;
  history(norad: string): Promise<ApiReply<HistoryAnswer>>;
}

export interface ApiClientOptions {
  /** where the API lives: the page's own origin, or VITE_API_BASE */
  base: string;
  /** defaults to the global fetch, looked up at call time */
  fetch?: FetchLike;
  /** the client gives up on the API after this long; the server's own worst case is two 8 s sources, or 70 s for a history */
  timeoutMs?: { tle?: number; history?: number };
}

export const API_TIMEOUT_TLE_MS = 20_000;
export const API_TIMEOUT_HISTORY_MS = 85_000;

/** Where to find the API, or null when there is none to ask: `VITE_API=off` switches it off, `VITE_API_BASE`
 *  points elsewhere, otherwise the page's own origin (not `file://`, whose origin is the string "null"). */
export function resolveApiBase(o: { VITE_API?: string; VITE_API_BASE?: string; origin?: string }): string | null {
  if ((o.VITE_API ?? '').trim().toLowerCase() === 'off') return null;
  const base = (o.VITE_API_BASE ?? '').trim() || (o.origin ?? '').trim();
  return /^https?:\/\//i.test(base) ? base.replace(/\/+$/, '') : null;
}

/** Whether an API failure is a reason to stop asking for a while. The API answering as itself that the sources are
 *  down (502, 504), or that the number was bad (400, which the guard above makes impossible), is not. */
export function tripsBreaker(down: ApiDown): boolean {
  if (down.why !== 'api_error') return true;
  return !(down.error === 'upstream_unavailable' || down.error === 'upstream_timeout' || down.error === 'bad_norad');
}

/* ---- what a reply has to look like ------------------------------------------------------------------- */

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const OUTCOMES: readonly string[] = ['unreachable', 'timeout', 'http', 'unreadable', 'too_large', 'older'] satisfies Outcome[];

export function isTleAnswer(x: unknown): x is TleAnswer {
  if (!isObj(x)) return false;
  if (x.status === 'ok') return isStr(x.norad) && isStr(x.l1) && isStr(x.l2) && isStr(x.src) && isNum(x.at) && isNum(x.epoch);
  if (x.status === 'gone') return isStr(x.norad) && isStr(x.src) && isNum(x.at);
  return false;
}

const isRow = (r: unknown): r is HistoryRow => isObj(r) && isNum(r.t) && isNum(r.sma) && (r.ecc === null || isNum(r.ecc));

export function isHistoryAnswer(x: unknown): x is HistoryAnswer {
  if (!isObj(x)) return false;
  if (x.status === 'ok') {
    return isStr(x.norad) && Array.isArray(x.P) && x.P.every(isRow) && isNum(x.rows) && isStr(x.src) && isNum(x.at);
  }
  if (x.status === 'none') {
    return isStr(x.norad) && (x.why === 'empty' || x.why === 'outside') && isNum(x.rows) && isStr(x.src) && isNum(x.at);
  }
  return false;
}

const isTried = (t: unknown): t is Tried =>
  isObj(t) && isStr(t.src) && isStr(t.outcome) && OUTCOMES.includes(t.outcome) && (t.status === undefined || isNum(t.status));

/* ---- the client -------------------------------------------------------------------------------------- */

/** The part of Eden's result this reads (its `response` is undefined when the fetch itself failed, which its type does not say). */
interface EdenLike {
  data: unknown;
  error: { status: unknown; value: unknown } | null;
  response: Response | undefined;
  status: number;
}

function classify<T>(r: EdenLike, guard: (x: unknown) => x is T): ApiReply<T> {
  const res = r.response;
  if (!res) return { kind: 'down', why: 'network' };
  if (res.headers.get(API_HEADER) !== '1') return { kind: 'down', why: 'not_ours', status: res.status };
  if (r.error) {
    const v = r.error.value;
    if (!isObj(v) || !isStr(v.error)) return { kind: 'down', why: 'not_json', status: res.status };
    const down: ApiDown = { kind: 'down', why: 'api_error', status: res.status, error: v.error };
    if (Array.isArray(v.tried)) down.tried = v.tried.filter(isTried);
    return down;
  }
  if (typeof r.data === 'string') return { kind: 'down', why: 'not_json', status: res.status };
  return guard(r.data) ? { kind: 'ok', data: r.data } : { kind: 'down', why: 'shape', status: res.status };
}

/* Eden's client is a chunk of its own, fetched the first time the page asks its API (a visit with no API never needs it). A failed fetch is
   not remembered. Its time is inside the call's deadline. */
let eden: Promise<typeof import('@elysia/eden/treaty2')['treaty']> | null = null;
const loadTreaty = () => (eden ??= import('@elysia/eden/treaty2').then(m => m.treaty, e => { eden = null; throw e; }));

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const send: FetchLike = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const tleMs = opts.timeoutMs?.tle ?? API_TIMEOUT_TLE_MS;
  const historyMs = opts.timeoutMs?.history ?? API_TIMEOUT_HISTORY_MS;

  /* One treaty per call: it is only a proxy, and it lets the call's own AbortSignal ride in the fetcher. Handing the signal
     to Eden as an option instead makes it add "content-type: application/json" to the GET, which turns a simple
     cross-origin request into one that needs a preflight. The fetcher also drops any content-type, for the same reason. */
  const treatyFor = async (signal: AbortSignal) => (await loadTreaty())<Api>(opts.base, {
    fetcher: ((url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.delete('content-type');
      return send(url, { ...init, headers: Object.fromEntries(headers), signal });
    }) as unknown as typeof fetch,                                    // Eden only ever calls it with (string, RequestInit)
    parseDate: false                                                  // a string that looks like a date stays a string
  });

  const timed = async <T>(ms: number, call: (signal: AbortSignal) => Promise<ApiReply<T>>): Promise<ApiReply<T>> => {
    const t = await withDeadline(ms, call);
    if (t.ok) return t.value;
    // a throw from Eden is a body it could not parse (a network failure is a value, not a throw)
    return { kind: 'down', why: t.timedOut ? 'timeout' : 'not_json' };
  };

  return {
    tle: norad => timed(tleMs, async signal => classify(await (await treatyFor(signal)).api.tle({ norad }).get(), isTleAnswer)),
    history: norad => timed(historyMs, async signal => classify(await (await treatyFor(signal)).api.history({ norad }).get(), isHistoryAnswer))
  };
}
