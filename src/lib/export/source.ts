/* Where the element set on screen came from, for the CSV: "embedded" for the snapshot built into this page, with the
 * source that last confirmed it current if one has; otherwise the source it was fetched from, and when.
 *
 * Moved from `tleSource()` in legacy/index.html (main@4eadd7a), lines 10176-10203, with its comments and its text.
 * What it read from the page (the entry's provenance, whether the lines are the embedded ones, the cached copy in
 * localStorage) is its argument. */
import type { Prov } from '../text/provenance';

/** What a planned orbit's file says about its origin: first, never "embedded", never "fetched live". */
export const CUSTOM_SOURCE = 'custom orbit planned on this page from user-entered elements; not a catalogue object; nothing was fetched';

export interface SourceIn {
  custom: boolean;
  /** the entry's provenance record, or null if it has not been checked */
  prov: Prov | null;
  /** the two lines on screen are the embedded ones */
  embedded: boolean;
  l1: string; l2: string;
  /** the `tle:<n>` copy in localStorage, or null */
  cached: { l1: string; l2: string; src?: string; at: number } | null;
}

const isoZ = (t: number): string => new Date(t).toISOString();

/* Read off the lines themselves as well as off the record, which records the last CHECK - a set taken live and then
   re-checked with the network down is still the live set, and would otherwise be written up as the embedded one. */
export function tleSourceText({ custom, prov: pv, embedded, l1, l2, cached }: SourceIn): string {
  const at = (t: number | undefined): string => isoZ(t as number);
  if (custom) return CUSTOM_SOURCE;        // first: never "embedded", never "fetched live"
  /* And what the last check said against it, when that was not a newer set: CelesTrak answering "No GP data found",
     or offering a newer set SGP4 cannot propagate - both, in practice, an object that has come down. The page says
     so under the element set; the file wrote plain "embedded", and a table read later showed no sign that its
     spacecraft might no longer be there. */
  const said = !pv ? ''
    : pv.gone ? '; ' + pv.gone + ' reports no current set ' + at(pv.at)
    : pv.dead ? '; ' + pv.dead + ' has a newer set SGP4 cannot propagate ' + at(pv.at) : '';
  if (embedded)
    return 'embedded' + (pv && pv.src ? ', confirmed current by ' + pv.src + ' ' + at(pv.at) : '') + said;
  if (pv && pv.src) return pv.src + ', fetched ' + at(pv.at);
  const c = cached;
  if (c && c.l1 === l1 && c.l2 === l2 && c.src) return c.src + ', fetched ' + at(c.at) + said;
  return 'fetched live, source not recorded' + said;
}
