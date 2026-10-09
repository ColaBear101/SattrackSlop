import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THREE } from '../../src/scene/three';
import { CONST_JSON, STAR_DATA } from '../../src/scene/sky-data';

/* The scene is the old orbit3d, orbitviz and globetex moved as they were (src/scene). These are the cheap guards around the
   parts that are not them: the list of three.js members they are given, and the sky's data tables. The scene itself is held to
   the old page by verification/ab3d.js (pixels and the scene graph) and by the verify-pov, verify-elements and verify-globe suites. */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('the three.js members the scene is given', () => {
  const used = new Set<string>();
  for (const f of ['orbit3d.ts', 'orbitviz.ts', 'globetex.ts']) {
    for (const m of read('src/scene/' + f).matchAll(/\bTHREE\.([A-Za-z0-9_]+)/g)) used.add(m[1]!);
  }
  it('names every member the three modules use (a member added to them has to be added to src/scene/three.ts)', () => {
    expect(used.size).toBeGreaterThan(30);
    /* SRGBColorSpace is newer than r128: the old code asks for it first and falls back to sRGBEncoding, so it is left out on purpose */
    const missing = [...used].filter(n => n !== 'SRGBColorSpace' && !(n in THREE));
    expect(missing).toEqual([]);
  });
  it('and nothing else: the full library is not a global (a namespace passed as a value cannot be tree-shaken)', () => {
    const extra = Object.keys(THREE).filter(n => n !== 'REVISION' && !used.has(n));
    expect(extra).toEqual([]);
  });
  it('is r128, the revision the palette and the day/night shader are tuned to', () => { expect(THREE.REVISION).toBe('128'); });
});

describe('the sky data tables', () => {
  it('the star catalogue is four numbers per star, every star to V = 5.5', () => {
    const d = STAR_DATA.split(',');
    expect(d.length % 4).toBe(0);
    expect(d.length / 4).toBeGreaterThan(2800);
    expect(d.every(x => x !== '' && Number.isFinite(+x))).toBe(true);
    /* right ascension in hundredths of a degree, declination in hundredths, magnitude in tenths, B-V in hundredths */
    for (let i = 0; i < d.length; i += 4) {
      expect(+d[i]!).toBeGreaterThanOrEqual(0); expect(+d[i]!).toBeLessThan(36000);
      expect(Math.abs(+d[i + 1]!)).toBeLessThanOrEqual(9000);
      expect(+d[i + 2]!).toBeLessThanOrEqual(56);
    }
  });
  it('the constellation figures are the 88 IAU constellations (Serpens in its two parts) as polylines of coordinate pairs', () => {
    const c = JSON.parse(CONST_JSON) as [string, string, number, number, number[][]][];
    expect(c.length).toBe(89);
    for (const [abbr, name, ra, dec, polys] of c) {
      expect(abbr).toMatch(/^[A-Z][A-Za-z]{2}[0-9]?$/); expect(name.length).toBeGreaterThan(2);
      expect(Math.abs(dec)).toBeLessThanOrEqual(90); expect(Math.abs(ra)).toBeLessThanOrEqual(360);
      for (const p of polys) expect(p.length % 2).toBe(0);
    }
  });
  it('both tables are the old file\'s, byte for byte (while the old file is still in the tree)', () => {
    const f = path.join(ROOT, 'legacy', 'earth', 'orbitviz.js');
    if (!fs.existsSync(f)) return;
    const old = read('legacy/earth/orbitviz.js');
    expect(old).toContain("const STAR_DATA = '" + STAR_DATA + "';");
    expect(old).toContain("const CONST_DATA = JSON.parse('" + CONST_JSON + "');");
  });
});
