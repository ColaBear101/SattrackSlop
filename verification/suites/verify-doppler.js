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
 * Last, the live line under the downlink box (#doplive, CHANGES-FROM-LEGACY.md
 * L52): scrubbed into a pass, with a downlink and an uplink typed in, and then
 * live, its figures are worked out again here from the range rate and the law
 * written out, and it must say which instant they are for.
 *
 *   node verification/suites/verify-doppler.js
 */
const H = require('../lib/harness');
const path = require('path');
const { chromium } = H.playwright();

let PAGE = null;   // an http URL from H.up(): the bundled app cannot be opened from file://

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

(async () => {
  const __srv = await H.up(); PAGE = __srv.page;
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

  /* ---- the live line under the downlink box (CHANGES-FROM-LEGACY.md, L52) ----------------------------------------------
     #doplive gives the frequency to receive on at one instant, for the downlink chosen above it, and the frequency to send
     on for an uplink typed into it. The page computes them with lib/analysis/tune.ts; here they are worked out again from
     the range rate the test surface gives, with the law written out, f (1 - rr/c) down and f / (1 - rr/c) up, at the
     instant the line says it is for (data-ms). The figure is printed to the hertz, so it must be within half of one.
     The clock is put 30 % of the way into a pass, where the range rate is several km/s and the shift several kHz: at
     culmination it is near nought, and a line that ignored it would pass. */
  console.log('\n  the live line under the downlink box');
  await page.waitForSelector('#doplive', { timeout: 15000 });
  const HZ = s => { const m = /^(\d+)\.(\d{3}) (\d{3}) MHz$/.exec(s || ''); return m ? +m[1] * 1e6 + +(m[2] + m[3]) : null; };
  const KHZ = s => { const m = /^([+−])(\d+\.\d{3}) kHz$/.exec(s || ''); return m ? (m[1] === '−' ? -1 : 1) * +m[2] : null; };
  const lineNow = () => page.evaluate(() => {
    const gt = window.__gt, el = document.getElementById('doplive'), ms = +el.dataset.ms;
    const t = id => { const e = document.getElementById(id); return e ? e.textContent : null; };
    const s = gt.stateAt(gt.D.track, ms);
    const shift = id => { const e = document.getElementById(id); return e && e.nextElementSibling ? e.nextElementSibling.textContent : null; };
    return { ms, wall: Date.now(), at: t('doplive-at'), go: !!document.getElementById('doplive-go'), rx: t('doplive-rx'), rxd: shift('doplive-rx'),
             tx: t('doplive-tx'), txd: shift('doplive-tx'), up: document.getElementById('dopup').value,
             rr: gt.rangeRateMs(gt.D.track, ms), el: s ? s.el : null, C: gt.C_KMS, MASK: gt.MASK,
             sel: (() => { const o = document.querySelector('#dopsel option:checked'); return o && o.value !== 'c' ? +o.value : null; })(),
             playing: document.getElementById('tpplay').getAttribute('aria-label') === 'Pause' };
  });
  /* the line's figure against the law, at its own instant: within half a hertz, the printed figure's rounding */
  const law = (L, f) => f * (1 - L.rr / L.C);
  const lawUp = (L, f) => f / (1 - L.rr / L.C);
  const near = (shown, want) => shown !== null && Math.abs(shown - want) <= 0.5 + 1e-6;

  const mid = await page.evaluate(() => {
    const D = window.__gt.D, t0 = D.start.getTime(), st = D.step * 1000;
    const p = D.passes.find(q => q.t0ms > t0 + st && q.t1ms < D.end.getTime() - st) || D.passes[0];
    const k = Math.round((p.t0ms + 0.3 * (p.t1ms - p.t0ms) - t0) / st);
    const r = document.getElementById('time');
    r.value = String(k);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return { ms: t0 + k * st, aos: p.aos.toISOString() };
  });
  await page.waitForTimeout(400);
  let L = await lineNow();
  const iso = ms => new Date(ms).toISOString();
  const whenZ = ms => iso(ms).slice(5, 10) + ' ' + iso(ms).slice(11, 19) + 'Z';
  chk('scrubbed 30 % into the pass from ' + mid.aos + ', the line is for the clock\'s instant and says so',
      L.ms === mid.ms && L.at === 'Tune at sim time ' + whenZ(mid.ms) && L.go && !L.playing,
      JSON.stringify({ at: L.at, ms: iso(L.ms), go: L.go }));
  chk('...and the spacecraft is above the mask there, so the line does not say it is below', L.el >= L.MASK && !/below/.test(L.at), 'el ' + (L.el === null ? null : L.el.toFixed(1)) + '°');
  if (L.sel !== null) {
    chk('the frequency to receive on is the downlink chosen in the box, ' + (L.sel / 1e6).toFixed(3) + ' MHz, times (1 - rr/c), to the hertz',
        near(HZ(L.rx), law(L, L.sel)), L.rx + ' vs ' + law(L, L.sel).toFixed(2) + ' Hz  (rr ' + L.rr.toFixed(4) + ' km/s)');
  } else chk('the spacecraft on screen has a downlink chosen from the table to check the line against', false, 'no #dopsel selection');

  /* a frequency typed into the box: the line follows the store, not the table */
  const F = await page.evaluate(() => {
    const i = document.getElementById('dopfreq');
    i.value = '437.1'; i.dispatchEvent(new Event('change', { bubbles: true }));
    return parseFloat('437.1') * 1e6;
  });
  await page.waitForTimeout(300);
  L = await lineNow();
  chk('typed 437.100 MHz, the line receives on f (1 - rr/c) with f the typed frequency, to the hertz',
      near(HZ(L.rx), law(L, F)), L.rx + ' vs ' + law(L, F).toFixed(2) + ' Hz');
  chk('...the range rate there is large enough for that to mean something (|rr| > 1 km/s, a shift of more than 1.4 kHz)',
      Math.abs(L.rr) > 1 && Math.abs(HZ(L.rx) - F) > 1400, 'rr ' + L.rr.toFixed(4) + ' km/s');
  chk('...and the shift beside it is the figure less the downlink, to the hertz',
      KHZ(L.rxd) !== null && Math.abs(KHZ(L.rxd) * 1000 - Math.round(law(L, F) - F)) <= 1, L.rxd);
  const pausedBefore = { rx: L.rx, ms: L.ms };

  /* an uplink: the frequency to send on is f / (1 - rr/c), which the same law brings back to exactly f on board */
  const U = await page.evaluate(() => {
    const i = document.getElementById('dopup');
    i.value = '145.9'; i.dispatchEvent(new Event('change', { bubbles: true }));
    return parseFloat('145.9') * 1e6;
  });
  await page.waitForTimeout(300);
  L = await lineNow();
  chk('an uplink of 145.900 MHz typed in: the line says to transmit on f / (1 - rr/c), to the hertz',
      near(HZ(L.tx), lawUp(L, U)), L.tx + ' vs ' + lawUp(L, U).toFixed(2) + ' Hz');
  chk('...which the spacecraft, ' + (L.rr < 0 ? 'approaching' : 'receding') + ', hears as 145.900 MHz (to the hertz), and its shift has the opposite sign to the downlink\'s',
      Math.abs(HZ(L.tx) * (1 - L.rr / L.C) - U) <= 1 && Math.sign(KHZ(L.txd)) === -Math.sign(KHZ(L.rxd)), L.txd + ' against ' + L.rxd);

  await page.waitForTimeout(700);
  L = await lineNow();
  chk('paused, the line is not repainted (nothing changes while the clock stands still)', L.rx === pausedBefore.rx && L.ms === pausedBefore.ms, L.rx);

  /* Go live: real time, running, at the wall clock. The line then says "now" and is worked out for the wall clock. */
  await page.click('#doplive-go');
  await page.waitForTimeout(500);
  L = await lineNow();
  chk('Go live runs the clock and the line says "now", with no Go live button',
      /^Tune now( · below the \d+° mask)?$/.test(L.at) && !L.go && L.playing, L.at);
  chk('...its instant is the wall clock (within a second of the page\'s Date.now())', Math.abs(L.wall - L.ms) <= 1000, (L.wall - L.ms) + ' ms');
  chk('...and it is right there too: receive f (1 - rr/c), transmit f / (1 - rr/c), to the hertz',
      near(HZ(L.rx), law(L, F)) && near(HZ(L.tx), lawUp(L, U)), L.rx + ', ' + L.tx);
  chk('...and it says "below the mask" exactly when the spacecraft is under it at that instant',
      /below the 5° mask/.test(L.at) === (L.el < L.MASK), L.at + ' (el ' + L.el.toFixed(1) + '°)');
  await page.waitForTimeout(600);
  const L2 = await lineNow();
  chk('...and, running, it moves with the clock', L2.ms > L.ms, (L2.ms - L.ms) + ' ms later');

  /* the uplink is the spacecraft's it was typed for: another spacecraft has an empty box and no transmit line */
  await H.pickExact(page, 'ISS (ZARYA)');
  await page.waitForFunction(() => window.__gt.D.entry.name === 'ISS (ZARYA)', null, { timeout: 15000 });
  await page.waitForTimeout(400);
  L = await lineNow();
  chk('another spacecraft: the uplink box is empty and there is no transmit line', L.up === '' && L.tx === null, JSON.stringify({ up: L.up, tx: L.tx }));

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
