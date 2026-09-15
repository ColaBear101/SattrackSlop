/*
 * The live TLE refresh, driven against mocked sources.
 *
 * index.html re-checks the element set while the page is open, which the
 * bit-identical gate cannot see: regress.js blocks the network precisely so that
 * a refresh cannot rewrite the numbers mid-run, so every path below is invisible
 * to it. The behaviour still has to be checked, and it cannot be checked against
 * the real CelesTrak - the answer would depend on what was served that minute,
 * and asserting "a newer set is adopted" needs a newer set to exist on demand.
 *
 * So the sources are mocked and the element set is manufactured: the page's own
 * embedded lines with the epoch shifted forward or back a day, checksums
 * recomputed. That makes the forward-only rule testable in both directions.
 *
 * Nothing is called through a test hook. The page script is wrapped in an IIFE,
 * so the only way in is the way a user has: a visibilitychange event, and the
 * interval the page sets for itself. Phase 5 waits the full 30 s rather than
 * reaching inside, because the wiring of that timer is the thing being checked.
 *
 *   node verification/verify-refresh.js          (needs playwright)
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');
const GP   = '**celestrak.org/NORAD/elements/gp.php**';
const ALT  = '**tle.ivanstanojevic.me/**';
const HOUR = 3600e3, TTL = 3 * HOUR, RETRY = 5 * 60e3;

function checksum(line) {                      // TLE mod-10; '-' counts as 1
  let s = 0;
  for (const c of line.substring(0, 68)) {
    if (c >= '0' && c <= '9') s += +c;
    else if (c === '-') s += 1;
  }
  return s % 10;
}
function withEpoch(l1, days) {                 // same object, epoch shifted
  const ep = parseFloat(l1.substring(20, 32));
  const body = l1.substring(0, 20) + (ep + days).toFixed(8).padStart(12, '0') + l1.substring(32, 68);
  return body + checksum(body);
}

let served = null, hits = 0, fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrs = [];
  page.on('pageerror', e => pageErrs.push(e.message));

  await page.route(ALT, r => r.abort());               // one source under test
  /* The globe's NASA imagery is nothing to do with this check, and letting it
     run costs seconds of wall clock that the timings here are measured against.
     Blocked, so the page takes its documented fallback to the drawn coastlines. */
  await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
  await page.route(GP, r => {
    hits++;
    return served ? r.fulfill({ status: 200, contentType: 'text/plain', body: served })
                  : r.abort();
  });

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  /* D.entry is the catalogue record now on screen - the same object refreshTLE
     mutates - so the test can read its re-arm time without a hook of its own. */
  const base = await page.evaluate(() => {
    const e = __gt.D.entry;
    return { satnum: e.satnum, name: e.name, l1: e.l1, l2: e.l2,
             next: e.__next, now: Date.now(), epoch: __gt.D.E.epoch.getTime() };
  });
  console.log('\nspacecraft     : ' + base.name + '  (NORAD ' + base.satnum + ')');
  console.log('embedded epoch : ' + new Date(base.epoch).toISOString() + '\n');

  // ---- phase 0: no source reachable ---------------------------------------
  chk('an unreachable source re-arms rather than retiring the entry',
      isFinite(base.next), '__next is ' + (isFinite(base.next) ? 'finite' : String(base.next)));
  chk('...backing off by the retry interval, not the full TTL',
      Math.abs((base.next - base.now) - RETRY) < 3000,
      'due in ' + ((base.next - base.now) / 1000).toFixed(0) + ' s (expect 300)');

  const tick = async () => {                   // make a check due, then let it run
    const before = hits;
    await page.evaluate(() => {
      localStorage.removeItem('tle:' + __gt.D.entry.satnum);
      __gt.D.entry.__next = 0;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    for (let i = 0; i < 60 && hits === before; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(700);
  };
  const state = () => page.evaluate(() => ({
    next: __gt.D.entry.__next, now: Date.now(), epoch: __gt.D.E.epoch.getTime(),
    meta: document.getElementById('tlemeta').textContent.replace(/\s+/g, ' ').trim()
  }));

  // ---- phase 1: the guard -------------------------------------------------
  served = base.l1 + '\n' + base.l2;
  const guardBefore = hits;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(800);
  chk('a tick before __next comes due makes no request', hits === guardBefore,
      'requests ' + guardBefore + ' -> ' + hits);

  // ---- phase 2: the same set back = confirmed current ---------------------
  await tick();
  let st = await state();
  chk('a due tick does reach the network', hits === guardBefore + 1, 'requests = ' + hits);
  chk('an identical set re-arms at the 3 h TTL', Math.abs((st.next - st.now) - TTL) < 60e3,
      'due in ' + ((st.next - st.now) / HOUR).toFixed(2) + ' h (expect 3.00)');
  chk('the page reports the set as confirmed current', /[Cc]onfirmed current/.test(st.meta));
  chk('...and says WHEN it was checked', /checked (just now|.+ ago)/.test(st.meta),
      st.meta.slice(0, 70));

  // ---- phase 3: a newer set is taken --------------------------------------
  served = withEpoch(base.l1, 1) + '\n' + base.l2;
  await tick();
  st = await state();
  const advanced = (st.epoch - base.epoch) / 86400e3;
  chk('a newer element set is adopted', Math.abs(advanced - 1) < 1e-6,
      'epoch advanced ' + advanced.toFixed(6) + ' days (expect 1)');
  chk('...and the page says it updated live', /Updated live/.test(st.meta));
  chk('...and re-arms at the TTL again', Math.abs((st.next - st.now) - TTL) < 60e3,
      'due in ' + ((st.next - st.now) / HOUR).toFixed(2) + ' h');

  // ---- phase 4: an older set is refused -----------------------------------
  /* The rule that matters most: a mirror can legitimately serve an element set
     older than the one already held, and taking it in the name of freshness
     would be exactly backwards. */
  const held = st.epoch;
  served = withEpoch(base.l1, -3) + '\n' + base.l2;
  await tick();
  st = await state();
  chk('an older element set is refused', st.epoch === held,
      'epoch still ' + new Date(st.epoch).toISOString());
  chk('...and the page says so rather than failing silently', /older set/.test(st.meta),
      st.meta.slice(0, 70));
  chk('...and a stale mirror backs off to the TTL, not the 5 min retry',
      Math.abs((st.next - st.now) - TTL) < 60e3,
      'due in ' + ((st.next - st.now) / HOUR).toFixed(2) + ' h (expect 3.00)');

  // ---- phase 5: the interval fires unprompted -----------------------------
  served = base.l1 + '\n' + base.l2;
  const idleBefore = hits;
  await page.evaluate(() => {
    localStorage.removeItem('tle:' + __gt.D.entry.satnum);
    __gt.D.entry.__next = 0;
  });
  console.log('\n  (waiting 32 s for an unprompted interval tick)');
  for (let i = 0; i < 330 && hits === idleBefore; i++) await page.waitForTimeout(100);
  chk('the 30 s interval re-checks with no user action at all', hits > idleBefore,
      'requests ' + idleBefore + ' -> ' + hits);

  console.log('\npage errors: ' + (pageErrs.length ? pageErrs.join(' | ') : 'none'));
  console.log('mocked requests served: ' + hits);
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || pageErrs.length ? 1 : 0);
})();
