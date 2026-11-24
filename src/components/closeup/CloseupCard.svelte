<svelte:options css="injected" />
<script module lang="ts">
  /* whether the spin's rates are shown, for as long as the page is open: the card is made anew each time the close-up is pressed */
  let spinShown = true;
  /* whether the card is folded to its title bar, likewise */
  let cardFolded = false;
</script>
<script lang="ts">
  import { mount, onDestroy, tick, unmount, untrack } from 'svelte';
  import { builtInFor, type BuiltIn } from '../../lib/models/registry';
  import { MAX_SPIN, modelFrame, ownAttitude, sameAttitude, spinRate, type Attitude, type V3 } from '../../lib/models/attitude';
  import { ownId } from '../../lib/models/attitude-record';
  import { modelKey, UNIT_SCALE } from '../../lib/models/validate';
  import type { ModelEntry } from '../../lib/models/index-record';
  import type { AppHost, GlobeHost } from './closeup';
  import {
    CARD_LABEL, CLOCK_NOTE, CREDITS, FLIGHT, HIDE_CARD, HINT, IN_SHADOW, MODEL_NAMES, NO_POSITION, NOT_KEPT, OWN_SPIN, REALISTIC, RESET,
    RESET_TURN, SHOW_CARD, SNAPSHOT,
    SPIN_BUTTON, SPIN_GROUP, SPIN_LABELS, SPIN_ORDER, SPIN_SIGNS, STOP_SPIN, YOUR_MODEL, failed, flightLine, loading, noModel, period, rateField,
    rateText, yours
  } from '../../lib/text/closeup-card';
  import { changed, typed } from './fields';
  import { plain, type Inline } from '../../lib/text/rich';
  import { loadModel, MODEL_URLS, orient, type Craft } from '../../scene/closeup-pass';
  import { attitudes } from '../../state/attitude.svelte';
  import { models } from '../../state/models.svelte';

  /* A credit is words and links only. They are drawn here rather than by ui/Rich.svelte, which lives in the entry chunk: a lazy chunk
     that imports anything of the entry makes the bundler split the entry's shared modules into chunks of their own, which the first
     screen would then fetch one by one. Text nodes, never markup, as Rich does. */
  const parts = (x: Inline): ({ text: string } | { href: string; text: string })[] =>
    Array.isArray(x) ? x.flatMap(parts) : typeof x === 'string' ? [{ text: x }] : 'link' in x ? [{ href: x.link.href, text: x.link.text }] : [{ text: plain(x) }];

  /* The card over the close-up (CHANGES-FROM-LEGACY.md, L72, L73): which spacecraft this is, whose model it wears and the credit its
     source asks for, how the model is coming along, whether the craft is in the Earth's shadow, the way back to the first view, the
     realistic Earth behind it one tick away (it is the Layers panel's "Realistic" surface; unticking goes back to the surface that was on
     before), and the reader's own model (state/models.svelte.ts), which wins over the page's and whose panel is a chunk of its own.
     Shown only while the close-up is the camera; a model is loaded only then, and a spacecraft chosen while one is still loading wins
     (each load is numbered, as the lifetime requests are). */
  let { craft, globe, app, host }: { craft: Craft; globe: GlobeHost; app: AppHost; host: HTMLElement } = $props();

  const open = $derived(globe.mode === 'close');
  /* the globe's box hides its key and its drag hint while this card stands where they were (Globe.svelte's `.closeup` rules) */
  $effect(() => { host.classList.toggle('closeup', open); });
  const entry = $derived(app.analysis?.entry ?? null);
  const name = $derived(entry?.name ?? '');
  const key = $derived(entry ? modelKey(entry as { satnum: string; custom?: boolean; cid?: string }) : '');
  /* a reader's own orbit has a placeholder number and never wears a built-in model (the flag, not the number, as every guard) */
  const built = $derived<BuiltIn | null>(entry && !entry.custom ? builtInFor(entry.satnum) : null);
  const mine = $derived<ModelEntry | null>(key ? models.entry(key) : null);
  /* which of the reader's models it is, as a string: the list is read again whole on another tab's change and on every write, and a new
     object of the same model must not ask for it again (it would cancel a load already on its way, L77) */
  const mineId = $derived(mine ? [mine.key, mine.added, mine.units, mine.forward, mine.up].join(' ') : '');

  let status = $state('');
  let credit = $state<Inline | null>(null);
  let shownId: string | null = null;
  let wantId = '';
  let seq = 0;
  /* the model on the craft, for how it flies (L77): its id (lib/models/attitude-record.ts) and its own attitude */
  let drawn = $state.raw<{ id: string; own: Attitude } | null>(null);
  /* another model on its way: until it is on the craft, the model drawn is not the spacecraft named, so its flight row and panel are put
     away (a setting made then would be kept for the model going, under the name of the one coming) */
  let pending = $state(false);

  async function show(name: string, b: BuiltIn | null, own: ModelEntry | null, force = false): Promise<void> {
    const url = b ? MODEL_URLS[b.id] : undefined;
    if (!own && (!b || !url)) {
      ++seq; wantId = ''; shownId = null; credit = null; drawn = null; pending = false;   // a load still on its way is let go
      craft.show(null);
      status = noModel(name);
      return;
    }
    const id = own ? 'own:' + own.key + ':' + own.added + ':' + own.units + own.forward + own.up : b!.id;
    if (!force && id === wantId) return;                 // on the craft already, or on its way: asking again cancels nothing (L77)
    const my = ++seq;
    wantId = id;
    credit = own ? yours(own.name) : CREDITS[b!.id];
    if (!force && shownId === id) { status = ''; pending = false; return; }   // back to the one on the craft while another was loading: that one is let go
    status = loading(own ? own.name : MODEL_NAMES[b!.id]);
    pending = shownId !== id;
    try {
      let m;
      if (own) {
        const bytes = await models.bytes(own.key);
        if (!bytes) throw new Error('gone');
        m = orient(await loadModel(bytes), modelFrame(own.forward, own.up), UNIT_SCALE[own.units]);
      } else m = await loadModel(url!, { centre: false });
      if (my !== seq) { m.dispose(); return; }
      shownId = id;
      const aid = own ? ownId(own.key, own.added) : b!.id, mineOwn = own ? ownAttitude() : ownAttitude(b!.spin ?? null);
      const base = own ? m : { ...m, radius: b!.frame ?? m.radius };
      craft.show({ ...base, own: mineOwn, id: aid, attitude: attitudes.get(aid) });
      drawn = { id: aid, own: mineOwn };
      pending = false;
      status = '';
    } catch {
      if (my === seq) { shownId = null; wantId = ''; drawn = null; pending = false; craft.show(null); status = failed(own ? own.name : MODEL_NAMES[b!.id]); }
    }
  }

  /* asked again only when something it shows changes: the close-up opened, another spacecraft, another model, or another name */
  $effect(() => {
    const on = open, nm = name, k = key, b = built;
    void mineId;
    if (!on || !k) return;
    untrack(() => void show(nm, b, models.entry(k)));
  });

  /* How the model flies (L77): the reader's setting for the model on the craft, followed as it changes (the panel, another tab). The card
     says it whenever it is the reader's, so that a setting kept on an earlier visit is never taken for how the spacecraft flies. */
  const flying = $derived(drawn ? attitudes.get(drawn.id) : null);
  const yoursFlying = $derived(!!drawn && !!flying && !sameAttitude(flying, drawn.own));
  $effect(() => {
    const d = drawn, a = flying;
    untrack(() => { if (d) craft.setAttitude(a, d.id); });
  });

  /* The spin's three rates (L77), on the card itself under a button that shows and hides them: a slider and a number for each of the
     model's own axes, to a tenth of a degree a second from -MAX_SPIN to MAX_SPIN. A change is the reader's setting for the model drawn,
     kept as the "How it flies" panel's are (a slider as it is let go, followed while it moves; a number as it is changed), and the craft
     takes it from the instant last drawn, so the model turns on from where it is. */
  const PINNED = /(?:^|[?&])tle=embedded(?:&|$)/.test(location.search);
  let spinOpen = $state(spinShown);
  let spinSay = $state('');
  const zero: V3 = [0, 0, 0];
  const flown = $derived(drawn ? flying ?? drawn.own : null);
  const rates = $derived<V3>((flown && spinRate(flown.spin)) ?? zero);
  const toRate = (v: number): number => Math.max(-MAX_SPIN, Math.min(MAX_SPIN, Math.round(v * 10) / 10));
  function setSpin(r: V3 | null, keep: boolean): void {
    const d = drawn, f = flown;
    if (!d || !f) return;
    attitudes.set(d.id, { ...f, spin: r && (r[0] || r[1] || r[2]) ? { rate: r } : null }, d.own, keep);
    if (keep) spinSay = attitudes.where === 'memory' ? (PINNED ? SNAPSHOT : NOT_KEPT) : '';
  }
  function setRate(i: number, v: number, keep: boolean): void {
    if (!Number.isFinite(v)) return;
    const r: [number, number, number] = [rates[0], rates[1], rates[2]];
    r[i] = toRate(v);
    setSpin(r, keep);
  }
  function toggleSpin(): void { spinOpen = spinShown = !spinOpen; }
  /* "Reset orientation": the model straight again from the instant last drawn (along the track, its front leading, no offsets), the turns
     made so far let go and the spin rates kept, turning on from there. The craft is told first, so the setting stored after it finds the
     model already flown so and moves nothing. */
  function level(): void {
    const d = drawn, f = flown;
    if (!d || !f) return;
    const next: Attitude = { pointing: 'track', face: '+Z', ypr: [0, 0, 0], spin: f.spin };
    craft.levelTurn(next, d.id);
    attitudes.set(d.id, next, d.own, true);
    spinSay = attitudes.where === 'memory' ? (PINNED ? SNAPSHOT : NOT_KEPT) : '';
  }
  /* the card folded to its title bar and opened again, the focus staying on the button that does it */
  let folded = $state(cardFolded);
  function fold(): void { folded = cardFolded = !folded; }
  onDestroy(() => attitudes.flush());

  /* whether the craft is in the Earth's shadow: the pass knows, as of its last frame */
  let dark = $state(false);
  const poll = setInterval(() => { if (open) dark = craft.shadowed; }, 700);
  onDestroy(() => clearInterval(poll));

  let before = 'night';
  function realistic(on: boolean): void {
    if (on) { if (globe.surface !== 'real') before = globe.surface; globe.setSurface('real'); }
    else globe.setSurface(before === 'real' ? 'night' : before);
  }

  /* The reader's own model: its panel is a chunk of its own, fetched at the first press and mounted into the card (as the AR view and
     the decay comparison are mounted; an {#await} block here would add its runtime to the Svelte chunk the entry shares). */
  let panel = $state(false), panelFailed = $state(false);
  let slot: HTMLElement | undefined = $state();
  let mounted: Record<string, unknown> | null = null;
  let uploads: Promise<typeof import('./uploads')> | null = null;
  async function openPanel(): Promise<void> {
    if (fpanel) closeFlight();                                 // one panel at a time: the model's preview is not the model flown
    panel = true; panelFailed = false;
    try {
      const u = await (uploads ??= import('./uploads').catch(e => { uploads = null; throw e; }));
      if (!panel || !slot || !entry || mounted) return;
      mounted = mount(u.ModelPanel, { target: slot, props: { craft, host, modelKey: key, spacecraft: entry.name, onclose: closePanel } });
    } catch { panelFailed = true; }
  }
  function closePanel(): void {
    panel = false;
    if (mounted) { void unmount(mounted); mounted = null; }
    if (entry) void show(entry.name, built, mine, true);      // put back what the preview replaced
  }
  /* another spacecraft, or the close-up left: the panel was for the one before */
  let lastKey = '';
  $effect(() => {
    const k = key, on = open;
    untrack(() => { if (panel && (!on || (lastKey && k !== lastKey))) closePanel(); lastKey = k; });
  });

  /* How it flies (L77): its panel is a chunk of its own too, fetched at the first press, for the model on the craft. It closes when another
     spacecraft is chosen, another model is put up or the close-up is left, and the focus goes back to its button when it is closed from
     inside. */
  let fpanel = $state(false), fpanelFailed = $state(false);
  let fslot: HTMLElement | undefined = $state();
  let fbutton: HTMLButtonElement | undefined = $state();
  let fmounted: Record<string, unknown> | null = null;
  let flight: Promise<typeof import('./flight')> | null = null;
  async function openFlight(): Promise<void> {
    if (pending) return;
    fpanel = true; fpanelFailed = false;
    try {
      const f = await (flight ??= import('./flight').catch(e => { flight = null; throw e; }));
      const d = drawn;
      if (!fpanel || !fslot || !d || pending || fmounted) return;
      fmounted = mount(f.FlightPanel, { target: fslot, props: { craft, id: d.id, own: d.own, spacecraft: name, onclose: () => closeFlight(true) } });
    } catch { fpanelFailed = true; }
  }
  function closeFlight(refocus = false): void {
    fpanel = false;
    if (fmounted) { void unmount(fmounted); fmounted = null; }
    if (refocus) fbutton?.focus();
  }
  /* closed by the card rather than by the reader: a focus that was in the panel goes back to its button, or, where the button is gone with
     the model it was for, to the card's first control, so a keyboard is never left on the page's body */
  let rbutton: HTMLButtonElement | undefined = $state();
  let lastDrawn = '', lastFlown = '';
  $effect(() => {
    const d = drawn?.id ?? '', k = key, on = open, wait = pending;
    untrack(() => {
      if (fpanel && (!on || wait || d !== lastDrawn || k !== lastFlown)) {
        const had = !!fslot && fslot.contains(document.activeElement);
        closeFlight();
        if (had && on) void tick().then(() => (fbutton ?? rbutton)?.focus());
      }
      lastDrawn = d; lastFlown = k;
    });
  });
