/* axe.js - an accessibility sweep of the console: the rules axe-core knows, at the viewports and in the
 * themes a design review looks at, in the states that change what is on screen.
 *
 *   npm run build && node verification/suites/axe.js [--strict] [--only desktop,phone]
 *
 * It reports; it does not fail unless --strict is given (then any violation not listed in ALLOWED does). The old page was the ceiling:
 * measured on its default state alone at these ten viewport/scheme pairs it had 293 violating nodes in 7 rules (region, color-contrast,
 * heading-order, html-has-lang, landmark-no-duplicate-contentinfo, landmark-unique, scrollable-region-focusable); this page has the one
 * below, in every state, and nothing else. Colour contrast is checked in both themes, which is where a design system usually slips.
 * The decay comparison's three states are scanned on a second page, whose storage alone holds a comparison left open (lib/decay-compare-seed.js).
 */
'use strict';
const H = require('../lib/harness');
const CMP = require('../lib/decay-compare-seed');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const STRICT = process.argv.includes('--strict');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const NOW = new Date('2026-10-05T12:00:00Z');
/* What is known and accepted, with the reason. A rule not here fails --strict. */
const ALLOWED = {
  'heading-order': "the Professor's notes (the report's #sec-prof and the planner's panel) are built by the planner's controller, whose markup is held identical to the old page's (tests/components/planner-markup.test.ts, scripts/compare-planner-markup.mjs): its items are h4 under the section's h2. The old page has the same, once in every state."
};

const VIEWS = [
  { id: 'desktop', w: 1440, h: 900, touch: false },
  { id: 'laptop', w: 1024, h: 650, touch: false },
  { id: 'tablet', w: 768, h: 1024, touch: true },
  { id: 'phone', w: 390, h: 844, touch: true },
  { id: 'landscape', w: 844, h: 390, touch: true }
].filter(v => !ONLY.length || ONLY.includes(v.id));

