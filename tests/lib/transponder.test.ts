import { describe, expect, it } from 'vitest';
import raw from '../../data/transponders.json';
import { makeTransponders, type TransponderData } from '../../src/lib/data/transponders';
import { rxHz, txHz, tuneAt } from '../../src/lib/analysis/tune';
import { freqGrouped } from '../../src/lib/text/fmt';
import {
  atSpacecraft, calibrate, calShift, centreFor, clampOffset, defaultHold, dialFor, heardFor, legsFor, mapDown, mapUp,
  OFFSET_MAX, pairLegs, pairMode, parseMHz, readOffsets, sendFor, withOffset, type Legs, type Passband
} from '../../src/lib/analysis/transponder';
import { byName, world } from './helpers';

/* The transponder calculator's arithmetic (src/lib/analysis/transponder.ts): uplink leg R(tx), the transponder's map and the
   spacecraft's offset, downlink leg R(fd); backwards with T. The five vectors were worked by hand from the formulas, not from the
   module, at a range rate of c x 1e-5 either way, so that 1 - rr/c is 0.99999 or 1.00001 and every figure can be checked with a
   pencil. The engine is the real one (tests/lib/helpers.ts). */
const { eng } = world();
const C = eng.C_KMS;
const RR = C * 1e-5;                      // receding at 2.99792458 km/s: beta = 1e-5
const TABLE = makeTransponders(raw as unknown as TransponderData);

const lin = (ulLo: number, ulHi: number, dlLo: number, dlHi: number, inv: boolean): Passband => ({ ulLo, ulHi, dlLo, dlHi, inv, linear: true });
const FO29 = lin(145_900_000, 146_000_000, 435_800_000, 435_900_000, true);          // JAS 2, 24278: V/U inverting
const AO7A = lin(145_850_000, 145_950_000, 29_400_000, 29_500_000, false);           // OSCAR 7, 7530, Mode A: V/A
const AO7B = lin(432_125_000, 432_175_000, 145_925_000, 145_975_000, true);          // OSCAR 7, Mode B: U/V inverting
const RS44 = lin(145_935_000, 145_995_000, 435_610_000, 435_670_000, true);          // BREEZE-KM R/B, 44909
const AO73 = lin(435_130_000, 435_150_000, 145_950_000, 145_970_000, true);          // FUNCUBE 1, 39444
const QO100 = lin(2_400_080_000, 2_400_150_000, 10_489_580_000, 10_489_650_000, false); // ES'HAIL 2, 43700: one of six segments
const ISS: Passband = { ulLo: 145_990_000, ulHi: 145_990_000, dlLo: 437_800_000, dlHi: 437_800_000, inv: false, linear: false };
const LEO = [FO29, AO7A, AO7B, RS44, AO73];
const ALL = [...LEO, QO100];

const near = (got: number, want: number, tol = 1e-3) => expect(Math.abs(got - want), `${got} against ${want}`).toBeLessThan(tol);
const legsNear = (l: Legs, want: { tx: number; fu: number; fd: number; rx: number }) => {
  near(l.tx, want.tx); near(l.fu, want.fu); near(l.fd, want.fd); near(l.rx, want.rx);
};
const S = (p: Passband) => p.ulLo + p.dlHi;
const D = (p: Passband) => p.dlLo - p.ulLo;

describe('the passbands of the vectors', () => {
  it('are the table\'s own records', () => {
    const pick = (n: string, i: number): Passband => {
      const t = TABLE.forSat(n)[i]!;
      return { ulLo: t.ulLo, ulHi: t.ulHi, dlLo: t.dlLo, dlHi: t.dlHi, inv: t.inv, linear: t.linear };
    };
    expect(pick('24278', 0)).toEqual(FO29);
    expect(pick('7530', 0)).toEqual(AO7A);
    expect(pick('7530', 2)).toEqual(AO7B);
    expect(pick('44909', 0)).toEqual(RS44);
    expect(pick('39444', 0)).toEqual(AO73);
    expect(pick('43700', 2)).toEqual(QO100);
    expect(pick('25544', 3)).toEqual(ISS);
  });
});

