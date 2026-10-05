import { describe, expect, it } from 'vitest';
import { DIRECT_HISTORY_TIMEOUT_MS, DIRECT_TIMEOUT_MS } from '../../src/lib/net/direct';
import { createHistorySource } from '../../src/lib/net/history-source';
import { BREAKER_MS } from '../../src/lib/net/breaker';
import { fetchLiveTle } from '../../src/lib/net/tle-source';
import { Lifetime } from '../../src/lib/planner/lifetime';
import { EMPTY_PLOT, celestrakText, falling, makeTle, plotPage } from '../server/helpers/tle.js';
import type { PlotRowSpec } from '../server/helpers/tle.js';
import { fakeClock, hang, html, scripted, text, type Script } from '../server/helpers/harness.js';
import { API_BASE, historyCtx, makeWorld, memoryStore, realApi, tleCtx } from './helpers';

const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);
const HOUR = 3_600_000;
const HIST_TTL = 12 * HOUR;
const DAY = 86_400_000;
const HIST = (id: string) => 'https://celestrak.org/NORAD/elements/graph-orbit-data.php?CATNR=' + id;
const good = (clock = fakeClock(T0), ecc: number | null = 0.0008) => plotPage(falling(clock.now(), ecc, 2, 420, 359));

const world = (clock = fakeClock(T0)) => ({ history: () => html(good(clock)) });

describe('the history source - the guards', () => {
  it('only a NORAD number is asked about, a custom orbit never is, and nothing is touched either way', async () => {
    for (const [n, custom] of [['O0001', false], ['123456', false], ['', false], [null, false], ['25544\n', false], ['25544', true]] as const) {
      const w = makeWorld({ upstream: world() });
      const src = createHistorySource(historyCtx(w, { isCustom: custom }));
      expect(await src.history(n), JSON.stringify([n, custom])).toBeNull();
      expect(src.cached(n)).toBeNull();
      expect(w.calls).toEqual([]);
      expect(w.store.reads).toEqual([]);
      expect(w.store.writes).toEqual([]);
    }
  });

  it('the control: with the guards off, the same source asks', async () => {
    const w = makeWorld({ upstream: world() });
    const out = await createHistorySource(historyCtx(w)).history('25544');
    expect(out).toMatchObject({ why: null });
    expect(w.calls.length).toBeGreaterThan(0);
  });
});

describe('the history source - the hist:<n> cache (12 hours)', () => {
  const stored = (at: number, n = 5) => JSON.stringify({ at, P: Array.from({ length: n }, (_, i) => ({ t: T0 - (n - i) * DAY, sma: 400 - i, ecc: 0.001 })) });

  it('answers from a copy under twelve hours old, asking nobody, with exactly the stored rows', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ store: memoryStore({ 'hist:25544': stored(T0 - HIST_TTL + 1) }), clock });
    const src = createHistorySource(historyCtx(w));
    const out = await src.history('25544');
    expect(out!.why).toBeNull();
    expect(out!.P).toHaveLength(5);
    expect(src.cached('25544')).toEqual(out!.P);
    expect(w.calls).toEqual([]);
  });

  it('is stale at exactly twelve hours (the original\'s <), and then asks', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ store: memoryStore({ 'hist:25544': stored(T0 - HIST_TTL) }), upstream: world(clock), clock });
    const src = createHistorySource(historyCtx(w));
    expect(src.cached('25544')).toBeNull();
    const out = await src.history('25544');
    expect(out!.P).toHaveLength(221);
    expect(w.calls.length).toBeGreaterThan(0);
  });

  it('ignores a copy with no rows, no `at`, or that is not JSON', async () => {
    for (const raw of [JSON.stringify({ at: T0, P: [] }), JSON.stringify({ P: [{ t: 1, sma: 400, ecc: 0 }] }), JSON.stringify({ at: T0 }), '{no', 'null', '']) {
      const w = makeWorld({ store: memoryStore({ 'hist:25544': raw }) });
      expect(createHistorySource(historyCtx(w)).cached('25544'), raw).toBeNull();
    }
  });

  it('hands back the stored rows untouched - a null eccentricity that went through JSON stays null, as it did', async () => {
    const raw = JSON.stringify({ at: T0, P: [{ t: T0 - DAY, sma: 400, ecc: null }] });
    const w = makeWorld({ store: memoryStore({ 'hist:25544': raw }) });
    expect(createHistorySource(historyCtx(w)).cached('25544')).toEqual([{ t: T0 - DAY, sma: 400, ecc: null }]);
  });

  it('is keyed on the number as given', async () => {
    const w = makeWorld({ upstream: world(), api: realApi(world()).handler });
    await createHistorySource(historyCtx(w)).history('01804');
    expect([...w.store.data.keys()]).toEqual(['hist:01804']);
  });

  it('works with no storage, and with storage that throws', async () => {
    for (const store of [null, memoryStore({}, { failReads: true }), memoryStore({}, { failWrites: true })]) {
      const w = makeWorld({ upstream: world() });
      const out = await createHistorySource(historyCtx(w, { storage: store })).history('25544');
      expect(out!.why).toBeNull();
    }
  });
});

