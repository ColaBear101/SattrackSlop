import { describe, expect, it } from 'vitest';
import { LIT_EVERY_MS, liveReader, liveState, type LiveEngine, type LiveOptics } from '../../src/lib/analysis/live-state';
import { toLocator } from '../../src/lib/maidenhead';
import { latStr, lonStr } from '../../src/lib/observer';
import {
  APPROACHING, BELOW, kmsSigned, LIT_WORDS, nowRows, RANGE_RATE, RECEDING, SPEED, SPEED_NOTE, SUNLIGHT
} from '../../src/lib/text/now-state';
import type { Lit, Track } from '../../src/lib/types';
import { byName, world } from './helpers';

/* The spacecraft at the clock's instant, in the rail's "now" section (CHANGES-FROM-LEGACY.md, L53): one propagation, and every figure
   read from it by code the page already runs. Each is checked here against the engine's or the optics' own call at the same instant,
   so a figure that drifted from what the rest of the page says at that instant would be caught. */
const START = Date.parse('2026-09-12T07:29:09.993Z');
const { eng, optics } = world();
const D = eng.compute(byName('KNACKSAT-2'), START, 24);
const ISS = eng.compute(byName('ISS (ZARYA)'), START, 24);

/** the instants checked: every 7 min 13.7 s across the window, so they fall at every phase of the orbit and off the 10 s samples */
const instants = (A: typeof D) => {
  const out: number[] = [];
  for (let ms = A.start.getTime() + 1234.5; ms < A.end.getTime(); ms += 433_700) out.push(ms);
  return out;
};

describe('the state at an instant', () => {
  it('is the engine\'s at that instant: the sub-satellite point, the range rate, and the length of the SGP4 velocity', () => {
    for (const A of [D, ISS]) for (const ms of instants(A)) {
      const s = liveState(eng, optics, A.track, ms)!, p = eng.sampleMs(A.track, ms)!;
      expect(s.ms).toBe(ms);
      expect([s.lat, s.lon, s.alt]).toEqual([p.lat, p.lon, p.alt]);
      expect(s.rr).toBe(eng.rangeRateMs(A.track, ms));
      const v = A.track.at(ms)!.v;
      expect(s.speed).toBe(Math.hypot(v.x, v.y, v.z));
    }
  });
  it('gives the shadow opticalAt gives at that instant, and all three states occur', () => {
    const seen = new Set<Lit>();
    for (const A of [D, ISS]) {
      for (const ms of instants(A)) {
        const s = liveState(eng, optics, A.track, ms)!;
        expect(s.lit).toBe(optics.opticalAt(A.track, ms)!.lit);
        expect(s.litMs).toBe(ms);
        seen.add(s.lit);
      }
      /* the penumbra is crossed in seconds: look for it at 2 s steps over the first two hours */
      for (let ms = A.start.getTime(); ms < A.start.getTime() + 7_200_000; ms += 2000) {
        const s = liveState(eng, optics, A.track, ms)!;
        expect(s.lit).toBe(optics.opticalAt(A.track, ms)!.lit);
        seen.add(s.lit);
      }
    }
    expect([...seen].sort()).toEqual(['penumbra', 'sun', 'umbra']);
  });
  it('names the grid square of the sub-satellite point, six characters', () => {
    for (const ms of instants(D)) {
      const s = liveState(eng, optics, D.track, ms)!;
      expect(s.grid).toBe(toLocator(s.lat, s.lon));
      expect(s.grid).toMatch(/^[A-R]{2}\d{2}[a-x]{2}$/);
    }
  });
  it('is an orbital speed for a LEO spacecraft, and the speed of an inertial velocity, not of one relative to the turning Earth', () => {
    const ms = D.passes[0]!.maxAt.getTime(), s = liveState(eng, optics, D.track, ms)!;
    expect(s.speed).toBeGreaterThan(7.3);
    expect(s.speed).toBeLessThan(7.9);
    /* relative to the turning Earth: v - omega x r, with omega along z. The ISS, at 51.6 deg, is prograde, so it is slower relative to
       the Earth than in space, by a good part of omega r (0.49 km/s at its height over the equator). */
    const st = ISS.track.at(ms)!, w = 7.2921158553e-5;
    const ground = Math.hypot(st.v.x + w * st.r.y, st.v.y - w * st.r.x, st.v.z);
    expect(liveState(eng, optics, ISS.track, ms)!.speed - ground).toBeGreaterThan(0.2);
  });
  it('is null where the propagation gives no state', () => {
    expect(liveState({ ...eng, fix: () => null }, optics, D.track, START)).toBeNull();
  });
});

