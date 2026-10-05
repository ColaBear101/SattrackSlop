<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { compass, hms, localMinute, mmss } from '../../lib/text/fmt';
  import { tzLabel } from '../../lib/observer';

  /* The access windows, one row per pass. A row is a button: it picks the pass (the sky plot follows) and takes the
     clock to its culmination, paused there. Times are UTC with the site's own time under them. */
  const passes = $derived(app.analysis?.passes ?? []);
  const md = (d: Date) => String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');

  function pick(i: number) {
    app.selPass = i;
    const p = passes[i];
    if (p) clock.seek(p.maxAt.getTime(), true);
  }
</script>

<table id="passlist" aria-label="Access windows. Times in UTC, with local time beneath.">
  <thead>
    <tr><th scope="col">#</th><th scope="col">AOS</th><th scope="col">Duration</th><th scope="col">Peak</th></tr>
  </thead>
  <tbody id="passbody">
    {#each passes as p, i (p.t0ms)}
      <tr class:sel={i === app.selPass} aria-current={i === app.selPass ? 'true' : undefined}>
        <td><button type="button" class="pick" onclick={() => pick(i)} aria-label="Pass {i + 1}: show it">{i + 1}</button></td>
        <td class="mono">
          <span>{md(p.aos)} {hms(p.aos)}Z{p.clipA ? ' *' : ''}</span>
          <span class="local">{localMinute(p.aos, app.site.tz).slice(11)} {tzLabel(app.site.tz)}</span>
        </td>
        <td class="mono">{mmss(p.dur)}</td>
        <td class="mono"><span>{p.maxEl.toFixed(1)}°</span><span class="local">{compass(p.aosAz)}→{compass(p.losAz)}</span></td>
      </tr>
    {:else}
      <tr><td colspan="4" class="none">No pass clears the 5° mask in this window.</td></tr>
    {/each}
  </tbody>
</table>

<style>
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-1); }
  th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-0); font-weight: 500; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; padding: var(--space-1) var(--space-2) var(--space-2) 0; }
  td { padding: var(--space-2) var(--space-2) var(--space-2) 0; border-top: 1px solid var(--rule); vertical-align: top; }
  td span { display: block; }
  .local { color: var(--muted); font-size: var(--fs-0); }
  tr.sel td { background: color-mix(in srgb, var(--contact) 9%, transparent); }
  tr.sel td:first-child { box-shadow: inset 3px 0 0 var(--contact); }
  .pick {
    width: 28px; height: 28px; border: 1px solid var(--rule); border-radius: var(--r-pill); background: var(--panel); color: var(--ink);
    font-family: var(--font-mono); font-size: var(--fs-0);
  }
  tr.sel .pick { background: var(--contact); border-color: var(--contact); color: #fff; }
  .none { color: var(--muted); }
  @media (pointer: coarse) { .pick { width: var(--tap); height: var(--tap); } }
</style>
