/*
 * Range rate, and the Doppler shift that comes from it.
 *
 * The analytic form projects the spacecraft's BODY-FIXED velocity onto the line
 * of sight. Body-fixed is the whole point: it is the one frame where the ground
 * station is at rest, so the closing speed is a projection and nothing else. The
 * trap is that the fixed-frame velocity is not the propagated velocity with its
 * axes turned - the transport term -omega x r is what carries the observer, and
 * leaving it out is the classic error. At Bangkok it is worth 0.452 km/s.
 *
 * So the check is a NUMERICAL DERIVATIVE of the range itself, which knows
 * nothing about frames, transport terms or omega: it just asks how far away the
 * thing was a moment ago and a moment later. Two methods with almost nothing in
 * common, which is what makes the agreement mean something.
 *
 * It also runs the analytic form with the transport term deliberately removed,
 * to show what the check is actually sensitive to. A test that cannot fail is
 * not a test.
 *
 * ONE FLOOR, MEASURED RATHER THAN ASSUMED. The agreement cannot be made
 * arbitrarily good by shrinking h, because satellite.js carries time as a
 * Julian date - about 2.46e6 for these epochs, where a double's ulp is 4.02e-5
 * seconds. At 7.66 km/s that quantises the propagated position at 0.308 m, so
 * the differenced range carries eps/(2h) of noise no matter how exact the
 * propagation is. Shrinking h makes the check WORSE, which is how this was
 * found: the error grew from 1.6e-5 km/s at h = 8 s to 6e-4 at h = 0.0625 s,
 * flipping sign as it went, and matched eps/(2h) at every step. h is chosen
 * where that noise and the stencil's own truncation balance.
 *
 *   node verification/verify-doppler.js
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

  const res = await page.evaluate(() => {
    const gt = window.__gt, D = gt.D, track = D.track;

    /* Differentiate the range numerically. A plain 3-point central difference is
       not good enough here: its truncation is (h^2/6)*r''', and near closest
       approach the range curve is sharply bent - for a 383 km pass at 7 km/s,
       |r'''| peaks around 2.0e-3 km/s^3, so h = 0.5 s carries ~8e-5 km/s of its
       OWN error. Measured, that is exactly what showed up. The tolerance would
       then be describing the test rather than the code.

       The 5-point stencil is O(h^4) instead, and h is large because the real
       floor is the propagator's time quantisation described in the header, not
       truncation: eps/(2h) with eps = 3.08e-4 km. */
    const h = 4;
    const rangeAt = ms => { const s = gt.stateAt(track, ms); return s ? s.rng : null; };
    const numeric = ms => {
      const m2 = rangeAt(ms - 2*h*1000), m1 = rangeAt(ms - h*1000);
      const p1 = rangeAt(ms + h*1000),   p2 = rangeAt(ms + 2*h*1000);
      if (m2 === null || m1 === null || p1 === null || p2 === null) return null;
      return (m2 - 8*m1 + 8*p1 - p2) / (12*h);
    };

    const out = { name: D.entry.name, samples: [], passes: [] };
    const t0 = D.start.getTime(), span = D.hours*3600000;

    // across the whole window, not only during passes
    let worst = 0, worstAt = null, n = 0, sumAbs = 0, maxRR = 0;
    for (let k = 0; k <= 400; k++) {
      const ms = t0 + Math.round(span*k/400);
      const an = gt.rangeRateMs(track, ms), nu = numeric(ms);
      if (an === null || nu === null) continue;
      const d = Math.abs(an - nu);
      if (d > worst) { worst = d; worstAt = new Date(ms).toISOString(); }
      sumAbs += d; n++;
      maxRR = Math.max(maxRR, Math.abs(an));
    }
    out.sweep = { n, worst, mean: sumAbs/n, worstAt, maxRR };

    /* The same comparison with the transport term dropped, to show the check
       has teeth. Recomputed here rather than by touching the page's function. */
    let biasWorst = 0;
    const b = track.body, OBS = gt.OBS;
    for (let k = 0; k <= 200; k++) {
      const ms = t0 + Math.round(span*k/200);
      const st = track.at(ms);
      if (!st) continue;
      const theta = b.spin(new Date(ms));
      const rf = b.toFixed(st.r, theta), vf = b.toFixed(st.v, theta);
      const sf = b.siteFixed(OBS);
      const dx = rf.x-sf.x, dy = rf.y-sf.y, dz = rf.z-sf.z;
      const rng = Math.hypot(dx, dy, dz);
      const naive = (dx*vf.x + dy*vf.y + dz*vf.z)/rng;     // no -omega x r
      const nu = numeric(ms);
      if (nu === null) continue;
      biasWorst = Math.max(biasWorst, Math.abs(naive - nu));
    }
    out.naiveWorst = biasWorst;

    // Doppler at the edges and the middle of each pass
    const F = 437.0e6;
    for (const p of D.passes) {
      const at = ms => {
        const rr = gt.rangeRateMs(track, ms);
        return { rr, hz: gt.dopplerHz(F, rr) };
      };
      const a = at(p.aos.getTime()), c = at(p.maxAt.getTime()), l = at(p.los.getTime());
      out.passes.push({
        aos: p.aos.toISOString().substr(11, 8), maxEl: p.maxEl,
        aosRR: a.rr, culRR: c.rr, losRR: l.rr,
        aosKHz: a.hz/1000, culKHz: c.hz/1000, losKHz: l.hz/1000
      });
    }
    out.freq = F;
    return out;
  });

  console.log('\nspacecraft: ' + res.name + '\n');
  console.log('  analytic vs numerical derivative, ' + res.sweep.n + ' samples over the window');
  console.log('    worst |difference| : ' + res.sweep.worst.toExponential(3) + ' km/s   at ' + res.sweep.worstAt);
  console.log('    mean  |difference| : ' + res.sweep.mean.toExponential(3) + ' km/s');
  console.log('    peak  |range rate| : ' + res.sweep.maxRR.toFixed(4) + ' km/s\n');

  /* 1e-4 km/s = 10 cm/s. The floor is the propagator's 0.308 m position
     quantisation over the 8 s stencil, not the formula being checked. */
  chk('the analytic range rate matches a numerical derivative of the range',
      res.sweep.worst < 1e-4, 'worst = ' + res.sweep.worst.toExponential(2) + ' km/s');
  /* The two methods share only the propagator, so agreement at this level says
     the frame handling is right, not merely self-consistent. */
  chk('...to far better than the observer term it depends on',
      res.sweep.worst < 0.452 * 1e-3,
      'worst is ' + (0.452/res.sweep.worst).toExponential(1) + 'x smaller than Bangkok\'s own 0.452 km/s');
  /* A gate that cannot fail is not a gate. */
  chk('dropping the -omega x r transport term DOES break it',
      res.naiveWorst > 0.1,
      'naive worst error = ' + res.naiveWorst.toFixed(4) + ' km/s'
      + '  (' + (res.naiveWorst/res.sweep.worst).toExponential(1) + 'x the real one)');

  console.log('\n  Doppler at ' + (res.freq/1e6).toFixed(3) + ' MHz');
  console.log('   AOS(UTC)   maxEl    ṙ AOS     ṙ cul     ṙ LOS      kHz AOS   kHz cul   kHz LOS');
  for (const p of res.passes)
    console.log('   ' + p.aos + '   ' + p.maxEl.toFixed(1).padStart(5)
      + '   ' + p.aosRR.toFixed(4).padStart(8) + '  ' + p.culRR.toFixed(4).padStart(8)
      + '  ' + p.losRR.toFixed(4).padStart(8)
      + '   ' + p.aosKHz.toFixed(2).padStart(8) + '  ' + p.culKHz.toFixed(2).padStart(8)
      + '  ' + p.losKHz.toFixed(2).padStart(8));

  /* Only for passes that lie wholly inside the analysis window.
     The window opens at the moment the check runs, so whatever the spacecraft
     was doing at that instant is where the first pass begins - and if it was
     already above the mask and already going away, that pass has its maximum
     elevation at its own first sample. Its range rate is then positive at AOS
     and identical at culmination, which is not the Doppler being wrong: it is
     a pass cut in half by the clock. Asserting the approach-then-recede shape
     over it made this check fail depending on the time of day it ran.
     A clipped pass is the one whose culmination sits on its own AOS. */
  const whole = res.passes.filter(p => p.culRR !== p.aosRR);
  const clipped = res.passes.length - whole.length;
  const signs = whole.every(p => p.aosRR < 0 && p.losRR > 0);
  chk('\n  every complete pass approaches then recedes', signs,
      'ṙ negative at AOS and positive at LOS on all ' + whole.length
        + (clipped ? ' (' + clipped + ' clipped by the window edge, skipped)' : ''));
  const culm = whole.every(p => Math.abs(p.culRR) < Math.abs(p.aosRR));
  chk('  range rate is smallest at culmination', culm,
      'the closing speed passes through zero near closest approach');

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
