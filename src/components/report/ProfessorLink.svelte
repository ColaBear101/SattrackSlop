<script lang="ts">
  /* nothing to compute: the script block is only here so that TypeScript can resolve this component */
</script>
<!-- The link from the element set's hint down to the Professor's notes, shown with that section (plannerui.ts unhides both
     together and sets the link's words from the notes' label). It goes at the end of the hint's sentence, with no space before
     it: the leading one is inside the span. Not in the report's jump bar, which has a header-height budget. Its look is
     in planner.css, with the section it points to. -->
<!-- svelte-ignore a11y_missing_content, a11y_consider_explicit_label -->
<span id="rp-nav" hidden>{' '}· <a id="rp-link" href="#sec-prof"></a></span>

