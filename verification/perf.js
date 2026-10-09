/*
 * perf.js - the old page and the rebuilt page, measured the same way, in one table.
 *
 *   node verification/perf.js                          both pages, 5 runs each, CPU x4, slow 4G
 *   node verification/perf.js --runs 7 --assert        the published numbers; exit 1 if a NEW number misses its target
 *   node verification/perf.js --target new --runs 3    one page (the production build in dist/, or GT_DIST; `npm run build` first)
 *   node verification/perf.js --json | --md            the JSON, or a Markdown table (for the PR text), on stdout; progress goes to stderr
 *   options: --cpu <n> (4)  --net none|slow4g (slow4g)  --http 1|2 (2)  --timeout <s> (120)  --out <file> (verification/perf-last.json)
 *
 * What it does, per page and per run: a FRESH Chromium (software WebGL, as the suites run it) and a fresh context at 1440x900, DPR 1, en-US,
 * Asia/Bangkok, light scheme, the REAL clock (no Playwright clock); CPU throttled with CDP Emulation.setCPUThrottlingRate and the network with
 * Network.emulateNetworkConditions (slow 4G: 1.6 Mbit/s down, 750 kbit/s up, 150 ms per request); loads the page and waits for the headline
 * (#totalbig, the big minutes figure, which both pages have) to hold a number and be painted; then
 *   - bytes and requests by type, first party and third party, for what the page fetched BEFORE the first answer ("first load") and for the
 *     whole visit until the network is quiet; transferred as served (brotli) and as the plan counts them (gzip level 9, like verify-visitor);
 *   - render-blocking requests (Chrome's own renderBlockingStatus from Resource Timing, the sync scripts in the DOM, the entry module);
 *   - FCP, LCP, CLS and long tasks from PerformanceObservers installed before the page's first script; TBT from FCP to the first answer + 2 s;
 *   - the clock set to its top rate (3600x) for 5 s: frames the globe draws per second (WebGL draw calls grouped by animation frame),
 *     requestAnimationFrame callbacks per second, main-thread busy time (CDP Performance.getMetrics TaskDuration) per second and per frame,
 *     long animation frames; then the clock paused, left alone for 2.5 s, and the same read for 3 s (the new page draws nothing then: CHANGES L22).
 * The table is the MEDIAN of the runs. Run to run spread is printed under it; if it is large the machine was busy: run again when it is quiet.
 *
 * HOW the network is made (and why it is not lib/harness.js's): Chromium's network throttling does not apply to responses Playwright fulfills
 * (route.fulfill: measured, a 400 KB body at 1.6 Mbit/s took 9 ms), and the harness fulfills the old page's CDN scripts and refuses its Google Fonts
 * stylesheet. Under throttling that would hand the old page its three.js and satellite.js for free. So lib/perf-server.js serves everything over a
 * real socket (HTTPS + HTTP/2 + brotli, one self-signed certificate that only this run's browser accepts), the third-party hosts are stand-ins on it
 * that Chromium is pointed at with --host-resolver-rules, and they are counted by their real host names (cdnjs.cloudflare.com, fonts.googleapis.com,
 * fonts.gstatic.com). No Playwright route is installed at all.
 *
 * WHAT THIS DOES NOT MEASURE (the numbers are a lab comparison, not a field result):
 *   - no real network: no DNS, TCP or TLS handshakes (the emulation adds one 150 ms delay per request and shares the bandwidth), no real CDN, no real
 *     Google Fonts bytes (same fonts and subsets from the Fontsource files, not Google's own files; they go through the same throttle);
 *   - the offline profile of the suites: CelesTrak, its mirror, GIBS and Open-Meteo do not resolve, and /api/* answers 503 - the numbers are about the
 *     page, not about CelesTrak. The new page asks its own /api once (a tiny 503, counted); the old page has no such request;
 *   - CPU throttling slows the page's main thread only. Workers, the GPU process (here SwiftShader, on the CPU) and the browser process run at full
 *     speed, which flatters the new page's worker-computed catalogue cloud and says nothing about a phone's GPU. A calibration loop before and after
 *     the load prints the slowdown the main thread actually got;
 *   - "first answer on screen" is the time of the animation frame after the one that painted the number (one frame, about 16 ms, late, on both pages).
 * Nothing in the repository is changed by it; it writes verification/perf-last.json (gitignored).
 */
'use strict';
const H = require('./lib/harness');
const PS = require('./lib/perf-server');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ---- options -------------------------------------------------------------------------------------------------------------------------- */
const argv = process.argv.slice(2);
const FLAGS = ['--assert', '--json', '--md', '--help'];
const VALUES = ['--runs', '--cpu', '--net', '--http', '--timeout', '--target', '--out', '--play', '--idle'];
for (let i = 0; i < argv.length; i++) {
  if (VALUES.includes(argv[i])) { i++; continue; }
  if (!FLAGS.includes(argv[i])) { console.error('perf.js: unknown option ' + argv[i] + '\n  options: ' + FLAGS.concat(VALUES).join(' ')); process.exit(2); }
}
const has = n => argv.includes('--' + n);
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
if (has('help')) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\n?/, '')); process.exit(0); }
const num = (n, d, min) => { const v = Number(val(n, d)); if (!Number.isFinite(v) || v < min) { console.error('perf.js: --' + n + ' must be a number >= ' + min); process.exit(2); } return v; };
const CFG = {
  runs: Math.floor(num('runs', 5, 1)), cpu: num('cpu', 4, 1), net: val('net', 'slow4g'), http: Math.floor(num('http', 2, 1)),
  timeout: num('timeout', 120, 10) * 1000, play: num('play', 5, 1) * 1000, idle: num('idle', 3, 1) * 1000,
  out: path.resolve(val('out', path.join(__dirname, 'perf-last.json'))), assert: has('assert')
};
const NETS = { none: null, slow4g: { latency: 150, down: 1.6e6 / 8, up: 750e3 / 8, label: 'slow 4G: 1.6 Mbit/s down, 750 kbit/s up, 150 ms per request' } };
if (!(CFG.net in NETS)) { console.error('perf.js: --net must be none or slow4g'); process.exit(2); }
if (CFG.http !== 1 && CFG.http !== 2) { console.error('perf.js: --http must be 1 or 2'); process.exit(2); }
const TARGET_ARG = val('target', 'both');
const TARGETS = TARGET_ARG === 'both' ? ['legacy', 'new'] : TARGET_ARG.split(',');
if (!TARGETS.every(t => t === 'legacy' || t === 'new')) { console.error('perf.js: --target must be legacy, new or both'); process.exit(2); }
const QUIET = has('json') || has('md');
const say = s => process.stderr.write(s + '\n');