describe('V1, FO-29: an inverting transponder, receding, the transmitter held at 145.950 000 MHz', () => {
  const want = { tx: 145_950_000, fu: 145_948_540.5, fd: 435_851_459.5, rx: 435_847_100.985405 };
  it('hears the uplink 1,459.5 Hz low, sends S - fu, and is received 4,358.514595 Hz below that', () => {
    const l = heardFor(FO29, 145_950_000, RR, eng);
    legsNear(l, want);
    expect([l.inside, l.below, l.above, l.far]).toEqual([true, 0, 0, false]);
  });
  it('runs backwards from the receive frequency to the same transmitter, through the same two figures on board', () => {
    legsNear(sendFor(FO29, want.rx, RR, eng), want);
  });
  it('moves the receiver by the net shift of about 290 MHz, not 581: the two legs partly cancel', () => {
    expect(S(FO29) - 145_950_000).toBe(435_850_000);
    near(heardFor(FO29, 145_950_000, RR, eng).rx - 435_850_000, -2_899.014595);
  });
});

describe('V2, AO-7 Mode A: a non-inverting transponder, approaching, with an offset of +200 Hz, the transmitter at 145.900 000 MHz', () => {
  const want = { tx: 145_900_000, fu: 145_901_459, fd: 29_451_659, rx: 29_451_953.51659 };
  it('hears the uplink 1,459 Hz high, sends fu + D + 200, and is received 294.51659 Hz above that', () => {
    const l = heardFor(AO7A, 145_900_000, -RR, eng, 200);
    legsNear(l, want);
    expect(l.inside).toBe(true);
  });
  it('runs backwards to the same transmitter with the same offset', () => {
    legsNear(sendFor(AO7A, want.rx, -RR, eng, 200), want);
  });
  it('adds the legs: the receiver is 200 + 1,459 + 294.51659 Hz from tx + D', () => {
    expect(145_900_000 + D(AO7A)).toBe(29_450_000);
    near(heardFor(AO7A, 145_900_000, -RR, eng, 200).rx - 29_450_000, 1_953.51659);
  });
});

describe('V3, RS-44: the dial 1 kHz inside the passband\'s low edge, receding, so the spacecraft hears it outside', () => {
  const want = { tx: 145_936_000, fu: 145_934_540.64, fd: 435_670_459.36, rx: 435_666_102.6554064 };
  it('flags the uplink 459.36 Hz below the passband on board, and still works the figures out', () => {
    const l = heardFor(RS44, 145_936_000, RR, eng);
    legsNear(l, want);
    expect(l.inside).toBe(false);
    near(l.below, 459.36);
    expect([l.above, l.far]).toEqual([0, false]);
  });
  it('gives the same flag run backwards, and none at a range rate of nought: the flag is about the spacecraft, not the dial', () => {
    const b = sendFor(RS44, want.rx, RR, eng);
    legsNear(b, want);
    expect(b.inside).toBe(false);
    near(b.below, 459.36);
    expect(heardFor(RS44, 145_936_000, 0, eng).inside).toBe(true);
  });
});

describe('V4, the ISS voice repeater: a pair, 145.990 -> 437.800 MHz, approaching', () => {
  it('sends T(ulLo) and listens on R(dlLo), each on its own, with no passband to be inside', () => {
    const l = pairLegs(ISS, -RR, eng);
    near(l.tx, 145_988_540.1145988540);
    near(l.rx, 437_804_378);
    expect([l.fu, l.fd, l.inside, l.below, l.above, l.far]).toEqual([145_990_000, 437_800_000, null, 0, 0, false]);
  });
  it('is the same whatever is held or dialled, and takes no offset', () => {
    for (const hold of ['tx', 'rx', 'sat'] as const) expect(legsFor(ISS, hold, 123, -RR, eng, 900)).toEqual(pairLegs(ISS, -RR, eng));
    expect(heardFor(ISS, 145_990_000, -RR, eng, 900).fd).toBe(437_800_000);
  });
});

describe('V5, calibration at V2\'s instant', () => {
  const heard = 29_452_153.51659, pred = 29_451_953.51659;
  it('moves the offset by what the spacecraft\'s downlink was out by, T(heard) - T(pred), to the hertz: 200 + 199.998 -> 400', () => {
    near(calShift(heard, pred, -RR, C), 199.99800002);
    expect(calibrate(200, heard, pred, -RR, C)).toBe(400);
  });
  it('then predicts what was heard, to the whole-hertz rounding', () => {
    const l = heardFor(AO7A, 145_900_000, -RR, eng, 400);
    near(l.fd, 29_451_859);
    near(l.rx, 29_452_153.51859);
    expect(Math.abs(l.rx - heard)).toBeLessThan(0.003);
  });
});

