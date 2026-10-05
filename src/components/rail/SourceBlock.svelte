<script lang="ts">
  import meta from '../../../data/catalogue.meta.json';
  import { app, PINNED } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { iso } from '../../lib/text/fmt';

  /* Where the element set came from, said without implying it is fresher than it is. Live refresh arrives with the
     API milestone; until then this is the embedded snapshot, and it says so. */
  const built = new Date(meta.fetched);
  const entry = $derived(app.entry);
  const E = $derived(app.analysis?.E);
  const builtDays = $derived((clock.tick.ms - built.getTime()) / 86_400_000);
  const epochHours = $derived(E ? (clock.tick.ms - E.epoch.getTime()) / 3_600_000 : 0);
</script>

{#if entry}
  <pre class="tle mono" id="tleraw">{entry.name}
{entry.l1}
{entry.l2}</pre>
  <p id="railprov" class="prov">
    Embedded snapshot built <b class="mono">{iso(built).replace('Z', '')} UTC</b> from {meta.source},
    {builtDays.toFixed(1)} days ago. This set's epoch is {epochHours < 48 ? epochHours.toFixed(1) + ' h' : (epochHours / 24).toFixed(1) + ' d'} old.
    {#if PINNED}This is the assignment snapshot: no newer set is asked for, and each window opens at its set's epoch.{/if}
  </p>
{/if}

<style>
  .tle { margin: 0 0 var(--space-3); padding: var(--space-3); overflow-x: auto; border: 1px solid var(--rule); border-radius: var(--r-2); background: var(--sunk); font-size: var(--fs-0); line-height: 1.5; }
  .prov { color: var(--muted); font-size: var(--fs-1); }
  b { font-weight: 500; color: var(--ink2); }
</style>
