<script lang="ts">
  import { GLOSSARY } from '../../lib/text/glossary';

  /* The vocabulary the page is written in, for a reader who has the basics of a TLE and not much more. Each entry keeps its
     id so a note elsewhere can point at the term it leans on (#t-sso, #t-ltan...): an entry that does not match the search is
     hidden, not removed, so a link to it still lands. */
  let q = $state('');
  const needle = $derived(q.trim().toLowerCase());
  const shown = (t: { term: string; text: string }) => !needle || (t.term + ' ' + t.text).toLowerCase().includes(needle);
  const count = $derived(GLOSSARY.filter(shown).length);

  /* a link to a term the filter has hidden clears the filter: the term is there to be landed on */
  function arrive() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (needle && GLOSSARY.some(t => t.id === id && !shown(t))) { q = ''; requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView()); }
  }
</script>

<svelte:window onhashchange={arrive} />

<section id="sec-terms" aria-labelledby="sec-terms-h">
  <header>
    <h2 id="sec-terms-h">Terms used on this page</h2>
    <p class="hint">Abbreviations also spell themselves out under the pointer</p>
  </header>
  <div class="find">
    <input type="search" bind:value={q} placeholder="Search the terms" aria-label="Search the terms" autocomplete="off" spellcheck="false">
    <span class="n mono" role="status">{needle ? count + ' of ' + GLOSSARY.length : GLOSSARY.length + ' terms'}</span>
  </div>
  <dl class="terms">
    {#each GLOSSARY as t (t.id)}
      <div id={t.id} hidden={!shown(t)}><dt>{t.term}</dt><dd>{t.text}</dd></div>
    {/each}
  </dl>
  {#if needle && count === 0}<p class="none">No term matches “{q.trim()}”.</p>{/if}
</section>

<style>
  section { padding: var(--space-6) 0; border-top: 1px solid var(--rule); scroll-margin-top: 56px; }
  header { display: grid; gap: var(--space-1); margin-bottom: var(--space-4); }
  .hint { color: var(--muted); font-size: var(--fs-1); }
  .find { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
  input {
    flex: 0 1 22rem; height: 36px; padding: 0 var(--space-3); border: 1px solid var(--rule); border-radius: var(--r-2);
    background: var(--panel); color: var(--ink); font-size: var(--fs-2);
  }
  input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  .n { color: var(--muted); font-size: var(--fs-0); }
  .terms { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: var(--space-4) var(--space-6); margin: 0; }
  .terms > div { scroll-margin-top: 64px; }
  dt { font-weight: 600; font-size: var(--fs-2); }
  dd { margin: var(--space-1) 0 0; color: var(--ink2); font-size: var(--fs-1); line-height: var(--lh-body); max-width: 62ch; }
  .terms > div:target { background: color-mix(in srgb, var(--contact) 10%, transparent); box-shadow: -8px 0 0 color-mix(in srgb, var(--contact) 10%, transparent); }
  .none { color: var(--muted); }
</style>
