import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawSky, type SkyColors } from '../../src/components/rail/draw-sky';
import { skyXY } from '../../src/lib/analysis/sky-now';
import { byName, world } from '../lib/helpers';

/* drawSky's fifth argument (CHANGES-FROM-LEGACY.md, L54): while the clock is inside the pass, the first `flown` samples of the arc,
   the stretch already behind the spacecraft, are drawn faint; 0, the default, draws the plot as it always was. Checked against a
   recording context (Vitest runs without a DOM): what matters is which points each stroke of the arc goes through, at what opacity,
   and that nothing else on the plot changes. */

const col: SkyColors = { sunk: '#sunk', ring: '#ring', observer: '#obs', ink: '#ink', ink2: '#ink2', panel: '#panel', muted: '#muted', contact: '#contact' };
const S = 268, DPR = 2;

interface Call { op: string; args: unknown[]; stroke: unknown; fill: unknown; alpha: number }
function canvas() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { strokeStyle: '', fillStyle: '', globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => { calls.push({ op: k, args, stroke: t.strokeStyle, fill: t.fillStyle, alpha: t.globalAlpha as number }); };
    },
    set(t, k: string, v) { t[k] = v; return true; }
  });
  const c = { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: S }) } as unknown as HTMLCanvasElement;
  return { c, calls, state };
}

/* the arc's strokes: each path's points (moveTo, lineTo) up to a stroke in the contact colour with the 3 px line */
function arcStrokes(calls: Call[]) {
  const out: { pts: [number, number][]; alpha: number }[] = [];
  let pts: [number, number][] = [];
  for (const c of calls) {
    if (c.op === 'beginPath') pts = [];
    else if (c.op === 'moveTo' || c.op === 'lineTo') pts.push([c.args[0] as number, c.args[1] as number]);
    else if (c.op === 'stroke' && c.stroke === col.contact && pts.length > 1) out.push({ pts, alpha: c.alpha });
  }
  return out;
}

const { eng } = world();
const ISS = eng.compute(byName('ISS (ZARYA)'), Date.parse('2026-09-12T07:29:09.993Z'), 24);
const p = ISS.passes.slice().sort((a, b) => b.maxEl - a.maxEl)[0]!;
const n = p.arc.length - 1;

beforeAll(() => { vi.stubGlobal('window', { devicePixelRatio: DPR }); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('drawSky', () => {
  it('sizes the backing store to the CSS box times the device pixel ratio, as before', () => {
    const { c } = canvas();
    drawSky(c, p, 5, col);
    expect(c.width).toBe(S * DPR); expect(c.height).toBe(S * DPR);
  });

  it('without `flown` draws the arc as one stroke through every sample, at full opacity, where skyXY puts them', () => {
    const { c, calls } = canvas();
    drawSky(c, p, 5, col);
    const arcs = arcStrokes(calls);
    expect(arcs.length).toBe(1);
    expect(arcs[0]!.alpha).toBe(1);
    expect(arcs[0]!.pts.length).toBe(n + 1);
    arcs[0]!.pts.forEach((q, i) => {
      const w = skyXY(S, p.arc[i]!.az, p.arc[i]!.el);
      expect(q[0]).toBeCloseTo(w[0], 9); expect(q[1]).toBeCloseTo(w[1], 9);
    });
    expect(calls.every(x => x.alpha === 1)).toBe(true);
  });

  it('with `flown` = k draws samples 0..k faint (.45, the AR radar\'s), then k..n at full opacity, and puts the opacity back', () => {
    const whole = arcStrokes((() => { const r = canvas(); drawSky(r.c, p, 5, col); return r.calls; })())[0]!.pts;
    for (const k of [1, 30, 45, 89]) {
      const { c, calls, state } = canvas();
      drawSky(c, p, 5, col, k);
      const arcs = arcStrokes(calls);
      expect(arcs.length).toBe(2);
      expect(arcs[0]!.alpha).toBe(0.45);
      expect(arcs[0]!.pts.length).toBe(k + 1);
      expect(arcs[1]!.alpha).toBe(1);
      expect(arcs[1]!.pts.length).toBe(n - k + 1);
      // the two meet at sample k, and together they go through the points the one stroke went through
      expect(arcs[0]!.pts[k]).toEqual(arcs[1]!.pts[0]);
      expect(arcs[0]!.pts.concat(arcs[1]!.pts.slice(1))).toEqual(whole);
      expect(state.globalAlpha).toBe(1);
      // only the flown stretch is faint: the highest point, AOS and LOS are drawn after it at full opacity
      const faint = calls.filter(x => x.alpha !== 1);
      expect(faint.map(x => x.op)).toEqual(['beginPath', 'moveTo', ...Array<string>(k).fill('lineTo'), 'stroke']);
    }
    // at LOS the whole arc is behind the spacecraft
    const { c, calls } = canvas();
    drawSky(c, p, 5, col, n);
    const arcs = arcStrokes(calls);
    expect(arcs.length).toBe(1);
    expect(arcs[0]!.alpha).toBe(0.45);
    expect(arcs[0]!.pts).toEqual(whole);
  });

  it('changes nothing else on the plot: the disc, the rings, the letters, the highest point and AOS/LOS are the same calls', () => {
    /* every call but the arc's own paths: a beginPath, then moveTo/lineTo, then a stroke in the contact colour */
    const others = (calls: Call[]) => {
      const out: Call[] = [];
      for (let i = 0; i < calls.length; i++) {
        if (calls[i]!.op === 'beginPath') {
          let j = i + 1;
          while (j < calls.length && (calls[j]!.op === 'moveTo' || calls[j]!.op === 'lineTo')) j++;
          if (j > i + 1 && calls[j]?.op === 'stroke' && calls[j]!.stroke === col.contact) { i = j; continue; }
        }
        out.push(calls[i]!);
      }
      return out;
    };
    const a = canvas();
    drawSky(a.c, p, 5, col);
    expect(others(a.calls).length).toBe(a.calls.length - (n + 3));
    for (const k of [1, 40, n]) {
      const b = canvas();
      drawSky(b.c, p, 5, col, k);
      expect(others(b.calls)).toEqual(others(a.calls));
    }
  });

  it('draws only the disc for no pass, whatever `flown` says', () => {
    const a = canvas(), b = canvas();
    drawSky(a.c, null, 5, col);
    drawSky(b.c, null, 5, col, 12);
    expect(b.calls).toEqual(a.calls);
    expect(arcStrokes(a.calls).length).toBe(0);
  });
});
