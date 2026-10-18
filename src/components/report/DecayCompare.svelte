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
  import { fetchPlan, notDrawn, ROWS_SHOWN } from '../../lib/decay/compare';
  import {
    CMP_ADD, CMP_ADD_DIALOG, CMP_ALT_NAME, CMP_CATALOGUE, CMP_CLEAR, CMP_DECAYED_NOTE, CMP_FETCH, CMP_LIST_NAME, CMP_LISTED, CMP_NO_MATCH,
    CMP_NOTHING_DRAWN, CMP_PLANNED, CMP_RATE_NAME, CMP_READING, CMP_RETRY, CMP_ROWS_NAME, CMP_SEARCH_NAME, CMP_SEARCH_PLACEHOLDER,
    CMP_SELECTED, CMP_WAIT_NOTE, CMP_WATCHED, cmpAddWatched, cmpChartName, cmpClearArmed, cmpFetching, cmpFetchMore, cmpFetchName,
    cmpHighlightName, cmpMoreMatch, cmpNotDrawn, cmpQueued, cmpRemoveName, cmpRetryName, cmpShowFirst, cmpShowOthers
  } from '../../lib/text/life-compare';
  import { colorOf, compareKey, compareTipAt, drawCompare, readCmpColors, type CmpColors, type CmpKeyItem, type CmpSeries, type CmpTipRow } from './draw-compare';
  import type { Geom } from './draw-life';
  import Button from '../ui/Button.svelte';
  import Popover from '../ui/Popover.svelte';

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

     The chart is redrawn only when what it draws changes (which spacecraft, their colours, a forecast), the theme, or its width: the
     seconds of a wait tick in the list, not in the chart, and the readout under the pointer stays put while they do. */

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
  const busy = $derived(compare.queue.length > 0 || compare.shown.some(n => compare.rows[n]?.st === 'fetching'));

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
  let geom: Geom | null = null;
  let drawn: CmpSeries[] = [];
  let tip = $state.raw<{ x: number; y: number; top: number; h: number; day: string; rows: CmpTipRow[] } | null>(null);
  let tipEl: HTMLElement | undefined = $state();

  $effect(() => {
    void drawKey;
    const c = colors, w = width, canvas = cv;
    if (!c || !w || !canvas) return;
    untrack(() => {
      drawn = compare.lines.map(l => ({ ...l, name: nameOf(l.n) }));
      const r = drawCompare(canvas, drawn, c);
      label = r.label; geom = r.geom; ckey = compareKey(drawn, c); tip = null;
    });
  });

  function move(e: PointerEvent) {
    const c = colors;
    if (!geom || !c || !cv) { tip = null; return; }
    const b = cv.getBoundingClientRect();
    const t = compareTipAt(geom, drawn, e.clientX - b.left, c);
    tip = t && t.rows.length ? { x: t.x, y: e.clientY - b.top, top: geom.T, h: geom.Hc - geom.T - geom.B, day: t.day, rows: t.rows } : null;
  }
  /* the readout beside the pointer, kept inside the chart both ways: flipped to the pointer's left at the right edge, never past either */
  $effect(() => {
    const t = tip, el = tipEl, g = geom;
    if (!t || !el || !g) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = t.x + 14;
    if (x + w > g.Wc) x = t.x - 14 - w;
    el.style.left = Math.max(0, Math.min(g.Wc - w, x)) + 'px';
    el.style.top = Math.max(0, Math.min(g.Hc - h, t.y - h / 2)) + 'px';
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
      {#if compare.watchable.length}
        <Button id="cmpwatched" variant="ghost" size="sm" onclick={() => barPress(() => compare.addWatched())}>{cmpAddWatched(compare.watchable.length)}</Button>
      {/if}
      {#if plan.k}
        <Button id="cmpfetch" size="sm" onclick={() => barPress(() => compare.fetchMore())}>{cmpFetchMore(plan.k, plan.more)}</Button>
      {/if}
      {#if compare.items.length}
        <Button id="cmpclear" variant="ghost" size="sm" aria-describedby="cmpsay" onclick={clearPress} onblur={() => (armed = false)}
                onkeydown={e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }}>{CMP_CLEAR}</Button>
      {/if}
    </div>
    <p id="cmpsay" role="status">{armed ? cmpClearArmed(compare.items.length) : addOpen ? '' : compare.say}</p>
    {#if busy}<p id="cmpwait">{CMP_WAIT_NOTE}</p>{/if}

    <div class="chart">
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
      <canvas bind:this={cv} id="cmpcv" role="img" aria-label={label} aria-describedby="cmprows" hidden={!compare.lines.length}
              onpointermove={move} onpointerleave={() => (tip = null)}></canvas>
      {#if tip}
        <div id="cmpx" style="left:{tip.x}px; top:{tip.top}px; height:{tip.h}px"></div>
        <div id="cmptip" class="mono" bind:this={tipEl}>
          <p>{tip.day}</p>
          {#each tip.rows as r (r.n)}<p><i class:p={r.projected} style="--c:{r.color}"></i>{r.value} <span>{r.name}</span></p>{/each}
        </div>
      {/if}
    </div>
    {#if compare.lines.length}
      <p id="cmpkey">{#each ckey as k}<span><i class:d={k.dashed} class:g={k.grey} style="--c:{k.color}"></i>{k.text}</span>{/each}</p>
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
                    onclick={() => compare.highlight(n, !(slot > 0))}>
              <span class="box">{#if slot > 0}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{/if}</span>
            </button>
          {/if}
          <span class="nm"><span class="name">{name}</span> <span class="id mono">{n}</span>{#if me}<span class="selmk">{CMP_SELECTED}</span>{/if}</span>
          <span class="in">
            <span class="hd">
              {#if me}<span class="big">{life.view.big}</span> <span class="sub">{life.view.sub}</span>
              {:else if r?.st === 'shown'}<span class="big">{r.big}</span> <span class="sub">{r.sub}</span>
              {:else if r?.st === 'failed'}<span class="big">{r.big}</span> <span class="sub">{r.short}</span>{/if}
            </span>
            <span class="fg mono">
              <span class="sr-only">{CMP_ALT_NAME}</span>{me ? (life.fields.alt ?? '—') : r?.st === 'shown' ? r.alt : '—'}
              <span class="sr-only">{CMP_RATE_NAME}</span>{me ? (life.fields.rate ?? '—') : r?.st === 'shown' ? r.rate : '—'}
            </span>
            <span class="st" id="cmpst-{n}" tabindex="-1">
              {#if pos}{cmpQueued(pos)}
              {:else if me && life.view.action}
                <Button size="sm" aria-label={life.view.action === 'retry' ? cmpRetryName(name) : cmpFetchName(name)} onclick={() => rowAsk(n, () => compare.fetchSelected())}>{life.view.action === 'retry' ? CMP_RETRY : CMP_FETCH}</Button>
              {:else if r?.st === 'fetching'}{cmpFetching(compare.secs)}
              {:else if r?.st === 'reading'}{CMP_READING}
              {:else if r?.st === 'wait'}
                <Button size="sm" aria-label={cmpFetchName(name)} onclick={() => rowAsk(n, () => compare.fetch(n))}>{CMP_FETCH}</Button>
              {:else if r?.st === 'failed' && r.retry}
                <Button size="sm" aria-label={cmpRetryName(name)} onclick={() => rowAsk(n, () => compare.fetch(n))}>{CMP_RETRY}</Button>
              {/if}
              {#if not}<span class="not" id="cmpnot-{n}">{cmpNotDrawn(not)}</span>{/if}
            </span>
            {#if refused}<span class="ref" id="cmpref-{n}">{refused}</span>{/if}
          </span>
          <span class="rmc">
            {#if !me}<button type="button" class="rm" data-rm={n} aria-label={cmpRemoveName(name)} onclick={() => drop(n)}>{@render cross()}</button>{/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if all.length > ROWS_SHOWN}
      <Button id="cmpmore" variant="ghost" size="sm" aria-expanded={unfold} aria-controls="cmprows" onclick={() => (unfold = !unfold)}>{unfold ? cmpShowFirst(ROWS_SHOWN) : cmpShowOthers(all.length - ROWS_SHOWN)}</Button>
    {/if}
  {/if}
</div>

<style>
  .cmp { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); margin-top: var(--space-3); min-width: 0; }
  .cmp > p { margin: 0; }
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
  .selmk { margin-left: var(--space-2); padding: 0 var(--space-2); border: 1px solid var(--track); border-radius: var(--r-pill); color: var(--ink2); font-size: var(--fs-0); }
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
  @media (pointer: coarse) { .row { --tgw: var(--tap); } }
</style>
