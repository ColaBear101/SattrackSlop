import { rxHz, txHz } from './tune';
import type { Engine } from '../types';

/* What to send and where to listen through a satellite's transponder at one instant: the arithmetic under the transponder
 * calculator, built on tune.ts's two laws and nothing else. Nothing imports it yet; the panel that will comes with its own
 * ledger row.
 *
 * Three steps, in the order the signal takes them:
 *  1. the uplink leg. The spacecraft hears what the ground sends shifted by the same law the ground hears the spacecraft by
 *     (the shift belongs to the closing speed, not to who is sending): fu = R(tx) = tx (1 - rr/c), tune.rxHz;
 *  2. the transponder's map from what it hears to what it sends, M. A LINEAR passband maps its uplink range onto its downlink
 *     range point for point (the table's ranges have equal widths), either without inverting, fu + D with D = dlLo - ulLo, or
 *     inverting, S - fu with S = ulLo + dlHi: the uplink's low edge comes down on the downlink's high edge, and a USB signal
 *     comes down as LSB. A single-frequency PAIR (an FM repeater, a digipeater) sends on its one downlink whatever it hears in
 *     its channel. Then the spacecraft's own offset, off Hz, the amount its oscillator puts the downlink out by, added to what
 *     it sends (set from the frequency a station hears itself on: calibrate);
 *  3. the downlink leg: rx = R(fd), tune.rxHz itself, so the receive figure is the live line's to the bit for the same
 *     downlink at the same instant.
 * Backwards, a receive frequency held and the transmit frequency wanted, the same steps run in reverse with tune.txHz,
 * T(f) = f / (1 - rr/c), R's exact inverse: fd = T(rx), fu = M^-1(fd - off), tx = T(fu). The two directions agree to a
 * millihertz, at QO-100's 10 GHz too.
 *
 * Why the kinds behave so differently: through a non-inverting transponder the two legs' shifts add,
 * rx - (tx + D) ~ -(fu + fd) rr/c; through an inverting one they partly cancel, rx - (S - tx) ~ -(fd - fu) rr/c, which is
 * why V/U and U/V transponders invert (FO-29's net shift is that of about 290 MHz, not of 581). Both legs take the range
 * rate of one instant. Over the light time between them (milliseconds in LEO) the range rate moves by at most about v^2/c,
 * 2e-4 km/s whatever the range (it changes fastest, v^2/range, where the light time, range/c, is shortest), so 0.3 Hz at
 * 435 MHz: far under what the element set limits (tune.ts: more than 100 Hz a second near culmination).
 *
 * Pure: the engine is only called (its dopplerHz through rxHz, its C_KMS for txHz), so no number it gives can move. Display
 * only: nothing here talks to a radio. */

/** A transponder's two ranges, Hz; the table's Transponder (lib/data/transponders.ts) is one. A linear passband has a range on
 *  both legs; a pair has ulHi === ulLo and dlHi === dlLo, and its `inv` means nothing. */
export interface Passband { ulLo: number; ulHi: number; dlLo: number; dlHi: number; inv: boolean; linear: boolean }

/** What the arithmetic needs of the engine: its first-order shift (for R) and its speed of light, km/s (for T). */
export type Eng = Pick<Engine, 'dopplerHz' | 'C_KMS'>;

/** One instant's four frequencies, Hz, in the order the signal takes them, and where the uplink falls in the passband. */
export interface Legs {
  /** what the ground transmits */
  tx: number;
  /** what the spacecraft hears: the uplink on board */
  fu: number;
  /** what the spacecraft sends: the downlink on board, its offset included */
  fd: number;
  /** what the ground receives */
  rx: number;
  /** the spacecraft hears the uplink inside the passband given, edges included (so its downlink, before the offset, is inside
   *  the downlink passband too); null for a pair, which has a channel, not a passband. Give the whole transponder
   *  (passbandOf), not one segment of its band plan, or a dial the spacecraft relays is called outside. */
  inside: boolean | null;
  /** how far below the passband's low edge, or above its high edge, the spacecraft hears the uplink, Hz; 0 when it is not */
  below: number;
  above: number;
  /** no figure worth showing: the uplink lies beyond the passband by more than the passband's own width (another band, or the
   *  other leg's frequency typed into the dial), or one of the four is not a positive frequency (an inverting map takes a dial
   *  above S below nought). Never for a pair. */
  far: boolean;
}

/** Which figure the reader keeps where it is while the other follows: the transmit frequency, the receive frequency, or the
 *  spot in the passband the spacecraft hears (both ground figures follow, so a contact stays put on board). */
