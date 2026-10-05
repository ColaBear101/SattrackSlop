/* verify-slice.js - the rebuilt console, end to end, as a visitor meets it.
 *
 * Not a port of an old suite: the first thing the new app has to get right is its own load. It checks,
 * on the production build (GT_TARGET=new, `npm run build` first):
 *
 *   - the assignment snapshot, ?tle=embedded: KNACKSAT-2 reads 899.7 s over 2 passes, from the DOM
 *   - a visitor's load (no test flag) fetches no test surface, no third-party host, and throws nothing
 *   - with the flag, the test surface appears and exposes the live analysis the page is showing
 *   - the Moon pages are served and unchanged (hash-checked in tests/moon; here: they answer 200)
 *
 * The README's headline figures are reproducible only from this URL, so it is guarded here and not just
 * in the baseline: the gate proves the numbers, this proves the page shows them.
 */
'use strict';
const H = require('./lib/harness');

let failed = 0, ran = 0;
function chk(name, ok, detail) {
  ran++;
  if (!ok) failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined ? '   ' + detail : ''));
}

(async () => {
  if (H.targetName() !== 'new') {
    console.log('verify-slice checks the rebuilt app: run it with GT_TARGET=new after `npm run build`');
    process.exit(0);
  }
  const srv = await H.up();

  /* ---- a visitor: no test flag --------------------------------------------------------------- */
  {
    const { chromium } = H.playwright({ testFlag: false });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errs = [], reqs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('request', r => reqs.push(r.url()));
    await page.goto(srv.page + '?tle=embedded', { waitUntil: 'load' });
    await page.waitForSelector('#totalsub', { timeout: 30000 });
    const name = await page.textContent('#satname');
    const sub = (await page.textContent('#totalsub')).replace(/\s+/g, ' ').trim();
    const exact = (await page.textContent('#totalexact')).replace(/\s+/g, ' ').trim();
    const big = (await page.textContent('#totalbig')).trim();
    const rows = await page.$$eval('#passbody tr', trs => trs.length);
    chk('?tle=embedded opens on KNACKSAT-2', name === 'KNACKSAT-2', name);
    chk('...which reads 899.7 s over 2 passes (the README figure)', /899\.7 s over 2 passes/.test(exact), exact);
    chk('...saying which window and which set, under the answer',
        /15 min 00 s in view over 24 h from 2026-09-12 14:29 UTC\+7/.test(sub) && /epoch 2026-09-12 07:29Z, embedded/.test(sub), sub);
    chk('...as 15.0 min in the headline', big === '15.0 min', big);
    chk('...with two rows in the pass list', rows === 2, String(rows));
    chk('a visitor has no test surface', await page.evaluate(() => typeof window.__gt === 'undefined'));
    const foreign = reqs.filter(u => !u.startsWith(srv.origin) && !u.startsWith('data:'));
    chk('no request leaves the origin (no CDN, no fonts, no API probe under ?tle=embedded)', foreign.length === 0, foreign.join(' ') || 'none');
    chk('no script chunk named like the test surface was fetched', !reqs.some(u => /surface/i.test(u)), reqs.filter(u => /\.js/.test(u)).map(u => u.split('/').pop()).join(' '));
    chk('no page error and nothing on the console', errs.length === 0, errs.join(' | ') || 'none');
    await browser.close();
  }

  /* ---- the harness: with the flag, the surface appears --------------------------------------- */
  {
    const { chromium } = H.playwright();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(srv.page + '?tle=embedded', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__gt, null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const gt = window.__gt;
      return { cat: gt.CAT.length, name: gt.D && gt.D.entry.name, passes: gt.D && gt.D.passes.length,
               keys: gt.D && Object.keys(gt.D).join(','), obs: Object.keys(gt.OBS).join(','), mask: gt.MASK };
    });
    chk('the test surface sees the 2,158-set catalogue', r.cat === 2158, String(r.cat));
    chk('...and the analysis the page is showing', r.name === 'KNACKSAT-2' && r.passes === 2, r.name + ' ' + r.passes);
    chk('...which has exactly the fifteen keys compute() always had',
        r.keys === 'entry,track,satrec,E,start,end,pts,passes,totalS,meanAlt,lambda,step,hours,drawStride,reentry', r.keys);
    chk('OBS is exactly {lat, lon, altKm, name, tz} and the mask is 5', r.obs === 'lat,lon,altKm,name,tz' && r.mask === 5, r.obs + ' / ' + r.mask);
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await browser.close();
  }

  /* ---- the keys: what the transport and the stage answer to, and what they leave to the focused control ---- */
  {
    const { chromium } = H.playwright({ testFlag: false });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(srv.page + '?tle=embedded', { waitUntil: 'load' });
    await page.waitForSelector('#totalbig', { timeout: 30000 });
    const label = () => page.getAttribute('#tpplay', 'aria-label');
    const was = await label();
    await page.keyboard.press('Space');
    const toggled = await label();
    chk('Space plays and pauses the clock', was !== toggled, was + ' -> ' + toggled);
    await page.keyboard.press('Space');
    chk('...and again', (await label()) === was);
    const rate0 = await page.textContent('#tpratev');
    await page.keyboard.press(']'); await page.keyboard.press(']');
    const rate1 = await page.textContent('#tpratev');
    chk('] doubles the rate and [ halves it', rate0.trim() === '1.0×' && rate1.trim() === '4.0×', rate0 + ' -> ' + rate1);
    await page.keyboard.press('[');
    chk('...', (await page.textContent('#tpratev')).trim() === '2.0×');
    const t0 = Date.parse((await page.textContent('#tpclock')).trim().replace(' ', 'T') + 'Z');
    await page.keyboard.press('ArrowRight');
    const t1 = Date.parse((await page.textContent('#tpclock')).trim().replace(' ', 'T') + 'Z');
    chk('the right arrow steps the clock on a minute, and stops it there', t1 - t0 >= 59000 && t1 - t0 <= 61000 && (await label()) === 'Play', (t1 - t0) / 1000 + ' s');
    await page.keyboard.press('g');
    chk('g shows the Globe and m the Map', (await page.getAttribute('[role=tab]:has-text("Globe")', 'aria-selected')) === 'true');
    await page.keyboard.press('m');
    chk('...', (await page.getAttribute('[role=tab]:has-text("Map")', 'aria-selected')) === 'true');
    /* a key that means something where the focus is is left to it: Space on a focused button presses that button,
       not the clock; typing a letter into the picker's field does not switch tabs */
    await page.focus('#tpplay');
    const before = await label();
    await page.keyboard.press('Space');
    chk('Space on a focused button is that button\'s, and nothing else\'s', (await label()) !== before);
    await page.click('#satname');
    await page.keyboard.type('gm');
    chk('typing in the picker is the picker\'s',
        (await page.inputValue('#satsearch')) === 'gm' && (await page.getAttribute('[role=tab]:has-text("Map")', 'aria-selected')) === 'true');
    await browser.close();
  }

  /* ---- the Moon pages ------------------------------------------------------------------------ */
  for (const p of ['moon.html', 'moon-track.html', 'core/body.js', 'moon/moondata.js']) {
    const res = await fetch(srv.url(p));
    chk('/' + p + ' is served', res.status === 200, String(res.status));
  }
  const missing = await fetch(srv.url('api/health'));
  chk('an unknown /api/ path is a real 404, not the app shell', missing.status === 404, String(missing.status));

  await srv.close();
  console.log('\n' + (failed ? failed + ' of ' + ran + ' CHECK(S) FAILED' : 'ALL ' + ran + ' CHECKS PASS'));
  /* Not process.exit(): on Windows, exiting while keep-alive sockets are still closing trips a libuv
     assertion (UV_HANDLE_CLOSING) after the last line has printed, and the runner reads that as a failure. */
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
