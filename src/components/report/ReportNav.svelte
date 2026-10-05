<script lang="ts">
  import { onMount } from 'svelte';

  /* The report's sub-navigation. The anchors are the old page's (#sec-elements and so on), so the README's
     links and anyone's bookmarks still land. The link of the section across the middle of the screen is marked. */
  const links = [
    ['sec-elements', 'Elements'], ['sec-track', 'Ground track'], ['sec-access', 'Passes'],
    ['sec-life', 'Decay'], ['sec-method', 'Method'], ['sec-terms', 'Terms']
  ] as const;

  let current = $state('');

  onMount(() => {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) current = e.target.id;
    }, { rootMargin: '-45% 0px -50% 0px' });
    for (const [id] of links) { const el = document.getElementById(id); if (el) io.observe(el); }
    return () => io.disconnect();
  });
</script>

<nav class="rnav" aria-label="Report sections">
  {#each links as [id, label] (id)}
    <a href="#{id}" aria-current={current === id ? 'location' : undefined}>{label}</a>
  {/each}
</nav>

<style>
  .rnav {
    position: sticky; top: 0; z-index: var(--z-bar); display: flex; gap: var(--space-1); overflow-x: auto;
    padding: var(--space-2) var(--space-4); background: var(--chrome); border-block: 1px solid var(--chromerule);
    scrollbar-width: none;
  }
  .rnav::-webkit-scrollbar { display: none; }
  a {
    flex: none; display: inline-flex; align-items: center; min-height: 32px; padding: 0 var(--space-3);
    border-radius: var(--r-2); color: var(--ink2); font-size: var(--fs-1); font-weight: 500; text-decoration: none;
  }
  a:hover { background: var(--hover); color: var(--ink); }
  a[aria-current] { background: var(--sel-bg); color: var(--sel-ink); }
  @media (pointer: coarse) { a { min-height: var(--tap); } }
</style>
