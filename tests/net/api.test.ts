import { describe, expect, it } from 'vitest';
import {
  API_TIMEOUT_HISTORY_MS, API_TIMEOUT_TLE_MS, createApiClient, isHistoryAnswer, isTleAnswer, resolveApiBase, tripsBreaker, type ApiDown
} from '../../src/lib/net/api';
import { BREAKER_MS, createBreaker } from '../../src/lib/net/breaker';
import { withDeadline } from '../../src/lib/net/deadline';
import { celestrakText, falling, makeTle, plotPage } from '../server/helpers/tle.js';
import { fakeClock, hang, html, neverSettles, text } from '../server/helpers/harness.js';
import { API_BASE, realApi, sleep } from './helpers';

const T0 = Date.UTC(2026, 8, 13);
const HOUR = 3_600_000;
const apiJson = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-gt-api': '1', ...extra } });
const okTle = (over: object = {}) => ({ status: 'ok', norad: '25544', l1: makeTle(25544, T0).l1, l2: makeTle(25544, T0).l2, src: 'CelesTrak', at: T0, epoch: T0, ...over });

describe('resolveApiBase', () => {
  it('is the page\'s own origin by default', () => {
    expect(resolveApiBase({ origin: 'https://sattrackslop.example' })).toBe('https://sattrackslop.example');
    expect(resolveApiBase({ origin: 'http://127.0.0.1:5173' })).toBe('http://127.0.0.1:5173');
  });

  it('is VITE_API_BASE when one is given, without a trailing slash', () => {
    expect(resolveApiBase({ VITE_API_BASE: 'https://api.example/', origin: 'https://page.example' })).toBe('https://api.example');
    expect(resolveApiBase({ VITE_API_BASE: '  https://api.example  ', origin: '' })).toBe('https://api.example');
  });

  it('is nothing at all when VITE_API=off, whatever else is set', () => {
    for (const off of ['off', 'OFF', ' Off ']) {
      expect(resolveApiBase({ VITE_API: off, VITE_API_BASE: 'https://api.example', origin: 'https://page.example' }), off).toBeNull();
    }
    expect(resolveApiBase({ VITE_API: 'on', origin: 'https://page.example' })).toBe('https://page.example');
  });

  it('is nothing when there is no http(s) origin to ask: file://, "null", empty', () => {
    for (const origin of ['null', 'file://', '', undefined, 'about:blank']) expect(resolveApiBase({ origin }), String(origin)).toBeNull();
    expect(resolveApiBase({})).toBeNull();
  });
});

