/*
 * The reader's own orbits: what happens to every part of the console that was written
 * for catalogue objects when the object on screen is not one.
 *
 * Each group is a failure that was MEASURED on the unguarded page (design-integration
 * section 2, SPEC 6.2):
 *
 *   - a custom entry pushed onto CAT made the page ask CelesTrak and the TLE mirror
 *     for CATNR=O0001, and the decay button ask for its history;
 *   - with a REAL number the reply was adopted as "newer" and the reader's orbit became
 *     the ISS's, under the words "Updated live from CelesTrak";
 *   - the lines under the element set said "fetched live earlier", the CSV's
 *     tle_source said "fetched live, source not recorded", and the section heading
 *     still named SatNOGS, Space-Track and CelesTrak;
 *   - an orbit whose elements equal the ISS's read "docked to ISS (ZARYA)", std mag -1.8;
 *   - a custom orbit named like the default turned on "Outside the brief";
 *   - a refused catalogue pick over a custom orbit left curIdx at -1 and the next span
 *     click threw load(undefined);
 *   - the forward-SGP4 decay loop took 30.7 s on a geostationary orbit, and the Decay
 *     chart clipped the x1/3 run and printed calendar months for an orbit that has no
 *     calendar;
 *   - a missing module, a stored record plus a throwing planner, or a throwing storage
 *     event listener each took the whole page down, on every reload, because the record
 *     stayed in storage.
 *
 * Driven through the controls a reader has wherever a control exists (the picker, the
 * span buttons, the export buttons, the planner pill); through window.__gt where the
 * thing under test is the page's own state. CelesTrak and the TLE mirror are blocked and
 * every request to them is COUNTED, because the assertion is that there are none: a
 * control (fetchTLE of a real number) proves the counter can see one.
 *
 * Where each of SPEC 7.4's additions is (the letters are the spec's):
 *   groups 1-11   the proto's eleven groups, amended: fresh browser and the D15 count text, add and
 *                 its provenance on every surface, names and numbers, the picker, persistence and
 *                 the poisoned stores, blocked storage, ?tle=embedded, the differential, the decay
 *                 guards (physical, no date: D8, D42), editing in place (n), the second layers (a)
 *   12  (c) Advisor.sunEci equals the page's        13  (b) the two-tab storage event
 *   14  (g) gt-customs-changed once per mutation    15  (h) a module missing, (i) a planner that throws, (o) a decayed object
 *   16  (j) err.sgp4 for a decayed epoch, (e) the shape of every refusal and the 13th orbit
 *   17  (d) cid and place handed back, (k) show:false      18  (l) c9999, (m) the counter across an empty list
 *   19  the all-non-Latin file name, and ZERO requests of any host
 *   20-24 what SPEC 6.1 changed without a spec check of its own: the reload paths (C07), the
 *         deep-space window (D39), the host of 6.8, the picker with the planner off, onLoad (C08)
 *
 * Served over http from a fresh context (empty localStorage) like the other page checks.
 * Three environment variables exist for verify-custom-mutants.js and for working on one group;
 * a plain run sets none of them and runs everything:
 *   CUSTOM_INDEX_HTML=<file>  serves that file as index.html instead (a copy with one guard removed,
 *                             never the repo file);
 *   CUSTOM_GROUPS=2,11,17     runs only those groups;
 *   CUSTOM_FAILFAST=1         stops at the first failing check and says which (a mutant that is caught
 *                             need not be run to the end).
 *
 *   node verification/verify-custom.js          (needs playwright)
 */
'use strict';
const H = require('./lib/harness');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = H.playwright();

const ROOT = path.join(__dirname, '..');
const SITE = H.targetRoot();   // what is being served: legacy/ or dist/ (ROOT stays the repo)
const INDEX = process.env.CUSTOM_INDEX_HTML || null;
const GROUPS = process.env.CUSTOM_GROUPS ? new Set(process.env.CUSTOM_GROUPS.split(',').map(Number)) : null;
const FAILFAST = !!process.env.CUSTOM_FAILFAST;
const want = n => !GROUPS || GROUPS.has(n);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      let file = path.join(SITE, rel);
      if (INDEX && rel === 'index.html') file = INDEX;
      if (!file.startsWith(SITE) && !(INDEX && file === INDEX)) { res.writeHead(404); return res.end('no'); }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* Thrown by chk under CUSTOM_FAILFAST: unwinds to the handler at the bottom, which closes the browser and the server
   (process.exit from inside a check would leave Chromium behind) and names the check. */
class FailFast extends Error {}
let browserRef = null, srvRef = null;
let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok && FAILFAST) throw new FailFast(name);
};
const allErrs = [];
const NET = /celestrak\.org|tle\.ivanstanojevic\.me/;
let BASE = '';

/* A fresh context. `init` runs before the page's own scripts on every load; `route` is a list of
   [pattern, handler] added before the first navigation. Page errors are collected per page and
   once more in allErrs, so the final line cannot be green with one unreported. */
async function open(browser, o) {
  o = o || {};
  const ctx = o.reuse || await browser.newContext(Object.assign({ viewport: { width: 1400, height: 900 }, timezoneId: 'UTC', acceptDownloads: true }, o.ctx || {}));
  if (o.init && !o.reuse) await ctx.addInitScript(o.init);
  const page = await ctx.newPage();
  const errs = [], reqs = [];
  page.on('pageerror', e => { errs.push(e.message); allErrs.push(e.message); });
  page.on('request', r => { if (NET.test(r.url())) reqs.push(r.url()); });
  for (const u of ['**celestrak.org/**', '**tle.ivanstanojevic.me/**', '**gibs.earthdata.nasa.gov/**', '**geocoding-api.open-meteo.com/**'])
    await page.route(u, r => r.abort());
  for (const [pat, fn] of (o.route || [])) await page.route(pat, fn);
  await page.goto(BASE + (o.search || ''), { waitUntil: 'load', timeout: 90000 });
  try { await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 40000 }); }
  catch (e) { chk('the page boots to a loaded analysis (window.__gt.D exists)' + (o.search ? ' [' + o.search + ']' : ''), false, 'page errors: ' + (errs.join(' | ') || 'none')); throw e; }
  await page.waitForTimeout(o.settle === undefined ? 500 : o.settle);
  return { ctx, page, errs, reqs };
}
/* Mean elements as the planner takes them. The epoch is the start of the current hour, so the default
   window (which opens now) holds passes and the orbit is a day old at most. */
const HOUR = Math.floor(Date.now() / 3600000) * 3600000;
const mkEl = o => Object.assign({ a: 6378.135 + 600, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: HOUR, am: 0.0043 }, o || {});
const add = (page, name, o, extra) => page.evaluate(([n, el, x]) => __gt.addCustom(Object.assign({ name: n, el }, x || {})), [name, mkEl(o), extra || null]);
/* Type into the real picker and press Enter; resolves when `until` (run in the page) is true. */
const pick = async (page, q, until) => {
  await page.click('#satsearch'); await page.fill('#satsearch', q); await page.keyboard.press('Enter');
  await page.waitForFunction(until || (() => true), q, { timeout: 15000 }).catch(() => {});
};
const onScreen = name => (n => __gt.D.entry.name === n);
const state = page => page.evaluate(() => {
  const g = id => document.getElementById(id);
  return {
    shown: __gt.D.entry.name, custom: !!__gt.D.entry.custom, picker: g('satsearch').value, masthead: g('satname').textContent,
    hours: __gt.D.hours, norad: g('idnorad').textContent, cospar: g('idcospar').textContent, src: g('srcline').textContent,
    meta: g('tlemeta').textContent, rail: g('railprov').textContent, chip: g('agetext').textContent,
    stale: g('agechip').classList.contains('stale'), count: g('satcount').textContent,
    brief: getComputedStyle(g('briefnote')).display !== 'none',
    note: (n => n.hidden ? '' : n.textContent)(g('loadnote')),
    lifebig: g('lifebig').textContent, lifesub: g('lifesub').textContent, lifenote: g('lifenote').textContent,
    lifespan: g('lifespan').textContent, lifelegend: g('lifelegend').textContent, lifego: !!g('lifego'),
    dop: g('dopbar').textContent, store: localStorage.getItem('gt.custom')
  };
});
const shown = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; }, id);
/* one download through the page's own export button */
const grab = async (page, id) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#' + id)]);
  const t = path.join(os.tmpdir(), 'gtc-' + process.pid + '-' + Date.now() + '-' + dl.suggestedFilename());
  await dl.saveAs(t);
  const text = fs.readFileSync(t, 'utf8'); fs.unlinkSync(t);
  return { name: dl.suggestedFilename(), text };
};
const DATE = /\d{4}-\d{2}-\d{2}/;
/* Runs before the page's scripts: when earth/plannerui.js assigns window.PlannerUI, its init is wrapped so the
   test can keep the host object the page hands over, count the calls, and see whether the boot load had
   already happened (window.__gt.D is null until it has). */
const HOSTSPY = `(function(){ var p; Object.defineProperty(window, 'PlannerUI', { configurable: true, get: function(){ return p; }, set: function(v){
  p = v; if(v && typeof v.init === 'function'){ var o = v.init; v.init = function(h){ window.__host = h; window.__initCalls = (window.__initCalls || 0) + 1;
    window.__initSawD = !!(window.__gt && window.__gt.D); return o.apply(this, arguments); }; } } }); })();`;
