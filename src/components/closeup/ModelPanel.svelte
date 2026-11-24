<svelte:options css="injected" />
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { AXES, modelFrame, ownAttitude, type Axis } from '../../lib/models/attitude';
  import {
    checkSize, cleanModelName, inspect, isRefusal, MODEL_MAX_COUNT, readGlb, readGltf, sniff, suggestUnits, UNIT_SCALE, UNITS, type Units
  } from '../../lib/models/validate';
  import {
    AXES_CLASH, CHOOSE, CLOSE, DROP, FORWARD_LABEL, KEEP, KEPT, NOT_KEPT, ONLY_HERE, PANEL_LABEL, PARSE_FAILED, READING, REMOVE, REMOVED,
    SNAPSHOT, TIMED_OUT, UNIT_NAMES, UNITS_LABEL, UP_LABEL, heavy, refusal, sizeLine, tooMany
  } from '../../lib/text/models';
  import { loadModel, orient, type CraftModel, type Craft } from '../../scene/closeup-pass';
  import { attitudes } from '../../state/attitude.svelte';
  import { models } from '../../state/models.svelte';

  /* The reader's own model for the spacecraft in the close-up (CHANGES-FROM-LEGACY.md, L73). A file is chosen (or dropped on the
     globe), checked in the order lib/models/validate.ts gives before three sees any of it, read, and shown at once in place of the
     spacecraft's own, with its size as read so a file in millimetres shows itself up; the units and the two axes turn it until it looks
     right, and "Keep" files it in this browser (state/models.svelte.ts). Nothing is sent anywhere. "Remove" gives the spacecraft its own
     model back. Closing the panel without keeping puts back what was shown before. */
  let { craft, host, modelKey, spacecraft, onclose }: {
    craft: Craft; host: HTMLElement; modelKey: string; spacecraft: string; onclose: () => void;
  } = $props();

  const PARSE_MS = 30000;
  const PINNED = /(?:^|[?&])tle=embedded(?:&|$)/.test(location.search);

  let say = $state(''), warn = $state(''), busy = $state(false);
  let file: { name: string; bytes: ArrayBuffer; blob: Blob } | null = $state.raw(null);
  let base: CraftModel | null = null;                 // the parsed model, unturned and unscaled
  let units = $state<Units>('m'), forward = $state<Axis>('+Z'), up = $state<Axis>('+Y');
  let size = $state<[number, number, number] | null>(null);
  const mine = $derived(models.entry(modelKey));
  const clash = $derived(!modelFrame(forward, up));

  function preview(): void {
    if (!base || clash) return;
    const m = orient(base, modelFrame(forward, up), UNIT_SCALE[units]);
    size = m.size;
    craft.show({ ...m, own: ownAttitude(), id: '' });           // a model not kept flies the bare frame (L77)
  }

  async function choose(f: File): Promise<void> {
    if (busy) return;
    say = READING; warn = ''; busy = true; size = null;
    try {
      const sized = checkSize(f.size);
      if (sized) { say = refusal(sized); return; }
      const bytes = await f.arrayBuffer();
      const kind = sniff(new Uint8Array(bytes, 0, Math.min(64, bytes.byteLength)));
      if (!kind) { say = refusal({ why: 'not-gltf' }); return; }
      const read = kind === 'glb' ? readGlb(bytes) : readGltf(new TextDecoder().decode(bytes));
      if (isRefusal(read)) { say = refusal(read); return; }
      const looked = inspect(read.json, kind);
      if (isRefusal(looked)) { say = refusal(looked); return; }
      let timer = 0;
      const m = await Promise.race([
        loadModel(bytes),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(TIMED_OUT)), PARSE_MS); })
      ]).finally(() => clearTimeout(timer));
      base = m;
      file = { name: cleanModelName(f.name), bytes, blob: new Blob([bytes], { type: kind === 'glb' ? 'model/gltf-binary' : 'model/gltf+json' }) };
      units = suggestUnits(m.size); forward = '+Z'; up = '+Y';
      warn = looked.heavy ? heavy(looked.triangles) : '';
      say = '';
      preview();
    } catch (e) {
      say = e instanceof Error && e.message === TIMED_OUT ? TIMED_OUT : PARSE_FAILED + '.';
    } finally { busy = false; }
  }

  async function keep(): Promise<void> {
    if (!file || clash || busy) return;
    if (!mine && models.list.length >= MODEL_MAX_COUNT) { say = tooMany(MODEL_MAX_COUNT); return; }
    busy = true;
    const where = await models.put({ key: modelKey, name: file.name, size: file.blob.size, units, forward, up, added: new Date().toISOString() }, file.blob);
    attitudes.dropOwn(modelKey);                                 // the model it replaces took its way of flying with it (L77)
    busy = false;
    say = where === 'kept' ? KEPT : PINNED ? SNAPSHOT : NOT_KEPT;
    base = null; file = null;
  }

  async function remove(): Promise<void> {
    await models.remove(modelKey);
    attitudes.dropOwn(modelKey);                                 // and how the reader flew it (L77)
    say = REMOVED; base = null; file = null; size = null;
    onclose();
  }

  /* a file dropped anywhere on the globe while the panel is open */
  const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
  const drop = (e: DragEvent) => { const f = e.dataTransfer?.files[0]; if (f) { e.preventDefault(); void choose(f); } };
  $effect(() => {
    const h = host;
    h.addEventListener('dragover', over);
    h.addEventListener('drop', drop);
    return () => { h.removeEventListener('dragover', over); h.removeEventListener('drop', drop); };
  });
  onDestroy(() => base?.dispose());
