/* The realistic globe (CHANGES-FROM-LEGACY.md, L71): clouds, the air and the sea, drawn over the shipped Blue Marble the way the
 * owner's Blender renders draw them.
 *
 * A chunk of its own (`realism`), asked for by orbit3d when the Layers panel's "Realistic: clouds & atmosphere" surface is chosen
 * (scene/globetex.ts, the mode that says `real`), and never otherwise: the default globe, and every state the ab3d gate draws,
 * is the old page's to the pixel and to the scene graph. While it is on it changes four things, and puts each back exactly when
 * it goes:
 *
 *   - the Earth's material: a shader that keeps the day and night maps the photographic surface already has on the GPU (nothing
 *     is uploaded twice, and every sharper rung sharpen() fetches lands here too, through surface()), and adds the sunlight that
 *     is left after the air (red at the terminator), the shadows of the clouds a little way towards the Sun, the Sun's glint off
 *     open water, the city lights fading in through twilight, and the haze between the ground and the eye;
 *   - a cloud shell 11.5 km up (1.0018 Earth radii), in the Earth's group so it turns with it, under the access ring, the track and
 *     the footprint (1.003, 1.004, 1.006), lit the same way, its edges broken up by noise when the camera is close enough to see
 *     past the map's 20 km texels;
 *   - the atmosphere shell's geometry and material: a wider shell (1.12) whose shader is the sky itself, single-scattered sunlight
 *     along each ray that misses the planet, dark where the Earth's shadow falls on the air, with the soft cyan glow the owner's
 *     compositor laid outside the limb (a blur of 1 % of the frame's height);
 *   - the clear colour: opaque black, because space is black in the renders and the look is graded against it.
 *
 * Every colour goes through the same AgX curve as the close-up's model (scene/look-glsl.ts), against the Sun of the renders
 * (4 W/m2). The land and ocean mask for the glint is drawn here from the same coastlines as the flat map (GT.WORLD), so nothing is
 * downloaded for it. The cloud map is NASA's Blue Marble cloud composite, shipped with the page (src/assets/globe/clouds-*.jpg;
 * scripts/bake-clouds.py makes the sharper rungs from NASA's larger file). */
import {
  BackSide, CanvasTexture, ClampToEdgeWrapping, Color, CustomBlending, LinearFilter, LinearMipmapLinearFilter, LuminanceFormat, Mesh, OneFactor,
  RepeatWrapping, ShaderMaterial, SphereGeometry, Texture, Vector2, Vector3, Vector4, ZeroFactor,
  type BufferGeometry, type Group, type Material, type PerspectiveCamera, type Scene, type WebGLRenderer
} from 'three';
import { EARTH_DIFFUSE, LOOK_COMMON, SUN_E } from './look-glsl';
import { DETAIL_GLSL, makeDetail } from './realism-detail';
import { makeSky, type SkyHandles } from './realsky';
import { moonState } from '../lib/core/moon';

/** The look's own maps, whatever src/assets/globe holds at build time, each in the widths it was baked at: the clouds
 *  (clouds-2048.jpg, NASA's own file; sharper ones once baked by scripts/bake-clouds.py), and the sharper night, the land's relief and
 *  the open sea (scripts/bake-realism.py). A map that is not there is a map the look does without. */
