/* perf-server.js - the server verification/perf.js measures both pages through.
 *
 * Why not lib/harness.js's server: it is plain HTTP/1.1, sends nothing compressed, and the harness answers the old page's CDN scripts with
 * route.fulfill(). Chromium's network throttling (Network.emulateNetworkConditions, the "slow 4G" of the budget) does NOT apply to a response
 * Playwright fulfills (measured: 400 KB at 1.6 Mbit/s arrives in 9 ms when fulfilled, 2.2 s from a real socket), so under throttling the old
 * page's three.js and satellite.js would have arrived for free, and its Google Fonts stylesheet (which the harness refuses) would have cost nothing.
 * Here everything is a real response on a real socket, and so is throttled the same way:
 *
 *   - one HTTPS server (a throw-away self-signed certificate: lib/selfcert.js), HTTP/2 by default as a CDN serves, `http: 1` for HTTP/1.1;
 *   - text types are compressed with brotli (what Vercel and the CDNs send), gzip when the client cannot take brotli; images and fonts are
 *     sent as they are. Every compressed body is made once, when the server starts, so the first run pays no compression time;
 *   - the page's own origin is served from `root` exactly like the harness (no SPA fallback, 404 for what is not there), and /api/** answers 503
 *     like the suites' 'offline' profile;
 *   - the third-party hosts the OLD page asks for are stand-ins on the same server, chosen by the Host header, and Chromium is pointed at them
 *     with --host-resolver-rules (see resolverRules()): cdnjs.cloudflare.com (satellite.js 6.0.1 and three r128: the same files the harness
 *     serves, which are byte-identical to what the page pins by hash), fonts.googleapis.com (a stylesheet built from the Fontsource CSS: one
 *     @font-face per script subset with its unicode-range, as Google sends, so the browser fetches the subsets the page's text needs) and
 *     fonts.gstatic.com (the Fontsource woff2 files). The bytes are not Google's own (same fonts and subsets, different files).
 *   - the hosts the page asks for data (CelesTrak, its mirror, GIBS, Open-Meteo) are mapped to ~NOTFOUND: they do not resolve, as offline.
 *
 * Every request is logged (host, path, Sec-Fetch-Dest, status, bytes sent, encoding) so a run can be cross-checked against what the browser says.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http2 = require('http2');
const https = require('https');
const { selfSigned } = require('./selfcert');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.tle': 'text/plain; charset=utf-8', '.cof': 'text/plain; charset=utf-8'
};
const COMPRESSIBLE = /^(text\/|application\/(json|wasm)|image\/svg)/;

/* The hosts whose answers are stood in for, and the ones that are refused. */
const CDN_HOST = 'cdnjs.cloudflare.com', FONT_CSS_HOST = 'fonts.googleapis.com', FONT_FILE_HOST = 'fonts.gstatic.com';
const MOCK_HOSTS = [CDN_HOST, FONT_CSS_HOST, FONT_FILE_HOST];
const REFUSED_HOSTS = ['celestrak.org', '*.celestrak.org', '*.ivanstanojevic.me', 'gibs.earthdata.nasa.gov', '*.open-meteo.com'];
const CDN_FILES = {
  '/ajax/libs/satellite.js/6.0.1/satellite.min.js': path.join(ROOT, 'verification', 'satellite.min.js'),
  '/ajax/libs/three.js/r128/three.min.js': path.join(ROOT, 'node_modules', 'three', 'build', 'three.min.js')
};
/* Fontsource carries the fonts the old page asks Google for: IBM Plex Mono and Sans 400/500/600 and Archivo (variable). */
const FONT_CSS = [
  ['@fontsource/ibm-plex-mono', ['400.css', '500.css', '600.css']],
  ['@fontsource/ibm-plex-sans', ['400.css', '500.css', '600.css']],
  ['@fontsource-variable/archivo', ['wght.css']]
];

const typeOf = file => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

/* what a body is when it is sent: raw, brotli (quality 11) and gzip (level 9) for text */
function entryFor(buf, ct) {
  const e = { raw: buf, ct, size: buf.length, compressible: COMPRESSIBLE.test(ct) };
  if (e.compressible) {
    e.br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    e.gz = zlib.gzipSync(buf, { level: 9 });
  }
  return e;
}

/* the stylesheet fonts.googleapis.com would send for the old page's <link>, from the Fontsource CSS and woff2 files */
function buildFontCss() {
  const files = new Map();             // gstatic path -> file on disk
  let css = '';
  for (const [pkg, sheets] of FONT_CSS) {
    const dir = path.join(ROOT, 'node_modules', pkg);
    for (const sheet of sheets) {
      const f = path.join(dir, sheet);
      if (!fs.existsSync(f)) continue;
      css += fs.readFileSync(f, 'utf8').replace(/url\(\.\/files\/([^)]+?\.woff2)\) format\('(woff2(?:-variations)?)'\)(?:, url\([^)]*\) format\('woff'\))?/g, (m, file, fmt) => {
        files.set('/s/' + file, path.join(dir, 'files', file));
        return 'url(https://' + FONT_FILE_HOST + '/s/' + file + ') format(\'' + fmt + '\')';
      });
    }
  }
  return { css, files };
}

/**
 * start({ root, http })  ->  { origin, port, hosts, resolverRules(), sizeOf(host, pathname), take(), close() }
 *   root   the folder served as the page's own origin (legacy/ or dist/)
 *   http   2 (default) or 1
 */
