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

class SimClock {
  playing = $state(true);
  rate = $state(1);
  tick = $state.raw<Tick>({ ms: Date.now() });

  private ms = Date.now();
  private raf = 0;
  private last = 0;
  private lastPublish = 0;

  /** Simulation time now, in ms since the epoch. Not reactive: call it from a frame loop, not a template. */
  now(): number { return this.ms; }

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
    const dt = Math.min((t - this.last) / 1000, 0.25);   // a background tab must not leap hours on return
    this.last = t;
    if (this.playing) this.ms += dt * this.rate * 1000;
    if (t - this.lastPublish >= PUBLISH_MS && this.playing) this.publish(t);
    this.raf = requestAnimationFrame(this.frame);
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
  setRate(r: number): void { this.rate = Math.max(1, Math.min(MAX_RATE, Math.round(r))); this.publish(); }
}

/* The slider is logarithmic: 1x to 3600x in one throw, so one second becomes an hour. */
export const rateToSlider = (r: number): number => Math.round(Math.log(r) / Math.log(MAX_RATE) * 100);
export const sliderToRate = (v: number): number => Math.max(1, Math.round(Math.pow(MAX_RATE, v / 100)));

export const clock = new SimClock();
