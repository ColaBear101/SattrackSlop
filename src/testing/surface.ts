import { app, PINNED } from '../state/app.svelte';
import { custom, customApi } from '../state/custom.svelte';
import { doppler } from '../state/doppler.svelte';
import { life } from '../state/life.svelte';
import { tleCtx } from '../state/net';
import { fetchLiveTle } from '../lib/net/tle-source';
import { isCustom } from '../lib/planner/custom';
import { session } from '../components/planner/session.svelte';
import { ar } from '../components/ar/session.svelte';
import { getEngine, getObs, getOptics, MASK, satellite, sun } from '../state/engine';
import { live } from '../state/live.svelte';
import { buildExports } from '../lib/export';
import { tleSourceText } from '../lib/export/source';
import { tzAt } from '../lib/places';
import { globe } from '../components/stage/globe-state.svelte';

/* The test surface: what the verification suites reach into. It exists only when the harness set
   window.__GT_TEST__ before the page loaded, and main.ts loads this file as a separate chunk then, so a
   visitor never fetches it. Members are LIVE objects, never copies or reactive proxies: the suites assert
   identity (host.obs() === __gt.OBS), and the gate compares with ===.

   The maths members call whichever engine is current, so they follow the observer when it moves. It holds
   no expected data, rounds nothing, clones nothing and adds no key to what the engine returns. `__gt` is
   assigned last, after the catalogue is parsed and the globe is built (or has failed to be: no WebGL) - the suites wait
   for it, then read CAT and drive Orbit3D. */
