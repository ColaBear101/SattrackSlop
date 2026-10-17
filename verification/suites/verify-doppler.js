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
 * written out, and it must say which instant they are for. Paused, it must do
 * no work (counted, not read off the text), and Go live must leave the focus in
 * it. The old page has no such line, so with GT_TARGET=legacy this part says so
 * and is skipped; the range-rate checks above run on either page.
 *
 * Then the transponder calculator that ends the line ("Uplink and transponders",
 * L63), on the rebuilt page only: its chunk and its table asked for at the first
 * opening and not before; the ISS's voice repeater (a pair) and FO-29 (JAS 2, an
 * inverting linear passband) at the clock's instant, worked out again here from
 * the range rate and the transponder's map written out; the nudges, the three
 * holds, a decimal comma, a frequency outside the passband and one far from it;
 * no coupling to the downlink box, the Doppler rows or the uplink box; the keys a
 * field and the summary keep; the offset, refused while scrubbed, set live from a
 * frequency typed (against the snapshot the panel took when the typing began),
 * refused when far, kept only on a press, surviving a reload, and reset; a table
 * that did not come, and Try again; no work while paused (choosing and nudging
 * included) or shut, and no more while open; nothing asked of SatNOGS; and a
 * calculator chunk that did not come, which leaves the summary as it was.
 *
 *   node verification/suites/verify-doppler.js
 */
const H = require('../lib/harness');
const path = require('path');
const { chromium } = H.playwright();
const NEW = H.targetName() === 'new';   // the live line under the downlink box is the rebuilt page's alone (L52)

