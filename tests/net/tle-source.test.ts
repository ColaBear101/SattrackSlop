import { describe, expect, it } from 'vitest';
import { tleEpochMs, tleOk } from '../../shared/tle.js';
import { fetchDirectTle } from '../../src/lib/net/direct';
import { fetchLiveTle } from '../../src/lib/net/tle-source';
import { BREAKER_MS } from '../../src/lib/net/breaker';
import { celestrakText, makeTle, mirrorJson } from '../server/helpers/tle.js';
import { fakeClock, hang, html, text } from '../server/helpers/harness.js';
import { API_BASE, makeWorld, memoryStore, realApi, spy, tleCtx, type ApiHandler } from './helpers';

const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);
const HOUR = 3_600_000;
const TTL = 3 * HOUR;
const GP = (id: string) => 'https://celestrak.org/NORAD/elements/gp.php?CATNR=' + id + '&FORMAT=tle';      // the page's own spelling
const MIRROR_URL = (id: string) => 'https://tle.ivanstanojevic.me/api/tle/' + id;
const apiJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-gt-api': '1' } });

/** a CelesTrak and a mirror that both know every object, with an element set `age` old */
const world = (clock = fakeClock(T0), age = HOUR) => ({
  gp: (id: string) => text(celestrakText('SAT', makeTle(id, clock.now() - age))),
  mirror: (id: string) => text(mirrorJson('SAT', makeTle(id, clock.now() - age), id))
});

describe('fetchLiveTle - the guards, in order, each a refusal to ask anyone anything', () => {
  const nothingHappened = (w: ReturnType<typeof makeWorld>) => {
    expect(w.calls, 'no request of any kind').toEqual([]);
    expect(w.store.reads, 'no storage read').toEqual([]);
    expect(w.store.writes, 'no storage write').toEqual([]);
    expect(w.store.removes, 'no storage removal').toEqual([]);
  };

  it('1. digits: anything that is not one to five digits is null, with nothing asked and nothing touched', async () => {
    for (const n of ['O0001', 'O1', '25544x', '123456', ' 25544', '', null, undefined, '25544\n', '2554 4', '../1', '25544&x=1', {}, -1]) {
      const w = makeWorld({ upstream: world() });
      expect(await fetchLiveTle(n, tleCtx(w)), JSON.stringify(n)).toBeNull();
      nothingHappened(w);
    }
  });

  it('2. a custom orbit is never fetched: no cache read, no API probe, no direct request, no key written', async () => {
    const w = makeWorld({ upstream: world() });
    expect(await fetchLiveTle('25544', tleCtx(w, { isCustom: true }))).toBeNull();
    nothingHappened(w);
  });

  it('3. ?tle=embedded is pinned: no cache read, no probe of the API, no request, even with a perfectly good API', async () => {
    const clock = fakeClock(T0);
    const real = realApi(world(clock), {}, clock);
    const w = makeWorld({ api: real.handler, upstream: world(clock), clock });
    expect(await fetchLiveTle('25544', tleCtx(w, { pinned: true }))).toBeNull();
    nothingHappened(w);
    expect(real.upstreamCalls).toEqual([]);
  });

  it('the control: the same context with the guards off does ask, so "nothing happened" above can mean something', async () => {
    const clock = fakeClock(T0);
    const real = realApi(world(clock), {}, clock);
    const w = makeWorld({ api: real.handler, upstream: world(clock), clock });
    expect(await fetchLiveTle('25544', tleCtx(w))).not.toBeNull();
    expect(w.calls.length).toBeGreaterThan(0);
    expect(w.store.reads.length).toBeGreaterThan(0);
    expect(w.store.writes.length).toBeGreaterThan(0);
  });

  it('reads the context in the order digits -> custom -> pinned -> cache -> API -> direct', async () => {
    const digits = spy(tleCtx(makeWorld({ upstream: world() })));
    await fetchLiveTle('nope', digits.ctx);
    expect(digits.reads).toEqual([]);                                   // not even the first flag was looked at

    const custom = spy(tleCtx(makeWorld({ upstream: world() }), { isCustom: true, pinned: true }));
    await fetchLiveTle('25544', custom.ctx);
    expect(custom.reads).toEqual(['isCustom']);                         // custom answers before pinned is read

    const pinned = spy(tleCtx(makeWorld({ upstream: world() }), { pinned: true }));
    await fetchLiveTle('25544', pinned.ctx);
    expect(pinned.reads).toEqual(['isCustom', 'pinned']);               // pinned answers before the cache is read

    const free = spy(tleCtx(makeWorld({ upstream: world() })));        // empty cache, no API (404): all the way down to direct
    await fetchLiveTle('25544', free.ctx);
    const first = (k: string) => free.reads.indexOf(k);
    expect(first('isCustom')).toBeGreaterThanOrEqual(0);
    expect(first('isCustom')).toBeLessThan(first('pinned'));
    expect(first('pinned')).toBeLessThan(first('storage'));
    expect(first('storage')).toBeLessThan(first('api'));
    expect(first('api')).toBeLessThan(first('fetch'));                  // `fetch` is what the direct path reads
  });

  it('a cache hit answers before the API is read, a fresh API answer before the direct fetch', async () => {
    const clock = fakeClock(T0);
    const t = makeTle(25544, T0 - HOUR);
    const store = memoryStore({ 'tle:25544': JSON.stringify({ ...t, src: 'CelesTrak', at: T0 - 60_000 }) });
    const hit = spy(tleCtx(makeWorld({ upstream: world(clock), store, clock })));
    expect(await fetchLiveTle('25544', hit.ctx)).not.toBeNull();
    expect(hit.reads).not.toContain('api');
    expect(hit.reads).not.toContain('fetch');
  });
});

