import { describe, expect, it } from 'vitest';
import { tleEpochMs } from '../../shared/tle.js';
import {
  CELESTRAK_GP, MIRROR, callsTo, endlessBody, fakeClock, hang, html, json, makeApp, neverSettles, scripted, text, withRedirects
} from './helpers/harness.js';
import type { Call, Clock } from './helpers/harness.js';
import { celestrakText, makeTle, mirrorJson } from './helpers/tle.js';

const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);
const HOUR = 3_600_000;
const TTL = 3 * HOUR;

/** an element set for `id` whose epoch is `ageMs` before `clock` */
const setFor = (id: string | number, clock: Clock, ageMs = HOUR) => makeTle(id, clock.now() - ageMs);
const gpUrl = (id: string) => CELESTRAK_GP + '?CATNR=' + id + '&FORMAT=TLE';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('GET /api/tle/:norad - the answer', () => {
  it('asks CelesTrak for the number and answers with the shape the contract names', async () => {
    const clock = fakeClock(T0);
    const t = setFor(25544, clock);
    const { get, calls } = makeApp(scripted({ gp: () => text(celestrakText('ISS (ZARYA)', t)) }), {}, clock);
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok', norad: '25544', l1: t.l1, l2: t.l2, src: 'CelesTrak', at: T0, epoch: tleEpochMs(t.l1) });
    expect(calls.map(c => c.url)).toEqual([gpUrl('25544')]);
  });

  it('carries the headers: the API marker, JSON, the cache policy for an element set, and a miss', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(scripted({ gp: () => text(celestrakText('ISS', setFor(25544, clock))) }), {}, clock);
    const r = await get('/api/tle/25544');
    expect(r.headers.get('x-gt-api')).toBe('1');
    expect(r.headers.get('x-gt-cache')).toBe('miss');
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(r.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=900');
  });

  it('identifies itself upstream, asks for what it can read, refuses redirects, and bounds the wait', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: () => text(celestrakText('ISS', setFor(25544, clock))) }),
      { GT_VERSION: '1.2.3', GT_CONTACT: 'ops@example.org' }, clock);
    await get('/api/tle/25544');
    const init = calls[0]!.init!;
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const h = init.headers as Record<string, string>;
    expect(h['user-agent']).toBe('sattrackslop-api/1.2.3 (+ops@example.org)');
    expect(h['accept']).toBe('text/plain');
  });

  it('gives the repository as the contact when none is configured', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: () => text(celestrakText('ISS', setFor(25544, clock))) }), {}, clock);
    await get('/api/tle/25544');
    expect((calls[0]!.init!.headers as Record<string, string>)['user-agent']).toBe('sattrackslop-api/9.9.9-test (+https://github.com/ColaBear101/SattrackSlop)');
  });

  it('serves the second request from memory: no upstream call, the same body, a hit', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: () => text(celestrakText('ISS', setFor(25544, clock))) }), {}, clock);
    const a = await get('/api/tle/25544');
    clock.advance(60_000);
    const b = await get('/api/tle/25544');
    expect(calls).toHaveLength(1);
    expect(b.body).toEqual(a.body);
    expect(b.headers.get('x-gt-cache')).toBe('hit');
    expect(b.body.at).toBe(T0);                                    // the instant it was fetched, not the instant it was served
  });

  it('keys the cache on the numeric value: "01804" and "1804" are one object, asked of CelesTrak without padding', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: id => text(celestrakText('ALOUETTE 2', setFor(id, clock))) }), {}, clock);
    const a = await get('/api/tle/01804');
    const b = await get('/api/tle/1804');
    expect(a.status).toBe(200);
    expect(a.body.norad).toBe('1804');
    expect(a.body.l1.substring(2, 7)).toBe('01804');            // the line spells the number zero-padded, as a TLE does
    expect(b.body).toEqual(a.body);
    expect(b.headers.get('x-gt-cache')).toBe('hit');
    expect(calls.map(c => c.url)).toEqual([gpUrl('1804')]);
    expect((await get('/api/tle/00001')).body.norad).toBe('1');
  });

  it('ignores a query string: it is not part of the key and not part of the upstream URL', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: () => text(celestrakText('ISS', setFor(25544, clock))) }), {}, clock);
    await get('/api/tle/25544');
    const r = await get('/api/tle/25544?CATNR=1&FORMAT=json&x=%0d%0a');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-gt-cache')).toBe('hit');
    expect(calls).toHaveLength(1);
  });

  it('puts the epoch of line 1 in the answer, as the forward-only rule reads it', async () => {
    const clock = fakeClock(T0);
    const t = setFor(25544, clock, 5 * HOUR);
    const { get } = makeApp(scripted({ gp: () => text(celestrakText('ISS', t)) }), {}, clock);
    expect((await get('/api/tle/25544')).body.epoch).toBe(tleEpochMs(t.l1));
  });
});