describe('the history source - the API', () => {
  it('asks it first: a history from the real server comes back as the page\'s rows, kept for 12 hours', async () => {
    const clock = fakeClock(T0);
    const real = realApi(world(clock), {}, clock);
    const w = makeWorld({ api: real.handler, clock });
    const src = createHistorySource(historyCtx(w));
    const out = await src.history('25544');
    expect(out!.why).toBeNull();
    expect(out!.P).toHaveLength(221);
    expect(out!.P![0]).toEqual({ t: expect.any(Number), sma: expect.any(Number), ecc: 0.0008 });
    expect(w.apiCalls()).toEqual([API_BASE + '/api/history/25544']);
    expect(w.directCalls()).toEqual([]);
    expect(JSON.parse(w.store.data.get('hist:25544')!).at).toBe(T0);
    clock.set(T0 + HIST_TTL - 1);
    expect(await src.history('25544')).toMatchObject({ why: null });
    expect(w.apiCalls()).toHaveLength(1);                              // the stored copy answers
  });

  it('turns the wire\'s null eccentricity back into NaN, so a forecast is the one a fresh parse would give', async () => {
    const clock = fakeClock(T0);
    const real = realApi({ history: () => html(good(clock, null)) }, {}, clock);
    const w = makeWorld({ api: real.handler, clock });
    const out = await createHistorySource(historyCtx(w)).history('25544');
    expect(out!.P!.every(r => Number.isNaN(r.ecc))).toBe(true);
    // ...and what the page's own estimator makes of it is what it makes of the same page read directly
    const direct = await createHistorySource(historyCtx(makeWorld({ upstream: { history: () => html(good(clock, null)) }, clock }), { api: null })).history('25544');
    expect(Lifetime.predict(out!.P)).toEqual(Lifetime.predict(direct!.P));
  });

  it('thins what it stores past 700 rows (about 500 spread over the run, and the newest 250 whole), and returns the whole run', async () => {
    const clock = fakeClock(T0);
    const rows = Array.from({ length: 3700 }, (_, i): PlotRowSpec => ({ t: T0 - (3700 - i) * HOUR, sma: 420 - i * 0.01, ecc: 0.0008 }));
    const real = realApi({ history: () => html(plotPage(rows)) }, {}, clock);
    const w = makeWorld({ api: real.handler, clock });
    const out = await createHistorySource(historyCtx(w)).history('25544');
    expect(out!.P).toHaveLength(3700);
    const kept = JSON.parse(w.store.data.get('hist:25544')!).P as Array<{ t: number }>;
    const want = rows.filter((_, i) => i % Math.ceil(3700 / 500) === 0 || i >= 3700 - 250).map(r => r.t);
    expect(kept.map(r => r.t)).toEqual(want);
    expect(kept).toHaveLength(682);
    // a short history is kept whole
    const short = makeWorld({ api: realApi(world(clock), {}, clock).handler, clock });
    await createHistorySource(historyCtx(short)).history('25544');
    expect(JSON.parse(short.store.data.get('hist:25544')!).P).toHaveLength(221);
  });

  it('a history that arrived and is not usable is an answer: {P:null, why, rows}, not stored, not retried from the browser', async () => {
    const clock = fakeClock(T0);
    for (const [page, why, rows] of [[EMPTY_PLOT, 'empty', 0], [plotPage([{ t: T0 - DAY, sma: 50, ecc: 0 }, { t: T0, sma: 40, ecc: 0 }]), 'outside', 2]] as const) {
      const real = realApi({ history: () => html(page) }, {}, clock);
      const w = makeWorld({ api: real.handler, upstream: world(clock), clock });
      expect(await createHistorySource(historyCtx(w)).history('25544')).toEqual({ P: null, why, rows });
      expect(w.directCalls()).toEqual([]);
      expect(w.store.writes).toEqual([]);
    }
  });

  it('a 504 from the API is the answer "timeout": the same slow endpoint is not asked again from the browser', async () => {
    const clock = fakeClock(T0);
    const real = realApi({ history: (_i, init) => hang(init) }, { HISTORY_TIMEOUT_MS: '30' }, clock);
    const w = makeWorld({ api: real.handler, upstream: world(clock), clock });
    expect(await createHistorySource(historyCtx(w)).history('25544')).toEqual({ P: null, why: 'timeout' });
    expect(w.directCalls()).toEqual([]);
    expect(w.breaker.isOpen()).toBe(false);                            // the API was there and said so
  });

  it('a 502 from the API goes on to the direct fetch, which may be refused for another reason (CelesTrak may refuse the server\'s address, not the reader\'s)', async () => {
    const clock = fakeClock(T0);
    const real = realApi({ history: () => text('Forbidden', 403) }, {}, clock);
    const w = makeWorld({ api: real.handler, upstream: world(clock), clock });
    const out = await createHistorySource(historyCtx(w)).history('25544');
    expect(out).toMatchObject({ why: null });
    expect(w.apiCalls()).toHaveLength(1);
    expect(w.directCalls()).toEqual([HIST('25544')]);
    expect(w.breaker.isOpen()).toBe(false);
  });

  it('shares the circuit breaker with the element sets: an API found absent is left alone by both', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ upstream: { ...world(clock), gp: id => text(celestrakText('X', makeTle(id, T0 - HOUR))) }, clock });
    await fetchLiveTle('25544', tleCtx(w));                            // 404: absent, trips
    expect(w.apiCalls()).toHaveLength(1);
    await createHistorySource(historyCtx(w)).history('25544');
    expect(w.apiCalls(), 'the history did not probe').toHaveLength(1);
    clock.advance(BREAKER_MS);
    await createHistorySource(historyCtx(w)).history('25545');
    expect(w.apiCalls(), 'ten minutes on, it does').toHaveLength(2);
  });

  it('one request for concurrent callers, and a second pass is answered from the stored copy', async () => {
    const clock = fakeClock(T0);
    const real = realApi(world(clock), {}, clock);
    const w = makeWorld({ api: real.handler, clock });
    const src = createHistorySource(historyCtx(w));
    const outs = await Promise.all(Array.from({ length: 5 }, () => src.history('25544')));
    expect(w.apiCalls()).toHaveLength(1);
    expect(outs.every(o => o!.P === outs[0]!.P)).toBe(true);           // the very same result, not five copies
    await src.history('25544');
    expect(w.apiCalls()).toHaveLength(1);
  });

  it('keeps no flight after a failure: the next call tries again', async () => {
    const clock = fakeClock(T0);
    let up = false;
    const w = makeWorld({ upstream: { history: () => up ? html(good(clock)) : text('busy', 503) }, clock });
    const src = createHistorySource(historyCtx(w, { api: null }));
    expect(await src.history('25544')).toEqual({ P: null, why: 'http', status: 503 });
    up = true;
    expect(await src.history('25544')).toMatchObject({ why: null });
  });
});

