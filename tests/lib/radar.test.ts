import { describe, expect, it } from 'vitest';
import { drawRadar, radarGeometry, radarPoint, radarSize, type RadarFrame, type RadarPalette } from '../../src/lib/ar/radar';

/* The AR radar's geometry is the console's own sky plot (src/components/rail/draw-sky.ts): r = R (90 - el) / 90, north up, east to
   the right, the zenith at the centre and the horizon on the rim. */

const RAD = Math.PI / 180;
const g = radarGeometry(156);

describe('radarSize', () => {
  it('is two fifths of the short side, between 112 and 200 px', () => {
    expect(radarSize(390, 844)).toBe(156);
    expect(radarSize(844, 390)).toBe(156);
    expect(radarSize(320, 568)).toBe(128);
    expect(radarSize(240, 400)).toBe(112);
    expect(radarSize(820, 1180)).toBe(200);
  });
});

describe('radarPoint', () => {
  it('puts the zenith at the centre and the horizon on the rim', () => {
    const z = radarPoint(g, 123, 90);
    expect(z.x).toBeCloseTo(g.cx, 9); expect(z.y).toBeCloseTo(g.cy, 9);
    const h = radarPoint(g, 90, 0);
    expect(h.x).toBeCloseTo(g.cx + g.R, 9); expect(h.y).toBeCloseTo(g.cy, 9);
  });

  it('has north up and east to the right', () => {
    const n = radarPoint(g, 0, 45), e = radarPoint(g, 90, 45), s = radarPoint(g, 180, 45), w = radarPoint(g, 270, 45);
    expect(n.y).toBeLessThan(g.cy); expect(n.x).toBeCloseTo(g.cx, 9);
    expect(e.x).toBeGreaterThan(g.cx); expect(e.y).toBeCloseTo(g.cy, 9);
    expect(s.y).toBeGreaterThan(g.cy);
    expect(w.x).toBeLessThan(g.cx);
  });

  it('is linear in zenith distance, as the console\'s plot is', () => {
    for (const [az, el] of [[0, 30], [45, 60], [200, 12.5], [359.9, 89]] as const) {
      const q = radarPoint(g, az, el), r = g.R * (90 - el) / 90;
      expect(q.x).toBeCloseTo(g.cx + r * Math.sin(az * RAD), 9);
      expect(q.y).toBeCloseTo(g.cy - r * Math.cos(az * RAD), 9);
      expect(q.clamped).toBe(false);
    }
  });

  it('keeps a direction below the horizon on the rim, and says so', () => {
    const q = radarPoint(g, 180, -20);
    expect(q.clamped).toBe(true);
    expect(Math.hypot(q.x - g.cx, q.y - g.cy)).toBeCloseTo(g.R, 9);
    expect(q.y).toBeGreaterThan(g.cy);
  });
});

