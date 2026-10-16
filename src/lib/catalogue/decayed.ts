/* Which element sets SGP4 has come down at one instant: the picker's "decayed now" (CHANGES-FROM-LEGACY.md, L59).
 *
 * The catalogue is a snapshot, and some of what it holds is no longer in orbit. compute() finds that out for the one spacecraft
 * it is asked to analyse, by propagating a whole window and a densely sampled revolution (engine.ts, "Re-entry"), which is far
 * too much to do for 2,158 of them before a list is read. So this asks SGP4 once per entry, at the instant given, through the
 * page's own SGP4 track (core/propagator.ts, which is not touched): the entry is decayed at that instant when SGP4 refuses it
 * with its error 6 (the orbit has met the ground), or when it still gives a position but one below the body's entry interface
 * (Body.reentryAltKm: 120 km for the Earth, the altitude compute()'s own re-entry test uses).
 *
 * One instant is not compute()'s test, and is never offered as it. An eccentric orbit whose perigee SGP4 already puts
 * underground can be well above 120 km at the instant asked, so a set this calls in orbit can still be refused once picked;
 * what compute() says of the window, when the spacecraft is picked, is the answer. A set SGP4 refuses for another reason (its
 * elements out of range: errors 1 to 4) is not called decayed: compute() names that reason itself. Pure, as everything in
 * src/lib: satellite.js and the body are handed in. */
import type * as SatelliteJs from 'satellite.js';
import { sgp4Track } from '../core/propagator';
import type { Body, Tle } from '../types';

/** satellite.js's refusal code for an orbit that has reached the ground */
export const SGP4_DECAYED = 6;

/** What one SGP4 sample says of an element set at an instant: `ground` when SGP4 refuses it with error 6, `low` when it gives a
 *  position below the body's entry interface, and null when it is in orbit there (or refused for a reason other than decay). */
export type Decay = 'ground' | 'low' | null;

export function decayAt(entry: Tle, ms: number, sat: typeof SatelliteJs, body: Body): Decay {
  const track = sgp4Track(body, entry, sat);
  const st = track.at(ms);
  if (!st) return track.lastError === SGP4_DECAYED ? 'ground' : null;
  /* a body with no atmosphere has no entry interface: only SGP4's own refusal counts there */
  if (body.reentryAltKm === null) return null;
  return body.toGeodetic(st.r, body.spin(new Date(ms))).height < body.reentryAltKm ? 'low' : null;
}

/** The catalogue numbers of the entries `from` to `to` (exclusive) that SGP4 has decayed at `ms`, added to `into`. In slices, so a
 *  caller can spread the 2,158 propagations over idle moments; the whole list in one call is `decayedAt(list, ms, sat, body)`. */
export function decayedAt(entries: readonly Tle[], ms: number, sat: typeof SatelliteJs, body: Body,
                          from = 0, to = entries.length, into: Set<string> = new Set()): Set<string> {
  for (let i = from; i < to && i < entries.length; i++) if (decayAt(entries[i]!, ms, sat, body)) into.add(entries[i]!.satnum);
  return into;
}
