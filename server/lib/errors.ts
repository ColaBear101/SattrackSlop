/* The shapes the API answers with when it cannot give an element set or a history, the Cache-Control for
 * every kind of answer, and the mapping from "what went wrong upstream" to a status.
 *
 * Errors are never cached: a 502 that a CDN kept for a few minutes would turn one bad moment at CelesTrak into a
 * few minutes of nothing for everybody, and the browser has a direct fallback that would not have needed it.
 * There is no stale-if-error in v1, on purpose: an element set older than its TTL is not served because the
 * source that should have replaced it is down.
 */
import { t } from 'elysia';
import type { Tried } from '../../shared/api-types.js';

/* ---- Cache-Control, for whichever CDN sits in front ------------------------------------------------- */

export const CACHE_CONTROL = {
  /** browsers always revalidate (the page keeps its own 3 h copy); a CDN may hold it 5 min and refresh in the background */
  tleOk: 'public, max-age=0, s-maxage=300, stale-while-revalidate=900',
  tleGone: 'public, s-maxage=3600',
  historyOk: 'public, s-maxage=43200, stale-while-revalidate=86400',
  historyNone: 'public, s-maxage=3600',
  noStore: 'no-store'
} as const;

/* ---- schemas (Elysia's TypeBox): they validate what leaves, and they are what the Eden client is typed from ---- */

export const OutcomeSchema = t.Union([
  t.Literal('unreachable'), t.Literal('timeout'), t.Literal('http'),
  t.Literal('unreadable'), t.Literal('too_large'), t.Literal('older')
]);
export const TriedSchema = t.Object({ src: t.String(), outcome: OutcomeSchema, status: t.Optional(t.Number()) });

export const BadNoradSchema = t.Object({ error: t.Literal('bad_norad') });
export const RateLimitedSchema = t.Object({ error: t.Literal('rate_limited') });
export const UpstreamUnavailableSchema = t.Object({ error: t.Literal('upstream_unavailable'), tried: t.Array(TriedSchema) });
export const UpstreamTimeoutSchema = t.Object({ error: t.Literal('upstream_timeout') });

/** 504 when every source that was asked ran out of time, 502 for anything else (a mix of failures is not a timeout). */
export function failureStatus(tried: readonly Tried[]): 502 | 504 {
  return tried.length > 0 && tried.every(x => x.outcome === 'timeout') ? 504 : 502;
}
