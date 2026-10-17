/* Which element sets SGP4 has come down at one instant: the picker's "decayed now" (CHANGES-FROM-LEGACY.md, L59).
 *
 * The catalogue is a snapshot, and some of what it holds is no longer in orbit. compute() finds that out for the one spacecraft
 * it is asked to analyse, by propagating a whole window and a densely sampled revolution (engine.ts, "Re-entry"), which is far
 * too much to do for 2,158 of them before a list is read. So this asks SGP4 once per entry, at the instant given, through the
 * page's own SGP4 track (core/propagator.ts, which is not touched). The entry is decayed at that instant in three ways:
 *
 *   ground  SGP4 refuses it with its error 6 (the orbit has met the ground);
 *   low     SGP4 still gives a position, but one below the body's entry interface (Body.reentryAltKm: 120 km for the Earth, the
 *           altitude compute()'s own re-entry test uses);
 *   spent   SGP4's drag terms have carried the orbit past what they can model. In SGP4's near-earth theory (periods under 225
 *           minutes) nothing but the drag terms changes the mean orbit's size and shape, and with a positive B* they only shrink
 *           it after the epoch: the semi-major axis goes as a(1 - C1 t - ...)^2 and the eccentricity falls with t. Run far
 *           enough, the eccentricity falls through SGP4's floor, or the polynomial passes zero and grows again. So, for a set
 *           that SGP4 initialised without complaint, with a positive B*, after its epoch: a refusal with any of the codes 1 to 4
 *           (STARLINK-2342 from 11 August 2026, error 1, a day after SGP4 had it under 120 km), or a position above the set's
 *           own apogee (DUCHIFAT 1 at 2,690 km on 28 October 2026, weeks after error 6), is that, not an orbit.
 *
 * Before its epoch, or for a set SGP4 refused when it was read (error 1 to 4 at t = 0), or for a negative or zero B* (an orbit the
 * drag terms raise, or leave alone), or a deep-space orbit (whose eccentricity the Sun and Moon move), a refusal 1 to 4 is not called
 * decayed: compute() names the reason itself. The apogee test allows 1 % over the set's apogee radius; SGP4's short-period terms take a
 * near-earth orbit at most 0.16 % over it in this catalogue before the drag runs out.
 *
 * One instant is not compute()'s test, and is never offered as it. An eccentric orbit whose perigee SGP4 already puts
 * underground can be well above 120 km at the instant asked, so a set this calls in orbit can still be refused once picked; and
 * a set long gone can, for a while as its drag polynomial crosses back through the size it had, sit between 120 km and its
 * apogee. What compute() says of the window, when the spacecraft is picked, is the answer. Pure, as everything in src/lib:
 * satellite.js and the body are handed in. */
import type * as SatelliteJs from 'satellite.js';
import { tleEpochMs } from '../../../shared/tle';
import { sgp4Track } from '../core/propagator';
import type { Body, Tle, Track } from '../types';

/** satellite.js's refusal code for an orbit that has reached the ground */
export const SGP4_DECAYED = 6;
/** SGP4's split between its near-earth and deep-space theories, a period in minutes (read here from the set's own mean motion,
 *  which is within a part in a thousand of the one SGP4 splits on; no decaying orbit is near it) */
export const DEEP_SPACE_MIN = 225;
/** How far over its own apogee radius a decaying near-earth set may be put before the position is the drag terms run out */
export const APOGEE_SLACK = 1.01;

/** What one SGP4 sample says of an element set at an instant: `ground` when SGP4 refuses it with error 6, `low` when it gives a
 *  position below the body's entry interface, `spent` when the drag terms have run past what they model (a refusal 1 to 4, or
 *  a position over the apogee, after the epoch of a near-earth set with a positive B*), and null when it is in orbit there (or
 *  refused for another reason). */
export type Decay = 'ground' | 'low' | 'spent' | null;

/* the fields as satellite.js's twoline2satrec reads them out of the two lines */
const bstarOf = (l1: string): number => parseFloat(l1.substring(53, 54) + '.' + l1.substring(54, 59) + 'E' + l1.substring(59, 61));
const eccOf = (l2: string): number => parseFloat('.' + l2.substring(26, 33));
const revsPerDay = (l2: string): number => parseFloat(l2.substring(52, 63));

/** Does only drag move this set's orbit from here, and only downwards: read cleanly, near-earth, a positive B*, after its epoch? */
function dragOnly(track: Track, entry: Tle, ms: number): boolean {
  return track.ok && bstarOf(entry.l1) > 0 && 1440 / revsPerDay(entry.l2) < DEEP_SPACE_MIN && ms > tleEpochMs(entry.l1);
}

export function decayAt(entry: Tle, ms: number, sat: typeof SatelliteJs, body: Body): Decay {
  const track = sgp4Track(body, entry, sat);
  const st = track.at(ms);
  if (!st && track.lastError === SGP4_DECAYED) return 'ground';
  /* a body with no atmosphere has no entry interface and no drag: only SGP4's own refusal counts there */
  if (body.reentryAltKm === null) return null;
  if (!st) {
    const code = track.lastError;
    return code !== null && code >= 1 && code <= 4 && dragOnly(track, entry, ms) ? 'spent' : null;
  }
  const a = track.recoveredA;
  if (a !== null && Math.hypot(st.r.x, st.r.y, st.r.z) > APOGEE_SLACK * a * (1 + eccOf(entry.l2)) && dragOnly(track, entry, ms)) return 'spent';
  return body.toGeodetic(st.r, body.spin(new Date(ms))).height < body.reentryAltKm ? 'low' : null;
}

/** The catalogue numbers of the entries `from` to `to` (exclusive) that SGP4 has decayed at `ms`, added to `into`. In slices, so a
 *  caller can spread the 2,158 propagations over idle moments; the whole list in one call is `decayedAt(list, ms, sat, body)`. */
export function decayedAt(entries: readonly Tle[], ms: number, sat: typeof SatelliteJs, body: Body,
                          from = 0, to = entries.length, into: Set<string> = new Set()): Set<string> {
  for (let i = from; i < to && i < entries.length; i++) if (decayAt(entries[i]!, ms, sat, body)) into.add(entries[i]!.satnum);
  return into;
}
