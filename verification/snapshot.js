/* snapshot.js — freeze what the Earth console currently computes.
 *
 * The central body is being made swappable. That is a refactor, and the only
 * honest answer to "did it change anything" is a diff against what the code
 * produced before it was touched. Eyeballing does not work here: the Kozai
 * semi-major-axis error was 512 m and the culmination bug hit 15 of 309
 * satellites, and neither would show up in a screenshot.
 *
 * This drives the REAL page in a browser rather than a re-implementation, so it
 * measures the shipping code. Values come from window.__gt at full precision,
 * not from the rendered text.
 *
 *   node verification/snapshot.js          write verification/baseline.json
 *   node verification/regress.js           compare against it
 *
 * Reproducibility rules, both of which matter:
 *   - the analysis window start is FIXED, never Date.now()
 *   - the network is blocked, because refreshTLE() would otherwise rewrite the
 *     element set mid-run and the "baseline" would depend on what CelesTrak
 *     served that minute
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* Windows path separators have to become forward slashes for a file:// URL. */
const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');
const OUT  = path.join(__dirname, 'baseline.json');

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

(async () => {
  const { chromium } = require(process.env.PW ||
    'C:/Users/Lenovo/AppData/Roaming/npm/node_modules/playwright');
  const browser = await chromium.launch();
  const page = await browser.newContext().then(c => c.newPage());
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  /* No network: the baseline must not depend on what a server returned today. */
  await page.route('**://celestrak.org/**', r => r.abort());
  await page.route('**://tle.ivanstanojevic.me/**', r => r.abort());

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt, null, { timeout: 30000 });

  const result = await page.evaluate(({ T0, SPANS, WANTED }) => {
    const gt = window.__gt;
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
           the point — this file is compared byte for byte. */
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
           change — the quantity computed is identical, only the handle moved. */
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
  }, { T0, SPANS, WANTED });

  await browser.close();

  if (errs.length) {
    console.error('page errors during snapshot:\n  ' + errs.join('\n  '));
    process.exit(1);
  }
  result.meta.written = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));

  const n = Object.keys(result.sats).length;
  let passes = 0, probes = 0;
  for (const s of Object.values(result.sats))
    for (const sp of Object.values(s.spans)) {
      if (sp.passes) passes += sp.passes.length;
      if (sp.probes) probes += sp.probes.filter(Boolean).length;
    }
  console.log('baseline written: ' + OUT);
  console.log('  ' + n + ' satellites x ' + SPANS.length + ' spans');
  console.log('  ' + passes + ' passes, ' + probes + ' sample probes');
  if (result.missing.length)
    console.log('  not in catalogue (skipped): ' + result.missing.join(', '));
})();
