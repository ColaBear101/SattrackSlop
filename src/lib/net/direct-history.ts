/* The decay history, fetched straight from CelesTrak, as the page always did it. MOVED, not rewritten, from direct.ts (where it came
 * from legacy/earth/lifetime.js lines 355-379, fetchHistory: the URL, the 75 s abort, the reading and the names of the outcomes are
 * the original's), so that neither it nor CelesTrak's page reader is in the entry, which every visit downloads: history-source.ts
 * imports this at the first history request that gets as far as a direct fetch.
 *
 * The page is read with shared/plot.ts's readPlot as the Decay section's model carries it (Lifetime.readPlot, the same function), so
 * the reader stays in the lifetime chunk, which the first screen fetches anyway (for the planner and the Decay section); a chunk of
 * its own for it, fetched with that one, cost the first screen more than leaving the entry saved.
 *
 * It is the fallback when the API is absent, and the first choice when there is none at all. One difference from the original, on
 * purpose (as for the element set, direct.ts): the deadline covers the body as well as the headers. */
import type { PlotRow } from '../../../shared/plot';
import { Lifetime } from '../planner/lifetime';
import type { FetchLike } from './types';

/* Measured: this endpoint can take over a MINUTE to answer - CelesTrak rebuilds the run of element sets from its archive on every
   call - so the page waits 75 seconds, not 8. */
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
    const got = Lifetime.readPlot(await r.text()), P = got.P;
    if (!P) return { P: null, why: !got.found ? 'unreadable' : got.rows ? 'outside' : 'empty', rows: got.rows };
    return { P, why: null };
  } catch {
    return { P: null, why: ctl.signal.aborted ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(bail);
  }
}
