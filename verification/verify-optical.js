/*
 * Naked-eye visibility: is the spacecraft sunlit, and is the ground dark?
 *
 * A pass in this program has always meant RADIO visibility - geometry above a
 * 5 deg mask, day or night. Seeing one needs two more conditions that pull in
 * opposite directions: the spacecraft lit while the observer is not. This checks
 * the geometry behind both.
 *
 * The parts worth doubting, and how each is caught:
 *
 *  - The shadow is a CONE. A cylinder is the usual shortcut and it is wrong in a
 *    specific direction: it reports full shadow where there is only partial
 *    shading. Checked by measuring the umbra's convergence directly - it must
 *    close to a point near 1.4e6 km, which a cylinder never does.
 *  - The umbra must lie strictly inside the penumbra everywhere.
 *  - Sunlit fraction of a LEO orbit: physically bounded, and for a 51.6 deg
 *    orbit in September it should sit near two thirds.
 *  - A dawn-dusk sun-synchronous orbit is the opposite extreme and should be
 *    lit almost continuously - the same code has to produce both.
 *  - Solar elevation is checked against the sub-solar point directly: the Sun
 *    must be overhead at its own sub-point, 90 deg, wherever that lands.
 *
 *   node verification/verify-optical.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**celestrak.org/**', r => r.abort());
  /* The globe's NASA imagery is nothing to do with this check, and letting it
     run costs seconds of wall clock that the timings here are measured against.
     Blocked, so the page takes its documented fallback to the drawn coastlines. */
  await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
  await page.route('**tle.ivanstanojevic.me/**', r => r.abort());
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const gt = window.__gt, RE = gt.RE;
    const T = Date.UTC(2026, 8, 15, 0, 0, 0);
    const S = gt.sunEci(new Date(T));
    const out = {};

    /* 1. The umbra converges. Walk straight down the anti-sun axis and find
          where a point on the axis stops being in shadow. For a cone that is a
          finite distance; for a cylinder it never happens. */
    const onAxis = d => ({ x: -S.x*d, y: -S.y*d, z: -S.z*d });
    let lo = RE, hi = 5e6;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (gt.sunlitState(onAxis(mid), new Date(T)) === 'umbra') lo = mid; else hi = mid;
    }
    out.umbraLenKm = (lo + hi) / 2;
    out.umbraPredicted = RE * S.distKm / (696000 - RE);   // similar triangles

    /* 2. Umbra strictly inside penumbra: sweep off-axis distance at a fixed
          depth and record where each boundary falls. */
    const depth = 40000;
    const offAt = state => {
      let a = 0, b = 3*RE;
      for (let i = 0; i < 200; i++) {
        const m = (a + b) / 2;
        // a point at `depth` behind the Earth, `m` off the shadow axis
        const ax = { x: -S.x*depth, y: -S.y*depth, z: -S.z*depth };
        // any perpendicular direction
        let px = -S.y, py = S.x, pz = 0;
        const pn = Math.hypot(px, py, pz); px /= pn; py /= pn; pz /= pn;
        const p = { x: ax.x + px*m, y: ax.y + py*m, z: ax.z + pz*m };
        const st = gt.sunlitState(p, new Date(T));
        const inside = state === 'umbra' ? (st === 'umbra') : (st !== 'sun');
        if (inside) a = m; else b = m;
      }
      return (a + b) / 2;
    };
    out.umbraR = offAt('umbra');
    out.penumbraR = offAt('penumbra');

    /* 3. Sunlit fraction over one day, for the selected spacecraft. */
    const frac = (track, t0, hours) => {
      let lit = 0, n = 0, pen = 0;
      for (let k = 0; k < 4000; k++) {
        const ms = t0 + hours*3600000*k/4000;
        const st = track.at(ms);
        if (!st) continue;
        const s = gt.sunlitState(st.r, new Date(ms));
        n++; if (s !== 'umbra') lit++; if (s === 'penumbra') pen++;
      }
      return { frac: lit/n, pen: pen/n, n };
    };
    out.knack = frac(gt.D.track, T, 24);

    /* 4. The same code on a dawn-dusk sun-synchronous orbit, which should be
          lit almost all the time - the opposite extreme from a 51.6 deg LEO. */
    const dd = gt.CAT.find(c => /SENTINEL-1A|METOP-B|SUOMI/.test(c.name));
    if (dd) {
      const D2 = gt.compute(dd, T, 24);
      out.ddName = dd.name;
      out.dd = frac(D2.track, T, 24);
    }

    /* 5. Solar elevation must be 90 deg at the sub-solar point itself. */
    let worstOverhead = 0;
    for (let k = 0; k < 48; k++) {
      const d = new Date(T + k*1800000);
      const ss = gt.subsolar(d);
      const el = gt.sunElevation({ lat: ss.lat, lon: ss.lon, altKm: 0 }, d);
      worstOverhead = Math.max(worstOverhead, Math.abs(el - 90));
    }
    out.worstOverhead = worstOverhead;

    /* 6. And -90 at the antipode. */
    let worstAnti = 0;
    for (let k = 0; k < 48; k++) {
      const d = new Date(T + k*1800000);
      const ss = gt.subsolar(d);
      let lon = ss.lon + 180; if (lon > 180) lon -= 360;
      const el = gt.sunElevation({ lat: -ss.lat, lon, altKm: 0 }, d);
      worstAnti = Math.max(worstAnti, Math.abs(el + 90));
    }
    out.worstAnti = worstAnti;

    // 7. the passes actually on screen
    out.passes = gt.D.passes.map(p => {
      const o = gt.passOptical(gt.D.track, p);
      return { aos: p.aos.toISOString().substr(11, 8), maxEl: p.maxEl,
               sunEl: o.sunEl, lit: o.litAtMid, frac: o.frac, both: o.both };
    });
    out.RE = RE;
    return out;
  });

  console.log('\n  umbra length : ' + (r.umbraLenKm/1e6).toFixed(4) + 'e6 km'
            + '   predicted ' + (r.umbraPredicted/1e6).toFixed(4) + 'e6 km');
  chk('the umbra is a converging cone, not a cylinder',
      Math.abs(r.umbraLenKm - r.umbraPredicted)/r.umbraPredicted < 1e-3,
      'closes at ' + (r.umbraLenKm/1e6).toFixed(3) + 'e6 km, within '
      + (100*Math.abs(r.umbraLenKm - r.umbraPredicted)/r.umbraPredicted).toFixed(3) + '% of Re*d/(Rs-Re)');
  chk('...which a cylindrical shadow could never do', r.umbraLenKm < 2e6,
      'a cylinder would still be in shadow at any distance');

  console.log('\n  at 40,000 km behind the Earth:  umbra radius '
            + r.umbraR.toFixed(1) + ' km,  penumbra radius ' + r.penumbraR.toFixed(1) + ' km');
  chk('the umbra lies strictly inside the penumbra', r.umbraR < r.penumbraR,
      'gap = ' + (r.penumbraR - r.umbraR).toFixed(1) + ' km');
  chk('...and both bracket the Earth\'s own radius', r.umbraR < r.RE && r.penumbraR > r.RE,
      'umbra < Re = ' + r.RE.toFixed(0) + ' < penumbra');

  console.log('\n  KNACKSAT-2 sunlit ' + (100*r.knack.frac).toFixed(1) + '% of 24 h'
            + '   (penumbra ' + (100*r.knack.pen).toFixed(2) + '%)');
  chk('a 51.6 deg LEO orbit is sunlit for about two thirds of the time',
      r.knack.frac > 0.55 && r.knack.frac < 0.80,
      (100*r.knack.frac).toFixed(1) + '%');
  /* The penumbra crossing is brief but must not be zero - zero would mean the
     cone had collapsed back to a cylinder with a hard edge. */
  chk('...crossing a real penumbra on the way in and out',
      r.knack.pen > 0 && r.knack.pen < 0.02,
      (100*r.knack.pen).toFixed(3) + '% of the orbit');

  if (r.dd) {
    console.log('\n  ' + r.ddName + ' sunlit ' + (100*r.dd.frac).toFixed(1) + '% of 24 h');
    chk('a sun-synchronous orbit is lit far more than the 51.6 deg one',
        r.dd.frac > r.knack.frac,
        (100*r.dd.frac).toFixed(1) + '% vs ' + (100*r.knack.frac).toFixed(1) + '%');
  }

  /* 1e-5 deg, not 1e-9, and the difference is the formulation rather than the
     code. Elevation comes out of asin, whose derivative diverges at +-1 - which
     is exactly where these two tests sit. A double's 2e-16 in the argument
     becomes sqrt(4e-16) = 2e-8 rad = 1.1e-6 deg in the angle, and that is the
     floor: 3 milliarcseconds, at the one point on Earth where it is worst.
     Before the clamp went in this returned NaN outright, which is what these
     two checks were written to catch. */
  chk('\n  the Sun is overhead at its own sub-point', r.worstOverhead < 1e-5,
      'worst |elevation - 90| = ' + r.worstOverhead.toExponential(2) + ' deg over 48 epochs');
  chk('  ...and directly underfoot at the antipode', r.worstAnti < 1e-5,
      'worst |elevation + 90| = ' + r.worstAnti.toExponential(2) + ' deg');

  console.log('\n  passes on screen');
  for (const p of r.passes)
    console.log('   AOS ' + p.aos + '  maxEl ' + p.maxEl.toFixed(1).padStart(5)
      + '   sun at site ' + p.sunEl.toFixed(1).padStart(6) + ' deg'
      + '   spacecraft ' + p.lit.padEnd(8)
      + '  -> ' + (p.both ? 'naked eye ' + Math.round(100*p.frac) + '%' : 'radio only'));

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
