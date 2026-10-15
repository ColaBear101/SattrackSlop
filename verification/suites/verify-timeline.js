/* verify-timeline.js — the clock runs on past the end of the window.
 *
 * It used to loop: reaching the right-hand end of the scrubber snapped the
 * instant back to +0 h and replayed the same day. That made the clock lie — the
 * displayed time jumped backwards while the spacecraft kept flying — and it
 * quietly capped the tool at one day of history.
 *
 * Now the analysis window itself advances and the instant is carried across. The
 * scrubber returning to the left edge means a NEW day has started, which is a
 * different claim from the old one and worth pinning down, because a regression
 * would look identical at a glance: in both cases the bar goes back to zero.
 *
 * The distinguishing evidence is checked here: the window moved, the clock did
 * not go backwards, and the passes were recomputed for the new day rather than
 * being the old day's list shown again.
 *
 * The same loop survived in the countdown, which past the last pass of the
 * window counted down to the window's first pass as though the day repeated.
 * Parked at the end of the bar, it is checked against the real next pass, and
 * the pass table against the UTC calendar date of every pass.
 *
 * Last, the pass sky plot while its pass is being flown (CHANGES-FROM-LEGACY.md
 * L54, the rebuilt page's alone): with the clock stopped inside the selected
 * pass, the rail's plot has a dot in ink where the engine puts the spacecraft
 * at that instant and the stretch already flown faint, read off the canvas's
 * pixels; nothing else on it differs from the plot outside the pass, which it
 * is again, pixel for pixel, once the clock leaves. Paused, nothing is drawn;
 * playing at real time, each tick lays the kept picture down and draws only the
 * dot, the plot itself being drawn again only as the flown stretch grows; the
 * report's copy is not drawn while it is out of view, and is when it comes in.
 *
 * And the pass list by the observer's day (CHANGES-FROM-LEGACY.md L55, the
 * rebuilt page's alone): over a week, every pass sits under a header naming the
 * site's date of its AOS, with the Sun's times there that day, checked against
 * the NOAA Solar Calculator's equations (verification/reference/noaa-sun.js); the
 * header stays at the top of the rail (and of a phone's sheet) over its day, a
 * row given the focus under it is scrolled out from under it, and with the clock
 * inside a pass the rows before it are grey and it is ringed, the line under the
 * list says so at the clock's instant, sim time, each such row is described so to
 * a screen reader, and no row's words change; running at real time the line says
 * "already flown", and paused there it says sim time at once.
 *
 * And the pass list's filter (CHANGES-FROM-LEGACY.md L56, the rebuilt page's
 * alone): a visit that has not touched it stores nothing; with a lowest peak, the
 * naked eye or a span of the site's hours, the rows are exactly the passes kept,
 * each with its own index as data-i and the words it had, a press on one selects
 * that pass, and nothing outside the list moves; a hidden selected pass is said;
 * the choice comes back after a reload, and "Show every pass" removes it; on a
 * phone, Escape in its panel shuts the panel and leaves the answer sheet open.
 */
'use strict';
const H = require('../lib/harness');
const path = require('path');
const NEW = H.targetName() === 'new';   // the live sky plot is the rebuilt page's alone (L54)

let PAGE = null;   // an http URL from H.up(): the bundled app cannot be opened from file://
let fails = 0;
function chk(name, ok, detail){
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if(!ok) fails++;
}
const iso = ms => new Date(ms).toISOString().slice(0, 16);

