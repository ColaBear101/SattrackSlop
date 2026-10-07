<script lang="ts">
  import { onMount } from 'svelte';
  import { mounted } from './load.svelte';
  import './planner.css';

  /* The orbit planner's markup, as the old page had it (legacy/index.html, the aside#planner block), and nothing else.
     plannerui.ts finds every node here by id, writes its text, attributes and children, builds the note lists and the
     saved list itself, and attaches every listener (its wire()). So this component is deliberately inert: no handlers,
     nothing bound into a node the controller writes, and no {#if} or {#each} around any of it - a node whose text the
     controller replaces is rendered once, with the words it starts with, and Svelte never touches it again.
     The ids, roles, aria wiring, data attributes, classes, element order, hidden states and static strings are the old
     page's, on purpose: the controller, the stylesheet and the oracle suites all key on them. */
  onMount(() => mounted('panel'));
</script>

<aside class="planner" id="planner" role="region" aria-labelledby="pl-title" hidden>
  <div class="pl-head">
    <p class="eyebrow">Orbit planner</p>
    <h2 id="pl-title">Design a satellite</h2>
    <button type="button" class="btn" id="pl-close" aria-label="Close the orbit planner">Close</button>
  </div>
  <div class="pl-scroll">
    <div class="pl-body">
      <div class="pl-form-col">
        <form class="pl-form" id="pl-form" novalidate autocomplete="off">
          <div class="pl-f">
            <label for="pl-name">Name</label>
            <div class="pl-text"><input id="pl-name" type="text" autocomplete="off" spellcheck="false" aria-describedby="pl-name-hint"></div>
            <p class="pl-err" id="pl-err-name" hidden></p>
            <p class="pl-hint" id="pl-name-hint">Up to 24 characters. It is kept in this browser, and listed in the search box under Your orbits.</p>
          </div>
          <div class="pl-f">
            <label for="pl-preset">Start from</label>
            <select class="pl-select" id="pl-preset" aria-describedby="pl-preset-note"></select>
            <p class="pl-hint" id="pl-preset-note"></p>
          </div>

          <fieldset class="pl-set" aria-describedby="pl-d-shape">
            <legend class="eyebrow">Size and shape</legend>
            <div class="seg" role="group" aria-label="How to describe the size and shape">
              <button type="button" class="btn" aria-pressed="true" data-shape="alt">Altitudes</button>
              <button type="button" class="btn" aria-pressed="false" data-shape="ae">a and e</button>
              <button type="button" class="btn" aria-pressed="false" data-shape="per">Period</button>
            </div>
            <div class="pl-grid pl-shape" data-lens="alt">
              <div class="pl-f">
                <label for="pl-hp">Mean perigee altitude</label>
                <div class="pl-num"><input id="pl-hp" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">km</span></div>
                <p class="pl-err" id="pl-err-hp" hidden></p>
              </div>
              <div class="pl-f">
                <label for="pl-ha">Mean apogee altitude</label>
                <div class="pl-num"><input id="pl-ha" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">km</span></div>
                <p class="pl-err" id="pl-err-ha" hidden></p>
              </div>
            </div>
            <div class="pl-grid pl-shape" data-lens="ae" hidden>
              <div class="pl-f">
                <label for="pl-a"><i>a</i> Semi-major axis</label>
                <div class="pl-num"><input id="pl-a" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">km</span></div>
                <p class="pl-err" id="pl-err-a" hidden></p>
              </div>
              <div class="pl-f">
                <label for="pl-e"><i>e</i> Eccentricity</label>
                <div class="pl-num"><input id="pl-e" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u"></span></div>
                <p class="pl-err" id="pl-err-e" hidden></p>
              </div>
            </div>
            <div class="pl-grid pl-shape" data-lens="per" hidden>
              <div class="pl-f">
                <label for="pl-period">Keplerian period</label>
                <div class="pl-num"><input id="pl-period" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">min</span></div>
                <p class="pl-err" id="pl-err-period" hidden></p>
              </div>
              <div class="pl-f">
                <label for="pl-e-p"><i>e</i> Eccentricity</label>
                <div class="pl-num"><input id="pl-e-p" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u"></span></div>
                <p class="pl-err" id="pl-err-e-p" hidden></p>
              </div>
            </div>
            <p class="pl-derived" id="pl-d-shape">—</p>
          </fieldset>

          <fieldset class="pl-set" aria-describedby="pl-d-orient">
            <legend class="eyebrow">Orientation</legend>
            <div class="pl-grid">
              <div class="pl-f">
                <label for="pl-inc"><i>i</i> Inclination</label>
                <div class="pl-num"><input id="pl-inc" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">°</span></div>
                <p class="pl-err" id="pl-err-inc" hidden></p>
              </div>
              <div class="pl-f">
                <div class="pl-lab"><label for="pl-raan"><i>Ω</i> Node</label>
                  <div class="seg" role="group" aria-label="Give the node as">
                    <button type="button" class="btn" aria-pressed="true" data-node="raan"><abbr title="right ascension of the ascending node: the angle, turned eastward from the March equinox, at which the orbit crosses the equator going north">RAAN</abbr></button>
                    <button type="button" class="btn" aria-pressed="false" data-node="ltan"><abbr title="local time of the ascending node: the local mean solar time at which the orbit crosses the equator going north">LTAN</abbr></button>
                  </div></div>
                <div class="pl-num"><input id="pl-raan" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="pl-d-orient"><span class="u" id="pl-raan-u">°</span></div>
                <p class="pl-err" id="pl-err-raan" hidden></p>
              </div>
              <div class="pl-f">
                <label for="pl-argp"><i>ω</i> Argument of perigee</label>
                <div class="pl-num"><input id="pl-argp" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">°</span></div>
                <p class="pl-err" id="pl-err-argp" hidden></p>
              </div>
              <div class="pl-f">
                <label for="pl-ma"><i>M</i> Mean anomaly</label>
                <div class="pl-num"><input id="pl-ma" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">°</span></div>
                <p class="pl-err" id="pl-err-ma" hidden></p>
              </div>
            </div>
            <p class="pl-derived" id="pl-d-orient">—</p>
          </fieldset>

          <fieldset class="pl-set" aria-describedby="pl-d-drag">
            <legend class="eyebrow">Epoch and drag</legend>
            <div class="pl-grid">
              <div class="pl-f wide">
                <label for="pl-epoch">Epoch, in <abbr title="Coordinated Universal Time">UTC</abbr></label>
                <div class="pl-epochrow">
                  <div class="pl-num"><input id="pl-epoch" type="datetime-local" step="1" aria-describedby="pl-epoch-note"><span class="pl-tz"><abbr title="Coordinated Universal Time">UTC</abbr></span></div>
                  <button type="button" class="btn" id="pl-now">Now</button>
                </div>
                <p class="pl-err" id="pl-err-epoch" hidden></p>
                <p class="pl-hint" id="pl-epoch-note"></p>
              </div>
              <div class="pl-f wide">
                <label for="pl-craft">What it is</label>
                <select class="pl-select" id="pl-craft" aria-describedby="pl-craft-note"></select>
                <p class="pl-hint" id="pl-craft-note"></p>
              </div>
              <div class="pl-f">
                <label for="pl-am">Area over mass</label>
                <div class="pl-num"><input id="pl-am" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">m²/kg</span></div>
                <p class="pl-err" id="pl-err-am" hidden></p>
              </div>
            </div>
            <p class="pl-derived" id="pl-d-drag">= <abbr title="B*, SGP4's drag term, in inverse Earth radii">B*</abbr> ... at this height · worked out from <abbr title="area over mass: the cross-section the air pushes on, per kilogram">A/m</abbr> · a guess, not a measurement</p>
          </fieldset>
        </form>
        <p class="pl-err pl-err-form" id="pl-err-form" hidden></p>
        <div class="pl-actions">
          <button type="submit" form="pl-form" class="btn primary" id="pl-add">Add to console</button>
          <button type="button" class="btn" id="pl-savenew" hidden>Save as new</button>
          <button type="button" class="btn" id="pl-reset">Reset</button>
          <p class="pl-status" id="pl-status" role="status" aria-live="polite"></p>
        </div>
      </div>

      <section class="prof" id="prof" aria-labelledby="pf-title">
        <div class="pf-head"><!-- svelte-ignore a11y_missing_content --><h3 id="pf-title"></h3><p class="eyebrow" id="pf-count"></p></div>
        <p class="pf-verdict" id="pf-verdict" hidden><b id="pf-head"></b><span class="sub" id="pf-sub"></span></p>
        <ul class="pf-list pf-errs" id="pf-errs"></ul>
        <details class="pf-grp" data-group="type" hidden><summary></summary><ul class="pf-list"></ul></details>
        <details class="pf-grp" data-group="survive" hidden><summary></summary><ul class="pf-list"></ul></details>
        <details class="pf-grp" data-group="sun" hidden><summary></summary><ul class="pf-list"></ul></details>
        <details class="pf-grp" data-group="ground" hidden><summary></summary><ul class="pf-list"></ul></details>
        <details class="pf-grp" data-group="caveat" hidden><summary></summary><ul class="pf-list"></ul></details>
        <p class="pf-empty" id="pf-empty" hidden></p>
        <p class="pf-foot" id="pf-foot"></p>
      </section>

      <section class="pl-saved" aria-labelledby="pl-saved-h">
        <h3 id="pl-saved-h">Your orbits <span class="pl-hint" id="pl-saved-count"></span></h3>
        <ul id="pl-saved-list"></ul>
        <p class="pl-undo" id="pl-undo" hidden></p>
        <p class="pl-hint" id="pl-saved-none" hidden>None yet. An orbit you add is kept here, in this browser, for the next visit.</p>
      </section>
    </div>
  </div>
  <p class="pl-say" id="pl-say" role="status" aria-live="polite"></p>
</aside>