describe('fetchLiveTle - the tle:<n> cache', () => {
  const rec = (clock = fakeClock(T0), id = 25544) => { const t = makeTle(id, clock.now() - HOUR); return { l1: t.l1, l2: t.l2, src: 'CelesTrak', at: clock.now() - 60_000 }; };

  it('answers from a record under three hours old, exactly as stored, asking nobody', async () => {
    const clock = fakeClock(T0);
    const stored = rec(clock);
    const w = makeWorld({ store: memoryStore({ 'tle:25544': JSON.stringify(stored) }), clock });
    expect(await fetchLiveTle('25544', tleCtx(w))).toEqual(stored);
    expect(w.calls).toEqual([]);
  });

  it('measures the three hours from `at`, and a record exactly three hours old is stale (the page\'s own <)', async () => {
    const clock = fakeClock(T0);
    const stored = { ...rec(clock), at: T0 - TTL + 1 };
    const w = makeWorld({ store: memoryStore({ 'tle:25544': JSON.stringify(stored) }), upstream: world(clock), clock });
    expect(await fetchLiveTle('25544', tleCtx(w))).toEqual(stored);
    expect(w.calls).toHaveLength(0);
    clock.advance(1);                                                    // now exactly three hours since `at`
    const got = await fetchLiveTle('25544', tleCtx(w));
    expect(got).not.toEqual(stored);
    expect(w.calls.length).toBeGreaterThan(0);
  });

  it('validates the stored copy again with tleOk and drops one that could never have arrived over the network', async () => {
    const clock = fakeClock(T0);
    const good = rec(clock);
    const poisoned: Record<string, unknown> = {
      'truncated line 1': { ...good, l1: good.l1.slice(0, 40) },
      'junk appended': { ...good, l2: good.l2 + ' <script>' },
      'lines of another object': { ...good, ...makeTle(25545, T0 - HOUR) },
      'not strings': { ...good, l1: 12345, l2: null },
      'a control character': { ...good, l1: good.l1.slice(0, 20) + '\x07' + good.l1.slice(21) }
    };
    for (const [what, bad] of Object.entries(poisoned)) {
      const store = memoryStore({ 'tle:25544': JSON.stringify(bad) });
      const w = makeWorld({ store, upstream: world(clock), clock });
      const got = await fetchLiveTle('25544', tleCtx(w));
      expect(store.removes, what).toEqual(['tle:25544']);
      expect(w.calls.length, what + ': asked instead of believing it').toBeGreaterThan(0);
      expect(got, what).not.toEqual(bad);                                // what comes back is the fetched record, not the poisoned one
      expect(tleOk(got as { l1: string; l2: string }, '25544'), what).toBe(true);
    }
    const store = memoryStore({ 'tle:25544': JSON.stringify(good) });
    await fetchLiveTle('25544', tleCtx(makeWorld({ store, clock })));
    expect(store.removes, 'control: a good record is left alone').toEqual([]);
  });

  it('ignores a record with no usable `at`, a record that is not JSON, and storage that says nothing', async () => {
    const clock = fakeClock(T0);
    for (const stored of [JSON.stringify({ ...rec(clock), at: 'yesterday' }), JSON.stringify({ l1: 'x' }), '{not json', 'null', '']) {
      const w = makeWorld({ store: memoryStore({ 'tle:25544': stored }), upstream: world(clock), clock });
      const got = await fetchLiveTle('25544', tleCtx(w));
      expect(got, stored).not.toBeNull();
      expect(w.calls.length, stored).toBeGreaterThan(0);
    }
  });

  it('keeps a stale record where it is until something replaces it (it only removes what is poisoned)', async () => {
    const clock = fakeClock(T0);
    const stale = { ...rec(clock), at: T0 - TTL - 1 };
    const store = memoryStore({ 'tle:25544': JSON.stringify(stale) });
    const w = makeWorld({ store, clock });                                // every source fails
    expect(await fetchLiveTle('25544', tleCtx(w))).toBeNull();
    expect(store.removes).toEqual([]);
    expect(JSON.parse(store.data.get('tle:25544')!)).toEqual(stale);
  });

  it('is keyed on the number as it was given: the catalogue\'s zero-padded "01804" is tle:01804', async () => {
    const clock = fakeClock(T0);
    const store = memoryStore();
    const w = makeWorld({ store, upstream: world(clock), clock, api: realApi(world(clock), {}, clock).handler });
    await fetchLiveTle('01804', tleCtx(w));
    expect([...store.data.keys()]).toEqual(['tle:01804']);
    const again = makeWorld({ store, clock });
    expect(await fetchLiveTle('01804', tleCtx(again))).not.toBeNull();   // served from tle:01804
    expect(again.calls).toEqual([]);
  });

  it('works with no storage at all, with storage that throws on read, and with storage that throws on write', async () => {
    const clock = fakeClock(T0);
    for (const [what, store] of [['null', null], ['read fails', memoryStore({}, { failReads: true })], ['write fails', memoryStore({}, { failWrites: true })]] as const) {
      const w = makeWorld({ upstream: world(clock), clock });
      const got = await fetchLiveTle('25544', tleCtx(w, { storage: store }));
      expect(got, what).toMatchObject({ src: 'CelesTrak' });
    }
  });
});

