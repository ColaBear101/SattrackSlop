import { app } from '../state/app.svelte';
import { engine, OBS, MASK } from '../state/engine';

/* The test surface: what the verification suites reach into. It exists only when the harness set
   window.__GT_TEST__ before the page loaded, and main.ts loads this file as a separate chunk then, so a
   visitor never fetches it. Members are LIVE objects, never copies or reactive proxies: the suites assert
   identity (host.obs() === __gt.OBS), and the gate compares with ===.

   It holds no expected data, rounds nothing, clones nothing and adds no key to what the engine returns.
   `__gt` is assigned last, after the catalogue is parsed - the gate waits for it, then reads CAT. */
export async function install(): Promise<void> {
  await app.ready;
  const gt = {
    compute: engine.compute, elements: engine.elements, findPasses: engine.findPasses,
    sample: engine.sample, sampleMs: engine.sampleMs, stateAt: engine.stateAt,
    elevationAt: engine.elevationAt, rangeRateMs: engine.rangeRateMs, dopplerHz: engine.dopplerHz,
    C_KMS: engine.C_KMS, stepFor: engine.stepFor, passStepFor: engine.passStepFor,
    OBS, MASK, RE: engine.RE, MU: engine.MU,
    get CAT() { return app.catalogue; },
    get D() { return app.analysis; }
  };
  (window as unknown as Record<string, unknown>).__gt = gt;
}
