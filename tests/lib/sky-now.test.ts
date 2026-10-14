import { describe, expect, it } from 'vitest';
import { flownSamples, skyXY } from '../../src/lib/analysis/sky-now';
import { drawRadar, type RadarFrame, type RadarPalette } from '../../src/lib/ar/radar';
import type { Pass } from '../../src/lib/types';
import { byName, world } from './helpers';

/* The pass sky plot while its pass is being flown (CHANGES-FROM-LEGACY.md, L54): how much of the pass is behind the spacecraft, which
   is the AR radar's count copied (radar.ts is in the AR chunk), and where a look lands on the plot, which is drawSky's own transform
   (that agreement is checked against drawSky itself in tests/components/draw-sky.test.ts). */
const START = Date.parse('2026-09-12T07:29:09.993Z');
const { eng } = world();
const ISS = eng.compute(byName('ISS (ZARYA)'), START, 24);
const passes: Pass[] = ISS.passes;

describe('flownSamples', () => {
  const p = passes[0]!, n = p.arc.length - 1, dur = p.t1ms - p.t0ms;

  it('is 0 before AOS and after LOS, n at LOS, and the samples whose instant has passed in between', () => {
    expect(n).toBe(90);
    expect(flownSamples(p, p.t0ms - 1)).toBe(0);
    expect(flownSamples(p, p.t1ms + 1)).toBe(0);
    expect(flownSamples(p, p.t0ms)).toBe(0);
    expect(flownSamples(p, p.t1ms)).toBe(n);
    // the arc is sampled evenly in time (engine.ts build()): sample i is at t0 + dur * i / 90
    for (const i of [1, 17, 45, 89]) {
      const at = p.t0ms + dur * i / n;
      expect(flownSamples(p, at + 1)).toBe(i);
      expect(flownSamples(p, at - 1)).toBe(i - 1);
    }
  });

  it('never goes back while the clock moves on through the pass', () => {
    let k = 0;
    for (let ms = p.t0ms; ms <= p.t1ms; ms += dur / 997) { const f = flownSamples(p, ms); expect(f).toBeGreaterThanOrEqual(k); k = f; }
  });

  it('is 0 for a pass of no length, rather than NaN', () => {
    expect(flownSamples({ arc: p.arc, t0ms: 5, t1ms: 5 }, 5)).toBe(0);
    expect(flownSamples({ arc: p.arc, t0ms: 5, t1ms: 5 }, NaN)).toBe(0);
  });

  /* The count is the AR radar's (radar.ts flown(), private there): the radar draws the flown stretch as one faint path through the
     samples 0..k, so k is read off the points of that path, for every pass of a day at instants all through each. */
  it('is the stretch the AR radar draws faint, at every instant checked', () => {
    const pal: RadarPalette = { ink: '#i', ink2: '#i2', halo: '#h', grid: '#g', horizon: '#hz', mask: '#m', pass: '#p', craft: '#c', aim: '#a' };
    const radarK = (pass: Pass, ms: number): number => {
      const calls: { op: string; alpha: number }[] = [];
      const state: Record<string, unknown> = { globalAlpha: 1 };
      const ctx = new Proxy(state, {
        get(t, k: string) { return k in t ? t[k] : () => { calls.push({ op: k, alpha: t.globalAlpha as number }); }; },
        set(t, k: string, v) { t[k] = v; return true; }
      }) as unknown as CanvasRenderingContext2D;
      const f: RadarFrame = { size: 156, dpr: 1, mask: 5, ms, pass, craft: null, aim: null };
      drawRadar(ctx, f, pal);
      const faint = calls.findIndex(c => c.op === 'stroke' && c.alpha === 0.45);
      if (faint < 0) return 0;
      let b = faint; while (calls[b]!.op !== 'beginPath') b--;
      return calls.slice(b, faint).filter(c => c.op === 'moveTo' || c.op === 'lineTo').length - 1;
    };
    let checked = 0;
    for (const q of passes) {
      for (let j = 0; j <= 40; j++) {
        const ms = q.t0ms + (q.t1ms - q.t0ms) * j / 40 + 0.5;
        expect(flownSamples(q, ms)).toBe(radarK(q, ms));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('skyXY', () => {
  const S = 268, R = S / 2 - 22;

  it('puts the zenith at the centre and the horizon on a circle of radius size/2 - 22', () => {
    const z = skyXY(S, 123, 90);
    expect(z[0]).toBeCloseTo(S / 2, 9); expect(z[1]).toBeCloseTo(S / 2, 9);
    for (const az of [0, 37, 90, 200, 359]) {
      const h = skyXY(S, az, 0);
      expect(Math.hypot(h[0] - S / 2, h[1] - S / 2)).toBeCloseTo(R, 9);
    }
  });

  it('has north up and east to the right, and is linear in zenith distance', () => {
    const n = skyXY(S, 0, 45), e = skyXY(S, 90, 45), s = skyXY(S, 180, 45), w = skyXY(S, 270, 45);
    expect(n[1]).toBeLessThan(S / 2); expect(n[0]).toBeCloseTo(S / 2, 9);
    expect(e[0]).toBeGreaterThan(S / 2); expect(e[1]).toBeCloseTo(S / 2, 9);
    expect(s[1]).toBeGreaterThan(S / 2);
    expect(w[0]).toBeLessThan(S / 2);
    for (const el of [5, 30, 60, 85]) expect(S / 2 - skyXY(S, 0, el)[1]).toBeCloseTo(R * (90 - el) / 90, 9);
  });
});
