import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CMP_PALETTE, colorOf, compareKey, compareTipAt, drawCompare, readCmpColors, type CmpColors, type CmpSeries, type DrawView
} from '../../src/components/report/draw-compare';
import { baseWindow, DAY_MS, frame, periodMin, RE, seriesEnd } from '../../src/lib/decay/compare';
import { CMP_REENTRY } from '../../src/lib/text/life-compare';

/* The decay comparison's chart (CHANGES-FROM-LEGACY.md, L66), drawn on a recording context (Vitest runs without a DOM): the frame it
   is fitted to, the 120 km line, the grey context lines first and thin, the coloured ones by slot with the selected spacecraft last
   and heaviest, its names written at the dots all or none (and never on the 'top' baseline), the key, and the hover's readout. */

const col: CmpColors = { ink2: '#ink2', muted: '#muted', rule: '#rule', panel: '#panel', slots: ['#track', '#s2', '#s3', '#s4', '#s5', '#s6', '#s7', '#s8'] };
const SLOT_COLOURS = new Set(col.slots);
const DPR = 2, L = 46, R = 30;

interface Call { op: string; args: unknown[]; stroke: unknown; fill: unknown; alpha: number; width: number; dash: number[]; base: string; align: string }
/** a 2D context that records every call with the state it was made in; save/restore and setLineDash keep their state */
function canvas(W = 700) {
  const calls: Call[] = [];
  let st: Record<string, unknown> = { strokeStyle: '', fillStyle: '', globalAlpha: 1, lineWidth: 1, textBaseline: 'alphabetic', textAlign: 'start', dash: [] };
  const stack: Record<string, unknown>[] = [];
  const rec = (op: string, args: unknown[]) => calls.push({
    op, args, stroke: st.strokeStyle, fill: st.fillStyle, alpha: st.globalAlpha as number, width: st.lineWidth as number,
    dash: st.dash as number[], base: st.textBaseline as string, align: st.textAlign as string
  });
  const ctx = new Proxy({}, {
    get(_, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: s.length * 6.6 });
      if (k === 'setLineDash') return (d: number[]) => { st.dash = d.slice(); };
      if (k === 'save') return () => { stack.push({ ...st }); rec('save', []); };
      if (k === 'restore') return () => { st = stack.pop() ?? st; rec('restore', []); };
      if (k in st) return st[k];
      return (...args: unknown[]) => rec(k, args);
    },
    set(_, k: string, v) { st[k] = v; return true; }
  });
  const c = { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: W }) } as unknown as HTMLCanvasElement;
  return { c, calls };
}

/** each path that was stroked or filled: its points, arcs and the state it was drawn in */
interface Mark { op: 'stroke' | 'fill'; pts: [number, number][]; arcs: [number, number, number][]; color: unknown; alpha: number; width: number; dash: number[] }
function marks(calls: Call[]): Mark[] {
  const out: Mark[] = [];
  let pts: [number, number][] = [], arcs: [number, number, number][] = [];
  for (const c of calls) {
    if (c.op === 'beginPath') { pts = []; arcs = []; }
    else if (c.op === 'moveTo' || c.op === 'lineTo') pts.push([c.args[0] as number, c.args[1] as number]);
    else if (c.op === 'arc') arcs.push([c.args[0] as number, c.args[1] as number, c.args[2] as number]);
    else if (c.op === 'stroke' || c.op === 'fill') {
      out.push({ op: c.op, pts, arcs, color: c.op === 'stroke' ? c.stroke : c.fill, alpha: c.alpha, width: c.width, dash: c.dash });
    }
  }
  return out;
}
const texts = (calls: Call[]) => calls.filter(c => c.op === 'fillText' || c.op === 'strokeText');
/** the lines of the series: strokes of more than one point, not the grid and not the 120 km line */
const seriesLines = (calls: Call[]) => marks(calls).filter(m => m.op === 'stroke' && m.pts.length > 1 && m.color !== col.rule && !(m.dash.join() === '4,3'));

const T = Date.UTC(2026, 9, 18);
/* a record of daily sets from `from` km to `to` km ending `endAgo` days before T, and a projection `proj` days long down to 120 km */
function line(n: string, slot: number, name: string, days: number, endAgo: number, from: number, to: number, proj = 0): CmpSeries {
  const tNow = T - endAgo * DAY_MS;
  const P = Array.from({ length: days + 1 }, (_, i) => ({ t: tNow - (days - i) * DAY_MS, sma: from - (from - to) * (i / days) }));
  const track = proj ? Array.from({ length: 11 }, (_, i) => ({ t: proj * i / 10, h: to - (to - 120) * (i / 10) })) : null;
  return { n, slot, name, P, r: { tNow, hNow: to, track } };
}
const geo = (slot: number): CmpSeries => ({
  n: '28884', slot, name: 'GEO', P: [{ t: T - 300 * DAY_MS, sma: 35786 }, { t: T, sma: 35786 }], r: { tNow: T, hNow: 35786, track: null }
});
/* three coloured lines whose last sets sit far apart */
const three = (): CmpSeries[] => [
  line('25544', 1, 'ISS (ZARYA)', 1000, 1, 460, 410, 300),
  line('40001', 2, 'ALPHA', 1000, 5, 700, 600, 900),
  line('40002', 3, 'BRAVO', 1000, 10, 560, 500, 600)
];
function draw(lines: CmpSeries[], W = 700) {
  const { c, calls } = canvas(W);
  const out = drawCompare(c, lines, col);
  return { ...out, c, calls };
}

