/* screens.js - the console as a design review sees it: four viewports in two themes, plus the states that
 * change the layout (the phone's answer sheet open, the picker, the window popover).
 *
 *   npm run build && node verification/screens.js [--out verification/screens] [--only desktop,phone]
 *
 * Pictures, not a test: nothing is compared. They are written to verification/screens/ (ignored by git)
 * so the folder always holds the last run. The clock is fixed at a known instant and the transport paused,
 * so two runs of the same build give the same picture and a diff between builds is a diff of the design.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./lib/harness');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(__dirname, 'screens')));
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const NOW = new Date('2026-10-05T12:00:00Z');

const VIEWS = [
  { id: 'desktop', w: 1440, h: 900, dpr: 1, touch: false },
  { id: 'tablet', w: 768, h: 1024, dpr: 1, touch: true },
  { id: 'phone', w: 390, h: 844, dpr: 2, touch: true },
  { id: 'landscape', w: 844, h: 390, dpr: 2, touch: true }
].filter(v => !ONLY.length || ONLY.includes(v.id));
const THEMES = ['light', 'dark'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await H.up({ target: 'new' });
  const { chromium } = H.playwright({ testFlag: false });
  const browser = await chromium.launch();
  const written = [];

  for (const v of VIEWS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({
        viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.dpr, colorScheme: theme,
        isMobile: v.touch && v.w < 720, hasTouch: v.touch
      });
      await ctx.addInitScript(t => { try { localStorage.setItem('gt.prefs', JSON.stringify({ theme: t })); } catch (e) {} }, theme);
      await ctx.clock.install({ time: NOW });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

      await page.goto(srv.page, { waitUntil: 'load' });
      await page.waitForSelector('#totalbig', { state: 'attached', timeout: 30000 });   // folded away in the phone's sheet
      await page.evaluate(() => document.fonts.ready);
      /* pause (a picture of one instant) without Playwright scrolling the button into view, which would move the page */
      await page.evaluate(() => document.getElementById('tpplay').click());
      await page.waitForTimeout(400);

      const snap = async name => {
        await page.evaluate(() => window.scrollTo(0, 0));
        const file = path.join(OUT, name + '.png');
        await page.screenshot({ path: file });
        written.push(file);
      };
      const base = v.id + '-' + theme;
      await snap(base);

      if (v.id === 'phone') {
        await page.click('.peek');
        await page.waitForTimeout(250);
        await snap(base + '-answer');
      }
      if (v.id === 'desktop') {
        const pop = theme === 'light' ? ['#satname', 'picker'] : ['text=/Window ·/', 'window'];
        await page.click(pop[0]);
        await page.waitForTimeout(250);
        await snap(base + '-' + pop[1]);
      }
      if (errs.length) console.log('  page errors at ' + base + ': ' + errs.join(' | '));
      await ctx.close();
    }
  }

  await browser.close();
  await srv.close();
  console.log(written.length + ' pictures in ' + OUT);
  for (const f of written) console.log('  ' + path.relative(process.cwd(), f));
})().catch(e => { console.error(e); process.exitCode = 1; });
