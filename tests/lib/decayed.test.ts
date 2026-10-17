import { describe, expect, it } from 'vitest';
import * as satellite from 'satellite.js';
import { APOGEE_SLACK, decayAt, decayedAt, SGP4_DECAYED } from '../../src/lib/catalogue/decayed';
import { sgp4Track } from '../../src/lib/core/propagator';
import { DECAYED_NOW, decayedNote } from '../../src/lib/text/decayed';
import type { Body, Tle } from '../../src/lib/types';
import { BODY, byName, CATALOGUE, world } from './helpers';

/* The picker's "decayed now" (CHANGES-FROM-LEGACY.md, L59): one SGP4 sample per entry, at one instant. Decayed there is SGP4's own
   error 6, a position below the body's 120 km entry interface, or SGP4's drag terms run past what they model (after the epoch of a
   near-earth set with a positive B*: a refusal with error 1 to 4, or a position over the set's own apogee). It is not compute()'s
   test (a window and a densely sampled revolution), so the checks here are that it says what one sample through the engine's own
   path says, and that it never calls decayed a spacecraft whose window, opened at that instant, compute() would analyse as being in
   orbit. The instants are fixed, because what has come down depends on when you ask: W0 is the window verify-catalogue.js drives,
   with COSMOS 2558 still up and ODIN long gone. */
const sat = satellite as never;
const W0 = Date.UTC(2026, 8, 14, 0, 0, 0);
const EPOCH = Date.parse('2026-09-12T07:29:09.993Z');          // KNACKSAT-2's set, where the README's figures open
const LAYOUT = Date.UTC(2026, 9, 5, 12);                        // the clock verify-layout.js and axe.js run on
const { eng } = world();

/** the fourteen entries SGP4 has down at W0, by catalogue number (names repeat: there are many an OBJECT X), with how; the catalogue
 *  and satellite.js 6.0.1 are both pinned */
const AT_W0: Record<string, 'ground' | 'low' | 'spent'> = {
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
  '47883': 'spent',    // STARLINK-2342: error 1, a month after its epoch
  '58821': 'ground',   // TAIJING-1 03
  '58925': 'ground'    // WEIHAI 1-02
};
const byNum = (n: string) => {
  const e = CATALOGUE.find(c => c.satnum === n);
  if (!e) throw new Error('not in the catalogue: ' + n);
  return e;
};
/** the radius of a position and the set's own apogee radius (SGP4's Brouwer a, line 2's e), km */
const radii = (e: Tle, ms: number) => {
  const track = sgp4Track(BODY, e, sat), st = track.at(ms);
  return { r: st ? Math.hypot(st.r.x, st.r.y, st.r.z) : NaN, ra: track.recoveredA! * (1 + parseFloat('.' + e.l2.substring(26, 33))), track };
};

