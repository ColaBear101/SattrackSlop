<script lang="ts">
  import meta from '../../../data/catalogue.meta.json';
  import { app, PINNED } from '../../state/app.svelte';
  import { live } from '../../state/live.svelte';
  import { wall } from '../../state/wall.svelte';
  import { ages } from '../../lib/text/provenance';
  import Rich from '../ui/Rich.svelte';

  /* Where the element set came from, said without implying it is fresher than it is: the lines themselves, then the
     last check against the live sources (or the reason there was none), then how old the set is and how old the
     embedded snapshot is. The snapshot is the page's own; a live set, where one was taken, replaces it on screen. */
  const built = new Date(meta.fetched);
  const entry = $derived(app.entry);
  const E = $derived(app.analysis?.E);
  const A = $derived(entry && E ? ages({
    custom: !!(entry as { custom?: boolean }).custom, prov: live.provOf(entry.satnum), embedded: app.isEmbedded(entry),
    now: wall.now, epoch: E.epoch, name: entry.name, satnum: entry.satnum, fetched: built, source: meta.source, pinned: PINNED
  }) : null);
</script>

{#if entry && A}
  <!-- the name is bold, the lines are text: nothing here is ever markup, whatever a source sent back -->
  <pre class="tle mono" id="tleraw"><b>{entry.name}</b>
{entry.l1}
{entry.l2}</pre>
  <p id="tlemeta" class="prov meta"><span class="prov-{A.state}"><Rich value={A.line} /></span><Rich value={A.metaRest} /></p>
  <p id="railprov" class="prov rail">
    <Rich value={A.railHead} /><span class="prov-{A.state}">{A.linePlain}</span><Rich value={A.railTail} />
  </p>
{/if}

<style>
  .tle { margin: 0 0 var(--space-3); padding: var(--space-3); overflow-x: auto; border: 1px solid var(--rule); border-radius: var(--r-2); background: var(--sunk); font-size: var(--fs-0); line-height: 1.5; }
  .prov { color: var(--muted); font-size: var(--fs-1); margin: 0 0 var(--space-3); }
  .prov :global(b) { font-weight: 500; color: var(--ink2); }
  .prov-live { color: var(--good); }
  .prov-gone { color: var(--bad); }
  .prov-custom { color: var(--observer); }
  .prov-snap, .prov-checking { color: var(--ink2); }
</style>
