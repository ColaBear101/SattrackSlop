import { Earth } from './core/body';
import { makeEngine } from './analysis';
import { parseCatalog, type CatalogueEntry } from './catalogue/parse';
import type { Analysis, Engine, Satellite, Site } from './types';

/* The DOM-free half of the test surface (window.__gt). It is what the regression gate measures, so it
   must be the very code the app runs: the app builds its engine with the same makeEngine() and the same
   Earth() body. Node reaches this through a bundled shim (`gate:lib`); the page's surface wraps it with
   live state (see src/testing/surface.ts).

   It holds no expected data, rounds nothing, clones nothing and adds no key to what the engine returns:
   the gate compares with ===, and a facade that tidied a number would make the gate agree with itself. */

export interface GtOptions {
  satellite: Satellite;
  catalogueText: string;
  site?: Site;
  mask?: number;
}

export interface Gt {
  compute: Engine['compute'];
  elements: Engine['elements'];
  findPasses: Engine['findPasses'];
  sample: Engine['sample'];
  sampleMs: Engine['sampleMs'];
  stateAt: Engine['stateAt'];
  elevationAt: Engine['elevationAt'];
  rangeRateMs: Engine['rangeRateMs'];
  dopplerHz: Engine['dopplerHz'];
  C_KMS: number;
  stepFor: Engine['stepFor'];
  passStepFor: Engine['passStepFor'];
  OBS: Site;
  MASK: number;
  RE: number;
  MU: number;
  CAT: CatalogueEntry[];
  /** The analysis currently on screen; null in Node, where nothing is selected. */
  readonly D: Analysis | null;
}

export function createGt(opts: GtOptions): Gt {
  const BODY = Earth(opts.satellite);
  /* Exactly {lat, lon, altKm, name, tz} at boot: the baseline deep-compares this object. */
  const OBS: Site = Object.assign({}, opts.site || BODY.defaultSite);
  const MASK = opts.mask === undefined ? 5 : opts.mask;
  const engine = makeEngine({ satellite: opts.satellite, BODY, OBS, MASK });
  const CAT = parseCatalog(opts.catalogueText);
  return {
    compute: engine.compute, elements: engine.elements, findPasses: engine.findPasses,
    sample: engine.sample, sampleMs: engine.sampleMs, stateAt: engine.stateAt,
    elevationAt: engine.elevationAt, rangeRateMs: engine.rangeRateMs, dopplerHz: engine.dopplerHz,
    C_KMS: engine.C_KMS, stepFor: engine.stepFor, passStepFor: engine.passStepFor,
    OBS, MASK, RE: engine.RE, MU: engine.MU, CAT,
    get D() { return null; }
  };
}
