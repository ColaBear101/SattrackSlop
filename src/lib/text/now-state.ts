/* What the "now" section of the answer rail says about the spacecraft at the clock's instant (CHANGES-FROM-LEGACY.md, L53).
 *
 * New in the rebuild; the old page gave the elevation now and, on the globe's orbital elements layer only, the speed. Under
 * the elevation and the countdown, four figures from lib/analysis/live-state.ts: whether sunlight reaches the spacecraft,
 * its range rate, its speed and the Maidenhead grid square of the point below it, each with a word on what it is. The block
 * (components/rail/NowState.svelte) is a chunk of its own, asked for when it is first in view, and these words come with it:
 * the entry carries neither. */
import type { Lit } from '../types';
import type { LiveState } from '../analysis/live-state';
import { latStr, lonStr } from '../observer';

/** One figure: the id of its value, the label above it, the value, and the word under it. */
export interface NowRow { id: string; label: string; value: string; note: string }

export const SUNLIGHT = 'Sunlight';
/** The shadow state: the value, then what it means. The Earth's shadow is a cone, the umbra, inside a penumbra where the
 *  Earth hides part of the Sun's disc (lib/analysis/optics.ts). The words under each figure are kept short enough for a
 *  phone's half column. */
export const LIT_WORDS: Readonly<Record<Lit, readonly [string, string]>> = {
  sun: ['Sunlit', 'the whole Sun in view'],
  penumbra: ['Penumbra', 'part of the Sun hidden'],
  umbra: ['Eclipsed', 'in the Earth\'s shadow']
};

export const RANGE_RATE = 'Range rate';
/** +3.214 km/s, −0.051 km/s: + is receding, a true minus sign approaching */
export const kmsSigned = (rr: number): string => (rr < 0 ? '−' : '+') + Math.abs(rr).toFixed(3) + ' km/s';
export const RECEDING = 'receding';
export const APPROACHING = 'approaching';

export const SPEED = 'Speed';
/** The speed is the length of the SGP4 velocity in its inertial frame (TEME, which does not turn with the Earth): not the
 *  speed relative to the ground below, which the Earth's turning lowers or raises by up to half a km/s in low orbit. */
export const SPEED_NOTE = 'relative to the stars';

export const BELOW = 'Below it';

const NONE = '—';

/** The four figures, or a dash for each where there is no state (no analysis, or an orbit SGP4 refuses at that instant). */
export function nowRows(s: LiveState | null): NowRow[] {
  const lit = s ? LIT_WORDS[s.lit] : null, rr = s ? s.rr : null;
  return [
    { id: 'now-lit', label: SUNLIGHT, value: lit ? lit[0] : NONE, note: lit ? lit[1] : '' },
    { id: 'now-rr', label: RANGE_RATE, value: rr === null ? NONE : kmsSigned(rr), note: rr === null ? '' : rr < 0 ? APPROACHING : RECEDING },
    { id: 'now-v', label: SPEED, value: s ? s.speed.toFixed(3) + ' km/s' : NONE, note: s ? SPEED_NOTE : '' },
    { id: 'now-grid', label: BELOW, value: s?.grid ?? NONE, note: s ? latStr(s.lat) + ' ' + lonStr(s.lon) : '' }
  ];
}
