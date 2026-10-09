/* One clock for the whole console.
 *
 * The old page ran the 3D scene and the flat map on separate clocks that never agreed, then fixed it by making
 * the page own simulation time and handing the scene a function. The same shape here: time is a plain number
 * read through now(), so the scene and the canvases can ask for it every frame without a reactive read; what
 * Svelte sees is `tick`, a small immutable value republished at most ten times a second while playing (and at
 * once on a seek, a pause or a rate change). Text readouts derive from tick; nothing re-renders at 60 Hz. */

export interface Tick { ms: number }

export const MAX_RATE = 3600;
const PUBLISH_MS = 100;

/** The span the analysis covers. When the clock runs out of it while playing, `onLeave` is called with the instant
 *  the clock has reached, once per frame until the owner has moved the window (or stopped the clock). */
export interface Bounds { t0: number; t1: number; onLeave: (ms: number) => void }

class SimClock {
  playing = $state(true);
  /** Continuous, 1 to 3600: a log-scale slider gives every value between, as the old page did. */
  rate = $state(1);
  tick = $state.raw<Tick>({ ms: Date.now() });

  private ms = Date.now();
  private raf = 0;
  private last = 0;
  private lastPublish = 0;
  private bounds: Bounds | null = null;

  /** Simulation time now, in ms since the epoch. Not reactive: call it from a frame loop, not a template. */
  now(): number { return this.ms; }

  /** Where the analysis window is, so the clock can say when it has run past it. Null for none. */
  setBounds(b: Bounds | null): void { this.bounds = b; }

  start(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((t - this.last) / 1000, 0.25);   // a background tab must not leap hours on return
    this.last = t;
    if (this.playing) {
      this.ms += dt * this.rate * 1000;
      /* Run ON rather than loop. The old behaviour snapped back to +0 h at the end of the bar, which made the clock
         lie: the time on screen jumped backwards a day while the spacecraft kept flying. Now the analysis window
         itself advances and the instant is carried across, so the scrubber returns to the left edge because a NEW
         day has started, not because the old one was replayed. */
      const b = this.bounds;
      if (b && (this.ms > b.t1 || this.ms < b.t0)) b.onLeave(this.ms);
    }
    if (this.playing && t - this.lastPublish >= PUBLISH_MS) this.publish(t);
  };

  private publish(t = performance.now()): void {
    this.lastPublish = t;
    this.tick = { ms: this.ms };
  }

  /** Jump to an instant. `pause` stops the clock there (a scrub, a pass chosen from the list). */
  seek(ms: number, pause = false): void {
    this.ms = ms;
    if (pause) this.playing = false;
    this.publish();
  }

  toggle(): void { this.playing = !this.playing; this.publish(); }

  /** Play or pause without moving the time (a failed window roll stops the clock where it is). */
  setPlaying(on: boolean): void { this.playing = on; this.publish(); }

  setRate(r: number): void {
    r = Math.max(1, Math.min(MAX_RATE, r));
    this.rate = r < 1.05 ? 1 : r;           // let the bottom of the travel be exactly real time
    this.publish();
  }
}

/* The slider is logarithmic: 1x to 3600x in one throw, so one second becomes an hour. */
export const rateToSlider = (r: number): number => 100 * Math.log(r) / Math.log(MAX_RATE);
export const sliderToRate = (v: number): number => Math.pow(MAX_RATE, v / 100);
/** 1.0×, 2.5×, 12×, 3,600×: tenths below ten, whole numbers above. */
export const rateLabel = (r: number): string => (r < 10 ? r.toFixed(1) : Math.round(r).toLocaleString('en-US')) + '×';

export const clock = new SimClock();
