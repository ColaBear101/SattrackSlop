<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { getEngine } from '../../state/engine';
  import { xpdr } from '../../state/transponder.svelte';
  import { calibrate, calShift, centreFor, dialFor, legsFor, OFFSET_MAX, parseMHz, passbandOf, type Hold, type Legs } from '../../lib/analysis/transponder';
  import {
    calFar, calMax, dialName, dialText, fig, HOLDS, modeAndTone, notIn, NUDGES, offsetSaid, onBoard, outAmount, outside, shift, sourceLine,
    XP_CAL, XP_CAL_HINT, XP_CAL_NOT_NOW, XP_DIAL, XP_FAILED, XP_HEARD, XP_HEARD_BAD, XP_HEARD_NAME, XP_HOLD, XP_LISTEN, XP_LOADING, XP_NONE,
    XP_OFFSET, XP_ON_BOARD, XP_RESET, XP_RETRY, XP_SELECT_NAME, XP_SEND, xpOption
  } from '../../lib/text/transponder';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import type { LiveLine } from './xpdr';

  /* The transponder calculator (CHANGES-FROM-LEGACY.md, L63), mounted into "Uplink and transponders", the disclosure that ends the live line
     (DopplerLive.svelte), by xpdr.ts. No style of its own: its rules are DopplerLive's, as :global(#xpdr ...), so that this chunk brings no
     stylesheet the entry would have to name.

     It works only while the disclosure is open: shut, nothing below reads the line, the store or the clock. Open, its figures are for the
     live line's instant and from the range rate the line has already worked out there (the caption above says which instant, and offers
     Go live), so it asks the engine for no state of its own: while the clock stands still, choosing, holding and nudging are arithmetic
     on that one range rate. Nothing it does reaches the downlink box, the Doppler rows or the uplink box above it. */
  let { details, line, done }: { details: HTMLDetailsElement; line: () => LiveLine | null; done: () => void } = $props();

  /* open or shut as the disclosure is: at the mount (the toggle that asked for this chunk has been and gone), then at each toggle */
  let open = $state(false);
  $effect(() => {
    const toggled = () => {
      if (!details.isConnected) { queueMicrotask(done); return; }
      open = details.open;
      if (details.open) void xpdr.ensure();
    };
    toggled();
    details.addEventListener('toggle', toggled);
    return () => details.removeEventListener('toggle', toggled);
  });

  const entry = $derived(open ? app.entry : null);
  const sat = $derived(entry?.satnum ?? '');
  const list = $derived(open ? xpdr.list(entry) : []);
  const pick = $derived(open ? xpdr.pickFor(sat, list) : null);
  const rec = $derived(pick ? list[pick.i] ?? null : null);
  /* the whole transponder the record is a segment of (QO-100's band plan is six records): the flags are measured against it, the figures
     are the record's own to the bit */
  const band = $derived(rec ? passbandOf(rec, list) : null);
  const off = $derived(rec && rec.linear ? xpdr.offsetFor(sat) : 0);
  const L = $derived(open ? line() : null);
  const rr = $derived(L && L.r ? L.r.rr : null);
  const legs = $derived.by((): Legs | null => {
    if (!rec || !band || !pick || rr === null || (rec.linear && pick.hz === null)) return null;
    return legsFor(band, pick.hold, pick.hz ?? 0, rr, getEngine(), off);
  });
  /* gone if the panel has outlived its disclosure (it was replaced): looked at whenever the line moves while open */
  $effect(() => { if (L && !details.isConnected) queueMicrotask(done); });

  /* far: no figure worth showing for what follows the held frequency */
  const far = $derived(!!legs && legs.far);
  const hold = $derived(pick ? pick.hold : 'tx');
  const txShown = $derived(!!legs && !(far && hold !== 'tx'));
  const rxShown = $derived(!!legs && !(far && hold !== 'rx'));
  const outText = $derived(!legs || !band || legs.inside !== false ? ''
    : far ? (hold === 'rx' ? notIn('downlink', band.dlLo, band.dlHi) : notIn('uplink', band.ulLo, band.ulHi))
    : outside(legs.below > 0 ? 'below' : 'above'));
  const live = $derived(!!L && L.live);
  const allowed = $derived(live && !!legs && legs.inside === true);
  const mode = $derived(rec ? modeAndTone(rec) : '');

  /* The record list follows the store, whatever was picked in it before. A picked <option> is "dirty" (the HTML standard; Chromium does
     it): from then on its `selected` attribute, which is all Svelte sets for selected={...}, no longer moves it. The same <select> stays
     in place from one spacecraft with records to the next, its options reused, so after OSCAR 7's third record, the ISS and OSCAR 7
     again, the list would say Mode A, or nothing, while the figures were Mode B's. The index is set instead, as #dopsel's is
     (PassDetails.svelte). */
  let selEl: HTMLSelectElement | undefined = $state();
  $effect(() => { if (selEl && pick && list.length) selEl.selectedIndex = pick.i; });

  function choose(e: Event) {
    xpdr.choose(sat, list, +(e.currentTarget as HTMLSelectElement).value);
    stale();
  }
  function setHold(h: Hold) {
    if (!rec || h === hold) return;
    xpdr.setHold(sat, list, h, (legs && dialFor(legs, h)) ?? centreFor(rec, h));
    stale();
  }
  function dial(e: Event) {
    const el = e.currentTarget as HTMLInputElement, hz = parseMHz(el.value);
    xpdr.setDial(sat, list, hz, el.value);
    if (hz !== null) el.value = dialText(hz);
    stale();
  }
  function nudge(d: number) { xpdr.nudge(sat, list, d); stale(); }

  /* Try again: its line goes at the press (the store clears `failed` as it asks again), and the focus the press had would fall to the
     page, a screen reader left on nothing and the next Tab from the top. It goes to the disclosure's summary, which stays whatever the
     answer, as Go live hands its focus to the caption (DopplerLive.svelte). */
  function retry(e: MouseEvent) {
    const had = document.activeElement === e.currentTarget;
    void xpdr.ensure();
    if (had) void tick().then(() => {
      const s = details.querySelector('summary'), a = document.activeElement;
      if (s && (a === null || a === document.body)) s.focus({ preventScroll: true });
    });
  }

  /* What a press says, for six seconds, as the one-pass calendar's line does. */
  let said = $state('');
  let sayT: ReturnType<typeof setTimeout> | undefined;
  function say(s: string) { said = s; clearTimeout(sayT); sayT = setTimeout(() => { said = ''; }, 6000); }

  /* The offset is set from the frequency the reader heard their own signal on against the one predicted for the same instant. The reader
     reads the receiver, then types: the predicted figure (and the range rate under it) is taken when the typing starts, at the first input
     into the empty box, not when Set offset is pressed seconds later, by which time the prediction has moved by tens of hertz a second
     near culmination. A figure typed is good for one press. The box is emptied, and its snapshot dropped, by the press that sets the
     offset and by Reset, and by another spacecraft (the disclosure shut too), another record, hold or held frequency: what was heard was
     heard against what was set before, and a press on the empty box asks for a figure, rather than compare the old one with the
     prediction at the press. A press that refuses the figure leaves it in the box, still against its snapshot, and the first edit takes
     another. A snapshot taken while the line was not live, or none at all (the figures were dashes as the typing began), is taken at the
     press. The panel carries the snapshot it will use, or the one the last press used, as data-pred and data-pred-ms. */
  type Snap = { pred: number; rr: number; ms: number; live: boolean; off: number; sat: string };
  let snap = $state.raw<Snap | null>(null), used = $state.raw<Snap | null>(null), retake = false;
  const shown = $derived(snap ?? used);
  const take = (): Snap | null => (legs && L && rr !== null && !legs.far && legs.rx > 0 ? { pred: legs.rx, rr, ms: L.ms, live: L.live, off, sat } : null);
  let heardEl: HTMLInputElement | undefined = $state();
  function stale() {
    snap = null;
    retake = false;
    if (heardEl) heardEl.value = '';
  }
  let heardFor = '';
  $effect(() => { if (sat !== heardFor) { heardFor = sat; stale(); } });
  function heardIn(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (!v.trim()) snap = null;
    else if (!snap || retake) snap = take();
    retake = false;
  }
  function setOffset() {
    if (!rec || !rec.linear || !entry) return;
    if (!allowed) { say(XP_CAL_NOT_NOW); return; }
    const heard = parseMHz(heardEl ? heardEl.value : '');
    if (heard === null) { say(XP_HEARD_BAD); return; }
    const s = snap && snap.sat === sat && snap.live ? snap : take();
    if (!s) { say(XP_CAL_NOT_NOW); return; }
    const C = getEngine().C_KMS, next = calibrate(s.off, heard, s.pred, s.rr, C);
    if (next === null) {
      snap = s;
      retake = true;
      const sh = calShift(heard, s.pred, s.rr, C);
      say(Math.abs(sh) > OFFSET_MAX || !Number.isFinite(sh) ? calFar(heard - s.pred) : calMax(s.off + sh, OFFSET_MAX));
      return;
    }
    used = s;
    stale();
    say(offsetSaid(entry.name, next, xpdr.setOffset(sat, next) ?? 'visit'));
  }
  function reset() {
    if (!entry) return;
    stale();
    say(offsetSaid(entry.name, 0, xpdr.setOffset(sat, 0) ?? 'visit'));
  }
