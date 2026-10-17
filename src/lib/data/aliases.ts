/* The other names of the catalogue's spacecraft, baked from SatNOGS DB (data/aliases.json, written by
 * verification/tools/fetch-aliases.js; CHANGES-FROM-LEGACY.md, L61).
 *
 * The catalogue names an object as its element-set source does: AO-7 is OSCAR 7, SO-50 SAUDISAT 1C, FO-29 JAS 2, and
 * RS-44 the rocket stage it rode on, BREEZE-KM R/B. The table holds, for 494 of the 2,158, the SatNOGS name and the
 * alternative names a search of the catalogue's own name would not find. It is SatNOGS DB data, under CC BY-SA 4.0, as the
 * footer's credit line says. A chunk of its own, asked for the first time something is typed into the picker (never at
 * boot): the page never asks SatNOGS anything. Keyed by the NORAD number without its leading zeros ("7530" for 07530).
 * This loader is the picker's own (in the entry, a few bytes): it asks for the table in the same moment as for the finder's chunk
 * (lib/catalogue/alias.ts), not once that chunk has come. */

export interface AliasData {
  built: string; source: string; licence: string;
  a: Record<string, readonly string[]>;
}

let loading: Promise<AliasData> | null = null;
/** The table, fetched on first use (its own chunk) and kept. */
export function loadAliases(): Promise<AliasData> {
  loading ??= import('../../../data/aliases.json').then(m => m.default as unknown as AliasData);
  return loading;
}
