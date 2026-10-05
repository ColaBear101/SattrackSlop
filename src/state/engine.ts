import * as satellite from 'satellite.js';
import { Earth } from '../lib/core/body';
import { makeEngine } from '../lib/analysis';
import type { Engine, Site } from '../lib/types';

/* The one body, observer and elevation mask the app computes against.
 *
 * The observer is a value. The old page handed ONE mutable object to the 3D scene at start-up and mutated it
 * in place, so replacing it would have left the globe pinned to the old site while every number moved. Here
 * moving the observer builds a NEW engine around a NEW frozen site, and everything that needs it asks for the
 * current one; nothing holds on to the old. */
export const BODY = Earth(satellite);
export const MASK = 5;
/** Bangkok: what "reset" means, and what a first visit starts with. */
export const HOME: Readonly<Site> = Object.freeze({ ...BODY.defaultSite });

let obs: Site = { ...HOME };
let eng: Engine = makeEngine({ satellite, BODY, OBS: obs, MASK });

export const getEngine = (): Engine => eng;
export const getObs = (): Site => obs;

/** Replace the observer. The Site is copied, so the caller's object is never the engine's. */
export function setObserver(site: Site): Site {
  obs = { ...site };
  eng = makeEngine({ satellite, BODY, OBS: obs, MASK });
  return obs;
}

export { satellite };
