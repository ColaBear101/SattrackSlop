import type { Analysis, Pass } from '../types';

/** What the countdown shows at one instant: a pass in progress, the next one, or none left in the window. */
export type Next =
  | { kind: 'none' }
  | { kind: 'now'; p: Pass; ms: number }
  | { kind: 'next'; p: Pass; ms: number };

/** The first pass that has not set yet, and how long until it sets (in view) or rises (not yet). Passes are
 *  in time order and `los` is when each one ends, so the first one still ahead of `ms` is the answer. */
export function nextPass(a: Analysis | null, ms: number): Next | null {
  if (!a) return null;
  const p = a.passes.find(q => q.los.getTime() > ms);
  if (!p) return { kind: 'none' };
  return p.aos.getTime() <= ms
    ? { kind: 'now', p, ms: p.los.getTime() - ms }
    : { kind: 'next', p, ms: p.aos.getTime() - ms };
}
