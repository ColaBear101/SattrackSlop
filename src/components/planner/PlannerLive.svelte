<script lang="ts">
  import { onMount } from 'svelte';
  import { mounted } from './load.svelte';

  /* What a commit says when the planner has closed itself. On a wide but short screen the planner is a sheet, Add closes it
     onto the globe, and its own status line is display:none by then, so a screen reader would hear nothing. This region
     is a direct child of the mount node, not of the planner, and is the one sibling the sheet does not make inert. It is
     visually hidden (.pl-say), not display:none: a live region taken out of the page may not be read when something is
     written into it. The controller writes its text; nothing here is bound. */
  onMount(() => mounted('root'));
</script>

<p class="pl-say" id="pl-live" role="status" aria-live="polite"></p>
