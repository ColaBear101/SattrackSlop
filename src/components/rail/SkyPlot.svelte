<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import { MASK } from '../../state/engine';
  import { compass } from '../../lib/text/fmt';
  import { skyCaption } from '../../lib/text/passfacts';
  import { drawSky, readSkyColors, type SkyColors } from './draw-sky';
  import Rich from '../ui/Rich.svelte';

  /* Sky track of the selected pass. The canvas draws it; the sentence under it says the same in words. There are two copies
     of the one plot, as there were in the old page: the rail's, under the pass list, and one beside the pass table in the
     report, so a row clicked at the table redraws a plot that is in view. `full` is the report's, with the old caption. */
  let { id = 'sky', captionId, full = false }: { id?: string; captionId?: string; full?: boolean } = $props();

  let canvas: HTMLCanvasElement;
  let colors = $state.raw<SkyColors | null>(null);
  let resized = $state(0);

  const pass = $derived(app.analysis?.passes[app.selPass] ?? null);
  const n = $derived(app.analysis?.passes.length ?? 0);

  onMount(() => {
    const ro = new ResizeObserver(() => resized++);
    ro.observe(canvas);
    return () => ro.disconnect();
  });
  $effect(() => { prefs.resolved; colors = readSkyColors(); });
  $effect(() => { resized; if (colors) drawSky(canvas, pass, MASK, colors); });

  const words = $derived(pass
    ? 'Pass ' + (app.selPass + 1) + ' of ' + n + ': rises ' + compass(pass.aosAz) + ', peaks at ' +
      pass.maxEl.toFixed(1) + '° ' + compass(pass.maxAz) + ', sets ' + compass(pass.losAz) + '.'
    : 'No pass above the ' + MASK + '° mask in this window.');
</script>

<figure class:full>
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas bind:this={canvas} {id} role="img" aria-label="Sky track of the selected pass, azimuth and elevation"></canvas>
  <figcaption class="mono" id={captionId}>{#if full}{#if pass}<Rich value={skyCaption(pass, app.selPass, n)} />{:else}No pass clears the {MASK}° mask in this window.{/if}{:else}{words}{/if}</figcaption>
</figure>

<style>
  figure { margin: 0; display: grid; gap: var(--space-2); justify-items: center; }
  canvas { display: block; width: 100%; max-width: 280px; aspect-ratio: 1; }
  figure.full canvas { max-width: 360px; }
  figcaption { color: var(--muted); font-size: var(--fs-0); text-align: center; }
</style>
