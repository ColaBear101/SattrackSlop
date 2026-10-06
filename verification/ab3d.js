/* ab3d.js - the old page's 3D scene, frozen, against the rebuilt page's.
 *
 * The globe is the one part of the Earth console that cannot be checked by reading text: it is a scene graph (a few dozen objects
 * and a few thousand points) drawn through a camera. So the OLD page's scene is captured once, in a state that is a pure function of
 * nothing the clock or the network can change, and the rebuilt page has to reproduce it twice over: the SCENE GRAPH (what is in it:
 * every object's type, visibility, order, geometry, material, uniforms, matrix; the camera; what the renderer drew and holds) and
 * the PIXELS (the frame it draws, read straight out of the WebGL buffer). The reference is made from the OLD page only.
 *
 *   node verification/ab3d.js --write                  capture legacy/ into verification/ab3d/ (<scenario>.png, inventory.json)
 *   node verification/ab3d.js [--target new|legacy]    capture the target and compare it with the reference; exit 1 on a difference
 *   node verification/ab3d.js --determinism            capture the target twice and compare the two: the tool's own noise floor
 *   options: --only default,pov (a subset; with --write the rest of the reference is kept), --out dir (the captured PNGs and the
 *            diff images; default verification/.ab3d-out/), --examples 6 (differences printed per scenario),
 *            --tile-mean 2 --tile-ssim 0.99 (the pixel tolerance, below),
 *            --fit (pin the target's canvas to the reference's CSS size, position:fixed, so a page that lays the globe out at another
 *            size is still compared pixel for pixel; the layout is then not what is being tested. Without it a different canvas
 *            size is one failure per scenario and no pixel metric.)
 *            --preload-fonts (give a non-legacy target the IBM Plex / Archivo faces before its scripts run, as legacy gets them)
 *   exit: 0 same, 1 different, 2 could not run (no reference, or "the target has no Orbit3D test surface")
 *
 * What makes a frame a pure function of the state: Chromium on SwiftShader (H.GL_ARGS), viewport 1100x800 at devicePixelRatio 1, the
 * clock fixed at 2026-09-13T00:00:00Z, the transport paused and the scrubber sent away and back to the window's first instant (the page
 * runs a moment at 1x before the pause lands, and that moment is time; the orbit ring is rebuilt only when the clock has moved 120 s,
 * so it keeps the instant of whichever frame built it), the offline network profile, a fresh page for every scenario, the state set
 * through the Orbit3D / OrbitViz API with the page's loops suspended and its labels laid out before the first frame draws
 * (renderer.info.memory counts everything ever uploaded, and what gets drawn on the way depends on the phase of the frame clock), a few
 * frames let go, any imagery waited for to its last rung - and then, inside ONE animation-frame callback, renderer.render() and
 * gl.readPixels() (a WebGL drawing buffer is gone by the next task) and the inventory, so the objects read are the objects drawn.
 *
 * INVENTORY: Orbit3D.scene walked in order. Per object: path (child indexes), type, name, own and effective visibility, renderOrder,
 * frustumCulled, userData keys, matrixWorld, and by kind: geometry (type, parameters, draw range, and for every attribute and the
 * index a digest over the DRAWN vertices (a trail's buffer keeps what an earlier, longer slice left past its draw range): count, item
 * size, min, max, sum, a position-weighted sum and a hash of the values rounded to 1e-6 - thousands of stars are one line, and a moved
 * star or a changed colour still changes it), material (type, flags, blending, colour hex, textures
 * as set + size, every uniform by name, a hash of the shader text), sprite scale/position/centre, light colour/intensity. Plus the
 * camera, renderer.info (draw calls, triangles, points, lines, geometries, textures), encoding, pixel ratio, canvas size, and the
 * state the scenario set. Nothing here touches the THREE namespace (the new page exposes only Vector3 and REVISION).
 * Comparison: strings, integers, booleans exactly; floats to 1e-6. Objects are aligned by signature (a diff of the two orders), so
 * one object added or dropped is one difference, not a shift of every one after it. A digest whose hash differs but whose min, max,
 * sums agree to 1e-6 x sqrt(values) is counted as equal (float32 noise), and said so.
 *
 * PIXELS: exact first (pixels that differ, largest channel delta). Identical frames pass. Otherwise a 16x16 tile grid: a tile fails
 * when a channel's mean moved by more than 2/255, or the contrast/structure term of its luminance SSIM (SSIM without the mean term,
 * which the first test covers) is below 0.99; any failing tile fails the frame. Mean abs error and mean/min SSIM are printed. The thresholds are strict on purpose: the old page renders byte-identically from run to run
 * (see --determinism), so any tolerance is only for a different build to earn. The PNG is the raw RGBA the canvas holds (the
 * canvas is transparent where nothing is drawn, premultiplied), top row first.
 *
 * Intentional differences are listed in verification/ab3d-diffs.json as key -> why. A key is one of
 *   "<scenario>:<object path>:<Type>.<field>"   one difference     "<Type>.<field>"   that field of every <Type> (indexes as [])
 *   "<scenario>:pixels" / "pixels"              the frame           "missing <Type>" / "extra <Type>"   an object dropped / added
 * and what is listed is counted and named, not hidden.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const H = require('./lib/harness');

const DIR = path.join(__dirname, 'ab3d');
const INV = path.join(DIR, 'inventory.json');
const ALLOW = path.join(__dirname, 'ab3d-diffs.json');
const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);          // golden.js's instant
const VIEW = { width: 1100, height: 800 };
const TOL = 1e-6;                                    // floats in the inventory
const TILE = 16;

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes('--' + k);
const TILE_MEAN = +arg('tile-mean', 2), TILE_SSIM = +arg('tile-ssim', 0.99);

class Unusable extends Error {}                      // exit 2: nothing to compare, or nothing to capture from

/* ---- the scenarios: each is a fresh page, a named state, set through the API ---------------------------------- */
const SVALBARD = { name: 'Svalbard', lat: 78.2297, lon: 15.4075, alt: 0.45, tz: 2 };
const SCENARIOS = {
  'default':       { note: 'the boot state, surface vector: free camera, 6 h trail, stars + planets, everything else off' },
  'vector':        { surface: ['marble', 'vector'], note: 'marble, then back to the coastlines: the material swap-back must leave the default frame' },
  'marble':        { surface: ['marble'], note: 'the shipped Blue Marble, its 2048 rung landed (the shader material, its maps and uniforms)' },
  'elements':      { js: ["OrbitViz.show('elements', true)", "OrbitViz.show('frame', true)", "OrbitViz.show('constellations', true)", 'Orbit3D.showRVector(true)'],
                     note: 'the element geometry, the inertial frame, the constellations and R(+): the sky layers hung on the scene' },
  'follow':        { js: ['Orbit3D.setFollow(true)'], note: 'the camera over the sub-satellite point (the page boots in this mode, so the frame equals default)' },
  'dragged':       { drag: [-90, 55], note: 'free camera turned by a mouse drag (leaves follow): the cam0 lon/lat steps' },
  'site':          { js: ['Orbit3D.setSite(true)'], note: 'the camera over Bangkok (the observer pin, its lock to the Earth)' },
  'pov':           { js: ['Orbit3D.setPov(true)'], note: 'the view from the spacecraft: camera on the orbit, footprint ring and atmosphere rules' },
  'pov-lens':      { js: ['Orbit3D.setPov(true)'], wheel: -6, note: 'POV with the lens opened by 6 wheel notches (42 -> 70 degrees: the wheel is a lens there; the horizon comes into view)' },
  'zoomed':        { wheel: 8, note: 'free camera pulled in by 8 wheel notches (4.2 -> 1.5 radii): marker scaling, near-camera cull of the catalogue' },
  'no-earth':      { js: ['Orbit3D.showEarth(false)'], note: 'the wire sphere instead of the planet and its atmosphere' },
  'trail-off':     { js: ['Orbit3D.showTrack(false)'], note: 'no ground-track trail' },
  'trail-all':     { js: ['Orbit3D.showTrack(true)', 'Orbit3D.setTrail(Infinity)'], note: 'the whole 24 h trail' },
  'no-cloud':      { js: ['Orbit3D.showCloud(false)'], note: 'the catalogue points hidden' },
  'site-svalbard': { site: SVALBARD, js: ['Orbit3D.setSite(true)'], note: 'an observer moved by the form (the pin is rebuilt: siteMoved), then the site camera' },
  'in-view':       { pass: 'last', note: 'the clock on the last pass\'s culmination: contact line, orange marker, footprint over the observer' }
};

