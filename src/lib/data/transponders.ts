/* Uplinks and transponders, baked from SatNOGS DB (data/transponders.json, written by verification/tools/fetch-transponders.js;
 * CHANGES-FROM-LEGACY.md, L62).
 *
 * The downlink table (data/transmitters.json, ./transmitters.ts) is for listening: no uplinks, and four records an object at most.
 * This one holds what working a spacecraft needs, from the same SatNOGS DB records: for every active record of a catalogue object
 * with both an uplink and a downlink in the amateur bands, the uplink the spacecraft listens on and the downlink it sends, either a
 * LINEAR passband (a transponder that maps its uplink range onto its downlink range point for point, inverting or not) or a single-
 * frequency PAIR (an FM repeater, a digipeater, a transceiver); the downlink mode and the uplink mode; the CTCSS tone the record
 * names; and SatNOGS's description. It is SatNOGS DB data, under CC BY-SA 4.0, as the footer's credit line says. A chunk of its own,
 * asked for when the transponder panel is first opened (never at boot): the page never asks SatNOGS anything. Keyed by the NORAD
 * number without its leading zeros ("7530" for 07530), as the other two tables are.
 *
 * Each record is [ulLo, ulHi, dlLo, dlHi, inv, mode, upMode, tone, desc]: integer Hz (a pair has ulHi === ulLo and dlHi === dlLo),
 * inv 1 for an inverting passband (always 0 for a pair), upMode '' when SatNOGS gives none or the same as the downlink's, tone 0
 * when the record names none. Per object, the linear passbands come first, then the pairs, each by uplink. */

export type XpRecord = [number, number, number, number, 0 | 1, string, string, number, string];
export interface TransponderData {
  built: string; source: string; licence: string; objects: number; records: number;
  x: Record<string, XpRecord[]>;
}
export interface Transponder {
  /** Hz: the uplink the spacecraft listens on, lowest and highest edge (equal for a pair) */
  ulLo: number; ulHi: number;
  /** Hz: the downlink it sends on, lowest and highest edge (equal for a pair) */
  dlLo: number; dlHi: number;
  /** the passband inverts: its uplink's low edge comes down on the downlink's high edge (USB in, LSB out). Never for a pair. */
  inv: boolean;
  /** a passband (a range on both legs), not a single-frequency pair */
  linear: boolean;
  /** as SatNOGS gives them: the downlink's mode ('' when none), and the uplink's ('' when none, or the same as the downlink's) */
  mode: string; upMode: string;
  /** the CTCSS tone the record names, Hz, one of CTCSS_HZ; 0 when none */
  tone: number;
  /** SatNOGS's description, cut to 44 characters */
  desc: string;
}
export interface TransponderTable {
  built: string; source: string; licence: string; objects: number; records: number;
  /** Every record for a NORAD number, or an empty array, in the table's order. Never null. "07530" and 7530 are one object; anything
   *  that is not a number (an orbit of the reader's own, O0001) is looked up as written and finds nothing. */
  forSat(satnum: string | number): Transponder[];
  has(satnum: string | number): boolean;
}

/** The 50 CTCSS tones of EIA/TIA-603, Hz, ascending. The baker checks a tone named in a description against the same list. */
export const CTCSS_HZ: readonly number[] = [
  67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8,
  123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9,
  183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1
];

/** "07530" and 7530 are one object; anything that is not a number is looked up as written (transmitters.ts's rule). */
const keyOf = (satnum: string | number): string => {
  const s = String(satnum).trim();
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};

export function makeTransponders(data: TransponderData): TransponderTable {
  const X = data.x;
  const own = (k: string) => Object.prototype.hasOwnProperty.call(X, k);
  return {
    built: data.built, source: data.source, licence: data.licence, objects: data.objects, records: data.records,
    forSat(satnum) {
      const k = keyOf(satnum);
      return own(k) ? X[k]!.map(t => ({
        ulLo: t[0], ulHi: t[1], dlLo: t[2], dlHi: t[3], inv: t[4] === 1, linear: t[1] > t[0] && t[3] > t[2],
        mode: t[5], upMode: t[6], tone: t[7], desc: t[8]
      })) : [];
    },
    has(satnum) { return own(keyOf(satnum)); }
  };
}

/** One promise for every caller while it is on its way or has come; a failure is forgotten, so the next call asks again (a lost
 *  chunk on a flaky connection is not the end of the table for the visit). */
export function retrying<T>(get: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= get().catch((e: unknown) => { p = null; throw e; }));
}

/** The table, fetched on first use (its own chunk) and kept; asked for again after a failure. */
export const loadTransponders: () => Promise<TransponderTable> = retrying(
  () => import('../../../data/transponders.json').then(m => makeTransponders(m.default as unknown as TransponderData)));
