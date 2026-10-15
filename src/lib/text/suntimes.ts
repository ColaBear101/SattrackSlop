/* What the pass list says over each of the observer's days about the Sun, and under the list about the clock
 * (CHANGES-FROM-LEGACY.md, L55).
 *
 * New in the rebuild. The list is grouped by the observer's calendar day (passfacts.ts, passDays), and each day's header
 * says when the Sun rises and sets there and when the sky is dark, from lib/analysis/sun-times.ts. Dark is the optics'
 * dark: the Sun 6 deg or more below the horizon, where a sunlit spacecraft can be seen. A pass outside those hours is radio
 * only whatever the spacecraft does, which is most of any list, and the times say why. Under the list, a line says what
 * the grey rows and the ringed one mean: they are measured at the clock's instant, which is not now once the clock has been
 * moved, sped up or paused, so the line says sim time then, by the Doppler line's rule (isLive). These words are a chunk of
 * their own with the Sun's times, asked for once there are passes; the entry carries neither. */
import { pad } from './fmt';
import type { SiteClock } from './passfacts';
import { b, br, type Inline } from './rich';
import { sunTimes, type SunTimes } from '../analysis/sun-times';
import { isLive } from '../analysis/tune';
import type { Sun } from '../types';

export const SUNRISE = 'Sunrise';
export const SUNSET = 'Sunset';
/** the sky stops being dark: the Sun rises through 6 deg below the horizon */
export const DARK_UNTIL = 'Dark until';
/** the sky is dark from: the Sun sets through 6 deg below */
export const DARK_FROM = 'Dark from';
export const SUN_UP_ALL_DAY = 'Sun up all day';
export const SUN_DOWN_ALL_DAY = 'Sun down all day';
export const DARK_ALL_DAY = 'Dark all day';
export const NEVER_DARK = 'Never dark';
/** Under the pointer, on the day's Sun line: what the words mean, and how good the times are. */
export const SUN_NOTE = 'Sunrise and sunset: the Sun\'s centre 0.833° below a level horizon. Dark: the Sun 6° or more below ' +
  'it, the sky a sunlit spacecraft can be seen against. Times to the nearest minute, in the site\'s time.';

/** 06:09: the site's wall clock at an instant, to the nearest minute. */
export const hhmm = (ms: number, c: SiteClock): string => {
  const t = new Date(Math.round(ms / 60000) * 60000 + c.offsetAt(ms) * 3600000);
  return pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes());
};

/** A day's Sun as short phrases: what holds all day first, then each event in time order. A Sun that never sets never lets
 *  the sky get dark, and a sky dark all day has a Sun that never rose, so each of those is said alone. */
export function sunWords(t: SunTimes, c: SiteClock): string[] {
  if (t.darkAll) return [DARK_ALL_DAY];
  if (t.polarDay) return [SUN_UP_ALL_DAY];
  const ev: [number, string][] = [];
  for (const [list, w] of [[t.dawn, DARK_UNTIL], [t.rise, SUNRISE], [t.set, SUNSET], [t.dusk, DARK_FROM]] as const)
    for (const ms of list) ev.push([ms, w]);
  ev.sort((a, b) => a[0] - b[0]);
  return [...(t.polarNight ? [SUN_DOWN_ALL_DAY] : []), ...ev.map(([ms, w]) => w + ' ' + hhmm(ms, c)),
    ...(t.neverDark ? [NEVER_DARK] : [])];
}

/** Thu 15 Oct, from 2026-10-15. */
export const dayName = (key: string): string => {
  const d = new Date(key + 'T12:00:00Z'), w = d.getUTCDay() * 3, m = d.getUTCMonth() * 3;
  return 'SunMonTueWedThuFriSat'.slice(w, w + 3) + ' ' + d.getUTCDate() + ' ' + 'JanFebMarAprMayJunJulAugSepOctNovDec'.slice(m, m + 3);
};

/** The offset a day's times are in: UTC+7. On a day the site's clock changes, each time is at its own instant's offset, so
 *  both are named, with the wall time the second starts at: UTC+0, then UTC+1 from 02:00. The change is looked for on the
 *  day's whole hours, where summer time starts and ends. */
export function dayZone(d: { t0: number; t1: number }, c: SiteClock): string {
  const o = c.offsetAt(d.t0);
  if (c.offsetAt(d.t1 - 1) !== o)
    for (let t = d.t0 + 3600000; t < d.t1; t += 3600000)
      if (c.offsetAt(t) !== o) return c.labelAt(d.t0) + ', then ' + c.labelAt(t) + ' from ' + hhmm(t, c);
  return c.labelAt(d.t0);
}

/** A day's header: its name, whose date it is (the rows lead with the UTC date), and the Sun that day:
 *  Thu 15 Oct local date, UTC+7 / Dark until 05:47 · Sunrise 06:09 · Sunset 17:59 · Dark from 18:20. A narrow rail breaks
 *  the Sun's line between its phrases, never inside one (each is bound with no-break spaces). */
export const dayHead = (d: { key: string; t0: number; t1: number }, c: SiteClock, sun: Pick<Sun, 'sunElevation'>,
  site: { lat: number; lon: number }): Inline =>
  [b(dayName(d.key)), ' local date, ' + dayZone(d, c), br,
    sunWords(sunTimes(sun, site, d.t0, d.t1), c).map(s => s.replace(/ /g, '\u00a0')).join(' · ')];

/** Whether the rows' instant is sim time rather than now: anything but the clock running at real time within 5 s of the wall
 *  clock (isLive, the Doppler line's rule). A paused clock is sim time however close it stopped, since nothing repaints a
 *  paused page and "now" would stay on rows going stale. */
export const simTime = (ms: number, wall: number, playing: boolean, rate: number): boolean => !isLive(ms, wall, playing, rate);

/** What a grey row and the ringed row are, at the clock's instant: said in the line under the list, and on the row itself to a
 *  screen reader (its description), which the colour and the ring are not. */
export const rowState = (sim: boolean): { past: string; live: string } =>
  sim ? { past: "flown before the clock's instant", live: "in view at the clock's instant" } : { past: 'already flown', live: 'in view now' };

/** The line under the list, when `past` rows are grey (flown) or the one at index `live` is ringed (in view): what that
 *  means, at the clock's instant. When that instant is not now (`sim`, simTime), the line says so. Empty when no row is
 *  either. */
export function flownNote(past: number, live: number, sim: boolean): string {
  const s = rowState(sim);
  return [
    past > 0 && 'Grey: ' + s.past + '.',
    live >= 0 && 'Ringed: ' + s.live + '.',
    (past > 0 || live >= 0) && sim && 'The clock is on sim time, not now.'
  ].filter(Boolean).join(' ');
}
