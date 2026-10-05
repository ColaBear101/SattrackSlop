<script lang="ts">
  import { app } from '../state/app.svelte';

  let text = $state('');
  $effect(() => { if (app.entry) text = app.entry.name; });

  function commit() {
    const hit = app.catalogue.find(c => c.name.toLowerCase() === text.trim().toLowerCase())
      ?? app.catalogue.find(c => c.satnum === text.trim());
    if (hit) app.select(hit);
  }
</script>

<label class="picker">
  <span class="label">Spacecraft</span>
  <input id="satsearch" type="search" list="satlist" autocomplete="off" spellcheck="false"
         placeholder="Name or NORAD id" bind:value={text} onchange={commit} aria-describedby="satcount">
  <datalist id="satlist">
    {#each app.catalogue as c (c.satnum)}<option value={c.name}></option>{/each}
  </datalist>
  <span id="satcount" class="count">{app.catalogue.length.toLocaleString('en-US')} spacecraft</span>
</label>

<style>
  .picker { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 0.75rem; }
  .label { font-size: 0.8125rem; color: var(--muted, #536169); }
  input { min-width: 16rem; padding: 0.4rem 0.6rem; font: inherit; }
  .count { font-size: 0.8125rem; color: var(--muted, #536169); }
</style>
