/*
 * The Snap button of the AR view and of the radar view: one picture of what the screen shows, saved or shared, and nothing else.
 *
 * verify-ar.js holds that the AR view "never draws the camera's picture into a canvas, reads it back, captures or records it". Snap is the one
 * exception, and this suite is what keeps it one: the picture is drawn once, into a canvas of snap.ts's own, when the reader presses the button,
 * the view's own canvases (#ar-sky, #ar-radar) never hold it, and nothing sends it anywhere. What is asserted here is written out, not read from
 * snap.ts: the file's name, its type and its bytes, its size in pixels, the colours at points of it, the words of the caption (caught at
 * fillText) and the band they sit in, and the census of everything the page did with a picture.
 *
 *  - The button: in both views, disabled until the first reading (and after a failure), enabled while running or finding north, disabled
 *    while a snap is being made (also while the share sheet is open) and enabled again after.
 *  - The AR view with a live camera: one download, named sattrack-sky-<site>-<UTC instant of the page's clock>.jpg, a JPEG of the screen's size
 *    in device pixels with the camera's colour over the whole frame (object-fit: cover), the sky over it, the blue crosshair on the radar's
 *    arm and a caption band of three lines along the foot. The status line says where it went.
 *  - The census: one snap is exactly one drawImage(video) and nothing else (a second adds one more); a session that never presses Snap has an
 *    empty census; the page makes no request, stores no image, makes no database, and its object URL is made once and revoked after 30 s,
 *    the anchor it clicked removed from the page at once.
 *  - The share sheet: where navigator.share takes a file, one call with a JPEG File and no download ("Picture shared."); a closed sheet
 *    (AbortError) is a silent cancel, a refusal (NotAllowedError), canShare saying no or no canShare at all is a download.
 *  - Where the camera is not live (declined; an iPhone finding north): a PNG of the sky overlay and the radar on the dark ground.
 *  - The radar view: no camera call, a PNG named sattrack-radar-..., the radar drawn at its box over the ground #05090C, the caption in its band.
 *  - The aim in the caption (Camera / Head, remembered), the live or sim time, a site's name made safe for a file name, two taps making one
 *    file, and closing the view while a snap is being made.
 *
 * The phone's mocks (the sensors, the camera, the picture census) are read out of verify-ar.js as text and used as they are; this file adds
 * its own, SPY, which records what the page does with the network, with object URLs and with the text it draws, and puts a recording
 * navigator.share in the place of the browser's own (headless Chromium on Windows has a real one, which must never be called: the page sees
 * none unless a check puts one there).
 *
 * About 30 s on an idle machine, a minute and more while other browsers run; like the AR suite it is timing-sensitive and runs alone. It
 * drives the rebuilt page only (the old page has no Snap), and every check of it was shown able to fail: nineteen faults were put into a
 * scratch copy of the build's AR chunk in turn (the video not drawn, the sky or the radar left out, the sky canvas read back, a request made,
 * the name, the cover, the revoke, the disabled button, an AbortError taken for a refusal, the caption's third line, ...) and each was caught.
 *
 *   node verification/suites/verify-ar-snap.js           (needs playwright and a build in dist/, or GT_DIST)
 *   GT_SNAP_ONLY=A,C node verification/suites/verify-ar-snap.js      (just these parts: A live camera, B no live camera, C radar view,
 *                                                              D names, live time and closing, E no press and failures)
 *   GT_SNAP_KEEP=1 ...                                         (keeps the pictures it saved, and says where)
 *   GT_SNAP_TIMES=1 ...                                        (says how many seconds in each check came)
 */
const H = require('../lib/harness');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = H.playwright();

const SITE = H.targetRoot();
if (H.targetName() !== 'new') {
  console.log('verify-ar-snap: Snap exists only in the rebuilt page (GT_TARGET=new); the old page has nothing to check.');
  process.exit(0);
}
const RAD = Math.PI / 180;

let fails = 0, passes = 0;
const T0 = Date.now();
const chk = (name, ok, detail) => {
  if (ok) passes++; else fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + (process.env.GT_SNAP_TIMES ? '[' + ((Date.now() - T0) / 1000).toFixed(1) + '] ' : '') + name + (detail ? '   ' + detail : ''));
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const n1 = v => v.toFixed(1);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- the phone's mocks: verify-ar.js's own, read out of it as text ----------------------------------------------------------------- */
const arSrc = fs.readFileSync(path.join(__dirname, 'verify-ar.js'), 'utf8');
const mA = arSrc.indexOf('function MOCKS(){'), mB = arSrc.indexOf('\nasync function phone(');
if (mA < 0 || mB < mA) throw new Error('verify-ar.js no longer has MOCKS() followed by phone(): this suite takes the phone\'s mocks from it');
const MOCKS = eval('(' + arSrc.slice(mA, mB) + ')');

/* What the page does around the press, recorded in the page. `on` is set by the press and the records are read after it. */
function SPY() {
  const Z = window.__spy = { on: false, net: [], urls: [], revoked: [], dom: [], text: [], blobs: [] };
  Z.mark = () => { for (const k of ['net', 'urls', 'revoked', 'dom', 'text', 'blobs']) Z[k].length = 0; };
  const rec = s => { if (Z.on) Z.net.push(s); };
  const f0 = window.fetch;
  window.fetch = function (u, o) { rec('fetch ' + String(u && u.url ? u.url : u) + (o && o.body ? ' (with a body)' : '')); return f0.apply(this, arguments); };
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { rec('xhr ' + m + ' ' + u); return xo.apply(this, arguments); };
  const sb = navigator.sendBeacon;
  if (sb) navigator.sendBeacon = function (u) { rec('beacon ' + u); return sb.apply(this, arguments); };
  const WS = window.WebSocket;
  window.WebSocket = class extends WS { constructor(u, p) { rec('websocket ' + u); super(u, p); } };
  const cou = URL.createObjectURL, rou = URL.revokeObjectURL;
  URL.createObjectURL = function (b) { const u = cou.apply(this, arguments); if (Z.on) Z.urls.push({ url: u, type: b && b.type, size: b && b.size }); return u; };
  URL.revokeObjectURL = function (u) { Z.revoked.push(u); return rou.apply(this, arguments); };
  /* The anchor the page clicks, seen as it is put in and taken out (by the parent it was put in, since it is gone when this is called). */
  new MutationObserver(ms => {
    if (!Z.on) return;
    for (const m of ms) {
      for (const n of m.addedNodes) if (n.nodeType === 1 && n.tagName === 'A')
        Z.dom.push({ op: 'add', download: n.getAttribute('download'), href: String(n.getAttribute('href') || '').slice(0, 5), inView: m.target.id === 'arview' || !!(m.target.closest && m.target.closest('#arview')) });
      for (const n of m.removedNodes) if (n.nodeType === 1 && n.tagName === 'A') Z.dom.push({ op: 'remove', download: n.getAttribute('download') });
    }
  }).observe(document, { childList: true, subtree: true });
  /* The words drawn on a canvas that is not in the page (the picture's own), and what it is encoded as. */
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t) {
    if (Z.on && !this.canvas.isConnected) Z.text.push({ text: String(t), font: this.font, w: this.canvas.width, h: this.canvas.height, maxW: arguments[3] });
    return ft.apply(this, arguments);
  };
  const tb = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
    if (Z.on && !this.isConnected) Z.blobs.push({ type, q, w: this.width, h: this.height, id: this.id });
    return tb.apply(this, arguments);
  };
  /* The share sheet. Nothing of it is there until a check asks (mode 'none'); then a recording one, which answers as `mode` says. */
  const SH = window.__share = { mode: 'none', can: true, noCan: false, calls: [], canCalls: 0, release: null };
  const fake = function (d) {
    const f = d && d.files && d.files[0];
    const call = { files: d && d.files ? d.files.length : 0, isFile: f instanceof File, name: f && f.name, type: f && f.type, size: f && f.size,
                   title: d && d.title, keys: Object.keys(d || {}), head: null };
    SH.calls.push(call);
    return (f ? f.slice(0, 8).arrayBuffer().then(b => { call.head = Array.from(new Uint8Array(b)); }) : Promise.resolve()).then(() => {
      if (SH.mode === 'abort') throw new DOMException('Share canceled', 'AbortError');
      if (SH.mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
      if (SH.mode === 'hang') return new Promise(r => { SH.release = r; });
      return undefined;
    });
  };
  const can = function (d) { SH.canCalls++; return !!SH.can && !!(d && d.files && d.files.length); };
  Object.defineProperty(navigator, 'share', { configurable: true, get: () => (SH.mode === 'none' ? undefined : fake) });
  Object.defineProperty(navigator, 'canShare', { configurable: true, get: () => (SH.mode === 'none' || SH.noCan ? undefined : can) });
}

/* The decoder: a blank page of its own, so that reading a picture's pixels is not something the phone's page does. */
function DECODER() {
  window.D = {
    cv: null, g: null, w: 0, h: 0,
    async load(b64, mime) {
      const img = new Image(); img.src = 'data:' + mime + ';base64,' + b64; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      this.cv = cv; this.g = g; this.w = cv.width; this.h = cv.height;
      return { w: this.w, h: this.h };
    },
    px(pts) {
      return pts.map(([x, y]) => Array.from(this.g.getImageData(Math.max(0, Math.min(this.w - 1, Math.round(x))), Math.max(0, Math.min(this.h - 1, Math.round(y))), 1, 1).data));
    },
    /* the pixels of a rectangle within `tol` of a colour: how many, and where their centre is */
    near(rect, rgb, tol) {
      const x0 = Math.max(0, Math.round(rect[0])), y0 = Math.max(0, Math.round(rect[1])), x1 = Math.min(this.w, Math.round(rect[2])), y1 = Math.min(this.h, Math.round(rect[3]));
      const d = this.g.getImageData(x0, y0, x1 - x0, y1 - y0).data, Wd = x1 - x0;
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < d.length; i += 4)
        if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) { n++; const p = i / 4; sx += x0 + p % Wd + 0.5; sy += y0 + Math.floor(p / Wd) + 0.5; }
      return { n, x: n ? sx / n : null, y: n ? sy / n : null };
    },
    /* the pixels of a rectangle that are light (every channel at least `min`) */
    light(rect, min) {
      const x0 = Math.max(0, Math.round(rect[0])), y0 = Math.max(0, Math.round(rect[1])), x1 = Math.min(this.w, Math.round(rect[2])), y1 = Math.min(this.h, Math.round(rect[3]));
      const d = this.g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] >= min && d[i + 1] >= min && d[i + 2] >= min) n++;
      return n;
    },
    /* the first and last row of a rectangle that hold at least `n` light pixels (every channel at least `min`), or null */
    lightRows(rect, min, n) {
      const x0 = Math.max(0, Math.round(rect[0])), y0 = Math.max(0, Math.round(rect[1])), x1 = Math.min(this.w, Math.round(rect[2])), y1 = Math.min(this.h, Math.round(rect[3]));
      const d = this.g.getImageData(x0, y0, x1 - x0, y1 - y0).data, Wd = x1 - x0;
      let first = null, last = null;
      for (let y = 0; y < y1 - y0; y++) {
        let c = 0;
        for (let x = 0; x < Wd; x++) { const i = (y * Wd + x) * 4; if (d[i] >= min && d[i + 1] >= min && d[i + 2] >= min) c++; }
        if (c >= n) { if (first === null) first = y0 + y; last = y0 + y; }
      }
      return first === null ? null : { first, last };
    }
  };
}