describe('decayAt: one SGP4 sample', () => {
  it('calls ODIN decayed at W0 (SGP4 refuses it, error 6), COSMOS 2558 low (still propagated, under 120 km), STARLINK-2342 spent, and KNACKSAT-2 and the ISS neither', () => {
    expect(decayAt(byName('ODIN'), W0, sat, BODY)).toBe('ground');
    expect(decayAt(byName('COSMOS 2558'), W0, sat, BODY)).toBe('low');
    expect(decayAt(byName('STARLINK-2342'), W0, sat, BODY)).toBe('spent');
    expect(decayAt(byName('KNACKSAT-2'), W0, sat, BODY)).toBeNull();
    expect(decayAt(byName('ISS (ZARYA)'), W0, sat, BODY)).toBeNull();
  });

  it('finds the fourteen at W0 across the whole catalogue, and thirteen at the epoch of the README\'s set (COSMOS 2558 not yet)', () => {
    const at = (ms: number) => Object.fromEntries(CATALOGUE.map(e => [e.satnum, decayAt(e, ms, sat, BODY)] as const).filter(([, d]) => d));
    expect(at(W0)).toEqual(AT_W0);
    const early = { ...AT_W0 } as Record<string, string>;
    delete early['53323'];
    expect(at(EPOCH)).toEqual(early);
  });

  it('says what the engine\'s own sample says at that instant, with the drag rule read off satellite.js\'s own fields (B*, theory, epoch, a, e)', () => {
    let spent = 0;
    for (const ms of [W0, EPOCH, LAYOUT, Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 15)]) {
      for (const e of CATALOGUE) {
        const track = sgp4Track(BODY, e, sat);
        const sr = track.raw as { bstar: number; method: string; jdsatepoch: number; a: number; ecco: number };
        const drag = track.ok && sr.bstar > 0 && sr.method === 'n' && ms > (sr.jdsatepoch - 2440587.5) * 864e5;
        const s = eng.sampleMs(track, ms), code = track.lastError;
        let want: string | null;
        if (!s) want = code === SGP4_DECAYED ? 'ground' : drag && code !== null && code >= 1 && code <= 4 ? 'spent' : null;
        else {
          const st = track.at(ms)!;
          want = drag && Math.hypot(st.r.x, st.r.y, st.r.z) > APOGEE_SLACK * sr.a * BODY.sgp4Re! * (1 + sr.ecco) ? 'spent'
            : s.alt < eng.REENTRY_KM ? 'low' : null;
        }
        if (want === 'spent') spent++;
        expect(decayAt(e, ms, sat, BODY), e.name + ' at ' + new Date(ms).toISOString()).toBe(want);
      }
    }
    expect(spent).toBeGreaterThan(5);
    expect(BODY.reentryAltKm).toBe(eng.REENTRY_KM);   // the body's entry interface is the one compute()'s re-entry test uses
  });

  it('never calls decayed a spacecraft whose window from that instant compute() analyses as in orbit: each is refused, or loads flagged as re-entering', () => {
    /* At these instants. Later the drag runaway itself can be analysed: on 1 November 2026 compute() loads DUCHIFAT 1 with no re-entry
       flag at a mean height of 22,562 km, far over its 200-odd km apogee. The mark ("spent") is right there and the window is not; that
       is compute()'s, and older than the mark. */
    for (const ms of [W0, EPOCH, LAYOUT]) {
      let refused = 0;
      for (const e of CATALOGUE) {
        const d = decayAt(e, ms, sat, BODY);
        if (!d) continue;
        let D: ReturnType<typeof eng.compute> | null = null, code: number | null | undefined;
        try { D = eng.compute(e, ms, 24); } catch (err) { code = (err as { sgp4?: number }).sgp4; }
        const at = e.name + ' at ' + new Date(ms).toISOString();
        if (D) expect(D.reentry, at).not.toBeNull();
        else {
          if (d === 'spent') expect([1, 2, 3, 4], at).toContain(code);     // STARLINK-2342: "error 1: mean eccentricity ... out of range"
          else expect(code, at).toBe(SGP4_DECAYED);
          refused++;
        }
      }
      expect(refused).toBeGreaterThan(0);
    }
  });

  it('calls spent what the drag terms have run past what they model: a refusal 1 to 4 or a position over the apogee, after the epoch of a near-earth set with a positive B*', () => {
    /* STARLINK-2342 (epoch 2026-08-09 07:03, B* 3.4e-4, 16.44 rev/day): read without complaint, at 131 km a day after its epoch, refused with
       error 1 from 11 August (the drag terms take its mean eccentricity below SGP4's floor), and a week before its epoch at 582 km, over
       its apogee, which is SGP4 running the drag backwards, not a runaway */
    const sl = byName('STARLINK-2342'), t = sgp4Track(BODY, sl, sat);
    expect(t.ok).toBe(true);
    expect(t.at(W0)).toBeNull();
    expect(t.lastError).toBe(1);
    expect(decayAt(sl, Date.UTC(2026, 7, 10), sat, BODY)).toBeNull();
    const before = radii(sl, Date.UTC(2026, 7, 1));
    expect(before.r).toBeGreaterThan(APOGEE_SLACK * before.ra);
    expect(decayAt(sl, Date.UTC(2026, 7, 1), sat, BODY)).toBeNull();
    /* DUCHIFAT 1, refused with error 6 from late September, is put at 2,690 km on 28 October: the drag polynomial past zero and growing */
    const du = byName('DUCHIFAT 1'), late = Date.UTC(2026, 9, 28);
    expect(decayAt(du, Date.UTC(2026, 9, 16), sat, BODY)).toBe('ground');
    const far = radii(du, late);
    expect(far.r - BODY.Re).toBeGreaterThan(2000);
    expect(far.r).toBeGreaterThan(APOGEE_SLACK * far.ra);
    expect(decayAt(du, late, sat, BODY)).toBe('spent');
  });

  it('does not call spent a refusal before the epoch, a B* that raises the orbit, a deep-space orbit, or a set SGP4 refused when it was read', () => {
    /* OBJECT X (47953) a week before its epoch: SGP4 refuses it with error 1 */
    const ox = sgp4Track(BODY, byNum('47953'), sat);
    expect(ox.at(Date.UTC(2026, 8, 1))).toBeNull();
    expect(ox.lastError).toBe(1);
    expect(decayAt(byNum('47953'), Date.UTC(2026, 8, 1), sat, BODY)).toBeNull();
    /* and before every epoch in the catalogue (the latest is 2026-09-14), SGP4 refuses some with 1 to 4 and none is called spent */
    const jan = Date.UTC(2026, 0, 1);
    expect(CATALOGUE.filter(e => { const k = sgp4Track(BODY, e, sat); return !k.at(jan) && (k.lastError ?? 0) >= 1 && (k.lastError ?? 0) <= 4; }).length).toBeGreaterThan(20);
    expect(CATALOGUE.some(e => decayAt(e, jan, sat, BODY) === 'spent')).toBe(false);
    /* OBJECT G (69588), B* -0.27: the drag terms raise it, to 199 times its apogee by 2028; that is not a decay */
    const og = radii(byNum('69588'), Date.UTC(2028, 0, 1));
    expect(og.r).toBeGreaterThan(100 * og.ra);
    expect(decayAt(byNum('69588'), Date.UTC(2028, 0, 1), sat, BODY)).toBeNull();
    /* CLUSTER II-FM7, a 53 h orbit (SGP4's deep-space theory) with B* 0: refused with error 1 in 2030, by the Sun and the Moon, not drag */
    const cl = sgp4Track(BODY, byName('CLUSTER II-FM7'), sat);
    expect(cl.at(Date.UTC(2030, 0, 1))).toBeNull();
    expect(cl.lastError).toBe(1);
    expect(decayAt(byName('CLUSTER II-FM7'), Date.UTC(2030, 0, 1), sat, BODY)).toBeNull();
    /* a set SGP4 refused when it was read (error 3 at t = 0) is not called spent when it refuses it again; the same refusal from a
       set it read cleanly is. A stand-in satellite.js, so the code is the one asked for. */
    const standIn = (initError: number) => ({
      twoline2satrec: () => ({ error: initError }),
      propagate: (s: { error: number }) => { s.error = 3; return null; }
    }) as never;
    const sl = byName('STARLINK-2342');
    expect(decayAt(sl, W0, standIn(3), BODY)).toBeNull();
    expect(decayAt(sl, W0, standIn(0), BODY)).toBe('spent');
    /* ...and from a deep-space orbit it is not, even with a positive B* (QZS-2's lines, a 24 h orbit, with B* put at 1e-4) */
    const qz = byName('QZS-2 (MICHIBIKI-2)'), qzDrag = { ...qz, l1: qz.l1.substring(0, 53) + ' 10000-3' + qz.l1.substring(61) };
    expect(qzDrag.l1.length).toBe(qz.l1.length);
    expect(decayAt(qzDrag, W0, standIn(0), BODY)).toBeNull();
    expect(decayAt({ ...sl, l1: sl.l1.substring(0, 53) + '-34182-3' + sl.l1.substring(61) }, W0, standIn(0), BODY)).toBeNull();   // a negative B*
    expect(decayAt({ name: 'NOT A SET', l1: '1 garbage', l2: '2 garbage', satnum: '99999' }, W0, sat, BODY)).toBeNull();
  });

  it('on a body with no atmosphere (no entry interface, no drag), counts only SGP4\'s own refusal', () => {
    const airless: Body = { ...BODY, reentryAltKm: null };
    expect(decayAt(byName('COSMOS 2558'), W0, sat, airless)).toBeNull();
    expect(decayAt(byName('STARLINK-2342'), W0, sat, airless)).toBeNull();
    expect(decayAt(byName('DUCHIFAT 1'), Date.UTC(2026, 9, 28), sat, airless)).toBeNull();
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
  it('mark the row "decayed now", and say under the list what that is, at which instant, and that the row is still a pick', () => {
    expect(DECAYED_NOW).toBe('decayed now');
    expect(decayedNote(120)).toBe("Decayed now: at the clock's instant SGP4 has it below the 120 km entry interface, or refuses it as decayed (error 6), "
      + "or its drag terms have carried it past what they can model (after the set's epoch: refused with error 1 to 4, or put above its own apogee). "
      + 'It is still listed; picking it asks SGP4 for its whole window.');
    expect(decayedNote(null)).toBe("Decayed now: at the clock's instant SGP4 refuses it as decayed (error 6). It is still listed; picking it asks SGP4 for its whole window.");
  });
});
