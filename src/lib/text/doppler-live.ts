/* What the live Doppler line under the downlink box says (CHANGES-FROM-LEGACY.md, L52).
 *
 * New in the rebuild; the old page gave the shift at AOS, culmination and LOS only. The line gives the frequency to
 * tune to at one instant (lib/analysis/tune.ts): the downlink as heard on the ground and, for an uplink typed in, the
 * frequency to send on. It is labelled "now" only while the clock is running at real time within 5 s of the wall
 * clock (the countdown's own test), and then it is worked out for the wall clock; otherwise it names the instant it is
 * for, the clock's, and offers to go live. */
import { whenZ } from './fmt';

/** The caption while the clock is live. */
export const TUNE_NOW = 'Tune now';
/** The caption at any other instant: Tune at sim time 09-14 18:14:07Z */
export const tuneAtSim = (ms: number): string => 'Tune at sim time ' + whenZ(new Date(ms));
/** Added to the caption while the spacecraft is under the mask the passes are found with. */
export const belowMask = (mask: number): string => ' · below the ' + mask + '° mask';

export const GO_LIVE = 'Go live';

export const RX = 'Receive';
export const TX = 'Transmit';
export const UPLINK = 'Uplink';

/** The shift from the frequency it was worked out from, to the hertz: +3.312 kHz, −0.040 kHz. */
export const shiftKHz = (hz: number): string => {
  const t = Math.round(hz);
  return (t < 0 ? '−' : '+') + (Math.abs(t) / 1000).toFixed(3) + ' kHz';
};
