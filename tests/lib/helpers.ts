import fs from 'node:fs';
import path from 'node:path';
import * as satellite from 'satellite.js';
import { Earth } from '../../src/lib/core/body';
import { makeSun } from '../../src/lib/core/sun';
import { makeEngine } from '../../src/lib/analysis';
import { makeOptics } from '../../src/lib/analysis/optics';
import { parseCatalog, type CatalogueEntry } from '../../src/lib/catalogue/parse';
import type { Engine, Optics, Site, Sun } from '../../src/lib/types';

/* A real engine, observer and catalogue for the tests that need numbers rather than mocks: the same code the page
   runs, around Bangkok. */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const CATALOGUE: CatalogueEntry[] = parseCatalog(fs.readFileSync(path.join(ROOT, 'data', 'catalogue.txt'), 'utf8'));
export const byName = (n: string): CatalogueEntry => {
  const e = CATALOGUE.find(c => c.name === n);
  if (!e) throw new Error('not in the catalogue: ' + n);
  return e;
};

export const BODY = Earth(satellite as never);
export const BANGKOK: Site = { ...BODY.defaultSite };
export const MASK = 5;

export function world(site: Site = BANGKOK) {
  const eng = makeEngine({ satellite: satellite as never, BODY, OBS: { ...site }, MASK }) as Engine;
  const sun = makeSun(satellite as never) as unknown as Sun;
  const optics = makeOptics(eng, sun, { embedded: CATALOGUE, current: n => CATALOGUE.find(c => c.satnum === n) }) as unknown as Optics;
  return { eng, sun, optics, site };
}