describe('fetchLiveTle - the API', () => {
  it('uses it first: one request, answered by the real server, mapped to the page\'s shapes, and kept in tle:<n>', async () => {
    const clock = fakeClock(T0);
    const real = realApi(world(clock), {}, clock);
    const w = makeWorld({ api: real.handler, clock });
    const got = await fetchLiveTle('25544', tleCtx(w));
    const t = makeTle(25544, T0 - HOUR);
    expect(got).toEqual({ l1: t.l1, l2: t.l2, src: 'CelesTrak', at: T0 });
    expect(w.apiCalls()).toEqual([API_BASE + '/api/tle/25544']);
    expect(w.directCalls()).toEqual([]);
    expect(real.upstreamCalls).toHaveLength(1);
    expect(JSON.parse(w.store.data.get('tle:25544')!)).toEqual(got);
  });

  it('asks for the numeric value: "01804" and "1804" are one URL (so one entry in any cache in between)', async () => {
    const clock = fakeClock(T0);
    const real = realApi(world(clock), {}, clock);
    const w = makeWorld({ api: real.handler, clock });
    const got = await fetchLiveTle('01804', tleCtx(w));
    expect(w.apiCalls()).toEqual([API_BASE + '/api/tle/1804']);
    expect(got).toMatchObject({ src: 'CelesTrak' });
    expect((got as { l1: string }).l1.substring(2, 7)).toBe('01804');
  });

  it('passes a mirror answer on with its own name', async () => {
    const clock = fakeClock(T0);
    const real = realApi({ gp: () => text('down', 503), mirror: id => text(mirrorJson('ISS', makeTle(id, T0 - HOUR), id)) }, {}, clock);
    const w = makeWorld({ api: real.handler, clock });
    expect(await fetchLiveTle('25544', tleCtx(w))).toMatchObject({ src: 'TLE API' });
  });

  it('a withdrawal is an answer: {src, gone:true, at}, not stored, and the sources are not asked behind its back', async () => {
    const clock = fakeClock(T0);
    const real = realApi({ gp: () => text('No GP data found', 404), mirror: () => text('should not be asked') }, {}, clock);
    const w = makeWorld({ api: real.handler, upstream: world(clock), clock });
    expect(await fetchLiveTle('25544', tleCtx(w))).toEqual({ src: 'CelesTrak', gone: true, at: T0 });
    expect(w.directCalls()).toEqual([]);
    expect(w.store.writes).toEqual([]);
  });

  it('does not let the server make an element set look younger than now: a clock ahead of ours is clamped', async () => {
    const serverClock = fakeClock(T0 + 10 * HOUR);
    const real = realApi({ gp: id => text(celestrakText('X', makeTle(id, T0 + 9 * HOUR))) }, {}, serverClock);
    const clientClock = fakeClock(T0);
    const w = makeWorld({ api: real.handler, clock: clientClock });
    const got = await fetchLiveTle('25544', tleCtx(w)) as { at: number };
    expect(got.at).toBe(T0);                                             // the server said T0 + 10 h
    expect(JSON.parse(w.store.data.get('tle:25544')!).at).toBe(T0);
  });

  it('keeps the server\'s fetch instant when it is in the past: an hour-old answer from its cache is an hour old here too', async () => {
    const clock = fakeClock(T0);
    const real = realApi(world(clock), {}, clock);
    await real.handler(API_BASE + '/api/tle/25544');                      // someone else's request warms the server
    clock.advance(HOUR);
    const w = makeWorld({ api: real.handler, clock });
    const got = await fetchLiveTle('25544', tleCtx(w)) as { at: number };
    expect(got.at).toBe(T0);
    expect(real.upstreamCalls).toHaveLength(1);
    // so the page's own cache honours the REAL age: it expires three hours after the fetch, not three hours after the pass-through
    clock.set(T0 + TTL - 1);
    expect(await fetchLiveTle('25544', tleCtx(w))).toMatchObject({ at: T0 });
    expect(w.apiCalls()).toHaveLength(1);
    clock.set(T0 + TTL);
    await fetchLiveTle('25544', tleCtx(w));
    expect(w.apiCalls()).toHaveLength(2);
  });

  it('does not believe a well-formed answer that is not an element set for this number (and goes to the sources)', async () => {
    const clock = fakeClock(T0);
    const other = makeTle(25545, T0 - HOUR);
    const liar: ApiHandler = () => apiJson({ status: 'ok', norad: '25544', l1: other.l1, l2: other.l2, src: 'CelesTrak', at: T0, epoch: tleEpochMs(other.l1) });
    const w = makeWorld({ api: liar, upstream: world(clock), clock });
    const got = await fetchLiveTle('25544', tleCtx(w)) as { l1: string };
    expect(got.l1.substring(2, 7)).toBe('25544');
    expect(w.directCalls()).toEqual([GP('25544')]);
    expect(JSON.parse(w.store.data.get('tle:25544')!).l1).toBe(got.l1);   // what was stored is the checked one
  });
});

