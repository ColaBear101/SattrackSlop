<script lang="ts">
  /* nothing to compute: the script block is only here so that TypeScript can resolve this component from parts.ts */
</script>
<!-- The four severity glyphs the planner's notes point into with <use href="#sv-...">: a shape each (circle, triangle, square),
     so a note reads the same in greyscale. It is a node of the document, not an external file, so the references
     resolve; the check mark and the cross are cut out of their shapes in the chrome colour. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="sv-good" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5.25" fill="currentColor"/><path d="M3.4 6.2l1.8 1.8 3.4-3.8" fill="none" stroke="var(--chrome)" stroke-width="1.5"/></symbol>
  <symbol id="sv-info" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="3.7" r=".9" fill="currentColor"/><rect x="5.3" y="5.3" width="1.4" height="3.4" fill="currentColor"/></symbol>
  <symbol id="sv-warn" viewBox="0 0 12 12"><path d="M6 1.2L11.2 10.6H.8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><rect x="5.3" y="4.4" width="1.4" height="3" fill="currentColor"/><circle cx="6" cy="8.7" r=".8" fill="currentColor"/></symbol>
  <symbol id="sv-bad" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5" fill="currentColor"/><path d="M3.8 3.8l4.4 4.4M8.2 3.8l-4.4 4.4" stroke="var(--chrome)" stroke-width="1.5"/></symbol>
</svg>