</script>

{#if open}
  <section class="closecard" class:folded aria-label={CARD_LABEL}>
    <div class="head">
      <b class="nm">{entry?.name ?? '—'}</b>
      <span class="acts">
        {#if !folded}<button type="button" class="btn" bind:this={rbutton} onclick={() => craft.reset()}>{RESET}</button>{/if}
        <button type="button" class="btn" id="cardfold" aria-expanded={!folded} aria-controls="closebody" onclick={fold}>{folded ? SHOW_CARD : HIDE_CARD}</button>
      </span>
    </div>
    <div class="body" id="closebody" hidden={folded}>
    {#if credit}<p class="credit">{#each parts(credit) as p}{#if 'href' in p}<a href={p.href} target="_blank" rel="noopener">{p.text}</a>{:else}{p.text}{/if}{/each}</p>{/if}
    <p class="status" role="status">{status}{#if !status && dark}{IN_SHADOW}{/if}{#if !status && !entry}{NO_POSITION}{/if}</p>
    <div class="row">
      <label class="real"><input type="checkbox" checked={globe.surface === 'real'} onchange={e => realistic(e.currentTarget.checked)}> {REALISTIC}</label>
      {#if entry}<button type="button" class="btn" id="mymodel" aria-expanded={panel} onclick={() => panel ? closePanel() : void openPanel()}>{YOUR_MODEL}</button>{/if}
    </div>
    <div bind:this={slot}></div>
    {#if panel && panelFailed}<p class="status" role="status">{failed(YOUR_MODEL)}</p>{/if}
    {#if drawn && !panel && !pending}
      <div class="row">
        <span class="flying">{flightLine(flying ?? drawn.own, yoursFlying)}</span>
        <button type="button" class="btn" id="flight" bind:this={fbutton} aria-expanded={fpanel} aria-controls="flightslot"
                onclick={() => fpanel ? closeFlight() : void openFlight()}>{FLIGHT}</button>
      </div>
      <p class="flying">{period(spinRate(flown?.spin ?? null))}</p>
      <div class="row">
        <button type="button" class="btn" id="level" onclick={level}>{RESET_TURN}</button>
        <button type="button" class="btn" id="spinrates" aria-expanded={spinOpen} aria-controls="spinslot" onclick={toggleSpin}>{SPIN_BUTTON}</button>
      </div>
      {#if spinOpen}
        <div class="spin" id="spinslot" role="group" aria-label={SPIN_GROUP + ': ' + name}>
          {#each SPIN_ORDER as ax, i}
            <div class="turn">
              <label for={'spin-' + ax}>{SPIN_LABELS[ax]}</label>
              <input id={'spin-' + ax} type="range" min={-MAX_SPIN} max={MAX_SPIN} step="0.1" value={rates[i]} aria-valuetext={rateText(rates[i]!, ax)}
                     aria-describedby="spin-signs"
                     oninputcapture={e => setRate(i, +e.currentTarget.value, false)} onchangecapture={e => setRate(i, +e.currentTarget.value, true)}>
              <input id={'spin-' + ax + '-n'} type="number" min={-MAX_SPIN} max={MAX_SPIN} step="0.1" value={rates[i]} aria-label={rateField(ax)}
                     aria-describedby="spin-signs"
                     oninputcapture={e => { const v = typed(e.currentTarget, toRate); if (v !== null) setRate(i, v, false); }}
                     onchangecapture={e => changed(e.currentTarget, v => setRate(i, v, true), () => rates[i]!)}>
            </div>
          {/each}
          <p class="note" id="spin-signs">{SPIN_SIGNS} {CLOCK_NOTE}</p>
          <p class="note" role="status">{spinSay}</p>
          <div class="row">
            <button type="button" class="btn" id="spin-own" onclick={() => setSpin(drawn ? spinRate(drawn.own.spin) : null, true)}>{OWN_SPIN}</button>
            <button type="button" class="btn" id="spin-stop" onclick={() => setSpin(null, true)}>{STOP_SPIN}</button>
          </div>
        </div>
      {/if}
    {/if}
    <div id="flightslot" bind:this={fslot}></div>
    {#if fpanel && fpanelFailed}<p class="status" role="status">{failed(FLIGHT)}</p>{/if}
    <p class="hint">{HINT}</p>
    </div>
  </section>
{/if}

<style>
  /* the same dark glass as the controls over the globe; space has no light mode */
  .closecard {
    position: absolute; left: var(--space-3); bottom: calc(var(--space-3) + var(--tbar, 0px)); z-index: 2; display: flex; flex-direction: column; gap: 4px;
    width: min(340px, calc(100% - 2 * var(--space-3))); max-height: calc(100% - 2 * var(--space-3) - var(--tbar, 0px)); overflow-y: auto; padding: 10px 12px;
    border-radius: 4px; background: rgba(10, 16, 20, .78); border: 1px solid rgba(180, 200, 212, .28); backdrop-filter: blur(6px);
    color: #DCE8EE; font-size: var(--fs-1); line-height: 1.4;
  }
  .head, .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .nm { font-family: var(--font-mono); font-weight: 600; letter-spacing: .04em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btn {
    flex: none; min-height: 30px; padding: 0 10px; border-radius: 3px; border: 1px solid rgba(180, 200, 212, .35); background: transparent;
    color: #DCE8EE; font-family: var(--font-mono); font-size: var(--fs-0); cursor: pointer;
  }
  .btn:hover { background: rgba(180, 200, 212, .16); }
  .credit, .status, .hint { margin: 0; font-size: var(--fs-0); }
  .credit { color: #AFC3CE; }
  .credit a { color: #CFE3EE; }
  .status { color: #CFE3EE; }
  .status:empty { display: none; }
  .hint { color: #8AA0AC; font-family: var(--font-mono); }
  .flying { min-width: 0; margin: 0; font-size: var(--fs-0); color: #AFC3CE; }
  .acts { display: flex; flex: none; gap: var(--space-2); }
  .body { display: flex; flex-direction: column; gap: 4px; }
  .body[hidden] { display: none; }
  .spin { display: flex; flex-direction: column; gap: 6px; padding: 6px 0 2px; border-top: 1px solid rgba(180, 200, 212, .22); }
  .turn { display: grid; grid-template-columns: 3.8em minmax(0, 1fr) 4.6em; align-items: center; gap: var(--space-2); font-size: var(--fs-0); }
  .turn input[type='range'] { width: 100%; min-width: 0; margin: 0; accent-color: var(--contact); }
  .turn input[type='number'] {
    width: 100%; min-width: 0; box-sizing: border-box; min-height: 28px; padding: 0 4px; border-radius: 3px; border: 1px solid rgba(180, 200, 212, .35);
    background: rgba(10, 16, 20, .9); color: #DCE8EE; font-family: var(--font-mono); font-size: var(--fs-0);
  }
  .note { margin: 0; font-size: var(--fs-0); color: #AFC3CE; }
  .note:empty { display: none; }
  .real { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-1); cursor: pointer; min-height: 30px; }
  .real input { accent-color: var(--contact); margin: 0; width: 14px; height: 14px; }
  @media (pointer: coarse) { .btn, .real, .turn input { min-height: var(--tap); } }
  /* a phone: above the strip of camera and trail controls along the globe's foot */
  @media (max-width: 719px) { .closecard { bottom: calc(96px + var(--tbar, 0px)); left: var(--space-2); width: calc(100% - 2 * var(--space-2)); max-height: calc(100% - 104px - var(--tbar, 0px)); } }
</style>
