<script lang="ts">
  import Picker from './components/Picker.svelte';
  import Answer from './components/Answer.svelte';
  import { app } from './state/app.svelte';
  import { iso } from './lib/text/fmt';

  const E = $derived(app.analysis?.E);
</script>

<main>
  <header>
    <h1 id="satname">{app.entry?.name ?? 'Ground Track Console'}</h1>
    {#if E}
      <p class="ids">NORAD <b>{E.satnum}</b> · COSPAR <b>{E.cospar}</b> · Epoch <b>{iso(E.epoch)}</b></p>
    {/if}
    <Picker />
  </header>

  {#if app.loading}
    <p role="status">Loading the catalogue…</p>
  {:else if app.error}
    <p role="alert" id="loadnote">{app.error}</p>
  {/if}

  <Answer />
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--surface, #f2f4f5);
    color: var(--ink, #0e1a1f);
    font: 15px/1.55 system-ui, sans-serif;
  }
  main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  h1 { margin: 0; font-size: 1.75rem; }
  .ids { margin: 0.25rem 0 1rem; color: var(--muted, #536169); font-size: 0.875rem; }
</style>
