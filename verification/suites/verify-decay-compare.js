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
const body = n => { const c = curve(n); return S.plot(S.falling(Date.now(), 0.001, c[2], c[0], c[1], c[3])); };
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
    const golden0 = await page.evaluate(([a]) => document.getElementById('sec-life').querySelectorAll(a).length, [GOLDEN_SEC]);

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
    const gold = await page.evaluate(([a, b]) => {
      const sec = document.getElementById('sec-life'), p = document.getElementById('cmppanel');
      const ids = [...p.querySelectorAll('[id]')].map(e => e.id).concat(['cmpopen', 'cmpfail', 'cmppanel']).filter(id => !/^(cmp|copt-|pop-)/.test(id));
      return { sec: sec.querySelectorAll(a).length, page: p.querySelectorAll(b + ', dt, section, .legend, .hint, .eyebrow, h2, th, figcaption, .passnote').length, ids };
    }, [GOLDEN_SEC, GOLDEN_PAGE]);
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
    const small = await page.evaluate(() => [...document.querySelectorAll('#sec-life h3, #cmpfail, #cmppanel *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) &&
      !e.closest('.sr-only') && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.tagName + '.' + e.className));
    chk('no text under 12 px', small.length === 0, small.join(' '));
    /* [how many controls are on the screen, those under 44 px] */
    const taps = sel => page.evaluate(s => {
      const all = [...document.querySelectorAll(s)].filter(b => b.offsetParent)
        .map(b => { const r = b.getBoundingClientRect(); return [b.id || b.getAttribute('aria-label') || b.className, Math.round(r.width), Math.round(r.height)]; });
      return [all.length, all.filter(([, w, h]) => w < 44 || h < 44)];
    }, sel);
    const [k1, t1] = await taps('#cmpopen, #cmppanel button');
    chk('every control of the panel is 44 px or more both ways', k1 >= 10 && t1.length === 0, k1 + ' controls; ' + JSON.stringify(t1));
    await page.click('#cmpadd');
    await page.fill('#cmpsearch', 'lemur');
    await sleep(300);
    const [k2, t2] = await taps('#cmppanel [role=option]');
    const inView = await page.evaluate(() => { const d = document.querySelector('[role=dialog][aria-label="Add a spacecraft to compare"]').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth; });
    chk('the search is inside the screen, its options 44 px tall', inView && k2 >= 3 && t2.length === 0, k2 + ' options; ' + JSON.stringify(t2));
    chk('...and the page still does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
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

  console.log('');
  chk('no page errors', allErrs.length === 0, allErrs.slice(0, 6).join(' | '));
  await browser.close();
  await srv.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
