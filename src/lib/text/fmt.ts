/* Small formatters shared by the views. The old page's `iso`, `hms` and `mmss`, as pure functions;
   the report's prose builders (milestone M5) add the rest. */

const pad = (x: number, n = 2) => String(x).padStart(n, '0');

/** 2026-09-12 07:29:09Z - the page's UTC timestamp. */
export const iso = (d: Date): string =>
  d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
  pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z';

/** 07:29:09 */
export const hms = (d: Date): string =>
  pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());

/** 5m 52s - a duration in seconds. */
export const mmss = (s: number): string => {
  const t = Math.round(s);
  return Math.floor(t / 60) + 'm ' + pad(t % 60) + 's';
};

/** 15 min 00 s - the headline's long form. */
export const minSec = (s: number): string => {
  const t = Math.round(s);
  return Math.floor(t / 60) + ' min ' + pad(t % 60) + ' s';
};

/** 01:58:49 - a countdown in ms; hours are not wrapped at 24. */
export const hhmmss = (ms: number): string => {
  const t = Math.max(0, Math.round(ms / 1000));
  return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t % 3600 / 60)) + ':' + pad(t % 60);
};

/** The 16-point compass name of an azimuth in degrees. */
export const compass = (az: number): string =>
  ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    [Math.round(((az % 360) + 360) % 360 / 22.5) % 16]!;

/** The wall-clock time at a site with a fixed UTC offset, as 2026-09-12 14:29 (no seconds, no zone letter). */
export const localMinute = (d: Date, tzHours: number): string =>
  iso(new Date(d.getTime() + tzHours * 3_600_000)).slice(0, 16);