/* ---- what runs in the page: one self-contained function, shipped as source -------------------------------------- */
function IN_PAGE() {
  const rn = v => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };         // no -0
  const num = v => (typeof v !== 'number' ? v : isFinite(v) ? rn(v) : String(v));
  const hex = c => (c && typeof c.getHex === 'function' ? c.getHex() : null);
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16); };
  const plain = v => {
    if (typeof v === 'number') return num(v);
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = plain(v[k]); return o; }
    return typeof v === 'function' ? 'fn' : v === undefined ? null : v;
  };
  const tex = t => {
    if (!t) return { set: false };
    const im = t.image || {};
    const o = { set: true, w: im.width || im.naturalWidth || im.videoWidth || 0, h: im.height || im.naturalHeight || im.videoHeight || 0 };
    for (const k of ['minFilter', 'magFilter', 'wrapS', 'wrapT', 'flipY', 'anisotropy', 'generateMipmaps', 'encoding', 'colorSpace']) if (t[k] !== undefined) o[k] = t[k];
    return o;
  };
  const val = v => {                                  // a uniform's value: scalars and vectors in full, textures as set + size
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') return num(v);
    if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v).slice(0, 64).map(val);
    if (v.isTexture) return tex(v);
    if (v.isColor) return hex(v);
    if (v.elements) return Array.from(v.elements).map(num);
    return ['x', 'y', 'z', 'w'].filter(k => k in v).map(k => num(v[k]));
  };
  /* count, size, min, max, sum, a position-weighted sum (a swap of two points moves it), and a hash of the values at 1e-6. Over the
     vertices that are DRAWN: a trail's buffer keeps whatever an earlier, longer slice left past its draw range, and that is history. */
  const digest = (a, lo, hi) => {
    const n = a.count, k = a.itemSize, arr = a.isInterleavedBufferAttribute ? null : a.array, get = ['getX', 'getY', 'getZ', 'getW'];
    const mn = Array(k).fill(Infinity), mx = Array(k).fill(-Infinity), sm = Array(k).fill(0), ws = Array(k).fill(0);
    let h = 0x811c9dc5;
    for (let i = lo; i < hi; i++) {
      const w = 1 + (i % 7) / 7;
      for (let j = 0; j < k; j++) {
        const v = arr ? arr[i * k + j] : a[get[j]](i);
        if (v < mn[j]) mn[j] = v; if (v > mx[j]) mx[j] = v;
        sm[j] += v; ws[j] += v * w;
        const q = Math.round(v * 1e6);
        h = Math.imul(h ^ (q | 0), 0x01000193); h = Math.imul(h ^ (Math.floor(q / 4294967296) | 0), 0x01000193);
      }
    }
    return { dt: arr ? arr.constructor.name : 'interleaved', n, k, drawn: hi - lo, norm: !!a.normalized, min: mn.map(num), max: mx.map(num), sum: sm.map(num), wsum: ws.map(num), h: (h >>> 0).toString(16) };
  };
  const geometry = g => {
    const o = { t: g.type, par: plain(g.parameters || {}), at: {}, dr: plain(g.drawRange || {}), grp: (g.groups || []).length };
    const dr = g.drawRange || { start: 0, count: Infinity };
    for (const k of Object.keys(g.attributes || {}).sort()) {
      const a = g.attributes[k], lo = g.index ? 0 : Math.min(a.count, Math.max(0, dr.start || 0));
      o.at[k] = digest(a, lo, g.index ? a.count : Math.min(a.count, lo + dr.count));
    }
    o.ix = g.index ? digest(g.index, 0, g.index.count) : null;
    return o;
  };
  const MAT = ['visible', 'transparent', 'opacity', 'side', 'blending', 'blendSrc', 'blendDst', 'blendEquation', 'depthWrite', 'depthTest', 'depthFunc', 'colorWrite',
               'vertexColors', 'fog', 'lights', 'wireframe', 'linewidth', 'size', 'sizeAttenuation', 'shininess', 'alphaTest', 'rotation', 'toneMapped', 'dashSize',
               'gapSize', 'scale', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'flatShading', 'premultipliedAlpha', 'dithering'];
  const material = m => {
    const o = { t: m.type };
    for (const k of MAT) if (m[k] !== undefined) o[k] = val(m[k]);
    for (const k of ['color', 'specular', 'emissive']) if (m[k] && m[k].isColor) o[k] = hex(m[k]);
    for (const k of ['map', 'alphaMap', 'emissiveMap', 'bumpMap', 'normalMap', 'specularMap']) if (m[k]) o[k] = tex(m[k]);
    if (m.uniforms) { o.uni = {}; for (const k of Object.keys(m.uniforms).sort()) o.uni[k] = val(m.uniforms[k] && m.uniforms[k].value); }
    if (typeof m.vertexShader === 'string') { o.vs = fnv(m.vertexShader.replace(/\s+/g, ' ')); o.fs = fnv(String(m.fragmentShader).replace(/\s+/g, ' ')); }
    return o;
  };
  const vis = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const inventory = () => {
    const objs = [];
    const walk = (o, p) => {
      const r = { p, t: o.type, n: o.name || '', v: !!o.visible, ev: vis(o), ro: o.renderOrder, fc: !!o.frustumCulled, ud: Object.keys(o.userData || {}).sort(),
                  mw: Array.from(o.matrixWorld.elements).map(num) };
      if (o.geometry) r.g = geometry(o.geometry);
      if (o.material) r.m = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
      if (o.isSprite) r.sp = { scale: val(o.scale), pos: val(o.position), center: val(o.center) };
      if (o.isLight) r.li = { color: hex(o.color), intensity: num(o.intensity) };
      objs.push(r);
      o.children.forEach((c, i) => walk(c, p + '.' + i));
    };
    walk(Orbit3D.scene, 'S');
    const r = Orbit3D.renderer, gl = r.getContext(), cv = r.domElement, c = Orbit3D.camera, info = r.info;
    return {
      renderer: { calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines,
                  geometries: info.memory.geometries, textures: info.memory.textures,
                  outputEncoding: r.outputEncoding === undefined ? null : r.outputEncoding, outputColorSpace: r.outputColorSpace === undefined ? null : r.outputColorSpace,
                  pixelRatio: r.getPixelRatio(), canvas: [cv.width, cv.height], drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                  css: [cv.clientWidth, cv.clientHeight], toneMapping: r.toneMapping, sortObjects: r.sortObjects, autoClear: r.autoClear,
                  clearAlpha: r.getClearAlpha(), context: plain(gl.getContextAttributes() || {}) },
      camera: { t: c.type, fov: num(c.fov), aspect: num(c.aspect), near: num(c.near), far: num(c.far), zoom: num(c.zoom),
                mw: Array.from(c.matrixWorld.elements).map(num), proj: Array.from(c.projectionMatrix.elements).map(num) },
      objects: objs
    };
  };
  const state = () => {
    const g = k => { try { const v = Orbit3D[k]; return typeof v === 'number' ? num(v) : v instanceof Date ? +v : v === undefined ? null : v; } catch (e) { return 'error'; } };
    let layers = null;
    try { layers = OrbitViz.layers().map(l => l.key + ':' + (l.on ? 1 : 0)).join(' '); } catch (e) { layers = 'error'; }
    return { surface: g('surface'), follow: g('follow'), site: g('site'), pov: g('pov'), earth: g('earth'), track: g('track'), rVector: g('rVector'),
             fov: g('fov'), trail: g('trail') === Infinity ? 'Infinity' : g('trail'), time: g('time'), layers, three: window.THREE && window.THREE.REVISION };
  };
  /* render and read in this one callback: the last of a few frames, so the page's own loop has run for this one already */
  const capture = frames => new Promise(res => {
    let k = 0;
    const step = () => {
      if (++k < frames) { requestAnimationFrame(step); return; }
      const r = Orbit3D.renderer, gl = r.getContext(), cv = r.domElement, w = cv.width, h = cv.height;
      r.render(Orbit3D.scene, Orbit3D.camera);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const inv = inventory();
      inv.state = state();
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      res({ w, h, px: btoa(s), inv });
    };
    requestAnimationFrame(step);
  });
  return { capture, state };
}

