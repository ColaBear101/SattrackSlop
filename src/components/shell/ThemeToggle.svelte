<script lang="ts">
  import { prefs } from '../../state/prefs.svelte';
  import Icon from '../ui/Icon.svelte';

  /* light -> dark -> auto. Three states on one button, announced by name. */
  const state = $derived(prefs.theme === 'auto' ? 'Theme: follows the system' : prefs.theme === 'dark' ? 'Theme: dark' : 'Theme: light');
</script>

<button type="button" class="theme" onclick={() => prefs.cycleTheme()} aria-label="{state}. Change theme" title={state}>
  <Icon name={prefs.theme === 'auto' ? 'auto' : prefs.theme === 'dark' ? 'moon' : 'sun'} size={18} />
</button>

<style>
  .theme {
    display: inline-grid; place-items: center; width: 36px; height: 36px; border: 1px solid var(--chromerule);
    border-radius: var(--r-pill); background: var(--chrome2); color: var(--chromeink);
  }
  .theme:hover { background: var(--hover); }
  @media (pointer: coarse) { .theme { width: var(--tap); height: var(--tap); } }
</style>