describe('identities', () => {
  it('at a range rate of nought and no offset: rx = tx + D through a non-inverting passband, S - tx through an inverting one, exactly', () => {
    for (const p of ALL) for (const tx of [p.ulLo, (p.ulLo + p.ulHi) / 2, p.ulHi, p.ulLo - 7_000, p.ulHi + 3_000]) {
      const l = heardFor(p, tx, 0, eng);
      expect(l.fu).toBe(tx);
      expect(l.rx).toBe(p.inv ? S(p) - tx : tx + D(p));
      expect(sendFor(p, l.rx, 0, eng).tx).toBe(tx);
    }
    expect(heardFor(AO73, 435_140_000, 0, eng).rx).toBe(145_960_000);
    expect(mapUp(QO100, 2_400_100_000)).toBe(10_489_600_000);
    expect(D(QO100)).toBe(8_089_500_000);
  });
  it('the edges: ulLo comes down on dlLo and ulHi on dlHi, or crossed over when inverting, for every passband in the table', () => {
    const passbands = Object.keys((raw as unknown as TransponderData).x).flatMap(k => TABLE.forSat(k)).filter(t => t.linear);
    expect(passbands.length).toBe(17);
    for (const p of passbands) {
      expect(mapUp(p, p.ulLo)).toBe(p.inv ? p.dlHi : p.dlLo);
      expect(mapUp(p, p.ulHi)).toBe(p.inv ? p.dlLo : p.dlHi);
      expect(mapDown(p, p.inv ? p.dlHi : p.dlLo)).toBe(p.ulLo);
      expect(mapDown(p, p.inv ? p.dlLo : p.dlHi)).toBe(p.ulHi);
      /* equal widths: the centre comes down on the centre, either way */
      expect(mapUp(p, centreFor(p, 'tx'))).toBe(centreFor(p, 'rx'));
    }
  });
  it('the map and its inverse undo each other, inside the passband and out of it', () => {
    for (const p of ALL) for (let k = -3; k <= 13; k++) {
      const f = p.ulLo + k * (p.ulHi - p.ulLo) / 10 + 0.37;
      near(mapDown(p, mapUp(p, f)), f, 1e-5);
    }
    expect(mapUp(ISS, 1)).toBe(437_800_000);
    expect(mapDown(ISS, 1)).toBe(145_990_000);
  });
});

describe('round trips', () => {
  const RRS = [-7.5, -3, -0.1, 0, 0.1, 3, 7.5];
  const OFFS = [-3000, 0, 250];
  it('both ways agree to a millihertz, over the range rates of LEO, three offsets, both kinds and QO-100\'s 10 GHz', () => {
    let n = 0;
    for (const p of ALL) for (const rr of RRS) for (const off of OFFS) for (const k of [-1, 0, 3, 5, 8, 10, 11]) {
      const t = p.ulLo + k * (p.ulHi - p.ulLo) / 10;
      near(sendFor(p, heardFor(p, t, rr, eng, off).rx, rr, eng, off).tx, t);
      const r = p.dlLo + k * (p.dlHi - p.dlLo) / 10;
      near(heardFor(p, sendFor(p, r, rr, eng, off).tx, rr, eng, off).rx, r);
      n++;
    }
    expect(n).toBe(ALL.length * RRS.length * OFFS.length * 7);
  });
  it('the spot held on board gives the transmitter that the spacecraft hears there, and the receiver that hears what it sends', () => {
    for (const p of ALL) for (const rr of RRS) for (const off of OFFS) {
      const fu = centreFor(p, 'sat') + 1234;
      const a = atSpacecraft(p, fu, rr, eng, off);
      expect(a.fu).toBe(fu);
      expect(a.fd).toBe(mapUp(p, fu) + off);
      const h = heardFor(p, a.tx, rr, eng, off);
      near(h.fu, fu); near(h.rx, a.rx);
      near(sendFor(p, a.rx, rr, eng, off).fu, fu);
    }
  });
  it('the spot held on board stays put on board while the range rate changes: only the ground figures move', () => {
    const fds = RRS.map(rr => atSpacecraft(FO29, 145_950_000, rr, eng, 400).fd);
    expect(new Set(fds).size).toBe(1);
    expect(new Set(RRS.map(rr => atSpacecraft(FO29, 145_950_000, rr, eng).tx)).size).toBe(RRS.length);
  });
});

