import { flushSync } from 'svelte';
import { isCustom, type CustomEntry } from '../../lib/planner/custom';
import { app, PINNED } from '../../state/app.svelte';
import { custom, customApi } from '../../state/custom.svelte';
import { getEngine, getObs, MASK, satellite } from '../../state/engine';
import { loadPlannerMods, type PlannerMods } from '../../state/planner-mods';
import type { Analysis } from '../../lib/types';
import { planner, ready } from './load.svelte';

/* The orbit planner's way into the page, and the page's way to the planner.
 *
 * From the end of legacy/index.html (main@4eadd7a), lines 12595-12626 (plannerHost and its init). The planner is a chunk of its own, so
 * everything here happens when something asked for it: the browser being idle after the first answer, the pill, a row of the picker, the
 * test surface. Order, as the old page had it: the saved orbits are read, the first spacecraft is on screen, THEN the controller is built
 * and initialised (once, also in the assignment snapshot, where it unhides the pill as disabled and says why), and only after that does
 * every load of a spacecraft tell it (PlannerUI.onLoad is a no-op until init has returned true, so the boot load can never reach a
 * controller that is half built). Everything the controller may do to the console goes through the host below; it holds no reference to
 * the page's own state. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** What the controller exposes (plannerui.ts is moved verbatim and carries no types of its own). */
export interface PlannerUiApi {
  init(host: PlannerHost): boolean;
  open(o?: { from?: 'pill' | 'picker' | 'chip' | 'tle' | 'api'; name?: string; entry?: CustomEntry }): void;
  close(): void;
  isOpen(): boolean;
  enabled(): boolean;
  onLoad(D: Analysis): void;
  refreshSaved(): void;
}

/** The seventeen members the controller is handed: no more (the suites compare the key list), no fewer. */
export interface PlannerHost {
  obs: () => unknown;
  mask: number;
  now: () => number;
  sat: typeof satellite;
  catalogue: () => unknown;
  customs: () => CustomEntry[];
  current: () => Analysis | null;
  window: () => { startMs: number; hours: number };
  trial: (entry: CustomEntry, t0: number, hours: number) => TrialAnswer | null;
  add: typeof customApi.add;
  update: typeof customApi.update;
  remove: typeof customApi.remove;
  show: (e: CustomEntry) => boolean;
  pinned: boolean;
  storageOk: () => boolean;
  tracked: (e: { custom?: unknown }) => boolean;
  entryTle: (e: { l1: string; l2: string }) => { l1: string; l2: string };
}

export interface TrialAnswer {
  n: number; totalS: number; longestS: number; bestEl: number; altMin: number; altMax: number; surfSwing: number; rSwing: number; reentry: boolean;
}

/** The analysis behind the Professor's numbers: a whole compute() in the window now on screen, kept out of the console (nothing is painted).
 *  null when compute refuses, and WITHOUT computing for a deep-space orbit more than 3 days from the window: SDP4 re-integrates its
 *  resonance terms from the epoch on every call, so the cost grows with the distance (a Molniya 107 ms at the epoch, 11 s a year away),
 *  and the Professor says nothing measured there instead of freezing the page. */
function trial(mods: PlannerMods, entry: CustomEntry, t0: number, hours: number): TrialAnswer | null {
  try {
    const P = mods.Planner;
    if (entry.el && P.isDeep(entry.el.a) && Math.abs(t0 - entry.el.epoch) > P.LIMITS.deepTrialDays * 864e5) return null;
    const d = getEngine().compute(entry, t0, hours);
    if (!d.E.altMeasured) return null;
    return {
      n: d.passes.length, totalS: d.totalS,
      longestS: d.passes.reduce((m, p) => Math.max(m, p.dur), 0), bestEl: d.passes.reduce((m, p) => Math.max(m, p.maxEl), 0),
      altMin: d.E.perigeeAlt, altMax: d.E.apogeeAlt,
      surfSwing: d.E.surfMax! - d.E.surfMin!, rSwing: d.E.rMax! - d.E.rMin!, reentry: !!d.reentry
    };
  } catch { return null; }
}

/** What the old file reached for as globals, handed over as an object: the four modules, and the window's own functions (each looked up
 *  when called, so a test that replaces one is heard). */