/* the plan's budget for the NEW page (section 4, "mid-phone lab profile": CPU x4, ~slow 4G) */
const BUDGET = { firstLoadGz: 275000, fcp: 1500, lcp: 2500, tbt: 200, cls: 0.05, blockCss: 1, blockJs: 0, blockModule: 1, blockThirdParty: 0 };

/* ---- what runs inside the page, before its first script -------------------------------------------------------------------------------- */
function RECORDER() {
  const raf0 = window.requestAnimationFrame.bind(window);
  const p = window.__p = { answer: null, answerDom: null, answerRect: null, answerText: null, fp: null, fcp: null, lcp: [], cls: [], lt: [], loaf: [], ticks: [], frames: [], firstDraw: null, errors: [] };
  let inRaf = false, lastTs = -1, tickN = 0, lastDrawTick = -1, lastDraw = -1e9;
  /* every requestAnimationFrame callback the PAGE runs, once per animation frame (this wrapper's own frames use raf0 and are not counted) */
  window.requestAnimationFrame = function (cb) {
    return raf0(function (ts) {
      if (ts !== lastTs) { lastTs = ts; tickN++; p.ticks.push(ts); }
      inRaf = true;
      try { return cb.apply(this, arguments); } finally { inRaf = false; }
    });
  };
  /* frames the globe draws: a frame is the draw calls of one animation frame (or, outside a callback, a burst of calls within 4 ms of each other) */
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const f = C.prototype[n];
      if (!f) continue;
      C.prototype[n] = function () {
        const t = performance.now();
        if (inRaf ? tickN !== lastDrawTick : t - lastDraw > 4) { p.frames.push(t); if (p.firstDraw === null) p.firstDraw = t; if (inRaf) lastDrawTick = tickN; }
        lastDraw = t;
        return f.apply(this, arguments);
      };
    }
  }
  const obs = (type, fn) => { try { new PerformanceObserver(l => { for (const e of l.getEntries()) fn(e); }).observe({ type, buffered: true }); } catch (e) { p.errors.push(type + ': ' + e.message); } };
  obs('paint', e => { if (e.name === 'first-contentful-paint') p.fcp = e.startTime; else if (e.name === 'first-paint') p.fp = e.startTime; });
  obs('largest-contentful-paint', e => p.lcp.push({ t: e.startTime, size: e.size, el: e.element ? e.element.tagName + (e.element.id ? '#' + e.element.id : '') : null, url: e.url || null }));
  obs('layout-shift', e => { if (!e.hadRecentInput) p.cls.push({ t: e.startTime, v: e.value }); });
  obs('longtask', e => p.lt.push({ t: e.startTime, d: e.duration }));
  obs('long-animation-frame', e => p.loaf.push({ t: e.startTime, d: e.duration, b: e.blockingDuration }));
  /* The first answer: #totalbig holds a digit, has a box, and a frame has been produced since (two animation frames after the text was set). */
  let found = false;
  const confirm = n => raf0(() => {
    if (n.isConnected && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden') {
      const r = n.getBoundingClientRect();
      p.answerRect = [r.x, r.y, r.width, r.height]; p.answerText = (n.textContent || '').trim(); p.answer = performance.now();
    } else confirm(n);
  });
  const look = () => {
    if (found) return;
    const n = document.getElementById('totalbig');
    if (!n || !/\d/.test(n.textContent || '')) return;
    found = true; mo.disconnect();
    p.answerDom = performance.now();
    raf0(() => confirm(n));
  };
  const mo = new MutationObserver(look);
  mo.observe(document, { subtree: true, childList: true, characterData: true });
}

/* A fixed piece of main-thread work, timed (the median of five loops of about 40 ms unthrottled): what the CPU throttle did to it is the ratio of the
   time before and after. The throttle works by pausing the thread in slices, so a single short loop can fall wholly between two pauses; the median
   of several is the fair read. */
const WORKLOAD = () => {
  const t = [];
  for (let rep = 0; rep < 5; rep++) {
    const t0 = performance.now(); let s = 0;
    for (let i = 1; i < 1.5e6; i++) s += Math.sqrt(i) * Math.sin(i);
    t.push(performance.now() - t0 + (s === 42 ? 1 : 0));
  }
  return t.sort((a, b) => a - b)[2];
};

