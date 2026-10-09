<script lang="ts">
  import type { Snippet } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { MASK } from '../../state/engine';
  import { countdown } from '../../lib/text/countdown';
  import { getEngine } from '../../state/engine';
  import { reentryNote } from '../../lib/text/notices';
  import { siteClock } from '../../lib/text/passfacts';
  import Icon from '../ui/Icon.svelte';

  /* The answer rail changes shape with the screen, and nothing inside it knows:
       wide (>= 1100 px)   a column beside the stage, scrolling on its own;
       middle (720-1099)   a panel under the stage that folds away behind its headline;
       narrow (< 720 px)   a sheet along the bottom edge whose peek is the headline and the countdown.
     One copy of the content is mounted in every case, so each id exists once. */
  let { children }: { children: Snippet } = $props();

  type Mode = 'side' | 'panel' | 'sheet';
  const modeNow = (): Mode => (matchMedia('(min-width: 1100px)').matches ? 'side'
    : matchMedia('(min-width: 720px)').matches ? 'panel' : 'sheet');

  const first = modeNow();
  let mode = $state<Mode>(first);
  let open = $state(first !== 'sheet');

  $effect(() => {
    const lists = [matchMedia('(min-width: 1100px)'), matchMedia('(min-width: 720px)')];
    const apply = () => { const m = modeNow(); if (m !== mode) { mode = m; open = m !== 'sheet'; } };
    for (const l of lists) l.addEventListener('change', apply);
    return () => { for (const l of lists) l.removeEventListener('change', apply); };
  });

  /* The element sets could not be loaded: the sheet opens by itself, because what it holds is the way to ask again; it folds once they have come. */
  let opened = false;
  $effect(() => {
    if (app.error) { open = true; opened = true; }
    else if (opened) { opened = false; open = mode !== 'sheet'; }
  });

  const a = $derived(app.analysis);
  /* the peek says what the countdown below it says, in the countdown's own words: past the window's last pass, in a pass that is still up when the
     window closes, with the clock scrubbed outside the window */
  /* a spacecraft that has come down: the passes are a prediction that will not happen, and the sheet is folded, so the peek says so itself */
  const down = $derived(!!a && !!reentryNote(a, getEngine().REENTRY_KM));
  const cd = $derived(a ? countdown(a, clock.tick.ms, Date.now(), MASK, siteClock(app.site), () => app.passAfterWindow()) : null);
</script>

<svelte:window onkeydown={e => { if (e.key === 'Escape' && !e.defaultPrevented && mode === 'sheet' && open) open = false; }} />

<aside class="rail {mode}" class:open aria-label="Answer">
  {#if mode !== 'side'}
    <button type="button" class="peek" aria-expanded={open} aria-controls="answer-body" onclick={() => (open = !open)}>
      <span class="grab" aria-hidden="true"></span>
      <span class="line" aria-hidden="true">
        {#if a}
          <span class="big">{(a.totalS / 60).toFixed(1)}<small>{' min visible'}</small></span>
          {#if down}<span class="down">Re-entry: these passes will not happen</span>{/if}
          <span class="nx mono">
            {#if cd}{cd.label} {cd.value}{/if}
          </span>
        {:else if app.error}<span class="nx down">The element sets could not be loaded</span>
        {:else}<span class="nx">Loading…</span>{/if}
      </span>
      <span class="chev" aria-hidden="true"><Icon name="chevron-down" size={18} /></span>
      <span class="sr-only">{open ? 'Hide the answer' : 'Show the answer'}{down ? '. Warning: this spacecraft has re-entered, so these passes will not happen' : ''}{app.error ? '. The element sets could not be loaded' : ''}</span>
    </button>
  {/if}
  <div id="answer-body" class="body" hidden={mode !== 'side' && !open}>
    {@render children()}
  </div>
</aside>

<style>
  .rail { min-width: 0; background: var(--panel); }

  .rail.side { height: 100%; overflow: auto; border-left: 1px solid var(--rule); }
  .rail.side .body { padding: var(--space-5); }

  .rail.panel { margin: 0 var(--space-4) var(--space-4); border: 1px solid var(--rule); border-radius: var(--r-3); }
  .rail.panel .body { padding: var(--space-4); border-top: 1px solid var(--rule); }

  .rail.sheet {
    position: fixed; z-index: var(--z-sheet); inset: auto 0 0 0;
    border-top: 1px solid var(--rule); border-radius: var(--r-3) var(--r-3) 0 0;
    box-shadow: 0 -10px 28px -14px rgba(0, 0, 0, .45); padding-bottom: env(safe-area-inset-bottom);
  }
  .rail.sheet .body { max-height: calc(80dvh - 64px); overflow: auto; overscroll-behavior: contain; padding: var(--space-4); border-top: 1px solid var(--rule); }

  .peek {
    position: relative; display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 56px;
    padding: var(--space-3) var(--space-4); border: 0; background: transparent; color: inherit; text-align: left;
  }
  .grab { position: absolute; top: 5px; left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: var(--rule); }
  .line { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 0 var(--space-4); min-width: 0; }
  .big { font-family: var(--font-head); font-variant-numeric: tabular-nums; font-size: var(--fs-4); font-weight: 700; letter-spacing: -0.02em; color: var(--contact); }
  .big small { font-family: var(--font-sans); font-size: var(--fs-1); font-weight: 400; letter-spacing: 0; color: var(--muted); }
  .down { font-size: var(--fs-1); font-weight: 500; color: var(--bad); }
  .nx { font-size: var(--fs-1); color: var(--ink2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { display: grid; transition: transform var(--dur) var(--ease); color: var(--muted); }
  .open .chev { transform: rotate(180deg); }
</style>
