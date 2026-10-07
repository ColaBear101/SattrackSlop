import { mount } from 'svelte';
import { app } from '../../state/app.svelte';
import { clock } from '../../state/clock.svelte';
import { getEngine, MASK, sun } from '../../state/engine';
import { latStr, lonStr } from '../../lib/observer';
import { here, tzAt, tzLabelAt } from '../../lib/places';
import { compass, hhmmss, hms, mmss, whenLocal, whenZ } from '../../lib/text/fmt';
import { globe } from '../stage/globe-state.svelte';

/* The AR view's way into the page, and the page's way to it.
 *
 * From bootAR() in legacy/index.html (main@4eadd7a), lines 12503-12565. The view (src/lib/ar/arview.ts, moved as it was) draws the sky over a
 * phone's camera; everything it says about the spacecraft comes from the provider built here. Every call is cheap and synchronous, reads the
 * page's live state, and writes none of it except through goLive and Use my location, which are the page's own paths. The observer and the
 * pass objects are read, never extended: the regression gate serialises them, and a key added to one would move the baseline.
 *
 * The view is a chunk of its own, brought in only where it can be used - a device whose primary pointer is a finger, and the test build -
 * and brought in BEFORE its button is offered, never on the tap: on an iPhone the motion permission must be asked for inside the tap, with
 * nothing awaited first, so the controller has to be there and initialised when the tap arrives. For the same reason its markup is built
 * here once, as a direct child of <body>: opening the view makes every other child of <body> inert, and a root inside the app's own mount
 * node would be made inert with its parent. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** What the controller exposes (arview.ts is moved verbatim and carries no types of its own). */
export interface ArViewApi {
  init(o: { provider: unknown; root: HTMLElement; opener: HTMLElement }): boolean;
  open(): void;
  close(): void;
  project(az: number, el: number): { x: number; y: number; on: boolean; front: boolean } | null;
  readonly isOpen: boolean;
  readonly state: string;
  readonly probe: Record<string, unknown>;
}

type Chunk = typeof import('./chunk');

/** What the old file reached for as globals: the two libraries, and the window's own members, each looked up when it is used (a suite
 *  that replaces one of them before the view opens is heard). */
function globalFor(chunk: Chunk): Any {
  const w = window as Any;
  return {
    get SkyAR() { return chunk.SkyAR; },
    get WMM() { return chunk.WMM; },
    get isSecureContext() { return w.isSecureContext; },
    get DeviceOrientationEvent() { return w.DeviceOrientationEvent; },
    get orientation() { return w.orientation; },
    get screen() { return w.screen; },
    get innerWidth() { return w.innerWidth; },
    get innerHeight() { return w.innerHeight; },
    get devicePixelRatio() { return w.devicePixelRatio; },
    addEventListener: (...a: [string, EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?]) => w.addEventListener(...a),
    removeEventListener: (...a: [string, EventListenerOrEventListenerObject, (boolean | EventListenerOptions)?]) => w.removeEventListener(...a)
  };
}

/** The view's goLive is also its own re-sync, called from its 250 ms readout while the clock has drifted from the present: when the window
 *  cannot be opened at the present (an object SGP4 can no longer propagate), say nothing more for a while rather than fail four times a
 *  second under a flashing note. */
const RETRY_AFTER_MS = 5000;