(async () => {
  const { chromium } = H.playwright();
  const __srv = await H.up(); PAGE = __srv.page;
  const browser = await chromium.launch();
  const page = await browser.newContext().then(c => c.newPage());
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  /* No network: a live element-set refresh would reload the page mid-run and
     move the window for a reason that has nothing to do with the clock. */
  await page.route('**://celestrak.org/**', r => r.abort());
  await page.route('**://tle.ivanstanojevic.me/**', r => r.abort());
  /* The globe's NASA imagery is nothing to do with this check, and letting it
     run costs seconds of wall clock that the timings here are measured against.
     Blocked, so the page takes its documented fallback to the drawn coastlines. */
  await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });

  const state = () => page.evaluate(() => ({
    t0: window.__gt.D.start.getTime(),
    t1: window.__gt.D.end.getTime(),
    clock: document.getElementById('tpclock').textContent.trim(),
    passes: document.getElementById('npasses').textContent.trim(),
    /* the first row's date and AOS: the table carries the date in a column of
       its own, ahead of the time */
    aos: [2, 3].map(n => (document.querySelector('#passbody tr td:nth-child(' + n + ')') || {})
      .textContent || '').join(' ')
  }));

  /* Park the scrubber at the far right, which is where the old behaviour used
     to wrap. Scrubbing pauses playback, so it has to be restarted. */
  await page.evaluate(() => {
    const r = document.getElementById('time');
    r.value = r.max;
    r.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(400);
  const before = await state();
  console.log('\nat the end of the bar: ' + before.clock);
  console.log('  window ' + iso(before.t0) + ' -> ' + iso(before.t1) +
              '   ' + before.passes + ' passes\n');

  /* Parked at the end of the bar the clock is past the window's last pass, and
     the countdown has to name the first pass AFTER the window. It used to take
     the window's own first pass and add the window length, as though the ground
     track repeated every window - 66.6 min late and 55 deg high in the case that
     found it. The reference is the page's own findPasses over the 48 h beyond
     the window; the clock is read off the transport, to the second. */
  const cd = await page.evaluate(() => {
    const D = window.__gt.D, t1 = D.end.getTime(), P = D.passes, last = P[P.length - 1];
    const nx = window.__gt.findPasses(D.track, t1, t1 + 48 * 3600000, window.__gt.passStepFor(48))
      .find(p => !p.clipA) || null;
    const clock = Date.parse(document.getElementById('tpclock').textContent.trim().replace(' ', 'T') + 'Z');
    return { up: !!(last && last.clipL),
             k: document.getElementById('cdlabel').textContent,
             v: document.getElementById('cdvalue').textContent,
             w: document.getElementById('cdwhen').textContent,
             aos: nx ? nx.aos.toISOString() : null, el: nx ? nx.maxEl.toFixed(1) : null,
             dt: nx ? nx.t0ms - clock : null };
  });
  console.log('  countdown: ' + cd.k + ' | ' + cd.v + ' | ' + cd.w);
  if (cd.up) {
    chk('the window ends mid-pass, and the countdown says it is still up rather than setting',
        /still up at window end/.test(cd.k), cd.k);
  } else if (cd.aos) {
    const hms = cd.v.split(':').map(Number);
    chk('past the last pass, the countdown names the first pass after the window',
        cd.w.includes(cd.aos.slice(11, 19)) && cd.w.includes(cd.el + '°') && !/next cycle/.test(cd.w),
        'real next ' + cd.aos.slice(0, 19) + 'Z at ' + cd.el + '°');
    chk('...and counts down to it', hms.length === 3 &&
        Math.abs((hms[0] * 3600 + hms[1] * 60 + hms[2]) * 1000 - cd.dt) <= 2000,
        cd.v + ' against ' + (cd.dt / 1000).toFixed(0) + ' s');
  } else {
    chk('no pass in the 48 h after the window, and the countdown says none', cd.v === 'none', cd.v);
  }
  chk('...on the transport clock, a day from now, and it says so', /sim time/.test(cd.k), cd.k);

  /* Dates. The table and the rail used to tag times "+Nd" counted in 24 h
     periods from the window start, so a pass early the next UTC morning carried
     no date at all. Each pass is now dated by its own UTC calendar day. */
  const dated = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#passbody tr[data-i]')]
      .map(tr => tr.children[1].textContent + ' ' + tr.children[2].textContent);
    const rail = [...document.querySelectorAll('#passlist .passrow .t')]
      .map(x => x.firstChild.textContent);
    return window.__gt.D.passes.map((p, i) => ({ iso: p.aos.toISOString(), row: rows[i] || '', rail: rail[i] || '' }));
  });
  const undated = dated.filter(d =>
    !d.row.startsWith(d.iso.slice(0, 10) + ' ' + d.iso.slice(11, 19)) ||
    !d.rail.startsWith(d.iso.slice(5, 10) + ' ' + d.iso.slice(11, 19) + 'Z'));
  chk('every pass carries its UTC calendar date, in the table and in the rail',
      dated.length > 0 && undated.length === 0,
      undated.length ? JSON.stringify(undated[0]) : dated.map(d => d.row).join(' | '));
  chk('...and no window-relative "+Nd" tag is left',
      !dated.some(d => /\+\d+d/.test(d.row + d.rail)));
  console.log('');

  await page.evaluate(() => {
    const r = document.getElementById('tprate');
    r.value = 100; r.dispatchEvent(new Event('input'));
  });
  if (await page.evaluate(() =>
        document.getElementById('tpplay').getAttribute('aria-label') === 'Play'))
    await page.click('#tpplay');

  await page.waitForTimeout(6000);
  const after = await state();

  const span = before.t1 - before.t0;
  const toMs = s => Date.parse(s.replace(' ', 'T') + 'Z');

  chk('the analysis window advanced rather than replaying',
      after.t0 > before.t0, iso(before.t0) + ' -> ' + iso(after.t0));
  chk('...by exactly one window span, so no time is skipped or repeated',
      Math.abs((after.t0 - before.t0) % span) < 1000,
      'moved ' + ((after.t0 - before.t0)/3600000).toFixed(2) + ' h, span ' +
      (span/3600000).toFixed(2) + ' h');
  chk('the clock never went backwards',
      toMs(after.clock) > toMs(before.clock), before.clock + ' -> ' + after.clock);
  chk('the clock is inside the new window',
      toMs(after.clock) >= after.t0 - 1000 && toMs(after.clock) <= after.t1 + 1000,
      after.clock + ' within ' + iso(after.t0) + '..' + iso(after.t1));
  chk('the passes were recomputed for the new day',
      after.aos !== before.aos || after.passes !== before.passes,
      before.passes + ' passes from ' + (before.aos.trim() || '—') +
      '  ->  ' + after.passes + ' from ' + (after.aos.trim() || '—'));
  chk('playback is still running', await page.evaluate(() =>
      document.getElementById('tpplay').getAttribute('aria-label') === 'Pause'));

  /* ---- the pass sky plot while its pass is flown (CHANGES-FROM-LEGACY.md, L54) ----------------------------------------
     With the clock inside the selected pass, the plot shows the spacecraft as a dot in ink where the engine puts it at that
     instant (app.exactAt, which is the test surface's sampleMs), and the stretch of the pass already flown faint. Read off
     the canvas's own pixels, at the points the plot's transform gives (written again here: R = S/2 - 22, r = R (90 - el)/90,
     north up, east right, in CSS pixels times the device pixel ratio, at most 2), against the plot drawn with the clock
     outside the pass. The count of the flown samples is the AR radar's, written again here too. */
  if (NEW) {
    console.log('\n  the pass sky plot while its pass is flown');
    // the clock is running at the top rate, and the window would roll on under the checks: stop it
    await page.evaluate(() => { const b = document.getElementById('tpplay'); if (b.getAttribute('aria-label') === 'Pause') b.click(); });
    await page.waitForTimeout(300);
    /* the highest pass of the window, which crosses the plot the furthest */
    const P = await page.evaluate(() => {
      const D = window.__gt.D; let b = -1;
      D.passes.forEach((p, i) => { if (p.arc.length === 91 && !p.clipA && !p.clipL && (b < 0 || p.maxEl > D.passes[b].maxEl)) b = i; });
      if (b < 0) return null;
      const p = D.passes[b];
      return { i: b, t0: p.t0ms, t1: p.t1ms, maxEl: p.maxEl, n: p.arc.length - 1, wt0: D.start.getTime(), wt1: D.end.getTime() };
    });
    chk('the window holds a whole pass to put the clock in', !!P, P ? 'pass ' + (P.i + 1) + ', peak ' + P.maxEl.toFixed(1) + '°' : 'none');
    if (P) {
      /* the rail's list selects it, and takes the clock to its culmination, stopped there */
      await page.click('#passlist .passrow[data-i="' + P.i + '"]');
      await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('sky').scrollIntoView({ block: 'center' }); });
      await page.evaluate(() => {
        const hex = h => { h = h.trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
        const cs = getComputedStyle(document.documentElement);
        window.__skyT = {
          ink: hex(cs.getPropertyValue('--ink')), contact: hex(cs.getPropertyValue('--contact')), snaps: {},
          snap(id, name) { const c = document.getElementById(id); this.snaps[name] = c.getContext('2d').getImageData(0, 0, c.width, c.height); },
          geo(id) { const c = document.getElementById(id); return { S: Math.round(c.getBoundingClientRect().width) || 268, dpr: Math.min(devicePixelRatio || 1, 2), w: c.width }; },
          /* where a look lands, in the canvas's device pixels */
          at(id, az, el) { const { S, dpr } = this.geo(id), R = S / 2 - 22, r = R * (90 - el) / 90, a = az * Math.PI / 180; return [(S / 2 + r * Math.sin(a)) * dpr, (S / 2 - r * Math.cos(a)) * dpr]; },
          px(img, x, y) { const i = (Math.floor(y) * img.width + Math.floor(x)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; },
          off(a, b) { return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])); },
          inView(id) { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }
        };
      });
      const seek = ms => page.evaluate(t => window.__gt.seek(t), ms);
      const outside = P.t1 + 120000 <= P.wt1 ? P.t1 + 120000 : P.t0 - 120000;

      /* the plot with the clock outside the pass: drawSky's, as the old page drew it */
      await seek(outside);
      await page.waitForTimeout(400);
      const ref = await page.evaluate(() => { const T = window.__skyT; T.snap('sky', 'ref'); return { live: document.getElementById('sky').dataset.live, sky: T.inView('sky'), sky2: T.inView('sky2'), geo: T.geo('sky') }; });
      chk('with the clock outside the selected pass the rail\'s plot carries no instant of its own (no data-live)', ref.live === undefined, String(ref.live));

      /* the clock stopped at 60 % of the pass: half way between two of the arc's samples, so that a second of play does not
         cross into the next at once */
      const t = Math.round(P.t0 + (Math.floor(0.6 * P.n) + 0.5) * (P.t1 - P.t0) / P.n);
      await seek(t);
      const drew = await page.waitForFunction(v => document.getElementById('sky').dataset.live === String(v), t, { timeout: 10000 }).then(() => true, () => false);
      chk('stopped inside it, at 60 % of the pass, the plot is drawn for that instant (data-live)', drew,
          await page.evaluate(() => document.getElementById('sky').dataset.live) + ' for ' + t);
      const L = await page.evaluate(({ t, P }) => {
        const T = window.__skyT, gt = window.__gt, D = gt.D, p = D.passes[P.i], { dpr } = T.geo('sky');
        T.snap('sky', 'live');
        const ref = T.snaps.ref, live = T.snaps.live, n = P.n;
        const look = gt.sampleMs(D.track, t), dot = T.at('sky', look.az, look.el);
        /* the AR radar's count of the flown samples (radar.ts flown()), written again */
        const k = Math.max(0, Math.min(n, Math.floor((t - p.t0ms) / (p.t1ms - p.t0ms) * n)));
        const pts = p.arc.map(s => T.at('sky', s.az, s.el));
        const S = T.geo('sky').S, c = S / 2 * dpr;
        const inward = (q, d) => { const vx = c - q[0], vy = c - q[1], m = Math.hypot(vx, vy) || 1; return [q[0] + vx / m * d, q[1] + vy / m * d]; };
        const marks = [dot, inward(pts[0], 19 * dpr), inward(pts[n], 19 * dpr), T.at('sky', p.maxAz, p.maxEl)];
        const clear = q => Math.min(...marks.map(m => Math.hypot(m[0] - q[0], m[1] - q[1])));
        /* a sample of each stretch as far as can be from the dot, the highest point and the AOS/LOS labels */
        const best = (a, b) => { let i = -1; for (let j = a; j <= b; j++) if (i < 0 || clear(pts[j]) > clear(pts[i])) i = j; return i; };
        const fi = best(3, k - 3), ui = best(k + 3, n - 3);
        const at = (img, q) => T.px(img, q[0], q[1]);
        /* every pixel that differs from the plot outside the pass must be the dot's (within 12 px of it) or on the flown
           stretch (within 3 px of it: the line is 3 px wide, with round caps) */
        const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)); return Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy); };
        let diff = 0, stray = 0, strayAt = null;
        for (let y = 0; y < live.height; y++) for (let x = 0; x < live.width; x++) {
          const i = (y * live.width + x) * 4;
          if (Math.max(Math.abs(live.data[i] - ref.data[i]), Math.abs(live.data[i + 1] - ref.data[i + 1]), Math.abs(live.data[i + 2] - ref.data[i + 2]), Math.abs(live.data[i + 3] - ref.data[i + 3])) <= 2) continue;
          diff++;
          const cx = x + 0.5, cy = y + 0.5;
          if (Math.hypot(cx - dot[0], cy - dot[1]) <= 12 * dpr) continue;
          let near = false;
          for (let j = 0; j < k && !near; j++) near = segD(cx, cy, pts[j], pts[j + 1]) <= 3 * dpr;
          if (!near) { stray++; strayAt = strayAt || [x, y]; }
        }
        return {
          k, n, look: { az: look.az, el: look.el }, dot: dot.map(v => +v.toFixed(1)), dpr, w: live.width, sameSize: live.width === ref.width && live.height === ref.height,
          dotPx: at(live, dot), dotRef: at(ref, dot), ink: T.ink, contact: T.contact,
          fi, fClear: clear(pts[fi]) / dpr, fLive: at(live, pts[fi]), fRef: at(ref, pts[fi]),
          ui, uClear: clear(pts[ui]) / dpr, uLive: at(live, pts[ui]), uRef: at(ref, pts[ui]),
          diff, stray, strayAt
        };
      }, { t, P });
      const T = { off: (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) };
      console.log('   pass ' + (P.i + 1) + ', ' + L.k + ' of ' + L.n + ' samples flown; the spacecraft at az ' + L.look.az.toFixed(1) + '° el ' + L.look.el.toFixed(1)
        + '°, on the canvas at ' + L.dot.join(', ') + ' (device px, ratio ' + L.dpr + '); ' + L.diff + ' pixels differ from the plot outside the pass');
      chk('...at the backing-store size drawSky gives it (CSS width x device pixel ratio), unchanged', L.sameSize && L.w === Math.round(ref.geo.S * ref.geo.dpr), L.w + ' for ' + ref.geo.S + ' x ' + ref.geo.dpr);
      chk('the spacecraft is a dot in ink where the engine puts it at that instant, where the plot outside the pass has none',
          T.off(L.dotPx, L.ink) <= 3 && T.off(L.dotRef, L.ink) > 60, 'there ' + L.dotPx.join(',') + ' (ink ' + L.ink.join(',') + '), outside the pass ' + L.dotRef.join(','));
      chk('the stretch already flown is faint: at its sample ' + L.fi + ' the arc is no longer its own colour',
          L.fClear >= 14 && T.off(L.fRef, L.contact) <= 3 && T.off(L.fLive, L.contact) > 40,
          'outside the pass ' + L.fRef.join(',') + ' (contact ' + L.contact.join(',') + '), now ' + L.fLive.join(',') + '; ' + L.fClear.toFixed(0) + ' px clear of the marks');
      chk('...and the stretch still to come is as it was: at its sample ' + L.ui + ' the arc is unchanged',
          L.uClear >= 14 && T.off(L.uRef, L.contact) <= 3 && T.off(L.uLive, L.uRef) <= 2,
          'outside the pass ' + L.uRef.join(',') + ', now ' + L.uLive.join(',') + '; ' + L.uClear.toFixed(0) + ' px clear of the marks');
      chk('nothing else on the plot differs from the plot outside the pass: every changed pixel is the dot\'s or on the flown stretch',
          L.diff > 0 && L.stray === 0, L.diff + ' changed, ' + L.stray + ' elsewhere' + (L.strayAt ? ' (first at ' + L.strayAt.join(',') + ')' : ''));

      /* the work: none paused; playing at real time, every tick lays the kept picture down and draws the dot, and drawSky runs
         again only when another sample of the arc is flown. Counted on the canvas's own context calls: a blit (drawImage), a
         whole plot (its "N"), a dot (its 9 px ring). The report's copy is below the fold the while, and must not be drawn. */
      const W = await page.evaluate(async () => {
        const C = CanvasRenderingContext2D.prototype, own = { drawImage: C.drawImage, fillText: C.fillText, arc: C.arc };
        const zero = () => ({ blit: 0, plot: 0, dot: 0 });
        const n = { sky: zero(), sky2: zero() }, of = ctx => n[ctx.canvas && ctx.canvas.id];
        C.drawImage = function (...a) { const c = of(this); if (c) c.blit++; return own.drawImage.apply(this, a); };
        C.fillText = function (...a) { const c = of(this); if (c && a[0] === 'N') c.plot++; return own.fillText.apply(this, a); };
        C.arc = function (...a) { const c = of(this); if (c && a[2] === 9) c.dot++; return own.arc.apply(this, a); };
        const sky = document.getElementById('sky'), sky2 = document.getElementById('sky2');
        const watch = async ms => { const seen = new Set(), t0 = performance.now(); while (performance.now() - t0 < ms) { seen.add(sky.dataset.live); await new Promise(f => setTimeout(f, 40)); } return seen.size; };
        const take = () => { const r = JSON.parse(JSON.stringify(n)); n.sky = zero(); n.sky2 = zero(); return r; };
        try {
          const sky2Hidden = !window.__skyT.inView('sky2');
          const pausedSeen = await watch(1000), paused = take();
          const r = document.getElementById('tprate'); r.value = 0; r.dispatchEvent(new Event('input'));
          const rate = document.getElementById('tpratev').textContent, ms0 = +sky.dataset.live, sky2Before = sky2.dataset.live;
          take();
          document.getElementById('tpplay').click();
          const playingSeen = await watch(2000);
          const playing = take(), moved = +sky.dataset.live - ms0, sky2After = sky2.dataset.live;
          document.getElementById('tpplay').click();
          await new Promise(f => setTimeout(f, 200));
          return { paused, pausedSeen, playing, playingSeen, moved, rate, sky2Hidden, sky2Before, sky2After };
        } finally { Object.assign(C, own); }
      });
      const per = (P.t1 - P.t0) / P.n;   // ms of clock per sample of the arc
      chk('paused for 1 s, neither plot draws anything and the instant shown stays where it is',
          W.pausedSeen === 1 && Object.values(W.paused.sky).every(v => v === 0) && Object.values(W.paused.sky2).every(v => v === 0),
          JSON.stringify(W.paused) + ', ' + W.pausedSeen + ' instant(s) shown');
      chk('playing at ' + W.rate + ' for 2 s, the dot follows the clock\'s ticks, each a kept picture laid down with the dot over it',
          /^1\.0/.test(W.rate) && W.playingSeen >= 10 && W.playing.sky.dot >= 10 && W.playing.sky.dot === W.playing.sky.blit + W.playing.sky.plot,
          W.playingSeen + ' instants shown; ' + JSON.stringify(W.playing.sky));
      chk('...and the plot itself is drawn again only as the flown stretch grows (a sample every ' + (per / 1000).toFixed(1) + ' s of clock)',
          W.playing.sky.plot <= Math.floor(W.moved / per) + 1, W.playing.sky.plot + ' whole plots as the clock moved ' + (W.moved / 1000).toFixed(2) + ' s');
      if (W.sky2Hidden) {
        chk('the report\'s copy, out of view the while, was not drawn at all', Object.values(W.playing.sky2).every(v => v === 0) && W.sky2Before === W.sky2After,
            JSON.stringify(W.playing.sky2) + ', data-live ' + W.sky2Before + ' -> ' + W.sky2After);
      } else console.log('   (the report\'s copy is in view at this window size: its not being drawn out of view is not checked)');

      /* the report's copy, brought into view with the clock stopped, is drawn then, for the same instant, with its own dot */
      const cur = await page.evaluate(() => { document.getElementById('sky2').scrollIntoView({ block: 'center' }); return document.getElementById('sky').dataset.live; });
      const came = await page.waitForFunction(v => document.getElementById('sky2').dataset.live === v, cur, { timeout: 5000 }).then(() => true, () => false);
      const R2 = await page.evaluate(ms => {
        const T = window.__skyT, gt = window.__gt, s = gt.sampleMs(gt.D.track, ms);
        T.snap('sky2', 'live2');
        const q = T.at('sky2', s.az, s.el);
        return { px: T.px(T.snaps.live2, q[0], q[1]), ink: T.ink, live: document.getElementById('sky2').dataset.live };
      }, +cur);
      chk('brought into view, the report\'s copy is drawn for the instant the clock stopped at, its dot where the engine puts the spacecraft',
          came && T.off(R2.px, R2.ink) <= 3, 'data-live ' + R2.live + ' (the rail\'s ' + cur + '), ' + R2.px.join(','));

      /* out of the pass again: the plot is drawSky's, pixel for pixel the one before */
      await seek(outside);
      const left = await page.waitForFunction(() => !('live' in document.getElementById('sky').dataset) && !('live' in document.getElementById('sky2').dataset), null, { timeout: 5000 }).then(() => true, () => false);
      const back = await page.evaluate(() => {
        const T = window.__skyT; T.snap('sky', 'back');
        const a = T.snaps.ref.data, b = T.snaps.back.data; let d = 0;
        if (a.length !== b.length) return -1;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
        return d;
      });
      chk('once the clock leaves the pass, both plots drop their instant, and the rail\'s is the plot from before, pixel for pixel',
          left && back === 0, (left ? 'no data-live' : 'data-live left behind') + ', ' + back + ' bytes differ');
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  } else console.log('\n  not checked: the live sky plot is the rebuilt page\'s (CHANGES-FROM-LEGACY.md, L54); the old page had none');

  /* ---- the pass list by the observer's day (CHANGES-FROM-LEGACY.md, L55) ----------------------------------------------------
     A week's passes, grouped by the site's calendar date of their AOS under a header that names the date and the Sun's times
     there that day. The dates are worked out here from each pass's AOS and the site's offset; the Sun's times are checked
     against a different Sun and a different method, the NOAA Solar Calculator's equations (verification/reference/noaa-sun.js),
     to the minute either way. The header stays at the top of the rail while its day scrolls under it, and a row reached with
     Tab is not left under it. Rows flown before the clock's instant are grey and the one in view at it ringed, and the line
     under the list says so, with "sim time" when the clock is not now (paused, sped up or away from the wall clock), as does each such
     row's description; nothing a row says changes. */
  if (NEW) {
    console.log('\n  the pass list by the observer\'s day');
    const noaa = require('../reference/noaa-sun');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => { const b = document.getElementById('tpplay'); if (b.getAttribute('aria-label') === 'Pause') b.click(); });
    await H.clickWindow(page, '[data-h="168"]');
    await page.waitForFunction(() => !!window.__gt.D && window.__gt.D.hours === 168, null, { timeout: 30000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#passlist .dh b').length > 0, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    const L = await page.evaluate(() => {
      const D = window.__gt.D;
      const rows = el => [...el.querySelectorAll('.passrow')].map(r => ({ i: +r.dataset.i, label: r.getAttribute('aria-label'), title: r.getAttribute('title'), text: r.textContent }));
      return {
        site: { lat: window.__gt.OBS.lat, lon: window.__gt.OBS.lon },
        aos: D.passes.map(p => ({ ms: p.t0ms, tz: window.__gt.tzAt(p.t0ms) })),
        groups: [...document.querySelectorAll('#passlist > *')].map(g => ({
          tag: g.tagName, cls: g.className, b: (g.querySelector('.dh b') || {}).textContent || null,
          head: g.querySelector('.dh') ? g.querySelector('.dh').textContent : null, rows: rows(g)
        })),
        stray: document.querySelectorAll('#passlist .passrow').length - document.querySelectorAll('#passlist > .day > .passrow').length,
        none: !!document.querySelector('#passlist > p'),
        tabbed: [...document.querySelectorAll('#passlist .dh')].filter(h => h.matches('button, a, input, [tabindex]')).length
      };
    });
    const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const local = a => new Date(a.ms + a.tz * 3600000);
    const name = d => WD[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MO[d.getUTCMonth()];
    const ymdOf = d => d.toISOString().slice(0, 10);
    const order = L.groups.flatMap(g => g.rows.map(r => r.i));
    const wrongDay = [];
    L.groups.forEach(g => g.rows.forEach(r => { const d = local(L.aos[r.i]); if (name(d) !== g.b) wrongDay.push(r.i + ': ' + name(d) + ' under ' + g.b); }));
    const dates = L.groups.map(g => ymdOf(local(L.aos[g.rows[0].i])));
    console.log('   ' + L.aos.length + ' passes in ' + L.groups.length + ' of the site\'s days: ' + L.groups.map(g => g.b + ' (' + g.rows.length + ')').join(', '));
    chk('a week\'s passes are grouped by the site\'s calendar date of their AOS, one header a day, in order, each pass once',
        L.groups.length >= 5 && L.groups.every(g => g.tag === 'DIV' && /\bday\b/.test(g.cls) && g.rows.length > 0) && wrongDay.length === 0
          && JSON.stringify(order) === JSON.stringify(L.aos.map((_, i) => i)) && new Set(dates).size === dates.length && L.stray === 0,
        wrongDay[0] || L.groups.length + ' groups, rows in order');
    chk('...each header says it is the local date, not the UTC date the rows lead with, and is no <p> of #passlist and no control',
        L.groups.every(g => / local date, UTC[+−]\d/.test(g.head)) && !L.none && L.tabbed === 0, L.groups[0].head);
    /* the Sun's times in each header, against NOAA's for that date at the site, to the minute (each is rounded to one) */
    const SUN = [['Dark until', true, noaa.CIVIL_ZENITH], ['Sunrise', true, noaa.RISE_SET_ZENITH], ['Sunset', false, noaa.RISE_SET_ZENITH], ['Dark from', false, noaa.CIVIL_ZENITH]];
    const sunBad = [];
    let sunN = 0;
    L.groups.forEach(g => {
      const d0 = local(L.aos[g.rows[0].i]), tz = L.aos[g.rows[0].i].tz, line = g.head.replace(/\u00a0/g, ' ');
      for (const [w, up, z] of SUN) {
        const ms = noaa.event(up, d0.getUTCFullYear(), d0.getUTCMonth() + 1, d0.getUTCDate(), L.site.lat, L.site.lon, z);
        const m = new RegExp(w + ' (\\d\\d):(\\d\\d)').exec(line);
        if (ms === null || !m) { if ((ms === null) !== !m) sunBad.push(g.b + ' ' + w + ': ' + (m ? m[0] : 'missing') + ' against ' + ms); continue; }
        const t = new Date(ms + tz * 3600000), want = t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60;
        sunN++;
        if (Math.abs(+m[1] * 60 + +m[2] - want) > 1) sunBad.push(g.b + ' ' + m[0] + ' against NOAA ' + t.toISOString().slice(11, 19));
      }
    });
    chk('...and the Sun\'s times that day (dark until, sunrise, sunset, dark from) are NOAA\'s for the site, to the minute',
        sunN === 4 * L.groups.length && sunBad.length === 0, sunBad[0] || sunN + ' times; ' + L.groups[0].head.replace(/^.*UTC[+−]\d+(\.\d)?/, ''));

    /* sticky: a day's second row scrolled to the top of the rail, and its header is there over it, opaque */
    const S = await page.evaluate(() => {
      const g = [...document.querySelectorAll('#passlist > .day')].find(x => x.querySelectorAll('.passrow').length >= 3);
      if (!g) return null;
      let sc = g.parentElement;
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      const box = () => (sc ? sc.getBoundingClientRect() : { top: 0 });
      const r2 = g.querySelectorAll('.passrow')[1], dh = g.querySelector('.dh');
      const by = dy => { if (sc) sc.scrollTop += dy; else window.scrollBy(0, dy); };
      by(r2.getBoundingClientRect().top - box().top - 4);
      const h = dh.getBoundingClientRect(), top = sc ? box().top + sc.clientTop : 0, hit = document.elementFromPoint(h.left + 4, h.top + h.height / 2);
      const out = { scroller: sc ? sc.tagName.toLowerCase() + '.' + sc.className.split(' ')[0] : 'page', at: +(h.top - top).toFixed(1), rowAt: +(r2.getBoundingClientRect().top - top).toFixed(1),
        bg: getComputedStyle(dh).backgroundColor, onTop: !!hit && dh.contains(hit), h: Math.round(h.height) };
      /* the third row of that day, inside the rail's visible part but under the stuck header (its top 10 px below the rail's), is
         given the focus, as Shift+Tab from the row after it would: it must be scrolled out from under the header (the rows' scroll
         margin), since the browser leaves alone what it thinks is already in view */
      const r3 = g.querySelectorAll('.passrow')[2];
      by(r3.getBoundingClientRect().top - box().top - 10);
      out.focus = { under: +(r3.getBoundingClientRect().top - top).toFixed(1) };
      r3.focus();
      const f = r3.getBoundingClientRect(), hh = dh.getBoundingClientRect();
      const fHit = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
      Object.assign(out.focus, { focused: document.activeElement === r3, rowTop: +(f.top - top).toFixed(1), headBottom: +(hh.bottom - top).toFixed(1),
        clear: out.focus.under < out.h && f.top >= hh.bottom - 1 && !!fHit && r3.contains(fHit) });
      r3.blur();
      if (sc) sc.scrollTop = 0;
      return out;
    });
    chk('scrolled under its day, the header stays at the top of the rail, opaque, over the rows',
        !!S && Math.abs(S.at) <= 1 && S.rowAt < S.h && S.onTop && /^rgb\(/.test(S.bg), S ? JSON.stringify({ scroller: S.scroller, at: S.at, rowAt: S.rowAt, h: S.h, bg: S.bg }) : 'no day of 3 passes');
    chk('...and a row of that day under the stuck header, given the focus as Shift+Tab would give it, is scrolled out from under it',
        !!S && S.focus.focused && S.focus.clear, S ? JSON.stringify(S.focus) : '');

    /* the clock inside a pass in the middle of the week: the flown rows grey, that one ringed, the rest as they were */
    const before = L.groups.flatMap(g => g.rows);
    const k = Math.floor(L.aos.length / 2);
    await page.evaluate(k => { const p = window.__gt.D.passes[k]; window.__gt.seek((p.t0ms + p.t1ms) / 2); }, k);
    await page.waitForTimeout(300);
    const C = await page.evaluate(() => {
      const css = (e, p) => getComputedStyle(e)[p];
      const root = getComputedStyle(document.documentElement);
      const rgb = h => { const x = document.createElement('i'); x.style.color = h; document.body.appendChild(x); const c = getComputedStyle(x).color; x.remove(); return c; };
      const rows = [...document.querySelectorAll('#passlist .passrow')];
      return {
        cls: rows.map(r => (r.classList.contains('past') ? 'past' : '') + (r.classList.contains('live') ? 'live' : '')),
        after: rows.map(r => ({ i: +r.dataset.i, label: r.getAttribute('aria-label'), title: r.getAttribute('title'), text: r.textContent })),
        tPast: css(rows[0].querySelector('.t'), 'color'), tNext: css(rows[rows.length - 1].querySelector('.t'), 'color'),
        ring: rows.filter(r => r.classList.contains('live')).map(r => css(r.querySelector('.n'), 'borderTopColor'))[0] || null,
        muted: rgb(root.getPropertyValue('--muted')), ink: rgb(root.getPropertyValue('--ink')), contact: rgb(root.getPropertyValue('--contact')),
        note: (document.getElementById('passflown') || {}).textContent || null,
        desc: rows.map(r => r.getAttribute('aria-describedby'))
      };
    });
    /* the description a screen reader is given for a row, as the browser works it out (its accessibility tree, over CDP) */
    const cdp = await page.context().newCDPSession(page);
    const axDesc = async sel => {
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      if (!nodeId) return null;
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      return nodes[0] && nodes[0].description ? nodes[0].description.value : '';
    };
    const want = C.cls.map((_, i) => (i < k ? 'past' : i === k ? 'live' : ''));
    chk('with the clock stopped inside pass ' + (k + 1) + ', the ' + k + ' rows before it are grey (the muted ink), it is ringed (the contact colour), the rest are as they were',
        JSON.stringify(C.cls) === JSON.stringify(want) && C.tPast === C.muted && C.tNext === C.ink && C.ring === C.contact,
        'past ' + C.cls.filter(c => c === 'past').length + ', live at ' + C.cls.indexOf('live') + '; grey ' + C.tPast + ' (muted ' + C.muted + '), next ' + C.tNext + ', ring ' + C.ring);
    chk('...and the line under the list says what they mean, at the clock\'s instant, which is sim time, not now',
        C.note === 'Grey: flown before the clock\'s instant. Ringed: in view at the clock\'s instant. The clock is on sim time, not now.', C.note);
    chk('...and nothing a row says changed: its index, label, title and text are as before',
        JSON.stringify(C.after) === JSON.stringify(before), before.length + ' rows');
    /* the grey and the ring are colour and shape: a screen reader is told on the row itself, in the line's words */
    const descWant = C.cls.map(c => (c === 'past' ? 'passflown-past' : c === 'live' ? 'passflown-live' : null));
    const dPast = await axDesc('#passlist .passrow.past'), dLive = await axDesc('#passlist .passrow.live'), dNext = await axDesc('#passlist .passrow:not(.past):not(.live)');
    chk('...and a screen reader is told which rows are flown and which is in view: each is described as such, the others not',
        JSON.stringify(C.desc) === JSON.stringify(descWant) && dPast === 'flown before the clock\'s instant' && dLive === 'in view at the clock\'s instant' && dNext === '',
        JSON.stringify({ past: dPast, live: dLive, next: dNext }));
    await page.evaluate(t => window.__gt.seek(t), L.aos[0].ms - 60000);
    await page.waitForTimeout(300);
    const none = await page.evaluate(() => ({ marked: document.querySelectorAll('#passlist .passrow.past, #passlist .passrow.live').length, note: !!document.getElementById('passflown'),
      described: document.querySelectorAll('#passlist .passrow[aria-describedby]').length }));
    chk('before the first pass no row is grey or ringed, or described as either, and the line is gone', none.marked === 0 && !none.note && none.described === 0, JSON.stringify(none));

    /* at real time, then paused there. The window is opened two days back so that passes have flown by now; with the clock
       running at 1x at the wall clock the line says "already flown", and the press of pause turns it to sim time at once. A paused
       clock publishes nothing more, and the line once stayed "now" for as long as the clock stayed paused, the passes flying on. */
    await H.clickWindow(page, '#tpnow');
    await page.waitForFunction(() => Math.abs(window.__gt.D.start.getTime() - Date.now()) < 120000, null, { timeout: 30000 });
    for (const back of [1, 2]) {
      await H.clickWindow(page, '#winPrevD');
      await page.waitForFunction(b => Math.abs(window.__gt.D.start.getTime() - (Date.now() - b * 86400000)) < 120000, back, { timeout: 30000 });
    }
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.__gt.seek(Date.now());
      const r = document.getElementById('tprate'); r.value = 0; r.dispatchEvent(new Event('input'));
      document.getElementById('tpplay').click();
    });
    await page.waitForTimeout(600);
    const flownNow = () => page.evaluate(() => {
      const row = document.querySelector('#passlist .passrow.past'), id = row && row.getAttribute('aria-describedby');
      return { playing: document.getElementById('tpplay').getAttribute('aria-label') === 'Pause', rate: document.getElementById('tpratev').textContent,
        past: document.querySelectorAll('#passlist .passrow.past').length, note: (document.getElementById('passflown') || {}).textContent || null,
        word: id ? (document.getElementById(id) || {}).textContent || null : null };
    });
    const R1 = await flownNow();
    chk('running at 1x at the wall clock, with passes flown by now, the line says they are already flown, and the rows say so',
        R1.playing && /^1\.0/.test(R1.rate) && R1.past > 0 && /^Grey: already flown\./.test(R1.note || '') && !/sim time/.test(R1.note) && R1.word === 'already flown',
        JSON.stringify(R1));
    await page.click('#tpplay');     // pause, as a reader would
    await page.waitForTimeout(400);
    const R2 = await flownNow();
    chk('...and paused there, the line turns to sim time at once (the pause is read, with no tick after it), and so do the rows',
        !R2.playing && R2.past > 0 && /^Grey: flown before the clock's instant\./.test(R2.note || '') && / The clock is on sim time, not now\.$/.test(R2.note)
          && R2.word === 'flown before the clock\'s instant', JSON.stringify(R2));

    /* on a phone the rail is a sheet whose body scrolls inside its own padding: a stuck header is at the sheet's edge, with no
       row showing above it */
    const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pp = await ph.newPage();
    pp.on('pageerror', e => errs.push('phone: ' + String(e)));
    await pp.goto(PAGE + '?span=168', { waitUntil: 'load' });
    await pp.waitForFunction(() => !!window.__gt && !!window.__gt.D && document.querySelectorAll('#passlist .dh b').length > 0, null, { timeout: 30000 });
    await pp.click('.rail .peek');
    await pp.waitForTimeout(400);
    const P2 = await pp.evaluate(() => {
      const body = document.getElementById('answer-body'), g = [...document.querySelectorAll('#passlist > .day')].find(x => x.querySelectorAll('.passrow').length >= 2);
      if (!g) return null;
      const r2 = g.querySelectorAll('.passrow')[1], dh = g.querySelector('.dh');
      body.scrollTop += r2.getBoundingClientRect().top - body.getBoundingClientRect().top + 4;
      const top = body.getBoundingClientRect().top + body.clientTop, h = dh.getBoundingClientRect();
      const edge = document.elementFromPoint(h.left + h.width / 2, top + 1);
      return { scrolls: getComputedStyle(body).overflowY, pad: getComputedStyle(body).paddingTop, at: +(h.top - top).toFixed(1), edge: !!edge && dh.contains(edge) };
    });
    chk('on a phone\'s sheet the stuck header is at the sheet\'s edge, inside its padding, and no row shows above it',
        !!P2 && P2.scrolls === 'auto' && Math.abs(P2.at) <= 1 && P2.edge, JSON.stringify(P2));
    await ph.close();
  } else console.log('\n  not checked: the pass list\'s day headers are the rebuilt page\'s (CHANGES-FROM-LEGACY.md, L55); the old page had none');

  /* ---- the pass list's filter (CHANGES-FROM-LEGACY.md, L56) ------------------------------------------------------------------
     A filter of the list only. In a page of its own, with storage of its own: the ISS's first week from London in the assignment
     snapshot (37 passes, 14 of them naked-eye visible). Nothing is stored until the filter is touched. With it on, the rows are
     exactly the passes it keeps, worked out here from the analysis itself (the culmination, the optics' verdict, the AOS on the
     site's clock), each row with its own index as data-i and the words it had, and a press on a row selects that pass, as the
     AR view's suite presses rows by data-i (verify-ar.js); the minutes in view, the count, the countdown, the transport's marks
     and the report's table do not move. The selected pass hidden is said; the choice is there again after a reload; "Show every
     pass" stores nothing again; on a phone, Escape in the panel shuts the panel alone. */
  if (NEW) {
    console.log('\n  the pass list\'s filter');
    const fx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const fp = await fx.newPage();
    fp.on('pageerror', e => errs.push('filter: ' + String(e)));
    await fp.route('**://celestrak.org/**', r => r.abort());
    await fp.route('**://tle.ivanstanojevic.me/**', r => r.abort());
    await fp.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
    await fp.goto(PAGE + (PAGE.includes('?') ? '&' : '?') + 'tle=embedded&sat=25544&span=168&site=51.5000,-0.1200', { waitUntil: 'load' });
    const ready = () => fp.waitForFunction(() => !!window.__gt && !!window.__gt.D && window.__gt.D.hours === 168 && !!document.getElementById('passfilterbtn'), null, { timeout: 30000 });
    const pause = () => fp.evaluate(() => { const b = document.getElementById('tpplay'); if (b.getAttribute('aria-label') === 'Pause') b.click(); });
    await ready();
    await pause();
    const read = () => fp.evaluate(() => ({
      rows: [...document.querySelectorAll('#passlist .passrow')].map(r => ({ i: +r.dataset.i, n: r.querySelector('.n').textContent, label: r.getAttribute('aria-label'), title: r.getAttribute('title'), text: r.textContent })),
      cur: [...document.querySelectorAll('#passlist .passrow[aria-current="true"]')].map(r => +r.dataset.i),
      say: (document.getElementById('passfiltersay') || {}).textContent || null,
      hid: (document.getElementById('passfilterhid') || {}).textContent || null,
      btn: document.getElementById('passfilterbtn').textContent.trim(),
      stored: localStorage.getItem('gt.passfilter'),
      fixed: { big: document.getElementById('totalbig').textContent, exact: document.getElementById('totalexact').textContent,
               cd: document.getElementById('cdlabel').textContent + ' | ' + document.getElementById('cdwhen').textContent,
               marks: document.querySelectorAll('#tppasses > *').length, table: document.querySelectorAll('#passbody tr[data-i]').length, none: !!document.querySelector('#passlist > p') }
    }));
    /* what each test keeps, from the analysis: the AOS's minute of the site's day at the offset the page gives that instant */
    const want = await fp.evaluate(() => {
      const D = window.__gt.D, H = 3600000, idx = f => D.passes.map((p, i) => (f(p) ? i : -1)).filter(i => i >= 0);
      const min = ms => { const m = Math.floor((ms + window.__gt.tzAt(ms) * H) / 60000) % 1440; return m < 0 ? m + 1440 : m; };
      return { n: D.passes.length, peak30: idx(p => p.maxEl >= 30), eye: idx(p => (window.__gt.passOptical(D.track, p) || {}).eye === 'yes'),
               night: idx(p => { const m = min(p.t0ms); return m >= 20 * 60 || m < 4 * 60; }), maxAt: D.passes.map(p => p.maxAt.getTime()) };
    });
    const ids = R => JSON.stringify(R.rows.map(r => r.i));
    const R0 = await read();
    const before = new Map(R0.rows.map(r => [r.i, r]));
    /* a row shown says what it said with the filter off: its number, label, title and text */
    const same = R => R.rows.every(r => { const o = before.get(r.i); return !!o && o.n === r.n && o.label === r.label && o.title === r.title && o.text === r.text; });
    console.log('   ' + want.n + ' passes; 30° or more: ' + want.peak30.length + '; naked-eye visible: ' + want.eye.length + '; rising 20:00 to 04:00 site time: ' + want.night.length);
    chk('a visit that has not touched the filter stores nothing, lists every pass and says nothing of a filter',
        R0.stored === null && R0.btn === 'Filter' && !R0.say && !R0.hid && ids(R0) === JSON.stringify([...Array(want.n).keys()]),
        JSON.stringify({ stored: R0.stored, btn: R0.btn, rows: R0.rows.length }));

    await fp.click('#passfilterbtn');
    await fp.waitForSelector('#passfilter', { state: 'visible', timeout: 10000 });
    await fp.click('#passfilter [data-peak="30"]');
    await fp.waitForTimeout(200);
    const R1 = await read();
    chk('peaking at 30° or more: the rows are exactly those passes, each with its own index as data-i and the words it had',
        ids(R1) === JSON.stringify(want.peak30) && want.peak30.length > 1 && want.peak30.length < want.n && same(R1), ids(R1));
    chk('...the line under the button says how many and by what, the button says the filter is on, and the choice is stored',
        R1.say === 'Showing ' + want.peak30.length + ' of ' + want.n + ' passes: peaking at 30° or more.' && R1.btn === 'Filter · on' && !!R1.stored && JSON.parse(R1.stored).minPeak === 30,
        JSON.stringify({ say: R1.say, btn: R1.btn, stored: R1.stored }));
    chk('...and nothing else moved: the minutes in view, the count of passes, the countdown, the transport\'s marks and the report\'s table',
        JSON.stringify(R1.fixed) === JSON.stringify(R0.fixed) && R0.fixed.marks === want.n && R0.fixed.table === want.n && !R0.fixed.none, JSON.stringify(R1.fixed));

    /* a row pressed is its own pass, whatever its place in the list (shut the panel first: it lies over the rows) */
    await fp.keyboard.press('Escape');
    await fp.waitForSelector('#passfilter', { state: 'detached', timeout: 5000 });
    const k = want.peak30[1];
    await fp.click('#passlist .passrow[data-i="' + k + '"]');
    await fp.waitForTimeout(300);
    const S = await fp.evaluate(() => ({ facts: document.querySelector('#skyfacts .row dd').textContent.trim(), clock: document.getElementById('tpclock').textContent.trim() }));
    const S1 = await read();
    const clockMs = Date.parse(S.clock.replace(' ', 'T').replace(/Z?$/, 'Z'));
    chk('pressed, the row of pass ' + (k + 1) + ' (the second shown) selects pass ' + (k + 1) + ': it is the row marked, the facts say "' + (k + 1) + ' of ' + want.n + '", the clock is at its culmination',
        JSON.stringify(S1.cur) === JSON.stringify([k]) && S.facts === (k + 1) + ' of ' + want.n && Math.abs(clockMs - Math.floor(want.maxAt[k] / 1000) * 1000) < 1000 && !S1.hid,
        JSON.stringify({ cur: S1.cur, facts: S.facts, clock: S.clock }));
    const h = [...Array(want.n).keys()].find(i => !want.peak30.includes(i));
    await fp.click('#passbody tr[data-i="' + h + '"]');
    await fp.waitForTimeout(300);
    const S2 = await read();
    chk('a pass the filter hides, selected in the report\'s table, is said to be hidden, and no row is marked',
        S2.hid === 'Pass ' + (h + 1) + ', the one selected, is hidden by the filter; the sky plot and the facts under it still show it.' && S2.cur.length === 0, S2.hid);

    /* the eye, then the hours */
    await fp.evaluate(() => window.scrollTo(0, 0));
    await fp.click('#passfilterbtn');
    await fp.waitForSelector('#passfilter', { state: 'visible', timeout: 10000 });
    await fp.click('#passfilter [data-peak="0"]');
    await fp.check('#pf-eye');
    await fp.waitForTimeout(200);
    const R2 = await read();
    chk('naked-eye visible only: the rows are exactly the passes the optics call "yes", by their own indices',
        ids(R2) === JSON.stringify(want.eye) && want.eye.length > 0 && want.eye.length < want.n && same(R2) && R2.say === 'Showing ' + want.eye.length + ' of ' + want.n + ' passes: visible to the naked eye.',
        ids(R2) + ' | ' + R2.say);
    await fp.uncheck('#pf-eye');
    await fp.fill('#pf-from', '20:00');
    await fp.fill('#pf-to', '04:00');
    await fp.waitForTimeout(200);
    const R3 = await read();
    chk('rising between 20:00 and 04:00 site time (a span past midnight, turned on by typing a time): the rows are exactly those passes',
        ids(R3) === JSON.stringify(want.night) && want.night.length > 0 && want.night.length < want.n && same(R3)
          && R3.say === 'Showing ' + want.night.length + ' of ' + want.n + ' passes: rising between 20:00 and 04:00 site time.', ids(R3) + ' | ' + R3.say);

    /* kept: the same rows after a reload, the filter's chunk read the stored choice before the first press */
    await fp.reload({ waitUntil: 'load' });
    await ready();
    await pause();
    await fp.waitForSelector('#passfiltersay', { timeout: 10000 }).catch(() => {});
    const R4 = await read();
    chk('after a reload the stored filter is applied again before anything is pressed',
        ids(R4) === JSON.stringify(want.night) && R4.btn === 'Filter · on' && R4.say === R3.say, ids(R4));
    await fp.click('#passfilterbtn');
    await fp.waitForSelector('#passfilter', { state: 'visible', timeout: 10000 });
    await fp.click('#pf-reset');
    await fp.waitForTimeout(200);
    const R5 = await read();
    chk('"Show every pass" lists every pass again, says nothing of a filter and leaves nothing stored',
        ids(R5) === ids(R0) && R5.stored === null && !R5.say && R5.btn === 'Filter', JSON.stringify({ rows: R5.rows.length, stored: R5.stored, btn: R5.btn }));
    await fx.close();

    /* on a phone the panel opens inside the answer sheet: Escape with the focus in it shuts the panel alone, and gives the focus back to the
       button in the sheet; Escape again, from there, shuts the sheet, as it always did */
    const px = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pp = await px.newPage();
    pp.on('pageerror', e => errs.push('filter, phone: ' + String(e)));
    await pp.route('**://celestrak.org/**', r => r.abort());
    await pp.route('**://tle.ivanstanojevic.me/**', r => r.abort());
    await pp.goto(PAGE + (PAGE.includes('?') ? '&' : '?') + 'tle=embedded&sat=25544', { waitUntil: 'load' });
    await pp.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!document.getElementById('passfilterbtn'), null, { timeout: 30000 });
    await pp.click('.rail .peek');
    await pp.waitForTimeout(300);
    await pp.click('#passfilterbtn');
    await pp.waitForSelector('#passfilter', { state: 'visible', timeout: 10000 });
    await pp.waitForFunction(() => !!document.activeElement && !!document.activeElement.closest('#passfilter'), null, { timeout: 3000 }).catch(() => {});
    const sheet = () => pp.evaluate(() => ({ open: document.querySelector('.rail .peek').getAttribute('aria-expanded'), panel: !!document.getElementById('passfilter'),
      focus: document.activeElement ? (document.activeElement.id || document.activeElement.tagName.toLowerCase()) + (document.activeElement.closest('#passfilter') ? ' (in the panel)' : '') : null }));
    const P0 = await sheet();
    await pp.keyboard.press('Escape');
    await pp.waitForTimeout(300);
    const P1 = await sheet();
    await pp.keyboard.press('Escape');
    await pp.waitForTimeout(300);
    const P2 = await sheet();
    chk('on a phone, Escape in the filter\'s panel shuts the panel and leaves the answer sheet open, with the focus on the button; Escape again shuts the sheet',
        P0.open === 'true' && P0.panel && /in the panel/.test(P0.focus) && P1.open === 'true' && !P1.panel && P1.focus === 'passfilterbtn' && P2.open === 'false',
        JSON.stringify([P0, P1, P2]));
    await px.close();
  } else console.log('\n  not checked: the pass list\'s filter is the rebuilt page\'s (CHANGES-FROM-LEGACY.md, L56); the old page had none');

  console.log('\npage errors: ' + (errs.length ? errs.slice(0, 3).join(' | ') : 'none'));
  /* The 3D scene is not in the rebuilt app until milestone M6; its trail switch is checked then, unchanged. Said out loud
     rather than passed over: four checks are not being made. */
  const hasScene = await page.evaluate(() => typeof window.Orbit3D !== 'undefined');
  if (!hasScene) console.log('  SKIP  the trail switch (4 checks): no 3D scene in this build yet (milestone M6)');
  if (hasScene) {
    // ---- the trail switch ----------------------------------------------------
    /* Off is a segment of the trail control rather than a checkbox beside it, so
       there is one control with one state instead of a tickbox and a row of
       durations that mean nothing while it is unticked.

       The check that matters is the last one. setSat() makes the whole
       ground-bound group visible again every time a spacecraft is loaded, so a
       trail switched off would quietly come back the moment the reader picked a
       different object - which is why it is a flag the loader consults and not
       just the mesh's visible bit. Read off the mesh in the scene graph, never
       off the button's aria-pressed: the button is the thing being tested. */
    const trailMesh = () => page.evaluate(() => {
      let tl = null;
      Orbit3D.scene.traverse(o => {
        if (o.type === 'Line' && o.material && o.material.vertexColors
            && o.geometry.attributes.color) tl = o;
      });
      return tl ? { visible: tl.visible, pts: tl.geometry.attributes.position.count } : null;
    });
    const trailClick = t => page.evaluate(v =>
      [...document.querySelectorAll('.trailseg .trl')].find(x => x.dataset.t === v).click(), t);

    const segs = await page.evaluate(() =>
      [...document.querySelectorAll('.trailseg .trl')].map(x => x.textContent.trim()));
    chk('the trail control carries its own off switch', segs[0] === 'Off', segs.join(' '));

    const on0 = await trailMesh();
    chk('...and the trail is drawn to begin with', !!on0 && on0.visible === true,
        on0 ? on0.pts + ' points, visible' : 'no trail mesh found');

    await trailClick('off');
    await page.waitForTimeout(700);
    const off0 = await trailMesh();
    chk('...Off takes it out of the scene', off0 && off0.visible === false,
        off0 ? 'visible = ' + off0.visible : 'mesh gone');

    /* Load a different spacecraft. This is the regression. */
    const otherName = await page.evaluate(() => __gt.CAT.find(c => String(c.satnum) !== String(__gt.D.E.satnum)).name);
    await H.pickExact(page, otherName);                    // through the picker, whichever build it is
    await page.waitForTimeout(2500);
    const offAfter = await trailMesh();
    chk('...and stays off when a different spacecraft is loaded',
        offAfter && offAfter.visible === false,
        offAfter ? 'visible = ' + offAfter.visible : 'mesh gone');
    chk('...with the button still showing it',
        await page.evaluate(() => document.querySelector('.trailseg .trl[data-t=off]')
          .getAttribute('aria-pressed') === 'true'));

    await trailClick('21600000');
    await page.waitForTimeout(700);
    const back = await trailMesh();
    chk('...and a duration brings it back', back && back.visible === true,
        back ? back.pts + ' points, visible' : 'mesh gone');

  }

  if (errs.length) fails++;

  await browser.close();
  console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASS');
  process.exit(fails ? 1 : 0);
})();
