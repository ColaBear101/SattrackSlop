/* layout-probe.js - the measuring code verify-layout.js runs INSIDE the page.
 *
 * `install` is serialised by Playwright (addInitScript) and run in every document, where it defines window.__L. Nothing in it may refer to
 * anything outside itself (no closures over Node values, no require). The sweeps are generic: they look at what is on screen, not at the ids
 * of one design, so the same functions find a covered button, a 9 px label or a 20 px tap target wherever it is. verify-layout.js's self-test
 * group injects each kind of violator and asserts these functions report it: a sweep that cannot see a violator is not a check.
 *
 * Vocabulary
 *   control  a button, link, field, select, summary, tab or option that a person can point at, and that is on screen (laid out, not
 *            display:none, not visibility:hidden, not opacity:0, not inside a closed <details>, at least 3 x 3 px: a 1 px box is the
 *            visually-hidden idiom).
 *   overlay  a selector the state under test declares as covering the page on purpose (an open popover, the expanded answer sheet, the
 *            planner's sheet). A control outside it that is covered BY it is not a defect; a control that is covered by anything else is.
 */
'use strict';

function install() {
  const L = window.__L = {};
  /* The window the context was given. In a mobile context a page that is wider than the screen makes window.innerWidth GROW to fit it (the
     browser zooms out), so `scrollWidth <= innerWidth` is true of any page there. The runner sets these from the size it asked for (setWindow);
     until it does, they are what the window says. */
  L.vw = window.innerWidth; L.vh = window.innerHeight;
  L.setWindow = (w, h) => { L.vw = w; L.vh = h; };

  /* ---- what counts as a control ----------------------------------------------------------------------------------------------- */
  const CTRL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab], [role=option], [role=button], [role=link], ' +
    '[role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=slider], [role=combobox]';
  L.CTRL = CTRL;

  L.shown = e => {
    if (!e || !e.isConnected) return false;
    if (e.checkVisibility && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width >= 3 && r.height >= 3;
  };

  /* A short name for a report: tag, id or first class, and the words on it. */
  L.name = e => {
    if (!e || !e.tagName) return String(e);
    let s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    else if (e.classList && e.classList.length) {
      const c = [...e.classList].find(x => !/^svelte-/.test(x));
      if (c) s += '.' + c;
    }
    const t = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || e.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
    if (t) s += ' "' + t.slice(0, 22) + (t.length > 22 ? '…' : '') + '"';
    return s;
  };

  /* ---- the box a person can see: the border box cut by every ancestor that clips it ------------------------------------------- */
  /* An absolutely positioned box is clipped only from its containing block outwards, a fixed one not at all. */
  L.visibleBox = e => {
    const r = e.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    let cur = e;
    for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const pos = getComputedStyle(cur).position;
      if (pos === 'fixed') break;
      const c = getComputedStyle(a);
      if (pos === 'absolute' && c.position === 'static' && c.transform === 'none') continue;
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        const pl = ar.left + a.clientLeft, pt = ar.top + a.clientTop, pr = pl + a.clientWidth, pb = pt + a.clientHeight;
        if (c.overflowX !== 'visible') { x0 = Math.max(x0, pl); x1 = Math.min(x1, pr); }
        if (c.overflowY !== 'visible') { y0 = Math.max(y0, pt); y1 = Math.min(y1, pb); }
      }
      cur = a;
    }
    return { x0, y0, x1, y1, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };

  /* Scroll every scrollable ancestor (never the page) so that e is inside it, as a person scrolling a panel or a row would; returns the undo. */
  L.reveal = (e, mode) => {
    const undo = [];
    for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const c = getComputedStyle(a);
      const sx = /(auto|scroll)/.test(c.overflowX) && a.scrollWidth > a.clientWidth;
      const sy = /(auto|scroll)/.test(c.overflowY) && a.scrollHeight > a.clientHeight;
      if (!sx && !sy) continue;
      undo.push([a, a.scrollLeft, a.scrollTop]);
      const r = e.getBoundingClientRect(), ar = a.getBoundingClientRect();
      /* the scrollport, less the container's scroll-padding: what a browser keeps clear when it scrolls a focused control into view
         (the planner's drawer says it keeps 76 px clear of its sticky Add bar) */
      const sp = k => { const v = parseFloat(c['scrollPadding' + k]); return isFinite(v) ? v : 0; };
      const pl = ar.left + a.clientLeft + sp('Left'), pt = ar.top + a.clientTop + sp('Top'), pr = ar.left + a.clientLeft + a.clientWidth - sp('Right'), pb = ar.top + a.clientTop + a.clientHeight - sp('Bottom');
      if (mode === 'center') {
        // as a person scrolling with a wheel might leave it: in the middle of the box, or as near as the scroll range allows
        if (sx) a.scrollLeft += (r.left + r.width / 2) - (pl + (pr - pl) / 2);
        if (sy) a.scrollTop += (r.top + r.height / 2) - (pt + (pb - pt) / 2);
      } else {
        if (sx) { if (r.right > pr) a.scrollLeft += r.right - pr; if (r.left < pl) a.scrollLeft -= pl - r.left; }
        if (sy) { if (r.bottom > pb) a.scrollTop += r.bottom - pb; if (r.top < pt) a.scrollTop -= pt - r.top; }
      }
    }
    return () => { for (let i = undo.length - 1; i >= 0; i--) { const [a, x, y] = undo[i]; a.scrollLeft = x; a.scrollTop = y; } };
  };

  /* A control parked off the top or the left of the document (the skip links, until they take focus) can never be scrolled to: it is not on
     screen, and the structure group looks at it by focusing it. */
  L.offCanvas = e => { const r = e.getBoundingClientRect(); return r.bottom + scrollY <= 0 || r.right + scrollX <= 0; };
  L.controls = () => [...document.querySelectorAll(CTRL)].filter(e => L.shown(e) && !L.offCanvas(e));
  const inOv = (e, ov) => !!ov && !!e.closest(ov);
  /* Where a finger would land on a control: the centre of the largest box it is drawn in. A link that wraps over two lines is two boxes, and the
     centre of the box that holds both can fall in the gap between them, on the paragraph. */
  L.point = e => {
    const rs = [...e.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
    const r = rs.length ? rs.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)) : e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const fixedIn = e => { for (let a = e; a && a !== document.documentElement; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true; return false; };

  /* ---- 1. the page does not scroll sideways ---------------------------------------------------------------------------------- */
  /* Which boxes make the page wider: those whose visible part (cut by every scroll container) sticks out of the window, widest first. A fixed box
     stretches with the layout viewport and never makes the page scroll, so it is not listed. */
  L.overflow = () => {
    const sw = document.documentElement.scrollWidth, iw = L.vw;
    const wide = [];
    if (sw > iw || document.body.scrollWidth > iw) {
      const c = [];
      for (const e of document.body.querySelectorAll('*')) {
        if (!L.shown(e) || fixedIn(e)) continue;
        const v = L.visibleBox(e);
        if (!v.w || !v.h) continue;
        if (v.x1 > iw + 0.5 || v.x0 < -0.5) c.push({ e, v });
      }
      // the outermost: one whose parent also sticks out adds nothing
      const set = new Set(c.map(x => x.e));
      const top = c.filter(x => !(x.e.parentElement && set.has(x.e.parentElement)));
      top.sort((p, q) => q.v.x1 - p.v.x1);
      for (const x of top.slice(0, 5)) wide.push(L.name(x.e) + ' ' + Math.round(x.v.x0) + '..' + Math.round(x.v.x1));
    }
    return { sw, iw, bsw: document.body.scrollWidth, wide };
  };

  /* ---- 2. reach: nothing sits over a control ---------------------------------------------------------------------------------- */
  /* Where the page is scrolled to. 'foot' of the stage means the foot of the screen as the page declares it (scroll-padding-bottom: the fixed
     answer sheet covers the last 72 px of a phone's screen, and the page says so), so the lower edge of the stage is placed just above it. */
  L.positions = () => {
    const root = document.documentElement, maxY = Math.max(0, root.scrollHeight - L.vh);
    const clamp = y => Math.max(0, Math.min(maxY, Math.round(y)));
    const pad = parseFloat(getComputedStyle(root).scrollPaddingBottom) || 0;
    const st = document.querySelector('section.stage') || document.querySelector('.stage');
    const out = { top: 0 };
    if (st) {
      const r = st.getBoundingClientRect();
      out['stage-foot'] = clamp(scrollY + r.bottom - (L.vh - pad) + 2);
      out['stage-top'] = clamp(scrollY + r.top);
    }
    out['page-foot'] = maxY;
    return out;
  };

  L.reach = (overlay, onlyInside) => {
    const out = [];
    for (const e of L.controls()) {
      if (onlyInside && !e.closest(onlyInside)) continue;
      const undo = L.reveal(e);
      const { x: cx, y: cy } = L.point(e);
      const rec = { name: L.name(e), y: Math.round(cy), x: Math.round(cx) };
      if (cx < 0 || cx > L.vw || cy < 0 || cy > L.vh) rec.off = true;
      else {
        const h = document.elementFromPoint(cx, cy);
        rec.ok = !!h && (h === e || e.contains(h) || (e.labels && [...e.labels].some(l => l.contains(h))));
        if (!rec.ok) {
          rec.by = h ? L.name(h) : 'nothing';
          rec.excused = !!(h && overlay && h.closest(overlay) && !e.closest(overlay));
        }
      }
      undo();
      out.push(rec);
    }
    return out;
  };

  /* Every control, at each of the page's scroll positions: how many were tested, and which were covered (and by what). */
  /* At the first screen and at the stage's edges the controls tested are the stage's own (what the old suite called the globe's buttons: the
     picture's edge at the screen's edge is where a docked bar sits on them); at the foot of the page, all of them (the last links must clear a fixed
     sheet). Every control is also tested from the middle of the screen (sweepEach), which is where anything that scrolls under a fixed bar is
     reached. */
  L.sweepReach = (overlay) => {
    const y0 = scrollY, pos = L.positions(), seen = new Map(), bad = [];
    for (const [pname, y] of Object.entries(pos)) {
      scrollTo(0, y);
      for (const r of L.reach(overlay, pname === 'page-foot' ? null : 'section.stage')) {
        const k = r.name;
        if (!seen.has(k)) seen.set(k, { tested: false });
        if (r.off) continue;
        seen.get(k).tested = true;
        if (!r.ok && !r.excused) bad.push({ pos: pname, scrollY: y, name: r.name, by: r.by, x: r.x, y: r.y });
      }
    }
    scrollTo(0, y0);
    return { n: seen.size, bad, positions: pos };
  };

  /* Every control in the page, one at a time, scrolled to the middle of the screen, centre tested. Catches what the edge positions cannot:
     a control that is covered wherever it is (a fixed layer over it), or clipped away (a box with overflow: hidden). */
  L.sweepEach = (overlay) => {
    const y0 = scrollY, bad = [];
    let n = 0;
    for (const e of L.controls()) {
      const b0 = e.getBoundingClientRect();
      if (b0.height > L.vh * 0.9) continue;
      scrollBy(0, b0.top + b0.height / 2 - L.vh / 2);
      const undo = L.reveal(e, 'center');
      const { x: cx, y: cy } = L.point(e);
      if (cx >= 0 && cx <= L.vw && cy >= 0 && cy <= L.vh) {
        n++;
        const h = document.elementFromPoint(cx, cy);
        const ok = !!h && (h === e || e.contains(h) || (e.labels && [...e.labels].some(l => l.contains(h))));
        if (!ok && !(h && overlay && h.closest(overlay) && !e.closest(overlay))) bad.push({ name: L.name(e), by: h ? L.name(h) : 'nothing' });
      }
      undo();
    }
    scrollTo(0, y0);
    return { n, bad };
  };

  /* ---- 2. overlap: no two controls' boxes overlap ----------------------------------------------------------------------------- */
  /* A fixed or sticky layer (the answer sheet, the report's navigation, the planner's Add bar) lies over whatever the page scrolls beneath it: that
     depends on where the page is scrolled to, so it is the reach sweeps' business (they scroll), not a box comparison's. */
  const layer = e => { for (let a = e; a && a !== document.documentElement; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === 'fixed' || p === 'sticky') return a; } return null; };
  /* The boxes a control is drawn in, each cut by the scroll containers that clip it (a link that wraps over two lines is two boxes: the box that
     holds both is mostly somebody else's text). */
  const boxes = e => {
    const vb = L.visibleBox(e), out = [];
    for (const r of e.getClientRects()) {
      const x0 = Math.max(r.left, vb.x0), y0 = Math.max(r.top, vb.y0), x1 = Math.min(r.right, vb.x1), y1 = Math.min(r.bottom, vb.y1);
      if (x1 - x0 > 0.1 && y1 - y0 > 0.1) out.push({ x0, y0, x1, y1 });
    }
    return out;
  };
  L.overlaps = (overlay) => {
    const cs = L.controls().map(e => ({ e, bx: boxes(e), o: inOv(e, overlay), l: layer(e) }));
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const A = cs[i], B = cs[j];
        if (A.e.contains(B.e) || B.e.contains(A.e)) continue;
        if (overlay && A.o !== B.o) continue;            // an overlay is over the page on purpose
        if ((A.l === null) !== (B.l === null)) continue; // one is in a fixed or sticky layer and the other is not: where the page is scrolled to decides
        if (A.l && B.l && A.l !== B.l && (A.l.contains(B.l) || B.l.contains(A.l))) continue;   // a sticky bar inside a fixed sheet, over what scrolls under it
        let hit = null;
        for (const a of A.bx) for (const b of B.bx) {
          const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          /* 0.1 px is the float noise of two boxes that share an edge, not a tolerance on what is visible */
          if (w > 0.1 && h > 0.1 && (!hit || w * h > hit.w * hit.h)) hit = { w, h };
        }
        if (hit) out.push({ a: L.name(A.e), b: L.name(B.e), w: +hit.w.toFixed(1), h: +hit.h.toFixed(1) });
      }
    }
    return { n: cs.length, out };
  };

  /* ---- 2. panels: inside the viewport horizontally, foot reachable ------------------------------------------------------------ */
  L.PANELS = '[role=dialog], #planner, aside.rail.sheet.open';
  L.panels = () => {
    const out = [], y0 = scrollY;
    for (const p of document.querySelectorAll(L.PANELS)) {
      if (!L.shown(p)) continue;
      const r = p.getBoundingClientRect();
      const rec = { name: L.name(p), left: Math.round(r.left), right: Math.round(r.right), iw: L.vw };
      rec.inside = r.left >= 0 && r.right <= L.vw;
      const cs = [...p.querySelectorAll(CTRL)].filter(L.shown);
      if (cs.length) {
        // the last control: bring it on screen the way a person would (scroll the panel, then the page, as little as it takes) and tap it
        const last = cs[cs.length - 1];
        const undo = L.reveal(last, 'center');
        let b = last.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0;   // the fixed answer sheet's 72 px on a phone
        if (b.bottom > L.vh - pad) scrollBy(0, b.bottom - (L.vh - pad) + 8);
        else if (b.top < 0) scrollBy(0, b.top - 8);
        const { x: cx, y: cy } = L.point(last);
        const h = document.elementFromPoint(cx, cy);
        rec.foot = L.name(last);
        rec.footOk = cx >= 0 && cx <= L.vw && cy >= 0 && cy <= L.vh && !!h && (h === last || last.contains(h) || (last.labels && [...last.labels].some(l => l.contains(h))));
        if (!rec.footOk) rec.footBy = h ? L.name(h) : 'nothing';
        undo();
        scrollTo(0, y0);
      } else { rec.footOk = true; }
      out.push(rec);
    }
    return out;
  };

  /* ---- 3. text ---------------------------------------------------------------------------------------------------------------- */
  /* Visible text under `min` px computed. `except` is a list of [selector, why]: text inside a match is not counted (verify-layout.js says
     why for each). Canvases hold no DOM text. */
  L.smallText = (min, except) => {
    const out = [], seen = new Set(), skipped = {};
    let looked = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      const e = n.parentElement;
      if (!t || !e || seen.has(e)) continue;
      if (e.closest('script, style, noscript, template, canvas')) continue;
      seen.add(e);
      if (!L.shown(e)) continue;
      const vb = L.visibleBox(e);
      if (!vb.w || !vb.h) continue;                      // clipped away entirely: it is not on screen (the clipped-text sweep reports it)
      looked++;
      const fs = parseFloat(getComputedStyle(e).fontSize);
      if (!(fs < min)) continue;
      const ex = (except || []).find(x => e.closest(x[0]));
      if (ex) { skipped[ex[0]] = (skipped[ex[0]] || 0) + 1; continue; }
      out.push({ fs: +fs.toFixed(2), text: t.slice(0, 26), name: L.name(e) });
    }
    return { small: out, skipped, seen: looked };
  };

  /* Text that does not fit the box that is meant to hold it. Two shapes of the same defect:
       cut    an element that clips (overflow: hidden / clip) holds content wider, or taller, than it is, and does not say it truncates
              (text-overflow: ellipsis) or scroll (overflow: auto / scroll);
       spills an element with text of its own, which does not clip, has that text sticking out of its own box.
     A box that is wider than the screen is the page-width check's, and an absolutely positioned popover that hangs out of its anchor is not text. */
  L.clippedText = (except) => {
    const out = [];
    const X = /^(hidden|clip)$/;
    for (const e of document.body.querySelectorAll('*')) {
      if (e.closest('svg, canvas, script, style, template')) continue;
      const c = getComputedStyle(e);
      if (c.display === 'inline' || c.display === 'contents' || c.display === 'none') continue;
      if (/^(input|textarea|select|img|video|iframe|button)$/i.test(e.tagName) && !e.textContent.trim()) continue;
      if (!L.shown(e) || !e.textContent.trim()) continue;
      if ((except || []).some(x => e.matches(x[0]))) continue;
      const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
      const clipX = X.test(c.overflowX), clipY = X.test(c.overflowY);
      if (!own.length && !clipX && !clipY) continue;
      const ell = c.textOverflow === 'ellipsis';
      const dx = e.scrollWidth - e.clientWidth, dy = e.scrollHeight - e.clientHeight;
      let why = '';
      const textBox = n => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect(); };
      if (clipX && !ell && dx >= 1) {
        // scrollWidth and clientWidth are whole pixels: a difference of one may be rounding, so measure the content itself
        let over = dx;
        if (dx === 1) {
          const rr = textBox(e), b = e.getBoundingClientRect();
          over = Math.max(rr.right - (b.right - parseFloat(c.borderRightWidth) - parseFloat(c.paddingRight)), (b.left + parseFloat(c.borderLeftWidth) + parseFloat(c.paddingLeft)) - rr.left);
        }
        if (over > 0.5) why = 'cut: content ' + Math.round(over * 10) / 10 + ' px wider than the box (overflow-x: ' + c.overflowX + ')';
      }
      if (!why && clipY && dy >= 1) why = 'cut: content ' + dy + ' px taller than the box (overflow-y: ' + c.overflowY + ')';
      if (!why && own.length && !clipX && !ell && !/(auto|scroll)/.test(c.overflowX)) {
        let l = Infinity, r = -Infinity;
        for (const n of own) { const rr = textBox(n); if (rr.width) { l = Math.min(l, rr.left); r = Math.max(r, rr.right); } }
        const b = e.getBoundingClientRect();
        const spill = Math.max(r - b.right, b.left - l);
        if (spill > 0.5) why = 'spills: its text sticks out of its box by ' + Math.round(spill * 10) / 10 + ' px';
      }
      if (why) out.push({ name: L.name(e), why });
    }
    return out.length > 12 ? out.slice(0, 12).concat([{ name: '...and ' + (out.length - 12) + ' more', why: '' }]) : out;
  };

  /* ---- 4. tap targets --------------------------------------------------------------------------------------------------------- */
  /* WCAG 2.2 SC 2.5.8 and the plan: a target is 44 x 44 CSS px, or at least 24 x 24 with 8 px clear of every other target. Exempt, and
     named as such in the report: a link or text button inside a sentence (the criterion's "inline" exception), and a range slider the page has
     not restyled (the "user agent control" exception). A check box or radio is measured with its label, which is what a finger lands on. */
  L.tapExempt = e => {
    const c = getComputedStyle(e);
    if (e.matches('input[type=range]') && c.appearance === 'auto') return 'user-agent range slider';
    if (e.matches('a, button') && (c.display === 'inline' || (c.display === 'inline-block' && e.classList.contains('link')))) {
      // the nearest ancestor that is a block of text, and the words it holds outside any control
      let blk = e.parentElement;
      while (blk && getComputedStyle(blk).display === 'inline') blk = blk.parentElement;
      let words = 0;
      if (blk) {
        const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) { if (n.parentElement.closest(CTRL)) continue; words += (n.textContent.match(/[A-Za-z0-9]{3,}/g) || []).length; }
      }
      if (words >= 2) return 'inline in a sentence';
    }
    return '';
  };

  L.taps = (opt) => {
    const FULL = opt.full, MIN = opt.min, CLEAR = opt.clear;
    const T = [];
    for (const e of L.controls()) {
      let b = e.getBoundingClientRect(), shownBox = b;
      if (e.matches('input[type=checkbox], input[type=radio]') && e.labels && e.labels.length) {
        const lb = e.labels[0].getBoundingClientRect();
        shownBox = { left: Math.min(b.left, lb.left), top: Math.min(b.top, lb.top), right: Math.max(b.right, lb.right), bottom: Math.max(b.bottom, lb.bottom) };
        shownBox.width = shownBox.right - shownBox.left; shownBox.height = shownBox.bottom - shownBox.top;
      }
      // covered by something else on purpose (a popover over the stage, the sheet over the page): not a target while it is covered
      const { x: cx, y: cy } = L.point(e);
      if (cx >= 0 && cx <= L.vw && cy >= 0 && cy <= L.vh) {
        const h = document.elementFromPoint(cx, cy);
        if (h && h !== e && !e.contains(h) && !(e.labels && [...e.labels].some(l => l.contains(h)))) continue;
      }
      /* what a neighbour can crowd is the part of it that is on screen: a list row scrolled out of its box is not next to anything outside the box */
      const vb = L.visibleBox(e);
      T.push({ e, b: shownBox, v: { left: vb.x0, top: vb.y0, right: vb.x1, bottom: vb.y1, w: vb.w, h: vb.h }, name: L.name(e), exempt: L.tapExempt(e) });
    }
    const gap = (A, B) => {
      const dx = Math.max(B.left - A.right, A.left - B.right, 0), dy = Math.max(B.top - A.bottom, A.top - B.bottom, 0);
      return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
    };
    const res = { full: 0, exception: [], exempt: [], fail: [], n: T.length };
    for (const t of T) {
      const w = t.b.width, h = t.b.height;
      let clear = Infinity;
      for (const o of T) {
        if (o === t || o.e.contains(t.e) || t.e.contains(o.e)) continue;
        if (!o.v.w || !o.v.h) continue;
        clear = Math.min(clear, gap(t.b, o.v));
      }
      const rec = { name: t.name, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, clear: isFinite(clear) ? Math.round(clear * 10) / 10 : 999 };
      if (t.exempt) { rec.why = t.exempt; res.exempt.push(rec); }
      else if (w >= FULL && h >= FULL) res.full++;
      else if (w >= MIN && h >= MIN && clear >= CLEAR) res.exception.push(rec);
      else res.fail.push(rec);
    }
    return res;
  };

  L.coarse = () => matchMedia('(pointer: coarse)').matches;
}

module.exports = { install };
