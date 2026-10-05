/* golden.js - the report's prose, against the old page's.
 *
 * The numbers are guarded bit for bit (regress.js). The WORDS are not numbers: the element cards' notes, the osculating and
 * derived values and what is said under them, the headline's sub-line, the pass tables, the facts under the sky plot, the
 * countdown, the method notes, the glossary, the provenance. They were written by hand, sentence by sentence, over a long time,
 * and a rebuild that re-types them silently changes what the page claims. So the old page's own output is captured once, at a
 * frozen instant, over the same 38 spacecraft the numeric baseline uses, two window spans and three sites, and the rebuilt page
 * has to say the same. The golden file is made from the OLD page only and never from the new one.
 *
 *   node verification/golden.js --write                 capture legacy/ into verification/golden.json
 *   node verification/golden.js --write-static          refresh only the part that does not vary (also from legacy/)
 *   node verification/golden.js [--target new|legacy]   capture the target and compare it with the golden file
 *   options: --sats 5 (the first N) or --sats "KNACKSAT-2;ISS (ZARYA)", --sites bangkok,svalbard, --spans 24, --families 25 (how many kinds of difference to show),
 *            --out file.json (write what was captured there instead of comparing: for a look, not a golden)
 *
 * What is compared is text, with its quiet markup kept as marks: an abbreviation's expansion, a line break, bold, a link's
 * target. Runs of ordinary white space collapse; a no-break space does not (the old page binds a figure to its unit with one on
 * purpose). Intentional differences are listed in verification/golden-diffs.json as field -> why: they are counted and named,
 * not hidden, and CHANGES-FROM-LEGACY.md says the same in prose.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./lib/harness');

const FILE = path.join(__dirname, 'golden.json');
const ALLOW = path.join(__dirname, 'golden-diffs.json');
const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);          // the numeric baseline's instant
const SPANS = [24, 72];
/* The default observer, then one in the far north (a polar pass geometry, a +2 offset), then one in the south (a negative
   latitude, a half-hour offset: Adelaide is UTC+9:30 until October). They are typed into the form like a person would. */
const SITES = [
  { id: 'bangkok', set: null },
  { id: 'svalbard', set: { name: 'Svalbard', lat: 78.2297, lon: 15.4075, alt: 0.45, tz: 2 } },
  { id: 'adelaide', set: { name: 'Adelaide', lat: -34.9285, lon: 138.6007, alt: 0.05, tz: 9.5 } }
];

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes('--' + k);

/* What is read off the page: everything here exists, under the same ids and classes, in both builds. It runs in the page, so it
   is one self-contained function whose source is shipped over. */
