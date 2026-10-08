<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { iso, spanLabel } from '../../lib/text/fmt';

  /* The line at the foot of the page that says which element set and which window everything above was computed from. From
     the footer of legacy/index.html (main@4eadd7a) and `#footepoch` in load(). */
  const D = $derived(app.analysis);
  const epoch = $derived(D ? 'Element set epoch ' + iso(D.E.epoch) + ' · window ' + spanLabel(D.hours) + ' from ' + iso(D.start) + ' · sample ' + D.step + ' s' : '—');
</script>

<footer>
  <span id="footepoch">{epoch}</span>
  <span>SGP4 (WGS-72) · geodetic on WGS-84 · angles in degrees</span>
  <span>Element sets degrade with age; re-fetch before quoting pass times far from epoch.</span>
  <span>Moon, in testing: <a href="moon-track.html">Lunar track</a> · <a href="moon.html">Earth–Moon</a></span>
</footer>

<style>
  footer a { color: inherit; text-underline-offset: 2px; }
  footer { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); max-width: 76rem; margin: 0 auto; padding: var(--space-5) var(--space-4) var(--space-7); border-top: 1px solid var(--rule); color: var(--muted); font-size: var(--fs-0); font-family: var(--font-mono); }
</style>
