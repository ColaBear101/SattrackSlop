/* The GLSL the realistic globe (scene/realism.ts) and the close-up's model pass (scene/closeup-pass.ts) share
 * (CHANGES-FROM-LEGACY.md, L71 and L72): one tone curve, one sRGB, one atmosphere, so the craft and the planet under it are lit and
 * graded alike.
 *
 * The tone curve is AgX, the view transform the owner's Blender renders use (Look None, exposure 0). three r128 predates it; this
 * is the approximation three.js itself adopted in r160 (src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js,
 * MIT License, Copyright 2010-2024 three.js authors), after Filament's, in turn after Blender's, with Rec.2020 primaries. Its
 * input and output are linear sRGB, and the output is encoded with the exact sRGB curve, not a 2.2 power, because the built-in
 * materials of the model pass are encoded that way by r128 (outputEncoding sRGB).
 *
 * The atmosphere is single scattering in an exponential atmosphere: Rayleigh (scale height 8 km) and aerosol (Mie, 1.2 km), with
 * the sea-level coefficients and heights of lib/models/sunlight.ts, in the scene's unit, one Earth radius. Optical depth along a
 * ray is never marched: it is Chapman's grazing-incidence function in Schueler's approximation (GPU Pro 3, "An Approximation to the
 * Chapman Grazing-Incidence Function for Atmospheric Scattering"): for a point at radius r looking up at cos(zenith) mu,
 * Ch = c / ((c - 1) mu + 1), c = sqrt(pi x / 2), x = r / H; looking down, the ray is mirrored about its lowest point; and a ray
 * that meets the planet has no end (the Earth's shadow). */
import { H_MIE_KM, H_RAYLEIGH_KM, MIE_KM, RAYLEIGH_KM, RE_KM, TOP_KM } from '../lib/models/sunlight';

const f = (x: number): string => {
  const s = String(+x.toPrecision(7));
  return /[.eE]/.test(s) ? s : s + '.0';
};
/** per Earth radius: the coefficients are per km */
const per = (x: number): number => x * RE_KM;

/** The Sun's irradiance in the owner's renders (Blender sun strength 4 W/m2, AgX at exposure 0). */
export const SUN_E = 4.0;
/** How much of the Blue Marble's colour a lit surface sends back (the owner's Earth material: (1 - metallic)(1 - transmission)). */
export const EARTH_DIFFUSE = 0.487;

/** Constants and functions every look shader includes. */
export const LOOK_COMMON = `
#define PI 3.141592653589793
const float SUN_E = ${f(SUN_E)};
const vec3 BETA_R = vec3(${f(per(RAYLEIGH_KM[0]))}, ${f(per(RAYLEIGH_KM[1]))}, ${f(per(RAYLEIGH_KM[2]))});
const float BETA_M = ${f(per(MIE_KM))};
const float BETA_M_EXT = ${f(per(MIE_KM) / 0.9)};
const float H_R = ${f(H_RAYLEIGH_KM / RE_KM)};
const float H_M = ${f(H_MIE_KM / RE_KM)};
const float R_TOP = ${f(1 + TOP_KM / RE_KM)};
const float MIE_G = 0.76;

vec3 srgbToLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

const mat3 AGX_SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 AGX_2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 AGX_INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
  vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const mat3 AGX_OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
  vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
vec3 agxContrast(vec3 x){
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
/** AgX, linear sRGB in and out. */
vec3 agx(vec3 color){
  const float MIN_EV = -12.47393, MAX_EV = 4.026069;
  color = AGX_INSET * (AGX_SRGB_TO_2020 * color);
  color = clamp((log2(max(color, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV), 0.0, 1.0);
  color = AGX_OUTSET * agxContrast(color);
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(AGX_2020_TO_SRGB * color, 0.0, 1.0);
}

/** Optical depth of unit-density air (density 1 at the surface, falling as exp(-height / H)) from radius r to infinity along a ray
 *  of cosine mu to the local vertical; 1e9 when the ray meets the planet. */
float chapman(float r, float mu, float H){
  float c = sqrt(1.5707963 * r / H);
  float up = exp(-(r - 1.0) / H) * c / ((c - 1.0) * abs(mu) + 1.0);
  if (mu >= 0.0) return H * up;
  float r0 = r * sqrt(max(0.0, 1.0 - mu * mu));
  if (r0 < 1.0) return 1e9;
  return H * (2.0 * exp(-(r0 - 1.0) / H) * sqrt(1.5707963 * r0 / H) - up);
}
/** The sunlight left at radius r with the Sun at cosine mus to the local vertical. */
vec3 sunTransmit(float r, float mus, float density){
  return exp(-density * (BETA_R * chapman(r, mus, H_R) + BETA_M_EXT * chapman(r, mus, H_M)));
}
float phaseR(float c){ return 0.0596831 * (1.0 + c * c); }
float phaseM(float c){
  float g2 = MIE_G * MIE_G;
  return 0.1193662 * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * MIE_G * c, 1e-4), 1.5));
}
/** What the air between a point at radius rp and an eye far above it does to the point's light: the transmittance T, and the
 *  sunlight it scatters towards the eye S (per unit of the Sun's irradiance). mup is the cosine between the point's vertical and
 *  the way to the eye, mus between its vertical and the Sun, and cosTheta is the scattering angle's: between the eye's line of
 *  sight (from the eye) and the way to the Sun, 1 looking into the Sun. The sunlight on the path is taken one Rayleigh scale
 *  height above the point, where the scattering air is. */
void aerial(float rp, float mup, float mus, float cosTheta, float density, out vec3 T, out vec3 S){
  float odR = density * chapman(rp, max(mup, 0.0), H_R);
  float odM = density * chapman(rp, max(mup, 0.0), H_M);
  vec3 tau = BETA_R * odR + BETA_M_EXT * odM;
  T = exp(-tau);
  vec3 scat = BETA_R * odR * phaseR(cosTheta) + BETA_M * odM * phaseM(cosTheta);
  S = sunTransmit(rp + H_R, mus, density) * scat * (1.0 - T) / max(tau, vec3(1e-5));
}
`;

/** The model pass's tone curve, put into r128's CustomToneMapping placeholder (tonemapping_pars_fragment): the same AgX as above,
 *  with the renderer's exposure. */
export const AGX_CHUNK = `
const mat3 AGX_SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 AGX_2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 AGX_INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
  vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const mat3 AGX_OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
  vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
vec3 agxContrast(vec3 x){
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 CustomToneMapping( vec3 color ){
  const float MIN_EV = -12.47393, MAX_EV = 4.026069;
  color *= toneMappingExposure;
  color = AGX_INSET * (AGX_SRGB_TO_2020 * color);
  color = clamp((log2(max(color, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV), 0.0, 1.0);
  color = AGX_OUTSET * agxContrast(color);
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(AGX_2020_TO_SRGB * color, 0.0, 1.0);
}`;

/** r128's placeholder, which AGX_CHUNK replaces (node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js:76). */
export const CUSTOM_TONE_PLACEHOLDER = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