describe('the laws underneath', () => {
  it('the downlink leg is tune.rxHz to the bit, and the uplink step back to the ground is tune.txHz', () => {
    for (const p of ALL) for (const rr of [-7.5, 0.1, 6.2]) {
      const h = heardFor(p, p.ulLo + 5_000, rr, eng, 250);
      expect(h.fu).toBe(rxHz(h.tx, rr, eng));
      expect(h.rx).toBe(rxHz(h.fd, rr, eng));
      const s = sendFor(p, p.dlLo + 5_000, rr, eng, 250);
      expect(s.fd).toBe(txHz(s.rx, rr, C));
      expect(s.tx).toBe(txHz(s.fu, rr, C));
      const a = atSpacecraft(p, p.ulLo + 5_000, rr, eng, 250);
      expect(a.tx).toBe(txHz(a.fu, rr, C));
      expect(a.rx).toBe(rxHz(a.fd, rr, eng));
    }
    const l = pairLegs(ISS, 4.4, eng);
    expect(l.tx).toBe(txHz(ISS.ulLo, 4.4, C));
    expect(l.rx).toBe(rxHz(ISS.dlLo, 4.4, eng));
  });
  it('at a real instant of a real pass the figures are the live line\'s (tuneAt) for the same frequencies, to the bit', () => {
    const START = Date.parse('2026-09-12T07:29:09.993Z');
    const run = eng.compute(byName('JAS 2'), START, 24);
    expect(run.passes.length).toBeGreaterThan(0);
    for (const p of run.passes) for (const ms of [p.aos.getTime(), p.maxAt.getTime(), p.los.getTime()]) {
      const rr = eng.stateAt(run.track, ms)!.rr!;
      const h = heardFor(FO29, 145_950_000, rr, eng);
      expect(h.rx).toBe(tuneAt(eng, run.track, ms, h.fd, null)!.rx);
      expect(h.fu).toBe(tuneAt(eng, run.track, ms, h.tx, null)!.rx);
      const s = sendFor(FO29, h.rx, rr, eng);
      expect(s.tx).toBe(tuneAt(eng, run.track, ms, null, s.fu)!.tx);
      near(s.tx, 145_950_000);
      const q = pairLegs(ISS, rr, eng), t = tuneAt(eng, run.track, ms, ISS.dlLo, ISS.ulLo)!;
      expect([q.tx, q.rx]).toEqual([t.tx, t.rx]);
    }
  });
});

describe('how the two kinds move', () => {
  it('an inverting passband mirrors the dial: a kHz up on the transmitter is a kHz down on the receiver at a range rate of nought; a non-inverting one follows it', () => {
    for (const p of ALL) {
      const t = (p.ulLo + p.ulHi) / 2;
      expect(heardFor(p, t + 1000, 0, eng).rx - heardFor(p, t, 0, eng).rx).toBe(p.inv ? -1000 : 1000);
      /* moving, by (1 - rr/c)^2: the step goes up one leg and down the other */
      const b = 6 / C;
      near(heardFor(p, t + 1000, 6, eng).rx - heardFor(p, t, 6, eng).rx, (p.inv ? -1000 : 1000) * (1 - b) ** 2, 1e-4);
    }
  });
  it('the net shift is about -(fd - fu) rr/c through an inverting passband and -(fu + fd) rr/c through a non-inverting one, to a hertz', () => {
    for (const p of LEO) for (const rr of [-7.5, -2, 2, 7.5]) {
      const tx = (p.ulLo + p.ulHi) / 2;
      const l = heardFor(p, tx, rr, eng);
      const net = l.rx - (p.inv ? S(p) - tx : tx + D(p));
      near(net, (p.inv ? -(l.fd - l.fu) : -(l.fu + l.fd)) * rr / C, 1);
    }
  });
});