describe('fetchLiveTle - when the API is not there, the page does what it always did', () => {
  const apiDown: Array<[string, ApiHandler]> = [
    ['a network error', () => { throw new TypeError('Failed to fetch'); }],
    ['a plain-text 404 (today\'s static deploy)', () => text('Not Found', 404)],
    ['the app shell answered with a 200', () => html('<!doctype html><title>Ground Track</title>')],
    ['a proxy\'s 502 page', () => html('<h1>502 Bad Gateway</h1>', 502)],
    ['a dev server with nothing behind its proxy (a 500)', () => text('Internal Server Error', 500)],
    ['the API header on a body that is not JSON', () => new Response('<<<', { headers: { 'content-type': 'application/json', 'x-gt-api': '1' } })],
    ['the API header on plain text', () => text('hello', 200, { 'x-gt-api': '1' })],
    ['JSON that is not what the schema promises', () => apiJson({ status: 'ok', norad: '25544' })],
    ['a structured error with the wrong shape', () => apiJson({ message: 'nope' }, 500)],
    ['a 429', () => apiJson({ error: 'rate_limited' }, 429)],
    ['a 502 from the API itself (the sources are down)', () => apiJson({ error: 'upstream_unavailable', tried: [{ src: 'CelesTrak', outcome: 'http', status: 503 }] }, 502)],
    ['a 504 from the API itself', () => apiJson({ error: 'upstream_timeout' }, 504)],
    ['a 500 from the API itself', () => apiJson({ error: 'internal' }, 500)]
  ];

  for (const [what, api] of apiDown) {
    it(`falls through to CelesTrak on ${what}`, async () => {
      const clock = fakeClock(T0);
      const w = makeWorld({ api, upstream: world(clock), clock });
      const got = await fetchLiveTle('25544', tleCtx(w));
      expect(got).toMatchObject({ src: 'CelesTrak' });
      expect(w.apiCalls()).toHaveLength(1);
      expect(w.directCalls()).toEqual([GP('25544')]);
    });
  }

  it('falls through when the API does not answer inside its deadline', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ api: (_u, init) => hang(init), upstream: world(clock), clock, apiTimeoutMs: { tle: 30 } });
    const got = await fetchLiveTle('25544', tleCtx(w));
    expect(got).toMatchObject({ src: 'CelesTrak' });
    expect(w.apiCalls()[0]).toBe(API_BASE + '/api/tle/25544');
  });

  it('is exactly what a page with no API at all does: the same result, request for request', async () => {
    const clock = fakeClock(T0);
    const none = makeWorld({ upstream: world(clock), clock });
    const a = await fetchLiveTle('25544', tleCtx(none, { api: null }));
    const down = makeWorld({ api: () => text('Not Found', 404), upstream: world(clock), clock });
    const b = await fetchLiveTle('25544', tleCtx(down));
    expect(b).toEqual(a);
    expect(down.directCalls()).toEqual(none.directCalls());
    expect(none.apiCalls()).toEqual([]);
  });

  it('a gone from CelesTrak is still a withdrawal through the fallback, and the mirror is still not asked', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ upstream: { gp: () => text('No GP data found', 404), mirror: () => text('nope') }, clock });
    expect(await fetchLiveTle('25544', tleCtx(w))).toEqual({ src: 'CelesTrak', gone: true, at: T0 });
    expect(w.directCalls()).toEqual([GP('25544')]);
    expect(w.store.writes).toEqual([]);
  });

  it('null when nothing answers at all, and nothing is stored', async () => {
    const w = makeWorld({ upstream: { gp: () => { throw new TypeError('x'); }, mirror: () => { throw new TypeError('x'); } } });
    expect(await fetchLiveTle('25544', tleCtx(w))).toBeNull();
    expect(w.store.writes).toEqual([]);
  });
});

