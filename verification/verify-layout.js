/*
 * The console's layout, at the sizes it is read at: a 1440x900 window, the
 * narrow and short laptop windows between that and a tablet, a 768x1024
 * tablet, a 390x844 phone and the same phone held sideways, and the largest
 * phones held sideways, which are wider than 900 px.
 *
 * Each check here is a defect that shipped:
 *
 *   - on a phone the layers panel hung open over half the globe and the clock,
 *     with nothing that closed it; held sideways, a 915 or 932 px phone got
 *     the desktop's open panel over a 231 px globe, with the same result;
 *   - on the desktop the open panel ran under the transport bar wherever the
 *     globe was shorter than 431 px - a short window, or 901 to 1030 px wide,
 *     where the header's links take two more rows - and the viewport clipped
 *     its last switches out of reach;
 *   - the transport bar was sticky at the foot of the screen and wraps to four
 *     rows there, so the camera and trail buttons along the globe's lower edge
 *     were under it - a tap on Free landed on the transport;
 *   - below 900 px every caption was hidden, leaving three unlabelled rows of
 *     "6 h" / "24 h" that do three different things;
 *   - nothing on the first screen said where the elements, the ground track and
 *     the pass table were, and the Moon pages were a link a thousand pixels down
 *     a rail that scrolls on its own;
 *   - a jump from the header on a tablet landed 200 px below the top of the
 *     screen, making room for a sticky header that had scrolled away;
 *   - held sideways, the globe key with the orbital elements' names in it was
 *     eleven rows, and climbed into the clock;
 *   - much of the data text was 9 to 10.5 px, the local pass times included;
 *   - AOS, LOS, COSPAR, TEME, B*'s 1/ER and the rest were used and never said.
 *
 * The AR button, offered only on a touch screen, makes the camera row 44 px
 * longer; it is checked to be there on each touch screen here and absent on
 * the desktop, and the sweeps below then cover it like any other button. At
 * 915x412 the longer row runs towards the HUD clock, and the gap is measured.
 * What the AR view itself does is verify-ar.js.
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
const H = require('./lib/harness');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = H.playwright();

const ROOT = path.join(__dirname, '..');
const SITE = H.targetRoot();   // what is being served: legacy/ or dist/ (ROOT stays the repo)
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.jpg':'image/jpeg', '.png':'image/png', '.css':'text/css' };
function serve(){
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(SITE, rel);
      if(!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
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

/* Every switch in the layers panel: can the pointer reach it? The panel is
   scrolled to bring each into view - the panel only, never the page or the
   viewport, which clips it - and it counts only if its centre is inside the
   globe and on the screen, and a tap there lands on it. */