describe('GET /api/tle/:norad - how long an element set is kept', () => {
  it('measures the three hours from the instant upstream was ASKED, not from when the answer arrived', async () => {
    const clock = fakeClock(T0);
    const t = setFor(25544, clock);
    const { get, calls } = makeApp(scripted({ gp: () => { clock.advance(5000); return text(celestrakText('ISS', t)); } }), {}, clock);
    const first = await get('/api/tle/25544');
    expect(first.body.at).toBe(T0);                                // asked at T0; the answer came at T0 + 5 s
    clock.set(T0 + TTL - 1);
    expect((await get('/api/tle/25544')).headers.get('x-gt-cache')).toBe('hit');
    expect(calls).toHaveLength(1);
    clock.set(T0 + TTL);                                           // 3 h after it was ASKED (still 5 s short of 3 h after it ANSWERED)
    const again = await get('/api/tle/25544');
    expect(again.headers.get('x-gt-cache')).toBe('miss');
    expect(calls).toHaveLength(2);
    expect(again.body.at).toBe(T0 + TTL);
  });

  it('honours TLE_TTL_S', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: () => text(celestrakText('ISS', setFor(25544, clock))) }), { TLE_TTL_S: '60' }, clock);
    await get('/api/tle/25544');
    clock.advance(59_999);
    await get('/api/tle/25544');
    expect(calls).toHaveLength(1);
    clock.advance(1);
    await get('/api/tle/25544');
    expect(calls).toHaveLength(2);
  });

  it('keeps a failure out of the cache: a 502 is followed by a fresh try, not by the same 502', async () => {
    const clock = fakeClock(T0);
    let up = false;
    const { get, calls } = makeApp(scripted({
      gp: () => up ? text(celestrakText('ISS', setFor(25544, clock))) : text('maintenance', 503),
      mirror: () => text('down', 503)
    }), {}, clock);
    expect((await get('/api/tle/25544')).status).toBe(502);
    expect(calls).toHaveLength(2);
    up = true;
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('holds 512 element sets and forgets the least recently used one after that', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: id => text(celestrakText('S' + id, setFor(id, clock))) }), {}, clock);
    for (let id = 1; id <= 512; id++) await get('/api/tle/' + id);
    expect(calls).toHaveLength(512);
    await get('/api/tle/1');                                       // read: 1 is now the freshest, 2 the oldest
    expect(calls).toHaveLength(512);
    await get('/api/tle/513');                                     // one over: 2 goes
    expect(calls).toHaveLength(513);
    await get('/api/tle/1');                                       // survived
    expect(calls).toHaveLength(513);
    await get('/api/tle/2');                                       // gone: asked again
    expect(calls).toHaveLength(514);
    expect(calls.at(-1)!.url).toBe(gpUrl('2'));
  });

  it('gives each app its own cache', async () => {
    const clock = fakeClock(T0);
    const script = scripted({ gp: () => text(celestrakText('ISS', setFor(25544, clock))) });
    const a = makeApp(script, {}, clock), b = makeApp(script, {}, clock);
    await a.get('/api/tle/25544');
    await b.get('/api/tle/25544');
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });
});

