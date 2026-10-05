/* A scripted upstream, a clock the test controls, and an app wired to both. Nothing here touches the network:
 * createApi's `fetch` is the script and `now` is the clock, so a test decides what CelesTrak says and what time it is.
 *
 * Elysia finds the path in `request.url` by looking for the first "/" at or after character 11, so a host shorter
 * than four characters ("http://x/api/...") is misread as a different path and every route 404s. Requests here use
 * "http://localhost".
 */
import { createApi, type Env } from '../../../server/app.js';
import type { FetchFn } from '../../../server/lib/upstream.js';

export const CELESTRAK_GP = 'https://celestrak.org/NORAD/elements/gp.php';
export const CELESTRAK_HISTORY = 'https://celestrak.org/NORAD/elements/graph-orbit-data.php';
export const MIRROR = 'https://tle.ivanstanojevic.me/api/tle/';

export const isGp = (u: string): boolean => u.startsWith(CELESTRAK_GP + '?');
export const isHistory = (u: string): boolean => u.startsWith(CELESTRAK_HISTORY + '?');
export const isMirror = (u: string): boolean => u.startsWith(MIRROR);
/** the number a URL asks about, whichever source it is for */
export const idOf = (u: string): string => isMirror(u) ? u.slice(MIRROR.length) : new URL(u).searchParams.get('CATNR') ?? '';

export function text(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });
}
export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
export const html = (body: string, status = 200): Response => new Response(body, { status, headers: { 'content-type': 'text/html' } });

/** a request that never completes but, like the real fetch, rejects once its signal is aborted */
export function hang(init?: RequestInit): Promise<never> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });
}
/** a request that never completes and ignores its signal altogether (a misbehaving fetch) */
export const neverSettles = (): Promise<never> => new Promise(() => {});

/** a body that delivers `chunks` chunks of `size` bytes and then never ends (and records whether it was cancelled) */
export function endlessBody(size: number, chunks: number, state: { cancelled: boolean; sent: number }): Response {
  let n = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (n++ < chunks) { state.sent += size; ctl.enqueue(new Uint8Array(size).fill(32)); return; }
      return new Promise(() => {});
    },
    cancel() { state.cancelled = true; }
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } });
}

export interface Call { url: string; init: RequestInit | undefined }
/** n is the 1-based number of this call */
export type Handler = (url: string, init: RequestInit | undefined, n: number) => Response | Promise<Response>;

/** a Handler as the `fetch` createApi takes */
export const asFetch = (h: Handler): FetchFn => async (url, init) => h(url, init, 0);

export function fakeClock(start = Date.UTC(2026, 8, 13, 0, 0, 0)) {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; }, advance: (ms: number) => { t += ms; } };
}
export type Clock = ReturnType<typeof fakeClock>;

/** Route by source: one handler per upstream, each given the number that was asked about. Anything not scripted is a
 *  404 with a body that is not "No GP data found", so an unexpected call shows up as a failure and in `calls`. */
export interface Script {
  gp?: (id: string, init: RequestInit | undefined, url: string) => Response | Promise<Response>;
  mirror?: (id: string, init: RequestInit | undefined, url: string) => Response | Promise<Response>;
  history?: (id: string, init: RequestInit | undefined, url: string) => Response | Promise<Response>;
}
export function scripted(s: Script): Handler {
  return (url, init) => {
    if (isGp(url) && s.gp) return s.gp(idOf(url), init, url);
    if (isMirror(url) && s.mirror) return s.mirror(idOf(url), init, url);
    if (isHistory(url) && s.history) return s.history(idOf(url), init, url);
    return text('scripted upstream: nothing for ' + url, 404);
  };
}

/** The environment most tests want: no rate limit (the limiter has its own tests), a known version. */
export const TEST_ENV: Env = { RATE_TLE_PER_MIN: '0', RATE_HISTORY_PER_MIN: '0', GT_VERSION: '9.9.9-test' };

export interface Reply { res: Response; status: number; body: any; headers: Headers }   // eslint-disable-line @typescript-eslint/no-explicit-any

export function makeApp(handler: Handler, env: Env = {}, clock: Clock = fakeClock()) {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  const app = createApi({ ...TEST_ENV, ...env }, { fetch, now: clock.now });
  const request = async (path: string, init?: RequestInit): Promise<Reply> => {
    const res = await app.handle(new Request('http://localhost' + path, init));
    const raw = await res.text();
    let body: unknown;
    try { body = raw === '' ? undefined : JSON.parse(raw); } catch { body = raw; }
    return { res, status: res.status, body, headers: res.headers };
  };
  return { app, calls, clock, get: (path: string, init?: RequestInit) => request(path, init), request };
}

/** the calls that went to one kind of upstream */
export const callsTo = (calls: Call[], kind: 'gp' | 'mirror' | 'history'): Call[] =>
  calls.filter(c => (kind === 'gp' ? isGp(c.url) : kind === 'mirror' ? isMirror(c.url) : isHistory(c.url)));

/** Wrap a handler so that a redirect behaves as the real fetch does: with `redirect: 'error'` it is a network error;
 *  with `'follow'` the Location is requested too (through the same handler; `onFollow` hears about it). */
export function withRedirects(inner: Handler, onFollow: (url: string) => void = () => {}): Handler {
  return async (url, init, n) => {
    const r = await inner(url, init, n);
    if (r.status < 300 || r.status > 399) return r;
    const location = r.headers.get('location');
    if (init?.redirect === 'error') throw new TypeError('fetch failed: unexpected redirect');
    if (init?.redirect === 'manual' || !location) return r;
    onFollow(location);
    return inner(location, init, n);
  };
}
