/* harness.js - the one way every suite reaches the page under test.
 *
 * Before this file, ten suites opened index.html from file:// and six more each
 * carried their own copy of a 15-line static server. A bundled app cannot be
 * opened from disk (ES modules and workers need an origin), and "which build am I
 * testing" has to be a switch rather than an edit, so both now live here.
 *
 *   GT_TARGET=new      the production build, served from dist/ (or from GT_DIST, a build made somewhere else:
 *                      `vite build --outDir <dir>`, so two runs never share a folder)   (the default)
 *   GT_TARGET=legacy   the pre-rewrite Earth console, served from legacy/: it is not in the tree, it is in git at the tag
 *                      legacy-earth-console, and is checked out there with `git worktree add legacy legacy-earth-console`
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
const TARGETS = { legacy: path.join(ROOT, 'legacy'), new: process.env.GT_DIST ? path.resolve(process.env.GT_DIST) : path.join(ROOT, 'dist') };

function targetName() {
  const t = process.env.GT_TARGET || 'new';
  if (!TARGETS[t]) throw new Error('GT_TARGET must be "legacy" or "new", not "' + t + '"');
  return t;
}
const targetRoot = () => {
  const t = targetName(), root = TARGETS[t];
  if (t === 'legacy' && !process.env.GT_URL && !fs.existsSync(path.join(root, 'index.html'))) {
    throw new Error('GT_TARGET=legacy needs the old page checked out as legacy/ (it is in git at the tag legacy-earth-console): git worktree add legacy legacy-earth-console');
  }
  return root;
};

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
      /* A suite that forgets to close it must still be able to exit. */
      srv.unref();
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

/* ---- Playwright --------------------------------------------------------------
   From the repo's own node_modules unless PW_PATH says otherwise. The Chromium it returns decorates
   every context it makes (and every page made straight from the browser) with the network profile
   and the test flag the new app waits for, so a suite needs no per-context boilerplate:

     const { chromium } = H.playwright();            // 'offline' profile
     const { chromium } = H.playwright({ net: 'open' });   // real network (globe imagery, Horizons)

   Routes a suite registers itself come later and so run first; ours is the fallback. */
async function decorate(ctx, profile, testFlag) {
  await net(ctx, profile);
  if (testFlag) await ctx.addInitScript(() => { window.__GT_TEST__ = true; });
  return ctx;
}
function decorateBrowser(browser, profile, testFlag) {
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = async o => decorate(await newContext(o), profile, testFlag);
  browser.newPage = async o => { const p = await newPage(o); await decorate(p.context(), profile, testFlag); return p; };
  return browser;
}
/* options: net: 'offline' (default) | 'open';  testFlag: false to load the page the way a visitor does,
   without window.__GT_TEST__ (the smoke test uses this to prove the test surface is not fetched). */
function playwright(opts) {
  const profile = (opts && opts.net) || 'offline';
  const testFlag = !(opts && opts.testFlag === false);
  const pw = require(process.env.PW_PATH || 'playwright');
  const chromium = new Proxy(pw.chromium, {
    get(target, prop) {
      if (prop === 'launch') return async o => decorateBrowser(await target.launch(o), profile, testFlag);
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    }
  });
  return { chromium, firefox: pw.firefox, webkit: pw.webkit, devices: pw.devices, errors: pw.errors };
}

/* ---- loading the classic scripts under test from Node ---------------------------
   core/*.js and earth/*.js are IIFEs that attach a global. `require` worked while the
   package was CommonJS; with a module root a file's meaning depends on the nearest
   package.json, so load them explicitly, as scripts, the way a browser does. */
function loadClassic(file) {
  const code = fs.readFileSync(file, 'utf8');
  vm.runInThisContext(code, { filename: file });
}
/* Where a named module of the Earth console lives for the chosen target.
   legacy: the classic script, legacy/core/<name>.js or legacy/earth/<name>.js.
   new:    ONE bundle of the TypeScript modules for every name (verification/.build/earth.cjs, built by
           `npm run build:shims` from src/lib/shims/earth.ts). The classic scripts shared a single instance of
           each module through globalThis, and checks that wrap `globalThis.Lifetime.rho` to count calls
           depend on it; one bundle keeps that identity, and requiring it twice is a no-op like loading a
           script twice was. */
