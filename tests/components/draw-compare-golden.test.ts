import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { compareKey, compareTipAt, drawCompare, type CmpColors, type CmpSeries } from '../../src/components/report/draw-compare';
import { DAY_MS } from '../../src/lib/decay/compare';

/* The comparison chart's call stream as it was before L67 touched it (CHANGES-FROM-LEGACY.md, L66; recorded from 4621100). Its
   default view (Auto, mean altitude) must keep drawing exactly this: every call made on the 2D context but measureText, in order,
   each with the state it was made in, hashed, beside the canvas's name, the geometry, the key and five readings of the readout.
   Property sets are not events, so a harmless reordering of assignments between two calls still passes. The snapshot is written
   once, by the untouched code, and is never updated: if it fails, the code is wrong. */

const col: CmpColors = { ink2: '#ink2', muted: '#muted', rule: '#rule', panel: '#panel', slots: ['#track', '#s2', '#s3', '#s4', '#s5', '#s6', '#s7', '#s8'] };
const DPR = 2;

type St = {
  strokeStyle: unknown; fillStyle: unknown; globalAlpha: unknown; lineWidth: unknown; dash: number[]; textAlign: unknown;
  textBaseline: unknown; font: unknown; lineJoin: unknown; miterLimit: unknown;
};
/** a 2D context that records every call but measureText (6.6 px a character) as [op, ...args] with the state it was made in;
 *  save/restore and setLineDash keep their state */
function canvas(W: number) {
  const stream: unknown[] = [];
  let st: St = {
    strokeStyle: '', fillStyle: '', globalAlpha: 1, lineWidth: 1, dash: [], textAlign: 'start', textBaseline: 'alphabetic',
    font: '', lineJoin: 'miter', miterLimit: 10
  };
  const stack: St[] = [];
  const rec = (op: string, args: unknown[]) => stream.push([[op, ...args],
    [st.strokeStyle, st.fillStyle, st.globalAlpha, st.lineWidth, st.dash.slice(), st.textAlign, st.textBaseline, st.font, st.lineJoin, st.miterLimit]]);
  const ctx = new Proxy({}, {
    get(_, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: s.length * 6.6 });
      if (k === 'setLineDash') return (d: number[]) => { rec(k, [d.slice()]); st.dash = d.slice(); };
      if (k === 'save') return () => { rec(k, []); stack.push({ ...st, dash: st.dash.slice() }); };
      if (k === 'restore') return () => { rec(k, []); st = stack.pop() ?? st; };
      if (k in st) return (st as Record<string, unknown>)[k];
      return (...args: unknown[]) => rec(k, args);
    },
    set(_, k: string, v) { (st as Record<string, unknown>)[k] = v; return true; }
  });
  const c = { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: W }) } as unknown as HTMLCanvasElement;
  return { c, stream };
}

const T = Date.UTC(2026, 9, 18);
/* a record of daily sets from `from` km to `to` km ending `endAgo` days before T, and a projection `proj` days long down to 120 km
   (draw-compare.test.ts's helpers, copied) */
function line(n: string, slot: number, name: string, days: number, endAgo: number, from: number, to: number, proj = 0): CmpSeries {
  const tNow = T - endAgo * DAY_MS;
  const P = Array.from({ length: days + 1 }, (_, i) => ({ t: tNow - (days - i) * DAY_MS, sma: from - (from - to) * (i / days) }));
  const track = proj ? Array.from({ length: 11 }, (_, i) => ({ t: proj * i / 10, h: to - (to - 120) * (i / 10) })) : null;
  return { n, slot, name, P, r: { tNow, hNow: to, track } };
}
const geo = (slot: number): CmpSeries => ({
  n: '28884', slot, name: 'GEO', P: [{ t: T - 300 * DAY_MS, sma: 35786 }, { t: T, sma: 35786 }], r: { tNow: T, hNow: 35786, track: null }
});
const three = (): CmpSeries[] => [
  line('25544', 1, 'ISS (ZARYA)', 1000, 1, 460, 410, 300),
  line('40001', 2, 'ALPHA', 1000, 5, 700, 600, 900),
  line('40002', 3, 'BRAVO', 1000, 10, 560, 500, 600)
];
const greys = (): CmpSeries[] => [line('40011', 0, 'GREY A', 400, 3, 500, 450, 100), line('40012', 0, 'GREY B', 400, 6, 520, 470, 200)];

/** what the scene draws and reads, picked field by field (a field added to drawCompare's result later is not in it) */
function record(lines: CmpSeries[], W: number) {
  const { c, stream } = canvas(W);
  const out = drawCompare(c, lines, col);
  const g = out.geom;
  const json = JSON.stringify(stream);
  const plot = g ? g.Wc - g.L - g.R : 0;
  const tips = g
    ? [g.L, g.L + plot / 4, g.L + plot / 2, g.L + 3 * plot / 4, g.Wc - g.R].map(x => {
        const tip = compareTipAt(g, lines, x, col);
        return tip && { x: tip.x, t: tip.t, day: tip.day, rows: tip.rows.map(r => ({ ...r })) };
      })
    : null;
  return {
    draw: {
      calls: stream.length,
      sha256: createHash('sha256').update(json).digest('hex'),
      label: out.label,
      labelled: out.labelled,
      geom: g ? { t0: g.t0, tEnd: g.tEnd, hMin: g.hMin, hMax: g.hMax, L: g.L, R: g.R, T: g.T, B: g.B, Wc: g.Wc, Hc: g.Hc } : null
    },
    key: compareKey(lines, col).map(k => ({ ...k })),
    tips
  };
}

beforeAll(() => { vi.stubGlobal('window', { devicePixelRatio: DPR }); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('the comparison chart before L67: its call stream, key and readout (golden)', () => {
  for (const W of [700, 280, 390, 1100]) {
    it('three coloured lines at ' + W + ' px', () => {
      expect(record(three(), W)).toMatchSnapshot();
    });
  }

  it('a 28-year ISS beside a 200-day KNACKSAT-2, at 700 px', () => {
    const iss = line('25544', 1, 'ISS (ZARYA)', 28 * 365, 1, 460, 410, 300), young = line('67683', 2, 'KNACKSAT-2', 200, 2, 520, 470, 150);
    expect(record([iss, young], 700)).toMatchSnapshot();
  });

  it('two coloured lines, two grey lines and a GEO line that is not drawn, at 700 px', () => {
    const [iss, a] = three(), [g1, g2] = greys();
    expect(record([g1!, a!, geo(4), iss!, g2!], 700)).toMatchSnapshot();
  });

  it('grey lines only, at 700 px', () => {
    expect(record(greys(), 700)).toMatchSnapshot();
  });

  it('nothing drawable, at 700 px', () => {
    const r = record([geo(2)], 700);
    expect(r.draw.geom).toBeNull();
    expect(r).toMatchSnapshot();
  });

  it('two coloured lines whose projections reach 120 km, named on a 900 px canvas', () => {
    const lines = three().slice(0, 2);
    const r = record(lines, 900);
    expect(r.draw.labelled).toBe(true);
    expect(r).toMatchSnapshot();
  });
});
