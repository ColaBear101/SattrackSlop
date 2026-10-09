<script lang="ts">
  import { app, SPANS } from '../../state/app.svelte';
  import { isCustom } from '../../lib/planner/custom';
  import { fromSiteInput, toSiteInput, tzLabelAt } from '../../lib/places';
  import Popover from '../ui/Popover.svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Icon from '../ui/Icon.svelte';

  /* The analysis window: where it opens and how long it runs. It used to be nailed to "24 h from the element
     set's epoch"; now it is any span you place, defaulting to your own clock, because "when can I see it
     tonight" is the question people arrive with. The ids are the old page's (winStartIn, winPrevD, tpnow...). */
  let open = $state(false);
  const a = $derived(app.analysis);
  const DAY = 86_400_000, H6 = 6 * 3_600_000;
  const spanLabel = (h: number) => (h >= 48 ? h / 24 + ' d' : h + ' h');

  /* the field is read and written in the observer's time, as its label says */
  const startLocal = $derived(a ? toSiteInput(app.site, a.start.getTime()) : '');
  const zoneLabel = $derived(a ? tzLabelAt(app.site, a.start.getTime()) : '');
  /* The field shows the window's start unless it has the focus (someone is typing in it): the old paintWindow. It is
     read from the element when it changes, not kept in a state of its own, so whatever sets it is what is read. */
  let startEl: HTMLInputElement | undefined = $state();
  $effect(() => { if (startEl && document.activeElement !== startEl) startEl.value = startLocal; });

  function move(ms: number) { if (a) app.setWindowStart(a.start.getTime() + ms); }
  function commit(e: Event) {
    const t = fromSiteInput(app.site, (e.currentTarget as HTMLInputElement).value);   // the observer's time, as labelled
    if (isFinite(t)) app.setWindowStart(t);
  }

  /* how far the window sits from the set's epoch: a TLE is only good for a few days either side of it */
  const off = $derived(a ? (a.start.getTime() - a.E.epoch.getTime()) / DAY : 0);
  const far = $derived(Math.abs(off) > 3);
  /* "SGP4 drifts this far out" is about real element sets, which the true orbit leaves as perturbations the model lacks pile up. A designed
     orbit has no truth behind it: the model IS the orbit, so far from the epoch it is not wrong, only far from the epoch, where the mean
     anomaly M is defined. Said plainly, and never as a warning. */
  const mine = $derived(!!a && isCustom(a.entry));
  const note = $derived(
    (Math.abs(off) < 0.05 ? 'window starts at the epoch' : (off > 0 ? '+' : '') + off.toFixed(1) + ' d from epoch') +
    (far ? (mine ? ' — M belongs to the epoch' : ' — SGP4 drifts this far out') : '')
  );
</script>

<Popover bind:open label="Analysis window" align="end" width={344} keepMounted>
  {#snippet trigger(props)}
    <Button {...props} id="winOpen" size="sm" title="Where the analysis window opens, and how long it runs">
      <Icon name="clock" size={14} /> Window · {a ? spanLabel(a.hours) : ''}
      <!-- the old page's window bar said, all the time, when the window was far from the element set's epoch ("+23.2 d from epoch - SGP4 drifts this far out");
           the sentence is in the popover now, so the button carries the warning where it can be seen without opening it -->
      {#if far && !mine}
        <span class="drift" title="The window is {off.toFixed(1)} d from the element set's epoch: SGP4 drifts this far out, so these pass times are extrapolated"><Icon name="alert" size={14} /><span class="driftw">{(off > 0 ? '+' : '') + off.toFixed(0)} d from epoch</span></span>
      {/if}
    </Button>
  {/snippet}

  <div class="win">
    <p class="eyebrow">Window opens</p>
    <div class="start">
      <input type="datetime-local" id="winStartIn" step="60" bind:this={startEl} onchangecapture={commit}
             aria-label="Start of the analysis window, in the observer’s time ({zoneLabel})">
      <span class="tz mono" id="winTz" aria-hidden="true" title="The observer’s local time, which the window start is read and written in">{zoneLabel}</span>
    </div>
    <div class="row">
      <Button id="winPrevD" size="sm" aria-label="Back one day" onclick={() => move(-DAY)}>−1 d</Button>
      <Button id="winPrevH" size="sm" aria-label="Back six hours" onclick={() => move(-H6)}>−6 h</Button>
      <Button id="winNextH" size="sm" aria-label="Forward six hours" onclick={() => move(H6)}>+6 h</Button>
      <Button id="winNextD" size="sm" aria-label="Forward one day" onclick={() => move(DAY)}>+1 d</Button>
    </div>
    <div class="row">
      <Button id="tpnow" size="sm" onclick={() => app.setWindowStart(Date.now())}>Now</Button>
      <Button id="tpepoch" size="sm" title="Open the window at the element set's epoch" onclick={() => { if (a) app.setWindowStart(a.E.epoch.getTime()); }}>Epoch</Button>
    </div>
    <p class="eyebrow">Span</p>
    <Segmented label="Window length" size="sm" dataAttr="h" value={a?.hours ?? 24} onchange={v => app.setSpan(+v)}
               options={SPANS.map(h => ({ value: h, label: spanLabel(h) }))} />
    <p class="note mono" id="winnote" class:warn={far && !mine}>{note}</p>
  </div>
</Popover>

<style>
  .drift { display: inline-flex; align-items: center; gap: 4px; color: var(--warn); }
  @media (max-width: 719px) { .driftw { display: none; } }
  .win { display: grid; gap: var(--space-3); }
  .start { display: flex; gap: var(--space-2); align-items: center; }
  .row { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
  input[type='datetime-local'] {
    flex: 1 1 auto; min-width: 0; height: 34px; padding: 0 var(--space-2); border: 1px solid var(--rule);
    border-radius: var(--r-2); background: var(--sunk); color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-1);
  }
  input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  .tz { color: var(--muted); font-size: var(--fs-0); }
  .note { color: var(--muted); font-size: var(--fs-0); }
  .note.warn { color: var(--warn); }
</style>
