/* The words of the button at the foot of the report that forgets what the page stored (CHANGES-FROM-LEGACY.md, L50).
 *
 * New in the rebuild; the old page had no such button. The first press says what will go, from what is in the browser
 * at that moment (lib/forget.ts, survey), and the second forgets it and reloads; Escape, or moving away from the button,
 * stands it down. */
import type { ForgetPart } from '../forget';

export const FORGET_LABEL = 'Forget what this page stored';
/** The button's label once it has been pressed and is waiting for the second press. */
export const FORGET_ARMED_LABEL = 'Forget and reload';
export const FORGET_NOTHING = 'This page has stored nothing in this browser.';
export const FORGET_BLOCKED = 'This browser does not let the page store anything, so there is nothing to forget.';

const count = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);

/** One part, as the list says it: "your saved site", "2 recent places", "3 cached element sets". */
export function partWords(p: ForgetPart): string {
  switch (p.kind) {
    case 'site': return 'your saved site';
    case 'recents': return p.n ? count(p.n, 'recent place', 'recent places') : 'your recent places';
    case 'choices': return 'your display choices';
    case 'watch': return p.n ? count(p.n, 'watched spacecraft', 'watched spacecraft') : 'your watchlist';
    case 'orbits': return p.n ? count(p.n, 'orbit of your own', 'orbits of your own') : 'the record of your own orbits';
    case 'tle': return count(p.n, 'cached element set', 'cached element sets');
    case 'hist': return count(p.n, 'cached decay history', 'cached decay histories');
  }
}

/** a, b and c */
const andList = (xs: string[]): string => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

/** After the first press: what the second will forget. `parts` is not empty (with nothing stored there is no second press). */
export function forgetArmed(parts: ForgetPart[]): string {
  const orbits = parts.find(p => p.kind === 'orbits');
  return 'Press again to forget these and reload the page: ' + andList(parts.map(partWords)) + '.'
    + (orbits && orbits.n !== 0 ? ' Your own orbits cannot be brought back.' : '');
}

/** The browser kept some of it: the page is not reloaded over a half-forgotten store. */
export function forgetLeft(n: number): string {
  return 'This browser refused to remove ' + count(n, 'item', 'items') + ', so the page has not been reloaded.';
}