/* ---- the colours the checks know, written out ----------------------------------------------------------------------------------------- */
const CAMERA = [0x1b, 0x2a, 0x33];             // the mock camera's stream
const GROUND = [0x05, 0x09, 0x0C];             // the view's ground
const BAND_ON_CAMERA = [10, 16, 21];           // rgba(5,9,12,.78) over the camera's colour
const AIM = [0x3D, 0x8B, 0xFF], PASS = [0xE8, 0xBC, 0x5A];
/* a direction in the words the View row uses (the camera's, or the head's) */
const dirWords = v => (!v ? '' : Math.abs(v.el) > 85 ? '— · straight ' + (v.el > 0 ? 'up' : 'down')
  : Math.round(v.az) % 360 + '° ' + compass(v.az) + ' · ' + Math.round(Math.abs(v.el)) + '° ' + (v.el >= 0 ? 'up' : 'down'));
const near3 = (p, rgb, tol) => !!p && rgb.every((v, i) => Math.abs(p[i] - v) <= tol);
const compass = az => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
/* the radar's unit, as radar.ts states it: 1 at the inset's 156 px, up to 2.2 for a radar that fills the screen */
const unitOf = side => Math.min(2.2, Math.max(1, side / 156));
const plotAt = (side, az, el) => {
  const u = unitOf(side), R = side / 2 - 15 * u, e = Math.max(0, Math.min(90, el)), r = R * (90 - e) / 90;
  return { x: side / 2 + r * Math.sin(az * RAD), y: side / 2 - r * Math.cos(az * RAD) };
};

const AT = Date.UTC(2026, 8, 13, 0, 0, 0);
const BLOCK = [/celestrak\.org/, /ivanstanojevic/, /gibs\.earthdata/, /open-meteo/];
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ar-snap-'));

/* A phone with the page loaded, the globe showing, every request noted, every download kept, and every error. */
async function phone(browser, origin, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    permissions: ['camera'], timezoneId: 'Asia/Bangkok', acceptDownloads: true });
  await ctx.clock.install({ time: AT });
  await ctx.addInitScript(MOCKS);
  await ctx.addInitScript(SPY);
  const page = await ctx.newPage();
  const errs = [], reqs = [], dls = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('download', d => dls.push(d));
  ctx.on('request', r => reqs.push({ url: r.url(), method: r.method(), body: (r.postDataBuffer() || []).length }));
  for (const u of BLOCK) await page.route(u, r => r.abort());
  await page.goto(origin + '/index.html');
  await page.waitForFunction(() => window.__gt && window.__gt.D && window.ARView && window.Orbit3D && Orbit3D.ok(), null, { timeout: 60000 });
  await H.showGlobe(page);
  return { ctx, page, errs, reqs, dls };
}

/* The page's window held at the culmination of its highest pass, and then at `el` degrees up on the way (not the zenith, where an azimuth means
   nothing): the spacecraft is up, and holds still. As verify-ar.js's radarPhone does it. */
async function atPass(page, el) {
  const best = await page.evaluate(() => {
    const P = __gt.D.passes;
    if (!P.length) return null;
    let k = 0; P.forEach((p, i) => { if (p.maxEl > P[k].maxEl) k = i; });
    document.querySelector('.passrow[data-i="' + k + '"]').click();
    return { k, maxEl: P[k].maxEl, name: __gt.D.entry.name };
  });
  if (!best) return null;
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if (b.getAttribute('aria-label') === 'Pause') b.click(); });
  await page.evaluate(([k, want]) => {
    const D = __gt.D, p = D.passes[k];
    let b = null;
    for (let t = p.t0ms; t <= p.t1ms; t += 5000) { const d = Math.abs(__gt.stateAt(D.track, t).el - Math.min(want, p.maxEl)); if (!b || d < b.d) b = { t, d }; }
    const r = document.getElementById('time'); r.value = Math.round((b.t - D.start.getTime()) / 1000 / D.step);
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }, [best.k, el]);
  await frames2(page);
  return best;
}
const frames2 = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const until = (page, fn, arg, ms) => page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: ms || 15000, polling: 50 }).then(h => h.jsonValue()).catch(() => null);
const probe = page => page.evaluate(() => { const q = ARView.probe; delete q.stream; return q; });
const stateIs = (page, s, ms) => until(page, st => ARView.state === st || (Array.isArray(st) && st.includes(ARView.state)), s, ms || 15000);

/* The phone pointed at (az, el), the picture level, as the sensor would say it; resolves once the view has got there and stopped. */
async function aimAt(page, az, el, th) {
  await page.evaluate(([az, el, th]) => { const q = ARView.probe; __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(az, el, th, q.decl || 0))); }, [az, el, th || 0]);
  await frames2(page);
  await until(page, ([az, el]) => {
    const v = ARView.probe.view; if (!v) return false;
    const R = Math.PI / 180, u = (a, e) => [Math.cos(e * R) * Math.sin(a * R), Math.cos(e * R) * Math.cos(a * R), Math.sin(e * R)], a = u(v.az, v.el), b = u(az, el);
    return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / R < 0.05 ? { ok: true } : false;
  }, [az, el], 10000);
  await frames2(page);
}
const aimAtCraft = async (page, th) => {
  const st = await page.evaluate(() => __gt.stateAt(__gt.D.track, ARView.probe.ms));
  await aimAt(page, st.az, st.el, th);
  return st;
};
const snapState = page => page.evaluate(() => { const b = document.getElementById('ar-snap'), q = ARView.probe;
  return { exists: !!b, disabled: b.disabled, snapping: q.snapping, state: q.state, mode: q.mode, text: b.textContent.trim(), title: b.title }; });
const statusText = page => page.evaluate(() => document.getElementById('ar-status').textContent);
const setShare = (page, o) => page.evaluate(o => Object.assign(__share, { mode: 'none', can: true, noCan: false, release: null }, o), o);

/* The observer's name, by the page's own form (the harness's helper). Typed in, applied, and the form shut; the form sometimes takes a name only on
   a second try (a click while the popover is still settling), so it is tried up to three times and the name the page then has is what counts. */
async function setSiteName(page, name) {
  const want = name.slice(0, 24).trim();            // the form's field keeps 24 characters
  for (let i = 0; i < 3; i++) {
    await H.setSite(page, { name });                  // the position and the zone are left as they are
    const ok = await page.waitForFunction(n => __gt.OBS.name === n, want, { timeout: 4000 }).then(() => true, () => false);
    await H.closeSiteForm(page);
    if (ok) return true;
  }
  return false;
}

/* ---- one press of Snap -------------------------------------------------------------------------------------------------------------------- */
/* By a finger (`how` 'tap') or by a script in the page ('js', which can say what the button is in the same task). Resolves with what came of it:
   the download, if there was one (the file kept, its bytes, its name), the page's own clock either side, and what the page recorded. */
async function press(page, st, how, o) {
  o = o || {};
  const n0 = st.dls.length, r0 = st.reqs.length;
  let pre = null;
  for (let i = 0; i < 200; i++) {                // a finger waits for the button to be enabled, as Playwright's own tap would
    pre = await page.evaluate(() => { __spy.mark(); __spy.on = true; const b = document.getElementById('ar-snap'), r = b.getBoundingClientRect();
      return { t0: Date.now(), disabled: b.disabled, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (!pre.disabled || how === 'js') break;
    await sleep(50);
  }
  let during = null;
  if (how === 'js') during = await page.evaluate(() => { const b = document.getElementById('ar-snap'); b.click(); return { disabled: b.disabled, snapping: ARView.probe.snapping }; });
  else await page.touchscreen.tap(pre.x, pre.y);
  if (o.download !== false) { for (let i = 0; i < 300 && st.dls.length === n0; i++) await sleep(50); }
  else await sleep(o.wait || 600);
  await until(page, () => !ARView.probe.snapping, null, 15000);
  /* what the status line says the moment the snap is done (it says it for 6 s, and reading a picture's pixels takes longer than that) */
  const post = await page.evaluate(() => { __spy.on = false;
    return { t1: Date.now(), status: document.getElementById('ar-status').textContent,
             spy: JSON.parse(JSON.stringify({ net: __spy.net, urls: __spy.urls, revoked: __spy.revoked, dom: __spy.dom, text: __spy.text, blobs: __spy.blobs })) }; });
  const out = { t0: pre.t0, t1: post.t1, status: post.status, spy: post.spy, during, got: st.dls.length - n0, reqs: st.reqs.slice(r0), name: null, file: null, bytes: null };
  if (st.dls.length > n0) {
    const d = st.dls[n0], from = await d.path();
    out.name = d.suggestedFilename();
    out.bytes = from ? fs.readFileSync(from) : null;
    if (from && process.env.GT_SNAP_KEEP) { out.file = path.join(OUT, String(st.dls.length) + '-' + out.name); fs.copyFileSync(from, out.file); }
  }
  return out;
}
/* A finger on an element of the page: at the middle of its box, where it is (so a tap on something that is covered lands on what covers it). */
async function tap(page, sel) {
  const r = await page.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  await page.touchscreen.tap(r.x, r.y);
}
/* The caption's three lines as the page drew them: the words drawn on the picture's own canvas at the caption's font, in the order drawn. */
const captionOf = (r, w, h) => r.spy.text.filter(t => t.w === w && t.h === h && /^500 /.test(t.font)).map(t => t.text);
const isJpeg = b => !!b && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
const isPng = b => !!b && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
const stampOf = name => { const m = /-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z\.(jpg|png)$/.exec(name || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; };

/* ---- reading a picture ------------------------------------------------------------------------------------------------------------------- */
async function decoder(browser) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 400 } });
  const page = await ctx.newPage();
  await page.goto('about:blank');
  await page.evaluate(DECODER);
  return {
    ctx,
    load: (bytes, mime) => page.evaluate(([b, m]) => D.load(b, m), [bytes.toString('base64'), mime]),
    px: pts => page.evaluate(p => D.px(p), pts),
    near: (rect, rgb, tol) => page.evaluate(([r, c, t]) => D.near(r, c, t), [rect, rgb, tol]),
    light: (rect, min) => page.evaluate(([r, m]) => D.light(r, m), [rect, min]),
    lightRows: (rect, min, n) => page.evaluate(([r, m, c]) => D.lightRows(r, m, c), [rect, min, n])
  };
}

