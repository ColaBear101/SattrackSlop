<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { rank, SHOWN_MAX } from '../../lib/catalogue/rank';
  import Popover from '../ui/Popover.svelte';
  import Icon from '../ui/Icon.svelte';

  /* The spacecraft picker: the title of the page is also the control that changes it. A search field over the
     whole catalogue (name or NORAD id), the best 80 matches, and the usual combobox keys. */
  let open = $state(false);
  let query = $state('');
  let active = $state(0);

  const hits = $derived(rank(app.catalogue, query));
  const shown = $derived(hits.slice(0, SHOWN_MAX));
  const more = $derived(hits.length - shown.length);

  $effect(() => { if (open) { query = ''; active = 0; } });
  $effect(() => { query; active = 0; });

  function choose(i: number) {
    const entry = app.catalogue[i];
    if (entry && app.select(entry)) open = false;
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); }
    else if (e.key === 'Enter' && shown.length) { e.preventDefault(); choose(shown[active]!); }
  }

  $effect(() => { document.getElementById('sopt' + active)?.scrollIntoView({ block: 'nearest' }); });

  /* "/" focuses the picker from anywhere that is not a text field */
  function slash(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); open = true; }
  }
</script>

<svelte:window onkeydown={slash} />

<Popover bind:open label="Choose a spacecraft" width={420}>
  {#snippet trigger(props)}
    <h1 class="name">
      <button type="button" class="title" {...props}>
        <span id="satname">{app.entry?.name ?? 'Ground Track Console'}</span>
        <Icon name="chevron-down" size={20} />
      </button>
    </h1>
  {/snippet}

  <div class="search">
    <Icon name="search" size={16} />
    <input id="satsearch" type="search" role="combobox" aria-expanded="true" aria-controls={shown.length ? 'satlist' : undefined}
           aria-autocomplete="list" aria-haspopup="listbox"
           aria-activedescendant={shown.length ? 'sopt' + active : undefined} autocomplete="off" spellcheck="false"
           placeholder="Search {app.catalogue.length.toLocaleString('en-US')} spacecraft by name or NORAD id"
           bind:value={query} onkeydown={key}>
  </div>
  <!-- The options are not themselves focusable: the search field keeps focus and names the highlighted one through
       aria-activedescendant, the combobox pattern. So the keyboard is handled on the input, above. -->
  {#if shown.length}
    <ul id="satlist" role="listbox" aria-label="Spacecraft">
      {#each shown as idx, k (idx)}
        {@const c = app.catalogue[idx]!}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li role="option" id="sopt{k}" data-idx={idx} aria-selected={c === app.entry} class:on={k === active}
            onclick={() => choose(idx)} onpointermove={() => (active = k)}>
          <span class="nm">{c.name}</span><span class="id mono">{c.satnum}</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if !shown.length}<p class="note">Nothing in the catalogue matches that.</p>{/if}
  {#if more > 0}<p class="note">{more.toLocaleString('en-US')} more match. Keep typing to narrow them.</p>{/if}
  <p id="satcount" class="count mono">{app.catalogue.length.toLocaleString('en-US')} spacecraft</p>
</Popover>

<style>
  .name { font-size: var(--fs-5); line-height: var(--lh-tight); letter-spacing: -0.02em; }
  .title {
    /* pulled left by its own padding so the name lines up with the line of ids under it; the max-width gives that
       pull back, or the button would be clipped by its container to its own width minus the pull */
    display: inline-flex; align-items: center; gap: var(--space-2);
    margin-left: calc(-1 * var(--space-2)); max-width: calc(100% + var(--space-2));
    padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--r-2);
    background: transparent; color: var(--chromeink); font: inherit; letter-spacing: inherit; text-align: left;
    transition: background var(--dur) var(--ease);
  }
  .title:hover { background: var(--hover); }
  .title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search {
    display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-3);
    border: 1px solid var(--rule); border-radius: var(--r-2); background: var(--sunk); color: var(--muted);
  }
  .search input { flex: 1; min-width: 0; height: 36px; border: 0; background: transparent; outline: none; color: var(--ink); font-size: var(--fs-2); }
  .search:focus-within { border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  ul { list-style: none; margin: var(--space-2) 0 0; padding: 0; max-height: min(52vh, 380px); overflow: auto; }
  li {
    display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3);
    padding: var(--space-2) var(--space-3); border-radius: var(--r-2); cursor: pointer; color: var(--ink);
  }
  li.on { background: var(--hover); }
  li[aria-selected='true'] .nm { font-weight: 600; }
  .id { color: var(--muted); font-size: var(--fs-0); }
  .note { padding: var(--space-2) var(--space-3); color: var(--muted); font-size: var(--fs-1); }
  .count { margin: var(--space-2) 0 0; padding: 0 var(--space-3); color: var(--muted); font-size: var(--fs-0); }
</style>
