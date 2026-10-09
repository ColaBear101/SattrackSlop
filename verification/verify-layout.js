/*
 * verify-layout.js - the rebuilt console's layout, at the sizes it is read at, in light and dark.
 *
 * The old suite (`git show legacy-earth-console:verification/verify-layout.js`; it passed 60 checks on the old page) is a list of defects that shipped on the old page, each a check that drives
 * that page's DOM. The rebuilt page has a different DOM and a different design (CHANGES-FROM-LEGACY.md L1-L43: one-row header from 1100 px, a
 * Globe | Map stage, the answer rail as a side column / a panel / a bottom sheet with a peek, the transport docked at the bottom, the planner as a
 * drawer / a panel / a sheet, Layers / Camera / Trail as small controls, the AR opener in the row of tabs), so this one asks generic questions of
 * whatever is on screen and then the few things this design promises. Each check says which defect it would catch.
 *
 * Twelve sizes: 1440x900, 1280x720 (laptops), 1100x800 (the one-row header's narrowest), 1099x800 (the panel presentation's widest), 1024x650,
 * 768x1024 (a tablet), 390x844 and 844x390 (a phone upright and sideways), 915x412 and 932x430 (the largest phones sideways: wider than 900 px),
 * 360x640 and 320x568 (the smallest). From the tablet down the context has a touch screen as its primary pointer, so (pointer: coarse) is true there.
 * Each size is visited once, in these states, and every sweep runs in each of them, in light and in dark:
 *   default . the Layers panel . the spacecraft picker . the observer form . the window popover . the Map tab . the answer rail (its three tabs,
 *   and folded, where it folds) . the orbit planner (a drawer, a sheet or a panel, by width)
 *
 *   1  The page does not scroll sideways (documentElement.scrollWidth <= the window's width, as the context was given it: in a mobile context innerWidth
 *      itself grows with a wide page), in every state.
 *      Shipped on the old page: a 915 px phone got the desktop's layout; a clock line wider than a 360 px phone made the page wider than the screen.
 *   2  Reach, overlap, panels. A tap at the centre of every control lands on it (elementFromPoint), with the page at its top, with the stage's
 *      foot at the foot of the screen, with the stage's top at the top, and at the foot of the page, and again for each control brought to the
 *      middle of the screen; no two controls' boxes overlap; every popover and panel is inside the viewport and its last control can be reached.
 *      Shipped: the old transport bar sat on the camera and trail buttons; the open layers panel ran under the transport; the viewport clipped the
 *      panel's last switches out of reach. A control covered ON PURPOSE (by an open popover, by the expanded answer sheet, by the planner's sheet)
 *      is not a defect; one covered by anything else is.
 *   3  Text. No visible text under MIN_TEXT_PX (12: the type scale's floor), except the named cases below; no text cut off or sticking out of the
 *      box that is meant to hold it whole (content wider than an element that clips, with no ellipsis declared; text outside its own box).
 *      Shipped: 9 to 10.5 px data text; a long name and a long place name pushing neighbours out of their rows.
 *   4  Tap targets, on the touch sizes. Every control is 44 x 44 CSS px, or at least 24 x 24 with 8 px clear of every other target. That is the
 *      plan's number (44, section 3) with the exception the brief gave it; WCAG 2.2 SC 2.5.8 itself asks only 24 px, and tokens.css sets --tap to 40,
 *      so a row of 40 px buttons with no gap between them is under this rule and over WCAG's. The exemptions are the criterion's own: a link inside a
 *      sentence, and a range slider the page does not restyle. The controls that rely on the 24 px + 8 px exception are listed, with their clearance.
 *   5  What the design promises: the header is one row of fixed height from 1100 px and the identity line is whole (the age chip, also under
 *      ?tle=embedded, with the longest names in the catalogue); under 720 px the header's name wraps and never widens the page; the globe and the
 *      map are never slivers (200 x 150 for the globe, 200 x 100 for the 2:1 map); the answer rail is a column / a panel / a sheet and its peek says whether it is open; the AR opener
 *      exists on touch and only there; the Source tab does not widen its rail; with the planner open at 901 px and wider the rail is gone and the
 *      planner is inside the viewport; the skip links exist and are on screen when focused; the report's sub-navigation is sticky and does not
 *      cover the heading of a section it jumps to; the Moon links are in the report's navigation and the footer.
 *   6  Self-tests. A sweep that cannot see a violator is not a check, so each is shown one: a 9 px label, a 20 px button on the touch screen, a
 *      button stacked over another, a box wider than the screen, text cut off by its box, a popover hanging off the screen. The sweep reports it,
 *      the violator is removed, and the sweep is clean again.
 *
 * The measuring code is in lib/layout-probe.js (it runs in the page). The page is the production build served over http, loaded the way a visitor
 * gets it (no test flag), with the clock fixed so that the pass lists, and with them the layout, are the same every run.
 *
 *   npm run build && node verification/verify-layout.js [--only 1,3] [--sizes 390x844,1440x900] [--verbose]
 *   GT_TARGET unset means the rebuilt page; GT_TARGET=legacy is refused: the old page's own suite is at the tag
 *   legacy-earth-console (see above). A failing sweep leaves a picture of the page where it failed in verification/screens/layout-*.png
 *   (the folder is not in git); the run deletes the last run's pictures first.
 *   --only runs just those groups (a subset never prints ALL CHECKS PASS).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./lib/harness');
const probe = require('./lib/layout-probe');

if (!process.env.GT_TARGET && !process.env.GT_URL) process.env.GT_TARGET = 'new';
if (!process.env.GT_URL && H.targetName() !== 'new') {
  console.error('verify-layout checks the rebuilt page: run it with GT_TARGET=new (GT_DIST=<build folder>, or dist/). The old page has its own suite, at the tag legacy-earth-console.');
  process.exit(2);
}

const argv = process.argv.slice(2);
const argOf = k => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] || '') : null; };
const ONLY = argOf('--only') !== null ? new Set(argOf('--only').split(',').filter(Boolean)) : null;
const SIZES_ONLY = argOf('--sizes') !== null ? new Set(argOf('--sizes').split(',').filter(Boolean)) : null;
const VERBOSE = argv.includes('--verbose');
const want = g => !ONLY || ONLY.has(String(g));

/* ---- the numbers this suite holds the page to ---------------------------------------------------------------------------------------- */
const MIN_TEXT_PX = 12;               // the type scale's floor (tokens.css --fs-0): nothing below it
const TAP_FULL = 44, TAP_MIN = 24, TAP_CLEAR = 8;   // a target is 44 x 44, or >= 24 x 24 with 8 px clear of every other target
const MIN_STAGE = { w: 200, h: 150 }; // the globe, where shown
const MIN_MAP = { w: 200, h: 100 };   // the map: a 2:1 plate carree, so a 296 px column (a 320 px phone) makes it 148 px tall; what matters is that it is not a sliver
const SHEET_MAX = 719, PANEL_MAX = 1099;            // the answer rail is a sheet up to 719 px, a panel up to 1099, a column from 1100
const NOW = new Date('2026-10-05T12:00:00Z');
const MAX_SHOTS = 80;
const SCREENS = path.join(__dirname, 'screens');

/* Text that may be under MIN_TEXT_PX, each with the reason a reviewer would accept. Empty means: nothing is exempt. */
const MIN_TEXT_EXCEPT = [];
/* Elements that may hold more than their box shows: [selector, why]. */
const CLIP_EXCEPT = [];

const SIZES = [
  { id: '1440x900', w: 1440, h: 900 }, { id: '1280x720', w: 1280, h: 720 }, { id: '1100x800', w: 1100, h: 800 },
  { id: '1099x800', w: 1099, h: 800 }, { id: '1024x650', w: 1024, h: 650 },
  { id: '768x1024', w: 768, h: 1024, touch: true },
  { id: '390x844', w: 390, h: 844, touch: true, phone: true }, { id: '844x390', w: 844, h: 390, touch: true, phone: true },
  { id: '915x412', w: 915, h: 412, touch: true, phone: true }, { id: '932x430', w: 932, h: 430, touch: true, phone: true },
  { id: '360x640', w: 360, h: 640, touch: true, phone: true }, { id: '320x568', w: 320, h: 568, touch: true, phone: true }
].filter(s => !SIZES_ONLY || SIZES_ONLY.has(s.id));
const railMode = s => (s.w > PANEL_MAX ? 'side' : s.w > SHEET_MAX ? 'panel' : 'sheet');
const plannerMode = s => (s.w >= 901 ? (s.h >= 561 ? 'drawer' : 'sheet') : 'flow');
const SCHEMES = ['light', 'dark'];

