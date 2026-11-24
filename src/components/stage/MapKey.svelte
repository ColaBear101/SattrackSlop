<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { MAP_CAT_KEY } from '../../lib/text/map';
  import { globe } from './globe-state.svelte';
  import { ONE_COLOUR, mapcat } from './map-layers.svelte';

  /* The map key's rows for the catalogue's dots (L86), in the map's chunk, inside the key the stage draws: while the dots are drawn, the one
     colour, or the classes of the colouring chosen, each swatch the colour its dots are drawn in (the globe's key's own). */
  const tint = $derived(globe.catColour !== 'one' ? mapcat.tint : null);
</script>

{#if globe.layers.catalogue && app.catalogue.length}
  {#if tint}
    {#each tint.key as row}{#each row as k}<li class="mk"><i style="--c:{k.c}"></i> {k.t}</li>{/each}{/each}
  {:else}
    <li class="mk"><i style="--c:{ONE_COLOUR}"></i> {MAP_CAT_KEY}</li>
  {/if}
{/if}

<style>
  .mk i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--c); vertical-align: middle; margin-right: var(--space-2); }
</style>
