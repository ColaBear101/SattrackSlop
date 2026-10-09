/* Whatever no route took, under /api: unknown paths (404), a missing number (400), a method other than GET
 * (405, with Allow), and an OPTIONS preflight. Answered as JSON with the API header, so a client can tell
 * "this API has no such thing" from "there is no API here" (a host that answers /api/* with its own 404 page).
 *
 * It is registered for GET as well as for every method: a static-file route mounted beside this app (serve.ts
 * with SERVE_STATIC=1) is a GET wildcard and would otherwise win every unknown GET. The more specific
 * `/api/*` beats it. It is also deliberately left out of the `Api` type (see the cast in app.ts): the Eden
 * client has no use for a route called `*`.
 */
import { Elysia, type Context } from 'elysia';
import type { Ctx } from '../ctx.js';
import { preflightHeaders } from '../lib/cors.js';
import { CACHE_CONTROL } from '../lib/errors.js';

/** `/api/health`, `/api/tle/<anything>`, `/api/history/<anything>`: paths that exist, whatever the method */
const KNOWN_PATH = /^\/api\/(health|tle\/[^/]*|history\/[^/]*)\/?$/;
/** `/api/tle` and `/api/history` with no number: the same mistake as a bad number */
const MISSING_NORAD = /^\/api\/(tle|history)\/?$/;

export const fallbackRoutes = (ctx: Ctx) => {
  const answer = ({ request, set, status }: Context) => {
    const method = request.method;
    const path = new URL(request.url).pathname;
    set.headers['cache-control'] = CACHE_CONTROL.noStore;
    if (method === 'OPTIONS') {
      const pre = preflightHeaders(ctx.config.corsOrigins, request.headers.get('origin'), request.headers.get('access-control-request-headers'));
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(set.headers)) if (v !== undefined) headers[k] = String(v);
      return new Response(null, { status: 204, headers: { ...headers, ...(pre ?? {}), allow: 'GET, HEAD, OPTIONS' } });
    }
    if (method === 'GET' || method === 'HEAD') {
      return MISSING_NORAD.test(path) ? status(400, { error: 'bad_norad' }) : status(404, { error: 'not_found' });
    }
    if (KNOWN_PATH.test(path)) {
      set.headers.allow = 'GET, HEAD, OPTIONS';
      return status(405, { error: 'method_not_allowed' });
    }
    return status(404, { error: 'not_found' });
  };
  return new Elysia()
    .get('/*', answer, { detail: { hide: true } })
    .all('/*', answer, { detail: { hide: true } });
};
