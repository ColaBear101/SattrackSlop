<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import { MASK, satellite } from '../../state/engine';
  import { makeSun } from '../../lib/core/sun';
  import { latStr, lonStr } from '../../lib/observer';
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

  /* The picture changes when the sample it shows changes (every 10 s in a day's window, at real time), not at every tick of the clock: the track
     and the world are the same, and so are the markers. Outside the window the instant itself is propagated, so each tick counts there. */
  const frame = $derived.by(() => { const ms = clock.tick.ms; return app.inWindow(ms) ? app.idxAt(ms) : ms; });

  $effect(() => {
    resized; frame; const col = colors, a = app.analysis;
    const ms = untrack(() => clock.tick.ms);
    /* the map is drawn while it is showing: a tab not chosen is hidden, and has no size to draw into */
    if (!painter || !col || !a || prefs.tab !== 'map') return;
    const date = new Date(ms);
    painter.draw({
      analysis: a, site: app.site, mask: MASK, world: app.world, cur: app.sampleAt(ms),
      subsolar: sun.subsolar(date), footprint: globe.layers.footprint, colors: col
    });
  });

  /* the point under the pointer, as the old map told it (a title that follows it, and the cursor of a map) */
  let here = $state('');
  function point(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    const lon = (e.clientX - r.left) / r.width * 360 - 180, lat = 90 - (e.clientY - r.top) / r.height * 180;
    here = latStr(lat) + '  ' + lonStr(lon);
  }

  const label = $derived(app.analysis
    ? 'Ground track of ' + app.analysis.entry.name + ' over ' + app.analysis.hours + ' hours, with the passes above the ' + MASK + ' degree mask from ' + app.site.name + ' in orange.'
    : 'Ground track map');
</script>

<!-- the old page refitted and repainted the map when the window was resized (a rotated phone, a dragged edge): the observer on the canvas sees a change of its own
     size, and this sees the window's, which also repaints for an unchanged canvas -->
<svelte:window onresize={() => { if (painter) { painter.resize(); resized++; } }} />

<!-- a canvas is a picture here: the same facts are in the readouts and the pass list, so it is named, not operable -->
<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
<canvas bind:this={canvas} id="map" role="img" aria-label={label} title={here} onmousemove={point}></canvas>

<style>
  /* the map keeps its 2:1 shape; on a short screen (a phone on its side) it narrows instead of growing taller than the view */
  canvas { cursor: crosshair; display: block; width: 100%; max-width: var(--map-max, calc(66dvh * 2)); margin-inline: auto; aspect-ratio: 2 / 1; border-radius: var(--r-2); }
</style>