function READERS() {
  const q = (s, r) => (r || document).querySelector(s), qa = (s, r) => [...(r || document).querySelectorAll(s)];
  const WS = /[ \t\n\r\f]+/g, EDGE = /^[ \t\n\r\f]+|[ \t\n\r\f]+$/g;      // not \s: that would swallow a no-break space
  const ser = n => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return '';
    const tag = n.tagName, inner = [...n.childNodes].map(ser).join('');
    if (tag === 'BR') return '⏎';
    if (tag === 'ABBR' && n.getAttribute('title')) return '⟦' + inner + '|' + n.getAttribute('title') + '⟧';
    if (tag === 'A' && n.getAttribute('href')) return '⟨' + inner + '→' + n.getAttribute('href') + '⟩';
    if (tag === 'B' || tag === 'STRONG') return '*' + inner + '*';
    return inner;
  };
  const clean = s => s.replace(WS, ' ').replace(EDGE, '');
  const txt = e => (e ? clean([...e.childNodes].map(ser).join('')) : null);     // what is inside; its own tag is the page's business
  const t = id => txt(document.getElementById(id));
  const shown = id => { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; };
  const when = id => (shown(id) ? t(id) : null);
  const rows = sel => qa(sel).map(d => [txt(q('dt', d)), txt(q('dd', d))]);
  const cells = sel => qa(sel + ' tr').map(tr => [...tr.children].map(txt));
  const readout = () => ({ lat: t('r-lat'), lon: t('r-lon'), alt: t('r-alt'), el: t('r-el'), az: t('r-az'), rng: t('r-rng') });
  /* #o3el, the elevation now, is written by the 3D scene's own loop, so it is not read here */
  const countdown = () => ({ label: t('cdlabel'), value: t('cdvalue'), when: t('cdwhen') });
  /* The old page repaints the downlink bar only for a pass: a spacecraft with none is left showing the PREVIOUS one's bar. That is
     a leftover, not a sentence, and it makes the bar depend on the order things were visited in, so it is read only where it
     belongs. */
  const sky = () => ({
    facts: qa('#skyfacts .row').map(r => [txt(q('.k', r)), txt(q('.v', r))]),
    cap: t('sky2cap'),
    dop: !qa('#passlist .passrow').length ? null
      : { options: qa('#dopsel option').map(o => clean(o.textContent)), freq: (q('#dopfreq') || {}).value || null, none: txt(q('#dopbar .none')) }
  });
  /* what changes with the spacecraft, the window and the observer */
  const STATE = () => ({
    name: t('satname'),
    head: { vis: t('lbl-vis'), big: t('totalbig'), sub: t('totalsub'), reentry: when('reentry'), brief: when('briefnote'), custom: when('customnote'), load: when('loadnote') },
    id: { norad: t('idnorad'), cospar: t('idcospar'), epoch: t('idepoch'), age: t('agetext'),
          stale: !!(document.getElementById('agechip') && document.getElementById('agechip').classList.contains('stale')) },
    elements: qa('#elgrid .el').map(e => [txt(q('.sym', e)), txt(q('.val', e)), txt(q('.note', e)), txt(q('.src', e))]),
    osc: rows('#osc .dv'), oscnote: t('oscnote'),
    derived: rows('#derived .dv'), dnote: t('dnote'),
    mini: rows('#minigrid .dv'),
    passes: {
      n: t('npasses'), longest: t('longest'), best: t('bestel'),
      rows: qa('#passbody tr').map(tr => [...tr.children].map(txt)),
      foot: cells('#passfoot'), note: when('passnote'),
      list: qa('#passlist .passrow').map(b => [b.getAttribute('aria-label'), b.getAttribute('title'),
        clean(b.querySelector('.t').firstChild.textContent), txt(q('.t small', b)), clean(b.querySelector('.e').firstChild.textContent)]),
      listNone: txt(q('#passlist > p'))
    },
    track: { h2: txt(q('#sec-track h2')), hint: t('trackhint'), inview: t('lbl-inview'), sitepos: t('lbl-sitepos'), sitering: t('lbl-sitering'),
             roel: t('lbl-roel'), roaz: t('lbl-roaz') },
    access: { h2: txt(q('#sec-access h2')), hint: t('lbl-acchint'), tz: t('lbl-tz2'), elnow: t('lbl-elnow') },
    method: { anaive: t('anaive'), scan: t('lbl-scan'), sample: t('lbl-sample'), prose: t('lbl-prose') },
    foot: t('footepoch'),
    prov: { rail: t('railprov'), meta: t('tlemeta'), raw: t('tleraw') },
    life: { span: t('lifespan'), big: t('lifebig'), sub: t('lifesub'), alt: t('lifealt'), rate: t('liferate'), hist: t('lifehist'), note: t('lifenote') }
  });
  /* what does not. These ids hold words that change with the state: the state part has them. */
  const DYN = new Set(['trackhint', 'lbl-inview', 'lbl-sitepos', 'lbl-sitering', 'lbl-roel', 'lbl-roaz', 'lbl-acchint', 'sky2cap', 'lifespan', 'lbl-vis', 'srcline']);
  const quiet = e => !DYN.has(e.id) && !DYN.has((e.querySelector('[id]') || {}).id);
  const STATIC = () => ({
    terms: qa('#sec-terms .terms > div').map(d => [d.id, txt(q('dt', d)), txt(q('dd', d))]),
    method: qa('#sec-method .method > div').map(d => [txt(q('h3', d)), txt(q('p', d))]),
    /* the words around each section's content, by section: where a section is not there, that is one difference, not a shift of
       every one after it */
    chrome: Object.fromEntries(qa('#report section').filter(s => !['sec-terms', 'sec-method', 'sec-prof'].includes(s.id))
      .map(s => [s.id, qa('h2, .hint, .eyebrow, th, figcaption, .passnote, .access dt, .life dt', s)
        .filter(e => !e.closest('#osc, #derived, #elgrid, #passbody, #passfoot') && quiet(e)).map(txt)])),
    /* the map's key and its readout labels, and the export buttons: the old page kept them in the report, the new one keeps them
       where they are used (the map stage, the pass list) */
    legend: qa('.legend .key, .legend li').filter(quiet).map(txt),
    readout: qa('.readout dt, .readouts dt').filter(quiet).map(txt),
    exports: [t('exp-csv'), t('exp-ics')],
    foot: qa('#report footer span').slice(1).map(txt)
  });
  const PASS = () => ({ readout: readout(), countdown: countdown(), sky: sky() });
  return { STATE, STATIC, PASS };
}

