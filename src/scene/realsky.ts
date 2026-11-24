/* The realistic sky (CHANGES-FROM-LEGACY.md, L75): what the realistic surface draws beyond the Earth, in place of the sky layers'
 * flat dabs. New in the rebuild; it rides the realism chunk (realism.ts makes it) and exists only while that surface is chosen.
 *
 *  - The Milky Way: NASA SVS's Deep Star Maps 2020, the starless map (the diffuse light of Gaia DR2 stars fainter than Tycho-2),
 *    baked to milkyway-<width>.jpg by scripts/bake-milkyway.py as linear light times MILKY_K, sRGB-encoded.
 *  - The stars: the page's own catalogue (sky-data.ts, HYG to V 5.5, 2,865 stars), each a soft point whose brightness and size
 *    follow its magnitude and whose colour follows its B-V, through a black body's temperature.
 *  - The Sun's glare: its disc, the bloom round it and six diffraction spikes, in the colour and the share of the Sun that reaches the
 *    camera (lib/models/sunlight: the Earth's limb covers it, and the air reddens it on the way).
 *  - The Moon: NASA's LRO colour map on a sphere lit by the Sun (Lommel-Seeliger, the regolith's law), at its true direction, size
 *    and phase as seen from the camera, its near side and poles oriented as the ephemeris says.
 *
 * Everything is in two groups centred on the camera each frame, so the sky is at infinity and has no parallax: the stars and the Milky
 * Way in J2000, turned to the date by the precession (orbitviz's ten lines); the Sun and the Moon of date. While it is on, the sky
 * layers' own Sun and Moon discs and star points are hidden (orbitviz.realSky); the planets and every name stay, moved to the camera
 * with this sky each frame (orbitviz.realSkyFrame), the Moon's name under the Moon drawn here.
 */
import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Group, LinearFilter, LinearMipmapLinearFilter,
  Matrix4, Mesh, PlaneGeometry, Points, RepeatWrapping, ShaderMaterial, SphereGeometry, Texture, Vector3
} from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { LOOK_COMMON } from './look-glsl';
import { sunlight } from '../lib/models/sunlight';
import { exposure } from '../lib/models/exposure';
import milky2048 from '../assets/sky/milkyway-2048.jpg?url';
import milky4096 from '../assets/sky/milkyway-4096.jpg?url';
import moon1024 from '../assets/sky/moon-1024.jpg?url';
import moon2048 from '../assets/sky/moon-2048.jpg?url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type V3 = [number, number, number];

/** the scale the Milky Way's rungs were baked with (scripts/bake-milkyway.py prints it) */
const MILKY_K = 10.012;
/** how bright the Milky Way is drawn against the look's exposure: art, not physics (with a sunlit Earth in view no camera shows it) */
const MILKY_GAIN = 1.1;
const STAR_GAIN = 1.0;
const R_FAR = 385, R_STARS = 380, R_NEAR = 370;
const RE_KM = 6378.137, MOON_KM = 1737.4;
const OBLIQUITY = 23.4393 * Math.PI / 180;

/** the Moon where the ephemeris puts it, km from the Earth's centre in the equatorial frame of date, and how it is turned */
export interface MoonAt { eciKm: V3; pole?: V3; prime?: V3 }

export interface SkyHandles {
  scene: Scene;
  renderer: WebGLRenderer;
  viz: { realSky?(on: boolean): void; realSkyFrame?(camPos: Vector3, moonPos: Vector3 | null): void; ephemeris?(d?: Date): Any } | null;
  now: () => Date;
  stars: () => Promise<string>;
  /** the Sun's direction in the scene's axes, current each frame (the look's own) */
  sunW: Vector3;
  /** the precise Moon (lib/core/moon), when it is there; otherwise the sky layers' series */
  moonAt?: (d: Date) => MoonAt | null;
  small: boolean;
  lean: boolean;
  wake?: () => void;
  /** is the close-up the camera, with the craft's model in the middle of the view (L83) */
  closeUp?: () => boolean;
}

export interface Sky {
  frame(cam: PerspectiveCamera): void;
  remove(): void;
}

