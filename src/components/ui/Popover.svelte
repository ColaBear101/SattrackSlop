<script lang="ts">
  import type { Snippet } from 'svelte';

  /* A popover anchored under its trigger. Written by hand because the native `popover` attribute needs Safari
     17 and the build targets Safari 16.4: it closes on Escape and on a press outside, returns focus to the
     trigger, and flips to the right edge when it would run off the screen. The trigger is a snippet so the
     caller owns what it looks like; it receives the props that make it a disclosure button. */
  let { open = $bindable(false), label, align = 'start', width = 320, keepMounted = false, trigger, children }: {
    open?: boolean; label: string; align?: 'start' | 'end'; width?: number;
    /** keep the panel's contents in the page while it is closed (hidden): for fields whose value other code reads */
    keepMounted?: boolean;
    trigger: Snippet<[{ onclick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'dialog'; 'aria-controls': string | undefined }]>;
    children: Snippet;
  } = $props();

  const id = 'pop-' + Math.random().toString(36).slice(2, 8);
  let root: HTMLElement;
  let panel: HTMLElement | undefined = $state();

  function close(restore = true) {
    open = false;
    if (restore) (root.querySelector('[aria-controls="' + id + '"]') as HTMLElement | null)?.focus();
  }
  function outside(e: PointerEvent) { if (open && !root.contains(e.target as Node)) close(false); }
  function key(e: KeyboardEvent) { if (open && e.key === 'Escape') { e.stopPropagation(); close(); } }

  /* When the panel opens: open upward if it would run off the bottom of the screen and there is more room above
     (the transport lives at the bottom edge), then move focus into it so a keyboard user lands there. Measured
     in the frame it opens, so nothing flashes. Focus must not scroll: the panel is still where it was first
     placed, possibly below the fold, and focusing it there used to drag the whole page down to it. */
  let up = $state(false);
  /* The edge the panel hangs from: the one asked for, unless that runs it off the screen - the observer's chip is at the left of a phone and
     its panel, hung from the chip's right edge, ran off the left, Apply and all. */
  let edge = $state<'start' | 'end' | null>(null);
  $effect(() => {
    if (!open || !panel) { up = false; edge = null; return; }
    const r = root.getBoundingClientRect();
    const need = panel.offsetHeight + 12;
    const below = innerHeight - r.bottom, above = r.top;
    up = below < need && above > below;
    edge = align === 'end' ? (r.right - panel.offsetWidth >= 0 ? 'end' : 'start') : (r.left + panel.offsetWidth <= innerWidth ? 'start' : 'end');
    /* in the next frame, once the flip above is on the screen: focused while the panel is still where it was first placed - below the fold, for a
       popover on the transport - a date field makes the browser scroll to it whatever is asked, and the page jumped by hundreds of pixels */
    const p = panel;
    const raf = requestAnimationFrame(() => p.querySelector<HTMLElement>('input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])')
      ?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  });
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<div class="pop" bind:this={root}>
  <!-- aria-controls names the panel only while there is one: a shut popover that is not kept mounted has nothing to point at -->
  {@render trigger({ onclick: () => (open = !open), 'aria-expanded': open, 'aria-haspopup': 'dialog', 'aria-controls': open || keepMounted ? id : undefined })}
  {#if open || keepMounted}
    <div class="panel {edge ?? align}" class:up {id} role="dialog" aria-label={label} hidden={!open} style="--w:{width}px" bind:this={panel}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .pop { position: relative; display: inline-block; max-width: 100%; }
  .panel {
    position: absolute; top: calc(100% + 6px); z-index: var(--z-popover);
    width: min(var(--w), calc(100vw - 2 * var(--space-4)));
    background: var(--panel); color: var(--ink); border: 1px solid var(--rule); border-radius: var(--r-3);
    box-shadow: var(--shadow); padding: var(--space-4);
  }
  .panel.start { left: 0; }
  .panel.end { right: 0; }
  .panel.up { top: auto; bottom: calc(100% + 6px); }
</style>
