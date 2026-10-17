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
 * Last, on the rebuilt page, the picker's search of the catalogue by the
 * words of a query (CHANGES-FROM-LEGACY.md, L58): ISS (ZARYA), AO-91 and
 * OSCAR 7 found from what people type for them, what starts with the first
 * word listed first, and a word in another script looked for, not dropped.
 * Then the other names SatNOGS DB keeps (L61): RS-44, AO-7, SO-50 and FO-29
 * found under the catalogue's BREEZE-KM R/B, OSCAR 7, SAUDISAT 1C and JAS 2,
 * each option saying which name matched, the table a chunk of its own asked
 * for at the first query together with its finder's (Enter on it waits for
 * it, and acts only on the query it was pressed on; until it comes the list
 * says neither that nothing matches nor offers the Plan row; rows it brings
 * leave a chosen Plan row chosen), and nothing asked of SatNOGS.
 * Then the picker's "decayed now" (L59): on a page whose clock starts at the
 * same fixed instant, the rows SGP4 has down then are marked, exactly those,
 * as an independent run of the pinned satellite.js finds them; nothing is
 * taken out of the list, a marked row is still a pick, the work is a chunk of
 * its own asked for when the list first opens, the marks follow the clock
 * when it is put at another instant, and the snapshot has none.
 * Then the watchlist (L60): the star on the line under the name, reached by
 * Tab with its focus ring whole, stored only at a press; the picker's
 * "Watched" group on the empty query; another tab; the cap at 50.
 *
 *   node verification/suites/verify-catalogue.js          (needs playwright)
 */
'use strict';
const H = require('../lib/harness');
const path = require('path');
const { chromium } = H.playwright();

