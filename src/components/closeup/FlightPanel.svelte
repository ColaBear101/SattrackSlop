<svelte:options css="injected" />
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { POINTINGS, type Attitude, type Axis, type Pointing } from '../../lib/models/attitude';
  import { POINTING_NAMES } from '../../lib/text/closeup-card';
  import {
    ANGLE_LABELS, CLOSE, FACE_LABEL, FACE_ORDER, FACES, NOT_KEPT, OWN, PANEL_LABEL, POINTING_LABEL, SIGNS, SNAPSHOT, STARS_NOTE, degrees,
    fieldName
  } from '../../lib/text/attitude';
  import type { Craft } from '../../scene/closeup-pass';
  import { attitudes } from '../../state/attitude.svelte';
  import { changed, typed } from './fields';

  /* How the model in the close-up flies (CHANGES-FROM-LEGACY.md, L77): where it points (along the track, toward the Sun, or held among
     the stars), which face it points, and three turns from there; the spin's three rates are on the card itself (CloseupCard.svelte),
     under its "Spin rates" button. Every change is the reader's setting
     for this model (state/attitude.svelte.ts), which the card hands the craft (scene/closeup-pass.ts) from the instant last drawn, so the
     model moves only as it is pointed anew; "Reset to its own" puts it back exactly as the page flies it. A slider is kept as it is let go
     and followed while it
     moves; a number field as it is changed (Enter, or the focus leaving it), when it shows what was kept (a value out of range is
     brought into it), and while it is typed in whenever what is typed is already a value it can hold. The selects take
     `selected` on their options and the fields `value`, never bind:value, which would bring a part of Svelte into the chunk the entry
     shares; the inputs are listened to at the element, as the transport's are, so an event that does not bubble still counts. Escape
     inside it closes it, with the focus back on its button, before anything else on the page hears it. */
  let { craft, id, own, spacecraft, onclose }: { craft: Craft; id: string; own: Attitude; spacecraft: string; onclose: () => void } = $props();

  const PINNED = /(?:^|[?&])tle=embedded(?:&|$)/.test(location.search);
  const ANGLES = ['yaw', 'pitch', 'roll'] as const;

  const a = $derived(attitudes.get(id) ?? own);
  let say = $state('');
  let root: HTMLElement | undefined = $state();

  function change(next: Attitude, keep: boolean): void {
    attitudes.set(id, next, own, keep);
    if (keep) say = attitudes.where === 'memory' ? (PINNED ? SNAPSHOT : NOT_KEPT) : '';
  }
  /* what each control holds: whole degrees from -180 to 180 */
  const toAngle = (v: number): number => Math.max(-180, Math.min(180, Math.round(v)));
  function setAngle(i: number, v: number, keep: boolean): void {
    if (!Number.isFinite(v)) return;
    const ypr: [number, number, number] = [a.ypr[0], a.ypr[1], a.ypr[2]];
    ypr[i] = toAngle(v);
    change({ ...a, ypr }, keep);
  }
  function reset(): void {
    attitudes.set(id, null, own, true);
    craft.resetAttitude(id);
    say = '';
  }

  /* Escape inside the panel is the panel's: heard on it, before the page's own listeners on the window (the answer sheet's) */
  $effect(() => {
    const el = root;
    if (!el) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onclose(); } };
    el.addEventListener('keydown', esc);
    return () => el.removeEventListener('keydown', esc);
  });

  onDestroy(() => attitudes.flush());
</script>

<div class="panel" role="group" aria-label={PANEL_LABEL + ': ' + spacecraft} bind:this={root}>
  <label class="field">{POINTING_LABEL}
    <select id="fly-pointing" onchangecapture={e => change({ ...a, pointing: e.currentTarget.value as Pointing }, true)}>
      {#each POINTINGS as p}<option value={p} selected={p === a.pointing}>{POINTING_NAMES[p]}</option>{/each}
    </select>
  </label>
  {#if a.pointing === 'stars'}
    <p class="note">{STARS_NOTE}</p>
  {:else}
    <label class="field">{FACE_LABEL[a.pointing]}
      <select id="fly-face" onchangecapture={e => change({ ...a, face: e.currentTarget.value as Axis }, true)}>
        {#each FACE_ORDER as f}<option value={f} selected={f === a.face}>{FACES[f]}</option>{/each}
      </select>
    </label>
  {/if}
  {#each ANGLES as nm, i}
    <div class="turn">
      <label for={'fly-' + nm}>{ANGLE_LABELS[i]}</label>
      <input id={'fly-' + nm} type="range" min="-180" max="180" step="1" value={a.ypr[i]} aria-valuetext={degrees(a.ypr[i]!)} aria-describedby="fly-signs"
             oninputcapture={e => setAngle(i, +e.currentTarget.value, false)} onchangecapture={e => setAngle(i, +e.currentTarget.value, true)}>
      <input id={'fly-' + nm + '-n'} type="number" min="-180" max="180" step="1" value={a.ypr[i]} aria-label={fieldName(ANGLE_LABELS[i])}
             aria-describedby="fly-signs"
             oninputcapture={e => { const v = typed(e.currentTarget, toAngle); if (v !== null) setAngle(i, v, false); }}
             onchangecapture={e => changed(e.currentTarget, v => setAngle(i, v, true), () => a.ypr[i]!)}>
    </div>
  {/each}
  <p class="note" id="fly-signs">{SIGNS}</p>
  <p class="note" id="fly-say" role="status">{say}</p>
  <div class="row">
    <button type="button" class="btn" id="fly-own" onclick={reset}>{OWN}</button>
    <button type="button" class="btn" id="fly-close" onclick={onclose}>{CLOSE}</button>
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding-top: 8px; border-top: 1px solid rgba(180, 200, 212, .22); }
  .field { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--fs-0); }
  .field select { background: rgba(10, 16, 20, .9); color: #DCE8EE; border: 1px solid rgba(180, 200, 212, .35); border-radius: 3px; font-size: var(--fs-0); min-height: 28px; }
  .turn { display: grid; grid-template-columns: 4.6em minmax(0, 1fr) 4.6em; align-items: center; gap: var(--space-2); font-size: var(--fs-0); }
  .turn input[type='range'] { width: 100%; min-width: 0; margin: 0; accent-color: var(--contact); }
  .turn input[type='number'] {
    width: 100%; min-width: 0; box-sizing: border-box; min-height: 28px; padding: 0 4px; border-radius: 3px; border: 1px solid rgba(180, 200, 212, .35);
    background: rgba(10, 16, 20, .9); color: #DCE8EE; font-family: var(--font-mono); font-size: var(--fs-0);
  }
  .note { margin: 0; font-size: var(--fs-0); color: #AFC3CE; }
  .note:empty { display: none; }
  .row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .btn {
    min-height: 30px; padding: 0 10px; border-radius: 3px; border: 1px solid rgba(180, 200, 212, .35); background: transparent;
    color: #DCE8EE; font-family: var(--font-mono); font-size: var(--fs-0); cursor: pointer;
  }
  .btn:hover { background: rgba(180, 200, 212, .16); }
  /* a finger: every control a full target high */
  @media (pointer: coarse) { .btn, .field select, .turn input { min-height: var(--tap); } }
</style>