</script>

<div class="panel" role="group" aria-label={PANEL_LABEL + ': ' + spacecraft}>
  <label class="pick">
    <span>{CHOOSE}</span>
    <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" disabled={busy}
           onchange={e => { const f = e.currentTarget.files?.[0]; if (f) void choose(f); e.currentTarget.value = ''; }}>
  </label>
  <p class="note">{DROP}. {ONLY_HERE}</p>
  {#if file}
    {#if size}<p class="note">{sizeLine(size[0], size[1], size[2])}</p>{/if}
    <label class="field">{UNITS_LABEL}
      <select onchange={e => { units = e.currentTarget.value as Units; preview(); }}>{#each UNITS as u}<option value={u} selected={u === units}>{UNIT_NAMES[u]}</option>{/each}</select>
    </label>
    <label class="field">{FORWARD_LABEL}
      <select onchange={e => { forward = e.currentTarget.value as Axis; preview(); }}>{#each AXES as a}<option value={a} selected={a === forward}>{a}</option>{/each}</select>
    </label>
    <label class="field">{UP_LABEL}
      <select onchange={e => { up = e.currentTarget.value as Axis; preview(); }}>{#each AXES as a}<option value={a} selected={a === up}>{a}</option>{/each}</select>
    </label>
    {#if clash}<p class="note warn">{AXES_CLASH}</p>{/if}
    {#if warn}<p class="note warn">{warn}</p>{/if}
  {/if}
  <p class="note" role="status">{say}</p>
  <div class="row">
    {#if file}<button type="button" class="btn primary" disabled={busy || clash} onclick={keep}>{KEEP}</button>{/if}
    {#if mine}<button type="button" class="btn" disabled={busy} onclick={remove}>{REMOVE}</button>{/if}
    <button type="button" class="btn" onclick={onclose}>{CLOSE}</button>
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding-top: 8px; border-top: 1px solid rgba(180, 200, 212, .22); }
  .pick { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-1); }
  .pick input { font-size: var(--fs-0); color: #DCE8EE; max-width: 100%; }
  .field { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--fs-0); }
  .field select { background: rgba(10, 16, 20, .9); color: #DCE8EE; border: 1px solid rgba(180, 200, 212, .35); border-radius: 3px; font-size: var(--fs-0); min-height: 28px; }
  .note { margin: 0; font-size: var(--fs-0); color: #AFC3CE; }
  .note:empty { display: none; }
  .warn { color: var(--warn); }
  .row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .btn {
    min-height: 30px; padding: 0 10px; border-radius: 3px; border: 1px solid rgba(180, 200, 212, .35); background: transparent;
    color: #DCE8EE; font-family: var(--font-mono); font-size: var(--fs-0); cursor: pointer;
  }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn.primary { background: var(--contact); border-color: var(--contact); color: #fff; }
  @media (pointer: coarse) { .btn, .field select { min-height: var(--tap); } }
</style>
