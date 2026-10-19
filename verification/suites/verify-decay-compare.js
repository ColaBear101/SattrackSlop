/*
 * verify-decay-compare.js - the decay comparison (CHANGES-FROM-LEGACY.md, L66), in a browser, with CelesTrak faked per spacecraft.
 *
 * Under the Decay section's own chart a disclosure, "Compare with other spacecraft", opens a panel with a chart of its own: the
 * spacecraft the reader lists, the selected one first in the page's cyan, up to seven more in colours of their own and the rest in
 * grey. What it promises, and what this drives the page to see:
 *
 *  - Nothing is asked for unless the reader presses something that says so. A fresh visit fetches neither the comparison's chunk
 *    nor any history, and stores nothing; opening the panel asks CelesTrak for nothing; reading the list back after a reload draws
 *    what the 12-hour cache holds and leaves the rest waiting for Fetch, with no request; a planned orbit and ?tle=embedded ask
 *    for nothing either.
 *  - One request at a time, never two at once, and seven at most for any one press. Adding a spacecraft asks for its history once
 *    (the selected spacecraft's own request first, when the section has not estimated it: the same request its Estimate button
 *    makes); "Add watched" with 10 watched asks for 7 and leaves 3 waiting; with 20, for the selected one and 6 more, and "Fetch 7
 *    more" then "Fetch the rest (7)" for the others; a double-click on either is one press. A request cannot be called back: a row
 *    removed while its request is out lets it finish (the answer still fills the cache), the next request waits for it, and the row
 *    listed again meanwhile joins it. A listed spacecraft picked as the selected one while its request is out says so on its row,
 *    and the section's own Estimate then shares that request (the page's one history source). With 49 listed, "Add watched" adds
 *    the one that fits and goes.
 *  - The chart: its name counts what is drawn, its key names the selected one first and the coloured ones by colour, and each line
 *    is drawn in its row's colour (pixels of that exact colour on the canvas); a colour freed is gone from the canvas; the readout
 *    under the pointer lists the coloured lines' values, highest first, inside the chart; the chart is not redrawn while a request's
 *    seconds tick.
 *  - The list: a highlight past seven is refused and says why, on its row too; a freed colour goes to the next highlight as the
 *    lowest free one and nobody else's colour moves; the keyboard keeps its focus through a row that moves, a removed row and a
 *    toolbar button that goes; a double-click on a row's Remove removes that row alone; Clear takes two presses, and a second within
 *    0.6 s is the rest of a double-click; a failure says so with Try again named for its spacecraft.
 *  - The chart's view (L67): Range (Auto, 30 d, 90 d, 1 y, All; a group of pressed buttons the arrow keys move along) and Show (the
 *    seven quantities) redraw it once each, name it, caption it with the quantity, its unit and its dates, and are kept in the record
 *    only when not the default, with no request; each range spans what it says, and each quantity reads in its own unit and agrees
 *    with the others (perigee below the mean altitude below apogee, period times mean motion a day); a reload keeps the range and the
 *    quantity and no zoom; a drag across the plot (8 px or more) or a double-click zooms inside the range, Escape or a short press does
 *    not, and Reset zoom or a press of the range goes back; the reading has a dot on each coloured line; the slider under the plot
 *    starts on the newest element set (never past it), reads it from the keyboard with each line's full name, and zooms with plus and
 *    minus; on a phone a tap pins the reading at the top of the plot, a sideways finger moves it, a tap elsewhere or Escape lets it go
 *    (a tap on the slider does not), a double tap zooms nothing, and a vertical swipe still scrolls the page.
 *  - Its markup keeps out of the selectors the golden prose reads, so the default report reads as it always did.
 *  - A phone: no sideways scroll, text 12 px and up, 44 px targets; a chunk that does not come says so, and to reload.
 *
 * The histories are made up per catalogue number (lib/decay-compare-seed.js); the route counts CelesTrak's requests per number and
 * the most in flight at once (the harness answers /api/** with 503, which trips the page's breaker, so every history comes from
 * the direct fetch this fakes), can fail one number on demand, and can hold one number's answer until the suite lets it go.
 * Timing-sensitive (the 0.6 s of Clear, a held request's seconds): run.js runs it alone.
 *
 *   npm run build && node verification/suites/verify-decay-compare.js        (npm run decay-compare)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness');
const S = require('../lib/decay-compare-seed');
const { chromium } = H.playwright();

if (H.targetName() !== 'new' && !process.env.GT_URL) {
  console.error('verify-decay-compare checks the rebuilt page (the old page had no comparison): GT_TARGET=new');
  process.exit(2);
}

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- the spacecraft and their made-up histories ----------------------------------------------------------------------------- */
const SEL = '67683';                                            // KNACKSAT-2, the page's default spacecraft
const ADD = ['25544', '48274', '20580', '62637', '42841', '27844', '41603'];
const NAMES = { 67683: 'KNACKSAT-2', 25544: 'ISS (ZARYA)', 48274: 'CSS (TIANHE-1)', 20580: 'HST', 62637: 'FLOCK 4G 24', 42841: 'LEMUR 2 PETERG',
  27844: 'CUTE-1', 41603: 'LAPAN A3', 39444: 'FUNCUBE 1', 43159: 'JILIN-01-07', 54023: 'OTB-3-GAZELLE', 29055: 'ASTRA 1KR' };
const FAILING = '39444';                                        // FUNCUBE 1: answered 503 while the suite says so
const X = '43159', Y = '54023', Z = '29055';                    // the held request, the one queued behind it, the one dropped
const WATCHED = ['40298', '43152', '54029', '29055', '54020', '54021', '54026', '54027', '43159', '54023'];
/* [from, to, endAgo, days]: distinct last heights, so every dot is where its own line ends */
const CURVES = {
  67683: [420, 359, 2, 221], 25544: [421, 414, 1, 400], 48274: [392, 380, 1, 300], 20580: [522, 505, 1, 600], 62637: [470, 405, 1, 260],
  42841: [330, 228, 1, 221], 27844: [640, 636, 1, 500], 41603: [505, 470, 1, 400]
};
const curve = n => CURVES[+n] || [380 + (+n % 160), 380 + (+n % 160) - 8 - (+n % 30), 1, 260];
/* each spacecraft's eccentricity, rising by half along its history: 0.0006 to 0.0024, so the eccentricity and perigee views (L67)
   draw lines that differ (modulo 11: the five that part 11 draws get five different ones), and far under the Decay section's
   "eccentric" mark (0.02), so no verdict and no other check moves; the selected spacecraft's is 0.0006 as before */
const ECC = n => 0.0006 + (+n % 11) * 0.0001;
const body = n => { const c = curve(n); return S.plot(S.falling(Date.now(), u => ECC(n) * (1 + 0.5 * u), c[2], c[0], c[1], c[3])); };
/* the light theme's colours for slots 2..8 (draw-compare.ts CMP_PALETTE.light) */
const LIGHT = ['#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const DELAY = 200;                                              // each answer takes this long: two at once would overlap

/* catalogue numbers for a 20-strong watchlist: the ten above and ten more the suite uses nowhere else */
function catalogue() {
  const t = fs.readFileSync(path.join(H.ROOT, 'data', 'catalogue.txt'), 'utf8').split(/\r?\n/), all = [];
  for (let i = 0; i + 2 < t.length; i += 3) all.push(t[i + 1].slice(2, 7).trim());
  return all;
}
const USED = new Set([SEL, ...ADD, FAILING, X, Y, Z, ...WATCHED, '43786', '52444', '60543', '59069']);
const WATCHED20 = WATCHED.concat(catalogue().filter(n => !USED.has(n) && /^\d{5}$/.test(n)).filter((n, i) => i % 100 === 50).slice(0, 10));

/* ---- the fake CelesTrak --------------------------------------------------------------------------------------------------------- */
async function fake(page) {
  const net = { req: {}, order: [], inflight: 0, max: 0, failing: new Set(), hold: new Map(), arrived: new Set() };
  await page.route('**celestrak.org/**', async r => {
    const u = new URL(r.request().url());
    if (!/graph-orbit-data/.test(u.pathname)) return r.abort().catch(() => {});
    const n = u.searchParams.get('CATNR');
    net.req[n] = (net.req[n] || 0) + 1;
    net.order.push(n);
    net.inflight++; net.max = Math.max(net.max, net.inflight);
    try {
      const h = net.hold.get(n);
      if (h) { net.arrived.add(n); await h.p; net.hold.delete(n); }
      await sleep(DELAY);
    } finally { net.inflight--; }
    const ok = !net.failing.has(n);
    await r.fulfill(ok ? { status: 200, contentType: 'text/html', body: body(n) } : { status: 503, contentType: 'text/html', body: 'busy' }).catch(() => {});
  });
  /* hold one number's answer until release() */
  net.holdNext = n => { let release; const p = new Promise(res => { release = res; }); net.hold.set(n, { p, release }); return () => release(); };
  net.total = () => Object.values(net.req).reduce((a, b) => a + b, 0);
  return net;
}

/* ---- a page --------------------------------------------------------------------------------------------------------------------- */
const allErrs = [];
async function open(browser, srv, o) {
  o = o || {};
  const phone = !!o.phone;
  const ctx = await browser.newContext({ viewport: o.vp || { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone });
  const seed = Object.assign({}, o.seed || {});
  if (o.theme) seed['gt.prefs'] = JSON.stringify({ theme: o.theme });
  /* written once: a reload reads what the page itself wrote since */
  if (Object.keys(seed).length) await ctx.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const k of Object.keys(s)) localStorage.setItem(k, s[k]);
  }, seed);
  /* how many times the comparison's chart has been drawn (draw-compare clears the canvas once per drawing) */
  await ctx.addInitScript(() => {
    const c = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...a) {
      if (this.canvas && this.canvas.id === 'cmpcv') window.__cmpDraws = (window.__cmpDraws || 0) + 1;
      return c.apply(this, a);
    };
  });
  const page = await ctx.newPage();
  const label = o.label || 'page';
  page.on('pageerror', e => allErrs.push(label + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) allErrs.push(label + ': console: ' + m.text()); });
  const net = await fake(page);
  const chunks = [];
  page.on('request', r => { const m = /\/assets\/(DecayCompare|decayed\.svelte)-[A-Za-z0-9_-]{8}\.js$/.exec(new URL(r.url()).pathname); if (m) chunks.push(m[1]); });
  await page.goto(o.url || srv.page, { waitUntil: 'load' });
  await ready(page);
  return { ctx, page, net, chunks };
}
const ready = page => page.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!document.getElementById('cmpopen'), null, { timeout: 30000 });
const toSection = async page => { await page.evaluate(() => document.getElementById('cmpopen').scrollIntoView({ block: 'center' })); await sleep(300); };

