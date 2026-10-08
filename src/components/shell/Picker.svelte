<script lang="ts">
  import { app, PINNED } from '../../state/app.svelte';
  import { custom } from '../../state/custom.svelte';
  import { isCustom } from '../../lib/planner/custom';
  import { rank, SHOWN_MAX } from '../../lib/catalogue/rank';
  import { session } from '../planner/session.svelte';
  import Popover from '../ui/Popover.svelte';
  import Icon from '../ui/Icon.svelte';

  /* The spacecraft picker: the title of the page is also the control that changes it. A search field over the
     whole catalogue (name or NORAD id) and the reader's own orbits (name, or the word "custom"), the best 80 matches,
     and the usual combobox keys. The list is in one index space: the catalogue first, then the reader's orbits in order,
     which is what data-idx carries. The last option opens the planner, when there is one to open. */
  let open = $state(false);
  let query = $state('');
  let active = $state(0);

  const hits = $derived.by(() => { void custom.rev; return rank(app.catalogue, query, custom.list); });
  const shown = $derived(hits.slice(0, SHOWN_MAX));
  const more = $derived(hits.length - shown.length);
  /* the row in the list that is on screen: the entry may carry a live set's lines, so a spacecraft is its number, an orbit its object */
  const here = $derived.by(() => { void app.rev; void custom.rev; return custom.indexOf(app.entry); });
  /* Two group rows, on the empty query only and only when there is something of the reader's to separate from the catalogue. They are
     presentation: not options, not in `shown`, so every index below is still a position in it. */
  const groups = $derived(!query.trim() && custom.count > 0);
  /* Only a planner that is up may be offered: not before it has been built, not after a failed build, and not in the snapshot, where the
     pill says why instead. */
  const planOn = $derived(session.enabled && !PINNED);
  const last = $derived(shown.length + (planOn ? 1 : 0) - 1);

  $effect(() => { if (open) { query = ''; active = 0; } });
  $effect(() => { query; active = 0; });

  /* Closed whether or not it loaded: the title names the spacecraft on screen, and a refusal is said in the note under the bar
     (the old combobox put the current name back in its field; here there is no field to put it in). */
  function choose(i: number) {
    const entry = custom.entryAt(i);
    if (entry) { app.select(entry); open = false; }
  }

  /* The Plan row, or Enter on a query that matched nothing: the list closes (no focus is given back to the title: the planner is taking
     it), and the planner opens with what was typed as the name of the orbit. */
  function plan() {
    const name = query.trim();
    open = false;
    void session.open('picker', { name });
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, last); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); }
    else if (e.key === 'Enter') {
      if (active < shown.length && shown[active] !== undefined) { e.preventDefault(); choose(shown[active]!); }
      else if (planOn && active === shown.length) { e.preventDefault(); plan(); }
      else if (shown.length) { e.preventDefault(); choose(shown[0]!); }
      else if (planOn && query.trim()) { e.preventDefault(); plan(); }
    }
  }

  const activeId = $derived(planOn && active === shown.length ? 'soptplan' : shown.length ? 'sopt' + active : undefined);
  $effect(() => { document.getElementById(activeId ?? '')?.scrollIntoView({ block: 'nearest' }); });

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
        <span id="satname">{app.current?.name ?? 'Ground Track Console'}</span>
        <Icon name="chevron-down" size={20} />
      </button>
    </h1>
  {/snippet}

  <div class="search">
    <Icon name="search" size={16} />
    <input id="satsearch" type="search" role="combobox" aria-expanded="true" aria-controls={shown.length || planOn ? 'satlist' : undefined}
           aria-autocomplete="list" aria-haspopup="listbox"
           aria-activedescendant={activeId} autocomplete="off" spellcheck="false"
           placeholder="Search {app.catalogue.length.toLocaleString('en-US')} spacecraft or NORAD ID"
           bind:value={query} onkeydown={key}>
  </div>
  <!-- The options are not themselves focusable: the search field keeps focus and names the highlighted one through
       aria-activedescendant, the combobox pattern. So the keyboard is handled on the input, above. -->
  {#if shown.length || planOn}
    <ul id="satlist" role="listbox" aria-label="Spacecraft">
      {#each shown as idx, k (idx)}
        {@const c = custom.entryAt(idx)!}
        {@const mine = isCustom(c)}
        {#if groups && mine && !isCustom(custom.entryAt(shown[k - 1]!))}<li class="grp" role="presentation">Your orbits</li>{/if}
        {#if groups && !mine && (k === 0 || isCustom(custom.entryAt(shown[k - 1]!)))}<li class="grp" role="presentation">Catalogue</li>{/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li role="option" id="sopt{k}" data-idx={idx} aria-selected={idx === here} class:on={k === active} class:cu={mine}
            onclick={() => choose(idx)} onpointermove={() => (active = k)}>
          <span class="nm">{c.name}</span>{#if mine}<span class="id tag">custom</span>{:else}<span class="id mono">{c.satnum}</span>{/if}
        </li>
      {/each}
      <!-- One option after the real ones: the arrow keys reach it, Enter or a press opens the planner. It is a constant string; nothing typed
           reaches it. The press does not move focus (the list would take it back when it closes), the planner takes it. -->
      {#if planOn}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li role="option" id="soptplan" class="plan" class:on={active === shown.length} data-plan="1" aria-selected="false"
            onmousedown={e => e.preventDefault()} onclick={plan} onpointermove={() => (active = shown.length)}>+ Plan a custom orbit…</li>
      {/if}
    </ul>
  {/if}
  {#if !shown.length}<p class="note">Nothing in the catalogue matches that.</p>{/if}
  {#if more > 0}<p class="note">{more.toLocaleString('en-US')} more match. Keep typing to narrow them.</p>{/if}
  <p id="satcount" class="count mono">{app.catalogue.length.toLocaleString('en-US')}{custom.count ? ' + ' + custom.count + ' of yours' : ' spacecraft'}</p>
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
  li.grp { cursor: default; padding: var(--space-2) var(--space-3) var(--space-1); color: var(--muted); font-size: var(--fs-0); letter-spacing: .13em; text-transform: uppercase; }
  li.grp:hover { background: none; }
  li .tag { flex: none; padding: 0 var(--space-2); border: 1px solid var(--track); border-radius: var(--r-pill); color: var(--ink2); letter-spacing: .06em; }
  li.plan { margin-top: var(--space-1); border-top: 1px solid var(--rule); border-radius: 0 0 var(--r-2) var(--r-2); padding-top: var(--space-3); justify-content: flex-start; }
  li[aria-selected='true'] .nm { font-weight: 600; }
  .id { color: var(--muted); font-size: var(--fs-0); }
  .note { padding: var(--space-2) var(--space-3); color: var(--muted); font-size: var(--fs-1); }
  .count { margin: var(--space-2) 0 0; padding: 0 var(--space-3); color: var(--muted); font-size: var(--fs-0); }
</style>
