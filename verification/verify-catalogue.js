/*
 * The catalogue holds objects that are no longer in orbit.
 *
 * It is a snapshot, built 2026-09-12 from sets as old as mid-July, and things
 * have come down since. SGP4 meets them in two ways, and the page used to
 * handle neither:
 *
 *  - It refuses them outright. Propagated past the point where its drag terms
 *    take the orbit inside the Earth, SGP4 returns error 6 ("decayed") for every
 *    instant, compute() has nothing to analyse, and it throws. The throw came
 *    out of load() after the picker had already moved, so the page went on
 *    showing KNACKSAT-2 under a picker reading "ODIN", and every later change
 *    of span or window threw again.
 *  - It propagates them anyway. Short of that point it goes on producing
 *    positions at 40 km, then at 20, and the page quoted passes, naked-eye
 *    verdicts and Doppler for them, and exported the lot.
 *
 * Both are driven here through the controls a user has - the picker, the
 * window buttons, the span buttons, the transport and the export button - in a
 * FIXED window, because which objects are decayed depends on when you ask. The
 * window's datetime-local field is in the observer's time - Bangkok, UTC+7 -
 * whatever the browser's zone, so an instant goes in and comes out seven hours
 * on; the browser runs in UTC so that nothing here agrees with the field by
 * accident. The live refresh is blocked: it would swap element sets mid-run.
 *
 * The objects and instants are the embedded catalogue's own - ODIN, and COSMOS
 * 2558, whose set SGP4 last propagates at 11:39:50 on 2026-09-15. A rebuild
 * that drops them has to choose others, the same way.
 *
 *   node verification/verify-catalogue.js          (needs playwright)
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');
const DAY = 86400e3;
const BKK = 7 * 3600e3;                         // the field reads Bangkok time
const W0 = Date.UTC(2026, 8, 14, 0, 0, 0);     // COSMOS 2558 still up; ODIN long gone

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};
const iso = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'UTC', acceptDownloads: true,
                                         viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**celestrak.org/**', r => r.abort());
  await page.route('**tle.ivanstanojevic.me/**', r => r.abort());
  /* The globe's NASA imagery is nothing to do with this check. */
  await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });

  const state = () => page.evaluate(() => {
    const note = document.getElementById('loadnote'), re = document.getElementById('reentry');
    return {
      shown: __gt.D.entry.name, masthead: document.getElementById('satname').textContent,
      picker: document.getElementById('satsearch').value,
      start: __gt.D.start.getTime(), hours: __gt.D.hours,
      winIn: document.getElementById('winStartIn').value,
      span: (document.querySelector('.bar-window .span[aria-pressed="true"]') || {}).textContent,
      note: note.hidden ? '' : note.textContent,
      reentry: re.hidden ? '' : re.textContent,
      field: __gt.D.reentry, passes: __gt.D.passes.length
    };
  });
  const pick = async q => {
    await page.click('#satsearch');
    await page.fill('#satsearch', q);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
  };
  const setWindow = ms => page.evaluate(v => {
    const inp = document.getElementById('winStartIn');
    inp.value = v; inp.dispatchEvent(new Event('change'));
  }, new Date(ms + BKK).toISOString().slice(0, 16));

  await setWindow(W0);
  await page.waitForTimeout(900);
  let s = await state();
  console.log('\nwindow ' + iso(s.start) + ' UTC, ' + s.hours + ' h, on screen: ' + s.shown + '\n');

  // ---- refused outright ---------------------------------------------------
  const errsBefore = errs.length;
  await pick('26702');                                   // ODIN, decayed 2026-08-03
  s = await state();
  chk('a decayed object is refused without a page error', errs.length === errsBefore,
      errs.slice(errsBefore).join(' | ') || 'none');
  chk('...the masthead and the analysis stay on the spacecraft that was there',
      s.shown === 'KNACKSAT-2' && s.masthead === 'KNACKSAT-2', s.masthead + ' / D: ' + s.shown);
  chk('...and the picker goes back to naming it, not the refused one',
      s.picker === 'KNACKSAT-2', 'picker reads ' + JSON.stringify(s.picker));
  chk('...and the page says why, with SGP4\'s own reason',
      /ODIN/.test(s.note) && /error 6: decayed/.test(s.note) && /Still showing KNACKSAT-2/.test(s.note),
      s.note);

  /* The regression that made this more than cosmetic: curIdx had moved, so
     every later reload re-ran the failure. */
  await page.click('.bar-window .span[data-h="72"]');
  await page.waitForTimeout(1200);
  s = await state();
  chk('a later span change loads normally', errs.length === errsBefore && s.hours === 72
      && s.shown === 'KNACKSAT-2', s.shown + ', ' + s.hours + ' h, errors ' + (errs.length - errsBefore));
  chk('...and the refusal note clears once something loads', s.note === '', s.note || 'hidden');
  await page.click('.bar-window .span[data-h="24"]');
  await page.waitForTimeout(900);

  // ---- propagated, but below the entry interface ---------------------------
  await pick('53323');                                   // COSMOS 2558, decayed 2026-09-12 per SATCAT
  s = await state();
  chk('an object SGP4 still propagates, but low, does load', s.shown === 'COSMOS 2558'
      && s.picker === 'COSMOS 2558', s.shown);
  chk('...and is flagged as re-entering', !!s.field && s.field.minAlt < 120,
      s.field ? 'lowest ' + s.field.minAlt.toFixed(1) + ' km' : 'no flag');
  chk('...in the answer block, where the minutes in view are read',
      /Re-entry/.test(s.reentry) && /120 km entry interface/.test(s.reentry), s.reentry.slice(0, 90));

  chk('...with a pass in the window, so the export has something to refuse', s.passes > 0,
      s.passes + ' pass(es)');
  let downloaded = false;
  const onDl = () => { downloaded = true; };
  page.on('download', onDl);
  await page.evaluate(() => document.getElementById('exp-csv').click());
  await page.evaluate(() => document.getElementById('exp-ics').click());
  await page.waitForTimeout(1500);
  page.off('download', onDl);
  const hint = await page.evaluate(() => document.getElementById('exphint').textContent);
  chk('its passes are not exported, as CSV or calendar', !downloaded && /Not exported/.test(hint),
      (downloaded ? 'a file was downloaded; ' : '') + hint);

  /* Into the day it came down. The window still has samples, so it loads, and
     SGP4's error 6 part-way through is the instant it reports the orbit meeting
     the ground. */
  await page.click('#winNextD');
  await page.waitForTimeout(1200);
  s = await state();
  chk('a day later it still loads, up to the moment SGP4 gives up',
      s.shown === 'COSMOS 2558' && s.start === W0 + DAY, iso(s.start));
  chk('...and the note says when SGP4 had it below the surface',
      !!s.field && s.field.groundAt !== null && /below the surface at .*\(error 6\)/.test(s.reentry),
      s.field && s.field.groundAt ? iso(s.field.groundAt) + ' UTC' : 'no time');

  /* A day after that there is nothing to propagate. The window must stay where
     it was, and say so, rather than moving the controls without the analysis. */
  await page.click('#winNextD');
  await page.waitForTimeout(1200);
  s = await state();
  chk('a window SGP4 cannot fill is refused, not half-applied',
      s.start === W0 + DAY && s.shown === 'COSMOS 2558' && s.winIn === '2026-09-15T07:00',
      'window ' + iso(s.start) + ', field ' + s.winIn);
  chk('...and says so', /Window not changed/.test(s.note) && /error 6: decayed/.test(s.note), s.note);

  /* Playback running off the end of a window rolls it forward - here into the
     same failure. It has to stop at the edge, not retry on every animation
     frame. The window is placed to end just after the last instant SGP4 still
     returns a position (11:39:50 on the 15th), so the next one holds nothing at
     all. At 3600x the clock reaches that edge within a few seconds. */
  const W1 = Date.UTC(2026, 8, 14, 11, 45, 0);
  await setWindow(W1);
  await page.waitForTimeout(1200);
  s = await state();
  chk('a window ending just after the decay still loads', s.shown === 'COSMOS 2558'
      && s.start === W1, iso(s.start) + ' -> ' + iso(s.start + s.hours * 3600e3));
  await page.evaluate(() => {
    const r = document.getElementById('time');
    r.value = r.max; r.dispatchEvent(new Event('input'));
    const q = document.getElementById('tprate');
    q.value = 100; q.dispatchEvent(new Event('input'));
  });
  if (await page.evaluate(() => document.getElementById('tpplay').getAttribute('aria-label') === 'Play'))
    await page.click('#tpplay');
  const tpState = () => page.evaluate(() => ({
    label: document.getElementById('tpplay').getAttribute('aria-label'),
    clock: document.getElementById('tpclock').textContent.trim() }));
  let tp = await tpState();
  for (let i = 0; i < 60 && tp.label !== 'Play'; i++) { await page.waitForTimeout(250); tp = await tpState(); }
  await page.waitForTimeout(1000);                      // and it stays stopped
  tp = await tpState();
  s = await state();
  chk('playback into decayed time stops at the window edge', tp.label === 'Play'
      && s.start === W1 && tp.clock === '2026-09-15 11:45:00',
      'button ' + tp.label + ', clock ' + tp.clock + ', window ' + iso(s.start));
  chk('...and says the window was not moved', /Window not changed/.test(s.note), s.note);
  chk('...with no page error on the way', errs.length === errsBefore,
      errs.slice(errsBefore).join(' | ') || 'none');

  // ---- and back ------------------------------------------------------------
  await pick('KNACKSAT-2');
  s = await state();
  chk('a spacecraft in orbit carries no re-entry flag', s.shown === 'KNACKSAT-2'
      && s.field === null && s.reentry === '' && s.note === '',
      'lowest point well above 120 km; note ' + (s.reentry ? 'shown' : 'hidden'));

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