describe('the passband flag', () => {
  it('counts the edges as inside, and one hertz beyond either as outside by one hertz on that side', () => {
    for (const p of LEO) {
      for (const tx of [p.ulLo, p.ulHi]) expect(heardFor(p, tx, 0, eng)).toMatchObject({ inside: true, below: 0, above: 0, far: false });
      expect(heardFor(p, p.ulLo - 1, 0, eng)).toMatchObject({ inside: false, below: 1, above: 0, far: false });
      expect(heardFor(p, p.ulHi + 1, 0, eng)).toMatchObject({ inside: false, below: 0, above: 1, far: false });
      /* held on the receiver: an inverting passband's receive edge dlHi is its uplink's low edge */
      const lowEdgeRx = p.inv ? p.dlHi : p.dlLo, step = p.inv ? 1 : -1;
      expect(sendFor(p, lowEdgeRx, 0, eng)).toMatchObject({ inside: true, below: 0 });
      expect(sendFor(p, lowEdgeRx + step, 0, eng)).toMatchObject({ inside: false, below: 1 });
    }
  });
  it('calls an uplink beyond the passband by more than its width, or a figure that is not a frequency, too far to show', () => {
    /* FO-29's downlink typed into the transmit dial: 290 MHz above the passband */
    const typo = heardFor(FO29, 435_850_000, RR, eng);
    expect([typo.inside, typo.far]).toEqual([false, true]);
    expect(typo.above).toBeGreaterThan(289e6);
    /* a dial above S: the inverting map sends below nought */
    const neg = heardFor(FO29, 600_000_000, 0, eng);
    expect(neg.fd).toBeLessThan(0);
    expect(neg.far).toBe(true);
    expect(sendFor(FO29, 600_000_000, 0, eng).far).toBe(true);
    expect(sendFor(FO29, 145_850_000, RR, eng).far).toBe(true);
    /* exactly one width out is still shown (with the outside line); one hertz more is not */
    expect(heardFor(FO29, FO29.ulLo - 100_000, 0, eng)).toMatchObject({ below: 100_000, far: false });
    expect(heardFor(FO29, FO29.ulLo - 100_001, 0, eng).far).toBe(true);
    expect(heardFor(FO29, FO29.ulHi + 100_001, 0, eng).far).toBe(true);
    for (const bad of [NaN, Infinity, 0, -145e6]) expect(heardFor(FO29, bad, RR, eng)).toMatchObject({ inside: false, far: true });
    expect(atSpacecraft(FO29, NaN, RR, eng).far).toBe(true);
  });
});

describe('holding', () => {
  it('holds the lower-frequency leg when a passband is chosen: FO-29, RS-44 and QO-100 the transmitter; AO-73 and AO-7 the receiver', () => {
    expect([FO29, RS44, QO100].map(defaultHold)).toEqual(['tx', 'tx', 'tx']);
    expect([AO73, AO7A, AO7B].map(defaultHold)).toEqual(['rx', 'rx', 'rx']);
  });
  it('starts the dial at the published centre of the held leg, to the hertz', () => {
    expect(centreFor(FO29, 'tx')).toBe(145_950_000);
    expect(centreFor(FO29, 'sat')).toBe(145_950_000);
    expect(centreFor(FO29, 'rx')).toBe(435_850_000);
    expect(centreFor(lin(435_074_300, 435_094_300, 145_930_000, 145_950_000, true), 'tx')).toBe(435_084_300);
    expect(centreFor(lin(100, 103, 200, 203, false), 'tx')).toBe(102);
  });
  it('a change of hold keeps both figures: the new dial is the figure that was showing, to the hertz', () => {
    for (const p of LEO) {
      const l = heardFor(p, centreFor(p, 'tx') + 321, RR, eng, 150);
      const rxDial = dialFor(l, 'rx')!;
      expect(rxDial).toBe(Math.round(l.rx));
      const back = legsFor(p, 'rx', rxDial, RR, eng, 150);
      expect(Math.abs(back.tx - l.tx)).toBeLessThanOrEqual(0.5 + 1e-6);
      const satDial = dialFor(l, 'sat')!;
      expect(satDial).toBe(Math.round(l.fu));
      expect(Math.abs(legsFor(p, 'sat', satDial, RR, eng, 150).rx - l.rx)).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(dialFor(back, 'tx')).toBe(Math.round(back.tx));
    }
    expect(dialFor(heardFor(FO29, 600_000_000, 0, eng), 'rx')).toBeNull();
  });
  it('legsFor gives heardFor, sendFor or atSpacecraft as the hold says', () => {
    expect(legsFor(FO29, 'tx', 145_950_000, RR, eng, 7)).toEqual(heardFor(FO29, 145_950_000, RR, eng, 7));
    expect(legsFor(FO29, 'rx', 435_850_000, RR, eng, 7)).toEqual(sendFor(FO29, 435_850_000, RR, eng, 7));
    expect(legsFor(FO29, 'sat', 145_950_000, RR, eng, 7)).toEqual(atSpacecraft(FO29, 145_950_000, RR, eng, 7));
  });
});