describe('GET /api/tle/:norad - "No GP data found" is a withdrawal, not an outage', () => {
  const gone = () => text('No GP data found', 404);

  it('answers {status:"gone"} as a 200, so it caches, and never asks the mirror', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: gone, mirror: (id) => text(mirrorJson('X', setFor(id, clock), id)) }), {}, clock);
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'gone', norad: '25544', src: 'CelesTrak', at: T0 });
    expect(callsTo(calls, 'mirror')).toHaveLength(0);                         // mirror call count 0
    expect(callsTo(calls, 'gp')).toHaveLength(1);
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=3600');
    expect(r.headers.get('x-gt-api')).toBe('1');
  });

  it('is cached like an element set: the second request is a hit and asks nobody', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: gone }), {}, clock);
    await get('/api/tle/25544');
    const b = await get('/api/tle/25544');
    expect(b.body.status).toBe('gone');
    expect(b.headers.get('x-gt-cache')).toBe('hit');
    expect(calls).toHaveLength(1);
    clock.set(T0 + TTL);
    await get('/api/tle/25544');
    expect(calls).toHaveLength(2);                                            // re-checked on the normal interval
  });

  it('keeps its three hours from the instant CelesTrak was ASKED, like an element set', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: () => { clock.advance(5000); return gone(); } }), {}, clock);
    expect((await get('/api/tle/25544')).body.at).toBe(T0);
    clock.set(T0 + TTL - 1);
    await get('/api/tle/25544');
    expect(calls).toHaveLength(1);
    clock.set(T0 + TTL);
    await get('/api/tle/25544');
    expect(calls).toHaveLength(2);
  });

  it('is read before the status: a 200 with the text, or the text inside a page, is the same answer', async () => {
    for (const reply of [text('No GP data found', 200), html('<html><p>No GP data found for 25544</p></html>', 200), text('no gp data found', 404)]) {
      const { get, calls } = makeApp(scripted({ gp: () => reply.clone(), mirror: () => text('should not be asked', 200) }), {}, fakeClock(T0));
      const r = await get('/api/tle/25544');
      expect(r.body.status).toBe('gone');
      expect(callsTo(calls, 'mirror')).toHaveLength(0);
    }
  });

  it('is told apart from an outage: any other 404 sends the question on to the mirror', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({
      gp: () => text('Not Found', 404),
      mirror: id => text(mirrorJson('ISS', setFor(id, clock), id))
    }), {}, clock);
    const r = await get('/api/tle/25544');
    expect(r.body).toMatchObject({ status: 'ok', src: 'TLE API' });
    expect(callsTo(calls, 'mirror')).toHaveLength(1);
  });

  it('replaces an element set held before it: a withdrawn object is not confirmed current from memory', async () => {
    const clock = fakeClock(T0);
    let withdrawn = false;
    const { get } = makeApp(scripted({ gp: id => withdrawn ? gone() : text(celestrakText('X', setFor(id, clock))) }), {}, clock);
    expect((await get('/api/tle/25544')).body.status).toBe('ok');
    withdrawn = true;
    clock.set(T0 + TTL);
    const r = await get('/api/tle/25544');
    expect(r.body.status).toBe('gone');
    expect((await get('/api/tle/25544')).body.status).toBe('gone');
  });

  it('does not keep a withdrawal against a set that comes back: CelesTrak carrying the object again is believed', async () => {
    const clock = fakeClock(T0);
    let withdrawn = true;
    const { get } = makeApp(scripted({ gp: id => withdrawn ? gone() : text(celestrakText('X', setFor(id, clock))) }), {}, clock);
    expect((await get('/api/tle/25544')).body.status).toBe('gone');
    withdrawn = false;
    clock.set(T0 + TTL);
    expect((await get('/api/tle/25544')).body.status).toBe('ok');
  });
});

