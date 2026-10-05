<script lang="ts">
  /* A row of mutually exclusive choices: camera mode, trail length, window span. Buttons with aria-pressed
     rather than radios, so the whole group is one tab stop on arrow keys the way a native toolbar is. */
  interface Option<T> { value: T; label: string; title?: string }
  let { options, value, label, onchange, size = 'md', dataAttr }: {
    options: Option<string | number>[]; value: string | number; label: string;
    onchange: (v: string | number) => void; size?: 'sm' | 'md';
    /** name a data attribute each button carries its value in (data-h="24"), for code that finds them by it */
    dataAttr?: string;
  } = $props();

  function key(e: KeyboardEvent, i: number) {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length]!;
    onchange(next.value);
    ((e.currentTarget as HTMLElement).parentElement!.children[(i + d + options.length) % options.length] as HTMLElement).focus();
  }
</script>

<div class="seg {size}" role="group" aria-label={label}>
  {#each options as o, i (o.value)}
    <button type="button" aria-pressed={o.value === value} title={o.title} tabindex={o.value === value ? 0 : -1}
            {...(dataAttr ? { ['data-' + dataAttr]: o.value } : {})}
            onclick={() => onchange(o.value)} onkeydown={e => key(e, i)}>{o.label}</button>
  {/each}
</div>

<style>
  .seg { display: inline-flex; border: 1px solid var(--chromerule); border-radius: var(--r-2); overflow: hidden; background: var(--chrome2); }
  button {
    min-height: 32px; padding: 0 var(--space-3); border: 0; border-left: 1px solid var(--chromerule);
    background: transparent; color: var(--chromeink); font-size: var(--fs-1); font-weight: 500;
    transition: background var(--dur) var(--ease);
  }
  button:first-child { border-left: 0; }
  .sm button { min-height: 28px; padding: 0 var(--space-2); font-size: var(--fs-0); }
  button:hover { background: var(--hover); }
  button[aria-pressed='true'] { background: var(--sel-bg); color: var(--sel-ink); }
  button:focus-visible { outline-offset: -2px; }
  @media (pointer: coarse) { button { min-height: var(--tap); } }
</style>
