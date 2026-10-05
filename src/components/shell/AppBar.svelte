<script lang="ts">
  import meta from '../../../data/catalogue.meta.json';
  import { app, PINNED } from '../../state/app.svelte';
  import { live } from '../../state/live.svelte';
  import { wall } from '../../state/wall.svelte';
  import { iso } from '../../lib/text/fmt';
  import { ages } from '../../lib/text/provenance';
  import Picker from './Picker.svelte';
  import ObserverChip from './ObserverChip.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import Button from '../ui/Button.svelte';

  const E = $derived(app.analysis?.E);
  const entry = $derived(app.entry);
  const built = new Date(meta.fetched);
  /* how old the element set is, against the real time of day (the transport's clock can be anywhere) */
  const A = $derived(entry && E ? ages({
    custom: !!(entry as { custom?: boolean }).custom, prov: live.provOf(entry.satnum), embedded: app.isEmbedded(entry),
    now: wall.now, epoch: E.epoch, name: entry.name, satnum: entry.satnum, fetched: built, source: meta.source, pinned: PINNED
  }) : null);
</script>

<header class="bar">
  <div class="id">
    <Picker />
    {#if E && A}
      <p class="ids mono">
        <span>NORAD <b id="idnorad">{E.satnum}</b></span>
        <span class="sep wide-only">·</span><span class="wide-only">COSPAR <b id="idcospar">{E.cospar}</b></span>
        <span class="sep wide-only">·</span><span class="wide-only">Epoch <b id="idepoch">{iso(E.epoch)}</b></span>
        {#if PINNED}
          <span class="chip snapshot" title="The embedded element sets, each window opening at its set's epoch: the figures in the README">assignment snapshot</span>
        {/if}
        <span class="chip" id="agechip" class:stale={A.chip.stale} title={A.chip.title}><span id="agetext">{A.chip.text}</span></span>
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
  .chip.snapshot { border-color: var(--link); color: var(--link); }
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
