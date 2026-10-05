<script lang="ts">
  import { app } from '../../state/app.svelte';
  import Icon from '../ui/Icon.svelte';

  /* Said under the bar that holds the picker, because that is where the request that failed was made: a spacecraft SGP4
     cannot propagate, a window it cannot fill. Cleared by the next analysis that does load. The page stays on the
     spacecraft it was showing. */
</script>

<p class="loadnote" id="loadnote" role="alert" hidden={!app.note}><Icon name="alert" size={16} /> <span>{app.note}</span></p>

<style>
  .loadnote {
    display: flex; gap: var(--space-2); align-items: flex-start; margin: 0; padding: var(--space-2) var(--space-4);
    background: var(--sunk); border-bottom: 1px solid var(--rule); border-left: 3px solid var(--warn); color: var(--ink2); font-size: var(--fs-1);
  }
  .loadnote :global(svg) { margin-top: 2px; color: var(--warn); flex: none; }
</style>
