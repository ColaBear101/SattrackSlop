<script lang="ts">
  import { onMount } from 'svelte';

  /* The report's sub-navigation. The anchors are the old page's (#sec-elements and so on), so the README's
     links and anyone's bookmarks still land. The link of the section across the middle of the screen is marked. */
  const links = [
    ['sec-elements', 'Elements'], ['sec-track', 'Ground track'], ['sec-access', 'Passes'],
    ['sec-life', 'Decay'], ['sec-method', 'Method'], ['sec-terms', 'Terms']
  ] as const;

  let current = $state('');
  let nav: HTMLElement | undefined = $state();

  /* the link of the section in view is brought into view in the row, where the row scrolls (a phone) */
  $effect(() => {
    if (!nav || !current) return;
    const a = nav.querySelector<HTMLElement>('a[aria-current]');
    if (a && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: Math.max(0, a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2), behavior: 'smooth' });
  });

  onMount(() => {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) current = e.target.id;
    }, { rootMargin: '-45% 0px -50% 0px' });
    for (const [id] of links) { const el = document.getElementById(id); if (el) io.observe(el); }
    return () => io.disconnect();
  });
</script>

<nav class="rnav" aria-label="Sections below, and the Moon pages" bind:this={nav}>
  {#each links as [id, label] (id)}
    <!-- a section too short to cross the line the observer watches is marked by the press itself -->
    <a href="#{id}" aria-current={current === id ? 'location' : undefined} onclick={() => (current = id)}>{label}</a>
  {/each}
  <!-- the Moon pages, as the old page linked them: two other consoles, in testing -->
  <span class="moon"><span class="jk">Moon, in testing:</span>
    <a href="moon-track.html" title="Lunar track console: orbiters and landers">Lunar track →</a>
    <a href="moon.html" title="Earth–Moon system and the Lagrange points">Earth–Moon →</a></span>
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
  .moon { flex: none; display: inline-flex; align-items: center; gap: var(--space-1); margin-left: auto; padding-left: var(--space-4); }
  .jk { color: var(--muted); font-family: var(--font-mono); font-size: var(--fs-0); letter-spacing: .06em; white-space: nowrap; }
  a[aria-current] { background: var(--sel-bg); color: var(--sel-ink); }
  @media (pointer: coarse) { a { min-height: var(--tap); } }
</style>