/* scene axes are ECI turned -90 degrees about X: ECI (x, y, z) is drawn at (x, z, -y) */
const eciToScene = (v: V3, out = new Vector3()) => out.set(v[0], v[2], -v[1]);

/** B-V to the colour of a black body at the star's temperature (Ballesteros 2012; Planck's colours by a fit), linear, brightest 1 */
function bvColour(bv: number): V3 {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const k = t / 100;
  let r: number, g: number, b: number;
  if (k <= 66) { r = 255; g = 99.4708025861 * Math.log(k) - 161.1195681661; b = k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(k - 60, -0.1332047592); g = 288.1221695283 * Math.pow(k - 60, -0.0755148492); b = 255; }
  const c = [r, g, b].map(x => Math.pow(Math.min(255, Math.max(0, x)) / 255, 2.2)) as V3;
  const m = Math.max(c[0], c[1], c[2]);
  return [c[0] / m, c[1] / m, c[2] / m];
}

const MILKY_FRAG = `
uniform sampler2D uMap;
uniform float uOn;
uniform float uExpo;
varying vec2 vUv;
${LOOK_COMMON}
void main(){
  if (uOn < 0.5) discard;
  /* the map is the sky seen from inside, right ascension growing to the left; the sphere's own u grows the other way; times the
     exposure the view's brightest light allows (L83) */
  vec3 c = srgbToLinear(texture2D(uMap, vec2(1.0 - vUv.x, vUv.y)).rgb) / ${MILKY_K.toFixed(3)} * ${MILKY_GAIN.toFixed(2)} * uExpo;
  gl_FragColor = vec4(linearToSrgb(agx(c)), 1.0);
}`;

const STAR_VERT = `
attribute float aSize;
attribute vec3 aColour;
uniform float uDpr;
varying vec3 vColour;
void main(){
  vColour = aColour;
  gl_PointSize = aSize * uDpr;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const STAR_FRAG = `
