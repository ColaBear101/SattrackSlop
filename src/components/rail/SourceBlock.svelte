<script lang="ts">
  import meta from '../../../data/catalogue.meta.json';
  import { app, PINNED } from '../../state/app.svelte';
  import { live } from '../../state/live.svelte';
  import { wall } from '../../state/wall.svelte';
  import { ages } from '../../lib/text/provenance';
  import { CUSTOM_SRCLINE, isCustom } from '../../lib/planner/custom';
  import Rich from '../ui/Rich.svelte';
  import Button from '../ui/Button.svelte';

  /* Where the element set came from, said without implying it is fresher than it is: the lines themselves, then the
     last check against the live sources (or the reason there was none), then how old the set is and how old the
     embedded snapshot is. The snapshot is the page's own; a live set, where one was taken, replaces it on screen. */
  const built = new Date(meta.fetched);
  /* a snapshot, new on every load: an orbit the reader designed is edited in place, and a view that read its lines off an object whose
     identity did not change would never hear of it */
  const entry = $derived.by(() => {
    void app.rev;
    const e = app.entry;
    return e ? { name: e.name, l1: e.l1, l2: e.l2, satnum: e.satnum, custom: isCustom(e) } : null;
  });
  const E = $derived(app.analysis?.E);
  const A = $derived(entry && E ? ages({
    custom: entry.custom, prov: live.provOf(entry.satnum), embedded: app.isEmbedded(entry),
    now: wall.now, epoch: E.epoch, name: entry.name, satnum: entry.satnum, fetched: built, source: meta.source, pinned: PINNED
  }) : null);
</script>

{#if entry && A}
  <!-- static text for a catalogue spacecraft; for an orbit the reader designed it says so, and the lines below are not a real element set -->
  <p class="eyebrow" id="srcline">{entry.custom ? CUSTOM_SRCLINE : 'SatNOGS DB · Space-Track · CelesTrak'}</p>
  <!-- the name is bold, the lines are text: nothing here is ever markup, whatever a source sent back -->
  <pre class="tle mono" id="tleraw"><b>{entry.name}</b>
{entry.l1}
{entry.l2}</pre>
  <p id="tlemeta" class="prov meta"><span class="prov-{A.state}"><Rich value={A.line} /></span><Rich value={A.metaRest} /></p>
  <p id="railprov" class="prov rail">
    <Rich value={A.railHead} /><span class="prov-{A.state}">{A.linePlain}</span><Rich value={A.railTail} />
  </p>
  <!-- For an orbit the reader designed: its two lines are real and checksum-valid, so they paste into other tools. The planner's controller wires
       the two buttons; what a press says is written next to them, because the planner may be shut and then its own status line cannot be seen. -->
  <div class="tle-actions" id="tleactions" hidden={!entry.custom}>
    <Button id="tle-edit" size="sm">Edit in planner</Button>
    <Button id="tle-copy" size="sm">Copy as TLE</Button>
    <span class="tle-said" id="tle-said"></span>
  </div>
{/if}

<style>
  .tle { margin: 0 0 var(--space-3); padding: var(--space-3); overflow-x: auto; border: 1px solid var(--rule); border-radius: var(--r-2); background: var(--sunk); font-size: var(--fs-0); line-height: 1.5; }
  .prov { color: var(--muted); font-size: var(--fs-1); margin: 0 0 var(--space-3); }
  .prov :global(b) { font-weight: 500; color: var(--ink2); }
  .prov-live { color: var(--good); }
  .prov-gone { color: var(--bad); }
  .prov-custom { color: var(--observer); }
  #srcline { margin: 0 0 var(--space-2); }
  .tle-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-1); }
  .tle-actions[hidden] { display: none; }
  .tle-said { font-family: var(--font-mono); font-size: var(--fs-0); color: var(--ink2); }
  .prov-snap, .prov-checking { color: var(--ink2); }
</style>