describe('the sideband to send', () => {
  it('is the other one through an inverting passband, and anything else is sent as it comes down', () => {
    expect(pairMode('USB', true)).toBe('LSB');
    expect(pairMode('LSB', true)).toBe('USB');
    for (const m of ['USB', 'LSB', 'CW', 'FM', '']) expect(pairMode(m, false)).toBe(m);
    for (const m of ['CW', 'FM', '', 'AFSK']) expect(pairMode(m, true)).toBe(m);
  });
});

describe('the offset', () => {
  it('is made safe to use: whole hertz, within 50 kHz either way, never -0, nought for what is not a number', () => {
    expect(OFFSET_MAX).toBe(50_000);
    expect(clampOffset(1234.5)).toBe(1235);
    expect(clampOffset(-1234.6)).toBe(-1235);
    expect(clampOffset(60_000)).toBe(50_000);
    expect(clampOffset(-60_000)).toBe(-50_000);
    expect(clampOffset(Infinity)).toBe(50_000);
    expect(clampOffset(-Infinity)).toBe(-50_000);
    expect(clampOffset(NaN)).toBe(0);
    expect(Object.is(clampOffset(-0.4), 0)).toBe(true);
    expect(Object.is(clampOffset(-0), 0)).toBe(true);
  });
  it('is set from what was heard and what was predicted at one instant: (heard - pred) / (1 - rr/c) on board', () => {
    for (const rr of [-7, 0, 5.5]) near(calShift(435_847_400, 435_847_100, rr, C), 300 / (1 - rr / C), 1e-6);
    /* FO-29, held on the transmitter: after a press the prediction is what was heard, to the whole-hertz rounding */
    for (const rr of [-6.5, 0, 6.5]) {
      const pred = heardFor(FO29, 145_950_000, rr, eng, -800).rx, heard = pred + 1_733.2;
      const off = calibrate(-800, heard, pred, rr, C)!;
      expect(off).toBe(Math.round(-800 + 1_733.2 / (1 - rr / C)));
      expect(Math.abs(heardFor(FO29, 145_950_000, rr, eng, off).rx - heard)).toBeLessThanOrEqual(0.5);
    }
    expect(Object.is(calibrate(-300, 435_000_300, 435_000_000, 0, C), 0)).toBe(true);
  });
  it('refuses a figure more than 50 kHz from the prediction (an LNB\'s intermediate frequency, a mistyped digit) instead of clamping it', () => {
    /* QO-100: the receiver's IF typed in place of the downlink */
    expect(calibrate(0, 739_860_000, 10_489_860_000, 0, C)).toBeNull();
    expect(calibrate(0, 435_480_000, 435_848_000, 0, C)).toBeNull();
    expect(calibrate(0, 435_850_000 + 50_001, 435_850_000, 0, C)).toBeNull();
    expect(calibrate(0, 435_850_000 + 50_000, 435_850_000, 0, C)).toBe(50_000);
    expect(calibrate(0, 435_850_000 - 50_000, 435_850_000, 0, C)).toBe(-50_000);
  });
  it('refuses a new offset that would lie beyond 50 kHz, and anything that is not a frequency', () => {
    expect(calibrate(45_000, 435_856_000, 435_850_000, 0, C)).toBeNull();
    expect(calibrate(45_000, 435_844_000, 435_850_000, 0, C)).toBe(39_000);
    expect(calibrate(-45_000, 435_844_000, 435_850_000, 0, C)).toBeNull();
    for (const [h, p] of [[NaN, 435e6], [435e6, NaN], [0, 435e6], [435e6, 0], [-1, 435e6], [Infinity, 435e6]])
      expect(calibrate(0, h!, p!, 0, C)).toBeNull();
    expect(calibrate(NaN, 435e6, 435e6, 0, C)).toBeNull();
    expect(calibrate(0, 435e6, 435e6, NaN, C)).toBeNull();
  });
});

