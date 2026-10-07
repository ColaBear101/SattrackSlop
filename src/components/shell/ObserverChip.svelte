<script lang="ts">
  import { untrack } from 'svelte';
  import { app, PINNED } from '../../state/app.svelte';
  import { clock } from '../../state/clock.svelte';
  import { HOME } from '../../state/engine';
  import { latStr, lonStr, siteKey, tzLabel } from '../../lib/observer';
  import { credit, here, search, tzAt, tzLabelAt, type Place } from '../../lib/places';
  import { siteNote } from '../../lib/text/site';
  import Popover from '../ui/Popover.svelte';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import Rich from '../ui/Rich.svelte';

  /* Where the visibility is computed from. A place name answers all five fields at once - position, ground
     height and a real timezone - from one request; "use my location" asks the device; or type the coordinates. The
     search is a convenience over typing the numbers, and typing them works with no network at all. Everything it
     fills in is still editable underneath, and none of it is required.

     From the observer section of legacy/index.html (main@4eadd7a), lines 10372-10680: the messages are the original's,
     word for word, and the ids are the old page's (siteopen, s-search, s-hits, s-here, s-recent, s-manual, s-name,
     s-lat, s-lon, s-alt, s-tz, siteapply, sitereset, sitenote). */
  let open = $state(false);
  let fSearch: HTMLInputElement | undefined;
  let hits = $state.raw<Place[]>([]);
  let msg = $state<{ text: string; warn: boolean } | null>(null);
  let locating = $state(false);
  /* the five fields are plain inputs, written by paintSite() and read when Apply is pressed (as the old form's were), so
     whatever sets them - a person, a script - is what is applied */
  let fName: HTMLInputElement | undefined, fLat: HTMLInputElement | undefined, fLon: HTMLInputElement | undefined,
      fAlt: HTMLInputElement | undefined, fTz: HTMLInputElement | undefined;
  /* A bare coordinate's offset field follows longitude until it is typed in, so the page remembers the value it wrote:
     "edited" is "differs from that", however the value was changed. */
  let tzAuto = $state('');
  let manual = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctl: AbortController | null = null;

  /* The form shows the site that is current, and the note under it is the default one: on opening the form, and each
     time the site changes (the old paintSite). Called by the handlers that change it, in the order the old page ran
     them, so a message written afterwards ("Set from this device") is not wiped by a repaint that follows it. */
  function paintSite() {
    const s = app.site;
    if (fName) fName.value = s.name;
    if (fLat) fLat.value = String(s.lat);
    if (fLon) fLon.value = String(s.lon);
    if (fAlt) fAlt.value = String(s.altKm);
    if (fTz) fTz.value = String(s.tz);
    tzAuto = String(s.tz);
    msg = null;
  }
  $effect(() => { if (open) untrack(paintSite); });

  const recents = $derived(app.recents.filter(s => siteKey(s) !== siteKey(app.site)));
  const note = $derived(siteNote({ site: app.site, home: HOME, pinned: PINNED, tzLabel: tzLabelAt(app.site, clock.tick.ms) }));
  const say = (text: string, warn = false) => { msg = { text, warn }; };

  function closeHits() { hits = []; }
  function picked(site: Place) {
    if (!app.applySite(site, { persist: true, remember: true, where: site.where })) return;
    if (fSearch) fSearch.value = ''; closeHits(); paintSite();
  }

  /* Debounced rather than per-keystroke: someone typing "Ulaanbaatar" would otherwise send eleven requests to a free
     service to answer the last one. */
  function run() {
    const text = (fSearch?.value ?? '').trim();
    if (text.length < 2) { closeHits(); return; }
    ctl?.abort();
    ctl = new AbortController();
    search(text, 6, ctl.signal).then(list => {
      if (!list.length) { closeHits(); say('No place matched “' + text + '”.'); return; }
      hits = list;
      say(credit + '. Pick one, or enter coordinates instead.');
    }).catch(err => {
      if (err && err.name === 'AbortError') return;        // superseded by a later keystroke
      closeHits();
      say('Place search is unreachable — enter coordinates instead.', true);
    });
  }
  function typing() { clearTimeout(timer); timer = setTimeout(run, 250); }
  function searchKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); }
    if (e.key === 'Escape' && hits.length) { e.stopPropagation(); closeHits(); }
  }

  function useHere() {
    say('Asking this device where it is…');
    locating = true;
    here().then(site => {
      locating = false;
      if (!app.applySite(site, { persist: true, remember: true, where: site.where })) { say('That location did not make sense.', true); return; }
      closeHits(); paintSite();
      say('Set from this device' + (site.accuracyM ? ', accurate to about ' + Math.round(site.accuracyM) + ' m.' : '.'));
    }).catch(err => {
      locating = false;
      say((err && err.message ? err.message : 'no location') + ' — search for a place or enter coordinates.', true);
    });
  }

  /* A bare coordinate has no timezone, so the offset field follows longitude - the nearest hour of solar time,
     applySite's own default - until someone types in it. It used to keep whatever the last site had, and Apply passed
     that along: London entered by hand came out in UTC+7, Bangkok's, under a note saying the offset was solar time,
     and every local time was seven hours out. Typed in, the offset is taken as typed. A rename that leaves the
     position alone keeps the offset, and the zone, the site already had. */
  const num = (s: string | undefined) => parseFloat(s ?? '');
  const tzTyped = () => (fTz?.value ?? '') !== tzAuto;
  const movedTo = (la: number, lo: number) => la !== app.site.lat || lo !== app.site.lon;
  function suggestTz() {
    const la = num(fLat?.value), lo = num(fLon?.value);
    if (!fTz || tzTyped() || !isFinite(lo) || Math.abs(lo) > 180) return;
    fTz.value = String(movedTo(la, lo) ? (Math.round(lo / 15) || 0) : app.site.tz);
    tzAuto = fTz.value;
  }
  function apply(e: Event) {
    e.preventDefault();
    const la = num(fLat?.value), lo = num(fLon?.value), typed = tzTyped(), moved = movedTo(la, lo);
    const ok = app.applySite({
      name: fName?.value, lat: la, lon: lo, altKm: num(fAlt?.value),
      tz: typed ? num(fTz?.value) : moved ? undefined : app.site.tz,
      zone: typed || moved ? undefined : app.site.zone
    }, { persist: true, remember: true, where: '' });
    if (ok) { closeHits(); paintSite(); } else say('Latitude must be within ±90° and longitude within ±180°.', true);
  }
  function reset() { app.resetSite(); closeHits(); paintSite(); }
  function recent(r: (typeof app.recents)[number]) { app.applySite(r, { persist: true, where: r.where ?? '' }); paintSite(); }
