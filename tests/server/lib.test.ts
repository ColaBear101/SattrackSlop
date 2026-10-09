import { describe, expect, it } from 'vitest';
import { Flights, Lru, isFresh } from '../../server/lib/cache.js';
import { clientKey, createLimiter } from '../../server/lib/limit.js';
import { corsHeaders, preflightHeaders } from '../../server/lib/cors.js';
import { failureStatus } from '../../server/lib/errors.js';
import { fakeClock } from './helpers/harness.js';

describe('Lru', () => {
  it('forgets the least recently used key once it holds more than its size', () => {
    const l = new Lru<number>(3);
    l.set('a', 1); l.set('b', 2); l.set('c', 3);
    l.set('d', 4);
    expect(l.get('a')).toBeUndefined();
    expect([l.get('b'), l.get('c'), l.get('d')]).toEqual([2, 3, 4]);
    expect(l.size).toBe(3);
  });

  it('counts a read as a use: the key read last is the one that survives', () => {
    const l = new Lru<number>(3);
    l.set('a', 1); l.set('b', 2); l.set('c', 3);
    expect(l.get('a')).toBe(1);                    // a is now the freshest; b the oldest
    l.set('d', 4);
    expect(l.get('b')).toBeUndefined();
    expect(l.get('a')).toBe(1);
    // control: without the read, a would have been the one to go
    const m = new Lru<number>(3);
    m.set('a', 1); m.set('b', 2); m.set('c', 3); m.set('d', 4);
    expect(m.get('a')).toBeUndefined();
  });

  it('replaces a key in place and counts it as freshest', () => {
    const l = new Lru<number>(2);
    l.set('a', 1); l.set('b', 2); l.set('a', 10); l.set('c', 3);
    expect(l.get('b')).toBeUndefined();
    expect(l.get('a')).toBe(10);
    expect(l.size).toBe(2);
  });

  it('holds exactly its size, and refuses to be made of nothing', () => {
    const l = new Lru<number>(512);
    for (let i = 0; i < 1000; i++) l.set('k' + i, i);
    expect(l.size).toBe(512);
    expect(l.get('k487')).toBeUndefined();
    expect(l.get('k488')).toBe(488);
    expect(() => new Lru(0)).toThrow(RangeError);
  });
});

describe('isFresh', () => {
  it('is fresh while less than the TTL has passed since `at`, and stale from the instant it has passed', () => {
    expect(isFresh(1000, 500, 1000)).toBe(true);
    expect(isFresh(1000, 500, 1499)).toBe(true);
    expect(isFresh(1000, 500, 1500)).toBe(false);          // exactly the TTL: stale (the page's own `<`)
    expect(isFresh(1000, 0, 1000)).toBe(false);            // a TTL of 0 never serves from memory
  });
});

describe('Flights', () => {
  it('runs the work once for concurrent callers of one key, and says who joined', async () => {
    const f = new Flights<number>();
    let runs = 0, release!: (n: number) => void;
    const work = () => { runs++; return new Promise<number>(r => { release = r; }); };
    const a = f.run('k', work), b = f.run('k', work), c = f.run('k', work);
    expect([a.shared, b.shared, c.shared]).toEqual([false, true, true]);
    expect(f.active).toBe(1);
    release(7);
    expect(await Promise.all([a.promise, b.promise, c.promise])).toEqual([7, 7, 7]);
    expect(runs).toBe(1);
  });

  it('runs again for the next caller once the work is done - a flight is not a cache', async () => {
    const f = new Flights<number>();
    let runs = 0;
    await f.run('k', async () => ++runs).promise;
    await f.run('k', async () => ++runs).promise;
    expect(runs).toBe(2);
    expect(f.active).toBe(0);
  });

  it('keeps different keys apart', async () => {
    const f = new Flights<string>();
    const a = f.run('a', async () => 'A'), b = f.run('b', async () => 'B');
    expect([a.shared, b.shared]).toEqual([false, false]);
    expect(await Promise.all([a.promise, b.promise])).toEqual(['A', 'B']);
  });

  it('gives every joined caller the failure, and clears the key so the next caller can try again', async () => {
    const f = new Flights<number>();
    let fail = true;
    const work = async () => { if (fail) throw new Error('boom'); return 1; };
    const a = f.run('k', work), b = f.run('k', work);
    await expect(a.promise).rejects.toThrow('boom');
    await expect(b.promise).rejects.toThrow('boom');
    expect(f.active).toBe(0);
    fail = false;
    expect(await f.run('k', work).promise).toBe(1);
  });
});

