/* The close-up's spacecraft (CHANGES-FROM-LEGACY.md, L72): a model drawn over the globe, where the spacecraft is, the way it flies.
 *
 * The globe's camera cannot draw it. Its unit is the Earth's radius and its near plane 64 km away, and a float there is 0.76 m wide,
 * so a CubeSat would be clipped away and a station would shiver. orbit3d's close-up puts the globe's camera at the spacecraft
 * (aimPov, as POV does: from tens of metres away the planet is the same picture) and then calls render() here, after the globe has
 * been drawn, for a second pass with a scene, a camera and lights of its own, in metres, cleared of the globe's depth: at these
 * ranges nothing of the planet can be in front of the craft.
 *
 * That scene is the craft's own frame, local vertical and local horizontal (lib/models/attitude.ts): +Z along the track, +Y away
 * from the Earth. The models are exported in it, so a station flying its usual attitude needs no turn at all, and everything that
 * depends only on where the Earth is stays still in it: the Earth's glow from below and its reflection, which is one environment map
 * made once (an Earth-lit lower sky with the limb's blue line, black above). What moves is the camera, the globe camera's turn taken
 * into this frame, and the Sun, whose light goes red and then out as the craft passes into the Earth's shadow
 * (lib/models/sunlight.ts). The Sun is the owner's renders' 4 W/m2, with physically correct lights, and the picture goes through the
 * same AgX as the realistic globe (scene/look-glsl.ts), put into r128's CustomToneMapping for this pass.
 *
 * The renderer's settings this pass needs (tone mapping, physically correct lights, shadows, no auto-clear) are set for the pass and
 * put back after it, every frame: the globe's own pass, and everything the ab3d gate records, never sees them.
 *
 * How the model flies is the one turn of its pivot (L77). Flying its own attitude from the clock's epoch, it is drawn by the same two
 * lines as before the reader could change it (a page's model's slow spin, or none), so the default close-up is the same to the bit;
 * anything the reader sets (setAttitude) is lib/models/attitude.ts's pose, anchored at the instant last drawn so that nothing on screen
 * jumps but what the reader points somewhere else. The anchor and the stars' hold belong to the model shown, and start again only when
 * another model is shown (its id): the same model shown again, as the card does when a panel closes, keeps its turn. */
import {
  Box3, BufferAttribute, CanvasTexture, DirectionalLight, EquirectangularReflectionMapping, Group, LinearFilter, LinearMipmapLinearFilter,
  LoadingManager, Matrix4, PCFSoftShadowMap, PerspectiveCamera, Quaternion, Scene, ShaderChunk, Vector3,
  type Material, type Mesh, type Object3D, type Texture, type WebGLRenderer
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ANCHOR0, IDENTITY, lvlh, mulQuat, pointingOf, pose as poseOf, reanchor, sameAttitude, spinAngle, spinAxisOf, spinRate,
  type Attitude, type PoseAt, type Quat, type SpinAnchor
} from '../lib/models/attitude';
import { dayBelow, sunlight } from '../lib/models/sunlight';
import type { ModelId } from '../lib/models/registry';
import { AGX_CHUNK, CUSTOM_TONE_PLACEHOLDER, SUN_E } from './look-glsl';

/** The models the page ships, by registry id: whatever src/assets/models holds at build time (a Tiangong file added later needs no
 *  code change). Imported by URL, so each is a file of its own on the long cache, fetched only when its close-up is opened. */
