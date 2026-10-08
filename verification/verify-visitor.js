/*
 * verify-visitor.js - the rebuilt page as a VISITOR gets it.
 *
 * Every other browser suite loads the page with window.__GT_TEST__ set (the harness does it for every context). With it, src/testing/
 * surface.ts brings the orbit planner and the AR view up EAGERLY, before it publishes window.__gt, so no other suite ever sees how a
 * visitor's planner arrives. A reviewer deleted scheduleSession() from src/main.ts and verify-custom (205 checks) and verify-planner-ui
 * (665) both still passed. This is the guard for that path. It opens the page with H.playwright({ testFlag: false }), the way a visitor
 * does, tracks every request, and says what was fetched and when.
 *
 * Eight groups, each measured on the page as it is (the chunk names are assets/<name>-<hash>.js):
 *   1  a fresh visitor on a desktop: the first answer before any planner chunk, the pill from the first paint, the planner's chunks
 *      once each when the browser idles, no AR chunk, no test surface, nothing on the window, nothing in storage, nobody else asked;
 *      and the control that a live visit does ask the page's own cache API (/api/tle/<n>), which group 4 says it does not under the snapshot
 *   2  a visitor with a saved orbit: it is listed once the planner is up, the record is not rewritten, the planner lists it
 *   3  the pill pressed at first paint, before the browser has idled: it opens when its chunks arrive; the page's own idle request,
 *      kept back and answered AFTER the press, starts nothing twice; Add; reload; the address bar
 *   4  ?tle=embedded: no planner chunk at all, nothing asked of any other origin or of /api/ (the path, not the origin: the API is the page's
 *      own), the pill and the note say why, the pill does nothing, the answer is the snapshot's, the OPEN picker has no Plan row
 *   5  a file of the planner that cannot be fetched, each of the six in turn (planner, plannerui, advisor, advisor-copy, parts, lifetime):
 *      no pill, no Plan row, no saved orbits listed, the record untouched, no page error
 *   6  the AR view, where a finger is the primary pointer, and nowhere else: a desktop and a touch laptop (a mouse is primary; the touch
 *      screen is only any-pointer) get nothing; two tablets (portrait 820x1180, landscape 1180x820) and a phone get its own chunk, once,
 *      after the first answer; on the phone, a child of <body>, inert, closed
 *   7  the weight of the first screen, which must not grow: its JavaScript (the entry chunk, and all of it), and everything the visit fetches
 *      from this origin (the globe's texture, the catalogue, the world map, the fonts, the stylesheet as well). The budget for the entry chunk
 *      is 90 KB gzipped and it is above that today; this asserts no growth, not the budget
 *   8  a slow catalogue (kept back 3 s), on a desktop and on a phone: no planner chunk, and no AR chunk, is requested before the first
 *      answer. With the catalogue at hand the answer and the browser's first idle moment are milliseconds apart and that claim is a race;
 *      here the browser is idle at once and for 3 s, so a chunk that waited only for the browser is requested at once and seen
 *
 * Nothing here compares with the old page (the old page had no chunks): the rebuilt page only, on the folder in GT_DIST (or dist/). GT_TARGET
 * unset means the rebuilt page; GT_TARGET=legacy is refused (exit 2), so that nothing here can "pass" having checked nothing.
 *   GT_TARGET=new GT_DIST=dist-v node verification/verify-visitor.js            all groups
 *   GT_TARGET=new GT_DIST=dist-v node verification/verify-visitor.js --only 1,7  just these (7 needs the page of group 1, and runs it)
 *
 * Waits are on conditions, each with a deadline of 15 s. What can only be said as "nothing happened" is said after 8 s of idle (the
 * page's own idle request gives up waiting at 4 s) or a short settle, and the measurement is printed. The ordering claims (answer, then
 * chunks) are read off the page's own clock: a MutationObserver and a PerformanceObserver installed before the page's first script, so a
 * loaded machine delaying this process cannot reorder them. The 6 s given to the planner's chunks after the first answer is the page's own
 * 4 s wait for an idle moment and 2 s: it assumes that 4 s (IDLE_TIMEOUT below) and moves with it. What the weight ceilings do not cover:
 * the gzip of a file is measured, the transfer (headers, the HTTP version, compression the real host chooses) is not.
 *
 * What the browser cannot be made to be, and what stands in for it: Playwright's hasTouch makes the touch screen the primary pointer (a phone,
 * a tablet), so a FINE primary pointer with a touch screen also attached is not a context option; group 6's touch laptop answers the one query
 * (any-pointer: coarse) as such a laptop does (see TOUCH_LAPTOP), and leaves the rest to the browser.
 */
'use strict';
const H = require('./lib/harness');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const argv = process.argv.slice(2);
const oi = argv.indexOf('--only');
const ONLY = oi >= 0 ? new Set((argv[oi + 1] || '').split(',').filter(Boolean)) : null;
const want = g => !ONLY || ONLY.has(String(g));

let fails = 0, passes = 0;
const allErrs = [];
function chk(name, ok, detail) {
  if (ok) passes++; else fails++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined && detail !== '' ? '   ' + detail : ''));
}
const note = s => console.log('        ' + s);

const WAIT = 15000;
const IDLE_SETTLE = 8000;          // "nothing is brought in that cannot be used": looked at after this long
/* The page asks the browser for idle time after the first answer and gives up waiting for it at 4 s (scheduleSession in the planner's session,
   ar.watch in the AR view's: { timeout: 4000 }). The budget below is that timeout and 2 s: it ASSUMES the 4 s, and the two numbers move together. */
const IDLE_TIMEOUT = 4000;
const BOOT_BUDGET = IDLE_TIMEOUT + 2000;   // the chunks are requested within this long of the first answer
const HOLD = 3000;                 // group 8: how long the catalogue is kept back (the page has nothing to show, and nothing to do, for that long)

/* ---- what a visitor's page is made of -------------------------------------------------------------------------------------------- */
/* The planner's own chunks. `lifetime` is also the Decay panel's (the drag integrator is shared), so on a desktop it is fetched at boot, with
   the Decay panel, and not by the planner: it is counted once for the whole visit and not ordered. */
const FAMILY = ['planner', 'plannerui', 'advisor', 'advisor-copy', 'parts'];
const EXPECTED = FAMILY.concat(['lifetime', 'chunk', 'scene', 'sky-data', 'transmitters', 'surface', 'Report', 'reporter', 'treaty2', 'index-client']);
/* ...and the six files whose refusal takes the planner away (group 5). */
const REFUSED = FAMILY.concat(['lifetime']);
/* The two element-set sources the page asks directly when no cache API answers as itself (CHANGES-FROM-LEGACY 7). Nothing else. */
const ELEMENT_SET_HOSTS = ['celestrak.org', 'tle.ivanstanojevic.me'];
/* Everything the test surface, the planner or the AR view put on the window. A visitor has none of it. */
const FACADE = ['__gt', 'ARView', 'Planner', 'PlannerUI', 'Advisor', 'AdvisorCopy', 'Lifetime', '__host', '__planner', 'satellite',
  'Orbit3D', 'OrbitViz', 'THREE', 'SkyAR', 'WMM', '__GT_FAULT__'];
const SNAPSHOT_SENTENCE = 'The orbit planner is off in the assignment snapshot (?tle=embedded).';

/* An orbit in the planner's stored format (Planner.storable / sanitizeStore: the inputs only, in this key order), for the visitor who made
   one on an earlier visit. The epoch is fixed, so nothing here depends on the day. */
const ORBIT = { a: 6978.135, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: Date.UTC(2026, 9, 1), am: 0.0043 };
const SEED = JSON.stringify({ v: 1, next: 2, items: [{ id: 'c1', name: 'Saved earlier', made: 1, el: ORBIT }] });

