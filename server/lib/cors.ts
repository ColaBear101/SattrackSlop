/* CORS, by hand: @elysia/cors is not a dependency of this project, and what the console needs is a few lines.
 *
 * It matters only when the page and the API are on different origins (VITE_API_BASE pointing elsewhere). On one
 * origin, which is the normal case - Vite proxies /api in dev, a single host serves both in production - no
 * Origin header is sent that matters and nothing here runs. A request is a "simple" GET (no custom headers), so
 * there is normally no preflight; one is answered anyway.
 *
 * The thing that is easy to miss: the client tells the API from a 404 page by the x-gt-api response header, and a
 * browser hides every response header but a few from a cross-origin page unless it is exposed. So it is.
 */

export const EXPOSED_HEADERS = 'x-gt-api, x-gt-cache, retry-after';

/** The CORS headers for a request from `origin` (null when none was sent), given the configured allow-list. */
export function corsHeaders(allowed: readonly string[], origin: string | null): Record<string, string> {
  if (allowed.length === 0) return {};
  if (allowed.includes('*')) {
    return { 'access-control-allow-origin': '*', 'access-control-expose-headers': EXPOSED_HEADERS };
  }
  // a specific list: the answer depends on who asks, so caches must be told (also for an origin that is refused)
  const h: Record<string, string> = { vary: 'Origin' };
  if (origin !== null && allowed.includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-expose-headers'] = EXPOSED_HEADERS;
  }
  return h;
}

/** The answer to an OPTIONS preflight that the allow-list permits, or null. */
export function preflightHeaders(
  allowed: readonly string[], origin: string | null, requestedHeaders: string | null
): Record<string, string> | null {
  const h = corsHeaders(allowed, origin);
  if (!h['access-control-allow-origin']) return null;
  h['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
  if (requestedHeaders) h['access-control-allow-headers'] = requestedHeaders.slice(0, 200);
  h['access-control-max-age'] = '600';
  return h;
}