const FILES = import.meta.glob('../assets/models/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
export const MODEL_URLS: Partial<Record<ModelId, string>> = Object.fromEntries(
  Object.entries(FILES).map(([p, url]) => [/([\w-]+)\.glb$/.exec(p)?.[1] ?? '', url])
);

/** A model ready to show: in metres, in the canonical frame, centred on its bounding box. */
export interface CraftModel {
  object: Object3D;
  /** half its bounding box's diagonal, m */
  radius: number;
  triangles: number;
  /** its bounding box, m */
  size: [number, number, number];
  dispose(): void;
}

export interface Shown extends CraftModel {
  /** how the model flies of its own (lib/models/attitude.ts ownAttitude): a page's model with its spin, a reader's with none */
  own: Attitude;
  /** which model this is: a registry id, lib/models/attitude-record.ts ownId for a reader's kept model, '' for one not kept */
  id?: string;
  /** the reader's setting for it, or null for its own */
  attitude?: Attitude | null;
}

/** The close-up's frame angles and range, which orbit3d owns (close0) and this sets from the model's size. */
export interface CloseFrame { yaw: number; pitch: number; dist: number; min: number; max: number }

export interface Craft {
  /** orbit3d's call, after the globe is drawn, every frame the close-up is on */
  render(renderer: WebGLRenderer, cam: PerspectiveCamera, satPos: Vector3 | null, satVel: Vector3 | null, sun: Vector3, simTime: Date, c0: CloseFrame): void;
  /** put a model up (null: none), and frame it */
  show(m: Shown | null): void;
  /** the view back to where the close-up starts */
  reset(): void;
  /** fly the model shown as `a` (null: its own) from the instant last drawn, so nothing on screen jumps; ignored unless `id`, when
   *  given, is the model shown */
  setAttitude(a: Attitude | null, id?: string): void;
  /** the model shown back to its own attitude exactly as the page draws it, its spin's phase the clock's again */
  resetAttitude(id?: string): void;
  /** the model shown flown as `a` from the instant last drawn with the turns made so far let go: straight from now, its spin starting
   *  again from there (the card's "Reset orientation"); call it before the setting is stored, so that setAttitude finds it flown */
  levelTurn(a: Attitude, id?: string): void;
  /** is the craft in the Earth's shadow, as of the last frame */
  readonly shadowed: boolean;
  dispose(): void;
}

/* ---- loading ---------------------------------------------------------------------------------------------------------- */

/** A loader that can fetch nothing but the page's own files and what a model carries inside it (blob: and data: URLs): a model
 *  file that names a web address gets an empty answer, not a request. */
function loader(): GLTFLoader {
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (/^(blob|data):/i.test(url)) return url;
    try { if (new URL(url, location.href).origin === location.origin) return url; } catch { /* fall through */ }
    return 'data:,';
  });
  return new GLTFLoader(manager);
}

/** Load a glTF model from the page's own file (a URL) or from a reader's bytes (a .glb or a .gltf, as read from the file), and make it
 *  ready to show, centred on its bounding box unless `centre` is false. The page's own models are centred on their bodies by the scripts
 *  that build them (scripts/models): KNACKSAT-2's half-metre VHF antenna would otherwise pull the box, and the camera, off the spacecraft.
 *  A reader's model is then turned and scaled with orient(). */
export function loadModel(src: string | ArrayBuffer, o: { centre?: boolean } = {}): Promise<CraftModel> {
  return new Promise<CraftModel>((resolve, reject) => {
    const done = (gltf: { scene: Group }) => {
      try { resolve(prepare(gltf.scene, o)); } catch (e) { reject(e); }
    };
    const l = loader();
    if (typeof src === 'string') l.load(src, done, undefined, reject);
    else l.parse(src, '', done, reject);
  });
}

/** A reader's model in the canonical frame: turned by `frame` (a column-major 3x3, lib/models/attitude.ts modelFrame, null for none)
 *  and scaled by `scale` (its units to metres), about its centre. Applied to the model's holder, so changing either is a new turn of
 *  the same model, not a second parse of the file. */
export function orient(m: CraftModel, frame: number[] | null, scale: number): CraftModel {
  const f = frame;
  const r = new Matrix4();
  if (f) r.set(f[0]!, f[3]!, f[6]!, 0, f[1]!, f[4]!, f[7]!, 0, f[2]!, f[5]!, f[8]!, 0, 0, 0, 0, 1);
  m.object.quaternion.setFromRotationMatrix(r);
  m.object.scale.setScalar(scale);
  return { ...m, radius: m.radius * scale, size: [m.size[0] * scale, m.size[1] * scale, m.size[2] * scale] };
}