beforeAll(() => { vi.stubGlobal('window', { devicePixelRatio: DPR }); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('drawCompare: the canvas and the frame', () => {
  it('is 320 px tall, as wide as its box (280 px at least), at the device pixel ratio', () => {
    const { c, geom } = draw(three(), 700);
    expect([c.width, c.height]).toEqual([700 * DPR, 320 * DPR]);
    expect([geom!.Wc, geom!.Hc, geom!.L, geom!.R]).toEqual([700, 320, L, R]);
    expect(draw(three(), 200).geom!.Wc).toBe(280);
  });

  it('a 28-year record beside a 200-day one: the frame is the model\'s, and the short one has at least a quarter of the plot', () => {
    const iss = line('25544', 1, 'ISS (ZARYA)', 28 * 365, 1, 460, 410, 300), young = line('67683', 2, 'KNACKSAT-2', 200, 2, 520, 470, 150);
    const { geom, calls } = draw([iss, young]);
    const f = frame([iss, young])!;
    expect({ t0: geom!.t0, tEnd: geom!.tEnd, hMin: geom!.hMin, hMax: geom!.hMax }).toEqual(f);
    const plot = geom!.Wc - L - R;
    expect((geom!.X(seriesEnd(young)) - geom!.X(Math.max(geom!.t0, young.P[0]!.t))) / plot).toBeGreaterThanOrEqual(0.25);
    /* the old record is not drawn whole: the line comes in from the left edge, from the last set before the frame, and is clipped */
    const hist = seriesLines(calls).filter(m => m.color === '#track' && m.dash.length === 0)[0]!;
    const inView = iss.P.filter(p => p.t >= geom!.t0).length;
    expect(hist.pts).toHaveLength(inView + 1);
    expect(hist.pts[0]![0]).toBeLessThan(L);
    expect(hist.pts[1]![0]).toBeGreaterThanOrEqual(L);
    const clip = calls.findIndex(c => c.op === 'clip');
    expect(calls[clip - 1]).toMatchObject({ op: 'rect', args: [L, 14, geom!.Wc - L - R, 320 - 14 - 26] });
    expect(calls.findIndex(c => c.op === 'save')).toBeLessThan(clip);
  });

  it('a 36,000 km object is not drawn, does not move the frame and is not counted', () => {
    const a = draw(three()), b = draw([...three().slice(0, 2), geo(3)]), c = draw([...three(), geo(4)]);
    expect(c.geom!.t0).toBe(a.geom!.t0); expect(c.geom!.tEnd).toBe(a.geom!.tEnd);
    expect(c.geom!.hMin).toBe(a.geom!.hMin); expect(c.geom!.hMax).toBe(a.geom!.hMax);
    expect(marks(c.calls).some(m => m.color === '#s4')).toBe(false);
    expect(marks(b.calls).some(m => m.color === '#s3')).toBe(false);
    expect(c.label).toBe(a.label);
    expect(a.label).toBe('Mean altitude history and projected decay of 3 spacecraft: ISS (ZARYA), ALPHA and BRAVO');
  });

  it('with nothing it can draw: a dash, no geometry, and a name that says none', () => {
    for (const lines of [[], [geo(2)], [{ ...geo(2), r: {} }]] as CmpSeries[][]) {
      const { geom, calls, label, labelled } = draw(lines);
      expect(geom).toBeNull(); expect(labelled).toBe(false);
      expect(texts(calls).map(t => t.args[0])).toEqual(['—']);
      expect(label).toBe('Mean altitude history and projected decay of 0 spacecraft');
    }
  });

  it('fits the frame to the lines in colour: a high flat grey line or a grey 6,000-day projection does not move it', () => {
    const iss = line('25544', 1, 'ISS (ZARYA)', 400, 1, 415, 410, 300), cube = line('60001', 2, 'CUBE', 300, 1, 480, 200, 200);
    const ao7 = line('07530', 0, 'AO-7', 2000, 1, 1450, 1450), slow = line('40020', 0, 'SLOW', 1000, 1, 700, 690, 6000);
    const only = draw([iss, cube]).geom!, f = frame([iss, cube])!;
    expect({ t0: only.t0, tEnd: only.tEnd, hMin: only.hMin, hMax: only.hMax }).toEqual(f);
    for (const greys of [[ao7], [slow], [ao7, slow]]) {
      const { geom, calls, label } = draw([iss, ...greys, cube]);
      expect({ t0: geom!.t0, tEnd: geom!.tEnd, hMin: geom!.hMin, hMax: geom!.hMax }).toEqual(f);
      expect(seriesLines(calls).filter(m => m.color === '#muted').length).toBeGreaterThanOrEqual(greys.length);  // still drawn, clipped
      expect(label).toMatch(new RegExp('of ' + (2 + greys.length) + ' spacecraft'));
    }
    /* with nothing in colour, the grey lines are the frame */
    const g = draw([ao7, slow]).geom!;
    expect({ t0: g.t0, tEnd: g.tEnd, hMin: g.hMin, hMax: g.hMax }).toEqual(frame([ao7, slow]));
  });

  it('puts the grid at round heights, about five of them, each labelled with its height', () => {
    const yLabels = (calls: Call[]) => texts(calls).filter(t => t.op === 'fillText' && t.align === 'right' && t.base === 'middle');
    const flat = draw([line('40003', 2, 'FLAT', 400, 1, 500, 500)]);                 // 496..504 km
    expect(yLabels(flat.calls).map(t => t.args[0])).toEqual(['496', '498', '500', '502', '504']);
    for (const lines of [three(), [line('25544', 1, 'ISS (ZARYA)', 400, 1, 415, 410, 300), line('60001', 2, 'CUBE', 300, 1, 480, 200, 200)]]) {
      const { geom, calls } = draw(lines);
      const v = yLabels(calls).map(t => Number(t.args[0]));
      const step = v[1]! - v[0]!;
      expect(String(step)).toMatch(/^[125]0*$/);
      expect(v.length).toBeGreaterThanOrEqual(3); expect(v.length).toBeLessThanOrEqual(8);
      v.forEach((h, i) => { expect(h % step).toBe(0); if (i) expect(h - v[i - 1]!).toBe(step); });
      expect(v[0]! - step).toBeLessThan(geom!.hMin); expect(v[v.length - 1]! + step).toBeGreaterThan(geom!.hMax);
      const grid = marks(calls).filter(m => m.color === '#rule').map(m => m.pts[0]![1]);
      expect(grid).toEqual(v.map(h => geom!.Y(h)));
      yLabels(calls).forEach((t, i) => expect(t.args[2]).toBe(grid[i]));
    }
  });

  it('writes four month labels, or three where four would run into each other, never closer than 8 px', () => {
    const months = (calls: Call[]) => texts(calls).filter(t => t.op === 'fillText' && t.args[2] === 320 - 26 + 16);
    const span = (t: Call): [number, number] => {
      const x = t.args[1] as number, w = (t.args[0] as string).length * 6.6;
      return t.align === 'left' ? [x, x + w] : t.align === 'right' ? [x - w, x] : [x - w / 2, x + w / 2];
    };
    for (const [W, n] of [[280, 3], [288, 3], [307, 3], [308, 4], [700, 4]] as const) {
      const { calls, geom } = draw(three(), W);
      const m = months(calls);
      expect(m).toHaveLength(n);
      expect(m.map(t => t.align)).toEqual(n === 3 ? ['left', 'center', 'right'] : ['left', 'center', 'center', 'right']);
      expect(m[0]!.args[1]).toBe(L); expect(m[n - 1]!.args[1]).toBeCloseTo(geom!.Wc - R, 9);
      for (let i = 1; i < n; i++) expect(span(m[i]!)[0] - span(m[i - 1]!)[1]).toBeGreaterThanOrEqual(8);
    }
  });

  it('names the spacecraft in its name when they are four or fewer, the selected first; past four, only the count', () => {
    const lines = [line('40009', 0, 'GREY ONE', 400, 3, 500, 450, 100), ...three().reverse()];
    expect(draw(lines).label).toBe('Mean altitude history and projected decay of 4 spacecraft: ISS (ZARYA), ALPHA, BRAVO and GREY ONE');
    expect(draw([...lines, line('40010', 0, 'GREY TWO', 400, 3, 480, 440, 100)]).label).toBe('Mean altitude history and projected decay of 5 spacecraft');
  });
});

describe('drawCompare: the lines', () => {
  it('draws the 120 km line in the muted grey, dashed, under every series, and its words over them on the panel\'s halo', () => {
    const { geom, calls } = draw(three());
    const y = geom!.Y(120);
    const floor = marks(calls).filter(m => m.op === 'stroke' && m.color !== col.rule && m.pts.length === 2 && m.pts[0]![1] === y && m.pts[1]![1] === y);
    expect(floor).toHaveLength(1);
    expect(floor[0]).toMatchObject({ color: '#muted', dash: [4, 3], width: 1.4, pts: [[L, y], [geom!.Wc - R, y]] });
    const words = texts(calls).find(t => t.args[0] === CMP_REENTRY && t.op === 'fillText')!;
    const halo = texts(calls).find(t => t.args[0] === CMP_REENTRY && t.op === 'strokeText')!;
    expect(words).toMatchObject({ fill: '#muted', base: 'bottom', align: 'left', args: [CMP_REENTRY, L + 5, y - 3] });
    expect(halo).toMatchObject({ stroke: '#panel', width: 3, base: 'bottom', align: 'left', args: [CMP_REENTRY, L + 5, y - 3] });
    const all = marks(calls);
    expect(all.indexOf(floor[0]!)).toBeLessThan(all.findIndex(m => SLOT_COLOURS.has(m.color as string)));
    /* the words after the lines, which are drawn inside the plot's clip (on a phone the projections that end near the left run
       through them), the halo first, and before the dots and rings */
    const lines = calls.findIndex(c => c.op === 'restore');
    expect(calls.slice(0, lines).filter(c => c.op === 'stroke' && SLOT_COLOURS.has(c.stroke as string))).toHaveLength(6);
    expect(calls.indexOf(halo)).toBeGreaterThan(lines);
    expect(calls.indexOf(halo)).toBeLessThan(calls.indexOf(words));
    expect(calls.indexOf(words)).toBeLessThan(calls.findIndex(c => c.op === 'arc'));
    /* with nothing coming down to it, there is none */
    const high = draw([line('40003', 2, 'HIGH', 400, 1, 900, 880)]);
    expect(high.geom!.hMin).toBeGreaterThan(120);
    expect(texts(high.calls).some(t => t.args[0] === CMP_REENTRY)).toBe(false);
    expect(marks(high.calls).some(m => m.dash.join() === '4,3')).toBe(false);
  });

  it('draws the grey context lines first: 1 px, faint, the history solid and the projection dashed, with no dot and no name', () => {
    const greyA = line('40011', 0, 'GREY A', 400, 3, 500, 450, 100), greyB = line('40012', 0, 'GREY B', 400, 6, 520, 470, 200);
    const { calls } = draw([three()[0]!, greyA, three()[1]!, greyB]);
    const L2 = seriesLines(calls);
    const grey = L2.filter(m => m.color === '#muted');
    expect(grey).toHaveLength(4);
    expect(L2.slice(0, 4)).toEqual(grey);                                 // before any coloured line
    for (const m of grey) { expect(m.width).toBe(1); expect(m.alpha).toBe(0.45); }
    expect(grey.map(m => m.dash)).toEqual([[], [3, 3], [], [3, 3]]);
    expect(grey[0]!.pts).toHaveLength(greyA.P.length);
    expect(marks(calls).filter(m => m.arcs.length && m.color === '#muted')).toHaveLength(0);
    expect(texts(calls).some(t => /GREY/.test(t.args[0] as string))).toBe(false);
  });

  it('draws the coloured lines by slot, the selected one (slot 1, the page\'s cyan) last and widest', () => {
    const [iss, a, b] = three();
    const grey = line('40011', 0, 'GREY A', 400, 3, 500, 450, 100);
    const { calls } = draw([b!, iss!, grey, a!]);
    const coloured = seriesLines(calls).filter(m => SLOT_COLOURS.has(m.color as string));
    expect(coloured.map(m => m.color)).toEqual(['#s2', '#s2', '#s3', '#s3', '#track', '#track']);
    expect(coloured.map(m => m.dash)).toEqual([[6, 3], [], [6, 3], [], [6, 3], []]);     // each: the projection, then the history
    expect(coloured.map(m => m.width)).toEqual([2, 2, 2, 2, 3, 3]);
    const widest = Math.max(...marks(calls).filter(m => m.op === 'stroke').map(m => m.width));
    expect(widest).toBe(3);
    expect(marks(calls).filter(m => m.op === 'stroke' && m.width === 3).every(m => m.color === '#track')).toBe(true);
    /* the dots: the selected one's last, each on a ring of the panel's colour */
    const dots = marks(calls).filter(m => m.op === 'fill' && m.arcs.length === 1 && m.arcs[0]![2] === 4);
    expect(dots.map(m => m.color)).toEqual(['#s2', '#s3', '#track']);
    const rings = marks(calls).filter(m => m.op === 'fill' && m.color === '#panel' && m.arcs[0]![2] === 6);
    expect(rings.length).toBeGreaterThanOrEqual(3);
  });

  it('puts a ring at the end of a projection that reaches the 120 km floor, none for one that does not', () => {
    const { geom, calls } = draw(three());
    const ends = marks(calls).filter(m => m.op === 'stroke' && m.arcs.length === 1 && m.arcs[0]![2] === 3);
    expect(ends.map(m => m.color).sort()).toEqual(['#s2', '#s3', '#track']);
    const iss = three()[0]!;
    expect(ends.find(m => m.color === '#track')!.arcs[0]![0]).toBeCloseTo(geom!.X(seriesEnd(iss)), 9);
    expect(ends.find(m => m.color === '#track')!.arcs[0]![1]).toBeCloseTo(geom!.Y(120), 9);
    const flat = draw([line('40003', 2, 'FLAT', 400, 1, 500, 480)]);
    expect(marks(flat.calls).filter(m => m.op === 'stroke' && m.arcs.length)).toHaveLength(0);
  });
});

describe('drawCompare: the names on the chart', () => {
  const named = (calls: Call[]) => texts(calls).filter(t => ['ISS (ZARYA)', 'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'].includes(t.args[0] as string));

  it('writes every coloured line\'s name at its last set, right-aligned, in ink2 over a 3 px halo of the panel\'s colour', () => {
    const { calls, geom, labelled } = draw(three(), 800);
    expect(labelled).toBe(true);
    const fills = named(calls).filter(t => t.op === 'fillText'), halos = named(calls).filter(t => t.op === 'strokeText');
    expect(fills.map(t => t.args[0])).toEqual(['ALPHA', 'BRAVO', 'ISS (ZARYA)']);
    expect(halos.map(t => t.args[0])).toEqual(['ALPHA', 'BRAVO', 'ISS (ZARYA)']);
    for (const t of fills) expect(t).toMatchObject({ fill: '#ink2', align: 'right', base: 'alphabetic' });
    for (const t of halos) expect(t).toMatchObject({ stroke: '#panel', width: 3 });
    const iss = three()[0]!, at = fills.find(t => t.args[0] === 'ISS (ZARYA)')!;
    expect(at.args[1]).toBeCloseTo(geom!.X(iss.r.tNow!) - 6, 9);
    expect(at.args[2]).toBeCloseTo(geom!.Y(iss.r.hNow!) - 6, 9);
    const idx = (t: Call) => calls.indexOf(t);
    fills.forEach((t, i) => expect(idx(halos[i]!)).toBeLessThan(idx(t)));
  });

  it('cuts a long name to 18 characters on the chart', () => {
    const lines = three();
    lines[1] = { ...lines[1]!, name: 'STARLINK-31234 [DTC]' };
    expect(texts(draw(lines, 800).calls).some(t => t.args[0] === 'STARLINK-31234 [D…')).toBe(true);
  });

  it('writes none at all with five coloured lines', () => {
    const five = [...three(), line('40004', 4, 'CHARLIE', 1000, 20, 400, 300, 200), line('40005', 5, 'DELTA', 1000, 30, 900, 800, 2000)];
    const { calls, labelled } = draw(five, 1200);
    expect(labelled).toBe(false);
    expect(named(calls)).toHaveLength(0);
    expect(draw(five.slice(0, 4), 1200).labelled).toBe(true);
  });

  it('writes none at all on a plot under 400 px wide', () => {
    const narrow = draw(three(), 475), wide = draw(three(), 476);
    expect(narrow.geom!.Wc - L - R).toBe(399);
    expect(narrow.labelled).toBe(false);
    expect(named(narrow.calls)).toHaveLength(0);
    expect(wide.labelled).toBe(true);
    expect(named(wide.calls).filter(t => t.op === 'fillText')).toHaveLength(3);
  });

  it('writes none at all when two would sit within 13 px, rather than move one', () => {
    const lines = [...three(), line('40006', 4, 'ECHO', 1000, 1, 465, 412, 300)];      // beside the ISS's last set
    const { calls, labelled } = draw(lines, 800);
    expect(labelled).toBe(false);
    expect(named(calls)).toHaveLength(0);
  });

  it('never draws text on the \'top\' baseline', () => {
    const scenes: CmpSeries[][] = [three(), [], [geo(2)], [line('40003', 2, 'HIGH', 400, 1, 900, 880)],
      [...three(), line('40011', 0, 'GREY A', 400, 3, 500, 450, 100)]];
    for (const lines of scenes) for (const W of [300, 476, 800, 1400]) {
      const { calls } = draw(lines, W);
      expect(texts(calls).filter(t => t.base === 'top')).toEqual([]);
      expect(texts(calls).length).toBeGreaterThan(0);
    }
  });
});

describe('the key and the readout', () => {
  it('keys the selected spacecraft first, the coloured by slot, "N others" for the grey, then the two line styles', () => {
    const [iss, a, b] = three();
    const greys = [line('40011', 0, 'GREY A', 400, 3, 500, 450, 100), line('40012', 0, 'GREY B', 400, 3, 500, 450, 100)];
    expect(compareKey([b!, greys[0]!, a!, iss!, greys[1]!, geo(4)], col)).toEqual([
      { color: '#track', text: 'ISS (ZARYA)' }, { color: '#s2', text: 'ALPHA' }, { color: '#s3', text: 'BRAVO' },
      { color: '#muted', text: '2 others', grey: true },
      { color: '#muted', text: 'observed' }, { color: '#muted', text: 'projected', dashed: true }
    ]);
    expect(compareKey([a!], col).map(k => k.text)).toEqual(['ALPHA', 'observed', 'projected']);
    expect(compareKey([geo(2)], col)).toEqual([]);
  });

  it('counts the grey lines as "N spacecraft" when none is in colour, not as others', () => {
    const greys = [line('40011', 0, 'GREY A', 400, 3, 500, 450, 100), line('40012', 0, 'GREY B', 400, 3, 500, 450, 100)];
    const thin: CmpSeries = { ...three()[0]!, r: {} };                  // the selected one, not estimated yet: not drawn
    for (const lines of [greys, [thin, ...greys], [geo(2), ...greys]]) {
      expect(compareKey(lines, col)).toEqual([
        { color: '#muted', text: '2 spacecraft', grey: true },
        { color: '#muted', text: 'observed' }, { color: '#muted', text: 'projected', dashed: true }
      ]);
    }
    expect(compareKey([greys[0]!], col)[0]!.text).toBe('1 spacecraft');
  });

  const iss = line('25544', 1, 'ISS (ZARYA)', 400, 1, 460, 410, 300);
  const young = line('67683', 2, 'KNACKSAT-2 WITH A LONG NAME', 200, 2, 520, 470, 150);
  const grey = line('40011', 0, 'GREY A', 400, 1, 900, 880);
  const lines = [grey, iss, young];
  let geom: ReturnType<typeof drawCompare>['geom'] = null;
  beforeAll(() => { geom = draw(lines).geom; });

  it('reads the coloured lines at the pointer\'s day, highest first, the value before the name, the grey lines left out', () => {
    const t = T - 100.5 * DAY_MS, tip = compareTipAt(geom!, lines, geom!.X(t), col)!;
    expect(tip.day).toBe('2026-07-09');
    expect(Math.abs(tip.t - t)).toBeLessThan(1000);
    expect(tip.rows.map(r => r.n)).toEqual(['67683', '25544']);
    expect(tip.rows[0]!.h).toBeGreaterThan(tip.rows[1]!.h);
    for (const r of tip.rows) expect(r.value).toBe(r.h.toFixed(1) + ' km');
    expect(tip.rows.map(r => [r.color, r.name, r.projected])).toEqual([['#s2', 'KNACKSAT-2 WITH A…', false], ['#track', 'ISS (ZARYA)', false]]);
  });

  it('flags a value read from a projection, and orders by height whichever it is', () => {
    const t = T - 1.5 * DAY_MS, tip = compareTipAt(geom!, lines, geom!.X(t), col)!;     // past KNACKSAT-2's last set, not the ISS's
    expect(tip.rows.map(r => [r.n, r.projected])).toEqual([['67683', true], ['25544', false]]);
    expect(tip.rows[0]!.h).toBeCloseTo(470 - 35 * 0.5 / 15, 9);                      // on the line, half a day into a 15-day step
    expect(tip.rows[1]!.h).toBeCloseTo(410 + 50 / 400 / 2, 9);                         // halfway between two daily sets
    const late = compareTipAt(geom!, lines, geom!.X(T + 200 * DAY_MS), col)!;          // only the ISS's projection runs this far
    expect(late.rows.map(r => [r.n, r.projected])).toEqual([['25544', true]]);
  });

  it('reads each value off the line drawn under the pointer, so the order is the order the lines are drawn in', () => {
    /* A decays 4 km in 200 days, B 1 km in its first day: just past their last sets A's line is drawn above B's, while the next
       4 km point of each projection would rank B first */
    const A: CmpSeries = { n: '40021', slot: 2, name: 'SLOW A', P: [{ t: T - DAY_MS, sma: 470.2 }, { t: T, sma: 470 }],
      r: { tNow: T, hNow: 470, track: [{ t: 0, h: 470 }, { t: 200, h: 466 }, { t: 380, h: 462 }] } };
    const Bs: CmpSeries = { n: '40022', slot: 3, name: 'FAST B', P: [{ t: T - DAY_MS, sma: 470.1 }, { t: T, sma: 469.98 }],
      r: { tNow: T, hNow: 469.98, track: [{ t: 0, h: 469.98 }, { t: 1, h: 469 }, { t: 2, h: 465 }] } };
    const { geom: g, calls } = draw([Bs, A]);
    const x = g!.X(T + DAY_MS / 2), tip = compareTipAt(g!, [Bs, A], x, col)!;
    expect(tip.rows.map(r => r.n)).toEqual(['40021', '40022']);
    expect(tip.rows[0]!.h).toBeCloseTo(469.99, 9);
    /* each row's height is where its drawn projection crosses the pointer's x */
    const yOn = (pts: [number, number][]) => {
      const i = pts.findIndex(p => p[0] >= x), [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    };
    for (const r of tip.rows) {
      const drawn = seriesLines(calls).find(m => m.color === r.color && m.dash.join() === '6,3')!;
      expect(g!.Y(r.h)).toBeCloseTo(yOn(drawn.pts), 6);
    }
  });

  it('reads nothing outside the plot', () => {
    expect(compareTipAt(geom!, lines, L - 1, col)).toBeNull();
    expect(compareTipAt(geom!, lines, geom!.Wc - R + 1, col)).toBeNull();
    expect(compareTipAt(geom!, lines, L, col)).not.toBeNull();
  });
});

describe('the colours', () => {
  it('keeps seven distinct colours a theme for slots 2..8', () => {
    for (const th of ['light', 'dark'] as const) {
      expect(CMP_PALETTE[th]).toHaveLength(7);
      expect(new Set(CMP_PALETTE[th]).size).toBe(7);
      for (const h of CMP_PALETTE[th]) expect(h).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('reads slot 1 from the page\'s --track, and takes the rest from the theme\'s palette', () => {
    const css: Record<string, string> = { '--ink2': ' #3C4D56', '--muted': '#536169', '--rule': '#CBD6DB', '--panel': '#FFFFFF', '--track': '#0086AD ' };
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n: string) => css[n] ?? '' }));
    try {
      const light = readCmpColors('light'), dark = readCmpColors('dark');
      expect(light).toEqual({ ink2: '#3C4D56', muted: '#536169', rule: '#CBD6DB', panel: '#FFFFFF', slots: ['#0086AD', ...CMP_PALETTE.light] });
      expect(dark.slots).toEqual(['#0086AD', ...CMP_PALETTE.dark]);
      expect([1, 2, 8].map(s => colorOf(light, s))).toEqual(['#0086AD', '#eb6834', '#e34948']);
      expect([0, 9, -1].map(s => colorOf(light, s))).toEqual(['#536169', '#536169', '#536169']);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('window', { devicePixelRatio: DPR });
    }
  });
});

/* ---- the view (L67): another quantity, another time range, a zoom ------------------------------------------------------------ */

function drawIn(lines: CmpSeries[], view: DrawView, W = 700) {
  const { c, calls } = canvas(W);
  const out = drawCompare(c, lines, col, view);
  return { ...out, c, calls };
}
/** the line with a mean eccentricity on every set, from `from` to `to` (null: none, as a set read from the cache; NaN: none, as a
 *  fresh read or the API's answer) */
const withEcc = (s: CmpSeries, from: number | null, to: number | null = from): CmpSeries => ({
  ...s, P: s.P.map((r, i, a) => ({ ...r, ecc: from === null || to === null ? null : from + (to - from) * (i / Math.max(1, a.length - 1)) }))
});
/** each path: the calls between its beginPath and the stroke or fill that ends it, and that call (with its state) */
function paths(calls: Call[]): { ops: string[]; end: Call }[] {
  const out: { ops: string[]; end: Call }[] = [];
  let ops: string[] = [];
  for (const c of calls) {
    if (c.op === 'beginPath') ops = [];
    else if (c.op === 'stroke' || c.op === 'fill') out.push({ ops, end: c });
    else ops.push(c.op);
  }
  return out;
}
const xLabels = (calls: Call[]) => texts(calls).filter(t => t.op === 'fillText' && t.args[2] === 320 - 26 + 16);
const yLabels = (calls: Call[]) => texts(calls).filter(t => t.op === 'fillText' && t.align === 'right' && t.base === 'middle');
const span = (t: Call): [number, number] => {
  const x = t.args[1] as number, w = (t.args[0] as string).length * 6.6;
  return t.align === 'left' ? [x, x + w] : t.align === 'right' ? [x - w, x] : [x - w / 2, x + w / 2];
};
const dotsOf = (calls: Call[]) => marks(calls).filter(m => m.op === 'fill' && m.arcs.length === 1 && m.arcs[0]![2] === 4);
const ringsOf = (calls: Call[]) => marks(calls).filter(m => m.op === 'stroke' && m.arcs.length === 1 && m.arcs[0]![2] === 3);
const floorLine = (calls: Call[]) => marks(calls).filter(m => m.op === 'stroke' && m.dash.join() === '4,3');
const reentry = (calls: Call[]) => texts(calls).filter(t => t.args[0] === CMP_REENTRY);

describe('drawCompare: the view (L67)', () => {
  it('draws the default view given in full exactly as with none', () => {
    const base = draw(three()).calls;
    expect(drawIn(three(), {}).calls).toEqual(base);
    expect(drawIn(three(), { p: 'alt', r: 'auto', win: null }).calls).toEqual(base);
    expect(drawIn(three(), {}).info).toMatchObject({ p: 'alt', zoomed: false, why: null });
  });

  it('30 d: the window is the 30 days up to the newest set, a history leaves through the right edge, no dot or ring outside it, and then no names', () => {
    const lines = [...three(), line('40007', 4, 'OLD', 400, 40, 450, 430)];         // its last set 40 days before T
    const { geom, calls, labelled, info } = drawIn(lines, { r: '30d' }, 800);
    const B = baseWindow(lines, '30d')!;
    expect([geom!.t0, geom!.tEnd]).toEqual([B.t0, B.t1]);
    expect([B.t0, B.t1]).toEqual([T - 31 * DAY_MS, T - DAY_MS]);
    expect(info).toEqual({ p: 'alt', t0: B.t0, t1: B.t1, base: { t0: B.t0, t1: B.t1 }, zoomed: false, tLast: T - DAY_MS, why: null });
    const clip = calls.findIndex(c => c.op === 'clip');
    expect(calls[clip - 1]).toMatchObject({ op: 'rect', args: [L, 14, geom!.Wc - L - R, 320 - 14 - 26] });
    for (const m of seriesLines(calls).filter(m => m.dash.length === 0)) expect(m.pts.filter(p => p[0] > geom!.Wc - R).length).toBeLessThanOrEqual(1);
    for (const a of calls.filter(c => c.op === 'arc')) {
      expect(a.args[0]).toBeGreaterThanOrEqual(L); expect(a.args[0]).toBeLessThanOrEqual(geom!.Wc - R);
    }
    expect(dotsOf(calls).map(m => m.color)).toEqual(['#s2', '#s3', '#track']);       // none for OLD
    expect(ringsOf(calls)).toHaveLength(0);                                           // every ring is past the window
    expect(labelled).toBe(false);
    expect(drawIn(three(), { r: '30d' }, 800).labelled).toBe(true);                  // the same three alone: named
    /* a zoom inside it: the selected line's history comes in from the last set before the window and leaves at the first after it */
    const win = { t0: T - 21 * DAY_MS, t1: T - 11 * DAY_MS };
    const z = drawIn(three(), { r: '30d', win }, 800);
    const hist = seriesLines(z.calls).find(m => m.color === '#track' && m.dash.length === 0)!;
    expect(hist.pts).toHaveLength(13);                                               // T-22 d .. T-10 d, daily
    expect(hist.pts.filter(p => p[0] > z.geom!.Wc - R)).toHaveLength(1);
    expect(hist.pts.filter(p => p[0] < L)).toHaveLength(1);
    expect(hist.pts[12]![0]).toBeCloseTo(z.geom!.X(T - 10 * DAY_MS), 9);
  });

  it('writes no names when a dot falls outside the window, even one whose name alone would still fit on the plot', () => {
    const two = [line('40051', 2, 'ALPHA', 400, 10, 520, 500), line('40052', 3, 'BRAVO', 400, 20, 470, 450)];
    const edge = drawIn(two, { win: { t0: T - 40 * DAY_MS, t1: T - 10 * DAY_MS } }, 800);
    expect(edge.info!.zoomed).toBe(true);
    expect(dotsOf(edge.calls)).toHaveLength(2);                                       // ALPHA's on the right edge
    expect(edge.labelled).toBe(true);
    /* a tenth of a day less: ALPHA's dot is 2.4 px past the edge and not drawn, so neither name is written */
    const past = drawIn(two, { win: { t0: T - 40 * DAY_MS, t1: T - 10.1 * DAY_MS } }, 800);
    expect(past.geom!.X(T - 10 * DAY_MS) - (past.geom!.Wc - R)).toBeCloseTo(724 * 0.1 / 29.9, 9);
    expect(dotsOf(past.calls).map(m => m.color)).toEqual(['#s3']);
    expect(past.labelled).toBe(false);
    expect(texts(past.calls).some(t => t.args[0] === 'ALPHA' || t.args[0] === 'BRAVO')).toBe(false);
  });

  it('All runs from the first set held to the latest end of a projection', () => {
    const lines = three(), { geom } = drawIn(lines, { r: 'all' });
    expect(geom!.t0).toBe(Math.min(...lines.map(s => s.P[0]!.t)));
    expect(geom!.tEnd).toBe(Math.max(...lines.map(seriesEnd)));
  });

  it('writes days where months would repeat: 30 d at each width, a 2-day zoom, and Auto on a 60-day record', () => {
    for (const [W, n] of [[700, 4], [390, 3], [280, 2]] as const) {
      const { calls, geom } = drawIn(three(), { r: '30d' }, W);
      const d = xLabels(calls);
      expect(d).toHaveLength(n);
      for (const t of d) { expect(t.args[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(t.base).toBe('alphabetic'); }
      expect(new Set(d.map(t => t.args[0])).size).toBe(n);
      expect(d.map(t => t.align)).toEqual(n === 2 ? ['left', 'right'] : n === 3 ? ['left', 'center', 'right'] : ['left', 'center', 'center', 'right']);
      expect(d[0]!.args[1]).toBe(L); expect(d[n - 1]!.args[1]).toBeCloseTo(geom!.Wc - R, 9);
      for (let i = 1; i < n; i++) expect(span(d[i]!)[0] - span(d[i - 1]!)[1]).toBeGreaterThanOrEqual(8);
    }
    const B = baseWindow(three(), '30d')!;
    for (const W of [280, 700, 1100]) {
      const z = drawIn(three(), { r: '30d', win: { t0: B.t1 - 2 * DAY_MS, t1: B.t1 } }, W);
      expect(z.info!.zoomed).toBe(true);
      const d = xLabels(z.calls).map(t => t.args[0] as string);
      expect(d.length).toBeLessThanOrEqual(3); expect(d.length).toBeGreaterThanOrEqual(2);
      expect(new Set(d).size).toBe(d.length);
      for (const s of d) expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    /* the default view on a 60-day record with no forecast: four distinct days, where four month labels would have repeated one */
    const short = line('40041', 2, 'SHORT', 60, 1, 400, 380);
    const d = xLabels(draw([short]).calls).map(t => t.args[0] as string);
    expect(d).toEqual(['2026-08-18', '2026-09-07', '2026-09-27', '2026-10-17']);
    expect(new Set(d.map(s => s.slice(0, 7))).size).toBe(3);
    /* a year still has months, distinct */
    const y = xLabels(drawIn(three(), { r: '1y' }).calls).map(t => t.args[0] as string);
    expect(y).toHaveLength(4);
    for (const s of y) expect(s).toMatch(/^\d{4}-\d{2}$/);
    expect(new Set(y).size).toBe(4);
  });

  it('mean perigee altitude: history only (no dashes, no ring, no "projected"), km readouts highest first, the 120 km line when a perigee comes down to it', () => {
    const lines = three().map(s => withEcc(s, 0.001));
    const { geom, calls, info, label } = drawIn(lines, { p: 'hp' });
    expect(geom!.p).toBe('hp');
    expect(info).toMatchObject({ p: 'hp', why: null, zoomed: false });
    expect(label).toBe('Mean perigee altitude history of 3 spacecraft: ISS (ZARYA), ALPHA and BRAVO');
    expect(marks(calls).some(m => m.op === 'stroke' && m.dash.join() === '6,3')).toBe(false);
    expect(ringsOf(calls)).toHaveLength(0);
    expect(dotsOf(calls).map(m => m.color)).toEqual(['#s2', '#s3', '#track']);
    expect(compareKey(lines, col, 'hp')).toEqual([
      { color: '#track', text: 'ISS (ZARYA)' }, { color: '#s2', text: 'ALPHA' }, { color: '#s3', text: 'BRAVO' }, { color: '#muted', text: 'observed' }
    ]);
    const tip = compareTipAt(geom!, lines, geom!.X(T - 20 * DAY_MS), col)!;
    expect(tip.rows.map(r => r.n)).toEqual(['40001', '40002', '25544']);
    for (const r of tip.rows) { expect(r.value).toMatch(/^\d+\.\d km$/); expect(r.projected).toBe(false); }
    const iss = tip.rows[2]!, sma = 460 - 50 * ((1000 - 19) / 1000);                 // the ISS's set 19 days before its last
    expect(iss.h).toBeCloseTo((RE + sma) * (1 - 0.001) - RE, 6);
    const hist = seriesLines(calls).find(m => m.color === '#track')!;                  // drawn in perigee altitude, ending at its dot
    expect(hist.pts[hist.pts.length - 1]![1]).toBeCloseTo(geom!.Y((RE + 410) * (1 - 0.001) - RE), 9);
    expect(dotsOf(calls).find(m => m.color === '#track')!.arcs[0]![1]).toBeCloseTo(geom!.Y((RE + 410) * (1 - 0.001) - RE), 9);
    expect(compareTipAt(geom!, lines, geom!.X(T + 30 * DAY_MS), col)!.rows).toEqual([]);   // no forecast in it
    expect(floorLine(calls)).toHaveLength(0);
    /* a mean altitude that stays above 130 km with a perigee that goes below 120 */
    const low = withEcc(line('40042', 2, 'LOW', 100, 1, 200, 130), 0.002);
    expect(floorLine(draw([low]).calls)).toHaveLength(0);
    const h = drawIn([low], { p: 'hp' });
    expect(h.geom!.hMin).toBeLessThanOrEqual(120);
    expect(floorLine(h.calls)).toHaveLength(1);
    expect(floorLine(h.calls)[0]!.pts.map(p => p[1])).toEqual([h.geom!.Y(120), h.geom!.Y(120)]);
    expect(reentry(h.calls).length).toBe(2);
  });

  it('eccentricity: a left margin wide enough for "0.0012" (the plot starts there), no 120 km line, five-place readouts', () => {
    const lines = three().map(s => withEcc(s, 0.0007, 0.0013));
    const { geom, calls } = drawIn(lines, { p: 'ecc' });
    const yl = yLabels(calls).map(t => t.args[0] as string);
    expect(yl).toContain('0.0012');
    for (const s of yl) expect(s).toMatch(/^0\.\d{4}$/);
    expect(geom!.L).toBeGreaterThanOrEqual(53);
    expect(geom!.L).toBe(Math.ceil(Math.max(...yl.map(s => s.length * 6.6))) + 13);
    for (const t of yLabels(calls)) expect(t.args[1]).toBe(geom!.L - 7);
    const clip = calls.findIndex(c => c.op === 'clip');
    expect(calls[clip - 1]).toMatchObject({ op: 'rect', args: [geom!.L, 14, geom!.Wc - geom!.L - R, 320 - 14 - 26] });
    expect(marks(calls).filter(m => m.color === '#rule').every(m => m.pts[0]![0] === geom!.L)).toBe(true);
    expect(xLabels(calls)[0]!.args[1]).toBe(geom!.L);
    expect(floorLine(calls)).toHaveLength(0);
    expect(reentry(calls)).toHaveLength(0);
    /* the histories are drawn in eccentricity: every point inside the plot's width is inside its height */
    const hist = seriesLines(calls);
    expect(hist).toHaveLength(3);
    for (const m of hist) for (const [x, y] of m.pts) if (x >= geom!.L) { expect(y).toBeGreaterThanOrEqual(14); expect(y).toBeLessThanOrEqual(320 - 26); }
    const tip = compareTipAt(geom!, lines, geom!.X(T - 20 * DAY_MS), col)!;
    expect(tip.rows).toHaveLength(3);
    for (const r of tip.rows) expect(r.value).toMatch(/^\d\.\d{5}$/);
    expect(compareTipAt(geom!, lines, geom!.L - 1, col)).toBeNull();
  });

  it('the decay rate: below zero, a 60-day hole breaks the line (one stroke, two pieces), no 120 km line, signed readouts', () => {
    const full = line('40043', 1, 'HOLED', 200, 1, 400, 350);                         // -0.25 km/day
    const holed: CmpSeries = { ...full, P: full.P.filter((_, i) => i < 80 || i >= 140) };
    const raised = line('40044', 2, 'RAISED', 200, 1, 350, 400);                      // +0.25 km/day
    const { geom, calls, info } = drawIn([holed, raised], { p: 'rate' });
    expect(info!.why).toBeNull();
    expect(geom!.hMin).toBeLessThan(0);
    const mine = paths(calls).filter(q => q.end.op === 'stroke' && q.end.stroke === '#track');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.ops.filter(o => o === 'moveTo')).toHaveLength(2);
    expect(mine[0]!.ops.filter(o => o === 'lineTo').length).toBeGreaterThan(100);
    expect(paths(calls).filter(q => q.end.op === 'stroke' && q.end.stroke === '#s2')[0]!.ops.filter(o => o === 'moveTo')).toHaveLength(1);
    expect(floorLine(calls)).toHaveLength(0);
    expect(reentry(calls)).toHaveLength(0);
    expect(marks(calls).some(m => m.op === 'stroke' && m.dash.join() === '6,3')).toBe(false);
    const tip = compareTipAt(geom!, [holed, raised], geom!.X(T - 160 * DAY_MS), col)!;
    expect(tip.rows.map(r => r.value)).toEqual(['+0.250 km/day', '-0.250 km/day']);
    for (const r of tip.rows) expect(r.value).toMatch(/^[-+]\d+\.\d{3} km\/day$/);
    /* inside the hole, and in the days after it before a window holds eight sets, the holed line has no value */
    for (const ago of [100, 57]) expect(compareTipAt(geom!, [holed, raised], geom!.X(T - ago * DAY_MS), col)!.rows.map(r => r.n)).toEqual(['40044']);
  });

  it('the orbital period and the mean motion carry the forecast: dashed projections, a ring at the floor in the quantity, no 120 km line, projected readouts', () => {
    const cases = [['per', / min$/, /^\d+\.\d{2} min$/, periodMin], ['mm', / rev\/day$/, /^\d+\.\d{4} rev\/day$/, (h: number) => 1440 / periodMin(h)]] as const;
    for (const [p, unit, form, conv] of cases) {
      const lines = three();
      const { geom, calls, label } = drawIn(lines, { p });
      expect(label).toMatch(/history and projection of 3 spacecraft/);
      expect(seriesLines(calls).filter(m => m.dash.join() === '6,3').map(m => m.color)).toEqual(['#s2', '#s3', '#track']);
      const iss = lines[0]!, A = iss.r.track!, e = A[A.length - 1]!;
      const ring = ringsOf(calls).find(m => m.color === '#track')!;
      expect(ring.arcs[0]![0]).toBeCloseTo(geom!.X(seriesEnd(iss)), 9);
      expect(ring.arcs[0]![1]).toBeCloseTo(geom!.Y(conv(e.h)), 9);
      const dot = dotsOf(calls).find(m => m.color === '#track')!;
      expect(dot.arcs[0]![1]).toBeCloseTo(geom!.Y(conv(iss.r.hNow!)), 9);
      /* both of its strokes are in the quantity: the projection from its last set to the floor, the history up to that set */
      const [proj, hist] = seriesLines(calls).filter(m => m.color === '#track');
      expect(proj!.dash).toEqual([6, 3]);
      expect(proj!.pts.map(q => q[1])).toEqual(A.map(q => geom!.Y(conv(q.h))));
      expect(hist!.pts[hist!.pts.length - 1]![1]).toBeCloseTo(geom!.Y(conv(iss.P[iss.P.length - 1]!.sma)), 9);
      expect(floorLine(calls)).toHaveLength(0);
      expect(reentry(calls)).toHaveLength(0);
      expect(compareKey(lines, col, p).map(k => k.text)).toEqual(['ISS (ZARYA)', 'ALPHA', 'BRAVO', 'observed', 'projected']);
      const tip = compareTipAt(geom!, lines, geom!.X(T + 30 * DAY_MS), col)!;
      expect(tip.rows).toHaveLength(3);
      for (const r of tip.rows) { expect(r.projected).toBe(true); expect(r.value).toMatch(unit); expect(r.value).toMatch(form); }
    }
  });

  it('zooms to a window inside the range\'s, ignores one that is not, and says when the window holds nothing', () => {
    const lines = three(), B = baseWindow(lines, 'auto')!;
    const win = { t0: T - 200 * DAY_MS, t1: T - 100 * DAY_MS };
    const z = drawIn(lines, { win });
    expect([z.geom!.t0, z.geom!.tEnd]).toEqual([win.t0, win.t1]);
    expect(z.info).toMatchObject({ p: 'alt', zoomed: true, t0: win.t0, t1: win.t1, base: { t0: B.t0, t1: B.t1 }, why: null });
    expect(z.calls.filter(c => c.op === 'arc')).toHaveLength(0);                      // every dot and ring is after it
    expect(z.labelled).toBe(false);
    /* a window reaching outside the range's, or under a day: the range's own frame, the default call for call */
    for (const w of [{ t0: B.t0 - DAY_MS, t1: B.t0 + 10 * DAY_MS }, { t0: T - 100 * DAY_MS, t1: T - 100 * DAY_MS + DAY_MS - 1 }]) {
      const out = drawIn(lines, { win: w });
      expect(out.info!.zoomed).toBe(false);
      expect([out.geom!.t0, out.geom!.tEnd]).toEqual([B.t0, B.t1]);
      expect(out.calls).toEqual(draw(lines).calls);
    }
    /* in the future, under a quantity with no forecast: nothing falls in it */
    const e = three().map(s => withEcc(s, 0.001));
    const f = drawIn(e, { p: 'hp', win: { t0: T + 100 * DAY_MS, t1: T + 200 * DAY_MS } });
    expect(f.geom).toBeNull(); expect(f.labelled).toBe(false);
    expect(f.info).toMatchObject({ p: 'hp', why: 'range', zoomed: true, t0: T + 100 * DAY_MS, t1: T + 200 * DAY_MS });
    expect(texts(f.calls).map(t => t.args[0])).toEqual(['—']);
  });

  it('a line with no value of the quantity is not drawn, counted, keyed or read; with none at all, a dash that says why', () => {
    const [iss, a, b] = three();
    const mixed = [withEcc(iss!, 0.001), withEcc(a!, null), withEcc(b!, NaN)];
    const m = drawIn(mixed, { p: 'hp' });
    expect(m.label).toBe('Mean perigee altitude history of 1 spacecraft: ISS (ZARYA)');
    expect(marks(m.calls).some(k => k.color === '#s2' || k.color === '#s3')).toBe(false);
    expect(compareKey(mixed, col, 'hp').map(k => k.text)).toEqual(['ISS (ZARYA)', 'observed']);
    expect(compareTipAt(m.geom!, mixed, m.geom!.X(T - 20 * DAY_MS), col)!.rows.map(r => r.n)).toEqual(['25544']);
    /* every eccentricity missing, as the cache (null), a fresh read (NaN) or a fixture (absent) has it */
    for (const lines of [three().map(s => withEcc(s, null)), three().map(s => withEcc(s, NaN)), three()]) {
      const r = drawIn(lines, { p: 'hp' });
      expect(r.geom).toBeNull(); expect(r.labelled).toBe(false);
      expect(r.info).toMatchObject({ p: 'hp', why: 'param', zoomed: false });
      expect(texts(r.calls).map(t => t.args[0])).toEqual(['—']);
      expect(r.label).toBe('Mean perigee altitude history of 0 spacecraft');
      expect(compareKey(lines, col, 'hp')).toEqual([]);
    }
    /* no coloured line carries it but grey ones do: the window is still the coloured lines', the heights are the grey ones' */
    const greys = [withEcc(line('40011', 0, 'GREY A', 400, 3, 500, 450, 100), 0.001), withEcc(line('40012', 0, 'GREY B', 400, 6, 520, 470, 200), 0.001)];
    const g = drawIn([...three(), ...greys], { p: 'hp' });
    expect(g.info!.why).toBeNull();
    expect([g.geom!.t0, g.geom!.tEnd]).toEqual([draw(three()).geom!.t0, draw(three()).geom!.tEnd]);
    expect(g.geom!.hMin).toBeGreaterThan(400); expect(g.geom!.hMax).toBeLessThan(530);
    expect(g.label).toBe('Mean perigee altitude history of 2 spacecraft: GREY A and GREY B');
    expect(seriesLines(g.calls).map(k => k.color)).toEqual(['#muted', '#muted']);
    expect(compareKey([...three(), ...greys], col, 'hp')).toEqual([{ color: '#muted', text: '2 spacecraft', grey: true }, { color: '#muted', text: 'observed' }]);
    /* nothing drawable at all: no view to speak of */
    expect(drawIn([geo(2)], { p: 'hp' }).info).toBeNull();
    expect(drawIn([], { r: '30d' }).info).toBeNull();
  });

  it('never draws text on the \'top\' baseline in a view, and only the selected line is 3 px wide', () => {
    const e = three().map(s => withEcc(s, 0.0007, 0.0013));
    const views: DrawView[] = [{ p: 'hp' }, { p: 'ecc' }, { p: 'rate' }, { r: '30d' }, { win: { t0: T - 200 * DAY_MS, t1: T - 100 * DAY_MS } }];
    for (const v of views) for (const W of [280, 390, 700, 1100]) {
      const { calls } = drawIn(e, v, W);
      expect(texts(calls).filter(t => t.base === 'top')).toEqual([]);
      expect(texts(calls).length).toBeGreaterThan(0);
      const strokes = marks(calls).filter(m => m.op === 'stroke');
      expect(Math.max(...strokes.map(m => m.width))).toBe(3);
      expect(strokes.filter(m => m.width === 3).every(m => m.color === '#track')).toBe(true);
    }
  });

  it('reads the quantity its geometry was drawn in', () => {
    const lines = three(), a = drawIn(lines, {}).geom!, q = drawIn(lines, { p: 'per' }).geom!;
    expect([a.p, q.p]).toEqual(['alt', 'per']);
    expect([q.t0, q.tEnd]).toEqual([a.t0, a.tEnd]);                                   // the window does not depend on the quantity
    const t = T - 100 * DAY_MS, ta = compareTipAt(a, lines, a.X(t), col)!, tq = compareTipAt(q, lines, q.X(t), col)!;
    for (const r of ta.rows) expect(r.value).toMatch(/^\d+\.\d km$/);
    for (const r of tq.rows) expect(r.value).toMatch(/^\d+\.\d{2} min$/);
    expect(tq.rows.map(r => r.n)).toEqual(ta.rows.map(r => r.n));                     // the period rises with the altitude
    tq.rows.forEach((r, i) => expect(r.h).toBeCloseTo(periodMin(ta.rows[i]!.h), 6));
  });
});