/* The caption band as the picture has it: where it starts, from the foot up, on the right edge's pad (no text there). */
async function bandOf(dec, w, h, over) {
  // the first row, scanning down from well above the band, at which the picture goes darker than `over` (green channel)
  const col = [];
  for (let y = h - 260; y < h; y += 2) col.push([w - 5, y]);
  const px = await dec.px(col);
  let start = null;
  for (let i = 0; i < px.length; i++) if (px[i][1] < over) { start = col[i][1]; break; }
  return start === null ? null : { top: start, height: h - start };
}

/* ======================================================================
 * A - the AR view with the camera live
 * ==================================================================== */
async function partA(browser, origin, dec) {
  console.log('\nA - the AR view with the camera live\n');
  const st = await phone(browser, origin);
  const { page } = st;
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  const best = await atPass(page, 35);
  chk('precondition: the window has a pass to aim at', !!best, best ? best.name + ', pass ' + best.k + ' at ' + n1(best.maxEl) + '°' : 'none');
  if (!best) { await st.ctx.close(); return st.errs.length; }
  const storageOf = () => page.evaluate(() => { const o = {}; for (const S of [localStorage, sessionStorage]) for (let i = 0; i < S.length; i++) o[(S === localStorage ? 'l:' : 's:') + S.key(i)] = S.getItem(S.key(i)); return o; });
  const dbsOf = () => page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name).sort() : null));
  const store0 = await storageOf(), dbs0 = await dbsOf();

  /* The button before there is anything to take a picture of: the camera's answer held back for 0.6 s, so that the view is asking, and then waiting. */
  await page.evaluate(() => { __ar.delayMs = 600; });
  await tap(page, '#arbtn');
  await page.evaluate(() => { __ar.delayMs = 0; });
  const s0 = await snapState(page);
  const reach = await page.evaluate(() => { const b = document.getElementById('ar-snap'), r = b.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { shown: !b.hidden && getComputedStyle(b).display !== 'none' && r.width > 0 && r.height >= 40, reach: h === b, inView: !!b.closest('#arview') }; });
  chk('the AR view has a Snap button, in the view, shown, at least 40 px tall and in reach of a finger', s0.exists && reach.shown && reach.reach && reach.inView && s0.text === 'Snap' && s0.mode === 'ar',
      JSON.stringify(Object.assign({}, reach, { text: s0.text, title: s0.title })));
  chk('...and it is disabled while the view is asking for the camera and the sensors',
      s0.disabled && s0.state === 'asking', 'state ' + s0.state + ', disabled ' + s0.disabled);
  await stateIs(page, 'waiting', 10000);
  const s1 = await snapState(page);
  await aimAtCraft(page, 0);
  await until(page, () => ARView.probe.camera === 'live', null, 30000);
  const s2 = await snapState(page);
  chk('...and still while it waits for the first reading, and enabled once it is running', s1.disabled && s1.state === 'waiting' && !s2.disabled && s2.state === 'running',
      'waiting: disabled ' + s1.disabled + ' (' + s1.state + '); running: disabled ' + s2.disabled + ' (' + s2.state + ')');
  const q0 = await probe(page);
  chk('precondition: the camera is live, a stream of 1440x1080, and the view is aimed at the spacecraft',
      q0.camera === 'live' && q0.view && Math.hypot(q0.marker.x - q0.cx, q0.marker.y - q0.cy) < 1.5 && !!q0.radar.box && !!q0.radar.draw && !!q0.radar.draw.aim,
      'camera ' + q0.camera + ', marker ' + (q0.marker ? n1(Math.hypot(q0.marker.x - q0.cx, q0.marker.y - q0.cy)) + ' px off centre' : 'none') + ', radar ' + (q0.radar.box ? 'drawn' : 'none'));
  await frames2(page);
  const netBefore = st.reqs.length;

  /* ---- the first press: a finger on the button ---- */
  const viewRow = await page.evaluate(() => document.getElementById('ar-view').textContent);
  const r1 = await press(page, st, 'tap');
  const q1b = await probe(page);
  const W = 780, Hh = 1688;
  chk('one tap on Snap is exactly one download', r1.got === 1 && !!r1.name, r1.got + ' downloads' + (r1.name ? ', ' + r1.name : ''));
  const stamp = stampOf(r1.name);
  chk('...named sattrack-sky-<site>-<UTC yyyymmddThhmmssZ>.jpg, the instant from the page\'s clock and not from the wall clock\'s',
      /^sattrack-sky-bangkok-\d{8}T\d{6}Z\.jpg$/.test(r1.name || '') && stamp !== null && stamp >= Math.floor(r1.t0 / 1000) * 1000 && stamp <= r1.t1 && Math.abs(stamp - Date.now()) > 86400000,
      r1.name + ' (the page\'s Date.now ' + new Date(r1.t0).toISOString() + ' to ' + new Date(r1.t1).toISOString() + '; the wall clock is ' + new Date().toISOString().slice(0, 10) + ')');
  chk('...a JPEG: the bytes begin FF D8 FF, and it is a real picture (over 20 KB)', isJpeg(r1.bytes) && r1.bytes.length > 20000, r1.bytes ? r1.bytes.length + ' bytes, begin ' + [...r1.bytes.subarray(0, 3)].map(b => b.toString(16).toUpperCase()).join(' ') : 'no file');
  const sz = r1.bytes ? await dec.load(r1.bytes, 'image/jpeg') : { w: 0, h: 0 };
  chk('...decoded, it is the screen in device pixels: round(390 x 2) by round(844 x 2) = 780 x 1688 (the page says ' + q0.W + ' x ' + q0.H + ')',
      sz.w === W && sz.h === Hh && Math.round(q0.W * 2) === W && Math.round(q0.H * 2) === Hh, sz.w + ' x ' + sz.h);

  /* The camera's colour over the whole frame: a grid of points clear of the radar's box, the caption band and the sky's own marks. */
  const box = q0.radar.box, d0 = q0.radar.draw;
  const band = await bandOf(dec, W, Hh, 20);
  const pts = [];
  for (let x = 30; x < W; x += 60) for (let y = 40; y < Hh - 200; y += 90) {
    const cx = x / 2, cy = y / 2;
    if (cx > box.x - 10 && cx < box.x + box.w + 10 && cy > box.y - 10 && cy < box.y + box.h + 10) continue;
    pts.push([x, y]);
  }
  const grid = await dec.px(pts);
  const camOk = grid.filter(p => near3(p, CAMERA, 14)).length;
  chk('the camera\'s picture is in it, drawn over the whole frame (object-fit: cover): the stream\'s colour #1b2a33 at most of ' + pts.length + ' points of the screen, nowhere the dark ground',
      camOk >= 0.8 * pts.length && !grid.some(p => near3(p, GROUND, 6)), camOk + ' of ' + pts.length + ' points within 14 of #1b2a33');
  const edges = await dec.px([[3, 3], [W - 4, 3], [3, 600], [W - 4, 600], [3, Hh - 300], [W - 4, Hh - 300], [W / 2, 3]]);
  chk('...to every edge: the corners and the sides above the caption are the camera\'s colour, not the ground\'s (a stream 1440 wide is cropped to 390 x 844, not letterboxed)',
      edges.every(p => near3(p, CAMERA, 14)), edges.map(p => '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')).join(' '));

  /* The sky over it, the radar over that. */
  const aimImg = { x: (box.x + d0.aim.x) * 2, y: (box.y + d0.aim.y) * 2 };
  const blue = await dec.near([aimImg.x - 30, aimImg.y - 30, aimImg.x + 30, aimImg.y + 30], AIM, 60);
  chk('the radar is on it, at its box, with the blue crosshair #3D8BFF where the phone points: at least 30 blue pixels, centred within 3 px of the plot\'s own point for it',
      blue.n >= 30 && dist2(blue, aimImg) <= 3, blue.n + ' blue pixels centred ' + (blue.n ? n1(dist2(blue, aimImg)) : '-') + ' px from (' + n1(aimImg.x) + ', ' + n1(aimImg.y) + ')');
  /* the disc's dark glass, rgba(5,9,12,.62) over the camera's colour, is #0D161B: at the points between the rings (half way and five sixths of the
     way out) that the pass and the crosshair do not cross, which is most of the 16 */
  const glassPts = [];
  for (const f of [0.5, 0.83]) for (let k = 0; k < 8; k++) { const a = (22.5 + k * 45) * RAD;
    glassPts.push([(box.x + d0.cx + f * d0.R * Math.sin(a)) * 2, (box.y + d0.cy - f * d0.R * Math.cos(a)) * 2]); }
  const glass = await dec.px(glassPts), glassOk = glass.filter(p => near3(p, [13, 22, 27], 10)).length;
  const radarGold = await dec.near([box.x * 2, box.y * 2, (box.x + box.w) * 2, (box.y + box.h) * 2], PASS, 40);
  chk('...and the radar\'s own marks are there: the pass in its gold on the plot, and the dark glass of the disc over the camera\'s colour (#0D161B)',
      radarGold.n >= 40 && glassOk >= 8, radarGold.n + ' gold pixels in the radar\'s box; ' + glassOk + ' of 16 points of the disc are the glass\'s colour');
  const gold = await dec.near([0, 0, box.x * 2 - 6, Hh - 260], PASS, 50);
  chk('...and the sky drawn over the picture is in it, outside the radar: the pass\'s gold on the sky (the marker, the pass\'s arc and ticks)',
      gold.n >= 30, gold.n + ' gold pixels outside the radar\'s box and above the caption');

  /* The caption band along the foot. */
  const caption = captionOf(r1, W, Hh);
  chk('the strip along the foot is a dark band of three lines (3 x 17 + 2 x 10 = 71 px, 142 in the picture), over the camera\'s colour, with the picture above it',
      !!band && near(band.height, 142, 4), band ? 'the band starts at row ' + band.top + ', ' + band.height + ' px high' : 'no band found');
  const bandPx = band ? await dec.px([[W - 5, band.top + 12], [W - 5, Hh - 12], [W - 5, band.top - 8], [W - 5, band.top + 70]]) : [];
  chk('...dark (rgba(5,9,12,.78) over #1b2a33 is #0A1015) from top to foot, and the camera\'s colour just above',
      bandPx.length === 4 && near3(bandPx[0], BAND_ON_CAMERA, 14) && near3(bandPx[1], BAND_ON_CAMERA, 14) && near3(bandPx[3], BAND_ON_CAMERA, 14) && near3(bandPx[2], CAMERA, 14),
      bandPx.map(p => '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')).join(' '));
  const lines = [];
  for (let i = 0; i < 3; i++) lines.push(band ? await dec.light([20, band.top + 20 + 34 * i, W - 20, band.top + 20 + 34 * (i + 1)], 150) : 0);
  const above = band ? await dec.light([20, band.top - 40, W - 20, band.top - 2], 150) : -1;
  chk('...with light text in each of its three lines (and none in the picture above it): ' + lines.join(', ') + ' light pixels',
      lines.every(n => n >= 60) && above === 0, 'above the band: ' + above + ' light pixels');
  /* What the lines say, from the pixels' own source: the words drawn. */
  const q1 = await probe(page), stc = await page.evaluate(() => __gt.stateAt(__gt.D.track, ARView.probe.ms));
  const when = new Date(q1.ms).toISOString().slice(5, 19).replace('T', ' ') + 'Z';
  const want1 = best.name + ' · ' + Math.round(stc.az) % 360 + '° ' + compass(stc.az) + ' · ' + stc.el.toFixed(1) + '° up · ' + Math.round(stc.rng).toLocaleString('en-US') + ' km';
  const want2 = 'Bangkok · 13.75° N 100.52° E · ' + when + ' · sim time';
  chk('...whose words are the spacecraft and where it was (name, azimuth, elevation, range), the site, its position and the instant, with "sim time", and the aim',
      caption.length === 3 && caption[0] === want1 && caption[1] === want2 && /^Camera \d+° [NESW]+ · \d+° (up|down)$/.test(caption[2]),
      JSON.stringify(caption) + (caption[0] === want1 ? '' : ' (wanted ' + want1 + ')'));
  const aimWords = 'Camera ' + dirWords(q1.view);
  chk('...and the third line is where the camera points, in the words of the View row',
      [q1, q1b].some(q => caption[2] === 'Camera ' + dirWords(q.view)) && viewRow.startsWith((caption[2] || '').slice('Camera '.length)),
      JSON.stringify(caption[2]) + ' vs ' + JSON.stringify(aimWords) + ', the View row: ' + JSON.stringify(viewRow));
  chk('the picture is encoded as a JPEG, from a canvas that is not in the page, the size of the screen',
      r1.spy.blobs.length === 1 && r1.spy.blobs[0].type === 'image/jpeg' && r1.spy.blobs[0].w === W && r1.spy.blobs[0].h === Hh && !r1.spy.blobs[0].id,
      JSON.stringify(r1.spy.blobs));
  chk('the status line says where it went: "Picture saved as <the file name>"', r1.status.startsWith('Picture saved as ' + r1.name), JSON.stringify(r1.status));

  /* ---- the census ---- */
  const pics1 = await page.evaluate(() => __ar.pictures.slice());
  chk('THE CENSUS: one Snap is exactly one drawImage(video) and nothing else of the picture (no read of the view\'s canvas, ImageBitmap, ImageCapture, MediaRecorder, WebGL texture, OffscreenCanvas, VideoFrame, frame callback)',
      pics1.length === 1 && pics1[0] === 'drawImage(video)', JSON.stringify(pics1));
  const store1 = await storageOf(), dbs1 = await dbsOf();
  const changed = Object.keys(Object.assign({}, store0, store1)).filter(k => store0[k] !== store1[k]);
  const bigNew = Object.keys(store1).filter(k => store1[k] !== store0[k] && store1[k].length > 2048);
  const imgIn = Object.keys(store1).filter(k => /data:image|blob:/i.test(k + store1[k]));
  chk('nothing is stored: localStorage and sessionStorage are as they were, none holds an image (no data:image or blob: string, nothing new over 2 KB), and no database is made',
      !changed.length && !bigNew.length && !imgIn.length && JSON.stringify(dbs1) === JSON.stringify(dbs0),
      (changed.length ? 'changed: ' + changed.join(', ') + '; ' : '') + Object.keys(store1).length + ' keys, databases ' + JSON.stringify(dbs1));
  const afterNet = st.reqs.slice(netBefore);
  chk('nothing is sent: from the press to the file, the page made no request at all (and called no fetch, XHR, beacon or socket), none with a body',
      r1.reqs.length === 0 && afterNet.length === 0 && r1.spy.net.length === 0 && !afterNet.some(r => r.body > 0),
      r1.reqs.length + ' requests in the press, ' + afterNet.length + ' since the view was ready' + (afterNet.length ? ': ' + afterNet.map(r => r.method + ' ' + r.url.slice(0, 60)).join(', ') : '') + (r1.spy.net.length ? '; page: ' + r1.spy.net.join(', ') : ''));
  const add = r1.spy.dom.filter(d => d.op === 'add'), rem = r1.spy.dom.filter(d => d.op === 'remove');
  const left = await page.evaluate(() => document.querySelectorAll('a[download]').length);
  chk('the object URL is made once, for the one JPEG, and the anchor the page clicked was put inside the view (the page is inert) and is gone: nothing left in the page',
      r1.spy.urls.length === 1 && r1.spy.urls[0].type === 'image/jpeg' && r1.spy.urls[0].url.startsWith('blob:')
      && add.length === 1 && add[0].download === r1.name && add[0].href === 'blob:' && add[0].inView && rem.length === 1 && left === 0 && r1.spy.revoked.length === 0,
      r1.spy.urls.length + ' URLs, anchors added ' + JSON.stringify(add) + ', removed ' + rem.length + ', left in the page ' + left + ', revoked at once ' + r1.spy.revoked.length);

  /* ---- a second press, from a script, to see the button while the picture is made ---- */
  await until(page, () => !document.getElementById('ar-snap').disabled, null, 5000);
  const r2 = await press(page, st, 'js');
  const s3 = await snapState(page);
  chk('while a snap is being made the button is disabled and the view says so (probe.snapping), and once it is made it is enabled again',
      !!r2.during && r2.during.disabled && r2.during.snapping === true && !s3.disabled && s3.snapping === false && r2.got === 1,
      'in the press: disabled ' + (r2.during && r2.during.disabled) + ', snapping ' + (r2.during && r2.during.snapping) + '; after: disabled ' + s3.disabled + ', snapping ' + s3.snapping);
  const pics2 = await page.evaluate(() => __ar.pictures.slice());
  chk('...and a second Snap adds exactly one more drawImage(video), and again nothing else', pics2.length === 2 && pics2.every(p => p === 'drawImage(video)'), JSON.stringify(pics2));
  chk('...a second file of its own, named the same way, a JPEG, and its instant no earlier than the first\'s',
      r2.got === 1 && /^sattrack-sky-bangkok-\d{8}T\d{6}Z\.jpg$/.test(r2.name || '') && isJpeg(r2.bytes) && stampOf(r2.name) >= stamp,
      r2.name + ' (the first was ' + r1.name + ')');

  /* ---- the aim: the head ---- */
  await tap(page, '#ar-aimbtn');
  const aimNow = await page.evaluate(() => ({ src: ARView.probe.aimSource, view: ARView.probe.aimView, cam: ARView.probe.view, label: document.getElementById('ar-aimbtn').textContent, key: localStorage.getItem('gt.araim') }));
  await frames2(page);
  const qh0 = await probe(page);
  const r3 = await press(page, st, 'tap');
  const cap3 = captionOf(r3, W, Hh), qh = await probe(page);
  chk('with the head chosen (Aim: head) the caption\'s third line says "Head ", and where the head points, not the camera',
      aimNow.src === 'head' && aimNow.label === 'Aim: head' && cap3.length === 3 && [qh0, qh].some(q => cap3[2] === 'Head ' + dirWords(q.aimView)) && cap3[2] !== aimWords,
      JSON.stringify(cap3[2]) + ' (camera ' + JSON.stringify(aimWords) + ')');
  const q3 = await probe(page);
  const aimImg3 = q3.radar.draw && q3.radar.draw.aim ? { x: (q3.radar.box.x + q3.radar.draw.aim.x) * 2, y: (q3.radar.box.y + q3.radar.draw.aim.y) * 2 } : null;
  await dec.load(r3.bytes, 'image/jpeg');
  const blue3 = aimImg3 ? await dec.near([aimImg3.x - 30, aimImg3.y - 30, aimImg3.x + 30, aimImg3.y + 30], AIM, 60) : { n: 0 };
  chk('...and the crosshair on the radar in that picture is the head\'s, at its own point (apart from the camera\'s), and the picture under it is still the camera\'s',
      !!aimImg3 && blue3.n >= 30 && dist2(blue3, aimImg3) <= 3 && dist2(aimImg3, aimImg) > 20 && r3.name.endsWith('.jpg'),
      aimImg3 ? blue3.n + ' blue pixels ' + n1(dist2(blue3, aimImg3)) + ' px off the head\'s point, ' + n1(dist2(aimImg3, aimImg)) + ' px from the camera\'s' : 'no crosshair drawn');
  await tap(page, '#ar-aimbtn');
  await frames2(page);

  /* ---- the share sheet ---- */
  const before = await page.evaluate(() => __ar.pictures.length);
  await setShare(page, { mode: 'ok' });
  const rs = await press(page, st, 'tap', { download: false });
  const sh = await page.evaluate(() => __share.calls.slice()), shStatus = rs.status;
  chk('where the browser can share a file, Snap calls navigator.share once, with one File named as above, type image/jpeg, bytes FF D8 FF, over 5 KB, and no download happens',
      sh.length === 1 && sh[0].files === 1 && sh[0].isFile && /^sattrack-sky-bangkok-\d{8}T\d{6}Z\.jpg$/.test(sh[0].name) && sh[0].type === 'image/jpeg' && sh[0].size > 5000
      && sh[0].head && sh[0].head.slice(0, 3).join() === '255,216,255' && rs.got === 0 && rs.spy.urls.length === 0,
      JSON.stringify(sh.map(c => ({ name: c.name, type: c.type, size: c.size, files: c.files, isFile: c.isFile }))) + ', downloads ' + rs.got + ', object URLs ' + rs.spy.urls.length);
  chk('...the status says "Picture shared." (and not "saved")', shStatus === 'Picture shared.', JSON.stringify(shStatus));
  const afterShare = await page.evaluate(() => __ar.pictures.length);
  chk('...and the share path is one drawImage(video) too: the picture is made the same way', afterShare === before + 1, (afterShare - before) + ' more');

  /* a hanging sheet: the button stays off while it is open */
  await setShare(page, { mode: 'hang' });
  const nShare = await page.evaluate(() => { __spy.on = true; return __share.calls.length; });
  await tap(page, '#ar-snap');
  await until(page, n => __share.calls.length === n + 1, nShare, 5000);
  await sleep(300);
  const sOpen = await snapState(page);
  await page.evaluate(() => __share.release());
  await until(page, () => !ARView.probe.snapping, null, 5000);
  const sDone = await snapState(page);
  chk('while the share sheet is open the button stays disabled (the picture is not done until the reader has chosen), and is enabled again when it closes',
      sOpen.disabled && sOpen.snapping && !sDone.disabled && !sDone.snapping, 'open: disabled ' + sOpen.disabled + ', snapping ' + sOpen.snapping + '; closed: disabled ' + sDone.disabled + ', snapping ' + sDone.snapping);

  /* a closed sheet is a cancel: no download, nothing said about it */
  await page.evaluate(() => { __spy.on = false; });
  const status0 = await statusText(page);
  await setShare(page, { mode: 'abort' });
  const callsA = await page.evaluate(() => __share.calls.length);
  const ra = await press(page, st, 'tap', { download: false });
  const callsA2 = await page.evaluate(() => __share.calls.length), statusA = ra.status;
  chk('a closed share sheet (AbortError) is a cancel: the sheet was asked once, no file is saved instead, and the status line says nothing of it (no "Picture ...", no "could not be made")',
      callsA2 === callsA + 1 && ra.got === 0 && ra.spy.urls.length === 0 && !/Picture|could not be made/.test(statusA), 'share calls +' + (callsA2 - callsA) + ', downloads ' + ra.got + ', status ' + JSON.stringify(statusA) + ' (before: ' + JSON.stringify(status0) + ')');

  /* a refusal is a download instead */
  await setShare(page, { mode: 'denied' });
  const callsD = await page.evaluate(() => __share.calls.length);
  const rd = await press(page, st, 'tap');
  const callsD2 = await page.evaluate(() => __share.calls.length);
  const statusD = rd.status;
  const shD = await page.evaluate(() => __share.calls[__share.calls.length - 1]);
  chk('a refused share (NotAllowedError) falls back to a download of the same file: asked once, one download, "Picture saved as ..."',
      callsD2 === callsD + 1 && rd.got === 1 && isJpeg(rd.bytes) && rd.name === shD.name && statusD.startsWith('Picture saved as ' + rd.name),
      'share calls +' + (callsD2 - callsD) + ', downloads ' + rd.got + ', ' + rd.name + ', status ' + JSON.stringify(statusD));

  /* canShare saying no, and no canShare at all */
  await setShare(page, { mode: 'ok', can: false });
  const callsN = await page.evaluate(() => ({ calls: __share.calls.length, canCalls: __share.canCalls }));
  const rn = await press(page, st, 'tap');
  const nInfo = await page.evaluate(() => ({ calls: __share.calls.length, canCalls: __share.canCalls }));
  chk('canShare saying no for a file: it is asked, navigator.share is not called, and the picture is a download',
      nInfo.calls === callsN.calls && nInfo.canCalls === callsN.canCalls + 1 && rn.got === 1 && isJpeg(rn.bytes),
      'share calls +' + (nInfo.calls - callsN.calls) + ', canShare asked +' + (nInfo.canCalls - callsN.canCalls) + ', downloads ' + rn.got);
  await setShare(page, { mode: 'ok', noCan: true });
  const rm = await press(page, st, 'tap');
  const mInfo = await page.evaluate(() => __share.calls.length);
  chk('...and a navigator.share with no canShare (a browser that cannot say) is a download as well', mInfo === nInfo.calls && rm.got === 1 && isJpeg(rm.bytes), 'share calls +' + (mInfo - nInfo.calls) + ', downloads ' + rm.got);
  await setShare(page, { mode: 'none' });

  /* ---- the object URL is let go after 30 s: a snap of its own, so that the page's own 30 s have not gone by on the way here ---- */
  const rz = await press(page, st, 'tap');
  const url = rz.spy.urls[0] && rz.spy.urls[0].url;
  const live0 = url ? await page.evaluate(u => fetch(u).then(r => r.blob()).then(b => b.size, () => -1), url) : -2;
  await st.ctx.clock.fastForward(31000);
  await sleep(200);
  const revoked = await page.evaluate(() => __spy.revoked.slice());
  const live1 = url ? await page.evaluate(u => fetch(u).then(r => r.blob()).then(b => b.size, () => -1), url) : -2;
  chk('the object URL is let go 30 s after the snap (a fetch of it works before, and fails after): the file is not kept in the page',
      !!url && !rz.spy.revoked.includes(url) && live0 > 5000 && revoked.includes(url) && live1 === -1,
      'before: ' + live0 + ' bytes, not revoked at once; revoked ' + revoked.length + ' URL(s) after 31 s; then: ' + (live1 === -1 ? 'refused' : live1 + ' bytes'));

  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (A): ' + (st.errs.length ? st.errs.join(' | ') : 'none'));
  await st.ctx.close();
  return st.errs.length;
}

