/* Asking the upstream sources, and deciding what to believe. No cache and no clock of its own here (the
 * time comes in through Deps); services.ts puts a cache and a single flight in front of these functions.
 *
 * What this reproduces is what the page has always done (legacy/index.html fetchTLE, legacy/earth/lifetime.js
 * fetchHistory), moved to the server:
 *   - CelesTrak first, then the mirror; an answer is believed only if shared/tle.ts says it is a usable
 *     element set for the number that was asked about;
 *   - CelesTrak's "No GP data found" is read BEFORE the status (it arrives as a 404) and is an answer - the
 *     object has been withdrawn - not an outage, so the mirror is not asked to overrule it;
 *   - the decay history is read with the one parser the page uses (shared/plot.ts), and the ways of having no
 *     history keep the names the page gave them.
 *
 * Safety: the hosts are constants (config), only a canonical NORAD number is ever put in a URL, a redirect is
 * an error (a redirect is somewhere else the question was not about), and a body is read as a stream and
 * dropped the moment it passes its cap.
 */
import { SRC_CELESTRAK, SRC_MIRROR, type Outcome, type Tried } from '../../shared/api-types.js';
import type { HistoryRow } from '../../shared/api-types.js';
import { readPlot } from '../../shared/plot.js';
import { NORAD_RE, isNoGpData, tleEpochMs, tleFromMirrorJson, tleFromText, tleOkForNorad } from '../../shared/tle.js';
import type { TleLines } from '../../shared/tle.js';
import type { Config } from '../config.js';

/** What the server calls. Only ever with a string URL. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export interface Deps { fetch: FetchFn; now: () => number }

/** An element set whose epoch is further ahead of the clock than this is not a current one. It would also pin the
 *  forward-only floor above every correct set to come, so it is refused rather than kept. */
export const MAX_EPOCH_AHEAD_MS = 3 * 86_400_000;

/* ---- one request ------------------------------------------------------------------------------------- */

export type Reply =
  | { ok: true; status: number; text: string }
  | { ok: false; outcome: 'unreachable' | 'timeout' | 'too_large' };

const DEADLINE = Symbol('deadline');

/** A body, read as a stream, or null as soon as it is bigger than `maxBytes` (a declared length is believed
 *  only when it already says "too big"). */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { void res.body?.cancel().catch(() => {}); return null; }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let total = 0, text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { void reader.cancel().catch(() => {}); return null; }
    text += dec.decode(value, { stream: true });
  }
  return text + dec.decode();
}

/** One GET with a deadline over the whole exchange (headers AND body) and a size cap. Never throws. The
 *  deadline is raced as well as signalled, so it holds even for a fetch that ignores its AbortSignal. */