function prepare(scene: Group, o: { centre?: boolean }): CraftModel {
  const holder = new Group();
  holder.add(scene);
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  if (box.isEmpty()) throw new Error('the model has nothing to draw');
  const centre = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
  if (o.centre !== false) scene.position.sub(centre);
  let triangles = 0;
  const geometries = new Set<{ dispose(): void }>(), materials = new Set<Material>(), textures = new Set<Texture>();
  scene.traverse(x => {
    const mesh = x as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    const g = mesh.geometry;
    geometries.add(g);
    triangles += Math.floor((g.index ? g.index.count : (g.getAttribute('position') as BufferAttribute).count) / 3);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(m);
      for (const v of Object.values(m)) if (v && (v as Texture).isTexture) textures.add(v as Texture);
    }
  });
  return {
    object: holder, radius: Math.max(size.length() / 2, 0.05), triangles, size: [size.x, size.y, size.z],
    dispose() { for (const x of [...geometries, ...materials, ...textures]) x.dispose(); }
  };
}

/* ---- the pass --------------------------------------------------------------------------------------------------------- */

/** The Earth's light on a craft in low orbit, in its own frame, as an equirectangular picture: below the horizon (19.8 degrees down
 *  from 400 km) the day side's blue-grey, at the horizon the air's thin blue line, above it nothing. The renderer turns it into a
 *  mipmapped cube map itself, whose levels stand in for rough reflections (PMREMGenerator would do it better, and would bring a few
 *  kilobytes of three into the first screen's chunk for it). Drawn in sRGB, as a picture is. */
function earthEnvironment(): Texture {
  const W = 256, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const horizon = H * (0.5 + 19.8 / 180);                  // the row where the Earth's limb is
  const sky = g.createLinearGradient(0, horizon - 6, 0, H);
  sky.addColorStop(0, 'rgba(120,180,225,0)');
  sky.addColorStop(0.06, 'rgba(150,200,235,1)');           // the air's line along the limb
  sky.addColorStop(0.16, 'rgb(150,163,182)');              // the day side's blue-grey
  sky.addColorStop(1, 'rgb(140,152,170)');
  g.fillStyle = sky; g.fillRect(0, horizon - 6, W, H - horizon + 6);
  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  return t;
}

let agxIn = false;
/** AgX into r128's CustomToneMapping, once: programs compiled after this have it (only this pass asks for CustomToneMapping). */
function useAgx(): void {
  if (agxIn) return;
  const chunk = ShaderChunk as unknown as Record<string, string>;
  if (chunk.tonemapping_pars_fragment!.includes(CUSTOM_TONE_PLACEHOLDER))
    chunk.tonemapping_pars_fragment = chunk.tonemapping_pars_fragment!.replace(CUSTOM_TONE_PLACEHOLDER, AGX_CHUNK);
  agxIn = true;
}

const DEFAULT = { yaw: 35, pitch: -18 };
/** r128's CustomToneMapping (node_modules/three/src/constants.js:55), which its type declarations (@types/three 0.128) leave out. */
const CUSTOM_TONE_MAPPING = 5;