/* drawRadar against a recording context: what it draws is a handful of calls, and the checks are on what matters to a reader. */
function recorder() {
  const calls: { op: string; args: unknown[]; stroke: unknown; fill: unknown; alpha: number }[] = [];
  const state: Record<string, unknown> = { strokeStyle: '', fillStyle: '', globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => { calls.push({ op: k, args, stroke: t.strokeStyle, fill: t.fillStyle, alpha: t.globalAlpha as number }); };
    },
    set(t, k: string, v) { t[k] = v; return true; }
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const pal: RadarPalette = { ink: '#i', ink2: '#i2', halo: '#h', grid: '#g', horizon: '#hz', mask: '#m', pass: '#p', craft: '#c', aim: '#AIM' };
const frame = (o: Partial<RadarFrame>): RadarFrame => ({ size: 156, dpr: 2, mask: 5, ms: 0, pass: null, craft: null, aim: null, ...o });

describe('drawRadar', () => {
  it('draws no crosshair while the phone\'s heading is unknown, and none for a spacecraft below the horizon', () => {
    const { ctx, calls } = recorder();
    const p = drawRadar(ctx, frame({ craft: { az: 10, el: -5 }, aim: null }), pal);
    expect(p.aim).toBeNull(); expect(p.craft).toBeNull(); expect(p.pass).toBe(false);
    expect(calls.some(c => c.stroke === '#AIM')).toBe(false);
  });

  it('draws the crosshair in the aim colour where the phone points, and reports where', () => {
    const { ctx, calls } = recorder();
    const p = drawRadar(ctx, frame({ aim: { az: 135, el: 40 } }), pal);
    const want = radarPoint(radarGeometry(156), 135, 40);
    expect(p.aim).toEqual(want);
    expect(calls.some(c => c.stroke === '#AIM' && c.op === 'stroke')).toBe(true);
  });

  it('puts the spacecraft at its own azimuth and elevation, in the pass colour above the mask and cyan below it', () => {
    for (const [el, colour] of [[30, '#p'], [3, '#c']] as const) {
      const { ctx, calls } = recorder();
      const p = drawRadar(ctx, frame({ craft: { az: 250, el } }), pal);
      expect(p.craft).toEqual(radarPoint(radarGeometry(156), 250, el));
      expect(calls.some(c => c.op === 'fill' && c.fill === colour)).toBe(true);
    }
  });

  it('leaves the crosshair on the rim, fainter, when the phone points below the horizon', () => {
    const { ctx, calls } = recorder();
    const p = drawRadar(ctx, frame({ aim: { az: 90, el: -30 } }), pal);
    expect(p.aim!.clamped).toBe(true);
    expect(Math.hypot(p.aim!.x - p.cx, p.aim!.y - p.cy)).toBeCloseTo(p.R, 9);
    expect(calls.some(c => c.op === 'stroke' && c.stroke === '#AIM' && c.alpha < 1)).toBe(true);
  });

  it('leaves the crosshair out within 5 degrees of straight down, where the azimuth is only a tremor, and draws it from 85', () => {
    for (const el of [-90, -89, -85.5, -85.01]) {
      const { ctx, calls } = recorder();
      const p = drawRadar(ctx, frame({ aim: { az: 40, el } }), pal);
      expect(p.aim, 'el ' + el).toBeNull();
      expect(calls.some(c => c.stroke === '#AIM')).toBe(false);
    }
    const { ctx, calls } = recorder();
    const p = drawRadar(ctx, frame({ aim: { az: 40, el: -85 } }), pal);
    expect(p.aim!.clamped).toBe(true);
    expect(calls.some(c => c.stroke === '#AIM')).toBe(true);
  });

  it('marks the highest point with a ring, so that the spacecraft is the one solid dot', () => {
    const arc = Array.from({ length: 11 }, (_, i) => ({ az: 300 + i * 10, el: Math.sin(i / 10 * Math.PI) * 50 }));
    const pass = { arc, t0ms: 0, t1ms: 1000, maxAz: 350, maxEl: 50 };
    const solid = (craft: { az: number; el: number } | null) => {
      const { ctx, calls } = recorder();
      drawRadar(ctx, frame({ pass, ms: 500, craft }), pal);
      return calls.filter(c => c.op === 'fill' && c.fill === '#p').length;
    };
    expect(solid(null)).toBe(0);
    expect(solid({ az: 340, el: 30 })).toBe(1);
  });

  it('stars an end of the pass that the window, not the horizon, cut off', () => {
    const arc = Array.from({ length: 11 }, (_, i) => ({ az: 300 + i * 10, el: Math.sin(i / 10 * Math.PI) * 50 }));
    const words = (clipA: boolean, clipL: boolean) => {
      const { ctx, calls } = recorder();
      drawRadar(ctx, frame({ pass: { arc, t0ms: 0, t1ms: 1000, maxAz: 350, maxEl: 50, clipA, clipL }, ms: 500 }), pal);
      return calls.filter(c => c.op === 'fillText').map(c => c.args[0]);
    };
    expect(words(false, false)).toEqual(expect.arrayContaining(['AOS', 'LOS']));
    expect(words(true, false)).toEqual(expect.arrayContaining(['AOS*', 'LOS']));
    expect(words(false, true)).toEqual(expect.arrayContaining(['AOS', 'LOS*']));
  });

  it('draws a pass, its flown part faint, and says it did', () => {
    const arc = Array.from({ length: 11 }, (_, i) => ({ az: 300 + i * 10, el: Math.sin(i / 10 * Math.PI) * 50 }));
    const { ctx, calls } = recorder();
    const p = drawRadar(ctx, frame({ pass: { arc, t0ms: 0, t1ms: 1000, maxAz: 350, maxEl: 50 }, ms: 500 }), pal);
    expect(p.pass).toBe(true);
    const strokes = calls.filter(c => c.op === 'stroke' && c.stroke === '#p');
    expect(strokes.some(c => c.alpha < 1)).toBe(true);     // the stretch already flown
    expect(strokes.some(c => c.alpha === 1)).toBe(true);   // the rest
  });

  it('draws in CSS pixels under the transform it is given, and clears the whole backing store first', () => {
    const { ctx, calls } = recorder();
    drawRadar(ctx, frame({ dpr: 3 }), pal);
    expect(calls[0]).toMatchObject({ op: 'setTransform', args: [1, 0, 0, 1, 0, 0] });
    expect(calls[1]).toMatchObject({ op: 'clearRect', args: [0, 0, 468, 468] });
    expect(calls.some(c => c.op === 'setTransform' && c.args[0] === 3 && c.args[3] === 3)).toBe(true);
  });
});

/* The cache: the disc and the pass are painted once and laid down each frame; a frame the same as the last is not drawn. */
function layers() {
  const made: { w: number; h: number; calls: string[]; cv: { width: number; height: number; getContext: () => unknown } }[] = [];
  const make = (w: number, h: number) => {
    const rec = recorder();
    const entry = { w, h, calls: [] as string[], cv: { width: w, height: h, getContext: () => rec.ctx } };
    made.push(entry);
    Object.defineProperty(entry, 'calls', { get: () => rec.calls.map(c => c.op) });
    return entry.cv as unknown as ReturnType<NonNullable<NonNullable<Parameters<typeof drawRadar>[3]>['make']>>;
  };
  return { made, make };
}

describe('drawRadar with a cache', () => {
  const arc = Array.from({ length: 11 }, (_, i) => ({ az: 300 + i * 10, el: Math.sin(i / 10 * Math.PI) * 50 }));
  const pass = { arc, t0ms: 0, t1ms: 1000, maxAz: 350, maxEl: 50 };

  it('paints the disc once, whatever moves', () => {
    const L = layers(), cache = { make: L.make };
    const { ctx, calls } = recorder();
    drawRadar(ctx, frame({ aim: { az: 10, el: 20 } }), pal, cache);
    drawRadar(ctx, frame({ aim: { az: 11, el: 21 } }), pal, cache);
    drawRadar(ctx, frame({ aim: { az: 12, el: 22 } }), pal, cache);
    expect(L.made).toHaveLength(1);                                       // only the base: there is no pass
    expect(L.made[0]!.calls.filter(o => o === 'fillText')).toHaveLength(4);  // N E S W, once
    expect(calls.filter(c => c.op === 'drawImage')).toHaveLength(3);
    expect(calls.filter(c => c.op === 'fillText')).toHaveLength(0);       // none on the canvas itself
  });

  it('does not draw a frame that would be the last one again, and draws the next that differs', () => {
    const L = layers(), cache = { make: L.make };
    const { ctx, calls } = recorder();
    const a = drawRadar(ctx, frame({ aim: { az: 10, el: 20 }, craft: { az: 100, el: 30 } }), pal, cache);
    const n = calls.length;
    const b = drawRadar(ctx, frame({ aim: { az: 10.02, el: 20.01 }, craft: { az: 100.01, el: 30 } }), pal, cache);
    expect(calls.length).toBe(n);                                         // not a call more
    expect(b).toBe(a);
    drawRadar(ctx, frame({ aim: { az: 10.5, el: 20 }, craft: { az: 100, el: 30 } }), pal, cache);
    expect(calls.length).toBeGreaterThan(n);
  });

  it('repaints the pass layer only when its flown part moves on, and the disc layer when the size does', () => {
    const L = layers(), cache = { make: L.make };
    const { ctx } = recorder();
    drawRadar(ctx, frame({ pass, ms: 100 }), pal, cache);
    expect(L.made).toHaveLength(2);
    const paintsOf = (i: number) => L.made[i]!.calls.filter(o => o === 'stroke').length;
    const p0 = paintsOf(1);
    drawRadar(ctx, frame({ pass, ms: 105, aim: { az: 1, el: 1 } }), pal, cache);   // same sample of the pass
    expect(paintsOf(1)).toBe(p0);
    drawRadar(ctx, frame({ pass, ms: 300 }), pal, cache);                           // three samples further
    expect(paintsOf(1)).toBeGreaterThan(p0);
    const base0 = paintsOf(0);
    drawRadar(ctx, frame({ pass, ms: 300, size: 128 }), pal, cache);
    expect(paintsOf(0)).toBeGreaterThan(base0);
    expect(L.made[0]!.cv.width).toBe(256);                                         // 128 px at 2x
  });

  it('draws the same marks with a cache as without', () => {
    const L = layers();
    const f = frame({ pass, ms: 500, aim: { az: 330, el: 20 }, craft: { az: 340, el: 25 } });
    const a = drawRadar(recorder().ctx, f, pal), b = drawRadar(recorder().ctx, f, pal, { make: L.make });
    expect(b).toEqual(a);
  });
});
