<script lang="ts">
  import { app } from '../../state/app.svelte';
  import { clock, rateToSlider, sliderToRate } from '../../state/clock.svelte';
  import { iso } from '../../lib/text/fmt';
  import { tzLabel } from '../../lib/observer';
  import Icon from '../ui/Icon.svelte';
  import WindowPopover from './WindowPopover.svelte';

  /* The transport: play and pause, the rate (1x to 3600x, so a second becomes an hour), a scrubber over the
     analysis window with the passes marked on it, and the clock in UTC and at the site. */
  const a = $derived(app.analysis);
  const t0 = $derived(a ? a.start.getTime() : 0);
  const t1 = $derived(a ? a.end.getTime() : 1);
  const ms = $derived(clock.tick.ms);
  const frac = $derived(Math.max(0, Math.min(1, (ms - t0) / (t1 - t0))));
  const hours = $derived(Math.round((t1 - t0) / 3_600_000));

  /* the clock ran past the window: carry the instant across by opening a new window at it (as the old page did) */
  $effect(() => { if (a && (ms > t1 + 1 || ms < t0 - 1)) app.rollWindow(ms); });

  function scrub(e: Event) {
    const v = +(e.currentTarget as HTMLInputElement).value;
    clock.seek(t0 + (t1 - t0) * v / 1000, true);
  }
  /* the wall clock at the site: the same instant shifted by its offset, read back as UTC fields (hh:mm:ss) */
  const localTime = $derived(iso(new Date(ms + app.site.tz * 3_600_000)).slice(11, 19));
</script>

<div class="transport" role="group" aria-label="Time">
  <button type="button" class="play" id="tpplay" onclick={() => clock.toggle()} aria-label={clock.playing ? 'Pause' : 'Play'}>
    <Icon name={clock.playing ? 'pause' : 'play'} size={18} />
  </button>

  <label class="rate">
    <span class="eyebrow lbl">Rate</span>
    <input id="tprate" type="range" min="0" max="100" step="1" value={rateToSlider(clock.rate)}
           oninput={e => clock.setRate(sliderToRate(+e.currentTarget.value))} aria-valuetext="{clock.rate} times real time">
    <span class="mono x">{clock.rate}×</span>
  </label>

  <div class="scrub">
    <div class="track" aria-hidden="true">
      {#each a?.passes ?? [] as p (p.t0ms)}
        <i style="left:{100 * (p.t0ms - t0) / (t1 - t0)}%; width:max(3px, {100 * (p.t1ms - p.t0ms) / (t1 - t0)}%)"></i>
      {/each}
    </div>
    <input id="time" type="range" min="0" max="1000" step="1" value={Math.round(frac * 1000)} oninput={scrub}
           aria-label="Time within the window" aria-valuetext={iso(new Date(ms))}>
    <div class="ticks mono" aria-hidden="true"><span>+0 h</span><span>+{hours / 2} h</span><span>+{hours} h</span></div>
  </div>

  <div class="clock mono" id="tpclock">
    <span class="utc">{iso(new Date(ms)).replace('Z', '')} <small>UTC</small></span>
    <span class="loc">{localTime} <small>{tzLabel(app.site.tz)}</small></span>
  </div>

  <div class="win"><WindowPopover /></div>
</div>

<style>
  .transport {
    display: grid; grid-template-columns: auto minmax(120px, 190px) minmax(160px, 1fr) auto auto; align-items: center;
    gap: var(--space-4); min-height: var(--transport-h); padding: var(--space-2) var(--space-4);
    background: var(--chrome); border-top: 1px solid var(--chromerule);
  }
  .play {
    display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--r-pill); border: 1px solid var(--chromerule);
    background: var(--chrome2); color: var(--chromeink);
  }
  .play:hover { background: var(--hover); }
  .rate { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-2); }
  .x { min-width: 4ch; text-align: right; font-size: var(--fs-1); }
  .scrub { position: relative; display: grid; gap: 0; }
  .track { position: absolute; left: 0; right: 0; top: 11px; height: 6px; pointer-events: none; }
  .track i { position: absolute; top: 0; height: 6px; background: var(--contact); border-radius: 2px; opacity: .9; }
  input[type='range'] { width: 100%; margin: 0; accent-color: var(--ink); background: transparent; }
  #time { position: relative; z-index: 1; }
  .ticks { display: flex; justify-content: space-between; font-size: var(--fs-0); line-height: 1.2; color: var(--muted); padding: 0 2px; }
  .clock { display: grid; text-align: right; white-space: nowrap; }
  .utc { font-size: var(--fs-2); }
  .loc { color: var(--muted); font-size: var(--fs-0); }
  small { color: var(--muted); font-size: var(--fs-0); }

  /* narrow: the play button, the rate and the window on one row, the scrubber across the full width under them,
     the two clocks on a line of their own. The ticks give way: the pass marks and the clock say where you are. */
  @media (max-width: 819px) {
    .transport {
      grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'play rate win' 'scrub scrub scrub' 'clock clock clock';
      gap: var(--space-2) var(--space-3);
    }
    .play { grid-area: play; } .rate { grid-area: rate; } .win { grid-area: win; }
    .scrub { grid-area: scrub; } .clock { grid-area: clock; }
    .lbl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }   /* still the slider's name */
    .rate { grid-template-columns: 1fr auto; }
    .ticks { display: none; }
    .clock { display: flex; justify-content: space-between; text-align: left; }
  }
</style>
