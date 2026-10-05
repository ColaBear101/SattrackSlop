<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { MASK } from '../../state/engine';
  import { hhmmss, hms, localMinute, minSec } from '../../lib/text/fmt';
  import { nextPass } from '../../lib/analysis/next-pass';
  import { tzLabel } from '../../lib/observer';
  import Icon from '../ui/Icon.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import PassList from './PassList.svelte';
  import SkyPlot from './SkyPlot.svelte';
  import OrbitGrid from './OrbitGrid.svelte';
  import SourceBlock from './SourceBlock.svelte';

  /* The answer: how long the spacecraft is visible from the observer, then when it next is, then the detail. The
     first number is the point of the page; everything under it is there to be checked. */
  const a = $derived(app.analysis);
  const ms = $derived(clock.tick.ms);
  const cur = $derived(app.sampleAt(ms));
  const share = $derived(a ? 100 * a.totalS / (a.hours * 3600) : 0);

  const next = $derived(nextPass(a, ms));

  const OUT_OF_BRIEF = /^KNACKSAT[- ]?2\b/i;
  const outside = $derived(!!app.entry && OUT_OF_BRIEF.test(app.entry.name));
  const reentry = $derived(a?.reentry ?? null);

  let tab = $state('passes');
</script>

<div class="rail">
  {#if a}
    {#if reentry}
      <p class="notice bad" role="status"><Icon name="alert" size={16} /> This object is re-entering: SGP4 takes it below {a.track.body.reentryAltKm ?? 120} km within the window. The passes below are not a prediction you can rely on.</p>
    {/if}
    {#if outside}
      <p class="notice" id="briefnote"><Icon name="info" size={16} /> <span><b>Outside the brief.</b> KNACKSAT-2, the default, is not in CelesTrak's Earth Resources group, which the assignment asks for.</span></p>
    {/if}

    <section class="answer" aria-labelledby="lbl-vis">
      <p class="eyebrow" id="lbl-vis">Visible from {app.site.name} · {MASK}° mask</p>
      <p class="big" id="totalbig">{(a.totalS / 60).toFixed(1)}<span class="unit">{' min'}</span></p>
      <p class="sub" id="totalsub">
        <span class="mono">{a.totalS.toFixed(1)} s</span> over {a.passes.length} {a.passes.length === 1 ? 'pass' : 'passes'} in {a.hours} h,
        {minSec(a.totalS)} from {localMinute(a.start, app.site.tz)} {tzLabel(app.site.tz)} · {share.toFixed(2)}% of the window
      </p>
    </section>

    <section class="now" aria-label="Now">
      <div>
        <p class="eyebrow">Elevation at {app.site.name} now</p>
        <p class="mono val" class:hot={!!cur && cur.el >= MASK} id="o3el">{cur ? cur.el.toFixed(1) + '°' : '—'}</p>
      </div>
      <div>
        <p class="eyebrow">{next?.kind === 'now' ? 'In view, sets in' : 'Next pass in'}</p>
        <p class="mono val" id="cdvalue">{next && next.kind !== 'none' ? hhmmss(next.ms) : '—'}</p>
        <p class="mono when" id="cdwhen">{#if next?.kind === 'next'}<span>AOS {hms(next.p.aos)}Z</span> <span>max {next.p.maxEl.toFixed(1)}°</span>{:else if next?.kind === 'none'}none in this window{/if}</p>
      </div>
    </section>

    <Tabs tabs={[{ id: 'passes', label: 'Passes' }, { id: 'orbit', label: 'Orbit' }, { id: 'source', label: 'Source' }]}
          value={tab} label="Detail" onchange={id => (tab = id)}>
      {#snippet children(id)}
        {#if id === 'passes'}
          <PassList />
          <div class="sky"><SkyPlot /></div>
        {:else if id === 'orbit'}
          <OrbitGrid />
        {:else}
          <SourceBlock />
        {/if}
      {/snippet}
    </Tabs>
  {:else if app.error}
    <p class="notice bad" role="alert" id="loadnote"><Icon name="alert" size={16} /> {app.error}</p>
  {:else}
    <p class="notice" role="status">Loading the catalogue…</p>
  {/if}
</div>

<style>
  .rail { display: grid; gap: var(--space-5); align-content: start; }
  .notice {
    display: flex; gap: var(--space-2); align-items: flex-start; padding: var(--space-3); border-radius: var(--r-2);
    border: 1px solid var(--rule); border-left: 3px solid var(--warn); background: var(--sunk); font-size: var(--fs-1); color: var(--ink2);
  }
  .notice :global(svg) { margin-top: 2px; color: var(--warn); }
  .notice.bad { border-left-color: var(--bad); }
  .notice.bad :global(svg) { color: var(--bad); }
  .answer { display: grid; gap: var(--space-1); }
  /* the one big number: Archivo with tabular figures, as the old page set it, so the digits do not jitter as it changes */
  .big {
    margin: 0; font-family: var(--font-head); font-variant-numeric: tabular-nums; font-size: clamp(34px, 4.4vw, var(--fs-6));
    font-weight: 700; line-height: 1; letter-spacing: -0.035em; color: var(--contact);
  }
  .unit { font-size: var(--fs-4); font-weight: 600; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: var(--fs-1); }
  .now { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); padding: var(--space-4) 0; border-block: 1px solid var(--rule); }
  .val { margin: 2px 0 0; font-size: var(--fs-4); font-weight: 500; }
  .val.hot { color: var(--contact); }
  .when { margin: 0; color: var(--muted); font-size: var(--fs-0); }
  .when span { white-space: nowrap; }
  .sky { margin-top: var(--space-5); }
</style>