function globalFor(mods: PlannerMods, hook: (v: unknown) => void): Any {
  const w = window;
  return {
    get Planner() { return mods.Planner; },
    get Advisor() { return mods.Advisor; },
    get AdvisorCopy() { return mods.AdvisorCopy; },
    get Lifetime() { return mods.Lifetime; },
    get requestIdleCallback() { return typeof w.requestIdleCallback === 'function' ? ((cb: IdleRequestCallback, o?: IdleRequestOptions) => w.requestIdleCallback(cb, o)) : undefined; },
    get cancelIdleCallback() { return typeof w.cancelIdleCallback === 'function' ? ((id: number) => w.cancelIdleCallback(id)) : undefined; },
    get innerHeight() { return w.innerHeight; },
    get navigator() { return w.navigator; },
    getSelection: () => w.getSelection(),
    matchMedia: (q: string) => w.matchMedia(q),
    getComputedStyle: (e: Element, p?: string | null) => w.getComputedStyle(e, p),
    scrollBy: (x: number, y: number) => w.scrollBy(x, y),
    dispatchEvent: (e: Event) => w.dispatchEvent(e),
    addEventListener: (t: string, l: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => w.addEventListener(t, l, o),
    set __planner(v: unknown) { hook(v); }
  };
}

class PlannerSession {
  ui: PlannerUiApi | null = null;
  host: PlannerHost | null = null;
  mods: PlannerMods | null = null;
  /** What the controller published as its test hook (`__planner`). */
  hook: unknown = null;
  /** init returned true: the planner is up, and the picker may offer its row. False before, after a failed init, and in the snapshot. */
  enabled = $state(false);
  /** The planner could not be had (its chunk did not arrive): the pill goes, as the old page showed nothing for a planner that was not there. */
  failed = $state(false);
  /** The test surface is handed the four modules the moment they are here, before anything is read with them (a fault can be put in them). */
  onMods: ((mods: PlannerMods) => void) | null = null;
  /** The test surface wants a look at the controller and the host before the first init, to put them where the suites look. */
  onBuilt: ((s: { ui: PlannerUiApi; host: PlannerHost; mods: PlannerMods }) => void) | null = null;

  private starting: Promise<boolean> | null = null;

  /** Bring the planner up (once). Resolves true when it is up. */
  start(): Promise<boolean> {
    this.starting ??= this.run();
    return this.starting;
  }

  private async run(): Promise<boolean> {
    try {
      planner.request();                           // mounts the panel and the body-level pieces
      /* the controller is the largest piece of it, and the console's first screen needs none of it: fetched with the rest, here */
      const [mods, { makePlannerUI }] = await Promise.all([loadPlannerMods(), import('./plannerui'), ready, app.ready]);
      this.mods = mods;
      this.onMods?.(mods);
      custom.attach(mods.Planner);
      custom.restore();                            // idempotent: the saved orbits are in the list before the controller is built
      const host: PlannerHost = {
        obs: () => getObs(), mask: MASK, now: () => Date.now(), sat: satellite,
        catalogue: () => app.catalogue, customs: () => custom.list, current: () => app.analysis,
        window: () => ({ startMs: app.startMs === null ? Date.now() : app.startMs, hours: app.hours }),
        trial: (entry, t0, hours) => trial(mods, entry, t0, hours),
        add: customApi.add, update: customApi.update, remove: customApi.remove,
        show: e => app.select(e),
        pinned: PINNED, storageOk: () => custom.storageOk(),
        tracked: e => !isCustom(e), entryTle: e => ({ l1: e.l1, l2: e.l2 })
      };
      const ui = makePlannerUI(globalFor(mods, v => { this.hook = v; })) as PlannerUiApi;
      this.ui = ui;
      this.host = host;
      this.onBuilt?.({ ui, host, mods });
      /* Called under the snapshot too: the controller then unhides the pill as aria-disabled with the sentence and a way back, and
         returns false. Looked up on the window when the test surface put it there, so a spy on `init` is heard. */
      const w = window as unknown as { PlannerUI?: PlannerUiApi };
      const target = w.PlannerUI === ui ? w.PlannerUI : ui;
      try { target.init(host); } catch (e) { console.error(e); }
      this.enabled = !!ui.enabled();
      /* From now on every load of a spacecraft tells the controller, last. The property is looked up when it is called. The controller reads
         the console it is told about (the window bar's zone, the masthead), so what the load changed is painted first: Svelte would paint it
         at the end of the task. Inside an effect the flush that is running does it. */
      app.afterLoad = D => {
        try { flushSync(); } catch { /* inside an effect */ }
        (w.PlannerUI === ui ? w.PlannerUI : ui).onLoad(D);
      };
      return this.enabled;
    } catch (e) {
      console.error(e);                            // the chunk did not arrive (offline, say): no planner, and the console is the console it was
      this.failed = true;
      this.starting = null;
      return false;
    }
  }

  /** Open the planner from somewhere (the pill, the picker's last row, a chip), bringing it up first if it is not. */
  async open(from: 'pill' | 'picker' | 'chip' | 'tle' | 'api', o: { name?: string; entry?: CustomEntry } = {}): Promise<void> {
    if (PINNED) return;
    if (!(await this.start()) || !this.ui) return;
    try { this.ui.open({ from, ...o }); } catch (e) { console.error(e); }
  }
}

export const session = new PlannerSession();

/** After the first answer is on screen, when the browser has nothing better to do: the planner brings the Professor's notes on the
 *  spacecraft on screen, and the reader's saved orbits. In the snapshot there is nothing to bring (the pill says why, and is static). */
export function scheduleSession(): void {
  if (PINNED) return;
  const go = () => { void session.start(); };
  void app.ready.then(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric.call(window, go, { timeout: 4000 }); else setTimeout(go, 1500);
  }, () => { /* the console has no catalogue: nothing to plan against */ });
}
