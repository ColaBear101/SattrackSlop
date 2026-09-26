/*
 * Naked-eye visibility: is the spacecraft sunlit, is the ground dark, and is
 * it bright enough?
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
 * And then brightness, because lit against a dark sky is not the same as
 * visible. The page said "naked eye: yes" for CLUSTER II-FM8 at 124,000 km and
 * INTELSAT 36 at 37,000; the verdict now carries an estimated magnitude.
 *
 *  - The magnitude model is held to its own convention: the standard magnitude
 *    comes back exactly at 1,000 km and 90 deg phase, doubling the range costs
 *    5 log10 2, and full phase gains 2.5 log10 pi.
 *  - Range and phase angle are recomputed by a different route - the range
 *    from the look angles, the phase in the inertial frame with the site
 *    turned back out of the fixed one - so a Sun left unrotated shows up.
 *  - The objects the finding named are never "yes" over a week, and are lit
 *    against a dark sky while they are not, so the check is not vacuous.
 *  - A LEO object does come out "yes": a gate that refused everything would
 *    pass the check above.
 *  - Penumbra never counts towards "yes", and does occur in the sample.
 *  - A station's published figure reaches every catalogue entry on its
 *    element set - modules and docked vehicles, each under its own number -
 *    and nothing else; the pairing survives a refresh that moves one of them
 *    a day on, and the entries of one station agree pass by pass.
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
               sunEl: o.sunEl, lit: o.litAtMid, frac: o.frac, both: o.both,
               eye: o.eye, mag: o.peak ? o.peak.mag : null };
    });

    /* 8. The magnitude model against its own convention. */
    const S0 = gt.STD_MAG;
    out.conv = {
      std: gt.estMagnitude(1000, Math.PI/2, S0) - S0,
      dbl: gt.estMagnitude(2000, Math.PI/2, S0) - gt.estMagnitude(1000, Math.PI/2, S0),
      full: gt.estMagnitude(1000, 0, S0) - S0,
      back: gt.estMagnitude(1000, Math.PI, S0),
      lim: gt.NAKED_EYE_MAG, S0
    };

    /* 9. Range and phase by a second route. The page takes both in the fixed
          frame; here the range comes from the look angles (stateAt) and the
          phase from the inertial frame, with the site rotated back out of the
          fixed one by hand. Samples every 20 s across a week of passes. */
    const week = 7*24;
    const knackD = gt.compute(gt.CAT.find(c => c.name === 'KNACKSAT-2'), T, week);
    let worstRng = 0, worstPh = 0, nGeom = 0;
    for (const p of knackD.passes) {
      for (let ms = p.aos.getTime(); ms <= p.los.getTime(); ms += 20000) {
        const o = gt.opticalAt(knackD.track, ms);
        if (!o || o.rng === null) continue;
        const st = gt.stateAt(knackD.track, ms);
        worstRng = Math.max(worstRng, Math.abs(o.rng - st.rng));
        const b = knackD.track.body, d = new Date(ms), th = b.spin(d);
        const sf = b.siteFixed(gt.OBS), c = Math.cos(th), s = Math.sin(th);
        const obs = { x: sf.x*c - sf.y*s, y: sf.x*s + sf.y*c, z: sf.z };   // fixed -> inertial
        const r = knackD.track.at(ms).r, Sd = gt.sunEci(d), k = Sd.distKm;
        const ox = obs.x - r.x, oy = obs.y - r.y, oz = obs.z - r.z;
        const qx = Sd.x*k - r.x, qy = Sd.y*k - r.y, qz = Sd.z*k - r.z;
        const ph = Math.acos((ox*qx + oy*qy + oz*qz)/(Math.hypot(ox, oy, oz)*Math.hypot(qx, qy, qz)));
        worstPh = Math.max(worstPh, Math.abs(o.phase - ph));
        nGeom++;
      }
    }
    out.geom = { worstRng, worstPh, n: nGeom };

    /* 10-12. A week of verdicts for the objects the finding named, and for two
          LEO objects that should come out visible at least once: HST on its
          published standard magnitude, NOAA 15 on the assumed one. (The ISS
          has no dark-sky pass over Bangkok this particular week.) */
    const verdicts = name => {
      const e = gt.CAT.find(c => c.name === name);
      const Dx = gt.compute(e, T, week);
      let penBad = 0, penSeen = 0;
      const ps = Dx.passes.map(p => {
        const o = gt.passOptical(Dx.track, p);
        /* every sample the page counts as naked-eye visible must be fully
           sunlit - re-derived here sample by sample, not read off the counts */
        const t0 = p.aos.getTime(), t1 = p.los.getTime();
        for (let k = 0; k <= 60; k++) {
          const s = gt.opticalAt(Dx.track, t0 + (t1-t0)*k/60);
          if (!s) continue;
          if (s.visible && s.lit !== 'sun') penBad++;
          if (s.dark && s.lit === 'penumbra') penSeen++;
        }
        return { eye: o.eye, both: o.both, geo: o.geo, pen: o.pen,
                 mag: o.peak ? o.peak.mag : null, pk: !!(o.peak && o.peak.pen),
                 rng: o.peak ? o.peak.rng : null };
      });
      return { name, n: ps.length, ps, penBad, penSeen, std: gt.stdMagOf(Dx.track) };
    };
    out.far = ['INTELSAT 36 (IS-36)', 'MERIDIAN 10', 'CLUSTER II-FM8'].map(verdicts);
    out.near = ['HST', 'NOAA 15'].map(verdicts);
    out.stds = ['HST', 'ISS (ZARYA)', 'CSS (TIANHE-1)', 'KNACKSAT-2'].map(name =>
      Object.assign({ name }, gt.stdMagOf({ entry: gt.CAT.find(c => c.name === name) })));

    /* 13. A station is several catalogue entries: its modules and the vehicles
           docked to it, each under its own number and all published on the
           station's own element set. Keyed by number, ISS (NAUKA) - the entry
           a search for "ISS" loads - got the assumed 5.0 and read "too faint"
           on a pass where ISS (ZARYA) read "yes". Which entries share a set is
           re-derived here from the parsed elements rather than the page's
           column test: the same epoch, and each element within one unit of
           the TLE's last printed digit. */
    const ulp = { inc: 1e-4, raan: 1e-4, ecc: 1e-7, argp: 1e-4, ma: 1e-4, n: 1e-8 };
    const hosts = ['ISS (ZARYA)', 'HST', 'CSS (TIANHE-1)'].map(n => gt.CAT.find(c => c.name === n));
    const onSet = (c, h) => {
      const a = gt.elements(c.l1, c.l2), b = gt.elements(h.l1, h.l2);
      return a.epoch.getTime() === b.epoch.getTime()
        && Object.keys(ulp).every(k => Math.abs(a[k] - b[k]) <= 1.5*ulp[k]);
    };
    out.docked = gt.CAT.map(c => {
      const h = hosts.find(h => h !== c && onSet(c, h));
      const s = gt.stdMagOf({ entry: c });
      return { name: c.name, host: h ? h.name : null, mag: s.mag, known: s.known, via: s.via };
    }).filter(x => x.host || x.known);

    /* 14. ...and stays paired through a live refresh, which replaces the set of
           the one entry on screen and leaves the station's copy as it was.
           Stood in for by moving CREW DRAGON 12's epoch a day on, so that its
           set no longer matches the station's and only the snapshot's pairing
           can carry it. And the converse: an entry that was on no station's
           set in the snapshot, handed the ISS's set under its own number, is
           picked up from the sets as they stand. Both put back afterwards. */
    const swap = (name, l1, l2, fn) => {
      const e = gt.CAT.find(c => c.name === name), keep = { l1: e.l1, l2: e.l2 };
      try { e.l1 = l1(e); e.l2 = l2(e); return fn(e); }
      finally { e.l1 = keep.l1; e.l2 = keep.l2; }
    };
    const iss = hosts[0], num = (l, e) => l.substring(0, 2) + e.satnum.padStart(5) + l.substring(7);
    out.refresh = {
      moved: swap('CREW DRAGON 12', e => e.l1.substring(0, 20) + '256' + e.l1.substring(23), e => e.l2,
        e => Object.assign({ epoch: e.l1.substring(18, 32) }, gt.stdMagOf({ entry: e }))),
      joined: swap('NOAA 15', e => num(iss.l1, e), e => num(iss.l2, e),
        e => Object.assign({ satnum: e.l2.substring(2, 7) }, gt.stdMagOf({ entry: e }))),
      after: ['CREW DRAGON 12', 'NOAA 15'].map(n => gt.stdMagOf({ entry: gt.CAT.find(c => c.name === n) }))
    };

    /* 15. The same station, the same verdict: every entry on the ISS set and
           on Tianhe's over the day the finding's pass fell in, 2026-09-29. */
    const T2 = Date.UTC(2026, 8, 29, 12, 0, 0);
    out.groups = hosts.filter(h => h.name !== 'HST').map(h =>
      [h.name].concat(out.docked.filter(d => d.host === h.name).map(d => d.name)).map(name => {
        const Dx = gt.compute(gt.CAT.find(c => c.name === name), T2, 24);
        return { name, ps: Dx.passes.map(p => {
          const o = gt.passOptical(Dx.track, p);
          return { aos: p.aos.getTime(), eye: o.eye, mag: o.peak ? o.peak.mag : null };
        }) };
      }));
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
      + '  -> ' + (p.both ? 'naked eye ' + Math.round(100*p.frac) + '%' : p.eye)
      + (p.mag !== null ? ', mag ' + p.mag.toFixed(1) : ''));

  // ---- brightness ---------------------------------------------------------
  const c = r.conv;
  console.log('\n  magnitude model: standard ' + c.S0.toFixed(1) + ' assumed, naked-eye limit ' + c.lim);
  chk('the standard magnitude comes back at 1000 km and 90 deg phase',
      Math.abs(c.std) < 1e-12, 'residual ' + c.std.toExponential(1));
  chk('...doubling the range costs 5 log10 2',
      Math.abs(c.dbl - 5*Math.log10(2)) < 1e-12, c.dbl.toFixed(4) + ' mag');
  chk('...full phase gains 2.5 log10 pi',
      Math.abs(c.full + 2.5*Math.log10(Math.PI)) < 1e-12, c.full.toFixed(4) + ' mag');
  chk('...and a spacecraft backlit square-on is far out of sight',
      !(c.back <= c.lim + 20), 'mag ' + (isFinite(c.back) ? c.back.toFixed(1) : c.back));

  const g = r.geom;
  chk('range agrees with the look angles', g.n > 100 && g.worstRng < 1e-6,
      'worst ' + g.worstRng.toExponential(2) + ' km over ' + g.n + ' samples');
  /* 1e-7 rad, not 1e-12: acos near 0 and pi amplifies the last bits of the dot
     product the same way asin does for the solar elevation above. */
  chk('...and the phase angle with an inertial-frame recomputation', g.n > 100 && g.worstPh < 1e-7,
      'worst ' + g.worstPh.toExponential(2) + ' rad');

  const tally = v => { const o = {}; v.ps.forEach(p => { o[p.eye] = (o[p.eye] || 0) + 1; }); return o; };
  console.log('\n  a week of verdicts from 2026-09-15');
  for (const v of r.far.concat(r.near)) {
    const best = v.ps.filter(p => p.mag !== null).sort((a, b) => a.mag - b.mag)[0];
    console.log('   ' + v.name.padEnd(20) + ' std ' + v.std.mag.toFixed(1).padStart(4)
      + (v.std.known ? ' (published)' : ' (assumed) ')
      + '  ' + JSON.stringify(tally(v))
      + (best ? '   brightest ' + best.mag.toFixed(1) + ' at ' + best.rng.toFixed(0) + ' km' : ''));
  }
  for (const v of r.far) {
    const litDark = v.ps.filter(p => p.geo + p.pen > 0);
    const yes = v.ps.filter(p => p.eye === 'yes');
    const mags = litDark.filter(p => p.mag !== null).map(p => p.mag);
    chk(v.name + ' is never called naked-eye visible',
        v.n > 0 && yes.length === 0 && litDark.length > 0,
        litDark.length + ' of ' + v.n + ' passes lit against a dark sky, brightest est. mag '
        + (mags.length ? Math.min(...mags).toFixed(1) : '-'));
  }
  chk('...and each of those passes says too faint, above the limit',
      r.far.every(v => v.ps.every(p => p.geo + p.pen === 0
        || (p.eye === 'too faint' && p.mag > c.lim))));

  for (const v of r.near)
    chk(v.name + ' still comes out naked-eye visible on some pass',
        v.ps.some(p => p.eye === 'yes'), JSON.stringify(tally(v)));
  /* The same object both ways is the point of a range term: NOAA 15 is the
     same spacecraft on every pass, and only range and phase separate them. */
  const noaa = r.near[1];
  chk('...and too faint on others, which only range and phase can decide',
      noaa.ps.some(p => p.eye === 'too faint') && noaa.ps.some(p => p.eye === 'yes'),
      noaa.name + ' ' + JSON.stringify(tally(noaa)));
  const std = n => r.stds.find(s => s.name === n);
  chk('the published standard magnitudes are the ones used, and 5.0 otherwise',
      std('HST').known && std('HST').mag === 2.2 && std('ISS (ZARYA)').known
      && std('ISS (ZARYA)').mag === -1.8 && std('CSS (TIANHE-1)').known
      && !std('KNACKSAT-2').known && std('KNACKSAT-2').mag === c.S0,
      r.stds.map(s => s.name + ' ' + s.mag + (s.known ? '' : ' assumed')).join(', '));

  console.log('\n  entries on a station\'s element set');
  const hostMag = { 'ISS (ZARYA)': -1.8, 'HST': 2.2, 'CSS (TIANHE-1)': 0.0 };
  for (const d of r.docked)
    console.log('   ' + d.name.padEnd(22) + (d.host ? 'on ' + d.host + '\'s set' : 'published').padEnd(26)
      + ' std ' + d.mag.toFixed(1).padStart(4) + (d.via ? '  via ' + d.via : ''));
  const onIt = r.docked.filter(d => d.host);
  chk('every entry on a station\'s element set takes the station\'s published figure',
      onIt.length >= 9 && onIt.every(d => d.known && d.mag === hostMag[d.host] && d.via === d.host),
      onIt.length + ' entries: ' + onIt.map(d => d.name).join(', '));
  const nauka = r.docked.find(d => d.name === 'ISS (NAUKA)');
  chk('...ISS (NAUKA), which a search for "ISS" loads, among them at -1.8',
      !!nauka && nauka.mag === -1.8 && nauka.via === 'ISS (ZARYA)',
      nauka ? 'std ' + nauka.mag + ' via ' + nauka.via : 'not paired');
  chk('...and no entry off those sets takes a figure but the three it was published for',
      r.docked.every(d => d.host || (d.name in hostMag && d.via === null)),
      r.docked.filter(d => !d.host).map(d => d.name).join(', '));
  const rf = r.refresh;
  chk('a docked vehicle keeps the figure when a refresh moves its set off the station\'s',
      rf.moved.epoch !== '26255.20788499' && rf.moved.mag === -1.8 && rf.moved.via === 'ISS (ZARYA)',
      'epoch ' + rf.moved.epoch + ': std ' + rf.moved.mag + ' via ' + rf.moved.via);
  chk('...and an entry handed the station\'s set after the snapshot takes it up',
      rf.joined.satnum === '25338' && rf.joined.mag === -1.8 && rf.joined.via === 'ISS (ZARYA)',
      'NORAD ' + rf.joined.satnum + ': std ' + rf.joined.mag + ' via ' + rf.joined.via);
  chk('...both put back as they were',
      rf.after[0].via === 'ISS (ZARYA)' && !rf.after[1].known && rf.after[1].mag === c.S0);
  let gBad = null, gYes = 0, gN = 0;
  for (const g of r.groups) {
    const ref = g[0];
    gYes += ref.ps.filter(p => p.eye === 'yes').length; gN += ref.ps.length;
    for (const o of g.slice(1)) {
      const i = ref.ps.findIndex((p, k) => !o.ps[k] || o.ps[k].eye !== p.eye
        || Math.abs(o.ps[k].aos - p.aos) > 1000
        || (p.mag === null) !== (o.ps[k].mag === null) || Math.abs(o.ps[k].mag - p.mag) > 0.05);
      if ((i !== -1 || o.ps.length !== ref.ps.length) && !gBad)
        gBad = o.name + ' against ' + ref.name + ', pass ' + (i + 1);
    }
  }
  chk('the entries of one station agree pass by pass, verdict and estimate',
      !gBad && gYes > 0,
      gBad || r.groups.map(g => g.length + ' entries on ' + g[0].name).join(', ')
        + '; ' + gYes + ' naked-eye of ' + gN + ' passes on 2026-09-29');

  const all = r.far.concat(r.near), allP = [].concat(...all.map(v => v.ps));
  chk('a verdict of yes always rests on a fully sunlit estimate within the limit',
      allP.every(p => p.eye !== 'yes' || (p.mag <= c.lim && !p.pk && p.both <= p.geo)));
  chk('penumbra never counts towards naked-eye visible',
      all.every(v => v.penBad === 0), all.reduce((s, v) => s + v.penBad, 0) + ' penumbral samples counted');
  chk('...and was there to be excluded',
      all.reduce((s, v) => s + v.penSeen, 0) > 0,
      all.reduce((s, v) => s + v.penSeen, 0) + ' penumbral samples against a dark sky');

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
