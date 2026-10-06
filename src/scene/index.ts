import { THREE } from './three';
import { makeGlobeTex } from './globetex';
import { makeOrbit3D } from './orbit3d';
import { makeOrbitViz } from './orbitviz';
import day2048 from '../assets/globe/bluemarble-2048.jpg?url';
import day4096 from '../assets/globe/bluemarble-4096.jpg?url';
import day8192 from '../assets/globe/bluemarble-8192.jpg?url';

/* The 3D globe: the scene (orbit3d), the sky layers it carries (orbitviz) and the photographic surfaces (globetex), wired
 * together the way the old page's boot3D() wired them. The three modules are the old files, moved with a wrapper and nothing
 * else changed (see their headers); this is the part that was page code: who is given what, in what order, and what is on at
 * the start. It knows nothing of the stores or the components: everything it needs is passed in, so it runs in a test, and the
 * chunk it makes is fetched only when a globe is to be drawn.
 *
 * three is r128, pinned: the palette and the day/night shader are tuned to r128's output encoding. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export { THREE };

/** What the scene reads from the page. `OBS` is read afresh each time it is used (the observer is a value that is replaced
 *  when it moves, and the scene must never hold on to the old one); everything else is fixed or a function. */
export interface GlobeGt {
  WORLD: Any;
  CAT: readonly Any[];
  readonly OBS: Any;
  MASK: number;
  now(): Date;
  fmtUTC(d: Date): string;
  fmtLocal(d: Date): string;
}

export interface GlobeInit {
  canvas: HTMLCanvasElement;
  /** the DOM nodes the scene writes words into: name, hover, el, earth, alt, mini, fov, fovmm, gsd, gsdu */
  labels: Record<string, HTMLElement | null>;
  gt: GlobeGt;
  body: Any;
  satellite: Any;
  mkTrack: (entry: Any) => Any;
  onPick?: (index: number, clientX: number, clientY: number) => void;
  onFollow?: (on: boolean) => void;
  onSite?: (on: boolean) => void;
  onPov?: (on: boolean) => void;
  /** called whenever something calls into the scene's API: whatever it changed is worth a frame (see Globe.orbit3d) */
  onActivity?: () => void;
}

export interface Globe {
  /** the scene: Orbit3D's whole old API (setSat, setFollow, setSite, setPov, freeCam, setTrail, showEarth, ...). Every call
   *  through it asks the host for a frame first, so a script that changes something while the globe is idle sees the result. */
  orbit3d: Any;
  /** the same scene without that: what the host's own frame policy (suspend, setPace) calls */
  raw: Any;
  /** the sky layers, or null if they could not be built (the globe still works without them) */
  viz: Any | null;
  globeTex: Any;
  /** the sky's data tables have been given to the sky layers (the stars and the constellation figures are drawn from then) */
  skyReady: Promise<void>;
  /** stop the sky layers' clock (the scene's own loop is never stopped; it is suspended instead) */
  stop(): void;
}

/* The star catalogue and the constellation figures are a chunk of their own (sky-data.ts, 20 KB gzipped): started here, as the scene's code
   is evaluated, so it is fetched beside the scene's own work and not after it. */
const skyData = import('./sky-data');

const LOCAL_DAY: Record<number, string> = { 2048: day2048, 4096: day4096, 8192: day8192 };

/** Build the globe on a canvas. Null when WebGL is not there: the page then says so and leans on the flat map. */
export function createGlobe(init: GlobeInit): Globe | null {
  /* What the old modules reached for as globals. The pixel ratio is a getter: a window dragged to another screen changes it. */
  const g: Any = {
    THREE, satellite: init.satellite, navigator, performance,
    get devicePixelRatio() { return window.devicePixelRatio; }
  };
  const globeTex = makeGlobeTex({ localDay: (w: number) => LOCAL_DAY[w] });
  g.GlobeTex = globeTex;
  const orbit3d = makeOrbit3D(g);
  const wake = init.onActivity ?? (() => {});
  /* Calls into the scene's API wake the host's frame policy (an idle globe draws nothing, so a call that changes the picture has
     to ask for a frame), without the scene knowing anything about it. suspend and setPace are the policy's own tools. */
  const woken = <T extends object>(o: T, own: string[] = []): T => new Proxy(o, {
    get(t, k) { const v = Reflect.get(t, k); return typeof v === 'function' && !own.includes(String(k)) ? (...a: unknown[]) => { wake(); return v.apply(t, a); } : v; },
    set(t, k, v) { wake(); return Reflect.set(t, k, v); }
  });
  const ok = orbit3d.init({
    canvas: init.canvas, gt: init.gt, satellite: init.satellite, body: init.body, mkTrack: init.mkTrack,
    labels: init.labels, onPick: init.onPick, onFollow: init.onFollow, onSite: init.onSite, onPov: init.onPov
  });
  if (!ok) return null;

  /* The sky layers share the scene and its camera, and are initialised after the renderer exists. The imagery is drawn by
     orbit3d, so if the sky module ever throws, the reader loses the star field and not the planet. */
  let viz: Any | null = null;
  try {
    viz = makeOrbitViz(g);
    g.OrbitViz = viz;
    viz.init({
      THREE, scene: orbit3d.scene, body: init.body, satellite: init.satellite, scale: 1 / 6378.137,
      /* orbitviz projects its own labels, so it needs the camera and the canvas. The occluding radius is a function
         rather than a constant because the Earth switch turns the globe off, and with it occlusion. */
      camera: orbit3d.camera, viewport: () => orbit3d.renderer.domElement, occluder: () => (orbit3d.earth ? 1 : 0)
    });
    /* Every layer starts off - the default view was deliberately decluttered - except the star field, which IS the sky and
       not an annotation over it, and the Sun, Moon and planets, which are sky too (their names ride the constellations
       switch). */
    viz.layers().forEach((l: Any) => viz.show(l.key, false));
    viz.show('stars', true);
    viz.show('planets', true);
    orbit3d.showRVector(false);
  } catch {
    viz = null; g.OrbitViz = undefined;
  }

  /* The sky layers' labels lay out on the camera and their anchors move on simulated time: the page called setTime once per
     animation frame, after the scene's own frame. The same here, from a loop of its own. */
  let raf = 0;
  const vizTick = (): void => {
    raf = requestAnimationFrame(vizTick);
    if (viz && !orbit3d.suspended) viz.setTime(init.gt.now());
  };
  raf = requestAnimationFrame(vizTick);

  const skyReady = viz ? skyData.then(d => { viz.setSkyData(d.STAR_DATA, d.CONST_JSON); }).catch(() => { /* no stars: the globe is still a globe */ }) : Promise.resolve();
  return { orbit3d: woken(orbit3d, ['suspend', 'setPace']), raw: orbit3d, viz: viz && woken(viz, ['setTime']), globeTex, skyReady, stop: () => cancelAnimationFrame(raf) };
}