let PAGE = null;  // an http URL from H.up(): the bundled app cannot be opened from file://

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
  /* every request of the visit, for the transponder calculator's checks (its chunk and table asked for at the first opening, and
     never anything of SatNOGS's) */
  const reqs = [];
  page.on('request', r => reqs.push(r.url()));
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

  if (NEW) {
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

    /* Paused, the line does no work. Its text cannot show that: worked out again at the same instant it would read the
       same, and Svelte does not rewrite a text or an attribute that has not changed. So the work is counted: the line's
       one way to the orbit is the engine's stateAt (lib/analysis/tune.ts), and the engine is a live object the test
       surface hands out (__gt.eng), so stateAt is wrapped with a counter while the clock stands still (nothing else
       calls it through the engine while the AR view is shut, and the counter is read before this suite asks it
       anything), and then while the clock is moved one step, which must be counted at once: a counter that never moved
       would prove nothing either. */
    await page.evaluate(() => {
      const eng = window.__gt.eng, own = eng.stateAt;
      const w = window.__tuneWork = { calls: 0, undo: () => { eng.stateAt = own; } };
      eng.stateAt = function (...a) { w.calls++; return own.apply(this, a); };
    });
    await page.waitForTimeout(700);
    const pausedCalls = await page.evaluate(() => window.__tuneWork.calls);
    L = await lineNow();
    chk('paused for 0.7 s, the line asks the engine for nothing (no state is worked out while the clock stands still)', pausedCalls === 0, pausedCalls + ' calls');
    chk('...and it stays on the clock\'s instant, with the same figure (it does not drift to the wall clock)', L.rx === pausedBefore.rx && L.ms === pausedBefore.ms, L.rx);
    const stepped = await page.evaluate(async () => {
      const w = window.__tuneWork, r = document.getElementById('time'), t0 = performance.now();
      w.calls = 0;
      r.value = String(+r.value + 1);
      r.dispatchEvent(new Event('input', { bubbles: true }));
      while (!w.calls && performance.now() - t0 < 2000) await new Promise(f => setTimeout(f, 10));
      const out = { calls: w.calls, after: Math.round(performance.now() - t0), step: window.__gt.D.step * 1000 };
      w.undo();
      return out;
    });
    L = await lineNow();
    chk('...and moved one step, it is worked out again at once, for the new instant',
        stepped.calls >= 1 && stepped.after <= 200 && L.ms === pausedBefore.ms + stepped.step,
        stepped.calls + ' call(s) within ' + stepped.after + ' ms; ' + iso(pausedBefore.ms) + ' -> ' + iso(L.ms));

    /* Go live: real time, running, at the wall clock. The line then says "now" and is worked out for the wall clock. It is
       pressed from the keyboard: the button goes as the line turns live, and the focus it had must stay in the line (on its
       caption) rather than fall to the page. Chromium alone would send the next Tab on from where the button was (it keeps
       a starting point for it), so it is where the focus is at once that is checked; the Tab after it is checked too. */
    await page.focus('#doplive-go');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    L = await lineNow();
    chk('Go live, pressed with Enter, runs the clock and the line says "now", with no Go live button',
        /^Tune now( · below the \d+° mask)?$/.test(L.at) && !L.go && L.playing, L.at);
    const focusAt = () => page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.id || a.tagName) : 'body'; });
    const fGo = await focusAt();
    await page.keyboard.press('Tab');
    const fTab = await focusAt();
    chk('...the focus stays in the line, on the caption that says "now", and the next Tab goes on to the Uplink box',
        fGo === 'doplive-at' && fTab === 'dopup', fGo + ', then ' + fTab);
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

    /* ---- the transponder calculator (CHANGES-FROM-LEGACY.md, L63) --------------------------------------------------------
       "Uplink and transponders", the disclosure that ends the line, mounts a panel that is a chunk of its own (xpdr) and fetches
       the table, data/transponders.json, a file of its own, at its first opening. Its figures are for the line's instant
       (data-ms on #xpdr-panel, the same as #doplive's) from the range rate the line worked out there, and are worked out again
       here from __gt's range rate at that instant with the laws and the transponder's map written out: up, fu = tx (1 - rr/c);
       the map, S - fu for an inverting passband (S = ulLo + dlHi) plus the spacecraft's offset; down, rx = fd (1 - rr/c); and
       backwards with f / (1 - rr/c). Printed to the hertz, so within half of one. */
    console.log('\n  the transponder calculator at the end of the line');
    const XPDR_JS = /\/assets\/xpdr-[A-Za-z0-9_-]{8}\.js$/, XPDR_TABLE = /\/assets\/transponders-[A-Za-z0-9_-]{8}\.json$/;
    const nReq = re => reqs.filter(u => re.test(u)).length;
    /* the panel's figures: 435.847 101 MHz (narrow no-break space between the groups, no-break space before the unit), +1.460 kHz,
       the On board row "145.948 541 → 435.851 460 MHz" and how far outside "0.459 kHz below" */
    const HZS = s => { const m = /^(\d+)\.(\d{3})\s(\d{3})\sMHz$/.exec(s || ''); return m ? +m[1] * 1e6 + +(m[2] + m[3]) : null; };
    const KHZS = s => { const m = /^([+−])(\d+\.\d{3}) kHz$/.exec(s || ''); return m ? (m[1] === '−' ? -1 : 1) * Math.round(+m[2] * 1000) : null; };
    const SATS = s => { const m = /^(\d+)\.(\d{3})\s(\d{3}) → (\d+)\.(\d{3})\s(\d{3})\sMHz$/.exec(s || ''); return m ? [+m[1] * 1e6 + +(m[2] + m[3]), +m[4] * 1e6 + +(m[5] + m[6])] : null; };
    const AMT = s => { const m = /^(\d+\.\d{3}) (kHz|MHz) (below|above)$/.exec(s || ''); return m ? { hz: Math.round(+m[1] * (m[2] === 'MHz' ? 1e6 : 1e3)), side: m[3] } : null; };
    const xp = () => page.evaluate(() => {
      const gt = window.__gt, p = document.getElementById('xpdr-panel'), d = document.getElementById('xpdr');
      const t = id => { const e = document.getElementById(id); return e ? e.textContent : null; };
      const sib = id => { const e = document.getElementById(id); return e && e.nextElementSibling ? e.nextElementSibling.textContent : null; };
      const ms = p && p.dataset.ms ? +p.dataset.ms : null, cal = document.getElementById('xpdr-cal');
      return { open: !!d && d.open, ms, rr: ms === null ? null : gt.rangeRateMs(gt.D.track, ms), C: gt.C_KMS, name: gt.D.entry.name,
               tx: t('xpdr-tx'), txd: sib('xpdr-tx'), rx: t('xpdr-rx'), rxd: sib('xpdr-rx'), sat: t('xpdr-sat'), satd: t('xpdr-satd'), out: t('xpdr-out'),
               mode: t('xpdr-mode'), off: t('xpdr-off'), said: t('xpdr-offsay'), src: t('xpdr-src'), none: t('xpdr-none'), fail: t('xpdr-fail'),
               dial: (document.getElementById('xpdr-dial') || {}).value ?? null, hold: (document.querySelector('#xpdr [aria-pressed="true"]') || {}).id || null,
               cal: cal ? cal.getAttribute('aria-disabled') : 'absent', pred: p && p.dataset.pred !== undefined ? +p.dataset.pred : null,
               predMs: p && p.dataset.predMs !== undefined ? +p.dataset.predMs : null, at: document.getElementById('doplive-at').textContent,
               opts: [...document.querySelectorAll('#xpdrsel option')].map(o => o.textContent), sel: (document.getElementById('xpdrsel') || {}).value ?? null,
               ids: ['xpdr-hold-tx', 'xpdr-hold-rx', 'xpdr-hold-sat', 'xpdr-dial', 'xpdr-cal', 'xpdr-heard', 'xpdr-sat', 'xpdr-out', 'xpdr-off'].filter(i => document.getElementById(i)),
               kept: localStorage.getItem('gt.xpdr') };
    });
    const up1 = (X, f) => f * (1 - X.rr / X.C);                 // R: what the other side hears
    const upT = (X, f) => f / (1 - X.rr / X.C);                 // T: R's inverse
    const half = (shown, want) => shown !== null && Math.abs(shown - want) <= 0.5 + 1e-6;
    const choose = i => page.evaluate(k => { const s = document.getElementById('xpdrsel'); s.value = String(k); s.dispatchEvent(new Event('change', { bubbles: true })); }, i);
    const typeDial = async v => { await page.fill('#xpdr-dial', v); await page.press('#xpdr-dial', 'Enter'); await page.waitForTimeout(200); };
    /* a click as a pointer makes it; forced through Playwright's own wait for an enabled control where the button says it cannot be pressed now
       (aria-disabled: it stays focusable and pressable, and a press says why) */
    const press = async (sel, force) => { await page.click(sel, force ? { force: true } : undefined); await page.waitForTimeout(200); };
    /* what golden reads beside it, and the uplink box: the calculator must move none of them */
    const coupled = () => page.evaluate(() => ({
      sel: (document.querySelector('#dopsel option:checked') || {}).value ?? null, freq: document.getElementById('dopfreq').value,
      up: document.getElementById('dopup').value, facts: document.getElementById('skyfacts').textContent
    }));

    /* 1. nothing of it before the first opening */
    const shut0 = await page.evaluate(() => {
      const d = document.getElementById('xpdr'), live = document.getElementById('doplive');
      return d ? { open: d.open, summary: d.querySelector('summary').textContent, last: live.lastElementChild === d, panel: !!document.getElementById('xpdr-panel') } : null;
    });
    chk('"Uplink and transponders" ends the live line, shut, and before it is opened neither the calculator\'s chunk nor its table has been asked for',
        !!shut0 && !shut0.open && shut0.summary === 'Uplink and transponders' && shut0.last && !shut0.panel && nReq(XPDR_JS) === 0 && nReq(XPDR_TABLE) === 0,
        JSON.stringify(shut0) + '; xpdr ' + nReq(XPDR_JS) + ', transponders ' + nReq(XPDR_TABLE));

    /* 2. the ISS (on screen, live): Enter on the summary; the voice repeater, a pair with a CTCSS tone */
    const coupled0 = await coupled();
    await page.focus('#xpdr summary');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#xpdrsel', { timeout: 15000 });
    await page.waitForTimeout(300);
    let X = await xp();
    chk('Enter on the summary opens it: the chunk and the table are asked for once each, and the ISS lists its records with an uplink, the crew\'s two FM channels to 145.800 MHz and the voice repeater among them',
        X.open && nReq(XPDR_JS) === 1 && nReq(XPDR_TABLE) === 1 && X.opts.includes('144.490 → 145.800 MHz  FM') && X.opts.includes('145.200 → 145.800 MHz  FM') && X.opts.includes('145.990 → 437.800 MHz  FM'),
        X.opts.join(' | '));
    await choose(X.opts.indexOf('145.990 → 437.800 MHz  FM'));
    await page.waitForTimeout(300);
    X = await xp();
    chk('the voice repeater: send on 145.990 MHz / (1 - rr/c) and listen on 437.800 MHz x (1 - rr/c), at the panel\'s instant, to the hertz; its mode and its CTCSS tone',
        X.name === 'ISS (ZARYA)' && half(HZS(X.tx), upT(X, 145.99e6)) && half(HZS(X.rx), up1(X, 437.8e6)) && X.mode === 'Mode FM · CTCSS tone 67.0 Hz'
          && KHZS(X.txd) === Math.round(HZS(X.tx) - 145.99e6) && KHZS(X.rxd) === Math.round(HZS(X.rx) - 437.8e6),
        X.tx + ' ' + X.txd + ', ' + X.rx + ' ' + X.rxd + ', "' + X.mode + '" (rr ' + (X.rr === null ? null : X.rr.toFixed(4)) + ' km/s)');
    chk('...a pair has nothing to hold: no hold, no dial, no on-board row, no offset (#xpdr-hold-tx, -rx, -sat, #xpdr-dial, #xpdr-cal ... all absent)', X.ids.length === 0, X.ids.join(', ') || 'none');
    chk('...and its instant is the live line\'s', X.ms === +(await page.evaluate(() => document.getElementById('doplive').dataset.ms)), String(X.ms));
    const coupledI = await coupled();
    chk('...and opening it and choosing a record moved nothing of the downlink box, its list, the uplink box or the pass\'s facts and Doppler rows (golden reads them)',
        JSON.stringify(coupledI) === JSON.stringify(coupled0), JSON.stringify(coupledI).slice(0, 160));

    /* 3. FO-29 (JAS 2): an inverting V/U passband, 145.900-146.000 -> 435.900-435.800 MHz, at a scrubbed instant 30 % into a pass */
    await H.pickExact(page, 'JAS 2');
    await page.waitForFunction(() => window.__gt.D.entry.name === 'JAS 2', null, { timeout: 15000 });
    await page.evaluate(() => { const b = document.getElementById('tpplay'); if (b.getAttribute('aria-label') === 'Pause') b.click(); });
    const midJ = await page.evaluate(() => {
      const D = window.__gt.D, t0 = D.start.getTime(), st = D.step * 1000;
      const p = D.passes.find(q => q.t0ms > t0 + st && q.t1ms < D.end.getTime() - st) || D.passes[0];
      const k = Math.round((p.t0ms + 0.3 * (p.t1ms - p.t0ms) - t0) / st);
      const r = document.getElementById('time');
      r.value = String(k);
      r.dispatchEvent(new Event('input', { bubbles: true }));
      return { ms: t0 + k * st, aos: p.aos.toISOString() };
    });
    await page.waitForTimeout(400);
    X = await xp();
    const coupledJ = await coupled();
    const S29 = 145.9e6 + 435.9e6;
    const fo29 = (Y, tx, off = 0) => { const fu = up1(Y, tx), fd = S29 - fu + off; return { fu, fd, rx: up1(Y, fd) }; };
    let W = fo29(X, 145.95e6);
    chk('another spacecraft, JAS 2 (FO-29): the disclosure is still open and lists its one passband, held on the 2 m side (Send) at its centre, 145.950000 MHz',
        X.open && X.opts.length === 1 && X.opts[0] === '145.900–146.000 → 435.900–435.800 MHz inverting  USB' && X.hold === 'xpdr-hold-tx' && X.dial === '145.950000',
        JSON.stringify({ open: X.open, opts: X.opts, hold: X.hold, dial: X.dial }));
    chk('scrubbed 30 % into the pass from ' + midJ.aos + ': listen on (581.8 MHz - tx (1 - rr/c)) (1 - rr/c), to the hertz, at the clock\'s instant; send on the dial',
        X.ms === midJ.ms && Math.abs(X.rr) > 1 && half(HZS(X.rx), W.rx) && HZS(X.tx) === 145.95e6
          && Math.abs(KHZS(X.rxd) - (W.rx - W.fd)) <= 1 && Math.abs(KHZS(X.txd) - (145.95e6 - W.fu)) <= 1,
        X.rx + ' ' + X.rxd + ' vs ' + W.rx.toFixed(2) + ' Hz (rr ' + X.rr.toFixed(4) + ' km/s)');
    const sat0 = SATS(X.sat);
    chk('...the On board row is what the spacecraft hears and sends, to the hertz; inside the passband, so no warning; the sideband to send; the source',
        !!sat0 && Math.abs(sat0[0] - W.fu) <= 0.5 + 1e-6 && Math.abs(sat0[1] - W.fd) <= 0.5 + 1e-6 && X.satd === '' && X.out === ''
          && X.mode === 'Send LSB, heard as USB' && X.src === 'From SatNOGS DB, 2026-10-17 · Mode V/U Linear Transponder',
        X.sat + ' "' + X.satd + '" "' + X.out + '" ' + X.mode);

    /* 4. the nudges: +1 kHz twice moves the transmit dial 2 kHz up, and through an inverting passband the receive figure DOWN */
    const rx0 = W.rx;
    await press('#xpdr-p-1k');
    await press('#xpdr-p-1k');
    X = await xp();
    W = fo29(X, 145.952e6);
    chk('+1 kHz twice: the dial reads 145.952000, and the receive figure moves down by 2 kHz x (1 - rr/c)^2 (inverting), to the hertz',
        X.dial === '145.952000' && half(HZS(X.rx), W.rx) && Math.abs((HZS(X.rx) - rx0) + 2000 * (1 - X.rr / X.C) ** 2) <= 1, X.dial + ', ' + X.rx + ' (' + (HZS(X.rx) - rx0).toFixed(1) + ' Hz)');

    /* 5. the holds: Listen keeps the receive figure and works the transmit one backwards; On board keeps the spot in the passband */
    const rxHeld = HZS(X.rx);
    await press('#xpdr-hold-rx');
    X = await xp();
    chk('Listen held: the dial takes the receive figure (to the hertz) and it does not move; send on T(S - T(rx)), to the hertz',
        X.hold === 'xpdr-hold-rx' && X.dial === (rxHeld / 1e6).toFixed(6) && HZS(X.rx) === rxHeld && half(HZS(X.tx), upT(X, S29 - upT(X, rxHeld))),
        X.dial + ', ' + X.rx + ', ' + X.tx);
    const fuHeld = SATS(X.sat)[0];
    await press('#xpdr-hold-sat');
    X = await xp();
    chk('On board held: the dial takes the uplink the spacecraft hears; send on T(fu), listen on R(S - fu), to the hertz',
        X.hold === 'xpdr-hold-sat' && Math.abs(+X.dial * 1e6 - fuHeld) <= 1 && half(HZS(X.tx), upT(X, +X.dial * 1e6)) && half(HZS(X.rx), up1(X, S29 - +X.dial * 1e6)),
        X.dial + ', ' + X.tx + ', ' + X.rx);
    await press('#xpdr-hold-tx');

    /* 6. typed: a decimal comma, a frequency outside the passband on board, one far from it, and one that is not a frequency */
    await typeDial('145,952');
    X = await xp();
    W = fo29(X, 145.952e6);
    chk('"145,952" typed (a comma-decimal keypad) reads 145.952 MHz: written back as 145.952000, and the figures follow', X.dial === '145.952000' && half(HZS(X.rx), W.rx), X.dial + ', ' + X.rx);
    await typeDial('145.890');
    X = await xp();
    W = fo29(X, 145.89e6);
    const a6 = AMT(X.satd);
    chk('145.890 MHz: the spacecraft hears it below the passband, by 145.900 MHz - tx (1 - rr/c) (to the hertz, beside the On board row), and the warning says it relays nothing',
        !!a6 && a6.side === 'below' && Math.abs(a6.hz - (145.9e6 - W.fu)) <= 1 && X.out === '⚠ Outside the passband: the spacecraft hears you below it, and relays nothing.' && half(HZS(X.rx), W.rx),
        '"' + X.satd + '" vs ' + (145.9e6 - W.fu).toFixed(1) + ' Hz; "' + X.out + '"');
    await typeDial('435.850');
    X = await xp();
    chk('435.850 MHz, FO-29\'s downlink, typed as the transmit frequency: no figure to listen on and no on-board row, and where the uplink is',
        HZS(X.tx) === 435.85e6 && X.rx === '—' && X.rxd === '' && X.sat === '—' && X.out === '⚠ Not in this transponder\'s uplink, 145.900–146.000 MHz', X.tx + ' / ' + X.rx + ' / ' + X.sat + ' / ' + X.out);
    await typeDial('145.95.5');
    X = await xp();
    chk('"145.95.5" is not a frequency: dashes, no warning, and the box keeps what was typed', X.dial === '145.95.5' && X.tx === '—' && X.rx === '—' && X.sat === '—' && X.out === '', JSON.stringify([X.dial, X.tx, X.rx, X.out]));

    /* the keys: a field's arrows move its caret, not the clock; Space on the summary toggles it, not the clock */
    await typeDial('145.950');
    const keys0 = await page.evaluate(() => ({ t: document.getElementById('time').value, ms: document.getElementById('doplive').dataset.ms, play: document.getElementById('tpplay').getAttribute('aria-label') }));
    await page.focus('#xpdr-dial');
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(k);
    await page.waitForTimeout(250);
    const keys1 = await page.evaluate(() => ({ t: document.getElementById('time').value, ms: document.getElementById('doplive').dataset.ms, dial: document.getElementById('xpdr-dial').value }));
    chk('the arrow keys in the dial leave the clock where it is (and the dial too)', keys1.t === keys0.t && keys1.ms === keys0.ms && keys1.dial === '145.950000', JSON.stringify([keys0, keys1]));
    await page.focus('#xpdr summary');
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const sp1 = await page.evaluate(() => ({ open: document.getElementById('xpdr').open, play: document.getElementById('tpplay').getAttribute('aria-label') }));
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const sp2 = await page.evaluate(() => ({ open: document.getElementById('xpdr').open, play: document.getElementById('tpplay').getAttribute('aria-label'), sel: !!document.getElementById('xpdrsel') }));
    chk('Space on the summary shuts and opens it, and does not start or stop the clock', !sp1.open && sp2.open && sp2.sel && sp1.play === keys0.play && sp2.play === keys0.play, JSON.stringify([sp1, sp2]));
    const coupled1 = await coupled();
    chk('the nudges, the holds, the typing and the keys moved nothing of the downlink box, its list, the uplink box or the pass\'s facts and Doppler rows',
        JSON.stringify(coupled1) === JSON.stringify(coupledJ), JSON.stringify(coupled1).slice(0, 160));

    /* 7. the offset. Set offset is refused while the line is not live (your own signal is heard now, not at a scrubbed instant), and
       nothing is stored until a press that sets it. Live, with the dial back at the centre, inside the passband: the receive figure is
       read, 300 Hz above it is typed as heard, and the press sets the offset from the snapshot the panel took when the typing began
       (data-pred, data-pred-ms): (heard - pred) / (1 - rr/c) at that instant, to the hertz. The figure read before the typing is not
       what is compared: live, it moves by up to tens of hertz a second. */
    X = await xp();
    chk('scrubbed, Set offset says it cannot be pressed now (aria-disabled, with the hint under it)', X.cal === 'true', 'aria-disabled ' + X.cal);
    await press('#xpdr-cal', true);
    X = await xp();
    chk('...and a press says why, and stores nothing; nothing at all is stored after opening, choosing, holding, nudging and typing',
        X.said === 'Set offset works only while the line above says Tune now and the spacecraft hears you inside its passband.' && X.kept === null, '"' + X.said + '", gt.xpdr ' + X.kept);
    await page.click('#doplive-go');
    await page.waitForFunction(() => /^Tune now/.test(document.getElementById('doplive-at').textContent), null, { timeout: 5000 });
    await choose(0);
    await page.waitForTimeout(300);
    X = await xp();
    chk('live, the record chosen again: the dial is back at the centre, the spacecraft hears it inside the passband, and Set offset can be pressed',
        /^Tune now/.test(X.at) && X.dial === '145.950000' && X.out === '' && X.cal === null, JSON.stringify({ at: X.at, dial: X.dial, out: X.out, cal: X.cal }));
    const heardHz = HZS(X.rx) + 300;
    await page.fill('#xpdr-heard', (heardHz / 1e6).toFixed(6));
    const typedAt = await page.evaluate(() => Date.now());
    await page.waitForTimeout(400);
    await press('#xpdr-cal');
    X = await xp();
    const want7 = (heardHz - X.pred) / (1 - (await page.evaluate(ms => window.__gt.rangeRateMs(window.__gt.D.track, ms), X.predMs)) / X.C);
    const kept7 = X.kept === null ? null : JSON.parse(X.kept);
    chk('Set offset: the offset is (heard - pred) / (1 - rr/c) at the snapshot\'s instant, to the hertz, about +0.300 kHz; the snapshot was taken as the typing began, not at the press',
        X.pred !== null && Math.abs(KHZS(X.off) - want7) <= 1 && Math.abs(want7 - 300) < 50 && X.predMs <= typedAt + 50 && X.predMs >= typedAt - 1000,
        X.off + ' vs ' + want7.toFixed(2) + ' Hz; snapshot ' + (typedAt - X.predMs) + ' ms before the typing ended, the press ' + 400 + ' ms after');
    chk('...kept under gt.xpdr as {"24278": Hz}, and said so', !!kept7 && Object.keys(kept7).join() === '24278' && Math.abs(kept7['24278'] - want7) <= 1
        && X.said === 'Offset for JAS 2 set to ' + X.off + ', kept in this browser.', X.kept + '; "' + X.said + '"');
    W = fo29(X, 145.95e6, kept7 ? kept7['24278'] : 0);
    chk('...and the receive figure now carries it: (S - fu + offset) (1 - rr/c), to the hertz', half(HZS(X.rx), W.rx), X.rx + ' vs ' + W.rx.toFixed(2));
    await page.fill('#xpdr-heard', ((HZS(X.rx) + 60000) / 1e6).toFixed(6));
    await press('#xpdr-cal');
    X = await xp();
    chk('a frequency 60 kHz from the predicted one is refused, with the reason, and nothing changes', /^That is 60\.\d{3} kHz from the predicted figure: /.test(X.said) && JSON.stringify(JSON.parse(X.kept)) === JSON.stringify(kept7),
        '"' + X.said + '"');
    const coupled2 = await coupled();
    chk('...and setting the offset moved nothing of the downlink box, the uplink box or the rows either (the selected pass aside: the clock is live now)',
        coupled2.sel === coupledJ.sel && coupled2.freq === coupledJ.freq && coupled2.up === coupledJ.up, JSON.stringify(coupled2).slice(0, 120));

    /* a reload: the offset is still there. The table is refused once on the way (as on a dropped connection): the panel says so, and
       Try again fetches it */
    let refused = 0;
    await page.route(XPDR_TABLE, r => (refused++ === 0 ? r.abort() : r.continue()));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
    if (await page.evaluate(() => window.__gt.D.entry.name !== 'JAS 2')) {
      await H.pickExact(page, 'JAS 2');
      await page.waitForFunction(() => window.__gt.D.entry.name === 'JAS 2', null, { timeout: 15000 });
    }
    await page.waitForSelector('#doplive', { timeout: 15000 });
    await page.click('#xpdr summary');
    await page.waitForSelector('#xpdr-fail', { timeout: 15000 }).catch(() => {});
    X = await xp();
    chk('after a reload, a table that does not come is said, with Try again', !!X.fail && X.fail.startsWith('The transponder table did not load.') && refused === 1
        && (await page.isVisible('#xpdr-retry')), '"' + X.fail + '", refused ' + refused);
    await page.click('#xpdr-retry');
    await page.waitForSelector('#xpdrsel', { timeout: 15000 }).catch(() => {});
    X = await xp();
    chk('...Try again fetches it (a second request), and the offset set before the reload is still there', !!X.opts.length && refused === 2 && KHZS(X.off) === (kept7 ? kept7['24278'] : NaN),
        X.off + ', requests for the table ' + refused);
    await press('#xpdr-off0');
    X = await xp();
    chk('Reset: the offset is nought, gt.xpdr is gone (it was the last one), and it says so', X.off === '+0.000 kHz' && X.kept === null && X.said === 'Offset for JAS 2 cleared.', X.off + ', ' + X.kept + ', "' + X.said + '"');
    await page.unroute(XPDR_TABLE);

    /* 8. the work. Paused with the panel open, nothing is asked of the engine, not even for a nudge or another hold: its figures are
       arithmetic on the range rate the line already has. Moved one step, it is worked out at once. Running, the panel asks for no state
       of its own: one stateAt a tick, the line's, open or shut (counted against the line's own ticks, its data-ms). */
    await page.evaluate(() => { const b = document.getElementById('tpplay'); if (b.getAttribute('aria-label') === 'Pause') b.click(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const eng = window.__gt.eng, own = eng.stateAt;
      const w = window.__xpWork = { calls: 0, undo: () => { eng.stateAt = own; } };
      eng.stateAt = function (...a) { w.calls++; return own.apply(this, a); };
    });
    const dialP = (await xp()).dial;
    await page.waitForTimeout(700);
    await press('#xpdr-p-100');
    await press('#xpdr-hold-rx');
    await press('#xpdr-hold-tx');
    const paused8 = await page.evaluate(() => window.__xpWork.calls);
    const dialQ = (await xp()).dial;
    chk('paused with the panel open: no state is asked of the engine in 0.7 s, nor for a nudge and two changes of hold', paused8 === 0 && dialQ !== dialP, paused8 + ' calls; dial ' + dialP + ' -> ' + dialQ);
    const step8 = await page.evaluate(async () => {
      const w = window.__xpWork, r = document.getElementById('time'), t0 = performance.now();
      w.calls = 0;
      r.value = String(+r.value + 1);
      r.dispatchEvent(new Event('input', { bubbles: true }));
      while (!w.calls && performance.now() - t0 < 2000) await new Promise(f => setTimeout(f, 10));
      const out = { calls: w.calls, after: Math.round(performance.now() - t0), ms: +document.getElementById('xpdr-panel').dataset.ms };
      w.undo();
      return out;
    });
    chk('...moved one step, it is worked out at once, and the panel follows the line to the new instant',
        step8.calls >= 1 && step8.after <= 200 && step8.ms === +(await page.evaluate(() => document.getElementById('doplive').dataset.ms)), JSON.stringify(step8));
    const count = ms => page.evaluate(async t => {
      const eng = window.__gt.eng, own = eng.stateAt, el = document.getElementById('doplive');
      let calls = 0, ticks = 0;
      eng.stateAt = function (...a) { calls++; return own.apply(this, a); };
      const mo = new MutationObserver(rs => { ticks += rs.length; });
      mo.observe(el, { attributes: true, attributeFilter: ['data-ms'] });
      await new Promise(f => setTimeout(f, t));
      ticks += mo.takeRecords().length;
      mo.disconnect();
      eng.stateAt = own;
      return { calls, ticks };
    }, ms);
    await page.click('#doplive-go');
    await page.waitForTimeout(500);
    const open8 = await count(2000);
    await page.click('#xpdr summary');
    await page.waitForTimeout(300);
    const shut8 = await count(2000);
    chk('running, open: one stateAt a tick (the line\'s), the panel none of its own', open8.ticks >= 10 && Math.abs(open8.calls - open8.ticks) <= 1, open8.calls + ' calls in ' + open8.ticks + ' ticks');
    chk('...and shut: the same', shut8.ticks >= 10 && Math.abs(shut8.calls - shut8.ticks) <= 1 && !(await page.evaluate(() => document.getElementById('xpdr').open)),
        shut8.calls + ' calls in ' + shut8.ticks + ' ticks');

    /* 9. nothing asked of SatNOGS, the whole visit */
    const satnogs = reqs.filter(u => { try { return /satnogs/i.test(new URL(u).hostname); } catch (e) { return false; } });
    chk('no request to any SatNOGS host in the whole visit (the tables are files of the page\'s own)', satnogs.length === 0, satnogs.join(' ') || 'none of ' + reqs.length + ' requests');

    /* a calculator chunk that does not come: the summary opens on nothing and nothing breaks. (The browser keeps a failed import() for
       the life of the page, so toggling again does not ask again: a reload does. Said, not asserted: it is the browser's rule.) */
    const p2 = await browser.newPage();
    const errs2 = [], reqs2 = [];
    p2.on('pageerror', e => errs2.push(e.message));
    p2.on('request', r => reqs2.push(r.url()));
    for (const host of ['**celestrak.org/**', '**gibs.earthdata.nasa.gov/**', '**tle.ivanstanojevic.me/**']) await p2.route(host, r => r.abort());
    await p2.route(XPDR_JS, r => r.abort());
    await p2.goto(PAGE, { waitUntil: 'load' });
    await p2.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
    await p2.waitForSelector('#doplive', { timeout: 15000 });
    await p2.click('#xpdr summary');
    await p2.waitForTimeout(1200);
    await p2.click('#xpdr summary');
    await p2.click('#xpdr summary');
    await p2.waitForTimeout(800);
    const lost = await p2.evaluate(() => ({ open: document.getElementById('xpdr').open, panel: !!document.getElementById('xpdr-panel'), summary: document.querySelector('#xpdr summary').textContent }));
    chk('a calculator chunk that does not come: the summary still opens and shuts, no panel, no page error',
        lost.open && !lost.panel && lost.summary === 'Uplink and transponders' && errs2.length === 0,
        JSON.stringify(lost) + '; asked for ' + reqs2.filter(u => XPDR_JS.test(u)).length + ' time(s) in three toggles; errors: ' + (errs2.join(' | ') || 'none'));
    await p2.close();
  } else {
    /* the old page has the range rate the checks above use, but no line under its downlink box (it is new in the rebuild) */
    console.log('\n  the live line under the downlink box: not on the old page, which has none (CHANGES-FROM-LEGACY.md, L52); not checked');
    console.log('  the transponder calculator at its end: not on the old page, which had no uplink arithmetic (L63); not checked');
  }

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
