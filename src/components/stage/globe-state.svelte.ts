import type { Globe } from '../../scene';
import { sgp4Track } from '../../lib/core/propagator';
import { iso } from '../../lib/text/fmt';
import { tzAt } from '../../lib/places';
import { app } from '../../state/app.svelte';
import { clock } from '../../state/clock.svelte';
import { BODY, MASK, getObs, satellite } from '../../state/engine';
import { live } from '../../state/live.svelte';

/* The 3D globe's controller: when the scene is built, what it is told, and what the controls on it say.
 *
 * The scene itself (src/scene) is the old orbit3d, orbitviz and globetex moved as they were; it is imperative, it owns the
 * canvas and the few labels it writes words into, and it is a chunk of its own (three.js and the Blue Marble loader),
 * fetched only when a globe is to be drawn. This is the part that was page code in the old index.html (boot3D and the
 * handlers around it, lines 12271-12501, with load()'s three calls into the scene): choosing the surface and saying how it is
 * going, the camera modes, the trail, the layers, the pick-and-confirm, and giving the scene the analysis, the observer and
 * the clock. The stores are read here and pushed into the scene; the scene never reads a store. */

export type CamMode = 'free' | 'sat' | 'site' | 'pov';
export type TrailKey = 'off' | '1800000' | 'orbit' | '21600000' | 'all';
export interface SurfaceMode { key: string; label: string; note?: string }
export interface LayerInfo { key: string; label: string }
export interface SurfaceNote { text: string; warn: boolean }
export interface Pick { index: number; name: string; satnum: string; x: number; y: number }

const SURFACE_KEY = 'gt.surface';
/* The Blue Marble that ships with the page. The old page opened on "Blue Marble & city lights" (key 'night'), whose lights are a
   NASA GIBS mosaic fetched at every start: a third-party request on load, and a page that is not offline under ?tle=embedded.
   Until the lights are baked into the shipped imagery (CHANGES-FROM-LEGACY.md, item 3) the default is the part that is local;
   the lights are still one choice away in the Layers panel, and a saved choice wins. */
const DEFAULT_SURFACE = 'marble';

/** The nodes the scene writes words into, by the names it knows them by. */
export interface GlobeNodes {
  canvas: HTMLCanvasElement;
  name: HTMLElement | null; hover: HTMLElement | null; earth: HTMLElement | null; alt: HTMLElement | null;
  mini: HTMLCanvasElement | null; fov: HTMLElement | null; fovmm: HTMLElement | null; gsd: HTMLElement | null; gsdu: HTMLElement | null;
}

function savedSurface(): string {
  try { return localStorage.getItem(SURFACE_KEY) || DEFAULT_SURFACE; } catch { return DEFAULT_SURFACE; }
}

class GlobeState {
  /** idle: not asked for yet; loading: the chunk is on its way; ready: a scene is drawing; unavailable: no WebGL (or it failed) */
  status = $state<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  mode = $state<CamMode>('sat');
  trail = $state<TrailKey>('21600000');
  /** the switches in the Layers panel (the sky layers, the footprint, the Earth, the catalogue's dots) */
  layers = $state({ frame: false, elements: false, constellations: false, footprint: true, earth: true, catalogue: true });
  surface = $state(savedSurface());
  surfaceNote = $state.raw<SurfaceNote>({ text: '', warn: false });
  surfaces = $state.raw<SurfaceMode[]>([]);
  skyLayers = $state.raw<LayerInfo[]>([]);
  pick = $state.raw<Pick | null>(null);
  /** is the globe showing and on screen (the scene stops drawing when it is not) */
  showing = $state(false);

  /** Resolves true when the scene is built, false when it cannot be. For the test surface. */
  ready: Promise<boolean>;
  private settle!: (ok: boolean) => void;
  private g: Globe | null = null;
  private nodes: GlobeNodes | null = null;
  private wanted = false;
  private started = false;
  private notes: Record<string, string> = {};

  constructor() {
    this.ready = new Promise(res => { this.settle = res; });
  }

  /** The scene, once built (the test surface exposes it as Orbit3D). */
  get scene(): Globe | null { return this.g; }

  /** The Globe component gives over its canvas and the nodes the scene writes into. */
  attach(n: GlobeNodes): void { this.nodes = n; void this.maybeStart(); }

  /** Somebody wants a globe: draw it as soon as the data it needs is in. */
  request(): void { this.wanted = true; void this.maybeStart(); }

  /** The data the scene is built from has arrived (the component calls this as the stores fill). */
  poke(): void { void this.maybeStart(); }