/* ---- small helpers --------------------------------------------------------------------------------------------------------------------- */
const sum = a => a.reduce((s, x) => s + x, 0);
const finite = a => a.filter(x => typeof x === 'number' && Number.isFinite(x));
function median(a) {
  a = finite(a).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = ['document', 'script', 'stylesheet', 'font', 'image', 'fetch', 'other'];
const TYPE_LABEL = { document: 'document', script: 'script', stylesheet: 'stylesheet', font: 'font', image: 'image', fetch: 'fetch / xhr', other: 'other' };
const typeOf = t => ({ Document: 'document', Script: 'script', Stylesheet: 'stylesheet', Font: 'font', Image: 'image', Fetch: 'fetch', XHR: 'fetch' })[t] || 'other';

/* ---- one run of one page --------------------------------------------------------------------------------------------------------------- */
async function measureOnce(target, srv) {
  const { chromium } = H.playwright({ net: 'open', testFlag: false });      // 'open': no route is installed; no test flag: the page as a visitor gets it
  const browser = await chromium.launch({ args: H.GL_ARGS.concat(['--host-resolver-rules=' + srv.resolverRules()]) });
  const info = { chromium: browser.version(), warnings: [] };
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'Asia/Bangkok', colorScheme: 'light',
      reducedMotion: 'no-preference', ignoreHTTPSErrors: true, serviceWorkers: 'block'
    });
    await ctx.addInitScript(RECORDER);
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    const errs = [];
    page.on('pageerror', e => errs.push(String((e && e.message) || e)));
    page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });

    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Performance.enable');
    /* the requests, as the browser reports them */
    const reqs = new Map();
    let lastNet = Date.now(), inflight = 0;
    cdp.on('Network.requestWillBeSent', e => {
      if (e.redirectResponse && reqs.has(e.requestId)) { reqs.delete(e.requestId); inflight--; }
      reqs.set(e.requestId, { url: e.request.url, type: e.type, wall: e.wallTime * 1000, mono0: e.timestamp * 1000, end: null, status: null, enc: null, failed: null, cached: false, done: false });
      inflight++; lastNet = Date.now();
    });
    cdp.on('Network.requestServedFromCache', e => { const r = reqs.get(e.requestId); if (r) r.cached = true; });
    cdp.on('Network.responseReceived', e => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.proto = e.response.protocol; } });
    cdp.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r && !r.done) { r.done = true; r.enc = e.encodedDataLength; r.end = r.wall + (e.timestamp * 1000 - r.mono0); inflight--; lastNet = Date.now(); } });
    cdp.on('Network.loadingFailed', e => { const r = reqs.get(e.requestId); if (r && !r.done) { r.done = true; r.failed = e.errorText; r.end = r.wall + (e.timestamp * 1000 - r.mono0); inflight--; lastNet = Date.now(); } });

    /* the main thread's slowdown, measured: a fixed loop on a blank page before the throttle is on, on the blank page with it on, and (below) on the
       loaded page once it has settled, which also shows that the throttle survived the navigation to another process */
    await page.goto('about:blank');
    const cal0 = await page.evaluate(WORKLOAD);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CFG.cpu });
    const calBlank = await page.evaluate(WORKLOAD);
    if (NETS[CFG.net]) {
      const n = NETS[CFG.net];
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: n.latency, downloadThroughput: n.down, uploadThroughput: n.up });
    }
    srv.take(); reqs.clear(); inflight = 0;

    /* ---- the load ---- */
    const wall0 = Date.now();
    await page.goto(srv.origin + '/', { waitUntil: 'commit', timeout: CFG.timeout });
    try { await page.waitForFunction(() => window.__p && window.__p.answer !== null, null, { timeout: CFG.timeout, polling: 100 }); }
    catch (e) { throw new Error('the first answer (#totalbig holding a number) never appeared within ' + CFG.timeout / 1000 + ' s' + (errs.length ? '; page errors: ' + errs.slice(0, 2).join(' | ').slice(0, 200) : '')); }
    const answer = await page.evaluate(() => window.__p.answer);
    info.answerWallMs = Date.now() - wall0;
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    /* the window of TBT and the load's long tasks ends 2 s after the answer */
    await page.waitForFunction(t => performance.now() >= t, answer + 2000, { timeout: CFG.timeout, polling: 100 });

    /* what blocked the first paint: Chrome's own flag on each resource, and the document's own scripts */
    const blocking = await page.evaluate(() => {
      const rt = performance.getEntriesByType('resource').filter(e => e.renderBlockingStatus === 'blocking').map(e => ({ url: e.name, kind: e.initiatorType }));
      const scripts = [...document.querySelectorAll('script[src]')].map(s => ({ url: s.src, module: s.type === 'module', sync: s.type !== 'module' && !s.async && !s.defer && !s.noModule, head: !!s.closest('head') }));
      return { rt, scripts };
    });

    /* settle: nothing in flight for 1.5 s, and at least 6.5 s after the answer (the page's own idle request gives up waiting at 4 s) */
    const settleDeadline = Date.now() + 60000;
    for (;;) {
      const now = await page.evaluate(() => performance.now());
      if (inflight <= 0 && Date.now() - lastNet >= 1500 && now >= answer + 6500) break;
      if (Date.now() > settleDeadline) { info.warnings.push('the network was still busy 60 s after the answer'); break; }
      await sleep(250);
    }
    const settleEnd = await page.evaluate(() => performance.now());
    const cal1 = await page.evaluate(WORKLOAD);
    info.throttle = { cal0, calBlank, cal1, blank: calBlank / cal0, ratio: cal1 / cal0 };
    if (CFG.cpu > 1 && calBlank / cal0 < CFG.cpu * 0.6) info.warnings.push('CPU throttle x' + CFG.cpu + ' slowed a fixed loop on a blank page only x' + (calBlank / cal0).toFixed(2));
    if (CFG.cpu > 1 && cal1 / cal0 < CFG.cpu * 0.6) info.warnings.push('CPU throttle x' + CFG.cpu + ' slowed a fixed loop on the loaded page only x' + (cal1 / cal0).toFixed(2));
    const snapshot = [...reqs.values()].map(r => Object.assign({}, r));
    const served = srv.take();

    /* ---- clock at its top rate ---- */
    const driver = await page.evaluate(() => {
      const play = document.getElementById('tpplay'), rate = document.getElementById('tprate');
      return { play: !!play, rate: !!rate, label: play ? play.getAttribute('aria-label') : null };
    });
    if (!driver.play || !driver.rate) throw new Error('#tpplay / #tprate are not on the page: the transport cannot be driven');
    if (driver.label !== 'Pause') await page.click('#tpplay');
    const rateSet = await page.evaluate(() => {
      const r = document.getElementById('tprate');
      r.value = r.max;
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return { value: r.value, label: (document.getElementById('tpratev') || {}).textContent || '' };
    });
    info.rate = rateSet.label.trim();
    const metric = async () => {
      const t = await page.evaluate(() => performance.now());
      const { metrics } = await cdp.send('Performance.getMetrics');
      const m = {}; for (const x of metrics) m[x.name] = x.value;
      return { t, ts: m.Timestamp, task: m.TaskDuration, script: m.ScriptDuration, layout: m.LayoutDuration, style: m.RecalcStyleDuration };
    };
    const idx0 = await page.evaluate(() => +document.getElementById('time').value);
    await sleep(300);                                                                  // the rate change has landed; the window starts from here
    const pA = await metric();
    await sleep(CFG.play);
    const pB = await metric();
    const idx1 = await page.evaluate(() => +document.getElementById('time').value);
    info.clockAdvanced = idx1 - idx0;
    if (!(idx1 !== idx0)) info.warnings.push('the clock did not advance while playing (#time stayed at ' + idx0 + ')');

    /* ---- clock paused, left alone ---- */
    await page.click('#tpplay');
    await page.mouse.move(2, 2);
    const paused = await page.evaluate(() => document.getElementById('tpplay').getAttribute('aria-label'));
    if (paused !== 'Play') info.warnings.push('the play button did not say Play after the pause (' + paused + ')');
    await sleep(2500);
    const iA = await metric();
    await sleep(CFG.idle);
    const iB = await metric();

    /* ---- everything the page recorded ---- */
    const p = await page.evaluate(() => JSON.parse(JSON.stringify(window.__p)));
    info.errors = errs;
    info.canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
    const m = compute({ target, srv, p, answer, settleEnd, timeOrigin, snapshot, served, blocking, pA, pB, iA, iB, info });
    info.crosscheck = crosscheck(srv, snapshot, served);
    info.reqs = snapshot.filter(r => !/^(data|blob):/.test(r.url)).map(r => ({ url: r.url.replace(srv.origin, ''), type: r.type, startMs: Math.round(r.wall - timeOrigin), afterAnswerMs: Math.round(r.wall - timeOrigin - answer), endAfterAnswerMs: r.end === null ? null : Math.round(r.end - timeOrigin - answer), status: r.status, bytes: r.enc, gz: r.failed ? null : gzOf(srv, r), failed: r.failed, cached: r.cached })).sort((a, b) => a.startMs - b.startMs);
    info.p = { fcp: p.fcp, fp: p.fp, lcp: p.lcp.slice(-3), answerRect: p.answerRect, answerText: p.answerText, answerDom: p.answerDom, errors: p.errors };
    await ctx.close();
    return { m, info };
  } finally {
    await browser.close().catch(() => { /* gone already */ });
  }
}

