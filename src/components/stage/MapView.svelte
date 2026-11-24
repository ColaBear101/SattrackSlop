<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Analysis, Sample } from '../../lib/types';
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import { view } from '../../state/view.svelte';
  import { MASK, getEngine, satellite } from '../../state/engine';
  import { makeSun } from '../../lib/core/sun';
  import { latStr, lonStr } from '../../lib/observer';
  import { iso } from '../../lib/text/fmt';
  import { tzAt, tzLabelAt } from '../../lib/places';
  import { isCustom } from '../../lib/planner/custom';
  import { CATCOL_CHOICES, CATCOL_GROUP } from '../../lib/text/catcolour';
  import { FULL, FULL_EXIT, SITE_LAYER } from '../../lib/text/view';
  import { MAP_CATALOGUE, MAP_FOOTPRINT, MAP_FULL_TITLE, MAP_LAYERS, MAP_TRAIL, MAP_TRAILS, mapCatSay } from '../../lib/text/map';
  import Segmented from '../ui/Segmented.svelte';
  import Popover from '../ui/Popover.svelte';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import { globe, type TrailKey } from './globe-state.svelte';
  import { MapPainter, readColors, type MapColors, type MapDots } from './draw-map';
  import { ONE_COLOUR, mapcat } from './map-layers.svelte';

  /* The flat ground-track map (the Map tab), a chunk of its own since L86, fetched the first time the tab is shown: the track, the passes
     above the mask in orange, the day/night line, the observer and where the spacecraft is now, painted on a canvas, so the picture is
     described in words beside it (the pass table and the readouts carry the same facts). Under it, its own Layers panel and full screen
     (CHANGES-FROM-LEGACY.md, L86): the globe's switches that a flat map can draw - the trail, the catalogue's dots and their colours, the
     observer's pin and circle, the footprint - held in the globe's own state, so the two views show the same layers and a switch set in
     one is set in the other. */
  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement | undefined;
  let painter: MapPainter | null = null;
  let colors = $state.raw<MapColors | null>(null);
  let resized = $state(0);
  let open = $state(false);
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

  /* ---- the trail (L86) ------------------------------------------------------------------------------------------------------------ *
     As on the globe: the track from a length of time behind the spacecraft to 8 minutes ahead of it, faded toward its tail; "24 h" is the
     whole window, as the old map always drew it, and Off draws none. The globe samples 6 h before the window as well, so that a trail has
     something behind it at the window's first instant, where the clock starts; so does this, once per analysis, when a trail asks for it. */
  const PAD = 6 * 3_600_000, LEAD = 8 * 60_000;
  let seqFor: Analysis | null = null, seq: Sample[] = [];
  function samplesOf(a: Analysis): Sample[] {
    if (seqFor !== a) {
      const pad: Sample[] = [], s = a.start.getTime(), st = a.step * 1000, eng = getEngine();
      for (let ms = s - PAD; ms < s; ms += st) { const p = eng.sampleMs(a.track, ms); if (p) pad.push(p); }
      seq = pad.concat(a.pts); seqFor = a;
    }
    return seq;
  }
  /** the first sample at or after ms */
  function seek(p: readonly Sample[], ms: number): number {
    let lo = 0, hi = p.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (p[mid]!.t.getTime() < ms) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function trailOf(a: Analysis, key: TrailKey, ms: number): 'all' | Sample[] | null {
    if (key === 'off') return null;
    if (key === 'all') return 'all';
    const span = key === 'orbit' ? (a.E.periodShown ? a.E.periodShown * 1000 : 5_400_000) : +key;
    const p = samplesOf(a);
    return p.slice(seek(p, ms - span), seek(p, ms + LEAD + 1));
  }

  /* ---- the catalogue's dots (L86) ------------------------------------------------------------------------------------------------- */
  let hover = $state(-1);
  const dotsOn = $derived(globe.layers.catalogue && app.catalogue.length > 0);
  $effect(() => { if (dotsOn && prefs.tab === 'map') mapcat.want(globe.catColour, app.catalogue); });
  $effect(() => { if (!dotsOn) { hover = -1; painter?.clearDots(); } });
  /* the selected spacecraft is the catalogue's own entry, not drawn as a dot: its marker is there (a planned orbit is in no catalogue) */
  const skip = $derived.by(() => {
    const D = app.analysis;
    const e = D && !isCustom(D.entry) ? app.embedded(D.entry.satnum) : undefined;
    return e ? app.catalogue.indexOf(e) : -1;
  });
  const tint = $derived(globe.catColour !== 'one' ? mapcat.tint : null);

  $effect(() => {
    resized; frame; const col = colors, a = app.analysis, h = hover, t = tint, sk = skip;
    const site = globe.layers.site, fp = globe.layers.footprint, tr = globe.trail, on = dotsOn;
    const ms = untrack(() => clock.tick.ms);
    /* the map is drawn while it is showing: a tab not chosen is hidden, and has no size to draw into */
    if (!painter || !col || !a || prefs.tab !== 'map') return;
    let dots: MapDots | null = null;
    if (on) {
      const cat = app.catalogue;
      mapcat.place(cat, ms);
      dots = { lat: mapcat.lat, lon: mapcat.lon, ok: mapcat.ok, css: t ? t.css : null, one: ONE_COLOUR, skip: sk, hover: h,
               label: h >= 0 && cat[h] ? cat[h].name + (t ? t.tags[h] ?? '' : '') : '' };
    }
    painter.draw({
      analysis: a, site: app.site, mask: MASK, world: app.world, cur: app.sampleAt(ms),
      subsolar: sun.subsolar(new Date(ms)), footprint: fp, colors: col,
      siteOn: site, trail: trailOf(a, tr, ms), dots
    });
  });

  /* the point under the pointer, as the old map told it (a title that follows it, and the cursor of a map), and the dot under it, named
     beside it as the globe names its own; a finger's tap does the same */
  let here = $state('');
  function point(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const lon = (e.clientX - r.left) / r.width * 360 - 180, lat = 90 - (e.clientY - r.top) / r.height * 180;
    here = latStr(lat) + '  ' + lonStr(lon);
    if (painter && dotsOn) hover = painter.pick(e.clientX - r.left, e.clientY - r.top);
  }

  const label = $derived(app.analysis
    ? 'Ground track of ' + app.analysis.entry.name + ' over ' + app.analysis.hours + ' hours, with the passes above the ' + MASK + ' degree mask from ' + app.site.name + ' in orange.'
      + (dotsOn ? mapCatSay(app.catalogue.length - 1) : '')
    : 'Ground track map');

  /* ---- full screen (L86, as the globe's, L78 and L85) ----------------------------------------------------------------------------- *
     The map's figure (the map, these controls and its key) over the whole screen; the timeline bar goes into it along its foot, as it goes
     with the globe, and its two clocks give way to this one, over the map's top left, as they do to the globe's. */
  const mine = $derived(view.full && !!wrap && document.fullscreenElement === wrap.closest('.mapfig'));
  /* the other tab chosen while the map is full screen (the g key) leaves full screen, which would otherwise show an empty figure */
  $effect(() => { if (mine && prefs.tab !== 'map') void document.exitFullscreen().catch(() => {}); });
  const utc = $derived(iso(new Date(clock.tick.ms)).replace('Z', ''));
  const local = $derived(iso(new Date(clock.tick.ms + tzAt(app.site, clock.tick.ms) * 3600000)).replace('Z', ''));
</script>

<!-- the old page refitted and repainted the map when the window was resized (a rotated phone, a dragged edge): the observer on the canvas sees a change of its own
     size, and this sees the window's, which also repaints for an unchanged canvas -->
<svelte:window onresize={() => { if (painter) { painter.resize(); resized++; } }} />

<div class="mapwrap" bind:this={wrap}>
  <!-- a canvas is a picture here: the same facts are in the readouts and the pass list, so it is named, not operable -->
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas bind:this={canvas} id="map" role="img" aria-label={label} title={hover >= 0 && app.catalogue[hover] ? app.catalogue[hover].name : here}
          onpointermove={point} onpointerdown={point} onpointerleave={e => { if (e.pointerType === 'mouse') hover = -1; }}></canvas>
  {#if mine}
    <div class="hud">
      <div class="t1" class:outwin={!app.inWindow(clock.tick.ms)}><span id="mapclock">{utc}</span><span class="zone">UTC</span></div>
      <div class="t2"><span id="mapclocklocal">{local}</span><span class="zone">{tzLabelAt(app.site, clock.tick.ms)}</span></div>
    </div>
  {/if}
</div>

<div class="mapctl">
  {#if view.canFull}
    <Button id="mapfull" size="sm" aria-pressed={mine} title={MAP_FULL_TITLE}
            onclick={e => view.toggleFull(e.currentTarget.closest('.mapfig'))}><Icon name={mine ? 'shrink' : 'expand'} size={16} /><span class="fslabel">{mine ? FULL_EXIT : FULL}</span></Button>
  {/if}
  <Popover bind:open label={MAP_LAYERS} align="end" width={260} boundary=".mapfig">
    {#snippet trigger(p)}
      <Button id="maplayers" size="sm" {...p}>Layers</Button>
    {/snippet}
    <div id="mapLayersMenu" class="layerpanel" role="group" aria-label={MAP_LAYERS}>
      <div class="trailseg">
        <span class="layerlabel">{MAP_TRAIL}</span>
        <Segmented options={MAP_TRAILS} value={globe.trail} label={MAP_TRAIL} size="sm" buttonClass="mtrl" dataAttr="t"
                   onchange={v => globe.setTrail(v as TrailKey)} />
      </div>
      <label><input type="checkbox" id="mapcat" checked={globe.layers.catalogue}
                    onchangecapture={e => globe.setLayer('catalogue', e.currentTarget.checked)}> {MAP_CATALOGUE}</label>
      <div class="sub" role="radiogroup" aria-label={CATCOL_GROUP}>
        {#each CATCOL_CHOICES as [k, l]}
          <label><input type="radio" name="mapcatcolour" value={k} checked={globe.catColour === k}
                        onchangecapture={() => globe.setCatColour(k)}> {l}</label>
        {/each}
      </div>
      {#if globe.catColour !== 'one' && mapcat.note}<p class="layernote sub" id="mapcatnote">{mapcat.note}</p>{/if}
      <label><input type="checkbox" id="mapsite" checked={globe.layers.site}
                    onchangecapture={e => globe.setLayer('site', e.currentTarget.checked)}> {SITE_LAYER}</label>
      <label><input type="checkbox" id="mapfov" checked={globe.layers.footprint}
                    onchangecapture={e => globe.setLayer('footprint', e.currentTarget.checked)}> {MAP_FOOTPRINT}</label>
    </div>
  </Popover>
</div>

<style>
  /* the map keeps its 2:1 shape; on a short screen (a phone on its side) it narrows instead of growing taller than the view */
  .mapwrap { position: relative; width: 100%; max-width: var(--map-max, calc(66dvh * 2)); margin-inline: auto; }
  canvas { cursor: crosshair; display: block; width: 100%; aspect-ratio: 2 / 1; border-radius: var(--r-2); touch-action: manipulation; }
  .mapctl { display: flex; justify-content: flex-end; gap: var(--space-2); width: 100%; max-width: var(--map-max, calc(66dvh * 2)); margin: var(--space-2) auto 0; }
  .mapctl :global(#mapfull) { gap: 6px; }
  /* a phone: the full-screen button is its icon alone, its words still its name */
  @media (max-width: 719px) { .fslabel { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }

  /* the clock over the map in full screen, where the timeline bar's two are not shown (as over the globe) */
  .hud { position: absolute; top: var(--space-2); left: var(--space-3); display: flex; flex-direction: column; gap: 2px; pointer-events: none; color: var(--ink);
         text-shadow: 0 0 4px var(--ocean), 0 0 4px var(--ocean); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .hud .t1 { font-size: 16px; }
  .hud .t1.outwin { color: var(--warn); }
  .hud .t2 { font-size: var(--fs-0); color: var(--ink2); }
  .hud .zone { font-size: var(--fs-0); letter-spacing: .14em; color: var(--muted); margin-left: 6px; }
  /* a phone's map is small: the clock is a line, not a third of it */
  @media (max-width: 719px) { .hud { top: 4px; left: var(--space-2); } .hud .t1 { font-size: var(--fs-1); } .hud .t2 { display: none; } }

  /* the panel: the globe's, in the page's own colours */
  .layerpanel { display: flex; flex-direction: column; gap: 1px; }
  .layerpanel label { display: flex; align-items: center; gap: var(--space-2); padding: 6px var(--space-2); border-radius: var(--r-1); font-size: var(--fs-1); cursor: pointer; min-height: 30px; }
  @media (pointer: coarse) { .layerpanel label { min-height: var(--tap); } }
  .layerpanel label:hover { background: var(--hover); }
  .layerpanel input { accent-color: var(--contact); margin: 0; width: 14px; height: 14px; }
  .trailseg { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 3px var(--space-2); }
  .trailseg :global(.seg) { width: 100%; }
  .trailseg :global(.seg button) { flex: 1 1 0; min-width: 0; padding-inline: 4px; }
  @media (pointer: coarse) { .trailseg :global(.seg) { gap: 8px; margin-bottom: 8px; } }
  .layerlabel { font-size: var(--fs-1); }
  .layernote { margin: 1px var(--space-2) 2px; max-width: 230px; font-size: var(--fs-0); line-height: 1.45; color: var(--muted); }
  .sub { display: flex; flex-direction: column; gap: 1px; padding-left: 22px; }
</style>
