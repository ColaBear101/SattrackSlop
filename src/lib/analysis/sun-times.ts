import type { Sun } from '../types';

/* When the Sun rises and sets at a site, and when the sky there is dark, over a span of time: the pass list's day headers
 * (CHANGES-FROM-LEGACY.md, L55).
 *
 * New in the rebuild; the old page had none. There is no astronomy of its own here: the Sun is the page's one model
 * (core/sun.ts, sunElevation, only called), the geometric elevation of its centre that the naked-eye test reads too. It is
 * asked every 10 minutes across the span and each crossing of a threshold is bisected to a second, the scan-and-bisect
 * findPasses does for a spacecraft. The thresholds are the almanac's (USNO; NOAA; Meeus, Astronomical Algorithms ch. 15):
 * sunrise and sunset when the centre is 0.833 deg below a level horizon (34' of refraction and a 16' semi-diameter, which a
 * geometric elevation leaves out), and the end of civil twilight at 6 deg below, which is where the optics call the sky
 * dark (optics.ts, DARK_SUN_EL) and a sunlit spacecraft can be seen. No site height and no weather: the times are good to a
 * minute or two, and they are shown to the minute.
 *
 * Near the polar circles the Sun can graze a threshold, dipping through it and back between two samples. So every turning
 * point of the elevation (its highest and lowest of the day) is found as well, to a second, and the crossings are looked
 * for on either side of it. A span with no crossing has the Sun on one side of the threshold throughout: polar day or
 * polar night, which is said in so many words rather than left to an empty list.
 *
 * Pure: no DOM, no globals. */

/** Sunrise and sunset: the Sun's centre 0.833 deg below the horizon. */
export const RISE_SET_DEG = -0.833;
/** Civil twilight ends (and the optics' dark sky begins) with the Sun's centre 6 deg below the horizon. */
export const CIVIL_DEG = -6;
/** How often the elevation is sampled. The Sun moves 2.5 deg in 10 minutes at most, so no crossing that lasts is missed;
 *  one that does not (a grazing Sun) is found through the turning point. */
export const SCAN_MS = 600_000;
/** Crossings and turning points are refined until they are bracketed to a second. */
const TO_MS = 1000;

/** A crossing of a threshold: when, and whether the Sun was rising through it. */
export interface Crossing { ms: number; up: boolean }
/** One threshold over a span: which side of it the Sun was on when the span began, and every crossing in the span, in time
 *  order. No crossing means the Sun stayed on that side throughout. */
export interface SunSide { h0: number; above: boolean; crossings: Crossing[] }

type Elevation = Pick<Sun, 'sunElevation'>;
interface Where { lat: number; lon: number }

/** The Sun against each threshold in `h0s` (degrees) at `site`, from `t0` to `t1` (ms). */
export function sunEvents(sun: Elevation, site: Where, t0: number, t1: number,
  h0s: readonly number[] = [RISE_SET_DEG, CIVIL_DEG]): SunSide[] {
  const el = (ms: number): number => sun.sunElevation(site, new Date(ms));
  /* the samples, with one more on either side of the span so that a turning point in its first or last step is seen */
  const ts: number[] = [t0 - SCAN_MS];
  for (let t = t0; t < t1; t += SCAN_MS) ts.push(t);
  ts.push(t1, t1 + SCAN_MS);
  const es = ts.map(el);
  const pts: [number, number][] = [];
  for (let i = 1; i < ts.length - 1; i++) pts.push([ts[i]!, es[i]!]);
  for (let i = 1; i < ts.length - 1; i++) {
    const rising = es[i]! > es[i - 1]!;
    if (rising !== es[i + 1]! > es[i]!) {
      const m = turn(el, ts[i - 1]!, ts[i + 1]!, rising);
      if (m[0] > t0 && m[0] < t1) pts.push(m);
    }
  }
  pts.sort((a, b) => a[0] - b[0]);
  return h0s.map(h0 => {
    const crossings: Crossing[] = [];
    for (let i = 1; i < pts.length; i++) {
      const [ta, ea] = pts[i - 1]!, [tb, eb] = pts[i]!;
      if ((ea >= h0) !== (eb >= h0)) crossings.push({ ms: bisect(el, h0, ta, tb, ea >= h0), up: eb >= h0 });
    }
    return { h0, above: pts[0]![1] >= h0, crossings };
  });
}

/** A span's sunrises, sunsets and dark sky, by name. `polarDay` and `polarNight`: the Sun never set, or never rose, in the
 *  span; `darkAll` and `neverDark`: it stayed below, or above, the 6 deg of civil twilight throughout. */
export interface SunTimes {
  rise: number[]; set: number[];
  /** the sky stops being dark (the Sun rises through -6 deg) */
  dawn: number[];
  /** the sky is dark from (the Sun sets through -6 deg) */
  dusk: number[];
  polarDay: boolean; polarNight: boolean; darkAll: boolean; neverDark: boolean;
}

export function sunTimes(sun: Elevation, site: Where, t0: number, t1: number): SunTimes {
  const [rs, cv] = sunEvents(sun, site, t0, t1, [RISE_SET_DEG, CIVIL_DEG]) as [SunSide, SunSide];
  const when = (s: SunSide, up: boolean) => s.crossings.filter(x => x.up === up).map(x => x.ms);
  const none = (s: SunSide) => s.crossings.length === 0;
  return {
    rise: when(rs, true), set: when(rs, false), dawn: when(cv, true), dusk: when(cv, false),
    polarDay: none(rs) && rs.above, polarNight: none(rs) && !rs.above,
    darkAll: none(cv) && !cv.above, neverDark: none(cv) && cv.above
  };
}

/* the highest (or lowest) elevation between a and b, by golden-section search: the elevation has one turning point in a
   step or two of the scan, since the Sun has two a day */
function turn(el: (ms: number) => number, a: number, b: number, max: boolean): [number, number] {
  const g = (Math.sqrt(5) - 1) / 2, f = (ms: number) => (max ? -el(ms) : el(ms));
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  while (b - a > TO_MS) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  const t = (a + b) / 2;
  return [t, el(t)];
}

/* the instant between a and b where the elevation crosses h0, to a second; a is on the side `aAbove` says */
function bisect(el: (ms: number) => number, h0: number, a: number, b: number, aAbove: boolean): number {
  while (b - a > TO_MS) {
    const m = (a + b) / 2;
    if ((el(m) >= h0) === aAbove) a = m; else b = m;
  }
  return Math.round((a + b) / 2);
}