/* ---- results ------------------------------------------------------------------------------------------------------------------------- */
const GROUPS = { 1: 'The page does not scroll sideways', 2: 'Reach, overlap and panels', 3: 'Text', 4: 'Tap targets (touch screens)', 5: 'What the design promises', 6: 'Self-tests: the sweeps can see a violator' };
const OUT = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
let fails = 0, passes = 0;
const pageErrors = [];
function chk(g, name, ok, detail, notes) {
  if (ok) passes++; else fails++;
  OUT[g].push({ ok, name, detail: detail === undefined ? '' : String(detail), notes: notes || [] });
}
const crashes = [];

/* ---- helpers ------------------------------------------------------------------------------------------------------------------------- */
const TIMES = {};   // where the run's time goes, printed with --verbose
const timed = async (k, fn) => { const t = Date.now(); try { return await fn(); } finally { TIMES[k] = (TIMES[k] || 0) + Date.now() - t; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raf2 = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const waitFor = (page, fn, arg, ms) => page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: ms || 15000 });
let shots = 0;
const shotAt = new Map();      // one picture per size, state and scroll position: the second kind of failure there points at the first one's
async function shot(page, size, scheme, state, kind, y) {
  const key = [size.id, state, y || 0].join('|');
  if (shotAt.has(key)) return shotAt.get(key);
  if (shots >= MAX_SHOTS) return '';
  try {
    fs.mkdirSync(SCREENS, { recursive: true });
    const file = path.join(SCREENS, ['layout', size.id, scheme, state, kind].concat(y ? ['y' + y] : []).join('-').replace(/[^A-Za-z0-9._-]/g, '_') + '.png');
    await page.evaluate(yy => scrollTo(0, yy || 0), y || 0);
    await raf2(page);
    await page.screenshot({ path: file });
    await page.evaluate(() => scrollTo(0, 0));
    shots++;
    shotAt.set(key, path.relative(process.cwd(), file));
    return shotAt.get(key);
  } catch (e) { return ''; }
}

function ctxOptions(size) {
  return { viewport: { width: size.w, height: size.h }, hasTouch: !!size.touch, isMobile: !!size.phone, deviceScaleFactor: 1, colorScheme: 'light' };
}
const urlWith = (srv, q) => srv.page + (q || '');

/* Open the page as a visitor gets it and wait until it has an answer, its report, its fonts and its globe; stop the clock so nothing moves. */
async function openPage(browser, srv, size, query, o) {
  o = o || {};
  const ctx = await browser.newContext(ctxOptions(size));
  await ctx.addInitScript(probe.install);
  if (o.noGL) await ctx.addInitScript(() => {
    const g = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...r) { return /webgl/i.test(t) ? null : g.call(this, t, ...r); };
  });
  if (!o.realClock) await ctx.clock.install({ time: NOW });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push('[' + size.id + (query || '') + '] ' + e.message));
  await page.goto(urlWith(srv, query), { waitUntil: 'load' });
  await page.evaluate(([w, h]) => window.__L.setWindow(w, h), [size.w, size.h]);
  await page.waitForSelector(o.ready || '#totalbig', { state: 'attached', timeout: 30000 });
  if (!o.light) await page.waitForSelector('#sec-terms', { state: 'attached', timeout: 30000 });   // the report is a chunk of its own
  await page.evaluate(() => document.fonts.ready);
  if (!o.light) await page.evaluate(() => { const b = document.getElementById('tpplay'); if (b && b.getAttribute('aria-label') === 'Pause') b.click(); });
  if (!o.light && !o.noGL) await waitFor(page, () => { const n = document.getElementById('o3name'); return !!n && n.textContent !== '—' && n.style.display === 'block'; }, undefined, 15000).catch(() => {});
  await page.waitForTimeout(o.light ? 150 : 500);
  return { ctx, page };
}

/* ---- the states a size is visited in ------------------------------------------------------------------------------------------------- */
const POP = l => '[role=dialog][aria-label="' + l + '"]';
function statesFor(page, size, assertPlanner) {
  const rm = railMode(size), pm = plannerMode(size);
  const hidden = sel => waitFor(page, s => { const e = document.querySelector(s); return !e || !e.checkVisibility() || e.hidden; }, sel, 6000);
  const shownSel = sel => waitFor(page, s => { const e = document.querySelector(s); return !!e && e.checkVisibility() && e.getBoundingClientRect().height > 0; }, sel, 8000);
  const esc = async sel => { await page.keyboard.press('Escape'); await hidden(sel); };
  const peekOpen = () => page.evaluate(() => { const p = document.querySelector('.rail .peek'); return !p || p.getAttribute('aria-expanded') === 'true'; });
  const peekTo = async want => {
    if (rm === 'side') return;
    if ((await peekOpen()) !== want) { await page.click('.rail .peek'); await page.waitForTimeout(150); }
  };
  const railTab = async label => {
    await peekTo(true);
    const t = await page.$('.rail [role=tab]:has-text("' + label + '")');
    if (t && (await t.getAttribute('aria-selected')) !== 'true') { await t.click(); await page.waitForTimeout(150); }
  };
  const S = [];
  S.push({ id: 'default', overlay: null, enter: async () => {}, exit: async () => {} });
  S.push({ id: 'layers', overlay: POP('Scene layers'), enter: async () => { await page.click('#layerstoggle'); await shownSel('#layersMenu'); await raf2(page); }, exit: () => esc('#layersMenu') });
  S.push({ id: 'picker', overlay: POP('Choose a spacecraft'), enter: async () => { await page.click('button.title'); await shownSel('#satsearch'); await raf2(page); }, exit: () => esc('#satsearch') });
  S.push({ id: 'observer', overlay: POP('Observer'), enter: async () => {
    await page.click('#siteopen'); await shownSel('#s-search');
    await page.evaluate(() => { const m = document.getElementById('s-manual'); if (m) m.open = true; });   // the coordinate fields: the form at its tallest
    await raf2(page);
  }, exit: () => esc('#s-search') });
  S.push({ id: 'window', overlay: POP('Analysis window'), enter: async () => { await page.click('#winOpen'); await shownSel('#winStartIn'); await raf2(page); }, exit: () => esc('#winStartIn') });
  S.push({ id: 'map', overlay: null, enter: async () => { await page.click('[role=tab]:has-text("Map")'); await shownSel('#map'); await page.waitForTimeout(300); },
    exit: async () => { await page.click('[role=tab]:has-text("Globe")'); await shownSel('#globe'); await page.waitForTimeout(200); } });
  /* the answer rail: on a phone it is the sheet along the bottom, shut until its peek is pressed; elsewhere it is open, and a panel (720-1099) folds */
  const ov = rm === 'sheet' ? '.rail.sheet' : null;
  for (const [id, tab] of [['rail-passes', 'Passes'], ['rail-orbit', 'Orbit'], ['rail-source', 'Source']]) {
    S.push({ id, overlay: ov, enter: () => railTab(tab), exit: async () => {} });
  }
  S[S.length - 1].exit = async () => { await railTab('Passes'); await peekTo(rm !== 'sheet'); };
  if (rm === 'panel') S.push({ id: 'rail-folded', overlay: null, enter: () => peekTo(false), exit: () => peekTo(true) });
  S.push({ id: 'planner-' + pm, overlay: pm === 'sheet' ? '#planner' : null,
    enter: async () => {
      await page.click('#planopen');
      await waitFor(page, () => { const p = document.getElementById('planner'); return !!p && !p.hidden && p.getBoundingClientRect().height > 0; }, undefined, 25000);
      await page.waitForTimeout(400);
      if (assertPlanner) await plannerAssert(page, size);
    },
    exit: async () => { await page.click('#pl-close'); await hidden('#planner'); await page.waitForTimeout(200); } });
  return S;
}

