/* What each of the catalogue's objects is, for the globe's colours by class (CHANGES-FROM-LEGACY.md, L76).
 *
 * New in the rebuild. The old page drew the catalogue's dots in one colour, and the globe still opens so; the Layers panel can
 * colour them instead by one of three classings, and this says which class each object is in:
 *
 *   orbit    from the element set's second line, the catalogue's own (the set the cloud's dots are flown on): LEO, SSO, MEO, GEO,
 *            IGSO, HEO or beyond GEO, by the rules at orbitOf;
 *   type     SATCAT's object type, and
 *   purpose  the CelesTrak lists the object is on, both from data/satcat.json: a table baked by verification/tools/fetch-satcat.js
 *            (which gives the rules), one letter for each in the catalogue's order, and the catalogue it was baked against.
 *
 * Pure: the catalogue and the table are arguments. Only the colours' own chunk (components/stage/catcolour.ts) imports this, so it
 * imports nothing the entry holds (a module that the entry and a lazy chunk share is split into a chunk of its own), and its
 * constants are written here rather than taken from core/body.ts. */

export type Orbit = 'leo' | 'sso' | 'meo' | 'geo' | 'igso' | 'heo' | 'beyond';
export type ObjType = 'pay' | 'rb' | 'deb' | 'unk';
export type Purpose = 'comms' | 'nav' | 'eo' | 'sci' | 'crew' | 'mil' | 'edu' | 'other';

/** the lines between the orbit classes, which the note under the choice states */
export const LEO_APOGEE_KM = 2000;
export const HEO_ECC = 0.25;
/** a geosynchronous period: within this share of a sidereal day */
export const GSO_BAND = 0.015;
/** a geosynchronous orbit inclined less than this (degrees) is GEO, one inclined more is IGSO */
export const GEO_INC_DEG = 15;
/** a low orbit whose plane turns within this many degrees a day of the Sun's 0.9856 is sun-synchronous */
export const SSO_SLACK_DEG_DAY = 0.1;

/* the Earth's figures, the ones core/body.ts gives it: WGS-84's mu and radius, J2, and the mean Sun's motion */
const MU = 398600.4418, RE = 6378.137, J2 = 1.08262668e-3, SUN_DEG_DAY = 0.9856;
const SIDEREAL_DAY_MIN = 1436.0682;

/** The orbit class of an element set, from its second line (the columns satellite.js reads: inclination 9-16, eccentricity
 *  27-33, mean motion 53-63 in revolutions a day), in this order:
 *    HEO     an eccentricity of 0.25 or more;
 *    GEO     a period within 1.5 % of a sidereal day, inclined under 15°, and IGSO the same period inclined more;
 *    LEO     an apogee under 2,000 km, and of those SSO, whose plane J2 turns at the Sun's rate (0.9856° a day, give or take 0.1°);
 *    MEO     any other orbit with a period under a sidereal day, and beyond GEO one with a longer period (the graveyard orbits).
 *  The semi-major axis is the mean motion's under two-body motion, which is all a class needs. */
export function orbitOf(l2: string): Orbit {
  const revs = parseFloat(l2.substring(52, 63));
  const e = parseFloat('.' + l2.substring(26, 33));
  const inc = parseFloat(l2.substring(8, 16));
  const n = revs * 2 * Math.PI / 86400;                     // rad/s
  const a = Math.cbrt(MU / (n * n));
  const period = 1440 / revs;                               // minutes
  if (e >= HEO_ECC) return 'heo';
  if (Math.abs(period - SIDEREAL_DAY_MIN) <= GSO_BAND * SIDEREAL_DAY_MIN) return inc < GEO_INC_DEG ? 'geo' : 'igso';
  if (a * (1 + e) - RE < LEO_APOGEE_KM) {
    const p = a * (1 - e * e);
    const node = -1.5 * n * J2 * (RE / p) ** 2 * Math.cos(inc * Math.PI / 180) * 86400 * 180 / Math.PI;   // degrees a day
    return Math.abs(node - SUN_DEG_DAY) <= SSO_SLACK_DEG_DAY ? 'sso' : 'leo';
  }
  return period < SIDEREAL_DAY_MIN ? 'meo' : 'beyond';
}

/** data/satcat.json: what CelesTrak says of each catalogue entry, by position (see verification/tools/fetch-satcat.js) */
export interface SatcatTable {
  /** the day the answers are of, YYYY-MM-DD */
  built: string;
  source: string;
  /** the catalogue it was baked against: its length, and catSum of its numbers */
  n: number;
  sum: string;
  /** one letter per entry: P payload, R rocket body, D debris, U unknown, N no SATCAT record */
  type: string;
  /** one letter per entry: c communications, n navigation, e Earth observation and weather, s science, h crewed stations,
   *  m military, a amateur and education, o other or unknown */
  purpose: string;
}

const TYPE_OF: Record<string, ObjType> = { P: 'pay', R: 'rb', D: 'deb', U: 'unk', N: 'unk' };
const PURPOSE_OF: Record<string, Purpose> = { c: 'comms', n: 'nav', e: 'eo', s: 'sci', h: 'crew', m: 'mil', a: 'edu', o: 'other' };

/** FNV-1a (32 bits) over the catalogue's NORAD numbers, one per line, in its order: which catalogue a table is for */
export function catSum(cat: readonly { satnum: string }[]): string {
  let h = 0x811c9dc5;
  const s = cat.map(c => c.satnum).join('\n');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Is the table this catalogue's? A table baked against another catalogue says nothing of this one, by position or otherwise. */
export function tableFits(t: SatcatTable, cat: readonly { satnum: string }[]): boolean {
  return t.n === cat.length && t.type.length === cat.length && t.purpose.length === cat.length && t.sum === catSum(cat);
}

/** The type and purpose of entry i, as the table has them (a letter it does not know is unknown, and other). */
export const typeAt = (t: SatcatTable, i: number): ObjType => TYPE_OF[t.type[i] ?? ''] ?? 'unk';
export const purposeAt = (t: SatcatTable, i: number): Purpose => PURPOSE_OF[t.purpose[i] ?? ''] ?? 'other';
/** Has SATCAT no record of entry i (SatNOGS's own numbers, or a number SATCAT gives another launch)? */
export const unrecorded = (t: SatcatTable, i: number): boolean => t.type[i] === 'N';