let PAGE = null;   // an http URL from H.up(): the bundled app cannot be opened from file://
const NEW = H.targetName() === 'new';   // the one-pass calendar button is the rebuilt page's alone (L57)
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
  const __srv = await H.up(); PAGE = __srv.page;
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
      /* the old combobox shows the current name in its field; the rebuilt picker is the title, and its field exists only while it is open */
      picker: (() => { const b = document.getElementById('satsearch'); return b && b.offsetParent !== null && b.value ? b.value : document.getElementById('satname').textContent; })(),
      start: __gt.D.start.getTime(), hours: __gt.D.hours,
      winIn: document.getElementById('winStartIn').value,
      span: (document.querySelector('[data-h][aria-pressed="true"]') || {}).textContent,
      note: note.hidden ? '' : note.textContent,
      reentry: re.hidden ? '' : re.textContent,
      field: __gt.D.reentry, passes: __gt.D.passes.length
    };
  });
  const pick = async q => { await H.pick(page, q); await page.waitForTimeout(900); };
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
  await H.clickWindow(page, '[data-h="72"]');
  await page.waitForTimeout(1200);
  s = await state();
  chk('a later span change loads normally', errs.length === errsBefore && s.hours === 72
      && s.shown === 'KNACKSAT-2', s.shown + ', ' + s.hours + ' h, errors ' + (errs.length - errsBefore));
  chk('...and the refusal note clears once something loads', s.note === '', s.note || 'hidden');
  await H.clickWindow(page, '[data-h="24"]');
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
  /* the selected pass alone, to a calendar (CHANGES-FROM-LEGACY.md, L57), is refused the same way; the old page had no such button */
  if (NEW) await page.evaluate(() => document.getElementById('exp-pass').click());
  await page.waitForTimeout(1500);
  page.off('download', onDl);
  const [hint, hintPass] = await page.evaluate(() => {
    const p = document.getElementById('exp-passhint');
    return [document.getElementById('exphint').textContent, p ? p.textContent : null];
  });
  chk('its passes are not exported, as CSV or calendar', !downloaded && /Not exported/.test(hint),
      (downloaded ? 'a file was downloaded; ' : '') + hint);
  if (NEW) {
    chk('...nor its selected pass alone, which says why in the same words',
        !downloaded && hintPass === 'Not exported — SGP4 takes COSMOS 2558 below the 120 km entry interface, so this pass will not happen.',
        (downloaded ? 'a file was downloaded; ' : '') + JSON.stringify(hintPass));
  } else console.log('  not checked: the selected pass alone, to a calendar, is the rebuilt page\'s (CHANGES-FROM-LEGACY.md, L57); the old page had none');

  /* Into the day it came down. The window still has samples, so it loads, and
     SGP4's error 6 part-way through is the instant it reports the orbit meeting
     the ground. */
  await H.clickWindow(page, '#winNextD');
  await page.waitForTimeout(1200);
  s = await state();
  chk('a day later it still loads, up to the moment SGP4 gives up',
      s.shown === 'COSMOS 2558' && s.start === W0 + DAY, iso(s.start));
  chk('...and the note says when SGP4 had it below the surface',
      !!s.field && s.field.groundAt !== null && /below the surface at .*\(error 6\)/.test(s.reentry),
      s.field && s.field.groundAt ? iso(s.field.groundAt) + ' UTC' : 'no time');

  /* A day after that there is nothing to propagate. The window must stay where
     it was, and say so, rather than moving the controls without the analysis. */
  await H.clickWindow(page, '#winNextD');
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

  // ---- the picker's last tier: the words of a query ------------------------
  /* After the old page's four tiers (starts, then contains), the rebuilt picker matches what they missed word by word, in the name with
     everything but letters, marks and digits (of any script) taken out, or a word of digits as the whole catalogue number without its leading zeros
     (CHANGES-FROM-LEGACY.md, L58). The old page found none of these. */
  if (NEW) {
    const rows = async q => {
      await H.typeInPicker(page, q);
      await page.waitForTimeout(250);
      return page.evaluate(() => [...document.querySelectorAll('#satlist li[data-idx]')].map(li => li.querySelector('.nm').textContent.trim()));
    };
    let r = await rows('iss zarya');
    chk('the picker finds ISS (ZARYA) from "iss zarya", the words without the brackets', r.join(' | ') === 'ISS (ZARYA)', JSON.stringify(r));
    r = await rows('ao91');
    chk('...AO-91 from "ao91"', r.join(' | ') === 'AO-91', JSON.stringify(r));
    r = await rows('007530');
    chk('...OSCAR 7 from its number with more leading zeros than the catalogue gives it (007530 for 07530)', r.join(' | ') === 'OSCAR 7', JSON.stringify(r));
    r = await rows('landsat 9');
    chk('...and a word of digits only as the whole number: "landsat 9" lists LANDSAT 9 alone, not LANDSAT 8, whose 39084 has a 9 in it',
        r.join(' | ') === 'LANDSAT 9', JSON.stringify(r));
    r = await rows('zzqq nothing');
    const none = await H.pickerNotes(page);
    chk('...while a query no word of which is in any name still lists nothing, and says so', r.length === 0 && none[0] === 'Nothing in the catalogue matches that.',
        JSON.stringify({ rows: r, notes: none }));
    await H.closePicker(page);
    await pick('oscar 7530');
    s = await state();
    const planner = await page.evaluate(() => { const p = document.getElementById('planner'); return !!p && !p.hidden; });
    chk('Enter on a query only its words match picks the first row, as on any other (oscar 7530: OSCAR 7), and the planner stays shut',
        s.shown === 'OSCAR 7' && s.masthead === 'OSCAR 7' && !planner, s.shown + (planner ? ', planner open' : ''));
    /* The tier is ordered as the four are, what starts with the first word first: "iss." (a stray full stop), which the four miss, lists the
       two ISS modules before the AAC-AIS-SAT objects, whose names only hold "iss" once the hyphens are out, so Enter picks an ISS. */
    r = await rows('iss.');
    chk('...the tier puts what starts with the first word first: "iss." lists ISS (NAUKA) and ISS (ZARYA) before AAC-AIS-SAT-1',
        r[0] === 'ISS (NAUKA)' && r[1] === 'ISS (ZARYA)' && r.indexOf('AAC-AIS-SAT-1') > 1, JSON.stringify(r.slice(0, 4)));
    /* A word in another script is a word to find, never dropped: the catalogue's names are ASCII, so a Thai one finds nothing, and the query is not
       matched on its 2 alone (which would list 516 rows); Enter then opens the planner with it as the orbit's name, the Plan row's way. */
    const THAI = 'ดาวเทียม 2';
    r = await rows(THAI);
    const thaiNote = (await H.pickerNotes(page))[0];
    chk('...and a word in another script must be in the name too: "' + THAI + '" (Thai, then 2) lists nothing and says so, rather than every name with a 2',
        r.length === 0 && thaiNote === 'Nothing in the catalogue matches that.', JSON.stringify({ rows: r.length, first: r[0], note: thaiNote }));
    const planRow = await page.evaluate(() => !!document.querySelector('#satlist li.plan'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const p = document.getElementById('planner'); return !!p && !p.hidden; }, null, { timeout: 5000 }).catch(() => {});
    const pl = await page.evaluate(() => { const p = document.getElementById('planner'), n = document.getElementById('pl-name');
      return { open: !!p && !p.hidden, name: n ? n.value : null }; });
    pl.planRow = planRow;
    chk('...so Enter on it opens the planner with it as the name, as before the tier', planRow && pl.open && pl.name === THAI, JSON.stringify(pl));
    if (pl.open) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('planner').hidden, null, { timeout: 5000 }).catch(() => {});
    }
  } else console.log('  not checked: the picker\'s last tier, the words of a query, is the rebuilt page\'s (CHANGES-FROM-LEGACY.md, L58); the old page had none');

  // ---- the picker's other names ---------------------------------------------
  /* The rebuilt picker also matches the other names SatNOGS DB keeps for the catalogue's spacecraft, baked into data/aliases.json
     (CHANGES-FROM-LEGACY.md, L61): after rank()'s rows, what one of them matches, by every word of the query starting a word of the name,
     its option saying which name matched in plain text. The table is a chunk of its own (with its finder, another, asked for in the same
     moment), asked for the first time something is typed, not at boot and not when the list opens; Enter on that first query, if it comes
     before the table, waits for it. Nothing is asked of SatNOGS and nothing is stored. A context of its own, so that no chunk is in the
     cache (and routes, which keep the page from its HTTP cache on each fresh load below). */
  if (NEW) {
    const ctxA = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1400, height: 900 } });
    for (const host of ['**celestrak.org/**', '**tle.ivanstanojevic.me/**', '**gibs.earthdata.nasa.gov/**']) await ctxA.route(host, r => r.abort());
    const pA = await ctxA.newPage();
    const errsA = [], reqsA = [];
    pA.on('pageerror', e => errsA.push(e.message));
    pA.on('request', r => reqsA.push(r.url()));
    const TABLE = /\/assets\/aliases-[A-Za-z0-9_-]{8}\.js$/, FINDER = /\/assets\/alias-[A-Za-z0-9_-]{8}\.js$/;
    const originA = new URL(PAGE).origin;
    /* the table is held back 1.5 s the first time, so that the Enter below is surely pressed before it has come; and so is the finder's
       code, so that the table is seen to be asked for while that is still on its way (together, one round trip; not one after the other) */
    let held = 0, heldF = 0;
    await pA.route(TABLE, async r => { held++; await new Promise(res => setTimeout(res, 1500)); await r.continue(); });
    await pA.route(FINDER, async r => { heldF++; await new Promise(res => setTimeout(res, 1500)); await r.continue(); });
    await pA.goto(PAGE, { waitUntil: 'load' });
    await pA.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
    await pA.waitForTimeout(1500);
    const before = await pA.evaluate(() => __gt.D.entry.name);
    await H.openPicker(pA);
    await pA.waitForTimeout(800);
    chk('the other names are not asked for at boot, nor when the list opens', !reqsA.some(u => TABLE.test(u) || FINDER.test(u)),
        reqsA.filter(u => TABLE.test(u) || FINDER.test(u)).join(' ') || 'not requested');
    await pA.click('#satsearch');
    await pA.fill('#satsearch', 'fo29');
    await pA.waitForTimeout(300);
    /* Until they have come, the first query is not yet answered: the list must not say nothing matches (FO-29 will), nor offer the Plan
       row as the choice when Enter is not going to open it */
    const unanswered = await pA.evaluate(() => ({ rows: document.querySelectorAll('#satlist li[data-idx]').length,
      notes: [...document.querySelectorAll('.search ~ p.note')].map(n => n.textContent), active: document.getElementById('satsearch').getAttribute('aria-activedescendant'),
      planOn: !!document.querySelector('#satlist li.plan.on'), plan: !!document.getElementById('soptplan') }));
    chk('the finder\'s code and the table are asked for together, the first time something is typed: both on their way while the code is still held back',
        held === 1 && heldF === 1, JSON.stringify({ table: held, finder: heldF }));
    chk('...and until they have come, "fo29" is not yet answered: no "Nothing in the catalogue matches that", and the Plan row is listed but not the active option',
        unanswered.rows === 0 && unanswered.notes.length === 0 && unanswered.active === null && !unanswered.planOn, JSON.stringify(unanswered));
    await pA.keyboard.press('Enter');
    await pA.waitForTimeout(300);
    const waiting = await pA.evaluate(() => ({ shown: __gt.D.entry.name, planner: (p => !!p && !p.hidden)(document.getElementById('planner')), open: !!document.getElementById('satsearch') }));
    await pA.waitForFunction(() => __gt.D.entry.name === 'JAS 2', null, { timeout: 10000 }).catch(() => {});
    const picked = await pA.evaluate(() => ({ shown: __gt.D.entry.name, planner: (p => !!p && !p.hidden)(document.getElementById('planner')), open: !!document.getElementById('satsearch') }));
    chk('Enter at once on the first thing typed, "fo29", which only an other name matches, waits for the table (the list still open, the planner shut) and then picks JAS 2, FO-29',
        held === 1 && before !== 'JAS 2' && waiting.shown === before && waiting.open && !waiting.planner && picked.shown === 'JAS 2' && !picked.open && !picked.planner,
        JSON.stringify({ held, before, waiting, picked }));
    await pA.unroute(TABLE);
    await pA.unroute(FINDER);
    await pA.waitForTimeout(900);
    const storeA = await pA.evaluate(() => Object.keys(localStorage).sort().join());

    const rowsA = async q => {
      await H.typeInPicker(pA, q);
      await pA.waitForTimeout(250);
      return pA.evaluate(() => [...document.querySelectorAll('#satlist li[data-idx]')].map(li => {
        const al = li.querySelector('.al');
        return { nm: li.querySelector('.nm').textContent.trim(), al: al ? al.textContent : null, n: (li.querySelector('.id') || {}).textContent, role: li.getAttribute('role'),
                 alRole: al && al.getAttribute('role'), alShown: !!al && al.getClientRects().length > 0, inner: li.querySelectorAll('a, button, input, select, textarea, [tabindex]').length };
      }));
    };
    let ra = await rowsA('rs44');
    chk('"rs44" lists BREEZE-KM R/B (44909), the rocket stage RS-44 is filed under, its option saying "matches RS-44" in plain text (no role, nothing focusable: the field keeps the keys)',
        ra.length === 1 && ra[0].nm === 'BREEZE-KM R/B' && ra[0].n === '44909' && ra[0].al === 'matches RS-44' && ra[0].alShown && ra[0].role === 'option' && ra[0].alRole === null && ra[0].inner === 0,
        JSON.stringify(ra));
    const spelt = [];
    for (const q of ['rs-44', 'RS 44', 'RS-44']) spelt.push(q + ': ' + (await rowsA(q)).map(x => x.nm + ' ' + x.al).join(', '));
    chk('...and so do "rs-44", "RS 44" and "RS-44"', spelt.every(s => /: BREEZE-KM R\/B matches RS-44$/.test(s)), spelt.join(' | '));
    ra = await rowsA('ao7');
    chk('"ao7" lists OSCAR 7 (AO-7) first, then FUNCUBE 1 (AO-73): a name that is the whole query before one that starts with it',
        ra.map(x => x.nm + ' / ' + x.al).join(' | ') === 'OSCAR 7 / matches AO-7 | FUNCUBE 1 / matches AO-73', JSON.stringify(ra.map(x => x.nm + ' / ' + x.al)));
    ra = await rowsA('so50');
    chk('"so50" lists SAUDISAT 1C (SO-50)', ra.map(x => x.nm + ' / ' + x.al).join(' | ') === 'SAUDISAT 1C / matches SO-50', JSON.stringify(ra.map(x => x.nm + ' / ' + x.al)));
    ra = await rowsA('iss');
    chk('rank()\'s rows come first and carry no line, and a word is looked for at the start of a word of a name: "iss" is its seven rows as before, none of them a "Mission"',
        ra.length === 7 && ra.every(x => x.al === null) && ra[0].nm === 'ISS (NAUKA)', JSON.stringify(ra.map(x => x.nm + (x.al ? ' / ' + x.al : ''))));
    ra = await rowsA('o000');
    const noneA = await H.pickerNotes(pA);
    ra = ra.concat(await rowsA('customs'));
    chk('a placeholder number ("o000") and "customs" still find nothing with the table in', ra.length === 0 && noneA[0] === 'Nothing in the catalogue matches that.', JSON.stringify({ rows: ra, notes: noneA }));
    ra = await rowsA('');
    chk('...and the empty query lists the catalogue with no line in it', ra.length === 80 && ra.every(x => x.al === null), ra.length + ' rows, ' + ra.filter(x => x.al).length + ' with a line');
    const storeA2 = await pA.evaluate(() => Object.keys(localStorage).sort().join());
    chk('...and the searches store nothing', storeA2 === storeA, JSON.stringify({ before: storeA, after: storeA2 }));
    await H.closePicker(pA);
    await H.pick(pA, 'so50');
    await pA.waitForTimeout(900);
    const so = await pA.evaluate(() => __gt.D.entry.name);
    chk('Enter on "so50" picks SAUDISAT 1C, as on any list', so === 'SAUDISAT 1C', so);
    const tableReqs = reqsA.filter(u => TABLE.test(u)), finderReqs = reqsA.filter(u => FINDER.test(u));
    chk('the table and its finder are each asked for once in the visit, from the page\'s own origin', tableReqs.length === 1 && finderReqs.length === 1
        && tableReqs.concat(finderReqs).every(u => u.startsWith(originA + '/')), tableReqs.concat(finderReqs).map(u => u.replace(originA, '')).join(' '));

    /* What the reader does while the table is on its way. Each case is a fresh load (the chunks are a page's once), with the table held
       back 1.5 s again. A waiting Enter acts on the query it was pressed on, in the list it was pressed in: typed on, or closed and opened
       again, it does nothing when the table comes (the next Enter decides). And rows that come in after the first query has been answered
       go before the Plan row, which stays the active option if it was. */
    const freshA = async () => {
      let n = 0;
      await pA.route(TABLE, async r => { n++; await new Promise(res => setTimeout(res, 1500)); await r.continue(); });
      await pA.goto(PAGE, { waitUntil: 'load' });
      await pA.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
      await pA.waitForTimeout(1500);
      await H.openPicker(pA);
      await pA.click('#satsearch');
      return { name: await pA.evaluate(() => __gt.D.entry.name), held: () => n };
    };
    const afterA = () => pA.evaluate(() => ({ shown: __gt.D.entry.name, planner: (p => !!p && !p.hidden)(document.getElementById('planner')), open: !!document.getElementById('satsearch'),
      q: (document.getElementById('satsearch') || {}).value, rows: [...document.querySelectorAll('#satlist li[data-idx] .nm')].slice(0, 2).map(n => n.textContent) }));
    let f = await freshA();
    await pA.fill('#satsearch', 'fo29');
    await pA.keyboard.press('Enter');
    await pA.waitForTimeout(300);
    await pA.fill('#satsearch', 'iss');
    await pA.waitForTimeout(2200);
    let after = await afterA();
    chk('Enter on a first "fo29", then "iss" typed before the table comes: nothing is picked when it comes (not JAS 2, not ISS (NAUKA)), the list stays open on "iss"',
        f.held() === 1 && after.shown === f.name && after.open && after.q === 'iss' && after.rows[0] === 'ISS (NAUKA)' && !after.planner, JSON.stringify({ before: f.name, after }));
    await H.closePicker(pA);
    await pA.unroute(TABLE);

    f = await freshA();
    await pA.fill('#satsearch', 'tango');
    await pA.keyboard.press('Enter');
    await pA.waitForTimeout(300);
    await pA.keyboard.press('Escape');
    await pA.waitForSelector('#satsearch', { state: 'detached', timeout: 5000 }).catch(() => {});
    await pA.keyboard.press('/');
    await pA.waitForSelector('#satsearch', { state: 'visible', timeout: 5000 }).catch(() => {});
    await pA.fill('#satsearch', 'zzqq nothing');
    await pA.waitForTimeout(2200);
    after = await afterA();
    chk('...Enter on a first "tango", then Escape, "/" and "zzqq nothing" before it comes: neither CLUSTER II-FM8 (TANGO) is picked nor the planner opened, the list open',
        f.held() === 1 && after.shown === f.name && after.open && after.q === 'zzqq nothing' && after.rows.length === 0 && !after.planner, JSON.stringify({ before: f.name, after }));
    await H.closePicker(pA);
    await pA.unroute(TABLE);

    f = await freshA();
    await pA.fill('#satsearch', 'cube');
    await pA.waitForSelector('#soptplan', { timeout: 10000 }).catch(() => {});
    await pA.keyboard.press('ArrowUp');
    const actA = () => pA.evaluate(() => ({ active: document.getElementById('satsearch').getAttribute('aria-activedescendant'), planOn: !!document.querySelector('#satlist li.plan.on'),
      rows: document.querySelectorAll('#satlist li[data-idx]').length, al: document.querySelectorAll('#satlist li[data-idx] .al').length }));
    const upA = await actA();
    await pA.waitForSelector('#satlist .al', { timeout: 10000 }).catch(() => {});
    await pA.waitForTimeout(200);
    const inA = await actA();
    chk('"cube" as the first query, ArrowUp to the Plan row, then the table comes: its six rows go before the Plan row, which is still the active option',
        f.held() === 1 && upA.active === 'soptplan' && upA.planOn && upA.al === 0 && inA.al === 6 && inA.rows === upA.rows + 6 && inA.active === 'soptplan' && inA.planOn,
        JSON.stringify({ before: upA, after: inA }));
    await pA.keyboard.press('Enter');
    await pA.waitForFunction(() => (p => !!p && !p.hidden)(document.getElementById('planner')), null, { timeout: 5000 }).catch(() => {});
    after = await afterA();
    chk('...and Enter then opens the planner, as the Plan row says, rather than picking CSC-1', after.planner && after.shown === f.name && !after.open, JSON.stringify(after));
    await pA.keyboard.press('Escape');
    await pA.waitForFunction(() => document.getElementById('planner').hidden, null, { timeout: 5000 }).catch(() => {});
    await pA.unroute(TABLE);
    chk('...and nothing is asked of db.satnogs.org, or of any SatNOGS host, at any point of the visit', !reqsA.some(u => /satnogs/i.test(new URL(u).hostname)),
        reqsA.filter(u => /satnogs/i.test(new URL(u).hostname)).join(' ') || 'none of ' + reqsA.length + ' requests');
    await ctxA.close();
    chk('...with no page error on the way', errsA.length === 0, errsA.join(' | ') || 'none');
    errs.push(...errsA);
  } else console.log('  not checked: the picker\'s other names are the rebuilt page\'s (CHANGES-FROM-LEGACY.md, L61); the old page had none');

  // ---- the picker's mark: decayed now ---------------------------------------
  /* The rebuilt picker marks "decayed now" what SGP4 has down at the clock's instant when the list is opened: SGP4's own error 6, a position
     under the 120 km entry interface, or SGP4's drag terms run past what they model (after the epoch of a near-earth set it read cleanly,
     with a positive B*: a refusal with error 1 to 4, or a position over the set's own apogee), one sample per entry (CHANGES-FROM-LEGACY.md,
     L59). Which ones depends on when you ask, so this page runs on a clock that starts at W0, and what should be marked is worked out here,
     apart from the page's code, with the pinned satellite.js (verification/reference/satellite.min.js) over the catalogue file, reading the
     drag rule off satellite.js's own record of each set where the page reads the two lines. It is a mark: no row is taken away, a marked
     row is still picked the way any is, the work is done in a chunk of its own the first time the list opens (and never in the snapshot,
     ?tle=embedded), the marks are for the clock's instant (put back to KNACKSAT-2's epoch, they are what is down there), and it asks
     nothing of the network and stores nothing. The old page had none. */
  if (NEW) {
    const fs = require('fs');
    const sat = require('../reference/satellite.min.js');
    const lines = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'catalogue.txt'), 'utf8').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(Boolean);
    const cat = [];
    for (let i = 0; i < lines.length - 2; i++) {
      if (lines[i + 1][0] === '1' && lines[i + 2][0] === '2' && lines[i][0] !== '1' && lines[i][0] !== '2') {
        cat.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2], satnum: lines[i + 1].substring(2, 7).trim() }); i += 2;
      }
    }
    const downAt = ms => cat.filter(e => {
      let s; try { s = sat.twoline2satrec(e.l1, e.l2); } catch (x) { return false; }
      /* read before propagate() clears it: the error SGP4 gave the set when it was read (t = 0) */
      const drag = !s.error && s.bstar > 0 && s.method === 'n' && ms > (s.jdsatepoch - 2440587.5) * DAY;
      const d = new Date(ms), pv = sat.propagate(s, d);
      if (!pv || !pv.position || !isFinite(pv.position.x)) return s.error === 6 || (drag && s.error >= 1 && s.error <= 4);
      const p = pv.position;
      if (drag && Math.hypot(p.x, p.y, p.z) > 1.01 * s.a * 6378.135 * (1 + s.ecco)) return true;
      return sat.eciToGeodetic(p, sat.gstime(d)).height < 120;
    }).map(e => e.satnum).sort();
    const DOWN = downAt(W0);
    const DOWN_LATER = downAt(W0 + 10 * 60e3);
    chk('(reference) at W0 the pinned SGP4 has 14 of the 2,158 down, ODIN, COSMOS 2558 and STARLINK-2342 (refused with error 1 a month after its epoch) among them, and the same 14 ten minutes on (so the seconds the page takes to open cannot change the answer)',
        cat.length === 2158 && DOWN.length === 14 && DOWN.includes('26702') && DOWN.includes('53323') && DOWN.includes('47883') && DOWN.join() === DOWN_LATER.join(), DOWN.join(' '));
    const EPOCH = Date.parse('2026-09-12T07:29:09.993Z');      // KNACKSAT-2's set: the Window popover's "Epoch" puts the window and the clock there
    const DOWN_EPOCH = downAt(EPOCH);
    chk('(reference) at KNACKSAT-2\'s epoch it has 13 down: the same but COSMOS 2558, not yet under 120 km',
        DOWN_EPOCH.length === 13 && DOWN_EPOCH.join() === DOWN.filter(n => n !== '53323').join(), DOWN_EPOCH.join(' '));

    const ctx2 = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1400, height: 900 } });
    await ctx2.clock.install({ time: W0 });
    for (const host of ['**celestrak.org/**', '**tle.ivanstanojevic.me/**', '**gibs.earthdata.nasa.gov/**']) await ctx2.route(host, r => r.abort());
    const p2 = await ctx2.newPage();
    const errs2 = [], reqs = [];
    p2.on('pageerror', e => errs2.push(e.message));
    p2.on('request', r => reqs.push(r.url()));
    const CHUNK = /\/assets\/decayed\.svelte-[A-Za-z0-9_-]{8}\.js$/;
    const origin = new URL(PAGE).origin;
    await p2.goto(PAGE, { waitUntil: 'load' });
    await p2.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
    await p2.waitForTimeout(1500);
    chk('the mark\'s chunk is not asked for while the list has not been opened', !reqs.some(u => CHUNK.test(u)), reqs.filter(u => CHUNK.test(u)).join(' ') || 'not requested');
    const storeBefore = await p2.evaluate(() => Object.keys(localStorage).sort().join());
    const sinceOpen = reqs.length;

    const rows = async q => {
      await H.typeInPicker(p2, q);
      await p2.waitForTimeout(200);
      return p2.evaluate(() => [...document.querySelectorAll('#satlist li[data-idx]')].map(li => ({
        n: (li.querySelector('.id') || {}).textContent, nm: li.querySelector('.nm').textContent.trim(),
        dk: li.querySelector('.dk') ? li.querySelector('.dk').textContent : null })));
    };
    await rows('26702');
    const came = await p2.waitForSelector('#satlist li .dk', { timeout: 10000 }).then(() => true, () => false);
    const odin = await p2.evaluate(() => {
      const li = document.querySelector('#satlist li[data-idx]'), dk = li && li.querySelector('.dk'), note = document.getElementById('satdecayed');
      return { role: li && li.getAttribute('role'), nm: li && li.querySelector('.nm').textContent, dk: dk && dk.textContent, dkRole: dk && dk.getAttribute('role'),
               inner: li ? li.querySelectorAll('a, button, input, select, textarea, [tabindex]').length : -1, note: note && note.textContent,
               noteIsNote: !!note && note.classList.contains('note') };
    });
    chk('the list, opened at W0 on "26702", marks ODIN "decayed now", in plain text inside its option (no role, nothing focusable: the field keeps the keys)',
        came && odin.role === 'option' && odin.nm === 'ODIN' && odin.dk === 'decayed now' && odin.dkRole === null && odin.inner === 0, JSON.stringify(odin));
    chk('...and says under the list what the mark is, in a line of its own (not one of the picker\'s notes)',
        odin.note === "Decayed now: at the clock's instant SGP4 has it below the 120 km entry interface, or refuses it as decayed (error 6), or its drag terms have carried it "
          + "past what they can model (after the set's epoch: refused with error 1 to 4, or put above its own apogee). It is still listed; picking it asks SGP4 for its whole window."
        && !odin.noteIsNote, JSON.stringify(odin.note));
    const asked = reqs.slice(sinceOpen);
    chk('...worked out in its own chunk, asked for once, and nothing else is asked of any host for it',
        asked.filter(u => CHUNK.test(u)).length === 1 && asked.every(u => u.startsWith(origin + '/')), asked.map(u => u.replace(origin, '')).join(' ') || 'nothing');

    /* each of the 14 by its number, and some lists of many rows: a row is marked exactly when the reference has it down */
    const wrong = [], seen = new Set();
    for (const q of DOWN.concat(['object', 'cosmos', 'jilin-01 gaofen 3d', 'lemur', 'starlink-23', 'knacksat', 'iss'])) {
      for (const r of await rows(q)) {
        seen.add(r.n);
        if ((r.dk === 'decayed now') !== DOWN.includes(r.n)) wrong.push(q + ': ' + r.n + ' ' + r.nm + ' ' + (r.dk || 'unmarked'));
      }
    }
    chk('every row is marked exactly when the reference has it down at W0: the 14 by their numbers, and the rows for "object", "cosmos", "jilin-01 gaofen 3d", "lemur", "starlink-23" (STARLINK-2342 marked: refused with error 1 after its epoch, the drag run out), "knacksat" and "iss"',
        wrong.length === 0 && DOWN.every(n => seen.has(n)) && seen.size > 150, wrong.slice(0, 4).join(' | ') || seen.size + ' rows read, ' + DOWN.length + ' of them marked');
    const quiet = await rows('knacksat');
    const quietNote = await p2.evaluate(() => !!document.getElementById('satdecayed'));
    chk('...and a list with no marked row has no line about the mark', quiet.length > 0 && !quietNote, quiet.length + ' row(s), line ' + (quietNote ? 'shown' : 'absent'));

    const all = await rows('');
    const count = await p2.evaluate(() => document.getElementById('satcount').textContent);
    const notes = await H.pickerNotes(p2);
    chk('the mark takes no row away: the empty query still lists 80 of 2,158, says 2,078 more match, and counts "2,158 spacecraft"',
        all.length === 80 && count === '2,158 spacecraft' && notes.length === 1 && notes[0] === '2,078 more match. Keep typing to narrow them.', all.length + ' rows; ' + count + '; ' + JSON.stringify(notes));
    const storeAfter = await p2.evaluate(() => Object.keys(localStorage).sort().join());
    chk('...and stores nothing', storeAfter === storeBefore, JSON.stringify({ before: storeBefore, after: storeAfter }));
    await H.closePicker(p2);

    /* a marked row is a pick like any other: COSMOS 2558 loads at W0, flagged as re-entering, and ODIN and STARLINK-2342 are refused with
       SGP4's reasons, as above */
    await H.pick(p2, '53323');
    await p2.waitForTimeout(900);
    const c2558 = await p2.evaluate(() => ({ shown: __gt.D.entry.name, reentry: !!__gt.D.reentry }));
    await H.pick(p2, '26702');
    await p2.waitForTimeout(900);
    const refused = await p2.evaluate(() => ({ shown: __gt.D.entry.name, note: document.getElementById('loadnote').textContent }));
    await H.pick(p2, '47883');
    await p2.waitForTimeout(900);
    const spent = await p2.evaluate(() => ({ shown: __gt.D.entry.name, note: document.getElementById('loadnote').textContent }));
    chk('a marked row is still picked as any is: COSMOS 2558 loads at W0, flagged as re-entering; ODIN is refused with SGP4\'s own reason (error 6), and STARLINK-2342 with its own (error 1)',
        c2558.shown === 'COSMOS 2558' && c2558.reentry && refused.shown === 'COSMOS 2558' && /ODIN/.test(refused.note) && /error 6: decayed/.test(refused.note)
        && spent.shown === 'COSMOS 2558' && /STARLINK-2342/.test(spent.note) && /error 1: mean eccentricity or semi-major axis out of range/.test(spent.note),
        JSON.stringify({ c2558, refused, spent }));

    /* the marks are for the clock's instant, not the wall clock's: put the clock at KNACKSAT-2's epoch (where a load from that window puts it)
       and the list, opened again, marks what is down there, worked out again for it; COSMOS 2558 is not down yet */
    await p2.evaluate(ms => __gt.seek(ms), EPOCH);
    await p2.waitForTimeout(300);
    await rows('53323');
    const moved = await p2.waitForFunction(() => { const li = document.querySelector('#satlist li[data-idx]'); return !!li && !li.querySelector('.dk'); }, null, { timeout: 10000 })
      .then(() => true, () => false);
    const wrongE = [], seenE = new Set();
    for (const q of ['53323', '26702', '47883', 'object', 'cosmos', 'jilin-01 gaofen 3d']) {
      for (const r of await rows(q)) {
        seenE.add(r.n);
        if ((r.dk === 'decayed now') !== DOWN_EPOCH.includes(r.n)) wrongE.push(q + ': ' + r.n + ' ' + r.nm + ' ' + (r.dk || 'unmarked'));
      }
    }
    chk('the marks follow the clock: put at KNACKSAT-2\'s epoch, the list marks exactly what the reference has down there (COSMOS 2558 not, ODIN and STARLINK-2342 still)',
        moved && wrongE.length === 0 && seenE.has('53323') && seenE.has('26702') && seenE.has('47883') && seenE.size > 80, wrongE.slice(0, 4).join(' | ') || seenE.size + ' rows read');
    await H.closePicker(p2);

    await ctx2.close();

    /* the snapshot: each window opens at its own set's epoch there, so a mark for this moment is never worked out (a context of its own, so
       that a chunk in the cache could not hide a request) */
    const ctx3 = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1400, height: 900 } });
    await ctx3.clock.install({ time: W0 });
    for (const host of ['**celestrak.org/**', '**tle.ivanstanojevic.me/**', '**gibs.earthdata.nasa.gov/**']) await ctx3.route(host, r => r.abort());
    const p3 = await ctx3.newPage();
    const reqs3 = [];
    p3.on('pageerror', e => errs2.push(e.message));
    p3.on('request', r => reqs3.push(r.url()));
    await p3.goto(PAGE + '?tle=embedded', { waitUntil: 'load' });
    await p3.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
    await H.typeInPicker(p3, '26702');
    await p3.waitForTimeout(2000);
    const pinned = await p3.evaluate(() => ({ rows: [...document.querySelectorAll('#satlist li[data-idx] .nm')].map(n => n.textContent),
      dk: document.querySelectorAll('#satlist .dk').length, line: !!document.getElementById('satdecayed') }));
    chk('in the snapshot (?tle=embedded) nothing is marked, and the chunk is never asked for',
        pinned.rows.join() === 'ODIN' && pinned.dk === 0 && !pinned.line && !reqs3.some(u => CHUNK.test(u)),
        JSON.stringify(pinned) + (reqs3.some(u => CHUNK.test(u)) ? ' (chunk requested)' : ''));
    await ctx3.close();
    chk('...with no page error on the way', errs2.length === 0, errs2.join(' | ') || 'none');
    errs.push(...errs2);
  } else console.log('  not checked: the picker\'s "decayed now" is the rebuilt page\'s (CHANGES-FROM-LEGACY.md, L59); the old page had none');

  // ---- the watchlist ----------------------------------------------------------
  /* The rebuilt page's watchlist (CHANGES-FROM-LEGACY.md, L60): a star beside the name, on the title's row, a toggle button (its name
     "Watch", aria-pressed its state) outside the picker's listbox, reached with the keyboard; a press puts the spacecraft on screen on
     the list or takes it off, written under gt.watch then and only then (the press is a chunk of its own, asked for at the first one),
     and the last one off leaves nothing stored. On the empty query the picker lists the watched first, in a group of their own and in
     the order they were starred, then the reader's orbits, then the catalogue, the same rows with none twice; what is typed is
     answered in rank()'s order, untouched. Another tab of the page hears a change through the storage event. At 50 a press puts
     nothing on and says why under the bar. An orbit of the reader's own has no star. The old page had none of it. */
  if (NEW) {
    const ctxW = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1400, height: 900 } });
    await ctxW.clock.install({ time: W0 });
    for (const host of ['**celestrak.org/**', '**tle.ivanstanojevic.me/**', '**gibs.earthdata.nasa.gov/**']) await ctxW.route(host, r => r.abort());
    const errsW = [], reqsW = [];
    const open = async () => {
      const p = await ctxW.newPage();
      p.on('pageerror', e => errsW.push(e.message));
      p.on('request', r => reqsW.push(r.url()));
      await p.goto(PAGE, { waitUntil: 'load' });
      await p.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!document.getElementById('watchstar'), null, { timeout: 30000 });
      await p.waitForTimeout(800);
      return p;
    };
    const PRESS = /\/assets\/watch-press-[A-Za-z0-9_-]{8}\.js$/;
    const origin = new URL(PAGE).origin;
    /* beside the name: in the header's identity block, after the title and on its row (the star's middle inside the title's height),
       and not on the line of ids under it, where it once made the header taller at 901 px with the planner's pill beside it */
    const star = p => p.evaluate(() => {
      const b = document.getElementById('watchstar'), t = document.querySelector('header button.title');
      const s = b && b.getBoundingClientRect(), tr = t && t.getBoundingClientRect(), mid = s && (s.top + s.bottom) / 2;
      return b && { tag: b.tagName, type: b.getAttribute('type'), pressed: b.getAttribute('aria-pressed'), name: b.getAttribute('aria-label'), title: b.getAttribute('title'),
        hidden: b.hidden, shown: b.checkVisibility(), inHead: !!b.closest('header .id') && !b.closest('header .ids'),
        byName: !!tr && s.left >= tr.right - 0.5 && mid > tr.top && mid < tr.bottom, inList: !!b.closest('#satlist, [role=listbox], [role=option]') };
    });
    const stored = p => p.evaluate(() => ({ keys: Object.keys(localStorage).sort().join(), watch: localStorage.getItem('gt.watch') }));
    /* the picker's rows as they are drawn: a group heading as [name], an option as its name */
    const listed = async (p, q) => {
      await H.typeInPicker(p, q);
      await p.waitForTimeout(250);
      return p.evaluate(() => [...document.querySelectorAll('#satlist li')].filter(li => !li.classList.contains('plan'))
        .map(li => li.classList.contains('grp') ? '[' + li.textContent + ']' : li.querySelector('.nm').textContent));
    };
    const pA = await open();
    const at0 = await star(pA), st0 = await stored(pA);
    chk('the star is a button beside the name, on the title\'s row and outside the picker\'s list: named "Watch" (its tooltip too), not pressed, on KNACKSAT-2',
        at0 && at0.tag === 'BUTTON' && at0.type === 'button' && at0.pressed === 'false' && at0.name === 'Watch' && at0.title === 'Watch' && at0.shown && at0.inHead && at0.byName && !at0.inList,
        JSON.stringify(at0));
    chk('...a visit that has not pressed it stores nothing, and has not asked for the press\'s chunk', st0.keys === '' && !reqsW.some(u => PRESS.test(u)),
        JSON.stringify(st0) + (reqsW.some(u => PRESS.test(u)) ? ' (press chunk requested)' : ''));
    const issBefore = await listed(pA, 'iss');
    await H.closePicker(pA);

    /* the keyboard: from the title (the picker's button), Tab is the star, and Space presses it */
    await pA.focus('button.title');
    await pA.keyboard.press('Tab');
    const focused = await pA.evaluate(() => document.activeElement && document.activeElement.id);
    /* the focus ring as the keyboard draws it, against every box above the star that clips (counted in `clips`, which may be none: the
       star sat once on the line under the name, which is overflow: hidden from 1100 px and as tall as the star, and a ring drawn outside
       its box lost its top and bottom there; beside the name it is inside its own box still, outline-offset -2px) */
    const ring = await pA.evaluate(() => {
      const b = document.activeElement, cs = getComputedStyle(b), s = b.getBoundingClientRect();
      const reach = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset), cut = [];
      let clips = 0;
      for (let e = b.parentElement; e; e = e.parentElement) {
        const c = getComputedStyle(e);
        if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
        clips++;
        const q = e.getBoundingClientRect();
        if (s.top - reach < q.top - 0.01 || s.bottom + reach > q.bottom + 0.01 || s.left - reach < q.left - 0.01 || s.right + reach > q.right + 0.01)
          cut.push((e.id || e.className) + ' ' + Math.round(q.top) + '..' + Math.round(q.bottom));
      }
      return { fv: b.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, star: Math.round(s.top) + '..' + Math.round(s.bottom), clips, cut };
    });
    const before = reqsW.length;
    await pA.keyboard.press('Space');
    const on1 = await pA.waitForFunction(() => document.getElementById('watchstar').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).then(() => true, () => false);
    const st1 = await stored(pA), asked = reqsW.slice(before);
    chk('Tab from the title reaches the star, and Space presses it: pressed, and gt.watch holds KNACKSAT-2\'s number, written now',
        focused === 'watchstar' && on1 && st1.keys === 'gt.watch' && st1.watch === '["67683"]', JSON.stringify({ focused, on1, st1 }));
    chk('...the press\'s chunk asked for once, from this origin, and nothing else asked of any host for it',
        asked.filter(u => PRESS.test(u)).length === 1 && asked.every(u => u.startsWith(origin + '/')), asked.map(u => u.replace(origin, '')).join(' ') || 'nothing');
    chk('the star\'s focus ring, from the keyboard, is drawn whole: inside the star\'s own box, and no box above it cuts it',
        focused === 'watchstar' && ring.fv && ring.style === 'solid' && parseFloat(ring.width) >= 2 && parseFloat(ring.width) + parseFloat(ring.offset) <= 0.01 && ring.cut.length === 0, JSON.stringify(ring));

    let rows = await listed(pA, '');
    const notes = await H.pickerNotes(pA);
    const count = await pA.evaluate(() => document.getElementById('satcount').textContent);
    const opts = await pA.evaluate(() => [...document.querySelectorAll('#satlist li[role=option][data-idx]')].map(li => li.dataset.idx));
    chk('the empty query lists it first, in a group of its own, then the catalogue without it: the same 80 rows of 2,158, none twice, the same notes',
        rows[0] === '[Watched]' && rows[1] === 'KNACKSAT-2' && rows[2] === '[Catalogue]' && !rows.slice(3).includes('KNACKSAT-2') && opts.length === 80
        && new Set(opts).size === 80 && count === '2,158 spacecraft' && notes.length === 1 && notes[0] === '2,078 more match. Keep typing to narrow them.',
        JSON.stringify({ first: rows.slice(0, 5), options: opts.length, count, notes }));
    const issAfter = await listed(pA, 'iss');
    chk('...and a query is answered in the search\'s own order, with no group: "iss" lists what it listed before the star',
        issAfter.join('|') === issBefore.join('|') && !issAfter.some(r => r.startsWith('[')) && issAfter.length > 3, issAfter.slice(0, 4).join(' | '));
    await H.closePicker(pA);

    /* a second spacecraft: its own star, off; on, it joins the group after the first, in the order they were starred */
    await H.pick(pA, '25544');
    await pA.waitForFunction(() => __gt.D.entry.name === 'ISS (ZARYA)', null, { timeout: 10000 });
    await pA.waitForTimeout(300);
    const issStar = await star(pA);
    await pA.click('#watchstar');
    await pA.waitForFunction(() => document.getElementById('watchstar').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).catch(() => {});
    rows = await listed(pA, '');
    const st2 = await stored(pA);
    chk('ISS (ZARYA)\'s star is off until pressed; then the group is KNACKSAT-2 and ISS (ZARYA), in the order they were starred, and so is the record',
        issStar.pressed === 'false' && rows.slice(0, 4).join('|') === '[Watched]|KNACKSAT-2|ISS (ZARYA)|[Catalogue]' && st2.watch === '["67683","25544"]',
        JSON.stringify({ issStar: issStar.pressed, rows: rows.slice(0, 4), st2 }));
    await H.closePicker(pA);

    /* another tab of the page: it reads the list as it opens, and hears the first tab change it */
    const pB = await open();
    const b0 = await star(pB);
    await pA.click('#watchstar');                      // ISS (ZARYA) off, in the first tab
    await pA.waitForFunction(() => document.getElementById('watchstar').getAttribute('aria-pressed') === 'false', null, { timeout: 5000 }).catch(() => {});
    rows = await listed(pB, '');
    await H.closePicker(pB);
    await H.pick(pA, '67683');                         // KNACKSAT-2 off too: the last one, nothing left stored
    await pA.waitForFunction(() => __gt.D.entry.name === 'KNACKSAT-2', null, { timeout: 10000 });
    await pA.click('#watchstar');
    const heard = await pB.waitForFunction(() => document.getElementById('watchstar').getAttribute('aria-pressed') === 'false', null, { timeout: 5000 }).then(() => true, () => false);
    const st3 = await stored(pA);
    const rowsB = await listed(pB, '');
    chk('a second tab opens with the star on for KNACKSAT-2, hears the first take ISS (ZARYA) off (its group: KNACKSAT-2 alone), then KNACKSAT-2, without a reload',
        b0.pressed === 'true' && rows.slice(0, 3).join('|') === '[Watched]|KNACKSAT-2|[Catalogue]' && heard && rowsB[0] === '3CAT-4',
        JSON.stringify({ opened: b0.pressed, groupAfterIss: rows.slice(0, 3), heard, first: rowsB.slice(0, 2) }));
    chk('...and with the last one off nothing is stored', st3.keys === '' && st3.watch === null, JSON.stringify(st3));
    await H.closePicker(pB);
    await pB.close();

    /* an orbit of the reader's own has no number to star: the star is hidden for it, and its group sits between the watched and the catalogue */
    await pA.click('#watchstar');                      // KNACKSAT-2 on again
    await pA.waitForFunction(() => document.getElementById('watchstar').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).catch(() => {});
    await pA.evaluate(() => { const k = __gt.D.entry; __gt.addCustomTLE('KNACKSAT-2 copy', k.l1, k.l2); });
    await pA.waitForTimeout(500);
    const mine = await star(pA);
    rows = await listed(pA, '');
    chk('an orbit of the reader\'s own shows no star; the empty query is then the watched, the reader\'s orbits, the catalogue',
        mine && mine.hidden && !mine.shown && rows.slice(0, 6).join('|') === '[Watched]|KNACKSAT-2|[Your orbits]|KNACKSAT-2 copy|[Catalogue]|3CAT-4',
        JSON.stringify({ hidden: mine && mine.hidden, rows: rows.slice(0, 6) }));
    await H.closePicker(pA);
    await pA.close();
    await ctxW.close();

    /* the cap: fifty watched (the first fifty of the catalogue, put there before the page opened), a press on a fifty-first */
    const ctxF = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1400, height: 900 } });
    await ctxF.clock.install({ time: W0 });
    for (const host of ['**celestrak.org/**', '**tle.ivanstanojevic.me/**', '**gibs.earthdata.nasa.gov/**']) await ctxF.route(host, r => r.abort());
    const catLines = require('fs').readFileSync(path.join(__dirname, '..', '..', 'data', 'catalogue.txt'), 'utf8').split(/\r?\n/).filter(l => /^1 /.test(l));
    const FIFTY = catLines.slice(0, 50).map(l => l.substring(2, 7).trim());   // the catalogue's own order: its first fifty, KNACKSAT-2 not among them
    await ctxF.addInitScript(v => { localStorage.setItem('gt.watch', v); }, JSON.stringify(FIFTY));
    const pF = await ctxF.newPage();
    pF.on('pageerror', e => errsW.push(e.message));
    await pF.goto(PAGE, { waitUntil: 'load' });
    await pF.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!document.getElementById('watchstar'), null, { timeout: 30000 });
    await pF.waitForTimeout(800);
    rows = await H.typeInPicker(pF, '').then(() => pF.waitForTimeout(250)).then(() => pF.evaluate(() => [...document.querySelectorAll('#satlist li')]
      .filter(li => !li.classList.contains('plan')).map(li => li.classList.contains('grp') ? '[' + li.textContent + ']' : li.dataset.idx)));
    chk('fifty watched are the group, in their order, before the catalogue', rows[0] === '[Watched]' && rows.slice(1, 51).join() === FIFTY.map((_, i) => String(i)).join() && rows[51] === '[Catalogue]',
        JSON.stringify(rows.slice(0, 4)) + ' ... ' + JSON.stringify(rows.slice(50, 53)));
    await H.closePicker(pF);
    await pF.click('#watchstar');
    await pF.waitForFunction(() => !document.getElementById('loadnote').hidden, null, { timeout: 5000 }).catch(() => {});
    const capped = await pF.evaluate(() => ({ pressed: document.getElementById('watchstar').getAttribute('aria-pressed'), note: document.getElementById('loadnote').hidden ? '' : document.getElementById('loadnote').textContent.trim(),
      watch: JSON.parse(localStorage.getItem('gt.watch')).length, shown: __gt.D.entry.name }));
    chk('a press on a fifty-first puts nothing on, keeps the record, and says why under the bar', capped.pressed === 'false' && capped.watch === 50 && capped.shown === 'KNACKSAT-2'
        && capped.note === 'You are watching 50 spacecraft, the most this page keeps: take the star off one of them to watch KNACKSAT-2.', JSON.stringify(capped));
    await ctxF.close();
    chk('...with no page error on the way', errsW.length === 0, errsW.join(' | ') || 'none');
    errs.push(...errsW);
  } else console.log('  not checked: the watchlist is the rebuilt page\'s (CHANGES-FROM-LEGACY.md, L60); the old page had none');

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