export function makeCraft(o: { renderer: WebGLRenderer; wake?: () => void; lean?: boolean }): Craft {
  useAgx();
  const scene = new Scene();
  scene.environment = earthEnvironment();
  const cam = new PerspectiveCamera(42, 1, 0.01, 1000);

  const sun = new DirectionalLight(0xffffff, SUN_E);
  sun.castShadow = true;
  sun.shadow.mapSize.set(o.lean ? 1024 : 2048, o.lean ? 1024 : 2048);
  scene.add(sun, sun.target);
  /* the Earth's glow from below, (0.708, 0.863, 1.0) as the owner's renders light the craft's underside */
  const earthshine = new DirectionalLight(0xb4dcff, 0);
  scene.add(earthshine, earthshine.target);
  const pivot = new Group();
  scene.add(pivot);

  let shown: Shown | null = null, materials: Material[] = [], frameNext = true, last: CloseFrame | null = null, inShadow = false;
  const basis = new Matrix4(), qL = new Quaternion(), qInv = new Quaternion(), sunM = new Vector3(), axis = new Vector3();
  /* how the model flies (L77): the reader's attitude (null: its own), its spin's anchor, the stars' hold, the pointing as of the last
     frame, the instant last drawn, and the model all of it belongs to */
  let flown: Attitude | null = null, anchor: SpinAnchor = ANCHOR0, held: Quat | null = null, pointed: Quat = IDENTITY;
  let lastMs: number | null = null, shownId: string | undefined;

  /** From the instant last drawn: the spin carries on from where it was (a new pointing or face starts it again from there), and
   *  'stars' holds the model where that frame had it. */
  function fly(next: Attitude, now: Attitude): void {
    if (lastMs !== null) anchor = reanchor(now, next, anchor, lastMs);
    if (next.pointing !== 'stars') held = null;
    else if (now.pointing !== 'stars') held = lastMs !== null ? mulQuat([qL.x, qL.y, qL.z, qL.w], pointed) : null;
    flown = next;
  }

  return {
    get shadowed() { return inShadow; },
    show(m) {
      /* the same model turned or scaled anew (the panel's units and axes) is the same object, and is not disposed */
      if (shown && shown.object !== m?.object) { pivot.remove(shown.object); shown.dispose(); }
      const was = shown ? flown ?? shown.own : null, again = !!m && !!m.id && m.id === shownId;
      shown = m;
      /* the same model shown again keeps its turn and takes the setting it is given from there; another starts at the clock's epoch */
      if (m && again && was) {
        const next = m.attitude ?? m.own;
        if (!sameAttitude(next, was)) fly(next, was);
      } else {
        shownId = m?.id; flown = m?.attitude ?? null; anchor = ANCHOR0; held = null; pointed = IDENTITY; lastMs = null;
      }
      materials = [];
      if (m) {
        if (m.object.parent !== pivot) pivot.add(m.object);
        m.object.traverse(x => {
          const mesh = x as Mesh;
          if (mesh.isMesh) for (const mm of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.push(mm);
        });
        const r = m.radius;
        sun.shadow.camera.left = sun.shadow.camera.bottom = -r * 1.1;
        sun.shadow.camera.right = sun.shadow.camera.top = r * 1.1;
        sun.shadow.camera.near = r * 0.05;
        sun.shadow.camera.far = r * 4;
        sun.shadow.camera.updateProjectionMatrix();
        sun.shadow.normalBias = r * 0.004;
        sun.shadow.bias = -0.0002;
      }
      frameNext = true;
      o.wake?.();
    },
    reset() {
      if (last) { last.yaw = DEFAULT.yaw; last.pitch = DEFAULT.pitch; }
      frameNext = true;
      o.wake?.();
    },
    setAttitude(a, id) {
      if (!shown || (id !== undefined && id !== shownId)) return;
      const now = flown ?? shown.own, next = a ?? shown.own;
      if (sameAttitude(next, now)) return;
      fly(next, now);
      o.wake?.();
    },
    resetAttitude(id) {
      if (!shown || (id !== undefined && id !== shownId)) return;
      flown = null; anchor = ANCHOR0; held = null;
      o.wake?.();
    },
    levelTurn(a, id) {
      if (!shown || (id !== undefined && id !== shownId)) return;
      flown = a; held = null; pointed = IDENTITY;
      anchor = lastMs !== null ? { t0: lastMs, phase0: 0, base: IDENTITY } : ANCHOR0;
      o.wake?.();
    },
    render(renderer, globeCam, satPos, satVel, sunDir, simTime, c0) {
      last = c0;
      if (!satPos) return;
      const r = shown ? shown.radius : 10;
      if (frameNext || !(c0.dist > 0)) {
        c0.min = r * 1.1;
        c0.max = Math.max(r * 60, 50);
        c0.dist = r * 2.4;
        frameNext = false;
      }
      if (!shown) return;
      /* the craft's frame, and the globe camera's turn taken into it */
      const f = lvlh([satPos.x, satPos.y, satPos.z], satVel ? [satVel.x, satVel.y, satVel.z] : null);
      basis.makeBasis(new Vector3(...f.left), new Vector3(...f.up), new Vector3(...f.forward));
      qL.setFromRotationMatrix(basis);
      qInv.copy(qL).invert();
      cam.quaternion.copy(qInv).multiply(globeCam.quaternion);
      cam.position.set(0, 0, c0.dist).applyQuaternion(cam.quaternion);
      cam.fov = globeCam.fov;
      cam.aspect = globeCam.aspect;
      cam.near = Math.max(0.005, c0.dist / 400);
      cam.far = c0.dist + r * 8 + 50;
      cam.updateProjectionMatrix();

      /* the Sun, in the craft's frame, as much of it as the Earth and its air let through */
      const sp: [number, number, number] = [satPos.x, satPos.y, satPos.z], sd: [number, number, number] = [sunDir.x, sunDir.y, sunDir.z];
      const light = sunlight(sp, sd);
      inShadow = light.geometric < 0.02;
      sunM.copy(sunDir).applyQuaternion(qInv).normalize();
      /* black in the shadow rather than switched off: a light that comes and goes would recompile every material at the terminator */
      sun.color.setRGB(light.rgb[0], light.rgb[1], light.rgb[2]);
      sun.position.copy(sunM).multiplyScalar(r * 2);
      const below = dayBelow(sp, sd);
      earthshine.intensity = 0.3 * SUN_E * below;
      earthshine.position.set(0, -r * 2, 0);
      for (const m of materials) (m as Material & { envMapIntensity?: number }).envMapIntensity = 0.12 + 0.88 * below;

      /* the model's turn (L77): its own attitude from the clock's epoch by the two lines it has always been drawn with, anything the
         reader set by its pose, 'stars' taking its hold from the frame before it was chosen (or this one, when none was drawn) */
      const ms = simTime.getTime(), fa = flown ?? shown.own;
      if (anchor === ANCHOR0 && held === null && sameAttitude(fa, shown.own)) {
        /* a rate about one axis alone, as every page's model has: that axis and that rate exactly (its rate vector's direction and
           length), so the turn is the one it was drawn with when the spin was one axis and one rate */
        const r = spinRate(shown.own.spin);
        if (r) {
          const v = spinAxisOf(r);
          pivot.quaternion.setFromAxisAngle(axis.set(v[0], v[1], v[2]), spinAngle(Math.hypot(r[0], r[1], r[2]), ms));
        } else pivot.quaternion.identity();
        pointed = IDENTITY;
      } else {
        const frame: Quat = [qL.x, qL.y, qL.z, qL.w];
        if (fa.pointing === 'stars' && !held) held = mulQuat(frame, pointed);
        const at: PoseAt = { sun: [sunM.x, sunM.y, sunM.z], frame, held };
        pointed = pointingOf(fa, at);
        const q = poseOf(fa, at, ms, anchor);
        pivot.quaternion.set(q[0], q[1], q[2], q[3]);
      }
      lastMs = ms;

      const was = {
        autoClear: renderer.autoClear, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure,
        pcl: renderer.physicallyCorrectLights, shadows: renderer.shadowMap.enabled, type: renderer.shadowMap.type
      };
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.toneMapping = CUSTOM_TONE_MAPPING as typeof renderer.toneMapping;
      renderer.toneMappingExposure = 1;
      renderer.physicallyCorrectLights = true;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFSoftShadowMap;
      try {
        renderer.render(scene, cam);
      } finally {
        renderer.autoClear = was.autoClear;
        renderer.toneMapping = was.toneMapping;
        renderer.toneMappingExposure = was.exposure;
        renderer.physicallyCorrectLights = was.pcl;
        renderer.shadowMap.enabled = was.shadows;
        renderer.shadowMap.type = was.type;
      }
    },
    dispose() {
      if (shown) { pivot.remove(shown.object); shown.dispose(); shown = null; }
      flown = null; held = null; lastMs = null;
      scene.environment?.dispose();
    }
  };
}
