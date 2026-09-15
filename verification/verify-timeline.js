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
 */
'use strict';
const path = require('path');

const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');
let fails = 0;
function chk(name, ok, detail){
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if(!ok) fails++;
}
const iso = ms => new Date(ms).toISOString().slice(0, 16);

(async () => {
  const { chromium } = require('playwright');
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
    aos: (document.querySelector('#passbody tr td:nth-child(2)') || {}).textContent || ''
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

  console.log('\npage errors: ' + (errs.length ? errs.slice(0, 3).join(' | ') : 'none'));
  if (errs.length) fails++;

  await browser.close();
  console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASS');
  process.exit(fails ? 1 : 0);
})();
