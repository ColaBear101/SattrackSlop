import { describe, expect, it } from 'vitest';
import { parsePlot, readPlot } from '../../shared/plot.js';
import { CELESTRAK_HISTORY, MIRROR, callsTo, endlessBody, fakeClock, hang, html, makeApp, neverSettles, scripted, text } from './helpers/harness.js';
import type { Clock } from './helpers/harness.js';
import { EMPTY_PLOT, falling, plotPage } from './helpers/tle.js';
import type { PlotRowSpec } from './helpers/tle.js';

const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);
const HOUR = 3_600_000;
const HISTORY_TTL = 12 * HOUR;
const DAY = 86_400_000;
const histUrl = (id: string) => CELESTRAK_HISTORY + '?CATNR=' + id;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** the page, as the wire form of what readPlot reads from it: NaN becomes null */
const wire = (page: string) => (parsePlot(page) ?? []).map(r => ({ t: r.t, sma: r.sma, ecc: Number.isFinite(r.ecc) ? r.ecc : null }));

describe('GET /api/history/:norad - a history', () => {
  const page = (clock: Clock) => plotPage(falling(clock.now(), 0.0008, 2, 420, 359));

  it('asks CelesTrak\'s graph-orbit-data page and answers with the run of element sets and how many rows there were', async () => {
    const clock = fakeClock(T0);
    const p = page(clock);
    const { get, calls } = makeApp(scripted({ history: () => html(p) }), {}, clock);
    const r = await get('/api/history/25544');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok', norad: '25544', P: wire(p), rows: 221, src: 'CelesTrak', at: T0 });
    expect(r.body.P).toHaveLength(221);
    expect(calls.map(c => c.url)).toEqual([histUrl('25544')]);
  });

  it('is what the page\'s own parser reads: row for row the same as shared/plot.ts\'s readPlot, with NaN as null', async () => {
    const clock = fakeClock(T0);
    const rows: PlotRowSpec[] = [
      ...falling(clock.now(), null, 2, 420, 359).slice(0, 5),                       // no eccentricity at all
      { t: clock.now() - DAY, sma: 40, ecc: 0.1 },                                  // outside the bounds
      { t: clock.now() - 5 * DAY, sma: 500, ecc: 0.0123 }                           // out of order
    ];
    const p = plotPage(rows);
    const { get } = makeApp(scripted({ history: () => html(p) }), {}, clock);
    const r = await get('/api/history/25544');
    expect(r.body.P).toEqual(wire(p));
    expect(r.body.rows).toBe(readPlot(p).rows);
    expect(r.body.rows).toBe(7);                                                    // counted before the bounds
    expect(r.body.P).toHaveLength(6);
    expect(r.body.P.map((x: { ecc: number | null }) => x.ecc)).toEqual([null, null, null, null, null, 0.0123]);   // the 500 km row is the latest in time
    expect(r.body.P.map((x: { t: number }) => x.t)).toEqual([...r.body.P.map((x: { t: number }) => x.t)].sort((a, b) => a - b));
  });

  it('sends an eccentricity that is not a number as null, whatever made it one (blank, text, Infinity)', async () => {
    const clock = fakeClock(T0);
    const p = 'var plotData = "H|2026-09-01T00:00:00,0,0,0,400,|2026-09-02T00:00:00,0,0,0,401,abc|2026-09-03T00:00:00,0,0,0,402,Infinity|2026-09-04T00:00:00,0,0,0,403,0.5"';
    const { get } = makeApp(scripted({ history: () => html(p) }), {}, clock);
    const r = await get('/api/history/25544');
    expect(r.body.P.map((x: { ecc: number | null }) => x.ecc)).toEqual([null, null, null, 0.5]);
  });

  it('returns the whole series, never thinned: 3,700 element sets are 3,700 rows', async () => {
    const clock = fakeClock(T0);
    const rows = Array.from({ length: 3700 }, (_, i): PlotRowSpec => ({ t: T0 - (3700 - i) * HOUR, sma: 420 - i * 0.01, ecc: 0.0008 }));
    const { get } = makeApp(scripted({ history: () => html(plotPage(rows)) }), {}, clock);
    const r = await get('/api/history/25544');
    expect(r.body.P).toHaveLength(3700);
    expect(r.body.rows).toBe(3700);
  });

  it('carries the headers of a long-lived answer: 12 hours for a CDN, and a miss the first time', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(scripted({ history: () => html(page(clock)) }), {}, clock);
    const r = await get('/api/history/25544');
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=43200, stale-while-revalidate=86400');
    expect(r.headers.get('x-gt-cache')).toBe('miss');
    expect(r.headers.get('x-gt-api')).toBe('1');
  });

  it('asks as itself: the identifying User-Agent, text/html, no redirects, and only the number in the URL', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ history: () => html(page(clock)) }), { GT_VERSION: '7.7.7' }, clock);
    await get('/api/history/01804');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(histUrl('1804'));                              // the numeric value, not "01804"
    const init = calls[0]!.init!;
    expect(init.redirect).toBe('error');
    expect(init.method).toBe('GET');
    expect(init.headers as Record<string, string>).toEqual({ 'user-agent': 'sattrackslop-api/7.7.7 (+https://github.com/ColaBear101/SattrackSlop)', accept: 'text/html' });
  });

  it('never asks the mirror: it has no history', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ history: () => html('<html>nothing</html>'), mirror: () => text('x') }), {}, clock);
    await get('/api/history/25544');
    expect(callsTo(calls, 'mirror')).toHaveLength(0);
    expect(calls.every(c => !c.url.startsWith(MIRROR))).toBe(true);
  });
});

