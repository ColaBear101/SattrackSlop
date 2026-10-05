<script lang="ts">
  import { app, PINNED } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { iso } from '../../lib/text/fmt';
  import Picker from './Picker.svelte';
  import ObserverChip from './ObserverChip.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import Button from '../ui/Button.svelte';

  const E = $derived(app.analysis?.E);
  /* how old the element set is, against the instant the clock shows (the assignment snapshot is its own thing) */
  const ageH = $derived(E ? (clock.tick.ms - E.epoch.getTime()) / 3_600_000 : 0);
  const age = $derived(ageH < 48 ? ageH.toFixed(1) + ' h old' : (ageH / 24).toFixed(1) + ' d old');
</script>

<header class="bar">
  <div class="id">
    <Picker />
    {#if E}
      <p class="ids mono">
        <span>NORAD <b>{E.satnum}</b></span>
        <span class="sep wide-only">·</span><span class="wide-only">COSPAR <b>{E.cospar}</b></span>
        <span class="sep wide-only">·</span><span class="wide-only">Epoch <b>{iso(E.epoch)}</b></span>
        {#if PINNED}
          <span class="chip snapshot" title="The embedded element sets, each window opening at its set's epoch: the figures in the README">assignment snapshot</span>
        {:else}
          <span class="chip" class:stale={ageH > 24 * 7} title="How old this element set is at the time shown">epoch {age}</span>
        {/if}
      </p>
    {/if}
  </div>
  <div class="tools">
    <div class="t-obs"><ObserverChip /></div>
    <div class="t-plan"><Button variant="default" disabled title="Design your own orbit: coming in a later milestone">Plan an orbit</Button></div>
    <div class="t-theme"><ThemeToggle /></div>
  </div>
</header>

<style>
  .bar {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-4);
    min-height: var(--bar-h); padding: var(--space-2) var(--space-4);
    background: var(--chrome); color: var(--chromeink); border-bottom: 1px solid var(--chromerule);
  }
  .id { min-width: 0; flex: 1 1 340px; }
  .ids { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--space-2); margin: 0; color: var(--muted); font-size: var(--fs-0); }
  .ids b { font-weight: 500; color: var(--ink2); }
  .sep { opacity: .5; }
  .chip {
    display: inline-flex; align-items: center; padding: 0 var(--space-2); border: 1px solid var(--chromerule);
    border-radius: var(--r-pill); font-size: var(--fs-0); color: var(--muted); margin-left: var(--space-1);
  }
  .chip.stale { border-color: var(--warn); color: var(--warn); }
  .chip.snapshot { border-color: var(--track); color: var(--track); }
  .tools { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }

  /* narrow: the name and the theme toggle share a row, the observer and the planner sit under them, and the
     ids shrink to NORAD and the age chip, so the first screen is mostly the map */
  @media (max-width: 719px) {
    .bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'id theme' 'obs plan'; align-items: center; padding: var(--space-2) var(--space-3); }
    .id { grid-area: id; flex: none; }
    .tools { display: contents; }
    .t-theme { grid-area: theme; justify-self: end; }
    .t-obs { grid-area: obs; justify-self: start; min-width: 0; }
    .t-plan { grid-area: plan; justify-self: end; }
    .wide-only { display: none; }
  }
  /* wide: one row of fixed height, because the console below is sized to what is left of the screen */
  @media (min-width: 1100px) {
    .bar { flex-wrap: nowrap; height: var(--bar-h); }
    .ids { flex-wrap: nowrap; white-space: nowrap; overflow: hidden; }
  }
</style>