/* What a picture drawn on the ground (a PNG) shows, from its pixels alone, for the checks that are the same in the AR view with no live camera and
   in the radar view: the file, its size, the ground, the caption's band. Returns what the callers add to. */
async function drawingFacts(dec, r, W, Hh, box) {
  const png = isPng(r.bytes);
  const sz = r.bytes ? await dec.load(r.bytes, 'image/png') : { w: 0, h: 0 };
  const pts = [];
  for (let x = 30; x < W; x += 60) for (let y = 40; y < Hh - 200; y += 90) {
    const cx = x / 2, cy = y / 2;
    if (box && cx > box.x - 10 && cx < box.x + box.w + 10 && cy > box.y - 10 && cy < box.y + box.h + 10) continue;
    pts.push([x, y]);
  }
  const grid = await dec.px(pts);
  const ground = grid.filter(p => near3(p, GROUND, 3)).length;
  const corners = await dec.px([[2, 2], [W - 3, 2], [2, Hh - 160], [W - 3, Hh - 160], [2, Hh - 2], [W - 3, Hh - 2]]);
  const lines = [];
  for (let i = 0; i < 3; i++) lines.push(await dec.light([20, Hh - 142 + 20 + 34 * i, W - 20, Hh - 142 + 20 + 34 * (i + 1)], 150));
  const rows = await dec.lightRows([0, Hh - 142, W, Hh], 150, 3);
  const above = await dec.light([20, Hh - 142 - 40, W - 20, Hh - 142 - 2], 150);
  return { png, sz, ground, total: pts.length, camera: grid.filter(p => near3(p, CAMERA, 10)).length, corners, lines, rows, above };
}
const hex = p => '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');

