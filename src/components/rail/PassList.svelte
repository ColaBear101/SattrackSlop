<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { sun } from '../../state/engine';
  import { compass } from '../../lib/text/fmt';
  import { clipSay, passDays, passRowText, siteClock } from '../../lib/text/passfacts';
  import type { Analysis } from '../../lib/types';
  import Rich from '../ui/Rich.svelte';

  /* The access windows, one row per pass. A row is a button: it picks the pass (the sky plot and the facts under it
     follow) and takes the clock to its culmination, paused there. Times are UTC with the site's own time under them.
     A pass cut by the window edge carries a mark, a tooltip and, for a screen reader, the words.

     The rows are grouped by the observer's calendar day of their AOS (CHANGES-FROM-LEGACY.md, L55), under a header that
     stays at the top of the rail while its day scrolls under it: the site's date, and the Sun's times there that day, which
     come with their words in a chunk of their own (lib/text/suntimes.ts), asked for once there are passes. A row flown
     before the clock's instant is grey and the one in view at it is ringed, from clock.tick; a line under the list says
     what they mean, and that the instant is sim time when the clock is not now, and each such row is described in the same
     words to a screen reader. Nothing in a row's own text, label, title or index changes. */
  const passes = $derived(app.analysis?.passes ?? []);
  const c = $derived(siteClock(app.site));

  /* The filter (CHANGES-FROM-LEGACY.md, L56): it hides rows, and nothing else. A row shown keeps its index, its data-i and
     what pressing it selects; a day with no row shown goes with its header. The filter's bar over the list (the button, the
     panel it opens, the lines under it) is a chunk of its own, asked for once there are passes, which hands back the indices
     to show with the analysis they are of: indices of an analysis no longer on screen are not read. Until it has come the
     list shows every pass, and the bar's height is kept for it. */
  let Bar = $state.raw<typeof import('./PassFilterBar.svelte').default | null>(null);
  $effect(() => { if (passes.length && !Bar) import('./PassFilterBar.svelte').then(m => { Bar = m.default; }, () => {}); });
  let kept = $state.raw<{ D: Analysis; i: number[] } | null>(null);
  const days = $derived.by(() => {
    const all = passDays(passes, c), k = kept && kept.D === app.analysis ? new Set(kept.i) : null;
    return k ? all.map(d => ({ ...d, i: d.i.filter(i => k.has(i)) })).filter(d => d.i.length) : all;
  });
  const ms = $derived(clock.tick.ms);
  /* the passes are in time order and do not overlap: the flown ones are the first `past`, and at most one is in view */
  const past = $derived(passes.filter(p => p.t1ms < ms).length);
  const live = $derived(passes.findIndex(p => p.t0ms <= ms && ms <= p.t1ms));
  let st = $state.raw<typeof import('../../lib/text/suntimes') | null>(null);
  $effect(() => { if (passes.length && !st) import('../../lib/text/suntimes').then(m => { st = m; }, () => {}); });
  /* "now" only while the clock runs at real time by the wall clock: a pause or a rate change is read here, so the line turns to
     sim time at the very pause, with no tick after it */
  const sim = $derived(st ? st.simTime(ms, Date.now(), clock.playing, clock.rate) : true);
  /* the line is the key to the marks on screen: with a filter on, it speaks of grey rows only when one is shown, and of the
     ringed row only when it is (with every row shown, these are `past` and `live` themselves) */
  const onScreen = $derived(days.flatMap(d => d.i));
  const note = $derived(st ? st.flownNote(onScreen.some(i => i < past) ? past : 0, onScreen.includes(live) ? live : -1, sim) : '');
  const said = $derived(st ? st.rowState(sim) : null);
  const described = (i: number): string | undefined =>
    !said ? undefined : i < past ? 'passflown-past' : i === live ? 'passflown-live' : undefined;
</script>

