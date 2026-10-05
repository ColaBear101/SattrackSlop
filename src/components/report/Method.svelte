<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { getEngine } from '../../state/engine';

  /* (e) How these numbers were produced. The prose is the old page's, word for word (legacy/index.html, main@4eadd7a, the
     markup of #sec-method); the four things it filled in when an analysis loaded are expressions here: the site's name, how
     often the horizon is scanned, how often the track is sampled, and how far the two-body semi-major axis is from the one
     SGP4 recovers for this element set. */
  const D = $derived(app.analysis);
  const scan = $derived(D ? getEngine().passStepFor(D.hours) + ' s' : '4 s');
  const sample = $derived(D ? D.step + ' s' : '10 s');
  const anaive = $derived.by(() => {
    if (!D) return 'differs from it by a few km';
    const dA = D.E.aNaive! - D.E.a;
    return D.E.aSource === 'sgp4'
      ? 'comes out ' + Math.abs(dA).toFixed(2) + ' km ' + (dA < 0 ? 'short' : 'long') + ' for this element set'
      : 'is shown instead for this element set, since SGP4 left no Brouwer value to read';
  });
</script>

<section id="sec-method" aria-labelledby="sec-method-h">
  <header><h2 id="sec-method-h">How these numbers were produced</h2></header>
  <div class="method">
      <div>
        <h3>Elements</h3>
        <p>Inclination, RAAN, eccentricity, argument of perigee and mean anomaly are read from
        their fixed columns in TLE line 2 — no fitting, no propagation. They are SGP4 mean
        elements, not osculating ones; the osculating values at the epoch are listed under them.
        The semi-major axis is not stored in a TLE. The mean motion <code>n</code> in line 2 is
        Kozai's; SGP4 converts it to Brouwer's <code>n″</code> during initialisation and recovers
        <code>a″ = (kₑ/n″)^⅔</code> on WGS-72, and that is the value shown. The two-body
        <code>a = (μ/n²)^⅓</code> on the Kozai <code>n</code> <span id="anaive">{anaive}</span>; across the catalogue the difference reaches 6.4 km.</p>
      </div>
      <div>
        <h3>Propagation</h3>
        <p>SGP4 through <code>satellite.js</code>, the same analytic theory the element set was fitted
        to — TLEs are only meaningful with SGP4/SDP4. Positions come out in TEME and are rotated by
        Greenwich mean sidereal time, which is the rotation TEME is defined against; that lands in the
        pseudo-Earth-fixed frame, about 10 m from true ITRF because polar motion is not applied. Sub-satellite
        points are then geodetic on WGS-84. SGP4 itself runs in WGS-72, where the theory is defined.</p>
      </div>
      <div>
        <h3>Visibility</h3>
        <p>Topocentric elevation is scanned at the <span id="lbl-prose">{app.site.name}</span> site every
        <code id="lbl-scan">{scan}</code>. Each horizon crossing of the 5° mask is then bracketed and
        bisected to millisecond precision, so the cumulative total is not quantised by the scan.
        The scan has to be finer than the shortest pass worth finding, since a pass that falls
        between two samples is never bracketed at all — which is why it runs finer than the
        <code id="lbl-sample">{sample}</code> the ground track is drawn at. Purely geometric — no
        terrain, refraction or link budget.</p>
      </div>
      <div>
        <h3>The two views</h3>
        <p>The globe is drawn in the inertial frame, where the orbit stands still and the Earth
        turns beneath it. The flat map is the rotating frame, where the Earth is fixed and the track
        walks west each revolution. Same propagation, two frames — one clock drives both.</p>
      </div>
    </div>
</section>

<style>
  section { padding: var(--space-6) 0; border-top: 1px solid var(--rule); scroll-margin-top: 56px; }
  header { margin-bottom: var(--space-4); }
  .method { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--space-5) var(--space-6); }
  h3 { font-size: var(--fs-3); margin-bottom: var(--space-2); }
  p { color: var(--ink2); font-size: var(--fs-2); line-height: var(--lh-prose); max-width: 68ch; }
  code { font-size: .92em; padding: 0 3px; border-radius: var(--r-1); background: var(--sunk); }
</style>