/* ---- one size: the walk through the states, every sweep in each ---------------------------------------------------------------------- */
async function walkSize(browser, srv, size, o) {
  const t0 = Date.now();
  const { ctx, page } = await timed('open page', () => openPage(browser, srv, size));
  const acc = { overflow: new Map(), reach: new Map(), each: new Map(), overlap: new Map(), panels: new Map(), small: new Map(), clipped: new Map(), taps: new Map(), exception: new Map(), exempt: new Map(),
                states: [], controls: 0, textSeen: 0, tapFull: 0, coarse: null, shots: [] };
  const pre = await page.evaluate(() => ({ iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, coarse: matchMedia('(pointer: coarse)').matches, theme: document.documentElement.dataset.theme, probe: typeof window.__L }));
  acc.coarse = pre.coarse;
  chk([1, 2, 3, 4, 5].find(want), size.id + ': the context is the size asked for (inner window, and a coarse primary pointer exactly on the touch sizes)',
      (pre.iw === size.w || pre.sw > pre.iw) && (pre.ih === size.h || pre.sw > pre.iw) && pre.coarse === !!size.touch && pre.probe === 'object', JSON.stringify(pre));
  const note = (m, key, detail) => { const k = key + ' :: ' + detail; const e = m.get(k) || { state: key, detail, schemes: new Set() }; m.set(k, e); return e; };

  let flip = false, cur = 'light';
  const states = o.sweeps ? statesFor(page, size, o.structure) : [];
  for (const st of states) {
    try { await timed('enter state', () => st.enter()); } catch (e) { crashes.push(size.id + ' ' + st.id + ': could not enter the state: ' + String(e.message).split('\n')[0]); try { await st.exit(); } catch (_) {} continue; }
    acc.states.push(st.id);
    for (const scheme of (flip = !flip) ? SCHEMES : SCHEMES.slice().reverse()) {   // the other way round each state: half the switches
      if (cur !== scheme) await timed('switch scheme', async () => {
        await page.emulateMedia({ colorScheme: scheme });
        await waitFor(page, t => document.documentElement.dataset.theme === t, scheme, 4000).catch(() => {});
        await raf2(page);
        cur = scheme;
      });
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      if (theme !== scheme) { crashes.push(size.id + ' ' + st.id + ': the page did not take the ' + scheme + ' scheme (data-theme=' + theme + ')'); continue; }
      const r = await timed('sweeps', () => page.evaluate(a => {
        const L = window.__L, o = {};
        scrollTo(0, 0);
        o.overflow = L.overflow();
        if (a.g2) { o.reach = L.sweepReach(a.overlay); o.each = L.sweepEach(a.overlay); o.overlaps = L.overlaps(a.overlay); o.panels = L.panels(); }
        if (a.g3) { o.small = L.smallText(a.min, a.minExcept); o.clipped = L.clippedText(a.clipExcept); }
        if (a.g4 && L.coarse()) o.taps = L.taps(a.tap);
        scrollTo(0, 0);
        return o;
      }, { overlay: st.overlay, g2: want(2), g3: want(3), g4: want(4) && size.touch, min: MIN_TEXT_PX, minExcept: MIN_TEXT_EXCEPT, clipExcept: CLIP_EXCEPT, tap: { full: TAP_FULL, min: TAP_MIN, clear: TAP_CLEAR } }));

      const sid = st.id;
      if (r.overflow.sw > r.overflow.iw || r.overflow.bsw > r.overflow.iw) {
        const d = 'page ' + r.overflow.sw + ' px wide in a ' + r.overflow.iw + ' px window' + (r.overflow.wide.length ? ' (' + r.overflow.wide.join('; ') + ')' : '');
        const e = note(acc.overflow, sid, d); if (!e.schemes.size) e.shot = await shot(page, size, scheme, sid, 'overflow', 0); e.schemes.add(scheme);
      }
      if (r.reach) {
        acc.controls = Math.max(acc.controls, r.reach.n);
        for (const b of r.reach.bad) {
          const d = b.name + ' is covered by ' + b.by + ' (page at ' + b.pos + ', scrollY ' + b.scrollY + ')';
          const e = note(acc.reach, sid, d); if (!e.schemes.size) e.shot = await shot(page, size, scheme, sid, 'covered', b.scrollY); e.schemes.add(scheme);
        }
        for (const b of r.each.bad) {
          const d = b.name + ' is covered by ' + b.by + ' (scrolled to the middle of the screen)';
          const e = note(acc.each, sid, d); if (!e.schemes.size) e.shot = ''; e.schemes.add(scheme);
        }
        for (const o of r.overlaps.out) {
          const d = o.a + ' overlaps ' + o.b + ' by ' + o.w + ' x ' + o.h + ' px';
          const e = note(acc.overlap, sid, d); if (!e.schemes.size) e.shot = await shot(page, size, scheme, sid, 'overlap', 0); e.schemes.add(scheme);
        }
        for (const p of r.panels) {
          if (!p.inside) { const d = p.name + ' spans ' + p.left + '..' + p.right + ' in a ' + p.iw + ' px window'; const e = note(acc.panels, sid, d); if (!e.schemes.size) e.shot = await shot(page, size, scheme, sid, 'panel', 0); e.schemes.add(scheme); }
          if (!p.footOk) { const d = p.name + ': its last control, ' + p.foot + ', cannot be reached (covered by ' + p.footBy + ')'; const e = note(acc.panels, sid, d); if (!e.schemes.size) e.shot = await shot(page, size, scheme, sid, 'panelfoot', 0); e.schemes.add(scheme); }
        }
      }
      if (r.small) {
        acc.textSeen = Math.max(acc.textSeen, r.small.seen);
        for (const s of r.small.small) { const d = s.fs + ' px "' + s.text + '" (' + s.name + ')'; const e = note(acc.small, sid, d); if (!e.schemes.size) e.shot = await shot(page, size, scheme, sid, 'smalltext', 0); e.schemes.add(scheme); }
        for (const c of r.clipped) { const d = c.name + ' ' + c.why; const e = note(acc.clipped, sid, d); if (!e.schemes.size) e.shot = await shot(page, size, scheme, sid, 'clipped', 0); e.schemes.add(scheme); }
      }
      if (r.taps) {
        acc.tapFull = Math.max(acc.tapFull, r.taps.full);
        for (const t of r.taps.fail) {
          let e = acc.taps.get(t.name);
          if (!e) { e = { name: t.name, w: t.w, h: t.h, clear: t.clear, states: new Set(), shot: '' }; acc.taps.set(t.name, e); e.shot = await shot(page, size, scheme, sid, 'tap', 0); }
          e.clear = Math.min(e.clear, t.clear); e.states.add(sid);
        }
        for (const t of r.taps.exception) acc.exception.set(t.name, t.w + ' x ' + t.h + ', ' + (t.clear >= 999 ? 'alone' : t.clear + ' px clear'));
        for (const t of r.taps.exempt) acc.exempt.set(t.name, t.why);
      }
    }
    try { await timed('leave state', () => st.exit()); } catch (e) { crashes.push(size.id + ' ' + st.id + ': could not leave the state: ' + String(e.message).split('\n')[0]); break; }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  if (o.structure) {
    const step = async (what, fn) => { try { await fn(); } catch (e) { crashes.push(size.id + ': ' + what + ': ' + String(e.message).split('\n')[0]); } };
    await step('structure', () => timed('structure', () => structureChecks(page, size)));
    if (!o.sweeps) await step('the planner', () => timed('planner check', () => plannerChecks(page, size)));
    await step('the Source tab', async () => {
      const src = await sourceTab(page, size);
      chk(5, size.id + ': the Source tab does not widen the rail or the page (the two 69-character raw lines fit, or scroll in their own box)', src.aside <= 0 && src.body <= 0 && src.page <= 0 && (src.pre === 'fits' || src.pre === 'scrolls'),
          'rail ' + src.w + ' px, overflow rail ' + src.aside + ' / body ' + src.body + ' / page ' + src.page + ', the two raw lines ' + src.pre);
    });
  }
  await ctx.close();
  return { acc, t: (Date.now() - t0) / 1000 };
}

/* report the accumulated failures of one kind as ONE check for a size: the states and schemes it was seen in are in the detail */
function summarise(map) {
  const rows = [...map.values()];
  const list = rows.slice(0, 8).map(e => e.state + (e.schemes.size === 2 ? '' : '/' + [...e.schemes][0]) + ': ' + e.detail + (e.shot ? ' [' + e.shot + ']' : ''));
  if (rows.length > 8) list.push('...and ' + (rows.length - 8) + ' more');
  return list.join(' | ');
}

/* the controls under the tap rule, grouped by kind (button.trl, li#sopt*, ...) so that 80 rows of one list read as one line */
function tapSummary(map) {
  const groups = new Map();
  for (const e of map.values()) {
    const key = e.name.replace(/ ".*$/, '').replace(/#(tab|pl)-[a-z0-9]{4,6}-[a-z]+/, '#$1-*').replace(/#sopt[0-9]+/, '#sopt*');
    const label = (e.name.match(/ "(.*)"$/) || [])[1] || '';
    const g = groups.get(key) || { key, n: 0, w: 1e9, h: 1e9, clear: 1e9, labels: [], states: new Set(), shot: e.shot, least: null };
    if (!g.least || Math.min(e.w, e.h) < Math.min(g.least.w, g.least.h)) g.least = { label, w: e.w, h: e.h };
    g.n++; g.w = Math.min(g.w, e.w); g.h = Math.min(g.h, e.h); g.clear = Math.min(g.clear, e.clear); if (label && g.labels.length < 5) g.labels.push(label.replace(/…$/, ''));
    for (const st of e.states) g.states.add(st);
    groups.set(key, g);
  }
  const rows = [...groups.values()];
  const list = rows.slice(0, 12).map(g => g.key + (g.n > 1 ? ' x' + g.n : '') + (g.labels.length && g.n <= 6 ? ' (' + g.labels.join(', ') + ')' : g.n > 6 && g.least ? ' (smallest "' + g.least.label.replace(/…$/, '') + '" ' + g.least.w + ' x ' + g.least.h + ')' : '') + ': ' + g.w + ' x ' + g.h + ' px' + (g.n > 1 ? ' and up' : '') + ', ' + (g.clear >= 999 ? 'alone' : g.clear > 0 ? g.clear + ' px clear' : 'flush') + ' [' + [...g.states].slice(0, 3).join(',') + (g.states.size > 3 ? ',+' + (g.states.size - 3) : '') + ']');
  if (rows.length > 12) list.push('...and ' + (rows.length - 12) + ' more kinds');
  const shots = [...new Set([...map.values()].map(e => e.shot).filter(Boolean))];
  return map.size + ' control' + (map.size === 1 ? '' : 's') + ' in ' + rows.length + ' kind' + (rows.length === 1 ? '' : 's') + ' under the rule: ' + list.join('; ') + (shots.length ? ' [' + shots[0] + ']' : '');
}

/* ---- group 5: what the design promises ----------------------------------------------------------------------------------------------- */
async function structureChecks(page, size) {
  const rm = railMode(size);
  const m = await page.evaluate(({ rm }) => {
    const q = s => document.querySelector(s), L = window.__L;
    const R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const o = {};
    // the rail
    const rail = q('aside.rail');
    o.rail = { cls: rail.className, mode: ['side', 'panel', 'sheet'].find(x => rail.classList.contains(x)), r: R(rail), pos: getComputedStyle(rail).position };
    const stage = q('section.stage'); o.stage = R(stage);
    const peek = q('.rail .peek');
    o.peek = peek ? { shown: L.shown(peek), expanded: peek.getAttribute('aria-expanded'), controls: peek.getAttribute('aria-controls'), h: R(peek).h } : null;
    const body = document.getElementById('answer-body');
    o.body = body ? { hidden: !body.checkVisibility() } : null;
    // the stage's pictures, where shown
    const cv = id => { const e = document.getElementById(id); return e && L.shown(e) ? R(e) : null; };
    o.globe = cv('globe'); o.map = cv('map');
    // the AR opener
    const ar = document.getElementById('arbtn');
    o.ar = ar ? { shown: L.shown(ar), r: R(ar) } : null;
    const tabs = q('section.stage [role=tablist]'); o.tabs = tabs ? R(tabs) : null;
    o.coarse = L.coarse();
    // skip links
    o.skips = [...document.querySelectorAll('a.skip')].map(a => ({ href: a.getAttribute('href'), target: !!document.querySelector(a.getAttribute('href')), text: a.textContent.trim() }));
    // the report navigation and the footer
    const nav = q('nav.rnav');
    o.nav = nav ? { pos: getComputedStyle(nav).position, top: getComputedStyle(nav).top, links: [...nav.querySelectorAll('a')].map(a => a.getAttribute('href')) } : null;
    const foot = q('footer');
    o.footer = foot ? [...foot.querySelectorAll('a')].map(a => a.getAttribute('href')) : null;
    return o;
  }, { rm });

  // ---- the answer rail's shape, and its peek
  const wantMode = rm;
  chk(5, size.id + ': the answer rail is a ' + { side: 'column beside the stage', panel: 'panel under the stage', sheet: 'sheet along the bottom' }[rm] +
         ' (' + (rm === 'side' ? '>= 1100' : rm === 'panel' ? '720-1099' : '< 720') + ' px)',
      m.rail.mode === wantMode && (rm === 'side' ? m.rail.r.l >= m.stage.r - 1 && Math.abs(m.rail.r.w - 360) < 1.5 && m.rail.r.t < m.stage.b
        : rm === 'panel' ? m.rail.r.t >= m.stage.b - 1 && m.rail.r.l >= 0 && m.rail.r.r <= size.w
        : m.rail.pos === 'fixed' && Math.abs(m.rail.r.b - size.h) < 1 && m.rail.r.l === 0 && m.rail.r.r === size.w),
      m.rail.mode + ' ' + Math.round(m.rail.r.w) + ' x ' + Math.round(m.rail.r.h) + ' at ' + Math.round(m.rail.r.l) + ',' + Math.round(m.rail.r.t) + ', position ' + m.rail.pos + '; stage ' + Math.round(m.stage.l) + '..' + Math.round(m.stage.r) + ' x ' + Math.round(m.stage.t) + '..' + Math.round(m.stage.b));
  if (rm === 'side') {
    chk(5, size.id + ': ...a column has no peek (nothing to fold)', !m.peek, m.peek ? 'a peek is drawn' : 'none');
  } else {
    // the peek: visible, its aria-expanded says whether the body is showing, and pressing it flips both, and again
    const t = [];
    const read = () => page.evaluate(() => { const p = document.querySelector('.rail .peek'), b = document.getElementById('answer-body'); return { ex: p.getAttribute('aria-expanded'), shown: b.checkVisibility(), peekShown: window.__L.shown(p) }; });
    let s0 = await read(); t.push(s0);
    await page.click('.rail .peek'); await page.waitForTimeout(200); const s1 = await read(); t.push(s1);
    await page.click('.rail .peek'); await page.waitForTimeout(200); const s2 = await read(); t.push(s2);
    const consistent = t.every(x => x.ex === String(x.shown));
    const startsRight = s0.ex === String(rm !== 'sheet');
    chk(5, size.id + ': ...the peek is on screen, aria-expanded says whether the answer is showing, and a press flips both (starts ' + (rm === 'sheet' ? 'shut' : 'open') + ')',
        !!m.peek && m.peek.shown && m.peek.controls === 'answer-body' && consistent && startsRight && s1.ex !== s0.ex && s2.ex === s0.ex,
        t.map(x => 'expanded=' + x.ex + ' body ' + (x.shown ? 'shown' : 'hidden')).join(' -> ') + ', peek ' + (m.peek ? Math.round(m.peek.h) + ' px tall' : 'missing'));
    await page.evaluate(() => scrollTo(0, 0));
  }
  // ---- the stage's pictures
  const globeOk = m.globe && m.globe.w >= MIN_STAGE.w && m.globe.h >= MIN_STAGE.h;
  chk(5, size.id + ': the globe is at least ' + MIN_STAGE.w + ' x ' + MIN_STAGE.h + ' px where shown', !!globeOk, m.globe ? Math.round(m.globe.w) + ' x ' + Math.round(m.globe.h) : 'the canvas is not shown');
  await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.trim() === 'Map').click());
  await page.waitForTimeout(350);
  const mp = await page.evaluate(() => { const e = document.getElementById('map'), r = e.getBoundingClientRect(); return { shown: window.__L.shown(e), w: r.width, h: r.height }; });
  const mapOk = mp.shown && mp.w >= MIN_MAP.w && mp.h >= MIN_MAP.h;
  const mapShot = mapOk ? '' : await shot(page, size, 'light', 'map', 'mapsize', 0);
  await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.trim() === 'Globe').click());
  await page.waitForTimeout(250);
  chk(5, size.id + ': ...and so is the map', mapOk, (Math.round(mp.w * 10) / 10) + ' x ' + (Math.round(mp.h * 10) / 10) + (mp.shown ? '' : ' (not shown)') + (mapShot ? ' [' + mapShot + ']' : ''));
  // ---- the AR opener: on a touch screen only
  if (size.touch) {
    await waitFor(page, () => { const b = document.getElementById('arbtn'); return !!b && window.__L.shown(b); }, undefined, 12000).catch(() => {});
  }
  const ar = await page.evaluate(() => {
    const b = document.getElementById('arbtn'); if (!b) return null;
    const L = window.__L, r = b.getBoundingClientRect(), tabs = document.querySelector('section.stage [role=tablist]').getBoundingClientRect();
    const stage = document.querySelector('section.stage').getBoundingClientRect();
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { shown: L.shown(b), reach: !!h && (h === b || b.contains(h)), inRow: r.top >= tabs.top - 20 && r.bottom <= tabs.bottom + 20 && r.right <= stage.right + 0.5, right: Math.round(stage.right - r.right), w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (size.touch) chk(5, size.id + ': the AR opener is offered on this touch screen, in the stage\'s row of tabs, and a tap on it lands on it', !!ar && ar.shown && ar.reach && ar.inRow, ar ? JSON.stringify(ar) : '#arbtn is not in the page');
  else chk(5, size.id + ': there is no AR opener without a touch screen', !ar || !ar.shown, ar ? 'shown: ' + JSON.stringify(ar) : 'absent');
  // ---- skip links
  const sk = await page.evaluate(() => [...document.querySelectorAll('a.skip')].map(a => {
    a.focus();
    const r = a.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const res = { href: a.getAttribute('href'), text: a.textContent.trim(), top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), onScreen: r.top >= 0 && r.left >= 0 && r.right <= window.__L.vw && r.bottom <= window.__L.vh, reach: h === a, target: !!document.querySelector(a.getAttribute('href')) };
    a.blur(); return res;
  }));
  chk(5, size.id + ': the two skip links exist, point at something, and are on screen and reachable when they have the focus',
      sk.length === 2 && sk.every(s => s.target && s.onScreen && s.reach) && sk[0].href === '#main' && sk[1].href === '#report', JSON.stringify(sk.map(s => s.href + ' ' + s.top + ',' + s.left + (s.onScreen ? '' : ' OFF') + (s.reach ? '' : ' COVERED'))));
  await page.evaluate(() => scrollTo(0, 0));
  // ---- the report's navigation: sticky, and a jump does not land under it
  const jump = await page.evaluate(async () => {
    const nav = document.querySelector('nav.rnav'); if (!nav) return null;
    const a = nav.querySelector('a[href="#sec-life"]'); a.click();
    await new Promise(r => setTimeout(r, 450));
    const sec = document.getElementById('sec-life'), h = sec && (sec.querySelector('h2') || sec), nb = nav.getBoundingClientRect(), hb = h.getBoundingClientRect(), sb = sec.getBoundingClientRect();
    const r = { navBottom: Math.round(nb.bottom), navTop: Math.round(nb.top), headingTop: Math.round(hb.top), headingBottom: Math.round(hb.bottom), secTop: Math.round(sb.top), pos: getComputedStyle(nav).position, y: Math.round(scrollY), vh: window.__L.vh };
    scrollTo(0, 0);
    return r;
  });
  chk(5, size.id + ': the report\'s navigation is sticky (stuck at the top of the screen after a jump) and the heading it jumps to is below it, not under it',
      !!jump && jump.pos === 'sticky' && jump.navTop === 0 && jump.headingTop >= jump.navBottom && jump.headingBottom <= jump.vh,
      jump ? 'nav ' + jump.navTop + '..' + jump.navBottom + ' px, #sec-life heading at ' + jump.headingTop + '..' + jump.headingBottom + ' px (section top ' + jump.secTop + ')' : 'no navigation');
  const moon = h => h === 'moon-track.html' || h === 'moon.html';
  chk(5, size.id + ': the Moon pages are linked from the report\'s navigation and from the footer',
      !!m.nav && !!m.footer && ['moon-track.html', 'moon.html'].every(h => m.nav.links.includes(h) && m.footer.includes(h)), 'nav: ' + (m.nav ? m.nav.links.filter(moon).join(' ') : 'none') + '; footer: ' + (m.footer ? m.footer.filter(moon).join(' ') : 'none'));
  return m;
}

/* the Source tab: two 69-character lines scroll in their own box and do not widen the rail or the page; the rail's tab content stays in the rail */
async function sourceTab(page, size) {
  const rm = railMode(size);
  const open = await page.evaluate(() => { const p = document.querySelector('.rail .peek'); return !p || p.getAttribute('aria-expanded') === 'true'; });
  if (!open) { await page.click('.rail .peek'); await page.waitForTimeout(150); }
  await page.click('.rail [role=tab]:has-text("Source")');
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const aside = document.querySelector('aside.rail'), body = document.getElementById('answer-body'), pre = document.getElementById('tleraw');
    return { aside: aside.scrollWidth - aside.clientWidth, body: body ? body.scrollWidth - body.clientWidth : 0, page: document.documentElement.scrollWidth - window.__L.vw, pre: pre ? (pre.scrollWidth <= pre.clientWidth ? 'fits' : /(auto|scroll)/.test(getComputedStyle(pre).overflowX) ? 'scrolls' : 'CUT') : 'missing', w: Math.round(aside.getBoundingClientRect().width) };
  });
  await page.click('.rail [role=tab]:has-text("Passes")');
  if (!open) { await page.click('.rail .peek'); await page.waitForTimeout(100); }
  return m;
}

