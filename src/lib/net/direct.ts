/* The element set and the decay history, fetched straight from the sources, as the page always did it. MOVED, not
 * rewritten, from legacy/index.html (main@4eadd7a) lines 11424-11524 (fetchTLE) and legacy/earth/lifetime.js lines
 * 355-379 (fetchHistory): the sources, their order, their URLs, the abort times (8 s a source for an element set,
 * 75 s for a history), the "No GP data found" test read before the status, the validation and the names of the
 * outcomes are the originals'. What is gone is the page: the clock, `fetch` and the abort times come in as
 * arguments, and what is cached is decided by the callers (tle-source.ts, history-source.ts), which write the
 * record these return.
 *
 * It is the fallback when the API is absent, and the first choice when there is none at all: the page worked
 * before the API existed and must not lose that. Both sources send Access-Control-Allow-Origin: *, which is the
 * only reason this can happen in the browser at all. CelesTrak is authoritative and goes first.
 *
 * One difference from the originals, on purpose: their abort timers were cleared the moment the headers arrived,
 * so a body that stalled hung the check for good (and the element-set check's 5 minute re-arm guard kept it from
 * ever being asked again). The deadlines now cover the body as well.
 */
import { readPlot, type PlotRow } from '../../../shared/plot';
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

/* ---- the decay history -------------------------------------------------------------------------------- */

/* Measured: this endpoint can take over a MINUTE to answer - CelesTrak rebuilds the run of element sets from its
   archive on every call - so the page waits 75 seconds, not 8. */
export const DIRECT_HISTORY_TIMEOUT_MS = 75_000;

/** history() answers {P, why}: P the run of element sets, or null with why saying which way there is none - 'timeout'
 *  (no answer inside 75 s), 'unreachable' (the request itself failed: offline, blocked, refused), 'http' (an error
 *  status, in status), 'unreadable' (an answer with no history in it that this can find), 'empty' (a history with no
 *  rows) or 'outside' (rows, every one outside the bounds of shared/plot.ts, counted in rows). */
export type HistoryOutcome =
  | { P: PlotRow[]; why: null }
  | { P: null; why: 'timeout' | 'unreachable' | 'http' | 'unreadable' | 'empty' | 'outside'; status?: number; rows?: number };

/** legacy/earth/lifetime.js fetchHistory (lines 355-379) without its storage: the request, the abort, the reading. */
export async function fetchDirectHistory(
  satnum: string,
  ctx: { fetch: FetchLike; timeoutMs?: number }
): Promise<HistoryOutcome> {
  const ctl = new AbortController();
  const bail = setTimeout(() => ctl.abort(), ctx.timeoutMs ?? DIRECT_HISTORY_TIMEOUT_MS);
  try {
    const r = await ctx.fetch('https://celestrak.org/NORAD/elements/graph-orbit-data.php?CATNR=' + satnum, { signal: ctl.signal });
    if (!r.ok) return { P: null, why: 'http', status: r.status };
    const got = readPlot(await r.text()), P = got.P;
    if (!P) return { P: null, why: !got.found ? 'unreadable' : got.rows ? 'outside' : 'empty', rows: got.rows };
    return { P, why: null };
  } catch {
    return { P: null, why: ctl.signal.aborted ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(bail);
  }
}