describe('the reply guards', () => {
  const ok = okTle();
  it('isTleAnswer accepts the two shapes the API sends, and nothing that is a little off', () => {
    expect(isTleAnswer(ok)).toBe(true);
    expect(isTleAnswer({ status: 'gone', norad: '1', src: 'CelesTrak', at: T0 })).toBe(true);
    for (const bad of [null, undefined, 5, 'ok', [], {}, { status: 'ok' }, { ...ok, l1: 5 }, { ...ok, at: '1' }, { ...ok, epoch: NaN }, { ...ok, at: Infinity },
      { ...ok, status: 'stale' }, { status: 'gone', norad: '1', at: T0 }, { status: 'gone', norad: 1, src: 'x', at: T0 }]) {
      expect(isTleAnswer(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('isHistoryAnswer accepts a run and a "none", row by row', () => {
    const row = { t: T0, sma: 400, ecc: 0.001 };
    expect(isHistoryAnswer({ status: 'ok', norad: '1', P: [row, { ...row, ecc: null }], rows: 2, src: 'CelesTrak', at: T0 })).toBe(true);
    expect(isHistoryAnswer({ status: 'none', norad: '1', why: 'empty', rows: 0, src: 'CelesTrak', at: T0 })).toBe(true);
    expect(isHistoryAnswer({ status: 'none', norad: '1', why: 'outside', rows: 3, src: 'CelesTrak', at: T0 })).toBe(true);
    for (const bad of [{}, { status: 'ok', norad: '1', P: 'rows', rows: 1, src: 'x', at: T0 },
      { status: 'ok', norad: '1', P: [{ t: T0, sma: 400 }], rows: 1, src: 'x', at: T0 },
      { status: 'ok', norad: '1', P: [{ t: T0, sma: '400', ecc: 0 }], rows: 1, src: 'x', at: T0 },
      { status: 'ok', norad: '1', P: [{ t: T0, sma: 400, ecc: NaN }], rows: 1, src: 'x', at: T0 },
      { status: 'none', norad: '1', why: 'nope', rows: 0, src: 'x', at: T0 }, { status: 'none', norad: '1', rows: 0, src: 'x', at: T0 }]) {
      expect(isHistoryAnswer(bad), JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
  });
});

describe('createApiClient - did I just talk to MY API?', () => {
  const client = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>, over: { tle?: number; history?: number } = {}) => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const c = createApiClient({ base: API_BASE, fetch: async (url, init) => { calls.push({ url, init }); return handler(url, init); }, timeoutMs: over });
    return { c, calls };
  };

  it('an answer is the data, typed: ok and gone for an element set', async () => {
    const a = client(() => apiJson(okTle()));
    const r = await a.c.tle('25544');
    expect(r).toEqual({ kind: 'ok', data: okTle() });
    const g = await client(() => apiJson({ status: 'gone', norad: '25544', src: 'CelesTrak', at: T0 })).c.tle('25544');
    expect(g).toEqual({ kind: 'ok', data: { status: 'gone', norad: '25544', src: 'CelesTrak', at: T0 } });
  });

  it('asks as a simple GET: the right URL, no body, no headers that would make a cross-origin page send a preflight', async () => {
    const { c, calls } = client(() => apiJson(okTle()));
    await c.tle('25544');
    await c.history('25544');
    expect(calls.map(x => x.url)).toEqual([API_BASE + '/api/tle/25544', API_BASE + '/api/history/25544']);
    for (const call of calls) {
      expect(call.init!.method).toBe('GET');
      expect(call.init!.body).toBeUndefined();
      expect(Object.keys(call.init!.headers as object).filter(h => h !== 'accept')).toEqual([]);
      expect(call.init!.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('does not turn a string that looks like a date into a Date', async () => {
    const { c } = client(() => apiJson(okTle({ src: '2026-09-12T04:59:21.000Z' })));
    const r = await c.tle('25544');
    expect(r.kind === 'ok' && r.data.src).toBe('2026-09-12T04:59:21.000Z');
    expect(r.kind === 'ok' && typeof r.data.src).toBe('string');
  });

  it('network: the request failed, whatever the cause (offline, refused, blocked, a CORS failure)', async () => {
    const { c } = client(() => { throw new TypeError('Failed to fetch'); });
    expect(await c.tle('25544')).toEqual({ kind: 'down', why: 'network' });
    expect(await c.history('25544')).toEqual({ kind: 'down', why: 'network' });
  });

  it('timeout: no reply inside the deadline - also from a fetch that ignores its signal', async () => {
    const a = client((_u, init) => hang(init), { tle: 30, history: 30 });
    expect(await a.c.tle('25544')).toEqual({ kind: 'down', why: 'timeout' });
    expect(await a.c.history('25544')).toEqual({ kind: 'down', why: 'timeout' });
    expect(a.calls[0]!.init!.signal!.aborted).toBe(true);
    const b = client(() => neverSettles(), { tle: 30 });
    expect(await b.c.tle('25544')).toEqual({ kind: 'down', why: 'timeout' });
  });

  it('has the deadlines of the plan: 20 s for an element set (two 8 s sources), 85 s for a history (the server gives up at 70)', () => {
    expect(API_TIMEOUT_TLE_MS).toBe(20_000);
    expect(API_TIMEOUT_HISTORY_MS).toBe(85_000);
  });

  it('not_ours: a reply without the x-gt-api header is not the API, whatever it says - a 404 page, the app shell, a proxy error, or perfect JSON', async () => {
    const replies = [text('Not Found', 404), html('<!doctype html><title>app</title>'), html('<h1>502</h1>', 502), text('Internal Server Error', 500),
      new Response(JSON.stringify(okTle()), { headers: { 'content-type': 'application/json' } })];
    for (const r of replies) {
      const got = await client(() => r.clone()).c.tle('25544');
      expect(got.kind).toBe('down');
      expect((got as ApiDown).why).toBe('not_ours');
    }
    expect(await client(() => text('Not Found', 404)).c.tle('25544')).toEqual({ kind: 'down', why: 'not_ours', status: 404 });
  });

  it('not_json: the header on a body that is not JSON, or that is JSON of the wrong kind of thing', async () => {
    const broken = new Response('<<<', { headers: { 'content-type': 'application/json', 'x-gt-api': '1' } });
    expect(await client(() => broken.clone()).c.tle('25544')).toEqual({ kind: 'down', why: 'not_json' });
    const plain = text('hello', 200, { 'x-gt-api': '1' });
    expect(await client(() => plain.clone()).c.tle('25544')).toMatchObject({ kind: 'down', why: 'not_json' });
    expect(await client(() => apiJson({ message: 'no code' }, 500)).c.tle('25544')).toMatchObject({ kind: 'down', why: 'not_json', status: 500 });
  });

  it('shape: JSON with the header that is not what the schema promises', async () => {
    expect(await client(() => apiJson({ status: 'ok', norad: '25544' })).c.tle('25544')).toEqual({ kind: 'down', why: 'shape', status: 200 });
    expect(await client(() => apiJson(okTle())).c.history('25544')).toEqual({ kind: 'down', why: 'shape', status: 200 });
  });

  it('api_error: the API itself said no, with its code and what it tried', async () => {
    const tried = [{ src: 'CelesTrak', outcome: 'http', status: 503 }, { src: 'TLE API', outcome: 'unreachable' }];
    expect(await client(() => apiJson({ error: 'upstream_unavailable', tried }, 502)).c.tle('25544'))
      .toEqual({ kind: 'down', why: 'api_error', status: 502, error: 'upstream_unavailable', tried });
    expect(await client(() => apiJson({ error: 'upstream_timeout' }, 504)).c.history('25544'))
      .toEqual({ kind: 'down', why: 'api_error', status: 504, error: 'upstream_timeout' });
    expect(await client(() => apiJson({ error: 'rate_limited' }, 429, { 'retry-after': '40' })).c.tle('25544'))
      .toEqual({ kind: 'down', why: 'api_error', status: 429, error: 'rate_limited' });
    // an entry in `tried` that is not what the schema promises is dropped, not trusted
    const dirty = await client(() => apiJson({ error: 'upstream_unavailable', tried: [{ src: 'x', outcome: 'exploded' }, ...tried] }, 502)).c.tle('25544');
    expect((dirty as ApiDown).tried).toEqual(tried);
  });

  it('talks to the real server in process, typed all the way: an element set, a history, and a refusal', async () => {
    const clock = fakeClock(T0);
    const real = realApi({
      gp: id => id === '99999' ? text('No GP data found', 404) : text(celestrakText('X', makeTle(id, T0 - HOUR))),
      history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359)))
    }, {}, clock);
    const c = createApiClient({ base: API_BASE, fetch: async (url, init) => real.handler(url, init) });
    const tle = await c.tle('25544');
    expect(tle.kind === 'ok' && tle.data.status === 'ok' && tle.data.l1.startsWith('1 25544U')).toBe(true);
    const gone = await c.tle('99999');
    expect(gone.kind === 'ok' && gone.data.status).toBe('gone');
    const hist = await c.history('25544');
    expect(hist.kind === 'ok' && hist.data.status === 'ok' && hist.data.P.length).toBe(221);
    const bad = await c.tle('abc');
    expect(bad).toEqual({ kind: 'down', why: 'api_error', status: 400, error: 'bad_norad' });
  });

  it('uses the global fetch, looked up at call time, when none is given', async () => {
    const real = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => { seen.push(String(url)); return apiJson(okTle()); }) as typeof fetch;
    try {
      const r = await createApiClient({ base: API_BASE }).tle('25544');
      expect(r.kind).toBe('ok');
      expect(seen).toEqual([API_BASE + '/api/tle/25544']);
    } finally { globalThis.fetch = real; }
  });

  it('a base with a trailing slash or no scheme still reaches /api/..', async () => {
    const urls: string[] = [];
    const c = createApiClient({ base: 'http://localhost/', fetch: async url => { urls.push(url); return apiJson(okTle()); } });
    await c.tle('1');
    expect(urls).toEqual(['http://localhost/api/tle/1']);
  });
});

describe('tripsBreaker - what is a reason to stop asking', () => {
  const down = (why: ApiDown['why'], error?: string): ApiDown => ({ kind: 'down', why, ...(error ? { error } : {}) });

  it('every failure to be the API is; the API reporting upstream trouble or a bad number is not', () => {
    for (const why of ['network', 'timeout', 'not_ours', 'not_json', 'shape'] as const) expect(tripsBreaker(down(why)), why).toBe(true);
    for (const e of ['rate_limited', 'internal', 'not_found', 'method_not_allowed']) expect(tripsBreaker(down('api_error', e)), e).toBe(true);
    for (const e of ['upstream_unavailable', 'upstream_timeout', 'bad_norad']) expect(tripsBreaker(down('api_error', e)), e).toBe(false);
  });
});

describe('createBreaker', () => {
  it('is closed until tripped, open for ten minutes, and closed again at the instant they are up', () => {
    const clock = fakeClock(T0);
    const b = createBreaker(clock.now);
    expect(b.isOpen()).toBe(false);
    b.trip();
    expect(b.isOpen()).toBe(true);
    clock.advance(BREAKER_MS - 1);
    expect(b.isOpen()).toBe(true);
    clock.advance(1);
    expect(b.isOpen()).toBe(false);
    expect(BREAKER_MS).toBe(600_000);
  });

  it('a second trip restarts the ten minutes, and reset() closes it at once', () => {
    const clock = fakeClock(T0);
    const b = createBreaker(clock.now);
    b.trip();
    clock.advance(BREAKER_MS - 1000);
    b.trip();
    clock.advance(BREAKER_MS - 1);
    expect(b.isOpen()).toBe(true);
    b.reset();
    expect(b.isOpen()).toBe(false);
  });

  it('takes its length as an argument', () => {
    const clock = fakeClock(T0);
    const b = createBreaker(clock.now, 1000);
    b.trip();
    clock.advance(999);
    expect(b.isOpen()).toBe(true);
    clock.advance(1);
    expect(b.isOpen()).toBe(false);
  });
});

describe('withDeadline', () => {
  it('is the value when the work finishes in time', async () => {
    expect(await withDeadline(1000, async () => 7)).toEqual({ ok: true, value: 7 });
  });

  it('is a timeout when it does not, and aborts the signal it handed out - even when the work ignores it', async () => {
    let signal!: AbortSignal;
    const r = await withDeadline(20, async s => { signal = s; return new Promise<number>(() => {}); });
    expect(r).toEqual({ ok: false, timedOut: true });
    expect(signal.aborted).toBe(true);
  });

  it('is a failure, not a throw, when the work throws - also a synchronous throw', async () => {
    expect(await withDeadline(1000, async () => { throw new Error('x'); })).toEqual({ ok: false, timedOut: false });
    expect(await withDeadline(1000, (() => { throw new Error('sync'); }) as never)).toEqual({ ok: false, timedOut: false });
  });

  it('leaves no timer behind and no unhandled rejection when the deadline wins and the work fails later', async () => {
    const r = await withDeadline(10, (s) => new Promise<number>((_, rej) => s.addEventListener('abort', () => rej(new Error('late')))));
    expect(r).toEqual({ ok: false, timedOut: true });
    await sleep(20);                                                     // an unhandled rejection would fail the run
  });
});