describe('GET /api/history/:norad - each way of having no history, told apart (the names the decay page uses)', () => {
  const run = async (handler: ReturnType<typeof scripted>, env = {}) => {
    const clock = fakeClock(T0);
    const app = makeApp(handler, env, clock);
    return { ...app, r: await app.get('/api/history/25544') };
  };

  it('http: an error status from CelesTrak is a 502 carrying that status', async () => {
    for (const status of [503, 404, 500, 403]) {
      const { r } = await run(scripted({ history: () => text('busy', status) }));
      expect(r.status, String(status)).toBe(502);
      expect(r.body, String(status)).toEqual({ error: 'upstream_unavailable', tried: [{ src: 'CelesTrak', outcome: 'http', status }] });
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('unreachable: the request itself failing (offline, refused, a redirect) is a 502', async () => {
    const { r } = await run(scripted({ history: () => { throw new TypeError('Failed to fetch'); } }));
    expect(r.status).toBe(502);
    expect(r.body.tried).toEqual([{ src: 'CelesTrak', outcome: 'unreachable' }]);
  });

  it('timeout: no answer inside the deadline is a 504 {upstream_timeout}', async () => {
    const { r, calls } = await run(scripted({ history: (_i, init) => hang(init) }), { HISTORY_TIMEOUT_MS: '30' });
    expect(r.status).toBe(504);
    expect(r.body).toEqual({ error: 'upstream_timeout' });
    expect(calls[0]!.init!.signal!.aborted).toBe(true);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('timeout also when the fetch ignores its AbortSignal', async () => {
    const { r } = await run(scripted({ history: () => neverSettles() }), { HISTORY_TIMEOUT_MS: '30' });
    expect(r.status).toBe(504);
  });

  it('unreadable: an answer with no plotData in it (a maintenance page) is a 502, not an answer', async () => {
    const { r } = await run(scripted({ history: () => html('<html>down for maintenance</html>') }));
    expect(r.status).toBe(502);
    expect(r.body.tried).toEqual([{ src: 'CelesTrak', outcome: 'unreadable' }]);
  });

  it('empty: a history with a header and no rows is an ANSWER - 200 {status:"none", why:"empty"}, which caches', async () => {
    const { r } = await run(scripted({ history: () => html(EMPTY_PLOT) }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'none', norad: '25544', why: 'empty', rows: 0, src: 'CelesTrak', at: T0 });
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=3600');
  });

  it('outside: rows that all fall outside the bounds are an answer too, and say how many there were', async () => {
    const rows: PlotRowSpec[] = [{ t: T0 - DAY, sma: 50, ecc: 0 }, { t: T0, sma: 40, ecc: 0 }];
    const { r } = await run(scripted({ history: () => html(plotPage(rows)) }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'none', norad: '25544', why: 'outside', rows: 2, src: 'CelesTrak', at: T0 });
  });

  it('all of them in one table: seven outcomes, seven different answers', async () => {
    const good = plotPage(falling(T0, 0.0008, 2, 420, 359));
    const rows: Array<[string, ReturnType<typeof scripted>, Record<string, string>]> = [
      ['ok', scripted({ history: () => html(good) }), {}],
      ['http', scripted({ history: () => text('busy', 503) }), {}],
      ['unreachable', scripted({ history: () => { throw new TypeError('x'); } }), {}],
      ['timeout', scripted({ history: (_i, init) => hang(init) }), { HISTORY_TIMEOUT_MS: '30' }],
      ['unreadable', scripted({ history: () => html('<html></html>') }), {}],
      ['empty', scripted({ history: () => html(EMPTY_PLOT) }), {}],
      ['outside', scripted({ history: () => html(plotPage([{ t: T0 - DAY, sma: 50, ecc: 0 }])) }), {}]
    ];
    const seen: Record<string, string> = {};
    for (const [name, h, env] of rows) {
      const { r } = await run(h, env);
      seen[name] = r.status === 200 ? (r.body.status === 'ok' ? 'ok' : r.body.why)
        : r.status === 504 ? 'timeout' : r.body.tried[0].outcome;
    }
    expect(seen).toEqual({ ok: 'ok', http: 'http', unreachable: 'unreachable', timeout: 'timeout', unreadable: 'unreadable', empty: 'empty', outside: 'outside' });
  });
});

describe('GET /api/history/:norad - how long, how big, how many', () => {
  it('keeps a history for 12 hours from the instant CelesTrak was ASKED', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ history: () => { clock.advance(30_000); return html(plotPage(falling(T0, 0.0008, 2, 420, 359))); } }), {}, clock);
    const a = await get('/api/history/25544');
    expect(a.body.at).toBe(T0);
    clock.set(T0 + HISTORY_TTL - 1);
    expect((await get('/api/history/25544')).headers.get('x-gt-cache')).toBe('hit');
    expect(calls).toHaveLength(1);
    clock.set(T0 + HISTORY_TTL);
    const c = await get('/api/history/25544');
    expect(c.headers.get('x-gt-cache')).toBe('miss');
    expect(calls).toHaveLength(2);
    expect(c.body.at).toBe(T0 + HISTORY_TTL);
  });

  it('keeps the histories apart from the element sets: a 3 h TTL does not apply to them', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359))) }), {}, clock);
    await get('/api/history/25544');
    clock.set(T0 + 11 * HOUR);
    await get('/api/history/25544');
    expect(calls).toHaveLength(1);
  });

  it('honours HISTORY_TTL_S', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359))) }), { HISTORY_TTL_S: '100' }, clock);
    await get('/api/history/25544');
    clock.advance(99_999);
    await get('/api/history/25544');
    expect(calls).toHaveLength(1);
    clock.advance(1);
    await get('/api/history/25544');
    expect(calls).toHaveLength(2);
  });

  it('caches the answers that are not histories ("none") like a history, and never a failure', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ history: () => html(EMPTY_PLOT) }), {}, clock);
    await get('/api/history/25544');
    expect((await get('/api/history/25544')).headers.get('x-gt-cache')).toBe('hit');
    expect(calls).toHaveLength(1);
    const f = makeApp(scripted({ history: () => text('busy', 503) }), {}, clock);
    await f.get('/api/history/25544'); await f.get('/api/history/25544');
    expect(f.calls).toHaveLength(2);
  });

  it('holds 48 histories and forgets the least recently used one after that', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359))) }), {}, clock);
    for (let id = 1; id <= 48; id++) await get('/api/history/' + id);
    await get('/api/history/1');
    expect(calls).toHaveLength(48);
    await get('/api/history/49');                                               // 2 is the oldest and goes
    expect(calls).toHaveLength(49);
    await get('/api/history/1');
    expect(calls).toHaveLength(49);
    await get('/api/history/2');
    expect(calls).toHaveLength(50);
  });

  it('gives a history its own, longer deadline: the TLE timeout does not cut it short', async () => {
    const clock = fakeClock(T0);
    const p = plotPage(falling(T0, 0.0008, 2, 420, 359));
    const { get } = makeApp(scripted({ history: async () => { await sleep(120); return html(p); } }), { TLE_TIMEOUT_MS: '30', HISTORY_TIMEOUT_MS: '2000' }, clock);
    const r = await get('/api/history/25544');
    expect(r.status).toBe(200);
  });

  it('puts the deadline over the body too: a page that never finishes arriving is a timeout', async () => {
    const state = { cancelled: false, sent: 0 };
    const { get } = makeApp(scripted({ history: () => endlessBody(1024, 3, state) }), { HISTORY_TIMEOUT_MS: '40' }, fakeClock(T0));
    const r = await get('/api/history/25544');
    expect(r.status).toBe(504);
  });

  describe('a page is capped at 2 MB, as a stream', () => {
    const cap = 2 * 1024 * 1024;
    const sized = (clock: Clock, size: number) => {
      const base = plotPage(falling(clock.now(), 0.0008, 2, 420, 359));
      return base + ' '.repeat(size - base.length);
    };

    it('takes a page of exactly 2 MiB and refuses one byte more', async () => {
      const clock = fakeClock(T0);
      const atCap = makeApp(scripted({ history: () => html(sized(clock, cap)) }), {}, clock);
      expect((await atCap.get('/api/history/25544')).status).toBe(200);
      const over = makeApp(scripted({ history: () => html(sized(clock, cap + 1)) }), {}, clock);
      const r = await over.get('/api/history/25544');
      expect(r.status).toBe(502);
      expect(r.body.tried).toEqual([{ src: 'CelesTrak', outcome: 'too_large' }]);
    });

    it('stops a stream that has no length at the cap and cancels it', async () => {
      const state = { cancelled: false, sent: 0 };
      const { get } = makeApp(scripted({ history: () => endlessBody(256 * 1024, 1000, state) }), {}, fakeClock(T0));
      const r = await get('/api/history/25544');
      expect(r.body.tried[0].outcome).toBe('too_large');
      expect(state.cancelled).toBe(true);
      expect(state.sent).toBeLessThanOrEqual(cap + 3 * 256 * 1024);
    });

    it('refuses a declared length over the cap without reading, and is not fooled by a declared length under it', async () => {
      const clock = fakeClock(T0);
      const declared = makeApp(scripted({ history: () => new Response(plotPage(falling(clock.now(), 0.0008, 2, 420, 359)), { headers: { 'content-length': String(cap * 2) } }) }), {}, clock);
      expect((await declared.get('/api/history/25544')).body.tried[0].outcome).toBe('too_large');
      const liar = makeApp(scripted({ history: () => new Response(sized(clock, cap + 10), { headers: { 'content-length': '50' } }) }), {}, clock);
      expect((await liar.get('/api/history/25544')).body.tried[0].outcome).toBe('too_large');
    });
  });
});