</script>

<!-- one row of figures: the frequency and its shift from the one it was worked out from (what the spacecraft hears or sends) -->
{#snippet row(id: string, k: string, f: number | null, from: number | null)}
  <p class="ln"><span class="k">{k}</span> <span class="f" id="xpdr-{id}">{f === null ? '—' : fig(f)}</span> <span class="d">{f === null || from === null || fig(f) === '—' ? '' : shift(f - from)}</span></p>
{/snippet}

<div id="xpdr-panel" data-ms={L ? L.ms : undefined} data-pred={shown ? String(shown.pred) : undefined} data-pred-ms={shown ? shown.ms : undefined}>
  {#if open}
    {#if xpdr.failed}
      <p id="xpdr-fail" class="ln">{XP_FAILED} <Button size="sm" id="xpdr-retry" onclick={retry}>{XP_RETRY}</Button></p>
    {:else if !xpdr.table}
      <p id="xpdr-wait" role="status">{XP_LOADING}</p>
    {:else if !rec || !pick}
      <p id="xpdr-none">{XP_NONE}</p>
    {:else}
      <p class="ln"><select id="xpdrsel" aria-label={XP_SELECT_NAME} bind:this={selEl} onchange={choose}>
        {#each list as t, i}<option value={String(i)}>{xpOption(t)}</option>{/each}
      </select></p>
      {#if rec.linear}
        <div class="ln"><span class="k">{XP_HOLD}</span> <Segmented size="sm" label={XP_HOLD} value={hold} options={HOLDS.map(h => ({ ...h }))} onchange={h => setHold(h as Hold)} /></div>
        <p class="ln">
          <label class="k" for="xpdr-dial">{XP_DIAL}</label>
          <input id="xpdr-dial" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value={pick.hz === null ? pick.text : dialText(pick.hz)} aria-label={dialName(hold)} onchange={dial}>
          <span class="d">MHz</span>
        </p>
        <p class="ln nudge">{#each NUDGES as [d, t, id]}<Button size="sm" id="xpdr-{id}" onclick={() => nudge(d)}>{t}</Button>{/each}</p>
      {/if}
      {@render row('tx', XP_SEND, txShown && legs ? legs.tx : null, legs ? legs.fu : null)}
      {@render row('rx', XP_LISTEN, rxShown && legs ? legs.rx : null, legs ? legs.fd : null)}
      {#if rec.linear}
        <p class="ln"><span class="k">{XP_ON_BOARD}</span> <span class="f" id="xpdr-sat">{legs && !far ? onBoard(legs.fu, legs.fd) : '—'}</span> <span class="d" id="xpdr-satd">{legs && !far ? outAmount(legs.below, legs.above) : ''}</span></p>
        <p id="xpdr-out" class="warn" role="status">{outText}</p>
      {/if}
      {#if mode}<p id="xpdr-mode">{mode}</p>{/if}
      {#if rec.linear}
        <p class="ln"><span class="k">{XP_OFFSET}</span> <span class="f" id="xpdr-off">{shift(off)}</span></p>
        <p class="ln">
          <label class="k" for="xpdr-heard">{XP_HEARD}</label>
          <input id="xpdr-heard" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label={XP_HEARD_NAME} bind:this={heardEl} oninput={heardIn}>
          <span class="d">MHz</span>
        </p>
        <p class="ln">
          <Button size="sm" id="xpdr-cal" aria-disabled={allowed ? undefined : 'true'} aria-describedby="xpdr-calhint" onclick={setOffset}>{XP_CAL}</Button>
          <Button size="sm" id="xpdr-off0" onclick={reset}>{XP_RESET}</Button>
        </p>
        <p id="xpdr-calhint">{XP_CAL_HINT}</p>
        <p id="xpdr-offsay" role="status">{said}</p>
      {/if}
      <p id="xpdr-src">{sourceLine(xpdr.table.built, rec.desc)}</p>
    {/if}
  {/if}
</div>
