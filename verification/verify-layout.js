/*
 * The console's layout, at the sizes it is read at: a 1440x900 window, a
 * 768x1024 tablet, a 390x844 phone and the same phone held sideways.
 *
 * Each check here is a defect that shipped:
 *
 *   - on a phone the layers panel hung open over half the globe and the clock,
 *     with nothing that closed it;
 *   - the transport bar was sticky at the foot of the screen and wraps to four
 *     rows there, so the camera and trail buttons along the globe's lower edge
 *     were under it - a tap on Free landed on the transport;
 *   - below 900 px every caption was hidden, leaving three unlabelled rows of
 *     "6 h" / "24 h" that do three different things;
 *   - nothing on the first screen said where the elements, the ground track and
 *     the pass table were, and the Moon pages were a link a thousand pixels down
 *     a rail that scrolls on its own;
 *   - much of the data text was 9 to 10.5 px, the local pass times included;
 *   - AOS, LOS, COSPAR, TEME, B*'s 1/ER and the rest were used and never said.
 *
 * "Covered" is measured, not inferred from z-index: elementFromPoint at the
 * centre of every button, with the page scrolled so the globe's lower edge is
 * at the foot of the screen - where a sticky bar would sit on it - and again
 * with its top edge at the top.
 *
 * Served over http, like the other page checks.
 *
 *   node verification/verify-layout.js        (needs playwright)
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.jpg':'image/jpeg', '.png':'image/png', '.css':'text/css' };
function serve(){
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
        res.writeHead(404); return res.end('no');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let fails = 0;
const chk = (name, ok, detail) => {
  if(!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

/* Every visible button over the globe: does a tap at its centre reach it? */
const HITS = () => [...document.querySelectorAll('.viewport .btn')].filter(e => e.offsetParent).map(e => {
  const b = e.getBoundingClientRect(), x = b.x + b.width/2, y = b.y + b.height/2;
  const name = e.textContent.trim();
  if(y < 0 || y > innerHeight) return { name, ok: false, off: true, got: 'off screen' };
  const h = document.elementFromPoint(x, y);
  return { name, ok: h === e || e.contains(h), got: h ? h.tagName.toLowerCase() + '.' + h.className : 'nothing' };
});
/* On the first screen a button below the fold is only below the fold; scrolled
   to the globe, every one of them must be on screen and reachable. */
const bad = (hs, firstScreen) => hs.filter(h => !h.ok && !(firstScreen && h.off))
  .map(h => h.name + ' -> ' + h.got).join(', ');
const scrollGlobe = (p, edge) => p.evaluate(e => {
  const r = document.querySelector('.viewport').getBoundingClientRect();
  scrollBy(0, e === 'bottom' ? Math.max(0, r.bottom - innerHeight + 2) : r.top);
}, edge);

/* The text the reader sees, and how small it is. Hidden elements are skipped:
   a closed panel's text is not on screen. */
const SMALL = () => {
  const out = [], seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for(let n; (n = w.nextNode());){
    const t = n.textContent.trim(), e = n.parentElement;
    if(!t || seen.has(e) || e.closest('script, .skip')) continue;
    seen.add(e);
    let hid = false;
    for(let a = e; a && !hid; a = a.parentElement){
      const c = getComputedStyle(a);
      hid = c.display === 'none' || c.visibility === 'hidden' || a.hidden;
    }
    const r = e.getBoundingClientRect();
    if(hid || !r.width || !r.height) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if(fs < 11) out.push(fs + 'px "' + t.slice(0, 28) + '"');
  }
  return out;
};

async function open(browser, url, opt){
  const ctx = await browser.newContext(opt);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for(const u of ['**celestrak.org/**', '**tle.ivanstanojevic.me/**',
                  '**gibs.earthdata.nasa.gov/**', '**geocoding-api.open-meteo.com/**'])
    await page.route(u, r => r.abort());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 40000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('tpplay').click());   // freeze the clock
  return { ctx, page, errs };
}