/* ======================================================================
 * B - the AR view with no live camera: declined, and an iPhone finding north
 * ==================================================================== */
async function partB(browser, origin, dec) {
  console.log('\nB - the AR view where the camera is not live: declined, and an iPhone finding north\n');
  const st = await phone(browser, origin);
  const { page } = st;
  await page.evaluate(() => { __ar.camera = 'NotAllowedError'; });
  const best = await atPass(page, 35);
  chk('precondition: the window has a pass to aim at', !!best, best ? best.name + ' at ' + n1(best.maxEl) + '°' : 'none');
  if (!best) { await st.ctx.close(); return st.errs.length; }
  const W = 780, Hh = 1688;
  await tap(page, '#arbtn');
  await aimAtCraft(page, 0);
  await until(page, () => ARView.probe.camera === 'declined' && ARView.state === 'running', null, 15000);
  const q0 = await probe(page), s0 = await snapState(page);
  chk('the camera is declined and the view runs on the sensors alone; Snap is enabled, for it wants a reading and not a camera',
      q0.camera === 'declined' && q0.state === 'running' && !s0.disabled && s0.mode === 'ar', 'camera ' + q0.camera + ', state ' + q0.state + ', Snap disabled ' + s0.disabled);
  const r = await press(page, st, 'tap');
  chk('Snap there makes a PNG, named sattrack-sky-bangkok-<UTC>.png (a drawing, so lossless), and the bytes begin 89 50 4E 47',
      r.got === 1 && /^sattrack-sky-bangkok-\d{8}T\d{6}Z\.png$/.test(r.name || '') && isPng(r.bytes) && r.spy.blobs.length === 1 && r.spy.blobs[0].type === 'image/png',
      r.name + ', ' + (r.bytes ? r.bytes.length : 0) + ' bytes, encoded as ' + JSON.stringify(r.spy.blobs.map(b => b.type)));
  const f = await drawingFacts(dec, r, W, Hh, q0.radar.box);
  chk('...780 x 1688, on the dark ground #05090C: at most of ' + f.total + ' points of the screen the ground\'s colour, none the camera\'s, and the corners and sides are ground to the edge',
      f.sz.w === W && f.sz.h === Hh && f.ground >= 0.8 * f.total && f.camera === 0 && f.corners.every(p => near3(p, GROUND, 3)),
      f.sz.w + ' x ' + f.sz.h + ', ground ' + f.ground + '/' + f.total + ', camera-coloured ' + f.camera + ', corners ' + f.corners.map(hex).join(' '));
  const pics = await page.evaluate(() => __ar.pictures.slice()), calls = await page.evaluate(() => __ar.calls.map(c => c.what));
  chk('THE CENSUS with no camera to draw: still empty after the snap (no drawImage(video), nothing read, no frame taken)', pics.length === 0, JSON.stringify(pics));
  const box = q0.radar.box, d0 = q0.radar.draw;
  const aimImg = { x: (box.x + d0.aim.x) * 2, y: (box.y + d0.aim.y) * 2 };
  const blue = await dec.near([aimImg.x - 40, aimImg.y - 40, aimImg.x + 40, aimImg.y + 40], AIM, 14);
  const gold = await dec.near([0, 0, box.x * 2 - 6, Hh - 260], PASS, 20);
  const goldR = await dec.near([box.x * 2, box.y * 2, (box.x + box.w) * 2, (box.y + box.h) * 2], PASS, 14);
  chk('...the sky is still in it: the pass\'s gold outside the radar (marker, arc, ticks), and the radar with its gold pass and, at the plot\'s own point for where the phone points, the blue crosshair #3D8BFF',
      gold.n >= 30 && goldR.n >= 40 && blue.n >= 60 && dist2(blue, aimImg) <= 1.5,
      gold.n + ' gold pixels on the sky, ' + goldR.n + ' on the radar, ' + blue.n + ' blue centred ' + (blue.n ? n1(dist2(blue, aimImg)) : '-') + ' px from the point');
  chk('...and the caption\'s band is the same three lines on the ground: light text in each third of the 142 px foot and none just above it, first row ' + (f.rows ? f.rows.first - (Hh - 142) : '-') + ' and last ' + (f.rows ? f.rows.last - (Hh - 142) : '-') + ' px into the band',
      f.lines.every(n => n >= 60) && f.above === 0 && !!f.rows && f.rows.first >= Hh - 142 + 14 && f.rows.last <= Hh - 8, f.lines.join(', ') + ' light pixels per line; above: ' + f.above);
  /* Not asserted, but said: the status line puts the camera's own message above Snap's, so with the camera declined the file is saved and the line
     keeps saying why there is no picture; no "Picture saved as" is shown. (The same goes for the answer to Use my location.) */
  if (!r.status.startsWith('Picture saved as ')) console.log('        note: with the camera declined the status line stays on the camera\'s message, not Snap\'s: ' + JSON.stringify(r.status.slice(0, 70)));
  chk('...asked for the camera once (the view\'s own request, which was refused) and for nothing else of it: no stream, no recording',
      calls.filter(c => c === 'camera').length === 1 && (await page.evaluate(() => __ar.streams.length)) === 0, JSON.stringify(calls));
  await page.evaluate(() => { __feed(null); ARView.close(); });

  /* An iPhone that has not yet found north: the radar has no crosshair, and Snap is enabled all the same. */
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  await tap(page, '#arbtn');
  await page.evaluate(() => { const a = __aimAt(0, 10, 0, 0); __feed({ type: 'deviceorientation', a: (a.a + 137) % 360, b: a.b, g: a.g, h: 0, acc: 10 }); });
  await until(page, () => { const q = ARView.probe; return q.state === 'finding' && q.camera === 'live' && q.radar.box && q.radar.draw ? { ok: true } : false; }, null, 30000);
  await frames2(page);
  const qf = await probe(page), sf = await snapState(page);
  chk('an iPhone finding north (no bearing yet): the view is "finding", and Snap is enabled in it', qf.state === 'finding' && !sf.disabled && !sf.snapping, qf.state + ', Snap disabled ' + sf.disabled);
  const rf = await press(page, st, 'tap');
  const capf = captionOf(rf, W, Hh);
  const szf = rf.bytes ? await dec.load(rf.bytes, 'image/jpeg') : { w: 0 };
  const boxf = qf.radar.box;
  const blueF = await dec.near([boxf.x * 2, boxf.y * 2, (boxf.x + boxf.w) * 2, (boxf.y + boxf.h) * 2], AIM, 60);
  const goldF = await dec.near([boxf.x * 2, boxf.y * 2, (boxf.x + boxf.w) * 2, (boxf.y + boxf.h) * 2], PASS, 40);
  chk('...a JPEG again (the camera is live), the radar in it with the pass but no blue crosshair (its azimuth means nothing yet), and the caption\'s third line says so',
      rf.got === 1 && isJpeg(rf.bytes) && /\.jpg$/.test(rf.name) && szf.w === W && blueF.n === 0 && goldF.n >= 40 && capf.length === 3 && /^Camera — \(finding north\) · \d+° up$/.test(capf[2]),
      rf.name + ', ' + blueF.n + ' blue pixels on the radar, ' + goldF.n + ' gold, ' + JSON.stringify(capf[2]));
  chk('...and the status line says where it went (the finding-north note, which is below it, gives way)', rf.status.startsWith('Picture saved as ' + rf.name), JSON.stringify(rf.status));
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (B): ' + (st.errs.length ? st.errs.join(' | ') : 'none'));
  await st.ctx.close();
  return st.errs.length;
}

