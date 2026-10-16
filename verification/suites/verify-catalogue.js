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
 * Then the picker's "decayed now" (L59): on a page whose clock starts at the
 * same fixed instant, the rows SGP4 has down then are marked, exactly those,
 * as an independent run of the pinned satellite.js finds them; nothing is
 * taken out of the list, a marked row is still a pick, the work is a chunk of
 * its own asked for when the list first opens, and the snapshot has none.
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

  // ---- the picker's mark: decayed now ---------------------------------------
  /* The rebuilt picker marks "decayed now" what SGP4 has down at the moment the list is opened: SGP4's own error 6, or a position under the
     120 km entry interface, one sample per entry (CHANGES-FROM-LEGACY.md, L59). Which ones depends on when you ask, so this page runs on a
     clock that starts at W0, and what should be marked is worked out here, apart from the page's code, with the pinned satellite.js
     (verification/reference/satellite.min.js) over the catalogue file. It is a mark: no row is taken away, a marked row is still picked
     the way any is, the work is done in a chunk of its own the first time the list opens (and never in the snapshot, ?tle=embedded), and
     it asks nothing of the network and stores nothing. The old page had none. */
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
      const d = new Date(ms), pv = sat.propagate(s, d);
      if (!pv || !pv.position || !isFinite(pv.position.x)) return s.error === 6;
      return sat.eciToGeodetic(pv.position, sat.gstime(d)).height < 120;
    }).map(e => e.satnum).sort();
    const DOWN = downAt(W0);
    const DOWN_LATER = downAt(W0 + 10 * 60e3);
    chk('(reference) at W0 the pinned SGP4 has 13 of the 2,158 down, ODIN and COSMOS 2558 among them, and the same 13 ten minutes on (so the seconds the page takes to open cannot change the answer)',
        cat.length === 2158 && DOWN.length === 13 && DOWN.includes('26702') && DOWN.includes('53323') && DOWN.join() === DOWN_LATER.join(), DOWN.join(' '));

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
        odin.note === 'Decayed now: at this moment SGP4 has it below the 120 km entry interface, or refuses it as decayed (error 6). It is still listed; picking it asks SGP4 for its whole window.'
        && !odin.noteIsNote, JSON.stringify(odin.note));
    const asked = reqs.slice(sinceOpen);
    chk('...worked out in its own chunk, asked for once, and nothing else is asked of any host for it',
        asked.filter(u => CHUNK.test(u)).length === 1 && asked.every(u => u.startsWith(origin + '/')), asked.map(u => u.replace(origin, '')).join(' ') || 'nothing');

    /* each of the 13 by its number, and some lists of many rows: a row is marked exactly when the reference has it down */
    const wrong = [], seen = new Set();
    for (const q of DOWN.concat(['object', 'cosmos', 'jilin-01 gaofen 3d', 'lemur', 'starlink-23', 'knacksat', 'iss'])) {
      for (const r of await rows(q)) {
        seen.add(r.n);
        if ((r.dk === 'decayed now') !== DOWN.includes(r.n)) wrong.push(q + ': ' + r.n + ' ' + r.nm + ' ' + (r.dk || 'unmarked'));
      }
    }
    chk('every row is marked exactly when the reference has it down at W0: the 13 by their numbers, and the rows for "object", "cosmos", "jilin-01 gaofen 3d", "lemur", "starlink-23" (STARLINK-2342 is refused with error 1, not 6), "knacksat" and "iss"',
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

    /* a marked row is a pick like any other: COSMOS 2558 loads at W0, flagged as re-entering, and ODIN is refused with SGP4's reason, as above */
    await H.pick(p2, '53323');
    await p2.waitForTimeout(900);
    const c2558 = await p2.evaluate(() => ({ shown: __gt.D.entry.name, reentry: !!__gt.D.reentry }));
    await H.pick(p2, '26702');
    await p2.waitForTimeout(900);
    const refused = await p2.evaluate(() => ({ shown: __gt.D.entry.name, note: document.getElementById('loadnote').textContent }));
    chk('a marked row is still picked as any is: COSMOS 2558 loads at W0, flagged as re-entering; ODIN is refused with SGP4\'s own reason',
        c2558.shown === 'COSMOS 2558' && c2558.reentry && refused.shown === 'COSMOS 2558' && /ODIN/.test(refused.note) && /error 6: decayed/.test(refused.note),
        JSON.stringify({ c2558, refused }));

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

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
