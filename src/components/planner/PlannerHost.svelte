<script lang="ts">
  import { planner, parts } from './load.svelte';

  /* Mounts the planner's pieces once something has asked for them (planner.request()), and never before, so the first visit
     pays for none of it. The pieces live in two places, so this is placed twice in App.svelte:
       'zone'  the panel itself, in the console's planner cell (it takes the rail's cell or sits under the stage);
       'root'  the two body-level pieces, as direct children of the mount node: the confirmation region #pl-live (the one
               sibling the sheet presentation does not make inert) and the icon sprite the notes' glyphs point into.
     The `{#if}` is only about whether to fetch; nothing inside the panel is conditional (the controller owns those nodes). */
  let { place }: { place: 'zone' | 'root' } = $props();
</script>

{#if planner.wanted}
  {#await parts() then m}
    {#if place === 'zone'}
      <m.PlannerPanel />
    {:else}
      <m.PlannerLive />
      <m.PlannerSprite />
    {/if}
  {:catch}
    <!-- offline, or the chunk is gone: no planner, and nothing else on the page depends on it -->
  {/await}
{/if}
