<script lang="ts">
  import { app } from '../state/app.svelte';
  import { iso, mmss } from '../lib/text/fmt';

  const a = $derived(app.analysis);
</script>

{#if a}
  <section class="answer" aria-labelledby="lbl-vis">
    <p class="eyebrow" id="lbl-vis">Visible from {a.track.body.defaultSite.name} · 5° mask</p>
    <p class="big" id="totalbig">{(a.totalS / 60).toFixed(1)} min</p>
    <p class="sub" id="totalsub">
      {a.totalS.toFixed(1)} s over {a.passes.length} {a.passes.length === 1 ? 'pass' : 'passes'}
      in {a.hours} h from {iso(a.start)}
    </p>
    <table id="passlist">
      <thead><tr><th>#</th><th>AOS (UTC)</th><th>Duration</th><th>Max elevation</th></tr></thead>
      <tbody id="passbody">
        {#each a.passes as p, i (p.t0ms)}
          <tr><td>{i + 1}</td><td>{iso(p.aos)}</td><td>{mmss(p.dur)}</td><td>{p.maxEl.toFixed(1)}°</td></tr>
        {:else}
          <tr><td colspan="4">No pass above the mask in this window.</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  .eyebrow { margin: 0; font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted, #536169); }
  .big { margin: 0.25rem 0; font-size: 2.5rem; font-weight: 600; color: var(--contact, #b4670f); font-variant-numeric: tabular-nums; }
  .sub { margin: 0 0 1rem; color: var(--muted, #536169); }
  table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 0.25rem 1rem 0.25rem 0; text-align: left; }
  th { font-weight: 500; color: var(--muted, #536169); font-size: 0.8125rem; }
</style>
