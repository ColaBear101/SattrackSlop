<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import { iso, spanLabel } from '../../lib/text/fmt';

  /* (b) The ground track. The map itself is the Map tab at the top of the page, where it moves with the clock; this says
     what it covers. The words are the old page's (renderElements' neighbours in load(): the heading and #trackhint). */
  const D = $derived(app.analysis);
  const heading = $derived(D ? 'Ground track · ' + spanLabel(D.hours) + ' from window start' : 'Ground track');
  const hint = $derived(D ? iso(D.start) + '  →  ' + iso(D.end) + '  ·  ' + (D.hours * 3600 / D.E.periodShown!).toFixed(1) + ' revolutions' : '—');

  function show() {
    prefs.setTab('map');
    document.getElementById('main')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
</script>

<section id="sec-track" aria-labelledby="sec-track-h">
  <header>
    <h2 id="sec-track-h">{heading}</h2>
    <p class="hint" id="trackhint">{hint}</p>
  </header>
  <p class="where">The track is drawn on the flat map at the top of the page, with the day and night line, the footprint under the spacecraft and the passes in orange; the clock below it moves it.
    <button type="button" class="link" onclick={show}>Show the map</button></p>
</section>

<style>
  section { padding: var(--space-6) 0; border-top: 1px solid var(--rule); scroll-margin-top: 56px; }
  header { display: grid; gap: var(--space-1); margin-bottom: var(--space-3); }
  .hint { color: var(--muted); font-size: var(--fs-1); font-family: var(--font-mono); }
  .where { color: var(--ink2); font-size: var(--fs-2); max-width: 70ch; }
  .link { border: 0; background: transparent; padding: 0; color: var(--link); text-decoration: underline; font: inherit; cursor: pointer; }
</style>