describe('a typed frequency', () => {
  it('reads MHz with a decimal point or one decimal comma, to the hertz, exactly', () => {
    expect(parseMHz('145.950')).toBe(145_950_000);
    expect(parseMHz('145,950')).toBe(145_950_000);
    expect(parseMHz(' 145.9 ')).toBe(145_900_000);
    expect(parseMHz('145')).toBe(145_000_000);
    expect(parseMHz('145.')).toBe(145_000_000);
    expect(parseMHz('145.950001')).toBe(145_950_001);
    expect(parseMHz('10489.995')).toBe(10_489_995_000);
    expect(parseMHz('0.5')).toBe(500_000);
    expect(parseMHz('29.4515')).toBe(29_451_500);
  });
  it('reads the page\'s own figure back, its spaces and its unit included', () => {
    for (const hz of [435_847_101, 145_950_000, 10_489_550_007, 29_451_954, 500_000]) expect(parseMHz(freqGrouped(hz))).toBe(hz);
    expect(parseMHz('435.847 101 MHz')).toBe(435_847_101);
    expect(parseMHz('145.950mhz')).toBe(145_950_000);
  });
  it('gives nothing for anything else, so the figures show dashes rather than a frequency the reader did not mean', () => {
    for (const s of ['', ' ', '145.95.5', '1e3', '0', '0.000', '-145.9', '+145.9', '.5', '145,950,5', '1,450.5', '145.9500001',
      '123456', 'abc', '145 950', 'Infinity', 'NaN', '0x10', '145.95abc', '145.95 kHz', 'MHz'])
      expect(parseMHz(s), JSON.stringify(s)).toBeNull();
  });
});

describe('the kept offsets', () => {
  it('read nothing from anything that is not an object of NORAD numbers and finite numbers', () => {
    for (const s of [null, '', 'x', '[]', '[1,2]', 'null', '5', '"24278"', '{"07530":1}', '{"7530":"1"}', '{"7530":1e999}',
      '{"7530":0}', '{"7530":-0.4}', '{"7530":null}', '{"0":5}', '{"1234567890":5}', '{"O0001":5}', '{"__proto__":5}', '{"7530":{"a":1}}'])
      expect(readOffsets(s), String(s)).toEqual({});
    expect(Object.getPrototypeOf(readOffsets('{"__proto__":{"x":1}}'))).toBe(Object.prototype);
  });
  it('read each good entry, made safe, and leave the bad ones out', () => {
    expect(readOffsets('{"24278":400,"7530":-1200}')).toEqual({ 7530: -1200, 24278: 400 });
    expect(readOffsets('{"7530":60000,"24278":-0.4,"44909":12.6,"x":3}')).toEqual({ 7530: 50_000, 44909: 13 });
  });
  it('keep 200 at most', () => {
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [String(i + 1), 100]));
    const got = readOffsets(JSON.stringify(many));
    expect(Object.keys(got).length).toBe(200);
    expect(got['200']).toBe(100);
    expect(got['201']).toBeUndefined();
  });
  it('change one spacecraft in a copy, take it out at nought, and leave the original as it was', () => {
    const m = Object.freeze({ 7530: 200 }) as Readonly<Record<string, number>>;
    expect(withOffset(m, '24278', 400)).toEqual({ 7530: 200, 24278: 400 });
    expect(withOffset(m, '7530', 0)).toEqual({});
    expect(withOffset(m, '7530', 0.3)).toEqual({});
    expect(withOffset(m, '7530', 60_000)).toEqual({ 7530: 50_000 });
    expect(withOffset(m, '7530', -99.5)).toEqual({ 7530: -99 });
    expect(withOffset(m, '07530', 5)).toEqual({ 7530: 200 });
    expect(withOffset(m, 'O0001', 5)).toEqual({ 7530: 200 });
    expect(withOffset(m, '7530', 200)).not.toBe(m);
    expect(m).toEqual({ 7530: 200 });
    expect(readOffsets(JSON.stringify(withOffset(m, '24278', 400)))).toEqual({ 7530: 200, 24278: 400 });
  });
});
