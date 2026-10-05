<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import { MASK } from '../../state/engine';
  import { compass } from '../../lib/text/fmt';
  import { drawSky, readSkyColors, type SkyColors } from './draw-sky';

  /* Sky track of the selected pass. The canvas draws it; the sentence under it says the same in words. */
  let canvas: HTMLCanvasElement;
  let colors = $state.raw<SkyColors | null>(null);
  let resized = $state(0);

  const pass = $derived(app.analysis?.passes[app.selPass] ?? null);

  onMount(() => {
    const ro = new ResizeObserver(() => resized++);
    ro.observe(canvas);
    return () => ro.disconnect();
  });
  $effect(() => { prefs.resolved; colors = readSkyColors(); });
  $effect(() => { resized; if (colors) drawSky(canvas, pass, MASK, colors); });

  const words = $derived(pass
    ? 'Pass ' + (app.selPass + 1) + ' of ' + app.analysis!.passes.length + ': rises ' + compass(pass.aosAz) + ', peaks at ' +
      pass.maxEl.toFixed(1) + '° ' + compass(pass.maxAz) + ', sets ' + compass(pass.losAz) + '.'
    : 'No pass above the ' + MASK + '° mask in this window.');
</script>

<figure>
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas bind:this={canvas} id="sky" role="img" aria-label="Sky track of the selected pass, azimuth and elevation"></canvas>
  <figcaption class="mono">{words}</figcaption>
</figure>

<style>
  figure { margin: 0; display: grid; gap: var(--space-2); justify-items: center; }
  canvas { display: block; width: 100%; max-width: 280px; aspect-ratio: 1; }
  figcaption { color: var(--muted); font-size: var(--fs-0); text-align: center; }
</style>
