/* What counts as a usable element set, and how one is read out of an upstream answer.
 *
 * MOVED, not rewritten, from legacy/index.html (main@4eadd7a), lines 11438-11484 (tleFromText, the two
 * source parsers' bodies, the "No GP data found" test, TLE_LINE and tleOk) and from the epoch arithmetic of
 * elements() (src/lib/analysis/engine.ts, lines 34-38). The browser and the API server import THIS file, so
 * "is this a TLE this page will run a propagator on" has exactly one answer. Pure TypeScript: no DOM, no
 * Node, no imports. Behaviour is the original's; the types and the names of the helpers are new.
 *
 * What the original asked of a network reply and of a cached copy alike (and what it did NOT):
 *   - both lines are strings of 69 to 71 printable ASCII characters (0x20-0x7E);
 *   - the catalogue number in columns 3 to 7 of BOTH lines, trimmed, is the number that was asked for.
 *   There is no checksum test and no test of the leading "1 " / "2 " here. The text parser below needs the
 *   "1 " / "2 " pair to find the lines in a reply, and the planner checks checksums for the orbits a reader
 *   designs; a reply from CelesTrak or its mirror was never held to either, and this file does not start.
 */

/* ---- the number -------------------------------------------------------------------------------------- */

/** One to five digits: the only thing that is ever put in a URL or used as a storage key. */
export const NORAD_RE = /^\d{1,5}$/;

/** The legacy second-layer guard of fetchTLE: `/^\d{1,5}$/.test(String(satnum))`. It coerces, as the original did
 *  (a number passes, `null`, `undefined`, `'25544\n'` and `' 25544'` do not). */
export function isNoradId(satnum: unknown): boolean {
  return NORAD_RE.test(String(satnum));
}

/** The numeric value as a string, without leading zeros: "01804" and "1804" are one object. `null` when it is
 *  not one to five digits. This is the key the API caches under and the spelling it puts in an upstream URL. */
export function canonicalNorad(raw: unknown): string | null {
  return typeof raw === 'string' && NORAD_RE.test(raw) ? String(Number(raw)) : null;
}

/* ---- reading an answer ------------------------------------------------------------------------------- */

/** The two lines as a reply carried them. Nothing is promised about them until tleOk has seen them. */
export interface TleLines { l1: unknown; l2: unknown }

/** CelesTrak's reply: an optional name line, then the pair that starts "1 " and "2 ". */
export function tleFromText(t: unknown): { l1: string; l2: string } | null {
  const L = String(t).trim().split(/\r?\n/).map(x => x.replace(/\s+$/,''));
  for(let i=0;i<L.length-1;i++)
    if(L[i].startsWith('1 ') && L[i+1].startsWith('2 '))
      return {l1:L[i], l2:L[i+1]};
  return null;
}

/** The mirror's reply: JSON with `line1` and `line2`. */
export function tleFromMirrorJson(t: string): TleLines | null {
  try { const j = JSON.parse(t);
    return (j && j.line1 && j.line2) ? {l1:j.line1, l2:j.line2} : null;
  } catch { return null; }
}

/* CelesTrak answers for an object it no longer carries with a 404 and "No GP
   data found". For something that was in the catalogue when this snapshot
   was built, that nearly always means it has re-entered - an answer, not an
   outage. It was being treated as an outage: the mirror was asked next, and
   a mirror still serving the last set it saw turned a withdrawn object into
   "Confirmed current". Read before the status is looked at, since it comes back as a 404. */
export function isNoGpData(text: string): boolean {
  return /No GP data found/i.test(text);
}

/* ---- what a usable element set looks like ------------------------------------------------------------ */

/* What a two-line element set has to look like before this page will run a
   propagator on it.

   A TLE line is 69 characters of printable ASCII, and both lines carry the
   catalogue number in columns 3 to 7. The old check asked only that line 1 be
   AT LEAST 69 characters and that its number matched - no maximum, no
   character restriction, nothing asked of line 2 at all - so a line with
   anything appended past column 69 was accepted and handed to the renderer and
   to SGP4.

   One function, used on both the network reply and the cached copy. They were
   two different standards before: the fetch branch validated, and the cache
   branch checked that l1 was truthy. A record that could never have arrived
   over the network was therefore trusted the moment it was in localStorage -
   which is exactly where the fetch branch puts things. */
export const TLE_LINE = /^[\x20-\x7E]{69,71}$/;
export function tleOk(rec: { l1?: unknown; l2?: unknown } | null | undefined, satnum: unknown): boolean {
  return !!rec && typeof rec.l1 === 'string' && typeof rec.l2 === 'string'
    && TLE_LINE.test(rec.l1) && TLE_LINE.test(rec.l2)
    && rec.l1.substring(2, 7).trim() === String(satnum)
    && rec.l2.substring(2, 7).trim() === String(satnum);
}

/** tleOk for a canonical number ("1804"). A TLE spells the number zero-padded to five columns ("01804"); the
 *  original compared the spelling it had asked for, and the catalogue asks with the line's own spelling. The
 *  API asks with the numeric value, so it accepts either spelling of the same number. */
export function tleOkForNorad(rec: { l1?: unknown; l2?: unknown } | null | undefined, norad: string): boolean {
  return tleOk(rec, norad) || tleOk(rec, norad.padStart(5, '0'));
}

/* ---- forward only ------------------------------------------------------------------------------------ */

/** The epoch of line 1 in ms since 1970: the same arithmetic as elements() in src/lib/analysis/engine.ts
 *  (two-digit year with the pivot at 57, day of year with its fraction, through a Date so the value is the
 *  integer the original compared). NaN when the columns do not hold a date. */
export function tleEpochMs(l1: string): number {
  const yy = parseInt(l1.substring(18,20),10);
  const doy = parseFloat(l1.substring(20,32));
  const year = yy < 57 ? 2000+yy : 1900+yy;
  return new Date(Date.UTC(year,0,1) + (doy-1)*86400000).getTime();
}

/** `refreshTLE`'s test, `elements(got).epoch > elements(held).epoch`: strictly newer. Equal, older, or an
 *  epoch that is not a date (NaN compares false) is "not newer". */
export function isNewerSet(got: { l1: string }, held: { l1: string }): boolean {
  return tleEpochMs(got.l1) > tleEpochMs(held.l1);
}
