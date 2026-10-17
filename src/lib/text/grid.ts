/* What the observer form says about a Maidenhead grid square (CHANGES-FROM-LEGACY.md, L51).
 *
 * New in the rebuild; the old page took a place name or coordinates. A locator typed where a place name goes is read on
 * the page (lib/maidenhead.ts) and offered as the one result, with no request; picked, its centre is the site, at sea
 * level, with the offset of a bare coordinate. These say what was found and how far its centre can be from the station.
 *
 * The form is not on the first screen, so this module is a chunk of its own, loaded when the form first opens: it
 * carries the locator's code with its words (the re-export below), and the entry carries neither. The search field's
 * title, which is there as soon as the form is, stays in site.ts, as does what the form says when this chunk cannot be
 * fetched; the shape of a locator, which holds such text back from the place search, is lib/gridshape.ts. */
import { latStr, lonStr } from '../observer';
import { cellReachKm, fromLocator, type GridCell } from '../maidenhead';

export { fromLocator, locatorPart, siteLocator, toLocator } from '../maidenhead';

/** What a site picked as a grid square is, where a place's region and country would be (the result, the recent chip). */
export const GRID_WHERE = 'Maidenhead grid square';
/** The words before the site's own locator at the head of the form. */
export const GRID_LABEL = 'Grid square';
export const GRID_TITLE = 'The Maidenhead locator of the observer: the grid square, six characters long, that the site is in';
/** ...when the site was picked as a grid square and is still its centre: that square, as long as it was given */
export const GRID_TITLE_GIVEN = 'The Maidenhead grid square the observer was picked as: the site is its centre';

/** 4.6 km, 9.0 km, 216 km, 460 m; whole metres under 100 m (a square's width a few metres from a pole), and "under 1 m"
 *  rather than nought for an eight-character square closer to one than that */
const dist = (km: number): string =>
  km < 0.0005 ? 'under 1 m' : km < 0.1 ? Math.round(km * 1000) + ' m'
    : km < 1 ? Math.round(km * 100) * 10 + ' m' : km < 10 ? km.toFixed(1) + ' km' : Math.round(km) + ' km';

/** The square's size, east to west by north to south, at its centre's latitude. */
function size(c: GridCell): { ew: string; ns: string; off: string } {
  const r = cellReachKm(c);
  return { ew: dist(2 * r.ew), ns: dist(2 * r.ns), off: dist(Math.hypot(r.ew, r.ns)) };
}

/** The result's second line: Maidenhead grid square, 9.0 km × 4.6 km · 13.77° N 100.54° E */
export function gridHitLine(c: GridCell): string {
  const s = size(c);
  return GRID_WHERE + ', ' + s.ew + ' × ' + s.ns + ' · ' + latStr(c.lat) + ' ' + lonStr(c.lon);
}

/** The note while the square is offered: that it asked nobody, how far its centre is from a corner (the result line
 *  above it gives the size), and what is assumed once it is picked. */
export function gridOffer(c: GridCell): string {
  const chars = c.locator.length;
  return c.locator + ' is a Maidenhead grid square' + (chars === 4 ? ', 2° of longitude by 1° of latitude' : '')
    + ', found on this page with no request. Its centre stands for all of it: a station in a corner is ' + size(c).off
    + ' from it' + (chars < 8 ? ', and two more characters narrow it ' + (chars === 4 ? 24 : 10) + ' times each way' : '')
    + '. Picked, the ground is taken as sea level and the offset as the nearest hour of solar time; correct either under'
    + ' Enter coordinates.';
}

/** Under a four-character square, the way to the place search after all: a postcode district such as BN11 has the
 *  same shape as a square, and nothing is sent unless this is pressed. */
export const gridPlacesLabel = (text: string): string => 'Search places for “' + text + '” instead';
export const GRID_PLACES_HINT = 'A postcode district can look like a grid square: this sends it to the place search';

/** A locator the page does not read (locatorPart): it is not sent to the place search, and this says why. One caught half
 *  way through its last pair (OK03g) is the start of a square; one with a fifth pair (OK03gs01a, OK03gs01ab) is finer
 *  than the page reads, and its first eight characters are the square it is in. */
export function gridPartial(text: string): string {
  const t = String(text ?? '').trim();
  if (t.length < 9) return t + ' is the start of a Maidenhead grid square, which has 4, 6 or 8 characters. It is not sent to'
    + ' the place search.';
  const first = fromLocator(t.slice(0, 8))?.locator ?? t.slice(0, 8);
  return t + ' has more characters than this page reads: a Maidenhead grid square here has 4, 6 or 8. Type its first 8, '
    + first + ', for the square it is in. It is not sent to the place search.';
}
