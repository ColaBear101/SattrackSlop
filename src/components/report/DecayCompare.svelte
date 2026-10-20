<svelte:options css="injected" />

<script module lang="ts">
  import { mount } from 'svelte';
  import { compare } from '../../state/decay-compare.svelte';
  import Panel from './DecayCompare.svelte';

  /* The Decay section (DecaySection.svelte) holds the opener, "Compare with other spacecraft" (#cmpopen), and the panel's empty slot
     (#cmppanel), and imports nothing of this: it asks for this chunk at the opener's first press, or when the section comes near with
     the panel left open in the record, and calls attach(). The panel is mounted into the slot once, and from then on whether it is
     open is the record's (compare.open), which the panel itself writes onto the opener (aria-expanded) and the slot (hidden). So the
     report's chunk carries the button, its words and the import, and nothing else of the comparison, its style included: that is
     injected by this chunk (svelte:options above), so the report's chunk need not name a stylesheet for it either. */
  let at: HTMLElement | null = null;
  /** The panel put in its slot (once per slot); and at a press of the opener (`pressed`), opened or shut, as the button said when it
   *  was pressed. */
  export function attach(pressed?: boolean): void {
    const slot = document.getElementById('cmppanel');
    if (slot && slot !== at) { mount(Panel, { target: slot }); at = slot; }
    if (pressed) compare.setOpen(document.getElementById('cmpopen')?.getAttribute('aria-expanded') !== 'true');
  }
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { app, PINNED } from '../../state/app.svelte';
  import { life } from '../../state/life.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import { watch } from '../../state/watch.svelte';
  import { rank, SHOWN_MAX } from '../../lib/catalogue/rank';
  import { watchedFirst } from '../../lib/catalogue/watch';
  import {
    COMPARE_MAX, DAY_MS, fetchPlan, notDrawn, PARAMS, RANGES, ROWS_SHOWN, type CmpParam, type CmpRange, type Win
  } from '../../lib/decay/compare';
  import {
    CMP_ADD, CMP_ADD_DIALOG, CMP_ALT_NAME, CMP_CATALOGUE, CMP_CLEAR, CMP_DECAYED_NOTE, CMP_DRAG_HINT, CMP_FETCH, CMP_LIST_NAME, CMP_LISTED,
    CMP_NO_MATCH, CMP_NOTHING_DRAWN, CMP_PARAMS, CMP_PLANNED, CMP_RANGE, CMP_RANGE_TITLES, CMP_RANGES, CMP_RATE_NAME, CMP_READING,
    CMP_RESET, CMP_RETRY, CMP_ROWS_NAME, CMP_SCRUB_HINT, CMP_SCRUB_KEYS, CMP_SCRUB_NAME, CMP_SEARCH_NAME, CMP_SEARCH_PLACEHOLDER, CMP_SELECTED,
    CMP_SHOW, CMP_WAIT_NOTE, CMP_WATCHED, cmpAddWatched, cmpAxis, cmpChartName, cmpClearArmed, cmpDay, cmpFetching, cmpFetchMore,
    cmpFetchName, cmpHighlightName, cmpMoreMatch, cmpNoParam, cmpNotDrawn, cmpNote, cmpQueued, cmpRemoveName, cmpRetryName, cmpScrubText,
    cmpScrubView, cmpShowFirst, cmpShowOthers
  } from '../../lib/text/life-compare';
  import {
    colorOf, compareKey, compareTipAt, drawCompare, readCmpColors, type CmpColors, type CmpGeom, type CmpKeyItem, type CmpSeries, type CmpTipRow,
    type DrawInfo
  } from './draw-compare';
  import Button from '../ui/Button.svelte';
  import Popover from '../ui/Popover.svelte';
  import Segmented from '../ui/Segmented.svelte';

  /* The decay comparison's panel (CHANGES-FROM-LEGACY.md, L66), under the Decay section's own chart, which it does not touch: a toolbar
     (add from the catalogue, add the watched, fetch the rows that wait, clear), a status line, a chart of its own (draw-compare.ts) with
     its key and a readout under the pointer, and the list, the selected spacecraft first. The list, the fetching and the record are the
     store's (state/decay-compare.svelte.ts); this is what the reader sees of them and presses.

     A chunk of its own (DecayCompare), with the store, the model, the chart and the words, asked for by DecaySection.svelte at the first
     press of "Compare with other spacecraft", or when the section comes near with the panel left open (see attach(), above). Nothing
     here asks for a history unless the reader presses something that says so.

     The search is the picker's (rank() over the catalogue, the watched first on an empty query, the best 80, the combobox keys, and the
     picker's own "decayed now" chunk for the marks, never in the snapshot; the line under the list is this panel's, since the
     picker's says what picking does there), with ids of its own: adding keeps the field and the list
     open, so several can be added from one search, and an option already in the comparison, or the selected one, says so and is not
     added again. While it is open, its own line says what an add did, and the status line under the toolbar says nothing, so nothing
     is spoken twice.

     The chart is redrawn only when what it draws changes (which spacecraft, their colours, a forecast), the theme, its width, or its
     view (L67: the quantity, the range, a zoom): the seconds of a wait tick in the list, not in the chart, and the readout under the
     pointer stays put while they do. */

  /* The opener and the panel's slot are the Decay section's (DecaySection.svelte); whether the panel is open is the record's
     (compare.open), so the button says so and the slot shows or hides from here. */
  $effect(() => {
    const o = compare.open;
    document.getElementById('cmpopen')?.setAttribute('aria-expanded', String(o));
    const slot = document.getElementById('cmppanel');
    if (slot) slot.hidden = !o;
  });

  /* ---- the selected spacecraft and the rows --------------------------------------------------------------------------- */

  /* The rows are one line from 900 px (where the section sets its chart and figures side by side), two (or three) below. The one
     line's columns are fixed, or a share of the room with a fixed least, so the rows' columns line up and none is wider than the room
     (the panel's own column is minmax(0, 1fr), so nothing in it widens it); the toggle's and Remove's are as wide as those buttons
     (--tgw), 44 px under a coarse pointer. */

  const sel = $derived(compare.selected);
  const all = $derived(sel ? [sel, ...compare.shown] : compare.shown);
  let unfold = $state(false);
  const visible = $derived(unfold ? all : all.slice(0, ROWS_SHOWN));
  /* nothing left to fold, nothing unfolded: a list cleared or cut to 8 and grown again folds again */
  $effect(() => { if (all.length <= ROWS_SHOWN) unfold = false; });
  const nameOf = (n: string): string => (n === sel && app.entry ? app.entry.name : compare.name(n));
  /** the selected spacecraft's forecast, when it has one that cannot be drawn: why */
  const selNot = $derived(life.chart && !life.chart.custom ? notDrawn(life.chart.r) : null);

  let colors = $state.raw<CmpColors | null>(null);
  $effect(() => { colors = readCmpColors(prefs.resolved); });
  const colorFor = (slot: number): string => (colors ? colorOf(colors, slot) : 'currentColor');

  /* A row moves when it takes or gives back a colour (the highlighted come first), and the browser lets go of the focus of an element
     it moves: whatever in the list had it before the move has it again after, if it is still there. A row that gives back its colour
     goes to its place among the grey ones, which can be in the folded part of the list: then the fold opens, and the same control of
     that row has the focus again. */
  let held: HTMLElement | null = null;
  let heldRow = '';
  $effect.pre(() => {
    void visible;
    const a = document.activeElement, li = a instanceof HTMLElement ? a.closest<HTMLElement>('#cmprows > li') : null;
    held = li ? (a as HTMLElement) : null;
    heldRow = li?.dataset.n ?? '';
  });
  $effect(() => {
    void visible;
    const h = held, n = heldRow;
    held = null;
    if (!h || document.activeElement === h) return;
    if (h.isConnected) { h.focus(); return; }
    if (!all.includes(n) || visible.includes(n)) return;
    const as = h.classList.contains('tg') ? '.tg' : h.classList.contains('rm') ? '.rm' : '.st';
    unfold = true;
    void tick().then(() => document.querySelector<HTMLElement>('#cmprows > li[data-n="' + n + '"] ' + as)?.focus());
  });

  /* A click of a double-click is not a press of its own: the first one's button goes, or its row moves, and the second would land on
     whatever comes under the pointer (another batch of requests, the next row's Remove). Keys give a click with no count (0). */
  const once = (f: () => unknown) => (e: MouseEvent) => { if (e.detail <= 1) void f(); };

  /* a press whose button goes (it asked, and the row now says Queued): the focus would fall to the page, so it goes to that row's state */
  async function rowAsk(n: string, f: () => void) {
    f();
    await tick();
    if (document.activeElement === document.body) document.getElementById('cmpst-' + n)?.focus();
  }
  /* a toolbar button that goes once pressed (nothing left to add or fetch, the list cleared): the focus goes to Add spacecraft */
  async function barPress(f: () => void) {
    f();
    await tick();
    if (document.activeElement === document.body) document.getElementById('cmpadd')?.focus();
  }
  /* Remove: the focus goes to the next row's remove button, else the previous row's, else to Add spacecraft */
  async function drop(n: string) {
    const rest = all.filter(k => k !== sel), j = rest.indexOf(n), next = rest[j + 1] ?? null, prev = j > 0 ? rest[j - 1]! : null;
    compare.remove(n);
    await tick();
    const btn = (k: string | null) => (k ? document.querySelector<HTMLElement>('#cmprows [data-rm="' + k + '"]') : null);
    (btn(next) ?? btn(prev) ?? document.getElementById('cmpadd'))?.focus();
  }

  /* ---- Clear, in two presses -------------------------------------------------------------------------------------------- */

  /* As Forget (ForgetData.svelte): the first press says what a second will do; Escape, the focus leaving, or a press elsewhere stands it
     down; a second press within 0.6 s of the first is the rest of a double-click, and is not one. */
  const GAP_MS = 600;
  let armed = $state(false);
  let armedAt = 0;
  function clearPress() {
    if (!armed) { compare.say = ''; armed = true; armedAt = performance.now(); return; }
    if (performance.now() - armedAt < GAP_MS) return;
    armed = false;
    void barPress(() => compare.clear());
  }
  $effect(() => {
    if (!armed) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('#cmpclear')) armed = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') armed = false; };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
  });

  const plan = $derived(fetchPlan(compare.waiting.length));
  /* the selected spacecraft's own row among them: listed before it was selected, its request may still be out */
  const busy = $derived(compare.queue.length > 0 || all.some(n => compare.rows[n]?.st === 'fetching'));

  /* ---- the search ------------------------------------------------------------------------------------------------------- */

  let addOpen = $state(false);
  let query = $state('');
  let active = $state(0);
  let dk = $state.raw<typeof import('../../state/decayed.svelte')['decayed'] | null>(null);
  const lead = $derived(query.trim() || !app.catalogue.length ? [] : watch.list.map(n => app.catIndex({ satnum: n })).filter(i => i >= 0));
  const hits = $derived(watchedFirst(rank(app.catalogue, query), lead));
  const shownIdx = $derived(hits.slice(0, SHOWN_MAX));
  const more = $derived(hits.length - shownIdx.length);
  const head = (k: number): string => (!lead.length || query.trim() ? '' : k === 0 ? CMP_WATCHED : k === lead.length ? CMP_CATALOGUE : '');
  const taken = (satnum: string): string => (satnum === sel ? CMP_SELECTED : compare.listed(satnum) ? CMP_LISTED : '');

  /* opened or shut: whatever the status line said goes, since the search's own line speaks while it is open */
  let wasOpen = false;
  $effect(() => {
    if (addOpen === wasOpen) return;
    wasOpen = addOpen;
    untrack(() => { compare.say = ''; });
    if (addOpen) {
      query = ''; active = 0;
      if (!PINNED) import('../../state/decayed.svelte').then(m => { dk = m.decayed.ensure(app.catalogue); }, () => {});
    }
  });
  $effect(() => { void query; active = 0; });

  function pick(idx: number) {
    const e = app.catalogue[idx];
    if (e && !taken(e.satnum)) compare.add(e.satnum);
  }
  function key(e: KeyboardEvent) {
    const last = shownIdx.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (last >= 0) active = active >= last ? 0 : active + 1; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (last >= 0) active = active <= 0 ? last : active - 1; }
    else if (e.key === 'Tab') addOpen = false;
    else if (e.key === 'Enter') { e.preventDefault(); const i = shownIdx[active]; if (i !== undefined) pick(i); }
  }
  const activeId = $derived.by(() => {
    const i = shownIdx[active], e = i === undefined ? undefined : app.catalogue[i];
    return e ? 'copt-' + e.satnum : undefined;
  });
  $effect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' }); });

  /* ---- the chart -------------------------------------------------------------------------------------------------------- */

  let cv: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  $effect(() => {
    const c = cv;
    if (!c) return;
    const ro = new ResizeObserver(es => { width = Math.round(es[0]!.contentRect.width); });
    ro.observe(c);
    return () => ro.disconnect();
  });

  /* what is drawn, as one string: a forecast by the object it is (a new one is a new line), with its number and colour */
  const ids = new WeakMap<object, number>();
  let idn = 0;
  const idOf = (o: unknown): number => {
    if (!o || typeof o !== 'object') return 0;
    let k = ids.get(o);
    if (!k) ids.set(o, (k = ++idn));
    return k;
  };
  const drawKey = $derived(compare.lines.map(l => l.n + ':' + l.slot + ':' + idOf(l.r)).join(' '));
  let label = $state(cmpChartName(0, null));
  let ckey = $state.raw<CmpKeyItem[]>([]);
  let geom: CmpGeom | null = null;
  let drawn: CmpSeries[] = [];
  /** the reading: `y` the pointer's height beside which the box sits, null for one held at the top of the plot (touch, the scrubber) */
  let tip = $state.raw<{ x: number; y: number | null; top: number; h: number; day: string; rows: CmpTipRow[] } | null>(null);
  let tipEl: HTMLElement | undefined = $state();

  /* ---- the chart's view (L67): the range, the quantity, a zoom, and reading it --------------------------------------- */

  /* The range and the quantity are the store's (kept with the list where they are not the default); a zoom is this panel's and never
     kept. What was drawn last (info) gives the caption, the hint or Reset zoom, the note and the scrubber; a zoom always lies inside
     the range's own window and spans a day at least, and one the window drawn cannot hold (a new line, another range) is dropped. */
  let win = $state.raw<Win | null>(null);
  let info = $state.raw<DrawInfo | null>(null);
  let pl = $state(46);
  const rangeOpts = RANGES.map(r => ({ value: r, label: CMP_RANGES[r], title: CMP_RANGE_TITLES[r], id: 'cmpr-' + r }));
  const caption = $derived(info ? (info.why === 'param' ? cmpNoParam(info.p) : cmpAxis(info.p, info.t0, info.t1, info.zoomed, info.why === 'range')) : '');
  const note = $derived(info && info.p !== 'alt' ? cmpNote(info.p) : '');
  const describedBy = $derived('cmpaxis' + (note ? ' cmpnote' : '') + ' cmprows');
  const viewKey = $derived(compare.view.p + ' ' + compare.view.r + ' ' + (win ? win.t0 + ':' + win.t1 : ''));

  /* the dropdown follows the store, whatever was picked last (PassDetails.svelte's #dopsel): its options are written out, with no
     value bound, so the page's entry needs nothing more for it */
  let paramEl: HTMLSelectElement | undefined = $state();
  $effect(() => { const el = paramEl, p = compare.view.p; if (el) el.selectedIndex = PARAMS.indexOf(p); });
  function pickRange(v: string | number) {
    win = null;                                               // the pressed one again: back to its whole window
    compare.setView({ r: v as CmpRange });
  }
  function pickParam(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if ((PARAMS as readonly string[]).includes(v)) compare.setView({ p: v as CmpParam });
  }
  /* a zoom is of one spacecraft's company: another selected, it goes */
  $effect(() => { void compare.selected; untrack(() => { win = null; }); });

  let scrubEl: HTMLInputElement | undefined = $state();
  let scrubText = $state('');
  /** the touch reading is held where the finger left it */
  let pinned = $state(false);

  $effect(() => {
    void drawKey; void viewKey;
    const c = colors, w = width, canvas = cv;
    if (!c || !w || !canvas) return;
    untrack(() => {
      /* a redraw while the scrubber has the focus (a history come in, a forecast, the page zoomed or the theme turned) keeps it on
         the instant it reads, while the new window holds it: a reader on it is not sent to the newest set and told of a day unasked */
      const el = scrubEl, g0 = geom, hold = keepT === null && !!el && !!g0 && document.activeElement === el;
      if (hold) keepT = scrubT(g0!, el!);
      drawn = compare.lines.map(l => ({ ...l, name: nameOf(l.n) }));
      const v = compare.view, r = drawCompare(canvas, drawn, c, { p: v.p, r: v.r, win });
      label = r.label; geom = r.geom; info = r.info; ckey = compareKey(drawn, c, v.p); pl = r.geom ? r.geom.L : 46;
      canvas.dataset.p = v.p;                                 // for the suites: nothing here reads them
      canvas.dataset.t0 = r.info ? String(Math.round(r.info.t0)) : ''; canvas.dataset.t1 = r.info ? String(Math.round(r.info.t1)) : '';
      tip = null; pinned = false; endDrag();
      setScrubStart();
      if (hold) keepT = null;
      if (win && !r.info?.zoomed) win = null;                 // a zoom the new window cannot hold: one more draw
    });
  });

  const STEPS = 240;                                          // the scrubber's steps across the plot
  const yOf = (h: number): number => (geom ? geom.Y(h) : 0);
  /** the instant at x (CSS px from the canvas's left edge), as compareTipAt reads it */
  const tAt = (g: CmpGeom, x: number): number => g.t0 + (x - g.L) / (g.Wc - g.L - g.R) * (g.tEnd - g.t0);
  const scrubT = (g: CmpGeom, el: HTMLInputElement): number => g.t0 + +el.value / STEPS * (g.tEnd - g.t0);
  const px = (e: MouseEvent): number => e.clientX - cv!.getBoundingClientRect().left;

  /** the reading at x: none outside the plot; with no line valued there, nothing, or the crosshair alone when `bare` */
  function showAt(x: number, y: number | null, bare: boolean) {
    const c = colors, g = geom;
    const t = g && c ? compareTipAt(g, drawn, x, c) : null;
    tip = g && t && (t.rows.length || bare) ? { x: t.x, y, top: g.T, h: g.Hc - g.T - g.B, day: t.day, rows: t.rows } : null;
  }
  /** what the scrubber says at its value: the day, and every coloured line's value there by its full name */
  function scrubSays(g: CmpGeom, el: HTMLInputElement): string {
    const t = scrubT(g, el), r = colors ? compareTipAt(g, drawn, g.X(t), colors) : null;
    return cmpScrubText(cmpDay(t), r ? r.rows.map(q => ({ name: nameOf(q.n), value: q.value, projected: q.projected })) : []);
  }
  /** the instant a `+` or `-` on the scrubber was pressed at (or the focused scrubber read when a redraw came): the draws of that
   *  zoom keep the scrubber there */
  let keepT: number | null = null;
  /** a `+` or `-` on the scrubber is being drawn: what it says then ends with the span drawn, so the zoom is heard */
  let zoomSay = false;
  /** after a draw: the scrubber at the newest element set, on its step or the one before, never after it (a quantity with no
      forecast has no value past it, and the reading would be empty), at its right end when that set is outside the window; or,
      after a zoom from the scrubber, still at the instant it was zoomed about; said, not shown */
  function setScrubStart() {
    const el = scrubEl, g = geom, i = info;
    if (!el || !g || !i || i.why) { scrubText = ''; return; }
    const k = keepT === null ? -1 : Math.round((keepT - g.t0) / (g.tEnd - g.t0) * STEPS);
    const last = i.tLast >= i.t0 && i.tLast <= i.t1 ? Math.floor((i.tLast - i.t0) / (i.t1 - i.t0) * STEPS) : STEPS;
    el.value = String(k >= 0 && k <= STEPS ? k : last);
    if (document.activeElement === el) readScrub();
    else scrubText = scrubSays(g, el);
    if (zoomSay) scrubText = cmpScrubView(scrubText, i.t0, i.t1, i.zoomed);
  }
  $effect(() => { if (scrubEl) untrack(setScrubStart); });   // the scrubber comes with the first line: set it once there
  function readScrub() {
    const el = scrubEl, g = geom;
    if (!el || !g) return;
    scrubText = scrubSays(g, el);
    showAt(g.X(scrubT(g, el)), null, true);
  }
  /* A finger on the slider moves its value without focusing it (Chromium, Safari), so no blur would ever take that reading away: it
     is held as a tap on the chart holds one, and goes as that does, at a press anywhere else or Escape. */
  function scrubInput() {
    if (document.activeElement !== scrubEl) pinned = true;
    readScrub();
  }
  function scrubBlur() { if (!pinned) tip = null; }
  async function scrubKey(e: KeyboardEvent) {
    const g = geom, el = scrubEl;
    if (e.key === 'Escape') { if (tip) { e.preventDefault(); tip = null; } return; }   // until the next input; the sheet stays
    if (e.ctrlKey || e.metaKey || e.altKey) return;           // Ctrl or Cmd with + or -: the browser's own zoom of the page
    if (!g || !el || (e.key !== '+' && e.key !== '=' && e.key !== '-')) return;
    e.preventDefault();
    const t = scrubT(g, el);
    keepT = t;                                                // the reading stays on this instant through the zoom's draws
    zoomSay = true;
    if (e.key === '-') zoomOut();
    else { const s = (g.tEnd - g.t0) / 4; zoomTo(t - s, t + s); }
    await tick();
    keepT = null; zoomSay = false;
    /* zoomed into a span with nothing drawn, the scrubber is hidden with the focus in it: Reset zoom has it (shown, as zoomed) */
    const a = document.activeElement;
    if (scrubEl?.hidden && (a === scrubEl || a === document.body)) (document.getElementById('cmpreset') ?? paramEl)?.focus();
  }

  /* A zoom inside the window drawn now, never under a day: whole milliseconds, so the model reads it as inside (an edge one ulp past
     the window's would not be). */
  function zoomTo(a: number, b: number) {
    const g = geom;
    if (!g) return;
    const lo = Math.ceil(g.t0), hi = Math.floor(g.tEnd), w = Math.round(Math.max(b - a, DAY_MS));
    if (w >= hi - lo) return;                                 // already this narrow, or narrower than a day
    const t0 = Math.min(Math.max(Math.round((a + b) / 2 - w / 2), lo), hi - w);
    win = { t0, t1: t0 + w };
  }
  /** twice the zoom, about its middle, inside the range's window; the whole of that window once it reaches it */
  function zoomOut() {
    const i = info, z = win;
    if (!i || !z) return;
    const lo = Math.ceil(i.base.t0), hi = Math.floor(i.base.t1), w = 2 * (z.t1 - z.t0);
    if (w >= hi - lo) { win = null; return; }
    const t0 = Math.min(Math.max(Math.round((z.t0 + z.t1) / 2 - w / 2), lo), hi - w);
    win = { t0, t1: t0 + w };
  }
  async function resetZoom() {
    win = null;
    await tick();
    document.getElementById('cmpr-' + compare.view.r)?.focus();        // Reset zoom has gone: the range it was made in
  }

  /* A drag across the plot (a mouse or pen, 8 px or more) zooms to it; Escape, or the pointer taken away, lets it go with no change. */
  let drag: { x0: number; on: boolean } | null = null;
  let band = $state.raw<{ l: number; w: number; top: number; h: number } | null>(null);
  let lastType = '';
  /** the last press became a drag: the double-click a browser may make of a click and that press is not one (it zoomed already) */
  let dragged = false;
  /** the finger that came down on the chart last: where, and how far sideways it has gone since */
  let finger: { id: number; x0: number; far: number } | null = null;
  const dragEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); endDrag(); } };   // the sheet stays
  function endDrag() {
    if (drag) document.removeEventListener('keydown', dragEsc);
    drag = null; band = null;
  }
  const inPlot = (g: CmpGeom, x: number): number => Math.max(g.L, Math.min(g.Wc - g.R, x));

  function down(e: PointerEvent) {
    lastType = e.pointerType;
    dragged = false;
    const g = geom;
    if (!g || !cv) return;
    const x = px(e);
    if (e.pointerType === 'touch') {                          // held at the top, the finger under it
      finger = { id: e.pointerId, x0: x, far: 0 };
      pinned = true; showAt(x, null, true); return;
    }
    if (e.button !== 0 || x < g.L || x > g.Wc - g.R) return;
    endDrag();
    drag = { x0: x, on: false };
    document.addEventListener('keydown', dragEsc);
    cv.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    const g = geom;
    if (!g || !colors || !cv) { tip = null; return; }
    const x = px(e);
    if (e.pointerType === 'touch') {
      if (finger?.id === e.pointerId) finger.far = Math.max(finger.far, Math.abs(x - finger.x0));
      if (pinned) showAt(x, null, true);
      return;
    }
    if (drag) {
      const xc = inPlot(g, x);
      if (Math.abs(xc - drag.x0) >= 8) drag.on = dragged = true;
      if (drag.on) { band = { l: Math.min(xc, drag.x0), w: Math.abs(xc - drag.x0), top: g.T, h: g.Hc - g.T - g.B }; tip = null; return; }
    }
    showAt(x, e.clientY - cv.getBoundingClientRect().top, false);
  }
  function up(e: PointerEvent) {
    const d = drag, g = geom;
    endDrag();
    if (!d?.on || !g) return;
    const x = inPlot(g, px(e));
    if (Math.abs(x - d.x0) >= 8) zoomTo(tAt(g, Math.min(x, d.x0)), tAt(g, Math.max(x, d.x0)));   // brought back under 8 px: nothing
  }
  function cancel() { endDrag(); }                           // a touch reading stays where it is
  /* The browser took the pointer for itself. A finger that came down on the chart and went on to scroll the page or pinch it (the
     browser's, by touch-action) pinned a reading it never meant: that goes. One that first slid sideways 8 px or more was reading
     the chart, and its reading stays. (Not on lostpointercapture: that follows every tap's pointerup too.) */
  function cancelPointer(e: PointerEvent) {
    endDrag();
    if (e.pointerType === 'touch' && finger?.id === e.pointerId && finger.far < 8) { pinned = false; tip = null; }
  }
  function leave(e: PointerEvent) { if (e.pointerType !== 'touch' && !drag) tip = null; }
  /* half the span about the point: the drag's one-pointer alternative; never from a touch, which never zooms, nor from a press
     that dragged (its release zoomed to the band, and may end a double-click with the click before it) */
  function dbl(e: MouseEvent) {
    const g = geom;
    if (lastType === 'touch' || dragged || !g) return;
    const x = px(e);
    if (x < g.L || x > g.Wc - g.R) return;
    const t = tAt(g, x), s = (g.tEnd - g.t0) / 4;
    zoomTo(t - s, t + s);
  }
  /* a held touch reading goes at a press anywhere else, or Escape (as Clear's arming, above) */
  $effect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('#cmpcv, #cmpscrub')) { pinned = false; tip = null; } };
    /* the Escape is taken (the answer sheet stays) only when it hides a reading: a touch in the axis margin pins one with nothing shown */
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (tip) e.preventDefault(); pinned = false; tip = null; } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
  });

  /* the readout beside the pointer, kept inside the chart both ways: flipped to the pointer's left at the right edge, never past either;
     held at the top of the plot for a touch or the scrubber. Where it fits on neither side of the line (a phone), the names give way
     (cut with an ellipsis, 8 characters left at least, so a value never rests on its colour alone), and the box covers less of the
     line and the dots on it. */
  const NAME_MIN = 8;
  $effect(() => {
    const t = tip, el = tipEl, g = geom;
    if (!t || !el || !g) return;
    el.style.maxWidth = '';
    let w = el.offsetWidth;
    const h = el.offsetHeight, room = Math.max(t.x - 14, g.Wc - t.x - 14);
    if (w > room) {
      let edge = 0, need = 0;                                 // the names' right edge, and where it could come in to
      for (const s of el.querySelectorAll<HTMLElement>('p > span')) {
        const r = s.offsetLeft + s.offsetWidth, n = s.textContent?.length || 1, keep = Math.min(s.offsetWidth, NAME_MIN * s.offsetWidth / n);
        edge = Math.max(edge, r); need = Math.max(need, r - s.offsetWidth + keep);
      }
      if (edge) { el.style.maxWidth = Math.ceil(Math.max(room, w - edge + need)) + 'px'; w = el.offsetWidth; }
    }
    let x = t.x + 14;
    if (x + w > g.Wc) x = t.x - 14 - w;
    el.style.left = Math.max(0, Math.min(g.Wc - w, x)) + 'px';
    el.style.top = (t.y === null ? g.T + 2 : Math.max(0, Math.min(g.Hc - h, t.y - h / 2))) + 'px';
  });
