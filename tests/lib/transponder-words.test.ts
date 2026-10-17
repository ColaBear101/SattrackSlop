import { describe, expect, it } from 'vitest';
import raw from '../../data/transponders.json';
import { makeTransponders, type Transponder, type TransponderData } from '../../src/lib/data/transponders';
import { heardFor, OFFSET_MAX, parseMHz, type Passband } from '../../src/lib/analysis/transponder';
import { RX, shiftKHz, TX, XPDR_OPEN } from '../../src/lib/text/doppler-live';
import { freqGrouped } from '../../src/lib/text/fmt';
import {
  calFar, calMax, dialName, dialText, fig, HOLDS, modeAndTone, modeLine, notIn, NUDGES, offsetSaid, onBoard, outAmount, outside, shift,
  sourceLine, toneLine, XP_CAL, XP_CAL_HINT, XP_CAL_NOT_NOW, XP_DIAL, XP_FAILED, XP_HEARD, XP_HEARD_BAD, XP_HEARD_NAME, XP_HOLD, XP_LISTEN,
  XP_LOADING, XP_NONE, XP_OFFSET, XP_ON_BOARD, XP_RESET, XP_RETRY, XP_SELECT_NAME, XP_SEND, xpOption
} from '../../src/lib/text/transponder';
import { world } from './helpers';

/* The words of the transponder calculator (CHANGES-FROM-LEGACY.md, L63), src/lib/text/transponder.ts, and the one line of it the entry
   carries (doppler-live.ts's XPDR_OPEN). The figures are written as the live line writes its own (freqGrouped: a narrow no-break space
   between the groups of digits, a no-break space before the unit), so the expectations spell those characters out. */
const T = makeTransponders(raw as unknown as TransponderData);
const one = (sat: number, i: number): Transponder => T.forSat(sat)[i]!;
const NNBSP = ' ', NBSP = ' ';

describe('the disclosure and the record list', () => {
  it('opens from "Uplink and transponders", the only words of it in the entry', () => {
    expect(XPDR_OPEN).toBe('Uplink and transponders');
  });
  it('names a linear passband by its two ranges, the downlink in the order the uplink\'s edges come down on, then its mode', () => {
    expect(xpOption(one(24278, 0))).toBe('145.900–146.000 → 435.900–435.800 MHz inverting  USB');
    expect(xpOption(one(7530, 0))).toBe('145.850–145.950 → 29.400–29.500 MHz  CW');
    expect(xpOption(one(7530, 1))).toBe('145.850–145.950 → 29.400–29.500 MHz  USB');
    expect(xpOption(one(7530, 2))).toBe('432.125–432.175 → 145.975–145.925 MHz inverting  USB');
    expect(xpOption(one(43803, 0))).toBe('435.100–435.120 → 145.875–145.855 MHz inverting  CW');
  });
  it('writes an edge with as many decimals as it needs to be exact (UKUBE 1\'s 435.0743)', () => {
    expect(xpOption(one(40074, 0))).toBe('435.0743–435.0943 → 145.950–145.930 MHz inverting  USB');
  });
  it('tells QO-100\'s band-plan segments apart by their descriptions, which have no mode, and never says FM for a linear passband', () => {
    const q = T.forSat(43700);
    expect(q.map(xpOption)).toEqual([
      '2400.005–2400.040 → 10489.505–10489.540 MHz  CW',
      '2400.040–2400.080 → 10489.540–10489.580 MHz  Narrowband digimodes(500Hz max BW)',
      '2400.080–2400.150 → 10489.580–10489.650 MHz  digimodes(2700Hz max BW)',
      '2400.150–2400.245 → 10489.650–10489.745 MHz  SSB Only Transpoder',
      '2400.255–2400.350 → 10489.755–10489.850 MHz  SSB Only Transpoder',
      '2400.350–2400.495 → 10489.850–10489.995 MHz  Mixed modes(2700Hz max BW)',
      '2400.360 → 10489.860 MHz  USB'
    ]);
    /* the baker writes no mode for a linear passband filed as FM; one that came through anyway is named by its description, and the mode
       line leaves it out */
    const filedFM = { ...q[3]!, mode: 'FM' };
    expect(xpOption(filedFM)).toBe('2400.150–2400.245 → 10489.650–10489.745 MHz  SSB Only Transpoder');
    expect(modeLine(filedFM)).toBe('');
    for (const t of q.slice(1, 6)) expect(modeAndTone(t)).toBe('');
  });
  it('names a pair by its two frequencies and its mode', () => {
    expect(T.forSat(25544).map(xpOption)).toEqual([
      '144.490 → 145.800 MHz  FM', '145.200 → 145.800 MHz  FM', '145.825 → 145.825 MHz  AFSK', '145.990 → 437.800 MHz  FM', '437.825 → 437.825 MHz  AFSK'
    ]);
  });
  it('says what it is waiting for, what failed and what is missing', () => {
    expect(XP_LOADING).toBe('Loading the transponder table…');
    expect(XP_FAILED).toBe('The transponder table did not load.');
    expect(XP_RETRY).toBe('Try again');
    expect(XP_NONE).toBe('No published uplink for this spacecraft: type the frequency it listens on into the Uplink box above.');
    expect(XP_SELECT_NAME).toBe('Transponder or repeater');
  });
});

