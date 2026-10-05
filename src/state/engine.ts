import * as satellite from 'satellite.js';
import { Earth } from '../lib/core/body';
import { makeSun } from '../lib/core/sun';
import { makeEngine } from '../lib/analysis';
import { makeOptics } from '../lib/analysis/optics';
import type { Engine, Optics, Site, StdMagCatalogue, Sun } from '../lib/types';

/* The one body, observer and elevation mask the app computes against.
 *
 * The observer is a value. The old page handed ONE mutable object to the 3D scene at start-up and mutated it
 * in place, so replacing it would have left the globe pinned to the old site while every number moved. Here
 * moving the observer builds a NEW engine around a NEW frozen site, and everything that needs it asks for the
 * current one; nothing holds on to the old. The optical code is built around the same site, so it is replaced
 * with it. */
export const BODY = Earth(satellite);
export const MASK = 5;
/** Bangkok: what "reset" means, and what a first visit starts with. */
export const HOME: Readonly<Site> = Object.freeze({ ...BODY.defaultSite });

export const sun = makeSun(satellite) as unknown as Sun;

let obs: Site = { ...HOME };
let eng: Engine = makeEngine({ satellite, BODY, OBS: obs, MASK });

/* The catalogue as the optical code reads it (the snapshot, and each entry's set as it stands now). Empty until the
   catalogue has been parsed; the app registers the real one then. */
let cat: StdMagCatalogue = { embedded: [], current: () => undefined };
const buildOptics = (): Optics => makeOptics(eng, sun, cat) as unknown as Optics;
let optics: Optics = buildOptics();

export const getEngine = (): Engine => eng;
export const getObs = (): Site => obs;
export const getOptics = (): Optics => optics;

/** Replace the observer. The Site is copied, so the caller's object is never the engine's. */
export function setObserver(site: Site): Site {
  obs = { ...site };
  eng = makeEngine({ satellite, BODY, OBS: obs, MASK });
  optics = buildOptics();
  return obs;
}

/** Tell the optical code about the catalogue (once it is parsed). */
export function setCatalogueSource(c: StdMagCatalogue): void {
  cat = c;
  optics = buildOptics();
}

export { satellite };
