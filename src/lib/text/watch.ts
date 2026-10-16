/* The words of the watchlist: the star on the identity line under the spacecraft's name, and the picker's group of what is starred
 * (CHANGES-FROM-LEGACY.md, L60).
 *
 * New in the rebuild. The star is a toggle button: its name stays "Watch" and aria-pressed says whether it is on; its tooltip is
 * its name. These are in the entry chunk with the star, so they are few; the refusal at the cap is
 * watch-full.ts, which travels with the press's own chunk (state/watch-press.ts). */

/** the star's name and its tooltip, on or off */
export const WATCH_LABEL = 'Watch';
/** the picker's group of the watched, over the reader's orbits and the catalogue */
export const WATCHED = 'Watched';
