/* What the transponder calculator under the live Doppler line says (CHANGES-FROM-LEGACY.md, L63).
 *
 * New in the rebuild; the old page had no uplink arithmetic. The panel opens from "Uplink and transponders" (the one line of it the
 * entry carries, XPDR_OPEN, is in doppler-live.ts) and is a chunk of its own with these words, its store and its arithmetic
 * (lib/analysis/transponder.ts). For one record of the baked table (data/transponders.json) it gives the frequency to send on and the
 * one to listen on at the live line's instant, with what the spacecraft hears and sends between them; for a linear passband the
 * reader holds one of the three where it is and the others follow. The panel's rows have words of their own, "Send on" and
 * "Listen on", rather than the live line's "Transmit" and "Receive", which sit just above for another frequency (the downlink chosen
 * in the box and the uplink typed there). */
import { pairMode, type Hold } from '../analysis/transponder';
import type { Transponder } from '../data/transponders';
import { shiftKHz } from './doppler-live';
import { freqGrouped } from './fmt';

export const XP_LOADING = 'Loading the transponder table…';
export const XP_FAILED = 'The transponder table did not load.';
export const XP_RETRY = 'Try again';
/** a spacecraft the table has no record with an uplink for, or an orbit of the reader's own */
export const XP_NONE = 'No published uplink for this spacecraft: type the frequency it listens on into the Uplink box above.';
/** the record list's accessible name */
export const XP_SELECT_NAME = 'Transponder or repeater';

/** MHz, as the downlink list writes them, to three decimals, or as many more as an edge needs to be exact (UKUBE 1's 435.0743) */
const mhz = (hz: number): string => {
  let d = 3;
  while (d < 6 && Math.round(hz) % 10 ** (6 - d) !== 0) d++;
  return (hz / 1e6).toFixed(d);
};
/* what tells one record from another after its frequencies: the downlink mode, or SatNOGS's description where there is none. A linear
   passband filed as FM (SatNOGS files QO-100's SSB and digimode segments so) has its description instead: FM is the one mode such a
   passband does not carry, and the baker drops it too */
const tag = (t: Transponder): string => (t.mode && !(t.linear && t.mode === 'FM') ? t.mode : t.desc);

/** One option of the record list. A linear passband: its uplink, and its downlink in the order the uplink's edges come down on, so an
 *  inverting one reads high to low ("145.900–146.000 → 435.900–435.800 MHz inverting  USB"); a pair: its two frequencies
 *  ("145.990 → 437.800 MHz  FM"). */
export function xpOption(t: Transponder): string {
  const down = !t.linear ? mhz(t.dlLo) : t.inv ? mhz(t.dlHi) + '–' + mhz(t.dlLo) : mhz(t.dlLo) + '–' + mhz(t.dlHi);
  const up = t.linear ? mhz(t.ulLo) + '–' + mhz(t.ulHi) : mhz(t.ulLo);
  const k = tag(t);
  return up + ' → ' + down + ' MHz' + (t.linear && t.inv ? ' inverting' : '') + (k ? '  ' + k : '');
}

/** The hold, the label of the three-way switch, and its three choices with what each does (a pointer's title). */
export const XP_HOLD = 'Hold';
export const HOLDS: readonly { value: Hold; label: string; title: string; id: string }[] = [
  { value: 'tx', label: 'Send', title: 'Keep the frequency you send on where it is; the one you listen on follows', id: 'xpdr-hold-tx' },
  { value: 'rx', label: 'Listen', title: 'Keep the frequency you listen on where it is; the one you send on follows', id: 'xpdr-hold-rx' },
  { value: 'sat', label: 'On board', title: 'Keep the spot in the passband where it is; both frequencies follow, so a contact stays put', id: 'xpdr-hold-sat' }
];
/** the label of the box that holds the held frequency */
export const XP_DIAL = 'Held at';
/** ...and its accessible name, with what is held and the unit */
export const dialName = (h: Hold): string =>
  (h === 'tx' ? 'Frequency to send on' : h === 'rx' ? 'Frequency to listen on' : 'Uplink as the spacecraft hears it') + ', held, in MHz';
/** The held frequency written back into its box: MHz to the hertz, 145.952000. */
export const dialText = (hz: number): string => {
  const t = Math.round(hz);
  return Math.floor(t / 1e6) + '.' + String(t % 1e6).padStart(6, '0');
};
/** The nudges of the held frequency, Hz, with their labels (a true minus, as the shifts are written) and the end of their ids. Buttons,
 *  not the arrow keys: in a text box those move the caret. */
export const NUDGES: readonly (readonly [number, string, string])[] = [
  [-1000, '−1 kHz', 'n-1k'], [-100, '−100 Hz', 'n-100'], [100, '+100 Hz', 'p-100'], [1000, '+1 kHz', 'p-1k']
];