/* ---- group 5, header: the identity line, the longest names, ?tle=embedded ----------------------------------------------------------- */
function longNames() {
  const t = fs.readFileSync(path.join(H.ROOT, 'data', 'catalogue.txt'), 'utf8').split(/\r?\n/);
  const all = [];
  for (let i = 0; i + 2 < t.length; i += 3) all.push({ name: t[i].trim(), norad: t[i + 1].slice(2, 7).trim() });
  const byLen = all.slice().sort((a, b) => b.name.length - a.name.length);
  const wide = s => (s.match(/[WMQ@%]/g) || []).length;            // the capitals that set widest in the title face
  const byWide = all.slice().sort((a, b) => wide(b.name) - wide(a.name) || b.name.length - a.name.length);
  const pick = [byLen[0], byLen[1], byLen[2], byWide[0]];
  return pick.filter((p, i) => pick.findIndex(q => q.norad === p.norad) === i);
}

/* what the header looks like on this page, as numbers */
const HEADER = () => {
  const q = s => document.querySelector(s), R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const bar = q('header.bar-top'), id = q('header .id'), tools = q('header .tools'), title = q('header .title'), nm = document.getElementById('satname');
  const ids = q('header .ids'), chip = document.getElementById('agechip'), txt = document.getElementById('agetext'), snap = q('.chip.snapshot'), theme = q('.theme');
  const bh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h'));
  const o = { barH: R(bar).h, barVar: bh, id: R(id), tools: R(tools), title: R(title), name: R(nm), theme: R(theme), page: document.documentElement.scrollWidth - window.__L.vw };
  const lh = parseFloat(getComputedStyle(nm).lineHeight) || parseFloat(getComputedStyle(nm).fontSize) * 1.15;
  o.lines = Math.round(R(nm).h / lh);
  o.titleCut = title.scrollWidth - title.clientWidth;
  if (ids && chip) {
    o.ids = R(ids); o.chip = R(chip); o.idsClip = ids.scrollWidth - ids.clientWidth;
    const cr = document.createRange(); cr.selectNodeContents(txt); const tr = cr.getBoundingClientRect();
    o.chipText = { l: tr.left, r: tr.right }; o.chipShown = window.__L.shown(chip);
    o.snap = snap ? { shown: window.__L.shown(snap), r: R(snap).r } : null;
    o.idsFont = parseFloat(getComputedStyle(ids).fontSize);
  }
  // everything in the header stays inside it
  o.out = [...bar.querySelectorAll('*')].filter(e => window.__L.shown(e)).map(e => ({ n: window.__L.name(e), b: e.getBoundingClientRect().bottom })).filter(x => x.b > R(bar).b + 0.5).map(x => x.n).slice(0, 3);
  return o;
};