export async function httpGet(
  deps: Deps, url: string,
  o: { timeoutMs: number; maxBytes: number; accept: string; userAgent: string }
): Promise<Reply> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ctl.abort(); reject(DEADLINE); }, o.timeoutMs);
  });
  const work = (async (): Promise<Reply> => {
    const res = await deps.fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: ctl.signal,
      headers: { 'user-agent': o.userAgent, accept: o.accept }
    });
    const text = await readCapped(res, o.maxBytes);
    return text === null ? { ok: false, outcome: 'too_large' } : { ok: true, status: res.status, text };
  })();
  work.catch(() => {});                       // if the deadline wins, what the work does afterwards is nobody's business
  try {
    return await Promise.race([work, deadline]);
  } catch (e) {
    return { ok: false, outcome: e === DEADLINE || ctl.signal.aborted ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/* ---- the element set --------------------------------------------------------------------------------- */

/** Where the number goes in a URL: digits, and nothing else. A second layer behind the route's own check. */
function digits(norad: string): string {
  if (!NORAD_RE.test(norad)) throw new TypeError('not a NORAD number');
  return norad;
}

interface TleSource {
  name: string;
  url: (norad: string) => string;
  accept: string;
  read: (text: string) => TleLines | null;
  /** only CelesTrak's "No GP data found" means the object is gone; the mirror is never asked to say so */
  canWithdraw: boolean;
}

export function tleSources(cfg: Pick<Config, 'celestrakBase' | 'mirrorBase'>): readonly TleSource[] {
  return [
    { name: SRC_CELESTRAK, accept: 'text/plain', canWithdraw: true, read: tleFromText,
      url: n => cfg.celestrakBase + '/NORAD/elements/gp.php?CATNR=' + digits(n) + '&FORMAT=TLE' },
    { name: SRC_MIRROR, accept: 'application/json', canWithdraw: false, read: tleFromMirrorJson,
      url: n => cfg.mirrorBase + '/api/tle/' + digits(n) }
  ];
}

export type TleFetch =
  | { kind: 'ok'; l1: string; l2: string; src: string; at: number; epoch: number }
  | { kind: 'gone'; src: string; at: number }
  | { kind: 'failed'; tried: Tried[] };

/** Ask CelesTrak, then the mirror, for the element set of `norad` (canonical). `floorEpoch` is the epoch of the
 *  record already held, or null: an answer older than it is refused, so a stale mirror cannot walk the
 *  cache backwards. `at` on the result is the instant the successful request was MADE. */
export async function fetchTle(deps: Deps, cfg: Config, norad: string, floorEpoch: number | null): Promise<TleFetch> {
  const tried: Tried[] = [];
  for (const s of tleSources(cfg)) {
    const at = deps.now();
    const got = await httpGet(deps, s.url(norad), {
      timeoutMs: cfg.tleTimeoutMs, maxBytes: cfg.tleMaxBytes, accept: s.accept, userAgent: cfg.userAgent
    });
    if (!got.ok) { tried.push({ src: s.name, outcome: got.outcome }); continue; }
    /* Read before the status check, since the answer that matters most comes back as a 404. */
    if (s.canWithdraw && isNoGpData(got.text)) return { kind: 'gone', src: s.name, at };
    if (got.status < 200 || got.status > 299) { tried.push({ src: s.name, outcome: 'http', status: got.status }); continue; }
    /* A source that is up but has no such object answers 200 with an error page, so validate the shape
       before believing it. */
    const read = s.read(got.text);
    const l1 = read && read.l1, l2 = read && read.l2;
    if (typeof l1 !== 'string' || typeof l2 !== 'string' || !tleOkForNorad({ l1, l2 }, norad)) {
      tried.push({ src: s.name, outcome: 'unreadable' });
      continue;
    }
    const epoch = tleEpochMs(l1);
    if (!Number.isFinite(epoch) || epoch > deps.now() + MAX_EPOCH_AHEAD_MS) { tried.push({ src: s.name, outcome: 'unreadable' }); continue; }
    /* Only ever move forward. */
    if (floorEpoch !== null && epoch < floorEpoch) { tried.push({ src: s.name, outcome: 'older' }); continue; }
    return { kind: 'ok', l1, l2, src: s.name, at, epoch };
  }
  return { kind: 'failed', tried };
}

/* ---- the decay history ------------------------------------------------------------------------------- */

export type HistoryFetch =
  | { kind: 'ok'; P: HistoryRow[]; rows: number; src: string; at: number }
  | { kind: 'none'; why: 'empty' | 'outside'; rows: number; src: string; at: number }
  | { kind: 'failed'; tried: Tried[] };

export function historyUrl(cfg: Pick<Config, 'celestrakBase'>, norad: string): string {
  return cfg.celestrakBase + '/NORAD/elements/graph-orbit-data.php?CATNR=' + digits(norad);
}

/** The history of `norad` (canonical) from CelesTrak, in the page's own terms (verification/verify-lifetime.js):
 *  rows -> ok; a page with no rows or only rows outside the bounds -> none (`empty` / `outside`, which are answers);
 *  anything else -> failed, with the outcome named as the page names it (http, unreachable, timeout, unreadable). */
export async function fetchHistory(deps: Deps, cfg: Config, norad: string): Promise<HistoryFetch> {
  const at = deps.now();
  const fail = (outcome: Outcome, status?: number): HistoryFetch =>
    ({ kind: 'failed', tried: [status === undefined ? { src: SRC_CELESTRAK, outcome } : { src: SRC_CELESTRAK, outcome, status }] });
  const got = await httpGet(deps, historyUrl(cfg, norad), {
    timeoutMs: cfg.historyTimeoutMs, maxBytes: cfg.historyMaxBytes, accept: 'text/html', userAgent: cfg.userAgent
  });
  if (!got.ok) return fail(got.outcome);
  if (got.status < 200 || got.status > 299) return fail('http', got.status);
  const read = readPlot(got.text);
  if (!read.P) {
    if (!read.found) return fail('unreadable');
    return { kind: 'none', why: read.rows ? 'outside' : 'empty', rows: read.rows, src: SRC_CELESTRAK, at };
  }
  /* JSON has no NaN: a row with no eccentricity travels as null, and the client turns it back into NaN. */
  const P: HistoryRow[] = read.P.map(r => ({ t: r.t, sma: r.sma, ecc: Number.isFinite(r.ecc) ? r.ecc : null }));
  return { kind: 'ok', P, rows: read.rows, src: SRC_CELESTRAK, at };
}