export const XP_SEND = 'Send on';
export const XP_LISTEN = 'Listen on';
export const XP_ON_BOARD = 'On board';
/** A frequency to the hertz, as the live line writes it: 435.847 101 MHz; a dash for what is not a frequency. */
export const fig = freqGrouped;
/** The shift beside a figure, from the frequency it was worked out from: +1.460 kHz. */
export const shift = shiftKHz;
/** The On board row: the uplink the spacecraft hears and the downlink it sends, 145.948 541 → 435.851 460 MHz. */
export const onBoard = (fu: number, fd: number): string => {
  const u = freqGrouped(fu), d = freqGrouped(fd);
  return u === '—' || d === '—' ? '—' : u.replace(/\s+MHz$/, '') + ' → ' + d;
};

/* an amount of frequency, kHz to the hertz, MHz from a megahertz: 0.459 kHz, 289.850 MHz */
const amount = (hz: number): string => {
  const t = Math.round(Math.abs(hz));
  return t >= 1e6 ? (t / 1e6).toFixed(3) + ' MHz' : (t / 1000).toFixed(3) + ' kHz';
};
/** Beside the On board row when the spacecraft hears the uplink outside the passband: how far, and which way. */
export const outAmount = (below: number, above: number): string =>
  below > 0 ? amount(below) + ' below' : above > 0 ? amount(above) + ' above' : '';
/** The warning under it (the amount stays in the row, so that this line, which a screen reader announces, changes only with the side). */
export const outside = (side: 'below' | 'above'): string =>
  '⚠ Outside the passband: the spacecraft hears you ' + side + ' it, and relays nothing.';
/** ...and when the held frequency is not near the transponder at all (another band, or the other leg's frequency typed): the range it
 *  works in, ascending. */
export const notIn = (leg: 'uplink' | 'downlink', lo: number, hi: number): string =>
  '⚠ Not in this transponder\'s ' + leg + ', ' + mhz(lo) + '–' + mhz(hi) + ' MHz';

/** The mode to send and the mode heard: "Send LSB, heard as USB" through an inverting passband, "Mode FM" where they are one; nothing for
 *  a record with no mode, and never FM for a linear passband (see tag above). */
export function modeLine(t: Transponder): string {
  const down = t.linear && t.mode === 'FM' ? '' : t.mode;
  if (!down) return '';
  const up = t.upMode || pairMode(down, t.linear && t.inv);
  return up === down ? 'Mode ' + down : 'Send ' + up + ', heard as ' + down;
}
/** The tone the record names: CTCSS tone 67.0 Hz. */
export const toneLine = (hz: number): string => (hz > 0 ? 'CTCSS tone ' + hz.toFixed(1) + ' Hz' : '');
/** The mode and the tone on one line, either alone where there is only one. */
export const modeAndTone = (t: Transponder): string => [modeLine(t), toneLine(t.tone)].filter(Boolean).join(' · ');

export const XP_OFFSET = 'Offset';
export const XP_HEARD = 'Heard on';
export const XP_HEARD_NAME = 'Frequency you heard yourself on, in MHz';
export const XP_CAL = 'Set offset';
export const XP_RESET = 'Reset';
/** Under the two buttons, always: how the offset is set, and when it can be. */
export const XP_CAL_HINT =
  'Send, find yourself on the receiver, type the frequency it shows into Heard on and press Set offset, while the line above says Tune now and the spacecraft hears you inside its passband.';
/** said for a press of Set offset at any other time */
export const XP_CAL_NOT_NOW = 'Set offset works only while the line above says Tune now and the spacecraft hears you inside its passband.';
/** said for a press with no frequency in the box, or one the page cannot read */
export const XP_HEARD_BAD = 'Type the frequency you heard yourself on, in MHz, as 435.851460.';

/** What a press did, said under the buttons. */
export function offsetSaid(name: string, hz: number, how: 'kept' | 'visit' | 'cleared'): string {
  if (how === 'cleared') return 'Offset for ' + name + ' cleared.';
  return 'Offset for ' + name + ' set to ' + shiftKHz(hz) + (how === 'kept' ? ', kept in this browser.' : ' for this visit: the browser would not keep it.');
}
/** A press refused because the frequency typed is too far from the one predicted to be the reader's own signal (an LNB's intermediate
 *  frequency, another frequency, a mistyped one). */
export const calFar = (hz: number): string =>
  'That is ' + amount(hz) + ' from the predicted figure: type the frequency your receiver shows for the spacecraft\'s downlink.';
/** ...or because the offset it comes to would be beyond what the page keeps. */
export const calMax = (hz: number, max: number): string =>
  'That would put the offset at ' + shiftKHz(hz) + ', beyond the ' + max / 1000 + ' kHz this page allows: check the frequency you typed.';

/** Where the record comes from: From SatNOGS DB, 2026-10-17 · Mode V/U Linear Transponder. */
export const sourceLine = (built: string, desc: string): string => 'From SatNOGS DB, ' + built.slice(0, 10) + (desc ? ' · ' + desc : '');