/* ---- driving the page --------------------------------------------------------------------------------------- */
const frames = (page, n) => page.evaluate(n => new Promise(res => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : setTimeout(res, 200)); requestAnimationFrame(f); }), n);

async function setSurface(page, key) {
  /* ready with no 'sharpening' left in the note is the last rung of the ladder; 'failed' is the page's own fallback to coastlines */
  const st = await page.evaluate(k => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('surface ' + k + ' was not ready after 60 s')), 60000);
    Orbit3D.setSurface(k, s => {
      if (s.state === 'failed') { clearTimeout(t); res({ failed: s.detail || 'failed' }); }
      else if (s.state === 'ready' && !/sharpening/i.test(s.detail || '')) { clearTimeout(t); res({ ok: true }); }
    });
  }), key);
  if (st.failed) throw new Error('surface ' + key + ' failed: ' + st.failed);
}

/* ---- fonts: the sky labels are text baked into canvases ONCE, in whatever face is loaded at that moment ------------------------
   The old page asks Google Fonts for these (legacy/index.html's <link>); the offline profile refuses that host, which left the
   labels in the generic fallback face - not what the old page looks like. So, for the legacy target only, the stylesheet and the
   files are answered from the fontsource packages (the latin subset, the same files the new build self-hosts), and the faces are
   also handed to the page before any of its scripts run (a FontFace made from bytes is loaded at once, so even the labels baked
   at boot get the real face). Every target then waits for its faces before a scenario builds anything. A new build that bakes its
   labels at boot, before its own face has loaded, is left to show that (those labels differ, and which ones varies run to run);
   --preload-fonts hands it the same faces first, to compare everything else. */
