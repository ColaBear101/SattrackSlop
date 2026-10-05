<script lang="ts">
  import { report } from '../../state/report.svelte';
  import Rich from '../ui/Rich.svelte';

  /* (a) The orbital elements at the epoch: the six that the TLE holds, each with what it is and where on the two lines it
     comes from; the same orbit as the state vector says it is at that instant (osculating); and the figures that follow from
     them. The cards, the rows and every sentence are the old page's renderElements(), moved verbatim into
     lib/analysis/elements-report.ts; this lays them out. */
  const R = $derived(report.elements);
</script>

<section id="sec-elements" aria-labelledby="sec-elements-h">
  <header>
    <h2 id="sec-elements-h">Orbital elements at epoch</h2>
    <p class="hint">SGP4 mean elements from the <abbr title="two-line element set">TLE</abbr> (Kozai n, Brouwer a), angles in the <abbr title="true equator, mean equinox: the inertial frame SGP4 works in">TEME</abbr> frame of epoch</p>
  </header>

  <div class="elements" id="elgrid">
    {#each R?.cells ?? [] as [sym, label, val, unit, note, src] (sym)}
      <div class="el">
        <p class="sym"><i>{sym}</i>{label}</p>
        <!-- the degree sign sits on its number, as it does everywhere else on the page; a unit word is bound to it by a no-break space -->
        <p class="val mono">{val}{#if unit}<span>{unit === '°' ? '' : '\u00a0'}{unit}</span>{/if}</p>
        <p class="note">{note}</p>
        <p class="src mono">{src}</p>
      </div>
    {/each}
  </div>

  <div class="oscbox">
    <p class="eyebrow">Osculating at epoch · the same instant, from SGP4's r and v</p>
    <dl class="derived osc" id="osc">
      {#each R?.oscRows ?? [] as [name, value, words] (name)}
        <div class="dv"><dt><i>{name}</i>{#if words}{' '}<span>{words}</span>{/if}</dt><dd class="mono">{value}</dd></div>
      {/each}
    </dl>
    <p class="dnote" id="oscnote">{R?.oscNote ?? ''}</p>
  </div>

  <dl class="derived" id="derived">
    {#each R?.derived ?? [] as [k, v] (k)}
      <div class="dv"><dt><Rich value={k} /></dt><dd class="mono"><Rich value={v} /></dd></div>
    {/each}
  </dl>
  <p class="dnote" id="dnote">{R?.dnote ?? ''}</p>
</section>

<style>
  section { padding: var(--space-6) 0; border-top: 1px solid var(--rule); scroll-margin-top: 56px; }
  header { display: grid; gap: var(--space-1); margin-bottom: var(--space-4); }
  .hint { color: var(--muted); font-size: var(--fs-1); max-width: 70ch; }
  abbr { text-decoration: underline dotted; text-underline-offset: 2px; }
  .elements { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--space-4); }   /* six cards: 3 + 3 at full width, 2 + 2 + 2, then one */
  .el { padding: var(--space-4); border: 1px solid var(--rule); border-radius: var(--r-3); background: var(--panel); display: grid; align-content: start; gap: var(--space-1); }
  .sym { font-size: var(--fs-1); color: var(--muted); }
  .sym i { font-family: var(--font-head); font-size: var(--fs-4); font-style: italic; color: var(--ink); margin-right: var(--space-2); }
  .val { font-size: var(--fs-4); font-weight: 500; }
  .val span { font-size: var(--fs-2); color: var(--muted); }
  .note { font-size: var(--fs-1); color: var(--ink2); line-height: var(--lh-body); }
  .src { font-size: var(--fs-0); color: var(--muted); }
  .oscbox { margin-top: var(--space-5); padding: var(--space-4); border: 1px solid var(--rule); border-radius: var(--r-3); background: var(--panel); }
  .derived { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-3) var(--space-4); margin: var(--space-3) 0; }
  dt { font-size: var(--fs-0); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-family: var(--font-mono); }
  dt i { font-family: var(--font-head); font-style: italic; text-transform: none; letter-spacing: 0; font-size: var(--fs-2); color: var(--ink); }
  dd { margin: 2px 0 0; font-size: var(--fs-2); }
  .dnote { color: var(--muted); font-size: var(--fs-1); max-width: 78ch; line-height: var(--lh-body); }
</style>