/* The chunk a URL is, by name: assets/<name>-<8 character hash>.js */
function chunkOf(url) {
  let p; try { p = new URL(url, 'http://x').pathname; } catch (e) { return null; }
  const m = /^\/assets\/(.+)-[A-Za-z0-9_-]{8}\.js$/.exec(p);
  return m ? m[1] : null;
}

/* ---- the page's own clock -------------------------------------------------------------------------------------------------------- */
/* Installed in every context before the page's first script. Records (all on performance.now(), which is also what a resource entry's
   startTime is on): when the first answer was on screen, when the pill was first in the page and whether it was shown, every resource
   request; and every call to localStorage's mutators and to history's (a custom orbit must never put sat=O.... in the address bar).
   With `hold`, the page's own requests for idle time are kept (not dropped) and never answered until window.__release() is called, so a
   press of the pill is certain to come before the browser has "idled", and the idle request can then be answered AFTER the press, as the
   order is when a visitor is quick. __release() hands them to the real requestIdleCallback, in the order they were made, and returns how
   many there were; v.ran counts the ones that have run. The seed, when there is one, is written first and so is not counted as a write. */
function RECORDER(o) {
  const v = window.__v = { answer: null, pill: null, pillShown: null, pillFirstHidden: false, res: [], writes: [], urls: [], held: 0, ran: 0 };
  if (o.hold && window.name !== 'gt-idle-ok') {
    const ric = window.requestIdleCallback, cic = window.cancelIdleCallback, held = [];
    window.__hold = true;
    window.requestIdleCallback = function (cb, opts) {
      if (!window.__hold) return ric.call(window, cb, opts);
      held.push([cb, opts]); v.held = held.length;
      return -held.length;                       // a kept request's id is negative, so that it is never a real one
    };
    window.cancelIdleCallback = function (id) { if (id < 0) held[-id - 1] = null; else cic.call(window, id); };
    window.__release = function () {
      window.__hold = false;
      const mine = held.splice(0).filter(Boolean);
      for (const [cb, opts] of mine) ric.call(window, function (d) { try { return cb.call(window, d); } finally { v.ran++; } }, opts);
      return mine.length;
    };
  }
  for (const m of ['setItem', 'removeItem', 'clear']) {
    const f = Storage.prototype[m];
    Storage.prototype[m] = function (k) { v.writes.push(m + ':' + (this === window.localStorage ? 'local' : 'session') + ':' + k); return f.apply(this, arguments); };
  }
  for (const m of ['pushState', 'replaceState']) {
    const f = History.prototype[m];
    History.prototype[m] = function (s, t, u) { if (u !== undefined && u !== null) v.urls.push(String(u)); return f.apply(this, arguments); };
  }
  const shown = p => !p.closest('[hidden]') && p.getClientRects().length > 0;
  const look = () => {
    const now = performance.now();
    if (v.answer === null) { const n = document.getElementById('totalbig'); if (n && /\d/.test(n.textContent || '')) v.answer = now; }
    const p = document.getElementById('planopen');
    if (p && v.pill === null) { v.pill = now; v.pillFirstHidden = !shown(p); }
    if (p && v.pillShown === null && shown(p)) v.pillShown = now;
    if (v.answer !== null && v.pillShown !== null) mo.disconnect();
  };
  const mo = new MutationObserver(look);
  mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  new PerformanceObserver(l => { for (const e of l.getEntries()) v.res.push({ t: e.startTime, url: e.name }); }).observe({ type: 'resource', buffered: true });
}

/* A group that throws (a harness step that timed out because the machine stalled, say) is a FAILED check naming the step, not the end of the
   run: the contexts it opened are closed and the next group goes on. */
const opened = new Set();
async function group(n, fn) {
  try { await fn(); } catch (e) { chk('group ' + n + ' ran to its end', false, String((e && e.message) || e).split(/\r?\n/)[0].slice(0, 200)); }
  for (const c of opened) await c.close().catch(() => { /* already gone: it is cleanup */ });
  opened.clear();
}

/* The devices a visitor comes on. Playwright's hasTouch alone turns on (pointer: coarse) and (hover: none), so each of the three touch
   devices below has a finger as its primary pointer. What it cannot make is a FINE primary pointer with a touch screen also attached (a touch
   laptop): that is TOUCH_LAPTOP, below. */
const DESKTOP = { viewport: { width: 1400, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const TABLET = { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const TABLET_LAND = { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
/* A desktop with a mouse (its primary pointer is fine) and a touch screen as well: Chromium reports (any-pointer: coarse) there and
   (pointer: coarse) not. The browser cannot be put in that state through the context's options (hasTouch makes the touch screen the primary
   pointer), so the one query is answered the way such a laptop answers it; the page's own (pointer: coarse) is left to the browser. */
function TOUCH_LAPTOP() {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => { const r = mm(q); if (/any-pointer\s*:\s*coarse/.test(q)) Object.defineProperty(r, 'matches', { value: true }); return r; };
}
/* The catalogue is the one file the first answer waits for. Holding it back for HOLD ms leaves the page nothing to compute and the main thread
   idle, so the browser is "idle" at once and for a long time, which is the only way to see that a chunk is waited for the answer and not just for
   the browser: with the catalogue at hand the answer and the first idle moment are a few milliseconds apart and a race. */
const CATALOGUE = /\/assets\/catalogue-[A-Za-z0-9_-]{8}\.txt$/;

/* A visitor: a context with the recorder (and the seed, if there is one), a page that logs what it is asked for and what goes wrong. */
async function visit(browser, o) {
  o = o || {};
  const ctx = await browser.newContext(o.device || DESKTOP);
  if (o.seed) await ctx.addInitScript(s => { try { localStorage.setItem('gt.custom', s); } catch (e) { /* no storage: the seed is the check's, and it will say so */ } }, o.seed);
  if (o.laptop) await ctx.addInitScript(TOUCH_LAPTOP);
  await ctx.addInitScript(RECORDER, { hold: !!o.hold });
  opened.add(ctx);
  const page = await ctx.newPage();
  const w = { ctx, page, reqs: [], failed: [], errs: [], cons: [], opts: o };
  if (o.slow) await page.route(CATALOGUE, async r => { await new Promise(res => setTimeout(res, o.slow)); await r.fallback().catch(() => { /* the visit is over */ }); });
  page.on('request', r => w.reqs.push(r.url()));
  page.on('requestfailed', r => w.failed.push(r.url()));
  page.on('pageerror', e => w.errs.push(String((e && e.message) || e)));
  /* The offline profile refuses every third-party host and answers /api with 503, and the browser says so on the console; that is the
     profile, not the page. Anything else the page writes there is the page's. */
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) w.cons.push(m.text()); });
  return w;
}
const count = (w, name) => w.reqs.filter(u => chunkOf(u) === name).length;
const clock = w => w.page.evaluate(() => window.__v);
const until = (page, fn, arg, ms) => page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: ms || WAIT, polling: 100 }).then(() => true, () => false);
const answerOn = w => until(w.page, () => window.__v && window.__v.answer !== null);
const round = x => Math.round(x);
function noErrors(label, w, allow) {
  const cons = allow ? w.cons.filter(c => !allow.test(c)) : w.cons;
  chk(label + ': no page error, and nothing on the console but the refused resources' + (allow ? ' and the failed chunk' : ''), !w.errs.length && !cons.length,
    w.errs.length || cons.length ? w.errs.concat(cons).join(' | ').slice(0, 300) : 'none');
  allErrs.push(...w.errs);
}