function earthFile(name) {
  const t = targetName();
  if (t === 'legacy') {
    const sub = name === 'body' || name === 'propagator' ? 'core' : 'earth';
    return path.join(TARGETS.legacy, sub, name + '.js');
  }
  return path.join(ROOT, 'verification', '.build', 'earth.cjs');
}
/* The SOURCE text of a module, for the few checks that scan it (purity, the one definition of a label).
   legacy: the classic script. new: the verbatim TypeScript module it was moved into. */
function earthSource(name) {
  if (targetName() === 'legacy') return earthFile(name);
  const map = { lifetime: 'planner/lifetime', planner: 'planner/planner', advisor: 'planner/advisor', 'advisor-copy': 'planner/advisor-copy' };
  if (!map[name]) throw new Error('no TypeScript source recorded for module ' + name);
  return path.join(ROOT, 'src', 'lib', map[name] + '.ts');
}

/* ---- driving the console, whichever build it is ----------------------------------------------------------------
   The old page kept its controls on screen. The rebuilt one folds some of them into popovers (the spacecraft picker
   under the title, the window controls, the observer form), so a suite that clicked them directly would be clicking
   something that is not there. These do what a person does - open it if it is shut, then use it - and do nothing
   extra on the old page, so a suite reads the same against either build. */

/** The spacecraft picker, open (the old page's is a field that is always on screen; the rebuilt one is a popover under the title). */
async function openPicker(page) {
  if (!(await page.isVisible('#satsearch'))) {
    await page.click('#satname');
    await page.waitForSelector('#satsearch', { state: 'visible', timeout: 5000 });
  }
}
/** Is the picker a popover under the title (the rebuilt page: the title is a button and the search field exists only while it is open), or a
 *  field that is always on the page (the old one)? */
const pickerIsPopover = page => page.evaluate(() => { const t = document.getElementById('satname'); return !!(t && t.closest('button')); });
/** ...shut again: Escape, and the field is gone. Nothing to do on the old page, where the field is permanent (waiting for it to go would only
 *  wait out the timeout). On the rebuilt page a popover that is still open 5 s after Escape is an error, not something to carry on past: whatever
 *  reads the page next would be reading it with the list over it. */
async function closePicker(page) {
  if (!(await pickerIsPopover(page)) || !(await page.isVisible('#satsearch'))) return;
  await page.keyboard.press('Escape');
  try { await page.waitForSelector('#satsearch', { state: 'detached', timeout: 5000 }); }
  catch (e) { throw new Error('closePicker: the spacecraft picker is still open 5 s after Escape (#satsearch is still in the page)'); }
}
/** Is the picker shut? The old page's field is permanent, so there is nothing to ask there (true). A shut popover of the rebuilt page holds no
 *  search field, no list and no count line: they are in the page only while it is open. */
async function pickerShut(page) {
  if (!(await pickerIsPopover(page))) return true;
  return page.evaluate(() => !document.getElementById('satsearch') && !document.getElementById('satlist') && !document.getElementById('satcount'));
}
/** The count line under the picker ("2,158 spacecraft", "2,158 + 2 of yours"), read the way a person does: open it, look, shut it. */
async function satCount(page) {
  const was = await page.isVisible('#satsearch');
  await openPicker(page);
  const t = await page.evaluate(() => (document.getElementById('satcount') || {}).textContent || '');
  if (!was) await closePicker(page);
  return t;
}
/** The name of the spacecraft on screen as the picker shows it (the old page's field value; the rebuilt title's text). */
const pickerName = page => page.evaluate(() => {
  const f = document.getElementById('satsearch'), t = document.getElementById('satname');
  /* The old page's field always holds the name of what is on screen, and its masthead is a separate heading (a suite that asks for the
     picker's text checks the two are in step). The rebuilt page's search box exists only while the popover is open and holds the QUERY;
     the title, a button, is what names the spacecraft. */
  if (f && !(t && t.closest('button'))) return f.value;
  return t ? t.textContent : '';
});

/** The notes an open picker shows ("Nothing in the catalogue matches that", "N more match..."): rows of the old page's list, paragraphs under the rebuilt page's. */
const pickerNotes = page => page.evaluate(() => [...document.querySelectorAll('#satlist li.note, .search ~ p.note')].map(n => n.textContent));
/** Type a query into the picker (open it first if it is shut), without choosing anything. */
async function typeInPicker(page, q) {
  await openPicker(page);
  await page.click('#satsearch');
  await page.fill('#satsearch', q);
}