const FONT_SETS = [
  ['IBM Plex Mono', [400, 500, 600], w => '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-' + w + '-normal.woff2'],
  ['IBM Plex Sans', [400, 500, 600], w => '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-' + w + '-normal.woff2'],
  ['Archivo', [500, 600, 700], () => '@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2']      // one variable file, three weights
];
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
async function fontsFor(ctx, answerGoogle) {
  const list = [];
  for (const [family, weights, file] of FONT_SETS) for (const weight of weights) {
    const f = path.join(H.ROOT, 'node_modules', file(weight));
    list.push({ family, weight, name: path.basename(f), file: f });
  }
  const css = list.map(f => "@font-face{font-family:'" + f.family + "';font-style:normal;font-weight:" + f.weight + ';font-display:swap;src:url(https://fonts.gstatic.com/ab3d/' +
                            f.name + ") format('woff2');unicode-range:" + LATIN + '}').join('\n');
  if (answerGoogle) await ctx.route(u => /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname), route => {   // after the harness's own route, so it runs first
    const u = new URL(route.request().url()), hit = list.find(f => u.pathname === '/ab3d/' + f.name), cors = { 'Access-Control-Allow-Origin': '*' };
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', headers: cors, body: css });
    return hit ? route.fulfill({ status: 200, contentType: 'font/woff2', headers: cors, body: fs.readFileSync(hit.file) }) : route.abort();
  });
  await ctx.addInitScript(faces => {
    for (const f of faces) {
      const b = atob(f.b64), bytes = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
      document.fonts.add(new FontFace(f.family, bytes.buffer, { weight: String(f.weight), style: 'normal' }));
    }
  }, list.map(f => ({ family: f.family, weight: f.weight, b64: fs.readFileSync(f.file).toString('base64') })));
}
const FONT_USES = ['400 56px "IBM Plex Mono"', '500 56px "IBM Plex Mono"', '600 56px "IBM Plex Mono"', '400 14px "IBM Plex Sans"', '600 14px "IBM Plex Sans"', '600 14px Archivo'];

async function captureOne(browser, srv, id, errors, warns, fit) {
  const sc = SCENARIOS[id];
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, timezoneId: 'UTC', locale: 'en-US' });
  await ctx.addInitScript(() => { try { localStorage.setItem('gt.surface', 'vector'); } catch (e) {} });   // boot on the surface the scenarios start from
  if (srv.target === 'legacy') await fontsFor(ctx, true);
  else if (has('preload-fonts')) await fontsFor(ctx, false);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(id + ': ' + e.message));
  /* a refused request is what the offline profile is for; any other error in the page is a failure of the page */
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(id + ': console: ' + m.text()); });
  try {
    await page.clock.setFixedTime(new Date(T0));
    await page.goto(srv.page, { waitUntil: 'load' });
    /* a page with neither global is not going to grow them: say so without waiting out the analysis */
    if (!(await page.waitForFunction(() => !!(window.Orbit3D || window.__gt), null, { timeout: 15000 }).then(() => true, () => false)))
      throw new Unusable('the target has no Orbit3D test surface (window.Orbit3D; the new page installs it only when window.__GT_TEST__ is set)');
    const up = await page.waitForFunction(() => !!(window.Orbit3D && window.Orbit3D.scene && window.Orbit3D.renderer && window.Orbit3D.camera && window.__gt && window.__gt.D), null, { timeout: 40000 }).then(() => true, () => false);
    if (!up) {
      if (!(await page.evaluate(() => !!(window.Orbit3D && window.Orbit3D.scene && window.Orbit3D.renderer && window.Orbit3D.camera))))
        throw new Unusable('the target has no Orbit3D test surface (window.Orbit3D with scene, camera and renderer; the new page installs it only when window.__GT_TEST__ is set)');
      throw new Unusable('the target page never finished loading its analysis (window.__gt.D)');
    }
    await page.waitForTimeout(1500);
    const faces = await page.evaluate(async uses => {                    // the faces, loaded, before a layer is built
      await Promise.all(uses.map(u => document.fonts.load(u)));
      await document.fonts.ready;
      return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight);
    }, FONT_USES);
    if (!faces.some(f => /^IBM Plex Mono 600$/.test(f))) warns.push(id + ': IBM Plex Mono 600, the face the labels are baked in, is not loaded (' + faces.join(', ') + ')');
    await page.evaluate(`window.__ab = (${IN_PAGE.toString()})()`);
    if (fit) {                                          // --fit: the canvas at the reference's size wherever the layout puts it
      await page.evaluate(([w, h]) => {
        const cv = Orbit3D.renderer.domElement, css = { position: 'fixed', left: '0', top: '0', width: w + 'px', height: h + 'px', 'max-width': 'none', 'max-height': 'none' };
        for (const k of Object.keys(css)) cv.style.setProperty(k, css[k], 'important');
      }, fit);
      await frames(page, 4);
    }

    if (sc.site) {                                      // typed into the form like a person would; the page moves the pin itself
      await H.setSite(page, sc.site);
      await page.waitForFunction(s => Math.abs(window.__gt.OBS.lat - s.lat) < 1e-9, sc.site, { timeout: 15000 });
      await page.waitForTimeout(500);
    }
    /* the transport runs for a moment before the pause lands, and that moment is time: the scrubber goes back to the window start.
       The orbit ring is rebuilt around the clock only once the clock has moved 120 s from where it was last built, so it would keep
       the instant of whatever frame built it (the run's own timing); away and back makes it a rebuild at exactly the frozen instant. */
    if ((await page.getAttribute('#tpplay', 'aria-label')) === 'Pause') await page.evaluate(() => document.getElementById('tpplay').click());
    const scrub = i => page.evaluate(i => { const r = document.getElementById('time'); if (r) { r.value = Math.min(i, +r.max); r.dispatchEvent(new Event('input', { bubbles: true })); } }, i);
    await scrub(120); await frames(page, 6); await scrub(0); await frames(page, 4);
    if (sc.pass === 'last') {
      const n = await page.evaluate(() => { const b = document.querySelectorAll('#passlist .passrow'); if (b.length) b[b.length - 1].click(); return b.length; });
      if (!n) throw new Error('no pass in the window to put the clock on');
    }
    await frames(page, 6);
    /* renderer.info.memory counts everything ever uploaded, so WHICH frames were drawn on the way matters to it (a layer's labels are
       drawn once before the 30 Hz layout has placed them, or not, by the phase of the frame clock). The steps of a scenario therefore
       run with the loops suspended, the labels are laid out, and only then does the first frame draw; a surface is drawn for a few
       frames before the next replaces it. */
    for (const key of sc.surface || []) { await setSurface(page, key); await frames(page, 6); }
    if (sc.js) {
      await page.evaluate(() => { window.__sus = typeof Orbit3D.suspend === 'function'; if (window.__sus) Orbit3D.suspend(true); });
      await page.evaluate(sc.js.join('; '));
      await page.evaluate(() => new Promise(res => {
        const lay = () => { try { OrbitViz.setTime(new Date(Orbit3D.time)); } catch (e) {} };
        lay(); setTimeout(() => { lay(); if (window.__sus) Orbit3D.suspend(false); res(); }, 60);
      }));
    }
    if (sc.drag) {                                      // a press on the globe, twelve moves, a release
      await page.evaluate(d => {
        const cv = Orbit3D.renderer.domElement, R = cv.getBoundingClientRect(), x = R.left + R.width / 2, y = R.top + R.height / 2;
        cv.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
        for (let i = 1; i <= 12; i++) window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + d[0] * i / 12, clientY: y + d[1] * i / 12, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }, sc.drag);
    }
    for (let i = 0; i < Math.abs(sc.wheel || 0); i++) {  // as a person turns the wheel: one notch at a time on the canvas (positive: in)
      await page.evaluate(dy => Orbit3D.renderer.domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true })), sc.wheel > 0 ? -100 : 100);
      await page.waitForTimeout(40);
    }
    await frames(page, 12);
    await page.waitForTimeout(500);                     // anything that was going to be fetched, decoded or uploaded
    const cap = await page.evaluate(() => window.__ab.capture(4));
    if (cap.inv.state.time !== null && Math.abs(cap.inv.state.time - T0) > 0 && !sc.pass) warns.push(id + ': the clock is at ' + new Date(cap.inv.state.time).toISOString() + ', not the frozen instant');
    if (sc.surface && sc.surface.slice(-1)[0] === 'marble') {
      const w = cap.inv.objects.map(o => o.m && o.m.uni && o.m.uni.dayMap && o.m.uni.dayMap.w).find(x => x);
      if (w !== 2048) warns.push(id + ': the Blue Marble is at the ' + w + ' rung, not 2048');
    }
    return { w: cap.w, h: cap.h, rgba: Buffer.from(cap.px, 'base64'), inv: cap.inv };
  } finally { await ctx.close(); }
}