/* ======================================================================
 * C - the radar view: no AR, no camera
 * ==================================================================== */
async function partC(browser, origin, dec) {
  console.log('\nC - the radar view, with no camera\n');
  const st = await phone(browser, origin);
  const { page } = st;
  const best = await atPass(page, 12);          // on the way up or down, well clear of the pass's highest point
  chk('precondition: the window has a pass to draw', !!best, best ? best.name + ', pass ' + best.k + ' at ' + n1(best.maxEl) + '°' : 'none');
  if (!best) { await st.ctx.close(); return st.errs.length; }
  const W = 780, Hh = 1688;
  await tap(page, '#radarbtn');
  const s0 = await snapState(page);
  const reach = await page.evaluate(() => { const b = document.getElementById('ar-snap'), r = b.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { shown: !b.hidden && getComputedStyle(b).display !== 'none' && r.width > 0 && r.height >= 40, reach: h === b, inView: !!b.closest('#arview'), dataMode: document.getElementById('arview').dataset.mode }; });
  chk('the radar view has a Snap button too, in the view, shown and in reach, and it is disabled until the first reading',
      s0.exists && reach.shown && reach.reach && reach.inView && reach.dataMode === 'radar' && s0.mode === 'radar' && s0.disabled && ['asking', 'waiting'].includes(s0.state),
      JSON.stringify(reach) + ', state ' + s0.state + ', disabled ' + s0.disabled);
  await stateIs(page, 'waiting', 10000);
  const sw = await snapState(page);
  const stAt = await page.evaluate(() => __gt.stateAt(__gt.D.track, ARView.probe.ms));
  const top = await page.evaluate(k => { const p = __gt.D.passes[k]; return { az: p.maxAz, el: p.maxEl }; }, best.k);
  await aimAt(page, (top.az + 180) % 360, 20, 0);            // away from the pass's highest point and from the spacecraft
  const sr = await snapState(page);
  chk('...disabled while it waits and enabled once the view is running, with no camera asked for (the radar view takes only the motion permission)',
      sw.disabled && sw.state === 'waiting' && !sr.disabled && sr.state === 'running', 'waiting: disabled ' + sw.disabled + '; running: disabled ' + sr.disabled);
  const q0 = await probe(page), box = q0.radar.box, d0 = q0.radar.draw;
  chk('precondition: the radar is drawn at a box, large (a unit of 2.2 at most 420 px), with the pass, the spacecraft and the crosshair',
      q0.mode === 'radar' && !!box && !!d0 && d0.pass === true && !!d0.craft && !!d0.aim && !d0.aim.clamped && near(d0.R, d0.size / 2 - 15 * unitOf(d0.size), 0.01) && box.w > 300,
      'box ' + (box ? [box.x, box.y, box.w, box.h].join(' ') : 'none') + ', R ' + (d0 && d0.R) + ', size ' + (d0 && d0.size));
  const r = await press(page, st, 'tap');
  chk('Snap in the radar view is one download, a PNG named sattrack-radar-bangkok-<UTC>.png, 780 x 1688, encoded as image/png',
      r.got === 1 && /^sattrack-radar-bangkok-\d{8}T\d{6}Z\.png$/.test(r.name || '') && isPng(r.bytes) && r.spy.blobs.length === 1 && r.spy.blobs[0].type === 'image/png' && r.spy.blobs[0].w === W && r.spy.blobs[0].h === Hh,
      r.name + ', ' + (r.bytes ? r.bytes.length : 0) + ' bytes, ' + JSON.stringify(r.spy.blobs));
  const f = await drawingFacts(dec, r, W, Hh, box);
  const pics = await page.evaluate(() => __ar.pictures.slice()), calls = await page.evaluate(() => __ar.calls.map(c => c.what));
  chk('...the camera is not called, in the view or in the snap (the only call is the motion permission, no stream), and the census is empty',
      calls.join() === 'motion' && (await page.evaluate(() => __ar.streams.length)) === 0 && pics.length === 0 && r.reqs.length === 0 && r.spy.net.length === 0,
      'calls ' + JSON.stringify(calls) + ', census ' + JSON.stringify(pics) + ', requests ' + r.reqs.length);
  chk('...780 x 1688 on the dark ground #05090C (' + f.ground + ' of ' + f.total + ' points outside the radar, to every corner)', f.sz.w === W && f.sz.h === Hh && f.ground >= 0.95 * f.total && f.corners.every(p => near3(p, GROUND, 3)) && f.camera === 0,
      f.sz.w + ' x ' + f.sz.h + ', corners ' + f.corners.map(hex).join(' '));

  /* The radar at its box, in the picture: the horizon at R, nothing outside it, the pass's hollow ring, the spacecraft's dot, the crosshair. */
  const u = unitOf(d0.size), c0 = { x: (box.x + d0.cx) * 2, y: (box.y + d0.cy) * 2 }, R = d0.R;
  const onCircle = (c, rr, deg) => [c.x + rr * Math.sin(deg * RAD), c.y - rr * Math.cos(deg * RAD)];
  const hor = [20, 110, 200, 290].map(a => onCircle(c0, R * 2, a)), outer = [20, 110, 200, 290].map(a => onCircle(c0, (R + 6 * u) * 2, a));
  const pxHor = await dec.px(hor.concat(outer));
  chk('the radar is where the page says, at its box: the horizon ring at R = side/2 - 15u (' + n1(R) + ' px) is light at four bearings, and just outside it the ground',
      pxHor.slice(0, 4).every(p => p[0] >= 175 && p[1] >= 175 && p[2] >= 175) && pxHor.slice(4).every(p => near3(p, GROUND, 3)), pxHor.map(hex).join(' '));
  const topAt = plotAt(d0.size, top.az, top.el), topImg = { x: (box.x + topAt.x) * 2, y: (box.y + topAt.y) * 2 };
  const bear = [...Array(16).keys()].map(i => i * 22.5);
  const ringPx = await dec.px(bear.map(a => onCircle(topImg, 3.5 * u * 2, a)).concat(bear.map(a => onCircle(topImg, 2.2 * u * 2, a))));
  const onRing = ringPx.slice(0, 16).filter(p => near3(p, PASS, 12)).length, inside = ringPx.slice(16).filter(p => near3(p, PASS, 12)).length;
  chk('the pass\'s highest point, at the plot\'s transform of its own azimuth and elevation, is a small hollow ring: the pass colour round it (at least 14 of 16 bearings), and not all round inside it (at most 7 of 16: only where the arc\'s own line crosses)',
      onRing >= 14 && inside <= 7, 'top (' + n1(top.az) + '°, ' + n1(top.el) + '°) at (' + n1(topImg.x) + ', ' + n1(topImg.y) + '): ring ' + onRing + '/16, inside ' + inside + '/16');
  const craftAt = plotAt(d0.size, stAt.az, stAt.el), craftImg = { x: (box.x + d0.craft.x) * 2, y: (box.y + d0.craft.y) * 2 };
  const dotPx = await dec.px([[craftImg.x, craftImg.y]].concat([0, 45, 90, 135, 180, 225, 270, 315].map(a => onCircle(craftImg, 3.5 * u * 2, a))));
  chk('the spacecraft\'s dot is at the plot\'s transform of its own azimuth and elevation (the page\'s: within 0.1 px) and solid in the pass colour: its centre and 3.5u round it, all 9 points',
      dist2(d0.craft, craftAt) <= 0.1 && dotPx.every(p => near3(p, PASS, 12)) && dist2(craftImg, topImg) > 40, 'dot ' + n1(dist2(d0.craft, craftAt)) + ' px off the transform, ' + dotPx.filter(p => near3(p, PASS, 12)).length + '/9 gold, ' + n1(dist2(craftImg, topImg) / 2) + ' px from the top');
  const aimImg = { x: (box.x + d0.aim.x) * 2, y: (box.y + d0.aim.y) * 2 }, aimWant = plotAt(d0.size, q0.view.az, q0.view.el);
  const blue = await dec.near([aimImg.x - 40, aimImg.y - 40, aimImg.x + 40, aimImg.y + 40], AIM, 14);
  chk('the crosshair is blue #3D8BFF where the phone points: at the plot\'s transform of the view (0.15 px), at least 150 blue pixels, centred on it within 1.5 px',
      dist2(d0.aim, aimWant) <= 0.15 && blue.n >= 150 && dist2(blue, aimImg) <= 1.5, n1(dist2(d0.aim, aimWant)) + ' px from the transform, ' + blue.n + ' blue pixels centred ' + (blue.n ? n1(dist2(blue, aimImg)) : '-') + ' px off');
  const cap = captionOf(r, W, Hh), when = new Date(q0.ms).toISOString().slice(5, 19).replace('T', ' ') + 'Z';
  const want1 = best.name + ' · ' + Math.round(stAt.az) % 360 + '° ' + compass(stAt.az) + ' · ' + stAt.el.toFixed(1) + '° up · ' + Math.round(stAt.rng).toLocaleString('en-US') + ' km';
  const aimW = 'Camera ' + Math.round(q0.view.az) % 360 + '° ' + compass(q0.view.az) + ' · ' + Math.round(Math.abs(q0.view.el)) + '° ' + (q0.view.el >= 0 ? 'up' : 'down');
  chk('the caption is in its band along the foot (light text in each of its three lines, none above it) and says the spacecraft and where it was, the site and the instant, and where the phone points',
      f.lines.every(n => n >= 60) && f.above === 0 && !!f.rows && f.rows.first >= Hh - 142 + 14 && f.rows.last <= Hh - 8
      && cap.length === 3 && cap[0] === want1 && cap[1] === 'Bangkok · 13.75° N 100.52° E · ' + when + ' · sim time' && cap[2] === aimW,
      f.lines.join(', ') + ' light pixels per line; ' + JSON.stringify(cap));
  chk('...and the status line says where it went', r.status.startsWith('Picture saved as ' + r.name), JSON.stringify(r.status));

  /* the share sheet, with a PNG */
  await setShare(page, { mode: 'ok' });
  const rs = await press(page, st, 'tap', { download: false });
  const sh = await page.evaluate(() => __share.calls.slice());
  chk('the share sheet gets the PNG as a File named sattrack-radar-...png of type image/png (bytes 89 50 4E 47), and no download', sh.length === 1 && sh[0].isFile && /^sattrack-radar-bangkok-\d{8}T\d{6}Z\.png$/.test(sh[0].name) && sh[0].type === 'image/png'
      && sh[0].head && sh[0].head.slice(0, 4).join() === '137,80,78,71' && sh[0].size > 1000 && rs.got === 0,
      JSON.stringify(sh.map(c => ({ name: c.name, type: c.type, size: c.size }))) + ', downloads ' + rs.got);
  await setShare(page, { mode: 'abort' });
  const ra = await press(page, st, 'tap', { download: false });
  chk('a closed sheet there is a silent cancel: no download, the status line is empty (the radar view shows no hint)', ra.got === 0 && ra.status === '', JSON.stringify(ra.status));
  await setShare(page, { mode: 'none' });

  /* closing while the picture is made: the focus goes to the button that opened the view, nothing is thrown, and the finished snap is not shown after */
  const n0 = st.dls.length;
  await page.evaluate(() => { __feed(null); document.getElementById('ar-snap').click(); ARView.close(); });
  const focus0 = await page.evaluate(() => document.activeElement && document.activeElement.id);
  for (let i = 0; i < 60 && st.dls.length === n0; i++) await sleep(50);          // the picture is still finished and handed over, a moment later
  await sleep(200);
  const focus1 = await page.evaluate(() => document.activeElement && document.activeElement.id), closed = await page.evaluate(() => ARView.state);
  chk('closing the radar view while a snap is being made leaves no error, the view closed and the focus on the Radar button that opened it',
      !st.errs.length && closed === 'closed' && focus0 === 'radarbtn' && focus1 === 'radarbtn', 'focus ' + focus0 + ' then ' + focus1 + ', state ' + closed + ', errors ' + st.errs.length + ', ' + (st.dls.length - n0) + ' late download(s)');
  await tap(page, '#radarbtn');
  const sAgain = await snapState(page), statusAgain = await statusText(page);
  chk('...and reopened, the snap that finished meanwhile says nothing (the status line is not "Picture ..."), and Snap waits for a first reading again',
      !/Picture/.test(statusAgain) && sAgain.disabled && !sAgain.snapping, JSON.stringify(statusAgain) + ', disabled ' + sAgain.disabled);
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (C): ' + (st.errs.length ? st.errs.join(' | ') : 'none'));
  await st.ctx.close();
  return st.errs.length;
}

