<script lang="ts">
  import type { Snippet } from 'svelte';

  /* A tablist with the keyboard behaviour people expect: arrows move between tabs, Home/End jump, only the
     selected tab is in the tab order, and the panel is labelled by its tab. `variant` is only appearance. */
  interface Tab { id: string; label: string }
  let { tabs, value, label, onchange, variant = 'underline', children }: {
    tabs: Tab[]; value: string; label: string; onchange: (id: string) => void;
    variant?: 'underline' | 'pill'; children: Snippet<[string]>;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 7);

  function key(e: KeyboardEvent, i: number) {
    const last = tabs.length - 1;
    const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    onchange(tabs[to]!.id);
    ((e.currentTarget as HTMLElement).parentElement!.children[to] as HTMLElement).focus();
  }
</script>

<div class="tabs {variant}">
  <div class="list" role="tablist" aria-label={label}>
    {#each tabs as t, i (t.id)}
      <button type="button" role="tab" id="tab-{uid}-{t.id}" aria-selected={t.id === value} aria-controls="panel-{uid}-{t.id}"
              tabindex={t.id === value ? 0 : -1} onclick={() => onchange(t.id)} onkeydown={e => key(e, i)}>{t.label}</button>
    {/each}
  </div>
  {#each tabs as t (t.id)}
    <div class="panel" role="tabpanel" id="panel-{uid}-{t.id}" aria-labelledby="tab-{uid}-{t.id}" hidden={t.id !== value}>
      {#if t.id === value}{@render children(t.id)}{/if}
    </div>
  {/each}
</div>

<style>
  .list { display: flex; gap: var(--space-1); }
  button {
    min-height: 32px; padding: 0 var(--space-3); border: 0; background: transparent; color: var(--muted);
    font-size: var(--fs-1); font-weight: 500; border-radius: var(--r-2);
    transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
  }
  button:hover { color: var(--ink); }
  button[aria-selected='true'] { color: var(--ink); }
  .underline .list { border-bottom: 1px solid var(--rule); gap: var(--space-2); }
  .underline button { border-radius: 0; padding: 0 var(--space-1); margin-right: var(--space-3); box-shadow: inset 0 -2px 0 transparent; }
  .underline button[aria-selected='true'] { box-shadow: inset 0 -2px 0 var(--ink); }
  .pill button[aria-selected='true'] { background: var(--sel-bg); color: var(--sel-ink); }
  @media (pointer: coarse) { button { min-height: var(--tap); } }
</style>
