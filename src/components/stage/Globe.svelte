<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import { MASK } from '../../state/engine';
  import { iso } from '../../lib/text/fmt';
  import { tzAt, tzLabelAt } from '../../lib/places';
  import { globe } from './globe-state.svelte';
  import GlobeControls from './GlobeControls.svelte';

  /* The 3D globe: the catalogue as points, the spacecraft's orbit and track, what it can see, the Earth turning under
     it, and the cameras. The scene is drawn by src/scene (the old orbit3d, moved as it was) onto the canvas here and writes
     words into a few labels here: the spacecraft's name, the name under the pointer, the R and altitude annotations, and in
     the point-of-view camera the lens and the ground one pixel covers. Those nodes are plain elements that Svelte never
     rewrites; everything else is Svelte's. */
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let nodes: Record<'name' | 'hover' | 'earth' | 'alt' | 'fov' | 'fovmm' | 'gsd' | 'gsdu', HTMLElement | undefined> =
    { name: undefined, hover: undefined, earth: undefined, alt: undefined, fov: undefined, fovmm: undefined, gsd: undefined, gsdu: undefined };
  let mini: HTMLCanvasElement | undefined;
  let card: HTMLDivElement | undefined = $state();
  let inView = $state(false);
  let cardPos = $state({ x: 8, y: 8 });

  onMount(() => {
    globe.attach({
      canvas, mini: mini ?? null,
      name: nodes.name ?? null, hover: nodes.hover ?? null, earth: nodes.earth ?? null, alt: nodes.alt ?? null,
      fov: nodes.fov ?? null, fovmm: nodes.fovmm ?? null, gsd: nodes.gsd ?? null, gsdu: nodes.gsdu ?? null
    });
    /* off screen the scene draws nothing: a report scrolled into view, or another tab, costs no frames */
    const io = new IntersectionObserver(es => { inView = es[0]!.isIntersecting; }, { rootMargin: '60px' });
    io.observe(host);
    const ro = new ResizeObserver(() => globe.wake());
    ro.observe(host);
    return () => { io.disconnect(); ro.disconnect(); };
  });

  /* The globe is what the page opens on; the other tab asks for it when it is first chosen. */
  $effect(() => { if (prefs.tab === 'globe') globe.request(); });
  /* the data the scene is built from (the coastlines, the catalogue) arriving */
  $effect(() => { app.world; app.catalogue; untrack(() => globe.poke()); });
  /* a new analysis - another spacecraft, another window, another observer - is flown; the pin follows a moved observer */
  $effect(() => { app.analysis; globe.status; untrack(() => globe.load()); });
  $effect(() => { app.site; globe.status; untrack(() => globe.siteMoved()); });
  /* drawing only while it can be seen, and while something is moving (see globe-state: wake, policy) */
  $effect(() => {
    globe.showing = prefs.tab === 'globe' && inView;
    globe.status;
    untrack(() => globe.wake());
  });
  /* the clock moved (a seek, a scrub, a rate change; while it plays this is ten times a second) or was started or stopped */
  $effect(() => { clock.tick; clock.playing; clock.rate; untrack(() => globe.wake()); });
  /* WebGL is not here: say so, and if the reader did not choose the globe, open the map instead */
  $effect(() => { if (globe.status === 'unavailable') prefs.fallback('map'); });

  /* the clock on the globe, the one picture people share: UTC above, the observer's time under it */
  const utc = $derived(iso(new Date(clock.tick.ms)).replace('Z', ''));
  const local = $derived(iso(new Date(clock.tick.ms + tzAt(app.site, clock.tick.ms) * 3600000)).replace('Z', ''));
  const zone = $derived(tzLabelAt(app.site, clock.tick.ms));

  /* the confirmation sits by the point that was clicked, inside the view */
  $effect(() => {
    const p = globe.pick;
    if (!p || !host) return;
    const r = host.getBoundingClientRect();
    requestAnimationFrame(() => {
      const w = card?.offsetWidth || 212, h = card?.offsetHeight || 96;
      cardPos = { x: Math.max(8, Math.min(p.x - r.left + 14, r.width - w - 8)), y: Math.max(8, Math.min(p.y - r.top + 14, r.height - h - 8)) };
      card?.querySelector<HTMLElement>('#pcload')?.focus({ preventScroll: true });
    });
  });
  const nm = $derived(app.site.name);
