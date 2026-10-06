<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import { MASK, satellite } from '../../state/engine';
  import { makeSun } from '../../lib/core/sun';
  import { globe } from './globe-state.svelte';
  import { MapPainter, readColors, type MapColors } from './draw-map';

  /* The flat ground-track map: 24 h of track, the passes above the mask in orange, the day/night line, the
     observer and where the spacecraft is now. Painted on a canvas, so the picture is described in words beside
     it (the pass table and the readouts carry the same facts). */
  let canvas: HTMLCanvasElement;
  let painter: MapPainter | null = null;
  let colors = $state.raw<MapColors | null>(null);
  let resized = $state(0);
  const sun = makeSun(satellite);

  onMount(() => {
    painter = new MapPainter(canvas);
    const ro = new ResizeObserver(() => { if (painter?.resize()) resized++; });
    ro.observe(canvas);
    resized++;
    return () => ro.disconnect();
  });

  /* colours are read once per theme, not once per stroke */
  $effect(() => { prefs.resolved; colors = readColors(); });

  $effect(() => {
    resized; const col = colors, a = app.analysis;
    const ms = clock.tick.ms;
    /* the map is drawn while it is showing: a tab not chosen is hidden, and has no size to draw into */
    if (!painter || !col || !a || prefs.tab !== 'map') return;
    const date = new Date(ms);
    painter.draw({
      analysis: a, site: app.site, mask: MASK, world: app.world, cur: app.sampleAt(ms),
      subsolar: sun.subsolar(date), footprint: globe.layers.footprint, colors: col
    });
  });

  const label = $derived(app.analysis
    ? 'Ground track of ' + app.analysis.entry.name + ' over ' + app.analysis.hours + ' hours, with the passes above the ' + MASK + ' degree mask from ' + app.site.name + ' in orange.'
    : 'Ground track map');
</script>

<!-- a canvas is a picture here: the same facts are in the readouts and the pass list, so it is named, not operable -->
<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
<canvas bind:this={canvas} id="map" role="img" aria-label={label}></canvas>

<style>
  /* the map keeps its 2:1 shape; on a short screen (a phone on its side) it narrows instead of growing taller than the view */
  canvas { display: block; width: 100%; max-width: var(--map-max, calc(66dvh * 2)); margin-inline: auto; aspect-ratio: 2 / 1; border-radius: var(--r-2); }
</style>