</script>

<Popover bind:open label="Observer" align="end" width={380}>
  {#snippet trigger(props)}
    <button type="button" class="chip" id="siteopen" {...props} title="Change the observer">
      <Icon name="pin" size={16} />
      <span class="where">{app.site.name}</span>
      <span class="tz mono">{tzLabelAt(app.site, clock.tick.ms)}</span>
    </button>
  {/snippet}

  <div class="form" id="siteform">
    <p class="eyebrow">Observer · {latStr(app.site.lat)} {lonStr(app.site.lon)}</p>

    <div class="find">
      <input id="s-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search a town or city"
             aria-label="Search for a place" aria-controls="s-hits"
             bind:this={fSearch} oninputcapture={typing} onkeydown={searchKey}>
      <Button id="s-here" size="sm" disabled={locating} onclick={useHere}>Use my location</Button>
    </div>
    <ul class="hits" id="s-hits" aria-label="Search results" hidden={!hits.length}>
      {#each hits as site (site.id ?? site.name + site.lat)}
        <li><button type="button" onclick={() => picked(site)}>{site.name}<span class="hw">{[site.where, latStr(site.lat) + ' ' + lonStr(site.lon), Math.round(site.altKm * 1000) + ' m'].filter(Boolean).join(' · ')}</span></button></li>
      {/each}
    </ul>

    <div class="recents" id="s-recent" hidden={!recents.length}>
      {#each recents as r (siteKey(r))}
        <button type="button" class="recent" title={latStr(r.lat) + ' ' + lonStr(r.lon) + (r.where ? ' · ' + r.where : '')}
                onclick={() => recent(r)}>{r.name}</button>
      {/each}
    </div>

    <details class="manual" id="s-manual" bind:open={manual}>
      <summary>Enter coordinates</summary>
      <form onsubmit={apply} class="fields" novalidate>
        <label>Name<input id="s-name" type="text" maxlength="24" bind:this={fName}></label>
        <label>Latitude<input id="s-lat" type="number" step="0.0001" min="-90" max="90" bind:this={fLat} oninputcapture={suggestTz}></label>
        <label>Longitude<input id="s-lon" type="number" step="0.0001" min="-180" max="180" bind:this={fLon} oninputcapture={suggestTz}></label>
        <label>Altitude km<input id="s-alt" type="number" step="0.001" min="-0.5" max="9" bind:this={fAlt}></label>
        <label>UTC offset<input id="s-tz" type="number" step="0.5" min="-12" max="14" bind:this={fTz}></label>
        <div class="row"><Button id="siteapply" variant="primary" type="submit">Apply</Button></div>
      </form>
    </details>

    <div class="row"><Button id="sitereset" variant="ghost" onclick={reset}>Reset to {HOME.name}</Button></div>
    <p class="note" id="sitenote" class:warn={!!msg?.warn}>{#if msg}{msg.text}{:else}<Rich value={note} />{/if}</p>
  </div>
</Popover>

<style>
  .chip {
    display: inline-flex; align-items: center; gap: var(--space-2); min-height: 36px; max-width: 100%;
    padding: 0 var(--space-3); border: 1px solid var(--chromerule); border-radius: var(--r-pill);
    background: var(--chrome2); color: var(--chromeink); font-size: var(--fs-1);
  }
  .chip :global(svg) { color: var(--observer); }
  .where { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14ch; }
  .tz { color: var(--muted); font-size: var(--fs-0); }
  .form { display: grid; gap: var(--space-3); }
  .find { display: flex; gap: var(--space-2); align-items: center; }
  .find input { flex: 1; min-width: 0; }
  input {
    height: 36px; padding: 0 var(--space-3); border: 1px solid var(--rule); border-radius: var(--r-2);
    background: var(--sunk); color: var(--ink); font-size: var(--fs-2);
  }
  input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  .hits { list-style: none; margin: 0; padding: 0; display: grid; border: 1px solid var(--rule); border-radius: var(--r-2); overflow: hidden; }
  .hits li + li { border-top: 1px solid var(--rule); }
  .hits button { display: grid; width: 100%; padding: var(--space-2) var(--space-3); border: 0; background: transparent; color: var(--ink); text-align: left; font-size: var(--fs-2); }
  .hits button:hover { background: var(--hover); }
  .hw { color: var(--muted); font-size: var(--fs-0); font-family: var(--font-mono); }
  .recents { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .recent { border: 1px solid var(--rule); background: var(--sunk); color: var(--ink); border-radius: var(--r-pill); padding: 2px var(--space-3); font-size: var(--fs-0); }
  .recent:hover { border-color: var(--observer); }
  .manual summary { cursor: pointer; color: var(--ink2); font-size: var(--fs-1); }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-top: var(--space-3); }
  .fields label { display: grid; gap: var(--space-1); font-size: var(--fs-0); color: var(--muted); }
  .fields label:first-child { grid-column: 1 / -1; }
  .row { display: flex; gap: var(--space-2); grid-column: 1 / -1; }
  .note { color: var(--muted); font-size: var(--fs-1); }
  .note.warn { color: var(--warn); }
  .note :global(a) { color: var(--link); }
</style>