</script>

<svelte:window onkeydown={e => { if (e.key === 'Escape') globe.cancelPick(); }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="viewport" bind:this={host} onpointermove={() => globe.interact()} onpointerdown={() => globe.interact()} onwheel={() => globe.interact()}
     onmousedown={e => { if (!(e.target as Element).closest('.pickconfirm')) globe.cancelPick(); }}>
  <canvas bind:this={canvas} id="globe" aria-label="Interactive 3D orbit view. The written analysis below contains the same data."></canvas>
  <div class="o3-layer">
    <span class="o3-label" id="o3name" bind:this={nodes.name}>—</span>
    <span class="o3-label o3-hover" id="o3hover" bind:this={nodes.hover}></span>
    <span class="o3-label o3-earth" id="o3earth" bind:this={nodes.earth}>R⊕ = 6378.137 km</span>
    <span class="o3-label o3-alt" id="o3alt" bind:this={nodes.alt}>alt</span>
  </div>
  <div class="hud">
    <div class="t1"><span id="o3clock">{utc}</span><span class="zone">UTC</span></div>
    <div class="t2"><span id="o3clocklocal">{local}</span><span class="zone" id="lbl-tz1">{zone}</span></div>
    <div class="t3" id="o3fovrow" hidden>
      <span class="zone"><abbr title="field of view, the width of the lens">FOV</abbr></span><span id="o3fov3" bind:this={nodes.fov}>—</span><span class="mm" id="o3fovmm" bind:this={nodes.fovmm}>—</span>
    </div>
    <div class="t3" id="o3gsdrow" hidden>
      <span class="zone"><abbr title="ground sample distance, the ground one screen pixel covers">GSD</abbr></span><span id="o3gsd" bind:this={nodes.gsd}>—</span><span class="mm" id="o3gsdu" bind:this={nodes.gsdu}>m/px</span>
    </div>
  </div>
  {#if globe.status !== 'unavailable'}<GlobeControls />{/if}
  <canvas id="o3mini" class="o3-mini" width="480" height="240" hidden bind:this={mini}
          aria-label="Minimap: the spacecraft's position, its access circle and where the camera is pointed"></canvas>
  <!-- where there is no globe, there is no key to it and nothing to drag: the sentence below is all the panel says -->
  {#if globe.status !== 'unavailable'}
  <ul class="o3-key" id="o3key" class:kel-on={globe.layers.elements} aria-label="Globe key">
    <li><i class="k-orbit"></i>Orbit, one revolution</li>
    <li><i class="k-track"></i>Spacecraft and ground track</li>
    <li><i class="k-view"></i><span id="lbl-keyview">In view from {nm} (el ≥ {MASK}°)</span></li>
    <li><i class="k-foot"></i>Footprint (ground above {MASK}°)</li>
    <li><i class="k-site"></i><span id="lbl-keysite">{nm} {MASK}° access circle</span></li>
    <li><i class="k-cat"></i>Rest of the catalogue</li>
    <li class="kel kel-h" hidden={!globe.layers.elements}>Orbital elements · point at one for its value</li>
    <li class="kel" hidden={!globe.layers.elements}><b class="s-raan">Ω</b>RAAN, from ♈︎ · <b class="s-raan">☊</b>ascending node</li>
    <li class="kel" hidden={!globe.layers.elements}><b class="s-inc">i</b>inclination · <b class="s-argp">ω</b>argument of perigee</li>
    <li class="kel" hidden={!globe.layers.elements}><b class="s-nu">θ</b>true anomaly · <b class="s-e">e</b>eccentricity vector</li>
    <li class="kel" hidden={!globe.layers.elements}><b class="s-h">h</b>angular momentum · <b class="s-v">v</b>velocity (vt, vn)</li>
  </ul>
  <p class="hint-drag">Drag to orbit · scroll or pinch to zoom · click or tap a point to load that spacecraft</p>
  {/if}
  <!-- always in the page, hidden until a point is clicked: a script asks whether it is there -->
  <div class="pickconfirm" id="pickconfirm" role="dialog" aria-labelledby="pcname" hidden={!globe.pick} bind:this={card} style="left:{cardPos.x}px; top:{cardPos.y}px">
    <p class="pcn" id="pcname">{globe.pick?.name ?? '—'}</p>
    <p class="pcd" id="pcmeta">NORAD {globe.pick?.satnum ?? '—'}</p>
    <div class="pcb">
      <button type="button" class="pcbtn load" id="pcload" onclick={() => globe.confirmPick()}>Load</button>
      <button type="button" class="pcbtn" id="pccancel" onclick={() => globe.cancelPick()}>Cancel</button>
    </div>
  </div>
  {#if globe.status === 'unavailable'}
    <p class="o3-fallback" id="o3fallback" role="status">WebGL is not available here — the flat ground track plots the same orbit.</p>
  {/if}
</div>

<style>
  .viewport {
    position: relative; overflow: hidden; border-radius: var(--r-3); background: var(--void); color: #EAF2F6;
    height: clamp(340px, calc(100dvh - var(--bar-h) - var(--transport-h) - 132px), 880px);
  }
  @media (max-width: 1099px) { .viewport { height: clamp(360px, 78vw, 620px); } }
  /* a phone: tall, but not taller than leaves the strip along the globe's foot above the answer sheet's peek on the first screen (the header and
     the tabs above it are about 230 px, the peek 56-73 px) */
  @media (max-width: 719px) { .viewport { height: clamp(280px, min(130vw, calc(100dvh - 316px)), 600px); } }
  /* a phone on its side: the globe is the screen, the page scrolls to the rest */
  @media (max-height: 520px) { .viewport { height: max(300px, calc(100dvh - 24px)); } }
  #globe { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }

  /* the scene positions these over the points they name and shows and hides them itself */
  .o3-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .o3-label {
    position: absolute; display: none; transform: translate(12px, -50%);
    font-family: var(--font-mono); font-size: var(--fs-0); font-weight: 600; letter-spacing: .06em; color: #EAF2F6; white-space: nowrap;
    text-shadow: 0 0 4px #05090C, 0 0 4px #05090C, 0 0 9px #05090C;
  }
  .o3-label.o3-hover { color: #AFC3CE; font-weight: 500; }
  .o3-label.o3-earth { color: #E8EFF2; transform: translate(12px, -190%); }
  .o3-label.o3-alt { color: #17A3CC; transform: translate(12px, 90%); }

  /* the clock on the globe, and in the point-of-view camera the lens and the ground a pixel covers */
  .hud { position: absolute; top: var(--space-3); left: var(--space-4); display: flex; flex-direction: column; gap: 2px; pointer-events: none; color: #EAF2F6; text-shadow: 0 0 6px #05090C, 0 0 6px #05090C; }
  .hud .t1 { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 16px; letter-spacing: -.01em; }
  .hud .t2 { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-0); color: #AFC3CE; }
  .hud .zone { font-size: var(--fs-0); letter-spacing: .14em; color: #8AA0AC; margin-left: 6px; }
  .hud .t3 { margin-top: 5px; display: flex; align-items: baseline; gap: 7px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-1); color: #CFE3EE; }
  .hud .t3[hidden] { display: none; }
  .hud .t3 .zone { margin-left: 0; }
  .hud .t3 .mm { font-size: var(--fs-0); color: #8AA0AC; }
  .hud abbr[title] { pointer-events: auto; text-decoration: underline dotted; text-underline-offset: 2px; cursor: help; }

  /* the point-of-view minimap: where the spacecraft is, the circle it can see, where the lens points */
  .o3-mini {
    position: absolute; left: 10px; bottom: 34px; width: 240px; height: 120px; border: 1px solid rgba(180, 200, 212, .30); border-radius: 3px;
    background: rgba(10, 16, 20, .72); backdrop-filter: blur(6px); pointer-events: none;
  }
  .o3-mini[hidden] { display: none; }
  @media (max-width: 760px), (max-height: 720px) { .o3-mini { width: 168px; height: 84px; left: 8px; bottom: 30px; } }
  @media (max-width: 640px) { .o3-mini { display: none; } }

  /* the globe's key: what the colours mean, bottom left */
  .o3-key {
    position: absolute; left: var(--space-4); bottom: 32px; margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; pointer-events: none;
    font-family: var(--font-mono); font-size: var(--fs-0); letter-spacing: .05em; color: #9DB1BC; text-shadow: 0 0 5px #05090C, 0 0 5px #05090C;
  }
  .o3-key li { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
  .o3-key i { flex: none; width: 16px; display: flex; justify-content: center; }
  .o3-key i::before { content: ""; display: block; }
  .o3-key .k-orbit::before { width: 16px; border-top: 2px solid #768893; }
  .o3-key .k-track::before { width: 16px; border-top: 2px solid #55D1E7; }
  .o3-key .k-foot::before { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid #BFC6CA; }
  .o3-key .k-site::before { width: 9px; height: 9px; border-radius: 50%; border: 1.5px dashed #F29CBB; }
  .o3-key .k-view::before { width: 16px; border-top: 3px solid #E8BC5A; }
  .o3-key .k-cat::before { width: 6px; height: 6px; border-radius: 50%; background: #3A93A3; }
  .o3-key li.kel { display: block; }
  .o3-key li.kel[hidden] { display: none; }
  .o3-key .kel-h { margin-top: 5px; color: #7E94A0; }
  .o3-key .kel b { display: inline-block; min-width: 16px; margin-right: 7px; text-align: center; font-family: Georgia, serif; font-style: italic; font-size: var(--fs-1); font-weight: 600; }
  .o3-key .s-raan { color: #F5C842; } .o3-key .s-inc { color: #A98BFF; } .o3-key .s-argp { color: #FF9230; }
  .o3-key .s-nu { color: #FF4FA3; } .o3-key .s-h { color: #4FC3FF; } .o3-key .s-e { color: #FF5555; } .o3-key .s-v { color: #4DF0A0; }
  @media (max-height: 560px) { .o3-key.kel-on > li:not(.kel) { display: none; } }
  .o3-mini:not([hidden]) ~ .o3-key { display: none; }
  @media (max-width: 640px) { .o3-key { display: none; } }

  /* one line, cut short where the picture is narrow (the orbit planner's drawer leaves the globe 530 px): a second line would grow up into the key above it */
  .hint-drag { position: absolute; left: var(--space-4); right: var(--space-4); bottom: var(--space-3); margin: 0; pointer-events: none; font-family: var(--font-mono); font-size: var(--fs-0); color: #8AA0AC; text-shadow: 0 0 6px #05090C; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* a phone: above the controls' strip, and wrapping */
  @media (max-width: 719px) { .hint-drag { right: var(--space-3); bottom: 92px; white-space: normal; } }

  /* "load this one?" by the point that was clicked: the cloud is dense, so a nudge must not swap the spacecraft unasked */
  .pickconfirm[hidden] { display: none; }
  .pickconfirm {
    position: absolute; z-index: 5; min-width: 212px; padding: 11px 12px 10px; border-radius: 4px; background: rgba(10, 16, 20, .92);
    border: 1px solid rgba(180, 200, 212, .35); box-shadow: 0 6px 24px rgba(0, 0, 0, .5); backdrop-filter: blur(6px);
  }
  .pcn { margin: 0; font-family: var(--font-mono); font-size: var(--fs-1); color: #EAF2F6; }
  .pcd { margin: 2px 0 0; font-family: var(--font-mono); font-size: var(--fs-0); color: #8AA0AC; }
  .pcb { display: flex; gap: 6px; margin-top: 9px; }
  .pcbtn { flex: 1; min-height: 32px; border-radius: 3px; border: 1px solid rgba(180, 200, 212, .35); background: transparent; color: #DCE8EE; font-family: var(--font-mono); font-size: var(--fs-1); }
  /* the card puts the focus on Load itself, after a press, where :focus-visible does not draw: the ring is asked for */
  .pcbtn.load:focus { outline: 2px solid var(--focus); outline-offset: 2px; }
  .pcbtn.load { background: var(--contact); border-color: var(--contact); color: #fff; }
  @media (pointer: coarse) { .pcbtn { min-height: var(--tap); } }

  .o3-fallback { position: absolute; inset: auto var(--space-4) var(--space-4); margin: 0; padding: var(--space-3); border-radius: var(--r-2); background: rgba(10, 16, 20, .8); color: #CFE3EE; font-size: var(--fs-1); text-align: center; }
</style>
