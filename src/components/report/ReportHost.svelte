<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { report } from '../../state/report.svelte';

  /* The report is below the first screen, so it is a chunk of its own (its sections, their sentences, the glossary, the words of the
     element cards), fetched once the first answer is up and then mounted here: when the browser is idle, when the reader scrolls towards
     it, at once for a link to a part of it (#sec-life, #t-sso), and before the test surface says the page is ready. The placeholder keeps
     the page's height roughly where it will be, and the anchor the old page called #report. The orbit planner waits for it (its read-only
     section, #sec-prof, is one of the report's). */
  let Sections = $state.raw<typeof import('./Report.svelte').default | null>(null);
  let host: HTMLElement | undefined = $state();

  /* a link to a part of the report that was not in the page when the page opened: go there now that it is */
  async function arrive() {
    await tick();
    const h = location.hash;
    let id = '';
    try { id = decodeURIComponent(h.slice(1)); } catch { /* not a fragment of ours */ }
    if (id && document.getElementById(id)) {
      /* Assigning the fragment the address already has moves nothing (the browser ignores it). Taking it off without a navigation and then
         navigating to it does: the page scrolls to the target, it is :target, and the history keeps the one entry it had. */
      history.replaceState(history.state, '', location.pathname + location.search);
      location.replace(h);
    }
  }

  /* a chunk that cannot be fetched (a dropped connection, a tab left open across a deploy) is said, with a way to try again: the old page, all
     in one file, could not fail this way */
  let failed = $state(false);
  function load() {
    failed = false;
    import('./Report.svelte').then(m => { Sections = m.default; void arrive(); report.mounted(); }, e => { failed = true; report.failed(e); });
  }
  $effect(() => { if (report.wanted && !Sections && !failed) untrack(load); });

  onMount(() => {
    if (location.hash.length > 1) { report.request(); return; }                 // a deep link: now
    const go = () => report.request();
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const idle = ric ? ric.call(window, go, { timeout: 2500 }) : setTimeout(go, 1200);
    /* ...or as soon as it is within a few screens of being looked at */
    const io = new IntersectionObserver(es => { if (es[0]?.isIntersecting) go(); }, { rootMargin: '1500px 0px' });
    if (host) io.observe(host);
    return () => { io.disconnect(); if (!ric) clearTimeout(idle as number); };
  });
</script>

{#if Sections}
  <Sections />
{:else if failed}
  <div class="soon" id="report" role="alert">
    <p>The written analysis could not be loaded. <button type="button" onclick={load}>Try again</button></p>
  </div>
{:else}
  <div class="soon" id="report" bind:this={host} aria-hidden="true"></div>
{/if}

<style>
  .soon { min-height: 70vh; background: var(--surface); }
  .soon p { margin: 0; padding: var(--space-6) var(--space-4); text-align: center; color: var(--ink2); }
  .soon button { margin-left: var(--space-2); }
</style>