async function headerChecks(browser, srv, size) {
  const wide = size.w >= 1100, phone = size.w < 720;
  const ready = '#agechip';
  // 1. the assignment snapshot (?tle=embedded): no network at all; the snapshot chip is added to the identity line
  {
    const { ctx, page } = await openPage(browser, srv, size, '?tle=embedded', { light: true, noGL: true, ready });
    const h = await page.evaluate(HEADER);
    await ctx.close();
    const chipWhole = h.chipShown && h.chip.l >= h.ids.l - 0.5 && h.chip.r <= h.ids.r + 0.5 && h.chipText.r <= h.chip.r + 0.5 && h.chipText.l >= h.chip.l - 0.5;
    chk(5, size.id + ': ?tle=embedded: the identity line is whole - the age chip is on screen, inside the line and not cut' + (wide ? ', and the header is still one row of ' + h.barVar + ' px' : ''),
        chipWhole && h.idsClip <= 0 && !h.out.length && h.page <= 0 && (!wide || Math.abs(h.barH - h.barVar) < 0.5),
        'header ' + Math.round(h.barH) + ' px; age chip ' + Math.round(h.chip.l) + '..' + Math.round(h.chip.r) + ' in a line of ' + Math.round(h.ids.l) + '..' + Math.round(h.ids.r) + ' (' + (h.idsClip > 0 ? 'CUT by ' + h.idsClip + ' px' : 'whole') + '), snapshot chip ' + (h.snap ? (h.snap.shown ? 'drawn' : 'not drawn') : 'absent') + (h.out.length ? ', sticks out of the header: ' + h.out.join(', ') : '') + (h.page > 0 ? ', page ' + h.page + ' px too wide' : ''));
  }
  // 2. the longest names: a real load of the longest, then the same header with each of the other long names in the title
  const names = longNames();
  {
    const first = names[0];
    const { ctx, page } = await openPage(browser, srv, size, '?sat=' + first.norad, { light: true, noGL: true, ready });
    const rows = [];
    let okAll = true;
    for (let i = 0; i < names.length; i++) {
      if (i > 0) await page.evaluate(n => { document.getElementById('satname').textContent = n; }, names[i].name);
      await raf2(page);
      const h = await page.evaluate(HEADER);
      const nm = await page.evaluate(() => document.getElementById('satname').textContent);
      const chipWhole = h.chip && h.chipShown && h.chip.l >= h.ids.l - 0.5 && h.chip.r <= h.ids.r + 0.5 && h.idsClip <= 0;
      let ok = chipWhole && !h.out.length && h.page <= 0 && h.titleCut <= 0 && h.name.r <= h.tools.l + 0.5 + (phone ? 1e9 : 0);
      if (wide) ok = ok && Math.abs(h.barH - h.barVar) < 0.5 && h.title.r <= h.tools.l + 0.5;
      if (phone) ok = ok && h.title.r <= h.theme.l + 0.5 && h.name.r <= size.w;
      if (!ok) okAll = false;
      rows.push(nm + ' (' + names[i].norad + '): header ' + Math.round(h.barH) + ' px, name ' + h.lines + ' line' + (h.lines === 1 ? '' : 's') + ' ' + Math.round(h.name.l) + '..' + Math.round(h.name.r) + ', ' + (phone ? 'toggle at ' + Math.round(h.theme.l) : 'tools at ' + Math.round(h.tools.l)) + (h.chip ? ', age chip ' + (chipWhole ? 'whole' : 'CUT') : ', no age chip') + (h.page > 0 ? ', page ' + h.page + ' px too wide' : '') + (h.out.length ? ', sticks out: ' + h.out.join(', ') : '') + (h.titleCut > 0 ? ', title cut by ' + h.titleCut + ' px' : ''));
    }
    if (!okAll) await shot(page, size, 'light', 'header-longname', 'header', 0);
    await ctx.close();
    chk(5, size.id + ': ' + (wide ? 'the header stays one row of fixed height and the identity line whole' : phone ? 'the header\'s name wraps in its own column and never widens the page' : 'the header wraps its rows and never widens the page') + ' with the longest names in the catalogue',
        okAll, rows.join(' | '));
  }
}

