<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { doppler } from '../../state/doppler.svelte';
  import { live } from '../../state/live.svelte';
  import { getEngine, getOptics, MASK } from '../../state/engine';
  import { tleSourceText } from '../../lib/export/source';
  import type { ExportFile } from '../../lib/export';
  import Button from '../ui/Button.svelte';

  /* Taking the answer away with you. Two formats because they answer different questions. The CSV is the whole pass
     table at full precision, for anything that wants to compute with it. The calendar is for turning up: one event per
     pass, titled with the spacecraft and its peak elevation, so a phone says "KNACKSAT-2, 68 deg" ten minutes before
     AOS rather than nothing at all.

     Both are built here and handed over as a Blob: there is no server to ask. The writers are their own chunk,
     fetched on the first click. An exported pass outlives the page that computed it - once it is a row in someone's
     spreadsheet or an alarm on their phone, the re-entry warning is no longer beside it - so the passes of an object
     SGP4 has below the entry interface do not leave the page. */
  let hint = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const say = (msg: string) => { hint = msg; clearTimeout(timer); timer = setTimeout(() => { hint = ''; }, 6000); };

  function download(text: string, name: string, mime: string) {
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);       // revoking immediately can beat the download in some browsers
  }

  function cached(satnum: string) {
    try { return JSON.parse(localStorage.getItem('tle:' + satnum) || 'null'); } catch { return null; }
  }

  async function go(kind: 'csv' | 'ics') {
    const D = app.analysis, entry = app.entry;
    if (!D || !entry || !D.passes.length) { say('No passes in this window to export.'); return; }
    if (D.reentry) {
      say('Not exported — SGP4 takes ' + entry.name + ' below the ' + getEngine().REENTRY_KM + ' km entry interface, so these passes will not happen.');
      return;
    }
    const { buildExports } = await import('../../lib/export');
    const x = buildExports({
      D, OBS: app.site, MASK, dopHz: doppler.hz, eng: getEngine(), optics: getOptics(),
      sourceText: tleSourceText({
        custom: !!(entry as { custom?: boolean }).custom, prov: live.provOf(entry.satnum), embedded: app.isEmbedded(entry),
        l1: entry.l1, l2: entry.l2, cached: cached(entry.satnum)
      }),
      stampAt: new Date()
    });
    const f: ExportFile = kind === 'csv' ? x.exportCSV() : x.exportICS();
    download(f.text, f.name, f.mime);
    say(f.hint);
  }
</script>

<div class="exportbar">
  <Button id="exp-csv" size="sm" onclick={() => go('csv')}>Export CSV</Button>
  <Button id="exp-ics" size="sm" onclick={() => go('ics')}>Export calendar</Button>
  <span class="exphint" id="exphint" role="status">{hint}</span>
</div>

<style>
  .exportbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-4); }
  .exphint { color: var(--muted); font-size: var(--fs-1); }
</style>
