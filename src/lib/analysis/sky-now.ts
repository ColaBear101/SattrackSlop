import type { Pass } from '../types';

/* The pass sky plot while its pass is being flown (CHANGES-FROM-LEGACY.md, L54): how much of the pass is behind the
 * spacecraft at an instant, and where a look from the observer lands on the plot.
 *
 * New in the rebuild. The plot is the console's own (src/components/rail/draw-sky.ts): north up, east to the right, the
 * zenith at the centre and the horizon on a circle of radius size/2 - 22 round it, with the standard polar projection
 * r = R (90 - el) / 90. The AR radar (src/lib/ar/radar.ts) draws the same pass on the same geometry and fades the stretch
 * already flown; its three-line count of the flown samples is copied here rather than imported, since radar.ts is in the
 * AR view's chunk and the sky plot is on the first screen. Nothing here propagates: the look at the instant is the
 * engine's, taken by the caller (app.exactAt, the "Elevation now" figure's own call).
 *
 * Pure: no DOM, no globals. */

const RAD = Math.PI / 180;

/** How many of the pass's arc samples are already flown at `ms`: 0 while it has not begun or once it is over (the AR
 *  radar's flown(), radar.ts). The arc is sampled evenly in time from AOS to LOS (engine.ts build()). */
export function flownSamples(p: Pick<Pass, 'arc' | 't0ms' | 't1ms'>, ms: number): number {
  const n = p.arc.length - 1;
  if (!(ms >= p.t0ms && ms <= p.t1ms && p.t1ms > p.t0ms)) return 0;
  return Math.max(0, Math.min(n, Math.floor((ms - p.t0ms) / (p.t1ms - p.t0ms) * n)));
}

/** Where a look (azimuth and elevation, degrees) lands on a sky plot `size` CSS pixels square, in CSS pixels from its
 *  top left: drawSky's own transform (draw-sky.ts). */
export function skyXY(size: number, az: number, el: number): [number, number] {
  const R = size / 2 - 22, r = R * (90 - el) / 90, a = az * RAD;
  return [size / 2 + r * Math.sin(a), size / 2 - r * Math.cos(a)];
}