async function capture(target, opts) {
  const { chromium } = H.playwright();
  const srv = await H.up({ target });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'UTC', locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  /* a refused request is what the offline profile is for; any other error in the page is a failure of the page */
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.clock.setFixedTime(new Date(T0));
  await page.goto(srv.page, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  /* Paused, the clock is at the window start after every load: the countdown is then a pure function of the page's state. */
  if ((await page.getAttribute('#tpplay', 'aria-label')) === 'Pause') await page.evaluate(() => document.getElementById('tpplay').click());
  await page.evaluate(`window.__R = (${READERS.toString()})()`);

  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline.json'), 'utf8'));
  let names = Object.keys(baseline.sats);
  if (opts.sats) names = /^d+$/.test(opts.sats) ? names.slice(0, +opts.sats) : opts.sats.split(';');     // the first N, or these, by name
  const sites = SITES.filter(s => !opts.sites || opts.sites.split(',').includes(s.id));
  const spans = SPANS.filter(h => !opts.spans || opts.spans.split(',').map(Number).includes(h));

  if (opts.staticOnly) {
    const o = { static: await page.evaluate(() => window.__R.STATIC()), errors: errs };
    await browser.close(); await srv.close();
    return o;
  }
  const out = { meta: { t0: T0, sites: SITES.map(s => s.id), spans: SPANS, sats: Object.keys(baseline.sats) }, static: null, records: {} };
  out.static = await page.evaluate(() => window.__R.STATIC());

  for (const site of sites) {
    if (site.set) await H.setSite(page, site.set);
    await page.waitForTimeout(500);
    for (const h of spans) {
      await H.clickWindow(page, '[data-h="' + h + '"]');
      await page.waitForTimeout(400);
      for (const name of names) {
        await H.pickExact(page, name);
        /* the analysis and the title both say it: a record is never read off the spacecraft before */
        await page.waitForFunction(n => !!window.__gt.D && window.__gt.D.entry.name === n && document.getElementById('satname').textContent === n, name, { timeout: 15000 })
          .catch(async () => { throw new Error('could not load ' + name + '; the page shows ' + (await page.evaluate(() => document.getElementById('satname').textContent))); });
        await page.waitForTimeout(350);
        const rec = await page.evaluate(() => Object.assign(window.__R.STATE(), { at0: window.__R.PASS() }));
        /* the clock to the last pass's culmination: the "in view" branch of the countdown, the readout at a high elevation, and
           the sky facts of a second pass */
        const n = await page.evaluate(() => document.querySelectorAll('#passlist .passrow').length);
        if (n > 0) {
          await page.evaluate(() => { const b = document.querySelectorAll('#passlist .passrow'); b[b.length - 1].click(); });
          await page.waitForTimeout(150);
          rec.atLast = await page.evaluate(() => window.__R.PASS());
        }
        out.records[site.id + '|' + h + '|' + name] = rec;
      }
    }
  }
  await browser.close(); await srv.close();
  out.errors = errs;
  return out;
}

/* ---- comparing ------------------------------------------------------------------------------------------------ */
function flatten(v, p, out) {
  if (Array.isArray(v)) { if (!v.length) out[p + '[]'] = '(none)'; v.forEach((x, i) => flatten(x, p + '[' + i + ']', out)); }
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) flatten(v[k], p ? p + '.' + k : k, out);
  else out[p] = v;
  return out;
}
const family = p => p.replace(/\[\d+\]/g, '[]');