describe('GET /api/tle/:norad - CelesTrak first, then the mirror', () => {
  it('falls back to the mirror when CelesTrak cannot be reached, and says where the set came from', async () => {
    const clock = fakeClock(T0);
    const t = setFor(25544, clock);
    const { get, calls } = makeApp(scripted({
      gp: () => { throw new TypeError('fetch failed'); },
      mirror: id => text(mirrorJson('ISS (ZARYA)', t, id))
    }), {}, clock);
    const r = await get('/api/tle/25544');
    expect(r.body).toMatchObject({ status: 'ok', src: 'TLE API', l1: t.l1, l2: t.l2 });
    expect(calls.map(c => c.url)).toEqual([gpUrl('25544'), MIRROR + '25544']);
    expect((calls[1]!.init!.headers as Record<string, string>)['accept']).toBe('application/json');
  });

  it('falls back on a non-200 from CelesTrak (500, 503, 403, 429)', async () => {
    for (const status of [500, 503, 403, 429, 418]) {
      const clock = fakeClock(T0);
      const { get, calls } = makeApp(scripted({
        gp: () => text('Service Unavailable', status),
        mirror: id => text(mirrorJson('ISS', setFor(id, clock), id))
      }), {}, clock);
      const r = await get('/api/tle/25544');
      expect(r.body.src, 'CelesTrak said ' + status).toBe('TLE API');
      expect(calls).toHaveLength(2);
    }
  });

  it('does not ask the mirror when CelesTrak has answered', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({
      gp: id => text(celestrakText('ISS', setFor(id, clock))),
      mirror: () => { throw new Error('not to be asked'); }
    }), {}, clock);
    await get('/api/tle/25544');
    expect(callsTo(calls, 'mirror')).toHaveLength(0);
  });

  it('does not believe a 200 HTML error page (a source that is up but has no such object), and moves on', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({
      gp: () => html('<html><head><title>Error</title></head><body>Something went wrong</body></html>'),
      mirror: id => text(mirrorJson('ISS', setFor(id, clock), id))
    }), {}, clock);
    const r = await get('/api/tle/25544');
    expect(r.body.src).toBe('TLE API');
    expect(calls).toHaveLength(2);
  });

  it('is a 502 naming what each source did when none of them can be believed', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(scripted({
      gp: () => html('<html>error</html>'),
      mirror: () => json({ message: 'Unable to find any tle for the given satellite id' }, 404)
    }), {}, clock);
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: 'upstream_unavailable', tried: [
      { src: 'CelesTrak', outcome: 'unreadable' }, { src: 'TLE API', outcome: 'http', status: 404 }] });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-gt-api')).toBe('1');
    expect(r.headers.get('x-gt-cache')).toBe('miss');
  });

  it('names a network failure "unreachable"', async () => {
    const { get } = makeApp(scripted({ gp: () => { throw new TypeError('fetch failed'); }, mirror: () => { throw new TypeError('fetch failed'); } }), {}, fakeClock(T0));
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(502);
    expect(r.body.tried).toEqual([{ src: 'CelesTrak', outcome: 'unreachable' }, { src: 'TLE API', outcome: 'unreachable' }]);
  });

  describe('validation: nothing is believed until shared/tle.ts says it is an element set for the number asked', () => {
    it('rejects lines for another object, whoever sent them', async () => {
      const clock = fakeClock(T0);
      const wrong = setFor(25545, clock), right = setFor(25544, clock);
      const { get, calls } = makeApp(scripted({
        gp: () => text(celestrakText('NOT THE ISS', wrong)),
        mirror: () => text(mirrorJson('ISS', right, 25544))
      }), {}, clock);
      const r = await get('/api/tle/25544');
      expect(r.body).toMatchObject({ status: 'ok', src: 'TLE API', l1: right.l1 });
      expect(calls).toHaveLength(2);
      const both = makeApp(scripted({ gp: () => text(celestrakText('X', wrong)), mirror: () => text(mirrorJson('X', wrong, 25544)) }), {}, clock);
      const bad = await both.get('/api/tle/25544');
      expect(bad.status).toBe(502);
      expect(bad.body.tried.map((t: { outcome: string }) => t.outcome)).toEqual(['unreadable', 'unreadable']);
    });

    it('rejects one line from the right object and one from another', async () => {
      const clock = fakeClock(T0);
      const a = setFor(25544, clock), b = setFor(25545, clock);
      const { get } = makeApp(scripted({
        gp: () => text(a.l1 + '\r\n' + b.l2 + '\r\n'),
        mirror: () => text(mirrorJson('X', { l1: b.l1, l2: a.l2 }, 25544))
      }), {}, clock);
      expect((await get('/api/tle/25544')).status).toBe(502);
    });

    it('rejects lines of the wrong length or with unprintable characters', async () => {
      const clock = fakeClock(T0);
      const t = setFor(25544, clock);
      const variants: Record<string, { l1: string; l2: string }> = {
        'line 1 a character short': { l1: t.l1.slice(0, 68), l2: t.l2 },
        'line 2 with junk appended': { l1: t.l1, l2: t.l2 + ' junk junk junk' },
        'a bell in line 1': { l1: t.l1.slice(0, 30) + '\x07' + t.l1.slice(31), l2: t.l2 },
        'a non-ASCII character in line 2': { l1: t.l1, l2: t.l2.slice(0, 40) + 'é' + t.l2.slice(41) }
      };
      for (const [what, v] of Object.entries(variants)) {
        const { get } = makeApp(scripted({ gp: () => text('X\r\n' + v.l1 + '\r\n' + v.l2 + '\r\n'), mirror: () => text(mirrorJson('X', v, 25544)) }), {}, clock);
        const r = await get('/api/tle/25544');
        expect(r.status, what).toBe(502);
        expect(r.body.tried.map((x: { outcome: string }) => x.outcome), what).toEqual(['unreadable', 'unreadable']);
      }
      // control: the untouched pair passes through the same path
      const ok = makeApp(scripted({ gp: () => text('X\r\n' + t.l1 + '\r\n' + t.l2 + '\r\n') }), {}, clock);
      expect((await ok.get('/api/tle/25544')).status).toBe(200);
    });

    it('reads the mirror\'s JSON: a missing line, a broken body or a non-object is unreadable, not an error', async () => {
      const clock = fakeClock(T0);
      const t = setFor(25544, clock);
      for (const body of [JSON.stringify({ line1: t.l1 }), '{"line1":', 'null', '<html>', JSON.stringify({ line1: t.l1, line2: 7 })]) {
        const { get } = makeApp(scripted({ gp: () => text('nothing', 500), mirror: () => text(body) }), {}, clock);
        const r = await get('/api/tle/25544');
        expect(r.status, body).toBe(502);
        expect(r.body.tried[1], body).toEqual({ src: 'TLE API', outcome: 'unreadable' });
      }
    });

    it('does not accept an element set whose epoch is not a date, or is more than three days ahead of the clock', async () => {
      const clock = fakeClock(T0);
      const t = setFor(25544, clock);
      const noDate = { l1: t.l1.substring(0, 18) + 'ab' + 'xxxxxxxxxxxx' + t.l1.substring(32), l2: t.l2 };
      const ahead = makeTle(25544, T0 + 4 * 86400000);
      const near = makeTle(25544, T0 + 2 * 86400000);
      const run = async (lines: { l1: string; l2: string }) =>
        (await makeApp(scripted({ gp: () => text('X\r\n' + lines.l1 + '\r\n' + lines.l2 + '\r\n') }), {}, clock).get('/api/tle/25544')).status;
      expect(await run(noDate)).toBe(502);
      expect(await run(ahead)).toBe(502);
      expect(await run(near)).toBe(200);                      // control: two days ahead is a clock skew, not a poisoned set
    });
  });
});