async function start(opts) {
  const root = path.resolve(opts.root);
  const version = opts.http === 1 ? 1 : 2;
  if (!fs.existsSync(root)) throw new Error(root + ' does not exist' + (/dist$/.test(root) ? ' - run `npm run build` first' : ''));

  /* everything that can be compressed is compressed now, once; the rest is read on demand */
  const table = new Map();             // 'host/path' -> entry
  const fromDisk = new Map();          // 'host/path' -> file (read when asked, for what is not compressible)
  const own = (function walk(dir, rel) {
    const out = [];
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name), r = rel + '/' + d.name;
      if (d.isDirectory()) out.push(...walk(p, r)); else out.push([r, p]);
    }
    return out;
  })(root, '');
  for (const [rel, file] of own) {
    const ct = typeOf(file);
    if (COMPRESSIBLE.test(ct)) table.set('self' + rel, entryFor(fs.readFileSync(file), ct));
    else fromDisk.set('self' + rel, file);
  }
  for (const [p, file] of Object.entries(CDN_FILES)) {
    if (fs.existsSync(file)) table.set(CDN_HOST + p, entryFor(fs.readFileSync(file), typeOf(file)));
  }
  const fonts = buildFontCss();
  table.set(FONT_CSS_HOST + '/css2', entryFor(Buffer.from(fonts.css, 'utf8'), MIME['.css']));
  for (const [p, file] of fonts.files) fromDisk.set(FONT_FILE_HOST + p, file);

  const log = [];
  const sizeCache = new Map();
  function lookup(key) {
    if (table.has(key)) return table.get(key);
    const file = fromDisk.get(key);
    if (!file) return null;
    if (!sizeCache.has(key)) sizeCache.set(key, entryFor(fs.readFileSync(file), typeOf(file)));
    return sizeCache.get(key);
  }

  const hostOf = req => String(req.headers[':authority'] || req.headers.host || '').replace(/:\d+$/, '');
  function handle(req, res) {
    const host = hostOf(req);
    const pathname = (() => { try { return decodeURIComponent(new URL(req.url, 'https://x').pathname); } catch (e) { return null; } })();
    const rec = { t: Date.now(), host, path: pathname, dest: req.headers['sec-fetch-dest'] || '', status: 0, bytes: 0, enc: '' };
    log.push(rec);
    const send = (status, headers, body) => {
      rec.status = status; rec.bytes = body ? body.length : 0; rec.enc = headers['content-encoding'] || '';
      headers['content-length'] = rec.bytes;
      res.writeHead(status, headers);
      res.end(body);
    };
    if (pathname === null) return send(400, { 'content-type': 'text/plain' }, Buffer.from('bad request'));
    let key, headers = {}, mine = false;
    if (host === CDN_HOST || host === FONT_FILE_HOST || host === FONT_CSS_HOST) {
      key = host + (host === FONT_CSS_HOST ? '/css2' : pathname);
      if (host === FONT_CSS_HOST && pathname !== '/css2') key = null;
      Object.assign(headers, { 'access-control-allow-origin': '*', 'timing-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable' });
    } else {
      mine = true;
      if (/^\/api(\/|$)/.test(pathname)) return send(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' }, Buffer.from('api offline in this profile'));
      let rel = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
      key = 'self' + rel;
      headers['cache-control'] = /^\/assets\//.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache';
    }
    const e = key && lookup(key);
    if (!e) return send(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' }, Buffer.from('not found'));
    headers['content-type'] = e.ct;
    headers.vary = 'accept-encoding';
    const accept = String(req.headers['accept-encoding'] || '');
    let body = e.raw;
    if (e.compressible && /\bbr\b/.test(accept)) { body = e.br; headers['content-encoding'] = 'br'; }
    else if (e.compressible && /\bgzip\b/.test(accept)) { body = e.gz; headers['content-encoding'] = 'gzip'; }
    send(200, headers, body);
  }

  const cert = selfSigned(['127.0.0.1', 'localhost'].concat(MOCK_HOSTS));
  const srv = version === 2
    ? http2.createSecureServer({ key: cert.key, cert: cert.cert, allowHTTP1: true }, handle)
    : https.createServer({ key: cert.key, cert: cert.cert }, handle);
  const sockets = new Set();
  srv.on('session', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => { /* a navigation that left */ }); });
  srv.on('secureConnection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => { /* a connection that was dropped */ }); });
  srv.on('sessionError', () => { /* the browser went away mid-stream */ });
  srv.on('tlsClientError', () => { /* the same, in the handshake */ });
  srv.on('clientError', (e, s) => { try { s.destroy(); } catch (x) { /* gone */ } });
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(0, '127.0.0.1', resolve); });
  srv.unref();
  const port = srv.address().port;

  return {
    root, port, http: version, origin: 'https://127.0.0.1:' + port, mockHosts: MOCK_HOSTS,
    /* the value of Chromium's --host-resolver-rules */
    resolverRules: () => MOCK_HOSTS.map(h => 'MAP ' + h + ' 127.0.0.1:' + port).concat(REFUSED_HOSTS.map(h => 'MAP ' + h + ' ~NOTFOUND')).join(', '),
    /* the sizes of what the page asked for: { raw, br, gz, compressible } or null (a request this server does not know) */
    sizeOf(host, pathname) {
      const own = !MOCK_HOSTS.includes(host);
      const e = lookup(own ? 'self' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname) : host + (host === FONT_CSS_HOST ? '/css2' : pathname));
      return e ? { raw: e.size, br: e.compressible ? e.br.length : e.size, gz: e.compressible ? e.gz.length : e.size, compressible: e.compressible } : null;
    },
    take() { return log.splice(0); },
    close() {
      for (const s of sockets) { try { s.destroy(); } catch (e) { /* closed already */ } }
      return new Promise(r => srv.close(() => r()));
    }
  };
}

module.exports = { start, MOCK_HOSTS, REFUSED_HOSTS };
