<script lang="ts">
  import { report } from '../../state/report.svelte';

  /* "Orbit in this window": the few figures that frame the visibility answer. The rest of the orbit, with its notes, is in
     the report under Orbital elements. The rows are the old page's (renderElements, #minigrid). */
  const rows = $derived(report.elements?.mini ?? []);
</script>

<dl id="minigrid">
  {#each rows as [k, v] (k)}
    <div class="dv"><dt class="eyebrow">{k}</dt><dd class="mono">{v}</dd></div>
  {/each}
</dl>
<p class="more"><a href="#sec-elements">All the elements, osculating values and notes ↓</a></p>

<style>
  dl { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3) var(--space-4); }
  dt { font-size: var(--fs-0); letter-spacing: .08em; }
  dd { margin: 2px 0 0; font-size: var(--fs-2); }
  .more { margin-top: var(--space-4); font-size: var(--fs-1); }
</style>
