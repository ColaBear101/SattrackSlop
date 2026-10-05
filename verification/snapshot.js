/* snapshot.js - freeze what the Earth console computes, or take the same measurements again.
 *
 * The central body is being made swappable, and then the whole console is being rebuilt. Both are
 * refactors, and the only honest answer to "did it change anything" is a diff against what the code
 * produced before it was touched. Eyeballing does not work here: the Kozai semi-major-axis error was
 * 512 m and the culmination bug hit 15 of 309 satellites, and neither would show up in a screenshot.
 *
 * This drives the REAL page in a browser rather than a re-implementation, so it measures the shipping
 * code. Values come from window.__gt at full precision, not from the rendered text.
 *
 *   node verification/snapshot.js --write-baseline    rewrite verification/baseline.json
 *                                                     (only ever from the legacy page: GT_TARGET=legacy)
 *   node verification/snapshot.js --out FILE          take the measurements of the chosen target into FILE
 *
 *   GT_TARGET=legacy|new   which build is measured (see lib/harness.js); GT_URL adopts a running one.
 *
 * Reproducibility rules, both of which matter:
 *   - the analysis window start is FIXED, never Date.now()
 *   - the network is blocked, because refreshTLE() would otherwise rewrite the element set mid-run and
 *     the "baseline" would depend on what CelesTrak served that minute
 *
 * regress.js imports capture() from here and compares in memory. It no longer copies this file, patches
 * its source text and runs the copy: that trick silently overwrote baseline.json if the `OUT` line was
 * ever reformatted.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./lib/harness');

const BASELINE = path.join(__dirname, 'baseline.json');

/* A fixed instant, chosen inside the embedded catalogue's epoch span so every
   object propagates sensibly. */
const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);
const SPANS = [24, 72];

/* Deliberately spread across orbit regimes: LEO, sun-synchronous, GEO, Molniya,
   a decaying object and a few awkward ones. Anything not in the catalogue is
   skipped with a note rather than silently dropped. */
const WANTED = [
  'KNACKSAT-2', 'LANDSAT 9', 'LANDSAT 8', 'ISS (ZARYA)', 'NOAA 18', 'NOAA 19',
  'TERRA', 'AQUA', 'AURA', 'SUOMI NPP', 'SENTINEL-1A', 'SENTINEL-2A',
  'SENTINEL-3A', 'METOP-B', 'METOP-C', 'FENGYUN 3E', 'RADARSAT 2',
  'INTELSAT 10-02', 'JCSAT-5A', 'ASTRA 5B', 'ZHONGXING-2A', 'ELEKTRO-L 3',
  'GOES 16', 'GOES 18', 'MOLNIYA 3-50', 'CLUSTER II-FM8', 'HINODE (SOLAR B)',
  'OCO 2', 'PLEIADES 1A', 'SKYSAT-C1', 'ICEYE-X57', 'EMISAT', 'IRIDIUM 130',
  'TIANMU-1 18', 'YAM-3', 'SAUDISAT 2', 'APRIZESAT 7', 'UNISAT 7', 'TEN-KOH',
  'VELOX-1'
];

/* Everything the baseline records, read from an object with the window.__gt shape.
 *
 * This ONE function runs in the browser (page.evaluate is handed its source) and in Node (`gate:lib`),
 * so the two gates cannot measure different things. It must stay self-contained: no closure over
 * anything in this module, because its text is what crosses into the page. */
function MEASURE_GT(gt, T0, SPANS, WANTED) {
    const byName = new Map(gt.CAT.map(c => [c.name, c]));
    const out = { meta: {}, missing: [], sats: {} };
    out.meta = { t0: T0, spans: SPANS, catalogue: gt.CAT.length,
                 obs: gt.OBS, mask: gt.MASK, RE: gt.RE, MU: gt.MU };

    const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;

    for (const name of WANTED) {
      const entry = byName.get(name);
      if (!entry) { out.missing.push(name); continue; }
      const rec = { satnum: entry.satnum, l1: entry.l1, l2: entry.l2, spans: {} };
      for (const hours of SPANS) {
        let D;
        try { D = gt.compute(entry, T0, hours); }
        catch (e) { rec.spans[hours] = { error: String(e) }; continue; }

        const E = D.E;
        /* Full precision. toString() on a double round-trips exactly, which is
           the point - this file is compared byte for byte. */
        const elements = {
          epoch: E.epoch.getTime(), a: E.a, ecc: E.ecc, inc: E.inc, raan: E.raan,
          argp: E.argp, ma: E.ma, n: E.n, period: E.period,
          perigeeAlt: num(E.perigeeAlt), apogeeAlt: num(E.apogeeAlt),
          bstar: num(E.bstar), ndot: num(E.ndot), rev: E.rev,
          aSource: E.aSource || null, altMeasured: !!E.altMeasured,
          satnum: E.satnum, cospar: E.cospar
        };

        const passes = D.passes.map(p => ({
          aos: p.aos.getTime(), los: p.los.getTime(), dur: p.dur,
          maxEl: p.maxEl, maxAt: p.maxAt.getTime(), maxAz: p.maxAz,
          minRng: p.minRng, aosAz: p.aosAz, losAz: p.losAz,
          clipA: !!p.clipA, clipL: !!p.clipL,
          arcLen: p.arc.length,
          /* a few arc samples rather than all 91, to keep the file readable
             while still catching a change in the sky-track geometry */
          arc: [0, 22, 45, 68, 90].map(i => p.arc[i] ? {
            el: p.arc[i].el, az: p.arc[i].az, rng: p.arc[i].rng } : null)
        }));

        /* 100 fixed sample times across the window, independent of `step`, so a
           change in sampling cadence does not silently change what is compared */
        const probes = [];
        /* D.track after the body refactor, D.satrec before it. Accepting both
           is what lets this one file grade the code on either side of the
           change - the quantity computed is identical, only the handle moved. */
        const handle = D.track || D.satrec;
        for (let k = 0; k < 100; k++) {
          const ms = T0 + Math.round(hours * 3600000 * k / 99);
          const s = gt.sampleMs(handle, ms);
          probes.push(s ? { ms, lat: s.lat, lon: s.lon, alt: s.alt,
                            el: s.el, az: s.az, rng: s.rng } : null);
        }

        rec.spans[hours] = {
          elements, passes,
          totalS: D.totalS, meanAlt: D.meanAlt, lambda: D.lambda,
          step: D.step, drawStride: D.drawStride,
          nPts: D.pts.length,
          firstPt: D.pts[0] ? { lat: D.pts[0].lat, lon: D.pts[0].lon, alt: D.pts[0].alt } : null,
          lastPt: D.pts[D.pts.length-1] ? {
            lat: D.pts[D.pts.length-1].lat, lon: D.pts[D.pts.length-1].lon,
            alt: D.pts[D.pts.length-1].alt } : null,
          probes
        };
      }
      out.sats[name] = rec;
    }
    return out;
}