describe('GET /api/tle/:norad - it only ever moves forward', () => {
  /* An element set from a source that is behind must not replace a newer one. After the TTL the next request asks
     upstream again; what comes back is compared with the epoch of the record held. */
  const epochs = (clock: Clock) => {
    const E1 = clock.now() - HOUR;                            // the set CelesTrak first gave
    return { E1, older: E1 - 3 * 86400000, newer: E1 + 86400000 };
  };

  it('an OLDER mirror set cannot replace a newer cached one, and is never served', async () => {
    const clock = fakeClock(T0);
    const { E1, older } = epochs(clock);
    const first = makeTle(25544, E1), stale = makeTle(25544, older);
    let mode: 'first' | 'down-mirror-stale' = 'first';
    const { get } = makeApp(scripted({
      gp: () => mode === 'first' ? text(celestrakText('ISS', first)) : text('down', 503),
      mirror: () => text(mirrorJson('ISS', stale, 25544))
    }), {}, clock);
    const seen: string[] = [];
    const a = await get('/api/tle/25544');
    seen.push(a.body.l1);
    expect(a.body.l1).toBe(first.l1);
    clock.set(T0 + TTL);                                      // the held set has expired: upstream is asked again
    mode = 'down-mirror-stale';
    const b = await get('/api/tle/25544');
    expect(b.status).toBe(502);
    expect(b.body.tried).toEqual([{ src: 'CelesTrak', outcome: 'http', status: 503 }, { src: 'TLE API', outcome: 'older' }]);
    expect(JSON.stringify(b.body)).not.toContain(stale.l1);
    // and it is not in the cache either: asked again, still no stale set, and CelesTrak recovering gives the real one
    const c = await get('/api/tle/25544');
    expect(c.status).toBe(502);
    mode = 'first';
    const d = await get('/api/tle/25544');
    expect(d.body.l1).toBe(first.l1);
    expect(seen.concat(d.body.l1)).not.toContain(stale.l1);
  });

  it('the control: with nothing held, the same older mirror set IS served - so it was the rule that refused it, not the set', async () => {
    const clock = fakeClock(T0);
    const { older } = epochs(clock);
    const stale = makeTle(25544, older);
    const { get } = makeApp(scripted({ gp: () => text('down', 503), mirror: () => text(mirrorJson('ISS', stale, 25544)) }), {}, clock);
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(200);
    expect(r.body.l1).toBe(stale.l1);
  });

  it('a NEWER set is taken, and replaces what was held', async () => {
    const clock = fakeClock(T0);
    const { E1, newer } = epochs(clock);
    const first = makeTle(25544, E1), later = makeTle(25544, newer);
    let step = 0;
    const { get } = makeApp(scripted({ gp: () => text(celestrakText('ISS', step++ === 0 ? first : later)) }), {}, clock);
    expect((await get('/api/tle/25544')).body.l1).toBe(first.l1);
    clock.set(T0 + TTL);
    const r = await get('/api/tle/25544');
    expect(r.body.l1).toBe(later.l1);
    expect(r.body.epoch).toBe(tleEpochMs(later.l1));
    clock.advance(1000);
    expect((await get('/api/tle/25544')).body.l1).toBe(later.l1);        // and that is what is held now
  });

  it('the same epoch again is accepted: the set is confirmed, and its clock restarts', async () => {
    const clock = fakeClock(T0);
    const { E1 } = epochs(clock);
    const t = makeTle(25544, E1);
    const { get, calls } = makeApp(scripted({ gp: () => text(celestrakText('ISS', t)) }), {}, clock);
    await get('/api/tle/25544');
    clock.set(T0 + TTL);
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(200);
    expect(r.body.at).toBe(T0 + TTL);
    expect(calls).toHaveLength(2);
    clock.set(T0 + TTL + TTL - 1);
    expect((await get('/api/tle/25544')).headers.get('x-gt-cache')).toBe('hit');     // fresh from the second fetch
  });

  it('holds CelesTrak to the same rule: an older CelesTrak set is refused, and the mirror is asked', async () => {
    const clock = fakeClock(T0);
    const { E1, older, newer } = epochs(clock);
    const first = makeTle(25544, E1), stale = makeTle(25544, older), later = makeTle(25544, newer);
    let step = 0;
    const { get, calls } = makeApp(scripted({
      gp: () => text(celestrakText('ISS', step++ === 0 ? first : stale)),
      mirror: () => text(mirrorJson('ISS', later, 25544))
    }), {}, clock);
    await get('/api/tle/25544');
    clock.set(T0 + TTL);
    const r = await get('/api/tle/25544');
    expect(r.body).toMatchObject({ status: 'ok', src: 'TLE API', l1: later.l1 });
    expect(calls).toHaveLength(3);
  });

  it('keeps the floor per object: another number\'s epoch does not matter', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(scripted({
      gp: id => text(celestrakText('X', makeTle(id, id === '1' ? T0 : T0 - 10 * 86400000)))
    }), {}, clock);
    expect((await get('/api/tle/1')).status).toBe(200);
    expect((await get('/api/tle/2')).status).toBe(200);      // epoch far older than object 1's, and fine
  });
});