async function captureAll(target, ids, fits) {
  const { chromium } = H.playwright();
  const srv = await H.up({ target });
  const browser = await chromium.launch({ args: H.GL_ARGS });
  const out = {}, errors = [], warns = [];
  try {
    for (const id of ids) {
      const t = Date.now();
      out[id] = await captureOne(browser, srv, id, errors, warns, fits && fits[id]);
      process.stdout.write('  captured ' + id.padEnd(14) + ((Date.now() - t) / 1000).toFixed(1) + ' s\n');
    }
  } finally { await browser.close(); await srv.close(); }
  return { scenarios: out, errors, warns };
}

/* ---- PNG: written and read here (no image library is installed) ------------------------------------------------ */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
/* rgba is bottom-up (what readPixels gives) when flip is true. Each row takes the filter that leaves the smallest residue. */
function encodePNG(w, h, rgba, flip) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h), cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const row = rgba.subarray((flip ? h - 1 - y : y) * stride, (flip ? h - y : y + 1) * stride);
    const up = y ? rgba.subarray((flip ? h - y : y - 1) * stride, (flip ? h - y + 1 : y) * stride) : null;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0, b = up ? up[i] : 0, c = up && i >= 4 ? up[i - 4] : 0;
        const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - p) & 255; cand[f][i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best; cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePNG(buf) {
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[9] !== 6 || d[12] !== 0) throw new Error('only 8-bit RGBA PNGs written by this tool can be read'); }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * 4, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[o + i - 4] : 0, b = y ? out[o - stride + i] : 0, c = y && i >= 4 ? out[o - stride + i - 4] : 0;
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      out[o + i] = (raw[src + i] + pr) & 255;
    }
  }
  return { w, h, rgba: out };
}
const topDown = (rgba, w, h) => { const o = Buffer.alloc(rgba.length), s = w * 4; for (let y = 0; y < h; y++) rgba.copy(o, y * s, (h - 1 - y) * s, (h - y) * s); return o; };

