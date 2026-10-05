/* harness.js - the one way every suite reaches the page under test.
 *
 * Before this file, ten suites opened index.html from file:// and six more each
 * carried their own copy of a 15-line static server. A bundled app cannot be
 * opened from disk (ES modules and workers need an origin), and "which build am I
 * testing" has to be a switch rather than an edit, so both now live here.
 *
 *   GT_TARGET=legacy   the pre-rewrite Earth console, served from legacy/   (default for now)
 *   GT_TARGET=new      the production build, served from dist/
 *   GT_URL=<url>       test something already running (a preview, a deployment)
 *   PW_PATH=<path>     where to find playwright, when it is not in node_modules
 *
 * The server is deliberately dumb. It has no SPA fallback, so a missing file is a
 * 404 and not index.html with a 200, and it sends the right MIME type for modules,
 * wasm and fonts. It is not `vite preview`, which can answer an unknown /api/x
 * with the app shell and cannot serve legacy/ beside dist/.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGETS = { legacy: path.join(ROOT, 'legacy'), new: path.join(ROOT, 'dist') };

function targetName() {
  const t = process.env.GT_TARGET || 'legacy';
  if (!TARGETS[t]) throw new Error('GT_TARGET must be "legacy" or "new", not "' + t + '"');
  return t;
}
const targetRoot = () => TARGETS[targetName()];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.tle': 'text/plain; charset=utf-8', '.cof': 'text/plain; charset=utf-8'
};

/* A static server on a free port. Resolves to { origin, url(path), close() }. */
function serve(root) {
  root = path.resolve(root || targetRoot());
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let file;
      try {
        let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (rel.endsWith('/')) rel += 'index.html';
        file = path.resolve(root, '.' + rel);
      } catch (e) { res.writeHead(400); res.end(); return; }
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size, 'Cache-Control': 'no-store'
        });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file).pipe(res);
      });
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const origin = 'http://127.0.0.1:' + srv.address().port;
      resolve({
        root, origin,
        url: p => origin + '/' + String(p == null ? '' : p).replace(/^\/+/, ''),
        close: () => new Promise(r => srv.close(() => r()))
      });
    });
  });
}

/* The page under test. `up()` starts a server for the chosen target (or adopts
   GT_URL) and returns { page, origin, url(path), close() }; `page` is the URL of
   the console itself, without any query string. */
async function up(opts) {
  opts = opts || {};
  if (process.env.GT_URL) {
    const u = new URL(process.env.GT_URL);
    const origin = u.origin;
    return { target: 'url', origin, page: u.href, url: p => origin + '/' + String(p || '').replace(/^\/+/, ''), close: async () => {} };
  }
  const t = opts.target || targetName();
  const root = TARGETS[t];
  if (!fs.existsSync(root)) throw new Error(root + ' does not exist' + (t === 'new' ? ' - run `npm run build` first' : ''));
  const s = await serve(root);
  return { target: t, root, origin: s.origin, page: s.url('index.html'), url: s.url, close: s.close };
}

/* Playwright, from the repo's own node_modules unless PW_PATH says otherwise. */
const playwright = () => require(process.env.PW_PATH || 'playwright');
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/* ---- the network ----------------------------------------------------------------
   Every browser stage used to fetch satellite.js and three.js from cdnjs on each
   run, which made "a clean run" depend on someone else's uptime. The two files are
   byte-identical to what the page pins by hash (verification/satellite.min.js is
   checked against the SRI by verify.js; three is checked below), so they can be
   answered locally with the CORS header a crossorigin="anonymous" tag needs. */
const CDN = [
  { re: /\/satellite\.js\/6\.0\.1\/satellite\.min\.js$/, file: path.join(__dirname, '..', 'satellite.min.js') },
  { re: /\/three\.js\/r128\/three\.min\.js$/, file: path.join(ROOT, 'node_modules', 'three', 'build', 'three.min.js') }
];
/* Hosts whose answer would make a run depend on what they served that minute. */
const THIRD_PARTY = /(^|\.)(celestrak\.org|ivanstanojevic\.me|gibs\.earthdata\.nasa\.gov|open-meteo\.com|googleapis\.com|gstatic\.com)$/;

/* Install the network profile on a context (or page). 'offline' is the default for
   suites: CDN scripts local, data hosts and fonts refused, /api/** answered 503 so a
   client that tries the cache API first falls back to the paths the suites mock.
   'open' touches nothing (globe imagery, the Moon checks). */
async function net(target, profile) {
  profile = profile || 'offline';
  if (profile === 'open') return;
  await target.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'cdnjs.cloudflare.com') {
      const hit = CDN.find(c => c.re.test(u.pathname) && fs.existsSync(c.file));
      if (hit) {
        return route.fulfill({
          status: 200, body: fs.readFileSync(hit.file),
          headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return route.fallback();
    }
    if (THIRD_PARTY.test(u.hostname)) return route.abort();
    if (/^\/api\//.test(u.pathname) && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
      return route.fulfill({ status: 503, contentType: 'text/plain', body: 'api offline in this profile' });
    }
    return route.fallback();
  });
}

/* ---- loading the classic scripts under test from Node ---------------------------
   core/*.js and earth/*.js are IIFEs that attach a global. `require` worked while the
   package was CommonJS; with a module root a file's meaning depends on the nearest
   package.json, so load them explicitly, as scripts, the way a browser does. */
function loadClassic(file) {
  const code = fs.readFileSync(file, 'utf8');
  vm.runInThisContext(code, { filename: file });
}
/* Where a named module of the Earth console lives for the chosen target. During the
   migration only legacy exists; the new target's shim bundles are added with them. */
function earthFile(name) {
  const t = targetName();
  if (t === 'legacy') {
    const sub = name === 'body' || name === 'propagator' ? 'core' : 'earth';
    return path.join(TARGETS.legacy, sub, name + '.js');
  }
  return path.join(ROOT, 'verification', '.build', name + '.cjs');
}

module.exports = {
  ROOT, TARGETS, targetName, targetRoot, serve, up, playwright, GL_ARGS, net,
  loadClassic, earthFile, CDN, THIRD_PARTY
};