/* ---- group 5, per size: things that need their own flow ---------------------------------------------------------------------------- */
/* the planner open: how it is presented at this size (the page is already showing it) */
async function plannerAssert(page, size) {
  const pm = plannerMode(size);
  const m = await page.evaluate(() => {
    const L = window.__L, p = document.getElementById('planner'), r = p.getBoundingClientRect(), rail = document.querySelector('aside.rail'), st = document.querySelector('section.stage').getBoundingClientRect();
    const tr = document.querySelector('.transport').getBoundingClientRect(), pos = getComputedStyle(p).position, y = pos === 'fixed' ? 0 : scrollY;   // document coordinates, except for a fixed sheet
    return { r: { l: r.left, t: r.top + y, r: r.right, b: r.bottom + y, w: r.width }, pos, rail: rail ? { shown: L.shown(rail), display: getComputedStyle(rail).display } : null, stage: { l: st.left, r: st.right, t: st.top + scrollY, b: st.bottom + scrollY }, tr: { t: tr.top + scrollY, b: tr.bottom + scrollY }, page: document.documentElement.scrollWidth - window.__L.vw, expanded: document.getElementById('planopen').getAttribute('aria-expanded') };
  });
  let ok, why;
  if (pm === 'drawer') { ok = m.rail && !m.rail.shown && m.r.l >= m.stage.r - 1.5 && m.r.r <= size.w + 0.5 && m.r.l >= 0 && m.page <= 0; why = 'drawer ' + Math.round(m.r.l) + '..' + Math.round(m.r.r) + ' beside the stage (..' + Math.round(m.stage.r) + '), rail ' + (m.rail ? (m.rail.shown ? 'STILL SHOWN' : 'gone') : 'absent'); }
  else if (pm === 'sheet') { ok = m.rail && !m.rail.shown && m.pos === 'fixed' && m.r.l >= 0 && m.r.r <= size.w + 0.5 && m.r.t >= 0 && m.r.b <= size.h + 0.5 && m.page <= 0; why = 'sheet ' + Math.round(m.r.l) + '..' + Math.round(m.r.r) + ' x ' + Math.round(m.r.t) + '..' + Math.round(m.r.b) + ' (' + m.pos + '), rail ' + (m.rail ? (m.rail.shown ? 'STILL SHOWN' : 'gone') : 'absent'); }
  else { ok = m.rail && m.rail.shown && m.r.l >= -0.5 && m.r.r <= size.w + 0.5 && m.page <= 0 && m.r.t >= m.stage.b - 1 && m.r.b <= m.tr.t + 1; why = 'panel in the column ' + Math.round(m.r.l) + '..' + Math.round(m.r.r) + ' between the stage (..' + Math.round(m.stage.b) + ') and the transport (' + Math.round(m.tr.t) + '..), rail ' + (m.rail && m.rail.shown ? 'still below it' : 'GONE'); }
  chk(5, size.id + ': with the planner open (' + pm + ' presentation, ' + (size.w >= 901 ? '901 px and wider' : 'under 901 px') + (size.w >= 901 ? ', ' + (size.h >= 561 ? '561 px and taller' : 'under 561 px tall') : '') + ') ' +
        (pm === 'flow' ? 'it is a panel in the column and the rail is still there' : 'the rail is gone and the planner is inside the viewport'), !!ok && m.expanded === 'true', why + ', aria-expanded ' + m.expanded);
}
/* ...and the same, opening it first and shutting it after (when the walk through the states is not being made) */
async function plannerChecks(page, size) {
  await page.click('#planopen');
  await waitFor(page, () => { const p = document.getElementById('planner'); return !!p && !p.hidden && p.getBoundingClientRect().height > 0; }, undefined, 25000);
  await page.waitForTimeout(400);
  await plannerAssert(page, size);
  await page.click('#pl-close');
  await waitFor(page, () => { const p = document.getElementById('planner'); return !p || p.hidden; }, undefined, 6000);
  await page.waitForTimeout(150);
}