const REACH = () => {
  const m = document.getElementById('layersMenu'), vp = document.querySelector('.viewport').getBoundingClientRect();
  const out = [];
  for(const l of [...m.querySelectorAll('label')].filter(e => e.offsetParent)){
    let b = l.getBoundingClientRect(), mr = m.getBoundingClientRect();
    if(b.bottom > mr.bottom) m.scrollTop += b.bottom - mr.bottom + 2;
    if(b.top < mr.top) m.scrollTop -= mr.top - b.top + 2;
    b = l.getBoundingClientRect(); mr = m.getBoundingClientRect();
    const x = b.x + b.width/2, y = b.y + b.height/2;
    const inside = y > mr.top && y < mr.bottom && y > vp.top && y < vp.bottom && y > 0 && y < innerHeight;
    const h = inside && document.elementFromPoint(x, y);
    out.push({ name: l.textContent.trim(), ok: !!h && l.contains(h) });
  }
  m.scrollTop = 0;
  return out;
};
/* The open panel against the camera and trail rows: clear of both? */
const CLEAR = () => {
  const X = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const m = document.getElementById('layersMenu').getBoundingClientRect();
  return ['.camseg', '.trailseg'].map(s => document.querySelector(s))
    .filter(e => e && getComputedStyle(e).display !== 'none')
    .every(e => !X(m, e.getBoundingClientRect()));
};
/* The globe key's rows as drawn, against the clock over the globe. */
const KEYGAP = () => {
  const rows = [...document.querySelectorAll('#o3key li')].filter(li => li.offsetParent).map(li => {
    const g = document.createRange(); g.selectNodeContents(li); return g.getBoundingClientRect(); });
  const hud = [...document.querySelectorAll('.hud > div')].filter(d => d.offsetParent)
    .map(d => d.getBoundingClientRect().bottom);
  return rows.length ? Math.min(...rows.map(b => b.top)) - Math.max(...hud) : null;
};

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
        app: q('.app').getBoundingClientRect().height,
        ar: vis(q('#arbtn'))
      };
    });
    chk('at 1440x900 the layers panel is open, as it always was, and no toggle is drawn',
        d.panel && !d.toggle);
    chk('...and there is no AR button, since there is no touch screen', !d.ar);
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
        'TEME', '1/ER', 'POV', 'FOV', 'GSD', 'AR', 'WMM2025'].every(a => v.named.includes(a)), [...new Set(v.named)].join(' '));
    chk('...and the Terms section says what they mean', ['AOS, LOS', 'Z, UTC', 'NORAD ID, COSPAR ID',
        'TEME', 'B*, 1/ER', 'std mag', 'penumbra', 'POV, FOV, GSD', 'AR, heading, declination',
        'Earth Resources group', 'entry interface']
        .every(t => v.terms.includes(t)), v.terms.split(' | ').length + ' entries');
    chk('...including every term a note links to', !v.orphans.length, v.orphans.join(' ') || 'none missing');
    chk('the degree sign on the element cards sits on its number',
        v.val.filter(s => /°/.test(s)).every(s => /\d°$/.test(s)) && v.val.some(s => /°$/.test(s)),
        v.val.filter(s => /°/.test(s)).join(', '));
    allErrs.push(...errs);
    await ctx.close();
  }

  // ---- the desktop console in a narrow or short window ---------------------------
  /* The open panel is 327 px tall from 92 px down. At 1024x650 and 901x700 the
     header takes its links in two more rows and the globe is 376 and 372 px;
     at 1280x600 the window is short. The panel stays open, as on any desktop,
     and scrolls. */
  for(const [w, h] of [[1024, 650], [901, 700], [1280, 600]]){
    const { ctx, page, errs } = await open(browser, PAGE, { viewport: { width: w, height: h } });
    const d = await page.evaluate(() => ({
      panel: getComputedStyle(document.getElementById('layersMenu')).display !== 'none',
      toggle: getComputedStyle(document.getElementById('layerstoggle')).display !== 'none' }));
    const r = await page.evaluate(REACH), clear = await page.evaluate(CLEAR);
    chk(w + 'x' + h + ': the layers panel is open, clear of the rows above it, and every switch is in reach',
        d.panel && !d.toggle && r.length >= 8 && r.every(x => x.ok) && clear,
        (r.filter(x => !x.ok).map(x => x.name).join(', ') || r.length + ' of ' + r.length) +
        (clear ? '' : ', OVER the rows'));
    chk('...every globe button is reachable', !bad(await page.evaluate(HITS)), bad(await page.evaluate(HITS)) || 'all');
    allErrs.push(...errs);
    await ctx.close();
  }

  // ---- narrow: tablet, phone, and the phone held sideways ------------------------
  const NARROW = [
    { name: 'tablet 768x1024', opt: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'phone 390x844', opt: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
                                    isMobile: true, hasTouch: true } },
    { name: 'phone sideways 844x390', opt: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2,
                                             isMobile: true, hasTouch: true } },
    /* wider than 900 px, so the desktop console, but too short for its open panel */
    { name: 'large phone sideways 915x412', opt: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2,
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
    /* A touch screen is offered the AR button, in the camera row's own box, so
       the sweeps below - nothing over a button, the layers panel clear of the
       rows, no sideways scroll - measure it with the rest. The first line is a
       precondition: if hasTouch stopped making the primary pointer coarse, the
       button would silently vanish from every check here. */
    const ar = await page.evaluate(() => {
      const b = document.getElementById('arbtn'), r = b.getBoundingClientRect(), seg = document.querySelector('.camseg');
      const c = seg.getBoundingClientRect();
      /* the clock's text, measured as text: the HUD's own boxes are wider */
      const gapNow = () => {
        const c = seg.getBoundingClientRect(), rng = document.createRange(), clock = [];
        for(const d of document.querySelectorAll('.hud > div')){
          if(getComputedStyle(d).display === 'none' || d.hidden) continue;
          rng.selectNodeContents(d); const t = rng.getBoundingClientRect(); if(t.width) clock.push(t);
        }
        return clock.length ? Math.min(...clock.map(t => t.bottom <= c.top || t.top >= c.bottom ? Infinity : c.left - t.right)) : Infinity;
      };
      /* and with a long site name, which above 900 px was never cut short:
         "Frankfurt am Main" put the longer row 42 px into the clock */
      const n = document.getElementById('lbl-camsite'), was = n.textContent;
      const gap = gapNow();
      n.textContent = 'Frankfurt am Main';
      const gapLong = gapNow();
      n.textContent = was;
      return { coarse: matchMedia('(pointer: coarse)').matches, shown: getComputedStyle(b).display !== 'none',
               inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5,
               gap, gapLong };
    });
    chk('...a touch screen, so the AR button is offered, in the camera row', ar.coarse && ar.shown && ar.inside,
        ar.coarse ? (ar.inside ? 'inside the row' : 'OUTSIDE the row') : 'precondition failed: (pointer: coarse) does not match');
    if(N.opt.viewport.width > 900)
      chk('...and the camera row, AR included, stays clear of the clock, with a long site name too',
          ar.gap > 0 && ar.gapLong > 0,
          isFinite(ar.gap) ? ar.gap.toFixed(0) + ' px between them, ' + ar.gapLong.toFixed(0) + ' px for "Frankfurt am Main"' : 'not level with it');

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
      const o = await page.evaluate(() => ({
        shown: getComputedStyle(document.getElementById('layersMenu')).display !== 'none',
        exp: document.getElementById('layerstoggle').getAttribute('aria-expanded') }));
      const clear = await page.evaluate(CLEAR), r = await page.evaluate(REACH);
      chk('...the button opens it, clear of the trail and camera rows, with every switch in reach',
          o.shown && o.exp === 'true' && clear && r.length >= 8 && r.every(x => x.ok),
          'aria-expanded ' + o.exp + (clear ? ', clear of the rows, ' : ', OVER the rows, ') +
          (r.filter(x => !x.ok).map(x => x.name).join(', ') || r.length + ' of ' + r.length + ' in reach'));
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
    /* With the orbital elements on, the key grows by five rows. Where it is
       drawn at all (not on a phone held upright), it stays under the clock. */
    const elements = on => page.evaluate(v => {
      const l = document.querySelector('#layersMenu input[data-layer="elements"]');
      l.checked = v; l.dispatchEvent(new Event('change', { bubbles: true }));
    }, on);
    await elements(true);
    await page.waitForTimeout(400);
    const kg = await page.evaluate(KEYGAP);
    if(kg !== null) chk("...with the elements' names in the globe key, the key stays under the clock",
                        kg >= 4, kg.toFixed(0) + ' px between them');
    await elements(false);
    /* A jump from the header lands at the top of the screen. Where the header
       is sticky it is sticky only inside the console, so by the time the
       report is reached there is nothing to make room for. */
    await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.jump a[href="#sec-access"]').click(); });
    await page.waitForTimeout(400);
    const land = await page.evaluate(() => document.getElementById('sec-access').getBoundingClientRect().top);
    chk('...a jump from the header lands at the top of the screen', land > -2 && land <= 40,
        'Passes at ' + land.toFixed(0) + ' px');
    await page.evaluate(() => scrollTo(0, 0));
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
