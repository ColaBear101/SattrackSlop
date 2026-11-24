<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { globe, type CamMode, type TrailKey } from './globe-state.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Popover from '../ui/Popover.svelte';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import { CLOSE_LABEL, CLOSE_TITLE } from '../../lib/text/closeup';
  import { CATCOL_CHOICES, CATCOL_GROUP } from '../../lib/text/catcolour';
  import { FULL, FULL_EXIT, FULL_TITLE, SITE_LAYER } from '../../lib/text/view';
  import { view } from '../../state/view.svelte';

  /* What the reader chooses about the globe: where the camera is (free, on the spacecraft, over the observer, close by the
     spacecraft, or looking out of it), how much of the track trails behind it, and what is drawn - the surface the planet wears, the Earth and the
     catalogue's dots, the footprint and the sky layers. The old page laid these over the globe as seven pieces at pixel
     positions that collided on a short screen; here they are two rows and one panel. Every id and data attribute is the old
     page's, so a script that finds them by those finds them here. */
  const cams = $derived([
    { value: 'free', label: 'Free' },
    { value: 'sat', label: 'Satellite' },
    { value: 'site', label: app.site.name, title: 'Hold the observer in the middle of the view', id: 'lbl-camsite' },
    { value: 'close', label: CLOSE_LABEL, title: CLOSE_TITLE },
    { value: 'pov', label: 'POV', title: 'point of view: ride the spacecraft, looking along its track' }
  ]);
  const trails = [
    { value: 'off', label: 'Off' }, { value: '1800000', label: '30 m' }, { value: 'orbit', label: '1 orbit' },
    { value: '21600000', label: '6 h' }, { value: 'all', label: '24 h' }
  ];
  let open = $state(false);

  const ECI = /\bECI\b/;
  const ECI_TITLE = 'Earth-centred inertial: axes fixed against the stars, x towards the First Point of Aries';
</script>

