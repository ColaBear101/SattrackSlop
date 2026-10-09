/* Node bundle entry: the classic earth/ and core/ globals, from the TypeScript modules.
 *
 * ONE bundle for all of them, on purpose. The classic scripts shared a single instance of each module
 * through globalThis, and some checks depend on it: the advisor suite counts how often the atmosphere is
 * evaluated by wrapping `globalThis.Lifetime.rho`, which only works if the Advisor calls the very object
 * the suite wrapped. Separate per-module bundles would each carry a private copy.
 *
 * `H.earthFile(name)` in verification/lib/harness.js resolves every module name to this one file; the
 * second `require` of it is a no-op, exactly as loading a script twice was. See scripts/build-shims.mjs.
 */
import { Earth } from '../core/body';
import { sgp4Track } from '../core/propagator';
import { Lifetime } from '../planner/lifetime';
import { Planner } from '../planner/planner';
import { Advisor } from '../planner/advisor';
import { AdvisorCopy } from '../planner/advisor-copy';
import { SkyAR } from '../ar/skyar';
import { WMM } from '../ar/wmm';
import { makeARView } from '../ar/arview';

const g = globalThis as unknown as Record<string, unknown>;
g.Body = { Earth };
g.Propagator = { sgp4Track };
g.Lifetime = Lifetime;
g.Planner = Planner;
g.AdvisorCopy = AdvisorCopy;
g.Advisor = Advisor;
g.SkyAR = SkyAR;
g.WMM = WMM;
/* the AR controller reads SkyAR and WMM through the object it is given, and touches no document until init() and open() */
g.ARView = makeARView(g);
