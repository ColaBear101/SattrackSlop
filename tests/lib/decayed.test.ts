import { describe, expect, it } from 'vitest';
import * as satellite from 'satellite.js';
import { decayAt, decayedAt, SGP4_DECAYED } from '../../src/lib/catalogue/decayed';
import { sgp4Track } from '../../src/lib/core/propagator';
import { DECAYED_NOW, decayedNote } from '../../src/lib/text/decayed';
import type { Body } from '../../src/lib/types';
import { BODY, byName, CATALOGUE, world } from './helpers';

/* The picker's "decayed now" (CHANGES-FROM-LEGACY.md, L59): one SGP4 sample per entry, at one instant. Decayed there is SGP4's own
   error 6, or a position below the body's 120 km entry interface; it is not compute()'s test (a window and a densely sampled
   revolution), so the checks here are that it says what one sample through the engine's own path says, and that it never calls
   decayed a spacecraft whose window compute() would analyse as being in orbit. The instants are fixed, because what has come down
   depends on when you ask: W0 is the window verify-catalogue.js drives, with COSMOS 2558 still up and ODIN long gone. */
const sat = satellite as never;
const W0 = Date.UTC(2026, 8, 14, 0, 0, 0);
const EPOCH = Date.parse('2026-09-12T07:29:09.993Z');          // KNACKSAT-2's set, where the README's figures open
const { eng } = world();

/** the thirteen entries SGP4 has down at W0, by catalogue number (names repeat: there are many an OBJECT X), with how; the catalogue and
 *  satellite.js 6.0.1 are both pinned */
const AT_W0: Record<string, 'ground' | 'low'> = {
  '53323': 'low',      // COSMOS 2558
  '48924': 'ground',   // FARADAY_PHOENIX
  '61772': 'ground',   // HYPERVIEW-1G
  '52444': 'ground',   // JILIN-01 GAOFEN 3D 27
  '52445': 'ground',   // JILIN-01 GAOFEN 3D 28
  '48273': 'ground',   // LEMUR 2 SPECIAL K
  '60521': 'ground',   // OBJECT BF
  '54687': 'ground',   // OBJECT F
  '47953': 'low',      // OBJECT X
  '26702': 'ground',   // ODIN
  '58468': 'ground',   // SPIRIT
  '58821': 'ground',   // TAIJING-1 03
  '58925': 'ground'    // WEIHAI 1-02
};
const byNum = (n: string) => {
  const e = CATALOGUE.find(c => c.satnum === n);
  if (!e) throw new Error('not in the catalogue: ' + n);
  return e;
};

describe('decayAt: one SGP4 sample', () => {
  it('calls ODIN decayed at W0 (SGP4 refuses it, error 6), COSMOS 2558 low (still propagated, under 120 km), and KNACKSAT-2 and the ISS neither', () => {
    expect(decayAt(byName('ODIN'), W0, sat, BODY)).toBe('ground');
    expect(decayAt(byName('COSMOS 2558'), W0, sat, BODY)).toBe('low');
    expect(decayAt(byName('KNACKSAT-2'), W0, sat, BODY)).toBeNull();
    expect(decayAt(byName('ISS (ZARYA)'), W0, sat, BODY)).toBeNull();
  });

  it('finds the thirteen at W0 across the whole catalogue, and twelve at the epoch of the README\'s set (COSMOS 2558 not yet)', () => {
    const at = (ms: number) => Object.fromEntries(CATALOGUE.map(e => [e.satnum, decayAt(e, ms, sat, BODY)] as const).filter(([, d]) => d));
    expect(at(W0)).toEqual(AT_W0);
    const early = { ...AT_W0 } as Record<string, string>;
    delete early['53323'];
    expect(at(EPOCH)).toEqual(early);
  });

  it('says what the engine\'s own sample says at that instant: SGP4\'s error 6, or the altitude the engine measures under 120 km', () => {
    for (const ms of [W0, EPOCH, Date.UTC(2026, 9, 5, 12)]) {
      for (const e of CATALOGUE) {
        const track = sgp4Track(BODY, e, sat);
        const s = eng.sampleMs(track, ms);
        const want = s ? (s.alt < eng.REENTRY_KM ? 'low' : null) : (track.lastError === SGP4_DECAYED ? 'ground' : null);
        expect(decayAt(e, ms, sat, BODY), e.name + ' at ' + new Date(ms).toISOString()).toBe(want);
      }
    }
    expect(BODY.reentryAltKm).toBe(eng.REENTRY_KM);   // the body's entry interface is the one compute()'s re-entry test uses
  });

  it('never calls decayed a spacecraft whose window compute() analyses as in orbit: each one is refused, or loads flagged as re-entering', () => {
    let refused = 0;
    for (const n of Object.keys(AT_W0)) {
      let D: ReturnType<typeof eng.compute> | null = null, code: number | null | undefined;
      try { D = eng.compute(byNum(n), W0, 24); } catch (err) { code = (err as { sgp4?: number }).sgp4; }
      if (D) expect(D.reentry, n).not.toBeNull();
      else { expect(code, n).toBe(SGP4_DECAYED); refused++; }
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('does not call decayed a set SGP4 refuses for another reason (STARLINK-2342: error 1, elements out of range), nor one it cannot read', () => {
    const e = byName('STARLINK-2342'), track = sgp4Track(BODY, e, sat);
    expect(track.at(W0)).toBeNull();
    expect(track.lastError).toBe(1);
    expect(decayAt(e, W0, sat, BODY)).toBeNull();
    expect(decayAt({ name: 'NOT A SET', l1: '1 garbage', l2: '2 garbage', satnum: '99999' }, W0, sat, BODY)).toBeNull();
  });

  it('on a body with no atmosphere (no entry interface), counts only SGP4\'s own refusal', () => {
    const airless: Body = { ...BODY, reentryAltKm: null };
    expect(decayAt(byName('COSMOS 2558'), W0, sat, airless)).toBeNull();
    expect(decayAt(byName('ODIN'), W0, sat, airless)).toBe('ground');
  });
});

describe('decayedAt: the catalogue numbers, in slices', () => {
  it('is the same set whether the list goes through in one call or in slices of any size', () => {
    const whole = decayedAt(CATALOGUE, W0, sat, BODY);
    expect([...whole].sort()).toEqual(Object.keys(AT_W0).sort());
    for (const n of [1, 240, 1000]) {
      const into = new Set<string>();
      for (let i = 0; i < CATALOGUE.length; i += n) decayedAt(CATALOGUE, W0, sat, BODY, i, i + n, into);
      expect(into).toEqual(whole);
    }
  });
});

describe('the words', () => {
  it('mark the row "decayed now", and say under the list what that is and that the row is still a pick', () => {
    expect(DECAYED_NOW).toBe('decayed now');
    expect(decayedNote(120)).toBe('Decayed now: at this moment SGP4 has it below the 120 km entry interface, or refuses it as decayed (error 6). '
      + 'It is still listed; picking it asks SGP4 for its whole window.');
    expect(decayedNote(null)).toBe('Decayed now: at this moment SGP4 refuses it as decayed (error 6). It is still listed; picking it asks SGP4 for its whole window.');
  });
});
