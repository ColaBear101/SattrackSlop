<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { doppler } from '../../state/doppler.svelte';
  import { getEngine, getOptics } from '../../state/engine';
  import { dopRows, opticalRows } from '../../lib/analysis/doppler';
  import { passFacts, siteClock } from '../../lib/text/passfacts';
  import { EXPORT_NOT_LOADED, PASS_ICS, PASS_ICS_TITLE } from '../../lib/text/pass-ics';
  import type { Row } from '../../lib/text/rich';
  import Button from '../ui/Button.svelte';
  import Rich from '../ui/Rich.svelte';
  import DopplerLive from './DopplerLive.svelte';

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

  /* This pass alone, to a calendar (CHANGES-FROM-LEGACY.md, L57): the pass selected at the press, of the analysis on screen then. The work
     is a chunk of its own with the export writers (pass-ics.ts), fetched on the first press; one that does not arrive says so, as the full
     export does. What a press comes to is said beside the button for six seconds.
     One press at a time, as the AR view's Snap: a second tap while the chunks arrive or the share sheet is up would ask the browser for a
     second sheet, which it refuses, and a refused sheet is a download, so the reader would get the sheet and a stray file. The button is
     disabled until the press is done, and the focus, which a disabled button drops, comes back to it. */
  let said = $state('');
  let busy = $state(false);
  let sayT: ReturnType<typeof setTimeout> | undefined;
  async function toCalendar(e: MouseEvent) {
    const A = D, i = app.selPass;
    if (!A || busy) return;
    const btn = e.currentTarget as HTMLButtonElement, held = document.activeElement === btn;
    busy = true;
    try {
      let go: typeof import('./pass-ics')['passToCalendar'] | null = null;
      try { ({ passToCalendar: go } = await import('./pass-ics')); } catch { /* said below */ }
      said = go ? await go(A, i) : EXPORT_NOT_LOADED;
      clearTimeout(sayT); sayT = setTimeout(() => { said = ''; }, 6000);
    } finally {
      busy = false;
      if (held) {
        await tick();      // the button is enabled again only once Svelte has written busy to it
        if (btn.isConnected && !btn.disabled && (!document.activeElement || document.activeElement === document.body)) btn.focus();
      }
    }
  }
</script>

<dl id="skyfacts" class="facts">
  {#each rows as [k, v]}
    <div class="row"><dt class="k"><Rich value={k} /></dt><dd class="v"><Rich value={v} /></dd></div>
  {/each}
</dl>

{#if pass}
  <div id="passcal" class="passcal">
    <Button id="exp-pass" size="sm" title={PASS_ICS_TITLE} disabled={busy} onclick={toCalendar}>{PASS_ICS}</Button>
    <span id="exp-passhint" class="said" role="status">{said}</span>
  </div>
{/if}

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

<DopplerLive />

<style>
  .facts { margin: 0; display: grid; }
  .row { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--rule); font-size: var(--fs-1); }
  dt { color: var(--muted); }
  dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .passcal { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
  .said { color: var(--muted); font-size: var(--fs-1); }
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
