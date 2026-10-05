<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { MASK } from '../../state/engine';
  import { latStr, lonStr } from '../../lib/observer';
  import { ABBR, mmss } from '../../lib/text/fmt';
  import { clipSay, passTableRow } from '../../lib/text/passfacts';
  import SkyPlot from '../rail/SkyPlot.svelte';

  /* (c) The passes: every time the spacecraft clears the elevation mask in the window, as a table. A row is a button in
     effect: it picks the pass and takes the clock to its culmination, as the rail's list does. From `renderAccess()` in
     legacy/index.html (main@4eadd7a), lines 9842-9927, and the markup of #sec-access; the words are the original's. */
  const D = $derived(app.analysis);
  const P = $derived(D?.passes ?? []);
  const total = $derived(D?.totalS ?? 0);
  const m = $derived(Math.round(app.site.altKm * 1000));
  const hint = $derived(latStr(app.site.lat) + ' ' + lonStr(app.site.lon) + ', ' +
    (m ? Math.abs(m) + ' m ' + (m > 0 ? 'above' : 'below') + ' sea level' : 'sea level') + ', geometric');
</script>

<section id="sec-access" aria-labelledby="sec-access-h">
  <header>
    <h2 id="sec-access-h">Visibility from {app.site.name} · {MASK}° elevation mask</h2>
    <p class="hint" id="lbl-acchint">{hint}</p>
  </header>

  <dl class="derived">
    <div><dt class="eyebrow">Passes</dt><dd class="mono" id="npasses">{D ? String(P.length) : '—'}</dd></div>
    <div><dt class="eyebrow">Longest</dt><dd class="mono" id="longest">{P.length ? mmss(Math.max(...P.map(p => p.dur))) : '—'}</dd></div>
    <div><dt class="eyebrow">Best elevation</dt><dd class="mono" id="bestel">{P.length ? Math.max(...P.map(p => p.maxEl)).toFixed(1) + '°' : '—'}</dd></div>
  </dl>

  <div class="access">
  <div class="tbl">
  <p class="eyebrow cap">Access windows — click a row for its sky track<span>{' · scroll sideways for more columns'}</span></p>
  <!-- it scrolls sideways on a narrow screen, so it is a region the keyboard can reach and scroll (axe: scrollable-region-focusable) -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="tablewrap" tabindex="0" role="region" aria-label="Access windows">
    <table>
      <thead>
        <tr>
          <th scope="col">#</th><th scope="col">Date (UTC)</th>
          <th scope="col"><abbr title={ABBR.AOS.title}>AOS</abbr> (UTC)</th><th scope="col"><abbr title={ABBR.LOS.title}>LOS</abbr> (UTC)</th>
          <th scope="col">Duration</th><th scope="col">Max elev.</th><th scope="col">Az at max</th><th scope="col">Min range</th>
          <th scope="col"><abbr title="the azimuth at acquisition of signal, then at loss of signal">AOS→LOS</abbr> az</th>
        </tr>
      </thead>
      <tbody id="passbody">
        {#each P as p, i (p.t0ms)}
          {@const r = passTableRow(p)}
          <!-- a row is a mouse shortcut for the pass buttons in the rail, which are the keyboard's way to the same action -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <tr data-i={i} aria-selected={i === app.selPass} onclick={() => app.selectPass(i, true)}>
            <td>{i + 1}</td>
            <td>{r[0]}</td>
            <td title={p.clipA ? '* ' + clipSay(p) : undefined}>{r[1]}</td>
            <td title={p.clipL ? '* ' + clipSay(p) : undefined}>{r[2]}</td>
            <td>{r[3]}</td><td>{r[4]}</td><td>{r[5]}</td><td>{r[6]}</td><td>{r[7]}</td>
          </tr>
        {:else}
          <tr><td colspan="9">No pass clears the {MASK}° mask in this window.</td></tr>
        {/each}
      </tbody>
      <tfoot id="passfoot">
        {#if P.length}
          <tr><td colspan="4">Cumulative time above {MASK}°</td><td>{mmss(total)}</td><td colspan="4">{(total / 60).toFixed(1)} minutes over {P.length} passes</td></tr>
        {/if}
      </tfoot>
    </table>
  </div>
  <p class="passnote" id="passnote" hidden={!P.some(p => p.clipA || p.clipL)}>
    * Clipped by the window edge. The spacecraft is already above {MASK}° when the window opens, or still above it when the
    window closes, so the true <abbr title={ABBR.AOS.title}>AOS</abbr> or <abbr title={ABBR.LOS.title}>LOS</abbr> lies outside
    the window and the duration counts only the part inside it. The CSV and calendar exports carry the same flag.
  </p>
  </div>
  <div class="sky" id="tablesky"><SkyPlot id="sky2" captionId="sky2cap" full /></div>
  </div>
</section>

<style>
  section { padding: var(--space-6) 0; border-top: 1px solid var(--rule); scroll-margin-top: 56px; }
  header { display: grid; gap: var(--space-1); margin-bottom: var(--space-4); }
  .hint { color: var(--muted); font-size: var(--fs-1); max-width: 70ch; }
  .derived { display: flex; flex-wrap: wrap; gap: var(--space-5); margin: 0 0 var(--space-4); }
  .derived dd { margin: 2px 0 0; font-size: var(--fs-3); }
  .access { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); align-items: start; }
  @media (min-width: 1100px) { .access { grid-template-columns: minmax(0, 1fr) 380px; } .sky { position: sticky; top: 64px; } }
  .cap { margin-bottom: var(--space-2); }
  .tablewrap { overflow-x: auto; border: 1px solid var(--rule); border-radius: var(--r-3); background: var(--panel); }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-1); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  th { text-align: left; font-weight: 500; font-size: var(--fs-0); color: var(--muted); letter-spacing: .04em; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--rule); white-space: nowrap; }
  td { padding: var(--space-2) var(--space-3); border-top: 1px solid var(--rule); white-space: nowrap; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--hover); }
  tbody tr[aria-selected='true'] { background: color-mix(in srgb, var(--contact) 9%, transparent); }
  tfoot td { color: var(--ink2); font-weight: 500; border-top: 2px solid var(--rule); }
  .passnote { margin-top: var(--space-3); color: var(--muted); font-size: var(--fs-1); max-width: 78ch; }
  abbr { text-decoration: underline dotted; text-underline-offset: 2px; }
</style>
