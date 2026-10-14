import { describe, expect, it } from 'vitest';
import { isLive, LIVE_MS, rxHz, txHz, tuneAt } from '../../src/lib/analysis/tune';
import { dopRows } from '../../src/lib/analysis/doppler';
import { freqGrouped } from '../../src/lib/text/fmt';
import { belowMask, shiftKHz, TUNE_NOW, tuneAtSim, UPLINK, UPLINK_NAME } from '../../src/lib/text/doppler-live';
import { byName, world } from './helpers';

/* The live Doppler line under the downlink box (CHANGES-FROM-LEGACY.md, L52): the frequency to receive on and the one to send on at
   one instant, from the engine's range rate, which is only called. */
const START = Date.parse('2026-09-12T07:29:09.993Z');
const { eng } = world();
const C = eng.C_KMS;
const D = eng.compute(byName('KNACKSAT-2'), START, 24);
const F = 145_825_000, U = 435_100_000;

describe('the two laws', () => {
  it('leave a frequency alone at a range rate of nought', () => {
    expect(rxHz(F, 0, eng)).toBe(F);
    expect(txHz(U, 0, C)).toBe(U);
  });
  it('shift a receding spacecraft down on the ground, and ask a station to send higher for it; an approaching one the other way', () => {
    expect(rxHz(F, 5, eng)).toBeLessThan(F);
    expect(txHz(U, 5, C)).toBeGreaterThan(U);
    expect(rxHz(F, -5, eng)).toBeGreaterThan(F);
    expect(txHz(U, -5, C)).toBeLessThan(U);
  });
  it('receive is the engine\'s own shift added to the downlink, which is f (1 - rr/c) to well under a millihertz', () => {
    for (const rr of [-7.4, -3.1, 0.25, 6.9]) {
      expect(rxHz(F, rr, eng)).toBe(F + eng.dopplerHz(F, rr)!);
      expect(Math.abs(rxHz(F, rr, eng) - F * (1 - rr / C))).toBeLessThan(1e-3);
    }
  });
  it('transmit is f / (1 - rr/c): what the same law brings down to exactly f on board, so the round trip is exact', () => {
    for (const rr of [-7.4, -3.1, 0.25, 6.9]) {
      expect(Math.abs(rxHz(txHz(U, rr, C), rr, eng) - U)).toBeLessThan(1e-3);
      /* the first-order alternative f (1 + rr/c) is short of it by f (rr/c)^2: under half a hertz at 435 MHz */
      const gap = txHz(U, rr, C) - U * (1 + rr / C);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(0.5);
    }
  });
});

describe('at an instant', () => {
  it('takes the range rate the engine gives at that instant, and the elevation from the same state', () => {
    for (const p of D.passes) {
      for (const ms of [p.aos.getTime(), p.maxAt.getTime(), p.los.getTime(), (p.t0ms + p.t1ms) / 2 + 1234]) {
        const t = tuneAt(eng, D.track, ms, F, U)!;
        expect(t.ms).toBe(ms);
        expect(t.rr).toBe(eng.rangeRateMs(D.track, ms));
        expect(t.el).toBe(eng.stateAt(D.track, ms)!.el);
        expect(t.rx).toBe(rxHz(F, t.rr, eng));
        expect(t.tx).toBe(txHz(U, t.rr, C));
      }
    }
  });
  it('agrees with the pass\'s Doppler rows at AOS, culmination and LOS, to the figure the rows print', () => {
    expect(D.passes.length).toBeGreaterThan(0);
    for (const p of D.passes) {
      const rows = dopRows(p, F, D.track, eng);
      const kHz = (ms: number) => { const v = (tuneAt(eng, D.track, ms, F, null)!.rx! - F) / 1000; return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2); };
      expect(rows[0]![1]).toBe(kHz(p.aos.getTime()) + ' → ' + kHz(p.maxAt.getTime()) + ' → ' + kHz(p.los.getTime()) + ' kHz');
    }
  });
  it('gives no figure for a link not given, and nothing where the propagation gives no state', () => {
    const t = tuneAt(eng, D.track, D.passes[0]!.maxAt.getTime(), null, null)!;
    expect(t.rx).toBeNull();
    expect(t.tx).toBeNull();
    expect(tuneAt({ ...eng, stateAt: () => null }, D.track, START, F, U)).toBeNull();
    expect(tuneAt({ ...eng, stateAt: () => ({ el: 10, az: 0, rng: 900, rr: null }) }, D.track, START, F, U)).toBeNull();
  });
});

describe('now', () => {
  const wall = Date.parse('2026-10-14T12:00:00Z');
  it('is a clock running at real time within 5 s of the wall clock, the countdown\'s test', () => {
    expect(LIVE_MS).toBe(5000);
    expect(isLive(wall, wall, true, 1)).toBe(true);
    expect(isLive(wall - 5000, wall, true, 1)).toBe(true);
    expect(isLive(wall + 5000, wall, true, 1)).toBe(true);
    expect(isLive(wall - 5001, wall, true, 1)).toBe(false);
    expect(isLive(wall + 3_600_000, wall, true, 1)).toBe(false);
  });
  it('is not a paused clock, however close (nothing repaints a paused page), nor one running faster than real time', () => {
    expect(isLive(wall, wall, false, 1)).toBe(false);
    expect(isLive(wall, wall, true, 2)).toBe(false);
    expect(isLive(wall, wall, true, 3600)).toBe(false);
  });
});

describe('the words', () => {
  it('write a frequency to the hertz in MHz, its decimals in threes, with no break inside', () => {
    expect(freqGrouped(145_825_000)).toBe('145.825 000 MHz');
    expect(freqGrouped(145_828_312.4)).toBe('145.828 312 MHz');
    expect(freqGrouped(145_828_312.5)).toBe('145.828 313 MHz');
    expect(freqGrouped(145_999_999.6)).toBe('146.000 000 MHz');
    expect(freqGrouped(2_401_200_007)).toBe('2401.200 007 MHz');
    expect(freqGrouped(10_489_550_000)).toBe('10489.550 000 MHz');
    expect(freqGrouped(500_000)).toBe('0.500 000 MHz');
  });
  it('write no frequency for nought, a negative or not a number', () => {
    for (const x of [0, 0.4, -145e6, NaN, Infinity]) expect(freqGrouped(x)).toBe('—');
  });
  it('give the shift to the hertz in kHz, signed with a true minus, and a shift that rounds to nought as +', () => {
    expect(shiftKHz(3312.2)).toBe('+3.312 kHz');
    expect(shiftKHz(-40)).toBe('−0.040 kHz');
    expect(shiftKHz(-9876.5)).toBe('−9.876 kHz');
    expect(shiftKHz(-0.4)).toBe('+0.000 kHz');
  });
  it('say now, or the instant the figure is for, and the mask', () => {
    expect(TUNE_NOW).toBe('Tune now');
    expect(tuneAtSim(Date.parse('2026-09-14T18:12:07.400Z'))).toBe('Tune at sim time 09-14 18:12:07Z');
    expect(belowMask(5)).toBe(' · below the 5° mask');
  });
  it('name the uplink box with its unit, as the downlink box is named, and begin with the label a reader sees beside it', () => {
    expect(UPLINK_NAME).toBe('Uplink frequency in MHz');
    expect(UPLINK_NAME.startsWith(UPLINK + ' ')).toBe(true);
  });
});
