import type { PlannerCore } from '../lib/planner/custom';

/* The planner's four modules - the maths (Planner), the advisor, its sentences (AdvisorCopy) and the drag integrator (Lifetime) - are
 * chunks of their own: nothing on the console's first screen needs them. They are fetched together, once, when the reader has orbits
 * saved, opens the planner, or looks at the decay of an orbit they designed (and, in the test build, at start-up).
 *
 * The modules themselves are moved unchanged from legacy/earth (lib/planner/*.ts); the types here name only what the page reads. */

/* The planner's own members are many and typed as the verbatim files declare them (nothing, in practice: they are `@ts-nocheck`), so
   the modules are named through the narrow interfaces each reader needs and `Any` where the reader is the planner's own controller. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface PlannerMods {
  Planner: PlannerCore & Record<string, Any>;
  Advisor: Record<string, Any>;
  AdvisorCopy: Record<string, Any>;
  Lifetime: Record<string, Any>;
}

let mods: PlannerMods | null = null;
let loading: Promise<PlannerMods> | null = null;

/** The modules, or null while they are not here. */
export const plannerMods = (): PlannerMods | null => mods;

/** Fetch the four modules (once). A failed fetch is not remembered: the next ask tries again. */
export function loadPlannerMods(): Promise<PlannerMods> {
  loading ??= Promise.all([
    import('../lib/planner/planner'), import('../lib/planner/advisor'),
    import('../lib/planner/advisor-copy'), import('../lib/planner/lifetime')
  ]).then(([p, a, c, l]) => (mods = { Planner: p.Planner as Any, Advisor: a.Advisor as Any, AdvisorCopy: c.AdvisorCopy as Any, Lifetime: l.Lifetime as Any }))
    .catch(err => { loading = null; throw err; });
  return loading;
}