/* ---- pixels -------------------------------------------------------------------------------------------------- */
const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
function comparePixels(A, B) {
  const w = A.w, h = A.h, a = A.rgba, b = B.rgba, tw = Math.ceil(w / TILE), th = Math.ceil(h / TILE), flagged = new Uint8Array(tw * th);
  let diffPx = 0, maxD = 0, sumAbs = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d0 = Math.abs(a[i] - b[i]), d1 = Math.abs(a[i + 1] - b[i + 1]), d2 = Math.abs(a[i + 2] - b[i + 2]), d3 = Math.abs(a[i + 3] - b[i + 3]), m = Math.max(d0, d1, d2, d3);
    if (m) { diffPx++; sumAbs += d0 + d1 + d2 + d3; if (m > maxD) maxD = m; flagged[((y / TILE) | 0) * tw + ((x / TILE) | 0)] = 1; }
  }
  const r = { identical: !diffPx, diffPx, maxD, mae: sumAbs / a.length, meanSsim: 1, minSsim: 1, bad: 0, worst: null, flagged };
  if (!diffPx) return r;
  const C2 = (0.03 * 255) ** 2;                          // SSIM's contrast-structure term; its mean term is the tile-mean test, in 255ths, so a flat dark tile that moved by 1 is not "structure"
  let ssimSum = tw * th - flagged.reduce((s, v) => s + v, 0), worstScore = Infinity;
  for (let t = 0; t < flagged.length; t++) if (flagged[t]) {
    const x0 = (t % tw) * TILE, y0 = ((t / tw) | 0) * TILE, x1 = Math.min(x0 + TILE, w), y1 = Math.min(y0 + TILE, h), n = (x1 - x0) * (y1 - y0);
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0; const ca = [0, 0, 0, 0], cb = [0, 0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4, p = luma(a, i), q = luma(b, i);
      sx += p; sy += q; sxx += p * p; syy += q * q; sxy += p * q;
      for (let c = 0; c < 4; c++) { ca[c] += a[i + c]; cb[c] += b[i + c]; }
    }
    const mx = sx / n, my = sy / n, vx = sxx / n - mx * mx, vy = syy / n - my * my, cxy = sxy / n - mx * my;
    const ssim = (2 * cxy + C2) / (vx + vy + C2);
    const dm = Math.max(...ca.map((s, c) => Math.abs(s - cb[c]) / n));
    ssimSum += ssim;
    if (ssim < r.minSsim) r.minSsim = ssim;
    if (dm > TILE_MEAN || ssim < TILE_SSIM) {
      r.bad++;
      const score = Math.min(ssim, 1) - dm / 255;
      if (score < worstScore) { worstScore = score; r.worst = { x: x0, y: y0, dMean: dm, ssim }; }
    }
  }
  r.meanSsim = ssimSum / flagged.length;
  return r;
}
function diffImage(A, B) {                              // the reference dimmed, every differing pixel in red by how far it moved
  const w = A.w, h = A.h, o = Buffer.alloc(w * h * 4);
  for (let i = 0; i < o.length; i += 4) {
    const d = Math.max(Math.abs(A.rgba[i] - B.rgba[i]), Math.abs(A.rgba[i + 1] - B.rgba[i + 1]), Math.abs(A.rgba[i + 2] - B.rgba[i + 2]), Math.abs(A.rgba[i + 3] - B.rgba[i + 3]));
    if (d) { o[i] = Math.min(255, 96 + d * 4); o[i + 1] = o[i + 2] = 0; } else o[i] = o[i + 1] = o[i + 2] = luma(A.rgba, i) * 0.35;
    o[i + 3] = 255;
  }
  return o;
}

/* ---- the scene graph ------------------------------------------------------------------------------------------ */
const sig = o => [o.p.split('.').length, o.t, o.n, o.g ? o.g.t : '', o.m ? (Array.isArray(o.m) ? o.m.map(x => x.t).join('+') : o.m.t) : ''].join('|');
/* pairs of indexes (into a, into b) that the two orders agree on: the longest common run of signatures */
function align(a, b) {
  const sa = a.map(sig), sb = b.map(sig), pairs = [];
  if (sa.length === sb.length && sa.every((s, i) => s === sb[i])) return sa.map((_, i) => [i, i]);
  if (sa.length * sb.length > 4e6) { for (let i = 0; i < Math.min(sa.length, sb.length); i++) if (sa[i] === sb[i]) pairs.push([i, i]); return pairs; }
  const W = sb.length + 1, L = new Uint16Array((sa.length + 1) * W);
  for (let i = sa.length - 1; i >= 0; i--) for (let j = sb.length - 1; j >= 0; j--) L[i * W + j] = sa[i] === sb[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  for (let i = 0, j = 0; i < sa.length && j < sb.length;) {
    if (sa[i] === sb[j]) { pairs.push([i, j]); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++; else j++;
  }
  return pairs;
}
function flat(v, p, out) {
  if (Array.isArray(v)) { if (!v.length) out[p + '[]'] = '[]'; v.forEach((x, i) => flat(x, p + '[' + i + ']', out)); }
  else if (v && typeof v === 'object') { const ks = Object.keys(v); if (!ks.length) out[p + '{}'] = '{}'; for (const k of ks) flat(v[k], p ? p + '.' + k : k, out); }
  else out[p] = v;
  return out;
}
const same = (x, y) => (typeof x === 'number' && typeof y === 'number' && !(Number.isInteger(x) && Number.isInteger(y)) ? Math.abs(x - y) <= TOL * 1.0001 : x === y);

/* differences between two flat maps; `tolerated` counts digests equal in every statistic but not in the hash */
function diffMaps(ra, rb, label, type, out, tol) {
  const hashes = [];
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    const x = ra[k], y = rb[k];
    if (/\.h$/.test(k)) { if (x !== y) hashes.push(k); continue; }
    const m = /^(.*)\.w?sum\[\d+\]$/.exec(k);
    const eq = m && typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= TOL * Math.max(1, Math.sqrt((ra[m[1] + '.drawn'] || ra[m[1] + '.n'] || 1) * (ra[m[1] + '.k'] || 1))) : same(x, y);
    if (!eq) out.push({ label, type, field: k, was: x, now: y });
  }
  for (const k of hashes) {                              // a hash alone is float32 noise unless something else in that digest moved
    const base = k.slice(0, -2);
    if (!out.some(d => d.label === label && d.field.startsWith(base + '.'))) { if (tol) tol.n++; }
  }
}
function compareInventory(ref, got) {
  const out = [], tol = { n: 0 };
  diffMaps(flat(ref.renderer, '', {}), flat(got.renderer, '', {}), 'renderer', 'renderer', out, tol);
  diffMaps(flat(ref.camera, '', {}), flat(got.camera, '', {}), 'camera', 'camera', out, tol);
  diffMaps(flat(ref.state, '', {}), flat(got.state, '', {}), 'state', 'state', out, tol);
  const pairs = align(ref.objects, got.objects), inA = new Set(pairs.map(p => p[0])), inB = new Set(pairs.map(p => p[1]));
  ref.objects.forEach((o, i) => { if (!inA.has(i)) out.push({ label: o.p + ':' + o.t, type: 'missing ' + o.t, field: '(object)', was: o.p + ' ' + (o.g ? o.g.t + '/' : '') + (o.m && !Array.isArray(o.m) ? o.m.t : ''), now: 'not in the target' }); });
  got.objects.forEach((o, i) => { if (!inB.has(i)) out.push({ label: o.p + ':' + o.t, type: 'extra ' + o.t, field: '(object)', was: 'not in the reference', now: o.p + ' ' + (o.g ? o.g.t + '/' : '') + (o.m && !Array.isArray(o.m) ? o.m.t : '') }); });
  for (const [i, j] of pairs) {
    const a = ref.objects[i], b = got.objects[j], label = a.p + ':' + a.t;
    const fa = flat(a, '', {}), fb = flat(b, '', {}); delete fa.p; delete fb.p;
    diffMaps(fa, fb, label, a.t, out, tol);
  }
  return { diffs: out, tolerated: tol.n };
}

/* ---- the report ------------------------------------------------------------------------------------------------ */
const fam = d => (d.field === '(object)' ? d.type : d.type + '.' + d.field).replace(/\[\d+\]/g, '[]');
const cut = v => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 90 ? s.slice(0, 90) + '...' : s; };