/* the list, as the page has it */
const rowText = (page, n) => page.evaluate(k => { const li = document.querySelector('#cmprows > li[data-n="' + k + '"]'); return li ? li.innerText.replace(/\s+/g, ' ').trim() : null; }, n);
const stText = (page, n) => page.evaluate(k => { const s = document.getElementById('cmpst-' + k); return s ? s.textContent.replace(/\s+/g, ' ').trim() : null; }, n);
const say = page => page.evaluate(() => document.getElementById('cmpsay').textContent);
const record = page => page.evaluate(() => localStorage.getItem('gt.decaycmp'));
const listed = async page => JSON.parse((await record(page)) || '{"l":[]}').l;
const slotIn = (l, n) => (l.find(i => i.n === n) || {}).h;
const pressed = page => page.evaluate(() => [...document.querySelectorAll('#cmprows button.tg')].map(b => (b.getAttribute('aria-pressed') === 'true' ? 'H' : 'g')).join(''));
const focusIs = (page, sel) => page.evaluate(s => !!document.activeElement && document.activeElement.matches(s), sel);
/* every row's request answered and its forecast worked out: k rows (the fold opened first when there is one) */
async function settled(page, k, ms) {
  if (k > 8) await page.evaluate(() => { const b = document.getElementById('cmpmore'); if (b && b.getAttribute('aria-expanded') === 'false') b.click(); });
  await page.waitForFunction(k => {
    const t = (document.getElementById('cmprows') || {}).innerText || '';
    return !/Queued|Fetching|Reading/.test(t) && document.querySelectorAll('#cmprows > li').length === k;
  }, k, { timeout: ms || 30000 });
  await sleep(150);
}
async function search(page) {
  if (!(await page.$('#cmpsearch'))) { await page.click('#cmpadd'); await page.waitForSelector('#cmpsearch', { state: 'visible' }); }
  /* the popover moves the focus into its field in the frame after it opens */
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'cmpsearch', null, { timeout: 5000 });
}
/* add these through the search (it stays open between adds), then shut it */
async function addBySearch(page, ns, keepOpen) {
  await search(page);
  for (const n of ns) { await page.fill('#cmpsearch', n); await sleep(40); await page.keyboard.press('Enter'); await sleep(80); }
  if (!keepOpen) { await page.keyboard.press('Escape'); await sleep(60); }
}
/* the canvas's opaque pixels within 3 of each colour, per colour */
const colourCounts = (page, colours) => page.evaluate(cs => {
  const cv = document.getElementById('cmpcv'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const t = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = c => { t.clearRect(0, 0, 1, 1); t.fillStyle = '#000'; t.fillStyle = c; t.fillRect(0, 0, 1, 1); return [...t.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
  const want = cs.map(rgb), n = cs.map(() => 0);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 250) continue;
    for (let k = 0; k < want.length; k++) {
      const w = want[k];
      if (Math.abs(d[i] - w[0]) <= 3 && Math.abs(d[i + 1] - w[1]) <= 3 && Math.abs(d[i + 2] - w[2]) <= 3) n[k]++;
    }
  }
  return n;
}, colours);
/* the colour each coloured row's swatch is drawn in, the selected one's first */
const rowColours = page => page.evaluate(() => [...document.querySelectorAll('#cmprows > li')]
  .filter(li => li.classList.contains('me') || li.querySelector('button.tg[aria-pressed="true"]'))
  .map(li => ({ n: li.dataset.n, c: getComputedStyle(li.querySelector('.tg')).getPropertyValue('--c').trim() })));
const opaque = page => page.evaluate(() => {
  const cv = document.getElementById('cmpcv'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n;
});
/* the readout under the pointer: its rows, whether it is inside the chart, and its crosshair */
const tipNow = page => page.evaluate(() => {
  const t = document.getElementById('cmptip'), c = document.getElementById('cmpcv').getBoundingClientRect();
  if (!t) return null;
  const a = t.getBoundingClientRect(), x = document.getElementById('cmpx').getBoundingClientRect();
  return { day: t.querySelector('p').textContent, rows: [...t.querySelectorAll('p')].slice(1).map(p => ({ v: parseFloat(p.textContent), name: p.querySelector('span').textContent })),
    inside: a.left >= c.left - 1 && a.right <= c.right + 1 && a.top >= c.top - 1 && a.bottom <= c.bottom + 1, cross: x.width <= 1.5 && x.top >= c.top && x.bottom <= c.bottom };
});
/* what is stored for the comparison and its histories, to seed the next pages with */
const keep = page => page.evaluate(() => {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^(hist:|gt\.decaycmp$)/.test(k)) o[k] = localStorage.getItem(k); }
  return o;
});
/* what golden.js reads in a report section (golden.js: per section and page-wide) */
const GOLDEN_SEC = 'h2, .hint, .eyebrow, th, figcaption, .passnote, .access dt, .life dt';
const GOLDEN_PAGE = '.legend .key, .legend li, .readout dt, .readouts dt';
/* what of those the section and the panel hold, and the panel's ids that do not start with cmp (part 1, and again in part 11) */
const goldenIn = page => page.evaluate(([a, b]) => {
  const sec = document.getElementById('sec-life'), p = document.getElementById('cmppanel');
  const ids = [...p.querySelectorAll('[id]')].map(e => e.id).concat(['cmpopen', 'cmpfail', 'cmppanel']).filter(id => !/^(cmp|copt-|pop-)/.test(id));
  return { sec: sec.querySelectorAll(a).length, page: p.querySelectorAll(b + ', dt, section, .legend, .hint, .eyebrow, h2, th, figcaption, .passnote').length, ids };
}, [GOLDEN_SEC, GOLDEN_PAGE]);
let golden0 = null;       // the section's count on a fresh visit, the panel shut (part 1)

async function part(name, fn) {
  console.log('\n' + name);
  try { await fn(); } catch (e) { chk(name + ': ran to the end', false, String(e && e.message || e).split('\n')[0]); }
}

