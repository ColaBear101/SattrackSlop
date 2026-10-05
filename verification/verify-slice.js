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
    const big = (await page.textContent('#totalbig')).trim();
    const rows = await page.$$eval('#passbody tr', trs => trs.length);
    chk('?tle=embedded opens on KNACKSAT-2', name === 'KNACKSAT-2', name);
    chk('...which reads 899.7 s over 2 passes (the README figure)', /899\.7 s over 2 passes/.test(sub), sub);
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
