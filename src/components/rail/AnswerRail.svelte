<script lang="ts">
  import { app, PINNED } from '../../state/app.svelte';
  import { isCustom } from '../../lib/planner/custom';
  import { clock } from '../../state/clock.svelte';
  import { getEngine, MASK } from '../../state/engine';
  import { countdown } from '../../lib/text/countdown';
  import { briefNote, outOfBrief, reentryNote, totalSub } from '../../lib/text/notices';
  import { siteClock } from '../../lib/text/passfacts';
  import Icon from '../ui/Icon.svelte';
  import Rich from '../ui/Rich.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import PassList from './PassList.svelte';
  import PassDetails from './PassDetails.svelte';
  import ExportBar from './ExportBar.svelte';
  import SkyPlot from './SkyPlot.svelte';
  import OrbitGrid from './OrbitGrid.svelte';
  import SourceBlock from './SourceBlock.svelte';

  /* The answer: how long the spacecraft is visible from the observer, then when it next is, then the detail. The
     first number is the point of the page; everything under it is there to be checked. */
  const a = $derived(app.analysis);
  const ms = $derived(clock.tick.ms);
  /* "Elevation now" is the elevation at the clock's instant, not at the nearest stored sample: the old page read it off the globe's own label, propagated there */
  const cur = $derived(app.exactAt(ms));
  const c = $derived(siteClock(app.site));
  const cd = $derived(a ? countdown(a, ms, Date.now(), MASK, c, () => app.passAfterWindow()) : null);

  const mine = $derived(!!app.current && isCustom(app.current));
  const outside = $derived(!!app.current && outOfBrief(app.current.name, mine));
  const reentry = $derived(a ? reentryNote(a, getEngine().REENTRY_KM) : null);

  let tab = $state('passes');
</script>

<div class="rail">
  {#if a}
    <p class="notice bad" id="reentry" role="status" hidden={!reentry}><Icon name="alert" size={16} /> <span>{#if reentry}<Rich value={reentry} />{/if}</span></p>
    <p class="notice" id="briefnote" hidden={!outside}><Icon name="info" size={16} /> <span><Rich value={briefNote} /></span></p>
    <!-- Said beside the answer it qualifies, for an orbit the reader designed: the minutes below are the first thing read, and they are a
         prediction for an orbit that may not exist. Shown in place of the note above. -->
    <p class="notice" id="customnote" hidden={!mine}><Icon name="info" size={16} /> <span><b>Your orbit.</b> Designed here from elements you typed, not tracked by anyone. These passes are a prediction for an orbit that may not exist.</span></p>

    <section class="answer" aria-labelledby="lbl-vis">
      <p class="eyebrow" id="lbl-vis">Visible from {app.site.name} · {MASK}° mask</p>
      <p class="big" id="totalbig">{(a.totalS / 60).toFixed(1)}<span class="unit">{' min'}</span></p>
      <p class="sub" id="totalsub">{totalSub(a, app.site, PINNED)}</p>
      <p class="exact mono" id="totalexact">{a.totalS.toFixed(1)} s over {a.passes.length} {a.passes.length === 1 ? 'pass' : 'passes'}</p>
    </section>

    <section class="now" aria-label="Now">
      <div>
        <p class="eyebrow" id="lbl-elnow">Elevation at {app.site.name} now</p>
        <p class="mono val" class:hot={!!cur && cur.el >= MASK} id="o3el">{cur ? cur.el.toFixed(1) + '°' : '—'}</p>
      </div>
      <div>
        <p class="eyebrow" id="cdlabel">{cd?.label ?? 'Next pass'}</p>
        <p class="mono val" class:hot={!!cd?.live} id="cdvalue">{cd?.value ?? '—'}</p>
        <p class="mono when" id="cdwhen">{#if cd}<Rich value={cd.when} />{/if}</p>
      </div>
    </section>

    <Tabs tabs={[{ id: 'passes', label: 'Passes' }, { id: 'orbit', label: 'Orbit' }, { id: 'source', label: 'Source' }]}
          value={tab} label="Detail" keepMounted onchange={id => (tab = id)}>
      {#snippet children(id)}
        {#if id === 'passes'}
          <PassList />
          <ExportBar />
          <div class="sky"><SkyPlot /></div>
          <PassDetails />
        {:else if id === 'orbit'}
          <OrbitGrid />
        {:else}
          <SourceBlock />
        {/if}
      {/snippet}
    </Tabs>
  {:else if app.error}
    <p class="notice bad" role="alert"><Icon name="alert" size={16} /> {app.error}</p>
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
  .notice :global(svg) { margin-top: 2px; color: var(--warn); flex: none; }
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
  .exact { color: var(--ink2); font-size: var(--fs-0); }
  .now { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); padding: var(--space-4) 0; border-block: 1px solid var(--rule); }
  .val { margin: 2px 0 0; font-size: var(--fs-4); font-weight: 500; }
  .val.hot { color: var(--contact); }
  .when { margin: 0; color: var(--muted); font-size: var(--fs-0); }
  .when :global(span) { white-space: nowrap; }
  .sky { margin-top: var(--space-5); }
</style>