/* ref and got: { scenarios: { id: { w, h, rgba (top-down), inv } } }. Returns a row per scenario. */
function compareRuns(ref, got, ids, allow) {
  const rows = [];
  for (const id of ids) {
    const A = ref[id], B = got[id], diffs = [], row = { id, diffs, allowed: [], px: null };
    if (!A) { diffs.push({ label: id, type: 'scenario', field: '(reference)', was: 'none', now: 'captured' }); rows.push(row); continue; }
    const c = compareInventory(A.inv, B.inv); row.tolerated = c.tolerated;
    for (const d of c.diffs) {
      const keys = [id + ':' + d.label + '.' + d.field, d.label + '.' + d.field, fam(d), id + ':' + fam(d)];
      const k = keys.find(x => allow[x] !== undefined);
      (k ? row.allowed : diffs).push(Object.assign(d, { why: k && allow[k] }));
    }
    if (A.w !== B.w || A.h !== B.h) row.px = { size: [A.w + 'x' + A.h, B.w + 'x' + B.h], bad: 1, identical: false };
    else row.px = comparePixels(A, B);
    row.pxFail = !row.px.identical && row.px.bad > 0;
    row.pxAllowed = row.pxFail && (allow[id + ':pixels'] !== undefined || allow.pixels !== undefined);
    row.A = A; row.B = B;
    rows.push(row);
  }
  return rows;
}
function report(rows, examples) {
  const pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);
  console.log('\n' + pad('scenario', 15) + lp('inv diffs', 10) + lp('px diff', 9) + lp('max d', 7) + lp('MAE', 8) + '  ' + pad('SSIM mean/min', 15) + lp('bad tiles', 10) + '  verdict');
  let fail = 0;
  for (const r of rows) {
    const p = r.px, invFail = r.diffs.length > 0, pixFail = p && r.pxFail && !r.pxAllowed, ok = !invFail && !pixFail;
    if (!ok) fail++;
    const verdict = (ok ? 'PASS' : 'FAIL') + (p && !p.identical && !r.pxFail ? ' (pixels within tolerance)' : '') + (r.pxAllowed ? ' (pixels listed)' : '');
    if (!p) { console.log(pad(r.id, 15) + '  no reference for this scenario  FAIL'); continue; }
    if (p.size) { console.log(pad(r.id, 15) + lp(r.diffs.length + (r.allowed.length ? '+' + r.allowed.length : ''), 10) + '   canvas ' + p.size.join(' vs ') + ' (--fit compares at the reference size)  ' + verdict); continue; }
    console.log(pad(r.id, 15) + lp(r.diffs.length + (r.allowed.length ? '+' + r.allowed.length : ''), 10) + lp(p.diffPx, 9) + lp(p.maxD, 7) + lp(p.mae.toFixed(3), 8) + '  ' +
                pad(p.meanSsim.toFixed(4) + '/' + p.minSsim.toFixed(4), 15) + lp(p.bad, 10) + '  ' + verdict);
  }
  console.log('\n(inv diffs: differences in the scene graph; "+n" are listed as intentional in ab3d-diffs.json)');
  for (const r of rows) {
    const p = r.px, lines = [];
    for (const d of r.diffs.slice(0, examples)) lines.push('  ' + r.id + ': ' + d.label + '.' + d.field + ': ' + cut(d.was) + ' -> ' + cut(d.now));
    if (r.diffs.length > examples) lines.push('  ' + r.id + ': ... and ' + (r.diffs.length - examples) + ' more (--examples ' + r.diffs.length + ' for all)');
    for (const d of r.allowed.slice(0, 2)) lines.push('  ' + r.id + ': listed  ' + d.label + '.' + d.field + '  - ' + d.why);
    if (p && p.worst) lines.push('  ' + r.id + ': pixels: worst tile at (' + p.worst.x + ',' + p.worst.y + ') mean moved ' + p.worst.dMean.toFixed(2) + '/255, SSIM ' + p.worst.ssim.toFixed(4) + (r.pxAllowed ? '  (listed)' : ''));
    if (r.tolerated) lines.push('  ' + r.id + ': note: ' + r.tolerated + ' geometry digest(s) differ in the hash only, equal in every statistic to 1e-6 (counted as equal)');
    if (lines.length) console.log(lines.join('\n'));
  }
  return fail;
}

