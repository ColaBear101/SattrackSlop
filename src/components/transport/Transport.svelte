<script lang="ts">
  import { flushSync } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { clock, rateLabel, rateToSlider, sliderToRate } from '../../state/clock.svelte';
  import { iso, spanLabel } from '../../lib/text/fmt';
  import { tzAt, tzLabelAt } from '../../lib/places';
  import Icon from '../ui/Icon.svelte';
  import WindowPopover from './WindowPopover.svelte';

  /* The transport: play and pause, the rate (1x to 3600x, so a second becomes an hour), a scrubber over the
     analysis window with the passes marked on it, and the clock in UTC and at the site. The scrubber counts samples
     (the analysis's own step), and the clock runs ON past the window's end by opening the next one (app.rollWindow),
     so what it shows is never a day replayed. */
  /* The two sliders are listened to at the element (the `capture` form of the handler), not through Svelte's delegation
     from the document: an input event that does not bubble - what a script or an assistive technology may dispatch -
     reaches an element's own listeners and never reaches the document. */
  const a = $derived(app.analysis);
  const t0 = $derived(a ? a.start.getTime() : 0);
  const span = $derived(a ? a.end.getTime() - t0 : 1);
  const ms = $derived(clock.tick.ms);
  const idx = $derived(app.idxAt(ms));

  function scrub(e: Event) {
    if (!a) return;
    clock.seek(t0 + (+(e.currentTarget as HTMLInputElement).value) * a.step * 1000, true);
    flushSync();       // the clocks beside the slider say the new time in the same turn, as the old page's did
  }

  /* One unit across the whole axis: mixing '+42h' with '+3.5d' reads as noise. */
  const ticks = $derived.by(() => {
    if (!a) return [];
    const useDays = a.hours >= 48;
    const tick = (f: number) => {
      const hh = a.hours * f;
      if (useDays) { const d = hh / 24; return '+' + (d % 1 ? d.toFixed(1) : d.toFixed(0)) + 'd'; }
      return '+' + (hh % 1 ? hh.toFixed(1) : hh.toFixed(0)) + 'h';
    };
    return [0, .25, .5, .75, 1].map(tick);
  });

  const utc = $derived(iso(new Date(ms)).replace('Z', ''));
  const local = $derived(iso(new Date(ms + tzAt(app.site, ms) * 3_600_000)).replace('Z', ''));
</script>

<div class="transport" role="group" aria-label="Time">
  <button type="button" class="play" id="tpplay" onclick={() => clock.toggle()} aria-label={clock.playing ? 'Pause' : 'Play'}>
    <Icon name={clock.playing ? 'pause' : 'play'} size={18} />
  </button>

  <label class="rate">
    <span class="eyebrow lbl">Rate</span>
    <input id="tprate" type="range" min="0" max="100" step="1" value={Math.round(rateToSlider(clock.rate))}
           aria-label="Time rate, 1x to 3600x"
           oninputcapture={e => { clock.setRate(sliderToRate(+e.currentTarget.value)); flushSync(); }} aria-valuetext="{clock.rate} times real time">
    <span class="mono x" id="tpratev">{rateLabel(clock.rate)}</span>
  </label>

  <div class="scrub">
    <div class="track" id="tppasses" aria-hidden="true">
      {#each a?.passes ?? [] as p (p.t0ms)}
        <i class="tp-pass" style="left:{100 * (p.t0ms - t0) / span}%; width:max(0.45%, {100 * (p.t1ms - p.t0ms) / span}%)"></i>
      {/each}
    </div>
    <input id="time" type="range" min="0" max={a ? a.pts.length - 1 : 0} step="1" value={idx} oninputcapture={scrub}
           aria-label={a ? 'Time within the ' + spanLabel(a.hours) + ' analysis window from ' + iso(a.start) + ', in ' + a.step + '-second steps' : 'Time within the analysis window'}
           aria-valuetext={iso(new Date(ms))}>
    <div class="ticks mono" id="tpticks" aria-hidden="true">{#each ticks as t}<span>{t}</span>{/each}</div>
  </div>

  <div class="clock mono tp-clock" class:outwin={!app.inWindow(ms)}>
    <span class="utc"><span id="tpclock">{utc}</span> <small>UTC</small></span>
    <span class="loc"><span id="tpclocklocal">{local}</span> <small id="lbl-tz2">{tzLabelAt(app.site, ms)}</small></span>
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
  .clock.outwin .utc { color: var(--warn); }
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
