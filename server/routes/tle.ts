/* GET /api/tle/:norad - the current element set of one object, from memory or from CelesTrak (then the mirror).
 *
 *   200 {status:'ok', norad, l1, l2, src, at, epoch}   an element set
 *   200 {status:'gone', norad, src, at}                CelesTrak no longer carries the object (a withdrawal, not an outage)
 *   400 bad_norad   429 rate_limited   502 upstream_unavailable {tried}   504 upstream_timeout
 *
 * A content answer is a 200 so that it caches. `at` is the instant upstream was asked, so a cache in front of
 * this cannot make a set look younger than it is. `norad` is the canonical number: "01804" and "1804" are one
 * object, one cache entry and one URL upstream.
 */
import { Elysia, t } from 'elysia';
import { canonicalNorad } from '../../shared/tle.js';
import type { Ctx } from '../ctx.js';
import {
  BadNoradSchema, CACHE_CONTROL, RateLimitedSchema, UpstreamTimeoutSchema, UpstreamUnavailableSchema, failureStatus
} from '../lib/errors.js';

/** One to five digits; anything else is a 400 before any upstream is asked. */
export const NoradParams = t.Object({ norad: t.String({ pattern: '^\\d{1,5}$' }) });

export const TleOkSchema = t.Object({
  status: t.Literal('ok'), norad: t.String(), l1: t.String(), l2: t.String(),
  src: t.String(), at: t.Number(), epoch: t.Number()
});
export const TleGoneSchema = t.Object({ status: t.Literal('gone'), norad: t.String(), src: t.String(), at: t.Number() });

export const tleRoutes = (ctx: Ctx) =>
  new Elysia().get('/tle/:norad', async ({ params, request, set, status }) => {
    /* the route's schema has already refused anything but digits; this is the second layer, the one that holds
       if the schema is ever loosened */
    const norad = canonicalNorad(params.norad);
    if (norad === null) { set.headers['cache-control'] = CACHE_CONTROL.noStore; return status(400, { error: 'bad_norad' }); }

    const budget = ctx.services.limit('tle', request);
    if (!budget.ok) {
      set.headers['retry-after'] = String(budget.retryAfterS);
      set.headers['cache-control'] = CACHE_CONTROL.noStore;
      return status(429, { error: 'rate_limited' });
    }

    const { result, cache } = await ctx.services.tle(norad);
    set.headers['x-gt-cache'] = cache;
    if (result.kind === 'ok') {
      set.headers['cache-control'] = CACHE_CONTROL.tleOk;
      return { status: 'ok' as const, norad, l1: result.l1, l2: result.l2, src: result.src, at: result.at, epoch: result.epoch };
    }
    if (result.kind === 'gone') {
      set.headers['cache-control'] = CACHE_CONTROL.tleGone;
      return { status: 'gone' as const, norad, src: result.src, at: result.at };
    }
    set.headers['cache-control'] = CACHE_CONTROL.noStore;
    return failureStatus(result.tried) === 504
      ? status(504, { error: 'upstream_timeout' })
      : status(502, { error: 'upstream_unavailable', tried: result.tried });
  }, {
    params: NoradParams,
    response: {
      200: t.Union([TleOkSchema, TleGoneSchema]),
      400: BadNoradSchema, 429: RateLimitedSchema, 502: UpstreamUnavailableSchema, 504: UpstreamTimeoutSchema
    }
  });
