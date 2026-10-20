/* The other names of the catalogue's spacecraft, baked from SatNOGS DB (data/aliases.json, written by
 * verification/tools/fetch-aliases.js; CHANGES-FROM-LEGACY.md, L61).
 *
 * The catalogue names an object as its element-set source does: AO-7 is OSCAR 7, SO-50 SAUDISAT 1C, FO-29 JAS 2, and
 * RS-44 the rocket stage it rode on, BREEZE-KM R/B. The table holds, for 494 of the 2,158, the SatNOGS name and the
 * alternative names a search of the catalogue's own name would not find. It is SatNOGS DB data, under CC BY-SA 4.0, as the
 * footer's credit line says. A file of the page's own (assets/aliases-<hash>.json, the same bytes), fetched the first time
 * something is typed into the picker (never at boot), and asked for again after a failure (../net/file.ts says why it is not
 * imported as a chunk; L65): the page never asks SatNOGS anything. Keyed by the NORAD number without its leading zeros ("7530"
 * for 07530). This loader is the picker's own (in the entry, a few bytes): it asks for the table in the same moment as for the
 * finder's chunk (lib/catalogue/alias.ts), not once that chunk has come. */

import ALIASES_URL from '../../../data/aliases.json?url';
import { fetchTable, retrying } from '../net/file';

export interface AliasData {
  built: string; source: string; licence: string;
  a: Record<string, readonly string[]>;
}

/** The table, fetched on first use and kept; after a failure the next call asks again. */
export const loadAliases: () => Promise<AliasData> = retrying(() => fetchTable(ALIASES_URL, 'a') as Promise<AliasData>);
