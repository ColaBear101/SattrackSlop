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