  private async maybeStart(): Promise<void> {
    if (this.started || !this.wanted || !this.nodes || !app.world || !app.catalogue.length) return;
    this.started = true;
    this.status = 'loading';
    /* The sky's labels (the planets, the Sun and Moon, the constellations' names, the element symbols) are baked once into
       canvases, from whatever face is loaded at that moment; a face that is still on its way gives them the wider fallback, and
       a wider label can cover the point under the pointer. So the three weights of the mono face are loaded first, beside the
       scene's own code and bounded: a font that is slow or missing must not keep the globe waiting. */
    const faces = Promise.race([
      Promise.all([400, 500, 600].map(w => document.fonts.load(w + ' 16px "IBM Plex Mono"'))),
      new Promise(res => setTimeout(res, 2500))
    ]).catch(() => undefined);
    let mod: typeof import('../../scene');
    try { [mod] = await Promise.all([import('../../scene'), faces]); } catch { this.status = 'unavailable'; this.settle(false); return; }
    const n = this.nodes;
    const gt = {
      WORLD: app.world, CAT: app.catalogue,
      get OBS() { return getObs(); },
      MASK,
      now: () => new Date(clock.now()),
      fmtUTC: (d: Date) => iso(d).replace('Z', ''),
      fmtLocal: (d: Date) => iso(new Date(d.getTime() + tzAt(app.site, d.getTime()) * 3600000)).replace('Z', '')
    };
    const g = mod.createGlobe({
      canvas: n.canvas,
      labels: { name: n.name, hover: n.hover, earth: n.earth, alt: n.alt, mini: n.mini, fov: n.fov, fovmm: n.fovmm, gsd: n.gsd, gsdu: n.gsdu },
      gt, body: BODY, satellite,
      /* the set a spacecraft is flown on is the live one when one has been taken: the catalogue's own record for the cloud's
         dots, the effective record for the one on screen */
      mkTrack: e => sgp4Track(BODY, live.effective(e), satellite),
      onPick: (index, x, y) => {
        const c = app.catalogue[index];
        if (c) this.pick = { index, name: c.name, satnum: c.satnum, x, y };
      },
      onFollow: () => this.syncMode(), onSite: () => this.syncMode(), onPov: () => this.syncMode(),
      onActivity: () => this.wake()
    });
    if (!g) { this.status = 'unavailable'; this.settle(false); return; }
    this.g = g;
    this.status = 'ready';
    const o = g.orbit3d;
    this.surfaces = o.surfaces();
    this.notes = Object.fromEntries(this.surfaces.map(m => [m.key, m.note || '']));
    this.skyLayers = g.viz ? g.viz.layers().filter((l: LayerInfo) => l.key !== 'stars' && l.key !== 'planets').map((l: LayerInfo) => ({ key: l.key, label: l.label })) : [];
    /* the saved surface, or the coastlines if it is one the page no longer offers */
    let want = this.surface;
    if (!this.surfaces.some(m => m.key === want)) want = 'vector';
    this.surface = want;
    o.setSurface(want, (st: Any) => this.surfaceStatus(st));
    this.syncMode();
    this.applyLayers();
    this.wake();
    /* a test that asks for the globe wants the sky as well: ready is when the stars can be drawn */
    void g.skyReady.then(() => { this.settle(true); this.wake(); });
    setInterval(() => this.policy(), 250);
  }

  /* ---- what the scene is told ---------------------------------------------------------------------------------- */

  /** A spacecraft has been analysed: fly it. Called as the analysis changes (after the scene exists, and once when it does). */
  load(): void {
    const g = this.g, D = app.analysis;
    if (!g || !D) return;
    /* the catalogue's own entry, not the effective copy: the cloud lights the dot whose record IS the one on screen. A planned
       orbit is not in the catalogue and is passed as it is. */
    const entry = app.embedded(D.entry.satnum) ?? D.entry;
    g.orbit3d.setSat(entry, D.E, { start: D.start.getTime(), hours: D.hours });
    this.applyTrail();                            // "1 orbit" is per spacecraft
    if (g.viz) g.viz.setOrbit({ satrec: D.satrec, elements: D.E });
  }

  /** The observer moved: the pin and the site camera follow. */
  siteMoved(): void { this.g?.orbit3d.siteMoved(); }

  /* ---- when a frame is worth drawing --------------------------------------------------------------------------- *
   * The old scene drew sixty frames a second whatever was happening. Now: nothing while the globe is not showing or not in view,
   * and nothing while the clock is stopped and nothing has moved for a couple of seconds; anything that could change the picture
   * (a pointer over it, a call into the scene, a seek, the clock starting, a resize) wakes it. While it draws, the pace follows
   * what is moving: every frame while the reader is dragging or the clock is fast, 30 a second under a fast-ish clock, ten a
   * second when only real time is passing (a low orbit covers 7.6 km a second, a pixel is about 20 km). */
  private activeUntil = 0;
  private interactUntil = 0;

  /** Something may have changed what the globe shows: draw for a while. */
  wake(ms = 2000): void {
    this.activeUntil = Math.max(this.activeUntil, performance.now() + ms);
    this.policy();
  }

