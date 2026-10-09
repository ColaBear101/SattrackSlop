<script lang="ts">
  import type { Inline } from '../../lib/text/rich';

  /* Renders a sentence built as data (lib/text/rich.ts): strings are text nodes, never markup, so whatever a
     spacecraft is called or a source replies with cannot become an element. */
  let { value }: { value: Inline } = $props();
</script>

{#snippet node(x: Inline)}
  {#if typeof x === 'string'}{x}
  {:else if Array.isArray(x)}{#each x as y}{@render node(y)}{/each}
  {:else if 'abbr' in x}<abbr title={x.abbr.title}>{x.abbr.text}</abbr>
  {:else if 'b' in x}<b>{@render node(x.b)}</b>
  {:else if 'warn' in x}<span class="warn">{@render node(x.warn)}</span>
  {:else if 'link' in x}<a href={x.link.href}>{x.link.text}</a>
  {:else}<br>{/if}
{/snippet}

{@render node(value)}

<style>
  .warn { color: var(--warn); }
  abbr { text-decoration: underline dotted; text-underline-offset: 2px; cursor: help; }
</style>