describe('the mode and the tone', () => {
  it('says the sideband to send through an inverting passband, and one mode where up and down are the same', () => {
    expect(modeLine(one(24278, 0))).toBe('Send LSB, heard as USB');
    expect(modeLine(one(7530, 2))).toBe('Send LSB, heard as USB');
    expect(modeLine(one(7530, 1))).toBe('Mode USB');
    expect(modeLine(one(43803, 0))).toBe('Mode CW');
    expect(modeLine(one(43803, 1))).toBe('Send LSB, heard as USB');
    expect(modeLine(one(25544, 0))).toBe('Mode FM');
    expect(modeLine({ ...one(24278, 0), upMode: '' })).toBe('Send LSB, heard as USB');   // no uplink mode filed: the sideband the inversion gives
  });
  it('gives the record\'s CTCSS tone beside the mode, or alone', () => {
    expect(toneLine(67)).toBe('CTCSS tone 67.0 Hz');
    expect(toneLine(88.5)).toBe('CTCSS tone 88.5 Hz');
    expect(toneLine(0)).toBe('');
    expect(modeAndTone(one(25544, 3))).toBe('Mode FM · CTCSS tone 67.0 Hz');
    expect(modeAndTone(T.forSat(27607)[0]!)).toBe('Mode FM · CTCSS tone 67.0 Hz');
    expect(modeAndTone({ ...one(25544, 3), mode: '' })).toBe('CTCSS tone 67.0 Hz');
    expect(modeAndTone(one(24278, 0))).toBe('Send LSB, heard as USB');
  });
  it('says where the record comes from', () => {
    expect(sourceLine(T.built, one(24278, 0).desc)).toBe('From SatNOGS DB, 2026-10-17 · Mode V/U Linear Transponder');
    expect(sourceLine(T.built, '')).toBe('From SatNOGS DB, 2026-10-17');
  });
});

describe('the hold, the dial and the nudges', () => {
  it('holds one of three, each with what it does, under its own id', () => {
    expect(XP_HOLD).toBe('Hold');
    expect(HOLDS.map(h => [h.value, h.label, h.id])).toEqual([['tx', 'Send', 'xpdr-hold-tx'], ['rx', 'Listen', 'xpdr-hold-rx'], ['sat', 'On board', 'xpdr-hold-sat']]);
    expect(HOLDS[0]!.title).toBe('Keep the frequency you send on where it is; the one you listen on follows');
    expect(HOLDS[1]!.title).toBe('Keep the frequency you listen on where it is; the one you send on follows');
    expect(HOLDS[2]!.title).toBe('Keep the spot in the passband where it is; both frequencies follow, so a contact stays put');
  });
  it('labels the box, and names it for a screen reader with what is held and the unit', () => {
    expect(XP_DIAL).toBe('Held at');
    expect(dialName('tx')).toBe('Frequency to send on, held, in MHz');
    expect(dialName('rx')).toBe('Frequency to listen on, held, in MHz');
    expect(dialName('sat')).toBe('Uplink as the spacecraft hears it, held, in MHz');
  });
  it('writes the held frequency back to the hertz, in the form the box reads', () => {
    expect(dialText(145_950_000)).toBe('145.950000');
    expect(dialText(145_952_000)).toBe('145.952000');
    expect(dialText(29_451_953.51659)).toBe('29.451954');
    expect(dialText(10_489_505_123)).toBe('10489.505123');
    for (const hz of [145_950_000, 435_847_101, 29_400_000, 2_400_005_000, 10_489_995_000, 1]) expect(parseMHz(dialText(hz))).toBe(hz);
  });
  it('nudges by 100 Hz and 1 kHz either way, written with a true minus', () => {
    expect(NUDGES.map(n => [...n])).toEqual([[-1000, '−1 kHz', 'n-1k'], [-100, '−100 Hz', 'n-100'], [100, '+100 Hz', 'p-100'], [1000, '+1 kHz', 'p-1k']]);
  });
});