describe('the shadow test', () => {
  /* a stand-in for the optics that counts its calls and answers what the real one does */
  const counting = () => {
    const c = { calls: 0, sunlitState: ((r, t) => { c.calls++; return optics.sunlitState(r, t); }) as LiveOptics['sunlitState'] };
    return c;
  };
  it('is made at most once a second of the clock: ten ticks a second at real time make one test a second', () => {
    const o = counting(), read = liveReader(), t0 = D.passes[0]!.aos.getTime();
    for (let k = 0; k < 30; k++) {
      const s = read(eng, o, D.track, t0 + k * 100)!;
      expect(s.ms).toBe(t0 + k * 100);
      expect(s.ms - s.litMs).toBeGreaterThanOrEqual(0);
      expect(s.ms - s.litMs).toBeLessThan(LIT_EVERY_MS);
      expect(s.lit).toBe(optics.opticalAt(D.track, s.litMs)!.lit);
    }
    expect(LIT_EVERY_MS).toBe(1000);
    expect(o.calls).toBe(3);                                      // at 0, 1.0 and 2.0 s
  });
  it('is made again at once for a jump of a second or more either way, and for another track', () => {
    const o = counting(), read = liveReader(), t0 = D.passes[0]!.aos.getTime();
    read(eng, o, D.track, t0);
    read(eng, o, D.track, t0 + 999);
    expect(o.calls).toBe(1);
    expect(read(eng, o, D.track, t0 - 1000)!.litMs).toBe(t0 - 1000);
    expect(read(eng, o, D.track, t0 + 3_600_000)!.litMs).toBe(t0 + 3_600_000);
    expect(o.calls).toBe(3);
    expect(read(eng, o, ISS.track, t0 + 3_600_000)!.litMs).toBe(t0 + 3_600_000);
    expect(o.calls).toBe(4);
  });
  it('follows a fast clock tick by tick (at 600 times real time a tick is a minute)', () => {
    const o = counting(), read = liveReader(), t0 = D.start.getTime();
    for (let k = 0; k < 20; k++) expect(read(eng, o, D.track, t0 + k * 60_000)!.litMs).toBe(t0 + k * 60_000);
    expect(o.calls).toBe(20);
  });
  it('keeps the last test through an instant with no state', () => {
    const o = counting(), read = liveReader(), t0 = D.start.getTime();
    read(eng, o, D.track, t0);
    const none: LiveEngine = { ...eng, fix: () => null };
    expect(read(none, o, D.track, t0 + 5000)).toBeNull();
    expect(read(eng, o, D.track, t0 + 500)!.litMs).toBe(t0);
    expect(o.calls).toBe(1);
  });
  it('asks the track for one state per reading, whatever is worked out from it', () => {
    let n = 0;
    const track: Track = Object.create(D.track, { at: { value: (ms: number) => { n++; return D.track.at(ms); } } });
    liveState(eng, optics, track, D.passes[0]!.maxAt.getTime());
    expect(n).toBe(1);
  });
});

describe('the words', () => {
  it('give a range rate to the metre a second, + receding and a true minus approaching', () => {
    expect(kmsSigned(3.2144)).toBe('+3.214 km/s');
    expect(kmsSigned(-0.0512)).toBe('−0.051 km/s');
    expect(kmsSigned(0)).toBe('+0.000 km/s');
  });
  it('give each figure its label, value and word, from the state', () => {
    const ms = D.passes[0]!.aos.getTime(), s = liveState(eng, optics, D.track, ms)!;
    const rows = nowRows(s);
    expect(rows.map(r => r.id)).toEqual(['now-lit', 'now-rr', 'now-v', 'now-grid']);
    expect(rows.map(r => r.label)).toEqual([SUNLIGHT, RANGE_RATE, SPEED, BELOW]);
    expect([rows[0]!.value, rows[0]!.note]).toEqual([...LIT_WORDS[s.lit]]);
    expect(rows[1]!.value).toBe(kmsSigned(s.rr!));
    expect(rows[1]!.note).toBe(s.rr! < 0 ? APPROACHING : RECEDING);
    expect(rows[1]!.note).toBe(APPROACHING);                        // at AOS the spacecraft is coming closer
    expect(rows[2]!.value).toBe(s.speed.toFixed(3) + ' km/s');
    expect(rows[2]!.note).toBe(SPEED_NOTE);
    expect(rows[3]!.value).toBe(s.grid);
    expect(rows[3]!.note).toBe(latStr(s.lat) + ' ' + lonStr(s.lon));
  });
  it('name the three shadow states', () => {
    expect(LIT_WORDS.sun[0]).toBe('Sunlit');
    expect(LIT_WORDS.penumbra[0]).toBe('Penumbra');
    expect(LIT_WORDS.umbra[0]).toBe('Eclipsed');
  });
  it('give a dash for every figure where there is no state, and no word under it', () => {
    for (const r of nowRows(null)) expect([r.value, r.note]).toEqual(['—', '']);
    const rows = nowRows({ ...liveState(eng, optics, D.track, START)!, rr: null });
    expect([rows[1]!.value, rows[1]!.note]).toEqual(['—', '']);
  });
  it('keep the words under the figures short enough for half of a 320 px phone\'s rail (22 characters)', () => {
    const notes = [...Object.values(LIT_WORDS).map(w => w[1]), RECEDING, APPROACHING, SPEED_NOTE, latStr(-89.99) + ' ' + lonStr(-179.99)];
    for (const n of notes) expect(n.length).toBeLessThanOrEqual(22);
  });
});
