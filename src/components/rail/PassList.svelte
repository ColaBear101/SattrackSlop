<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { compass } from '../../lib/text/fmt';
  import { clipSay, passRowText, siteClock } from '../../lib/text/passfacts';

  /* The access windows, one row per pass. A row is a button: it picks the pass (the sky plot and the facts under it
     follow) and takes the clock to its culmination, paused there. Times are UTC with the site's own time under them.
     A pass cut by the window edge carries a mark, a tooltip and, for a screen reader, the words. */
  const passes = $derived(app.analysis?.passes ?? []);
  const c = $derived(siteClock(app.site));
</script>

<div id="passlist" class="list">
  {#each passes as p, i (p.t0ms)}
    {@const t = passRowText(p, c)}
    <button type="button" class="passrow" data-i={i} aria-current={i === app.selPass} title={clipSay(p) ? '* ' + clipSay(p) : undefined}
            aria-label="Pass {i + 1}, {t.label}" onclick={() => app.selectPass(i, true)}>
      <span class="n">{i + 1}</span>
      <span class="t mono">{t.utc}<small>{t.sub}</small></span>
      <span class="e mono">{t.peak}<small>{compass(p.aosAz)}→{compass(p.losAz)}</small></span>
    </button>
  {:else}
    <p class="none">No pass clears the 5° mask in this window.</p>
  {/each}
</div>

<style>
  .list { display: grid; }
  .passrow {
    display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: start; gap: var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) 0; border: 0; border-top: 1px solid var(--rule);
    background: transparent; color: var(--ink); text-align: left; font-size: var(--fs-1);
  }
  .passrow:hover { background: var(--hover); }
  small { display: block; color: var(--muted); font-size: var(--fs-0); }
  .e { text-align: right; }
  .n {
    display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--rule); border-radius: var(--r-pill);
    background: var(--panel); font-family: var(--font-mono); font-size: var(--fs-0);
  }
  .passrow[aria-current='true'] { background: color-mix(in srgb, var(--contact) 9%, transparent); box-shadow: inset 3px 0 0 var(--contact); padding-left: var(--space-2); }
  .passrow[aria-current='true'] .n { background: var(--contact); border-color: var(--contact); color: #fff; }
  .none { color: var(--muted); font-size: var(--fs-1); }
  @media (pointer: coarse) { .n { width: var(--tap); height: var(--tap); } .passrow { grid-template-columns: var(--tap) minmax(0, 1fr) auto; } }
</style>
