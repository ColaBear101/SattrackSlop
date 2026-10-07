<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { prefs, type StageTab } from '../../state/prefs.svelte';
  import { MASK } from '../../state/engine';
  import { compass } from '../../lib/text/fmt';
  import { latStr, lonStr } from '../../lib/observer';
  import { tzLabelAt } from '../../lib/places';
  import Tabs from '../ui/Tabs.svelte';
  import Button from '../ui/Button.svelte';
  import { ar } from '../ar/session.svelte';
  import GroundTrackMap from './GroundTrackMap.svelte';
  import Globe from './Globe.svelte';

  /* The stage: the 3D globe, and the flat map of the ground track beside it as a tab. Both stay in the page, the one not
     chosen hidden, so the globe keeps its place and the map's key and readouts are there to be read. The readouts under the map
     are the spacecraft's position and the look from the observer at the instant on the clock. */
  const cur = $derived(app.sampleAt(clock.tick.ms));
  const nm = $derived(app.site.name);
  const pos = $derived(latStr(app.site.lat) + ' ' + lonStr(app.site.lon));
  /* [id of the value, id of the label, label, value] - the ids are the old page's */
  const items = $derived(!cur ? [] : [
    ['r-lat', '', 'Latitude', latStr(cur.lat)],
    ['r-lon', '', 'Longitude', lonStr(cur.lon)],
    ['r-alt', '', 'Altitude', cur.alt.toFixed(1) + ' km'],
    ['r-el', 'lbl-roel', 'Elevation @ ' + nm, cur.el.toFixed(2) + '°'],
    ['r-az', 'lbl-roaz', 'Azimuth @ ' + nm, cur.az.toFixed(1) + '° ' + compass(cur.az)],
    ['r-rng', '', 'Slant range', cur.rng.toFixed(0) + ' km']
  ] as [string, string, string, string][]);
</script>

<section class="stage" aria-label="Spacecraft position">
  <!-- The sky through the phone's camera: offered where the primary pointer is a finger, once the view is up (it is brought in before it is
       offered, never on the tap, so the tap can ask for the camera and the motion sensors itself). It sits in the row of the stage's tabs,
       so it is there on the map as well, and where there is no WebGL. The node is always in the page, hidden where it is not offered. -->
  <div class="ar-slot">
    <Button id="arbtn" size="sm" hidden={!ar.offered} aria-haspopup="dialog" aria-controls="arview" aria-label="AR: the sky through the camera"
            onclick={() => ar.open()}><abbr title="augmented reality: the sky drawn over this phone's camera, where it points">AR</abbr></Button>
  </div>
  <Tabs tabs={[{ id: 'globe', label: 'Globe' }, { id: 'map', label: 'Map' }]} value={prefs.tab} label="View"
        variant="pill" keepMounted onchange={id => prefs.setTab(id as StageTab)}>
    {#snippet children(id)}
      {#if id === 'map'}
        <GroundTrackMap />
        <ul class="legend" aria-label="Key">
          <li><i class="k track"></i> Sub-satellite track</li>
          <li><i class="k contact"></i> <span id="lbl-inview">In view from {nm} (el ≥ {MASK}°)</span></li>
          <li><i class="k dot"></i> <span id="lbl-sitepos">{nm} {pos}</span></li>
          <li><i class="k observer"></i> <span id="lbl-sitering">{nm} {MASK}° access circle</span></li>
          <li><i class="k fov"></i> Spacecraft footprint (ground above {MASK}°)</li>
          <li><i class="k night"></i> Sunlit / night side at the shown instant</li>
        </ul>
        <dl class="readouts">
          {#each items as [id, lid, k, v] (id)}<div><dt class="eyebrow" id={lid || undefined}>{k}</dt><dd class="mono" class:hot={id === 'r-el' && !!cur && cur.el >= MASK} {id}>{v}</dd></div>{/each}
        </dl>
      {:else}
        <Globe />
      {/if}
    {/snippet}
  </Tabs>
</section>

<style>
  .stage { position: relative; padding: var(--space-4); min-width: 0; }
  .ar-slot { position: absolute; top: var(--space-4); right: var(--space-4); z-index: 3; }
  .ar-slot :global(abbr) { text-decoration: none; cursor: inherit; }
  .ar-slot :global(.btn[hidden]) { display: none; }
  /* wide: the stage sits between the bar and the transport, so the map is as large as leaves room for its legend
     and readouts (about 250 px of them, the tabs and the padding) without the stage having to scroll */
  @media (min-width: 1100px) { .stage { --map-max: max(420px, calc((100dvh - var(--bar-h) - var(--transport-h) - 250px) * 2)); } }
  .legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); list-style: none; margin: var(--space-3) 0; padding: 0; font-size: var(--fs-1); color: var(--ink2); }
  .k { display: inline-block; width: 18px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: var(--space-2); }
  .k.track { background: var(--track); } .k.contact { background: var(--contact); height: 4px; }
  .k.observer { background: transparent; border-top: 2px dashed var(--observer); height: 0; }
  .k.fov { background: transparent; border-top: 2px solid var(--fov); height: 0; }
  .k.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--observer); }
  .k.night { width: 14px; height: 10px; border-radius: 2px; background: linear-gradient(90deg, var(--swday) 50%, var(--swnight) 50%); border: 1px solid var(--rule); }
  .readouts dd.hot { color: var(--contact); }
  .readouts {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--space-3) var(--space-4); margin: 0;
    padding: var(--space-4); border: 1px solid var(--rule); border-radius: var(--r-3); background: var(--panel);
  }
  .readouts dd { margin: 2px 0 0; font-size: var(--fs-2); }
  @media (max-width: 719px) {
    .stage { padding: var(--space-3); }
    .ar-slot { top: var(--space-3); right: var(--space-3); }
    .readouts { grid-template-columns: repeat(3, minmax(0, 1fr)); padding: var(--space-3); gap: var(--space-3) var(--space-2); }
    .readouts .eyebrow { letter-spacing: .06em; }
  }
</style>