const FILES = import.meta.glob('../assets/globe/{clouds,blackmarble,relief,ocean}-*.{jpg,png}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const rungs = (name: string) => Object.entries(FILES)
  .map(([p, url]) => ({ w: +(new RegExp(name + '-(\\d+)\\.').exec(p)?.[1] ?? 0), url }))
  .filter(r => r.w > 0).sort((a, b) => a.w - b.w);
const CLOUD_RUNGS = rungs('clouds'), NIGHT_RUNGS = rungs('blackmarble'), RELIEF_RUNGS = rungs('relief'), OCEAN_RUNGS = rungs('ocean');

export interface LookHandles {
  renderer: WebGLRenderer;
  earth: Mesh;
  earthGroup: Group;
  atmo: Mesh;
  /** the photographic surface's material: the maps, and the Sun direction orbit3d keeps current in it */
  photoMat: ShaderMaterial;
  /** the coastlines (GT.WORLD), for the glint's land and ocean mask */
  world: { features: { geometry: { type: string; coordinates: unknown } }[] };
  /** Save-Data or a slow link: the coarse cloud map, and half the steps through the air */
  lean: boolean;
  /** ask the page for a frame (a map that arrives is a picture that changed) */
  wake?: () => void;
  /** for the realistic sky (realsky.ts, L75): the scene, the sky layers, the page's clock and its star catalogue; without them the
   *  look draws the Earth and its air alone */
  scene?: Scene;
  viz?: SkyHandles['viz'];
  now?: () => Date;
  stars?: () => Promise<string>;
  moonAt?: SkyHandles['moonAt'];
  /** is the close-up the camera (the sky's exposure counts its sunlit model, L83) */
  closeUp?: () => boolean;
}

export interface Look {
  /** the material the Earth wears in place of the photographic one handed in (whose maps it takes) */
  surface(photo: ShaderMaterial): ShaderMaterial;
  /** once a frame, before the render: the Sun, and what depends on the camera */
  frame(cam: PerspectiveCamera): void;
  /** put everything back as it was */
  remove(): void;
}

/** The cloud layer's height, Earth radii (11.5 km). */
const CLOUD_H = 0.0018;
/** The air's density against the real atmosphere's: the owner's renders sit between half (the latest) and one (January). */
const DENSITY = 0.75;
/** City lights, against the full Sun on the ground. */
const NIGHT_GAIN = 0.55;
/** The relief map's top (GEBCO's white), Earth radii, and how much its slopes are steepened to be seen from orbit. */
const HMAX = 6400 / 6378137;
const RELIEF_K = 6.0;
/** The compositor's glow outside the limb: its strength at the limb, and its width as a share of the frame's height. */
const HALO = 0.24;
const HALO_SHARE = 0.01;

/* The Earth and the cloud shell are spheres of 160 x 96 facets, whose middles lie inside the true sphere by up to 1 - cos 1.46 deg
   (3.3e-4 of the radius, 2 km for the Earth). The sky's shader leaves every ray that meets the true sphere to the Earth's, so between
   the facets' edge and the true limb a sliver was drawn by neither: a dashed dark line along the horizon, seen close up. Each is drawn
   inflated by INFLATE, which covers the true sphere, and its fragments whose ray misses the true sphere are let go: both limbs are
   then the true circle, drawn once. */
const INFLATE = 1.0004;
/** the Rayleigh scale height, 8 km, in Earth radii (look-glsl's H_R) */
const H_R_RADII = 8 / 6378.137;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

const VERT = `
uniform float uInflate;
varying vec2 vUv;
varying vec3 vWP;
varying vec3 vWN;
varying vec3 vON;
varying vec3 vEast;
varying vec3 vNorth;
void main(){
  vec3 pos = position * uInflate;
  vUv = uv;
  vWP = (modelMatrix * vec4(pos, 1.0)).xyz;
  vWN = normalize(mat3(modelMatrix) * normal);
  vON = normal;
  /* the local east and north, for the relief's slopes: east is where longitude grows (the sphere's u), north the spin axis's way */
  vec3 n = normalize(normal), e = normalize(vec3(n.z, 0.0, -n.x) + vec3(1e-6, 0.0, 0.0));
  vEast = normalize(mat3(modelMatrix) * e);
  vNorth = normalize(mat3(modelMatrix) * cross(n, e));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

/* How near the ray from the eye through this fragment passes to the Earth's centre: the sky's own measure (SKY_FRAG), so that the
   shaders share the limb exactly. A sphere of radius r covers the fragment by (r - r0) over r0's change across a pixel, plus a half:
   that coverage, given to the multisample buffer as alpha (alphaToCoverage), smooths the limb the way the GPU smooths a polygon's edge;
   without multisampling (uA2C 0) the fragment is drawn or not at the half. */
const MEETS = `
uniform float uA2C;
float closest(vec3 wp){
  vec3 C = cameraPosition, D = normalize(wp - C);
  float tca = dot(-C, D);
  return tca > 0.0 ? sqrt(max(dot(C, C) - tca * tca, 0.0)) : length(C);
}
float coverage(float r0, float r){
  float c = clamp((r - r0) / max(fwidth(r0), 1e-7) + 0.5, 0.0, 1.0);
  return uA2C > 0.5 ? c : step(0.5, c);
}`;

/* The clouds over Thailand thinned (CHANGES-FROM-LEGACY.md, L84): NASA's cloud composite is one still picture, and the page's own
   country is its first view, so its land is left clear, an ellipse round 13 N 100.8 E (about 5 degrees of longitude and 8.5 of latitude
   across its half-widths, feathered over 4 more) where the deck keeps an eighth of its cover, its shadows with it. The credit says so. */
const CLOUD_OPACITY = `
float cloudOpacity(float v){ return smoothstep(0.08, 0.85, v); }
float clearSky(vec2 uv){
  vec2 d = vec2((uv.x * 360.0 - 180.0 - 100.8) / 5.0, (uv.y * 180.0 - 90.0 - 13.0) / 8.5);
  float r = length(d);
  return mix(0.12, 1.0, smoothstep(1.0, 1.0 + 4.0 / 6.5, r));
}`;

const EARTH_FRAG = `
uniform sampler2D uDay;
${DETAIL_GLSL}
uniform sampler2D uNight;
uniform sampler2D uNight2;
uniform sampler2D uClouds;
uniform sampler2D uMask;
uniform sampler2D uRelief;
uniform float uUseNight;
uniform float uNight2On;
uniform float uCloudOn;
uniform float uReliefOn;
uniform vec2 uReliefTexel;
uniform float uDensity;
uniform float uExposure;
uniform vec3 uSunW;
uniform vec3 uSunO;
varying vec2 vUv;
varying vec3 vWP;
varying vec3 vWN;
varying vec3 vON;
varying vec3 vEast;
varying vec3 vNorth;
${LOOK_COMMON}
${CLOUD_OPACITY}
${MEETS}
void main(){
  float cover = coverage(closest(vWP), 1.0);   /* past the true limb the sky draws it; on it, both share the pixel */
  if (cover <= 0.0) discard;
  vec3 N = normalize(vWN), L = normalize(uSunW), V = normalize(cameraPosition - vWP);
  float mu = dot(N, L), muv = max(dot(N, V), 0.0);
  vec3 day = srgbToLinear(dayColor(uDay, vUv));   /* the shipped map, or NASA's 500 m tiles where they have come (realism-detail.ts) */

  /* the relief: the slopes of the land's height (two texels apart each way, rise over run in Earth radii, steepened to be seen from
     orbit) tilt the normal the sunlight sees, so mountains are lit on one face and shaded on the other, most of all near the
     terminator. The terminator itself and the air's light stay on the sphere. */
  float lit = mu;
  if (uReliefOn > 0.5) {
    float hx = texture2D(uRelief, vUv + vec2(uReliefTexel.x, 0.0)).r - texture2D(uRelief, vUv - vec2(uReliefTexel.x, 0.0)).r;
    float hy = texture2D(uRelief, vUv + vec2(0.0, uReliefTexel.y)).r - texture2D(uRelief, vUv - vec2(0.0, uReliefTexel.y)).r;
    float cl = max(sqrt(max(1.0 - normalize(vON).y * normalize(vON).y, 0.0)), 0.05);
    float sx = hx * ${HMAX} / (4.0 * PI * cl * uReliefTexel.x), sy = hy * ${HMAX} / (2.0 * PI * uReliefTexel.y);
    lit = dot(normalize(N - ${RELIEF_K.toFixed(1)} * (sx * normalize(vEast) + sy * normalize(vNorth))), L);
  }

  /* the cloud overhead, and the one between this point and the Sun: its shadow lands a little way from under it */
  float cloudHere = 0.0, shade = 1.0;
  if (uCloudOn > 0.5) {
    cloudHere = cloudOpacity(texture2D(uClouds, vUv).r) * clearSky(vUv);
    vec3 O = normalize(vON), So = normalize(uSunO);
    vec3 Q = normalize(O + So * ${CLOUD_H} / max(dot(O, So), 0.1));
    vec2 duv = vec2(atan(-Q.z, Q.x) - atan(-O.z, O.x), asin(clamp(Q.y, -1.0, 1.0)) - asin(clamp(O.y, -1.0, 1.0)));
    duv.x = mod(duv.x + PI, 2.0 * PI) - PI;
    shade = 1.0 - 0.55 * cloudOpacity(texture2D(uClouds, vUv + duv / vec2(2.0 * PI, PI)).r) * clearSky(vUv + duv / vec2(2.0 * PI, PI)) * step(0.0, mu);
  }

  vec3 E = SUN_E * sunTransmit(1.0, mu, uDensity);
  vec3 c = day * ${EARTH_DIFFUSE} * E * max(lit, 0.0) * step(0.0, mu + 0.02) / PI * shade;

  /* the Sun's glint off open water: GGX, roughness 0.3, water's 2 % at normal incidence */
  float ocean = texture2D(uMask, vUv).r;
  if (ocean > 0.01 && mu > 0.0 && muv > 0.0) {
    vec3 Hh = normalize(L + V);
    float NdH = max(dot(N, Hh), 0.0), VdH = max(dot(V, Hh), 0.0);
    float a2 = 0.0081, d = NdH * NdH * (a2 - 1.0) + 1.0, k = 0.045;
    float D = a2 / (PI * d * d);
    float G = (mu / (mu * (1.0 - k) + k)) * (muv / (muv * (1.0 - k) + k));
    float F = 0.02 + 0.98 * pow(1.0 - VdH, 5.0);
    c += ocean * (1.0 - cloudHere) * shade * E * D * G * F / max(4.0 * muv, 1e-3);
  }

  /* city lights, through twilight into the night, dimmed under cloud. The mosaic is the Black Marble, lights over a navy moonlit
     landscape; the lights are what is warm in it, so the red channel picks them out and the night side is left black. */
  if (uUseNight > 0.5) {
    vec3 n = uNight2On > 0.5 ? texture2D(uNight2, vUv).rgb : texture2D(uNight, vUv).rgb;
    c += srgbToLinear(n) * smoothstep(0.08, 0.4, n.r) * ${NIGHT_GAIN} * (1.0 - smoothstep(-0.12, 0.02, mu)) * (1.0 - 0.6 * cloudHere);
  }

  vec3 T, S;
  aerial(1.0, muv, mu, -dot(V, L), uDensity, T, S);
  c = c * T + SUN_E * S;
  gl_FragColor = vec4(linearToSrgb(agx(c * uExposure)), cover);
}`;

const CLOUD_FRAG = `
uniform sampler2D uClouds;
uniform float uCloudOn;
uniform float uDensity;
uniform float uExposure;
uniform vec3 uSunW;
varying vec2 vUv;
varying vec3 vWP;
varying vec3 vWN;
varying vec3 vON;
${LOOK_COMMON}
${CLOUD_OPACITY}
${MEETS}
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
void main(){
  float a = cloudOpacity(texture2D(uClouds, vUv).r) * clearSky(vUv) * uCloudOn;
  /* Close up, the map's texels would show: the edges are broken with noise of 15, 7, 3, 1.5 and 0.7 km where the cover is partial (the
     last two since L87, for the close-up and POV). Each octave comes in only once its features span a few pixels here (the footprint of
     a pixel on the shell, from the derivatives), so a whole-globe view draws none of it and a grazing view does not alias. */
  float foot = max(length(fwidth(vWP)), 1e-7);
  float f = 420.0, amp = 0.5, n = 0.0;
  for (int k = 0; k < 5; k++) {
    n += amp * smoothstep(2.0, 5.0, 1.0 / (f * foot)) * (vnoise(normalize(vON) * f) - 0.5);
    f *= 2.13; amp *= 0.65;
  }
  a = clamp(a + n * 2.4 * a * (1.0 - a) * 4.0, 0.0, 1.0);
  vec3 N = normalize(vWN), L = normalize(uSunW), V = normalize(cameraPosition - vWP);
  /* seen aslant, a cloud deck is crossed over a longer path: thicker toward the limb, as the sky's own clouds are from orbit */
  a = 1.0 - pow(1.0 - a, 1.0 / max(dot(N, V), 0.12));
  a *= coverage(closest(vWP), 1.0 + ${CLOUD_H});   /* the clouds' own true limb */
  if (a < 0.004) discard;
  float mu = dot(N, L);
  /* Past the light, a cloud deck is black over black ground, and adds nothing to see but its edge: 11.5 km up, it stands above the night
     limb as a ragged dark band against the stars (L87). So it fades out as its light goes, gone by 7 degrees past the ground's terminator;
     the Earth's own shading still dims the city lights under it, from the map itself (cloudHere). */
  a *= smoothstep(-0.12, -0.04, mu);
  if (a < 0.004) discard;
  /* white cloud, lit by what is left of the Sun at its height: a deck 11.5 km up sees the Sun 3.4 degrees past the ground's terminator
     (mu -0.06), and no further. It was wrapped to 17 degrees (mu -0.3) for the light inside a cloud, which left a band of grey cloud lit
     over ground already in the dark (L87). */
  vec3 col = 0.8 * SUN_E * sunTransmit(1.0 + ${CLOUD_H}, mu, uDensity) * max((mu + 0.06) / 1.06, 0.0) / PI;
  vec3 T, S;
  aerial(1.0 + ${CLOUD_H}, max(dot(N, V), 0.0), mu, -dot(V, L), uDensity, T, S);
  col = col * T + SUN_E * S;
  gl_FragColor = vec4(linearToSrgb(agx(col * uExposure)), a);
}`;

const SKY_VERT = `
varying vec3 vWP;
void main(){
  vWP = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
uniform vec3 uSunW;
uniform float uDensity;
uniform float uExposure;
uniform float uHalo;
uniform float uHaloK;
varying vec3 vWP;
${LOOK_COMMON}
void main(){
  vec3 C = cameraPosition, D = normalize(vWP - C), L = normalize(uSunW);
  float tca = dot(-C, D);
  /* A ray that meets the planet is drawn as the limb's own sky: behind the Earth that is hidden by the Earth's depth, and on the
     limb's edge, where the Earth covers only part of a pixel, it fills the rest (it was discarded, and the black of space showed) */
  float r0 = max(tca > 0.0 ? sqrt(max(dot(C, C) - tca * tca, 0.0)) : length(C), 1.0);
  float cosT = dot(D, L);
  vec3 sky = vec3(0.0);
  if (r0 < R_TOP) {
    /* Rayleigh, marched across the tangent point, where the air along the ray is a Gaussian of width sqrt(r0 H) */
    float span = 3.5 * sqrt(r0 * H_R), ds = 2.0 * span / float(STEPS);
    for (int i = 0; i < STEPS; i++) {
      float t = tca - span + (float(i) + 0.5) * ds;
      if (t < 0.0) continue;
      vec3 p = C + D * t;
      float r = length(p);
      vec3 up = p / r;
      float toEye = -dot(up, D);
      vec3 Tv = exp(-uDensity * (BETA_R * chapman(r, toEye, H_R) + BETA_M_EXT * chapman(r, toEye, H_M)));
      sky += BETA_R * (uDensity * exp(-(r - 1.0) / H_R)) * sunTransmit(r, dot(up, L), uDensity) * Tv * ds;
    }
    sky *= phaseR(cosT);
    /* the aerosol, at the tangent point: its column is narrower than the steps */
    vec3 pt = C + D * max(tca, 0.0);
    float rt = length(pt);
    float odM = uDensity * 2.0 * H_M * exp(-(rt - 1.0) / H_M) * sqrt(1.5707963 * rt / H_M);
    vec3 Tv = exp(-uDensity * (BETA_R * chapman(rt, 0.0, H_R) + BETA_M_EXT * chapman(rt, 0.0, H_M)));
    sky += BETA_M * odM * phaseM(cosT) * sunTransmit(rt, dot(pt / rt, L), uDensity) * Tv;
    sky *= SUN_E;
  }
  /* the compositor's glow: a blur of the lit disc, so it is as wide as 1 % of the frame at the limb's distance */
  float sigma = uHaloK * max(tca, 0.02);
  vec3 limb = normalize(C + D * max(tca, 0.0));
  float h = r0 - 1.0;
  sky += uHalo * vec3(0.316, 0.856, 1.0) * exp(-0.5 * h * h / (sigma * sigma)) * smoothstep(-0.2, 0.35, dot(limb, L));
  gl_FragColor = vec4(linearToSrgb(agx(sky * uExposure)), 0.0);
}`;

/** The land and ocean mask for the glint: 1 over open water, from the coastlines the flat map is drawn with. */
function oceanMask(world: LookHandles['world']): CanvasTexture {
  const W = 2048, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const px = (lon: number) => (lon + 180) / 360 * W, py = (lat: number) => (90 - lat) / 180 * H;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.beginPath();
  for (const f of world.features) {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    for (const poly of polys) for (const ring of poly) {
      ring.forEach((p, i) => i ? g.lineTo(px(p[0]!), py(p[1]!)) : g.moveTo(px(p[0]!), py(p[1]!)));
      g.closePath();
    }
  }
  /* a hair of shore around the coasts: a glint on a beach reads as a misplaced coastline */
  g.fillStyle = '#000'; g.fill();
  g.strokeStyle = '#000'; g.lineWidth = 2.5; g.stroke();
  const t = new CanvasTexture(c);
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  return t;
}

export function makeLook(h: LookHandles): Look {
  const sunW = new Vector3(1, 0, 0), sunO = new Vector3(1, 0, 0);
  const steps = h.lean ? 6 : 12;
  /* uniforms the three materials share: one object each, so one write reaches all of them */
  const u = {
    uSunW: { value: sunW }, uSunO: { value: sunO }, uDensity: { value: DENSITY }, uExposure: { value: 1 },
    uClouds: { value: null as Texture | null }, uCloudOn: { value: 0 },
    uHalo: { value: HALO }, uHaloK: { value: 0.0077 }
  };
  const mask = oceanMask(h.world);
  /* the limb is smoothed through the multisample buffer when there is one (see MEETS) */
  let a2c = false;
  try { const gl = h.renderer.getContext(); a2c = (gl.getParameter(gl.SAMPLES) || 0) > 0; } catch { /* no context to ask: drawn hard */ }
  /* until the cloud map arrives, the sampler is bound to the mask rather than to nothing (see applyPhoto: undefined on some drivers) */
  u.uClouds.value = mask;

  /* NASA's 500 m tiles for the ground in view close up (realism-detail.ts): not on a lean connection; a smaller window on a phone */
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* no media queries: a desktop */ }
  const detail = h.lean ? null : makeDetail(h.renderer, { small: coarse, wake: h.wake });
  /* the sky beyond the Earth (realsky.ts): only when the page has handed in the scene, its clock and its catalogue */
  const sky = h.scene && h.now && h.stars
    ? makeSky({
        scene: h.scene, renderer: h.renderer, viz: h.viz ?? null, now: h.now, stars: h.stars, sunW, small: coarse, lean: h.lean, wake: h.wake, closeUp: h.closeUp,
        /* the Moon pages' own Moon (lib/core/moon: ELP-2000/82B, and the IAU's pole, prime meridian and libration) */
        moonAt: h.moonAt ?? ((d: Date) => { const m = moonState(d); return { eciKm: m.eci, pole: m.poleEci, prime: m.primeEci }; })
      })
    : null;
  const earthMat = new ShaderMaterial({
    uniforms: {
      uDay: { value: null }, uNight: { value: null }, uUseNight: { value: 0 }, uMask: { value: mask },
      uNight2: { value: mask }, uNight2On: { value: 0 }, uRelief: { value: mask }, uReliefOn: { value: 0 }, uReliefTexel: { value: new Vector2(1, 1) },
      uClouds: u.uClouds, uCloudOn: u.uCloudOn, uSunW: u.uSunW, uSunO: u.uSunO, uDensity: u.uDensity, uExposure: u.uExposure,
      uInflate: { value: INFLATE }, uA2C: { value: a2c ? 1 : 0 },
      ...(detail ? detail.uniforms : { uDetail: { value: mask }, uDetailOk: { value: mask }, uDetailWin: { value: new Vector4(0, 0, 8, 9) }, uDetailOn: { value: 0 } })
    },
    vertexShader: VERT, fragmentShader: EARTH_FRAG, extensions: { derivatives: true },
    /* the limb's coverage to the multisample buffer, the colour as it is, and the canvas's alpha left opaque */
    alphaToCoverage: a2c, blending: CustomBlending, blendSrc: OneFactor, blendDst: ZeroFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor
  });
  const eu = earthMat.uniforms as Record<string, { value: unknown }>;
  const cloudGeo = new SphereGeometry(1 + CLOUD_H, 160, 96);
  const cloudMat = new ShaderMaterial({
    uniforms: { uClouds: u.uClouds, uCloudOn: u.uCloudOn, uSunW: u.uSunW, uDensity: u.uDensity, uExposure: u.uExposure, uInflate: { value: INFLATE }, uA2C: { value: a2c ? 1 : 0 } },
    vertexShader: VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
    extensions: { derivatives: true }
  });
  const clouds = new Mesh(cloudGeo, cloudMat);
  clouds.name = 'realism-clouds';
  h.earthGroup.add(clouds);

  const skyGeo = new SphereGeometry(1.12, 96, 64);
  const skyMat = new ShaderMaterial({
    uniforms: { uSunW: u.uSunW, uDensity: u.uDensity, uExposure: u.uExposure, uHalo: u.uHalo, uHaloK: u.uHaloK },
    defines: { STEPS: steps },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: BackSide, transparent: true, depthWrite: false,
    /* added to the black of space, and the canvas's alpha left as it is */
    blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor
  });
  const atmoGeo0 = h.atmo.geometry as BufferGeometry, atmoMat0 = h.atmo.material as Material;
  h.atmo.geometry = skyGeo;
  h.atmo.material = skyMat;

  const clear0 = new Color(), alpha0 = h.renderer.getClearAlpha();
  h.renderer.getClearColor(clear0);
  h.renderer.setClearColor(0x000000, 1);

  /* The maps: each the widest rung the GPU and the connection allow, and no wider than 4096 on a phone or a tablet (a coarse pointer),
     whose memory the full set (some 300 MB of textures at 8192) would crowd. On a lean link, or on a phone, the relief and the sharp sea,
     which come only at 8192, are not fetched at all, and the coastlines' mask stands in. The two one-channel maps go to the GPU as one
     channel. Until a map arrives its sampler is bound to the mask rather than to nothing (see applyPhoto: undefined on some drivers),
     and the look does without it. */
  let gone = false;
  const textures: Texture[] = [];
  let small = false;
  try { small = matchMedia('(pointer: coarse)').matches; } catch { /* no media queries: a desktop */ }
  const gpu = h.renderer.capabilities.maxTextureSize || 4096, maxTex = Math.min(gpu, small ? 4096 : 8192);
  /* the clouds, one channel, may go to 16384 on a desktop whose GPU takes it (scripts/bake-clouds-full.py: 2.4 km a pixel, L87) */
  const cloudMax = Math.min(gpu, small ? 4096 : 16384);
  const best = (rs: { w: number; url: string }[], cap = maxTex) => { const fit = rs.filter(r => r.w <= cap); return h.lean ? fit[0] : fit[fit.length - 1]; };
  const fetch = (r: { url: string } | undefined, wrapS: number, done: (t: Texture, im: HTMLImageElement) => void, grey = false) => {
    if (!r) return;
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => {
      if (gone) return;
      const t = new Texture(im);
      if (grey) t.format = LuminanceFormat;
      t.wrapS = wrapS as typeof t.wrapS; t.wrapT = ClampToEdgeWrapping;
      t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
      t.anisotropy = h.renderer.capabilities.getMaxAnisotropy();
      t.needsUpdate = true;
      textures.push(t);
      done(t, im);
      h.wake?.();
    };
    im.src = r.url;
  };
  fetch(best(CLOUD_RUNGS, cloudMax), RepeatWrapping, t => { u.uClouds.value = t; u.uCloudOn.value = 1; }, true);   /* one channel: the shaders read .r */
  fetch(best(NIGHT_RUNGS), ClampToEdgeWrapping, t => { eu.uNight2!.value = t; eu.uNight2On!.value = 1; });
  if (!h.lean) {
    fetch(best(RELIEF_RUNGS), RepeatWrapping, (t, im) => {
      eu.uRelief!.value = t; (eu.uReliefTexel!.value as Vector2).set(1 / im.naturalWidth, 1 / im.naturalHeight); eu.uReliefOn!.value = 1;
    }, true);
    fetch(best(OCEAN_RUNGS), ClampToEdgeWrapping, t => { eu.uMask!.value = t; }, true);
  }

  return {
    surface(photo) {
      earthMat.uniforms.uDay!.value = photo.uniforms.dayMap!.value;
      earthMat.uniforms.uNight!.value = photo.uniforms.nightMap!.value;
      earthMat.uniforms.uUseNight!.value = photo.uniforms.useNight!.value;
      return earthMat;
    },
    frame(cam) {
      sunW.copy(h.photoMat.uniforms.sunDir!.value as Vector3).normalize();
      /* the Sun in the Earth's own frame: undo the group's turn by GMST about the spin axis */
      const a = -h.earthGroup.rotation.y, ca = Math.cos(a), sa = Math.sin(a);
      sunO.set(ca * sunW.x + sa * sunW.z, sunW.y, -sa * sunW.x + ca * sunW.z);
      clouds.visible = h.earth.visible;
      /* the 500 m tiles are for the ground in view: none is asked for while the planet is switched off */
      if (h.earth.visible) detail?.frame(cam, h.earthGroup.rotation.y, h.renderer.domElement.height || 800);
      else if (detail) detail.uniforms.uDetailOn.value = 0;
      sky?.frame(cam);
      /* orbit3d hides its thin rim from a camera under 1.03 R in POV or the close-up; this sky is the air itself, seen from inside */
      h.atmo.visible = h.earth.visible;
      u.uHaloK.value = 2 * HALO_SHARE * Math.tan(cam.fov * Math.PI / 360);
      /* The compositor's glow stands for air too thin to resolve: once the Rayleigh layer's height spans a few pixels at the limb (close
         up, in POV and the close-up) the march draws it itself, and the glow, a fixed share of the frame, would be a stripe beside it */
      const d2 = cam.position.lengthSq();
      if (d2 > 1.0001) {
        const px = h.renderer.domElement.height || 800;
        const hPx = (H_R_RADII / Math.sqrt(d2 - 1)) / ((cam.fov * Math.PI / 180) / px);
        u.uHalo.value = HALO * (1 - smoothstep(1.5, 4.0, hPx));
      }
    },
    remove() {
      gone = true;
      if (h.earth.material === earthMat) h.earth.material = h.photoMat;
      h.atmo.geometry = atmoGeo0;
      h.atmo.material = atmoMat0;
      h.earthGroup.remove(clouds);
      h.renderer.setClearColor(clear0, alpha0);
      detail?.dispose();
      sky?.remove();
      for (const x of [earthMat, cloudMat, skyMat, cloudGeo, skyGeo, mask, ...textures]) x.dispose();
    }
  };
}
