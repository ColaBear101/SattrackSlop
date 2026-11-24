import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Lunar, moonOrientation, moonState } from '../../src/lib/core/moon';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* The Moon pages load public/moon/lunar.js and public/core/body.js as classic scripts, frozen byte for byte
   (tests/moon/moon-assets.test.ts), and the realistic globe runs a copy of their Moon, src/lib/core/moon.ts (CHANGES-FROM-LEGACY.md,
   L75). Two copies of one idea drift, so this test is permanent, as core-equivalence.test.ts is for the Earth's half of body.js: it
   runs the classic files in a bare vm context, as a browser would load them, beside the port, and demands the same bits from every
   function the port carries, and the same lines. The sandbox is handed this realm's Date, so that lunar.js's `date instanceof Date`
   takes the path a page's own Date takes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const classic: any = vm.createContext({ Date });
vm.runInContext(read('public/moon/lunar.js'), classic, { filename: 'lunar.js' });
vm.runInContext(read('public/core/body.js'), classic, { filename: 'body.js' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cLunar: any = classic.Lunar, cMoon: any = classic.Body.Moon();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const port: any = Lunar;

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
const expectSame = (a: unknown, b: unknown, where: string) => { const r = same(a, b, where); if (r) throw new Error(r); };

/* A few hundred instants from 1990 to 2050, none on a round hour (a step of 45.7 days and a time of day that wanders), and the ones
   where something changes: J2000 itself (where body.js's day count is zero), the two sides of 2026.0, after which lunar.js holds its
   last Delta T, and the ends. */
const T1990 = Date.UTC(1990, 0, 1), T2050 = Date.UTC(2050, 0, 1);
const INSTANTS: number[] = [];
for (let i = 0; i < 480; i++) INSTANTS.push(T1990 + Math.floor((T2050 - T1990) * i / 480) + (i * 7_919_993) % 86_400_000);
INSTANTS.push(T1990, T2050, Date.UTC(2000, 0, 1, 12), Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1) - 1);

/* What lunar.js's lines 438-618 define (moonApparent and the Lagrange points), which the port does not carry. */
const NOT_CARRIED = ['lagrange', 'moonApparent', 'moonState', 'collinear', 'gradOmega', 'fAxis', 'dfAxis', 'solveAxis'];

describe('the Moon: classic public/moon/lunar.js and public/core/body.js vs the port in src/lib/core/moon.ts', () => {
  it('carries every member lunar.js exports up to the end of moon(), in its order, with the same constants', () => {
    expect(Object.keys(port)).toEqual(Object.keys(cLunar).filter(k => !NOT_CARRIED.includes(k)));
    for (const k of Object.keys(port)) {
      if (typeof cLunar[k] === 'function') { expect(typeof port[k], k).toBe('function'); continue; }
      expect(Object.is(port[k], cLunar[k]), k).toBe(true);
    }
  });

  it(`moon() and sun() give the same bits at ${INSTANTS.length} instants from 1990 to 2050, from a Date and from milliseconds`, () => {
    let n = 0;
    for (const ms of INSTANTS) {
      const d = new Date(ms), at = d.toISOString();
      expectSame(port.moon(d), cLunar.moon(d), 'moon @' + at);
      expectSame(port.sun(d), cLunar.sun(d), 'sun @' + at);
      expectSame(port.moon(ms), cLunar.moon(ms), 'moon(ms) @' + at);
      expectSame(port.sun(ms), cLunar.sun(ms), 'sun(ms) @' + at);
      n++;
    }
    expect(n).toBe(INSTANTS.length);
  });

  it('the internals give the same bits: the series, the Sun, the nutation, the obliquity, the turn to the equator, the librations', () => {
    for (const ms of INSTANTS) {
      const T = cLunar.centuries(cLunar.toJDE(cLunar.jdFrom(new Date(ms))));
      expect(Object.is(port.centuries(port.toJDE(port.jdFrom(new Date(ms)))), T)).toBe(true);
      const m = cLunar.moonEcliptic(T), s = cLunar.sunEcliptic(T), eps = cLunar.meanObliquity(T);
      expectSame(port.moonEcliptic(T), m, 'moonEcliptic');
      expectSame(port.sunEcliptic(T), s, 'sunEcliptic');
      expectSame(port.nutation(T), cLunar.nutation(T), 'nutation');
      expect(Object.is(port.meanObliquity(T), eps)).toBe(true);
      expectSame(port.eclToEq(m.lon, m.lat, m.dist, eps), cLunar.eclToEq(m.lon, m.lat, m.dist, eps), 'eclToEq');
      expectSame(port.selenographic(m.lon, m.lat, m.om, m.F), cLunar.selenographic(m.lon, m.lat, m.om, m.F), 'selenographic');
      expectSame(port.selenographic(s.lon + 180, 0, m.om, m.F), cLunar.selenographic(s.lon + 180, 0, m.om, m.F), 'selenographic (Sun)');
    }
  });

  it('Delta T and the time scales give the same bits, on every branch of Delta T from 1600 to 2100', () => {
    const years: number[] = [];
    for (let y = 1600; y <= 2100; y += 0.37) years.push(y);
    /* each side of every boundary in deltaT() */
    years.push(1799.999, 1800, 1859.999, 1860, 1899.999, 1900, 1919.999, 1920, 1940.999, 1941, 1959.999, 1960, 2025.999, 2026, 2100);
    for (const y of years) expect(Object.is(port.deltaT(y), cLunar.deltaT(y)), String(y)).toBe(true);
    for (const ms of INSTANTS) {
      const d = new Date(ms);
      for (const v of [d, ms, d.toISOString()]) expect(Object.is(port.jdFrom(v), cLunar.jdFrom(v)), String(v)).toBe(true);
      const jd = cLunar.jdFrom(d);
      expect(Object.is(port.toJDE(jd), cLunar.toJDE(jd))).toBe(true);
      expect(Object.is(port.centuries(jd), cLunar.centuries(jd))).toBe(true);
    }
  });

  it('moonOrientation() gives the same bits as body.js\'s Body.Moon().orientation and .spin', () => {
    for (const ms of INSTANTS) {
      const d = new Date(ms);
      expectSame(moonOrientation(d), cMoon.orientation(d), 'orientation @' + d.toISOString());
      expectSame(moonOrientation(d), cMoon.spin(d), 'spin @' + d.toISOString());
    }
  });

  it('moonState() hands lunar.js\'s own numbers through untouched: the position, the distance, the phase angle and the lit share', () => {
    for (const ms of INSTANTS) {
      const d = new Date(ms), s = moonState(d), c = cLunar.moon(d);
      expectSame(s.eci, [c.x, c.y, c.z], 'eci');
      expectSame([s.distanceKm, s.phaseAngle, s.illuminated], [c.r, c.phaseAngle, c.illum], 'distance, phase angle, lit share');
    }
  });

  /* The text, so that the comments travel with the arithmetic: lunar.js's header (lines 1-36) and lines 39-436 (37 and 38 are its
     IIFE and 'use strict'), then body.js's line 30 (its RAD) and lines 117-161, each block whole, unchanged and in that order. A change
     the port needs goes at a line marked CHANGED, outside these blocks, or splits one of them here, with the reason. */
  it('is the classic text: lunar.js lines 1-36 and 39-436, then body.js lines 30 and 117-161, unchanged and in order', () => {
    const text = read('src/lib/core/moon.ts').replace(/\r\n/g, '\n');
    const L = read('public/moon/lunar.js').replace(/\r\n/g, '\n').split('\n');
    const B = read('public/core/body.js').replace(/\r\n/g, '\n').split('\n');
    expect(L[36]).toBe('(function(global){');
    expect(L[37]).toBe("'use strict';");
    const blocks = [L.slice(0, 36), L.slice(38, 436), B.slice(29, 30), B.slice(116, 161)].map(b => b.join('\n') + '\n');
    let at = 0;
    for (const b of blocks) {
      const i = text.indexOf(b, at);
      expect(i, 'not found after offset ' + at + ': ' + b.slice(0, 80)).toBeGreaterThanOrEqual(0);
      at = i + b.length;
    }
    expect(text).not.toContain('(function(global){');
  });
});
