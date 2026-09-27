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
 * Phases 6 to 8 are the answers that are not a fresher set: the provenance line
 * has to follow the spacecraft rather than the last fetch, a newer set that
 * SGP4 cannot propagate has to be refused, and CelesTrak's "No GP data found"
 * has to be reported as a withdrawal rather than an outage.
 *
 * Phase 9 is the refresh switched off on purpose: ?tle=embedded, the assignment
 * snapshot, which keeps the embedded sets and opens each window at its set's
 * epoch so that the README's figures can be reproduced on the page itself.
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
/* Same object, mean motion replaced. 17.5 rev/day is a semi-major axis inside
   the Earth, which SGP4 answers with error 6 at every instant: the shape of a
   later element set for an object that has come down. */
function withMeanMotion(l2, n) {
  const body = l2.substring(0, 52) + n.toFixed(8).padStart(11, ' ') + l2.substring(63, 68);
  return body + checksum(body);
}

let served = null, hits = 0, fails = 0;
let mine = null, gone = false, altServed = null, altHits = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrs = [];
  page.on('pageerror', e => pageErrs.push(e.message));

  /* One source under test. The mirror is counted, and answers only in phase 8,
     where the point is that it is not asked at all. */
  await page.route(ALT, r => {
    altHits++;
    return altServed ? r.fulfill({ status: 200, contentType: 'application/json', body: altServed })
                     : r.abort();
  });
  /* The globe's NASA imagery is nothing to do with this check, and letting it
     run costs seconds of wall clock that the timings here are measured against.
     Blocked, so the page takes its documented fallback to the drawn coastlines. */
  await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
  await page.route(GP, async r => {
    /* Any other spacecraft (phase 6) gets a slow failure, so there is a moment
       in which its own check is visibly still running. */
    const id = new URL(r.request().url()).searchParams.get('CATNR');
    if (mine && id !== mine) { await new Promise(res => setTimeout(res, 1500)); return r.abort(); }
    hits++;
    if (gone) return r.fulfill({ status: 404, contentType: 'text/plain', body: 'No GP data found' });
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
  mine = base.satnum;
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
  /* The set held here is the newer one phase 3 took live, and it said
     "keeping the embedded one" of it. */
  chk('...naming the set it keeps as the one fetched live, not the embedded one',
      /keeping the newer one on screen, fetched live/.test(st.meta) && !/embedded one/.test(st.meta),
      st.meta.slice(0, 110));
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
  await page.waitForTimeout(700);

  // ---- phase 6: the line belongs to the spacecraft on screen ---------------
  /* The provenance used to be one page-wide variable that nothing reset on a
     change of spacecraft, so the line described whichever object had been
     checked last. Confirm this one, move to another whose check is slow and
     then fails, and come back - through the picker, as a user would. */
  const pick = async q => {
    await page.click('#satsearch');
    await page.fill('#satsearch', q);
    await page.keyboard.press('Enter');
  };
  const cur = await page.evaluate(() => ({ l1: __gt.D.entry.l1, l2: __gt.D.entry.l2 }));
  served = cur.l1 + '\n' + cur.l2;
  await tick();
  st = await state();
  chk('(set up) the spacecraft is confirmed current', /[Cc]onfirmed current/.test(st.meta),
      st.meta.slice(0, 60));
  const epoch6 = st.epoch;
  const other = await page.evaluate(n => __gt.CAT.find(c => c.satnum !== n && /^GOES 18$/.test(c.name))
                                      || __gt.CAT.find(c => c.satnum !== n), base.satnum);
  await pick(other.satnum);
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => ({ name: __gt.D.entry.name,
    meta: document.getElementById('tlemeta').textContent.replace(/\s+/g, ' ').trim() }));
  chk('another spacecraft does not inherit that verdict while its own check runs',
      mid.name === other.name && /Checking for a newer element set/.test(mid.meta),
      mid.name + ': ' + mid.meta.slice(0, 60));
  await page.waitForTimeout(2500);
  const failed = await page.evaluate(() =>
    document.getElementById('tlemeta').textContent.replace(/\s+/g, ' ').trim());
  chk('...and reports its own failure once that check ends', /No live source reachable/.test(failed),
      failed.slice(0, 60));
  const hitsBack = hits;
  await pick(base.satnum);
  await page.waitForTimeout(800);
  st = await state();
  chk('coming back shows this spacecraft\'s own result, not the last one fetched',
      /[Cc]onfirmed current/.test(st.meta) && st.epoch === epoch6,
      st.meta.slice(0, 60));
  chk('...without asking again, since its check is not due', hits === hitsBack,
      'requests ' + hitsBack + ' -> ' + hits);

  // ---- phase 7: a newer set SGP4 cannot propagate --------------------------
  /* What a mirror serves for an object that has come down: a later element
     set, with the orbit inside the Earth. Adopting it used to throw out of the
     reload with the entry already rewritten, and every span change after that
     threw again. */
  const heldNow = await page.evaluate(() => ({ l1: __gt.D.entry.l1, epoch: __gt.D.E.epoch.getTime() }));
  served = withEpoch(cur.l1, 1) + '\n' + withMeanMotion(cur.l2, 17.5);
  const errsBefore = pageErrs.length;
  /* Someone is typing in the picker when the refused set comes back. The
     restore after the refusal used to write the spacecraft's name over it. */
  await page.fill('#satsearch', 'GOES 1');
  await tick();
  st = await state();
  const typed = await page.evaluate(() => document.getElementById('satsearch').value);
  await page.keyboard.press('Escape');
  const kept = await page.evaluate(() => __gt.D.entry.l1);
  chk('a newer set SGP4 cannot propagate is not adopted', st.epoch === heldNow.epoch
      && kept === heldNow.l1, 'epoch still ' + new Date(st.epoch).toISOString());
  chk('...and the page says why, in SGP4\'s terms',
      /cannot propagate/.test(st.meta) && /error 6: decayed/.test(st.meta) && /re-entered/.test(st.meta),
      st.meta.slice(0, 90));
  chk('...and leaves alone what was being typed in the picker', typed === 'GOES 1',
      JSON.stringify(typed));
  await page.click('.bar-window .span[data-h="72"]');
  await page.waitForTimeout(1200);
  const span72 = await page.evaluate(() => __gt.D.hours);
  await page.click('.bar-window .span[data-h="24"]');
  await page.waitForTimeout(900);
  chk('...and the span still changes afterwards, without a page error',
      span72 === 72 && pageErrs.length === errsBefore,
      span72 + ' h; ' + (pageErrs.slice(errsBefore).join(' | ') || 'no errors'));

  // ---- phase 8: CelesTrak no longer carries the object ---------------------
  /* A 404 with "No GP data found" is CelesTrak's answer for an object it has
     withdrawn - for something in this catalogue, nearly always a re-entry. The
     mirror here would happily confirm the set on screen; it must not be asked. */
  gone = true;
  altServed = JSON.stringify({ line1: cur.l1, line2: cur.l2 });
  const altBefore = altHits;
  await tick();
  st = await state();
  chk('CelesTrak\'s "No GP data found" is reported as such, not as an outage',
      /CelesTrak has no current elements/.test(st.meta) && /re-entered/.test(st.meta),
      st.meta.slice(0, 80));
  chk('...and the mirror is not asked to overrule it', altHits === altBefore
      && !/[Cc]onfirmed current/.test(st.meta), 'mirror requests ' + altBefore + ' -> ' + altHits);
  chk('...and it is re-checked on the normal interval', Math.abs((st.next - st.now) - TTL) < 60e3,
      'due in ' + ((st.next - st.now) / HOUR).toFixed(2) + ' h (expect 3.00)');
  gone = false; altServed = null;

  // ---- phase 9: the assignment snapshot ------------------------------------
  /* ?tle=embedded pins the embedded element sets and opens each window at its
     set's epoch, which is how the README's figures were computed. A newer set
     is on offer here, and must not even be asked for. The figures checked are
     the README's own: KNACKSAT-2's (c), and the LANDSAT 9 comparison reached
     through the answer block's "Show LANDSAT 9" - the one-click way from the
     default, which is outside the brief's Earth Resources group, to an object
     inside it. A new page is a new browser context, so nothing cached above
     carries over. */
  const pin = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  pin.on('pageerror', e => pageErrs.push(e.message));
  let pinHits = 0;
  const newer = withEpoch(base.l1, 1) + '\n' + base.l2;
  await pin.route(GP, r => { pinHits++; return r.fulfill({ status: 200, contentType: 'text/plain', body: newer }); });
  await pin.route(ALT, r => { pinHits++; return r.abort(); });
  await pin.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
  await pin.goto(PAGE + '?tle=embedded', { waitUntil: 'load' });
  await pin.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
  await pin.waitForTimeout(1500);
  const pinState = () => pin.evaluate(() => ({
    name: __gt.D.entry.name, l1: __gt.D.entry.l1,
    start: __gt.D.start.getTime(), epoch: __gt.D.E.epoch.getTime(),
    totalS: __gt.D.totalS, passes: __gt.D.passes.length,
    brief: !document.getElementById('briefnote').hidden,
    sub: document.getElementById('totalsub').textContent,
    meta: document.getElementById('tlemeta').textContent.replace(/\s+/g, ' ').trim() }));
  let ps = await pinState();
  chk('the assignment snapshot keeps the embedded set and asks no source',
      ps.name === base.name && ps.l1 === base.l1 && pinHits === 0,
      ps.name + ', requests ' + pinHits);
  chk('...opens the window at the element set epoch', ps.start === ps.epoch,
      new Date(ps.start).toISOString());
  chk('...and gives the README\'s answer to (c): 899.7 s over 2 passes',
      ps.totalS.toFixed(1) === '899.7' && ps.passes === 2, ps.totalS + ' s, ' + ps.passes + ' passes');
  chk('...saying which window and which set, under the answer and in the provenance',
      /over 24 h from 2026-09-12 14:29 UTC\+7/.test(ps.sub) && /epoch 2026-09-12 07:29Z, embedded/.test(ps.sub)
      && /Assignment snapshot/.test(ps.meta), ps.sub);
  await pin.evaluate(() => {
    __gt.D.entry.__next = 0;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pin.waitForTimeout(800);
  chk('...and a due re-check still asks nothing', pinHits === 0, 'requests ' + pinHits);
  chk('the default is flagged in the answer block as outside the brief', ps.brief, ps.name);
  await pin.click('#briefgo');
  await pin.waitForTimeout(1500);
  ps = await pinState();
  chk('"Show LANDSAT 9" loads it, at its own epoch, and the flag goes',
      ps.name === 'LANDSAT 9' && ps.start === ps.epoch && !ps.brief,
      ps.name + ' from ' + new Date(ps.start).toISOString());
  chk('...giving the README\'s comparison: 37.74 min over 4 passes',
      (ps.totalS / 60).toFixed(2) === '37.74' && ps.passes === 4,
      (ps.totalS / 60).toFixed(3) + ' min, ' + ps.passes + ' passes');
  await pin.context().close();

  console.log('\npage errors: ' + (pageErrs.length ? pageErrs.join(' | ') : 'none'));
  console.log('mocked requests served: ' + hits);
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || pageErrs.length ? 1 : 0);
})();