/* ======================================================================
 * D - the caption's time, a site's name in a file name, two taps, closing while a picture is made
 * ==================================================================== */
async function partD(browser, origin, dec) {
  console.log('\nD - live time, names, quick taps and closing in the AR view\n');
  const st = await phone(browser, origin);
  const { page } = st;
  const W = 780, Hh = 1688;
  /* the clock as the page starts it is the present: the caption says "live", and the instant is the page's now */
  await tap(page, '#radarbtn');
  await aimAt(page, 250, 20, 0);
  const t0 = await page.evaluate(() => Date.now());
  const rl = await press(page, st, 'tap');
  const capL = captionOf(rl, W, Hh);
  const stamps = [];
  for (let t = t0 - 1000; t <= rl.t1 + 1000; t += 1000) stamps.push(new Date(t).toISOString().slice(5, 19).replace('T', ' ') + 'Z');
  chk('with the clock at the present the caption\'s second line ends "· live" (and not "sim time"), and its instant is the page\'s now',
      capL.length === 3 && / · live$/.test(capL[1]) && stamps.some(s => capL[1].includes(' · ' + s + ' · live')), JSON.stringify(capL[1]) + ' (the page\'s now ' + new Date(t0).toISOString() + ')');
  await page.evaluate(() => { __feed(null); ARView.close(); });

  /* names: the site's name made safe for a file name */
  const NAMES = [
    ['Wat Phra That Doi Suthep Chiang Mai', 'wat-phra-that-doi-suthep'],
    ['Zürich Hauptbahnhof', 'zurich-hauptbahnhof'],
    ['กรุงเทพมหานคร', 'site'],
    ['../../Etc/Passwd', 'etc-passwd'],
    ['Café ☕ #1 "Base"', 'cafe-1-base']
  ];
  const got = [];
  for (const [name, want] of NAMES) {
    await setSiteName(page, name);
    await tap(page, '#radarbtn');
    await aimAt(page, 250, 20, 0);
    const r = await press(page, st, 'tap');
    const m = /^sattrack-radar-([a-z0-9-]{1,24})-\d{8}T\d{6}Z\.png$/.exec(r.name || '');
    got.push({ name, want, file: r.name, slug: m && m[1], title: await page.evaluate(() => document.getElementById('ar-site').textContent) });
    await page.evaluate(() => { __feed(null); ARView.close(); });
  }
  chk('a site\'s name makes a safe file name: ascii, lower case, digits and single hyphens, at most 24 characters, or "site" when nothing of it is ascii',
      got.every(g => !!g.slug && g.slug === g.want && !/^-|-$|--/.test(g.slug)),
      got.map(g => JSON.stringify(g.name) + ' -> ' + (g.file || 'no file')).join('; '));
  chk('...made from the name the view shows, which the observer form keeps to 24 characters', got.every(g => g.title === g.name.slice(0, 24).trim()), got.map(g => g.title).join(' | '));
  await setSiteName(page, 'Bangkok');

  /* the AR view: two taps in one task make one file; closing while the picture is made */
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  await tap(page, '#arbtn');
  await aimAt(page, 250, 20, 0);
  await until(page, () => ARView.probe.camera === 'live', null, 30000);
  await press(page, st, 'js');
  await page.evaluate(() => { __spy.mark(); __spy.on = true; });
  const n1d = st.dls.length;
  const clicks = await page.evaluate(() => { const b = document.getElementById('ar-snap'); b.click(); const a = b.disabled; b.click(); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return a; });
  for (let i = 0; i < 100 && st.dls.length === n1d; i++) await sleep(50);
  await until(page, () => !ARView.probe.snapping, null, 10000);
  await sleep(400);                                                               // time for a second file to show, if there were going to be one
  const picsTwo = await page.evaluate(() => __ar.pictures.length);
  chk('three clicks on Snap in one task (a double tap, and more) make one file: one download and one more drawImage(video), the second and third ignored',
      clicks === true && st.dls.length - n1d === 1 && picsTwo === 2, 'downloads ' + (st.dls.length - n1d) + ', census ' + picsTwo + ' (the earlier press made the other)');
  const nA = st.dls.length;
  await page.evaluate(() => { __feed(null); document.getElementById('ar-snap').click(); ARView.close(); });
  const focusA = await page.evaluate(() => document.activeElement && document.activeElement.id);
  for (let i = 0; i < 60 && st.dls.length === nA; i++) await sleep(50);
  await sleep(200);
  const focusB = await page.evaluate(() => document.activeElement && document.activeElement.id), stateC = await page.evaluate(() => ARView.state);
  chk('closing the AR view while a snap is being made leaves no error, the view closed and the focus on the AR button that opened it, then and when the picture is done',
      !st.errs.length && stateC === 'closed' && focusA === 'arbtn' && focusB === 'arbtn', 'focus ' + focusA + ' then ' + focusB + ', ' + (st.dls.length - nA) + ' late download(s), errors ' + st.errs.length);
  await tap(page, '#arbtn');
  const sOpen = await snapState(page), statusOpen = await statusText(page);
  chk('...and reopened: nothing of the finished snap is said (not "Picture ..."), and Snap is disabled until a first reading, with no snap in progress',
      !/Picture/.test(statusOpen) && sOpen.disabled && !sOpen.snapping && ['asking', 'waiting'].includes(sOpen.state), JSON.stringify(statusOpen) + ', ' + sOpen.state + ', disabled ' + sOpen.disabled);
  await aimAt(page, 250, 20, 0);
  const rb = await press(page, st, 'tap');
  chk('...and works again after the reading comes: a JPEG, one more file', rb.got === 1 && isJpeg(rb.bytes) && /\.jpg$/.test(rb.name), rb.name);
  /* the head, chosen once, is kept: the next time the view is opened its snap still says "Head " (and nothing was stored before it was chosen) */
  const keyBefore = await page.evaluate(() => localStorage.getItem('gt.araim'));
  await tap(page, '#ar-aimbtn');
  await frames2(page);
  await page.evaluate(() => { __feed(null); ARView.close(); });
  await tap(page, '#arbtn');
  await aimAt(page, 250, 20, 0);
  const rk = await press(page, st, 'tap');
  const capk = captionOf(rk, W, Hh), keyAfter = await page.evaluate(() => localStorage.getItem('gt.araim'));
  chk('...and the head, chosen once, is kept: the next time the view is opened the caption still says "Head " (gt.araim was ' + JSON.stringify(keyBefore) + ', now ' + JSON.stringify(keyAfter) + ')',
      keyBefore === null && keyAfter === 'head' && capk.length === 3 && /^Head /.test(capk[2]), JSON.stringify(capk[2]));
  await tap(page, '#ar-aimbtn');
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (D): ' + (st.errs.length ? st.errs.join(' | ') : 'none'));
  await st.ctx.close();
  return st.errs.length;
}

