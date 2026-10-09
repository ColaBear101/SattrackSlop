import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as satelliteEs from 'satellite.js';
import { Earth } from '../../src/lib/core/body';
import { sgp4Track } from '../../src/lib/core/propagator';
import type { Site } from '../../src/lib/types';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);

/* The Moon pages keep the classic public/core/body.js and propagator.js. The Earth console now runs the
   TypeScript port of their Earth halves. Two copies of one idea drift, so this test is permanent: it runs
   the classic scripts (in a bare vm context, as a browser would load them) beside the port, with each
   one's own satellite.js build, and demands the same bits - on constants, on frame maths, and on tracks
   for every element set in the catalogue. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const umd: any = require(path.join(ROOT, 'verification', 'satellite.min.js'));
/* The sandbox is handed this realm's Date: satellite.js tells a Date from numeric arguments with
   `instanceof Date`, which a Date made inside another vm realm would fail. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const classic: any = vm.createContext({ Date });
for (const f of ['body.js', 'propagator.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'core', f), 'utf8'), classic, { filename: f });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cEarth: any = classic.Body.Earth(umd);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tEarth: any = Earth(satelliteEs as any);

function sets() {
  const L = fs.readFileSync(path.join(ROOT, 'data', 'catalogue.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  const out: { name: string; l1: string; l2: string; satnum: string }[] = [];
  for (let i = 0; i < L.length; i += 3) out.push({ name: L[i]!.trim(), l1: L[i + 1]!, l2: L[i + 2]!, satnum: L[i + 1]!.substring(2, 7).trim() });
  return out;
}

function same(a: unknown, b: unknown, where: string): string | null {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b) ? null : `${where}: ${a} vs ${b}`;
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

describe('Earth body: classic public/core/body.js vs the TypeScript port', () => {
  it('has the same constants and the same set of members', () => {
    expect(Object.keys(tEarth).sort()).toEqual(Object.keys(cEarth).sort());
    for (const k of Object.keys(cEarth)) {
      if (typeof cEarth[k] === 'function') continue;
      expect(same(tEarth[k], cEarth[k], k), k).toBeNull();
    }
  });

  it('frame maths agree on a grid of positions, instants and sites', () => {
    const sites: Site[] = [
      { lat: 13.75, lon: 100.52, altKm: 0, name: 'Bangkok', tz: 7 },
      { lat: -33.9, lon: 18.4, altKm: 0.05, name: 'Cape Town', tz: 2 },
      { lat: 78.2, lon: 15.6, altKm: 0.01, name: 'Svalbard', tz: 1 }
    ];
    const T0 = Date.UTC(2026, 8, 13);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const ang = i * 0.7853981633974483 * 0.37, rad = 6600 + (i % 37) * 900;
      const r = { x: rad * Math.cos(ang), y: rad * Math.sin(ang) * 0.8, z: rad * Math.sin(ang * 1.3) * 0.6 };
      const d = new Date(T0 + i * 977_000);
      const thC = cEarth.spin(d), thT = tEarth.spin(d);
      expect(Object.is(thC, thT)).toBe(true);
      expect(same(tEarth.toFixed(r, thT), cEarth.toFixed(r, thC), 'toFixed')).toBeNull();
      expect(same(tEarth.toGeodetic(r, thT), cEarth.toGeodetic(r, thC), 'toGeodetic')).toBeNull();
      const rf = tEarth.toFixed(r, thT);
      for (const s of sites) {
        expect(same(tEarth.lookAngles(s, rf), cEarth.lookAngles(s, rf), 'lookAngles')).toBeNull();
        expect(same(tEarth.siteFixed(s), cEarth.siteFixed(s), 'siteFixed')).toBeNull();
      }
      n++;
    }
    expect(n).toBe(400);
  });
});

describe('SGP4 track: classic public/core/propagator.js vs the TypeScript port', () => {
  const T0 = Date.UTC(2026, 8, 13);
  const instants = [0, 1, 37, 72, 240, -120].map(h => T0 + h * 3_600_000);

  it('agrees on every catalogue entry at six instants: ok, state, error codes, recovered a', () => {
    let compared = 0;
    for (const e of sets()) {
      const c = classic.Propagator.sgp4Track(cEarth, e, umd);
      const t = sgp4Track(tEarth, e, satelliteEs as never);
      expect(t.ok, e.name).toBe(c.ok);
      expect(Object.is(t.recoveredA, c.recoveredA), e.name + ' recoveredA').toBe(true);
      for (const ms of instants) {
        const a = t.at(ms), b = c.at(ms);
        const r = same(a, b, `${e.name} @${ms}`);
        if (r) throw new Error(r);
        expect(t.lastError, e.name).toBe(c.lastError);
        compared++;
      }
    }
    expect(compared).toBe(2158 * 6);
  });
});