/* ...from a page that exposes window.__gt (the shipping build, in a real browser). */
async function capture(page) {
  return page.evaluate(({ src, T0, SPANS, WANTED }) =>
    (new Function('return (' + src + ')'))()(window.__gt, T0, SPANS, WANTED),
  { src: MEASURE_GT.toString(), T0, SPANS, WANTED });
}

/* ...from the library bundle (`npm run build:shims`) loaded into a BLANK Chromium page: no app, no server,
   a few seconds, and the fast pre-gate. Same engine and satellite.js bytes as the app; the page run stays
   the authoritative one.
   Why a browser and not Node: the baseline was made in Chromium, and Node's V8 evaluates some Math
   functions differently in the last bits - the same bundle run in Node 23.5 differs from the baseline in
   364 values by up to 1e-14 relative, and run in Chromium it is BIT-IDENTICAL. The engine is not at
   fault; the question "did the numbers move" has to be asked of the engine that made them. */
async function measureLib() {
  const bundle = path.join(__dirname, '.build', 'gt.cjs');
  if (!fs.existsSync(bundle)) throw new Error(bundle + ' is missing - run `npm run build:shims`');
  const text = fs.readFileSync(path.join(__dirname, '..', 'data', 'catalogue.txt'), 'utf8');
  const { chromium } = H.playwright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto('about:blank');
    await page.addScriptTag({ content: fs.readFileSync(bundle, 'utf8') });
    const result = await page.evaluate(({ src, T0, SPANS, WANTED, text }) =>
      (new Function('return (' + src + ')'))()(globalThis.__createGtForNode(text), T0, SPANS, WANTED),
    { src: MEASURE_GT.toString(), T0, SPANS, WANTED, text });
    return { result, errs, target: 'lib bundle in a blank Chromium page' };
  } finally {
    await browser.close();
  }
}

/* Open the chosen target in a fresh browser with the network blocked, wait for the test surface,
   and capture. Resolves to { result, errs, target }. */
async function measure(opts) {
  opts = opts || {};
  if (opts.mode === 'lib') return measureLib();
  const { chromium } = H.playwright();
  const server = await H.up();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    /* No network: the baseline must not depend on what a server returned today. Also no GIBS: the
       baseline is numbers, not pixels, and regenerating it should not depend on NASA being reachable. */
    await H.net(ctx, 'offline');
    await ctx.addInitScript(() => { window.__GT_TEST__ = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(server.page, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__gt, null, { timeout: 30000 });
    const result = await capture(page);
    return { result, errs, target: server.target };
  } finally {
    await browser.close();
    await server.close();
  }
}

function describe(result) {
  const n = Object.keys(result.sats).length;
  let passes = 0, probes = 0;
  for (const s of Object.values(result.sats))
    for (const sp of Object.values(s.spans)) {
      if (sp.passes) passes += sp.passes.length;
      if (sp.probes) probes += sp.probes.filter(Boolean).length;
    }
  return '  ' + n + ' satellites x ' + SPANS.length + ' spans\n' +
         '  ' + passes + ' passes, ' + probes + ' sample probes' +
         (result.missing.length ? '\n  not in catalogue (skipped): ' + result.missing.join(', ') : '');
}

module.exports = { capture, measure, describe, BASELINE, T0, SPANS, WANTED };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
    const writeBaseline = argv.includes('--write-baseline');
    const out = writeBaseline ? BASELINE : arg('--out');
    if (!out) { console.error('say where to write: --out FILE, or --write-baseline (legacy only)'); process.exit(2); }
    /* The baseline is the legacy page's answer. Regenerating it from the thing being judged would make
       the gate agree with whatever the rewrite computes, which is the one thing it exists to prevent. */
    if (writeBaseline && (process.env.GT_TARGET !== 'legacy' || process.env.GT_URL)) {
      console.error('refusing to rewrite baseline.json: set GT_TARGET=legacy explicitly (and no GT_URL)');
      process.exit(2);
    }
    const { result, errs, target } = await measure({ mode: arg('--mode') || 'page' });
    if (errs.length) { console.error('page errors during snapshot:\n  ' + errs.join('\n  ')); process.exit(1); }
    result.meta.written = new Date().toISOString();
    fs.writeFileSync(out, JSON.stringify(result, null, 1));
    console.log('snapshot written: ' + out + '  (target: ' + target + ')');
    console.log(describe(result));
  })().catch(e => { console.error(e); process.exit(1); });
}