export async function install(): Promise<void> {
  await app.ready;
  const e = () => getEngine();
  const o = () => getOptics();
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

    /* the Sun and the optical verdict (observer-bound, so they follow it) */
    sunEci: (...a: Parameters<typeof sun.sunEci>) => sun.sunEci(...a),
    subsolar: (...a: Parameters<typeof sun.subsolar>) => sun.subsolar(...a),
    sunElevation: (...a: Parameters<typeof sun.sunElevation>) => sun.sunElevation(...a),
    sunlitState: (...a: Parameters<ReturnType<typeof o>['sunlitState']>) => o().sunlitState(...a),
    opticalAt: (...a: Parameters<ReturnType<typeof o>['opticalAt']>) => o().opticalAt(...a),
    passOptical: (...a: Parameters<ReturnType<typeof o>['passOptical']>) => o().passOptical(...a),
    estMagnitude: (...a: Parameters<ReturnType<typeof o>['estMagnitude']>) => o().estMagnitude(...a),
    stdMagOf: (...a: Parameters<ReturnType<typeof o>['stdMagOf']>) => o().stdMagOf(...a),
    get STD_MAG() { return o().STD_MAG; },
    get NAKED_EYE_MAG() { return o().NAKED_EYE_MAG; },
    get DARK_SUN_EL() { return o().DARK_SUN_EL; },

    /** the pass table as the exports write it (the same rows), for the analysis on screen */
    passRows: () => {
      const D = app.analysis, entry = app.entry;
      if (!D || !entry) return [];
      return buildExports({
        D, OBS: getObs(), MASK, dopHz: doppler.hz, eng: e(), optics: o(),
        sourceText: tleSourceText({ custom: isCustom(entry), prov: live.provOf(entry.satnum), embedded: app.isEmbedded(entry), l1: entry.l1, l2: entry.l2, cached: null })
      }).passRows();
    },

    /** The observer, as the old page's applySite did it: validate, resolve the zone, move - and nothing else (no reload;
     *  the caller computes against it). `persist` writes the site. */
    applySite: (site: Parameters<typeof app.applySite>[0], persist?: boolean) =>
      app.applySite(site, { persist: !!persist, reanalyze: false }),
    tzAt: (ms: number) => tzAt(getObs(), ms),

    /** the refresh's bookkeeping, which the old page kept on the entry as __next and __prov */
    live: {
      next: (satnum: string) => live.nextOf(satnum),
      makeDue: (satnum: string) => live.makeDue(satnum),
      prov: (satnum: string) => live.provOf(satnum),
      /** record what a check said, as refresh would have (a test stands in for the network); null clears it */
      setProv: (satnum: string, p: Parameters<typeof live.prov.set>[1] | null) => { if (p) live.prov.set(satnum, p); else live.prov.delete(satnum); },
      check: () => (app.entry ? live.check(app.entry) : Promise.resolve())
    },

    /* the reader's own orbits: the list itself (the planner's host hands out the same array), and the one place that changes it */
    get CUSTOM() { return custom.list; },
    entryAt: customApi.entryAt,
    indexOf: customApi.indexOf,
    addCustom: customApi.add,
    updateCustom: customApi.update,
    removeCustom: customApi.remove,
    addCustomTLE: customApi.addTLE,
    /** the element-set fetch and the decay request, called directly (the suites exercise their second layers of defence) */
    fetchTLE: (n: unknown) => fetchLiveTle(n, tleCtx({ pinned: PINNED, isCustom: false })),
    runLife: (entry: Parameters<typeof life.run>[0], my: number) => life.run(entry, my),
    get lifeReq() { return life.seq; },

    get C_KMS() { return e().C_KMS; },
    get OBS() { return getObs(); },
    MASK,
    get RE() { return e().RE; },
    get MU() { return e().MU; },
    get CAT() { return app.catalogue; },
    get D() { return app.analysis; }
  };
  const w = window as unknown as Record<string, unknown>;
  w.satellite = satellite;                  // the SGP4 library, as the old page's script tag made it a global
  /* The 3D scene, under the names the old page's globals had: Orbit3D (its whole API), OrbitViz (the sky layers) and THREE, which
     is only what the suites touch - a vector class and the revision - so the whole library is never a global. The page may be
     showing the map; the harness wants the scene either way, so it is asked for here. */
  globe.request();
  if (await globe.ready) {
    const { THREE } = await import('../scene');
    w.Orbit3D = globe.scene!.orbit3d;
    if (globe.scene!.viz) w.OrbitViz = globe.scene!.viz;
    w.THREE = { Vector3: THREE.Vector3, REVISION: THREE.REVISION };
  }
  /* The orbit planner, under the names the old page's scripts had. The suites look at the controller and at the host it was given, and spy
     on the controller's `init`, so both are put on the window BEFORE init is called (session.onBuilt), and the four modules are the same
     objects the page itself runs: a suite that patches one is patching the page's own. The planner is brought up in the snapshot too, where
     init says no and the pill says why. A planner that cannot be had (its chunk is gone) leaves the console as it was. */
  /* A fault the suites can arm before the page loads (window.__GT_FAULT__): the planner's TLE writer throws, as a planner that is broken would,
     so that what the console does about it is observable. Put in before anything is built with the modules. */
  session.onMods = mods => {
    if ((w.__GT_FAULT__ as { toTLE?: boolean } | undefined)?.toTLE) mods.Planner.toTLE = () => { throw new Error('planner fault (test)'); };
  };
  session.onBuilt = ({ ui, host, mods }) => {
    w.Planner = mods.Planner; w.Advisor = mods.Advisor; w.AdvisorCopy = mods.AdvisorCopy; w.Lifetime = mods.Lifetime;
    w.__host = host;
    w.PlannerUI = ui;
  };
  try { await session.start(); } catch (err) { console.error(err); }
  if (session.hook) w.__planner = session.hook;
  /* The AR view and the two libraries under it, as the old page's script tags made them globals: the suites read the libraries and drive the
     controller (open, close, project, probe, state, isOpen). Brought up on a desktop too (the button is only offered to a finger). */
  try {
    if (await ar.start() && ar.chunk && ar.ui) { w.SkyAR = ar.chunk.SkyAR; w.WMM = ar.chunk.WMM; w.ARView = ar.ui; }
  } catch (err) { console.error(err); }
  w.__gt = gt;
}
