import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CMP_PALETTE, colorOf, compareKey, compareTipAt, drawCompare, readCmpColors, type CmpColors, type CmpSeries
} from '../../src/components/report/draw-compare';
import { DAY_MS, frame, seriesEnd } from '../../src/lib/decay/compare';
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
