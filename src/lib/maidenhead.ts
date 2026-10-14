/* The Maidenhead locator, the grid square radio amateurs give for where a station stands (CHANGES-FROM-LEGACY.md, L51).
 *
 * New in the rebuild; the old page had no locator. Written from the IARU's definition of the Maidenhead Locator System,
 * in which a locator is pairs of characters, longitude first in each pair, every pair cutting the cell of the one before
 * it:
 *
 *   field            A-R    18 x 18 cells, 20 deg of longitude by 10 deg of latitude, counted east from 180 W and
 *                           north from 90 S
 *   square           0-9    10 x 10, 2 deg by 1 deg
 *   subsquare        a-x    24 x 24, 5' by 2.5'
 *   extended square  0-9    10 x 10, 0.5' by 0.25'
 *
 * so OK03gs is field O-K, square 0-3, subsquare g-s. Letters are written upper case in the field and lower case in the
 * subsquare by convention; the system itself does not care, and neither does fromLocator.
 *
 * Both directions count in the finest unit, an extended square: 1/120 deg of longitude and 1/240 deg of latitude, 43,200
 * of each round the globe and pole to pole. A position is turned into that whole number once, with one floor, and the
 * characters are its digits in a mixed radix (18, 10, 24, 10), so a value on a cell's edge cannot fall into the cell on
 * one level and out of it on the next. The edges that close the globe, 90 deg of latitude and 180 deg of longitude, are
 * counted in the last cell (R, 9, x, 9) rather than in a nineteenth field that does not exist.
 *
 * Pure: no DOM, no globals. */
import { LOCATOR, PART } from './gridshape';

/* The patterns are gridshape.ts, which the entry carries so that the form can hold text with a locator's shape back
   from the place search before this module has come (or when it cannot come). */
export { LOCATOR };

/** Units of the finest cell in one degree: an extended square is 0.5' of longitude by 0.25' of latitude. */
const LON_UNITS = 120, LAT_UNITS = 240;
/** Cells round the globe in that unit: 360 deg of longitude, 180 of latitude. */
const SPAN = 43200;
/** A cell's size in the finest unit at each pair (field, square, subsquare, extended square); the same for both axes. */
const CELL = [2400, 240, 10, 1];

/** A grid square, as fromLocator reads it: its centre, and half its size each way, in degrees. */
export interface GridCell {
  /** the locator written the conventional way: OK03gs */
  locator: string;
  lat: number;
  lon: number;
  halfLatDeg: number;
  halfLonDeg: number;
}

/** The characters of one axis, from its index in the finest unit. */
function digits(n: number, pairs: number): number[] {
  return [Math.floor(n / CELL[0]!), Math.floor(n / CELL[1]!) % 10, Math.floor(n / CELL[2]!) % 24, n % 10].slice(0, pairs);
}

const index = (deg: number, units: number): number => Math.min(SPAN - 1, Math.max(0, Math.floor(deg * units)));

/** The locator of a position, `pairs` pairs long (1 to 4: a field, a square, a subsquare, an extended square), or null
 *  for a position that is not one (latitude past 90, longitude past 180, not a number). */
export function toLocator(lat: number, lon: number, pairs = 3): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!Number.isInteger(pairs) || pairs < 1 || pairs > 4) return null;
  const x = digits(index(lon + 180, LON_UNITS), pairs), y = digits(index(lat + 90, LAT_UNITS), pairs);
  let s = '';
  for (let i = 0; i < pairs; i++) {
    const letters = i === 0 ? 65 : i === 2 ? 97 : 0;          // A, a, or a digit
    s += letters ? String.fromCharCode(letters + x[i]!, letters + y[i]!) : String(x[i]) + String(y[i]);
  }
  return s;
}

/** The grid square a locator names, or null when it is not one. Accepts 4, 6 or 8 characters, in either case, with
 *  space round it; anything else (a field alone, a letter past R or x, a pair left half-typed, a fifth pair) is not
 *  one it reads. */
export function fromLocator(text: string): GridCell | null {
  const m = LOCATOR.exec(String(text ?? '').trim());
  if (!m) return null;
  const field = m[1]!.toUpperCase(), square = m[2]!, sub = m[3]?.toLowerCase(), ext = m[4];
  const pairs = ext ? 4 : sub ? 3 : 2;
  const at = (axis: 0 | 1): number =>
    (field.charCodeAt(axis) - 65) * CELL[0]! + (+square[axis]!) * CELL[1]!
    + (sub ? (sub.charCodeAt(axis) - 97) * CELL[2]! : 0) + (ext ? (+ext[axis]!) * CELL[3]! : 0);
  const cell = CELL[pairs - 1]!;
  /* the centre, as a whole number of half units over the units in a degree: one division, then the offset */
  return {
    locator: field + square + (sub ?? '') + (ext ?? ''),
    lat: (2 * at(1) + cell) / (2 * LAT_UNITS) - 90,
    lon: (2 * at(0) + cell) / (2 * LON_UNITS) - 180,
    halfLatDeg: cell / (2 * LAT_UNITS),
    halfLonDeg: cell / (2 * LON_UNITS)
  };
}

/** Whether text has a locator's shape but is not one this page reads: caught half way through its last pair (OK03g), or
 *  gone past the extended square into a fifth pair (OK03gs01a, OK03gs01ab). See gridshape.ts, PART. */
export function locatorPart(text: string): boolean {
  return PART.test(String(text ?? '').trim());
}

/** The locator to name a site by, as the form's head shows it. A site picked as a grid square is that square's centre,
 *  which lies on the corners of the smaller squares inside it (OK03's centre, 13.5 N 101 E, is the corner of OK03ll,
 *  lm, ml and mm), so working its six characters out again would name a subsquare the reader never gave: a site that is
 *  the centre of the locator it is named by is given that locator, as long as it was (`given`). Any other site is given
 *  the six characters of the square it is in. Null for a position that is not one. */
export function siteLocator(site: { name?: string; lat: number; lon: number }): { locator: string; given: boolean } | null {
  const named = fromLocator(String(site.name ?? ''));
  if (named && named.lat === site.lat && named.lon === site.lon) return { locator: named.locator, given: true };
  const own = toLocator(site.lat, site.lon);
  return own ? { locator: own, given: false } : null;
}

/** Kilometres in a degree of latitude, on a sphere of the Earth's mean radius (6,371 km): good to half a per cent, which
 *  is all a statement of a grid square's size needs. */
const KM_PER_DEG = Math.PI * 6371 / 180;

/** How far a square reaches from its centre, in km: north and south, and east and west at its centre's latitude. */
export function cellReachKm(c: Pick<GridCell, 'lat' | 'halfLatDeg' | 'halfLonDeg'>): { ns: number; ew: number } {
  return { ns: c.halfLatDeg * KM_PER_DEG, ew: c.halfLonDeg * KM_PER_DEG * Math.cos(c.lat * Math.PI / 180) };
}