/* ---- main ----------------------------------------------------------------------------------------------------- */
const readRef = ids => {
  if (!fs.existsSync(INV)) throw new Unusable('there is no reference yet: run  node verification/ab3d.js --write  (it captures legacy/)');
  const inv = JSON.parse(fs.readFileSync(INV, 'utf8')), out = {};
  for (const id of ids) {
    const f = path.join(DIR, id + '.png');
    if (!inv.scenarios[id] || !fs.existsSync(f)) continue;
    const png = decodePNG(fs.readFileSync(f));
    out[id] = { w: png.w, h: png.h, rgba: png.rgba, inv: inv.scenarios[id] };
  }
  return out;
};
const topDownRun = run => { const o = {}; for (const id of Object.keys(run.scenarios)) { const s = run.scenarios[id]; o[id] = { w: s.w, h: s.h, rgba: topDown(s.rgba, s.w, s.h), inv: s.inv }; } return o; };
const writeInv = (meta, scenarios) => {      // one line per object: a diff of this file reads like a diff of the scene
  const L = ['{', '"meta": ' + JSON.stringify(meta) + ',', '"scenarios": {'], ids = Object.keys(scenarios);
  ids.forEach((id, n) => {
    const s = scenarios[id];
    L.push(JSON.stringify(id) + ': {', '"state": ' + JSON.stringify(s.state) + ',', '"renderer": ' + JSON.stringify(s.renderer) + ',', '"camera": ' + JSON.stringify(s.camera) + ',', '"objects": [');
    L.push(s.objects.map(o => JSON.stringify(o)).join(',\n'), ']', '}' + (n < ids.length - 1 ? ',' : ''));
  });
  L.push('}', '}');
  fs.writeFileSync(INV, L.join('\n') + '\n');
};

async function main() {
  const write = has('write'), det = has('determinism');
  if (write) {
    if (process.env.GT_URL) throw new Unusable('the reference is made from legacy/, not from a URL');
    process.env.GT_TARGET = 'legacy';                  // never from the rebuilt page: the file is the old page's, or it is worthless
  }
  const target = write ? 'legacy' : arg('target', process.env.GT_TARGET || 'new');
  const only = arg('only');
  const ids = only ? only.split(',') : Object.keys(SCENARIOS);
  for (const id of ids) if (!SCENARIOS[id]) throw new Unusable('no scenario "' + id + '"; they are: ' + Object.keys(SCENARIOS).join(', '));
  const outDir = path.resolve(arg('out', path.join(__dirname, '.ab3d-out')));
  const t0 = Date.now();

  if (write) {
    console.log('capturing legacy (' + ids.length + ' scenarios) ...');
    const run = await captureAll('legacy', ids);
    if (run.errors.length) throw new Unusable('the old page raised errors, the reference would be of a broken page:\n  ' + run.errors.slice(0, 5).join('\n  '));
    fs.mkdirSync(DIR, { recursive: true });
    const prior = fs.existsSync(INV) ? JSON.parse(fs.readFileSync(INV, 'utf8')).scenarios : {}, scn = {};
    for (const id of Object.keys(SCENARIOS)) scn[id] = run.scenarios[id] ? run.scenarios[id].inv : prior[id];
    for (const id of Object.keys(scn)) if (!scn[id]) delete scn[id];
    let total = 0;
    for (const id of ids) { const s = run.scenarios[id], png = encodePNG(s.w, s.h, s.rgba, true); fs.writeFileSync(path.join(DIR, id + '.png'), png); total += png.length; }
    writeInv({ target: 'legacy', viewport: [VIEW.width, VIEW.height], t0: new Date(T0).toISOString(), three: Object.values(run.scenarios)[0].inv.state.three, notes: SCENARIOS }, scn);
    const size = fs.readdirSync(DIR).reduce((s, f) => s + fs.statSync(path.join(DIR, f)).size, 0);
    console.log('wrote ' + ids.length + ' PNG(s) (' + (total / 1024).toFixed(0) + ' KB) and inventory.json; verification/ab3d/ is now ' + (size / 1024).toFixed(0) + ' KB, ' +
                ((Date.now() - t0) / 1000).toFixed(0) + ' s');
    for (const w of run.warns) console.log('  warning: ' + w);
    return;
  }

  const stored = det ? null : readRef(ids);              // before the minutes of capturing: no reference is an answer by itself
  const fits = {};
  if (has('fit') && stored) for (const id of ids) if (stored[id]) fits[id] = stored[id].inv.renderer.css;
  console.log('capturing ' + target + ' (' + ids.length + ' scenarios' + (has('fit') ? ', canvas fitted to the reference' : '') + ') ...');
  const run = await captureAll(target, ids, fits);
  fs.mkdirSync(outDir, { recursive: true });
  for (const id of ids) fs.writeFileSync(path.join(outDir, id + '.png'), encodePNG(run.scenarios[id].w, run.scenarios[id].h, run.scenarios[id].rgba, true));
  let ref;
  if (det) {                                           // the tool's own noise floor: the same page, captured again
    console.log('capturing ' + target + ' again ...');
    const again = await captureAll(target, ids);
    ref = topDownRun(run); run.errors.push(...again.errors); run.warns.push(...again.warns);
    run.scenarios = again.scenarios;
  } else ref = stored;
  const got = topDownRun(run), allow = det || !fs.existsSync(ALLOW) ? {} : JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
  const rows = compareRuns(ref, got, ids, allow);
  const fail = report(rows, +arg('examples', 6));
  for (const r of rows) if (r.px && !r.px.identical && r.A && r.A.w === r.B.w && r.A.h === r.B.h) fs.writeFileSync(path.join(outDir, r.id + '.diff.png'), encodePNG(r.A.w, r.A.h, diffImage(r.A, r.B), false));
  for (const w of run.warns) console.log('warning: ' + w);
  if (run.errors.length) console.log('\npage errors (' + run.errors.length + '): ' + run.errors.slice(0, 3).join(' | '));
  console.log('\n' + (det ? 'determinism: ' : '') + (rows.length - fail) + ' of ' + rows.length + ' scenarios pass; captured PNGs' + (rows.some(r => r.px && !r.px.identical) ? ' and diff images' : '') + ' in ' +
              path.relative(process.cwd(), outDir) + '; ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  process.exitCode = fail || run.errors.length ? 1 : 0;
}
if (require.main === module) main().catch(e => { console.error('ab3d: ' + (e instanceof Unusable || !process.env.DEBUG ? e.message : e.stack)); process.exitCode = 2; });
else module.exports = { IN_PAGE, SCENARIOS, encodePNG, decodePNG, comparePixels, compareInventory, align };      // for a test of the tool itself
