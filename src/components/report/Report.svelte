<script lang="ts">
  import ReportNav from './ReportNav.svelte';
  import ElementsSection from './ElementsSection.svelte';
  import ProfessorSection from './ProfessorSection.svelte';
  import TrackSection from './TrackSection.svelte';
  import PassesSection from './PassesSection.svelte';
  import DecaySection from './DecaySection.svelte';
  import Method from './Method.svelte';
  import Glossary from './Glossary.svelte';
  import ReportFoot from './ReportFoot.svelte';
  import { app } from '../../state/app.svelte';
  import { isCustom } from '../../lib/planner/custom';

  /* For an orbit the reader designed the page hides the Professor's section and the link to it itself, whichever way the planner is: a
     controller that is late, dead or faulted must not leave a catalogue spacecraft's notes up under that orbit. Showing them is the
     controller's (it builds them); both nodes are written by it and are not bound to anything here, so they are found by id. */
  $effect(() => {
    if (!app.entry || !isCustom(app.entry)) return;
    for (const id of ['sec-prof', 'rp-nav']) { const n = document.getElementById(id); if (n) n.hidden = true; }
  });

  /* The report: what the console above summarises, written out. The sections keep the old page's anchors and order
     (#sec-elements, #sec-track, #sec-access, #sec-life, #sec-method, #sec-terms), so the README's links and anyone's
     bookmarks still land. The element set's own section lives in the rail's Source tab. The Professor's notes on the spacecraft on screen
     (#sec-prof) are hidden until the orbit planner has built them, and for an orbit the reader designed, whose host is the planner. */
</script>

<div class="report" id="report">
  <ReportNav />
  <div class="sheet">
    <ElementsSection />
    <ProfessorSection />
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
