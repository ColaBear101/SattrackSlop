<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { MASK } from '../../state/engine';
  import { passfilter } from '../../state/passfilter.svelte';
  import { tzLabelAt } from '../../lib/places';
  import { NO_FILTER, PEAKS, parseClock, type PassFilter, type PassHours } from '../../lib/analysis/pass-filter';
  import { clockText } from '../../lib/text/passfilter';
  import * as W from '../../lib/text/passfilter-panel';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';

  /* The pass list's filter (CHANGES-FROM-LEGACY.md, L56), inside the popover under the list's Filter button (PassFilterBar):
     a chunk of its own with its words, asked for at the first press. Every change is the reader's, and is kept at once
     (state/passfilter.svelte.ts); "Show every pass" forgets it. The span is read in the site's time, which the fields' names
     and the offset beside them say. A time typed with the span off turns it on: nobody types one to see nothing happen. */
  const f = $derived(passfilter.spec ?? NO_FILTER);
  const zone = $derived(tzLabelAt(app.site, app.analysis?.start.getTime() ?? Date.now()));
  const put = (g: Partial<PassFilter>) => passfilter.set({ ...f, ...g });
  const hours = (g: Partial<PassHours>) => put({ hours: { ...f.hours, ...g } });
  function time(e: Event, which: 'from' | 'to') {
    const m = parseClock((e.currentTarget as HTMLInputElement).value);
    if (m !== null) hours(which === 'from' ? { from: m, on: true } : { to: m, on: true });
  }
</script>

<div class="pf" id="passfilter">
  <p class="eyebrow">{W.PEAK_HEAD}</p>
  <Segmented label={W.PEAK_NAME} size="sm" dataAttr="peak" value={f.minPeak} onchange={v => put({ minPeak: +v })}
             options={PEAKS.map(p => ({ value: p, label: W.peakLabel(p) }))} />
  <label class="tick"><input type="checkbox" id="pf-eye" checked={f.eye} onchange={e => put({ eye: e.currentTarget.checked })}> {W.EYE_LABEL}</label>
  <p class="note">{W.EYE_NOTE}</p>
  <label class="tick"><input type="checkbox" id="pf-hours" checked={f.hours.on} onchange={e => hours({ on: e.currentTarget.checked })}> {W.HOURS_LABEL}</label>
  <div class="times">
    <input type="time" id="pf-from" step="60" value={clockText(f.hours.from)} aria-label={W.fromName(zone)} onchange={e => time(e, 'from')}>
    <span aria-hidden="true">{W.HOURS_AND}</span>
    <input type="time" id="pf-to" step="60" value={clockText(f.hours.to)} aria-label={W.toName(zone)} onchange={e => time(e, 'to')}>
    <span class="tz mono" aria-hidden="true">{zone}</span>
  </div>
  <label class="tick"><input type="checkbox" id="pf-out" checked={f.hours.out} onchange={e => hours({ out: e.currentTarget.checked })}> {W.OUT_LABEL}</label>
  <p class="note">{W.HOURS_NOTE}</p>
  <div><Button id="pf-reset" size="sm" onclick={() => passfilter.clear()}>{W.RESET_LABEL}</Button></div>
  <p class="note">{W.filterNote(MASK)}</p>
</div>

<style>
  .pf { display: grid; gap: var(--space-2); justify-items: start; }
  .pf > :global(.seg) { margin-bottom: var(--space-2); }
  .tick { display: flex; align-items: center; gap: var(--space-2); min-height: 30px; font-size: var(--fs-1); cursor: pointer; }
  .tick input { accent-color: var(--contact); margin: 0; width: 14px; height: 14px; flex: none; }
  .note { margin: 0 0 var(--space-2); color: var(--muted); font-size: var(--fs-0); line-height: 1.45; }
  .times { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font-size: var(--fs-1); }
  input[type='time'] {
    height: 34px; padding: 0 var(--space-2); border: 1px solid var(--rule); border-radius: var(--r-2);
    background: var(--sunk); color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-1);
  }
  input[type='time']:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  .tz { color: var(--muted); font-size: var(--fs-0); }
  @media (pointer: coarse) { .tick { min-height: var(--tap); } }
</style>
