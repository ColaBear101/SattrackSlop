/* Which passes the rail's list shows (CHANGES-FROM-LEGACY.md, L56).
 *
 * New in the rebuild. A filter of the list only: the analysis still finds every pass over the 5 deg mask (MASK in
 * state/engine.ts does not move), and the minutes in view, the countdown, the timeline's marks, the report's table and the
 * exports go on counting every one of them. What this gives is the indices of the passes the list shows, the analysis's
 * own (0 is the window's first pass whatever is hidden), so a row keeps its number, its data-i and what pressing it selects.
 *
 * Three tests, each off until it is asked for; a pass is shown when it passes every one that is on:
 *   - the highest point: its culmination (the highest point inside the window, for a pass the window cuts) at `minPeak`
 *     degrees or more;
 *   - the eye: the optical verdict on the whole pass is 'yes' (optics.ts, passOptical: fully sunlit against a dark sky at
 *     magnitude +6 or brighter at one of its samples). 'penumbra only' is not a promise, and is left out;
 *   - the hours: its AOS (the window's edge, for a pass already up when the window opens), on the site's clock at that
 *     instant, falls in [from, to) minutes after the site's midnight - a span that runs past midnight when `from` is later
 *     than `to`, so 18:00 to 06:00 is the night - or outside it, with `out`. from === to is the whole day, so with `out`
 *     nothing is shown.
 *
 * Pure: the site's offset and the optical verdict are arguments. The verdict is asked for only while the eye test is on, and
 * only of a pass the other two have kept (it costs 61 propagations). Written from the page's own needs, not from any other
 * program's code. */
import type { Pass } from '../types';

/** A span of the site's day, in minutes after its midnight, and whether it is used. */
export interface PassHours { on: boolean; from: number; to: number; out: boolean }

export interface PassFilter {
  /** the lowest culmination shown, in degrees; 0 is any pass over the mask */
  minPeak: number;
  /** only the passes the optical verdict calls naked-eye visible */
  eye: boolean;
  hours: PassHours;
}

/** The culminations offered, in degrees: 0 is every pass. */
export const PEAKS: readonly number[] = [0, 10, 20, 30, 45];

const DAY_MIN = 1440;

/** Nothing hidden: what the list shows when the reader has chosen nothing. The span is the night, ready for when it is asked for. */
export const NO_FILTER: PassFilter = { minPeak: 0, eye: false, hours: { on: false, from: 18 * 60, to: 6 * 60, out: false } };

/** Does this filter hide anything it could? (One with every test off shows the list as it is.) */
export const filterOn = (f: PassFilter): boolean => f.minPeak > 0 || f.eye || f.hours.on;

/** The minute of the site's day at an instant (0 to 1439), with the site's offset in hours at that instant. */
export function siteMinute(ms: number, offsetH: number): number {
  const m = Math.floor((ms + offsetH * 3600000) / 60000) % DAY_MIN;
  return m < 0 ? m + DAY_MIN : m;
}

/** Is a minute of the day in [from, to)? The span runs past midnight when from > to; from === to is the whole day. */
export const inSpan = (m: number, from: number, to: number): boolean =>
  from === to || (from < to ? m >= from && m < to : m >= from || m < to);

/** The indices, in the analysis's own order, of the passes the filter shows. `offsetAt` is the site's offset in hours at an
 *  instant (passfacts.ts, siteClock); `eyeOf(i)` whether pass i is naked-eye visible. */
export function filterPasses(P: readonly Pass[], f: PassFilter, offsetAt: (ms: number) => number, eyeOf: (i: number) => boolean): number[] {
  const out: number[] = [];
  P.forEach((p, i) => {
    if (p.maxEl < f.minPeak) return;
    if (f.hours.on && inSpan(siteMinute(p.t0ms, offsetAt(p.t0ms)), f.hours.from, f.hours.to) === f.hours.out) return;
    if (f.eye && !eyeOf(i)) return;
    out.push(i);
  });
  return out;
}

/** A time field's value ("18:00", or "18:00:30" where a browser adds seconds) as minutes after midnight; null when it is not one. */
export function parseClock(s: string): number | null {
  const m = /^(\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1]!, mi = +m[2]!;
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

const minuteOk = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < DAY_MIN;

/** A filter as the page stored it (JSON), or null when there is none to read. A field the page could not have written (a
 *  culmination it does not offer, a minute past the day) takes its value from NO_FILTER, as a missing one does. */
export function readFilter(raw: string | null): PassFilter | null {
  let j: unknown;
  try { j = JSON.parse(raw ?? 'null'); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>, h = (o.hours && typeof o.hours === 'object' ? o.hours : {}) as Record<string, unknown>, d = NO_FILTER;
  return {
    minPeak: typeof o.minPeak === 'number' && PEAKS.includes(o.minPeak) ? o.minPeak : d.minPeak,
    eye: typeof o.eye === 'boolean' ? o.eye : d.eye,
    hours: {
      on: typeof h.on === 'boolean' ? h.on : d.hours.on,
      from: minuteOk(h.from) ? h.from : d.hours.from,
      to: minuteOk(h.to) ? h.to : d.hours.to,
      out: typeof h.out === 'boolean' ? h.out : d.hours.out
    }
  };
}