describe('createLimiter - a fixed window per client and route', () => {
  it('lets `max` through in a window and refuses the next, with the seconds until the window turns over', () => {
    const clock = fakeClock(0);
    const lim = createLimiter(clock.now);
    for (let i = 1; i <= 3; i++) expect(lim.take('tle', 'ip', 3).ok, 'request ' + i).toBe(true);
    clock.advance(20_000);
    const r = lim.take('tle', 'ip', 3);
    expect(r.ok).toBe(false);
    expect(r.retryAfterS).toBe(40);
  });

  it('starts a new window once the old one is a full window old', () => {
    const clock = fakeClock(0);
    const lim = createLimiter(clock.now);
    for (let i = 0; i < 3; i++) lim.take('tle', 'ip', 3);
    expect(lim.take('tle', 'ip', 3).ok).toBe(false);
    clock.advance(59_999);
    expect(lim.take('tle', 'ip', 3).ok).toBe(false);
    clock.advance(1);
    expect(lim.take('tle', 'ip', 3).ok).toBe(true);
  });

  it('keeps one client\'s budget from another\'s, and one route\'s from another\'s', () => {
    const clock = fakeClock(0);
    const lim = createLimiter(clock.now);
    for (let i = 0; i < 3; i++) lim.take('tle', 'a', 3);
    expect(lim.take('tle', 'a', 3).ok).toBe(false);
    expect(lim.take('tle', 'b', 3).ok).toBe(true);
    expect(lim.take('history', 'a', 3).ok).toBe(true);
  });

  it('a max of 0 turns the limiter off', () => {
    const lim = createLimiter(fakeClock(0).now);
    for (let i = 0; i < 1000; i++) expect(lim.take('tle', 'ip', 0).ok).toBe(true);
  });

  it('never grows without bound: past its key cap it drops what has expired, then the oldest', () => {
    const clock = fakeClock(0);
    const lim = createLimiter(clock.now, 60_000, 100);
    for (let i = 0; i < 100; i++) lim.take('tle', 'ip' + i, 1);
    clock.advance(61_000);                                 // all 100 windows have expired
    for (let i = 0; i < 100; i++) lim.take('tle', 'new' + i, 1);
    // an expired client starts over; a live one is still counted (it was not evicted to make room)
    expect(lim.take('tle', 'ip3', 1).ok).toBe(true);
    expect(lim.take('tle', 'new99', 1).ok).toBe(false);
  });
});

describe('clientKey - who is asking', () => {
  const h = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });

  it('without TRUST_PROXY everyone is one client: an x-forwarded-for from the open internet is whatever the sender typed', () => {
    expect(clientKey(h('203.0.113.9'), false)).toBe('unknown');
    expect(clientKey(h('1.1.1.1, 2.2.2.2'), false)).toBe('unknown');
    expect(clientKey(h(), false)).toBe('unknown');
  });

  it('with TRUST_PROXY it is the right-most entry, the one our own proxy appended (the control: the same headers give a client)', () => {
    expect(clientKey(h('203.0.113.9'), true)).toBe('203.0.113.9');
    expect(clientKey(h('6.6.6.6, 203.0.113.9'), true)).toBe('203.0.113.9');        // a forged left part is ignored
    expect(clientKey(h('203.0.113.9 , 198.51.100.2 '), true)).toBe('198.51.100.2');
  });

  it('falls back to the shared bucket when there is no header, or it is empty, and bounds what it keeps', () => {
    expect(clientKey(h(), true)).toBe('unknown');
    expect(clientKey(h(' '), true)).toBe('unknown');
    expect(clientKey(h('x'.repeat(500)), true)).toHaveLength(64);
  });
});

describe('corsHeaders / preflightHeaders', () => {
  it('sends nothing when no origin is configured', () => {
    expect(corsHeaders([], 'https://a.example')).toEqual({});
    expect(preflightHeaders([], 'https://a.example', null)).toBeNull();
  });

  it('allows a listed origin by echoing it, exposes the headers the client needs, and says the answer varies by origin', () => {
    const h = corsHeaders(['https://a.example'], 'https://a.example');
    expect(h['access-control-allow-origin']).toBe('https://a.example');
    expect(h['access-control-expose-headers']).toBe('x-gt-api, x-gt-cache, retry-after');
    expect(h['vary']).toBe('Origin');
  });

  it('gives an unlisted origin nothing to read with - but still says it varies, so a cache keeps the answers apart', () => {
    const h = corsHeaders(['https://a.example'], 'https://evil.example');
    expect(h['access-control-allow-origin']).toBeUndefined();
    expect(h['vary']).toBe('Origin');
    expect(corsHeaders(['https://a.example'], null)['access-control-allow-origin']).toBeUndefined();
  });

  it('"*" allows every origin with a single answer', () => {
    const h = corsHeaders(['*'], 'https://anything.example');
    expect(h['access-control-allow-origin']).toBe('*');
    expect(h['vary']).toBeUndefined();
  });

  it('answers a preflight only for a permitted origin, with GET/HEAD/OPTIONS and the headers it asked for', () => {
    const ok = preflightHeaders(['https://a.example'], 'https://a.example', 'x-custom')!;
    expect(ok['access-control-allow-methods']).toBe('GET, HEAD, OPTIONS');
    expect(ok['access-control-allow-headers']).toBe('x-custom');
    expect(ok['access-control-max-age']).toBe('600');
    expect(preflightHeaders(['https://a.example'], 'https://evil.example', null)).toBeNull();
  });
});

describe('failureStatus', () => {
  it('is 504 when every source asked ran out of time, and 502 for anything else', () => {
    expect(failureStatus([{ src: 'CelesTrak', outcome: 'timeout' }, { src: 'TLE API', outcome: 'timeout' }])).toBe(504);
    expect(failureStatus([{ src: 'CelesTrak', outcome: 'timeout' }])).toBe(504);
    expect(failureStatus([{ src: 'CelesTrak', outcome: 'timeout' }, { src: 'TLE API', outcome: 'http', status: 500 }])).toBe(502);
    expect(failureStatus([{ src: 'CelesTrak', outcome: 'unreachable' }])).toBe(502);
    expect(failureStatus([])).toBe(502);
  });
});
