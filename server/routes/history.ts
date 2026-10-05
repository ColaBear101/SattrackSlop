/* GET /api/history/:norad - the decay history of one object (CelesTrak's graph-orbit-data page), read with the
 * page's own parser and returned as the run of element sets the decay estimate fits.
 *
 *   200 {status:'ok', norad, P:[{t,sma,ecc}], rows, src, at}     the history; `ecc` is null where a row had none
 *   200 {status:'none', norad, why:'empty'|'outside', rows, src, at}   it arrived and there is nothing to fit - an answer, not a retry
 *   400 bad_norad   429 rate_limited   502 upstream_unavailable {tried}   504 upstream_timeout
 *
 * `tried[].outcome` carries the names the decay page has always used for a request that gave no history:
 * `http` (with `status`), `unreachable`, `unreadable`; a deadline is the 504. Each way of having no history
 * is told apart from the others, and from a history. The full series is returned, never thinned, so a
 * forecast made from it is the forecast the page would have made itself.
 */
import { Elysia, t } from 'elysia';
import { canonicalNorad } from '../../shared/tle.js';
import type { Ctx } from '../ctx.js';
import {
  BadNoradSchema, CACHE_CONTROL, RateLimitedSchema, UpstreamTimeoutSchema, UpstreamUnavailableSchema, failureStatus
} from '../lib/errors.js';
import { NoradParams } from './tle.js';

export const HistoryRowSchema = t.Object({ t: t.Number(), sma: t.Number(), ecc: t.Union([t.Number(), t.Null()]) });
export const HistoryOkSchema = t.Object({
  status: t.Literal('ok'), norad: t.String(), P: t.Array(HistoryRowSchema), rows: t.Number(), src: t.String(), at: t.Number()
});
export const HistoryNoneSchema = t.Object({
  status: t.Literal('none'), norad: t.String(), why: t.Union([t.Literal('empty'), t.Literal('outside')]),
  rows: t.Number(), src: t.String(), at: t.Number()
});

export const historyRoutes = (ctx: Ctx) =>
  new Elysia().get('/history/:norad', async ({ params, request, set, status }) => {
    const norad = canonicalNorad(params.norad);
    if (norad === null) { set.headers['cache-control'] = CACHE_CONTROL.noStore; return status(400, { error: 'bad_norad' }); }

    const budget = ctx.services.limit('history', request);
    if (!budget.ok) {
      set.headers['retry-after'] = String(budget.retryAfterS);
      set.headers['cache-control'] = CACHE_CONTROL.noStore;
      return status(429, { error: 'rate_limited' });
    }

    const { result, cache } = await ctx.services.history(norad);
    set.headers['x-gt-cache'] = cache;
    if (result.kind === 'ok') {
      set.headers['cache-control'] = CACHE_CONTROL.historyOk;
      return { status: 'ok' as const, norad, P: result.P, rows: result.rows, src: result.src, at: result.at };
    }
    if (result.kind === 'none') {
      set.headers['cache-control'] = CACHE_CONTROL.historyNone;
      return { status: 'none' as const, norad, why: result.why, rows: result.rows, src: result.src, at: result.at };
    }
    set.headers['cache-control'] = CACHE_CONTROL.noStore;
    return failureStatus(result.tried) === 504
      ? status(504, { error: 'upstream_timeout' })
      : status(502, { error: 'upstream_unavailable', tried: result.tried });
  }, {
    params: NoradParams,
    response: {
      200: t.Union([HistoryOkSchema, HistoryNoneSchema]),
      400: BadNoradSchema, 429: RateLimitedSchema, 502: UpstreamUnavailableSchema, 504: UpstreamTimeoutSchema
    }
  });
