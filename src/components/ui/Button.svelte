<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /* One button. `pressed` makes it a toggle (aria-pressed); `variant` is the visual weight. Tap targets are at
     least 40 px tall on touch devices whatever the visible size. */
  let { variant = 'default', size = 'md', pressed, children, ...rest }: HTMLButtonAttributes & {
    variant?: 'default' | 'ghost' | 'primary'; size?: 'sm' | 'md'; pressed?: boolean; children?: Snippet;
  } = $props();
</script>

<button type="button" class="btn {variant} {size}" aria-pressed={pressed} {...rest}>
  {@render children?.()}
</button>

<style>
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
    min-height: 32px; padding: 0 var(--space-3);
    border: 1px solid var(--chromerule); border-radius: var(--r-2);
    background: var(--chrome2); color: var(--chromeink);
    font-size: var(--fs-1); font-weight: 500; line-height: 1; white-space: nowrap;
    transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .btn.sm { min-height: 28px; padding: 0 var(--space-2); font-size: var(--fs-0); }
  .btn:hover:not(:disabled) { background: color-mix(in srgb, var(--chrome2) 80%, var(--ink)); }
  .btn:disabled { opacity: .5; }
  .btn[aria-pressed='true'] { background: var(--sel-bg); color: var(--sel-ink); border-color: var(--sel-bg); }
  .ghost { background: transparent; border-color: transparent; }
  .ghost:hover:not(:disabled) { background: var(--hover); }
  .primary { background: var(--track); border-color: var(--track); color: #fff; }
  .primary:hover:not(:disabled) { background: color-mix(in srgb, var(--track) 85%, #000); }
  @media (pointer: coarse) { .btn, .btn.sm { min-height: var(--tap); min-width: var(--tap); } }
</style>