describe('the direct fetch - legacy fetchHistory, moved', () => {
  it('asks CelesTrak\'s graph-orbit-data page at the page\'s own URL, once, and reads it with the shared parser', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ upstream: world(clock), clock });
    const out = await createHistorySource(historyCtx(w, { api: null })).history('25544');
    expect(w.calls.map(c => c.url)).toEqual([HIST('25544')]);
    expect(out!.P).toHaveLength(221);
    expect(w.calls[0]!.init!.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(w.store.data.get('hist:25544')!).at).toBe(T0);
  });

  it('has the timeouts the page has always had: 8 seconds a source for an element set, 75 seconds for a history', () => {
    expect(DIRECT_TIMEOUT_MS).toBe(8000);
    expect(DIRECT_HISTORY_TIMEOUT_MS).toBe(75_000);
  });

  it('stores nothing when there is nothing to store', async () => {
    for (const upstream of [{ history: () => text('busy', 503) }, { history: () => html('<html></html>') }, { history: () => html(EMPTY_PLOT) }] as Script[]) {
      const w = makeWorld({ upstream });
      await createHistorySource(historyCtx(w, { api: null })).history('25544');
      expect(w.store.writes).toEqual([]);
    }
  });
});

describe('every way of having no history, against the original', () => {
  /* Lifetime.history (legacy/earth/lifetime.js, moved to src/lib/planner/lifetime.ts) is the oracle: the page's decay
     section speaks in its answers. The same upstream behaviour is run through (a) the original, (b) the new direct
     path, (c) the new path with the real API server in front, and all three must say the same thing. */
  let serial = 0;
  const run = async (upstream: Script, serverEnv: Record<string, string> = {}) => {
    const satnum = String(60000 + serial++);                           // a fresh number each time: the original keeps module-level state
    const router = scripted(upstream);
    // (a) the original, with the page's globals replaced as verify-lifetime.js does
    const realFetch = globalThis.fetch, realST = globalThis.setTimeout;
    let legacy;
    globalThis.fetch = ((url: string, init?: RequestInit) => Promise.resolve(router(url, init, 0))) as typeof fetch;
    globalThis.setTimeout = ((fn: () => void) => realST(fn, 5)) as unknown as typeof setTimeout;
    try { legacy = await Lifetime.history(satnum); }
    finally { globalThis.fetch = realFetch; globalThis.setTimeout = realST; }
    // (b) direct only
    const b = makeWorld({ upstream, clock: fakeClock(T0) });
    const direct = await createHistorySource(historyCtx(b, { api: null, directTimeoutMs: 5 })).history(satnum);
    // (c) the API in front
    const clockC = fakeClock(T0);
    const real = realApi(upstream, serverEnv, clockC);
    const c = makeWorld({ api: real.handler, upstream, clock: clockC });
    const viaApi = await createHistorySource(historyCtx(c, { directTimeoutMs: 5 })).history(satnum);
    return { legacy, direct, viaApi, c };
  };

  const cases: Array<[string, Script, Record<string, string>, number]> = [
    // [what, what upstream does, server environment, direct requests the API path ends up making]
    ['a history', { history: () => html(good()) }, {}, 0],
    ['a history with no eccentricity at all', { history: () => html(good(fakeClock(T0), null)) }, {}, 0],
    ['http 503', { history: () => text('busy', 503) }, {}, 1],
    ['http 404', { history: () => text('nope', 404) }, {}, 1],
    ['unreachable', { history: () => { throw new TypeError('Failed to fetch'); } }, {}, 1],
    ['timeout', { history: (_i, init) => hang(init) }, { HISTORY_TIMEOUT_MS: '5' }, 0],
    ['unreadable', { history: () => html('<html>down for maintenance</html>') }, {}, 1],
    ['empty', { history: () => html(EMPTY_PLOT) }, {}, 0],
    ['outside', { history: () => html(plotPage([{ t: T0 - DAY, sma: 50, ecc: 0 }, { t: T0, sma: 40, ecc: 0 }])) }, {}, 0]
  ];

  for (const [label, upstream, env, directViaApi] of cases) {
    it(`${label}: the original, the direct path and the API path all answer alike`, async () => {
      const { legacy, direct, viaApi, c } = await run(upstream, env);
      expect(direct).toEqual(legacy);
      expect(viaApi).toEqual(legacy);
      expect(c.apiCalls()).toHaveLength(1);
      expect(c.directCalls()).toHaveLength(directViaApi);
    });
  }

  it('says seven different things for the seven ways (so "alike" above is not nine copies of one answer)', async () => {
    const seen = new Set<string>();
    for (const [, upstream, env] of cases.slice(1)) {
      const { viaApi } = await run(upstream, env);
      seen.add(viaApi!.why ?? 'ok');
    }
    expect(seen).toEqual(new Set(['ok', 'http', 'unreachable', 'timeout', 'unreadable', 'empty', 'outside']));
  });
});