uniform float uExpo;
varying vec3 vColour;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  /* a star is a point: the optics' core and a little scattered light round it */
  float i = exp(-r2 * 4.0) + 0.12 * exp(-r2 * 1.2);
  /* times the exposure (L83): added light, not tone-mapped, so the brightest stars are the last to go */
  gl_FragColor = vec4(vColour * i * ${STAR_GAIN.toFixed(2)} * uExpo, 1.0);
}`;

const QUAD_VERT = `
varying vec2 vQ;
void main(){
  vQ = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GLARE_FRAG = `
uniform vec3 uColour;
uniform float uDisc;
varying vec2 vQ;
void main(){
  float r = length(vQ);
  if (r > 1.0) discard;
  float a = atan(vQ.y, vQ.x);
  float disc = smoothstep(uDisc * 1.15, uDisc * 0.85, r);
  /* the bloom: the lens's and the eye's own scatter round a source this bright, wide and soft */
  float bloom = 0.9 * exp(-r / (uDisc * 2.5)) + 0.32 * exp(-r / 0.06) + 0.11 * exp(-r / 0.2) + 0.035 * exp(-r / 0.5);
  /* six spikes, as a lens's hexagonal stop throws them, a fainter six between, and a faint ghost ring */
  float spikes = pow(abs(cos(a * 3.0)), 220.0) + 0.18 * pow(abs(cos(a * 3.0 + 1.5708)), 260.0);
  spikes *= 0.55 * exp(-r / 0.22) * smoothstep(uDisc, uDisc * 3.0, r);
  float ring = 0.014 * exp(-pow((r - 0.6) / 0.02, 2.0));
  vec3 c = uColour * (2.5 * disc + bloom + spikes + ring) * smoothstep(1.0, 0.8, r);
  gl_FragColor = vec4(c, 1.0);
}`;

const MOON_VERT = `
varying vec2 vUv;
varying vec3 vN;
void main(){
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MOON_FRAG = `
uniform sampler2D uMap;
uniform float uOn;
uniform vec3 uSun;
uniform vec3 uView;
uniform vec3 uLight;
varying vec2 vUv;
varying vec3 vN;
${LOOK_COMMON}
void main(){
  vec3 N = normalize(vN);
  float m0 = max(dot(N, uSun), 0.0), m = max(dot(N, uView), 0.0);
  vec3 alb = uOn > 0.5 ? srgbToLinear(texture2D(uMap, vUv).rgb) : vec3(0.3);
  /* Lommel-Seeliger: the regolith's single scattering, so the full Moon is evenly bright to its edge as it is; the night side
     faintly lit by the Earth */
  vec3 c = alb * 0.42 * SUN_E * uLight * (m0 / max(m0 + m, 1e-3)) + alb * 0.004;
  gl_FragColor = vec4(linearToSrgb(agx(c)), 1.0);
}`;

export function makeSky(h: SkyHandles): Sky {
  const far = new Group(), near = new Group();
  far.name = 'realism-sky'; near.name = 'realism-sky-date';
  h.scene.add(far); h.scene.add(near);
  const textures: Texture[] = [];
  let gone = false;
  const load = (url: string, done: (t: Texture) => void, wrapS = ClampToEdgeWrapping) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => {
      if (gone) return;
      const t = new Texture(im);
      t.wrapS = wrapS as typeof t.wrapS; t.wrapT = ClampToEdgeWrapping;
      t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
      t.anisotropy = h.renderer.capabilities.getMaxAnisotropy();
      t.needsUpdate = true;
      textures.push(t);
      done(t);
      h.wake?.();
    };
    im.src = url;
  };
  const lite = h.small || h.lean;

  /* ---- the Milky Way: drawn first, behind everything, writing no depth ---- */
  const mwGeo = new SphereGeometry(R_FAR, 96, 48);
  const mwMat = new ShaderMaterial({
    uniforms: { uMap: { value: null as Texture | null }, uOn: { value: 0 }, uExpo: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: MILKY_FRAG, side: BackSide, depthWrite: false
  });
  const mw = new Mesh(mwGeo, mwMat);
  mw.renderOrder = -3; mw.frustumCulled = false;
  /* the sphere's u runs from right ascension 12h (its seam) round to 12h, as the map's does: RA 0h is its +X, 6h its -Z */
  far.add(mw);
  load(lite ? milky2048 : milky4096, t => { mwMat.uniforms.uMap!.value = t; mwMat.uniforms.uOn!.value = 1; }, RepeatWrapping);

  /* ---- the stars ---- */
  const starMat = new ShaderMaterial({
    uniforms: { uDpr: { value: 1 }, uExpo: { value: 1 } }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, blending: AdditiveBlending
  });
  let starGeo: BufferGeometry | null = null;
  h.stars().then(data => {
    if (gone || !data) return;
    const d = data.split(','), n = Math.floor(d.length / 4);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ra = +d[i * 4]! / 100 * Math.PI / 180, dec = +d[i * 4 + 1]! / 100 * Math.PI / 180;
      const v = +d[i * 4 + 2]! / 10, bv = +d[i * 4 + 3]! / 100;
      const cd = Math.cos(dec);
      eciToScene([cd * Math.cos(ra) * R_STARS, cd * Math.sin(ra) * R_STARS, Math.sin(dec) * R_STARS]).toArray(pos, i * 3);
      /* the light a star sends, by its magnitude, made something an eye can take in: each 2.5 magnitudes brighter is half again as
         big and bright on screen, the faintest still there */
      const f = Math.pow(10, -0.4 * (v - 1));
      const lum = Math.min(2.2, 0.32 + 0.75 * Math.pow(f, 0.45));
      const c = bvColour(bv);
      col[i * 3] = c[0] * lum; col[i * 3 + 1] = c[1] * lum; col[i * 3 + 2] = c[2] * lum;
      siz[i] = 2.2 + 3.6 * Math.min(1.6, Math.pow(f, 0.3));
    }
    starGeo = new BufferGeometry();
    starGeo.setAttribute('position', new BufferAttribute(pos, 3));
    starGeo.setAttribute('aColour', new BufferAttribute(col, 3));
    starGeo.setAttribute('aSize', new BufferAttribute(siz, 1));
    const pts = new Points(starGeo, starMat);
    pts.renderOrder = -2; pts.frustumCulled = false;
    far.add(pts);
    h.wake?.();
  }).catch(() => { /* no catalogue: the Milky Way alone */ });

  /* ---- the Sun's glare: a square facing the camera, drawn last, over everything ---- */
  const glareMat = new ShaderMaterial({
    uniforms: { uColour: { value: new Vector3(1, 1, 1) }, uDisc: { value: 0.01 } },
    vertexShader: QUAD_VERT, fragmentShader: GLARE_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending
  });
  const quad = new PlaneGeometry(1, 1);
  const glare = new Mesh(quad, glareMat);
  glare.renderOrder = 30; glare.frustumCulled = false;
  near.add(glare);

  /* ---- the Moon ---- */
  const moonGeo = new SphereGeometry(1, 64, 32);
  const moonMat = new ShaderMaterial({
    uniforms: { uMap: { value: null as Texture | null }, uOn: { value: 0 }, uSun: { value: new Vector3(1, 0, 0) }, uView: { value: new Vector3(0, 0, 1) }, uLight: { value: new Vector3(1, 1, 1) } },
    vertexShader: MOON_VERT, fragmentShader: MOON_FRAG
  });
  const moon = new Mesh(moonGeo, moonMat);
  moon.renderOrder = -1; moon.frustumCulled = false;
  near.add(moon);
  load(lite ? moon1024 : moon2048, t => { moonMat.uniforms.uMap!.value = t; moonMat.uniforms.uOn!.value = 1; }, RepeatWrapping);

  h.viz?.realSky?.(true);

  /* the precession: J2000 to the date, as orbitviz turns its own sky (recomputed when the date moves 30 days) */
  let precMs: number | null = null;
  const M = new Matrix4().makeRotationX(-Math.PI / 2), Mi = new Matrix4().makeRotationX(Math.PI / 2);
  const precess = (date: Date) => {
    const T = (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525, as = Math.PI / 180 / 3600;
    const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
    const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
    const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
    const R = new Matrix4().makeRotationZ(zeta).multiply(new Matrix4().makeRotationY(-theta)).multiply(new Matrix4().makeRotationZ(z));
    far.quaternion.setFromRotationMatrix(M.clone().multiply(R).multiply(Mi));
  };

  const fwd = new Vector3(), tmp = new Vector3(), mPos = new Vector3(), X = new Vector3(), Y = new Vector3(), Z = new Vector3();
  /* The exposure (L83): a camera, or an eye, set for what is bright in the view does not see the stars. The Sun in or near the view with
     the camera in sunlight takes them down to the brightest few; the sunlit Earth takes them down as far as it fills the view; in the
     Earth's shadow, looking at the night side or out at the sky, they are all there. The target is worked out each frame and the
     exposure eases toward it over about a second of real time, as an eye or a camera does, asking for frames until it is there
     (lib/models/exposure.ts works the target out). */
  let expo = 1, wallMs = 0;

  const rot = new Matrix4();
  const moonNow = (date: Date): MoonAt | null => {
    const precise = h.moonAt?.(date);
    if (precise) return precise;
    const e = h.viz?.ephemeris?.(date);
    const m = e && e.Moon;
    if (!m) return null;
    const ra = m.ra * Math.PI / 180, dec = m.dec * Math.PI / 180, km = m.dist * RE_KM;
    return { eciKm: [km * Math.cos(dec) * Math.cos(ra), km * Math.cos(dec) * Math.sin(ra), km * Math.sin(dec)] };
  };

  return {
    frame(cam) {
      if (gone) return;
      const date = h.now(), ms = date.getTime();
      far.position.copy(cam.position); near.position.copy(cam.position);
      if (precMs === null || Math.abs(ms - precMs) > 2.6e9) { precess(date); precMs = ms; }
      starMat.uniforms.uDpr!.value = h.renderer.getPixelRatio();
      const halfTan = Math.tan(cam.fov * Math.PI / 360);

      /* the Sun: as much of it as the Earth leaves the camera, in the colour the air leaves it */
      const s = h.sunW;
      const light = sunlight([cam.position.x, cam.position.y, cam.position.z], [s.x, s.y, s.z]);
      cam.getWorldDirection(fwd);
      const peak = Math.max(light.rgb[0], light.rgb[1], light.rgb[2]);
      const want = exposure({ cam: [cam.position.x, cam.position.y, cam.position.z], forward: [fwd.x, fwd.y, fwd.z], sun: [s.x, s.y, s.z],
        sunlight: peak, halfDiag: Math.atan(halfTan * Math.hypot(1, cam.aspect || 1)), subject: h.closeUp?.() ? 1 : 0 });
      const wall = performance.now();
      const dt = wallMs ? Math.min(1, (wall - wallMs) / 1000) : 1;
      wallMs = wall;
      expo += (want - expo) * (1 - Math.exp(-dt / 0.35));
      if (Math.abs(want - expo) < 0.002) expo = want; else h.wake?.();
      starMat.uniforms.uExpo!.value = expo;
      mwMat.uniforms.uExpo!.value = expo;
      glare.visible = peak > 1e-3 && fwd.dot(s) > -0.2;
      if (glare.visible) {
        const span = 0.9;                              /* the glare's square spans this share of the view's height */
        glare.position.copy(s).multiplyScalar(R_NEAR);
        glare.quaternion.copy(cam.quaternion);
        glare.scale.setScalar(2 * R_NEAR * halfTan * span);
        (glareMat.uniforms.uColour!.value as Vector3).set(light.rgb[0], light.rgb[1], light.rgb[2]);
        glareMat.uniforms.uDisc!.value = Math.tan(0.004652) / (halfTan * span);
      }

      /* the Moon, from the camera: its direction, its size and the side the Sun lights */
      const at = moonNow(date);
      moon.visible = !!at;
      if (at) {
        eciToScene([at.eciKm[0] / RE_KM, at.eciKm[1] / RE_KM, at.eciKm[2] / RE_KM], mPos);
        tmp.copy(mPos).sub(cam.position);
        const distKm = tmp.length() * RE_KM;
        tmp.normalize();
        moon.position.copy(tmp).multiplyScalar(R_NEAR);
        moon.scale.setScalar(R_NEAR * Math.sin(Math.asin(Math.min(1, MOON_KM / distKm))));
        /* turned so that its +X (the map's longitude 0) and +Y (its north) are the ephemeris's prime meridian and pole; without them,
           the near side faces the Earth and the north is the ecliptic's */
        if (at.prime && at.pole) { eciToScene(at.prime, X); eciToScene(at.pole, Y); }
        else { X.copy(mPos).negate(); Y.set(0, Math.cos(OBLIQUITY), Math.sin(OBLIQUITY)); }
        X.normalize(); Y.addScaledVector(X, -Y.dot(X)).normalize(); Z.crossVectors(X, Y);
        rot.makeBasis(X, Y, Z);
        moon.quaternion.setFromRotationMatrix(rot);
        (moonMat.uniforms.uSun!.value as Vector3).copy(s);
        (moonMat.uniforms.uView!.value as Vector3).copy(tmp).negate();
        /* the Moon is lit by the full Sun unless the Earth eclipses it: the same law as the camera's, at the Moon */
        const ml = sunlight([mPos.x, mPos.y, mPos.z], [s.x, s.y, s.z]);
        (moonMat.uniforms.uLight!.value as Vector3).set(ml.rgb[0], ml.rgb[1], ml.rgb[2]);
      }
      /* the sky layers' figures and names, kept on: to the camera too, and the Moon's name under this Moon */
      h.viz?.realSkyFrame?.(cam.position, at ? mPos : null);
    },
    remove() {
      gone = true;
      h.viz?.realSky?.(false);
      h.scene.remove(far); h.scene.remove(near);
      for (const x of [mwGeo, mwMat, starMat, glareMat, quad, moonGeo, moonMat, ...textures]) x.dispose();
      starGeo?.dispose();
    }
  };
}
