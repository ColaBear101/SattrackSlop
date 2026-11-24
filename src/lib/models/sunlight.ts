/* How much sunlight reaches a spacecraft, and in what colour (CHANGES-FROM-LEGACY.md, L72).
 *
 * New in the rebuild. The close-up lights a model with the real Sun, so a spacecraft going into the Earth's shadow has to go dark,
 * and on the way it passes through the sunset the reference renders never showed: the last light reaches it through the limb of
 * the atmosphere, which takes the blue out first. The same numbers drive the realistic globe's shaders (scene/look-glsl.ts), so the
 * craft and the sky under it agree about where the terminator is and how red it gets.
 *
 * The Sun is far enough for its rays to be parallel, so a ray from the craft towards the Sun passes the Earth's centre at a distance
 * d, and its least altitude above the sphere is d - 1 (Earth radii). Below zero the Earth is in the way (the umbra), softened over
 * the Sun's own width seen at that range (the penumbra). Above zero the ray grazes the air, and the light that is left is
 * exp(-optical depth) along the whole chord through the tangent point: for an exponential atmosphere of scale height H that column
 * is exp(-h/H) * sqrt(2 pi (R + h) H) (Chapman's grazing-incidence form). Above the top of the air nothing is taken.
 *
 * Inputs are in Earth radii, in any axes as long as both are in the same ones. Pure. */
import { dot, unit, type V3 } from './attitude';

export const RE_KM = 6378.137;
/** The Sun's angular radius at one astronomical unit, radians (959.6 arcsec). */
export const SUN_RADIUS = 0.004652;
/** Extinction at sea level per km: Rayleigh at red, green and blue (680, 550, 440 nm), and the aerosol (Mie, grey). */
export const RAYLEIGH_KM: V3 = [5.8e-3, 13.5e-3, 33.1e-3];
export const MIE_KM = 21e-3;
/** Scale heights, km, and the height above which the air is taken to be nothing. */
export const H_RAYLEIGH_KM = 8;
export const H_MIE_KM = 1.2;
export const TOP_KM = 100;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface Sunlight {
  /** the light that arrives, red/green/blue, 1 being the full Sun */
  rgb: [number, number, number];
  /** the share of the Sun's disc the Earth does not cover, 0 to 1, before the air takes its part */
  geometric: number;
  /** the ray's least altitude above the sphere, km (negative inside the Earth's shadow); Infinity on the sunward side */
  tangentKm: number;
}

/** The sunlight at `r` (the craft, Earth radii) with the Sun along the unit vector `s`. */
export function sunlight(r: V3, s: V3): Sunlight {
  const along = dot(r, s);
  if (along >= 0) return { rgb: [1, 1, 1], geometric: 1, tangentKm: Infinity };    // the sunward half: nothing in between
  const d = Math.sqrt(Math.max(0, dot(r, r) - along * along));
  const hKm = (d - 1) * RE_KM;
  /* the penumbra: the Sun's disc, seen from the craft, slides behind the limb over this many km of tangent altitude */
  const halfKm = Math.max(0.5, -along * RE_KM * SUN_RADIUS);
  const geometric = smoothstep(-halfKm, halfKm, hKm);
  if (geometric <= 0) return { rgb: [0, 0, 0], geometric: 0, tangentKm: hKm };
  if (hKm >= TOP_KM) return { rgb: [geometric, geometric, geometric], geometric, tangentKm: hKm };
  const h = Math.max(hKm, 0);
  const colR = Math.exp(-h / H_RAYLEIGH_KM) * Math.sqrt(2 * Math.PI * (RE_KM + h) * H_RAYLEIGH_KM);
  const colM = Math.exp(-h / H_MIE_KM) * Math.sqrt(2 * Math.PI * (RE_KM + h) * H_MIE_KM);
  const rgb = RAYLEIGH_KM.map(b => geometric * Math.exp(-(b * colR + MIE_KM * colM))) as [number, number, number];
  return { rgb, geometric, tangentKm: hKm };
}

/** The share of the Earth under the craft that is in daylight, roughly, as it sees it: 1 over the subsolar point, 0 over the
 *  antisolar one. What the Earth's glow on the underside of a model (the earthshine) is scaled by. */
export const dayBelow = (r: V3, s: V3): number => 0.5 * (1 + dot(unit(r), s));