(async () => {
  const AxeBuilder = require('@axe-core/playwright').default || require('@axe-core/playwright');
  const srv = await H.up({ target: 'new' });
  const { chromium } = H.playwright({ testFlag: false });
  /* software WebGL, so the globe is really there to be scanned: the page opens on it */
  const browser = await chromium.launch({ args: H.GL_ARGS });
  let total = 0, ok = 0;
  const rules = new Map();   // rule id -> what failed, where, and a sample

  for (const v of VIEWS) {
    for (const theme of ['light', 'dark']) {
      /* the page the states start from, in this view and theme; `seed` is written into this page's storage alone, before its code runs */
      const open = async seed => {
        const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, hasTouch: v.touch, isMobile: v.touch && v.w < 720 });
        await ctx.addInitScript(t => { try { localStorage.setItem('gt.prefs', JSON.stringify({ theme: t })); } catch (e) {} }, theme);
        await ctx.clock.install({ time: NOW });
        const page = await ctx.newPage();
        if (seed) await page.addInitScript(CMP.seedStorage, seed);
        await page.goto(srv.page, { waitUntil: 'load' });
        await page.waitForSelector('#totalbig', { state: 'attached', timeout: 30000 });
        await page.waitForSelector('#sec-terms', { state: 'attached', timeout: 30000 });    // the report is a chunk of its own, fetched when the browser is idle: scan it too
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => document.getElementById('tpplay').click());
        /* the scene is a chunk of its own and the globe draws a moment after the page: wait for its first label */
        await page.waitForFunction(() => { const n = document.getElementById('o3name'); return !!n && n.textContent !== '—' && n.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(400);
        return { ctx, page };
      };
      const scan = async (page, name) => {
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
        const label = v.id + '/' + theme + '/' + name;
        if (!r.violations.length) { ok++; return; }
        for (const x of r.violations) {
          total += x.nodes.length;
          const g = rules.get(x.id) || { impact: x.impact, help: x.help, nodes: 0, where: new Set(), samples: new Set() };
          g.nodes += x.nodes.length; g.where.add(label);
          for (const n of x.nodes.slice(0, 2)) g.samples.add(n.target.join(' ') + '  ' + ((n.failureSummary || '').split('\n')[1] || '').trim());
          rules.set(x.id, g);
        }
      };
      const { ctx, page } = await open(null);

      const states = [
        ['default', async () => {}],
        ['layers', async () => { await page.evaluate(() => document.getElementById('layerstoggle').click()); await page.waitForTimeout(250); }],
        ['map', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Map').click()); await page.waitForTimeout(400); }],
        ['window', async () => { await page.evaluate(() => document.getElementById('winOpen').click()); await page.waitForTimeout(250); }],
        ['picker', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('#satname').closest('button').click()); await page.waitForTimeout(250); }],
        /* ...on a query with rows SGP4 has down at NOW, each marked "decayed now" in plain text inside its option, and the line under the list
           that says what the mark is (CHANGES-FROM-LEGACY.md, L59; worked out in a chunk of its own when the list first opens) */
        ['decayed', async () => { await page.fill('#satsearch', 'jilin-01 gaofen 3'); await page.waitForSelector('#satdecayed', { state: 'visible', timeout: 10000 }); }],
        /* ...on a query only the other names match (CHANGES-FROM-LEGACY.md, L61): OSCAR 7 and FUNCUBE 1, each option saying in plain text which
           name matched ("matches AO-7"), the first row the active one; the table is a chunk of its own, asked for at the first query */
        ['alias', async () => { await page.fill('#satsearch', 'ao7'); await page.waitForSelector('#satlist .al', { state: 'visible', timeout: 10000 }); }],
        /* the watchlist (CHANGES-FROM-LEGACY.md, L60): the star on the identity line pressed (a toggle button, aria-pressed; outside the listbox, so no
           control sits inside an option), and the list opened again on the empty query, with the group of the watched over the catalogue */
        ['watched', async () => {
          await page.keyboard.press('Escape');
          await page.waitForSelector('#satsearch', { state: 'detached', timeout: 5000 }).catch(() => {});
          await page.evaluate(() => document.getElementById('watchstar').click());
          await page.waitForFunction(() => document.getElementById('watchstar').getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
          await page.evaluate(() => document.querySelector('#satname').closest('button').click());
          await page.waitForFunction(() => { const g = document.querySelector('#satlist li.grp'); return !!g && g.textContent === 'Watched'; }, null, { timeout: 5000 });
          await page.waitForTimeout(250);
        }],
        /* the observer form, with a four-character grid square typed: the square and the button to the place search are listed, found on the page
           with no request (CHANGES-FROM-LEGACY.md, L51). The field is left without the focus, so that the next state's Escape closes the form
           (in the field, with the list open, Escape closes the list and stops there). */
        ['observer', async () => {
          await page.keyboard.press('Escape');
          await page.evaluate(() => document.getElementById('siteopen').click());
          await page.waitForSelector('#s-search', { state: 'visible', timeout: 5000 });
          await page.fill('#s-search', 'OK03');
          await page.press('#s-search', 'Enter');
          await page.waitForSelector('#s-gridplaces', { state: 'visible', timeout: 5000 });
          await page.evaluate(() => document.activeElement && document.activeElement.blur());
          await page.waitForTimeout(250);
        }],
        /* the pass list's filter, open (CHANGES-FROM-LEGACY.md, L56): a popover in the rail, on a phone inside the answer sheet (opened first), whose
           panel is a chunk of its own asked for at the first press. Escape with it open shuts the panel alone, wherever the focus is, so the next
           state presses Escape twice: the panel, then (on a phone) the sheet. */
        ['passfilter', async () => {
          await page.keyboard.press('Escape');
          await page.evaluate(() => { const p = document.querySelector('.rail .peek'); if (p && p.getAttribute('aria-expanded') !== 'true') p.click(); });
          await page.waitForTimeout(250);
          await page.evaluate(() => document.getElementById('passfilterbtn').click());
          await page.waitForSelector('#passfilter', { state: 'visible', timeout: 10000 });
          await page.waitForTimeout(250);     // the popover moves the focus into its panel a frame after it opens
        }],
        /* the orbit planner: the pill brings its chunk in and opens it (the three presentations - flow, drawer, sheet - are what the viewports are for) */
        ['planner', async () => {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(100);
          await page.keyboard.press('Escape');     // the filter's panel above, then the answer sheet it was in
          await page.evaluate(() => document.getElementById('planopen').click());
          await page.waitForFunction(() => { const p = document.getElementById('planner'); return !!p && !p.hidden; }, null, { timeout: 20000 });
          await page.waitForTimeout(400);
        }]
      ];
      if (v.id === 'phone') states.splice(1, 0, ['answer', async () => { await page.evaluate(() => document.querySelector('.peek').click()); await page.waitForTimeout(250); }]);

      for (const [name, go] of states) { await go(); await scan(page, name); }
      await ctx.close();

      /* the decay comparison (CHANGES-FROM-LEGACY.md, L66), on a page of its own whose storage holds a comparison left open (lib/decay-compare-seed.js,
         that page alone: no other state has it), so it opens from the cache as the section comes near, with no request: nine rows with the fold
         opened (the selected spacecraft and four more in colour, two grey, one waiting with its Fetch, one too high to draw with its reason), the
         chart and its key; then its search, on a query whose options carry the marks "in the comparison" and "decayed now" in plain text, the
         first one active, with the line that says what the second mark is; then the chart's view changed and zoomed (L67) */
      const two = await open(CMP.compareSeed(NOW.getTime()));
      const p2 = two.page;
      for (const [name, go] of [
        ['decay-compare', async () => {
          await p2.evaluate(() => document.getElementById('cmpopen').scrollIntoView({ block: 'center' }));
          await p2.waitForFunction(() => {
            const r = document.getElementById('cmprows'), cv = document.getElementById('cmpcv');
            return !!r && r.children.length === 8 && !/Reading|Queued|Fetching/.test(r.innerText) && !!cv && !cv.hidden && !!document.getElementById('cmpmore');
          }, null, { timeout: 20000 });
          await p2.evaluate(() => document.getElementById('cmpmore').click());
          await p2.waitForFunction(n => document.getElementById('cmprows').children.length === n, CMP.SEED_ROWS, { timeout: 5000 });
          await p2.waitForTimeout(250);
        }],
        ['decay-compare-add', async () => {
          await p2.evaluate(() => document.getElementById('cmpadd').click());
          await p2.waitForSelector('#cmpsearch', { state: 'visible', timeout: 5000 });
          await p2.fill('#cmpsearch', 'jilin-01 gaofen 3');
          await p2.waitForSelector('#cmpdecayed', { state: 'visible', timeout: 10000 });
          await p2.waitForTimeout(250);
        }],
        /* ...and its chart's view (L67), the search shut: the group "Range" with 30 d pressed, Show (a labelled select) at Mean perigee
           altitude, the caption with "zoomed in" and Reset zoom, the note under the key, and the reading slider (named, with its
           aria-valuetext and its keys described) focused after a plus, its reading held over the plot with a dot on each line */
        ['decay-compare-view', async () => {
          await p2.keyboard.press('Escape');
          await p2.waitForSelector('#cmpsearch', { state: 'detached', timeout: 5000 }).catch(() => {});
          await p2.selectOption('#cmpparam', 'hp');
          await p2.click('#cmpr-30d');
          await p2.focus('#cmpscrub');
          await p2.keyboard.press('=');
          await p2.waitForSelector('#cmpreset', { state: 'visible', timeout: 5000 });
          await p2.waitForSelector('#cmptip', { state: 'visible', timeout: 5000 });
          await p2.waitForTimeout(250);
        }]
      ]) { await go(); await scan(p2, name); }
      await two.ctx.close();
    }
  }
  await browser.close();
  await srv.close();
  for (const [id, g] of rules) {
    console.log('  ' + (ALLOWED[id] ? 'ALLOWED' : 'FAIL') + '  ' + id + ' (' + g.impact + ') x' + g.nodes + '  ' + g.help);
    console.log('          in ' + g.where.size + ' state(s): ' + [...g.where].slice(0, 6).join(', ') + (g.where.size > 6 ? ', ...' : ''));
    for (const t of [...g.samples].slice(0, 2)) console.log('          ' + t);
  }
  for (const [id] of rules) if (ALLOWED[id]) console.log('  ' + id + ' is allowed: ' + ALLOWED[id]);
  const blocking = [...rules].filter(([id]) => !ALLOWED[id]);
  console.log('\n' + ok + ' clean state(s); ' + (total ? total + ' violating node(s) in ' + rules.size + ' rule(s), ' + blocking.length + ' not allowed' : 'no violations'));
  if (STRICT && blocking.length) process.exitCode = 1;
  else if (STRICT) console.log('ALL CHECKS PASS (axe, strict: nothing but what is allowed)');
})().catch(e => { console.error(e); process.exitCode = 1; });
