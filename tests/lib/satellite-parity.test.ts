import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);

/* The regression baseline was produced with satellite.js 6.0.1 loaded from cdnjs (UMD, minified);
   verification/satellite.min.js is that exact file (its sha512 is what the old page pinned). The
   rewrite bundles the npm package's ES build instead. Same source, same arithmetic - this test
   proves it rather than assuming it, on every element set and a spread of instants. */
type Num = number | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const umd: any = require(path.join(ROOT, 'verification', 'satellite.min.js'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const esm: any = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'satellite.js', 'dist', 'satellite.es.js')).href);

function sets() {
  const L = fs.readFileSync(path.join(ROOT, 'data', 'catalogue.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  const out: { name: string; l1: string; l2: string }[] = [];
  for (let i = 0; i < L.length; i += 3) out.push({ name: L[i]!.trim(), l1: L[i + 1]!, l2: L[i + 2]! });
  return out;
}

/* deep, bit-level equality: numbers by Object.is (so -0 and NaN are distinguished), no functions */
function same(a: unknown, b: unknown, where: string): string | null {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a as Num, b as Num) ? null : `${where}: ${a} vs ${b}`;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : `${where}: ${String(a)} vs ${String(b)}`;
  const ka = Object.keys(a as object).filter(k => typeof (a as Record<string, unknown>)[k] !== 'function');
  const kb = Object.keys(b as object).filter(k => typeof (b as Record<string, unknown>)[k] !== 'function');
  if (ka.join() !== kb.join()) return `${where}: keys ${ka.join()} vs ${kb.join()}`;
  for (const k of ka) {
    const r = same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], where + '.' + k);
    if (r) return r;
  }
  return null;
}

describe('satellite.js 6.0.1: npm ES build vs the vendored UMD the baseline used', () => {
  const T0 = Date.UTC(2026, 8, 13);
  const instants = [0, 3_600_000, 37 * 3_600_000, 72 * 3_600_000, 10 * 86_400_000, -5 * 86_400_000].map(d => T0 + d);
  const all = sets();

  it('exports what the page uses', () => {
    for (const k of ['twoline2satrec', 'propagate', 'gstime', 'eciToEcf', 'eciToGeodetic', 'geodeticToEcf', 'ecfToLookAngles', 'constants']) {
      expect(typeof esm[k], k).not.toBe('undefined');
    }
  });

  it('has the same constants', () => {
    expect(same(esm.constants, umd.constants, 'constants')).toBeNull();
  });

  it('builds identical satrecs and propagates identically for all 2,158 sets at 6 instants', () => {
    let compared = 0;
    for (const s of all) {
      const ra = esm.twoline2satrec(s.l1, s.l2), rb = umd.twoline2satrec(s.l1, s.l2);
      const bad = same(ra, rb, s.name + ' satrec');
      expect(bad).toBeNull();
      for (const t of instants) {
        const d = new Date(t);
        const pa = esm.propagate(ra, d), pb = umd.propagate(rb, d);
        const r = same(pa, pb, `${s.name} @${t}`);
        if (r) throw new Error(r);
        compared++;
      }
    }
    expect(compared).toBe(2158 * 6);
  });

  it('frame maths agree: gstime, eci/ecf/geodetic, look angles', () => {
    const site = { longitude: 100.52 * Math.PI / 180, latitude: 13.75 * Math.PI / 180, height: 0 };
    let n = 0;
    for (const s of all.slice(0, 300)) {
      const ra = esm.twoline2satrec(s.l1, s.l2), rb = umd.twoline2satrec(s.l1, s.l2);
      for (const t of instants) {
        const d = new Date(t);
        const gA = esm.gstime(d), gB = umd.gstime(d);
        expect(Object.is(gA, gB)).toBe(true);
        const pa = esm.propagate(ra, d), pb = umd.propagate(rb, d);
        if (!pa || !pa.position || typeof pa.position === 'boolean') continue;
        const checks: [string, unknown, unknown][] = [
          ['ecf', esm.eciToEcf(pa.position, gA), umd.eciToEcf(pb.position, gB)],
          ['geodetic', esm.eciToGeodetic(pa.position, gA), umd.eciToGeodetic(pb.position, gB)],
          ['look', esm.ecfToLookAngles(site, esm.eciToEcf(pa.position, gA)), umd.ecfToLookAngles(site, umd.eciToEcf(pb.position, gB))],
          ['site', esm.geodeticToEcf(site), umd.geodeticToEcf(site)]
        ];
        for (const [what, a, b] of checks) { const r = same(a, b, `${s.name} ${what}`); if (r) throw new Error(r); }
        n++;
      }
    }
    expect(n).toBeGreaterThan(1000);
  });
});