describe('GET /api/tle/:norad - one request to CelesTrak for everyone who asks', () => {
  /** a response that is held until the test lets it go */
  function gate() {
    let release!: () => void;
    const opened = new Promise<void>(r => { release = r; });
    return { opened, release };
  }

  it('ten concurrent requests for one object make exactly one upstream call', async () => {
    const clock = fakeClock(T0);
    const g = gate();
    const t = setFor(25544, clock);
    const { get, calls } = makeApp(scripted({ gp: async () => { await g.opened; return text(celestrakText('ISS', t)); } }), {}, clock);
    const pending = Array.from({ length: 10 }, () => get('/api/tle/25544'));
    await sleep(25);
    expect(calls).toHaveLength(1);                            // nine of them are waiting on the first
    g.release();
    const replies = await Promise.all(pending);
    expect(calls).toHaveLength(1);
    expect(replies.every(r => r.status === 200 && r.body.l1 === t.l1)).toBe(true);
    const labels = replies.map(r => r.headers.get('x-gt-cache')).sort();
    expect(labels).toEqual(['coalesced', 'coalesced', 'coalesced', 'coalesced', 'coalesced', 'coalesced', 'coalesced', 'coalesced', 'coalesced', 'miss']);
  });

  it('the control: ten requests for ten different objects make ten calls (so the count above can see a call)', async () => {
    const clock = fakeClock(T0);
    const g = gate();
    const { get, calls } = makeApp(scripted({ gp: async id => { await g.opened; return text(celestrakText('X', setFor(id, clock))); } }), {}, clock);
    const pending = Array.from({ length: 10 }, (_, i) => get('/api/tle/' + (100 + i)));
    await sleep(25);
    expect(calls).toHaveLength(10);
    g.release();
    await Promise.all(pending);
  });

  it('the control: ten requests one after another make one call and nine hits, which is not the same label as coalesced', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: id => text(celestrakText('X', setFor(id, clock))) }), {}, clock);
    const labels: string[] = [];
    for (let i = 0; i < 10; i++) labels.push((await get('/api/tle/25544')).headers.get('x-gt-cache')!);
    expect(calls).toHaveLength(1);
    expect(labels).toEqual(['miss', ...Array(9).fill('hit')]);
  });

  it('shares a failure too, and then forgets it: the next request tries again', async () => {
    const clock = fakeClock(T0);
    const g = gate();
    const { get, calls } = makeApp(scripted({
      gp: async () => { await g.opened; return text('down', 503); },
      mirror: () => text('down', 503)
    }), {}, clock);
    const pending = Array.from({ length: 10 }, () => get('/api/tle/25544'));
    await sleep(25);
    g.release();
    const replies = await Promise.all(pending);
    expect(replies.every(r => r.status === 502)).toBe(true);
    expect(calls).toHaveLength(2);                            // one CelesTrak, one mirror, for all ten
    await get('/api/tle/25544');
    expect(calls).toHaveLength(4);
  });

  it('shares one flight between spellings of one number', async () => {
    const clock = fakeClock(T0);
    const g = gate();
    const { get, calls } = makeApp(scripted({ gp: async id => { await g.opened; return text(celestrakText('X', setFor(id, clock))); } }), {}, clock);
    const pending = ['/api/tle/01804', '/api/tle/1804', '/api/tle/01804'].map(p => get(p));
    await sleep(25);
    g.release();
    await Promise.all(pending);
    expect(calls).toHaveLength(1);
  });
});