export type Hold = 'tx' | 'rx' | 'sat';

/** The largest offset a spacecraft is given, Hz, either way. A transponder's oscillator drifts by a few kHz at most; a figure
 *  beyond this is a mistyped frequency or a receiver's own error (an LNB's), which belongs in the receiver's setting. */
export const OFFSET_MAX = 50_000;

/** M: the downlink the spacecraft sends for the uplink fu it hears, Hz, before its offset. */
export function mapUp(p: Passband, fu: number): number {
  if (!p.linear) return p.dlLo;
  return p.inv ? (p.ulLo + p.dlHi) - fu : fu + (p.dlLo - p.ulLo);
}

/** M^-1: the uplink the spacecraft must hear for it to send fd, Hz (fd before the offset). For a pair, its one uplink. */
export function mapDown(p: Passband, fd: number): number {
  if (!p.linear) return p.ulLo;
  return p.inv ? (p.ulLo + p.dlHi) - fd : fd - (p.dlLo - p.ulLo);
}

/** The widest gap between two segments of one band plan that still counts as inside the transponder, Hz. QO-100 leaves
 *  10 kHz around its middle beacon (2400.245-2400.255 MHz up, 10489.745-10489.755 down): the transponder relays it, but
 *  the table files the segments either side as separate records. */
export const GUARD_MAX = 25_000;

/* the constant of a linear passband's map, Hz: D for a non-inverting one, S for an inverting one */
const mapConst = (p: Passband): number => p.inv ? p.ulLo + p.dlHi : p.dlLo - p.ulLo;

/** The whole transponder a record belongs to, for the passband flag: the table files a band plan as several records (QO-100's
 *  one 2400.005-2400.495 MHz passband is six segments, CW, digimodes, SSB, mixed), and a dial in the SSB segment while the CW
 *  record is chosen is still relayed. The records of one spacecraft (`all`) that are linear, invert alike and share the map's
 *  constant to the hertz (D, or S) are one transponder where their uplinks overlap, touch or leave a gap of at most
 *  GUARD_MAX; the result spans those chained to `p`, `p` included. Its map is `p`'s exactly (the same D or S, in whole hertz),
 *  so every figure is the same to the bit; only `inside`, `below`, `above` and `far` are measured against the whole span. A
 *  pair is returned as it is. */
export function passbandOf(p: Passband, all: readonly Passband[]): Passband {
  if (!p.linear) return p;
  const k = mapConst(p);
  const kin = all.filter(q => q.linear && q.inv === p.inv && mapConst(q) === k);
  let lo = p.ulLo, hi = p.ulHi, grew = true;
  while (grew) {
    grew = false;
    for (const q of kin) {
      if (q.ulLo > hi + GUARD_MAX || q.ulHi < lo - GUARD_MAX || (q.ulLo >= lo && q.ulHi <= hi)) continue;
      lo = Math.min(lo, q.ulLo); hi = Math.max(hi, q.ulHi); grew = true;
    }
  }
  return p.inv ? { ulLo: lo, ulHi: hi, dlLo: k - hi, dlHi: k - lo, inv: true, linear: true }
    : { ulLo: lo, ulHi: hi, dlLo: lo + k, dlHi: hi + k, inv: false, linear: true };
}

const positive = (f: number): boolean => Number.isFinite(f) && f > 0;

/* the four figures with the passband flag: inside, how far out on which side, and whether too far out to show */
function legs(p: Passband, tx: number, fu: number, fd: number, rx: number): Legs {
  if (!p.linear) return { tx, fu, fd, rx, inside: null, below: 0, above: 0, far: false };
  const below = fu < p.ulLo ? p.ulLo - fu : 0;
  const above = fu > p.ulHi ? fu - p.ulHi : 0;
  const width = p.ulHi - p.ulLo;
  return {
    tx, fu, fd, rx, inside: fu >= p.ulLo && fu <= p.ulHi, below, above,
    far: !(positive(tx) && positive(fu) && positive(fd) && positive(rx)) || below > width || above > width
  };
}

/** The transmit frequency held: what the spacecraft hears, what it sends and what the ground receives, at a range rate rr km/s
 *  (+ receding) with the spacecraft's offset `off` Hz. A pair takes no offset. */
export function heardFor(p: Passband, tx: number, rr: number, eng: Eng, off = 0): Legs {
  const fu = rxHz(tx, rr, eng);
  const fd = mapUp(p, fu) + (p.linear ? off : 0);
  return legs(p, tx, fu, fd, rxHz(fd, rr, eng));
}

