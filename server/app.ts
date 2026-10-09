/* The data-cache API. Compute stays in the browser; this only fetches, validates and caches what the page
 * would otherwise fetch for itself, so that N visitors cost CelesTrak one request, not N.
 *
 *   createApi(env, deps?)   env: a plain object (serve.ts passes process.env; tests pass what they like)
 *                           deps: { fetch, now } - injectable, so a test drives the whole app with a scripted
 *                           upstream and a clock it controls, and never touches the network
 *   export type Api          what the Eden client is typed from (src/lib/net/api.ts imports it as a TYPE only)
 *
 * No host is assumed. app.handle(request) is the whole surface: serve.ts puts it behind a Node listener, and
 * `export default { fetch: req => api.fetch(req) }` is all a serverless platform would need. No OpenAPI and no
 * static files here - those are serve.ts's, and only outside production.
 *
 * Everything under /api carries `x-gt-api: 1` (the client tells this API from a 404 page by it), including
 * errors and the 404 of an unknown path under /api. Nothing outside /api does.
 *
 * Imports are relative with a .js suffix and there are no `node:` imports and no `process`: a platform's
 * TypeScript build may support neither path aliases nor project references.
 */
import { Elysia } from 'elysia';
import { API_HEADER } from '../shared/api-types.js';
import { loadConfig, type Env } from './config.js';
import type { Ctx } from './ctx.js';
import { corsHeaders } from './lib/cors.js';
import { CACHE_CONTROL } from './lib/errors.js';
import { createServices } from './lib/services.js';
import type { Deps, FetchFn } from './lib/upstream.js';
import { fallbackRoutes } from './routes/fallback.js';
import { healthRoutes } from './routes/health.js';
import { historyRoutes } from './routes/history.js';
import { tleRoutes } from './routes/tle.js';

export type { Env } from './config.js';
export type { Deps, FetchFn } from './lib/upstream.js';

export function createApi(env: Env = {}, deps: Partial<Deps> = {}) {
  const config = loadConfig(env);
  const fetchFn: FetchFn = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const d: Deps = { fetch: fetchFn, now: deps.now ?? (() => Date.now()) };
  const ctx: Ctx = { config, deps: d, services: createServices(config, d) };

  return new Elysia({ prefix: '/api' })
    /* These two hooks are registered before the routes, so they cover every route below (the Elysia instance
       scopes them to this app: a static file or a 404 served by whatever this is mounted under does not get them). */
    .onTransform(({ request, set }) => {
      set.headers[API_HEADER] = '1';
      Object.assign(set.headers, corsHeaders(config.corsOrigins, request.headers.get('origin')));
    })
    .onError(({ code, error, set }) => {
      /* never cached, never a stack trace. A bad number is the caller's mistake (400); a response that fails its own
         schema is ours (500). */
      set.headers['cache-control'] = CACHE_CONTROL.noStore;
      if (code === 'VALIDATION' && error.type !== 'response') { set.status = 400; return { error: 'bad_norad' as const }; }
      if (code === 'NOT_FOUND') { set.status = 404; return { error: 'not_found' as const }; }
      set.status = 500;
      return { error: 'internal' as const };
    })
    .use(healthRoutes(ctx))
    .use(tleRoutes(ctx))
    .use(historyRoutes(ctx))
    /* Anything under /api that no route took is answered by the fallback, as JSON and with the API header. Typed as
       a bare Elysia so its `*` routes stay out of what the Eden client sees. */
    .use(fallbackRoutes(ctx) as unknown as Elysia);
}

export type Api = ReturnType<typeof createApi>;