describe('GET /api/tle/:norad - upstream that is slow, huge, or sends us elsewhere', () => {
  it('gives up on a source after TLE_TIMEOUT_MS and asks the next', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({
      gp: (_id, init) => hang(init),
      mirror: id => text(mirrorJson('ISS', setFor(id, clock), id))
    }), { TLE_TIMEOUT_MS: '30' }, clock);
    const r = await get('/api/tle/25544');
    expect(r.body.src).toBe('TLE API');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init!.signal!.aborted).toBe(true);        // the request was cancelled, not left running
  });

  it('is a 504 {upstream_timeout} when every source ran out of time', async () => {
    const { get } = makeApp(scripted({ gp: (_i, init) => hang(init), mirror: (_i, init) => hang(init) }), { TLE_TIMEOUT_MS: '30' }, fakeClock(T0));
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(504);
    expect(r.body).toEqual({ error: 'upstream_timeout' });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-gt-api')).toBe('1');
  });

  it('is a 502, not a 504, when only some of the failures were timeouts', async () => {
    const { get } = makeApp(scripted({ gp: (_i, init) => hang(init), mirror: () => text('error', 500) }), { TLE_TIMEOUT_MS: '30' }, fakeClock(T0));
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(502);
    expect(r.body.tried).toEqual([{ src: 'CelesTrak', outcome: 'timeout' }, { src: 'TLE API', outcome: 'http', status: 500 }]);
  });

  it('holds even for a fetch that ignores its AbortSignal altogether', async () => {
    const { get } = makeApp(scripted({ gp: () => neverSettles(), mirror: () => neverSettles() }), { TLE_TIMEOUT_MS: '30' }, fakeClock(T0));
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(504);
  });

  it('puts the deadline over the body as well as the headers: a body that never ends is a timeout', async () => {
    const state = { cancelled: false, sent: 0 };
    const clock = fakeClock(T0);
    const { get } = makeApp(scripted({ gp: () => endlessBody(1024, 2, state), mirror: id => text(mirrorJson('ISS', setFor(id, clock), id)) }),
      { TLE_TIMEOUT_MS: '40' }, clock);
    const r = await get('/api/tle/25544');
    expect(r.body.src).toBe('TLE API');
    expect(state.sent).toBeLessThanOrEqual(2048);                 // the body offered two chunks and then stalled; the deadline, not the body, ended it
  });

  describe('a body is capped at 64 KB, as a stream', () => {
    const cap = 64 * 1024;
    const t = (clock: Clock) => setFor(25544, clock);
    const sized = (clock: Clock, size: number) => {
      const base = celestrakText('ISS', t(clock));
      return base + ' '.repeat(size - base.length);            // trailing blanks: still a valid reply, just a long one
    };

    it('takes a reply of exactly the cap and refuses one byte more (the control that the cap bites at the right place)', async () => {
      const clock = fakeClock(T0);
      const atCap = makeApp(scripted({ gp: () => text(sized(clock, cap)) }), {}, clock);
      expect((await atCap.get('/api/tle/25544')).status).toBe(200);
      const over = makeApp(scripted({ gp: () => text(sized(clock, cap + 1)) }), {}, clock);
      const r = await over.get('/api/tle/25544');
      expect(r.status).toBe(502);
      expect(r.body.tried[0]).toEqual({ src: 'CelesTrak', outcome: 'too_large' });
    });

    it('refuses a declared length that is already too big, and drops the body unread', async () => {
      const clock = fakeClock(T0);
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(ctl) { ctl.enqueue(new Uint8Array(10)); },
        cancel() { cancelled = true; }
      });
      const { get } = makeApp(scripted({
        gp: () => new Response(body, { status: 200, headers: { 'content-length': String(cap * 10) } }),
        mirror: id => text(mirrorJson('ISS', t(clock), id))
      }), {}, clock);
      const r = await get('/api/tle/25544');
      expect(r.body.src).toBe('TLE API');
      expect(cancelled).toBe(true);
    });

    it('stops reading a stream that has no length as soon as it passes the cap, and cancels it', async () => {
      const clock = fakeClock(T0);
      const state = { cancelled: false, sent: 0 };
      const { get } = makeApp(scripted({ gp: () => endlessBody(16 * 1024, 1000, state), mirror: id => text(mirrorJson('ISS', t(clock), id)) }), {}, clock);
      const r = await get('/api/tle/25544');
      expect(r.body.src).toBe('TLE API');
      expect(state.cancelled).toBe(true);
      expect(state.sent).toBeLessThanOrEqual(cap + 3 * 16 * 1024);       // a handful of chunks past the cap, not the thousand offered
    });

    it('is not fooled by a Content-Length that says small', async () => {
      const clock = fakeClock(T0);
      const { get } = makeApp(scripted({
        gp: () => text(sized(clock, cap * 4), 200, { 'content-length': '100' }),
        mirror: () => text('error', 500)
      }), {}, clock);
      const r = await get('/api/tle/25544');
      expect(r.body.tried[0]).toEqual({ src: 'CelesTrak', outcome: 'too_large' });
    });
  });

  describe('a redirect is refused, never followed', () => {
    const redirecting = () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal?x=1' } });

    it('sends every upstream request with redirect:"error", on every path through the code', async () => {
      const clock = fakeClock(T0);
      const t = setFor(25544, clock);
      const cases = [
        scripted({ gp: () => text(celestrakText('X', t)) }),
        scripted({ gp: () => text('No GP data found', 404) }),
        scripted({ gp: () => text('down', 500), mirror: () => text(mirrorJson('X', t, 25544)) }),
        scripted({ gp: () => text('down', 500), mirror: () => text('down', 500) })
      ];
      for (const h of cases) {
        const { get, calls } = makeApp(h, {}, clock);
        await get('/api/tle/25544');
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every((c: Call) => c.init?.redirect === 'error')).toBe(true);
      }
    });

    it('treats a redirect as a failed source (and so asks the mirror), and never requests where it points', async () => {
      const clock = fakeClock(T0);
      const followed: string[] = [];
      const handler = withRedirects(scripted({ gp: redirecting, mirror: id => text(mirrorJson('ISS', setFor(id, clock), id)) }), u => followed.push(u));
      const { get, calls } = makeApp(handler, {}, clock);
      const r = await get('/api/tle/25544');
      expect(r.body.src).toBe('TLE API');
      expect(followed).toEqual([]);
      expect(calls.some(c => c.url.includes('evil.example'))).toBe(false);
    });

    it('the control: the same upstream, asked with redirect:"follow", does reach the other host (so the test can see a violation)', async () => {
      const followed: string[] = [];
      const handler = withRedirects(scripted({ gp: redirecting }), u => followed.push(u));
      await handler(gpUrl('25544'), { redirect: 'follow' }, 1);
      expect(followed).toEqual(['https://evil.example/steal?x=1']);
    });
  });
});