describe('the figures', () => {
  const { eng } = world();
  const FO29: Passband = { ulLo: 145_900_000, ulHi: 146_000_000, dlLo: 435_800_000, dlHi: 435_900_000, inv: true, linear: true };
  it('has words of its own for its rows, not the live line\'s Transmit and Receive, which sit just above for another frequency', () => {
    expect([XP_SEND, XP_LISTEN, XP_ON_BOARD]).toEqual(['Send on', 'Listen on', 'On board']);
    expect(XP_SEND).not.toBe(TX);
    expect(XP_LISTEN).not.toBe(RX);
  });
  it('writes the figures as the live line does, to the hertz, and the shifts with them (vector 1, FO-29, receding at c x 1e-5)', () => {
    const l = heardFor(FO29, 145_950_000, eng.C_KMS * 1e-5, eng);
    expect(fig).toBe(freqGrouped);
    expect(shift).toBe(shiftKHz);
    expect(fig(l.rx)).toBe('435.847' + NNBSP + '101' + NBSP + 'MHz');
    expect(shift(l.rx - l.fd)).toBe('−4.359 kHz');
    expect(fig(l.tx)).toBe('145.950' + NNBSP + '000' + NBSP + 'MHz');
    expect(shift(l.tx - l.fu)).toBe('+1.460 kHz');
    expect(onBoard(l.fu, l.fd)).toBe('145.948' + NNBSP + '541 → 435.851' + NNBSP + '460' + NBSP + 'MHz');
  });
  it('dashes the On board row for what is not a frequency', () => {
    expect(onBoard(-1, 435e6)).toBe('—');
    expect(onBoard(145e6, NaN)).toBe('—');
    expect(fig(-5)).toBe('—');
  });
  it('says how far outside the passband, in kHz, and in MHz from a megahertz (vector 3, RS-44: 459.36 Hz below)', () => {
    expect(outAmount(459.36, 0)).toBe('0.459 kHz below');
    expect(outAmount(0, 2_837.4)).toBe('2.837 kHz above');
    expect(outAmount(0, 289_850_000)).toBe('289.850 MHz above');
    expect(outAmount(999_999.6, 0)).toBe('1.000 MHz below');
    expect(outAmount(0, 0)).toBe('');
  });
  it('warns, with a glyph, that the spacecraft relays nothing outside its passband, and where the transponder works when far from it', () => {
    expect(outside('below')).toBe('⚠ Outside the passband: the spacecraft hears you below it, and relays nothing.');
    expect(outside('above')).toBe('⚠ Outside the passband: the spacecraft hears you above it, and relays nothing.');
    expect(notIn('uplink', 145_900_000, 146_000_000)).toBe('⚠ Not in this transponder\'s uplink, 145.900–146.000 MHz');
    expect(notIn('downlink', 435_800_000, 435_900_000)).toBe('⚠ Not in this transponder\'s downlink, 435.800–435.900 MHz');
  });
});

describe('the offset', () => {
  it('labels its rows and buttons', () => {
    expect([XP_OFFSET, XP_HEARD, XP_HEARD_NAME, XP_CAL, XP_RESET]).toEqual(['Offset', 'Heard on', 'Frequency you heard yourself on, in MHz', 'Set offset', 'Reset']);
    expect(XP_CAL_HINT).toBe('Send, find yourself on the receiver, type the frequency it shows into Heard on and press Set offset, while the line above says Tune now and the spacecraft hears you inside its passband.');
    expect(XP_CAL_NOT_NOW).toBe('Set offset works only while the line above says Tune now and the spacecraft hears you inside its passband.');
    expect(XP_HEARD_BAD).toBe('Type the frequency you heard yourself on, in MHz, as 435.851460.');
  });
  it('says what a press did: kept, held for the visit, cleared', () => {
    expect(offsetSaid('JAS 2', 400, 'kept')).toBe('Offset for JAS 2 set to +0.400 kHz, kept in this browser.');
    expect(offsetSaid('JAS 2', -1200, 'visit')).toBe('Offset for JAS 2 set to −1.200 kHz for this visit: the browser would not keep it.');
    expect(offsetSaid('OSCAR 7', 0, 'cleared')).toBe('Offset for OSCAR 7 cleared.');
  });
  it('says why it refused: a figure far from the one predicted (an LNB\'s 739.860 MHz), or an offset beyond what it keeps', () => {
    expect(calFar(739_860_000)).toBe('That is 739.860 MHz from the predicted figure: type the frequency your receiver shows for the spacecraft\'s downlink.');
    expect(calFar(-60_123)).toBe('That is 60.123 kHz from the predicted figure: type the frequency your receiver shows for the spacecraft\'s downlink.');
    expect(calMax(62_000, OFFSET_MAX)).toBe('That would put the offset at +62.000 kHz, beyond the 50 kHz this page allows: check the frequency you typed.');
    expect(calMax(-50_001, OFFSET_MAX)).toBe('That would put the offset at −50.001 kHz, beyond the 50 kHz this page allows: check the frequency you typed.');
  });
});
