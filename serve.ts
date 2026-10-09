/* serve.ts - the API on a port. `npx tsx serve.ts` (dev: `tsx watch serve.ts`, behind Vite's /api proxy on 3001).
 *
 * The one place that touches the process: it reads process.env, hands it to createApi, and puts the result behind a
 * Node listener with @elysia/node (no Bun). Nothing here is needed by a serverless host, which would import
 * createApi from server/app.ts and expose `fetch` itself; hosting is undecided, so this is the self-host path.
 *
 *   PORT (3001)  HOST (127.0.0.1)  NODE_ENV  SERVE_STATIC=1  - the rest is in server/config.ts
 *
 * Outside production it also serves OpenAPI docs at /api/docs (registered here, never in server/app.ts, so a
 * production bundle of the API does not carry them) and honours UPSTREAM_CELESTRAK / UPSTREAM_MIRROR. An unset
 * NODE_ENV counts as development: SET NODE_ENV=production WHEN DEPLOYING. With SERVE_STATIC=1 it serves dist/ too, so one process is
 * the whole site: put Caddy or nginx in front for TLS and set TRUST_PROXY=1 so the rate limiter sees real clients.
 *
 * Not named app.ts / server.ts / index.ts: a platform that detects an Elysia entry point by those names must not
 * pick this up by mistake.
 */
import { readFileSync } from 'node:fs';
import { Elysia } from 'elysia';
import { node } from '@elysia/node';
import { createApi } from './server/app.js';
import { CELESTRAK_BASE, ConfigError, MIRROR_BASE, loadConfig } from './server/config.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string };
const env = { GT_VERSION: pkg.version, ...process.env };

let config;
try {
  config = loadConfig(env);
} catch (e) {
  if (e instanceof ConfigError) { console.error('[api] ' + e.message); process.exit(1); }
  throw e;
}

const app = new Elysia({ adapter: node() });

if (!config.production) {
  const { openapi } = await import('@elysia/openapi');
  app.use(openapi({
    path: '/api/docs',
    specPath: '/api/docs/json',
    documentation: {
      info: {
        title: 'sattrackslop data-cache API',
        version: config.version,
        description: 'Element sets and decay histories, cached and single-flighted so many visitors cost CelesTrak one request. Compute stays in the browser.'
      }
    }
  }));
}

app.use(createApi(env));

if (config.serveStatic) {
  /* dist/ exactly as built: index.html, the hashed assets, the Moon pages. Revalidated on every load (ETag), so a
     deploy is never half old, half new; a proxy in front can cache the hashed /assets/ for a year. */
  const { staticPlugin } = await import('@elysia/static');
  /* @elysia/node 1.4.6 answers a Blob - what @elysia/static returns - with BOTH Content-Length and
     "Transfer-Encoding: chunked". Browsers and curl put up with that; a strict HTTP/1.1 parser (Node's own fetch, nginx
     as a proxy) refuses the response. Handing the adapter a Response instead keeps it off that path; the ETag and
     Cache-Control the plugin set on the way stay, they travel in `set.headers`. */
  app.onAfterHandle({ as: 'global' }, ({ response }) => {
    if (response instanceof Blob) return new Response(response, { headers: { 'content-type': response.type || 'application/octet-stream' } });
  });
  app.use(await staticPlugin({ assets: 'dist', prefix: '/', maxAge: 0, directive: 'no-cache', silent: true }));
}

app.listen({ port: config.port, hostname: config.host }, server => {
  const note: string[] = [config.production ? 'production' : 'development'];
  if (config.celestrakBase !== CELESTRAK_BASE) note.push('CelesTrak -> ' + config.celestrakBase);
  if (config.mirrorBase !== MIRROR_BASE) note.push('mirror -> ' + config.mirrorBase);
  if (config.serveStatic) note.push('serving dist/');
  if (!config.production) note.push('docs at /api/docs');
  console.log('[api] listening on http://' + server.hostname + ':' + server.port + ' (' + note.join(', ') + ')');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => { void app.stop().finally(() => process.exit(0)); });
}