/* ---- group 6: the sweeps can see a violator ---------------------------------------------------------------------------------------- */
async function selfTests(browser, srv) {
  const size = { id: '390x844', w: 390, h: 844, touch: true, phone: true };
  const { ctx, page } = await openPage(browser, srv, size, '', { light: false });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const prep = { min: MIN_TEXT_PX, tap: { full: TAP_FULL, min: TAP_MIN, clear: TAP_CLEAR } };

  // -- text under the floor
  {
    const before = await ev(a => window.__L.smallText(a.min, []).small.length, prep);
    await ev(() => { const s = document.createElement('span'); s.id = '__st_small'; s.textContent = 'a nine pixel label'; s.style.cssText = 'position:fixed;left:20px;top:200px;z-index:99999;font-size:9px;color:#000'; document.body.appendChild(s); });
    const during = await ev(a => window.__L.smallText(a.min, []).small.map(x => x.fs + ' ' + x.name), prep);
    const hidden = await ev(a => { document.getElementById('__st_small').style.display = 'none'; return window.__L.smallText(a.min, []).small.length; }, prep);
    const exc = await ev(a => window.__L.smallText(a.min, [['#__st_small', 'test']]).small.length, prep);
    await ev(() => document.getElementById('__st_small').remove());
    const after = await ev(a => window.__L.smallText(a.min, []).small.length, prep);
    chk(6, 'the min-text sweep reports a 9 px span, ignores it when hidden or named as an exception, and is clean again once it is removed',
        during.length === before + 1 && /^9 /.test(during.find(x => /__st_small/.test(x)) || '') && hidden === before && exc === before && after === before, 'violations ' + before + ' -> ' + during.length + ' -> (hidden) ' + hidden + ' -> (excepted) ' + exc + ' -> ' + after);
  }
  // -- tap targets
  {
    const base = await ev(a => { const t = window.__L.taps(a.tap); return t.fail.length; }, prep);
    await ev(() => {
      const mk = (id, css, txt) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.textContent = txt || 'x'; b.style.cssText = 'position:fixed;z-index:99999;padding:0;border:1px solid #888;background:#fff;color:#000;font-size:12px;' + css; document.body.appendChild(b); return b; };
      mk('__tp_small', 'left:20px;top:300px;width:20px;height:20px;');                  // 20 px: under 24 whatever stands next to it
      mk('__tp_flush1', 'left:100px;top:300px;width:40px;height:40px;');                // 40 px, flush with a neighbour: 24 px is enough only with 8 px clear
      mk('__tp_flush2', 'left:140px;top:300px;width:40px;height:40px;');
      mk('__tp_alone', 'left:20px;top:380px;width:40px;height:40px;');                  // 40 px with 8 px or more clear on every side: the exception
      mk('__tp_big', 'left:200px;top:380px;width:44px;height:44px;');                   // 44 px: fine
    });
    const t = await ev(a => window.__L.taps(a.tap), prep);
    const failed = t.fail.map(x => x.name).join(' | '), exc = t.exception.map(x => x.name).join(' | ');
    const hasF = id => t.fail.some(x => x.name.indexOf('#' + id) >= 0), hasE = id => t.exception.some(x => x.name.indexOf('#' + id) >= 0);
    await ev(() => document.querySelectorAll('[id^=__tp_]').forEach(e => e.remove()));
    const after = await ev(a => window.__L.taps(a.tap).fail.length, prep);
    chk(6, 'the tap-target sweep, on this touch screen, reports a 20 px button and a 40 px button flush with another, accepts a 40 px button 8 px clear of everything and a 44 px one, and is clean again once they are removed',
        hasF('__tp_small') && hasF('__tp_flush1') && hasF('__tp_flush2') && !hasF('__tp_alone') && hasE('__tp_alone') && !hasF('__tp_big') && !hasE('__tp_big') && after === base,
        'failures ' + base + ' -> ' + t.fail.length + ' (' + failed.split(' | ').filter(x => /__tp_/.test(x)).map(x => x.replace(/ ".*/, '')).join(', ') + '), exception: ' + exc.split(' | ').filter(x => /__tp_/.test(x)).map(x => x.replace(/ ".*/, '')).join(', ') + ' -> ' + after);
  }
  // -- overlap and covered
  {
    const base = await ev(() => ({ o: window.__L.overlaps(null).out.length, r: window.__L.sweepReach(null).bad.length, e: window.__L.sweepEach(null).bad.length }));
    await ev(() => {
      const mk = (id, left, top) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.textContent = id; b.style.cssText = 'position:fixed;z-index:99999;width:100px;height:40px;left:' + left + 'px;top:' + top + 'px;background:#fff;color:#000;border:1px solid #888;'; document.body.appendChild(b); };
      mk('__ov_under', 100, 250); mk('__ov_over', 120, 260);
    });
    const d = await ev(() => ({ o: window.__L.overlaps(null).out, r: window.__L.sweepReach(null).bad, e: window.__L.sweepEach(null).bad }));
    const overlay = await ev(() => ({ o: window.__L.overlaps('#__ov_over').out.length, r: window.__L.sweepReach('#__ov_over').bad.filter(x => /__ov_under/.test(x.name)).length }));
    await ev(() => document.querySelectorAll('[id^=__ov_]').forEach(e => e.remove()));
    const after = await ev(() => ({ o: window.__L.overlaps(null).out.length, r: window.__L.sweepReach(null).bad.length, e: window.__L.sweepEach(null).bad.length }));
    chk(6, 'the overlap sweep reports two buttons stacked over each other, the reach sweeps report the one underneath as covered by the other, a declared overlay excuses it, and all is clean again once they are removed',
        d.o.some(x => /__ov_under/.test(x.a + x.b) && /__ov_over/.test(x.a + x.b)) && d.r.some(x => /__ov_under/.test(x.name) && /__ov_over/.test(x.by)) && d.e.some(x => /__ov_under/.test(x.name) && /__ov_over/.test(x.by)) &&
        overlay.o === base.o && overlay.r === 0 && after.o === base.o && after.r === base.r && after.e === base.e,
        'overlaps ' + base.o + ' -> ' + d.o.length + ', covered ' + base.r + ' -> ' + d.r.length + ' (each-control sweep ' + base.e + ' -> ' + d.e.length + '), with the overlay declared: ' + overlay.o + ' overlap(s), ' + overlay.r + ' covered -> ' + after.o + '/' + after.r + '/' + after.e);
  }
  // -- sideways scroll
  {
    const b0 = await ev(() => window.__L.overflow());
    await ev(() => { const d = document.createElement('div'); d.id = '__wide'; d.textContent = 'wide'; d.style.cssText = 'position:absolute;left:0;top:300px;width:' + (__L.vw + 240) + 'px;height:20px;background:#ccc'; document.body.appendChild(d); });
    const d = await ev(() => window.__L.overflow());
    await ev(() => document.getElementById('__wide').remove());
    const a = await ev(() => window.__L.overflow());
    chk(6, 'the sideways-scroll sweep reports a box wider than the screen (and names it), and is clean again once it is removed',
        b0.sw <= b0.iw && d.sw > d.iw && d.wide.some(x => /__wide/.test(x)) && a.sw <= a.iw, b0.sw + ' -> ' + d.sw + ' (' + d.wide.join('; ') + ') -> ' + a.sw + ' px in a ' + a.iw + ' px window');
  }
  // -- text cut off by its box
  {
    const b0 = await ev(() => window.__L.clippedText([]).length);
    await ev(() => {
      const c = document.createElement('div'); c.id = '__cut'; c.textContent = 'a long sentence that does not fit in a box sixty pixels wide'; c.style.cssText = 'position:fixed;left:20px;top:500px;width:60px;overflow:hidden;white-space:nowrap;font-size:14px;z-index:99999;background:#fff;color:#000';
      const e = document.createElement('div'); e.id = '__ell'; e.textContent = 'a long sentence that does not fit in a box sixty pixels wide'; e.style.cssText = 'position:fixed;left:20px;top:540px;width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px;z-index:99999;background:#fff;color:#000';
      const s = document.createElement('div'); s.id = '__scroll'; s.textContent = 'a long sentence that does not fit in a box sixty pixels wide'; s.style.cssText = 'position:fixed;left:20px;top:580px;width:60px;overflow-x:auto;white-space:nowrap;font-size:14px;z-index:99999;background:#fff;color:#000';
      const p = document.createElement('div'); p.id = '__spill'; p.textContent = 'text sticking out of its own box'; p.style.cssText = 'position:fixed;left:20px;top:620px;width:60px;white-space:nowrap;font-size:14px;z-index:99999;background:#fff;color:#000';
      document.body.append(c, e, s, p);
    });
    const d = await ev(() => window.__L.clippedText([]).map(x => x.name + ' ' + x.why));
    await ev(() => document.querySelectorAll('#__cut, #__ell, #__scroll, #__spill').forEach(e => e.remove()));
    const a = await ev(() => window.__L.clippedText([]).length);
    chk(6, 'the clipped-text sweep reports text cut off by a box (overflow: hidden) and text sticking out of its own box, but not text that declares an ellipsis or scrolls, and is clean again once they are removed',
        d.some(x => /__cut/.test(x)) && d.some(x => /__spill/.test(x)) && !d.some(x => /__ell|__scroll/.test(x)) && b0 === a && d.length === b0 + 2, b0 + ' -> ' + d.length + ' (' + d.filter(x => /__/.test(x)).map(x => x.replace(/ ".*?"/, '')).join('; ') + ') -> ' + a);
  }
  // -- a popover hanging off the screen
  {
    const b0 = await ev(() => window.__L.panels().filter(p => !p.inside || !p.footOk).length);
    await ev(() => {
      const d = document.createElement('div'); d.id = '__pop'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'violator');
      d.style.cssText = 'position:fixed;z-index:99999;top:100px;left:' + (__L.vw - 60) + 'px;width:260px;height:120px;background:#fff;color:#000;border:1px solid #888';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'last'; d.appendChild(b); document.body.appendChild(d);
    });
    const d = await ev(() => window.__L.panels().filter(p => /violator/.test(p.name)).map(p => p.left + '..' + p.right + ' inside=' + p.inside));
    await ev(() => document.getElementById('__pop').remove());
    const a = await ev(() => window.__L.panels().filter(p => !p.inside || !p.footOk).length);
    chk(6, 'the panel sweep reports a popover that runs off the right edge of the screen, and is clean again once it is removed', d.length === 1 && /inside=false/.test(d[0]) && a === b0, b0 + ' -> ' + d.join(';') + ' -> ' + a);
  }
  await ctx.close();
}

