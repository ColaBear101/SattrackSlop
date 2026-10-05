/* Small formatters shared by the views and the exporters: the old page's `pad`, `iso`, `hms`, `ymd`, `md`,
   `whenZ`, `mmss`, `ago`, `compass`, `hhmmss` and `spanLabel` as pure functions, moved verbatim from
   legacy/index.html (main@4eadd7a, lines 8535-8575 and 9699-9701). The two that need the site's offset
   (`whenLocal`, `localMinute`) take it as an argument. The report's prose builders (milestone M5) add the rest. */

export const pad = (x: number, n = 2): string => String(x).padStart(n, '0');

/** 2026-09-12 07:29:09Z - the page's UTC timestamp. */
export const iso = (d: Date): string =>
  d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
  pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z';

/** 07:29:09 */
export const hms = (d: Date): string =>
  pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());

/* Pass times carry their calendar date: the UTC date, and a local time that falls on another day says which. */
export const ymd = (d: Date): string => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
export const md = (d: Date): string => pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
/** 09-12 07:29:09Z */
export const whenZ = (d: Date): string => md(d) + ' ' + hms(d) + 'Z';

/** The site's wall clock at an instant: 09-12 14:29:09 UTC+7. `offsetHours` is the site's offset AT that instant
 *  (the old page's tzAt) and `label` the zone's name for it (tzLabelAt); both come from the site. */
export const whenLocal = (d: Date, offsetHours: number, label: string): string => {
  const t = new Date(d.getTime() + offsetHours * 3600000);
  return (md(t) !== md(d) ? md(t) + ' ' : '') + hms(t) + ' ' + label;
};

/** 5m 52s, or 1h 05m once it passes an hour. */
export const mmss = (s: number): string => {
  const T = Math.round(s);                  // round first, or 59.7 s renders as '60s'
  const hh = Math.floor(T / 3600);
  return hh ? hh + 'h ' + pad(Math.floor(T % 3600 / 60)) + 'm'
            : Math.floor(T / 60) + 'm ' + pad(T % 60) + 's';
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

/** How long ago, in the unit that reads best: 12 s, 40 min, 3.5 h, 4.2 days. */
export const ago = (ms: number): string => {
  const s = Math.max(0, ms) / 1000;
  if (s < 90) return Math.round(s) + ' s';
  if (s < 5400) return Math.round(s / 60) + ' min';
  if (s < 172800) return (s / 3600).toFixed(1) + ' h';
  return (s / 86400).toFixed(1) + ' days';
};

/** 6 h, 24 h, 3 d, 7 d. */
export const spanLabel = (hrs: number): string => (hrs >= 48 ? (hrs / 24) + ' d' : hrs + ' h');

/** The 16-point compass name of an azimuth in degrees. */
export const compass = (az: number): string =>
  ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    [Math.round(((az % 360) + 360) % 360 / 22.5) % 16]!;

/** The wall-clock time at a site with a fixed UTC offset, as 2026-09-12 14:29 (no seconds, no zone letter). */
export const localMinute = (d: Date, tzHours: number): string =>
  iso(new Date(d.getTime() + tzHours * 3_600_000)).slice(0, 16);

/** The abbreviations the pass readouts are written in, spelled out under the pointer. The old page built them
 *  as <abbr> markup strings; here they are the text and the title, and a component renders the element. */
export const ABBR = {
  AOS: { text: 'AOS', title: 'acquisition of signal: the spacecraft rises through the 5° mask' },
  LOS: { text: 'LOS', title: 'loss of signal: the spacecraft sets through the 5° mask' },
  STD: { text: 'std mag', title: 'standard magnitude: its brightness at 1,000 km, half lit' }
} as const;
