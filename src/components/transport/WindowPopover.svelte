<script lang="ts">
  import { app, SPANS } from '../../state/app.svelte';
  import { localMinute } from '../../lib/text/fmt';
  import { tzLabel } from '../../lib/observer';
  import Popover from '../ui/Popover.svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Icon from '../ui/Icon.svelte';

  /* The analysis window: where it opens and how long it runs. It used to be nailed to "24 h from the element
     set's epoch"; now it is any span you place, defaulting to your own clock, because "when can I see it
     tonight" is the question people arrive with. The ids are the old page's (winStartIn, winPrevD, tpnow...). */
  let open = $state(false);
  const a = $derived(app.analysis);
  const tz = $derived(app.site.tz);
  const DAY = 86_400_000, H6 = 6 * 3_600_000;
  const spanLabel = (h: number) => (h >= 48 ? h / 24 + ' d' : h + ' h');

  /* the field is read and written in the observer's time, as its label says */
  const startLocal = $derived(a ? localMinute(a.start, tz).replace(' ', 'T') : '');
  let typed = $state('');
  $effect(() => { typed = startLocal; });

  function move(ms: number) { if (a) app.setWindowStart(a.start.getTime() + ms); }
  function commit() {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(typed);
    if (!m) return;
    app.setWindowStart(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - tz * 3_600_000);
  }

  /* how far the window sits from the set's epoch: a TLE is only good for a few days either side of it */
  const off = $derived(a ? (a.start.getTime() - a.E.epoch.getTime()) / DAY : 0);
  const far = $derived(Math.abs(off) > 3);
  const note = $derived(
    (Math.abs(off) < 0.05 ? 'window starts at the epoch' : (off > 0 ? '+' : '') + off.toFixed(1) + ' d from epoch') +
    (far ? ' — SGP4 drifts this far out' : '')
  );
</script>

<Popover bind:open label="Analysis window" align="end" width={344} keepMounted>
  {#snippet trigger(props)}
    <Button {...props} id="winOpen" size="sm" title="Where the analysis window opens, and how long it runs">
      <Icon name="clock" size={14} /> Window · {a ? spanLabel(a.hours) : ''}
    </Button>
  {/snippet}

  <div class="win">
    <p class="eyebrow">Window opens</p>
    <div class="start">
      <input type="datetime-local" id="winStartIn" step="60" bind:value={typed} onchange={commit}
             aria-label="Start of the analysis window, in the observer’s time ({tzLabel(tz)})">
      <span class="tz mono" id="winTz" aria-hidden="true">{tzLabel(tz)}</span>
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
    <p class="note mono" id="winnote" class:warn={far}>{note}</p>
  </div>
</Popover>

<style>
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