/** The receive frequency held: the same steps backwards, so heardFor(p, sendFor(p, rx, ...).tx, ...).rx is rx again. */
export function sendFor(p: Passband, rx: number, rr: number, eng: Eng, off = 0): Legs {
  const fd = txHz(rx, rr, eng.C_KMS);
  const fu = mapDown(p, fd - (p.linear ? off : 0));
  return legs(p, txHz(fu, rr, eng.C_KMS), fu, fd, rx);
}

/** The spot in the passband held, fu as the spacecraft hears it: transmit T(fu), and receive what it sends for it. */
export function atSpacecraft(p: Passband, fu: number, rr: number, eng: Eng, off = 0): Legs {
  const fd = mapUp(p, fu) + (p.linear ? off : 0);
  return legs(p, txHz(fu, rr, eng.C_KMS), fu, fd, rxHz(fd, rr, eng));
}

/** A pair, which has nothing to hold: transmit T(ulLo) so that the spacecraft hears its channel, and receive R(dlLo), the two
 *  independent of each other (what the live line does for a typed uplink and the chosen downlink). */
export function pairLegs(p: Passband, rr: number, eng: Eng): Legs {
  return { tx: txHz(p.ulLo, rr, eng.C_KMS), fu: p.ulLo, fd: p.dlLo, rx: rxHz(p.dlLo, rr, eng), inside: null, below: 0, above: 0, far: false };
}

/** The figures for what is held: `hz` is the transmit frequency, the receive frequency or the uplink on board, as `hold` says.
 *  A pair ignores both and gives pairLegs. */
export function legsFor(p: Passband, hold: Hold, hz: number, rr: number, eng: Eng, off = 0): Legs {
  if (!p.linear) return pairLegs(p, rr, eng);
  return hold === 'tx' ? heardFor(p, hz, rr, eng, off) : hold === 'rx' ? sendFor(p, hz, rr, eng, off) : atSpacecraft(p, hz, rr, eng, off);
}

/** The dial for a newly chosen hold, keeping both figures where they are: the held figure of `l`, to the hertz; null when it is
 *  not a positive frequency. */
export function dialFor(l: Legs, hold: Hold): number | null {
  const f = hold === 'tx' ? l.tx : hold === 'rx' ? l.rx : l.fu;
  return positive(f) ? Math.round(f) : null;
}

/** The published centre of the held leg's passband, to the hertz: where the dial starts when a passband is chosen. */
export function centreFor(p: Passband, hold: Hold): number {
  return Math.round(hold === 'rx' ? (p.dlLo + p.dlHi) / 2 : (p.ulLo + p.ulHi) / 2);
}

/** The leg to hold when a passband is chosen: the lower-frequency one, which has the smaller shift, so the reader follows on
 *  the other (the usual practice: FO-29 and RS-44 hold the 2 m transmitter, AO-73 and AO-7 the receiver). */
export function defaultHold(p: Passband): 'tx' | 'rx' {
  return p.ulLo + p.ulHi < p.dlLo + p.dlHi ? 'tx' : 'rx';
}

/** The mode to send for a downlink mode: an inverting passband turns USB into LSB and back, so the uplink is the other
 *  sideband; anything else (CW, FM, a non-inverting passband) is sent as it comes down. */
export function pairMode(mode: string, inv: boolean): string {
  if (!inv) return mode;
  return mode === 'USB' ? 'LSB' : mode === 'LSB' ? 'USB' : mode;
}

/** An offset made safe to use, Hz: to the hertz, within +-OFFSET_MAX, never -0, and 0 for what is not a number. */
export function clampOffset(hz: number): number {
  if (Number.isNaN(hz)) return 0;
  const r = Math.round(Math.min(OFFSET_MAX, Math.max(-OFFSET_MAX, hz)));
  return r === 0 ? 0 : r;
}

/** How far the spacecraft's downlink was from the one predicted, Hz, on board, when the ground heard `heard` where `pred` was
 *  predicted at the same instant (range rate rr km/s, c km/s): T(heard) - T(pred) = (heard - pred) / (1 - rr/c). */
export const calShift = (heard: number, pred: number, rr: number, c: number): number => txHz(heard, rr, c) - txHz(pred, rr, c);

/** The new offset, Hz, from the frequency a station heard itself on (`heard`) and the receive frequency predicted for the same
 *  instant with the old offset (`pred`, at range rate rr): off + calShift, to the hertz. Null, refused, when either is not a
 *  positive frequency, when the two are more than OFFSET_MAX apart on board (a mistyped figure, another frequency, an LNB's
 *  intermediate frequency), or when the new offset would lie beyond OFFSET_MAX: a measured figure is never clamped, because
 *  the offset kept would then not be the one heard. Pred and rr must be of one instant, the one `heard` was read at. */