function provider(chunk: Chunk) {
  let failedAt = 0;
  const D = () => app.analysis;
  /* The window bar's Now moves the window and leaves the rate alone. Under the real sky the rate has to be real time too, and the window is
     solved again only when the present has left it. */
  const goLive = () => {
    const t = Date.now();
    if (t - failedAt < RETRY_AFTER_MS) return;
    clock.setRate(1);
    clock.setPlaying(true);
    if (D() && app.inWindow(t)) clock.seek(t);
    else if (!app.setWindowStart(t)) failedAt = t;
  };
  return {
    now: () => clock.now(),
    live: () => Math.abs(clock.now() - Date.now()) <= 5000,          // the countdown's own test
    running: () => clock.playing && clock.rate === 1,
    goLive,
    site: () => app.site,
    mask: MASK,
    target: () => { const d = D(); return d ? { name: d.entry.name, reentry: !!d.reentry } : null; },
    at: (ms: number) => { const d = D(); return d ? getEngine().stateAt(d.track, ms) : null; },
    inWindow: (ms: number) => app.inWindow(ms),
    windowEnd: () => { const d = D(); return d ? d.end.getTime() : Infinity; },
    pass: (ms: number) => { const d = D(); return d && app.inWindow(ms) ? (d.passes.find(p => p.t1ms >= ms) ?? app.passAfterWindow()) : null; },
    sun: (ms: number) => { const s = sun.subsolar(new Date(ms)), o = app.site; return chunk.SkyAR.sunAzEl(o.lat, o.lon, s.lat, s.lon); },
    fmt: {
      whenZ: (ms: number) => whenZ(new Date(ms)),
      whenLocal: (ms: number) => whenLocal(new Date(ms), tzAt(app.site, ms), tzLabelAt(app.site, ms)),
      local: (ms: number) => hms(new Date(ms + tzAt(app.site, ms) * 3600000)),
      hm: (ms: number) => hms(new Date(ms + tzAt(app.site, ms) * 3600000)).slice(0, 5),
      zone: (ms: number) => tzLabelAt(app.site, ms),
      tz: (ms: number) => tzAt(app.site, ms),
      hhmmss, mmss, compass, lat: latStr, lon: lonStr
    },
    /* the page's own path to a new observer: the engine, the analysis and the globe follow, and the place is saved like any other. It
       resolves after the (synchronous) change, so the view's declination and its "you are not there" check see the new site. */
    here: () => here().then(place => {
      if (!app.applySite(place, { persist: true, remember: true, where: place.where })) throw new Error('that location did not make sense');
      return place;
    }),
    onOpen: () => { globe.cancelPick(); globe.cover(true); },
    onClose: () => globe.cover(false)
  };
}

class ArSession {
  /** The controller is up and its markup is in the page. */
  ready = $state(false);
  /** The primary pointer is a finger (a phone or a tablet; never a touch laptop, whose primary pointer is fine). */
  coarse = $state(false);
  ui: ArViewApi | null = null;
  chunk: Chunk | null = null;

  /** Offered where the view can be used: not gated on a secure page or on the APIs being there - over http, or with no sensors, the tap says why,
   *  the way Use my location does. */
  get offered(): boolean { return this.ready && this.coarse; }

  private starting: Promise<boolean> | null = null;

  /** Bring the view up (once): the chunk, the markup on <body>, the controller initialised against it. Resolves true when it is ready. */
  start(): Promise<boolean> {
    this.starting ??= this.run();
    return this.starting;
  }

  private async run(): Promise<boolean> {
    try {
      const chunk = await import('./chunk');
      await app.ready;
      this.chunk = chunk;
      mount(chunk.ArRoot, { target: document.body });
      const root = document.getElementById('arview'), opener = document.getElementById('arbtn');
      if (!root || !opener) return false;
      const ui = chunk.makeARView(globalFor(chunk)) as ArViewApi;
      if (!ui.init({ root, opener, provider: provider(chunk) })) return false;
      this.ui = ui;
      this.ready = true;
      return true;
    } catch (e) {
      console.error(e);                            // the chunk did not arrive (offline, say): no AR, and the console is the console it was
      this.starting = null;
      return false;
    }
  }

  /** The tap. Nothing before open(): on an iPhone the motion request must be made inside it, so this runs synchronously. */
  open(): void {
    try { this.ui?.open(); } catch (e) { console.error(e); }
  }

  /** Follow the pointer type, and bring the view up when there is a finger to use it with. */
  watch(): void {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    const sync = () => {
      this.coarse = !!mq && mq.matches;
      if (this.coarse) this.idle(() => { void this.start(); });
    };
    sync();
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync); }
  }

  private idle(fn: () => void): void {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    void app.ready.then(() => { if (ric) ric.call(window, fn, { timeout: 4000 }); else setTimeout(fn, 1500); }, () => { /* no catalogue: nothing to look at */ });
  }
}

export const ar = new ArSession();