/** Choose a spacecraft by typing into the picker and pressing Enter. */
async function pick(page, q) {
  if (!(await page.isVisible('#satsearch'))) await page.click('#satname');
  await page.click('#satsearch');
  await page.fill('#satsearch', q);
  await page.keyboard.press('Enter');
}

/** Choose the spacecraft whose name is exactly this (typing narrows the list; the match is clicked, not just the first). */
async function pickExact(page, name) {
  if (!(await page.isVisible('#satsearch'))) await page.click('#satname');
  await page.click('#satsearch');
  await page.fill('#satsearch', name);
  await page.waitForTimeout(400);
  await page.evaluate(n => {
    const o = [...document.querySelectorAll('#satlist [role=option]')]
      .find(li => ((li.querySelector('.nm') || li).textContent || '').trim() === n);
    if (o) o.click();
  }, name);
}

/** Make the window controls usable (the old page's window bar is always on screen). */
async function windowOpen(page) {
  if (!(await page.$('#winOpen'))) return;
  if (!(await page.isVisible('#winStartIn'))) await page.click('#winOpen');
}
/** Click something in the window controls: a step, Now, Epoch, a span. */
async function clickWindow(page, selector) {
  await windowOpen(page);
  await page.click(selector);
}

/** The observer form, open, with the coordinate fields showing. */
async function siteForm(page) {
  if (!(await page.isVisible('#s-search'))) await page.click('#siteopen');
  await page.evaluate(() => { const m = document.getElementById('s-manual'); if (m) m.open = true; });
}
/** Move the observer by typing the coordinates in, as a person would, and pressing Apply. Fields left out are left alone. */
async function setSite(page, s) {
  await siteForm(page);
  const v = Object.assign({}, s, { alt: s.alt !== undefined ? s.alt : s.altKm });      // the old form's own name for it is altKm
  const map = { name: '#s-name', lat: '#s-lat', lon: '#s-lon', alt: '#s-alt', tz: '#s-tz' };
  for (const k of Object.keys(map)) if (v[k] !== undefined) await page.fill(map[k], String(v[k]));
  await page.click('#siteapply');
}
/** ...and shut again. The rebuilt page's observer form is a popover that stays open after Apply, over the header and the stage under it, and
 *  a tap there would land on it; the old page's form is part of the page, and nothing is done to it. */
async function closeSiteForm(page) {
  const pop = '[role=dialog][aria-label="Observer"]';
  if (!(await page.isVisible(pop))) return;
  await page.keyboard.press('Escape');
  /* a form that does not shut is a defect, not a thing to wait out: say so (the next tap would land on it) */
  await page.waitForSelector(pop, { state: 'hidden', timeout: 5000 }).catch(() => { throw new Error('closeSiteForm: the observer form is still open 5 s after Escape'); });
}

/** Bring the flat map into view. The rebuilt console keeps it on a tab beside the globe; the old page shows both. */
async function showMap(page) {
  const t = await page.$('[role=tab]:has-text("Map")');
  if (t && (await t.getAttribute('aria-selected')) !== 'true') { await t.click(); await page.waitForTimeout(250); }
}
/** ...and the globe. */
async function showGlobe(page) {
  const t = await page.$('[role=tab]:has-text("Globe")');
  if (t && (await t.getAttribute('aria-selected')) !== 'true') { await t.click(); await page.waitForTimeout(250); }
}
/** One of the answer rail's tabs (Passes, Orbit, Source), brought into view: opened first when the rail is a sheet or panel that is folded. The old
 *  page shows everything the rail holds at once, so on it this does nothing. */
async function showRailTab(page, label) {
  const peek = await page.$('.rail .peek');
  if (peek && (await peek.getAttribute('aria-expanded')) !== 'true') { await peek.click(); await page.waitForTimeout(150); }
  const t = await page.$('.rail [role=tab]:has-text("' + label + '")');
  if (t && (await t.getAttribute('aria-selected')) !== 'true') { await t.click(); await page.waitForTimeout(150); }
}

module.exports = {
  ROOT, TARGETS, targetName, targetRoot, serve, up, playwright, GL_ARGS, net,
  loadClassic, earthFile, earthSource, CDN, THIRD_PARTY,
  openPicker, closePicker, pickerIsPopover, pickerShut, satCount, pickerName, pickerNotes, typeInPicker, pick, pickExact, windowOpen, clickWindow, siteForm, setSite, closeSiteForm, showMap, showGlobe, showRailTab
};
