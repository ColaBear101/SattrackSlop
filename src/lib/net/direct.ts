/* The element set, fetched straight from the sources, as the page always did it. MOVED, not rewritten, from
 * legacy/index.html (main@4eadd7a) lines 11424-11524 (fetchTLE): the sources, their order, their URLs, the abort time
 * (8 s a source), the "No GP data found" test read before the status, the validation and the names of the outcomes
 * are the original's. What is gone is the page: the clock, `fetch` and the abort time come in as arguments, and what
 * is cached is decided by the caller (tle-source.ts), which writes the record this returns. The decay history's own
 * direct fetch (legacy/earth/lifetime.js lines 355-379) was here too; it is direct-history.ts now, a chunk of its own
 * asked for at the first history request, and CelesTrak's page reader left the entry with it.
 *
 * It is the fallback when the API is absent, and the first choice when there is none at all: the page worked
 * before the API existed and must not lose that. Both sources send Access-Control-Allow-Origin: *, which is the
 * only reason this can happen in the browser at all. CelesTrak is authoritative and goes first.
 *
 * One difference from the originals, on purpose: their abort timers were cleared the moment the headers arrived,
 * so a body that stalled hung the check for good (and the element-set check's 5 minute re-arm guard kept it from
 * ever being asked again). The deadlines now cover the body as well.
 */
import { isNoGpData, tleFromMirrorJson, tleFromText, tleOk } from '../../../shared/tle';
import type { TleLines } from '../../../shared/tle';
import type { FetchLike } from './types';

/** What a successful check hands back. `at` is when it was fetched. */
export interface LiveTle { l1: string; l2: string; src: string; at: number }
/** CelesTrak no longer carries the object: an answer (usually a re-entry), not an outage. */
export interface GoneTle { src: string; gone: true; at: number }

export const DIRECT_TIMEOUT_MS = 8000;

const SOURCES: ReadonlyArray<{
  name: string;
  url: (id: string) => string;
  parse: (text: string) => TleLines | null;
  gone?: (text: string) => boolean;
}> = [
  { name: 'CelesTrak',
    url: id => 'https://celestrak.org/NORAD/elements/gp.php?CATNR=' + id + '&FORMAT=tle',
    parse: tleFromText,
    /* CelesTrak answers for an object it no longer carries with a 404 and "No GP data found". For something that was
       in the catalogue when this snapshot was built, that nearly always means it has re-entered - an answer, not an
       outage. It was being treated as an outage: the mirror was asked next, and a mirror still serving the last set
       it saw turned a withdrawn object into "Confirmed current". */
    gone: isNoGpData },
  { name: 'TLE API',
    url: id => 'https://tle.ivanstanojevic.me/api/tle/' + id,
    parse: tleFromMirrorJson }
];

/** Ask CelesTrak, then the mirror. `satnum` must already be one to five digits (tle-source.ts checks). Never throws:
 *  CORS, DNS, a timeout, offline - on to the next source; every source failing is null. */
export async function fetchDirectTle(
  satnum: string,
  ctx: { fetch: FetchLike; now: () => number; timeoutMs?: number }
): Promise<LiveTle | GoneTle | null> {
  for (const s of SOURCES) {
    const ctl = new AbortController();
    const bail = setTimeout(() => ctl.abort(), ctx.timeoutMs ?? DIRECT_TIMEOUT_MS);
    try {
      const r = await ctx.fetch(s.url(satnum), { signal: ctl.signal, cache: 'no-store' });
      const text = await r.text();
      /* Read before the status check, since the answer that matters most comes back as a 404. Not written to the
         cache, which holds element sets - the entry's own __next already spaces out the next time it is asked. */
      if (s.gone && s.gone(text)) return { src: s.name, gone: true, at: ctx.now() };
      if (!r.ok) continue;
      const got = s.parse(text);
      /* A source that is up but has no such object answers 200 with an error page, so validate the shape before
         believing it. */
      const rec = { l1: got && got.l1, l2: got && got.l2, src: s.name, at: ctx.now() };
      if (!tleOk(rec, satnum)) continue;
      return rec as LiveTle;                                  // tleOk has just seen that both lines are strings
    } catch { /* CORS, DNS, timeout, offline - try the next one */ }
    finally { clearTimeout(bail); }
  }
  return null;
}