/* what the browser says it fetched against what the server says it sent: a request one side has and the other has not is a measurement hole */
function crosscheck(srv, snapshot, served) {
  const own = snapshot.filter(r => !r.cached && !r.failed && r.url.startsWith(srv.origin + '/') && !/^data:|^blob:/.test(r.url));
  const mine = served.filter(s => !srv.mockHosts.includes(s.host));
  const third = snapshot.filter(r => !r.cached && !r.failed && srv.mockHosts.includes(new URL(r.url).hostname));
  const thirdServed = served.filter(s => srv.mockHosts.includes(s.host));
  return { firstParty: { browser: own.length, server: mine.length }, thirdParty: { browser: third.length, server: thirdServed.length } };
}

/* a request's weight in the plan's unit: the body as gzip level 9 (compressible types) or as it is; the browser's own transferred bytes when the
   server does not know the file (a 404, the /api 503) */
function gzOf(srv, r) {
  const u = new URL(r.url);
  const own = u.origin === srv.origin;
  const s = r.status && r.status < 400 ? srv.sizeOf(own ? '127.0.0.1' : u.hostname, u.pathname) : null;
  return s ? s.gz : (r.enc || 0);
}

function compute(c) {
  const { srv, p, answer, settleEnd, timeOrigin, snapshot, blocking, info } = c;
  const m = {};
  const third = r => new URL(r.url).origin !== srv.origin;
  const good = snapshot.filter(r => !/^(data|blob):/.test(r.url));
  const refused = good.filter(r => r.failed);
  const counted = good.filter(r => !r.failed && !r.cached && r.done);
  m.refused = refused.length;
  info.unfinished = good.filter(r => !r.done).length;
  /* First load: requests already under way before the first answer's number was written to the page (5 ms of margin, for what the answer's own commit starts in
     the same task: the scene, the cache client, the transmitters) and finished before it was painted. */
  const answerAbs = timeOrigin + answer, answerDomAbs = timeOrigin + p.answerDom;
  const scopes = { first: counted.filter(r => r.wall < answerDomAbs - 5 && r.end !== null && r.end <= answerAbs), all: counted };
  for (const [scope, list] of Object.entries(scopes)) {
    const addGroup = (name, rs) => {
      m[scope + '.' + name + '.n'] = rs.length;
      m[scope + '.' + name + '.n3'] = rs.filter(third).length;
      m[scope + '.' + name + '.br'] = sum(rs.map(r => r.enc || 0));
      m[scope + '.' + name + '.br3'] = sum(rs.filter(third).map(r => r.enc || 0));
      m[scope + '.' + name + '.gz'] = sum(rs.map(r => gzOf(srv, r)));
      m[scope + '.' + name + '.gz3'] = sum(rs.filter(third).map(r => gzOf(srv, r)));
    };
    for (const t of TYPES) addGroup(t, list.filter(r => typeOf(r.type) === t));
    addGroup('total', list);
    m[scope + '.gzNoImg'] = sum(list.filter(r => typeOf(r.type) !== 'image').map(r => gzOf(srv, r)));
    m[scope + '.brNoImg'] = sum(list.filter(r => typeOf(r.type) !== 'image').map(r => r.enc || 0));
  }
  /* timings */
  m.answer = answer;
  m.answerDom = p.answerDom;
  m.fcp = p.fcp;
  const lcp = p.lcp.filter(e => e.t <= settleEnd);
  m.lcp = lcp.length ? lcp[lcp.length - 1].t : null;
  m.cls = sum(p.cls.filter(e => e.t <= settleEnd).map(e => e.v));
  m.firstDraw = p.firstDraw;
  const wEnd = answer + 2000;
  const ltW = p.lt.filter(e => e.t < wEnd);
  m.ltCountW = ltW.length; m.ltSumW = sum(ltW.map(e => e.d));
  const ltAll = p.lt.filter(e => e.t < settleEnd);
  m.ltCountAll = ltAll.length; m.ltSumAll = sum(ltAll.map(e => e.d));
  m.tbt = p.fcp === null ? null : sum(p.lt.filter(e => e.t + e.d > p.fcp && e.t < wEnd).map(e => {
    const dur = e.t + e.d - Math.max(e.t, p.fcp);
    return Math.max(0, dur - 50);
  }));
  /* blocking */
  const rt = blocking.rt.map(e => Object.assign({}, e, { tp: new URL(e.url).origin !== srv.origin }));
  const syncScripts = blocking.scripts.filter(s => s.sync).map(s => ({ url: s.url, tp: new URL(s.url).origin !== srv.origin }));
  const rtCss = rt.filter(e => e.kind === 'link' || e.kind === 'css');
  const rtJs = rt.filter(e => e.kind === 'script');
  const syncUrls = new Set(rtJs.map(e => e.url).concat(syncScripts.map(s => s.url)));
  const jsBlock = [...syncUrls].map(u => ({ url: u, tp: new URL(u).origin !== srv.origin }));
  const mods = blocking.scripts.filter(s => s.module).map(s => ({ url: s.url, tp: new URL(s.url).origin !== srv.origin }));
  m.blockCss = rtCss.length; m.blockCss3 = rtCss.filter(e => e.tp).length;
  m.blockJs = jsBlock.length; m.blockJs3 = jsBlock.filter(e => e.tp).length;
  m.blockMod = mods.length; m.blockMod3 = mods.filter(e => e.tp).length;
  /* the frames */
  const phase = (a, b) => {
    const inW = t => t >= a.t && t < b.t;
    const secs = (b.t - a.t) / 1000, cpuSecs = b.ts - a.ts;
    const frames = p.frames.filter(inW).length, ticks = p.ticks.filter(inW).length;
    const loaf = p.loaf.filter(e => inW(e.t)), lt = p.lt.filter(e => inW(e.t));
    const busy = (b.task - a.task) * 1000;
    return {
      fps: frames / secs, raf: ticks / secs, busyPerSec: busy / cpuSecs, busyPct: 100 * (b.task - a.task) / cpuSecs,
      perFrame: frames > 0 ? busy / frames : (ticks > 0 ? busy / ticks : null), frames, ticks,
      scriptPerSec: (b.script - a.script) * 1000 / cpuSecs, layoutPerSec: (b.layout - a.layout) * 1000 / cpuSecs, stylePerSec: (b.style - a.style) * 1000 / cpuSecs,
      loaf: loaf.length, loafSum: sum(loaf.map(e => e.d)), lt: lt.length, ltSum: sum(lt.map(e => e.d)), secs
    };
  };
  for (const [k, ph] of [['play', phase(c.pA, c.pB)], ['idle', phase(c.iA, c.iB)]]) for (const [n, v] of Object.entries(ph)) m[k + '.' + n] = v;
  if (!(m['play.frames'] > 0)) info.warnings.push('the globe drew no WebGL frame while playing (is there a WebGL context? canvases: ' + info.canvases + ')');
  m.throttle = info.throttle.ratio;
  m.throttleBlank = info.throttle.blank;
  m.pageErrors = info.errors.length;
  return m;
}

