<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { prefs, type StageTab } from '../../state/prefs.svelte';
  import { MASK } from '../../state/engine';
  import { compass } from '../../lib/text/fmt';
  import { latStr, lonStr } from '../../lib/observer';
  import Tabs from '../ui/Tabs.svelte';
  import Icon from '../ui/Icon.svelte';
  import GroundTrackMap from './GroundTrackMap.svelte';

  /* The stage: the spacecraft's ground track now, and (milestone M6) the 3D globe on the other tab. The readouts
     under the map are the spacecraft's position and the look from the observer at the instant on the clock. */
  const cur = $derived(app.sampleAt(clock.tick.ms));
  const items = $derived(!cur ? [] : [
    ['Latitude', latStr(cur.lat)],
    ['Longitude', lonStr(cur.lon)],
    ['Altitude', cur.alt.toFixed(1) + ' km'],
    ['Elevation', cur.el.toFixed(2) + '°'],
    ['Azimuth', cur.az.toFixed(1) + '° ' + compass(cur.az)],
    ['Slant range', cur.rng.toFixed(0) + ' km']
  ] as [string, string][]);
</script>

<section class="stage" aria-label="Spacecraft position">
  <Tabs tabs={[{ id: 'map', label: 'Map' }, { id: 'globe', label: 'Globe' }]} value={prefs.tab} label="View"
        variant="pill" onchange={id => prefs.setTab(id as StageTab)}>
    {#snippet children(id)}
      {#if id === 'map'}
        <GroundTrackMap />
        <ul class="legend" aria-label="Key">
          <li><i class="k track"></i> Ground track</li>
          <li><i class="k contact"></i> In view above {MASK}°</li>
          <li><i class="k observer"></i> {app.site.name} and its reach</li>
          <li><i class="k fov"></i> Spacecraft footprint</li>
        </ul>
        <dl class="readouts">
          {#each items as [k, v] (k)}<div><dt class="eyebrow">{k}</dt><dd class="mono">{v}</dd></div>{/each}
        </dl>
      {:else}
        <div class="globe" id="globe-placeholder">
          <Icon name="globe" size={40} />
          <p><b>The 3D globe is rebuilt in a later milestone.</b></p>
          <p>It keeps the camera modes (free, spacecraft, site, point of view), trails, the day and night split and the sky layers.
             Until then the map shows the same track.</p>
        </div>
      {/if}
    {/snippet}
  </Tabs>
</section>

<style>
  .stage { padding: var(--space-4); min-width: 0; }
  /* wide: the stage sits between the bar and the transport, so the map is as large as leaves room for its legend
     and readouts (about 250 px of them, the tabs and the padding) without the stage having to scroll */
  @media (min-width: 1100px) { .stage { --map-max: max(420px, calc((100dvh - var(--bar-h) - var(--transport-h) - 250px) * 2)); } }
  .legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); list-style: none; margin: var(--space-3) 0; padding: 0; font-size: var(--fs-1); color: var(--ink2); }
  .k { display: inline-block; width: 18px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: var(--space-2); }
  .k.track { background: var(--track); } .k.contact { background: var(--contact); height: 4px; }
  .k.observer { background: transparent; border-top: 2px dashed var(--observer); height: 0; }
  .k.fov { background: transparent; border-top: 2px solid var(--fov); height: 0; }
  .readouts {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--space-3) var(--space-4); margin: 0;
    padding: var(--space-4); border: 1px solid var(--rule); border-radius: var(--r-3); background: var(--panel);
  }
  .readouts dd { margin: 2px 0 0; font-size: var(--fs-2); }
  @media (max-width: 719px) {
    .stage { padding: var(--space-3); }
    .readouts { grid-template-columns: repeat(3, minmax(0, 1fr)); padding: var(--space-3); gap: var(--space-3) var(--space-2); }
    .readouts .eyebrow { letter-spacing: .06em; }
  }
  .globe {
    display: grid; place-content: center; justify-items: center; gap: var(--space-3); text-align: center;
    min-height: 320px; padding: var(--space-6); border-radius: var(--r-3); background: var(--void); color: #AEBFC8;
  }
  .globe p { max-width: 42ch; margin: 0; font-size: var(--fs-1); }
  .globe b { color: #E8EFF2; }
</style>