describe('the circuit breaker - an absent API is not probed on every selection', () => {
  const absent: ApiHandler = () => text('Not Found', 404);

  it('leaves the API alone for ten minutes after it was found absent, then probes once more', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ api: absent, upstream: world(clock), clock });
    await fetchLiveTle('25544', tleCtx(w));
    expect(w.apiCalls()).toHaveLength(1);
    for (const id of ['25545', '25546', '25547', '25544']) {
      clock.advance(60_000);
      await fetchLiveTle(id, tleCtx(w));
    }
    expect(w.apiCalls(), 'four more selections in the next four minutes: no probe').toHaveLength(1);
    expect(w.directCalls().length, 'each one went direct, except the last, which the cache in storage answered').toBe(4);
    clock.set(T0 + BREAKER_MS - 1);
    await fetchLiveTle('30000', tleCtx(w));
    expect(w.apiCalls(), 'one millisecond short of ten minutes').toHaveLength(1);
    clock.set(T0 + BREAKER_MS);
    await fetchLiveTle('30001', tleCtx(w));
    expect(w.apiCalls(), 'ten minutes: probed again').toHaveLength(2);
  });

  it('a failed probe starts another ten minutes', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ api: absent, upstream: world(clock), clock });
    await fetchLiveTle('25544', tleCtx(w));
    clock.advance(BREAKER_MS);
    await fetchLiveTle('25545', tleCtx(w));
    expect(w.apiCalls()).toHaveLength(2);
    clock.advance(BREAKER_MS - 1);
    await fetchLiveTle('25546', tleCtx(w));
    expect(w.apiCalls()).toHaveLength(2);
  });

  it('keeps asking an API that is there: success does not trip it, and a probe that succeeds closes the matter', async () => {
    const clock = fakeClock(T0);
    let up = false;
    const real = realApi(world(clock), {}, clock);
    const w = makeWorld({ api: (u, i) => up ? real.handler(u, i) : absent(u, i), upstream: world(clock), clock });
    await fetchLiveTle('25544', tleCtx(w));                              // absent: trips
    up = true;
    await fetchLiveTle('25545', tleCtx(w));                              // still inside the ten minutes
    expect(w.apiCalls()).toHaveLength(1);
    clock.advance(BREAKER_MS);
    await fetchLiveTle('25549', tleCtx(w));                              // the probe finds it
    for (const id of ['25546', '25547', '25548']) await fetchLiveTle(id, tleCtx(w));
    expect(w.apiCalls()).toHaveLength(5);
  });

  const trips: Array<[string, ApiHandler]> = [
    ['not our header', () => text('Not Found', 404)],
    ['a network error', () => { throw new TypeError('x'); }],
    ['JSON that is the wrong shape', () => apiJson({ nonsense: true })],
    ['a rate limit', () => apiJson({ error: 'rate_limited' }, 429)],
    ['an internal error', () => apiJson({ error: 'internal' }, 500)],
    ['an unknown route (a client newer than the server)', () => apiJson({ error: 'not_found' }, 404)]
  ];
  for (const [what, api] of trips) {
    it(`trips on ${what}`, async () => {
      const clock = fakeClock(T0);
      const w = makeWorld({ api, upstream: world(clock), clock });
      await fetchLiveTle('25544', tleCtx(w));
      await fetchLiveTle('25545', tleCtx(w));
      expect(w.apiCalls()).toHaveLength(1);
    });
  }

  const stays: Array<[string, ApiHandler]> = [
    ['the API reporting that the sources are down (502)', () => apiJson({ error: 'upstream_unavailable', tried: [] }, 502)],
    ['the API reporting that the sources timed out (504)', () => apiJson({ error: 'upstream_timeout' }, 504)]
  ];
  for (const [what, api] of stays) {
    it(`does not trip on ${what}: the API is working, and the next object may be fine`, async () => {
      const clock = fakeClock(T0);
      const w = makeWorld({ api, upstream: world(clock), clock });
      await fetchLiveTle('25544', tleCtx(w));
      await fetchLiveTle('25545', tleCtx(w));
      expect(w.apiCalls()).toHaveLength(2);
    });
  }

  it('is not consulted, and not tripped, by a guard or a cache hit', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ api: absent, upstream: world(clock), clock });
    await fetchLiveTle('nope', tleCtx(w));
    await fetchLiveTle('25544', tleCtx(w, { isCustom: true }));
    await fetchLiveTle('25544', tleCtx(w, { pinned: true }));
    expect(w.breaker.isOpen()).toBe(false);
    await fetchLiveTle('25544', tleCtx(w));
    expect(w.breaker.isOpen()).toBe(true);
  });

  it('with no API configured, it is never created or asked', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ upstream: world(clock), clock });
    for (const id of ['25544', '25545']) await fetchLiveTle(id, tleCtx(w, { api: null }));
    expect(w.apiCalls()).toEqual([]);
  });
});