/* ---- main ---------------------------------------------------------------------------------------------------------------------------- */
(async () => {
  const t0 = Date.now();
  try { for (const f of fs.readdirSync(SCREENS)) if (/^layout-.*\.png$/.test(f)) fs.unlinkSync(path.join(SCREENS, f)); } catch (e) { /* no folder yet */ }
  const srv = await H.up({ target: 'new' });
  const { chromium } = H.playwright({ testFlag: false });
  const browser = await chromium.launch({ args: H.GL_ARGS });   // software WebGL: the page opens on its globe, which is a thing to measure

  for (const size of SIZES) {
    const ts = Date.now();
    try {
      {
        const { acc } = await walkSize(browser, srv, size, { sweeps: want(1) || want(2) || want(3) || want(4), structure: want(5) });
        // ---- group 1
        if (want(1)) chk(1, size.id + ': no horizontal page scroll in any of ' + acc.states.length + ' states x 2 schemes (' + acc.states.join(', ') + ')', acc.overflow.size === 0, acc.overflow.size ? summarise(acc.overflow) : 'scrollWidth <= the window width throughout');
        // ---- group 2
        if (want(2)) {
          chk(2, size.id + ': a tap at the centre of every control lands on it (page at its top, stage foot at the foot of the screen, stage top at the top, page foot; and each control in the middle of the screen)',
              acc.reach.size === 0 && acc.each.size === 0 && acc.controls >= 15, acc.reach.size || acc.each.size ? [summarise(acc.reach), summarise(acc.each)].filter(Boolean).join(' || ') : acc.controls + ' controls at most in one state' + (acc.controls < 15 ? ' - TOO FEW: the sweep is not seeing the page' : ''));
          chk(2, size.id + ': no two controls\' boxes overlap', acc.overlap.size === 0, acc.overlap.size ? summarise(acc.overlap) : 'none');
          chk(2, size.id + ': every popover and panel is inside the viewport and its last control can be reached', acc.panels.size === 0, acc.panels.size ? summarise(acc.panels) : 'all inside');
        }
        // ---- group 3
        if (want(3)) {
          chk(3, size.id + ': no visible text under ' + MIN_TEXT_PX + ' px', acc.small.size === 0 && acc.textSeen >= 60, acc.small.size ? summarise(acc.small) : acc.textSeen + ' text boxes at most in one state, none under ' + MIN_TEXT_PX + ' px' + (acc.textSeen < 60 ? ' - TOO FEW: the sweep is not seeing the page' : ''));
          chk(3, size.id + ': no text cut off by, or sticking out of, the box that is meant to hold it whole', acc.clipped.size === 0, acc.clipped.size ? summarise(acc.clipped) : 'none');
        }
        // ---- group 4
        if (want(4) && size.touch) {
          const exc = [...acc.exception.entries()].map(([k, v]) => k.replace(/ "/, ' "') + ' ' + v);
          const exm = [...acc.exempt.entries()].map(([k, v]) => k + ' (' + v + ')');
          chk(4, size.id + ': every control is 44 x 44 px, or at least 24 x 24 with 8 px clear of every other target', acc.taps.size === 0 && acc.tapFull > 0, acc.taps.size ? tapSummary(acc.taps) : acc.tapFull + ' controls are 44 x 44 or more; ' + acc.exception.size + ' rely on the exception; ' + acc.exempt.size + ' exempt',
              [acc.exception.size ? 'rely on the 24 px + 8 px exception: ' + exc.join('; ') : '', acc.exempt.size ? 'exempt (WCAG 2.5.8 inline / user-agent control): ' + exm.join('; ') : ''].filter(Boolean));
        }
      }
      if (want(5)) await timed('header loads', () => headerChecks(browser, srv, size));

    } catch (e) { crashes.push(size.id + ': ' + String(e.stack || e.message).split('\n').slice(0, 3).join(' / ')); }
    console.log('  .. ' + size.id + ' measured in ' + ((Date.now() - ts) / 1000).toFixed(1) + ' s');
  }
  if (want(6)) { try { await selfTests(browser, srv); } catch (e) { crashes.push('self-tests: ' + String(e.stack || e.message).split('\n').slice(0, 3).join(' / ')); } }
  await browser.close();
  await srv.close();

  // ---- print, group by group
  for (const g of [1, 2, 3, 4, 5, 6]) {
    if (!want(g) || !OUT[g].length) continue;
    console.log('\n== ' + g + '. ' + GROUPS[g] + ' ==');
    for (const r of OUT[g]) {
      console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail !== '' ? '   ' + r.detail : ''));
      if (VERBOSE || !r.ok || r.notes.length) for (const n of r.notes) console.log('          ' + n);
    }
  }
  if (crashes.length) { console.log('\nCOULD NOT MEASURE:'); for (const c of crashes) console.log('  FAIL  ' + c); }
  console.log('\npage errors: ' + (pageErrors.length ? pageErrors.slice(0, 6).join(' | ') : 'none'));
  if (VERBOSE) console.log('time by phase (ms): ' + Object.entries(TIMES).map(([k, v]) => k + ' ' + v).join(', '));
  const ok = fails === 0 && crashes.length === 0 && pageErrors.length === 0;
  console.log((passes + fails) + ' checks, ' + passes + ' passed, ' + (shots ? shots + ' picture' + (shots === 1 ? '' : 's') + ' in verification/screens/layout-*.png, ' : '') + 'in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  const partial = ONLY || SIZES_ONLY;
  if (ok && !partial) console.log('ALL CHECKS PASS');
  else if (ok) console.log('(a subset: the full run is the one that ends ALL CHECKS PASS)');
  else console.log((fails + crashes.length) + ' CHECK(S) FAILED' + (pageErrors.length ? '   PAGE ERRORS: ' + pageErrors.length : ''));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