describe('GET /api/history/:norad - one request for everyone, one entry per object', () => {
  it('five concurrent requests make one upstream call, and the others are coalesced', async () => {
    const clock = fakeClock(T0);
    let release!: () => void;
    const opened = new Promise<void>(r => { release = r; });
    const { get, calls } = makeApp(scripted({ history: async () => { await opened; return html(plotPage(falling(T0, 0.0008, 2, 420, 359))); } }), {}, clock);
    const pending = Array.from({ length: 5 }, () => get('/api/history/25544'));
    await sleep(25);
    expect(calls).toHaveLength(1);
    release();
    const replies = await Promise.all(pending);
    expect(calls).toHaveLength(1);
    expect(replies.map(r => r.headers.get('x-gt-cache')).sort()).toEqual(['coalesced', 'coalesced', 'coalesced', 'coalesced', 'miss']);
    expect(replies.every(r => r.body.P.length === 221)).toBe(true);
  });

  it('the control: different objects are different flights', async () => {
    const clock = fakeClock(T0);
    let release!: () => void;
    const opened = new Promise<void>(r => { release = r; });
    const { get, calls } = makeApp(scripted({ history: async () => { await opened; return html(EMPTY_PLOT); } }), {}, clock);
    const pending = [1, 2, 3, 4, 5].map(i => get('/api/history/' + i));
    await sleep(25);
    expect(calls).toHaveLength(5);
    release();
    await Promise.all(pending);
  });

  it('shares one entry between spellings of one number: "01804" and "1804"', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359))) }), {}, clock);
    const a = await get('/api/history/01804');
    const b = await get('/api/history/1804');
    expect(a.body.norad).toBe('1804');
    expect(b.headers.get('x-gt-cache')).toBe('hit');
    expect(calls).toHaveLength(1);
  });

  it('is its own cache, not the element sets\': the same number asked of both makes two upstream calls', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({
      history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359))),
      gp: () => text('No GP data found', 404)
    }), {}, clock);
    await get('/api/history/25544');
    await get('/api/tle/25544');
    expect(calls.map(c => c.url.split('?')[0])).toEqual([CELESTRAK_HISTORY, 'https://celestrak.org/NORAD/elements/gp.php']);
  });
});
