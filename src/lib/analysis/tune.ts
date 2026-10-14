import type { Engine, Track } from '../types';

/* What to tune to at one instant: the frequency heard on the ground from a transmitter on the spacecraft, and the
 * frequency to send on so that the spacecraft hears the one it listens on. Both come from the engine's range rate
 * (body-fixed, km/s, + is receding) and nothing else; the engine is only called, so no number it gives can move.
 *
 * Down: the engine's own first-order shift added to the downlink, f + dopplerHz(f, rr) = f (1 - rr/c), the textbook
 * law for a receding source and the same call the pass's Doppler rows make, so the line and the rows agree to the
 * hertz at AOS, culmination and LOS.
 *
 * Up: f / (1 - rr/c). The spacecraft hears what the ground sends shifted by the same law, so this is the frequency
 * that law brings to exactly f on board: the round trip is exact, rx(tx(f)) = f. The first-order alternative,
 * f (1 + rr/c), is short of it by f (rr/c)^2: at a range rate of 7.5 km/s about a quarter of a hertz at 435 MHz
 * and 1.5 Hz at 2.4 GHz, the size of the second-order terms (relativistic among them) that a first-order law leaves
 * out either way. What limits either figure is the element set: near culmination on a high LEO pass the shift at
 * 435 MHz moves by more than 100 Hz a second, so a set one second out along the track is that far out too. */

/** The frequency heard on the ground, Hz, from a transmitter on the spacecraft at f Hz, at a range rate rr km/s. */
export const rxHz = (f: number, rr: number, eng: Pick<Engine, 'dopplerHz'>): number => f + eng.dopplerHz(f, rr)!;

/** The frequency to transmit, Hz, for the spacecraft to hear f Hz, at a range rate rr km/s (c in km/s, the engine's C_KMS). */
export const txHz = (f: number, rr: number, c: number): number => f / (1 - rr / c);

/** How close the clock must be to the wall clock to be called "now": the countdown's test (text/countdown.ts) and the
 *  AR view's. */
export const LIVE_MS = 5000;

/** Whether a figure for the clock's instant is a figure for now: the clock is running, at real time, and within LIVE_MS
 *  of the wall clock. Running matters as much as close: a clock paused a moment ago is within 5 s for 5 s more, and
 *  nothing repaints a paused page, so "now" would stay on a figure going stale. */
export const isLive = (simMs: number, wallMs: number, playing: boolean, rate: number): boolean =>
  playing && rate === 1 && Math.abs(simMs - wallMs) <= LIVE_MS;

export interface Tune {
  /** the instant, ms */
  ms: number;
  /** elevation at the observer, degrees */
  el: number;
  /** range rate, km/s, + receding */
  rr: number;
  /** the downlink as heard on the ground, Hz, or null for no downlink */
  rx: number | null;
  /** the frequency to transmit for the uplink, Hz, or null for no uplink */
  tx: number | null;
}

/** Elevation, range rate and both frequencies at `ms` (Hz in, Hz out; null for a link not given). Null where the
 *  propagation gives no state there (an orbit SGP4 refuses at that instant) or the body declares no rotation. One
 *  propagation: stateAt's rr is rangeRateMs's, from the same state. */
export function tuneAt(
  eng: Pick<Engine, 'stateAt' | 'dopplerHz' | 'C_KMS'>, track: Track, ms: number, down: number | null, up: number | null
): Tune | null {
  const s = eng.stateAt(track, ms);
  if (!s || s.rr === null) return null;
  return {
    ms, el: s.el, rr: s.rr,
    rx: down === null ? null : rxHz(down, s.rr, eng),
    tx: up === null ? null : txHz(up, s.rr, eng.C_KMS)
  };
}