/* The planner is up when the picker offers its row. Opens the picker, waits for the row, shuts it. */
async function plannerUp(w) {
  await H.openPicker(w.page);
  const ok = await until(w.page, () => !!document.getElementById('soptplan'));
  await H.closePicker(w.page);
  return ok;
}
/* The picker's count, read the way a person does (H.satCount: open it, look, shut it), after waiting for it to say what is asked: the picker
   is held open for the wait, since the count repaints when the planner brings the saved orbits in. Not a poll that opens and shuts it every
   quarter second: on a loaded machine each round costs more than the thing waited for. */
async function countIs(page, text) {
  const t0 = Date.now();
  await H.openPicker(page);
  const ok = await until(page, t => { const c = document.getElementById('satcount'); return !!c && c.textContent === t; }, text);
  await H.closePicker(page);
  const c = await H.satCount(page);
  return { ok: ok && c === text, c, ms: Date.now() - t0 };
}
const storeNow = page => page.evaluate(() => { try { return { keys: Object.keys(localStorage), rec: localStorage.getItem('gt.custom') }; } catch (e) { return { keys: null, rec: null }; } });
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);

/* The weight of a file as a visitor's browser pays for it: gzipped (level 9, so the number is the same on every run), read over http. */
const gzCache = new Map();
async function gzBytes(srv, url) {
  const p = new URL(url, 'http://x').pathname;
  if (gzCache.has(p)) return gzCache.get(p);
  const res = await fetch(srv.url(p));
  const n = res.ok ? zlib.gzipSync(Buffer.from(await res.arrayBuffer()), { level: 9 }).length : null;
  gzCache.set(p, n);
  return n;
}
/* The page's own cache API (/api/tle/<n>, /api/history/<n>): the same origin as the page, so "nothing leaves the origin" cannot see it. */
const isApi = (srv, u) => u.startsWith(srv.origin + '/') && /^\/api\//.test(new URL(u).pathname);

/* ---- the ceilings of group 7 ------------------------------------------------------------------------------------------------------ */
/* Measured on the build these were written against (gzip level 9, bytes), then 5 % added: the weight must not grow. The entry is what the
   page cannot start without: the entry chunk, the Svelte runtime it shares with the lazy chunks (index-client) and the tiny shared chunk of
   the rich-text renderer; the 90 KB budget is for that sum (the report below the first screen, the element-set client and the planner are
   chunks of their own). */
/* total: index, scene, sky-data, transmitters, lifetime, and the Decay panel's own life and draw-life (counted whether or not the visit fetched
   them: see DECAY_OWN). */
const ENTRY_GRAPH = ['index', 'index-client', 'rich'];
/* fetched when the section is near, or at idle, or on the first ask of the API: which comes first depends on the layout and the machine, so
   each is counted whether or not the visit fetched it */
const DECAY_OWN = ['life', 'draw-life', 'Report', 'reporter', 'treaty2', ...ENTRY_GRAPH];
/* all: every file of this origin the visit fetches, of any kind (the JavaScript above; the stylesheet; the catalogue and the world map; the six
   fonts; the globe's 2048 px texture, the one image, which is most of the weight), the planner's own five chunks and its stylesheet apart. Images
   and woff2 do not shrink under gzip, so the figure is what the browser pays for them too. */
const MEASURED = { entry: 83274, total: 309367, all: 1194100 };   // entry: index 64538 + index-client 18483 + rich 253
const CEIL = { entry: Math.ceil(MEASURED.entry * 1.05), total: Math.ceil(MEASURED.total * 1.05), all: Math.ceil(MEASURED.all * 1.05), entryMeasured: MEASURED.entry, totalMeasured: MEASURED.total, allMeasured: MEASURED.all };
const kB = n => (n / 1000).toFixed(1) + ' kB';
const kindOf = p => /\.js$/.test(p) ? 'JavaScript' : /\.css$/.test(p) ? 'stylesheet' : /\.(woff2?|ttf)$/.test(p) ? 'fonts' : /\.(jpe?g|png|webp|svg|ico|gif)$/.test(p) ? 'images' : /\.html?$/.test(p) ? 'page' : 'data';

/* The old page had no chunks, so there is nothing here to run against it. Unset, GT_TARGET means the rebuilt page (the harness's own default is the
   old one, and `npm run visitor` by hand must not check nothing and exit 0, which reads as a pass); GT_TARGET=legacy is refused, non-zero. */
if (!process.env.GT_TARGET) process.env.GT_TARGET = 'new';

