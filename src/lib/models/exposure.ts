/* How much of the starlight a camera, or an eye, set for the brightest thing in its view still sees (CHANGES-FROM-LEGACY.md, L83).
 *
 * New in the rebuild, for the realistic sky only (scene/realsky.ts). A photograph from orbit with the Sun or the sunlit Earth in it shows
 * a black sky: the exposure is the bright thing's, and the stars are far below it. On the night side, in the Earth's shadow, an eye that
 * has adapted sees them all. This is that, roughly: a multiplier from 1 (every star and the Milky Way as drawn) down to a few hundredths
 * (only the brightest stars, faintly), from two things in the view:
 *   - the Sun: how much of it reaches the camera (sunlight()'s peak, 0 in the Earth's shadow) and how near it is to the view, in it or
 *     within some 35 degrees of its corners, where its glare still fills the lens;
 *   - the sunlit Earth: how much of the view the disc fills, and how much of the part of it the camera sees is lit (from low orbit a
 *     small cap, all dark over the night side);
 *   - the camera in sunlight at all: never more than half the starlight (glare in the optics, an eye that has not adapted), and with a
 *     sunlit model in the middle of the view (the close-up's), a sixth.
 * Vectors are plain triples in the scene's axes, the camera's position in Earth radii. Pure. */

export type V3 = readonly [number, number, number];

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angle = (a: V3, b: V3): number => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

export interface ExposureView {
  /** the camera's position, Earth radii from the centre */
  cam: V3;
  /** where it looks, a unit vector */
  forward: V3;
  /** the Sun's direction, a unit vector */
  sun: V3;
  /** how much of the Sun reaches the camera, 0 (the Earth's shadow) to 1 */
  sunlight: number;
  /** the view's half-angle to its corners, radians */
  halfDiag: number;
  /** a sunlit subject held in the middle of the view (the close-up's model), 0 or 1 */
  subject?: number;
}

/** The share of the Sun's glare in the view: the sunlight reaching the camera, falling off from the view's corners over 0.6 rad. */
export function sunInView(v: ExposureView): number {
  return v.sunlight * (1 - smooth(v.halfDiag, v.halfDiag + 0.6, angle(v.forward, v.sun)));
}

/** The share of the view the sunlit Earth fills, 0 to 1 (from the ground or below it, half: a day sky, roughly). */
export function earthInView(v: ExposureView): number {
  const d = Math.hypot(v.cam[0], v.cam[1], v.cam[2]);
  if (!(d > 1)) return 0.5;
  const rho = Math.asin(1 / d);                                                  // the Earth's angular radius from here
  const toCentre: V3 = [-v.cam[0] / d, -v.cam[1] / d, -v.cam[2] / d];
  const theta = angle(v.forward, toCentre);
  const overlap = Math.max(0, Math.min(1, (rho + v.halfDiag - theta) / (2 * Math.min(rho, v.halfDiag))));
  const fills = Math.min(1, (rho / v.halfDiag) ** 2);
  /* the lit share of what the camera sees of the Earth: the cap within beta of the point under it (from 400 km a cap 20 degrees across, from
     far off nearly a hemisphere), its middle gamma from the point under the Sun, across the day's edge at 90 degrees */
  const beta = Math.acos(1 / d), gamma = Math.acos(Math.max(-1, Math.min(1, -dot(toCentre, v.sun))));
  const lit = Math.max(0, Math.min(1, (Math.PI / 2 - gamma + beta) / (2 * beta)));
  return overlap * fills * lit;
}

/** The exposure: 1 in the Earth's shadow with nothing bright in the view; in sunlight never more than a half (the glare in the optics, and an
 *  eye not adapted to the dark), a sixth with a sunlit model filling the middle of the view (the close-up), about 1/32 with the Sun in it,
 *  about 1/16 with the sunlit Earth filling it. */
export const exposure = (v: ExposureView): number =>
  1 / (1 + 30 * sunInView(v) + 14 * earthInView(v) + v.sunlight * (1 + 4 * (v.subject ?? 0)));