/* ---- the table ------------------------------------------------------------------------------------------------------------------------- */
const fmt = {
  ms: x => x === null || x === undefined ? 'n/a' : (Math.abs(x) >= 1000 ? (x / 1000).toFixed(2) + ' s' : Math.round(x) + ' ms'),
  kB: x => x === null || x === undefined ? 'n/a' : (x / 1000).toFixed(1) + ' kB',
  n1: x => x === null || x === undefined ? 'n/a' : (Math.round(x * 10) / 10).toString(),
  n3: x => x === null || x === undefined ? 'n/a' : x.toFixed(3),
  int: x => x === null || x === undefined ? 'n/a' : String(Math.round(x))
};
const tp = (n, n3) => n3 ? n + ' (' + n3 + ' third-party)' : String(n);
function typeRow(scope, t) {
  return {
    label: '  ' + TYPE_LABEL[t],
    cell: m => { const n = m[scope + '.' + t + '.n']; return n ? n + (m[scope + '.' + t + '.n3'] ? ' (' + m[scope + '.' + t + '.n3'] + ' 3p)' : '') + ' / ' + fmt.kB(m[scope + '.' + t + '.br']) : '-'; },
    num: m => m[scope + '.' + t + '.br'], unit: 'kB', hideIfZero: [scope + '.' + t + '.n']
  };
}
function rows() {
  const R = [];
  const head = s => R.push({ head: s });
  head('Loading (the first answer is #totalbig holding a number, painted)');
  R.push({ label: 'first answer on screen', cell: m => fmt.ms(m.answer), num: m => m.answer, unit: 'ms' });
  R.push({ label: 'first contentful paint (FCP)', cell: m => fmt.ms(m.fcp), num: m => m.fcp, unit: 'ms', target: '<= 1.5 s', check: m => m.fcp !== null && m.fcp <= BUDGET.fcp });
  R.push({ label: 'largest contentful paint (LCP)', cell: m => fmt.ms(m.lcp), num: m => m.lcp, unit: 'ms', target: '<= 2.5 s', check: m => m.lcp !== null && m.lcp <= BUDGET.lcp });
  R.push({ label: 'total blocking time (FCP to answer + 2 s)', cell: m => fmt.ms(m.tbt), num: m => m.tbt, unit: 'ms', target: '<= 200 ms', check: m => m.tbt !== null && m.tbt <= BUDGET.tbt });
  R.push({ label: 'long tasks, start to answer + 2 s', cell: m => fmt.int(m.ltCountW) + ' / ' + fmt.ms(m.ltSumW), num: m => m.ltSumW, unit: 'ms' });
  R.push({ label: 'long tasks, start to network quiet', cell: m => fmt.int(m.ltCountAll) + ' / ' + fmt.ms(m.ltSumAll), num: m => m.ltSumAll, unit: 'ms' });
  R.push({ label: 'layout shift (CLS)', cell: m => fmt.n3(m.cls), num: m => m.cls, unit: '', target: '<= 0.05', check: m => m.cls <= BUDGET.cls });
  R.push({ label: 'globe first drawn (first WebGL draw call)', cell: m => fmt.ms(m.firstDraw), num: m => m.firstDraw, unit: 'ms' });
  head('Blocking the first paint');
  R.push({ label: 'render-blocking stylesheets', cell: m => tp(m.blockCss, m.blockCss3), num: m => m.blockCss, unit: '', target: '<= 1', check: m => m.blockCss <= BUDGET.blockCss });
  R.push({ label: 'parser-blocking scripts (classic, sync)', cell: m => tp(m.blockJs, m.blockJs3), num: m => m.blockJs, unit: '', target: '0', check: m => m.blockJs <= BUDGET.blockJs });
  R.push({ label: 'entry module scripts', cell: m => tp(m.blockMod, m.blockMod3), num: m => m.blockMod, unit: '', target: '<= 1', check: m => m.blockMod <= BUDGET.blockModule });
  R.push({ label: 'third-party among them', cell: m => String(m.blockCss3 + m.blockJs3 + m.blockMod3), num: m => m.blockCss3 + m.blockJs3 + m.blockMod3, unit: '', target: '0', check: m => m.blockCss3 + m.blockJs3 + m.blockMod3 <= BUDGET.blockThirdParty });
  head('First load: under way before the first answer appeared, finished before it was painted (count / transferred, brotli)');
  for (const t of TYPES) R.push(typeRow('first', t));
  R.push({ label: 'total', cell: m => tp(m['first.total.n'], m['first.total.n3']) + ' / ' + fmt.kB(m['first.total.br']), num: m => m['first.total.br'], unit: 'kB' });
  R.push({ label: '  of which third-party', cell: m => m['first.total.n3'] + ' / ' + fmt.kB(m['first.total.br3']), num: m => m['first.total.br3'], unit: 'kB' });
  R.push({ label: 'gzip-9, images (globe textures) left out', cell: m => fmt.kB(m['first.gzNoImg']), num: m => m['first.gzNoImg'], unit: 'kB', target: '<= 275 kB', check: m => m['first.gzNoImg'] <= BUDGET.firstLoadGz });
  R.push({ label: 'brotli (as sent), images left out', cell: m => fmt.kB(m['first.brNoImg']), num: m => m['first.brNoImg'], unit: 'kB' });
  head('Whole visit, until the network is quiet (count / transferred, brotli)');
  R.push({ label: 'requests', cell: m => tp(m['all.total.n'], m['all.total.n3']) + ' / ' + fmt.kB(m['all.total.br']), num: m => m['all.total.br'], unit: 'kB' });
  R.push({ label: '  of which images (new: its own textures; old: from GIBS, refused here)', cell: m => m['all.image.n'] + ' / ' + fmt.kB(m['all.image.br']), num: m => m['all.image.br'], unit: 'kB' });
  R.push({ label: '  of which scripts', cell: m => m['all.script.n'] + ' / ' + fmt.kB(m['all.script.br']), num: m => m['all.script.br'], unit: 'kB' });
  R.push({ label: 'refused by the profile (not counted)', cell: m => fmt.int(m.refused), num: null });
  head('Clock at 3600x, ' + CFG.play / 1000 + ' s');
  R.push({ label: 'frames the globe draws per second', cell: m => fmt.n1(m['play.fps']), num: m => m['play.fps'], unit: '' });
  R.push({ label: 'requestAnimationFrame callbacks per second', cell: m => fmt.n1(m['play.raf']), num: m => m['play.raf'], unit: '' });
  R.push({ label: 'main thread busy, ms per second', cell: m => fmt.int(m['play.busyPerSec']) + ' ms  (' + fmt.int(m['play.busyPct']) + ' %)', num: m => m['play.busyPerSec'], unit: 'ms' });
  R.push({ label: 'main thread busy, ms per frame drawn', cell: m => fmt.n1(m['play.perFrame']) + ' ms', num: m => m['play.perFrame'], unit: 'ms' });
  R.push({ label: '  of which script / layout / style, ms per second', cell: m => fmt.int(m['play.scriptPerSec']) + ' / ' + fmt.int(m['play.layoutPerSec']) + ' / ' + fmt.int(m['play.stylePerSec']), num: null });
  R.push({ label: 'slow frames (long animation frames > 50 ms)', cell: m => fmt.int(m['play.loaf']) + ' / ' + fmt.ms(m['play.loafSum']), num: m => m['play.loaf'], unit: '' });
  head('Clock paused, page left alone, ' + CFG.idle / 1000 + ' s');
  R.push({ label: 'frames the globe draws per second', cell: m => fmt.n1(m['idle.fps']), num: m => m['idle.fps'], unit: '' });
  R.push({ label: 'requestAnimationFrame callbacks per second', cell: m => fmt.n1(m['idle.raf']), num: m => m['idle.raf'], unit: '' });
  R.push({ label: 'main thread busy, ms per second', cell: m => fmt.int(m['idle.busyPerSec']) + ' ms  (' + fmt.n1(m['idle.busyPct']) + ' %)', num: m => m['idle.busyPerSec'], unit: 'ms' });
  R.push({ label: '  of which script / layout / style, ms per second', cell: m => fmt.int(m['idle.scriptPerSec']) + ' / ' + fmt.int(m['idle.layoutPerSec']) + ' / ' + fmt.int(m['idle.stylePerSec']), num: null });
  return R;
}
function change(l, n, unit) {
  if (l === null || n === null || l === undefined || n === undefined || !Number.isFinite(l) || !Number.isFinite(n)) return '';
  const d = n - l;
  if (Math.abs(d) < 1e-9) return 'same';
  const pct = l !== 0 ? ' (' + (d > 0 ? '+' : '-') + Math.round(Math.abs(d / l) * 100) + '%)' : '';
  const abs = unit === 'ms' ? fmt.ms(Math.abs(d)) : unit === 'kB' ? fmt.kB(Math.abs(d)) : (Math.abs(d) < 10 ? (Math.round(Math.abs(d) * 100) / 100).toString() : Math.round(Math.abs(d)).toString());
  return (d > 0 ? '+' : '-') + abs + pct;
}