<div class="controls">
  <div class="row camseg">
    <span class="seglabel" id="camlabel">Camera</span>
    <Segmented options={cams} value={globe.mode} label="Camera" tone="space" size="sm" buttonClass="cam" dataAttr="mode"
               onchange={v => globe.setMode(v as CamMode)} />
  </div>
  <div class="row layerseg">
    <!-- the globe's view full screen (L78), where the browser can show an element so -->
    {#if view.canFull}
      <Button id="fullscreen" size="sm" aria-pressed={view.full} title={FULL_TITLE}
              onclick={e => view.toggleFull(e.currentTarget.closest('.viewport'))}><Icon name={view.full ? 'shrink' : 'expand'} size={16} /><span class="fslabel">{view.full ? FULL_EXIT : FULL}</span></Button>
    {/if}
    <Popover bind:open label="Scene layers" align="end" width={260} keepMounted boundary=".viewport">
      {#snippet trigger(p)}
        <Button id="layerstoggle" size="sm" {...p}>Layers</Button>
      {/snippet}
      <div id="layersMenu" class="layerpanel" role="group" aria-label="Scene layers">
        <p class="layerhead">Globe surface</p>
        {#each globe.surfaces as m (m.key)}
          <label><input type="radio" name="globesurf" value={m.key} checked={globe.surface === m.key}
                        onchangecapture={() => globe.setSurface(m.key)}> {m.label}</label>
        {/each}
        <p class="layernote" class:warn={globe.surfaceNote.warn} id="texnote">{globe.surfaceNote.text}</p>
        <div class="layerrule"></div>
        <label><input type="checkbox" id="o3earth2" checked={globe.layers.earth}
                      onchangecapture={e => globe.setLayer('earth', e.currentTarget.checked)}> Earth</label>
        <label><input type="checkbox" id="o3cloud" checked={globe.layers.catalogue}
                      onchangecapture={e => globe.setLayer('catalogue', e.currentTarget.checked)}> Catalogue</label>
        <!-- the catalogue's dots by class (L76), under the switch that shows them; the classes and their words are a chunk of their own -->
        <div class="sub" role="radiogroup" aria-label={CATCOL_GROUP}>
          {#each CATCOL_CHOICES as [k, l]}
            <label><input type="radio" name="catcolour" value={k} checked={globe.catColour === k}
                          onchangecapture={() => globe.setCatColour(k)}> {l}</label>
          {/each}
        </div>
        {#if globe.catNote}<p class="layernote sub" id="catnote">{globe.catNote}</p>{/if}
        <!-- the trail, in the panel since L80 (it was a row over the globe): the old page's buttons, ids and data attributes -->
        <div class="trailseg">
          <span class="layerlabel" id="traillabel">Trail</span>
          <Segmented options={trails} value={globe.trail} label="Trail" size="sm" buttonClass="trl" dataAttr="t"
                     onchange={v => globe.setTrail(v as TrailKey)} />
        </div>
        <!-- the observer's pin and its access circle (L79) -->
        <label><input type="checkbox" id="o3site" checked={globe.layers.site}
                      onchangecapture={e => globe.setLayer('site', e.currentTarget.checked)}> {SITE_LAYER}</label>
        <label><input type="checkbox" id="o3fov" data-scene="footprint" checked={globe.layers.footprint}
                      onchangecapture={e => globe.setLayer('footprint', e.currentTarget.checked)}> Access footprint</label>
        {#each globe.skyLayers as l (l.key)}
          <label><input type="checkbox" data-layer={l.key} checked={globe.layers[l.key as 'frame' | 'elements' | 'constellations']}
                        onchangecapture={e => globe.setLayer(l.key as 'frame' | 'elements' | 'constellations', e.currentTarget.checked)}>
            <span>{#if ECI.test(l.label)}{l.label.split('ECI')[0]}<abbr title={ECI_TITLE}>ECI</abbr>{l.label.split('ECI')[1]}{:else}{l.label}{/if}</span></label>
        {/each}
      </div>
    </Popover>
  </div>
</div>

<style>
  .controls { position: absolute; top: var(--space-3); right: var(--space-3); display: grid; justify-items: end; gap: var(--space-2); z-index: 2; }
  .row { display: flex; align-items: center; gap: var(--space-2); }
  .seglabel { font-family: var(--font-mono); font-size: var(--fs-0); letter-spacing: .13em; text-transform: uppercase; color: #8AA0AC; text-shadow: 0 0 6px #05090C; }
  /* the Layers button over the globe: the same dark glass as the segmented rows */
  .layerseg :global(#fullscreen) { gap: 6px; }
  .layerseg :global(.btn) { background: rgba(10, 16, 20, .72); border-color: rgba(180, 200, 212, .28); color: #DCE8EE; backdrop-filter: blur(6px); }
  .layerseg :global(.btn:hover:not(:disabled)) { background: rgba(180, 200, 212, .16); }
  /* the panel itself scrolls (Popover's boundary: the globe's box clips it, and it is sized to the room inside the box) */
  .layerpanel { display: flex; flex-direction: column; gap: 1px; }
  .layerpanel label { display: flex; align-items: center; gap: var(--space-2); padding: 6px var(--space-2); border-radius: var(--r-1); font-size: var(--fs-1); cursor: pointer; min-height: 30px; }
  @media (pointer: coarse) { .layerpanel label { min-height: var(--tap); } }
  .layerpanel label:hover { background: var(--hover); }
  .layerpanel input { accent-color: var(--contact); margin: 0; width: 14px; height: 14px; }
  .layerhead { margin: 2px 0 1px; padding: 0 var(--space-2); font-family: var(--font-mono); font-size: var(--fs-0); letter-spacing: .15em; text-transform: uppercase; color: var(--muted); }
  .layerrule { height: 1px; margin: 6px 4px 3px; background: var(--rule); }
  /* the label over the buttons, which share the panel's width (on a touch screen they are a finger wide, and beside the label they did not fit) */
  .trailseg { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 3px var(--space-2); }
  .trailseg :global(.seg) { width: 100%; }
  .trailseg :global(.seg button) { flex: 1 1 0; min-width: 0; padding-inline: 4px; }
  /* a finger: the five apart by 8 px, and from the switch below, the tap rule's exception (they are under 44 px wide in a phone's panel) */
  @media (pointer: coarse) { .trailseg :global(.seg) { gap: 8px; margin-bottom: 8px; } }   /* and 8 px from the switch under them */
  .layerlabel { font-size: var(--fs-1); }
  .layernote { margin: 1px var(--space-2) 2px; max-width: 230px; font-size: var(--fs-0); line-height: 1.45; color: var(--muted); }
  .layernote.warn { color: var(--warn); }
  /* the catalogue's colourings, set in under its switch (the box's width and the gap after it) */
  .sub { display: flex; flex-direction: column; gap: 1px; padding-left: 22px; }
  abbr { text-decoration: underline dotted; text-underline-offset: 2px; }
  /* a phone: the controls are a strip along the bottom of the globe (the clock keeps the top), the camera row across the width and
     the trail beside the Layers button; on a short screen the labels go, and the strip stays where it is */
  @media (max-width: 719px) {
    .controls { top: auto; bottom: calc(var(--space-2) + var(--tbar, 0px)); left: var(--space-2); right: var(--space-2); grid-template-columns: minmax(0, 1fr) auto; justify-items: stretch; }
    .camseg { grid-column: 1 / -1; }
    .row :global(.seg) { width: 100%; }
    .row :global(.seg button) { flex: 1 1 0; }
    .layerseg { justify-self: end; }
    .seglabel { display: none; }
    /* the full-screen button is its icon alone here, beside Layers, so the trail keeps its width; its words stay for a screen reader */
    .fslabel { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }
  /* the narrowest phones: five 44 px trail buttons and the Layers button are 3 px wider than the strip leaves them, so the strip takes the gutter back */
  @media (max-width: 359px) { .controls { left: var(--space-1); right: var(--space-1); } }

  @media (max-height: 520px) { .seglabel { display: none; } }
  /* a long place name must not push the POV button off the row on a narrow screen, nor the row onto the clock on a wider one (the observer's
     name may be 24 letters long; with the planner's drawer open App.svelte holds it tighter still) */
  :global(#lbl-camsite) { max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 719px) { :global(#lbl-camsite) { max-width: 7em; } }
</style>
