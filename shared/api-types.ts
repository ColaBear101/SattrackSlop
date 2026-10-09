/* The wire contract of the data-cache API (server/) as plain TypeScript types, for the code on either side
 * that has no business importing the Elysia app: the client's replies are checked against these, and
 * tests/server/types.test.ts pins them to the route schemas so the two cannot drift apart. Pure types and a
 * few constants; no runtime dependencies.
 *
 *   GET /api/health            -> 200 Health
 *   GET /api/tle/:norad        -> 200 TleOk | TleGone                 (a content answer is a 200, so it caches)
 *   GET /api/history/:norad    -> 200 HistoryOk | HistoryNone
 *   any of them                -> 400 BadNorad | 429 RateLimited | 502 UpstreamUnavailable | 504 UpstreamTimeout | 500 Internal
 *
 * `at` is always the instant the upstream was ASKED (ms since 1970), never the instant this API answered, so
 * a cache in front of the API cannot make an element set look younger than it is.
 */

/** Every response of the API carries this header (value "1"): how a client tells the API from a 404 page. */
export const API_HEADER = 'x-gt-api';
/** hit | miss | coalesced, where it means something. */
export const CACHE_HEADER = 'x-gt-cache';

/** The names the page has always shown for where an element set came from. */
export const SRC_CELESTRAK = 'CelesTrak';
export const SRC_MIRROR = 'TLE API';

/** How one upstream attempt ended, when it did not produce an answer. The first five are the names the decay
 *  page has always used for "why there is no history" (verification/verify-lifetime.js):
 *    unreachable  the request itself failed: offline, refused, a redirect (refused on purpose), TLS
 *    timeout      no answer inside the deadline
 *    http         an error status (in `status`)
 *    unreadable   an answer that is not what this reads: no element set in it, or no plotData
 *    too_large    a body past the size cap
 *    older        a valid element set older than the one already held (forward only) */
export type Outcome = 'unreachable' | 'timeout' | 'http' | 'unreadable' | 'too_large' | 'older';
export interface Tried { src: string; outcome: Outcome; status?: number }

export interface Health { ok: true; version: string; now: number }

export interface TleOk { status: 'ok'; norad: string; l1: string; l2: string; src: string; at: number; epoch: number }
export interface TleGone { status: 'gone'; norad: string; src: string; at: number }
export type TleAnswer = TleOk | TleGone;

/** One element set of the run; `ecc` is null where the row carried none (JSON has no NaN). */
export interface HistoryRow { t: number; sma: number; ecc: number | null }
export interface HistoryOk { status: 'ok'; norad: string; P: HistoryRow[]; rows: number; src: string; at: number }
/** A history that arrived and is not usable: `empty` (no rows) or `outside` (rows, all outside the bounds). */
export interface HistoryNone { status: 'none'; norad: string; why: 'empty' | 'outside'; rows: number; src: string; at: number }
export type HistoryAnswer = HistoryOk | HistoryNone;

export interface BadNorad { error: 'bad_norad' }
export interface RateLimited { error: 'rate_limited' }
export interface UpstreamUnavailable { error: 'upstream_unavailable'; tried: Tried[] }
export interface UpstreamTimeout { error: 'upstream_timeout' }
export interface Internal { error: 'internal' }
export interface NotFound { error: 'not_found' }
export interface MethodNotAllowed { error: 'method_not_allowed' }
export type ApiError = BadNorad | RateLimited | UpstreamUnavailable | UpstreamTimeout | Internal | NotFound | MethodNotAllowed;