/* ---- main ------------------------------------------------------------------------------------------------------------------------------ */
(async () => {
  const servers = {}, runs = {};
  for (const t of TARGETS) { servers[t] = await PS.start({ root: H.TARGETS[t], http: CFG.http }); runs[t] = []; }
  let chromium = null, failed = 0;
  process.on('SIGINT', () => { for (const t of TARGETS) servers[t].close(); finish(130); });
  say('perf: ' + TARGETS.join(' + ') + ', ' + CFG.runs + ' run(s) each, CPU x' + CFG.cpu + ', network ' + CFG.net + ' (a fresh browser per run; this takes a while)');
  try {
    for (let i = 0; i < CFG.runs; i++) {
      for (const t of TARGETS) {
        const t0 = Date.now();
        try {
          const r = await measureOnce(t, servers[t]);
          chromium = chromium || r.info.chromium;
          runs[t].push(r);
          say('  run ' + (i + 1) + '/' + CFG.runs + ' ' + t.padEnd(6) + ' answer ' + fmt.ms(r.m.answer) + '  FCP ' + fmt.ms(r.m.fcp) + '  LCP ' + fmt.ms(r.m.lcp) + '  TBT ' + fmt.ms(r.m.tbt) +
            '  first load ' + fmt.kB(r.m['first.total.br']) + '  play ' + fmt.n1(r.m['play.fps']) + ' fps  idle ' + fmt.n1(r.m['idle.fps']) + ' fps  (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
          for (const w of r.info.warnings) say('    warning: ' + w);
        } catch (e) {
          failed++;
          say('  run ' + (i + 1) + '/' + CFG.runs + ' ' + t.padEnd(6) + ' FAILED: ' + String((e && e.message) || e).split(/\r?\n/)[0].slice(0, 300));
          runs[t].push({ error: String((e && e.message) || e) });
        }
      }
    }
  } finally {
    for (const t of TARGETS) await servers[t].close();
  }
  const good = {};
  for (const t of TARGETS) {
    good[t] = runs[t].filter(r => r.m);
    if (!good[t].length) { console.error('perf.js: every run of the ' + t + ' page failed'); process.exit(2); }
  }

  /* medians, and the spread of the ones that say whether the machine was quiet */
  const med = {}, spread = {};
  for (const t of TARGETS) {
    med[t] = {}; spread[t] = {};
    for (const k of Object.keys(good[t][0].m)) {
      const vs = good[t].map(r => r.m[k]);
      med[t][k] = median(vs);
      const f = finite(vs);
      spread[t][k] = f.length ? [Math.min(...f), Math.max(...f)] : null;
    }
  }
  const NOISY_KEYS = ['answer', 'fcp', 'lcp', 'tbt', 'play.busyPerSec', 'play.fps'];
  const noisy = [];
  for (const t of TARGETS) {
    if (good[t].length < 3) continue;
    for (const k of NOISY_KEYS) {
      const s = spread[t][k], m = med[t][k];
      if (s && m && (s[1] - s[0]) / m > 0.3) { const f = /^play./.test(k) ? x => x.toFixed(1) : fmt.ms; noisy.push(t + ' ' + k + ' ' + f(s[0]) + ' to ' + f(s[1]) + ' (median ' + f(m) + ')'); }
    }
  }
  const R = rows();
  const newM = med.new, checks = [];
  if (newM) for (const r of R) if (r.check) checks.push({ label: r.label.trim(), target: r.target, value: r.cell(newM), ok: !!r.check(newM) });

  const cpuModel = (os.cpus()[0] || {}).model || 'unknown cpu';
  let pwVersion = '?'; try { pwVersion = require(path.join(process.env.PW_PATH || 'playwright', 'package.json')).version; } catch (e) { try { pwVersion = require('playwright/package.json').version; } catch (e2) { /* unknown */ } }
  const thr = {}; for (const t of TARGETS) thr[t] = med[t].throttle;
  const meta = {
    when: new Date().toISOString(), cpu: cpuModel.trim() + ' (' + os.cpus().length + ' threads)', node: process.version, chromium, playwright: pwVersion, platform: os.platform() + ' ' + os.release(),
    config: { runs: CFG.runs, cpuThrottle: CFG.cpu, network: CFG.net, networkProfile: NETS[CFG.net], http: CFG.http, viewport: '1440x900 @1', locale: 'en-US', timezone: 'Asia/Bangkok', play: CFG.play / 1000 + ' s at 3600x', idle: CFG.idle / 1000 + ' s paused' },
    effectiveCpuSlowdown: thr, targets: TARGETS, builds: Object.fromEntries(TARGETS.map(t => [t, H.TARGETS[t]])), failedRuns: failed, noisy
  };
  const out = { meta, budget: BUDGET, median: med, spread, checks, runs: Object.fromEntries(TARGETS.map(t => [t, runs[t]])) };
  try { fs.writeFileSync(CFG.out, JSON.stringify(out, null, 1)); } catch (e) { say('perf.js: could not write ' + CFG.out + ': ' + e.message); }

  if (has('json')) console.log(JSON.stringify(out, null, 1));
  else print(R, meta, med, spread, good, noisy);
  if (CFG.assert) {
    const bad = checks.filter(c => !c.ok);
    say('\nassert (new page vs the plan\'s targets, defined for CPU x4 + slow 4G; this run: CPU x' + CFG.cpu + ', network ' + CFG.net + '): ' + (bad.length ? bad.length + ' missed' : 'all met'));
    for (const c of bad) say('  MISSED  ' + c.label + ': ' + c.value + ' (target ' + c.target + ')');
    if (!newM) { say('  --assert needs the new page (--target new or both)'); finish(2); return; }
    if (bad.length) { finish(1); return; }
  }
  finish(process.exitCode || 0);
})().catch(e => { console.error(e && e.stack || e); finish(2); });

/* leave once stdout and stderr are written (on Windows a pipe is asynchronous, and process.exit() would cut a long table short) */
function finish(code) { process.stderr.write('', () => process.stdout.write('', () => process.exit(code))); }

function header(meta, good) {
  const c = meta.config, n = c.networkProfile;
  const L = [];
  L.push('Perf: ' + meta.targets.join(' vs ') + '. Median of ' + c.runs + ' run' + (c.runs > 1 ? 's' : '') + ' per page, a fresh browser each' + (meta.failedRuns ? ' (' + meta.failedRuns + ' run(s) FAILED)' : '') + '.');
  L.push('Machine: ' + meta.cpu + ', Node ' + meta.node + ', Chromium ' + meta.chromium + ' (Playwright ' + meta.playwright + '), ' + meta.platform + '.');
  L.push('Profile: CPU x' + c.cpuThrottle + ' (CDP' + (c.cpuThrottle > 1 ? '; a fixed loop measured ' + meta.targets.map(t => t + ' x' + (meta.effectiveCpuSlowdown[t] || 0).toFixed(1)).join(', ') : '') + '), network ' + (n ? n.label + ' (CDP)' : 'not throttled') +
    ', ' + c.viewport + ', ' + c.locale + ', ' + c.timezone + ', real clock, software WebGL (SwiftShader).');
  L.push('Served: HTTPS + HTTP/' + (c.http === 2 ? '2' : '1.1') + ', text as brotli (transferred bytes are the browser\'s own count, headers included); "gzip-9" is the plan\'s unit, from the files, as verify-visitor counts.');
  L.push('Third parties: the old page\'s cdnjs (three r128, satellite.js) and Google Fonts are local stand-ins on a real socket, throttled like everything else and counted by their real hosts ("3p");');
  L.push('  the fonts are the Fontsource files, not Google\'s bytes. CelesTrak, its mirror, GIBS and Open-Meteo do not resolve and /api/* answers 503: the numbers are about the page, not about CelesTrak.');
  L.push('Not measured: real DNS/TCP/TLS and RTT beyond the 150 ms per request, a phone GPU, the CPU throttle on workers or the GPU process (it slows the main thread only), and the old page\'s globe imagery');
  L.push('  from NASA GIBS (refused here, as in the suites: its visit is lighter than a real one by that image, and its globe is drawn without that image).');
  return L;
}
function print(R, meta, med, spread, good, noisy) {
  const T = meta.targets, hasBoth = T.length === 2;
  const cols = [['metric'], ...T.map(t => [t])];
  if (hasBoth) cols.push(['change']);
  if (T.includes('new')) cols.push(['target (new)']);
  const body = [];
  for (const r of R) {
    if (r.head) { body.push({ head: r.head }); continue; }
    if (r.hideIfZero && T.every(t => !med[t][r.hideIfZero[0]])) continue;
    const row = [r.label];
    for (const t of T) row.push(r.cell(med[t]));
    if (hasBoth) row.push(r.num ? change(r.num(med.legacy), r.num(med.new), r.unit) : '');
    if (T.includes('new')) row.push((r.target ? r.target + (r.check ? (r.check(med.new) ? '  ok' : '  MISSED') : '') : ''));
    body.push({ row });
  }
  if (has('md')) {
    console.log(header(meta, good).map(l => '> ' + l).join('\n') + '\n');
    console.log('| ' + cols.map(c => c[0]).join(' | ') + ' |');
    console.log('|' + cols.map((c, i) => i ? '---:' : '---').join('|') + '|');
    for (const b of body) console.log(b.head ? '| **' + b.head + '** |' + ' |'.repeat(cols.length - 1) : '| ' + b.row.map(x => String(x).replace(/\|/g, '/')).join(' | ') + ' |');
    return;
  }
  const w = cols.map((c, i) => Math.max(c[0].length, ...body.filter(b => b.row).map(b => String(b.row[i] === undefined ? '' : b.row[i]).length)));
  const line = a => a.map((x, i) => i === 0 ? String(x).padEnd(w[i]) : String(x).padStart(w[i])).join('   ');
  console.log(header(meta, good).join('\n') + '\n');
  console.log(line(cols.map(c => c[0])));
  console.log('-'.repeat(line(cols.map(c => c[0])).length));
  for (const b of body) console.log(b.head ? '\n' + b.head : line(b.row));
  console.log('\nRun to run spread (min - max) of the numbers that tell whether the machine was quiet:');
  for (const t of T) {
    const s = k => spread[t][k] ? fmt.ms(spread[t][k][0]) + ' - ' + fmt.ms(spread[t][k][1]) : 'n/a';
    console.log('  ' + t.padEnd(6) + ' answer ' + s('answer') + ' | FCP ' + s('fcp') + ' | LCP ' + s('lcp') + ' | TBT ' + s('tbt') + ' | play busy ' + (spread[t]['play.busyPerSec'] ? Math.round(spread[t]['play.busyPerSec'][0]) + ' - ' + Math.round(spread[t]['play.busyPerSec'][1]) + ' ms/s' : 'n/a'));
  }
  for (const t of T) {
    const cc = good[t].map(r => r.info.crosscheck).filter(Boolean);
    const off = cc.filter(x => x.firstParty.browser !== x.firstParty.server || x.thirdParty.browser !== x.thirdParty.server);
    if (off.length) console.log('  note: ' + t + ' ' + off.length + ' run(s): the browser and the server disagree about the number of requests (first party browser/server ' + off[0].firstParty.browser + '/' + off[0].firstParty.server + ', third party ' + off[0].thirdParty.browser + '/' + off[0].thirdParty.server + ')');
    const warns = [...new Set(good[t].flatMap(r => r.info.warnings))];
    for (const x of warns) console.log('  warning (' + t + '): ' + x);
    const errs = [...new Set(good[t].flatMap(r => r.info.errors || []))];
    if (errs.length) console.log('  page errors (' + t + '): ' + errs.slice(0, 3).join(' | ').slice(0, 300));
  }
  if (noisy.length) console.log('\nNOISY: ' + noisy.join('; ') + '. The machine was probably busy: run again when it is quiet (more runs do not fix a busy machine).');
  console.log('\nFull numbers of every run: ' + path.relative(process.cwd(), CFG.out));
}
