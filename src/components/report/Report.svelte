<script lang="ts">
  import ReportNav from './ReportNav.svelte';
  import ElementsSection from './ElementsSection.svelte';
  import TrackSection from './TrackSection.svelte';
  import PassesSection from './PassesSection.svelte';
  import DecaySection from './DecaySection.svelte';
  import Method from './Method.svelte';
  import Glossary from './Glossary.svelte';
  import ReportFoot from './ReportFoot.svelte';

  /* The report: what the console above summarises, written out. The sections keep the old page's anchors and order
     (#sec-elements, #sec-track, #sec-access, #sec-life, #sec-method, #sec-terms), so the README's links and anyone's
     bookmarks still land. The element set's own section lives in the rail's Source tab; the Professor's notes
     (#sec-prof) arrive with the planner. */
</script>

<div class="report" id="report">
  <ReportNav />
  <div class="sheet">
    <ElementsSection />
    <TrackSection />
    <PassesSection />
    <DecaySection />
    <Method />
    <Glossary />
  </div>
  <ReportFoot />
</div>

<style>
  .report { background: var(--surface); }
  .sheet { max-width: 76rem; margin: 0 auto; padding: var(--space-2) var(--space-4) var(--space-8); }
  .sheet > :global(section:first-child) { border-top: 0; }
</style>
