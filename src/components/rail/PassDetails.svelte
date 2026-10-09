<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { doppler } from '../../state/doppler.svelte';
  import { getEngine, getOptics } from '../../state/engine';
  import { dopRows, opticalRows } from '../../lib/analysis/doppler';
  import { passFacts, siteClock } from '../../lib/text/passfacts';
  import type { Row } from '../../lib/text/rich';
  import Rich from '../ui/Rich.svelte';

  /* The facts about the selected pass, under its sky plot: when it rises, peaks and sets, how long, whether it can be
     seen with the eye, and the Doppler shift at the downlink you have tuned to. The frequency is the one thing this
     page cannot derive: it comes from the baked SatNOGS table, which covers about half the catalogue, and the panel
     says there is none rather than offering a plausible default to tune to. The box stays editable either way: a
     station knows its own bird better than a database does. */
  const D = $derived(app.analysis);
  const pass = $derived(D?.passes[app.selPass] ?? null);
  const c = $derived(siteClock(app.site));

  /* choose the default downlink once the spacecraft is known and the table has arrived (never on a repaint) */
  $effect(() => { doppler.reset(app.entry); });

  const list = $derived(doppler.list(app.entry));
  const rows = $derived.by((): Row[] => {
    if (!D) return [];
    if (!pass) return [['Status', 'no access']];
    const optics = getOptics();
    const extra = opticalRows(optics.passOptical(D.track, pass), optics.NAKED_EYE_MAG)
      .concat(dopRows(pass, doppler.hz, D.track, getEngine()));
    return passFacts(pass, app.selPass, D.passes.length, c, extra);
  });

  const mhz = $derived(doppler.hz === null ? '' : (doppler.hz / 1e6).toFixed(3));
  const inList = $derived(list.some(t => t.hz === doppler.hz));

  /* The dropdown follows the box, whatever was chosen last: an option's `selected` is set only when its own expression changes, so after
     "Custom…" and then a listed downlink, or a typed frequency, the control would say one thing and the numbers another. Where two options
     carry the tuned frequency the last is the one shown, as it always was. */
  let sel: HTMLSelectElement | undefined = $state();
  $effect(() => {
    if (!sel) return;
    const i = list.map(t => t.hz).lastIndexOf(doppler.hz as number);
    sel.selectedIndex = i >= 0 ? i : list.length;
  });

  function pick(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v === 'c') return;
    doppler.setHz(+v);
  }
  function typed(e: Event) {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    doppler.setHz(isFinite(v) && v > 0 ? v * 1e6 : null);
  }
</script>

<dl id="skyfacts" class="facts">
  {#each rows as [k, v]}
    <div class="row"><dt class="k"><Rich value={k} /></dt><dd class="v"><Rich value={v} /></dd></div>
  {/each}
</dl>

<div id="dopbar" class="dopbar">
  {#if list.length}
    <!-- Not keyed, and each option says for itself whether it is the one on show: the table lists a frequency once per mode
         (TEN-KOH has two on 437.390 MHz), so the frequency is not an identity, and where two options carry the tuned one the
         last is the one selected, as it always was. -->
    <select id="dopsel" aria-label="Downlink" bind:this={sel} onchangecapture={pick}>
      {#each list as t}
        <option value={String(t.hz)} selected={t.hz === doppler.hz}>{(t.hz / 1e6).toFixed(3)} MHz{t.mode ? '  ' + t.mode : ''}{t.baud ? '  ' + t.baud + 'bd' : ''}</option>
      {/each}
      <option value="c" selected={!inList}>Custom…</option>
    </select>
  {:else}
    <span class="none">no published downlink — enter one</span>
  {/if}
  <input id="dopfreq" type="number" step="0.001" min="0.1" max="60000" value={mhz} aria-label="Downlink frequency in MHz" onchangecapture={typed}>
  <span class="u">MHz</span>
</div>

<style>
  .facts { margin: 0; display: grid; }
  .row { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--rule); font-size: var(--fs-1); }
  dt { color: var(--muted); }
  dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .dopbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); font-size: var(--fs-1); }
  .none { color: var(--muted); }
  select, input {
    height: 32px; padding: 0 var(--space-2); border: 1px solid var(--rule); border-radius: var(--r-2); background: var(--sunk);
    color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-1);
  }
  input { width: 8.5rem; }
  select:focus, input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  .u { color: var(--muted); }
  @media (pointer: coarse) { select, input { height: var(--tap); } }
</style>
