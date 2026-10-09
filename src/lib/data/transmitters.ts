/* Downlink frequencies, baked from SatNOGS DB (data/transmitters.json, written by verification/fetch-transmitters.js).
 *
 * The table was a 122 KB script of object literals the page always loaded; it is a JSON file now, fetched as its own
 * chunk the first time a downlink is wanted, so the first paint does not carry it. The lookups are the old
 * `Transmitters` object's (legacy/earth/transmitters.js, main@4eadd7a), with one fix: they are keyed by the NORAD
 * NUMBER. The page asked for the zero-padded text of the TLE's catalogue column ("01804") in a table keyed 1804, so
 * the twenty satellites numbered under 10000 that have a downlink never showed one (CHANGES-FROM-LEGACY.md, item 1).
 *
 * Each record is [downlinkHz, mode, baud, description, service]. Objects absent from the table have no active
 * downlink in SatNOGS, which is the common case for the government and commercial half of the catalogue: the page
 * says so rather than guessing a frequency. */

export type TxRecord = [number, string, number, string, string];
export interface TransmitterData {
  built: string; source: string; objects: number; records: number;
  tx: Record<string, TxRecord[]>;
}
export interface Downlink { hz: number; mode: string; baud: number; desc: string; service: string }

export interface TransmitterTable {
  built: string; source: string; objects: number; records: number;
  /** Every active downlink for a NORAD id, or an empty array. Never null: a caller that forgets to check should
   *  render nothing, not crash. The id may be spelt as the TLE spells it ("01804") or as a number (1804). */
  forSat(satnum: string | number): Downlink[];
  /** The one to tune first: lowest frequency among the active downlinks. */
  primary(satnum: string | number): Downlink | null;
  has(satnum: string | number): boolean;
}

/** "01804" and 1804 are one object; anything that is not a number is looked up as written. */
const keyOf = (satnum: string | number): string => {
  const s = String(satnum).trim();
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};

export function makeTransmitters(data: TransmitterData): TransmitterTable {
  const TX = data.tx;
  const forSat = (satnum: string | number): Downlink[] => {
    const l = Object.prototype.hasOwnProperty.call(TX, keyOf(satnum)) ? TX[keyOf(satnum)] : undefined;
    return l ? l.map(t => ({ hz: t[0], mode: t[1], baud: t[2], desc: t[3], service: t[4] })) : [];
  };
  return {
    built: data.built, source: data.source, objects: data.objects, records: data.records,
    forSat,
    primary(satnum) { const l = forSat(satnum); return l.length ? l[0]! : null; },
    has(satnum) { return Object.prototype.hasOwnProperty.call(TX, keyOf(satnum)); }
  };
}

let loading: Promise<TransmitterTable> | null = null;
/** The table, fetched on first use (its own chunk) and kept. */
export function loadTransmitters(): Promise<TransmitterTable> {
  loading ??= import('../../../data/transmitters.json').then(m => makeTransmitters(m.default as unknown as TransmitterData));
  return loading;
}
