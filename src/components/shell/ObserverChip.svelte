<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { HOME } from '../../state/engine';
  import { latStr, lonStr, tzLabel } from '../../lib/observer';
  import Popover from '../ui/Popover.svelte';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';

  /* Where the visibility is computed from. Today: type coordinates, pick a recent place, or go back to Bangkok.
     Searching a place by name and "use my location" arrive with the live-data milestone. */
  let open = $state(false);
  let name = $state(''), lat = $state(''), lon = $state(''), alt = $state(''), tz = $state('');
  let problem = $state('');

  $effect(() => {
    if (open) {
      const s = app.site;
      name = s.name; lat = String(s.lat); lon = String(s.lon); alt = String(s.altKm); tz = String(s.tz); problem = '';
    }
  });

  const atHome = $derived(app.site.lat === HOME.lat && app.site.lon === HOME.lon && app.site.name === HOME.name);

  function apply(e: Event) {
    e.preventDefault();
    const ok = app.applySite({ name, lat: parseFloat(lat), lon: parseFloat(lon), altKm: alt.trim() === '' ? 0 : parseFloat(alt), tz: tz.trim() === '' ? undefined : parseFloat(tz) });
    if (!ok) { problem = 'Latitude must be between −90 and 90 and longitude between −180 and 180.'; return; }
    open = false;
  }
</script>

<Popover bind:open label="Observer" align="end" width={340}>
  {#snippet trigger(props)}
    <button type="button" class="chip" {...props} title="Change the observer">
      <Icon name="pin" size={16} />
      <span class="where">{app.site.name}</span>
      <span class="tz mono">{tzLabel(app.site.tz)}</span>
    </button>
  {/snippet}

  <form onsubmit={apply} class="form">
    <p class="eyebrow">Observer</p>
    <p class="now mono">{latStr(app.site.lat)} {lonStr(app.site.lon)}</p>

    {#if app.recents.length}
      <div class="recents" aria-label="Recent places">
        {#each app.recents as r (r.lat + ',' + r.lon)}
          <button type="button" class="recent" onclick={() => { app.applySite(r, r.where ?? ''); open = false; }}>{r.name}</button>
        {/each}
      </div>
    {/if}

    <label>Name<input bind:value={name} maxlength="24" autocomplete="off"></label>
    <div class="row">
      <label>Latitude<input bind:value={lat} inputmode="decimal" required></label>
      <label>Longitude<input bind:value={lon} inputmode="decimal" required></label>
    </div>
    <div class="row">
      <label>Altitude, km<input bind:value={alt} inputmode="decimal"></label>
      <label>UTC offset, h<input bind:value={tz} inputmode="decimal" placeholder="solar"></label>
    </div>
    {#if problem}<p class="problem" role="alert"><Icon name="alert" size={14} /> {problem}</p>{/if}
    <div class="actions">
      <Button variant="primary" type="submit">Apply</Button>
      <Button variant="ghost" onclick={() => { app.resetSite(); open = false; }} disabled={atHome}>Reset to Bangkok</Button>
    </div>
  </form>
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
  .now { color: var(--muted); font-size: var(--fs-1); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
  label { display: grid; gap: var(--space-1); font-size: var(--fs-0); color: var(--muted); }
  input {
    height: 36px; padding: 0 var(--space-3); border: 1px solid var(--rule); border-radius: var(--r-2);
    background: var(--sunk); color: var(--ink); font-size: var(--fs-2);
  }
  input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
  .recents { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .recent { border: 1px solid var(--rule); background: var(--sunk); color: var(--ink); border-radius: var(--r-pill); padding: 2px var(--space-3); font-size: var(--fs-0); }
  .recent:hover { border-color: var(--observer); }
  .problem { display: flex; gap: var(--space-2); align-items: center; color: var(--bad); font-size: var(--fs-1); }
  .actions { display: flex; gap: var(--space-2); justify-content: space-between; }
</style>