</script>

{#snippet cross()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" /></svg>{/snippet}

<div class="cmp">
  {#if compare.planned}
    <p id="cmpplanned">{CMP_PLANNED}</p>
  {:else}
    <div class="bar">
      <Popover bind:open={addOpen} label={CMP_ADD_DIALOG} width={380}>
        {#snippet trigger(t)}
          <Button {...t} id="cmpadd" size="sm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>{CMP_ADD}</Button>
        {/snippet}
        <div class="cmpfield">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" /></svg>
          <input id="cmpsearch" type="search" role="combobox" aria-expanded="true" aria-controls={shownIdx.length ? 'cmplist' : undefined}
                 aria-autocomplete="list" aria-haspopup="listbox" aria-activedescendant={activeId} aria-label={CMP_SEARCH_NAME}
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder={CMP_SEARCH_PLACEHOLDER}
                 bind:value={query} onkeydown={key}>
        </div>
        {#if shownIdx.length}
          <!-- the keys are the field's (combobox): a press in the list must not take the focus out of it -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <ul id="cmplist" role="listbox" aria-label={CMP_LIST_NAME} tabindex="-1" onmousedown={e => e.preventDefault()}>
            {#each shownIdx as idx, k (idx)}
              {@const e = app.catalogue[idx]!}
              {@const g = head(k)}
              {@const mark = taken(e.satnum)}
              {#if g}<li class="grp" role="presentation">{g}</li>{/if}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <li role="option" id="copt-{e.satnum}" aria-selected={k === active} aria-disabled={mark ? 'true' : undefined} class:on={k === active}
                  onclick={() => pick(idx)} onpointermove={() => (active = k)}>
                <span class="nm">{e.name}</span>{#if mark}<span class="mk">{mark}</span>{/if}{#if dk?.has(idx)}<span class="dk">{dk.label}</span>{/if}<span class="id mono">{e.satnum}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="cmpnote">{CMP_NO_MATCH}</p>
        {/if}
        {#if more > 0}<p class="cmpnote">{cmpMoreMatch(more)}</p>{/if}
        {#if dk?.any(shownIdx)}<p id="cmpdecayed" class="cmpnote">{CMP_DECAYED_NOTE}</p>{/if}
        <p id="cmpcount" role="status">{compare.say}</p>
      </Popover>
      {#if compare.watchable.length && compare.items.length < COMPARE_MAX}
        <Button id="cmpwatched" variant="ghost" size="sm" onclick={once(() => barPress(() => compare.addWatched()))}>{cmpAddWatched(compare.watchable.length)}</Button>
      {/if}
      {#if plan.k}
        <Button id="cmpfetch" size="sm" onclick={once(() => barPress(() => compare.fetchMore()))}>{cmpFetchMore(plan.k, plan.more)}</Button>
      {/if}
      {#if compare.items.length}
        <Button id="cmpclear" variant="ghost" size="sm" aria-describedby={armed ? 'cmpsay' : undefined} onclick={clearPress} onblur={() => (armed = false)}
                onkeydown={e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }}>{CMP_CLEAR}</Button>
      {/if}
    </div>
    <p id="cmpsay" role="status">{armed ? cmpClearArmed(compare.items.length) : addOpen ? '' : compare.say}</p>
    {#if busy}<p id="cmpwait">{CMP_WAIT_NOTE}</p>{/if}

    {#if compare.lines.length}
      <div id="cmpview" class="view">
        <div class="vg">
          <span class="vl" aria-hidden="true">{CMP_RANGE}</span>
          <Segmented label={CMP_RANGE} size="sm" value={compare.view.r} options={rangeOpts} onchange={pickRange} />
        </div>
        <div class="vg">
          <label class="vl" for="cmpparam">{CMP_SHOW}</label>
          <!-- the options written out and no value bound: an effect above keeps the one shown (selectedIndex) -->
          <select id="cmpparam" bind:this={paramEl} onchange={pickParam}>
            <option value="alt">{CMP_PARAMS.alt}</option>
            <option value="hp">{CMP_PARAMS.hp}</option>
            <option value="ha">{CMP_PARAMS.ha}</option>
            <option value="rate">{CMP_PARAMS.rate}</option>
            <option value="ecc">{CMP_PARAMS.ecc}</option>
            <option value="per">{CMP_PARAMS.per}</option>
            <option value="mm">{CMP_PARAMS.mm}</option>
          </select>
        </div>
      </div>
      <div class="cap">
        <p id="cmpaxis">{caption}</p>
        {#if info?.zoomed}<Button id="cmpreset" variant="ghost" size="sm" onclick={resetZoom}>{CMP_RESET}</Button>
        {:else if info && !info.why}<span id="cmpdraghint">{CMP_DRAG_HINT}</span><span id="cmpkeyhint" aria-hidden="true">{CMP_SCRUB_HINT}</span>{/if}
      </div>
    {/if}
    <div class="chart" style="--pl:{pl}px; --pr:30px">
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role, a11y_no_noninteractive_element_interactions -->
      <canvas bind:this={cv} id="cmpcv" role="img" aria-label={label} aria-describedby={describedBy} hidden={!compare.lines.length}
              onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancelPointer} onlostpointercapture={cancel}
              onpointerleave={leave} ondblclick={dbl}></canvas>
      {#if band}<div id="cmpsel" style="left:{band.l}px; width:{band.w}px; top:{band.top}px; height:{band.h}px"></div>{/if}
      {#if tip}
        <div id="cmpx" style="left:{tip.x}px; top:{tip.top}px; height:{tip.h}px"></div>
        {#if tip.rows.length}
          <div id="cmptip" class="mono" bind:this={tipEl}>
            <p>{tip.day}</p>
            {#each tip.rows as r (r.n)}<p><i class:p={r.projected} style="--c:{r.color}"></i>{r.value} <span>{r.name}</span></p>{/each}
          </div>
          <div id="cmpdots" aria-hidden="true">{#each tip.rows as r (r.n)}<i class:p={r.projected} style="left:{tip.x}px; top:{yOf(r.h)}px; --c:{r.color}"></i>{/each}</div>
        {/if}
      {/if}
      {#if compare.lines.length}
        <input id="cmpscrub" type="range" min="0" max="240" step="1" bind:this={scrubEl} hidden={!info || !!info.why}
               aria-label={CMP_SCRUB_NAME} aria-describedby="cmpscrubkeys" aria-valuetext={scrubText}
               oninput={scrubInput} onfocus={readScrub} onblur={scrubBlur} onkeydown={scrubKey}>
        <!-- the slider's description only (hidden: not read again as text, nor left in the page while the slider is hidden) -->
        <span id="cmpscrubkeys" hidden>{CMP_SCRUB_KEYS}</span>
      {/if}
    </div>
    {#if compare.lines.length}
      <p id="cmpkey">{#each ckey as k}<span><i class:d={k.dashed} class:g={k.grey} style="--c:{k.color}"></i>{k.text}</span>{/each}</p>
      {#if note}<p id="cmpnote">{note}</p>{/if}
    {:else}
      <p id="cmpnone">{CMP_NOTHING_DRAWN}</p>
    {/if}

    <ul id="cmprows" aria-label={CMP_ROWS_NAME}>
      {#each visible as n (n)}
        {@const me = n === sel}
        {@const name = nameOf(n)}
        {@const r = me ? null : compare.rows[n]}
        {@const slot = me ? 1 : compare.slotOf(n)}
        {@const not = me ? selNot : r?.st === 'shown' ? r.not : r?.st === 'failed' && !r.retry ? r.not : null}
        {@const refused = !me && compare.refusal?.n === n ? compare.refusal.text : ''}
        {@const pos = compare.queuePos(n)}
        <li class="row" class:me data-n={n}>
          {#if me}
            <span class="tg sw" style="--c:{colorFor(1)}" aria-hidden="true"><i></i></span>
          {:else}
            <button type="button" class="tg" style="--c:{colorFor(slot)}" aria-label={cmpHighlightName(name)} aria-pressed={slot > 0}
                    aria-disabled={not ? 'true' : undefined}
                    aria-describedby={[not ? 'cmpnot-' + n : '', refused ? 'cmpref-' + n : ''].filter(Boolean).join(' ') || undefined}
                    onclick={once(() => compare.highlight(n, !(slot > 0)))}>
              <span class="box">{#if slot > 0}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{/if}</span>
            </button>
          {/if}
          <span class="nm"><span class="name">{name}</span> <span class="id mono">{n}</span>{#if me}{' '}<span class="selmk">{CMP_SELECTED}</span>{/if}</span>
          <span class="in">
            <span class="hd">
              {#if me}<span class="big">{life.view.big}</span> <span class="sub">{life.view.sub}</span>
              {:else if r?.st === 'shown'}<span class="big">{r.big}</span> <span class="sub">{r.sub}</span>
              {:else if r?.st === 'failed'}<span class="big">{r.big}</span> <span class="sub">{r.short}</span>{/if}
            </span>
            <span class="fg mono">
              <span class="sr-only">{CMP_ALT_NAME}</span> {me ? (life.fields.alt ?? '—') : r?.st === 'shown' ? r.alt : '—'}
              <span class="sr-only">{CMP_RATE_NAME}</span> {me ? (life.fields.rate ?? '—') : r?.st === 'shown' ? r.rate : '—'}
            </span>
            <span class="st" id="cmpst-{n}" tabindex="-1">
              {#if pos}{cmpQueued(pos)}
              {:else if me && life.view.action && compare.selOut}{cmpFetching(compare.secs)}
              {:else if me && life.view.action}
                <Button size="sm" aria-label={life.view.action === 'retry' ? cmpRetryName(name) : cmpFetchName(name)} onclick={once(() => rowAsk(n, () => compare.fetchSelected()))}>{life.view.action === 'retry' ? CMP_RETRY : CMP_FETCH}</Button>
              {:else if r?.st === 'fetching'}{cmpFetching(compare.secs)}
              {:else if r?.st === 'reading'}{CMP_READING}
              {:else if r?.st === 'wait'}
                <Button size="sm" aria-label={cmpFetchName(name)} onclick={once(() => rowAsk(n, () => compare.fetch(n)))}>{CMP_FETCH}</Button>
              {:else if r?.st === 'failed' && r.retry}
                <Button size="sm" aria-label={cmpRetryName(name)} onclick={once(() => rowAsk(n, () => compare.fetch(n)))}>{CMP_RETRY}</Button>
              {/if}
              {#if not}<span class="not" id="cmpnot-{n}">{cmpNotDrawn(not)}</span>{/if}
            </span>
            {#if refused}<span class="ref" id="cmpref-{n}">{refused}</span>{/if}
          </span>
          <span class="rmc">
            {#if !me}<button type="button" class="rm" data-rm={n} aria-label={cmpRemoveName(name)} onclick={once(() => drop(n))}>{@render cross()}</button>{/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if all.length > ROWS_SHOWN}
      <Button id="cmpmore" variant="ghost" size="sm" aria-expanded={unfold} aria-controls="cmprows" onclick={once(() => (unfold = !unfold))}>{unfold ? cmpShowFirst(ROWS_SHOWN) : cmpShowOthers(all.length - ROWS_SHOWN)}</Button>
    {/if}
  {/if}
</div>

<style>
  .cmp { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); margin-top: var(--space-3); min-width: 0; }
  .cmp > p { margin: 0; }
  .cmp > :global(#cmpmore) { justify-self: start; }
  #cmpplanned, #cmpnone { color: var(--ink2); font-size: var(--fs-1); max-width: 62ch; }
  #cmpsay { color: var(--ink2); font-size: var(--fs-1); }
  #cmpsay:empty { margin-top: calc(-1 * var(--space-3)); }     /* empty, and still in the page: a live region must be there before it speaks */
  #cmpwait { color: var(--muted); font-size: var(--fs-0); }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }

  /* the search, as the picker's (classes of its own: the suites read the picker's notes page-wide) */
  .cmpfield {
    display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-3);
    border: 1px solid var(--rule); border-radius: var(--r-2); background: var(--sunk); color: var(--muted);
  }
  .cmpfield input { flex: 1; min-width: 0; height: 36px; border: 0; background: transparent; outline: none; color: var(--ink); font-size: var(--fs-2); }
  .cmpfield:focus-within { border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  #cmplist { list-style: none; margin: var(--space-2) 0 0; padding: 0; max-height: min(40vh, 300px); overflow: auto; }
  #cmplist li {
    display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--r-2);
    cursor: pointer; color: var(--ink);
  }
  #cmplist li.on { background: var(--hover); }
  #cmplist li[aria-disabled='true'] { cursor: default; }
  #cmplist li.grp { cursor: default; padding: var(--space-2) var(--space-3) var(--space-1); color: var(--muted); font-size: var(--fs-0); letter-spacing: .13em; text-transform: uppercase; }
  #cmplist .nm { min-width: 0; overflow-wrap: anywhere; }
  #cmplist .mk { flex: none; color: var(--muted); font-size: var(--fs-0); }
  #cmplist .dk { flex: none; padding: 0 var(--space-2); border: 1px solid currentColor; border-radius: var(--r-pill); color: var(--bad); font-size: var(--fs-0); white-space: nowrap; }
  #cmplist .id { flex: none; margin-left: auto; color: var(--muted); font-size: var(--fs-0); }
  .cmpnote { margin: 0; padding: var(--space-2) var(--space-3); color: var(--muted); font-size: var(--fs-1); }
  #cmpcount { margin: var(--space-2) 0 0; padding: 0 var(--space-3); color: var(--ink2); font-size: var(--fs-0); }

  /* the chart, its pointer's line and readout, and its key */
  .chart { position: relative; }
  canvas { display: block; width: 100%; height: 320px; border: 1px solid var(--rule); border-radius: var(--r-3); background: var(--panel); }
  #cmpx { position: absolute; width: 1px; background: var(--muted); opacity: .7; pointer-events: none; }
  #cmptip {
    position: absolute; z-index: 2; max-width: 100%; padding: var(--space-1) var(--space-2); border: 1px solid var(--rule); border-radius: var(--r-2);
    background: var(--panel); color: var(--ink); font-size: var(--fs-0); pointer-events: none; box-shadow: var(--shadow);
  }
  #cmptip p { display: flex; align-items: center; gap: var(--space-2); margin: 0; white-space: nowrap; }
  #cmptip span { color: var(--ink2); overflow: hidden; text-overflow: ellipsis; }
  #cmptip i { flex: none; width: 10px; height: 2px; background: var(--c); }
  #cmptip i.p { background: repeating-linear-gradient(90deg, var(--c) 0 4px, transparent 4px 6px); }
  #cmpkey { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); font-size: var(--fs-0); color: var(--muted); }
  #cmpkey i { display: inline-block; width: 14px; height: 3px; margin-right: var(--space-2); vertical-align: middle; border-radius: 2px; background: var(--c); }
  #cmpkey i.d { background: repeating-linear-gradient(90deg, var(--c) 0 5px, transparent 5px 8px); }
  #cmpkey i.g { height: 2px; opacity: .6; }

  /* the chart's view (L67): the range and the quantity over it, the caption with the hint or Reset zoom, the zoom's band, the dots of
     the reading, the scrubber inset to the plot (--pl, --pr: the plot's margins, written after each draw), and the note under the key */
  .view { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-5); min-width: 0; }
  .vg { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; max-width: 100%; }
  .vl { color: var(--muted); font-size: var(--fs-0); }
  #cmpparam {
    height: 28px; min-width: 0; max-width: 100%; padding: 0 var(--space-2); border: 1px solid var(--rule); border-radius: var(--r-2);
    background: var(--sunk); color: var(--ink); font: inherit; font-size: var(--fs-1);
  }
  #cmpparam:focus-visible { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  .cap { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-4); margin-bottom: calc(-1 * var(--space-2)); }
  #cmpaxis { margin: 0; flex: 1 1 16rem; min-width: 0; color: var(--ink2); font-size: var(--fs-0); font-variant-numeric: tabular-nums; }
  #cmpdraghint, #cmpkeyhint { color: var(--muted); font-size: var(--fs-0); }
  #cmpkeyhint { display: none; }
  .chart { --pl: 46px; --pr: 30px; }
  #cmpcv { touch-action: pan-y pinch-zoom; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  #cmpsel { position: absolute; pointer-events: none; background: color-mix(in srgb, var(--muted) 14%, transparent); border-inline: 1px solid var(--muted); }
  #cmpdots i {
    position: absolute; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; background: var(--c);
    box-shadow: 0 0 0 2px var(--panel); pointer-events: none; z-index: 1;
  }
  #cmpdots i.p { background: var(--panel); border: 2px solid var(--c); }
  #cmpscrub {
    display: block; width: calc(100% - var(--pl) - var(--pr) + 16px); height: 24px; margin: var(--space-1) calc(var(--pr) - 8px) 0 calc(var(--pl) - 8px);
    accent-color: var(--ink); background: transparent;
  }
  #cmpnote { color: var(--muted); font-size: var(--fs-0); max-width: 72ch; }
  /* a mouse or pen: the hint's place is as tall as Reset zoom (28 px), which takes it while zoomed, so the chart under them does not
     jump, on one line or two; while the slider has the keyboard's focus, the slider's keys are said there in its stead (not zoomed) */
  @media (hover: hover) and (pointer: fine) {
    #cmpcv { cursor: crosshair; }
    #cmpdraghint { display: inline-flex; align-items: center; min-height: 28px; }
    .cmp:has(#cmpscrub:focus-visible) #cmpdraghint { display: none; }
    .cmp:has(#cmpscrub:focus-visible) #cmpkeyhint { display: inline-flex; align-items: center; min-height: 28px; }
  }
  @media (hover: none), (pointer: coarse) { #cmpdraghint { display: none; } }
  @media (pointer: coarse) { #cmpparam { height: var(--tap); font-size: 16px; } #cmpscrub { height: var(--tap); margin-top: 0; } }
  @media (max-width: 359px) { .vg > .vl[aria-hidden='true'] { display: none; } }   /* 320: the group keeps its aria-label "Range" */

  /* the list: one line from 900 px, two (or three) below; see "the rows" above */
  #cmprows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
  .row {
    --tgw: 28px;
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'tg nm rm' 'tg in in';
    align-items: center; gap: var(--space-1) var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--rule); font-size: var(--fs-1);
  }
  .tg { grid-area: tg; }
  .nm { grid-area: nm; min-width: 0; overflow-wrap: anywhere; }
  .rmc { grid-area: rm; }
  .in { grid-area: in; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); min-width: 0; }
  .name { color: var(--ink); font-weight: 600; }
  .id { color: var(--muted); font-size: var(--fs-0); }
  .selmk { margin-left: var(--space-1); padding: 0 var(--space-2); border: 1px solid var(--track); border-radius: var(--r-pill); color: var(--ink2); font-size: var(--fs-0); }
  .hd { min-width: 0; overflow-wrap: anywhere; }
  .big { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .sub { color: var(--muted); font-size: var(--fs-0); }
  .fg { color: var(--ink2); font-size: var(--fs-0); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .st { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 8.5rem; color: var(--ink2); font-variant-numeric: tabular-nums; }
  .st:focus { outline: none; }
  .st:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .not { color: var(--muted); font-size: var(--fs-0); }
  .ref { flex-basis: 100%; color: var(--ink2); font-size: var(--fs-0); }
  @media (min-width: 900px) {
    .row { grid-template-columns: var(--tgw) minmax(0, 1.1fr) minmax(0, 1.3fr) 13rem minmax(9rem, 1fr) var(--tgw); grid-template-areas: 'tg nm hd fg st rm'; }
    .in { display: contents; }
    .hd { grid-area: hd; } .fg { grid-area: fg; } .st { grid-area: st; }
    .ref { grid-column: 2 / -1; }
  }

  /* the highlight: the line's colour on the panel, a check while on (in ink: full contrast in every colour), a hollow box while off;
     the selected one's own line, no button */
  .tg, .rm {
    display: grid; place-items: center; width: var(--tgw); height: var(--tgw); padding: 0; border: 0; border-radius: var(--r-2);
    background: none; color: var(--muted); cursor: pointer;
  }
  .tg:hover, .rm:hover { background: var(--hover); }
  .rm:hover { color: var(--ink); }
  .box { display: grid; place-items: center; width: 18px; height: 18px; border: 1.5px solid var(--muted); border-radius: 4px; background: var(--panel); }
  .tg[aria-pressed='true'] .box { border: 2px solid var(--c); color: var(--ink); }
  .tg[aria-disabled='true'] { cursor: default; }
  .tg[aria-disabled='true'] .box { border-style: dashed; }
  .sw { cursor: default; }
  .sw:hover { background: none; }
  .sw i { width: 18px; height: 3px; border-radius: 2px; background: var(--c); }
  @media (pointer: coarse) { .row { --tgw: var(--tap); } #cmplist li[role='option'] { min-height: var(--tap); align-items: center; } }
</style>