/* ======================================================================
 * E - a session that never presses Snap, and the views that cannot snap
 * ==================================================================== */
async function partE(browser, origin) {
  console.log('\nE - no press: the census stays empty; failed views have no Snap\n');
  const st = await phone(browser, origin);
  const { page } = st;
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  await atPass(page, 35);
  const r0 = st.reqs.length;
  await tap(page, '#arbtn');
  await aimAtCraft(page, 0);
  await until(page, () => ARView.probe.camera === 'live', null, 30000);
  await tap(page, '#ar-aimbtn'); await frames2(page); await tap(page, '#ar-aimbtn'); await frames2(page);
  await tap(page, '#ar-radarbtn'); await frames2(page); await tap(page, '#ar-radarbtn');
  await tap(page, '#ar-alignbtn'); await frames2(page); await tap(page, '#ar-alignbtn');
  await sleep(300);
  await page.evaluate(() => { __feed(null); ARView.close(); });
  await tap(page, '#radarbtn');
  await aimAtCraft(page, 0);
  await sleep(500);
  await page.evaluate(() => { __feed(null); ARView.close(); });
  const pics = await page.evaluate(() => __ar.pictures.slice()), urls = await page.evaluate(() => __spy.urls.length + __spy.revoked.length);
  chk('a session that never presses Snap has an empty census: the AR view with a live camera, the aim and radar switches, Align, and the radar view, and not one picture of the camera is drawn, read or captured',
      pics.length === 0 && st.dls.length === 0 && urls === 0, 'census ' + JSON.stringify(pics) + ', downloads ' + st.dls.length + ', object URLs ' + urls);

  /* a view that has failed has a Snap that is off, and a click on it does nothing */
  const failing = [
    ['AR view, motion sensors refused', '#arbtn', () => { __ar.motion = 'reject'; }],
    ['radar view, no motion sensor in the browser', '#radarbtn', () => { __ar.motion = 'granted'; __ar.noOri = true; }],
    ['AR view, a page that is not secure', '#arbtn', () => { __ar.noOri = false; __ar.insecure = true; }]
  ];
  const rows = [];
  for (const [what, opener, setup] of failing) {
    await page.evaluate(setup);
    await tap(page, opener);
    await until(page, () => ARView.state === 'failed', null, 8000);
    const s = await snapState(page);
    const n0 = st.dls.length;
    await page.evaluate(() => document.getElementById('ar-snap').click());
    await sleep(400);
    rows.push({ what, state: s.state, disabled: s.disabled, snapping: s.snapping, downloads: st.dls.length - n0, mode: s.mode });
    await page.evaluate(() => ARView.close());
    await page.evaluate(() => { __ar.noOri = false; __ar.insecure = false; __ar.motion = 'granted'; });
  }
  chk('a view that has failed has Snap disabled, and a click on it does nothing: motion refused (AR), no sensor (radar view), an insecure page (AR)',
      rows.every(x => x.state === 'failed' && x.disabled && !x.snapping && x.downloads === 0), rows.map(x => x.what + ': ' + x.state + ', disabled ' + x.disabled + ', downloads ' + x.downloads).join('; '));
  const pics2 = await page.evaluate(() => __ar.pictures.slice());
  chk('...and the census is still empty after them', pics2.length === 0 && st.dls.length === 0, JSON.stringify(pics2));
  const sent = st.reqs.slice(r0).filter(r => !/^(blob|data):/.test(r.url));
  chk('...and the page asked nobody for anything while it was used (no request after the view opened)', sent.length === 0, sent.length + ' requests' + (sent.length ? ': ' + sent.slice(0, 3).map(r => r.method + ' ' + r.url.slice(0, 60)).join(', ') : ''));
  console.log('\n  page errors (E): ' + (st.errs.length ? st.errs.join(' | ') : 'none'));
  await st.ctx.close();
  return st.errs.length;
}

(async () => {
  const srv = await H.serve(SITE);
  const browser = await chromium.launch({ args: [...H.GL_ARGS, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const only = (process.env.GT_SNAP_ONLY || 'A,B,C,D,E').split(',').map(s => s.trim().toUpperCase());
  let errs = 0;
  const t0 = Date.now();
  try {
    const dec = await decoder(browser);
    for (const [k, fn] of [['A', partA], ['B', partB], ['C', partC], ['D', partD], ['E', partE]]) {
      if (!only.includes(k)) continue;
      const t = Date.now();
      errs += await fn(browser, srv.origin, dec);
      console.log('        (part ' + k + ': ' + ((Date.now() - t) / 1000).toFixed(1) + ' s)');
    }
  } finally {
    await browser.close(); await srv.close();
    if (process.env.GT_SNAP_KEEP) console.log('\n  pictures kept in ' + OUT);
    else fs.rmSync(OUT, { recursive: true, force: true });
  }
  console.log('\npage errors: ' + (errs ? errs : 'none'));
  console.log('\n' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + passes + ' checks passed, ' + fails + ' failed');
  console.log(fails || errs ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS');
  process.exit(fails || errs ? 1 : 0);
})();
