import type { Engine, Lit, Optics, Track } from '../types';
import { toLocator } from '../maidenhead';

/* The spacecraft's state at one instant, for the "now" section of the answer rail (CHANGES-FROM-LEGACY.md, L53): whether
 * sunlight reaches it, how fast its distance from the observer is changing, how fast it moves, and the grid square of the
 * point on the ground below it.
 *
 * New in the rebuild; nothing here is new arithmetic. One propagation, the engine's fix(), gives the state, and every
 * figure is read from it by code the page already runs: the sub-satellite point by the engine's subPoint (what sampleMs
 * does after the same fix), the range rate by its rangeRateAt (what rangeRateMs does after it: body-fixed, + receding),
 * the speed as the length of the SGP4 velocity, and the shadow by the optical code's sunlitState, which is what opticalAt
 * asks of the same state (a conical umbra and its penumbra). The engine and the optics are only called, so no number they
 * give can move.
 *
 * The speed is INERTIAL: the length of the velocity SGP4 gives in its own frame (TEME), the figure the globe's orbital
 * elements layer prints as v. It is not the speed relative to the turning Earth: that is lower for a prograde orbit and
 * higher for a retrograde one, by up to the frame's own speed there, omega r (0.49 km/s at 400 km over the equator).
 *
 * While the clock plays, the shadow is tested at most once per second of the clock (LIT_EVERY_MS): at real time, once a
 * second, while the figures beside it follow every tick. A Sun is worked out for the test, and a LEO spacecraft takes 8 s
 * or more to cross the penumbra (the Sun is half a degree across, and the orbit turns about 0.065 deg a second), so a
 * second is finer than the state it reports changes. A seek of a second or more, or another track, tests it again at
 * once; the instant the state is for is kept with it (litMs). A reading marked fresh (the clock paused, which publishes
 * no more ticks, so whatever it shows stays on the page) is tested at its own instant whenever that differs from the last
 * test's: a pause or a short scrub would otherwise leave the shadow of up to a second earlier beside the figures of the
 * paused instant, for as long as the pause lasts, at the moment a student stopped the clock to see.
 *
 * Pure: no DOM, no globals. */

/** How far the clock must move, ms, before the shadow is tested again. */
export const LIT_EVERY_MS = 1000;

export interface LiveState {
  /** the instant, ms */
  ms: number;
  /** range rate, km/s, + receding (body-fixed: the observer at rest); null for a body that declares no rotation */
  rr: number | null;
  /** speed, km/s: the length of the SGP4 velocity (inertial, TEME) */
  speed: number;
  /** the sub-satellite point: geodetic latitude and longitude, degrees, and altitude, km */
  lat: number;
  lon: number;
  alt: number;
  /** the Maidenhead locator of the sub-satellite point, six characters */
  grid: string | null;
  /** whether sunlight reaches the spacecraft: 'sun', 'penumbra' or 'umbra' */
  lit: Lit;
  /** the instant the shadow was tested at, ms: within LIT_EVERY_MS of `ms`, and `ms` itself for a fresh reading */
  litMs: number;
}

export type LiveEngine = Pick<Engine, 'fix' | 'subPoint' | 'rangeRateAt'>;
export type LiveOptics = Pick<Optics, 'sunlitState'>;
/** `fresh`: the shadow must be the one at `ms` itself (the clock is paused); otherwise it may be up to LIT_EVERY_MS old. */
export type LiveRead = (eng: LiveEngine, optics: LiveOptics, track: Track, ms: number, fresh?: boolean) => LiveState | null;

/** A reader of the state at an instant that keeps the last shadow test, so it can be asked on every tick of the clock.
 *  Null where the propagation gives no state (an orbit SGP4 refuses at that instant). */
export function liveReader(): LiveRead {
  let last: { track: Track; ms: number; lit: Lit } | null = null;
  return (eng, optics, track, ms, fresh = false) => {
    const s = eng.fix(track, ms);
    if (!s) return null;
    if (!last || last.track !== track || Math.abs(ms - last.ms) >= LIT_EVERY_MS || (fresh && ms !== last.ms)) {
      last = { track, ms, lit: optics.sunlitState(s.r, s.t) };
    }
    const p = eng.subPoint(track, s);
    return {
      ms, rr: eng.rangeRateAt(track, s), speed: Math.hypot(s.v.x, s.v.y, s.v.z),
      lat: p.lat, lon: p.lon, alt: p.alt, grid: toLocator(p.lat, p.lon), lit: last.lit, litMs: last.ms
    };
  };
}

/** The state at exactly `ms`, with the shadow tested there: a reader used once (so every reading is fresh). */
export const liveState: LiveRead = (eng, optics, track, ms) => liveReader()(eng, optics, track, ms, true);
