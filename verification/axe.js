/* axe.js - an accessibility sweep of the console: the rules axe-core knows, at the viewports and in the
 * themes a design review looks at, in the states that change what is on screen.
 *
 *   npm run build && node verification/axe.js [--strict] [--only desktop,phone]
 *
 * It reports; it does not fail unless --strict is given (then any violation does). The legacy page is the
 * ceiling the final milestone enforces, so the first job of this script is to say what there is today.
 * Colour contrast is checked in both themes, which is where a design system usually slips.
 */
'use strict';
const H = require('./lib/harness');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const STRICT = process.argv.includes('--strict');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const NOW = new Date('2026-10-05T12:00:00Z');

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
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, hasTouch: v.touch, isMobile: v.touch && v.w < 720 });
      await ctx.addInitScript(t => { try { localStorage.setItem('gt.prefs', JSON.stringify({ theme: t })); } catch (e) {} }, theme);
      await ctx.clock.install({ time: NOW });
      const page = await ctx.newPage();
      await page.goto(srv.page, { waitUntil: 'load' });
      await page.waitForSelector('#totalbig', { state: 'attached', timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => document.getElementById('tpplay').click());
      /* the scene is a chunk of its own and the globe draws a moment after the page: wait for its first label */
      await page.waitForFunction(() => { const n = document.getElementById('o3name'); return !!n && n.textContent !== '—' && n.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);

      const states = [
        ['default', async () => {}],
        ['layers', async () => { await page.evaluate(() => document.getElementById('layerstoggle').click()); await page.waitForTimeout(250); }],
        ['map', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Map').click()); await page.waitForTimeout(400); }],
        ['window', async () => { await page.evaluate(() => document.getElementById('winOpen').click()); await page.waitForTimeout(250); }],
        ['picker', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('#satname').closest('button').click()); await page.waitForTimeout(250); }],
        /* the orbit planner: the pill brings its chunk in and opens it (the three presentations - flow, drawer, sheet - are what the viewports are for) */
        ['planner', async () => {
          await page.keyboard.press('Escape');
          await page.evaluate(() => document.getElementById('planopen').click());
          await page.waitForFunction(() => { const p = document.getElementById('planner'); return !!p && !p.hidden; }, null, { timeout: 20000 });
          await page.waitForTimeout(400);
        }]
      ];
      if (v.id === 'phone') states.splice(1, 0, ['answer', async () => { await page.evaluate(() => document.querySelector('.peek').click()); await page.waitForTimeout(250); }]);

      for (const [name, go] of states) {
        await go();
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
        const label = v.id + '/' + theme + '/' + name;
        if (!r.violations.length) { ok++; continue; }
        for (const x of r.violations) {
          total += x.nodes.length;
          const g = rules.get(x.id) || { impact: x.impact, help: x.help, nodes: 0, where: new Set(), samples: new Set() };
          g.nodes += x.nodes.length; g.where.add(label);
          for (const n of x.nodes.slice(0, 2)) g.samples.add(n.target.join(' ') + '  ' + ((n.failureSummary || '').split('\n')[1] || '').trim());
          rules.set(x.id, g);
        }
      }
      await ctx.close();
    }
  }
  await browser.close();
  await srv.close();
  for (const [id, g] of rules) {
    console.log('  FAIL  ' + id + ' (' + g.impact + ') x' + g.nodes + '  ' + g.help);
    console.log('          in ' + g.where.size + ' state(s): ' + [...g.where].slice(0, 6).join(', ') + (g.where.size > 6 ? ', ...' : ''));
    for (const t of [...g.samples].slice(0, 2)) console.log('          ' + t);
  }
  console.log('\n' + ok + ' clean state(s); ' + (total ? total + ' violating node(s) in ' + rules.size + ' rule(s)' : 'no violations'));
  if (STRICT && total) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