function compare(gold, got, allow) {
  const real = [], allowed = [];
  const diffMaps = (id, a, b) => {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] === b[k]) continue;
      const fam = allow[k] ? k : family(k);
      (allow[fam] ? allowed : real).push({ id, field: k, fam, was: a[k], now: b[k] });
    }
  };
  diffMaps('static', flatten(gold.static, '', {}), flatten(got.static, '', {}));
  for (const id of Object.keys(gold.records)) {
    if (!(id in got.records)) { if (!got.partial) real.push({ id, field: '(record)', fam: '(record)', was: 'captured', now: 'missing' }); continue; }
    diffMaps(id, flatten(gold.records[id], '', {}), flatten(got.records[id], '', {}));
  }
  return { real, allowed };
}

/* a no-break space is shown as a visible mark: the two strings of a difference can look the same on a screen */
const cut = (v, n) => { const s = JSON.stringify(v); return s && (s.length > n ? s.slice(0, n) + '...' : s).replace(/ /g, '⍒'); };

(async () => {
  const write = has('write'), writeStatic = has('write-static');
  if (write || writeStatic) {
    if (process.env.GT_URL) throw new Error('the golden file is made from legacy/, not from a URL');
    process.env.GT_TARGET = 'legacy';                 // never from the rebuilt page: the file is the old page's, or it is worthless
  }
  const target = write || writeStatic ? 'legacy' : arg('target', process.env.GT_TARGET || 'new');
  const opts = { sats: arg('sats'), sites: arg('sites'), spans: arg('spans'), staticOnly: writeStatic };
  const subset = !!(opts.sats || opts.sites || opts.spans);
  console.log('capturing ' + target + (subset ? ' (a subset)' : '') + ' ...');
  const t0 = Date.now();
  const got = await capture(target, opts);
  if (writeStatic) {
    const gold = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    gold.static = got.static;
    fs.writeFileSync(FILE, JSON.stringify(gold));
    console.log('rewrote the static part of ' + path.relative(process.cwd(), FILE) + ' from legacy/ (' + Object.keys(gold.records).length + ' records kept)');
    return;
  }
  console.log('  ' + Object.keys(got.records).length + ' records in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s; page errors: ' +
              (got.errors.length ? got.errors.length + ': ' + got.errors.slice(0, 2).join(' | ') : 'none'));
  if (arg('out')) {                                    // a look at what was captured, for any target and any subset
    fs.writeFileSync(arg('out'), JSON.stringify(got, null, 1));
    console.log('wrote ' + arg('out'));
    return;
  }
  if (write) {
    if (subset) throw new Error('the golden file is the whole matrix: no subsets');
    delete got.errors;
    fs.writeFileSync(FILE, JSON.stringify(got));
    console.log('wrote ' + path.relative(process.cwd(), FILE) + ' (' + (fs.statSync(FILE).size / 1024).toFixed(0) + ' KB)');
    return;
  }
  const gold = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  got.partial = subset;
  const allow = fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, 'utf8')) : {};
  const { real, allowed } = compare(gold, got, allow);
  const fams = new Map();
  for (const d of real) { const e = fams.get(d.fam) || { n: 0, first: d }; e.n++; fams.set(d.fam, e); }
  const aFams = new Map();
  for (const d of allowed) aFams.set(d.fam, (aFams.get(d.fam) || 0) + 1);
  console.log('\n' + allowed.length + ' difference(s) in ' + aFams.size + ' field(s) are listed as intentional; ' + real.length + ' in ' + fams.size + ' field(s) are not.');
  for (const [k, n] of aFams) console.log('   listed  ' + String(n).padStart(5) + '  ' + k + '  - ' + allow[k]);
  if (real.length) {
    console.log('\nnot listed:');
    const list = [...fams].sort((a, b) => b[1].n - a[1].n);
    for (const [k, e] of list) console.log('  ' + String(e.n).padStart(5) + '  ' + k);
    console.log('\none example of each (the first ' + (+arg('families', 25)) + '):');
    for (const [k, e] of list.slice(0, +arg('families', 25))) {
      console.log('  ' + e.first.field + '   [' + e.first.id + ']\n     was: ' + cut(e.first.was, 320) + '\n     now: ' + cut(e.first.now, 320));
    }
  }
  process.exitCode = real.length || got.errors.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
