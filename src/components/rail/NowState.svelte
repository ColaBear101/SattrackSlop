<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { getEngine, getOptics } from '../../state/engine';
  import { liveReader } from '../../lib/analysis/live-state';
  import { nowRows } from '../../lib/text/now-state';

  /* The spacecraft at the clock's instant, under the elevation and the countdown (CHANGES-FROM-LEGACY.md, L53): whether
     sunlight reaches it, its range rate, its speed and the grid square below it. A chunk of its own, which the rail asks for
     when this part of it is first in view. Worked out on clock.tick, as the elevation beside it is (ten times a second while
     the clock plays, never while it is paused), from one propagation; while the clock plays the shadow is tested at most
     once a second of the clock, and a paused clock's instant is always tested itself, since what a pause shows stays on the
     page (lib/analysis/live-state.ts). The instants are on the block for whoever checks it: the figures' (data-ms) and the
     shadow test's (data-lit-ms), with the state itself (data-lit). */
  const read = liveReader();
  const st = $derived(app.analysis ? read(getEngine(), getOptics(), app.analysis.track, clock.tick.ms, !clock.playing) : null);
</script>

<dl id="nowstate" data-ms={st?.ms} data-lit={st?.lit} data-lit-ms={st?.litMs}>
  {#each nowRows(st) as r (r.id)}
    <div><dt class="eyebrow">{r.label}</dt><dd><span class="mono v" id={r.id}>{r.value}</span> <span class="n">{r.note}</span></dd></div>
  {/each}
</dl>

<style>
  dl { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3) var(--space-4); }
  dd { margin: 2px 0 0; }
  .v { display: block; font-size: var(--fs-2); font-weight: 500; }
  .n { display: block; color: var(--muted); font-size: var(--fs-0); }
</style>