describe('the direct fetch - legacy fetchTLE, moved', () => {
  const ctx = (w: ReturnType<typeof makeWorld>, timeoutMs = 40) => ({ fetch: w.fetch, now: w.clock.now, timeoutMs });

  it('asks CelesTrak at the page\'s own URL, with the abort signal and without the HTTP cache, then the mirror', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ upstream: { gp: () => text('x', 503), mirror: id => text(mirrorJson('SAT', makeTle(id, T0 - HOUR), id)) }, clock });
    const got = await fetchDirectTle('25544', ctx(w));
    expect(w.calls.map(c => c.url)).toEqual([GP('25544'), MIRROR_URL('25544')]);
    expect(w.calls[0]!.init!.cache).toBe('no-store');
    expect(w.calls[0]!.init!.signal).toBeInstanceOf(AbortSignal);
    expect(got).toMatchObject({ src: 'TLE API', at: T0 });
  });

  it('puts the number in the URL as it was given, zero padding and all (the page\'s catalogue spelling)', async () => {
    const w = makeWorld({ upstream: world() });
    await fetchDirectTle('01804', ctx(w));
    expect(w.calls[0]!.url).toBe(GP('01804'));
  });

  it('does not ask the mirror once CelesTrak has answered', async () => {
    const w = makeWorld({ upstream: world() });
    await fetchDirectTle('25544', ctx(w));
    expect(w.calls).toHaveLength(1);
  });

  it('reads "No GP data found" before the status, as a withdrawal, and never asks the mirror', async () => {
    for (const reply of [text('No GP data found', 404), text('No GP data found', 200), html('<p>No GP data found</p>', 500)]) {
      const w = makeWorld({ upstream: { gp: () => reply.clone(), mirror: () => text('should not be asked') } });
      expect(await fetchDirectTle('25544', ctx(w))).toEqual({ src: 'CelesTrak', gone: true, at: w.clock.now() });
      expect(w.calls).toHaveLength(1);
    }
  });

  it('does not take a 200 HTML error page for an element set', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ upstream: { gp: () => html('<html>Error</html>'), mirror: id => text(mirrorJson('SAT', makeTle(id, T0 - HOUR), id)) }, clock });
    expect(await fetchDirectTle('25544', ctx(w))).toMatchObject({ src: 'TLE API' });
  });

  it('validates every answer with tleOk: the wrong number, a short line and junk after the line are all refused', async () => {
    const clock = fakeClock(T0);
    const t = makeTle(25544, T0 - HOUR), other = makeTle(25545, T0 - HOUR);
    const bad = [
      { l1: other.l1, l2: other.l2 }, { l1: t.l1.slice(0, 60), l2: t.l2 }, { l1: t.l1, l2: t.l2 + ' junk junk junk junk' }
    ];
    for (const lines of bad) {
      const w = makeWorld({ upstream: { gp: () => text('X\r\n' + lines.l1 + '\r\n' + lines.l2 + '\r\n'), mirror: () => text(mirrorJson('X', lines, 25544)) }, clock });
      expect(await fetchDirectTle('25544', ctx(w))).toBeNull();
      expect(w.calls).toHaveLength(2);
    }
  });

  it('gives up on a source after the timeout and tries the next; the signal is aborted', async () => {
    const clock = fakeClock(T0);
    const w = makeWorld({ upstream: { gp: (_i, init) => hang(init), mirror: id => text(mirrorJson('SAT', makeTle(id, T0 - HOUR), id)) }, clock });
    const got = await fetchDirectTle('25544', ctx(w, 30));
    expect(got).toMatchObject({ src: 'TLE API' });
    expect(w.calls[0]!.init!.signal!.aborted).toBe(true);
    const slow = makeWorld({ upstream: { gp: (_i, init) => hang(init), mirror: (_i, init) => hang(init) } });
    expect(await fetchDirectTle('25544', ctx(slow, 30))).toBeNull();
  });

  it('puts the timeout over the body as well: a stalled body no longer hangs the check for good', async () => {
    const w = makeWorld({ upstream: {
      gp: (_i, init) => {
        const body = new ReadableStream<Uint8Array>({ start(c) { init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); } });
        return new Response(body, { status: 200 });
      },
      mirror: id => text(mirrorJson('SAT', makeTle(id, T0 - HOUR), id))
    } });
    const got = await fetchDirectTle('25544', ctx(w, 30));
    expect(got).toMatchObject({ src: 'TLE API' });
  });

  it('is null when every source fails, and never throws', async () => {
    const w = makeWorld({ upstream: { gp: () => { throw new TypeError('CORS'); }, mirror: () => { throw new TypeError('offline'); } } });
    await expect(fetchDirectTle('25544', ctx(w))).resolves.toBeNull();
  });
});

describe('one request for all the visitors', () => {
  it('twenty pages that have never met cost CelesTrak exactly one request (each has its own storage and breaker)', async () => {
    const clock = fakeClock(T0);
    const real = realApi(world(clock), {}, clock);
    const worlds = Array.from({ length: 20 }, () => makeWorld({ api: real.handler, clock }));
    const results = await Promise.all(worlds.map(w => fetchLiveTle('25544', tleCtx(w))));
    expect(real.upstreamCalls).toHaveLength(1);
    expect(new Set(results.map(r => JSON.stringify(r))).size).toBe(1);
    expect(worlds.every(w => w.directCalls().length === 0)).toBe(true);
  });
});