const paintedPixels = page => page.evaluate(() => {
  const c = document.getElementById('lifecv'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n;
});

(async () => {
  const srv = await serve(); srvRef = srv;
  BASE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); browserRef = browser;
  let t0 = Date.now();
  const lap = what => { const s = ((Date.now() - t0) / 1000).toFixed(0); t0 = Date.now(); if (want(+what.replace(/\D/g, ''))) console.log('  (' + what + ': ' + s + ' s)'); };

  // ---- 1. a fresh browser is exactly what it was --------------------------------------------
  if (want(1)) {
    console.log('1. a fresh browser');
    const { ctx, page, errs } = await open(browser);
    const f = await page.evaluate(() => {
      const pts = []; Orbit3D.scene.traverse(o => { if (o.isPoints) pts.push(o.geometry.attributes.position.count); });
      return { cat: __gt.CAT.length, custom: __gt.CUSTOM.length, pts, count: document.getElementById('satcount').textContent,
               keys: Object.keys(localStorage), on: !!(window.PlannerUI && PlannerUI.enabled()),
               pill: !document.getElementById('planopen').hidden, chip: getComputedStyle(document.getElementById('customchip')).display,
               tle: getComputedStyle(document.getElementById('tleactions')).display, cnote: getComputedStyle(document.getElementById('customnote')).display,
               norad: getComputedStyle(document.getElementById('idnorad').parentNode).display, src: document.getElementById('srcline').textContent,
               name: __gt.D.entry.name };
    });
    chk('a fresh browser has no custom orbit, and the catalogue is 2,158', f.custom === 0 && f.cat === 2158, f.custom + ' / ' + f.cat);
    chk('...the count reads "2,158 spacecraft" (D15: no suffix, one line beside the pill)', f.count === '2,158 spacecraft', f.count);
    chk('...nothing was written to storage by merely opening the page: Object.keys(localStorage) is []', f.keys.length === 0, JSON.stringify(f.keys));
    chk('...the catalogue cloud is one Points object of exactly CAT.length (verify-elements finds it by that)', f.pts.includes(2158), f.pts.join(','));
    chk('...the planner is on (PlannerUI.enabled, the pill is shown) and opens the default spacecraft', f.on && f.pill && f.name === 'KNACKSAT-2', JSON.stringify([f.on, f.pill, f.name]));
    chk('...no mark of a custom orbit shows on a catalogue spacecraft (chip, note, element-set buttons: D37)',
        f.chip === 'none' && f.tle === 'none' && f.cnote === 'none' && f.norad !== 'none' && /SatNOGS/.test(f.src), [f.chip, f.tle, f.cnote, f.norad].join(' '));
    chk('...no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 1');

  // ---- 2. adding one: no request to anyone, and no sentence that lies -------------------------
  if (want(2)) {
    console.log('2. adding an orbit');
    const { ctx, page, errs, reqs } = await open(browser);
    reqs.length = 0;
    const r = await add(page, 'Polar 600');
    await page.waitForTimeout(1500);
    // the beat that re-checks element sets (tickAges, every 30 s and on returning to the tab), driven now
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(800);
    const s = await state(page);
    const f = await page.evaluate(() => {
      const e = __gt.D.entry, g = id => document.getElementById(id), sib = n => n.nextElementSibling;
      return { prov: e.__prov, next: e.__next, cid: e.cid, satnum: e.satnum, idx: __gt.indexOf(e), at: __gt.entryAt(2158) === e, cat: __gt.CAT.length,
        spans: [g('idnorad').parentNode, sib(g('idnorad').parentNode), g('idcospar').parentNode, sib(g('idcospar').parentNode)].map(n => getComputedStyle(n).display),
        sepOk: sib(g('idnorad').parentNode).classList.contains('sep') && sib(g('idcospar').parentNode).classList.contains('sep'),
        rev: g('derived').textContent, tle: g('tleraw').textContent.split('\n'),
        pts: (() => { const p = []; Orbit3D.scene.traverse(o => { if (o.isPoints) p.push(o.geometry.attributes.position.count); }); return p; })() };
    });
    chk('add returns ok, saved, the entry, and puts the orbit on screen',
        r.ok === true && r.saved === true && r.windowMoved === false && s.custom && s.shown === 'Polar 600' && s.masthead === 'Polar 600' && s.picker === 'Polar 600', JSON.stringify(r).slice(0, 90));
    chk('no request went to CelesTrak or the TLE mirror, including from the re-check', reqs.length === 0, reqs.join(' ') || 'none');
    chk('...and refreshTLE wrote no fetch state on the entry (__prov, __next): its own guard held, not only the second layer', f.prov === undefined && f.next === undefined, JSON.stringify([f.prov, f.next]));
    chk('the number fields do not claim a NORAD number: "none · custom" and "—", their spans and the two separators hidden (D16)',
        s.norad === 'none · custom' && s.cospar === '—' && f.spans.every(d => d === 'none') && f.sepOk, s.norad + ' / ' + s.cospar + ' ' + f.spans.join(','));
    chk('the "Custom orbit · edit" chip is a visible button with exactly that text, the custom note shows and the Outside-the-brief note does not',
        await page.evaluate(() => { const c = document.getElementById('customchip'); return c.tagName === 'BUTTON' && c.textContent === 'Custom orbit · edit' && getComputedStyle(c).display !== 'none'; })
          && await shown(page, 'customnote') && await shown(page, 'tleactions') && !s.brief);
    chk('the element-set heading no longer names SatNOGS, Space-Track or CelesTrak: Synthesized from your elements (D31)',
        s.src === 'Synthesized from your elements · not a real TLE', s.src);
    const lies = /embedded|snapshot|fetched live|Checking for a newer|No live source reachable|SatNOGS|README/i;
    chk('the lines under the element set say what it is: built here, a placeholder O0001, nothing fetched, and nothing about a snapshot or the README',
        /Custom orbit — built on this page/.test(s.meta) && /nothing was fetched/.test(s.meta) && /<?O0001/.test(s.meta) && /placeholder/.test(s.meta) && !lies.test(s.meta), s.meta.slice(0, 100));
    chk('the rail says the same', /Custom orbit, your elements/.test(s.rail) && /epoch \d+ (s|min) ago/.test(s.rail) && !lies.test(s.rail), s.rail);
    chk('the age chip does not go stale and does not say "old"', !s.stale && /^custom orbit · epoch .* ago$/.test(s.chip) && !/old/.test(s.chip), s.chip);
    chk('the picker count says how many are the reader\'s own', s.count === '2,158 + 1 of yours', s.count);
    chk('...the orbit has the placeholder number O0001 and lives at picker index 2158 (past the catalogue, which is untouched, and so is the cloud)',
        f.satnum === 'O0001' && f.cid === 'c1' && f.idx === 2158 && f.at && f.cat === 2158 && f.pts.includes(2158) && !f.pts.includes(2159), JSON.stringify([f.satnum, f.cid, f.idx, f.cat, f.pts]));
    chk('the derived values do not print a revolution count of 0 for an orbit that has not flown', /Rev\. no\. @ epoch\s*n\/a \(planned\)/.test(f.rev), (f.rev.match(/Rev\. no\. @ epoch.{0,24}/) || [''])[0]);
    chk('the element set is the synthetic one and is shown as text', f.tle[1].startsWith('1 O0001U') && f.tle[2].startsWith('2 O0001 '), f.tle[1]);
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');

    // decay (SPEC 6.5, D8, D42): the physical model; a duration after the epoch, never a date
    const circ = await page.evaluate(() => {
      const el = __gt.D.entry.el, d = Lifetime.integrate(el.a, 1000 * 2.2 * el.am, 120).days;
      return { days: d, years: (d / 365.25).toFixed(1) + ' years' };
    });
    chk('decay offers no "Estimate" button and requests nothing', !s.lifego && /history was requested/.test(s.lifenote), s.lifespan);
    chk('...the headline is the page\'s own atmosphere model run forward (Lifetime.integrate, drag as typed) and carries no date',
        s.lifebig === circ.years && !DATE.test(s.lifebig + ' ' + s.lifesub), s.lifebig + ' vs ' + circ.years + ' | ' + s.lifesub);
    chk('...the note says what it is: atmosphere model run forward, a factor of 3 either way, and (circular) scrolled years ahead',
        /atmosphere model run forward/.test(s.lifenote) && /factor of 3 either way/.test(s.lifenote) && /scrolled years ahead/.test(s.lifenote) && !DATE.test(s.lifenote), s.lifenote.slice(0, 60));
    chk('...the span line says it is an assumption, and the legend says "model, your drag" and never "observed ("',
        s.lifespan === 'forecast from your drag assumption, not from a history' && /model, your drag/.test(s.lifelegend) && !/observed \(/.test(s.lifelegend), s.lifespan + ' | ' + s.lifelegend);
    chk('...and the chart is drawn, not blank', (await paintedPixels(page)) > 2000, (await paintedPixels(page)) + ' painted pixels');

    // exports: the provenance says custom, the calendar says hypothetical, the numbers are the page's
    const n = await page.evaluate(() => __gt.D.passes.length);
    chk('the default window holds passes from Bangkok (so the export checks below really run)', n > 0, n + ' passes');
    if (n) {
      const csv = await grab(page, 'exp-csv'), rows = csv.text.trim().split(/\r?\n/), h = rows[0].split(','), c1 = rows[1].split(',');
      chk('the CSV says where the element set came from: a custom orbit planned here, never embedded or fetched (tle_source is exact)',
          c1[h.indexOf('tle_source')] === 'custom orbit planned on this page from user-entered elements; not a catalogue object; nothing was fetched', c1[h.indexOf('tle_source')]);
      chk('...the satellite column ends " (custom orbit)" and norad is the placeholder O0001', c1[h.indexOf('satellite')] === 'Polar 600 (custom orbit)' && c1[h.indexOf('norad')] === 'O0001', c1[1] + ' | ' + c1[2]);
      chk('...with the provenance columns still last, as verify-export requires, and a "passes-custom-" file name',
          h.slice(-8).join(',') === 'tle_epoch_utc,tle_line1,tle_line2,tle_source,window_start_utc,window_span_h,mask_deg,site_alt_km' &&
          /^passes-custom-.+-.+-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name);
      const ics = await grab(page, 'exp-ics'), flat = ics.text.replace(/\r\n /g, '');
      chk('the calendar event is marked as a hypothetical orbit in its title and its description, and its UID is the unique placeholder',
          /SUMMARY:\[custom orbit\] Polar 600/.test(flat) && /Hypothetical orbit planned on the Ground Track Console/.test(flat) && /UID:O0001-\d+@ground-track/.test(flat), ics.name);
      chk('...every calendar line is folded to 75 octets', ics.text.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
    }
    await ctx.close();
  }
  lap('group 2');

  // ---- 3. the things that match on names and numbers -------------------------------------------
  if (want(3)) {
    console.log('3. names and numbers');
    const { ctx, page, errs, reqs } = await open(browser);
    const s0 = await state(page);
    chk('control: the catalogue default KNACKSAT-2 does raise "Outside the brief" (so the guard below can be seen to act)', s0.brief === true);
    reqs.length = 0;
    // the ISS's own element set, as a custom orbit that even carries the ISS's real number
    const r = await page.evaluate(() => { const iss = __gt.CAT.find(c => c.name === 'ISS (ZARYA)');
      const out = __gt.addCustomTLE('ISS what-if', iss.l1, iss.l2);
      return { ok: out.ok, num: __gt.D.entry.satnum, std: __gt.stdMagOf({ entry: __gt.D.entry }), catStd: __gt.stdMagOf({ entry: iss }), std0: __gt.STD_MAG,
               dop: document.getElementById('dopbar').textContent }; });
    chk('an orbit equal to the ISS\'s set is not "docked to" it, and its brightness is assumed, not looked up',
        r.ok && r.std.known === false && r.std.via === null && r.std.mag === r.std0 && r.catStd.known === true, JSON.stringify(r.std));
    chk('a custom entry carrying a REAL catalogue number (25544) still finds no downlink in the SatNOGS table, and asks nobody about it',
        r.num === '25544' && r.dop.indexOf('no published downlink') >= 0 && reqs.length === 0, r.num + ' | ' + r.dop + ' | requests ' + reqs.length);
    // a custom orbit NAMED like the default
    await add(page, 'KNACKSAT-2 what-if');
    const s = await state(page);
    chk('a custom orbit named like the default does not raise "Outside the brief"', s.custom && !s.brief, 'brief shown: ' + s.brief);
    // the reader's own downlink frequency is the one thing a planned orbit can have
    const d = await add(page, 'Beacon', {}, { dlHz: 437.8e6 });
    const dop = await page.evaluate(() => ({ opt: [...document.querySelectorAll('#dopsel option')].map(o => o.textContent), freq: (document.getElementById('dopfreq') || {}).value }));
    chk('a downlink frequency given with the orbit is the only one offered, as the reader\'s own', d.ok && dop.opt.length === 2 && /437\.800 MHz\s+user/.test(dop.opt[0]) && dop.freq === '437.800', JSON.stringify(dop));
    const e = await page.evaluate(() => { const x = __gt.addCustom({ name: 'Beacon bad', el: { a: 6978.135, e: 0.001, i: 97.8, raan: 0, argp: 0, M: 0, epoch: Date.now(), am: 0.0043 }, dlHz: 5 });
      return { ok: x.ok, hz: __gt.D.entry.dlHz, dop: document.getElementById('dopbar').textContent }; });
    chk('...and a frequency outside 1 MHz to 100 GHz is dropped, never an error', e.ok && e.hz === undefined && e.dop.indexOf('no published downlink') >= 0, JSON.stringify(e));
    await page.evaluate(() => { while (__gt.CUSTOM.length) __gt.removeCustom(__gt.CUSTOM[0]); });
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 3');

  // ---- 4. the picker, and the failure path that used to read CAT.indexOf --------------------------
  if (want(4)) {
    console.log('4. the picker');
    const { ctx, page, errs } = await open(browser);
    await add(page, 'Alpha orbit'); await add(page, 'Bravo orbit', { i: 53 });
    await page.click('#satsearch');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#satlist li')].slice(0, 6).map(li => ({ role: li.getAttribute('role'), cls: li.className, t: li.textContent })));
    chk('with nothing typed the picker opens on a "Your orbits" group, the reader\'s own orbits tagged "custom", then a "Catalogue" group',
        rows[0].t === 'Your orbits' && rows[0].role === 'presentation' && /^Alpha orbitcustom$/.test(rows[1].t) && /^Bravo orbitcustom$/.test(rows[2].t) &&
        rows[3].t === 'Catalogue' && rows[3].role === 'presentation' && rows[4].role === 'option', JSON.stringify(rows.map(r => r.t)));
    const idx = await page.evaluate(() => [...document.querySelectorAll('#satlist li[data-idx]')].slice(0, 3).map(li => +li.dataset.idx));
    chk('...the group rows are not options: the first options are the two customs (picker indices 2158, 2159) then catalogue 0', idx.join() === '2158,2159,0', idx.join());
    await page.keyboard.press('Escape');
    await pick(page, 'alpha', n => __gt.D.entry.name === 'Alpha orbit');
    let s = await state(page);
    chk('typing a custom orbit\'s name picks it, and the picker names it', s.shown === 'Alpha orbit' && s.custom && s.picker === 'Alpha orbit', s.shown);
    await page.click('#satsearch'); await page.fill('#satsearch', 'custom');
    const cw = await page.evaluate(() => [...document.querySelectorAll('#satlist li[data-idx]')].slice(0, 3).map(li => li.querySelector('.nm').textContent));
    chk('the word "custom" finds the reader\'s own orbits first', cw[0] === 'Alpha orbit' && cw[1] === 'Bravo orbit', cw.join(' | '));
    await page.fill('#satsearch', 'O0001');
    const byNum = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#satlist li[data-idx]')].map(li => li.querySelector('.nm').textContent), note: !!document.querySelector('#satlist li.note') }));
    chk('a custom orbit is never found by its placeholder number (O0001 is not a search term)', byNum.rows.length === 0 && byNum.note, JSON.stringify(byNum));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    // the Plan row: the last option, reached by ArrowDown, opened by Enter or a click; Escape returns to the pill
    await page.click('#satsearch'); await page.fill('#satsearch', 'zzqq nothing');
    const plan = await page.evaluate(() => { const li = document.querySelector('#satlist li.plan');
      return { have: !!li, last: li === document.querySelector('#satlist').lastElementChild, role: li && li.getAttribute('role'), note: document.querySelector('#satlist li.note').textContent }; });
    chk('a query that matches nothing lists "Nothing in the catalogue matches that" and the Plan row as the last option',
        plan.have && plan.last && plan.role === 'option' && plan.note === 'Nothing in the catalogue matches that', JSON.stringify(plan));
    await page.keyboard.press('ArrowDown');
    chk('...ArrowDown reaches it (aria-activedescendant names it)', await page.evaluate(() => document.getElementById('satsearch').getAttribute('aria-activedescendant') === 'soptplan'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('planner').hidden, null, { timeout: 5000 }).catch(() => {});
    const o = await page.evaluate(() => ({ name: document.getElementById('pl-name').value, focus: document.activeElement.id, open: document.getElementById('planopen').getAttribute('aria-expanded'), list: document.getElementById('satlist').hidden, picker: document.getElementById('satsearch').value }));
    chk('...Enter opens the planner with the query as the name, the focus in its name field, the list closed and the picker back on the spacecraft on screen',
        o.name === 'zzqq nothing' && o.focus === 'pl-name' && o.open === 'true' && o.list && o.picker === 'Alpha orbit', JSON.stringify(o));
    await page.keyboard.press('Escape');
    chk('...Escape from there closes it and returns the focus to the pill, never to the page', await page.evaluate(() => document.getElementById('planner').hidden && document.activeElement.id === 'planopen'));
    // a click on the Plan row opens it too, and the planner keeps the focus (the mousedown must not blur it)
    await page.click('#satsearch'); await page.fill('#satsearch', 'qqzz');
    await page.click('#satlist li.plan');
    chk('a click on the Plan row opens the planner with the focus in its name field', await page.evaluate(() => !document.getElementById('planner').hidden && document.activeElement.id === 'pl-name'));
    await page.keyboard.press('Escape');
    await page.click('#satsearch'); await page.fill('#satsearch', 'ISS'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^ISS/.test(__gt.D.entry.name), null, { timeout: 15000 }).catch(() => {});
    const issName = await page.evaluate(() => __gt.D.entry.name);
    chk('"ISS" and Enter still pick the first hit, a catalogue spacecraft (the Plan row is only ever the last option)', /^ISS/.test(issName) && await page.evaluate(() => !__gt.D.entry.custom), issName);
    await pick(page, 'alpha', () => __gt.D.entry.name === 'Alpha orbit');

    // a decayed catalogue object is refused while a custom orbit is on screen: curIdx must go back to the custom one
    const before = errs.length;
    await pick(page, '26702', () => !document.getElementById('loadnote').hidden);
    s = await state(page);
    chk('a refused catalogue pick leaves the custom orbit on screen and the picker naming it (M11)',
        s.shown === 'Alpha orbit' && s.picker === 'Alpha orbit' && /ODIN/.test(s.note) && /Still showing Alpha orbit/.test(s.note), s.note.slice(0, 100));
    await page.click('.bar-window .span[data-h="72"]');
    await page.waitForFunction(() => __gt.D.hours === 72, null, { timeout: 15000 }).catch(() => {});
    s = await state(page);
    chk('...and the next span change reloads the custom orbit, not undefined', s.hours === 72 && s.shown === 'Alpha orbit' && errs.length === before,
        s.shown + ', ' + s.hours + ' h, errors ' + (errs.length - before) + ' ' + errs.slice(before).join('|'));
    await page.click('.bar-window .span[data-h="24"]');
    await page.waitForFunction(() => __gt.D.hours === 24, null, { timeout: 15000 }).catch(() => {});
    // remove the OTHER one (it sits after the one on screen): the on-screen one must stay addressable
    await page.evaluate(() => __gt.removeCustom(__gt.CUSTOM.find(c => c.name === 'Bravo orbit')));
    await page.click('.bar-window .span[data-h="6"]');
    await page.waitForFunction(() => __gt.D.hours === 6, null, { timeout: 15000 }).catch(() => {});
    s = await state(page);
    chk('removing another custom orbit leaves the one on screen loaded and reloadable (curIdx is recomputed after the splice)', s.shown === 'Alpha orbit' && s.hours === 6 && s.count === '2,158 + 1 of yours', s.count);
    // the first of two goes while the second is on screen: its virtual index shifts down by one
    await add(page, 'Charlie orbit');
    await page.evaluate(() => __gt.removeCustom(__gt.CUSTOM.find(c => c.name === 'Alpha orbit')));
    await page.click('.bar-window .span[data-h="24"]');
    await page.waitForFunction(() => __gt.D.hours === 24, null, { timeout: 15000 }).catch(() => {});
    s = await state(page);
    chk('removing a custom orbit that precedes the one on screen shifts its index; the next reload still finds it', s.shown === 'Charlie orbit' && s.custom && errs.length === before, s.shown);
    // remove the one ON screen
    const gone = await page.evaluate(() => __gt.removeCustom(__gt.D.entry));
    s = await state(page);
    chk('removing the orbit on screen goes back to the last catalogue spacecraft viewed first, then lets it go',
        gone === true && !s.custom && s.shown === issName && s.picker === issName && s.count === '2,158 spacecraft', s.shown + ' | ' + s.count);
    chk('...the saved list is empty but the counter is kept: {"v":1,"next":4,"items":[]}', s.store === '{"v":1,"next":4,"items":[]}', s.store);
    // every mark of a custom orbit goes with it: the chip, the note and the element-set buttons hide again, the number fields and the source line are the catalogue's
    const gone2 = await page.evaluate(() => { const g = id => document.getElementById(id), vis = id => !g(id).hidden && getComputedStyle(g(id)).display !== 'none';
      return { chip: vis('customchip'), note: vis('customnote'), btns: vis('tleactions'), noradParent: getComputedStyle(g('idnorad').parentNode).display,
        noradText: g('idnorad').textContent, src: g('srcline').textContent, seps: [...document.querySelectorAll('.ids .sep')].map(n => getComputedStyle(n).display) }; });
    chk('...and every mark of a custom orbit goes with it: chip, note and element-set buttons hidden again, the number fields back (with their separators), the source line the catalogue\'s',
        !gone2.chip && !gone2.note && !gone2.btns && gone2.noradText !== 'none · custom' && gone2.noradParent !== 'none' && /SatNOGS/.test(gone2.src) && gone2.seps.every(d => d !== 'none'), JSON.stringify(gone2));
    chk('...with the analysis of the catalogue object loaded, no error', errs.length === before && !s.note, errs.slice(before).join(' | ') || 'none');
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 4');

  // ---- 5. persistence: rebuilt on read, validated to the standard of the network path ----------------
  if (want(5)) {
    console.log('5. persistence');
    const { ctx, page, errs } = await open(browser);
    await add(page, 'Keep me'); await add(page, 'And me', { i: 28.5, a: 6378.135 + 550 });
    const saved = await page.evaluate(() => localStorage.getItem('gt.custom'));
    const j = JSON.parse(saved);
    chk('what is stored is the inputs and nothing derived: no TLE lines, no number, no flag, no B*, a version and a counter',
        j.v === 1 && j.next === 3 && j.items.length === 2 && j.items.every(it => !('l1' in it) && !('l2' in it) && !('custom' in it) && !('satnum' in it) && it.el && !('bstar' in it.el) && typeof it.el.am === 'number' && it.name && /^c\d+$/.test(it.id)), saved.slice(0, 120));
    const tles = await page.evaluate(() => __gt.CUSTOM.map(c => c.l1 + '|' + c.l2));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 40000 }); await page.waitForTimeout(500);
    const s = await state(page);
    const back = await page.evaluate(() => __gt.CUSTOM.map(c => c.l1 + '|' + c.l2));
    chk('after a reload both are back, rebuilt from the stored elements (no bstar in the record) to exactly the same two lines, and the page still opens on the default',
        back.length === 2 && back[0] === tles[0] && back[1] === tles[1] && s.shown === 'KNACKSAT-2', s.shown + ' / ' + back.length);
    chk('...and the picker says so', s.count === '2,158 + 2 of yours', s.count);
    chk('...the typed values are kept, not the TLE-rounded ones (the stored record still holds a = 6978.135 exactly)', await page.evaluate(() => __gt.CUSTOM[0].el.a === 6978.135 && __gt.CUSTOM[0].el.e === 0.001));
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  // each poisoned store, in a context of its own, seeded BEFORE the page runs
  const GOOD = { id: 'c1', name: 'Fine', made: 1, el: { a: 6978.135, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: Date.UTC(2026, 9, 1), bstar: 3e-4 } };
  const POISON = [
    ['not JSON', '{"v":1,"items":['],
    ['another version', JSON.stringify({ v: 2, items: [GOOD] })],
    ['an array, not an object', JSON.stringify([GOOD])],
    ['a 70,000 character string', JSON.stringify({ v: 1, items: [GOOD], pad: 'x'.repeat(70000) })],
    ['NaN and strings where numbers go', JSON.stringify({ v: 1, next: 2, items: [Object.assign({}, GOOD, { el: Object.assign({}, GOOD.el, { a: 'x', e: null }) })] })],
    ['an eccentricity of 1.5 and a perigee under ground', JSON.stringify({ v: 1, next: 2, items: [Object.assign({}, GOOD, { el: Object.assign({}, GOOD.el, { e: 1.5 }) }), Object.assign({}, GOOD, { id: 'c2', el: Object.assign({}, GOOD.el, { a: 6600, e: 0.05 }) })] })],
    ['a stored TLE and a stored custom flag (ignored, never read)', JSON.stringify({ v: 1, next: 2, items: [Object.assign({}, GOOD, { l1: 'x', l2: 'y', custom: false, satnum: '25544' })] })],
    ['a __proto__ key and an id that is not cN', '{"v":1,"next":2,"items":[{"id":"__proto__","name":"x","el":' + JSON.stringify(GOOD.el) + '},{"id":"c1","__proto__":{"custom":false},"name":"Ok","el":' + JSON.stringify(GOOD.el) + '}]}'],
    ['thirty orbits (cap is 12)', JSON.stringify({ v: 1, next: 31, items: Array.from({ length: 30 }, (_, k) => Object.assign({}, GOOD, { id: 'c' + (k + 1), name: 'Orbit ' + (k + 1) })) })],
    ['a perigee 5 km above the ground (the form accepts it, SGP4 refuses it: refused by SGP4)', JSON.stringify({ v: 1, next: 2, items: [{ id: 'c1', name: 'Too low', made: 1, el: { a: 6378.135 + 5, e: 0, i: 0, raan: 0, argp: 0, M: 0, epoch: Date.UTC(2026, 9, 1), am: 0.0043 } }] })],
    ['a name that is markup, a formula and a forged calendar line', JSON.stringify({ v: 1, next: 2, items: [Object.assign({}, GOOD, { name: '=1+1\r\nEND:VCALENDAR<img src=x onerror=window.__xss=1>' })] })]
  ];
  if (want(5)) for (const [label, raw] of POISON) {
    const { ctx, page, errs } = await open(browser, { init: `try{localStorage.setItem('gt.custom', ${JSON.stringify(raw)});}catch(e){}`, settle: 200 });
    const r = await page.evaluate(() => ({ n: __gt.CUSTOM.length, names: __gt.CUSTOM.map(c => c.name), tle: __gt.CUSTOM.map(c => [c.l1.length, c.l2.length, c.custom, c.satnum]),
      xss: window.__xss === 1, store: localStorage.getItem('gt.custom'), bak: localStorage.getItem('gt.custom.bak'), shown: __gt.D.entry.name,
      polluted: ({}).custom === true || Object.prototype.hasOwnProperty.call(Object.prototype, 'custom'),
      /* the name is markup: open the list so it is painted, then look for an element it made */
      noImg: (() => { document.getElementById('satsearch').focus(); return !document.querySelector('#satlist img, #satname img, #tleraw img, #satcount img'); })() }));
    const ok = !errs.length && !r.xss && !r.polluted && r.shown === 'KNACKSAT-2' && r.tle.every(t => t[0] === 69 && t[1] === 69 && t[2] === true && /^O\d{4}$/.test(t[3]));
    let expect;
    if (/not JSON|another version|array|70,000/.test(label)) expect = r.n === 0 && r.store === null;
    else if (/NaN/.test(label)) expect = r.n === 0;
    else if (/eccentricity/.test(label)) expect = r.n === 0;
    else if (/stored TLE/.test(label)) expect = r.n === 1 && r.names[0] === 'Fine';
    else if (/__proto__/.test(label)) expect = r.n === 1 && r.names[0] === 'Ok';
    else if (/thirty/.test(label)) expect = r.n === 12;
    else if (/refused by SGP4/.test(label)) expect = r.n === 0;
    else expect = r.n === 1 && !/[\r\n]/.test(r.names[0]) && !/^[=+\-@]/.test(r.names[0]) && Array.from(r.names[0]).length <= 24 && r.noImg;
    chk('poisoned store, ' + label + ': dropped or cleaned, never trusted', ok && expect,
        'kept ' + r.n + (r.names.length ? ' ' + JSON.stringify(r.names).slice(0, 60) : '') + (errs.length ? ' ERR ' + errs[0] : ''));
    if (/another version/.test(label)) chk('...a record of another version is moved aside, not destroyed', r.bak !== null && JSON.parse(r.bak).v === 2);
    await ctx.close();
  }
  lap('group 5');

  // ---- 6. storage that cannot be used ------------------------------------------------------------------
  if (want(6)) {
    console.log('6. blocked storage');
    const { ctx, page, errs } = await open(browser, { init:
      `Storage.prototype.getItem=function(){throw new DOMException('blocked','SecurityError')};Storage.prototype.setItem=function(){throw new DOMException('blocked','SecurityError')};Storage.prototype.removeItem=function(){throw new DOMException('blocked','SecurityError')};` });
    const r = await add(page, 'Session only');
    const shownName = await page.evaluate(() => __gt.D.entry.name);
    chk('with storage blocked the page still opens and a custom orbit still works for the session, saying it was not saved',
        r.ok === true && r.saved === false && shownName === 'Session only' && errs.length === 0, 'saved=' + r.saved + ' ' + (errs[0] || 'no error'));
    await ctx.close();
  }
  lap('group 6');

  // ---- 7. the assignment snapshot ------------------------------------------------------------------------
  if (want(7)) {
    console.log('7. ?tle=embedded');
    const seed = `try{localStorage.setItem('gt.custom', ${JSON.stringify(JSON.stringify({ v: 1, next: 2, items: [GOOD] }))});}catch(e){}`;
    const { ctx, page, errs } = await open(browser, { search: '?tle=embedded', init: seed });
    const r = await page.evaluate(() => {
      const el = { a: 6978, e: 0.001, i: 98, raan: 0, argp: 0, M: 0, epoch: Date.now(), am: 0.0043 };
      const pill = document.getElementById('planopen');
      pill.focus();
      const focused = document.activeElement === pill;
      pill.click();
      return { n: __gt.CUSTOM.length, count: document.getElementById('satcount').textContent, add: __gt.addCustom({ name: 'x', el }),
        upd: __gt.updateCustom({}, { name: 'x', el }), store: localStorage.getItem('gt.custom'), pill: !pill.hidden && getComputedStyle(pill).display !== 'none',
        dis: pill.getAttribute('aria-disabled'), exp: pill.getAttribute('aria-expanded'), title: pill.title, focused, planner: document.getElementById('planner').hidden,
        note: document.getElementById('plannote').textContent, noteShown: !document.getElementById('plannote').hidden,
        back: (a => a && a.getAttribute('href'))(document.querySelector('#plannote a')) };
    });
    chk('?tle=embedded shows only the embedded catalogue and leaves a saved store untouched (neither listed nor rewritten)',
        r.n === 0 && r.count === '2,158 spacecraft' && r.store && JSON.parse(r.store).items.length === 1 && JSON.parse(r.store).items[0].name === 'Fine', r.count + ' ' + r.n);
    chk('...addCustom and updateCustom refuse with the planner.off code and the sentence',
        r.add.ok === false && r.add.errors[0].code === 'planner.off' && /assignment snapshot/.test(r.add.errors[0].msg) && r.upd.ok === false && r.upd.errors[0].code === 'planner.off', JSON.stringify(r.add.errors));
    chk('...the pill is shown as aria-disabled, still focusable, with the sentence as its title and a way back; activating it opens nothing',
        r.pill && r.dis === 'true' && r.focused && r.exp === 'false' && r.planner && r.title === 'The orbit planner is off in the assignment snapshot (?tle=embedded).' &&
        r.noteShown && /^The orbit planner is off in the assignment snapshot \(\?tle=embedded\)\. Back to the live element sets\.$/.test(r.note) && r.back === '?', JSON.stringify([r.dis, r.focused, r.exp, r.planner, r.back]));
    // the storage listener exists (the planner is on) and must not take another tab's orbit into a snapshot
    const sev = await page.evaluate(seed => { window.dispatchEvent(new StorageEvent('storage', { key: 'gt.custom', newValue: seed, storageArea: localStorage }));
      return { n: __gt.CUSTOM.length, count: document.getElementById('satcount').textContent }; },
      JSON.stringify({ v: 1, next: 2, items: [{ id: 'c1', name: 'From elsewhere', made: 1, el: { a: 6978.135, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: Date.UTC(2026, 9, 1), am: 0.0043 } }] }));
    chk('...and another tab\'s change (a storage event) is not merged into the snapshot either', sev.n === 0 && sev.count === '2,158 spacecraft', JSON.stringify(sev));
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
    // init is called under PINNED too (it is what shows the pill as disabled), with a host that says so
    const P = await open(browser, { search: '?tle=embedded', init: HOSTSPY, settle: 200 });
    const ph = await P.page.evaluate(() => ({ init: window.__initCalls, pinned: window.__host && window.__host.pinned, enabled: PlannerUI.enabled() }));
    chk('...PlannerUI.init is still called under ?tle=embedded, with host.pinned true, and leaves the planner disabled', ph.init === 1 && ph.pinned === true && ph.enabled === false && P.errs.length === 0, JSON.stringify(ph));
    await P.ctx.close();
  }
  lap('group 7');

  // ---- 8. the same pipeline, bit for bit -------------------------------------------------------------------
  if (want(8)) {
    console.log('8. the differential');
    const { ctx, page, errs } = await open(browser);
    const d = await page.evaluate(() => {
      const T0 = Date.UTC(2026, 8, 13), k = __gt.CAT.find(c => c.name === 'KNACKSAT-2');
      const a = __gt.compute(k, T0, 24);
      __gt.addCustomTLE('KNACKSAT-2 copy', k.l1, k.l2);
      const c = __gt.compute(__gt.D.entry, T0, 24);
      const strip = D => ({ passes: D.passes.map(p => [p.aos.getTime(), p.los.getTime(), p.maxEl, p.maxAz, p.minRng, p.dur]),
        pts: D.pts.map(p => [p.lat, p.lon, p.alt, p.el, p.az, p.rng]), totalS: D.totalS, meanAlt: D.meanAlt, lambda: D.lambda,
        E: [D.E.a, D.E.ecc, D.E.inc, D.E.raan, D.E.argp, D.E.ma, D.E.n, D.E.period, D.E.perigeeAlt, D.E.apogeeAlt, D.E.bstar] });
      const A = JSON.stringify(strip(a)), C = JSON.stringify(strip(c));
      return { same: A === C, n: a.passes.length, pts: a.pts.length, len: A.length,
        life: document.getElementById('lifebig').textContent, lifenote: document.getElementById('lifenote').textContent, custom: __gt.D.entry.custom, el: __gt.D.entry.el };
    });
    chk('a catalogue object run down the custom path computes bit-identical elements, passes and ground track (8,641 samples)',
        d.same && d.pts === 8641 && d.n > 0, d.n + ' passes, ' + d.pts + ' samples, ' + d.len + ' bytes compared');
    chk('...and a custom entry with no elements (the test hook) says so in the Decay section instead of forecasting from nothing',
        d.custom === true && d.el === null && d.life === 'Not forecast' && /no elements to forecast from/.test(d.lifenote), d.life + ' | ' + d.lifenote);
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 8');

  // ---- 9. orbits the forward decay loop must never touch, and what the Decay section says for each -------------
  if (want(9)) {
    console.log('9. decay guards');
    const { ctx, page, errs } = await open(browser);
    const ws = await page.evaluate(() => __gt.D.start.getTime());
    const ft = () => page.evaluate(() => { window.__ft = []; const f = CanvasRenderingContext2D.prototype.fillText;
      if (!f.__spy) { CanvasRenderingContext2D.prototype.fillText = function (t) { window.__ft.push(String(t)); return f.apply(this, arguments); }; CanvasRenderingContext2D.prototype.fillText.__spy = true; } });
    await ft();
    const run = (name, o, extra) => page.evaluate(([n, el, x]) => { const t = performance.now();
      const r = __gt.addCustom(Object.assign({ name: n, el }, x || {})); const g = id => document.getElementById(id);
      return { ms: performance.now() - t, ok: r.ok, errors: r.errors, big: g('lifebig').textContent, sub: g('lifesub').textContent, note: g('lifenote').textContent,
        go: !!g('lifego'), reentry: !!__gt.D.reentry, passes: __gt.D.passes.length, legend: g('lifelegend').textContent, alt: g('lifealt').textContent, hist: g('lifehist').textContent,
        labels: (window.__ft || []).slice(), win: __gt.D.start.getTime() }; }, [name, mkEl(o), extra || null]);
    const geo = await run('GEO slot', { a: 42164.182, e: 0.0002, i: 0.05 });
    chk('a geostationary custom orbit loads in well under a few seconds and is given no decay figure (unguarded: 30.7 s)',
        geo.ok && geo.ms < 4000 && geo.big === 'Not forecast' && !geo.go && /^perigee 3\d,\d{3} km$/.test(geo.sub) && /Moon and the Sun/.test(geo.note) && !DATE.test(geo.note), geo.ms.toFixed(0) + ' ms, "' + geo.big + '" ' + geo.sub);
    const hi = await run('High LEO', { a: 6378.135 + 1500 });
    chk('an orbit with its perigee above the atmosphere table is told drag does not decide it',
        hi.ok && hi.big === 'No drag estimate' && /1,000 km/.test(hi.note) && hi.ms < 4000, hi.ms.toFixed(0) + ' ms, "' + hi.big + '" ' + hi.sub);
    const fast = await run('Low and draggy', { a: 6378.135 + 130, e: 0.0001, i: 51.6, epoch: ws });
    chk('a low orbit that SGP4 takes under 120 km inside the window is flagged as re-entering, and its Decay section is a duration in hours, never a date',
        fast.ok && fast.reentry && /^\d+ hours?$/.test(fast.big) && !DATE.test(fast.big + fast.sub + fast.note), fast.big + ' | ' + fast.sub);
    const inert = await run('Inert', { am: 0 });
    chk('an area-to-mass ratio of 0 never decays, and says so', inert.ok && inert.big === 'No drag' && /never decays/.test(inert.note), inert.big);
    const re = await run('Perigee at 100 km', { a: 6378.135 + 100, e: 0.0001, i: 51.6, epoch: ws });
    chk('a perigee under the 120 km line is "Re-entering" (Add stays enabled; the orbit loads)', re.ok && re.big === 'Re-entering' && /120 km line/.test(re.note), re.big + ' ' + (re.errors && re.errors[0] && re.errors[0].msg));
    await ft();
    const ecc = await run('Eccentric', { a: 6378.135 + 900, e: 0.04, i: 51.6 });
    chk('an eccentric orbit gets the orbit-averaged forecast: the note says "sooner or later", names the perigee, and the chart says perigee height',
        ecc.ok && /sooner or later/.test(ecc.note) && !/scrolled years ahead/.test(ecc.note) && /bites at perigee/.test(ecc.note) && /model, perigee height/.test(ecc.legend) && !DATE.test(ecc.big + ecc.sub + ecc.note), ecc.big + ' | ' + ecc.sub);
    await ft();
    const lo = await run('Low circular', { a: 6378.135 + 250 });
    chk('the Decay chart\'s x axis is days after the epoch: "epoch", then three "+N" labels, and no calendar date anywhere (D42)',
        lo.labels.includes('epoch') && lo.labels.filter(t => /^\+\d+(\.\d)? (h|d|y)$/.test(t)).length === 3 && !lo.labels.some(t => /\d{4}-\d{2}/.test(t)), JSON.stringify(lo.labels));
    const ex = await page.evaluate(() => { const L = Advisor.life(__gt.D.entry.el); const last = a => a && a.length ? a[a.length - 1].t : 0;
      const mid = last(L.track), d = Math.max(mid, last(L.fastTrack), last(L.slowTrack));
      const f = d < 2 ? Math.max(1, Math.round(d * 24)) + ' h' : d < 120 ? Math.round(d) + ' d' : (d / 365.25 < 10 ? (d / 365.25).toFixed(1) : String(Math.round(d / 365.25))) + ' y';
      return { mid, longest: d, label: '+' + f }; });
    chk('...and the axis runs to the end of the LONGEST of the three runs (the x1/3 run), so the band is not clipped at the edge: the last label is that run\'s length, longer than the mid-case run\'s',
        ex.longest > ex.mid * 1.5 && lo.labels.includes(ex.label), JSON.stringify(ex) + ' ' + JSON.stringify(lo.labels.filter(t => /^\+/.test(t))));
    await ft();
    const sso = await run('Sun-synchronous 700', { a: 6378.135 + 700, e: 0.0011, i: 98.2 });
    const lastY = sso.labels.filter(t => /^\+\d+ y$/.test(t)).map(t => parseInt(t.slice(1), 10));
    chk('...for a 700 km orbit that outlasts the century the last label is in years (>= 100) and no year like 2136 appears', lastY.length && Math.max.apply(null, lastY) >= 100 && !sso.labels.some(t => /\b20\d\d\b/.test(t)) && !DATE.test(sso.sub), JSON.stringify(sso.labels) + ' ' + sso.big + ' ' + sso.sub);
    // the hover tooltip: a duration after the epoch and a height, no date, no "observed"
    await page.evaluate(() => document.getElementById('lifecv').scrollIntoView({ block: 'center' }));
    const b2 = await page.evaluate(() => { const r = document.getElementById('lifecv').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.move(b2.x + b2.w * 0.5, b2.y + b2.h * 0.5);
    await page.waitForFunction(() => document.getElementById('lifetip').classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
    const tip = await page.evaluate(() => ({ on: document.getElementById('lifetip').classList.contains('on'), t: document.getElementById('lifetip').innerText }));
    chk('...and the chart\'s hover readout is "+N after epoch" with a height and "model", never a date or "observed"',
        tip.on && /^\+\d+(\.\d)? (h|d|y) after epoch\s+-?\d+\.\d km · model$/.test(tip.t) && !DATE.test(tip.t) && !/observed/.test(tip.t), JSON.stringify(tip));
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 9');

  // ---- 10. editing in place ----------------------------------------------------------------------------------------
  if (want(10)) {
    console.log('10. editing in place');
    const { ctx, page, errs, reqs } = await open(browser);
    await add(page, 'Edit me');
    reqs.length = 0;
    // scrub the clock somewhere inside the window and pause it, so "the reader's instant" is a text that does not tick
    await page.evaluate(() => { const r = document.getElementById('time'); r.value = 500; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const clock0 = await page.evaluate(() => document.getElementById('tpclock').textContent);
    const r = await page.evaluate(([el]) => { const e = __gt.CUSTOM[0], d0 = __gt.D.entry;
      const x = __gt.updateCustom(e, { name: 'Edited', el });
      return { ok: x.ok, same: __gt.D.entry === e && e === d0 && x.entry === e, inc: __gt.D.E.inc, cid: e.cid, satnum: e.satnum, n: __gt.CUSTOM.length, moved: x.windowMoved,
               name: document.getElementById('satname').textContent, picker: document.getElementById('satsearch').value, clock: document.getElementById('tpclock').textContent,
               stored: (JSON.parse(localStorage.getItem('gt.custom')) || { items: [{}] }).items[0] }; }, [mkEl({ i: 63.4, a: 6378.135 + 800 })]);
    chk('editing the orbit on screen re-analyses it in place: same object, same id and number, new inclination and name',
        r.ok && r.same && Math.abs(r.inc - 63.4) < 1e-4 && r.cid === 'c1' && r.satnum === 'O0001' && r.n === 1 && r.name === 'Edited' && r.picker === 'Edited' && r.moved === false, 'i ' + r.inc + ', ' + r.name);
    chk('...(n) the reader\'s instant on the clock is kept across the edit (updateCustom does that, not the host)', r.clock === clock0, clock0 + ' -> ' + r.clock);
    chk('...and the saved copy follows', r.stored.name === 'Edited' && Math.abs(r.stored.el.i - 63.4) < 1e-9, JSON.stringify(r.stored.el).slice(0, 60));
    const bad = await page.evaluate(([el]) => { const e = __gt.CUSTOM[0], before = e.l1 + e.l2 + e.name + JSON.stringify(e.el);
      const x = __gt.updateCustom(e, { name: 'Broken', el });
      return { ok: x.ok, code: x.errors && x.errors[0] && x.errors[0].code, sgp4: x.errors && x.errors[0] && x.errors[0].sgp4, msg: x.errors && x.errors[0] && x.errors[0].msg,
               restored: before === e.l1 + e.l2 + e.name + JSON.stringify(e.el), name: document.getElementById('satname').textContent, inc: __gt.D.E.inc,
               note: document.getElementById('loadnote').hidden, stored: (JSON.parse(localStorage.getItem('gt.custom')) || { items: [{}] }).items[0].name }; },
      [mkEl({ a: 6378.135 + 150, epoch: Date.now() - 30 * 86400000 })]);
    chk('an edit whose elements SGP4 cannot run is refused with the page\'s own reason (err.sgp4, the code SGP4 gave), and the old orbit is put back',
        !bad.ok && bad.code === 'err.sgp4' && bad.sgp4 > 0 && bad.restored && bad.name === 'Edited' && Math.abs(bad.inc - 63.4) < 1e-4 && bad.stored === 'Edited' && /cannot be propagated/.test(bad.msg || ''), (bad.msg || '').slice(0, 90));
    chk('...and the console\'s own #loadnote stays empty (a failed Add or Edit is the planner\'s message, not the console\'s)', bad.note === true);
    // (n) off screen: refuse an element set SGP4 cannot load BEFORE storing it
    await add(page, 'Second');
    const off = await page.evaluate(([bad, good]) => { const a = __gt.CUSTOM[0], b = __gt.D.entry, before = a.l1 + a.name + JSON.stringify(a.el), store0 = localStorage.getItem('gt.custom');
      const x = __gt.updateCustom(a, { name: 'Off broken', el: bad });
      const refused = { ok: x.ok, code: x.errors && x.errors[0].code, sgp4: x.errors && x.errors[0].sgp4, same: before === a.l1 + a.name + JSON.stringify(a.el), store: store0 === localStorage.getItem('gt.custom'), screen: __gt.D.entry === b };
      const y = __gt.updateCustom(a, { name: 'Off fine', el: good });
      return { refused, ok: y.ok, name: a.name, screen: __gt.D.entry === b, moved: y.windowMoved, stored: (JSON.parse(localStorage.getItem('gt.custom')) || { items: [] }).items.map(i => i.name) }; },
      [mkEl({ a: 6378.135 + 150, epoch: Date.now() - 30 * 86400000 }), mkEl({ i: 40 })]);
    chk('(n) editing an orbit that is NOT on screen refuses an element set SGP4 cannot load before anything is stored (the old one, the store and the screen stay)',
        !off.refused.ok && off.refused.code === 'err.sgp4' && off.refused.sgp4 > 0 && off.refused.same && off.refused.store && off.refused.screen, JSON.stringify(off.refused));
    chk('...and a good edit of it is stored without taking over the globe', off.ok && off.name === 'Off fine' && off.screen && off.moved === false && off.stored.join() === 'Off fine,Second', JSON.stringify(off.stored));
    chk('no request to any source, and no page error', reqs.length === 0 && errs.length === 0, reqs.join(' ') + (errs[0] || ''));
    await ctx.close();
  }
  lap('group 10');

  // ---- 11. the second layers of the network guard, called directly ----------------------------------------------------
  if (want(11)) {
    console.log('11. the second layers');
    const { ctx, page, errs, reqs } = await open(browser);
    reqs.length = 0;
    const ctl = await page.evaluate(() => __gt.fetchTLE('25544'));
    chk('control: fetchTLE of a real number does ask CelesTrak and the mirror (so the counter below can see a request); with both blocked it answers null',
        ctl === null && reqs.length >= 1, reqs.length + ' requests');
    reqs.length = 0;
    const odd = await page.evaluate(async () => { const out = [];
      for (const n of ['O0001', 'O1', '25544x', '123456', ' 25544', '', null, undefined, '25544\n', '2554 4']) out.push(await __gt.fetchTLE(n));
      return { out, keys: Object.keys(localStorage) }; });
    chk('(a) fetchTLE(\'O0001\') called directly returns null and requests nothing; so does anything else that is not one to five digits',
        odd.out.every(x => x === null) && reqs.length === 0 && !odd.keys.some(k => /^tle:/.test(k)), reqs.length + ' requests, keys ' + JSON.stringify(odd.keys));
    // runLife: the button that calls it is never made for a custom orbit, so only a direct call reaches the second layer
    reqs.length = 0;
    await page.evaluate(async () => { await __gt.runLife(__gt.D.entry, __gt.lifeReq); });
    chk('control: runLife for a catalogue spacecraft does ask for its decay history', reqs.length >= 1, reqs.length + ' requests');
    await add(page, 'No history');
    const before = await page.evaluate(() => document.getElementById('lifebig').textContent + '|' + document.getElementById('lifenote').textContent);
    reqs.length = 0;
    await page.evaluate(async () => { await __gt.runLife(__gt.D.entry, __gt.lifeReq); });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.getElementById('lifebig').textContent + '|' + document.getElementById('lifenote').textContent);
    chk('(a2) runLife called directly for a custom orbit requests nothing and leaves the Decay section as it was', reqs.length === 0 && after === before, reqs.length + ' requests; ' + after.slice(0, 40));
    // and the key the history cache would use is never written
    chk('...and no tle:/hist: key was ever written for the placeholder number', await page.evaluate(() => !Object.keys(localStorage).some(k => /O0001/.test(k))));
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 11');

  // ---- 12. Advisor.sunEci is the page's sunEci --------------------------------------------------------------------------
  if (want(12)) {
    console.log('12. sunEci');
    const { ctx, page, errs } = await open(browser);
    const r = await page.evaluate(() => {
      let seed = 123456789; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
      let bad = 0, n = 0, worst = '';
      for (let k = 0; k < 500; k++) {
        const ms = Math.floor(Date.UTC(2000, 0, 1) + rnd() * (Date.UTC(2056, 11, 31) - Date.UTC(2000, 0, 1)));   // whole ms: a Date cannot hold a fraction
        const a = __gt.sunEci(new Date(ms)), b = Advisor.sunEci(new Date(ms)), c = Advisor.sunEci(ms);
        n++;
        for (const key of ['ra', 'dec', 'distKm', 'x', 'y', 'z']) if (!(a[key] === b[key] && b[key] === c[key])) { bad++; worst = key + ' @ ' + ms; }
      }
      return { bad, n, worst };
    });
    chk('(c) Advisor.sunEci equals the page\'s sunEci exactly (every field, Date and number argument) on 500 random dates from 2000 to 2056', r.bad === 0 && r.n === 500, r.bad + ' differ ' + r.worst);
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 12');

  // ---- 13. two tabs: the storage event ------------------------------------------------------------------------------------
  if (want(13)) {
    console.log('13. two tabs');
    const init = `window.__ev = 0; window.addEventListener('gt-customs-changed', function(){ window.__ev++; });`;
    const A = await open(browser, { init });
    const B = await open(browser, { reuse: A.ctx });
    const ev = p => p.evaluate(() => window.__ev);
    await add(A.page, 'From A');
    await B.page.waitForFunction(() => __gt.CUSTOM.length === 1, null, { timeout: 15000 }).catch(() => {});
    const b1 = await B.page.evaluate(() => ({ name: __gt.CUSTOM[0].name, cid: __gt.CUSTOM[0].cid, shown: __gt.D.entry.name, count: document.getElementById('satcount').textContent,
      l1: __gt.CUSTOM[0].l1, saved: document.querySelectorAll('#pl-saved-list li').length }));
    const a1 = await A.page.evaluate(() => ({ l1: __gt.CUSTOM[0].l1, ev: window.__ev }));
    chk('(b) a second tab picks up an orbit the first one added: the same two lines, the count, the saved list; its own screen is untouched',
        b1.name === 'From A' && b1.cid === 'c1' && b1.l1 === a1.l1 && b1.shown === 'KNACKSAT-2' && b1.count === '2,158 + 1 of yours' && b1.saved === 1, JSON.stringify(b1).slice(0, 120));
    chk('(g) ...and the merge fires gt-customs-changed once in the tab that took it, as the add did in the tab that made it', (await ev(B.page)) === 1 && a1.ev === 1, (await ev(B.page)) + ' / ' + a1.ev);
    // the second tab makes an orbit of its own
    const rb = await add(B.page, 'From B');
    await A.page.waitForFunction(() => __gt.CUSTOM.length === 2, null, { timeout: 15000 }).catch(() => {});
    const a2 = await A.page.evaluate(() => ({ names: __gt.CUSTOM.map(c => c.name), shown: __gt.D.entry.name, cids: __gt.CUSTOM.map(c => c.cid) }));
    chk('...and back: the first tab takes the second one\'s orbit with a fresh number (c2, the counter was raised by the merge) and never touches the orbit on its screen',
        rb.ok && rb.entry.cid === 'c2' && a2.names.join() === 'From A,From B' && a2.shown === 'From A', JSON.stringify(a2));
    // the first tab deletes the orbit the second one is showing: the second one keeps it (last writer wins, adds never removes)
    await pick(B.page, 'from a', () => __gt.D.entry.name === 'From A');
    await A.page.evaluate(() => __gt.removeCustom(__gt.CUSTOM[0]));
    await B.page.waitForTimeout(600);
    const b3 = await B.page.evaluate(() => ({ n: __gt.CUSTOM.length, shown: __gt.D.entry.name, still: __gt.CUSTOM.some(c => c === __gt.D.entry) }));
    chk('the merge adds and never removes: an orbit deleted in one tab stays in the other, above all the one on its screen (last writer wins, as the README says)',
        b3.n === 2 && b3.shown === 'From A' && b3.still, JSON.stringify(b3));
    chk('no page error in either tab', A.errs.length === 0 && B.errs.length === 0, A.errs.concat(B.errs).join(' | ') || 'none');
    await A.ctx.close();
  }
  lap('group 13');

  // ---- 14. gt-customs-changed fires once per mutation, and not for a refusal ---------------------------------------------------------
  if (want(14)) {
    console.log('14. events');
    const init = `window.__ev = 0; window.addEventListener('gt-customs-changed', function(){ window.__ev++; });`;
    const { ctx, page, errs } = await open(browser, { init });
    const ev = () => page.evaluate(() => window.__ev);
    const step = async (label, fn, want) => { const b = await ev(); await fn(); const a = await ev(); chk('(g) ' + label + ': ' + want + ' event' + (want === 1 ? '' : 's'), a - b === want, (a - b) + ' fired'); };
    await step('add', () => add(page, 'One'), 1);
    await step('update (on screen)', () => page.evaluate(([el]) => __gt.updateCustom(__gt.CUSTOM[0], { name: 'One b', el }), [mkEl({ i: 60 })]), 1);
    await step('add with show:false', () => add(page, 'Two', {}, { show: false }), 1);
    await step('update (off screen)', () => page.evaluate(([el]) => __gt.updateCustom(__gt.CUSTOM[1], { name: 'Two b', el }), [mkEl({ i: 61 })]), 1);
    await step('remove (off screen)', () => page.evaluate(() => __gt.removeCustom(__gt.CUSTOM[1])), 1);
    await step('remove (on screen, falls back first)', () => page.evaluate(() => __gt.removeCustom(__gt.D.entry)), 1);
    await step('a refused add (invalid)', () => add(page, 'Bad', { e: 1.5 }), 0);
    await step('a refused add (SGP4 cannot load it)', () => add(page, 'Bad', { a: 6378.135 + 200, e: 0, epoch: HOUR - 730 * 86400000 }), 0);
    await add(page, 'Keep');
    await step('a refused update', () => page.evaluate(([el]) => __gt.updateCustom(__gt.CUSTOM[0], { name: 'x', el }), [mkEl({ e: 1.5 })]), 0);
    await step('removing something that is not in the list', () => page.evaluate(() => __gt.removeCustom({})), 0);
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
    // restore at boot
    const GOODEL = { a: 6978.135, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: Date.UTC(2026, 9, 1), am: 0.0043 };
    const seed = `try{localStorage.setItem('gt.custom', ${JSON.stringify(JSON.stringify({ v: 1, next: 3, items: [{ id: 'c1', name: 'Kept', made: 1, el: GOODEL }, { id: 'c2', name: 'Kept 2', made: 1, el: GOODEL }] }))});}catch(e){}`;
    const R = await open(browser, { init: init + seed });
    const rr = await R.page.evaluate(() => ({ ev: window.__ev, n: __gt.CUSTOM.length, names: __gt.CUSTOM.map(c => c.name), saved: document.querySelectorAll('#pl-saved-list li').length, count: document.getElementById('satcount').textContent }));
    chk('(g) restoring the saved orbits at boot fires it once for the whole list, and the saved list (built by init, after) shows both',
        rr.ev === 1 && rr.n === 2 && rr.saved === 2 && rr.count === '2,158 + 2 of yours', JSON.stringify(rr));
    chk('no page error', R.errs.length === 0, R.errs.join(' | ') || 'none');
    await R.ctx.close();
  }
  lap('group 14');

  // ---- 15. a module missing, a planner that throws: the console must still open, and the saved orbits must not be lost ----------------
  const GOODEL = { a: 6978.135, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: Date.UTC(2026, 9, 1), am: 0.0043 };
  const SEED = JSON.stringify({ v: 1, next: 2, items: [{ id: 'c1', name: 'Kept', made: 1, el: GOODEL }] });
  const seedInit = `try{localStorage.setItem('gt.custom', ${JSON.stringify(SEED)});}catch(e){}`;
  if (want(15)) {
    console.log('15. isolation at boot');
    // (h) each of the five modules in turn: the planner is off, the stored record is neither listed nor touched, nothing throws
    for (const mod of ['lifetime', 'planner', 'advisor', 'advisor-copy', 'plannerui']) {
      const { ctx, page, errs } = await open(browser, { init: seedInit, settle: 200,
        route: [['**/earth/' + mod + '.js', r => r.fulfill({ contentType: 'text/javascript', body: '/* ' + mod + ' withheld by the test */' })]] });
      const f = await page.evaluate(seed => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'gt.custom', newValue: seed, storageArea: localStorage }));
        const pill = document.getElementById('planopen');
        return { n: __gt.CUSTOM.length, store: localStorage.getItem('gt.custom'), pill: getComputedStyle(pill).display, planner: document.getElementById('planner').hidden,
          on: !!(window.PlannerUI && PlannerUI.enabled && PlannerUI.enabled()), name: __gt.D.entry.name, count: document.getElementById('satcount').textContent,
          add: __gt.addCustom({ name: 'x', el: { a: 6978, e: 0.001, i: 98, raan: 0, argp: 0, M: 0, epoch: Date.now(), am: 0.0043 } }),
          chip: getComputedStyle(document.getElementById('customchip')).display };
      }, SEED);
      chk('(h) with earth/' + mod + '.js missing the planner is off: no saved orbit listed, the record untouched, the pill and drawer hidden, the console open, no page error',
          f.n === 0 && f.store === SEED && f.pill === 'none' && f.planner && !f.on && f.name === 'KNACKSAT-2' && f.count === '2,158 spacecraft' && f.add.ok === false && f.chip === 'none' && errs.length === 0,
          JSON.stringify([f.n, f.store === SEED, f.pill, f.on, f.add.ok, f.add.errors && f.add.errors[0].code]) + (errs.length ? ' ERR ' + errs[0] : ''));
      await ctx.close();
    }
    // (i) a planner that throws while rebuilding a stored orbit
    const planSrc = fs.readFileSync(path.join(SITE, 'earth', 'planner.js'), 'utf8');
    const boom = planSrc + '\n;(function(){ var P = window.Planner; window.Planner = Object.assign({}, P, { toTLE: function(){ throw new Error("planner fault (test)"); } }); })();\n';
    const { ctx, page, errs } = await open(browser, { init: seedInit,
      route: [['**/earth/planner.js', r => r.fulfill({ contentType: 'text/javascript', body: boom })]] });
    const g = await page.evaluate(() => ({ n: __gt.CUSTOM.length, store: localStorage.getItem('gt.custom'), name: __gt.D.entry.name, count: document.getElementById('satcount').textContent,
      pill: !document.getElementById('planopen').hidden, add: (() => { try { return __gt.addCustom({ name: 'x', el: { a: 6978, e: 0.001, i: 98, raan: 0, argp: 0, M: 0, epoch: Date.now(), am: 0.0043 } }); } catch (e) { return { threw: String(e) }; } })() }));
    chk('(i) a Planner.toTLE that throws, with a saved orbit: zero page errors, no custom orbit, the console loaded, and the saved record not rewritten without the orbit it could not rebuild',
        g.n === 0 && g.store === SEED && g.name === 'KNACKSAT-2' && g.count === '2,158 spacecraft' && errs.length === 0, JSON.stringify([g.n, g.store === SEED, g.name, g.count]) + (errs[0] ? ' ERR ' + errs[0] : ''));
    chk('...and an Add then is refused as an answer (err.sgp4), never thrown into the page', g.add && g.add.ok === false && g.add.errors[0].code === 'err.sgp4' && !g.add.threw, JSON.stringify(g.add).slice(0, 100));
    await ctx.close();
    // a decayed catalogue object (hp < 0) loaded with the planner up and a saved orbit listed: no error anywhere
    const { ctx: c2, page: p2, errs: e2 } = await open(browser, { init: seedInit });
    const dead = await p2.evaluate(() => { for (const c of __gt.CAT) { try { const E = __gt.elements(c.l1, c.l2); if (E.perigeeAlt < 0) return { name: c.name, satnum: c.satnum, hp: E.perigeeAlt }; } catch (e) { /* next */ } } return null; });
    chk('(o) the catalogue holds an object whose mean perigee is under the ground (the case Advisor.context was written to survive)', !!dead && dead.hp < 0, JSON.stringify(dead));
    if (dead) {
      await pick(p2, dead.satnum, () => document.getElementById('satname').textContent.length > 0);
      await p2.waitForTimeout(800);
      await p2.evaluate(() => { __planner.open({ from: 'api' }); __planner.flush(); });
      const o = await p2.evaluate(() => ({ shown: __gt.D.entry.name, note: document.getElementById('loadnote').hidden ? '' : document.getElementById('loadnote').textContent, open: !document.getElementById('planner').hidden }));
      chk('(o) loading it (or being told it cannot be loaded), with the planner open and a saved orbit listed, gives zero page errors and a loaded console',
          e2.length === 0 && o.open && o.shown.length > 0, o.shown + (o.note ? ' | ' + o.note.slice(0, 60) : '') + (e2[0] ? ' ERR ' + e2[0] : ''));
    }
    await c2.close();
  }
  lap('group 15');

  // ---- 16. the refusals of addCustom: nothing kept, nothing disturbed ------------------------------------------------------------------
  if (want(16)) {
    console.log('16. refusals');
    const { ctx, page, errs } = await open(browser);
    const snap = () => page.evaluate(() => ({ shown: __gt.D.entry.name, start: __gt.D.start.getTime(), hours: __gt.D.hours, n: __gt.CUSTOM.length, store: localStorage.getItem('gt.custom'),
      note: document.getElementById('loadnote').hidden ? '' : document.getElementById('loadnote').textContent, picker: document.getElementById('satsearch').value }));
    const s0 = await snap();
    // (j) a 200 km orbit whose epoch is two years before the window: SGP4 has decayed it by then
    const j = await page.evaluate(([ws, el]) => __gt.addCustom({ name: 'Decayed', el: Object.assign({}, el, { epoch: ws - 730 * 86400000 }) }), [s0.start, mkEl({ a: 6378.135 + 200, e: 0.0001, i: 51.6, raan: 10, argp: 0 })]);
    const s1 = await snap();
    chk('(j) an Add of a 200 km circular orbit with an epoch 730 days before the window is refused with err.sgp4, sgp4 === 1, and a sentence from the page',
        j.ok === false && j.errors.length === 1 && j.errors[0].code === 'err.sgp4' && j.errors[0].sgp4 === 1 && /Decayed cannot be propagated anywhere in this window \(error 1/.test(j.errors[0].msg), JSON.stringify(j.errors).slice(0, 140));
    chk('...#loadnote stays empty (a failed Add is the planner\'s message), D.entry, the window, the span, the picker and the store are unchanged, and nothing was kept',
        s1.note === '' && s1.shown === s0.shown && s1.start === s0.start && s1.hours === s0.hours && s1.picker === s0.picker && s1.n === 0 && s1.store === null, JSON.stringify(s1).slice(0, 120));
    const jn = await add(page, 'After the failure');
    chk('...and the counter was given back: the next orbit is still c1 / O0001', jn.ok && jn.entry.cid === 'c1' && jn.entry.satnum === 'O0001', jn.entry && jn.entry.cid);
    await page.evaluate(() => __gt.removeCustom(__gt.CUSTOM[0]));
    // (e) every refusal has the same shape; the 13th orbit is refused with err.cap
    const bads = [
      ['an empty name', { name: '', el: mkEl() }], ['a name of only punctuation', { name: '---', el: mkEl() }], ['no elements', { name: 'x' }],
      ['elements that are not an object', { name: 'x', el: 'abc' }], ['a NaN', { name: 'x', el: mkEl({ a: NaN }) }], ['e 1.5', { name: 'x', el: mkEl({ e: 1.5 }) }],
      ['i 181', { name: 'x', el: mkEl({ i: 181 }) }], ['a perigee underground', { name: 'x', el: mkEl({ a: 6000, e: 0.05 }) }],
      ['an epoch in 1990', { name: 'x', el: mkEl({ epoch: Date.UTC(1990, 0, 1) }) }], ['am 11', { name: 'x', el: mkEl({ am: 11 }) }],
      ['a drag the B* cannot hold (am 5 at 300 km)', { name: 'x', el: mkEl({ a: 6378.135 + 300, am: 5 }) }], ['a name that is a number', { name: 12345, el: mkEl() }]
    ];
    const shapes = await page.evaluate(b => b.map(([label, input]) => { let r; try { r = __gt.addCustom(input); } catch (e) { return { label, threw: String(e) }; }
      return { label, ok: r.ok, shape: Array.isArray(r.errors) && r.errors.length > 0 && r.errors.every(e => typeof e.field === 'string' && typeof e.code === 'string' && typeof e.msg === 'string' && e.msg.length > 0), codes: (r.errors || []).map(e => e.code) }; }), bads);
    chk('(e) every refusal through addCustom carries {field, code, msg} in errors[] and none throws',
        shapes.every(x => !x.threw && x.ok === false && x.shape), shapes.map(x => x.label.slice(0, 12) + ':' + (x.codes || x.threw)).join(' '));
    chk('...nothing was kept by any of them', (await snap()).n === 0);
    let cap = null;
    for (let k = 1; k <= 13; k++) cap = await add(page, 'Cap ' + k, { i: 20 + k });
    const sc = await snap();
    chk('(e) the 13th addCustom returns {ok:false, errors:[{code:\'err.cap\', cap:12}]} and keeps nothing: twelve orbits, the twelfth still on screen',
        cap.ok === false && cap.errors.length === 1 && cap.errors[0].code === 'err.cap' && cap.errors[0].cap === 12 && cap.errors[0].field === '' && sc.n === 12 && sc.shown === 'Cap 12' && JSON.parse(sc.store).items.length === 12, JSON.stringify(cap.errors));
    chk('...the count reads "2,158 + 12 of yours"', await page.evaluate(() => document.getElementById('satcount').textContent === '2,158 + 12 of yours'));
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 16');

  // ---- 17. numbers, places and the clock: what Undo and a hidden Add rely on --------------------------------------------------------------
  if (want(17)) {
    console.log('17. numbers, places and the clock');
    const { ctx, page, errs } = await open(browser);
    await add(page, 'Aa'); await add(page, 'Bb', { i: 53 }); await add(page, 'Cc', { i: 28.5 });      // c1, c2, c3; Cc on screen
    const Bel = mkEl({ i: 53 });
    const clockText = () => page.evaluate(() => document.getElementById('tpclock').textContent);
    // scrub the clock to a time of the reader's own and pause it, so "the reader's instant" is a text that does not tick
    await page.evaluate(() => { const r = document.getElementById('time'); r.value = 700; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const clock0 = await clockText();
    const was = await page.evaluate(() => ({ B: __gt.indexOf(__gt.CUSTOM[1]), satnum: __gt.CUSTOM[1].satnum, on: __gt.D.entry.name, dObj: null }));
    const gone = await page.evaluate(() => __gt.removeCustom(__gt.CUSTOM[1]));
    const mid = await page.evaluate(() => ({ names: __gt.CUSTOM.map(c => c.name), onIdx: __gt.indexOf(__gt.D.entry), on: __gt.D.entry.name }));
    // (d) + (k): the same number and the same place back, and the screen and the clock are not taken over
    const back = await page.evaluate(([el, at]) => { const D0 = __gt.D, E0 = __gt.D.entry;
      const r = __gt.addCustom({ name: 'Bb', el, cid: 'c2', at, show: false });
      return { ok: r.ok, cid: r.entry && r.entry.cid, satnum: r.entry && r.entry.satnum, tle: r.entry && r.entry.l1.substring(2, 7), at: __gt.CUSTOM.indexOf(r.entry), idx: __gt.indexOf(r.entry),
        sameD: __gt.D === D0, sameEntry: __gt.D.entry === E0, onIdx: __gt.indexOf(__gt.D.entry), picker: document.getElementById('satsearch').value, names: __gt.CUSTOM.map(c => c.name),
        count: document.getElementById('satcount').textContent, saved: (JSON.parse(localStorage.getItem('gt.custom')) || { items: [] }).items.map(i => i.id + ':' + i.name) }; }, [Bel, 1]);
    chk('(d) removing an orbit and adding it back with its cid and its place hands back the same number (O0002), the same list index and the same picker index',
        gone === true && was.B === 2159 && was.satnum === 'O0002' && back.ok && back.cid === 'c2' && back.satnum === 'O0002' && back.tle === 'O0002' && back.at === 1 && back.idx === 2159 &&
        back.names.join() === 'Aa,Bb,Cc' && back.saved.join() === 'c1:Aa,c2:Bb,c3:Cc', JSON.stringify([was, back.cid, back.satnum, back.at, back.idx, back.saved]));
    chk('(k) ...with show:false the orbit on screen, the analysis object, the picker and the count are untouched, and the on-screen orbit\'s picker index follows the splice (2159 with Bb gone, 2160 with it back at its place)',
        mid.onIdx === 2159 && back.sameD && back.sameEntry && back.onIdx === 2160 && back.picker === 'Cc' && back.count === '2,158 + 3 of yours', JSON.stringify([mid.onIdx, back.sameD, back.sameEntry, back.onIdx, back.picker, back.count]));
    chk('(k) ...and the reader\'s instant on the clock is kept (a hidden Add never takes the clock)', (await clockText()) === clock0, clock0 + ' -> ' + await clockText());
    // curIdx is private: the next reload of the console (a span change) shows whether it still points at the orbit on screen
    await page.click('.bar-window .span[data-h="72"]');
    await page.waitForFunction(() => __gt.D.hours === 72, null, { timeout: 15000 }).catch(() => {});
    const after = await page.evaluate(() => ({ on: __gt.D.entry.name, idx: __gt.indexOf(__gt.D.entry) }));
    chk('(k) ...and curIdx was recomputed after the splice: the next reload is still the orbit on screen, not whatever sits at the old index', after.on === 'Cc' && after.idx === 2160, JSON.stringify(after));
    // a cid already in use, a malformed cid and an out-of-range place are not trusted: a fresh number, appended
    const odd = await page.evaluate(([el]) => ['c2', 'c0', 'x1', 'c01', 'c10000', 7, null].map((cid, k) => { const r = __gt.addCustom({ name: 'Odd ' + k, el, cid, at: k % 2 ? 99 : -1, show: false });
      return { ok: r.ok, cid: r.entry && r.entry.cid, last: __gt.CUSTOM[__gt.CUSTOM.length - 1] === r.entry }; }), [Bel]);
    chk('(d) ...a cid that is in use or malformed, and a place out of range, are not trusted: a fresh number from the counter (c4, c5, ...), at the end of the list',
        odd.every(r => r.ok && r.last) && odd.map(r => r.cid).join() === 'c4,c5,c6,c7,c8,c9,c10', odd.map(r => r.cid).join());
    await page.evaluate(() => { while (__gt.CUSTOM.length > 3) __gt.removeCustom(__gt.CUSTOM[__gt.CUSTOM.length - 1]); });
    // the orbit ON screen goes and comes back (Undo of a delete): reloaded, with its own number and its place
    const und = await page.evaluate(([el]) => { const C = __gt.CUSTOM[2], at = __gt.CUSTOM.indexOf(C), name = C.name, cid = C.cid;
      const rm = __gt.removeCustom(C), shownAfter = __gt.D.entry.name;
      const r = __gt.addCustom({ name, el, cid, at });
      return { rm, shownAfter, ok: r.ok, cid: r.entry.cid, satnum: r.entry.satnum, at: __gt.CUSTOM.indexOf(r.entry), onScreen: __gt.D.entry === r.entry, picker: document.getElementById('satsearch').value }; }, [mkEl({ i: 28.5 })]);
    chk('(d) Undo of the orbit that was on screen: it left for a catalogue spacecraft, and comes back loaded with its own number and place',
        und.rm === true && !/^Cc$/.test(und.shownAfter) && und.ok && und.cid === 'c3' && und.satnum === 'O0003' && und.at === 2 && und.onScreen && und.picker === 'Cc', JSON.stringify(und));
    // a successful Add clears a console note that was there before (a trial load does not clear one by itself)
    await pick(page, '26702', () => !document.getElementById('loadnote').hidden);
    const note0 = await page.evaluate(() => ({ hidden: document.getElementById('loadnote').hidden, text: document.getElementById('loadnote').textContent.slice(0, 40) }));
    await add(page, 'Clears the note');
    const note1 = await page.evaluate(() => ({ hidden: document.getElementById('loadnote').hidden, text: document.getElementById('loadnote').textContent }));
    chk('a successful Add clears the console\'s note from an earlier refused pick (control: the note was there)', note0.hidden === false && /ODIN/.test(note0.text) && note1.hidden === true && note1.text === '', JSON.stringify([note0, note1]));
    // D23: a programmatic Add takes a catalogue name and numbers a duplicate among the reader's own (24 code points kept)
    const nm = await page.evaluate(([el]) => { const long24 = 'ABCDEFGHIJKLMNOPQRSTUVWX';
      return ['Dup', 'dup', 'ISS (ZARYA)', long24, long24].map(n => { const r = __gt.addCustom({ name: n, el, show: false }); return r.ok ? r.entry.name : r.errors[0].code; }); }, [mkEl()]);
    chk('(D23) names: a duplicate among the reader\'s own is numbered (case-insensitive), a catalogue name is accepted programmatically, and the number never pushes a name past 24 code points',
        nm.join('|') === 'Dup|dup (2)|ISS (ZARYA)|ABCDEFGHIJKLMNOPQRSTUVWX|ABCDEFGHIJKLMNOPQRST (2)' && nm.every(n => Array.from(n).length <= 24), nm.join('|'));
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 17');

  // ---- 18. the counter: a stored c9999, and a list that was emptied ----------------------------------------------------------------------
  if (want(18)) {
    console.log('18. the counter');
    // (l) a store holding c9999 means every number is used: next is 10000, an Add is refused, nothing is duplicated, and the refusal is not undone by deleting it
    const GE = { a: 6978.135, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: Date.UTC(2026, 9, 1), am: 0.0043 };
    for (const next of [9999, 99999]) {
      const seed = `try{localStorage.setItem('gt.custom', ${JSON.stringify(JSON.stringify({ v: 1, next, items: [{ id: 'c9999', name: 'Last one', made: 1, el: GE }] }))});}catch(e){}`;
      const { ctx, page, errs } = await open(browser, { init: seed });
      const r = await page.evaluate(([el, GE]) => { const out = { n: __gt.CUSTOM.length, cid: __gt.CUSTOM[0] && __gt.CUSTOM[0].cid, satnum: __gt.CUSTOM[0] && __gt.CUSTOM[0].satnum };
        out.add = __gt.addCustom({ name: 'One more', el });
        out.afterAdd = { n: __gt.CUSTOM.length, store: JSON.parse(localStorage.getItem('gt.custom')) };
        // an edit saves the counter: it is the way to read what the page holds in customNext
        out.upd = __gt.updateCustom(__gt.CUSTOM[0], { name: 'Last one', el: Object.assign({}, GE, { i: 60 }) });
        out.next = (JSON.parse(localStorage.getItem('gt.custom')) || {}).next;
        out.rm = __gt.removeCustom(__gt.CUSTOM[0]);
        out.emptied = JSON.parse(localStorage.getItem('gt.custom'));
        out.again = __gt.addCustom({ name: 'Never wraps', el });
        out.count = document.getElementById('satcount').textContent;
        return out; }, [mkEl(), GE]);
      chk('(l) a stored c9999 (next ' + next + ') is restored as c9999 / O9999, the next Add is refused with planner.full and the sentence, and nothing is duplicated or kept',
          r.n === 1 && r.cid === 'c9999' && r.satnum === 'O9999' && r.add.ok === false && r.add.errors.length === 1 && r.add.errors[0].code === 'planner.full' && r.add.errors[0].field === '' &&
          /used every orbit number/.test(r.add.errors[0].msg) && r.afterAdd.n === 1 && !!r.afterAdd.store && r.afterAdd.store.items.length === 1, JSON.stringify(r.add.errors) + ' n=' + r.afterAdd.n);
      chk('(l) ...the counter the page holds is 10000 (an edit writes it), deleting c9999 keeps it (the list is empty, next 10000) and the number is never handed out again',
          r.upd.ok && r.next === 10000 && r.rm === true && !!r.emptied && r.emptied.next === 10000 && r.emptied.items.length === 0 && r.again.ok === false && r.again.errors[0].code === 'planner.full' && r.count === '2,158 spacecraft',
          JSON.stringify([r.next, r.emptied, r.again.ok, r.count]));
      chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
      await ctx.close();
    }
    // (m) two orbits added and both deleted: the store keeps the counter, and after a reload the next orbit is c3 / O0003
    {
      const { ctx, page, errs } = await open(browser);
      await add(page, 'First'); await add(page, 'Second');
      await page.evaluate(() => { while (__gt.CUSTOM.length) __gt.removeCustom(__gt.CUSTOM[0]); });
      const stored = await page.evaluate(() => localStorage.getItem('gt.custom'));
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 40000 }); await page.waitForTimeout(500);
      const n0 = await page.evaluate(() => ({ n: __gt.CUSTOM.length, count: document.getElementById('satcount').textContent, keys: Object.keys(localStorage) }));
      const r3 = await add(page, 'Third');
      chk('(m) two orbits added and both deleted: the saved record is {"v":1,"next":3,"items":[]}, a reload lists nothing and writes nothing new, and the next orbit is c3 / O0003',
          stored === '{"v":1,"next":3,"items":[]}' && n0.n === 0 && n0.count === '2,158 spacecraft' && r3.ok && r3.entry.cid === 'c3' && r3.entry.satnum === 'O0003' && r3.entry.l1.substring(2, 7) === 'O0003', stored + ' / ' + n0.count + ' / ' + (r3.entry && r3.entry.cid));
      chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
      await ctx.close();
    }
  }
  lap('group 18');

  // ---- 19. a name with no Latin letter in it, and every request, not only the two sources ------------------------------------------------------
  if (want(19)) {
    console.log('19. non-Latin names and all requests');
    const { ctx, page, errs } = await open(browser, { ctx: { locale: 'th-TH' } });
    const all = [];
    page.on('request', r => { if (!/^(data|blob):/.test(r.url())) all.push(r.method() + ' ' + r.url()); });
    const r = await add(page, 'ดาวเทียม');
    await page.waitForTimeout(800);
    const n = await page.evaluate(() => __gt.D.passes.length);
    const nm = await page.evaluate(() => ({ name: __gt.D.entry.name, masthead: document.getElementById('satname').textContent }));
    chk('a name made of non-Latin letters is kept (the cleaner keeps letters of every script)', r.ok && nm.name === 'ดาวเทียม' && nm.masthead === 'ดาวเทียม', JSON.stringify(nm));
    if (n) {
      const csv = await grab(page, 'exp-csv'), ics = await grab(page, 'exp-ics');
      const rows = csv.text.trim().split(/\r?\n/), h = rows[0].split(','), c1 = rows[1].split(',');
      chk('...its exports still get a valid file name: the stem falls back to "orbit" (passes-custom-orbit-bangkok-DATE.csv / .ics), not passes--bangkok',
          /^passes-custom-orbit-bangkok-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name) && /^passes-custom-orbit-bangkok\.ics$/.test(ics.name) && /^passes-custom-.+-.+-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name + ' | ' + ics.name);
      chk('...and the name itself is in the file, with the mark', c1[h.indexOf('satellite')] === 'ดาวเทียม (custom orbit)' && /SUMMARY:\[custom orbit\] ดาวเทียม/.test(ics.text.replace(/\r\n /g, '')), c1[h.indexOf('satellite')]);
    }
    // every request the page makes while an orbit is added and while the 30 s re-check runs: none at all (not only none to CelesTrak)
    all.length = 0;
    // control: a request the page makes on purpose (blocked by the route, but still a request) is seen by this counter
    await page.evaluate(() => fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE').catch(() => null));
    const seen = all.length;
    all.length = 0;
    await add(page, 'No traffic');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1500);
    chk('control: a fetch the page makes on purpose is counted by this listener (so "zero" below can be told from "not listening")', seen >= 1, seen + ' seen');
    chk('adding an orbit, and the re-check that follows, make ZERO requests of any kind (any host, any method)', all.length === 0, all.join(' ') || 'none');
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 19');

  // ---- 20. every way the console reloads itself keeps a custom orbit on screen ----------------------------------------------------------------
  // (these used to read CAT[curIdx], which is undefined for a custom orbit: load(undefined) threw on the next click)
  if (want(20)) {
    console.log('20. reload paths and the window note');
    const { ctx, page, errs } = await open(browser);
    const nav = async (sel, what) => { const s0 = await page.evaluate(() => __gt.D.start.getTime()); await page.click(sel);
      await page.waitForFunction(s => __gt.D.start.getTime() !== s, s0, { timeout: 15000 }).catch(() => {}); return what; };
    const note = () => page.evaluate(() => { const n = document.getElementById('winnote'); return { text: n.textContent, warn: n.classList.contains('warn'), who: __gt.D.entry.name }; });
    // control: for a catalogue spacecraft four days from its epoch the note is the warning about real element sets
    await page.click('#tpepoch'); await page.waitForTimeout(400);
    for (let k = 0; k < 4; k++) await nav('#winPrevD');
    const cat = await note();
    chk('control: four days from the epoch a catalogue spacecraft is told "SGP4 drifts this far out", as a warning', /^-4\.0 d from epoch — SGP4 drifts this far out$/.test(cat.text) && cat.warn, cat.who + ': ' + cat.text + ' warn=' + cat.warn);
    await add(page, 'Stays', {}, { show: true });
    await page.click('#tpepoch'); await page.waitForTimeout(400);
    const at0 = await note();
    for (let k = 0; k < 4; k++) await nav('#winPrevD');
    const cus = await note();
    chk('the same four days from a designed orbit\'s epoch are not a warning: it says M belongs to the epoch, and the "SGP4 drifts" sentence is not used',
        /^window starts at the epoch$/.test(at0.text) && /^-4\.0 d from epoch — M belongs to the epoch$/.test(cus.text) && !cus.warn && cus.who === 'Stays', at0.text + ' | ' + cus.text + ' warn=' + cus.warn);
    // setWindow: the buttons that move the window all reload through entryAt(curIdx)
    await nav('#winNextD');
    await page.click('#tpnow'); await page.waitForTimeout(600);
    await page.click('#tpepoch'); await page.waitForTimeout(600);
    const w = await page.evaluate(() => ({ name: __gt.D.entry.name, custom: !!__gt.D.entry.custom, picker: document.getElementById('satsearch').value, atEpoch: __gt.D.start.getTime() === __gt.D.E.epoch.getTime() }));
    chk('the window buttons (a day on, Now, Epoch) reload the custom orbit, not undefined, and the picker still names it', w.name === 'Stays' && w.custom && w.picker === 'Stays' && w.atEpoch && errs.length === 0, JSON.stringify(w) + ' ' + (errs[0] || ''));
    // siteChanged: the whole analysis is site-dependent
    await page.click('#siteopen'); await page.click('#s-manual > summary');
    await page.fill('#s-name', 'Quito'); await page.fill('#s-lat', '-0.18'); await page.fill('#s-lon', '-78.47'); await page.fill('#s-alt', '2.85'); await page.fill('#s-tz', '-5');
    await page.click('#siteapply');
    await page.waitForFunction(() => __gt.OBS.name === 'Quito', null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const sc = await page.evaluate(() => ({ name: __gt.D.entry.name, custom: !!__gt.D.entry.custom, site: __gt.OBS.name, picker: document.getElementById('satsearch').value, cust: __gt.CUSTOM.length }));
    chk('moving the observer reloads the custom orbit for the new site (siteChanged), and nothing throws', sc.name === 'Stays' && sc.custom && sc.site === 'Quito' && sc.picker === 'Stays' && errs.length === 0, JSON.stringify(sc) + ' ' + (errs[0] || ''));
    // rollWindow: play past the end of the window
    const roll = await page.evaluate(async () => {
      const r = document.getElementById('time'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true }));
      const rate = document.getElementById('tprate'); rate.value = 100; rate.dispatchEvent(new Event('input', { bubbles: true }));
      if (document.getElementById('tpplay').getAttribute('aria-label') === 'Play') document.getElementById('tpplay').click();
      const s0 = __gt.D.start.getTime();
      const t0 = Date.now();
      while (Date.now() - t0 < 12000 && __gt.D.start.getTime() === s0) await new Promise(r => setTimeout(r, 100));
      return { moved: __gt.D.start.getTime() !== s0, name: __gt.D.entry.name, custom: !!__gt.D.entry.custom };
    });
    chk('playing past the end of the window rolls it on (rollWindow) and the custom orbit is still the one on screen', roll.moved && roll.name === 'Stays' && roll.custom && errs.length === 0, JSON.stringify(roll) + ' ' + (errs[0] || ''));
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 20');

  // ---- 21. deep-space orbits and the window (D39): SDP4 costs a second a month of distance from the epoch ---------------------------------------
  if (want(21)) {
    console.log('21. deep-space orbits far from the window');
    const { ctx, page, errs } = await open(browser);
    const ws = await page.evaluate(() => __gt.D.start.getTime());
    const MOL = { a: 26554.137, e: 0.74, i: 63.4, raan: 10, argp: 270, M: 0, am: 0.0043 }, GEO = { a: 42164.182, e: 0.0002, i: 0.05, raan: 0, argp: 0, M: 0, am: 0.0043 };
    // Add: the window goes to the epoch when a deep-space orbit's epoch is more than 10 days away
    for (const [label, el] of [['Molniya', MOL], ['GEO', GEO]]) {
      const r = await page.evaluate(([n, el, ws]) => { const e = Object.assign({}, el, { epoch: ws - 365 * 864e5 }); const t = performance.now(), x = __gt.addCustom({ name: n, el: e });
        return { ms: performance.now() - t, ok: x.ok, moved: x.windowMoved, start: __gt.D.start.getTime(), epoch: e.epoch, note: document.getElementById('winnote').textContent, errors: x.errors }; }, [label + ' far', el, ws]);
      chk('(D39) Add of a ' + label + ' with its epoch a year before the window: the window moves to the epoch (windowMoved), and the Add is fast (' + Math.round(r.ms) + ' ms; unguarded it is seconds)',
          r.ok && r.moved === true && r.start === r.epoch && r.ms < 4000 && /window starts at the epoch/.test(r.note), JSON.stringify({ ok: r.ok, moved: r.moved, same: r.start === r.epoch, ms: Math.round(r.ms), note: r.note, e: r.errors && r.errors[0] && r.errors[0].code }));
      await page.evaluate(([w]) => { __gt.removeCustom(__gt.CUSTOM[__gt.CUSTOM.length - 1]); }, [ws]);
      await page.click('#tpnow'); await page.waitForTimeout(500);
    }
    // within 10 days of the window the window stays; a near-Earth orbit never moves it, however old its epoch
    const near = await page.evaluate(([el, ws]) => { const x = __gt.addCustom({ name: 'Molniya near', el: Object.assign({}, el, { epoch: ws - 5 * 864e5 }) }); return { ok: x.ok, moved: x.windowMoved, same: __gt.D.start.getTime() === ws }; }, [MOL, await page.evaluate(() => __gt.D.start.getTime())]);
    chk('(D39) a deep-space orbit whose epoch is only 5 days from the window leaves the window alone', near.ok && near.moved === false && near.same, JSON.stringify(near));
    await page.evaluate(() => __gt.removeCustom(__gt.D.entry));
    const leo = await page.evaluate(([el, ws]) => { const x = __gt.addCustom({ name: 'LEO old', el: Object.assign({ a: 6978.135, e: 0.001, i: 97.8, raan: 0, argp: 0, M: 0, am: 0.0043 }, { epoch: ws - 200 * 864e5 }) });
      return { ok: x.ok, moved: x.windowMoved, same: __gt.D.start.getTime() === ws, code: x.errors && x.errors[0].code }; }, [MOL, await page.evaluate(() => __gt.D.start.getTime())]);
    chk('(D39) a near-Earth orbit never moves the window, however old its epoch', leo.ok && leo.moved === false && leo.same, JSON.stringify(leo));
    await page.evaluate(() => { while (__gt.CUSTOM.length) __gt.removeCustom(__gt.CUSTOM[0]); });
    await page.click('#tpnow'); await page.waitForTimeout(500);
    // choosing a saved deep-space orbit from the picker: load() moves the window on a change of spacecraft
    const ws2 = await page.evaluate(() => __gt.D.start.getTime());
    await page.evaluate(([el, ws]) => __gt.addCustom({ name: 'Saved far', el: Object.assign({}, el, { epoch: ws - 60 * 864e5 }), show: false }), [MOL, ws2]);
    const t0 = Date.now();
    await pick(page, 'saved far', () => __gt.D.entry.name === 'Saved far');
    const ch = await page.evaluate(([ws]) => ({ moved: __gt.D.start.getTime() !== ws, atEpoch: __gt.D.start.getTime() === __gt.D.entry.el.epoch }), [ws2]);
    chk('(D39) choosing a saved deep-space orbit whose epoch is 60 days off from the picker moves the window to its epoch', ch.moved && ch.atEpoch && Date.now() - t0 < 12000, JSON.stringify(ch) + ' ' + (Date.now() - t0) + ' ms');
    // an edit of the orbit on screen into a far deep-space one: the window goes to the new epoch, and says so
    await page.evaluate(() => { while (__gt.CUSTOM.length) __gt.removeCustom(__gt.CUSTOM[0]); });
    await page.click('#tpnow'); await page.waitForTimeout(500);
    const up = await page.evaluate(([el, ws]) => { const x = __gt.addCustom({ name: 'To edit', el: { a: 6978.135, e: 0.001, i: 97.8, raan: 0, argp: 0, M: 0, am: 0.0043, epoch: ws } });
      const E = x.entry, far = Object.assign({}, el, { epoch: ws - 365 * 864e5 }), t = performance.now(), y = __gt.updateCustom(E, { name: 'To edit', el: far });
      return { ok: y.ok, moved: y.windowMoved, atEpoch: __gt.D.start.getTime() === far.epoch, ms: performance.now() - t, same: __gt.D.entry === E }; }, [MOL, await page.evaluate(() => __gt.D.start.getTime())]);
    chk('(D39) Update of the orbit on screen into a deep-space one a year from the window moves the window to the epoch, in place, quickly', up.ok && up.moved === true && up.atEpoch && up.same && up.ms < 4000, JSON.stringify(up));
    // the Professor's trial pass skips what would take seconds, and answers exactly where it is cheap (host.trial, D39)
    const tr = await page.evaluate(([el]) => { const ws = __gt.D.start.getTime();
      __planner.open({ from: 'api' });
      const form = e => ({ shape: 'ae', a: el.a, e: el.e, inc: el.i, argp: el.argp, raan: el.raan, ma: 0, epoch: new Date(e).toISOString().slice(0, 19), name: 'Probe' });
      __planner.setModel(form(ws - 365 * 864e5)); const t0 = performance.now(); __planner.flush(); const far = { measured: __planner.result().measured, ms: performance.now() - t0, ok: __planner.result().ok };
      __planner.setModel(form(ws - 864e5)); __planner.flush(); const nearr = { measured: __planner.result().measured, ok: __planner.result().ok };
      __planner.close(); return { far, nearr }; }, [MOL]);
    chk('(D39) the Professor\'s trial pass for a deep-space draft a year from the window is skipped without computing (measured null, quick), and runs when the epoch is a day away',
        tr.far.ok && tr.far.measured === null && tr.far.ms < 1500 && tr.nearr.ok && tr.nearr.measured && tr.nearr.measured.n >= 0 && Number.isFinite(tr.nearr.measured.totalS), JSON.stringify([tr.far.measured, Math.round(tr.far.ms), tr.nearr.measured && tr.nearr.measured.n]));
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 21');

  // ---- 22. what the planner is handed: the host's window, observer and trial pass are the page's own ---------------------------------------------
  if (want(22)) {
    console.log('22. the host the planner is given');
    const { ctx, page, errs } = await open(browser, { init: HOSTSPY });
    await add(page, 'Host probe');
    await add(page, 'Host other', { i: 40 }, { show: false });
    const hs = await page.evaluate(() => { const H = window.__host, e = __gt.D.entry, cat = __gt.CAT[0];
      const o = { keys: Object.keys(H).sort().join(), init: window.__initCalls, sawD: window.__initSawD };
      o.mask = typeof H.mask === 'number' && H.mask === __gt.MASK; o.pinned = H.pinned === false;
      o.obs = H.obs() === __gt.OBS; o.now = Math.abs(H.now() - Date.now()) < 2000; o.sat = !!H.sat && typeof H.sat.twoline2satrec === 'function';
      o.cat = H.catalogue() === __gt.CAT; o.customs = H.customs() === __gt.CUSTOM; o.cur = H.current() === __gt.D;
      o.win = H.window().startMs === __gt.D.start.getTime() && H.window().hours === __gt.D.hours;
      o.ops = H.add === __gt.addCustom && H.update === __gt.updateCustom && H.remove === __gt.removeCustom;
      o.tle = JSON.stringify(H.entryTle(e)) === JSON.stringify({ l1: e.l1, l2: e.l2 }); o.tracked = H.tracked(cat) === true && H.tracked(e) === false;
      const other = __gt.CUSTOM.find(c => c.name === 'Host other'); H.show(other); o.show = __gt.D.entry === other;
      H.show(e); o.back = __gt.D.entry === e;
      return o; });
    chk('PlannerUI.init is called exactly once, AFTER the boot load (the analysis exists), with a host of exactly the members of SPEC 6.8',
        hs.init === 1 && hs.sawD === true && hs.keys === 'add,catalogue,current,customs,entryTle,mask,now,obs,pinned,remove,sat,show,storageOk,tracked,trial,update,window', JSON.stringify([hs.init, hs.sawD, hs.keys]));
    chk('...and every member is the page\'s own: obs() is the live OBS, mask the MASK, catalogue()/customs()/current() the arrays and analysis, window() the window on screen, add/update/remove the page functions, show() loads, tracked() is false for a custom orbit, entryTle() its two lines',
        hs.mask && hs.pinned && hs.obs && hs.now && hs.sat && hs.cat && hs.customs && hs.cur && hs.win && hs.ops && hs.tle && hs.tracked && hs.show && hs.back, JSON.stringify(hs));
    await page.evaluate(() => { window.__si = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('blocked', 'SecurityError'); }; });
    const blocked = await add(page, 'Unsaved', {}, { show: false });
    const so1 = await page.evaluate(() => __host.storageOk());
    await page.evaluate(() => { Storage.prototype.setItem = window.__si; });
    const fine = await add(page, 'Saved again', {}, { show: false });
    const so2 = await page.evaluate(() => __host.storageOk());
    chk('...storageOk() is the result of the last save: false while storage refuses, true once it works again (the planner shows err.storage from it)', blocked.ok && blocked.saved === false && so1 === false && fine.ok && fine.saved === true && so2 === true, JSON.stringify([blocked.saved, so1, fine.saved, so2]));
    await page.evaluate(() => { while (__gt.CUSTOM.length > 2) __gt.removeCustom(__gt.CUSTOM[__gt.CUSTOM.length - 1]); });
    const meas = () => page.evaluate(() => { const e = __gt.D.entry; __planner.open({ from: 'chip', entry: e }); __planner.flush(); const m = __planner.result().measured, D = __gt.D;
      return { m, n: D.passes.length, totalS: D.totalS, longest: D.passes.reduce((x, p) => Math.max(x, p.dur), 0), best: D.passes.reduce((x, p) => Math.max(x, p.maxEl), 0), alt0: D.E.perigeeAlt, alt1: D.E.apogeeAlt,
        surf: D.E.surfMax - D.E.surfMin, r: D.E.rMax - D.E.rMin, reentry: !!D.reentry, from: __planner.result().from }; });
    const agree = r => !!r.m && r.m.n === r.n && Math.abs(r.m.totalS - r.totalS) < 1 && Math.abs(r.m.longestS - r.longest) < 1 && Math.abs(r.m.bestEl - r.best) < 0.05 &&
      Math.abs(r.m.altMin - r.alt0) < 0.05 && Math.abs(r.m.altMax - r.alt1) < 0.05 && Math.abs(r.m.surfSwing - r.surf) < 0.05 && Math.abs(r.m.rSwing - r.r) < 0.05 && r.m.reentry === r.reentry;
    const r1 = await meas();
    chk('the Professor\'s measured numbers for the orbit on screen (passes, time in view, best elevation, altitudes, swings) are the console\'s own to display precision', agree(r1), JSON.stringify(r1.m) + ' vs ' + r1.n + ' passes');
    await page.evaluate(() => __planner.close());
    // the window and span the host reports follow the page's: after a span change the trial pass is over the new window
    await page.click('.bar-window .span[data-h="72"]');
    await page.waitForFunction(() => __gt.D.hours === 72, null, { timeout: 15000 }).catch(() => {});
    const r2 = await meas();
    chk('...and after the span button (3 d) the host window is the new one: the numbers again equal the console\'s', agree(r2) && r2.n >= r1.n && r2.totalS > r1.totalS, r2.n + ' passes in 72 h against ' + r1.n + ' in 24 h');
    await page.evaluate(() => __planner.close());
    // the observer: the same trial from another place agrees with the console at that place
    await page.click('#siteopen'); await page.click('#s-manual > summary');
    await page.fill('#s-name', 'Hobart'); await page.fill('#s-lat', '-42.88'); await page.fill('#s-lon', '147.33'); await page.fill('#s-alt', '0.05'); await page.fill('#s-tz', '10');
    await page.click('#siteapply');
    await page.waitForFunction(() => __gt.OBS.name === 'Hobart', null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const r3 = await meas();
    chk('...and after the observer moves the host observer is the new one: the numbers equal the console\'s at Hobart, and differ from Bangkok\'s', agree(r3) && r3.n !== r2.n || (agree(r3) && Math.abs(r3.totalS - r2.totalS) > 1), r3.n + ' passes, ' + r3.totalS.toFixed(0) + ' s at Hobart; ' + r2.n + ', ' + r2.totalS.toFixed(0) + ' at Bangkok');
    await page.evaluate(() => __planner.close());
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 22');

  // ---- 23. the picker offers the planner only when there is one ---------------------------------------------------------------------------------
  if (want(23)) {
    console.log('23. the picker with the planner off, and group rows only on an empty query');
    const rows = async page => { await page.click('#satsearch'); const r = await page.evaluate(() => ({ plan: document.querySelectorAll('#satlist li.plan').length, cu: document.querySelectorAll('#satlist li.cu').length, grp: document.querySelectorAll('#satlist li.grp').length,
        n: document.querySelectorAll('#satlist li[data-idx]').length, planId: !!document.getElementById('soptplan') })); await page.keyboard.press('Escape'); return r; };
    for (const mod of ['lifetime', 'planner', 'advisor', 'advisor-copy', 'plannerui']) {
      const { ctx, page, errs } = await open(browser, { init: seedInit, settle: 200,
        route: [['**/earth/' + mod + '.js', r => r.fulfill({ contentType: 'text/javascript', body: '/* ' + mod + ' withheld by the test */' })]] });
      const r = await rows(page);
      chk('(h) with earth/' + mod + '.js missing the picker is the catalogue it was: no Plan row, no custom row, no group rows', r.plan === 0 && r.cu === 0 && r.grp === 0 && !r.planId && r.n > 50 && errs.length === 0, JSON.stringify(r) + (errs[0] ? ' ERR ' + errs[0] : ''));
      await ctx.close();
    }
    {
      const { ctx, page, errs } = await open(browser, { search: '?tle=embedded', init: seedInit, settle: 200 });
      const r = await rows(page);
      chk('?tle=embedded: the picker has no Plan row (the pill says why), and no custom row for the saved orbit it does not list', r.plan === 0 && r.cu === 0 && r.grp === 0 && errs.length === 0, JSON.stringify(r));
      await ctx.close();
    }
    {
      const { ctx, page, errs } = await open(browser);
      await add(page, 'Zqx alpha'); await add(page, 'Zqx bravo');
      await page.click('#satsearch');
      const empty = await page.evaluate(() => ({ grp: document.querySelectorAll('#satlist li.grp').length, plan: document.querySelectorAll('#satlist li.plan').length, last: document.querySelector('#satlist').lastElementChild.className }));
      await page.fill('#satsearch', 'zqx');
      const typed = await page.evaluate(() => ({ grp: document.querySelectorAll('#satlist li.grp').length, cu: document.querySelectorAll('#satlist li.cu').length, plan: document.querySelectorAll('#satlist li.plan').length,
        first: [...document.querySelectorAll('#satlist li[data-idx] .nm')].slice(0, 2).map(n => n.textContent) }));
      chk('the group rows ("Your orbits", "Catalogue") are for the empty query only; a typed query lists its hits with the customs first, tagged, and the Plan row last',
          empty.grp === 2 && empty.plan === 1 && typed.grp === 0 && typed.cu >= 2 && typed.plan === 1 && typed.first.join() === 'Zqx alpha,Zqx bravo', JSON.stringify([empty, typed]));
      await page.keyboard.press('Escape');
      chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
      await ctx.close();
    }
  }
  lap('group 23');

  // ---- 24. load() hands every finished analysis to the planner, last, and a fault in the planner never fails a load ---------------------------------------------
  if (want(24)) {
    console.log('24. PlannerUI.onLoad');
    const { ctx, page, errs } = await open(browser, { init: HOSTSPY });
    const logged = [];
    page.on('console', m => { if (m.type() === 'error') logged.push(m.text()); });
    await page.evaluate(() => { window.__calls = []; const o = PlannerUI.onLoad;
      PlannerUI.onLoad = function (d) { window.__calls.push({ same: d === __gt.D, name: d && d.entry && d.entry.name, hours: d && d.hours, masthead: document.getElementById('satname').textContent }); return o.apply(this, arguments); }; });
    await page.click('.bar-window .span[data-h="6"]');
    await page.waitForFunction(() => __gt.D.hours === 6, null, { timeout: 15000 }).catch(() => {});
    await add(page, 'Seen by the planner');
    const calls = await page.evaluate(() => window.__calls.slice());
    chk('load() calls PlannerUI.onLoad with the analysis it just made: once for the span change (6 h) and once for the Add, each time the same object as __gt.D, with the masthead already painted',
        calls.length === 2 && calls[0].same && calls[0].hours === 6 && calls[1].same && calls[1].name === 'Seen by the planner' && calls[1].masthead === 'Seen by the planner', JSON.stringify(calls));
    await page.evaluate(() => { PlannerUI.onLoad = function () { throw new Error('planner fault (test)'); }; });
    await page.click('.bar-window .span[data-h="72"]');
    await page.waitForFunction(() => __gt.D.hours === 72, null, { timeout: 15000 }).catch(() => {});
    const f = await page.evaluate(() => ({ hours: __gt.D.hours, name: __gt.D.entry.name, note: document.getElementById('loadnote').hidden }));
    chk('a PlannerUI.onLoad that throws never fails the load: the 72 h analysis of the custom orbit is on screen, no page error, the fault is logged',
        f.hours === 72 && f.name === 'Seen by the planner' && f.note === true && errs.length === 0 && logged.some(t => /planner fault/.test(t)), JSON.stringify(f) + ' ' + (errs[0] || '') + ' logged ' + logged.length);
    chk('no page error', errs.length === 0, errs.join(' | ') || 'none');
    await ctx.close();
  }
  lap('group 24');

  /*__NEXT__*/

  await browser.close();
  srv.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS') + (allErrs.length ? '   PAGE ERRORS: ' + allErrs.length + ' ' + allErrs.slice(0, 3).join(' | ') : '   no page errors'));
  process.exit(fails || allErrs.length ? 1 : 0);
})().catch(async e => {
  console.log(e instanceof FailFast ? '\nFIRST FAILURE (CUSTOM_FAILFAST): ' + e.message : '\nSUITE CRASHED: ' + (e && e.stack || e));
  try { if (browserRef) await browserRef.close(); } catch (_) { /* already gone */ }
  try { if (srvRef) srvRef.close(); } catch (_) { /* already closed */ }
  process.exit(1);
});
