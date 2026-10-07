<script lang="ts">
  import meta from '../../../data/catalogue.meta.json';
  import { app, PINNED } from '../../state/app.svelte';
  import { isCustom } from '../../lib/planner/custom';
  import { session } from '../planner/session.svelte';
  import { live } from '../../state/live.svelte';
  import { wall } from '../../state/wall.svelte';
  import { iso } from '../../lib/text/fmt';
  import { ages } from '../../lib/text/provenance';
  import Picker from './Picker.svelte';
  import ObserverChip from './ObserverChip.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import Button from '../ui/Button.svelte';
  import { PINNED_SENTENCE } from '../../lib/text/planner';

  const E = $derived(app.analysis?.E);
  /* A snapshot of the entry's fields, new on every load: an orbit the reader designed is edited in place, and a view that read its name
     off an object whose identity did not change would never hear of it. */
  const entry = $derived.by(() => {
    void app.rev;
    const e = app.entry;
    return e ? { name: e.name, l1: e.l1, l2: e.l2, satnum: e.satnum, custom: isCustom(e) } : null;
  });
  const built = new Date(meta.fetched);
  /* how old the element set is, against the real time of day (the transport's clock can be anywhere) */
  const A = $derived(entry && E ? ages({
    custom: entry.custom, prov: live.provOf(entry.satnum), embedded: app.isEmbedded(entry),
    now: wall.now, epoch: E.epoch, name: entry.name, satnum: entry.satnum, fetched: built, source: meta.source, pinned: PINNED
  }) : null);
</script>

<header class="bar bar-top">
  <div class="id">
    <Picker />
    {#if E && A && entry}
      <p class="ids mono">
        <!-- An orbit the reader designed has no catalogue number, and a made-up one beside a real label is the thing to avoid: the two
             numbers and their separators are hidden for it and the chip, which opens it in the planner, is shown in their place. The nodes
             stay, and say what they are, so nothing reads a number that is not there. -->
        <button type="button" class="chip custom-chip" id="customchip" hidden={!entry.custom}><span class="dot"></span>Custom orbit · edit</button>
        <span hidden={entry.custom}>NORAD <b id="idnorad">{entry.custom ? 'none · custom' : E.satnum}</b></span><span class="sep wide-only" hidden={entry.custom}>·</span>
        <span class="wide-only" hidden={entry.custom}>COSPAR <b id="idcospar">{entry.custom ? '—' : E.cospar}</b></span><span class="sep wide-only" hidden={entry.custom}>·</span>
        <span class="wide-only">Epoch <b id="idepoch">{iso(E.epoch)}</b></span>
        {#if PINNED}
          <span class="chip snapshot" title="The embedded element sets, each window opening at its set's epoch: the figures in the README">assignment snapshot</span>
        {/if}
        <span class="chip" id="agechip" class:stale={A.chip.stale} title={A.chip.title}><span id="agetext">{A.chip.text}</span></span>
      </p>
    {/if}
  </div>
  <div class="tools">
    <div class="t-obs"><ObserverChip /></div>
    <!-- The planner is a chunk of its own: this opens it, bringing it in first if it is not yet here. Once it is, its own listener takes the
         click, and under the assignment snapshot the button says why it does nothing. The controller owns aria-expanded. -->
    <div class="t-plan" hidden={session.failed}>
      <Button variant="default" id="planopen" aria-expanded="false" aria-controls="planner" aria-label="Plan an orbit"
              aria-disabled={PINNED ? 'true' : undefined} title={PINNED ? PINNED_SENTENCE : undefined}
              onclick={() => { if (!PINNED && !session.enabled) void session.open('pill'); }}>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.6" fill="none"/></svg><span>Plan<span class="pl-more">{' '}an orbit</span></span>
      </Button>
    </div>
    <div class="t-theme"><ThemeToggle /></div>
  </div>
</header>
<p class="plannote" id="plannote" hidden={!PINNED}>{#if PINNED}{PINNED_SENTENCE}{' '}<a href="?">Back to the live element sets</a>.{/if}</p>

<style>
  .bar {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-4);
    min-height: var(--bar-h); padding: var(--space-2) var(--space-4);
    background: var(--chrome); color: var(--chromeink); border-bottom: 1px solid var(--chromerule);
  }
  .id { min-width: 0; flex: 1 1 340px; }
  .ids { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--space-2); margin: 0; color: var(--muted); font-size: var(--fs-0); }
  .ids b { font-weight: 500; color: var(--ink2); }
  .sep { opacity: .5; }
  .chip {
    display: inline-flex; align-items: center; padding: 0 var(--space-2); border: 1px solid var(--chromerule);
    border-radius: var(--r-pill); font-size: var(--fs-0); color: var(--muted); margin-left: var(--space-1);
  }
  .chip[hidden] { display: none; }
  .custom-chip { background: none; font-family: inherit; color: var(--ink2); border-color: var(--track); cursor: pointer; }
  .custom-chip:hover { color: var(--ink); }
  .custom-chip .dot { width: 8px; height: 8px; margin-right: var(--space-1); border-radius: 50%; background: var(--observer); }
  .plannote { margin: 0; padding: var(--space-1) var(--space-4); background: var(--sunk); border-bottom: 1px solid var(--rule); color: var(--ink2); font-size: var(--fs-1); }
  .plannote[hidden] { display: none; }
  .chip.stale { border-color: var(--warn); color: var(--warn); }
  .chip.snapshot { border-color: var(--link); color: var(--link); }
  .tools { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  /* The pill says "Plan" alone where the header is tight (its name for a screen reader is "Plan an orbit" either way): it is the one cell
     that grows with its words, and the header must be as tall with it as without it. The old page's rule, at the old page's width. */
  @media (max-width: 1080px) { .pl-more { display: none; } }

  /* narrow: the name and the theme toggle share a row, the observer and the planner sit under them, and the
     ids shrink to NORAD and the age chip, so the first screen is mostly the map */
  @media (max-width: 719px) {
    .bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'id theme' 'obs plan'; align-items: center; padding: var(--space-2) var(--space-3); }
    .id { grid-area: id; flex: none; }
    .tools { display: contents; }
    .t-theme { grid-area: theme; justify-self: end; }
    .t-obs { grid-area: obs; justify-self: start; min-width: 0; }
    .t-plan { grid-area: plan; justify-self: end; }
    .wide-only { display: none; }
  }
  /* wide: one row of fixed height, because the console below is sized to what is left of the screen */
  @media (min-width: 1100px) {
    .bar { flex-wrap: nowrap; height: var(--bar-h); }
    .ids { flex-wrap: nowrap; white-space: nowrap; overflow: hidden; }
  }
</style>
