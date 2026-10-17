<script lang="ts">
  import type { Analysis } from '../../lib/types';
  import { app } from '../../state/app.svelte';
  import { passfilter } from '../../state/passfilter.svelte';
  import { siteClock } from '../../lib/text/passfacts';
  import { FILTER_BUTTON, FILTER_BUTTON_ON, FILTER_TITLE, hiddenSay, shownSay } from '../../lib/text/passfilter';
  import Button from '../ui/Button.svelte';
  import Popover from '../ui/Popover.svelte';

  /* The pass list's filter (CHANGES-FROM-LEGACY.md, L56): the button over the list, the panel it opens, and the lines under it.
     A chunk of its own, with the filter's code and words, which the list asks for once there are passes; the panel is another,
     asked for at the first press. What it hands the list is the indices of the passes to show, with the analysis they are of
     (null: every pass), so that a list already showing a new analysis never reads the last one's indices. */
  let { kept = $bindable(null) }: { kept?: { D: Analysis; i: number[] } | null } = $props();

  const D = $derived(app.analysis);
  const shown = $derived(passfilter.shown(D, siteClock(app.site).offsetAt));
  $effect(() => { kept = D && shown ? { D, i: shown } : null; });

  const n = $derived(D?.passes.length ?? 0);
  const say = $derived(shown && n ? shownSay(shown.length, n, passfilter.spec!) : '');
  const hid = $derived(shown && n && !shown.includes(app.selPass) ? hiddenSay(app.selPass) : '');

  let Panel = $state.raw<typeof import('./PassFilter.svelte').default | null>(null);
  /* the first press waits for the panel, then opens it (Popover then moves the focus into it); one that fails leaves it shut, to be pressed again */
  function press(toggle: () => void) {
    if (Panel) { toggle(); return; }
    import('./PassFilter.svelte').then(m => { Panel = m.default; toggle(); }, () => {});
  }
</script>

<Popover label={FILTER_TITLE} width={320} boundary=".rail.side, .rail.sheet .body">
  {#snippet trigger(t)}
    <Button {...t} id="passfilterbtn" size="sm" data-on={passfilter.on ? '' : undefined} onclick={() => press(t.onclick)}>{passfilter.on ? FILTER_BUTTON_ON : FILTER_BUTTON}</Button>
  {/snippet}
  {#if Panel}<Panel />{/if}
</Popover>
<div class="say" class:has={!!(say || hid)} role="status">
  {#if say}<p id="passfiltersay">{say}</p>{/if}
  {#if hid}<p id="passfilterhid">{hid}</p>{/if}
</div>

<style>
  /* a filter on: the button ringed in the contact colour, and its words say so */
  :global(#passfilterbtn[data-on]) { border-color: var(--contact); box-shadow: inset 0 0 0 1px var(--contact); }
  .say { display: grid; gap: var(--space-1); }
  .say.has { margin-top: var(--space-2); }
  .say p { margin: 0; color: var(--ink2); font-size: var(--fs-0); }
</style>