export function calibrate(off: number, heard: number, pred: number, rr: number, c: number): number | null {
  if (!Number.isFinite(off) || !Number.isFinite(rr) || !(c > 0) || !positive(heard) || !positive(pred)) return null;
  const shift = calShift(heard, pred, rr, c);
  const next = Math.round(off + shift);
  if (!(Math.abs(shift) <= OFFSET_MAX) || !(Math.abs(next) <= OFFSET_MAX)) return null;
  return next === 0 ? 0 : next;
}

/* A frequency box's text: whole MHz, a decimal point or one decimal comma (the comma-decimal keypads of de, fr, pl...), up to
   six decimals (the hertz). Spaces inside the decimals and a trailing "MHz" are allowed, so the page's own figure
   ("435.847 101 MHz") pastes back in. */
const MHZ_TEXT = /^(\d{1,5})(?:\.(\d{0,6}))?$/;

/** The hertz in a typed frequency in MHz, exactly (no floating-point multiply), or null for anything else: "145,950" and
 *  "145.950" are 145,950,000; "145.95.5", "1e3", "", "0" and a seventh decimal are null, so the figures show dashes rather
 *  than a frequency the reader did not mean. */
export function parseMHz(s: string): number | null {
  let t = String(s).trim().replace(/\s*MHz$/i, '');
  if (t.indexOf(',') !== -1 && t.indexOf(',') === t.lastIndexOf(',')) t = t.replace(',', '.');
  const dot = t.indexOf('.');
  if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\s/g, '');
  const m = MHZ_TEXT.exec(t);
  if (!m) return null;
  const hz = Number(m[1]) * 1e6 + Number((m[2] ?? '').padEnd(6, '0'));
  return hz > 0 ? hz : null;
}

/* The kept offsets: gt.xpdr, {"<NORAD number without leading zeros>": Hz}. Storage is not trusted: another version of the page,
   another tab or the reader may have written anything there. */
const NORAD_KEY = /^[1-9]\d{0,8}$/;
const OFFSETS_KEPT = 200;

/** The key a spacecraft's offset is kept under: its NORAD number without leading zeros, as the transponder table's loader
 *  reads one ("07530", the catalogue's own field for OSCAR 7, and 7530 are one object), or null for what is not a NORAD
 *  number (an orbit of the reader's own, O0001; nought). */
export function offsetKey(satnum: string | number): string | null {
  const s = String(satnum).trim();
  const k = /^\d+$/.test(s) ? String(Number(s)) : s;
  return NORAD_KEY.test(k) ? k : null;
}

/** A spacecraft's kept offset, Hz, looked up by the same satnum offsetKey takes; 0 when none is kept. */
export function offsetOf(m: Readonly<Record<string, number>>, satnum: string | number): number {
  const k = offsetKey(satnum);
  return k !== null && Object.prototype.hasOwnProperty.call(m, k) ? m[k]! : 0;
}

/** The offsets in a stored text: each NORAD-numbered key with a finite number, made safe (clampOffset), zeros left out, the
 *  first 200 at most; anything that is not such an object gives none. A key with a leading zero is left out too: withOffset
 *  never writes one, and taking it would leave "07530" and "7530" to fight over one spacecraft. */
export function readOffsets(raw: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === null) return out;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return out; }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, hz] of Object.entries(v as Record<string, unknown>)) {
    if (n >= OFFSETS_KEPT) break;
    if (!NORAD_KEY.test(k) || typeof hz !== 'number' || !Number.isFinite(hz)) continue;
    const c = clampOffset(hz);
    if (c !== 0) { out[k] = c; n++; }
  }
  return out;
}

/** A copy of the offsets with one spacecraft's set to `hz` (made safe), or taken out when that is 0; the original untouched.
 *  The spacecraft is named as offsetKey takes it, so the catalogue's "07530" is kept under "7530". Null, nothing to keep, for
 *  a satnum that is not a NORAD number: the caller says so rather than report an offset kept. */
export function withOffset(m: Readonly<Record<string, number>>, satnum: string | number, hz: number): Record<string, number> | null {
  const key = offsetKey(satnum);
  if (key === null) return null;
  const out: Record<string, number> = { ...m };
  const c = clampOffset(hz);
  if (c === 0) delete out[key];
  else out[key] = c;
  return out;
}
