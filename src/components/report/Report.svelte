<script lang="ts">
  import ReportNav from './ReportNav.svelte';

  /* The report: what the console above summarises, written out. The sections keep the old page's anchors and
     order. Their contents arrive with the report milestone; until then each says what will be here. */
  const sections = [
    { id: 'sec-elements', title: 'Orbital elements at epoch', hint: 'SGP4 mean elements, the osculating values at the same instant, and what follows from them.',
      stub: 'Six element cards, the osculating box, the derived values and their notes.' },
    { id: 'sec-track', title: 'Ground track', hint: 'The track on the rotating Earth, with the day and night line and the footprint.',
      stub: 'The large map with its legend and the live readout.' },
    { id: 'sec-access', title: 'Passes', hint: 'Every pass above the elevation mask in the window.',
      stub: 'The access table with clipped-edge notes, CSV and calendar export, and the selected pass’s sky track.' },
    { id: 'sec-life', title: 'Orbital decay · remaining life', hint: 'Mean altitude history and the projection to re-entry.',
      stub: 'The history chart, the forecast, and the rate and altitude figures.' },
    { id: 'sec-method', title: 'How these numbers were produced', hint: 'Elements, propagation, visibility and the two views, in prose.',
      stub: 'The four method notes, with the scan and sample steps filled in for this site.' },
    { id: 'sec-terms', title: 'Terms used on this page', hint: 'Abbreviations also spell themselves out under the pointer.',
      stub: 'The glossary, searchable, and the same terms as tooltips in the text above.' }
  ];
</script>

<div class="report" id="report">
  <ReportNav />
  <div class="sheet">
    {#each sections as s (s.id)}
      <section id={s.id} aria-labelledby="{s.id}-h">
        <header>
          <h2 id="{s.id}-h">{s.title}</h2>
          <p class="hint">{s.hint}</p>
        </header>
        <p class="stub">{s.stub}</p>
      </section>
    {/each}
  </div>
</div>

<style>
  .report { background: var(--surface); }
  .sheet { max-width: 76rem; margin: 0 auto; padding: var(--space-2) var(--space-4) var(--space-8); }
  section { padding: var(--space-6) 0; border-top: 1px solid var(--rule); scroll-margin-top: 56px; }
  section:first-child { border-top: 0; }
  header { display: grid; gap: var(--space-1); margin-bottom: var(--space-4); }
  .hint { color: var(--muted); font-size: var(--fs-1); max-width: 70ch; }
  .stub {
    padding: var(--space-5); border: 1px dashed var(--rule); border-radius: var(--r-3); background: var(--sunk);
    color: var(--muted); font-size: var(--fs-1);
  }
</style>
