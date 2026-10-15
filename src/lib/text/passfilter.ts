/* The words of the pass list's filter, over the list (CHANGES-FROM-LEGACY.md, L56).
 *
 * New in the rebuild. The filter is a panel under the list's Filter button: the lowest culmination shown, only the passes the
 * eye can see, and only those that rise in a span of the site's day (lib/analysis/pass-filter.ts). Only the list is filtered:
 * the minutes in view, the countdown, the timeline's marks, the report and the exports still count every pass over the mask.
 * With a filter on, the button says so, a line under it says how many passes are shown and by what, and another says so when
 * the selected pass is one of those hidden (its sky plot and facts stay on screen). These words are in the chunk of the
 * filter's bar, which the list asks for once there are passes; the entry carries none of them, and the panel's own are in
 * passfilter-panel.ts, with the panel. */
import { pad } from './fmt';
import type { PassFilter } from '../analysis/pass-filter';

/** 06:00: minutes after midnight on the site's clock. */
export const clockText = (min: number): string => pad(Math.floor(min / 60)) + ':' + pad(min % 60);

export const FILTER_BUTTON = 'Filter';
/** the button while a filter is on */
export const FILTER_BUTTON_ON = 'Filter · on';
/** the panel the button opens, as a screen reader names it */
export const FILTER_TITLE = 'Filter the pass list';

/** The tests that are on, as phrases: "peaking at 20° or more", "visible to the naked eye", "rising between 18:00 and 06:00 site time"
 *  (or "rising outside 18:00–06:00 site time"). */
export function filterWords(f: PassFilter): string[] {
  const w: string[] = [];
  if (f.minPeak > 0) w.push('peaking at ' + f.minPeak + '° or more');
  if (f.eye) w.push('visible to the naked eye');
  if (f.hours.on) {
    const h = f.hours;
    w.push(h.from === h.to ? (h.out ? 'rising at no hour of the day' : 'rising at any hour of the day')
      : h.out ? 'rising outside ' + clockText(h.from) + '–' + clockText(h.to) + ' site time'
      : 'rising between ' + clockText(h.from) + ' and ' + clockText(h.to) + ' site time');
  }
  return w;
}

/** The line under the button while a filter is on: "Showing 4 of 12 passes: peaking at 20° or more." */
export const shownSay = (n: number, of: number, f: PassFilter): string =>
  'Showing ' + n + ' of ' + of + ' ' + (of === 1 ? 'pass' : 'passes') + ': ' + filterWords(f).join(', ') + '.';

/** The selected pass is one the filter hides; `i` is its index (pass i + 1). */
export const hiddenSay = (i: number): string =>
  'Pass ' + (i + 1) + ', the one selected, is hidden by the filter; the sky plot and the facts under it still show it.';