  /** The reader is touching the globe: every frame for a moment, so a drag follows the hand. */
  interact(): void {
    this.interactUntil = performance.now() + 1200;
    this.wake(2500);
  }

  /** Set whether the scene is drawing, and how often, from the state of the page. */
  policy(): void {
    const g = this.g;
    if (!g) return;
    const now = performance.now(), playing = clock.playing;
    const busy = playing || now < this.activeUntil;
    g.raw.suspend(!this.showing || !busy);
    const r = clock.rate;
    g.raw.setPace(now < this.interactUntil || (playing && r > 60) ? 0 : playing ? (r > 2 ? 33 : 100) : 0);
  }

  /* ---- the controls -------------------------------------------------------------------------------------------- */

  setMode(m: CamMode): void {
    const o = this.g?.orbit3d;
    if (!o) { this.mode = m; return; }
    if (m === 'sat') o.setFollow(true);
    else if (m === 'site') o.setSite(true);
    else if (m === 'pov') o.setPov(true);
    else o.freeCam();
    this.syncMode();
  }

  /** The camera has one mode with three flags; the scene keeps them exclusive, and the control says which. */
  syncMode(): void {
    const o = this.g?.orbit3d;
    if (o) this.mode = o.pov ? 'pov' : o.site ? 'site' : o.follow ? 'sat' : 'free';
  }

  setTrail(t: TrailKey): void { this.trail = t; this.applyTrail(); }

  applyTrail(): void {
    const o = this.g?.orbit3d, D = app.analysis;
    if (!o) return;
    const v = this.trail;
    /* Off belongs in this control rather than beside it: one control with one state. */
    o.showTrack(v !== 'off');
    if (v === 'off') return;
    o.setTrail(v === 'all' ? Infinity : v === 'orbit' ? (D ? D.E.periodShown! * 1000 : 5400000) : +v);    // one revolution
  }

  setLayer(k: keyof typeof this.layers, on: boolean): void {
    this.layers[k] = on;
    this.applyLayers(k);
  }

  private applyLayers(only?: string): void {
    const g = this.g;
    if (!g) return;
    const o = g.orbit3d, L = this.layers;
    const all = !only;
    if (all || only === 'footprint') o.showFov(L.footprint);
    if (all || only === 'earth') o.showEarth(L.earth);
    if (all || only === 'catalogue') o.showCloud(L.catalogue);
    if (g.viz) {
      for (const k of ['frame', 'elements', 'constellations'] as const) if (all || only === k) g.viz.show(k, L[k]);
    }
    /* R(+) is drawn by orbit3d, not orbitviz, but it reads as one of the element annotations, so it rides the same switch */
    if (all || only === 'elements') o.showRVector(L.elements);
  }

  setSurface(key: string): void {
    this.surface = key;
    try { localStorage.setItem(SURFACE_KEY, key); } catch { /* private window: the choice holds for this visit */ }
    this.g?.orbit3d.setSurface(key, (st: Any) => this.surfaceStatus(st));
  }

  /* The page owns the wording; the scene owns the sequence (see Orbit3D.setSurface): loading, ready per rung, or failed. */
  private surfaceStatus(st: { state: string; key: string; detail?: string | null; meta?: { date?: string; source?: string } | null }): void {
    this.wake();                                  // an image arriving is a picture that changed, whatever the clock is doing
    if (st.state === 'loading') { this.surfaceNote = { text: 'Fetching NASA imagery…', warn: false }; return; }
    if (st.state === 'failed') {
      /* Named rather than swallowed: a globe that silently stayed schematic after you asked for a photograph is a bug report
         waiting to happen. The detail is added only when it says more than the lead already has. */
      const more = st.detail && !/^imagery unavailable\.?$/i.test(st.detail.trim()) ? ' ' + st.detail : '';
      this.surfaceNote = { text: 'Imagery unavailable — showing coastlines.' + more, warn: true };
      this.surface = 'vector';
      return;
    }
    let t = this.notes[st.key] || '';
    if (st.meta && st.meta.date) t += ' ' + st.meta.date + '.';
    if (st.detail) t += ' ' + st.detail;
    /* The surface names its own source: the Blue Marble ships with the page, the dated layers still come from GIBS, and the
       clouds mode is both. A single fixed credit line would be wrong for two of the three. */
    if (st.meta) t += ' Imagery courtesy ' + (st.meta.source || 'NASA') + '.';
    this.surfaceNote = { text: t.trim(), warn: false };
  }

  /* ---- picking a point in the cloud ---------------------------------------------------------------------------- */

  /** The cloud is dense enough that a click meant as a camera nudge could swap the spacecraft and reset the clock without the
   *  reader knowing why: ask first, and name what was picked. */
  confirmPick(): void {
    const p = this.pick;
    this.pick = null;
    const c = p && app.catalogue[p.index];
    if (c) app.select(c);
  }
  cancelPick(): void { this.pick = null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const globe = new GlobeState();
