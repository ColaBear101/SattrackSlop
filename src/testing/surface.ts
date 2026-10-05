import { app } from '../state/app.svelte';
import { getEngine, getObs, MASK } from '../state/engine';

/* The test surface: what the verification suites reach into. It exists only when the harness set
   window.__GT_TEST__ before the page loaded, and main.ts loads this file as a separate chunk then, so a
   visitor never fetches it. Members are LIVE objects, never copies or reactive proxies: the suites assert
   identity (host.obs() === __gt.OBS), and the gate compares with ===.

   The maths members call whichever engine is current, so they follow the observer when it moves. It holds
   no expected data, rounds nothing, clones nothing and adds no key to what the engine returns. `__gt` is
   assigned last, after the catalogue is parsed - the gate waits for it, then reads CAT. */
export async function install(): Promise<void> {
  await app.ready;
  const e = () => getEngine();
  const gt = {
    compute: (...a: Parameters<ReturnType<typeof e>['compute']>) => e().compute(...a),
    elements: (...a: Parameters<ReturnType<typeof e>['elements']>) => e().elements(...a),
    findPasses: (...a: Parameters<ReturnType<typeof e>['findPasses']>) => e().findPasses(...a),
    sample: (...a: Parameters<ReturnType<typeof e>['sample']>) => e().sample(...a),
    sampleMs: (...a: Parameters<ReturnType<typeof e>['sampleMs']>) => e().sampleMs(...a),
    stateAt: (...a: Parameters<ReturnType<typeof e>['stateAt']>) => e().stateAt(...a),
    elevationAt: (...a: Parameters<ReturnType<typeof e>['elevationAt']>) => e().elevationAt(...a),
    rangeRateMs: (...a: Parameters<ReturnType<typeof e>['rangeRateMs']>) => e().rangeRateMs(...a),
    dopplerHz: (...a: Parameters<ReturnType<typeof e>['dopplerHz']>) => e().dopplerHz(...a),
    stepFor: (h: number) => e().stepFor(h),
    passStepFor: (h: number) => e().passStepFor(h),
    get C_KMS() { return e().C_KMS; },
    get OBS() { return getObs(); },
    MASK,
    get RE() { return e().RE; },
    get MU() { return e().MU; },
    get CAT() { return app.catalogue; },
    get D() { return app.analysis; }
  };
  (window as unknown as Record<string, unknown>).__gt = gt;
}