(async () => {
  const srv = await serve();
  const PAGE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const allErrs = [];

  // ---- the desktop console ---------------------------------------------------
  {
    const { ctx, page, errs } = await open(browser, PAGE, { viewport: { width: 1440, height: 900 } });
    const d = await page.evaluate(() => {
      const q = s => document.querySelector(s), vis = e => !!e && getComputedStyle(e).display !== 'none';
      const jump = [...document.querySelectorAll('.bar-top .jump a')];
      return {
        panel: vis(q('#layersMenu')), toggle: vis(q('#layerstoggle')),
        captions: [...document.querySelectorAll('.seglabel')].filter(vis).map(e => e.textContent),
        jumps: jump.map(a => a.getAttribute('href')),
        dangling: jump.filter(a => a.getAttribute('href')[0] === '#' && !q(a.getAttribute('href')))
                      .map(a => a.getAttribute('href')),
        jumpBottom: jump.length ? Math.max(...jump.map(a => a.getBoundingClientRect().bottom)) : 1e9,
        header: q('.bar-top').getBoundingClientRect().height,
        app: q('.app').getBoundingClientRect().height
      };
    });
    chk('at 1440x900 the layers panel is open, as it always was, and no toggle is drawn',
        d.panel && !d.toggle);
    chk('...every caption is shown', d.captions.length === 6, d.captions.join(' '));
    chk('the header names every section below, and the Moon pages, on the first screen',
        ['#sec-elements', '#sec-track', '#sec-access', '#sec-life', '#sec-method', '#sec-terms',
         'moon-track.html', 'moon.html'].every(h => d.jumps.includes(h)) && d.jumpBottom < 900,
        d.jumps.join(' '));
    chk('...and every in-page link lands on something', !d.dangling.length, d.dangling.join(' ') || 'all resolve');
    chk('...in a line of the header, with the console still filling the screen', d.header <= 100 && d.app === 900,
        'header ' + d.header.toFixed(0) + ' px, console ' + d.app.toFixed(0) + ' px');
    chk('every globe button is reachable', !bad(await page.evaluate(HITS)), bad(await page.evaluate(HITS)) || 'all');

    // the smallest text, with the elements layer's key and the observer form open as well
    await page.evaluate(() => {
      const l = document.querySelector('#layersMenu input[data-layer="elements"]');
      l.checked = true; l.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('siteopen').click();
    });
    await page.waitForTimeout(600);
    const small = await page.evaluate(SMALL);
    chk('no visible text is smaller than 11 px', !small.length, small.slice(0, 6).join(', ') || 'none');
    const key = await page.evaluate(() => [...document.querySelectorAll('#o3key .kel')]
      .filter(li => !li.hidden).map(li => li.textContent).join(' | '));
    chk('with the elements layer on, the globe key names its symbols',
        ['RAAN', 'inclination', 'argument of perigee', 'true anomaly', 'eccentricity vector',
         'angular momentum', 'velocity'].every(w => key.includes(w)), key.slice(0, 90) + '…');
    await page.evaluate(() => {
      const l = document.querySelector('#layersMenu input[data-layer="elements"]');
      l.checked = false; l.dispatchEvent(new Event('change', { bubbles: true }));
    });
    chk('...and drops them when it is off', await page.evaluate(() =>
      [...document.querySelectorAll('#o3key .kel')].every(li => li.hidden)));

    // the vocabulary
    const v = await page.evaluate(() => {
      const txt = s => (document.querySelector(s) || {}).textContent || '';
      const abbrs = [...document.querySelectorAll('abbr')];
      const terms = [...document.querySelectorAll('#sec-terms dt')].map(d => d.textContent).join(' | ');
      const linked = [...document.querySelectorAll('a[href^="#t-"]')].map(a => a.getAttribute('href'));
      return {
        untitled: abbrs.filter(a => !a.title).map(a => a.textContent),
        named: abbrs.map(a => a.textContent),
        terms,
        orphans: linked.filter(h => !document.querySelector(h)),
        bstar: txt('#derived'), val: [...document.querySelectorAll('#elgrid .val')].map(e => e.textContent)
      };
    });
    chk('the abbreviations carry their expansion', !v.untitled.length && ['NORAD', 'COSPAR', 'AOS', 'LOS',
        'TEME', '1/ER', 'POV', 'FOV', 'GSD'].every(a => v.named.includes(a)), [...new Set(v.named)].join(' '));
    chk('...and the Terms section says what they mean', ['AOS, LOS', 'Z, UTC', 'NORAD ID, COSPAR ID',
        'TEME', 'B*, 1/ER', 'std mag', 'penumbra', 'POV, FOV, GSD', 'Earth Resources group', 'entry interface']
        .every(t => v.terms.includes(t)), v.terms.split(' | ').length + ' entries');
    chk('...including every term a note links to', !v.orphans.length, v.orphans.join(' ') || 'none missing');
    chk('the degree sign on the element cards sits on its number',
        v.val.filter(s => /°/.test(s)).every(s => /\d°$/.test(s)) && v.val.some(s => /°$/.test(s)),
        v.val.filter(s => /°/.test(s)).join(', '));
    allErrs.push(...errs);
    await ctx.close();
  }

  // ---- narrow: tablet, phone, and the phone held sideways ------------------------
  const NARROW = [
    { name: 'tablet 768x1024', opt: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'phone 390x844', opt: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
                                    isMobile: true, hasTouch: true } },
    { name: 'phone sideways 844x390', opt: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2,
                                             isMobile: true, hasTouch: true } }
  ];
  for(const N of NARROW){
    const { ctx, page, errs } = await open(browser, PAGE, N.opt);
    const s = await page.evaluate(() => {
      const q = s => document.querySelector(s), vis = e => !!e && getComputedStyle(e).display !== 'none';
      const cap = t => [...document.querySelectorAll('.seglabel')].some(e => e.textContent === t && vis(e));
      return { panel: vis(q('#layersMenu')), toggle: vis(q('#layerstoggle')),
               exp: q('#layerstoggle') && q('#layerstoggle').getAttribute('aria-expanded'),
               captions: ['Camera', 'Trail', 'Window', 'Span'].filter(cap) };
    });
    chk(N.name + ': the layers panel starts folded behind a button that says so',
        !s.panel && s.toggle && s.exp === 'false');
    chk('...the captions that tell the "6 h" rows apart are shown', s.captions.length === 4, s.captions.join(' '));

    /* On the first screen; with the globe's lower edge at the foot of the
       screen, where a sticky transport would sit on it; and, where the header
       is not sticky, with its top edge at the top - held sideways the globe is
       taller than the screen, and a sticky header covered the Layers button
       whenever the camera row was in view. Where the header is sticky, the
       whole console fits under it on the first screen. */
    const stickyTop = await page.evaluate(() => getComputedStyle(document.querySelector('.bar-top')).position === 'sticky');
    const pos = [];
    for(const edge of stickyTop ? ['first', 'bottom'] : ['first', 'bottom', 'top']){
      if(edge !== 'first') await scrollGlobe(page, edge);
      await page.waitForTimeout(250);
      const hs = await page.evaluate(HITS);
      pos.push(edge + ': ' + (bad(hs, edge === 'first') || hs.filter(h => h.ok).length + ' of ' + hs.length + ' reachable'));
      await page.evaluate(() => scrollTo(0, 0));
    }
    chk('...nothing sits over the globe\'s buttons' + (stickyTop ? ', first screen or scrolled to its foot'
        : ', first screen or either edge of the globe at the edge of the screen'),
        pos.every(x => /reachable/.test(x)), pos.join('; '));
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(250);

    if(s.toggle){                       // absent, there is nothing to open
      await page.click('#layerstoggle');
      await page.waitForTimeout(250);
      const o = await page.evaluate(() => {
        const m = document.getElementById('layersMenu').getBoundingClientRect(),
              t = document.querySelector('.trailseg').getBoundingClientRect();
        return { shown: getComputedStyle(document.getElementById('layersMenu')).display !== 'none',
                 exp: document.getElementById('layerstoggle').getAttribute('aria-expanded'),
                 gap: t.top - m.bottom };
      });
      chk('...the button opens it, and it stops short of the trail and camera rows',
          o.shown && o.exp === 'true' && o.gap >= 0, 'aria-expanded ' + o.exp + ', ' + o.gap.toFixed(0) + ' px clear');
      await page.focus('#layersMenu input');
      await page.keyboard.press('Escape');
      const c = await page.evaluate(() => ({
        shown: getComputedStyle(document.getElementById('layersMenu')).display !== 'none',
        exp: document.getElementById('layerstoggle').getAttribute('aria-expanded'),
        focus: document.activeElement && document.activeElement.id }));
      chk('...and Escape closes it and hands the focus back to the button',
          !c.shown && c.exp === 'false' && c.focus === 'layerstoggle', 'focus on #' + c.focus);
    }
    const small = await page.evaluate(SMALL);
    chk('...no visible text is smaller than 11 px', !small.length, small.slice(0, 6).join(', ') || 'none');
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    chk('...and the page does not scroll sideways', w <= N.opt.viewport.width, w + ' px wide');
    allErrs.push(...errs);
    await ctx.close();
  }

  console.log('\npage errors: ' + (allErrs.length ? allErrs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  srv.close();
  process.exit(fails || allErrs.length ? 1 : 0);
})();
