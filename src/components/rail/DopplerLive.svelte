<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { doppler } from '../../state/doppler.svelte';
  import { getEngine, MASK } from '../../state/engine';
  import { isLive, tuneAt } from '../../lib/analysis/tune';
  import { freqGrouped } from '../../lib/text/fmt';
  import { belowMask, GO_LIVE, RX, shiftKHz, TUNE_NOW, tuneAtSim, TX, UPLINK, UPLINK_NAME, XPDR_OPEN } from '../../lib/text/doppler-live';
  import Button from '../ui/Button.svelte';

  /* The frequency to tune to at one instant, under the downlink box (CHANGES-FROM-LEGACY.md, L52): the downlink chosen
     above as it is heard on the ground, and, for an uplink typed here, the frequency to send on. It is worked out on
     clock.tick, the one value the clock republishes (ten times a second while it plays, never while it is paused), so a
     paused page does no work for it. "Now" means the wall clock, and only while the clock runs at real time near it;
     at any other instant the line says which, and offers to go live.
     It ends with "Uplink and transponders" (L63), a disclosure whose panel is a chunk of its own (xpdr.ts), asked for at its first
     opening and mounted into it; the panel takes the line's instant and range rate from here, so the caption speaks for it too. */

  /* the uplink, in memory only, for the spacecraft it was typed for: another spacecraft listens on another frequency */
  let up = $state<{ sat: string; hz: number; text: string } | null>(null);
  const mine = $derived(up && up.sat === app.entry?.satnum ? up : null);

  const v = $derived.by(() => {
    const D = app.analysis, t = clock.tick.ms;
    if (!D) return null;
    const wall = Date.now(), live = isLive(t, wall, clock.playing, clock.rate);
    const ms = live ? wall : t;
    return { live, ms, r: tuneAt(getEngine(), D.track, ms, doppler.hz, mine ? mine.hz : null) };
  });

  function typed(e: Event) {
    const el = e.currentTarget as HTMLInputElement, f = parseFloat(el.value);
    up = isFinite(f) && f > 0 && app.entry ? { sat: app.entry.satnum, hz: f * 1e6, text: el.value } : null;
  }

  /* "Uplink and transponders" toggled: the calculator's chunk (xpdr.ts), asked for at the first opening, mounts its panel into the
     disclosure with a getter for the line; one that does not come leaves the summary as it was */
  const xpOpen = (e: Event) => { const d = e.currentTarget as HTMLDetailsElement; import('./xpdr').then(m => m.open(d, () => v), () => {}); };

  /* as the AR view's: real time, running, and the clock at the wall clock; a window that does not hold now is opened at it.
     The button goes as the line turns live, and the focus it held would fall to the page: a screen reader is left on
     nothing, and where the next Tab goes is up to the browser. A press that had the focus hands it to the caption, which
     now says "Tune now", and the next Tab goes on to the Uplink box (the caption is focusable from script only,
     tabindex -1, so Tab never stops on it). */
  let caption: HTMLElement | undefined = $state();
  function goLive(e: MouseEvent) {
    const b = e.currentTarget as HTMLElement, had = document.activeElement === b;
    const t = Date.now();
    clock.setRate(1);
    clock.setPlaying(true);
    if (app.inWindow(t)) clock.seek(t);
    else app.setWindowStart(t);
    if (had) void tick().then(() => {
      const lost = !b.isConnected && (document.activeElement === null || document.activeElement === document.body);
      if (lost && caption?.isConnected) caption.focus({ preventScroll: true });
    });
  }
</script>

<!-- one row of figures: the frequency (rx or tx, Hz, null for none at this instant) and its shift from the one it was worked out from -->
{#snippet row(id: string, k: string, f: number | null | undefined, from: number)}
  <p class="ln"><span class="k">{k}</span> <span class="f" id="doplive-{id}">{f ? freqGrouped(f) : '—'}</span> <span class="d">{f ? shiftKHz(f - from) : ''}</span></p>
{/snippet}

{#if v}
  <div id="doplive" class="live" data-ms={v.ms}>
    <p class="ln">
      <span id="doplive-at" tabindex="-1" bind:this={caption}>{v.live ? TUNE_NOW : tuneAtSim(v.ms)}{v.r && v.r.el < MASK ? belowMask(MASK) : ''}</span>
      {#if !v.live}<Button size="sm" id="doplive-go" onclick={goLive}>{GO_LIVE}</Button>{/if}
    </p>
    {#if doppler.hz !== null}{@render row('rx', RX, v.r?.rx, doppler.hz)}{/if}
    <p class="ln">
      <label class="k" for="dopup">{UPLINK}</label>
      <input id="dopup" type="number" step="any" min="0" value={mine ? mine.text : ''} aria-label={UPLINK_NAME} onchangecapture={typed}>
      <span class="d">MHz</span>
    </p>
    {#if mine}{@render row('tx', TX, v.r?.tx, mine.hz)}{/if}
    <details id="xpdr" ontoggle={xpOpen}><summary>{XPDR_OPEN}</summary></details>
  </div>
{/if}

<style>
  .live { margin-top: var(--space-3); padding-top: var(--space-1); border-top: 1px solid var(--rule); font-size: var(--fs-1); color: var(--muted); }
  .ln { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); margin: var(--space-2) 0 0; min-height: 28px; }
  .k { width: 5rem; }
  .f { color: var(--ink); font-weight: 500; }
  .f, .d { font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  input {
    height: 32px; width: 8.5rem; padding: 0 var(--space-2); border: 1px solid var(--rule); border-radius: var(--r-2); background: var(--sunk);
    color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-1);
  }
  input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  @media (pointer: coarse) { input { height: var(--tap); } }
  /* the transponder calculator (L63): its panel (TransponderPanel.svelte, mounted by xpdr.ts) has no style of its own, so that its chunk
     brings no stylesheet the entry would have to name; these rules are its */
  details { margin-top: var(--space-2); }
  summary { min-height: 32px; padding: 6px 0; color: var(--ink); font-weight: 500; cursor: pointer; }
  :global(#xpdr .ln) { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: var(--space-2) 0 0; min-height: 28px; }
  :global(#xpdr p) { margin: var(--space-2) 0 0; }
  :global(#xpdr .k) { width: 6rem; }
  :global(#xpdr .f) { color: var(--ink); font-weight: 500; }
  :global(#xpdr .f), :global(#xpdr .d) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  :global(#xpdr input), :global(#xpdr select) {
    height: 32px; padding: 0 var(--space-2); border: 1px solid var(--rule); border-radius: var(--r-2); background: var(--sunk);
    color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-1);
  }
  :global(#xpdr input) { width: 8.5rem; }
  :global(#xpdrsel) { width: 100%; min-width: 0; max-width: 100%; }
  :global(#xpdr input:focus), :global(#xpdr select:focus) { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  :global(#xpdr-out) { color: var(--warn); }
  :global(#xpdr-out:empty), :global(#xpdr-offsay:empty) { margin: 0; }
  :global(#xpdr [aria-disabled='true']) { cursor: not-allowed; border-style: dashed; }
  @media (pointer: coarse) { summary { min-height: var(--tap); } :global(#xpdr input), :global(#xpdr select) { height: var(--tap); } }
</style>
