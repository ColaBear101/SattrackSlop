<script lang="ts">
  /* nothing to compute: the script block is only here so that TypeScript can resolve this component */
</script>
<!-- The Professor on the spacecraft on screen: the report's read-only copy of the notes the planner shows for a design (SPEC 5.11).
     Hidden until plannerui.ts builds it after a load, and hidden again for an orbit the reader designed, whose host is the
     planner. Every node in it is written by that controller with textContent, because the spacecraft's name comes from the
     catalogue or the network: nothing here is bound to anything, and the five group shells are static, never rebuilt. The
     section's frame and the notes inside it are styled by the planner's own stylesheet (planner.css), which arrives with the
     planner's chunk; until then the section is hidden anyway. That keeps this markup free of a scoping class. -->
<section id="sec-prof" aria-labelledby="rp-title" hidden>
  <div class="shead">
    <!-- svelte-ignore a11y_missing_content -->
    <h2 id="rp-title"></h2>
    <p class="hint" id="rp-count"></p>
  </div>
  <p class="pf-verdict" id="rp-verdict"><b id="rp-head"></b></p>
  <details class="pf-grp" data-group="type" hidden><summary></summary><ul class="pf-list"></ul></details>
  <details class="pf-grp" data-group="survive" hidden><summary></summary><ul class="pf-list"></ul></details>
  <details class="pf-grp" data-group="sun" hidden><summary></summary><ul class="pf-list"></ul></details>
  <details class="pf-grp" data-group="ground" hidden><summary></summary><ul class="pf-list"></ul></details>
  <details class="pf-grp" data-group="caveat" hidden><summary></summary><ul class="pf-list"></ul></details>
  <p class="pf-foot" id="rp-foot"></p>
</section>