{#if passes.length}<div class="pfbar">{#if Bar}<Bar bind:kept />{/if}</div>{/if}
<div id="passlist" class="list">
  {#each days as d (d.key)}
    <div class="day">
      <div class="dh" title={st?.SUN_NOTE}>{#if st}<Rich value={st.dayHead(d, c, sun, app.site)} />{/if}</div>
      {#each d.i as i (passes[i]!.t0ms)}
        {@const p = passes[i]!}
        {@const t = passRowText(p, c)}
        <button type="button" class="passrow" class:past={i < past} class:live={i === live} data-i={i} aria-current={i === app.selPass}
                title={clipSay(p) ? '* ' + clipSay(p) : undefined} aria-label="Pass {i + 1}, {t.label}" aria-describedby={described(i)}
                onclick={() => app.selectPass(i, true)}>
          <span class="n">{i + 1}</span>
          <span class="t mono">{t.utc}<small>{t.sub}</small></span>
          <span class="e mono">{t.peak}<small>{compass(p.aosAz)}→{compass(p.losAz)}</small></span>
        </button>
      {/each}
    </div>
  {/each}
  <!-- said only when there is no pass at all: a filter that hides every one says so in its own line above -->
  {#if !passes.length}<p class="none">No pass clears the 5° mask in this window.</p>{/if}
</div>
{#if note}<p class="flown" id="passflown">{note}</p>{/if}
<!-- what a grey row and the ringed row are, for a screen reader: each such row is described by one of these (never shown) -->
{#if said}<div hidden><span id="passflown-past">{said.past}</span><span id="passflown-live">{said.live}</span></div>{/if}

<style>
  .pfbar { min-height: 28px; margin-bottom: var(--space-3); }   /* the filter's button, kept room for while its chunk is on the way */
  .list, .day { display: grid; }
  /* the day's header: opaque, over the rows of its own day as they scroll under it, and gone with the last of them */
  .dh {
    position: sticky; top: var(--sticky-top, 0); z-index: 1; padding: var(--space-2) 0; border-top: 1px solid var(--rule);
    min-height: calc(2lh + var(--space-4)); background: var(--panel); color: var(--muted); font-size: var(--fs-0);   /* two lines kept while the words are on the way */
  }
  .dh :global(b) { color: var(--ink); font-size: var(--fs-1); }
  .passrow {
    display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: start; gap: var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) 0; border: 0; border-top: 1px solid var(--rule);
    background: transparent; color: var(--ink); text-align: left; font-size: var(--fs-1);
    scroll-margin-top: 96px;   /* a row given the focus under its day's header (three lines at most) is scrolled out from under it */
  }
  .passrow:hover { background: var(--hover); }
  small { display: block; color: var(--muted); font-size: var(--fs-0); }
  .e { text-align: right; }
  .n {
    display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--rule); border-radius: var(--r-pill);
    background: var(--panel); font-family: var(--font-mono); font-size: var(--fs-0);
  }
  /* flown: the muted ink (4.5:1 and more on the panel, both themes), not a fade; in view: the number ringed in the contact colour */
  .past, .past .n { color: var(--muted); }
  .live .n { border-color: var(--contact); box-shadow: inset 0 0 0 1px var(--contact); color: var(--contact); }
  .passrow[aria-current='true'] { background: color-mix(in srgb, var(--contact) 9%, transparent); box-shadow: inset 3px 0 0 var(--contact); padding-left: var(--space-2); }
  .passrow[aria-current='true'] .n { background: var(--contact); border-color: var(--contact); color: var(--sel-ink); }   /* white on the light theme's orange, the panel's own dark on the dark theme's: 4.5:1 on both */
  .none { color: var(--muted); font-size: var(--fs-1); }
  .flown { margin: var(--space-2) 0 0; color: var(--muted); font-size: var(--fs-0); }
  @media (pointer: coarse) { .n { width: var(--tap); height: var(--tap); } .passrow { grid-template-columns: var(--tap) minmax(0, 1fr) auto; } .pfbar { min-height: var(--tap); } }
</style>
