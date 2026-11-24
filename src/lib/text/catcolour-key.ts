/* The words of the catalogue's colours by class (CHANGES-FROM-LEGACY.md, L76): each class's name, as the globe's key says it and as
 * it follows an object's name under the pointer, the key's rows, and the note under the Layers panel's choice, which says how many
 * objects are in each class and where the classes come from. They travel in the colours' own chunk (components/stage/catcolour.ts),
 * fetched the first time a colouring is chosen; the entry holds only the choice itself (this folder's catcolour.ts). Nothing here imports
 * what the entry holds, so the numbers are put in words here too. */
import type { ObjType, Orbit, Purpose } from '../catalogue/classify';

export const ORBIT_NAME: Record<Orbit, string> = {
  leo: 'LEO', sso: 'SSO', meo: 'MEO', geo: 'GEO', igso: 'IGSO', heo: 'HEO', beyond: 'Beyond GEO'
};
export const TYPE_NAME: Record<ObjType, string> = { pay: 'Payload', rb: 'Rocket body', deb: 'Debris', unk: 'Unknown' };
export const PURPOSE_NAME: Record<Purpose, string> = {
  comms: 'Communications', nav: 'Navigation', eo: 'Earth observation & weather', sci: 'Science', crew: 'Crewed stations',
  mil: 'Military', edu: 'Amateur & education', other: 'Other or unknown'
};

/** the key's rows, a few classes to a row, so that the key grows by a line or two and not by one a class */
export const ORBIT_ROWS: Orbit[][] = [['leo', 'sso', 'meo'], ['geo', 'igso', 'heo', 'beyond']];
export const TYPE_ROWS: ObjType[][] = [['pay', 'rb', 'deb', 'unk']];
export const PURPOSE_ROWS: Purpose[][] = [['comms', 'nav', 'sci', 'mil'], ['eo', 'crew'], ['edu', 'other']];

/** what follows an object's name under the pointer while the dots are coloured: "INTELSAT 40E (IS-40E) · GEO" */
export const tagFor = (name: string): string => ' · ' + name;

const num = (n: number): string => n.toLocaleString('en-US');

/** the note under "By orbit": the rules, in the order they are tried (classify.ts, orbitOf), with the count in each class */
export const orbitNote = (c: Record<Orbit, number>): string =>
  'Read from each object\'s own elements, the first that fits: HEO, an eccentricity of 0.25 or more (' + num(c.heo) + '); GEO, a period within 1.5 % '
  + 'of a sidereal day and under 15° of inclination (' + num(c.geo) + '), or IGSO, inclined geosynchronous, at more (' + num(c.igso) + '); LEO, an apogee '
  + 'under 2,000 km (' + num(c.leo) + '), or SSO, sun-synchronous, a low orbit whose plane turns with the Sun (' + num(c.sso) + '); MEO, higher, with a '
  + 'shorter period than GEO\'s (' + num(c.meo) + '); beyond GEO, a longer one (' + num(c.beyond) + ').';

/** the note under "By type": SATCAT's own word, the day it is of, and the objects it has no record of */
export const typeNote = (c: Record<ObjType, number>, unrecorded: number, day: string): string =>
  'SATCAT\'s object type, as CelesTrak had it on ' + day + ': ' + num(c.pay) + (c.pay === 1 ? ' payload, ' : ' payloads, ')
  + num(c.rb) + ' rocket ' + (c.rb === 1 ? 'body' : 'bodies') + ', ' + num(c.deb) + (c.deb === 1 ? ' piece' : ' pieces') + ' of debris and '
  + num(c.unk) + ' unknown' + (unrecorded ? ', ' + num(unrecorded) + ' of them objects SATCAT has no record of, which SatNOGS numbers itself' : '') + '.';

/** the note under "By purpose": where it comes from, the order an object on several lists is taken in (verification/tools/fetch-satcat.js,
 *  PURPOSE), and what the lists do not say */
export const purposeNote = (other: number, day: string): string =>
  'From the lists CelesTrak files objects in, as they were on ' + day + ', the first that has it of: military, an operator\'s fleet '
  + '(communications), navigation, weather and Earth resources, science, CubeSats (amateur & education), space stations (crewed), other '
  + 'communications, amateur radio and education. ' + num(other) + ' are on none of them and are other or unknown: the lists hold what '
  + 'CelesTrak has sorted, not everything in orbit.';

/** said instead when the table that ships with the page was made for another catalogue: it is not read */
export const STALE_NOTE = 'CelesTrak\'s table that ships with the page was made for another version of the catalogue, so it is not used and every object is unknown here.';