(async () => {
  if (H.targetName() !== 'new') {
    console.error('verify-visitor checks the rebuilt page as a visitor gets it, and the old page has no chunks to check: run it with GT_TARGET=new (GT_DIST=<build folder>, or dist/)');
    process.exit(2);
  }
  const srv = await H.up();
  const { chromium } = H.playwright({ testFlag: false });
  const browser = await chromium.launch();
  const t0 = Date.now();

  /* ---- 0. what the build is made of, so that "not requested" can never pass because a chunk was renamed ------------------------- */
  console.log('\n0. The build: the chunks these checks are about exist, once each');
  {
    const index = await (await fetch(srv.page)).text();
    const entry = (/<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(index) || [])[1];
    chk('index.html loads one module script, the entry chunk', !!entry && chunkOf(srv.origin + entry) === 'index', entry || 'none');
    if (srv.root) {
      const byName = {};
      for (const f of fs.readdirSync(path.join(srv.root, 'assets')).filter(f => f.endsWith('.js'))) (byName[chunkOf('/assets/' + f)] = byName[chunkOf('/assets/' + f)] || []).push(f);
      chk('every chunk the checks below name is one file in the build (a rename would make each "not requested" vacuous; the "requested once" checks prove the planner\'s and the AR view\'s names on the wire)',
        EXPECTED.every(n => (byName[n] || []).length === 1), EXPECTED.map(n => n + ' ' + ((byName[n] || []).join(',') || 'MISSING')).join('  '));
    } else note('(GT_URL: the build\'s files cannot be listed; the "requested once" checks prove the names on the wire)');
  }

  /* ---- 1 and 7. a fresh visitor, desktop ------------------------------------------------------------------------------------------ */
  if (want(1) || want(7)) await group('1/7', async () => {
    console.log('\n1. A fresh visitor on a desktop (fine pointer, empty storage)');
    const w = await visit(browser);
    await w.page.goto(srv.page, { waitUntil: 'load' });
    const answered = await answerOn(w);
    const got = answered ? await w.page.evaluate(() => document.getElementById('totalbig').textContent.trim()) : '';
    const famSeen = await until(w.page, f => f.every(n => window.__v.res.some(r => new RegExp('/assets/' + n + '-[A-Za-z0-9_-]{8}\\.js$').test(r.url))), FAMILY);
    const up = await plannerUp(w);
    const v = await clock(w);
    const t = n => v.res.filter(r => chunkOf(r.url) === n).map(r => r.t);
    const first = Math.min.apply(null, FAMILY.map(n => Math.min.apply(null, t(n).concat([Infinity]))));
    const last = Math.max.apply(null, FAMILY.map(n => Math.max.apply(null, t(n).concat([-Infinity]))));

    if (want(1)) {
      chk('the first answer is on screen (#totalbig reads a number)', answered && /\d/.test(got), got || 'never');
      chk('...before any planner chunk has been requested', v.answer !== null && first !== Infinity && v.answer < first,
        'answer at ' + round(v.answer) + ' ms, the first planner chunk at ' + round(first) + ' ms (+' + round(first - v.answer) + ' ms)');
      chk('#planopen is in the page, and shown, from the first paint (never seen hidden, shown before the first answer and any planner chunk)',
        v.pillShown !== null && !v.pillFirstHidden && v.pillShown <= v.answer && v.pillShown < first,
        'pill shown at ' + (v.pillShown === null ? 'never' : round(v.pillShown) + ' ms') + ', first answer at ' + round(v.answer) + ' ms');
      chk('...and is visible now', await w.page.isVisible('#planopen'));
      const counts = FAMILY.map(n => n + ' ' + count(w, n));
      chk('the planner\'s five chunks (planner, plannerui, advisor, advisor-copy, parts) are each requested exactly once', famSeen && FAMILY.every(n => count(w, n) === 1), counts.join(', '));
      chk('...all after the first answer, and within ' + BOOT_BUDGET / 1000 + ' s of it (the browser idles)', famSeen && first > v.answer && last - v.answer <= BOOT_BUDGET,
        'first +' + round(first - v.answer) + ' ms, last +' + round(last - v.answer) + ' ms after the answer; the last at ' + round(last) + ' ms from navigation');
      const tl = t('lifetime');
      chk('lifetime is requested exactly once for the whole visit (the Decay panel and the planner share the chunk, so which of them asks first depends on where the Decay section sits)', count(w, 'lifetime') === 1,
        count(w, 'lifetime') + ' request, at ' + (tl.length ? round(tl[0]) + ' ms (' + (tl[0] < v.answer ? 'before' : 'after') + ' the answer)' : 'never'));
      chk('the planner is up: the picker offers its Plan row (the idle request was answered, init ran)', up);
      /* the control for the claim of group 4: it only means something if the page, not embedded, does ask its API (the offline profile answers 503,
         which the page reads as "no API here"; the request was made all the same) */
      const apiPaths = w.reqs.filter(u => isApi(srv, u)).map(u => new URL(u).pathname);
      chk('the page, live, asks its own cache API for the element set (/api/tle/<n>): the control for group 4, where under ?tle=embedded it must not', apiPaths.some(p => /^\/api\/tle\//.test(p)), apiPaths.join(' ') || 'none');
      chk('the AR chunk is not requested (a fine pointer has no finger to use it with)', count(w, 'chunk') === 0, 'chunk requests: ' + count(w, 'chunk'));
      chk('the test surface chunk is not requested', count(w, 'surface') === 0, 'surface requests: ' + count(w, 'surface'));
      const win = await w.page.evaluate(n => n.map(k => k + ':' + typeof window[k]), FACADE);
      chk('nothing of the facade is on the window (' + FACADE.join(', ') + ')', win.every(s => /:undefined$/.test(s)), win.filter(s => !/:undefined$/.test(s)).join(' ') || 'all undefined');
      chk('#arbtn is not visible, and the AR view is not in the page at all', !(await visible(w.page, '#arbtn')) && (await w.page.evaluate(() => document.getElementById('arview') === null)));
      const hosts = [...new Set(w.reqs.map(u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.origin !== srv.origin ? x.hostname : null; } catch (e) { return null; } }).filter(Boolean))];
      chk('no host is contacted but the two element-set sources the page asks when no cache API answers (CelesTrak and its mirror)', hosts.every(h => ELEMENT_SET_HOSTS.includes(h)),
        hosts.join(', ') || 'none');
      const st = await storeNow(w.page);
      chk('localStorage is empty after the page has settled', Array.isArray(st.keys) && st.keys.length === 0, JSON.stringify(st.keys));
      chk('...and nothing was written to or removed from any storage, by the page or by the planner', v.writes.length === 0, v.writes.join(' ') || 'none');
      noErrors('group 1', w);
    }
    if (want(7)) {
      console.log('\n7. The weight of the first screen: its JavaScript, and everything else it fetches from this origin (a ceiling 5 % above each measurement; the budget for the entry chunk is 90 KB gzipped)');
      const files = [...new Set(w.reqs.filter(u => chunkOf(u) !== null && !FAMILY.includes(chunkOf(u)) && !['chunk', 'surface'].includes(chunkOf(u))))];
      const sizes = [];
      for (const u of files) sizes.push({ name: chunkOf(u), gz: await gzBytes(srv, u) });
      /* The Decay panel's own chunks are fetched when its section is near enough to view, which depends on the layout and the machine: counted
         whether or not this visit fetched them, so that the number is the same on every run and a chunk that grows is seen on every run. */
      for (const n of DECAY_OWN) {
        const f = srv.root && fs.readdirSync(path.join(srv.root, 'assets')).find(x => chunkOf('/assets/' + x) === n);
        if (f && !sizes.some(x => x.name === n)) sizes.push({ name: n, gz: await gzBytes(srv, '/assets/' + f), unfetched: true });
      }
      const total = sizes.reduce((s, x) => s + x.gz, 0);
      const entry = { gz: sizes.filter(x => ENTRY_GRAPH.includes(x.name)).reduce((s, x) => s + x.gz, 0), n: sizes.filter(x => ENTRY_GRAPH.includes(x.name)).length };
      note(sizes.sort((a, b) => b.gz - a.gz).map(x => x.name + ' ' + (x.gz / 1000).toFixed(1) + ' kB' + (x.unfetched ? ' (not fetched by this visit)' : '')).join(', '));
      chk('the entry (the entry chunk, the Svelte runtime it shares and the rich-text chunk) is no heavier than ' + (CEIL.entry / 1000).toFixed(1) + ' kB gzipped (measured ' + (CEIL.entryMeasured / 1000).toFixed(1) + ' kB, +5 %), and is within the 90 kB budget', entry.n === ENTRY_GRAPH.length && entry.gz <= CEIL.entry && entry.gz <= 90000,
        'now ' + (entry.gz / 1000).toFixed(2) + ' kB gzipped in ' + entry.n + ' files; the 90 kB budget is ' + (entry.gz <= 90000 ? 'met' : 'NOT met'));
      chk('all the first screen\'s JavaScript (what the visitor fetched, and the Decay panel\'s own chunks whether or not this visit was near enough to fetch them) but the planner\'s five chunks is no heavier than ' + (CEIL.total / 1000).toFixed(1) + ' kB gzipped (measured ' + (CEIL.totalMeasured / 1000).toFixed(1) + ' kB, +5 %)', total <= CEIL.total,
        'now ' + (total / 1000).toFixed(2) + ' kB in ' + sizes.length + ' files');
      /* The weight of everything else the first screen fetches. The JavaScript is not the heaviest part of it: the globe's texture alone is more
         than the JavaScript of the entry chunk, and a scene that asked for a larger tier of it would cost the visitor megabytes. Every distinct file of
         this origin the visit asked for, but the planner's own (five chunks and the stylesheet that comes with `parts`) and the page's API, and the
         Decay panel's own two chunks always counted (as above). A file the server does not have (a favicon) is no weight. */
      const everyone = [...new Set(w.reqs.filter(u => u.startsWith(srv.origin + '/') && !isApi(srv, u)).map(u => new URL(u).pathname))]
        .filter(p => !FAMILY.includes(chunkOf(p)) && !/^\/assets\/parts-[A-Za-z0-9_-]{8}\.css$/.test(p));
      const weigh = [];
      for (const p of everyone) { const gz = await gzBytes(srv, p); if (gz !== null) weigh.push({ p, gz, kind: kindOf(p) }); }
      for (const x of sizes.filter(s => s.unfetched)) weigh.push({ p: x.name, gz: x.gz, kind: 'JavaScript' });
      const byKind = {};
      for (const x of weigh) byKind[x.kind] = (byKind[x.kind] || 0) + x.gz;
      const everything = weigh.reduce((s, x) => s + x.gz, 0);
      note(Object.keys(byKind).sort((a, b) => byKind[b] - byKind[a]).map(k => k + ' ' + kB(byKind[k])).join(', ') + '; the largest: ' + weigh.slice().sort((a, b) => b.gz - a.gz).slice(0, 3).map(x => x.p.replace(/^\/assets\//, '') + ' ' + kB(x.gz)).join(', '));
      chk('everything the first screen fetches from this origin (the JavaScript above and the stylesheet, the catalogue, the world map, the fonts and the globe\'s texture; not the planner\'s five chunks and its stylesheet) is no heavier than ' + kB(CEIL.all) + ' gzipped (measured ' + kB(CEIL.allMeasured) + ', +5 %)',
        everything <= CEIL.all, 'now ' + kB(everything) + ' (' + everything + ' bytes) in ' + weigh.length + ' files');
      /* what strictly came before the first planner chunk is printed as well, for whoever lowers the ceilings; it depends on when the browser idles, so it is not asserted */
      const order = w.reqs.filter(u => chunkOf(u) !== null);
      const cut = order.findIndex(u => FAMILY.includes(chunkOf(u)));
      note('fetched before the first planner chunk: ' + order.slice(0, cut < 0 ? order.length : cut).map(chunkOf).join(', '));
    }
    await w.ctx.close();
  });

  /* ---- 2. a visitor with a saved orbit ----------------------------------------------------------------------------------------------- */
  if (want(2)) await group(2, async () => {
    console.log('\n2. A visitor with one saved orbit');
    const w = await visit(browser, { seed: SEED });
    await w.page.goto(srv.page, { waitUntil: 'load' });
    await answerOn(w);
    const c = await countIs(w.page, '2,158 + 1 of yours');
    chk('once the planner is up the picker counts "2,158 + 1 of yours" (the saved orbit is restored without anything being pressed)', c.ok, '"' + c.c + '" after ' + c.ms + ' ms');
    await H.openPicker(w.page);
    const rows = await w.page.evaluate(() => [...document.querySelectorAll('#satlist li')].slice(0, 4).map(l => ({ cls: l.className.replace(/svelte-\w+/g, '').trim(), role: l.getAttribute('role'), nm: (l.querySelector('.nm') || l).textContent.trim(), tag: (l.querySelector('.tag') || {}).textContent || null })));
    chk('the picker lists it under "Your orbits" (a group heading, then li.cu with its name and the tag), and the catalogue under its own', rows.length >= 3 && rows[0].cls === 'grp' && rows[0].nm === 'Your orbits' && /\bcu\b/.test(rows[1].cls) && rows[1].nm === 'Saved earlier' && rows[1].tag === 'custom' && rows[2].cls === 'grp' && rows[2].nm === 'Catalogue',
      JSON.stringify(rows.map(r => r.cls + ':' + r.nm + (r.tag ? '/' + r.tag : ''))));
    chk('...and offers the Plan row, last', await w.page.evaluate(() => { const l = [...document.querySelectorAll('#satlist li[role=option]')]; return !!l.length && l[l.length - 1].id === 'soptplan'; }));
    await H.closePicker(w.page);
    let st = await storeNow(w.page);
    let v = await clock(w);
    chk('the saved record is byte-identical to what was seeded, and is not rewritten (no write, no removal)', st.rec === SEED && v.writes.length === 0, (st.rec === SEED ? 'identical' : 'CHANGED') + '; writes: ' + (v.writes.join(' ') || 'none'));
    await w.page.click('#planopen');
    const opened = await until(w.page, () => { const p = document.getElementById('planner'); return !!p && !p.hidden && document.getElementById('planopen').getAttribute('aria-expanded') === 'true'; });
    const list = await w.page.evaluate(() => [...document.querySelectorAll('#pl-saved-list li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()));
    chk('#planopen opens the planner, and #pl-saved-list lists the saved orbit', opened && list.length === 1 && /^Saved earlier/.test(list[0]), list.join(' | ') || 'no rows');
    st = await storeNow(w.page); v = await clock(w);
    chk('...the record is still byte-identical, and nothing was written', st.rec === SEED && v.writes.length === 0 && st.keys.length === 1, st.keys.join(',') + '; writes: ' + (v.writes.join(' ') || 'none'));
    chk('...and each planner chunk was requested once only (the pill after the idle request does not fetch again)', FAMILY.every(n => count(w, n) === 1) && count(w, 'lifetime') === 1, FAMILY.concat(['lifetime']).map(n => n + ' ' + count(w, n)).join(', '));
    noErrors('group 2', w);
    await w.ctx.close();
  });

  /* ---- 3. the pill pressed at first paint --------------------------------------------------------------------------------------------- */
  if (want(3)) await group(3, async () => {
    console.log('\n3. The pill pressed at first paint, before the browser has idled');
    const w = await visit(browser, { hold: true });
    await w.page.goto(srv.page, { waitUntil: 'commit' });
    await w.page.waitForSelector('#planopen', { state: 'visible', timeout: WAIT });
    const before = FAMILY.reduce((s, n) => s + count(w, n), 0);
    const answeredAtPress = await w.page.evaluate(() => window.__v.answer !== null);
    await w.page.click('#planopen');
    chk('no planner chunk had been requested when the pill was pressed (so the press is what brings the planner)', before === 0, 'requests at the press: ' + before + '; the first answer was ' + (answeredAtPress ? '' : 'not yet ') + 'on screen');
    /* The page's own request for idle time is made once the first answer is committed, and was kept: answered NOW, after the press, while the
       planner is on its way (or just up). That is the order a quick visitor makes, and the one in which the planner could be started twice. */
    const kept = await until(w.page, () => window.__v.held >= 1);
    const released = kept ? await w.page.evaluate(() => window.__release()) : 0;
    const ranAll = kept && await until(w.page, n => window.__v.ran >= n, released);
    const opened = await until(w.page, () => { const p = document.getElementById('planner'); return !!p && !p.hidden && document.getElementById('planopen').getAttribute('aria-expanded') === 'true' && document.activeElement && document.activeElement.id === 'pl-name'; });
    const s = await w.page.evaluate(() => ({ hidden: (document.getElementById('planner') || {}).hidden, exp: document.getElementById('planopen').getAttribute('aria-expanded'), focus: document.activeElement && document.activeElement.id }));
    chk('the planner opens once its chunks arrive: #planner shown, #planopen aria-expanded=true, the focus on #pl-name', opened, JSON.stringify(s));
    chk('the page\'s own request for idle time was kept until after the press and then answered (its callback ran), so the idle request did come second', kept && released >= 1 && ranAll, released + ' kept request(s) answered after the press; ' + (kept && ranAll ? 'all ran' : 'not run'));
    const dom = await w.page.evaluate(() => ({ panels: document.querySelectorAll('#planner').length, live: document.querySelectorAll('#pl-live').length, names: document.querySelectorAll('#pl-name').length }));
    chk('...each of its chunks fetched once, whoever asked first (the press, then the idle request), and the planner is in the page once', FAMILY.every(n => count(w, n) === 1) && dom.panels === 1 && dom.live === 1 && dom.names === 1,
      FAMILY.map(n => n + ' ' + count(w, n)).join(', ') + '; ' + JSON.stringify(dom));
    await w.page.fill('#pl-name', 'Made at first paint');
    await w.page.click('#pl-add');
    const added = await until(w.page, () => /Added/.test((document.getElementById('pl-status') || {}).textContent || ''));
    const status = await w.page.evaluate(() => (document.getElementById('pl-status') || {}).textContent.replace(/\s+/g, ' ').trim());
    /* A planner started twice (the press, then the idle request) is a controller that answers one press twice: the second Add finds the name taken and
       says "Not added: ... is already a name", where the first said Added. Nothing else of the page shows a second start. */
    chk('Add (a name typed, #pl-add pressed once) adds an orbit: the status line says Added (and not "Not added: ... already a name", which is what a planner started twice says)', added && /^Added /.test(status), status.slice(0, 120));
    const chip = await w.page.evaluate(() => { const c = document.getElementById('customchip'); return { shown: !!c && !c.closest('[hidden]') && c.getClientRects().length > 0, text: c ? c.textContent.trim() : '' }; });
    chk('...and the header shows the Custom orbit chip', chip.shown && /Custom orbit/.test(chip.text), JSON.stringify(chip));
    const rec = JSON.parse((await storeNow(w.page)).rec || 'null');
    chk('...and it is saved (gt.custom holds one orbit, named as typed)', !!rec && rec.items.length === 1 && rec.items[0].name === 'Made at first paint', rec ? rec.items.map(i => i.id + ' ' + i.name).join(',') : 'no record');
    let v = await clock(w);
    chk('the address bar does not carry sat=O... after Add (the placeholder is nobody\'s number)', !/[?&]sat=O/i.test(w.page.url()) && !v.urls.some(u => /sat=O/i.test(u)), w.page.url().replace(srv.origin, '') + (v.urls.length ? '  history writes: ' + v.urls.join(' ') : ''));
    noErrors('group 3 (before the reload)', w);

    await w.page.evaluate(() => { window.name = 'gt-idle-ok'; });  // the reload is a visitor who is let to idle
    await w.page.reload({ waitUntil: 'load' });
    await answerOn(w);
    const c = await countIs(w.page, '2,158 + 1 of yours');
    chk('reload: after idle the picker counts "2,158 + 1 of yours"', c.ok, '"' + c.c + '" after ' + c.ms + ' ms');
    await H.openPicker(w.page);
    const names = await w.page.evaluate(() => [...document.querySelectorAll('#satlist li.cu .nm')].map(n => n.textContent.trim()));
    await H.closePicker(w.page);
    chk('...and it is the orbit that was made', names.length === 1 && names[0] === 'Made at first paint', names.join(', '));
    v = await clock(w);
    chk('the address bar never carried sat=O... (before the reload and after it)', !/[?&]sat=O/i.test(w.page.url()) && !v.urls.some(u => /sat=O/i.test(u)), w.page.url().replace(srv.origin, ''));
    noErrors('group 3', w);
    await w.ctx.close();
  });

  /* ---- 4. ?tle=embedded ---------------------------------------------------------------------------------------------------------------- */
  if (want(4)) await group(4, async () => {
    console.log('\n4. ?tle=embedded, the assignment snapshot');
    const w = await visit(browser, { seed: SEED });
    await w.page.goto(srv.page + '?tle=embedded', { waitUntil: 'load' });
    const answered = await answerOn(w);
    const t = await w.page.evaluate(() => window.__v.answer);
    const idled = await until(w.page, ms => performance.now() - window.__v.answer >= ms, IDLE_SETTLE, WAIT + IDLE_SETTLE);
    const fam = FAMILY.concat(['chunk', 'surface']).map(n => n + ' ' + count(w, n));
    chk('no planner chunk is requested at all, even after ' + IDLE_SETTLE / 1000 + ' s of idle', answered && idled && FAMILY.every(n => count(w, n) === 0) && w.reqs.every(u => !/parts-[\w-]+\.css/.test(u)), fam.join(', ') + '; lifetime ' + count(w, 'lifetime') + ' (the Decay panel\'s)');
    /* The page's own cache API is on the page's origin, so "nothing leaves the origin" does not see it: it is looked for by its path (CHANGES-FROM-LEGACY
       7: under ?tle=embedded nothing is asked, not even the API). Group 1 has the control that a live visit does ask it. */
    const away = w.reqs.filter(u => !u.startsWith(srv.origin) && !u.startsWith('data:')), api = w.reqs.filter(u => isApi(srv, u));
    chk('...nor the AR chunk, nor the test surface, and nothing is asked of any other origin or of the page\'s own cache API (/api/...)', count(w, 'chunk') === 0 && count(w, 'surface') === 0 && away.length === 0 && api.length === 0,
      (away.concat(api).join(' ') || 'every request is a file of ' + srv.origin) + '; chunk ' + count(w, 'chunk') + ', surface ' + count(w, 'surface'));
    const pill = await w.page.evaluate(() => { const p = document.getElementById('planopen'); return { shown: !p.closest('[hidden]') && p.getClientRects().length > 0, disabled: p.getAttribute('aria-disabled'), title: p.title, expanded: p.getAttribute('aria-expanded') }; });
    chk('#planopen is visible and aria-disabled="true", titled with the sentence', pill.shown && pill.disabled === 'true' && pill.title === SNAPSHOT_SENTENCE, JSON.stringify(pill));
    const nt = await w.page.evaluate(() => { const n = document.getElementById('plannote'); const a = n && n.querySelector('a[href="?"]'); return { shown: !!n && !n.closest('[hidden]') && n.getClientRects().length > 0, text: n ? n.textContent.replace(/\s+/g, ' ').trim() : '', link: a ? a.textContent.trim() : null }; });
    chk('#plannote is visible, says the sentence, and has the way back: a[href="?"] "Back to the live element sets"', nt.shown && nt.text.indexOf(SNAPSHOT_SENTENCE) === 0 && nt.link === 'Back to the live element sets', JSON.stringify(nt));
    await w.page.click('#planopen', { force: true });          // a visitor can press it with the mouse: Playwright refuses an aria-disabled button unless forced
    await w.page.waitForTimeout(700);
    const after = await w.page.evaluate(() => ({ expanded: document.getElementById('planopen').getAttribute('aria-expanded'), node: !!document.getElementById('planner') }));
    chk('pressing the pill does nothing: aria-expanded stays false, no planner node appears, no chunk is fetched', after.expanded === 'false' && !after.node && FAMILY.every(n => count(w, n) === 0), JSON.stringify(after) + '; ' + FAMILY.map(n => n + ' ' + count(w, n)).join(', '));
    const st = await storeNow(w.page), v = await clock(w);
    chk('a saved orbit seeded beforehand is untouched (byte-identical, no write, no removal)', st.rec === SEED && v.writes.length === 0, (st.rec === SEED ? 'identical' : 'CHANGED') + '; writes: ' + (v.writes.join(' ') || 'none'));
    const exact = (await w.page.textContent('#totalexact')).replace(/\s+/g, ' ').trim();
    const name = (await w.page.textContent('#satname')).trim();
    chk('the answer is the snapshot\'s: KNACKSAT-2, 899.7 s over 2 passes', name === 'KNACKSAT-2' && /899\.7 s over 2 passes/.test(exact), name + ': ' + exact);
    /* read with the picker OPEN: a shut popover has no list in the page, and a Plan row could not be found in it whatever the page did */
    await H.openPicker(w.page);
    const listed = await until(w.page, () => document.querySelectorAll('#satlist li[role=option]').length > 0);
    const pk = await w.page.evaluate(() => ({ count: (document.getElementById('satcount') || {}).textContent || '', list: !!document.getElementById('satlist'), rows: document.querySelectorAll('#satlist li[role=option]').length,
      plan: !!document.getElementById('soptplan') || !!document.querySelector('#satlist li.plan, #satlist [data-plan]'), cu: document.querySelectorAll('#satlist li.cu').length, grp: document.querySelectorAll('#satlist li.grp').length }));
    await H.closePicker(w.page);
    chk('the picker, open, counts the catalogue only ("2,158 spacecraft"), lists spacecraft, and has no Plan row (#soptplan) and none of the reader\'s orbits', listed && pk.count === '2,158 spacecraft' && pk.list && pk.rows > 0 && !pk.plan && pk.cu === 0 && pk.grp === 0, JSON.stringify(pk));
    noErrors('group 4', w);
    await w.ctx.close();
  });

  /* ---- 5. a planner chunk that cannot be fetched --------------------------------------------------------------------------------------- */
  /* The planner is six files, not one: the five chunks of FAMILY and `lifetime`, the drag integrator the Decay panel shares with it. Each is refused in
     turn, since the page loads them through different paths (the controller, the parts, the four maths modules) and a refusal could be handled in one
     and not in another. Whichever it is, the planner is not to be had, and the page is to say nothing about it but the one console line. */
  if (want(5)) await group(5, async () => {
    console.log('\n5. A file of the planner that cannot be fetched (assets/<name>-*.js aborted), each of the six in turn');
    for (const name of REFUSED) {
      const P = '[' + name + ' refused] ';
      console.log('   ' + name);
      const w = await visit(browser, { seed: SEED });
      await w.page.route(new RegExp('/assets/' + name + '-[A-Za-z0-9_-]{8}\\.js$'), r => r.abort());      // one name: advisor- is also the start of advisor-copy-, so the hash is anchored
      await w.page.goto(srv.page, { waitUntil: 'load' });
      const answered = await answerOn(w);
      const gone = await until(w.page, () => { const p = document.getElementById('planopen'); return !!p && (!!p.closest('[hidden]') || p.getClientRects().length === 0); });
      const pill = await w.page.evaluate(() => { const p = document.getElementById('planopen'), t = p.closest('.t-plan'); const r = p.getBoundingClientRect(); return { wrapperHidden: !!t && t.hidden, boxes: p.getClientRects().length, w: r.width, h: r.height }; });
      const v = await clock(w);
      chk(P + 'once the failure is known the pill is gone: its wrapper hidden, no box', gone && pill.wrapperHidden && pill.boxes === 0, JSON.stringify(pill));
      chk(P + '...it had been shown from the first paint (a failure is not a reason for it to be missing earlier)', v.pillShown !== null && !v.pillFirstHidden && v.pillShown <= v.answer, 'shown at ' + (v.pillShown === null ? 'never' : round(v.pillShown) + ' ms'));
      chk(P + 'the chunk was asked for and its request failed (so the abort is what happened), and for no more than the page itself asks',
        count(w, name) >= 1 && w.failed.some(u => chunkOf(u) === name) && count(w, 'chunk') === 0 && count(w, 'surface') === 0, FAMILY.concat(['lifetime']).map(n => n + ' ' + count(w, n)).join(', ') + '; failed: ' + (w.failed.filter(u => chunkOf(u) !== null).map(chunkOf).join(', ') || 'none'));
      const first = await w.page.evaluate(() => document.getElementById('totalbig').textContent.trim());
      chk(P + 'the console works: the answer is on screen', answered && /\d/.test(first), first);
      const count1 = await H.satCount(w.page);
      await H.openPicker(w.page);
      const picker = await w.page.evaluate(() => ({ plan: !!document.getElementById('soptplan') || !!document.querySelector('#satlist li.plan'), cu: document.querySelectorAll('#satlist li.cu').length, grp: [...document.querySelectorAll('#satlist li.grp')].map(g => g.textContent.trim()), rows: document.querySelectorAll('#satlist li[role=option]').length }));
      await H.closePicker(w.page);
      chk(P + '...the picker opens and lists 2,158 spacecraft, and no Plan row', count1 === '2,158 spacecraft' && !picker.plan && picker.rows > 0, '"' + count1 + '", ' + JSON.stringify(picker));
      chk(P + 'a saved orbit is simply not listed (no "Your orbits", no row of its own)', picker.cu === 0 && picker.grp.length === 0, JSON.stringify(picker.grp));
      const st = await storeNow(w.page), v2 = await clock(w);
      chk(P + '...and the saved record is untouched (byte-identical, no write, no removal)', st.rec === SEED && v2.writes.length === 0, (st.rec === SEED ? 'identical' : 'CHANGED') + '; writes: ' + (v2.writes.join(' ') || 'none'));
      noErrors('group 5 [' + name + ' refused]', w, /dynamically imported module|Failed to fetch|module script/i);
      await w.ctx.close();
      opened.delete(w.ctx);
    }
  });

  /* ---- 6. the AR view ------------------------------------------------------------------------------------------------------------------- */
  if (want(6)) await group(6, async () => {
    console.log('\n6. The AR view, offered only where a finger is the primary pointer');
    {
      const w = await visit(browser);
      await w.page.goto(srv.page, { waitUntil: 'load' });
      await answerOn(w);
      const idled = await until(w.page, () => window.__v.res.some(r => /\/assets\/plannerui-/.test(r.url)));      // the browser has idled: whatever idle brings has been asked for
      await w.page.waitForTimeout(400);
      chk('desktop (fine pointer): #arbtn is not visible, the AR chunk is never requested, and there is no AR view in the page', idled && !(await visible(w.page, '#arbtn')) && count(w, 'chunk') === 0 && (await w.page.evaluate(() => document.getElementById('arview') === null)),
        'chunk requests ' + count(w, 'chunk'));
      await w.ctx.close();
    }
    /* A touch laptop: the primary pointer is a mouse and a touch screen is also attached. The page reads the PRIMARY pointer ("never a touch laptop,
       whose primary pointer is fine": ar/session.svelte.ts), so a question that was (any-pointer: coarse) would offer the view here and fetch its chunk. */
    {
      const w = await visit(browser, { laptop: true });
      await w.page.goto(srv.page, { waitUntil: 'load' });
      await answerOn(w);
      const idled = await until(w.page, () => window.__v.res.some(r => /\/assets\/plannerui-/.test(r.url)));
      await w.page.waitForTimeout(400);
      const mq = await w.page.evaluate(() => ({ any: matchMedia('(any-pointer: coarse)').matches, primary: matchMedia('(pointer: coarse)').matches }));
      chk('touch laptop (a mouse is the primary pointer, a touch screen is also there: (any-pointer: coarse) true, (pointer: coarse) false): #arbtn is not visible, the AR chunk is never requested, no AR view in the page',
        mq.any === true && mq.primary === false && idled && !(await visible(w.page, '#arbtn')) && count(w, 'chunk') === 0 && (await w.page.evaluate(() => document.getElementById('arview') === null)), JSON.stringify(mq) + ', chunk requests ' + count(w, 'chunk'));
      await w.ctx.close();
    }
    /* Tablets, in both orientations: a finger is the primary pointer, whatever the width, so the view is offered and its chunk fetched once. (Playwright's
       hasTouch makes the touch screen the primary pointer, which the first check says; it is what a tablet is.) */
    for (const [label, device] of [['tablet, portrait 820x1180', TABLET], ['tablet, landscape 1180x820', TABLET_LAND]]) {
      const w = await visit(browser, { device });
      await w.page.goto(srv.page, { waitUntil: 'load' });
      await answerOn(w);
      const offered = await until(w.page, () => { const b = document.getElementById('arbtn'); return !!b && !b.closest('[hidden]') && b.getClientRects().length > 0; });
      await w.page.waitForTimeout(400);
      const mq = await w.page.evaluate(() => ({ any: matchMedia('(any-pointer: coarse)').matches, primary: matchMedia('(pointer: coarse)').matches, w: innerWidth, h: innerHeight }));
      const v = await clock(w), at = v.res.filter(r => chunkOf(r.url) === 'chunk').map(r => r.t);
      chk(label + ' (touch, coarse pointer): #arbtn is offered (visible)', mq.primary === true && offered, JSON.stringify(mq) + ', offered ' + offered);
      chk('...the AR chunk was requested exactly once, after the first answer, and the test surface not at all', count(w, 'chunk') === 1 && at.length === 1 && v.answer !== null && at[0] > v.answer && count(w, 'surface') === 0,
        'chunk requests ' + count(w, 'chunk') + (at.length ? ', at +' + round(at[0] - v.answer) + ' ms after the answer' : ''));
      noErrors(label, w);
      await w.ctx.close();
    }
    const w = await visit(browser, { device: PHONE });
    await w.page.goto(srv.page, { waitUntil: 'load' });
    await answerOn(w);
    const offered = await until(w.page, () => { const b = document.getElementById('arbtn'); return !!b && !b.closest('[hidden]') && b.getClientRects().length > 0; });
    await until(w.page, () => !!document.getElementById('pl-live'));       // the planner's body-level pieces are in the page: they are inert too
    const a = await w.page.evaluate(() => { const b = document.getElementById('arbtn'), r = document.getElementById('arview'); return { popup: b && b.getAttribute('aria-haspopup'), controls: b && b.getAttribute('aria-controls'), parent: r && r.parentElement && r.parentElement.tagName, inApp: !!r && !!r.closest('#app'), hidden: r && r.hidden }; });
    chk('phone (touch, coarse pointer): after idle #arbtn is visible, has aria-haspopup=dialog and aria-controls=arview', offered && a.popup === 'dialog' && a.controls === 'arview', JSON.stringify({ offered, popup: a.popup, controls: a.controls }));
    const pv = await clock(w), arAt = pv.res.filter(r => chunkOf(r.url) === 'chunk').map(r => r.t);
    chk('...the AR chunk was requested exactly once, after the first answer (group 8 holds the answer back to show it is the answer that is waited for), and the test surface not at all', count(w, 'chunk') === 1 && arAt.length === 1 && pv.answer !== null && arAt[0] > pv.answer && count(w, 'surface') === 0,
      'chunk requests ' + count(w, 'chunk') + (arAt.length ? ', at +' + round(arAt[0] - pv.answer) + ' ms after the answer' : ''));
    chk('...#arview is a direct child of <body>, not inside #app, and hidden', a.parent === 'BODY' && !a.inApp && a.hidden === true, JSON.stringify(a));
    const win = await w.page.evaluate(n => n.filter(k => typeof window[k] !== 'undefined'), FACADE);
    chk('...the visitor has no window.ARView (nor any other part of the facade)', win.length === 0, win.join(' ') || 'none');
    await w.page.tap('#arbtn');
    const open = await w.page.evaluate(() => ({ cls: document.documentElement.classList.contains('ar-open'), hidden: document.getElementById('arview').hidden,
      others: [...document.body.children].filter(c => c.id !== 'arview' && c.tagName !== 'SCRIPT').map(c => c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + ':' + (c.inert ? 'inert' : 'LIVE')) }));
    chk('pressing #arbtn opens the view: the html element has ar-open, #arview is not hidden', open.cls && open.hidden === false, JSON.stringify({ cls: open.cls, hidden: open.hidden }));
    chk('...every other child of <body> but #arview and the scripts is inert', open.others.length >= 1 && open.others.every(s => /:inert$/.test(s)), open.others.join(' '));
    const failedState = await until(w.page, () => document.getElementById('arview').dataset.state === 'failed');
    const status = await w.page.evaluate(() => document.getElementById('ar-status').textContent.replace(/\s+/g, ' ').trim());
    chk('the sensors are not available here: the view is in the failed state and says why in #ar-status', failedState && status.length > 0, status.slice(0, 90));
    chk('...and still no window.ARView', await w.page.evaluate(() => typeof window.ARView === 'undefined'));
    await w.page.tap('#ar-close');
    const closed = await until(w.page, () => !document.documentElement.classList.contains('ar-open') && document.getElementById('arview').hidden);
    const back = await w.page.evaluate(() => ({ cls: document.documentElement.classList.contains('ar-open'), hidden: document.getElementById('arview').hidden, inert: [...document.body.children].filter(c => c.inert).map(c => c.tagName), anyInert: document.querySelectorAll('[inert]').length, focus: document.activeElement && document.activeElement.id }));
    chk('Close (#ar-close) puts everything back: no ar-open, the view hidden, nothing inert, the focus on #arbtn', closed && !back.cls && back.hidden && back.inert.length === 0 && back.anyInert === 0 && back.focus === 'arbtn', JSON.stringify(back));
    noErrors('group 6', w);
    await w.ctx.close();
  });

  /* ---- 8. a slow catalogue ----------------------------------------------------------------------------------------------------------------- */
  if (want(8)) await group(8, async () => {
    console.log('\n8. A slow catalogue (kept back ' + HOLD / 1000 + ' s): the planner and the AR view wait for the first answer, and not only for the browser to be idle');
    /* With the catalogue at hand the first answer and the first idle moment of the browser are a few milliseconds apart, and "the planner comes after the
       answer" is decided by that race (a page that waited for the browser only, and not for the answer, passed group 1 two runs in three). Here the main
       thread has nothing to do for HOLD ms, so the browser is idle from the start: a chunk requested before the answer is a chunk that did not wait for it. */
    for (const [label, device] of [['desktop', DESKTOP], ['phone', PHONE]]) {
      const P = '[' + label + ', slow catalogue] ';
      console.log('   ' + label);
      const w = await visit(browser, { device, slow: HOLD });
      await w.page.goto(srv.page, { waitUntil: 'load' });
      const answered = await answerOn(w);
      const famSeen = await until(w.page, f => f.every(n => window.__v.res.some(r => new RegExp('/assets/' + n + '-[A-Za-z0-9_-]{8}\\.js$').test(r.url))), FAMILY);
      const arSeen = device !== PHONE || await until(w.page, () => window.__v.res.some(r => /\/assets\/chunk-[A-Za-z0-9_-]{8}\.js$/.test(r.url)));
      const v = await clock(w);
      const t = n => v.res.filter(r => chunkOf(r.url) === n).map(r => r.t);
      const first = Math.min.apply(null, FAMILY.map(n => Math.min.apply(null, t(n).concat([Infinity]))));
      const last = Math.max.apply(null, FAMILY.map(n => Math.max.apply(null, t(n).concat([-Infinity]))));
      chk(P + 'the catalogue was kept back: the first answer is on screen, and came no sooner than ' + HOLD + ' ms after the navigation (what follows is about a page that waited)', answered && v.answer !== null && v.answer >= HOLD,
        'answer at ' + (v.answer === null ? 'never' : round(v.answer) + ' ms'));
      chk(P + 'no planner chunk was requested before the first answer (the browser had been idle for ' + HOLD / 1000 + ' s)', answered && first !== Infinity && first > v.answer, 'first planner chunk at ' + round(first) + ' ms, the answer at ' + round(v.answer) + ' ms (+' + round(first - v.answer) + ' ms)');
      chk(P + 'the planner\'s five chunks then arrive, once each, within ' + BOOT_BUDGET / 1000 + ' s of the answer', famSeen && FAMILY.every(n => count(w, n) === 1) && last - v.answer <= BOOT_BUDGET, 'last +' + round(last - v.answer) + ' ms after the answer; ' + FAMILY.map(n => n + ' ' + count(w, n)).join(', '));
      if (device === PHONE) {
        const at = t('chunk');
        chk(P + 'the AR chunk is requested after the first answer too, and once', arSeen && count(w, 'chunk') === 1 && at.length === 1 && at[0] > v.answer, 'chunk requests ' + count(w, 'chunk') + (at.length ? ', at +' + round(at[0] - v.answer) + ' ms after the answer' : ''));
      }
      noErrors('group 8 [' + label + ']', w);
      await w.ctx.close();
      opened.delete(w.ctx);
    }
  });

  await browser.close();
  console.log('\n' + (ONLY ? '(groups ' + [...ONLY].join(',') + ' only, plus the build check: ' + (passes + fails) + ' checks, ' + passes + ' passed)' : (passes + fails) + ' checks, ' + passes + ' passed') + '   in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  const ok = fails === 0 && allErrs.length === 0;
  if (ok && !ONLY) console.log('ALL CHECKS PASS');
  else if (ok) console.log('(the full run is the one that ends ALL CHECKS PASS)');
  else console.log(fails + ' CHECK(S) FAILED' + (allErrs.length ? '   PAGE ERRORS: ' + allErrs.length : ''));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