(async () => {
  const srv = await H.up();
  const browser = await chromium.launch();
  let stored = {};          // the first page's record and histories, for the pages after it

  /* ---- 1. a reader's visit, 1280 x 900 light ----------------------------------------------------------------------------- */
  await part('1. a fresh visit, opened and used (1280 light)', async () => {
    const { ctx, page, net, chunks } = await open(browser, srv, { label: 'flow' });
    await toSection(page);
    await sleep(600);
    chk('fresh: the comparison\'s chunk is not fetched, even with the section in view', !chunks.includes('DecayCompare'), chunks.join(' ') || 'nothing');
    const kept0 = await page.evaluate(() => Object.keys(localStorage).filter(k => /^(hist:|gt\.decaycmp$)/.test(k)));
    chk('fresh: nothing of the comparison is stored (no record, no history) and CelesTrak is asked for nothing', !kept0.length && net.total() === 0,
      JSON.stringify(net.req) + ' ' + kept0.join(' '));
    const shut = await page.evaluate(() => {
      const b = document.getElementById('cmpopen'), s = document.getElementById('cmppanel');
      return { h3: !!b.closest('h3'), text: b.textContent, ex: b.getAttribute('aria-expanded'), ctl: b.getAttribute('aria-controls'), hidden: s.hidden, kids: s.children.length, fail: document.getElementById('cmpfail').textContent };
    });
    chk('the disclosure: a button in an h3, "Compare with other spacecraft", shut, its slot hidden and empty, no failure sentence',
      shut.h3 && shut.text === 'Compare with other spacecraft' && shut.ex === 'false' && shut.ctl === 'cmppanel' && shut.hidden && !shut.kids && shut.fail === '', JSON.stringify(shut));
    golden0 = await page.evaluate(([a]) => document.getElementById('sec-life').querySelectorAll(a).length, [GOLDEN_SEC]);

    await page.focus('#cmpopen');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cmpadd', { state: 'visible', timeout: 15000 });
    chk('a press opens the panel and the focus stays on the button', await page.evaluate(() =>
      document.getElementById('cmpopen').getAttribute('aria-expanded') === 'true' && document.activeElement.id === 'cmpopen' && !document.getElementById('cmppanel').hidden));
    chk('...its chunk came once, with no stylesheet of its own', chunks.filter(c => c === 'DecayCompare').length === 1 &&
      !(await page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].some(l => /DecayCompare/.test(l.href)))), chunks.join(' '));
    chk('...opening asks CelesTrak for nothing, and the record says open with an empty list', net.total() === 0 && (await record(page)) === '{"o":1,"l":[]}', await record(page));
    chk('...with nothing listed the chart is put away and the panel says why', await page.evaluate(() =>
      document.getElementById('cmpcv').hidden && /^Nothing to draw yet/.test(document.getElementById('cmpnone').textContent)));
    await page.keyboard.press('Enter');
    await sleep(120);
    chk('a second press shuts it (an empty list shut leaves nothing stored)', await page.evaluate(() =>
      document.getElementById('cmpopen').getAttribute('aria-expanded') === 'false' && document.getElementById('cmppanel').hidden && localStorage.getItem('gt.decaycmp') === null));
    await page.keyboard.press('Enter');
    await sleep(120);

    // ---- the search, by keyboard
    await page.click('#cmpadd');
    await page.waitForSelector('#cmpsearch', { state: 'visible' });
    await sleep(100);
    chk('Add spacecraft opens the search ("Add a spacecraft to compare") with the focus in its field', await page.evaluate(() =>
      document.activeElement.id === 'cmpsearch' && !!document.querySelector('[role=dialog][aria-label="Add a spacecraft to compare"]') &&
      document.activeElement.getAttribute('role') === 'combobox'));
    await page.keyboard.type('iss');
    await sleep(120);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#cmplist [role=option]')].slice(0, 4).map(o => o.id));
    chk('typing lists catalogue options, each keyed by its NORAD number', opts.length > 0 && opts.every(o => /^copt-\d{5}$/.test(o)), opts.join(' '));
    await page.keyboard.press('ArrowDown');
    chk('the arrow keys move the active option (aria-activedescendant, in the list the field controls)', await page.evaluate(() => {
      const s = document.getElementById('cmpsearch'), a = s.getAttribute('aria-activedescendant');
      return !!a && a === document.querySelectorAll('#cmplist [role=option]')[1].id && s.getAttribute('aria-controls') === 'cmplist';
    }));
    chk('opening the search asked for the picker\'s "decayed now" chunk', chunks.includes('decayed.svelte'), chunks.join(' '));

    /* the selected spacecraft has not been estimated: the first add asks for its history first, in the same queue. Its answer is
       held until every add is in, so the queue is seen in order */
    const letSel = net.holdNext(SEL);
    await page.fill('#cmpsearch', ADD[0]);
    await page.keyboard.press('Enter');
    await sleep(150);
    chk('Enter adds it, keeps the query and the search open, and says so there (not in the status line)', await page.evaluate(() =>
      document.getElementById('cmpsearch')?.value === '25544' && document.getElementById('cmpcount').textContent === 'Added ISS (ZARYA) · 1 in the comparison' &&
      document.getElementById('cmpsay').textContent === ''), await page.evaluate(() => document.getElementById('cmpcount')?.textContent));
    chk('...its option is marked "in the comparison" and aria-disabled', await page.evaluate(() => {
      const o = document.getElementById('copt-25544'); return o.getAttribute('aria-disabled') === 'true' && /in the comparison/.test(o.textContent);
    }));
    await page.keyboard.press('Enter');
    await sleep(100);
    chk('...and Enter on it again adds nothing', (await listed(page)).length === 1);
    for (const n of ADD.slice(1)) { await page.fill('#cmpsearch', n); await sleep(40); await page.keyboard.press('Enter'); await sleep(80); }
    await page.fill('#cmpsearch', SEL);
    await sleep(80);
    chk('the selected spacecraft\'s option is marked "selected" and aria-disabled', await page.evaluate(() => {
      const o = document.getElementById('copt-67683'); return !!o && o.getAttribute('aria-disabled') === 'true' && /selected/.test(o.textContent);
    }));
    await page.keyboard.press('Enter');
    await sleep(80);
    chk('...and is not added', (await listed(page)).length === 7 && !(await listed(page)).some(i => i.n === SEL));
    await page.keyboard.press('Escape');
    await sleep(100);
    chk('Escape shuts the search and gives the focus back to Add spacecraft', await page.evaluate(() => !document.getElementById('cmpsearch') && document.activeElement.id === 'cmpadd'));

    const q = await page.evaluate(ns => ns.map(n => ((document.getElementById('cmpst-' + n) || {}).textContent || '').trim()), ADD);
    chk('while the selected spacecraft\'s request is out, the rest wait in order (Queued, 1st ... 7th), and only it was asked for',
      q.join('|') === ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'].map(o => 'Queued, ' + o).join('|') && net.total() === 1 && net.req[SEL] === 1 && net.inflight === 1,
      q.join(' | ') + ' / ' + JSON.stringify(net.req));
    chk('...and the wait is said once, not per row', await page.evaluate(() =>
      (document.getElementById('cmppanel').innerText.match(/up to 75 seconds/g) || []).length === 1 && !!document.getElementById('cmpwait')));
    letSel();
    await settled(page, 8, 40000);
    chk('one request per spacecraft, the selected one\'s among them', [SEL, ...ADD].every(n => net.req[n] === 1) && Object.keys(net.req).length === 8, JSON.stringify(net.req));
    chk('never two CelesTrak requests at once', net.max === 1, 'max in flight ' + net.max);
    chk('the Decay section painted the selected spacecraft from that same request', await page.evaluate(() => /^\d{4}-\d{2}-\d{2}$/.test(document.getElementById('lifebig').textContent)),
      await page.evaluate(() => document.getElementById('lifebig').textContent));
    chk('the status line says what came in, once the queue is through', (await say(page)) === '8 fetched.', await say(page));
    chk('the waiting sentence goes with the wait', await page.evaluate(() => !document.getElementById('cmpwait')));

    // ---- the chart
    const name = await page.evaluate(() => document.getElementById('cmpcv').getAttribute('aria-label'));
    chk('the canvas is named for what it draws: 8 spacecraft (more than four, so not each by name)', name === 'Mean altitude history and projected decay of 8 spacecraft', name);
    const key = await page.evaluate(() => [...document.querySelectorAll('#cmpkey > span')].map(s => s.textContent));
    chk('the key: the selected one, the coloured ones by colour, then the two line styles',
      key.join('|') === ['KNACKSAT-2', ...ADD.map(n => NAMES[n]), 'observed', 'projected'].join('|'), key.join(' | '));
    const cols = await rowColours(page);
    const want = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--track').trim());
    chk('the rows\' swatches: the selected one in the page\'s --track, the seven in the palette\'s slots 2..8 in the order added',
      cols.length === 8 && cols[0].n === SEL && cols[0].c === want && cols.slice(1).map(c => c.c.toLowerCase()).join() === LIGHT.join(), JSON.stringify(cols));
    const px = await colourCounts(page, cols.map(c => c.c));
    chk('each of the eight lines is on the canvas in its row\'s colour', px.every(k => k >= 20), cols.map((c, i) => NAMES[c.n] + ' ' + px[i]).join(', '));
    const gold = await goldenIn(page);
    chk('the panel uses none of the selectors the golden prose reads, no dt and no section, and its ids start with cmp',
      gold.sec === golden0 && gold.page === 0 && !gold.ids.length, JSON.stringify(gold) + ' (section had ' + golden0 + ' before)');

    // ---- three turned off: grey context lines
    const n0 = net.total();
    for (const n of ['27844', '41603', '48274']) await page.click('#cmprows button.tg[aria-label="Highlight ' + NAMES[n] + '"]');
    await sleep(250);
    chk('three turned off: 4 in colour, then 3 grey, the coloured first', (await pressed(page)) === 'HHHHggg', await pressed(page));
    const key2 = await page.evaluate(() => [...document.querySelectorAll('#cmpkey > span')].map(s => s.textContent));
    chk('...the key says "3 others"', key2.join('|') === ['KNACKSAT-2', 'ISS (ZARYA)', 'HST', 'FLOCK 4G 24', 'LEMUR 2 PETERG', '3 others', 'observed', 'projected'].join('|'), key2.join(' | '));
    const freed = await colourCounts(page, [LIGHT[1], LIGHT[5], LIGHT[6]]), kept = await colourCounts(page, [LIGHT[0], LIGHT[2], LIGHT[3], LIGHT[4]]);
    chk('...their colours are gone from the canvas, the others\' are still there', freed.every(k => k <= 3) && kept.every(k => k >= 20), 'freed ' + freed.join('/') + ', kept ' + kept.join('/'));
    chk('...and none of it asked for anything', net.total() === n0);

    // ---- the readout under the pointer (the chart in view first: the clicks above scrolled to the rows)
    await page.evaluate(() => document.getElementById('cmpcv').scrollIntoView({ block: 'center' }));
    await sleep(150);
    const cv = await page.locator('#cmpcv').boundingBox();
    /* across the left half (the histories are there; the right holds only the longest projections): the fullest readout */
    let tip = null;
    for (let f = 0.02; f < 0.5; f += 0.02) {
      await page.mouse.move(cv.x + cv.width * f, cv.y + cv.height * 0.5);
      await sleep(60);
      const t = await tipNow(page);
      if (t && (!tip || t.rows.length > tip.rows.length)) tip = t;
    }
    const coloured = ['KNACKSAT-2', 'ISS (ZARYA)', 'HST', 'FLOCK 4G 24', 'LEMUR 2 PETERG'];
    chk('hover: the day, then the coloured lines\' values, highest first, only coloured ones, inside the chart, with a crosshair',
      !!tip && /^\d{4}-\d{2}-\d{2}$/.test(tip.day) && tip.rows.length >= 4 && tip.rows.every(r => coloured.includes(r.name)) && tip.inside && tip.cross &&
      tip.rows.every((r, i, a) => !i || a[i - 1].v >= r.v), JSON.stringify(tip));
    for (const [x, y] of [[cv.width - 33, 16], [cv.width - 33, cv.height - 28], [49, 16], [49, cv.height - 28]]) {
      await page.mouse.move(cv.x + x, cv.y + y);
      await sleep(120);
      const t = await tipNow(page);
      chk('hover just inside a corner of the plot (' + Math.round(x) + ', ' + Math.round(y) + '): the readout stays inside the chart', !!t && t.inside && t.cross, JSON.stringify(t));
    }
    await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height + 80);
    await sleep(100);
    chk('...and goes with the pointer', await page.evaluate(() => !document.getElementById('cmptip') && !document.getElementById('cmpx')));

    // ---- Tab shuts the search
    await search(page);
    await page.keyboard.press('Tab');
    await sleep(100);
    chk('Tab shuts the search', await page.evaluate(() => !document.getElementById('cmpsearch')));

    // ---- remove, and where the focus goes
    const order = await page.evaluate(() => [...document.querySelectorAll('#cmprows [data-rm]')].map(b => b.dataset.rm));
    await page.focus('#cmprows [data-rm="' + order[1] + '"]');
    await page.keyboard.press('Enter');
    await sleep(150);
    const l1 = await listed(page);
    chk('remove: the focus goes to the next row\'s Remove, it is said, and the colour it had is free while the others keep theirs',
      (await focusIs(page, '[data-rm="' + order[2] + '"]')) && (await say(page)) === 'Removed ' + NAMES[order[1]] + ' · 6 in the comparison' &&
      !l1.some(i => i.n === order[1]) && slotIn(l1, '25544') === 2 && slotIn(l1, '62637') === 5 && slotIn(l1, '42841') === 6 && !l1.some(i => i.h === 4),
      order.join(',') + ' / ' + (await say(page)) + ' / ' + JSON.stringify(l1));
    await page.focus('#cmprows [data-rm="' + order[order.length - 1] + '"]');
    await page.keyboard.press('Enter');
    await sleep(150);
    chk('remove the last row: the focus goes to the row before', await focusIs(page, '[data-rm="' + order[order.length - 2] + '"]'));

    // ---- Clear, in two presses
    await page.focus('#cmpclear');
    await page.keyboard.press('Enter');
    await sleep(60);
    const armed = await page.evaluate(() => ({ say: document.getElementById('cmpsay').textContent, by: document.getElementById('cmpclear').getAttribute('aria-describedby') }));
    chk('Clear, first press: it says what a second press does, and describes the button', armed.say === 'Press again to clear the comparison of 5 spacecraft.' && armed.by === 'cmpsay', JSON.stringify(armed));
    await page.keyboard.press('Enter');
    await sleep(60);
    chk('...a second press within 0.6 s is the rest of a double-click: nothing is cleared', (await listed(page)).length === 5);
    await page.keyboard.press('Escape');
    await sleep(60);
    chk('...Escape stands it down', await page.evaluate(() => document.getElementById('cmpsay').textContent === '' && !document.getElementById('cmpclear').getAttribute('aria-describedby')));
    await page.focus('#cmpclear');
    await page.keyboard.press('Enter');
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(150);
    chk('...pressed again after 0.6 s it clears, says so, and the focus goes to Add spacecraft', (await record(page)) === '{"o":1,"l":[]}' &&
      (await say(page)) === 'Cleared the comparison of 5 spacecraft.' && (await focusIs(page, '#cmpadd')) && !(await page.$('#cmpclear')), (await record(page)) + ' / ' + (await say(page)));
    chk('...the chart keeps the selected spacecraft\'s line, named', await page.evaluate(() =>
      document.getElementById('cmpcv').getAttribute('aria-label') === 'Mean altitude history and projected decay of 1 spacecraft: KNACKSAT-2' && !document.getElementById('cmpcv').hidden));

    // ---- a history that does not come
    net.failing.add(FAILING);
    await addBySearch(page, [FAILING]);
    await settled(page, 2);
    const f1 = await page.evaluate(n => {
      const li = document.querySelector('#cmprows > li[data-n="' + n + '"]'), b = [...li.querySelectorAll('button')].find(x => x.textContent === 'Try again');
      return { text: li.innerText.replace(/\s+/g, ' '), name: b && b.getAttribute('aria-label'), pressed: li.querySelector('button.tg').getAttribute('aria-pressed') };
    }, FAILING);
    chk('a failure says so ("Not received", "CelesTrak answered HTTP 503"), with Try again named for its spacecraft, and gives its colour back',
      /Not received/.test(f1.text) && /CelesTrak answered HTTP 503/.test(f1.text) && f1.name === 'Try again for FUNCUBE 1' && f1.pressed === 'false' && net.req[FAILING] === 1, JSON.stringify(f1));
    chk('...and the status line names it', (await say(page)) === 'The history of FUNCUBE 1 was not received.', await say(page));
    await page.click('#cmprows button[aria-label="Try again for FUNCUBE 1"]');
    await settled(page, 2);
    chk('Try again asks once more, and the focus is not dropped on the page', net.req[FAILING] === 2 && await page.evaluate(() => document.activeElement !== document.body),
      net.req[FAILING] + ' requests; focus on ' + await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));

    // ---- a request held: removed while out, the next waits for it; listed again, it joins it
    const letX = net.holdNext(X);
    await addBySearch(page, [X], true);
    for (let i = 0; i < 50 && !net.arrived.has(X); i++) await sleep(100);
    await addBySearch(page, [Y]);
    await sleep(150);
    chk('a request out and one queued behind it', /^Fetching… \d+ s$/.test(await stText(page, X)) && (await stText(page, Y)) === 'Queued, 1st' && net.inflight === 1 && !net.req[Y],
      (await stText(page, X)) + ' / ' + (await stText(page, Y)));
    const d0 = await page.evaluate(() => window.__cmpDraws || 0);
    await sleep(2300);
    const ticking = await stText(page, X);
    chk('the request\'s seconds tick in its row, and the chart is not redrawn for them', /^Fetching… [2-4] s$/.test(ticking) && (await page.evaluate(() => window.__cmpDraws || 0)) === d0,
      ticking + ', drawn ' + ((await page.evaluate(() => window.__cmpDraws || 0)) - d0) + ' time(s) meanwhile');
    await page.click('#cmprows [data-rm="' + X + '"]');
    await sleep(150);
    chk('removed while its request is out: it says the next one waits for that answer', (await say(page)) ===
      'Removed JILIN-01-07 · 2 in the comparison. Its history had already been asked for: the next one waits until that answer is in.', await say(page));
    await sleep(1000);
    chk('...and the next one does wait: still one request out, none for the one queued', net.inflight === 1 && !net.req[Y] && (await stText(page, Y)) === 'Queued, 1st', JSON.stringify(net.req));
    await addBySearch(page, [X]);
    await sleep(150);
    chk('listed again meanwhile, it joins the request that is out (no second one)', /^Fetching…/.test(await stText(page, X)) && net.req[X] === 1, (await stText(page, X)) + ' / ' + net.req[X]);
    letX();
    await settled(page, 4);
    chk('...the answer is its, then the queued one is asked for: one request each, never two at once', net.req[X] === 1 && net.req[Y] === 1 && net.max === 1 &&
      !/Fetch|Try again/.test(await rowText(page, X)) && !/Fetch|Try again/.test(await rowText(page, Y)), (await rowText(page, X)) + ' / ' + (await rowText(page, Y)));
    chk('...and the status line counts both', (await say(page)) === '2 fetched.', await say(page));

    // ---- removed while out, not listed again: the answer still fills the cache
    const letZ = net.holdNext(Z);
    await addBySearch(page, [Z]);
    for (let i = 0; i < 50 && !net.arrived.has(Z); i++) await sleep(100);
    await page.click('#cmprows [data-rm="' + Z + '"]');
    await sleep(120);
    chk('removed with nothing waiting behind it: said plainly', (await say(page)) === 'Removed ASTRA 1KR · 3 in the comparison', await say(page));
    letZ();
    await page.waitForFunction(n => !!localStorage.getItem('hist:' + n), Z, { timeout: 10000 });
    await sleep(200);
    chk('...its answer still fills the cache, and is not shown', !(await rowText(page, Z)) && net.req[Z] === 1);
    await addBySearch(page, [Z]);
    await settled(page, 5);
    chk('...so listed again it is drawn from the cache, with no request', net.req[Z] === 1 && !/Fetch/.test(await rowText(page, Z)), await rowText(page, Z));

    // ---- reload: cached drawn, not cached waiting, nothing asked, nothing written
    const rec = await record(page), before = net.total();
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await toSection(page);
    await settled(page, 5);
    const back = await page.evaluate(n => ({
      ex: document.getElementById('cmpopen').getAttribute('aria-expanded'), fetch: [...document.querySelectorAll('#cmprows li[data-n="' + n + '"] button')].map(b => b.getAttribute('aria-label')),
      name: document.getElementById('cmpcv').getAttribute('aria-label'), sel: document.querySelector('#cmprows > li.me .big').textContent
    }), FAILING);
    chk('after a reload: open again, the cached drawn, the one with no history waiting with its own Fetch, and no request',
      net.total() === before && back.ex === 'true' && back.fetch.includes('Fetch the history of FUNCUBE 1') &&
      back.name === 'Mean altitude history and projected decay of 4 spacecraft: KNACKSAT-2, JILIN-01-07, OTB-3-GAZELLE and ASTRA 1KR' && /^\d{4}-\d{2}-\d{2}$/.test(back.sel),
      JSON.stringify(back) + ' / ' + (net.total() - before) + ' request(s)');
    chk('...and reading the record back wrote nothing', (await record(page)) === rec, (await record(page)) + ' vs ' + rec);
    net.failing.delete(FAILING);
    await page.click('#cmprows button[aria-label="Fetch the history of FUNCUBE 1"]');
    await settled(page, 5);
    chk('its Fetch asks once, and it is drawn in the lowest free colour', net.req[FAILING] === 3 && slotIn(await listed(page), FAILING) === 5 &&
      (await page.evaluate(() => document.getElementById('cmpcv').getAttribute('aria-label'))) === 'Mean altitude history and projected decay of 5 spacecraft',
      JSON.stringify(await listed(page)));
    chk('1280: no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    stored = await keep(page);
    await ctx.close();
  });

  /* the histories the first page fetched (all fresh: fetched minutes ago), for seeding */
  const hists = Object.fromEntries(Object.entries(stored).filter(([k]) => k.startsWith('hist:')));
  const seedWith = l => Object.assign({}, hists, { 'gt.decaycmp': JSON.stringify({ o: 1, l }) });

  /* ---- 2. seven in colour, and an eighth asked for -------------------------------------------------------------------------- */
  await part('2. the highlight cap (1280 light, seeded: 7 in colour + 2 grey)', async () => {
    const extra = [X, Y];
    const { ctx, page, net } = await open(browser, srv, { label: 'cap', seed: seedWith([...ADD.map((n, i) => ({ n, h: i + 2 })), ...extra.map(n => ({ n }))]) });
    await toSection(page);
    await page.waitForFunction(() => document.querySelectorAll('#cmprows > li').length === 8 && !/Reading/.test(document.getElementById('cmprows').innerText), null, { timeout: 20000 });
    await sleep(200);
    chk('restored: 7 in colour after the selected one, the 10th row folded under "Show the other 2"', await page.evaluate(() =>
      [...document.querySelectorAll('#cmprows button.tg')].filter(b => b.getAttribute('aria-pressed') === 'true').length === 7 &&
      document.getElementById('cmpmore')?.textContent === 'Show the other 2' && document.getElementById('cmpmore').getAttribute('aria-expanded') === 'false'));
    await page.click('#cmpmore');
    await sleep(100);
    chk('...unfolded: all 10, and the button folds them again', await page.evaluate(() => document.querySelectorAll('#cmprows > li').length === 10 &&
      document.getElementById('cmpmore').getAttribute('aria-expanded') === 'true' && document.getElementById('cmpmore').textContent === 'Show only the first 8'));
    await page.click('#cmprows button.tg[aria-label="Highlight ' + NAMES[X] + '"]');
    await sleep(120);
    const ref = await page.evaluate(n => {
      const tg = document.querySelector('#cmprows > li[data-n="' + n + '"] button.tg');
      return { say: document.getElementById('cmpsay').textContent, pressed: tg.getAttribute('aria-pressed'), desc: tg.getAttribute('aria-describedby'), row: (document.getElementById('cmpref-' + n) || {}).textContent };
    }, X);
    chk('an eighth highlight is refused, said in the status line and on its row, which the toggle is described by',
      ref.pressed === 'false' && ref.say === 'Seven are highlighted: turn one off to highlight JILIN-01-07.' && ref.row === ref.say && ref.desc === 'cmpref-' + X, JSON.stringify(ref));
    await page.click('#cmprows button.tg[aria-label="Highlight HST"]');
    await page.click('#cmprows button.tg[aria-label="Highlight ' + NAMES[X] + '"]');
    await sleep(150);
    const l = await listed(page);
    chk('one turned off, the next takes its colour (the lowest free), and nobody else\'s colour moves',
      slotIn(l, '20580') === undefined && slotIn(l, X) === 4 && ADD.filter(n => n !== '20580').every((n, i) => slotIn(l, n) === [2, 3, 5, 6, 7, 8][i]), JSON.stringify(l));
    await page.focus('#cmprows button.tg[aria-label="Highlight ISS (ZARYA)"]');
    const at = () => page.evaluate(() => [...document.querySelectorAll('#cmprows > li')].findIndex(li => li.contains(document.activeElement)));
    const i0 = await at();
    await page.keyboard.press('Space');
    await sleep(120);
    const off = await page.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Highlight ISS (ZARYA)' && document.activeElement.getAttribute('aria-pressed') === 'false');
    const i1 = await at();
    await page.keyboard.press('Space');
    await sleep(120);
    const on = await page.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Highlight ISS (ZARYA)' && document.activeElement.getAttribute('aria-pressed') === 'true');
    const i2 = await at();
    chk('a toggle pressed from the keyboard keeps the focus while its row moves (down among the grey, and back up)', off && on && i1 > i0 && i2 === i0, 'row ' + i0 + ' -> ' + i1 + ' -> ' + i2);
    chk('...and back on it has its colour again, the lowest free', slotIn(await listed(page), '25544') === 2);
    /* the row goes at the first click, and the next row's Remove comes up under the pointer for the second */
    const l0 = await listed(page), rms = await page.evaluate(() => [...document.querySelectorAll('#cmprows [data-rm]')].map(b => b.dataset.rm));
    await page.dblclick('#cmprows [data-rm="' + rms[0] + '"]');
    await sleep(200);
    const l2 = await listed(page);
    chk('a double-click on a row\'s Remove removes that row alone, not the next one, which comes under the pointer',
      l2.length === l0.length - 1 && !l2.some(i => i.n === rms[0]) && l2.some(i => i.n === rms[1]), rms.slice(0, 2).join(',') + ' / ' + l2.map(i => i.n).join(','));
    chk('none of it asked for anything', net.total() === 0, JSON.stringify(net.req));
    await ctx.close();
  });

  /* ---- 3. Add watched, 10 watched, the selected spacecraft cached --------------------------------------------------------------- */
  await part('3. Add watched with 10 watched, the selected spacecraft already estimated', async () => {
    const { ctx, page, net } = await open(browser, srv, { label: 'watched10', seed: { 'gt.watch': JSON.stringify(WATCHED), 'gt.decaycmp': '{"o":1,"l":[]}', ['hist:' + SEL]: hists['hist:' + SEL] } });
    await toSection(page);
    await page.waitForSelector('#cmpwatched', { timeout: 20000 });
    chk('the button counts the watched: "Add watched (10)"', (await page.evaluate(() => document.getElementById('cmpwatched').textContent)) === 'Add watched (10)');
    await page.click('#cmpwatched');
    await sleep(100);
    chk('it says what it asked for: 7 fetched one at a time, 3 waiting', (await say(page)) === '10 added: 7 are being fetched one at a time, 3 wait for Fetch.', await say(page));
    chk('...the button goes and the focus goes to Add spacecraft', await page.evaluate(() => !document.getElementById('cmpwatched') && document.activeElement.id === 'cmpadd'));
    await settled(page, 11);
    chk('7 requests, the first seven watched, one at a time; none for the selected one', net.total() === 7 && WATCHED.slice(0, 7).every(n => net.req[n] === 1) && !net.req[SEL] && net.max === 1,
      JSON.stringify(net.req) + ' max ' + net.max);
    chk('...and the 7 are in colour, the other 3 wait for Fetch', (await pressed(page)) === 'HHHHHHHggg' && (await page.evaluate(() => document.getElementById('cmpfetch')?.textContent)) === 'Fetch the rest (3)',
      (await pressed(page)) + ' / ' + (await page.evaluate(() => document.getElementById('cmpfetch')?.textContent)));
    await page.click('#cmpfetch');
    await sleep(100);
    chk('Fetch: says what it asked for, the button goes and the focus goes to Add spacecraft', (await say(page)) === '3 are being fetched one at a time.' &&
      await page.evaluate(() => !document.getElementById('cmpfetch') && document.activeElement.id === 'cmpadd'), await say(page));
    await settled(page, 11);
    chk('...3 more requests, never two at once, and they are grey (every colour is taken)', net.total() === 10 && WATCHED.every(n => net.req[n] === 1) && net.max === 1 &&
      (await pressed(page)) === 'HHHHHHHggg' && (await page.evaluate(() => /3 others/.test(document.getElementById('cmpkey').textContent))), JSON.stringify(net.req));
    chk('...and the status line says they came', (await say(page)) === '3 fetched.', await say(page));
    await ctx.close();
  });

  /* ---- 4. Add watched, 20 watched, the selected spacecraft not estimated -------------------------------------------------------- */
  await part('4. Add watched with 20 watched, the selected spacecraft not estimated: Fetch 7 more, then the rest', async () => {
    const { ctx, page, net } = await open(browser, srv, { label: 'watched20', seed: { 'gt.watch': JSON.stringify(WATCHED20), 'gt.decaycmp': '{"o":1,"l":[]}' } });
    await toSection(page);
    await page.waitForSelector('#cmpwatched', { timeout: 20000 });
    chk('20 watched catalogue spacecraft: "Add watched (20)", and the selected row has its own Fetch, named for it', WATCHED20.length === 20 &&
      (await page.evaluate(() => document.getElementById('cmpwatched').textContent)) === 'Add watched (20)' &&
      (await page.evaluate(() => [...document.querySelectorAll('#cmprows > li.me button')].map(b => b.getAttribute('aria-label')).join())) === 'Fetch the history of KNACKSAT-2', WATCHED20.join(','));
    /* double-clicked: the button goes at the first click, and "Fetch 7 more" comes under the pointer for the second */
    await page.dblclick('#cmpwatched');
    await sleep(100);
    chk('the selected spacecraft\'s request is one of the seven: it is named, 6 more, 14 wait (a double-click is one press)',
      (await say(page)) === '20 added: KNACKSAT-2 and 6 more are being fetched one at a time, 14 wait for Fetch.', await say(page));
    await settled(page, 21, 40000);
    chk('7 requests, the selected one\'s first, one at a time', net.total() === 7 && net.order.slice(0, 7).join() === [SEL, ...WATCHED20.slice(0, 6)].join() && net.max === 1 &&
      await page.evaluate(() => /^\d{4}-\d{2}-\d{2}$/.test(document.getElementById('lifebig').textContent)), net.order.join(','));
    chk('"Fetch 7 more"', (await page.evaluate(() => document.getElementById('cmpfetch')?.textContent)) === 'Fetch 7 more');
    await page.dblclick('#cmpfetch');
    await sleep(100);
    chk('...double-clicked: 7 asked for, 7 still wait', (await say(page)) === '7 are being fetched one at a time, 7 still wait for Fetch.', await say(page));
    await settled(page, 21, 40000);
    chk('...7 more requests (the seventh coloured one first), and the button reads "Fetch the rest (7)"', net.total() === 14 && net.order[7] === WATCHED20[6] && net.max === 1 &&
      (await page.evaluate(() => document.getElementById('cmpfetch')?.textContent)) === 'Fetch the rest (7)', net.order.slice(7).join(','));
    await page.click('#cmpfetch');
    await sleep(100);
    chk('...pressed: the last 7', (await say(page)) === '7 are being fetched one at a time.', await say(page));
    await settled(page, 21, 40000);
    chk('21 requests in all, one per spacecraft, never two at once; nothing left to fetch', net.total() === 21 && [SEL, ...WATCHED20].every(n => net.req[n] === 1) && net.max === 1 &&
      await page.evaluate(() => !document.getElementById('cmpfetch')), JSON.stringify(net.req) + ' max ' + net.max);
    chk('seven in colour, the rest grey', (await pressed(page)) === 'H'.repeat(7) + 'g'.repeat(13), await pressed(page));
    chk('the canvas names 21 spacecraft and the key "13 others"', await page.evaluate(() =>
      document.getElementById('cmpcv').getAttribute('aria-label') === 'Mean altitude history and projected decay of 21 spacecraft' && /13 others/.test(document.getElementById('cmpkey').textContent)));
    await ctx.close();
  });

  /* ---- 5. a planned orbit selected ---------------------------------------------------------------------------------------------- */
  await part('5. a planned orbit selected', async () => {
    const GOOD = { id: 'c1', name: 'Fine', made: 1, el: { a: 6978.135, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: Date.UTC(2026, 9, 1), bstar: 3e-4 } };
    const s = Object.assign({}, stored, { 'gt.custom': JSON.stringify({ v: 1, next: 2, items: [GOOD] }) });
    const { ctx, page, net } = await open(browser, srv, { label: 'planned', seed: s });
    await toSection(page);
    await settled(page, 5);
    await page.evaluate(() => scrollTo(0, 0));
    await H.pick(page, 'Fine');
    await page.waitForFunction(() => window.__gt.D.entry.name === 'Fine', null, { timeout: 15000 });
    await sleep(500);
    const st = await page.evaluate(() => ({
      date: (/\d{4}-\d{2}-\d{2}/.exec(document.getElementById('sec-life').innerText) || [null])[0], cv: !!document.getElementById('cmpcv'), rows: !!document.getElementById('cmprows'),
      said: (document.getElementById('cmpplanned') || {}).textContent
    }));
    chk('one sentence, no rows, no chart, and no date anywhere in the section', !st.date && !st.cv && !st.rows && /^The comparison is put away while a planned orbit is selected/.test(st.said || ''), JSON.stringify(st));
    await H.pick(page, SEL);
    await page.waitForFunction(n => window.__gt.D.entry.satnum === n, SEL, { timeout: 15000 });
    await sleep(400);
    chk('it comes back as it was with a catalogue spacecraft selected', await page.evaluate(() => document.querySelectorAll('#cmprows > li').length === 5 && !document.getElementById('cmpplanned')));
    chk('none of it asked for anything', net.total() === 0, JSON.stringify(net.req));
    await ctx.close();
  });

  /* ---- 6. ?tle=embedded, the panel stored open ---------------------------------------------------------------------------------- */
  await part('6. ?tle=embedded with the panel stored open', async () => {
    const { ctx, page, net, chunks } = await open(browser, srv, { label: 'embedded', seed: stored, url: srv.page + (srv.page.includes('?') ? '&' : '?') + 'tle=embedded' });
    await toSection(page);
    await settled(page, 5);
    await page.click('#cmpadd');
    await page.fill('#cmpsearch', 'gaofen');
    await sleep(300);
    chk('restored from the cache with no request; the search marks nothing (no "decayed now" chunk under the snapshot)',
      net.total() === 0 && !chunks.includes('decayed.svelte') && await page.evaluate(() => !document.getElementById('cmpdecayed') && !document.querySelector('#cmplist .dk')), JSON.stringify(net.req) + ' ' + chunks.join(' '));
    await ctx.close();
  });

  /* ---- 7. a phone ------------------------------------------------------------------------------------------------------------- */
  await part('7. a phone, 390 x 844 dark (seeded)', async () => {
    const { ctx, page, net } = await open(browser, srv, { label: 'phone', seed: stored, vp: { width: 390, height: 844 }, phone: true, theme: 'dark' });
    await toSection(page);
    await settled(page, 5);
    chk('restored, drawn, no request', net.total() === 0 && (await opaque(page)) > 2000, JSON.stringify(net.req));
    chk('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), String(await page.evaluate(() => document.documentElement.scrollWidth)));
    const smallText = () => page.evaluate(() => [...document.querySelectorAll('#sec-life h3, #cmpfail, #cmppanel *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) &&
      !e.closest('.sr-only') && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.tagName + '.' + e.className));
    const small = await smallText();
    chk('no text under 12 px', small.length === 0, small.join(' '));
    /* [how many controls are on the screen, those under 44 px] */
    const taps = sel => page.evaluate(s => {
      const all = [...document.querySelectorAll(s)].filter(b => b.offsetParent)
        .map(b => { const r = b.getBoundingClientRect(); return [b.id || b.getAttribute('aria-label') || b.className, Math.round(r.width), Math.round(r.height)]; });
      return [all.length, all.filter(([, w, h]) => w < 44 || h < 44)];
    }, sel);
    const [k1, t1] = await taps('#cmpopen, #cmppanel button');
    chk('every control of the panel is 44 px or more both ways', k1 >= 10 && t1.length === 0, k1 + ' controls; ' + JSON.stringify(t1));
    /* the chart's view (L67): Range's five buttons are among the panel's buttons above; Show is a select */
    const [k3, t3] = await taps('#cmpparam');
    const pfs = await page.evaluate(() => getComputedStyle(document.getElementById('cmpparam')).fontSize);
    chk('Show (the quantity\'s select) is 44 px or more both ways, its text 16 px (so a phone does not zoom the page into it)', k3 === 1 && t3.length === 0 && pfs === '16px',
      k3 + ' control; ' + JSON.stringify(t3) + ' ' + pfs);
    const ta = await page.evaluate(() => getComputedStyle(document.getElementById('cmpcv')).touchAction);
    chk('the chart leaves a vertical swipe and a pinch to the page (touch-action: pan-y pinch-zoom)', ta === 'pan-y pinch-zoom', ta);
    await page.click('#cmpadd');
    await page.fill('#cmpsearch', 'lemur');
    await sleep(300);
    const [k2, t2] = await taps('#cmppanel [role=option]');
    const inView = await page.evaluate(() => { const d = document.querySelector('[role=dialog][aria-label="Add a spacecraft to compare"]').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth; });
    chk('the search is inside the screen, its options 44 px tall', inView && k2 >= 3 && t2.length === 0, k2 + ' options; ' + JSON.stringify(t2));
    chk('...and the page still does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press('Escape');
    await sleep(150);

    // ---- the reading by touch (L67): pinned at the top of the plot, moved by a sideways finger, let go by a tap elsewhere
    const box = async () => {
      await page.evaluate(() => document.getElementById('cmpcv').scrollIntoView({ block: 'center' }));
      await sleep(250);
      return page.evaluate(() => { const r = document.getElementById('cmpcv').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    };
    const pinnedNow = () => page.evaluate(() => {
      const t = document.getElementById('cmptip'), c = document.getElementById('cmpcv').getBoundingClientRect();
      return { tip: !!t, cross: !!document.getElementById('cmpx'), top: t ? Math.round(t.getBoundingClientRect().top - c.top) : null, day: t ? t.querySelector('p').textContent : null,
        rows: t ? t.querySelectorAll('p').length - 1 : 0, dots: document.querySelectorAll('#cmpdots i').length };
    });
    let C = await box();
    await page.touchscreen.tap(C.x + C.w * 0.4, C.y + C.h / 2);
    await sleep(150);
    const p1 = await pinnedNow();
    await sleep(400);
    const p2 = await pinnedNow();
    chk('a tap on the chart pins the reading at the top of the plot (16 px down: the finger is under it), a dot on the line for each row, and it stays',
      p1.tip && p1.cross && Math.abs(p1.top - 16) <= 4 && p1.rows > 0 && p1.dots === p1.rows && p2.tip && p2.day === p1.day, JSON.stringify([p1, p2]));
    await page.evaluate(() => document.querySelector('#cmprows .name').scrollIntoView({ block: 'nearest' }));
    await sleep(150);
    const held = (await pinnedNow()).tip;
    const nm = await page.evaluate(() => { const r = document.querySelector('#cmprows .name').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(nm.x, nm.y);
    await sleep(150);
    const p3 = await pinnedNow();
    chk('...a tap elsewhere (the first row\'s name) lets it go', held && !p3.tip && !p3.cross, 'held ' + held + ', then ' + JSON.stringify(p3));
    C = await box();
    const mid = [C.x + C.w * 0.5, C.y + C.h / 2];
    await page.touchscreen.tap(mid[0], mid[1]);
    await sleep(150);
    const q1 = await pinnedNow();
    await page.keyboard.press('Escape');
    await sleep(150);
    const q2 = await pinnedNow();
    chk('...Escape lets it go too', q1.tip && !q2.tip && !q2.cross, JSON.stringify([q1, q2]));
    await sleep(400);                                             // past a double tap
    /* a tap on the reading slider under the chart keeps it: the focused slider shows a reading of its own, so the slider is then left
       (blur), which hides a reading that is not pinned: a reading still there is held. (A tap does not focus the range input in this
       headless phone, so the slider is focused first; the tap is then on the focused slider, and moves its value.) */
    await page.touchscreen.tap(mid[0], mid[1]);
    await sleep(150);
    const q3 = await pinnedNow();
    await page.focus('#cmpscrub');
    await sleep(100);
    const sb = await page.evaluate(() => { const r = document.getElementById('cmpscrub').getBoundingClientRect(); return { x: r.left + r.width * 0.25, y: r.top + r.height / 2, h: Math.round(r.height) }; });
    await page.touchscreen.tap(sb.x, sb.y);
    await sleep(200);
    const q4 = await pinnedNow(), onScrub = await focusIs(page, '#cmpscrub');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await sleep(150);
    const q5 = await pinnedNow();
    chk('...a tap on the reading slider keeps it: still shown once the slider is left', q3.tip && sb.h > 0 && q4.tip && onScrub && q5.tip && q5.cross,
      JSON.stringify([q3, sb, q4, onScrub, q5]));
    await page.keyboard.press('Escape');
    await sleep(400);
    /* a double tap never zooms: two taps 100 ms apart, then the double-click a browser makes of them, sent after the touches */
    const w0 = await page.evaluate(() => { const c = document.getElementById('cmpcv'); window.__dbl = 0; c.addEventListener('dblclick', () => window.__dbl++); return [c.dataset.t0, c.dataset.t1]; });
    await page.touchscreen.tap(mid[0], mid[1]);
    await sleep(100);
    await page.touchscreen.tap(mid[0], mid[1]);
    await sleep(300);
    const nat = await page.evaluate(() => window.__dbl);
    await page.evaluate(([x, y]) => document.getElementById('cmpcv').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y })), mid);
    await sleep(250);
    const w1 = await page.evaluate(() => { const c = document.getElementById('cmpcv'); return [c.dataset.t0, c.dataset.t1]; });
    const zm = { reset: !!(await page.$('#cmpreset')), hint: !!(await page.$('#cmpdraghint')) };
    chk('a double tap on the chart zooms nothing, nor does the double-click a browser makes of it (the window as it was, the hint and no Reset zoom)',
      !!w0[0] && w1.join() === w0.join() && !zm.reset && zm.hint, JSON.stringify([w0, w1, zm]) + ' / the browser\'s own dblclicks ' + nat);
    await page.keyboard.press('Escape');
    await sleep(400);
    C = await box();
    const ym = C.y + C.h / 2, xa = C.x + C.w * 0.3, xb = C.x + C.w * 0.6;
    await page.touchscreen.tap(xa, ym);
    await sleep(150);
    const d30 = (await pinnedNow()).day;
    await sleep(400);                                             // well past a double tap
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xa, y: ym }] });
    for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: xa + (xb - xa) * i / 6, y: ym }] }); await sleep(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(150);
    const p4 = await pinnedNow();
    chk('a sideways finger from 30 % to 60 % of the chart moves the reading with it and leaves it there: a later day than a tap at 30 % reads',
      !!d30 && p4.tip && p4.day > d30 && p4.dots === p4.rows, d30 + ' -> ' + JSON.stringify(p4));
    /* a finger up the chart, 300 px, as touch events (Input.synthesizeScrollGesture's touch source scrolls nothing in headless
       Chromium, on the chart or off it; these go through the page's touch-action and the browser's own scrolling) */
    C = await box();
    const y0 = await page.evaluate(() => scrollY), xs = Math.round(C.x + C.w / 2), ys = Math.round(C.y + C.h * 0.8);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xs, y: ys }] });
    for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: xs, y: ys - 300 * i / 12 }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
    const y1 = await page.evaluate(() => scrollY);
    chk('a vertical swipe on the chart still scrolls the page', y1 - y0 >= 100, 'scrollY ' + y0 + ' -> ' + y1);
    const hint = await page.evaluate(() => { const h = document.getElementById('cmpdraghint'); return h ? h.checkVisibility() : 'absent'; });
    chk('the hint to drag or double-click is in the page (the chart is drawn, not zoomed) and not shown under a finger', hint === false, String(hint));
    chk('after the touches: still no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), String(await page.evaluate(() => document.documentElement.scrollWidth)));
    const small2 = await smallText();
    chk('...and no text under 12 px', small2.length === 0, small2.join(' '));
    await ctx.close();
  });

  /* ---- 8. the chunk does not come ---------------------------------------------------------------------------------------------- */
  await part('8. the comparison\'s chunk refused', async () => {
    const { ctx, page } = await open(browser, srv, { label: 'refused' });
    const block = r => r.abort();
    await page.route(/\/assets\/DecayCompare-[A-Za-z0-9_-]{8}\.js$/, block);
    await toSection(page);
    await page.click('#cmpopen');
    await page.waitForFunction(() => document.getElementById('cmpfail').textContent !== '', null, { timeout: 10000 }).catch(() => {});
    const f = await page.evaluate(() => ({ say: document.getElementById('cmpfail').textContent, role: document.getElementById('cmpfail').getAttribute('role'),
      ex: document.getElementById('cmpopen').getAttribute('aria-expanded'), hidden: document.getElementById('cmppanel').hidden, rec: localStorage.getItem('gt.decaycmp'),
      dis: document.getElementById('cmpopen').disabled || document.getElementById('cmpopen').getAttribute('aria-disabled') === 'true' }));
    chk('a press says it could not be loaded and asks for a reload; the button stays shut and pressable, nothing stored',
      f.say === 'The comparison could not be loaded. Reload the page to try again.' && f.role === 'status' && f.ex === 'false' && f.hidden && f.rec === null && !f.dis,
      JSON.stringify(f));
    await page.unroute(/\/assets\/DecayCompare-[A-Za-z0-9_-]{8}\.js$/, block);
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await toSection(page);
    await page.click('#cmpopen');
    await page.waitForSelector('#cmpadd', { state: 'visible', timeout: 15000 }).catch(() => {});
    chk('...after the reload a press opens it', await page.evaluate(() => document.getElementById('cmpopen').getAttribute('aria-expanded') === 'true' && document.getElementById('cmpfail').textContent === ''));
    await ctx.close();
  });

  /* ---- 9. a listed spacecraft picked while its compared request is out ------------------------------------------------------ */
  await part('9. a listed spacecraft picked as the selected one while its compared request is out', async () => {
    const ISS = '25544';
    const { ctx, page, net } = await open(browser, srv, { label: 'picked', seed: { 'gt.decaycmp': '{"o":1,"l":[]}', ['hist:' + SEL]: hists['hist:' + SEL] } });
    await toSection(page);
    await page.waitForSelector('#cmpadd', { timeout: 20000 });
    const letIss = net.holdNext(ISS);
    await addBySearch(page, [ISS]);
    for (let i = 0; i < 50 && !net.arrived.has(ISS); i++) await sleep(100);
    await page.evaluate(() => scrollTo(0, 0));
    await H.pick(page, ISS);
    await page.waitForFunction(n => window.__gt.D.entry.satnum === n, ISS, { timeout: 15000 });
    await toSection(page);
    await sleep(300);
    const s = await page.evaluate(n => ({
      me: (document.querySelector('#cmprows > li.me') || {}).dataset?.n, rows: document.querySelectorAll('#cmprows > li').length,
      st: (document.getElementById('cmpst-' + n) || {}).textContent?.trim(), buttons: [...document.querySelectorAll('#cmprows > li.me button')].map(b => b.getAttribute('aria-label')),
      wait: !!document.getElementById('cmpwait'), go: !!document.getElementById('lifego')
    }), ISS);
    chk('its row, the selected one\'s now, says its history is being fetched, with no Fetch to press, and the wait is said',
      s.me === ISS && s.rows === 1 && /^Fetching… \d+ s$/.test(s.st || '') && !s.buttons.length && s.wait && s.go && net.req[ISS] === 1, JSON.stringify(s));
    await page.click('#lifego');
    await sleep(400);
    chk('...the section\'s own Estimate shares that request: still one out, and no second', net.req[ISS] === 1 && net.inflight === 1, JSON.stringify(net.req));
    letIss();
    await page.waitForFunction(() => /^\d{4}-\d{2}-\d{2}$/.test(document.getElementById('lifebig').textContent), null, { timeout: 15000 }).catch(() => {});
    chk('...and its answer paints the section: one request in all, never two at once', net.total() === 1 && net.max === 1 &&
      await page.evaluate(() => /^\d{4}-\d{2}-\d{2}$/.test(document.getElementById('lifebig').textContent)), JSON.stringify(net.req) + ' max ' + net.max);
    await ctx.close();
  });

  /* ---- 10. the list nearly full -------------------------------------------------------------------------------------------- */
  await part('10. 49 listed and 10 watched: Add watched adds the one that fits, and goes', async () => {
    const FULL = catalogue().filter(n => !USED.has(n) && !WATCHED20.includes(n) && /^\d{5}$/.test(n)).filter((n, i) => i % 40 === 7).slice(0, 49);
    const { ctx, page, net } = await open(browser, srv, { label: 'full', seed: {
      'gt.watch': JSON.stringify(WATCHED), 'gt.decaycmp': JSON.stringify({ o: 1, l: FULL.map(n => ({ n })) }), ['hist:' + SEL]: hists['hist:' + SEL] } });
    await toSection(page);
    await page.waitForSelector('#cmpwatched', { timeout: 20000 });
    chk('"Add watched (10)" beside 49 listed', FULL.length === 49 && (await page.evaluate(() => document.getElementById('cmpwatched').textContent)) === 'Add watched (10)', String(FULL.length));
    /* double-clicked: the button goes at the first click, and "Fetch 7 more" (49 wait) comes under the pointer for the second */
    await page.dblclick('#cmpwatched');
    await sleep(150);
    chk('...double-clicked: the one that fits is added and asked for, the other 9 said not to fit, and the button goes with the list full',
      (await say(page)) === '1 added: 1 is being fetched. 9 more did not fit: the comparison holds 50.' && !(await page.$('#cmpwatched')), await say(page));
    await page.waitForFunction(() => !/Fetching|Queued/.test(document.getElementById('cmprows').innerText), null, { timeout: 15000 }).catch(() => {});
    chk('...one request, for the first watched, and 50 listed', net.total() === 1 && net.req[WATCHED[0]] === 1 && (await listed(page)).length === 50, JSON.stringify(net.req));
    await ctx.close();
  });

  /* ---- 11. the chart's view (L67) ----------------------------------------------------------------------------------------------- */
  await part('11. the chart\'s view: range, quantity, zoom and reading (1280 light, seeded)', async () => {
    const { ctx, page, net } = await open(browser, srv, { label: 'view', seed: stored });
    await toSection(page);
    await settled(page, 5);
    await page.waitForFunction(() => { const c = document.getElementById('cmpcv'); return !!c && !c.hidden && !!c.dataset.t0; }, null, { timeout: 10000 });
    const seeded = stored['gt.decaycmp'];
    const DAY = S.DAY;
    /* the lines in colour (the selected one and the highlighted rows) and, from their cached histories, the first element set among
       them and the newest: where All starts, and where 30 d, 90 d and 1 y end */
    const coloured = [SEL].concat(JSON.parse(seeded).l.filter(i => i.h).map(i => i.n));
    const sets = coloured.map(n => JSON.parse(stored['hist:' + n]).P);
    const tFirst = Math.min(...sets.map(P => P[0].t)), tLast = Math.max(...sets.map(P => P[P.length - 1].t));
    /* the view as the page has it: the pressed range, the quantity, the caption, the chart's name and description, the record, the
       draws, the key, the window drawn (the canvas's data-t0 and data-t1, written for the suites), Reset zoom, the hint and the note */
    const view = () => page.evaluate(() => {
      const cv = document.getElementById('cmpcv'), shown = id => { const e = document.getElementById(id); return !!e && e.checkVisibility(); };
      return { pressed: [...document.querySelectorAll('#cmpview button[aria-pressed="true"]')].map(b => b.id), buttons: document.querySelectorAll('#cmpview button[aria-pressed]').length,
        param: document.getElementById('cmpparam').value, axis: document.getElementById('cmpaxis').textContent, name: cv.getAttribute('aria-label'),
        desc: cv.getAttribute('aria-describedby'), rec: localStorage.getItem('gt.decaycmp'), draws: window.__cmpDraws || 0,
        key: [...document.querySelectorAll('#cmpkey > span')].map(s => s.textContent), t0: +cv.dataset.t0, t1: +cv.dataset.t1,
        reset: shown('cmpreset'), hint: shown('cmpdraghint'), note: (document.getElementById('cmpnote') || {}).textContent || null };
    });
    /* the reading: its day, its rows (the whole row's text, the value alone, the name), the dots on the lines, its top over the canvas's */
    const reading = () => page.evaluate(() => {
      const t = document.getElementById('cmptip'), c = document.getElementById('cmpcv').getBoundingClientRect();
      if (!t) return null;
      return { day: t.querySelector('p').textContent, top: Math.round(t.getBoundingClientRect().top - c.top), dots: document.querySelectorAll('#cmpdots i').length,
        rows: [...t.querySelectorAll('p')].slice(1).map(p => ({ text: p.textContent.replace(/\s+/g, ' ').trim(), v: [...p.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(), name: p.querySelector('span').textContent })) };
    });
    /* the canvas in the page and the plot's margins (--pl, --pr: what the panel wrote after the draw) */
    const plot = async () => {
      await page.evaluate(() => document.getElementById('cmpcv').scrollIntoView({ block: 'center' }));
      await sleep(200);
      return page.evaluate(() => {
        const cv = document.getElementById('cmpcv'), r = cv.getBoundingClientRect(), s = getComputedStyle(cv.parentElement);
        return { x: r.left, y: r.top, w: r.width, h: r.height, L: parseFloat(s.getPropertyValue('--pl')), R: parseFloat(s.getPropertyValue('--pr')) };
      });
    };
    const across = (P, f) => P.x + P.L + (P.w - P.L - P.R) * f;               // f of the way across the plot
    const off = async P => { await page.mouse.move(P.x + P.w / 2, P.y - 60); await sleep(80); };
    /* the pointer from 2 % to 98 % of the canvas's width, in 4 % steps, at half its height: every reading it shows */
    const hover = async P => {
      const out = [];
      for (let i = 0; i <= 24; i++) {
        await page.mouse.move(P.x + P.w * (0.02 + 0.04 * i), P.y + P.h / 2);
        await sleep(30);
        const r = await reading();
        if (r) out.push(r);
      }
      await off(P);
      return out;
    };
    const dates = a => (/ · (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(a) || []).slice(1);
    const day = t => new Date(t).toISOString().slice(0, 10);
    const focused = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    const HP_NOTE = 'Worked out from each element set’s mean altitude and eccentricity, above a sphere of the Earth’s equatorial radius: ' +
      'a height found by propagating the orbit differs by a few km. The forecast is of mean altitude only, so these lines stop at each last element set.';

    let P = await plot();
    const v1 = await view();
    chk('the defaults: Auto pressed and the other four not, Mean altitude shown, the caption "Mean altitude, km · <from> to <to>" with the drawn window\'s days, the record as seeded, no request, the hint and no Reset zoom',
      v1.buttons === 5 && v1.pressed.join() === 'cmpr-auto' && v1.param === 'alt' && /^Mean altitude, km · \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(v1.axis) &&
      dates(v1.axis).join() === [day(v1.t0), day(v1.t1)].join() && v1.rec === seeded && net.total() === 0 && v1.hint && !v1.reset && !(await page.$('#cmpreset')), JSON.stringify(v1));

    await page.click('#cmpr-90d');
    await sleep(200);
    const v2 = await view(), d2 = dates(v2.axis);
    chk('90 d: pressed instead, the window the 90 days up to the newest element set of the lines in colour (its end that set, the caption\'s days 90 apart), kept ("r":"90d", the list the same), drawn once more, the same name, no request',
      v2.pressed.join() === 'cmpr-90d' && v2.t1 === Math.round(tLast) && v2.t1 - v2.t0 === 90 * DAY && d2.length === 2 && Date.parse(d2[1]) - Date.parse(d2[0]) === 90 * DAY && JSON.parse(v2.rec).r === '90d' &&
      JSON.stringify(JSON.parse(v2.rec).l) === JSON.stringify(JSON.parse(seeded).l) && v2.draws === v1.draws + 1 && v2.name === v1.name && net.total() === 0, JSON.stringify(v2) + ' / newest set ' + day(tLast));

    await page.focus('#cmpr-90d');
    await page.keyboard.press('ArrowRight');
    await sleep(150);
    const k1 = await view(), f1 = await focused();
    await page.keyboard.press('ArrowLeft');
    await sleep(150);
    const k2 = await view(), f2 = await focused();
    chk('the arrow keys: ArrowRight presses 1 y and moves the focus to it, kept ("r":"1y"); ArrowLeft goes back to 90 d',
      k1.pressed.join() === 'cmpr-1y' && f1 === 'cmpr-1y' && JSON.parse(k1.rec).r === '1y' && k2.pressed.join() === 'cmpr-90d' && f2 === 'cmpr-90d' && JSON.parse(k2.rec).r === '90d',
      [k1.pressed, f1, k1.rec, k2.pressed, f2].join(' / '));

    /* every range, pressed in turn: its window (30 d and 1 y end at the newest set; All runs from the first set to the latest end of a
       projection, where Auto ends too), its caption, the record ("r" only when not Auto), one draw each, no request */
    const RANGE_WIN = {
      '30d': w => w.t1 === Math.round(tLast) && w.t1 - w.t0 === 30 * DAY,
      '1y': w => w.t1 === Math.round(tLast) && w.t1 - w.t0 === 365 * DAY,
      all: w => w.t0 === Math.round(tFirst) && w.t1 === v1.t1 && w.t0 <= v1.t0,
      auto: w => w.t0 === v1.t0 && w.t1 === v1.t1 && w.rec === seeded,
      '90d': w => w.t0 === v2.t0 && w.t1 === v2.t1 && w.rec === v2.rec
    };
    const RANGE_SAYS = { '30d': 'the 30 days up to the newest set', '1y': 'the 365 days up to the newest set', all: 'from the first set (' + day(tFirst) + ') to where Auto ends',
      auto: 'Auto\'s window again, the record as seeded', '90d': '90 d\'s window again' };
    for (const r of ['30d', '1y', 'all', 'auto', '90d']) {
      const n0 = (await view()).draws;
      await page.click('#cmpr-' + r);
      await sleep(200);
      const w = await view(), rec = JSON.parse(w.rec);
      chk('Range "' + r + '": pressed alone, ' + RANGE_SAYS[r] + ', the caption "Mean altitude, km · " with its days, kept (' + (r === 'auto' ? 'no "r"' : '"r":"' + r + '"') + '), drawn once more, no request',
        w.pressed.join() === 'cmpr-' + r && RANGE_WIN[r](w) && w.axis.startsWith('Mean altitude, km · ') && dates(w.axis).join() === [day(w.t0), day(w.t1)].join() &&
        (r === 'auto' ? !('r' in rec) : rec.r === r) && JSON.stringify(rec.l) === JSON.stringify(JSON.parse(seeded).l) && w.draws === n0 + 1 && net.total() === 0,
        JSON.stringify({ pressed: w.pressed, axis: w.axis, t0: w.t0, t1: w.t1, days: (w.t1 - w.t0) / DAY, rec: w.rec, draws: w.draws - n0 }) + ' / Auto ' + [v1.t0, v1.t1] + ', first set ' + tFirst + ', newest ' + tLast);
    }

    P = await plot();
    const h4 = await hover(P);
    chk('hover from 2 % to 98 % of the width: every reading\'s day within the caption\'s, some readings, and a dot for each row',
      h4.length > 0 && h4.every(r => r.rows.length && r.day >= d2[0] && r.day <= d2[1] && r.dots === r.rows.length), h4.length + ' readings; ' + JSON.stringify(h4.filter(r => !(r.day >= d2[0] && r.day <= d2[1] && r.dots === r.rows.length)).slice(0, 2)));

    /* every quantity, chosen in turn over 90 d: the select's value, the caption (the quantity, its unit, 90 d's days: the window never
       moves with the quantity), the record ("p" only when not Mean altitude), one draw each, no request, and the reading at the middle
       of the plot, each value in the quantity's own form; then those readings against each other, spacecraft by spacecraft */
    const PARAM_AXIS = { hp: 'Mean perigee altitude, km', ha: 'Mean apogee altitude, km', rate: 'Decay rate, km/day', ecc: 'Eccentricity', per: 'Orbital period, min',
      mm: 'Mean motion, rev/day', alt: 'Mean altitude, km' };
    const KM = /^\d+\.\d km$/;
    const FORM = { hp: KM, ha: KM, rate: /^[-+]?\d+\.\d{3} km\/day$/, ecc: /^\d\.\d{5}$/, per: /^\d+\.\d{2} min$/, mm: /^\d+\.\d{4} rev\/day$/, alt: KM };
    const FORM_SAYS = { hp: 'km to 0.1', ha: 'km to 0.1', rate: 'km/day to 0.001', ecc: 'to five places', per: 'min to 0.01', mm: 'rev/day to 0.0001', alt: 'km to 0.1' };
    const at = {};                                                // quantity -> name -> the value read at the middle of 90 d
    for (const p of ['hp', 'ha', 'rate', 'ecc', 'per', 'mm', 'alt']) {
      const n0 = (await view()).draws;
      await page.selectOption('#cmpparam', p);
      await sleep(200);
      const w = await view(), rec = JSON.parse(w.rec);
      const Q = await plot();
      await page.mouse.move(across(Q, 0.5), Q.y + Q.h / 2);
      await sleep(60);
      const r = await reading();
      await off(Q);
      at[p] = Object.fromEntries(((r && r.rows) || []).map(q => [q.name, parseFloat(q.v)]));
      chk('Show "' + p + '": chosen, the caption "' + PARAM_AXIS[p] + ' · " with 90 d\'s days, kept (' + (p === 'alt' ? 'no "p"' : '"p":"' + p + '"') + ' with "r":"90d"), drawn once more, no request, and the reading mid-plot one row per line in colour, each ' + FORM_SAYS[p],
        w.param === p && w.axis.startsWith(PARAM_AXIS[p] + ' · ') && dates(w.axis).join() === d2.join() && w.t0 === v2.t0 && w.t1 === v2.t1 &&
        (p === 'alt' ? !('p' in rec) && w.rec === v2.rec : rec.p === p) && rec.r === '90d' && w.draws === n0 + 1 && net.total() === 0 &&
        !!r && r.rows.length === coloured.length && r.rows.every(q => FORM[p].test(q.v)),
        JSON.stringify({ param: w.param, axis: w.axis, rec: w.rec, draws: w.draws - n0 }) + ' / ' + JSON.stringify(r));
    }
    const RE_KM = 6378.137, names = Object.keys(at.alt);
    const odd = names.filter(nm => !(at.hp[nm] < at.alt[nm] && at.alt[nm] < at.ha[nm] && Math.abs((at.ha[nm] - at.hp[nm]) - 2 * at.ecc[nm] * (at.alt[nm] + RE_KM)) <= 0.3 &&
      Math.abs(at.per[nm] * at.mm[nm] - 1440) <= 0.1 && at.rate[nm] < 0));
    chk('...and read together, each spacecraft\'s: perigee below its mean altitude below its apogee, apogee less perigee twice the eccentricity times the mean altitude plus 6378.137 km (to 0.3 km), period times mean motion 1440 min a day (to 0.1), the decay rate below zero; and five different eccentricities',
      names.length === coloured.length && !odd.length && new Set(names.map(nm => at.ecc[nm])).size === names.length,
      (odd.length ? 'odd: ' + odd.join(', ') + ' / ' : '') + JSON.stringify(at));

    const d5 = (await view()).draws;
    await page.selectOption('#cmpparam', 'hp');
    await sleep(200);
    const v5 = await view();
    chk('Show "Mean perigee altitude": the chart named for it, the key "observed" with no "projected", the note under it and in the chart\'s description, the caption "Mean perigee altitude, km · " with 90 d\'s days, kept with the range ("p":"hp","r":"90d"), drawn once more, no request',
      /^Mean perigee altitude history of \d+ spacecraft/.test(v5.name) && v5.key[v5.key.length - 1] === 'observed' && !v5.key.includes('projected') && v5.note === HP_NOTE &&
      v5.axis.startsWith('Mean perigee altitude, km · ') && dates(v5.axis).join() === d2.join() && JSON.parse(v5.rec).p === 'hp' && JSON.parse(v5.rec).r === '90d' &&
      v5.draws === d5 + 1 && net.total() === 0 && (v5.desc || '').split(' ').includes('cmpnote'), JSON.stringify(v5));
    P = await plot();
    const h5 = await hover(P);
    chk('...its readings: each row "<km to 0.1> km <name>", highest first', h5.length > 0 &&
      h5.every(r => r.rows.length && r.rows.every((q, i, a) => /^\d+\.\d km /.test(q.text) && (!i || parseFloat(a[i - 1].v) >= parseFloat(q.v)))), JSON.stringify(h5.slice(0, 2)));

    await page.selectOption('#cmpparam', 'rate');
    await sleep(200);
    const v6 = await view(), h6 = await hover(await plot());
    chk('Decay rate: the caption "Decay rate, km/day · ", every reading\'s value signed to 0.001 km/day and below zero (the histories fall)',
      v6.axis.startsWith('Decay rate, km/day · ') && h6.length > 0 && h6.every(r => r.rows.length && r.rows.every(q => /^[-+]\d+\.\d{3} km\/day /.test(q.text) && parseFloat(q.v) < 0)),
      v6.axis + ' / ' + JSON.stringify(h6.slice(0, 2)));

    await page.selectOption('#cmpparam', 'ecc');
    await sleep(200);
    const v7 = await view(), h7 = await hover(await plot());
    /* each line's values from left to right: the made-up eccentricities rise by half along each history, so none falls, each ends
       higher than it starts, and no two lines read the same (each spacecraft has its own) */
    const eccSeq = nm => h7.map(r => r.rows.find(q => q.name === nm)).filter(Boolean).map(q => parseFloat(q.v));
    const eccNames = [...new Set(h7.flatMap(r => r.rows.map(q => q.name)))];
    const eccOdd = eccNames.filter(nm => { const s = eccSeq(nm); return !(s.length > 1 && s.every((v, i) => !i || v >= s[i - 1]) && s[s.length - 1] > s[0]); });
    chk('Eccentricity: the caption "Eccentricity · " (no unit), every reading\'s value to five places, each line rising from left to right, and no two lines reading the same',
      v7.axis.startsWith('Eccentricity · ') && h7.length > 0 && h7.every(r => r.rows.length && r.rows.every(q => /^\d\.\d{5} /.test(q.text)) && new Set(r.rows.map(q => q.v)).size === r.rows.length) &&
      eccNames.length === coloured.length && !eccOdd.length,
      v7.axis + (eccOdd.length ? ' / not rising: ' + eccOdd.map(nm => nm + ' ' + eccSeq(nm).join(' ')).join('; ') : '') + ' / ' + JSON.stringify(h7.slice(0, 2)));

    await page.selectOption('#cmpparam', 'per');
    await sleep(150);
    await page.click('#cmpr-auto');
    await sleep(250);
    const v8 = await view(), rec8 = JSON.parse(v8.rec);
    const cols = await rowColours(page), px8 = await colourCounts(page, cols.map(c => c.c));
    const h8 = await hover(await plot());
    chk('Orbital period over Auto: the key ends "observed", "projected", every coloured row\'s line is on the canvas in its colour, the chart named "Orbital period history and projection of ...", readings in min, kept as "p":"per" with no "r"',
      v8.pressed.join() === 'cmpr-auto' && v8.key.slice(-2).join() === 'observed,projected' && cols.length >= 2 && px8.every(k => k >= 20) && v8.name.startsWith('Orbital period history and projection of ') &&
      h8.length > 0 && h8.every(r => r.rows.every(q => / min$/.test(q.v))) && rec8.p === 'per' && !('r' in rec8),
      JSON.stringify(v8) + ' / ' + cols.map((c, i) => c.n + ' ' + px8[i]).join(', ') + ' / ' + JSON.stringify(h8.slice(0, 1)));

    // ---- the zoom (a mouse): a drag, a short press, Escape mid-drag, Reset zoom, a double-click, a press of the range
    const auto = await view();
    P = await plot();
    const ym = P.y + P.h / 2;
    await page.mouse.move(across(P, 0.3), ym);
    await page.mouse.down();
    let band = false;
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(across(P, 0.3 + 0.03 * i), ym);
      if (i === 5) band = await page.evaluate(() => { const b = document.getElementById('cmpsel'); return !!b && b.checkVisibility() && b.getBoundingClientRect().width > 0; });
    }
    await page.mouse.up();
    await sleep(200);
    const z = await view();
    const aSpan = auto.t1 - auto.t0;
    chk('a drag from 30 % to 60 % of the plot: the band shows on the way, then that part of Auto\'s window (its start 30 % and its end 60 % of the way across, to 1 % of the span), Reset zoom, the caption ending " · zoomed in", Auto still pressed, the record unchanged, no request',
      band && z.t0 >= auto.t0 && z.t1 <= auto.t1 && Math.abs(z.t0 - (auto.t0 + 0.3 * aSpan)) <= 0.01 * aSpan && Math.abs(z.t1 - (auto.t0 + 0.6 * aSpan)) <= 0.01 * aSpan &&
      z.reset && z.axis.endsWith(' · zoomed in') && z.pressed.join() === 'cmpr-auto' && z.rec === auto.rec && net.total() === 0,
      'band ' + band + '; ' + ((z.t0 - auto.t0) / aSpan).toFixed(4) + ' to ' + ((z.t1 - auto.t0) / aSpan).toFixed(4) + ' of Auto; ' + JSON.stringify(z));
    await page.mouse.move(across(P, 0.5), ym);
    await page.mouse.down();
    await page.mouse.move(across(P, 0.5) + 4, ym);
    await page.mouse.up();
    await sleep(150);
    const z10 = await view();
    chk('a press that moves 4 px zooms nothing', z10.t0 === z.t0 && z10.t1 === z.t1, JSON.stringify([z.t0, z.t1, z10.t0, z10.t1]));
    await page.mouse.move(across(P, 0.2), ym);
    await page.mouse.down();
    await page.mouse.move(across(P, 0.2) + 100, ym, { steps: 5 });
    const band11 = await page.evaluate(() => !!document.getElementById('cmpsel'));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await sleep(150);
    const z11 = await view();
    chk('Escape during a drag: the band goes and nothing is zoomed', band11 && z11.t0 === z.t0 && z11.t1 === z.t1 && !(await page.$('#cmpsel')), 'band ' + band11 + '; ' + JSON.stringify([z11.t0, z11.t1]));
    await page.click('#cmpreset');
    await sleep(200);
    const v12 = await view();
    chk('Reset zoom: Auto\'s window again, Reset zoom gone, the focus on Auto (the range the zoom was made in), the caption no longer "zoomed in"',
      v12.t0 === auto.t0 && v12.t1 === auto.t1 && !v12.reset && !(await page.$('#cmpreset')) && (await focused()) === 'cmpr-auto' && !v12.axis.includes('zoomed in'),
      JSON.stringify(v12) + ' / focus ' + (await focused()));
    P = await plot();
    await page.dblclick('#cmpcv', { position: { x: P.L + (P.w - P.L - P.R) * 0.5, y: P.h / 2 } });
    await sleep(200);
    const v13 = await view();
    await off(P);
    await page.click('#cmpr-auto');
    await sleep(200);
    const v13b = await view();
    chk('a double-click at the middle halves the span (to 1 ms), inside Auto\'s, with Reset zoom; a press of Auto, the one pressed, takes the zoom away',
      Math.abs((v13.t1 - v13.t0) - (auto.t1 - auto.t0) / 2) <= 1 && v13.t0 >= auto.t0 && v13.t1 <= auto.t1 && v13.reset && v13b.t0 === auto.t0 && v13b.t1 === auto.t1 && !v13b.reset,
      JSON.stringify([(v13.t1 - v13.t0) / DAY, (auto.t1 - auto.t0) / DAY, v13.reset, v13b.reset]));

    // ---- the reading slider, from the keyboard
    await page.focus('#cmpscrub');
    await sleep(150);
    const s1 = await reading(), vt1 = (await page.getAttribute('#cmpscrub', 'aria-valuetext')) || '';
    chk('the reading slider, focused: the reading shows, held at the top of the plot (16 px down), and its aria-valuetext ("<day>: ...") names KNACKSAT-2',
      !!s1 && Math.abs(s1.top - 16) <= 4 && /^\d{4}-\d{2}-\d{2}: /.test(vt1) && vt1.includes('KNACKSAT-2'), JSON.stringify(s1) + ' / ' + vt1);
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    await sleep(100);
    const vt2 = (await page.getAttribute('#cmpscrub', 'aria-valuetext')) || '';
    chk('...ten ArrowLeft presses read an earlier day', vt2.slice(0, 10) < vt1.slice(0, 10), vt1.slice(0, 10) + ' -> ' + vt2.slice(0, 10));
    await page.evaluate(() => { window.__keys = []; addEventListener('keydown', e => { if (e.key !== 'Control') window.__keys.push(e.key + (e.defaultPrevented ? ' taken' : '')); }); });
    await page.keyboard.press('Control+Equal');
    await sleep(150);
    const c14 = await view(), keys = await page.evaluate(() => window.__keys);
    chk('...Ctrl with = is left to the browser (the page\'s own zoom): nothing zoomed, the key not taken', !c14.reset && c14.t0 === auto.t0 && c14.t1 === auto.t1 && keys.join() === '=',
      keys.join() + ' / ' + JSON.stringify([c14.reset, c14.t0 - auto.t0, c14.t1 - auto.t1]));
    await page.keyboard.press('=');
    await sleep(200);
    const s3 = await view(), vt3 = (await page.getAttribute('#cmpscrub', 'aria-valuetext')) || '';
    /* the slider stays on its instant through the zoom; when the halved window is held inside Auto's, the nearest of its 240 steps (well
       under a day away) may fall on the next day: a slider sent back to the newest set or the right end would be weeks away */
    chk('...= zooms in: Reset zoom shows, the span halves, the slider keeps the focus and still reads the instant it was at (to a day)',
      s3.reset && Math.abs((s3.t1 - s3.t0) - (auto.t1 - auto.t0) / 2) <= 1 && (await focused()) === 'cmpscrub' && Math.abs(Date.parse(vt3.slice(0, 10)) - Date.parse(vt2.slice(0, 10))) <= DAY,
      JSON.stringify([s3.reset, (s3.t1 - s3.t0) / DAY, (auto.t1 - auto.t0) / DAY]) + ' / ' + vt2.slice(0, 10) + ' -> ' + vt3.slice(0, 10) + ' / focus ' + (await focused()));
    await page.keyboard.press('-');
    await sleep(200);
    const s4 = await view();
    chk('...- takes the zoom away: Auto\'s window, no Reset zoom', !s4.reset && s4.t0 === auto.t0 && s4.t1 === auto.t1, JSON.stringify([s4.reset, s4.t0 - auto.t0, s4.t1 - auto.t1]));
    await page.keyboard.press('Escape');
    await sleep(100);
    const e1 = { tip: !!(await reading()), cross: !!(await page.$('#cmpx')) };
    await page.keyboard.press('ArrowRight');
    await sleep(100);
    const e2 = !!(await page.$('#cmpx'));
    await page.keyboard.press('Tab');
    await sleep(150);
    const e3 = { tip: !!(await reading()), cross: !!(await page.$('#cmpx')), focus: await focused() };
    chk('...Escape hides the reading, the next key brings it back, and Tab away leaves none', !e1.tip && !e1.cross && e2 && !e3.tip && !e3.cross && e3.focus !== 'cmpscrub',
      JSON.stringify([e1, e2, e3]));

    // ---- reload: the quantity and the range kept, a zoom not (reloaded with 90 d pressed, not the default, and a zoom drawn)
    await page.click('#cmpr-90d');
    await sleep(200);
    P = await plot();
    await page.dblclick('#cmpcv', { position: { x: P.L + (P.w - P.L - P.R) * 0.5, y: P.h / 2 } });
    await sleep(200);
    const z15 = await view();
    await off(P);
    const rec15 = await record(page), n15 = net.total();
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await toSection(page);
    await settled(page, 5);
    await page.waitForFunction(() => { const c = document.getElementById('cmpcv'); return !!c && !c.hidden && !!c.dataset.t0; }, null, { timeout: 10000 });
    await sleep(150);
    const v15 = await view(), r15 = JSON.parse(rec15 || '{}');
    chk('after a reload with 90 d pressed and a zoom drawn: Orbital period still shown, 90 d pressed and its window again, no zoom (no Reset zoom), the record as it was ("p":"per","r":"90d", nothing of the zoom), no request',
      z15.reset && z15.pressed.join() === 'cmpr-90d' && z15.t1 - z15.t0 < 90 * DAY && v15.param === 'per' && v15.pressed.join() === 'cmpr-90d' && v15.t0 === v2.t0 && v15.t1 === v2.t1 &&
      !v15.reset && !(await page.$('#cmpreset')) && v15.rec === rec15 && z15.rec === rec15 && r15.p === 'per' && r15.r === '90d' && Object.keys(r15).sort().join() === 'l,o,p,r' && net.total() === n15,
      'zoomed ' + JSON.stringify([z15.reset, z15.pressed, (z15.t1 - z15.t0) / DAY]) + ' / after ' + JSON.stringify(v15) + ' / ' + rec15);
    await page.click('#cmpr-auto');
    await sleep(200);
    await page.selectOption('#cmpparam', 'alt');
    await sleep(200);
    const v16 = await view();
    chk('Mean altitude again: the record is the seeded string (the default view is not written), and the chart\'s name is the first one', v16.rec === seeded && v16.name === v1.name,
      v16.rec + ' / ' + v16.name);

    /* the golden guard again, with the view in the page: as it is now, then with a note, Reset zoom, the reading and its dots */
    const g1 = await goldenIn(page);
    await page.selectOption('#cmpparam', 'hp');
    await sleep(200);
    /* Where the reading slider starts after a draw: on the newest element set's step of its 240 or the one before, never after it
       (Mean perigee altitude has no forecast, so past the last sets no line has a value). Its instant is the window's start plus
       value / 240 of the window. Over Auto, then over a zoom (a double-click about the newest set, a pixel further each time) that
       puts the newest set in the second half of a step, where a start rounded to the nearest step would land after it. */
    const scrubNow = () => page.evaluate(() => {
      const s = document.getElementById('cmpscrub'), c = document.getElementById('cmpcv'), t0 = +c.dataset.t0, t1 = +c.dataset.t1, v = +s.value;
      return { v, t0, t1, t: t0 + v / 240 * (t1 - t0), text: s.getAttribute('aria-valuetext') || '' };
    });
    const place = s => (tLast - s.t0) / (s.t1 - s.t0) * 240;      // the newest set's place on the slider's steps
    const startOk = s => !!s && s.t <= tLast + 1 && s.t > tLast - (s.t1 - s.t0) / 240 - 1 && /^\d{4}-\d{2}-\d{2}: /.test(s.text) && !/no line has a value here/.test(s.text);
    const sA = await scrubNow();
    let sZ = null;
    P = await plot();
    for (let dx = 0; dx < 10 && !sZ; dx++) {
      await page.dblclick('#cmpcv', { position: { x: P.L + (P.w - P.L - P.R) * (tLast - sA.t0) / (sA.t1 - sA.t0) + dx, y: P.h / 2 } });
      await sleep(200);
      const s = await scrubNow(), f = place(s);
      if (s.t1 - s.t0 < sA.t1 - sA.t0 && f > 0 && f < 240 && f - Math.floor(f) >= 0.55) sZ = s;
      await off(P);
      await page.click('#cmpr-auto');                             // the pressed range: the zoom goes
      await sleep(200);
    }
    await page.focus('#cmpscrub');
    await sleep(150);
    const r17 = await reading(), vt17 = (await page.getAttribute('#cmpscrub', 'aria-valuetext')) || '';
    const says = s => s && { v: s.v, place: +place(s).toFixed(3), before: +((tLast - s.t) / DAY).toFixed(3), text: s.text.slice(0, 60) };
    chk('Mean perigee altitude (no forecast past the last sets): the reading slider starts on the newest element set\'s step or the one before, never after it, and reads values there: over Auto, and over a zoom with that set in the second half of a step',
      startOk(sA) && startOk(sZ) && !!r17 && r17.rows.length > 0 && vt17 === sA.text,
      JSON.stringify({ auto: says(sA), zoom: says(sZ), newest: day(tLast) }) + ' / focused ' + vt17.slice(0, 60) + ' / ' + JSON.stringify(r17 && r17.rows.length));
    await page.keyboard.press('=');
    await sleep(200);
    const g2 = await goldenIn(page), there = await page.evaluate(() => ['cmpview', 'cmpaxis', 'cmpscrub', 'cmpnote', 'cmpreset', 'cmptip', 'cmpdots'].filter(id => !document.getElementById(id)));
    chk('with the view bar, the caption, the slider, the note, Reset zoom and the reading in the page, the panel still uses none of the selectors the golden prose reads, and its ids start with cmp',
      golden0 !== null && [g1, g2].every(g => g.sec === golden0 && g.page === 0 && !g.ids.length) && !there.length, JSON.stringify([g1, g2]) + ' (section had ' + golden0 + ' on a fresh visit); missing ' + there.join(' '));
    await ctx.close();
  });

  /* ---- 12. the slider's words name each line in full ----------------------------------------------------------------------------- */
  await part('12. the reading slider says each line\'s full name (1280 light, the sweeps\' seed: ARCTIC WEATHER SATELLITE in colour)', async () => {
    const { ctx, page, net } = await open(browser, srv, { label: 'names', seed: S.compareSeed(Date.now()) });
    await toSection(page);
    /* every cached row read and drawn (the fold shut: 8 of its 9 rows), as verify-layout waits for it */
    await page.waitForFunction(() => {
      const r = document.getElementById('cmprows'), c = document.getElementById('cmpcv'), s = document.getElementById('cmpscrub');
      return !!r && r.children.length === 8 && !/Reading|Queued|Fetching/.test(r.innerText) && !!c && !c.hidden && !!c.dataset.t0 && !!s && !s.hidden;
    }, null, { timeout: 20000 });
    await sleep(200);
    await page.focus('#cmpscrub');
    await sleep(150);
    const vt = (await page.getAttribute('#cmpscrub', 'aria-valuetext')) || '';
    const tipNames = await page.evaluate(() => [...document.querySelectorAll('#cmptip p')].slice(1).map(p => p.querySelector('span').textContent));
    const FULL = 'ARCTIC WEATHER SATELLITE', SHORT = 'ARCTIC WEATHER SA…';   // the readout's shortName: 17 characters and an ellipsis
    chk('the slider\'s aria-valuetext names ARCTIC WEATHER SATELLITE in full, where the reading beside it shortens the name (ARCTIC WEATHER SA…); no request',
      vt.includes(FULL + ' ') && !vt.includes(SHORT) && tipNames.includes(SHORT) && !tipNames.includes(FULL) && net.total() === 0, vt + ' / ' + tipNames.join(', ') + ' / ' + JSON.stringify(net.req));
    await ctx.close();
  });

  console.log('');
  chk('no page errors', allErrs.length === 0, allErrs.slice(0, 6).join(' | '));
  await browser.close();
  await srv.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
