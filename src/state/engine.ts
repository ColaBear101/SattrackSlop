import * as satellite from 'satellite.js';
import { Earth } from '../lib/core/body';
import { makeEngine } from '../lib/analysis';
import type { Site } from '../lib/types';

/* The one body, observer and mask the app computes against. The observer is a value: moving it will
   mean building a new engine (milestone M4), not mutating this object the way the old page did while
   handing the same reference to the 3D scene. */
export const BODY = Earth(satellite);
export const OBS: Site = Object.assign({}, BODY.defaultSite);
export const MASK = 5;
export const engine = makeEngine({ satellite, BODY, OBS, MASK });
export { satellite };
