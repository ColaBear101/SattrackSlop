import { describe, expect, it } from 'vitest';
import {
  addItem, COMPARE_MAX, DAY_MS, DRAW_MAX_KM, drawable, fetchPlan, frame, HIGHLIGHT_MAX, labelPlan, lightItem, lowestFree, notDrawn, readCompare,
  removeItem, rowOrder, seriesEnd, shortName, tipOrder, valueAt, writeCompare, type CompareItem, type SeriesShape,
  baseWindow, eccOf, frameView, lastOf, MEASURE, MU, niceStep, PARAMS, periodMin, points, projected, projects, RANGES, rateSeries, RE, ringOf,
  stepDecimals, valueIn, VIEW_DEFAULT, angleOf, hasPlane, RAAN_GAP_DAYS, raanSeries, wrap180
} from '../../src/lib/decay/compare';
import { Lifetime } from '../../src/lib/planner/lifetime';

/* The decay comparison's model (CHANGES-FROM-LEGACY.md, L66): the stored list read back whatever is in it, the seven colours and how
   they are handed out (the lowest free one, and a colour follows its spacecraft), what can be drawn, the frame the chart is fitted to
   (to the decay, not to every record), the readout's values, and the names written on the chart, all or none. */

const T = Date.UTC(2026, 9, 18);
const nums = (k: number, from = 40000): string[] => Array.from({ length: k }, (_, i) => String(from + i));
const list = (...xs: [string, number?][]): CompareItem[] => xs.map(([n, h]) => (h ? { n, h } : { n }));

describe('the stored list, read back', () => {
  it('takes anything that is not a record as an empty, shut list', () => {
    for (const raw of [null, '', '{not json', '[]', '"25544"', '7', 'null', '{"l":"25544"}']) expect(readCompare(raw)).toEqual({ open: false, items: [] });
  });
  it('reads the open flag and the rows, slots and all', () => {
    expect(readCompare('{"o":1,"l":[{"n":"25544","h":2},{"n":"07530"}]}')).toEqual({ open: true, items: list(['25544', 2], ['07530']) });
    expect(readCompare('{"o":0,"l":[{"n":"25544"}]}').open).toBe(false);
    expect(readCompare('{"o":true,"l":[]}').open).toBe(false);       // only 1 is open
  });
  it('keeps catalogue numbers only, written as the catalogue writes them, each once', () => {
    const r = readCompare(JSON.stringify({ o: 1, l: [{ n: '7530' }, { n: '07530' }, { n: 'O0001' }, { n: '123456' }, { n: 25544 }, {}, null, 'x', { n: '25544' }] }));
    expect(r.items).toEqual(list(['07530'], ['25544']));
  });
  it('keeps no more than 50', () => {
    const r = readCompare(JSON.stringify({ o: 1, l: nums(60).map(n => ({ n })) }));
    expect(r.items).toHaveLength(COMPARE_MAX);
    expect(r.items.at(-1)!.n).toBe('40049');
  });
  it('drops a slot that is not 2 to 8, or is taken by a row above (the row stays, not in colour)', () => {
    const r = readCompare(JSON.stringify({ o: 1, l: [{ n: '1', h: 1 }, { n: '2', h: 9 }, { n: '3', h: 2.5 }, { n: '4', h: '3' }, { n: '5', h: 3 }, { n: '6', h: 3 }, { n: '7', h: 8 }] }));
    expect(r.items).toEqual(list(['00001'], ['00002'], ['00003'], ['00004'], ['00005', 3], ['00006'], ['00007', 8]));
  });
  it('is written back in the same shape', () => {
    const items = list(['25544', 2], ['07530']);
    expect(writeCompare(true, items)).toBe('{"o":1,"l":[{"n":"25544","h":2},{"n":"07530"}]}');
    expect(readCompare(writeCompare(false, items))).toEqual({ open: false, items });
  });
});

describe('the seven colours', () => {
  it('a highlight takes the lowest free slot, and with seven taken there is none', () => {
    expect(lowestFree([])).toBe(2);
    expect(lowestFree(list(['a', 2], ['b', 4]))).toBe(3);
    expect(lowestFree(list(...nums(HIGHLIGHT_MAX).map((n, i): [string, number] => [n, i + 2])))).toBeNull();
  });
  it('adding lists a spacecraft once, in colour while one is free, and refuses past 50', () => {
    let items: CompareItem[] = [];
    for (const n of nums(9)) items = addItem(items, n, true)!;
    expect(items.map(i => i.h)).toEqual([2, 3, 4, 5, 6, 7, 8, undefined, undefined]);
    expect(addItem(items, '40000', true)).toBeNull();
    expect(addItem(items, 'O0001', true)).toBeNull();
    expect(addItem(list(['07530']), '7530', true)).toBeNull();      // the same number, written another way
    expect(addItem([], '7530', false)).toEqual(list(['07530']));
    expect(addItem(nums(50).map(n => ({ n })), '25544', true)).toBeNull();
  });
  it('a colour follows its spacecraft: a freed one goes to the next highlight, and nobody else is repainted', () => {
    let items: CompareItem[] = [];
    for (const n of nums(8)) items = addItem(items, n, true)!;      // 40000..40006 in 2..8, 40007 in none
    const before = new Map(items.map(i => [i.n, i.h]));
    expect(lightItem(items, '40007', true)).toBeNull();               // seven taken
    items = removeItem(items, '40002');                                // its 4 is free
    items = lightItem(items, '40007', true) as CompareItem[];
    expect(items.find(i => i.n === '40007')!.h).toBe(4);
    for (const i of items) if (i.n !== '40007') expect(i.h).toBe(before.get(i.n));
    items = lightItem(items, '40005', false) as CompareItem[];        // turned off: 7 free, the rest as they were
    expect(items.find(i => i.n === '40005')!.h).toBeUndefined();
    expect(lowestFree(items)).toBe(7);
    expect(lightItem(items, '40005', false)).toBe(items);              // already off: the same list
    expect(lightItem(items, '99999', true)).toBeNull();                // not listed
  });
  it('the list on the page: the highlighted by colour, then the rest as added, without the one that is now selected', () => {
    const items = list(['a'], ['b', 5], ['c'], ['d', 2], ['e', 3]);
    expect(rowOrder(items, null)).toEqual(['d', 'e', 'b', 'a', 'c']);
    expect(rowOrder(items, 'e')).toEqual(['d', 'b', 'a', 'c']);
  });
  it('a press of Fetch asks for seven at most, and says whether more will wait', () => {
    expect(fetchPlan(12)).toEqual({ k: 7, more: true });
    expect(fetchPlan(7)).toEqual({ k: 7, more: false });
    expect(fetchPlan(3)).toEqual({ k: 3, more: false });
    expect(fetchPlan(0)).toEqual({ k: 0, more: false });
  });
});

/* a record of daily sets from `from` km to `to` km ending `endAgo` days before T, and a projection `proj` days long down to 120 km */
function series(days: number, endAgo: number, from: number, to: number, proj = 0): SeriesShape {
  const tNow = T - endAgo * DAY_MS;
  const P = Array.from({ length: days + 1 }, (_, i) => ({ t: tNow - (days - i) * DAY_MS, sma: from - (from - to) * (i / days) }));
  const track = proj ? Array.from({ length: 11 }, (_, i) => ({ t: proj * i / 10, h: to - (to - 120) * (i / 10) })) : null;
  return { P, r: { tNow, hNow: to, track } };
}
const X = (f: { t0: number; tEnd: number }, t: number) => (t - f.t0) / (f.tEnd - f.t0);

describe('what is drawn, and the frame', () => {
  it('draws a forecast with a last altitude up to 2,000 km; not too little history, and not a geostationary one', () => {
    expect(notDrawn({ hNow: 410, tNow: T })).toBeNull();
    expect(drawable({ hNow: DRAW_MAX_KM, tNow: T })).toBe(true);
    expect(notDrawn({ hNow: 35786, tNow: T })).toBe('high');
    expect(notDrawn({ tNow: T })).toBe('thin');
    expect(notDrawn(null)).toBe('thin');
  });
  it('a 28-year record beside a 200-day one: the short one has at least a quarter of the plot', () => {
    const iss = series(28 * 365, 1, 460, 410, 300), young = series(200, 2, 520, 470, 150);
    const f = frame([iss, young])!;
    const tA = Math.min(iss.r.tNow!, young.r.tNow!), tEnd = Math.max(seriesEnd(iss), seriesEnd(young));
    expect(f.tEnd).toBe(tEnd);
    expect(f.t0).toBe(tA - Math.max(365 * DAY_MS, tEnd - tA));
    const share = X(f, seriesEnd(young)) - X(f, Math.max(f.t0, young.P[0]!.t));
    expect(share).toBeGreaterThanOrEqual(0.25);
    /* the union of the records would have left it about 3 % */
    const union = { t0: iss.P[0]!.t, tEnd };
    expect(X(union, seriesEnd(young)) - X(union, young.P[0]!.t)).toBeLessThan(0.04);
  });
  it('shows a past as long as the future it shows, when that is more than a year', () => {
    const slow = series(2000, 0, 600, 580, 1500), f = frame([slow])!;
    expect(f.t0).toBe(slow.r.tNow! - 1500 * DAY_MS);
    expect(f.tEnd).toBe(seriesEnd(slow));
    expect(frame([series(100, 0, 400, 390)])!.t0).toBe(T - 100 * DAY_MS);     // a record shorter than the year: from its start
  });
  it('fits the heights to what is in view: old history clipped, and a high one left out', () => {
    const iss = series(28 * 365, 1, 900, 410, 300), f = frame([iss])!;
    const inView = iss.P.filter(p => p.t >= f.t0).map(p => p.sma);
    expect(f.hMax).toBeLessThan(900);
    expect(f.hMax).toBeGreaterThan(Math.max(...inView));               // padded, with the height where the clipped line comes in
    expect(f.hMin).toBeLessThan(120);
    const geo: SeriesShape = { P: [{ t: T - 300 * DAY_MS, sma: 35786 }, { t: T, sma: 35786 }], r: { tNow: T, hNow: 35786, track: null } };
    expect(frame([iss, geo])).toEqual(f);
    expect(frame([geo])).toBeNull();
    expect(frame([])).toBeNull();
  });
  it('pads the heights by 8 %, and by at least 4 km, never below zero', () => {
    const flat = series(100, 0, 500, 500), f = frame([flat])!;
    expect(f.hMin).toBe(496);
    expect(f.hMax).toBe(504);
    const f2 = frame([series(100, 0, 600, 100, 0)])!;
    expect(f2.hMax).toBeCloseTo(640, 9);
    expect(f2.hMin).toBeCloseTo(60, 9);
  });
  it('gives one instant a day of width', () => {
    const one: SeriesShape = { P: [{ t: T, sma: 400 }], r: { tNow: T, hNow: 400, track: null } };
    const f = frame([one])!;
    expect(f.tEnd - f.t0).toBe(DAY_MS);
  });
});

describe('the readout', () => {
  const s = series(10, 0, 400, 390, 20);
  it('reads the line as drawn: straight between element sets inside the record, then along the projection, nothing outside', () => {
    expect(valueAt(s, s.P[0]!.t - 1)).toBeNull();
    expect(valueAt(s, s.P[0]!.t)).toEqual({ h: 400, projected: false });
    expect(valueAt(s, s.P[3]!.t)).toEqual({ h: s.P[3]!.sma, projected: false });
    const q = valueAt(s, s.P[3]!.t + DAY_MS / 4)!;                      // a quarter of the way to the next set
    expect(q.projected).toBe(false);
    expect(q.h).toBeCloseTo(s.P[3]!.sma + (s.P[4]!.sma - s.P[3]!.sma) / 4, 9);
    expect(valueAt(s, s.r.tNow!)).toEqual({ h: 390, projected: false });
    const p = valueAt(s, s.r.tNow! + DAY_MS)!;                          // halfway between the projection's first two points
    expect(p.projected).toBe(true);
    expect(p.h).toBeCloseTo((s.r.track![0]!.h + s.r.track![1]!.h) / 2, 9);
    expect(valueAt(s, s.r.tNow! + 2 * DAY_MS)).toEqual({ h: s.r.track![1]!.h, projected: true });
    expect(valueAt(s, s.r.tNow! + 20 * DAY_MS)).toEqual({ h: 120, projected: true });
    expect(valueAt(s, s.r.tNow! + 20 * DAY_MS + 1)).toBeNull();
    expect(valueAt(series(10, 0, 400, 390), T + 1)).toBeNull();         // no projection: nothing after the last set
  });
  it('reads a slow decayer just past its last set on its line, not at the next point 4 km down', () => {
    /* the lifetime model samples its projection every 4 km of height: here 4 km in 200 days */
    const slow: SeriesShape = { P: [{ t: T - DAY_MS, sma: 470.2 }, { t: T, sma: 470 }],
      r: { tNow: T, hNow: 470, track: [{ t: 0, h: 470 }, { t: 200, h: 466 }, { t: 380, h: 462 }] } };
    expect(valueAt(slow, T + DAY_MS / 2)!.h).toBeCloseTo(469.99, 9);
    expect(valueAt(slow, T + 290 * DAY_MS)!.h).toBeCloseTo(464, 9);
  });
  it('lists the values highest first, two at one height in their order', () => {
    expect(tipOrder([{ h: 300, k: 'a' }, { h: 410, k: 'b' }, { h: 300, k: 'c' }, { h: 120, k: 'd' }]).map(x => x.k)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('cuts a long name to 18 characters, the last an ellipsis', () => {
    expect(shortName('ISS (ZARYA)')).toBe('ISS (ZARYA)');
    expect(shortName('STARLINK-31234 [DTC]')).toBe('STARLINK-31234 [D…');
    expect([...shortName('STARLINK-31234 [DTC]')]).toHaveLength(18);
    expect(shortName('123456789012345678')).toBe('123456789012345678');
  });
});

describe('the names on the chart, all or none', () => {
  const plot = { left: 46, right: 690, top: 14 };
  it('puts each 6 px left of and above its last set, right-aligned', () => {
    expect(labelPlan([{ x: 500, y: 100, w: 80 }, { x: 600, y: 200, w: 60 }], plot)).toEqual([{ x: 494, y: 94 }, { x: 594, y: 194 }]);
  });
  it('writes none with more than four, or on a plot under 400 px', () => {
    const five = [100, 140, 180, 220, 260].map(y => ({ x: 600, y, w: 50 }));
    expect(labelPlan(five, plot)).toBeNull();
    expect(labelPlan(five.slice(0, 4), plot)).not.toBeNull();
    const one = [{ x: 300, y: 100, w: 50 }];
    expect(labelPlan(one, { left: 46, right: 445, top: 14 })).toBeNull();
    expect(labelPlan(one, { left: 46, right: 446, top: 14 })).not.toBeNull();
    expect(labelPlan([], plot)).toBeNull();
  });
  it('writes none when two would be closer than 13 px, and never moves one', () => {
    expect(labelPlan([{ x: 600, y: 100, w: 80 }, { x: 610, y: 112, w: 80 }], plot)).toBeNull();
    expect(labelPlan([{ x: 600, y: 100, w: 80 }, { x: 610, y: 113, w: 80 }], plot)).not.toBeNull();
    expect(labelPlan([{ x: 300, y: 100, w: 80 }, { x: 600, y: 100, w: 80 }], plot)).not.toBeNull();    // side by side, far apart
    expect(labelPlan([{ x: 300, y: 100, w: 80 }, { x: 392, y: 100, w: 80 }], plot)).toBeNull();        // 12 px between them
  });
  it('writes none when one would leave the plot', () => {
    expect(labelPlan([{ x: 120, y: 100, w: 80 }], plot)).toBeNull();
    expect(labelPlan([{ x: 600, y: 20, w: 80 }], plot)).toBeNull();
  });
});

/* ---- the chart's view (L67): the quantity and the time range, the record's two keys, and the guarantee that the default view is
   the frame above, unchanged ------------------------------------------------------------------------------------------------- */

/** a history with an eccentricity on each set (NaN or null where `e` gives one) */
const withEcc = (s: SeriesShape, e: (i: number) => number | null): SeriesShape => ({ ...s, P: s.P.map((r, i) => ({ ...r, ecc: e(i) })) });
/** the history with an inclination and a RAAN at each element set (L68) */
const withPlane = (s: SeriesShape, inc: (i: number) => number | null, raan: (i: number) => number | null): SeriesShape =>
  ({ ...s, P: s.P.map((r, i) => ({ ...r, inc: inc(i), raan: raan(i) })) });
/** `n` sets `step` apart ending at `end`, the mean altitude h(i) */
const rows = (n: number, h: (i: number) => number, step = DAY_MS, end = T) =>
  Array.from({ length: n }, (_, i) => ({ t: end - (n - 1 - i) * step, sma: h(i) }));
const geoS: SeriesShape = { P: [{ t: T - 300 * DAY_MS, sma: 35786 }, { t: T, sma: 35786 }], r: { tNow: T, hNow: 35786, track: null } };

describe('the record of the view (L67)', () => {
  const items = list(['25544', 2], ['07530']);
  const TODAY = '{"o":1,"l":[{"n":"25544","h":2},{"n":"07530"}]}';
  it('without a view, or with the default one, is written exactly as before', () => {
    expect(writeCompare(true, items)).toBe(TODAY);
    expect(writeCompare(true, items, VIEW_DEFAULT)).toBe(TODAY);
    expect(writeCompare(true, items, { p: 'alt', r: 'auto' })).toBe(TODAY);
  });
  it('writes "p" and "r" after the list, each only when it is not the default, and reads them back', () => {
    expect(writeCompare(true, [], { p: 'hp', r: '90d' })).toBe('{"o":1,"l":[],"p":"hp","r":"90d"}');
    expect(writeCompare(true, [], { p: 'alt', r: 'all' })).toBe('{"o":1,"l":[],"r":"all"}');
    expect(writeCompare(false, [], { p: 'ecc', r: 'auto' })).toBe('{"o":0,"l":[],"p":"ecc"}');
    expect(readCompare('{"o":1,"l":[],"p":"hp","r":"90d"}')).toEqual({ open: true, items: [], view: { p: 'hp', r: '90d' } });
    expect(readCompare('{"o":1,"l":[],"r":"all"}')).toEqual({ open: true, items: [], view: { r: 'all' } });
  });
  it('reads anything else as the default, with no view at all, and keeps the list', () => {
    for (const kv of ['"p":"argp"', '"p":"alt"', '"r":"auto"', '"r":7', '"r":"2y"', '"p":null']) {   // "inc" was here until L68 made it a quantity
      const rec = readCompare(TODAY.slice(0, -1) + ',' + kv + '}');
      expect('view' in rec, kv).toBe(false);
      expect(rec, kv).toEqual({ open: true, items });
    }
    /* an unknown key keeps the list; a good key beside a bad one is kept alone */
    expect(readCompare('{"o":1,"l":[{"n":"25544","h":2}],"x":{"p":"hp"},"zz":1}')).toEqual({ open: true, items: list(['25544', 2]) });
    expect(readCompare('{"o":0,"l":[],"p":"rate","r":"2y"}')).toEqual({ open: false, items: [], view: { p: 'rate' } });
  });
  it('round-trips every range with every quantity, "o" always first, and a shut one never reads as open to the section', () => {
    for (const r of RANGES) for (const p of PARAMS) {
      const s = writeCompare(true, items, { p, r });
      expect(s.startsWith('{"o":')).toBe(true);
      const rec = readCompare(s);
      expect(rec.items).toEqual(items);
      expect({ ...VIEW_DEFAULT, ...(rec.view ?? {}) }).toEqual({ p, r });
      expect('view' in rec).toBe(p !== 'alt' || r !== 'auto');
      expect(writeCompare(false, items, { p, r })).not.toMatch(/"o":1/);      // DecaySection's probe
    }
  });
});

describe('the quantities (L67)', () => {
  it('copies the page\'s WGS-84 pair; the period and mean motion of a mean altitude are CelesTrak\'s', () => {
    expect(RE).toBe(Lifetime.RE);
    expect(MU).toBe(Lifetime.MU);
    /* 67683 at 2026-09-12T07:29:09Z: SMA 363.259 km, mean motion 15.68476422 rev/day */
    expect(Math.abs(periodMin(363.259) - 91.8088)).toBeLessThan(1e-4);
    expect(Math.abs(1440 / periodMin(363.259) - 15.68476422)).toBeLessThan(1e-5);
    expect(PARAMS.filter(p => projects(p))).toEqual(['alt', 'per', 'mm']);
    expect(PARAMS.filter(p => MEASURE[p].floor)).toEqual(['alt', 'hp', 'ha']);
  });
  it('reads an eccentricity only where it is a finite number', () => {
    expect(eccOf({ ecc: NaN })).toBeNaN();
    expect(eccOf({ ecc: null })).toBeNaN();
    expect(eccOf({ ecc: undefined })).toBeNaN();
    expect(eccOf({})).toBeNaN();
    expect(eccOf({ ecc: 0.001 })).toBe(0.001);
  });
  const E = 0.00096186;
  const P = [{ t: T - 3 * DAY_MS, sma: 363.259, ecc: E }, { t: T - 2 * DAY_MS, sma: 362.9, ecc: NaN }, { t: T - DAY_MS, sma: 362.7, ecc: null },
    { t: T, sma: 362.5 }];
  it('mean perigee and apogee altitude from the mean altitude and eccentricity; NaN on a set without one', () => {
    const hp = points(P, 'hp'), ha = points(P, 'ha'), ec = points(P, 'ecc');
    expect(Math.abs(hp.v[0]! - ((363.259 + RE) * (1 - E) - RE))).toBeLessThan(1e-9);
    expect(Math.abs(ha.v[0]! - ((363.259 + RE) * (1 + E) - RE))).toBeLessThan(1e-9);
    expect(ec.v[0]).toBe(E);
    for (const i of [1, 2, 3]) for (const q of [hp, ha, ec]) expect(q.v[i]).toBeNaN();
    expect(Array.from(hp.t)).toEqual(P.map(r => r.t));
  });
  it('mean altitude, period and mean motion for every set', () => {
    const alt = points(P, 'alt'), per = points(P, 'per'), mm = points(P, 'mm');
    P.forEach((r, i) => {
      expect(alt.v[i]).toBe(r.sma);
      expect(per.v[i]).toBe(periodMin(r.sma));
      expect(mm.v[i]).toBe(1440 / periodMin(r.sma));
    });
  });
  it('gives the same object back for the same history and quantity, and works a new history out anew', () => {
    expect(points(P, 'hp')).toBe(points(P, 'hp'));
    expect(points(P, 'rate')).toBe(rateSeries(P));
    expect(points([...P], 'hp')).not.toBe(points(P, 'hp'));
  });
  it('pads and steps each axis by the table\'s least amounts', () => {
    expect(MEASURE).toMatchObject({
      alt: { pad: 4, step: 1 }, hp: { pad: 4, step: 1 }, ha: { pad: 4, step: 1 }, rate: { pad: 0.01, step: 0.001 },
      ecc: { pad: 0.00005, step: 0.00001 }, per: { pad: 0.08, step: 0.01 }, mm: { pad: 0.014, step: 0.001 }
    });
  });
  it('projects the forecast in each quantity that has one, kept apart per quantity, and nothing without a track', () => {
    const s = series(100, 0, 400, 390, 20), A = s.r.track!;
    const alt = projected(s, 'alt')!, per = projected(s, 'per')!, mm = projected(s, 'mm')!;   // alt first: each is its own entry
    expect(Array.from(alt.t)).toEqual(A.map(q => s.r.tNow! + q.t * DAY_MS));
    expect(Array.from(alt.v)).toEqual(A.map(q => q.h));
    expect(Array.from(per.v)).toEqual(A.map(q => periodMin(q.h)));
    A.forEach((_, i) => expect(Math.abs(mm.v[i]! - 1440 / per.v[i]!), String(i)).toBeLessThan(1e-12));
    expect(projected(s, 'per')).toBe(per);
    expect(projected(s, 'mm')).not.toBe(per);
    for (const p of ['hp', 'ha', 'rate', 'ecc'] as const) expect(projected(s, p), p).toBeNull();
    expect(projected(series(100, 0, 400, 390), 'alt')).toBeNull();
  });
});

describe('the decay rate (L67)', () => {
  it('a straight fall of 0.5 km/day, sampled daily, reads -0.5 wherever the 45 days hold 8 sets', () => {
    const q = rateSeries(rows(120, i => 500 - 0.5 * i));
    expect(q.t).toHaveLength(120);
    for (let i = 0; i < 120; i++) {
      if (i < 7) expect(q.v[i], String(i)).toBeNaN();
      else expect(Math.abs(q.v[i]! + 0.5), String(i)).toBeLessThan(1e-12);
    }
  });
  it('reads nothing with fewer than 8 sets in the 45 days', () => {
    const q = rateSeries(rows(40, i => 500 - 3.5 * i, 7 * DAY_MS));        // weekly: 7 sets in 45 days
    expect(Array.from(q.v).every(v => Number.isNaN(v))).toBe(true);
  });
  it('reads nothing with the window\'s two ends 5 days apart or less', () => {
    const q = rateSeries(rows(13, i => 500 - 0.25 * i, DAY_MS / 2));        // every 12 hours
    expect(q.v[11]).toBeNaN();                                               // 12 sets: the ends' middles 5 days apart
    expect(Number.isFinite(q.v[12]!)).toBe(true);                            // 13 sets: 5.5 days
    expect(q.v[12]).toBeCloseTo(-0.5, 12);
  });
  it('gives one point per instant: sets that share one count once, at the last of them', () => {
    const P = rows(60, i => 500 - 0.5 * i);
    const D = P.flatMap((r, i) => (i % 10 === 3 ? [r, { ...r, sma: r.sma + 0.1 }] : [r]));
    const q = rateSeries(D);
    expect(Array.from(q.t)).toEqual(P.map(r => r.t));
    /* the value at a shared instant is the window that ends with both sets */
    const lastAt = (i: number) => D.map(r => r.t).lastIndexOf(P[i]!.t);
    for (const i of [13, 23, 33, 43, 53]) {
      expect(D[lastAt(i)]!.sma, String(i)).toBe(P[i]!.sma + 0.1);
      const c = Lifetime.calibrate(D.slice(0, lastAt(i) + 1), 45);
      expect(c, String(i)).not.toBeNull();
      expect(q.v[i], String(i)).toBe(c!.rate);
    }
    /* where the window is short, the first of the two alone reads another figure (in longer ones the medians can hide it) */
    expect(q.v[13]).not.toBe(Lifetime.calibrate(D.slice(0, lastAt(13)), 45)!.rate);
  });
  it('reads above zero after a reboost', () => {
    const q = rateSeries(rows(100, i => (i < 50 ? 400 - 0.2 * i : 390 + 0.3 * (i - 50))));
    expect(q.v[99]).toBeGreaterThan(0);
    expect(q.v[49]).toBeLessThan(0);
  });
  it('at the last set is the Decay section\'s own 45-day figure, bit for bit', () => {
    const P = rows(200, i => 420 - 0.15 * i - 0.0004 * i * i + 0.3 * Math.sin(i * 1.7));
    P.splice(150, 0, { ...P[150]!, sma: P[150]!.sma + 0.05 });              // two sets at one instant
    P.push({ ...P.at(-1)!, sma: P.at(-1)!.sma - 0.3 });                     // and two at the last one (CelesTrak sends such pairs)
    const c = Lifetime.calibrate(P, 45);
    expect(c).not.toBeNull();
    const q = rateSeries(P);
    expect(q.v[q.v.length - 1]).toBe(c!.rate);
    expect(q.v[q.v.length - 1]).not.toBe(Lifetime.calibrate(P.slice(0, -1), 45)!.rate);   // the first of the pair alone differs
    expect(q.t[q.t.length - 1]).toBe(P[P.length - 1]!.t);
  });
  it('keeps at most 2,000 points, counted back from the last, which is always among them', () => {
    const P = rows(40000, i => 500 - i * 1e-4, 3600000);                    // hourly, 4.6 years
    const q = rateSeries(P);
    expect(q.t.length).toBeLessThanOrEqual(2000);
    expect(q.t.length).toBeGreaterThan(1900);
    expect(q.t[q.t.length - 1]).toBe(P[P.length - 1]!.t);
    expect(q.v[q.v.length - 1]).toBeCloseTo(-24e-4, 9);
  });
});

describe('the time window of a range (L67)', () => {
  const iss = series(28 * 365, 1, 460, 410, 300), young = series(200, 2, 520, 470, 150);
  const newest = T - DAY_MS;
  it('Auto is the frame\'s; 30 d, 90 d and 1 y end at the newest set, not clamped; All runs from the first set to the latest end', () => {
    const f = frame([iss, young])!;
    expect(baseWindow([iss, young], 'auto')).toEqual({ t0: f.t0, t1: f.tEnd, tLast: newest });
    for (const [r, N] of [['30d', 30], ['90d', 90], ['1y', 365]] as const) {
      expect(baseWindow([iss, young], r)).toEqual({ t0: newest - N * DAY_MS, t1: newest, tLast: newest });
    }
    expect(baseWindow([iss, young], 'all')).toEqual({ t0: iss.P[0]!.t, t1: Math.max(seriesEnd(iss), seriesEnd(young)), tLast: newest });
    const y = baseWindow([young], '1y')!;                                   // a year before a 200-day record's last set
    expect(y.t0).toBe(young.r.tNow! - 365 * DAY_MS);
    expect(y.t0).toBeLessThan(young.P[0]!.t);
  });
  it('gives one instant a day, and nothing with nothing drawable', () => {
    const one: SeriesShape = { P: [{ t: T, sma: 400 }], r: { tNow: T, hNow: 400, track: null } };
    expect(baseWindow([one], 'all')).toEqual({ t0: T, t1: T + DAY_MS, tLast: T });
    expect(baseWindow([geoS], 'all')).toBeNull();
    expect(baseWindow([], 'auto')).toBeNull();
    expect(baseWindow([young, geoS], '30d')).toEqual(baseWindow([young], '30d'));
  });
});

describe('the frame of a view (L67)', () => {
  /* every frame() fixture above */
  const fixtures: SeriesShape[][] = [
    [series(28 * 365, 1, 460, 410, 300), series(200, 2, 520, 470, 150)],
    [series(2000, 0, 600, 580, 1500)], [series(100, 0, 400, 390)],
    [series(28 * 365, 1, 900, 410, 300)], [series(28 * 365, 1, 900, 410, 300), geoS],
    [series(100, 0, 500, 500)], [series(100, 0, 600, 100, 0)],
    [{ P: [{ t: T, sma: 400 }], r: { tNow: T, hNow: 400, track: null } }]
  ];
  it('the default view is frame() itself, for every frame in this file', () => {
    for (const fx of fixtures) {
      const v = frameView(fx, VIEW_DEFAULT)!, f = frame(fx)!;
      expect({ t0: v.frame!.t0, tEnd: v.frame!.tEnd, hMin: v.frame!.hMin, hMax: v.frame!.hMax }).toEqual(f);
      expect([v.why, v.zoomed, v.t0, v.t1]).toEqual([null, false, f.t0, f.tEnd]);
      expect([v.frame!.base, v.frame!.zoomed]).toEqual([{ t0: f.t0, t1: f.tEnd }, false]);
    }
    expect(frameView([geoS], VIEW_DEFAULT)).toBeNull();
    expect(frameView([], VIEW_DEFAULT)).toBeNull();
  });
  it('the window does not depend on the quantity: switching it only refits the heights', () => {
    /* since L68 the lines carry an inclination and a RAAN too, and the first is the selected spacecraft, the RAAN offset's reference */
    const e = [withEcc(series(400, 1, 460, 410, 300), () => 0.001), withEcc(series(200, 2, 520, 470, 150), () => 0.002)];
    const pl = e.map((s, k) => withPlane(s, () => 51.6 + k, i => (300 - 5 * i + 360 * 9) % 360));
    const fx = pl.map(s => ({ ...s, ref: pl[0]!.P }));
    for (const r of RANGES) {
      const w = PARAMS.map(p => { const v = frameView(fx, { p, r })!; return [v.t0, v.t1, v.frame!.t0, v.frame!.tEnd]; });
      for (const x of w) expect(x, r).toEqual(w[0]);
    }
  });
  /* B comes in from the left edge of a 30-day window between two weekly sets, and its projection leaves through the right edge
     (the newest set is A's, today); A sits between B's two edge values */
  const B: SeriesShape = {
    P: Array.from({ length: 21 }, (_, i) => { const t = T - 10 * DAY_MS - (20 - i) * 7 * DAY_MS; return { t, sma: 300 + (T - 10 * DAY_MS - t) / DAY_MS }; }),
    r: { tNow: T - 10 * DAY_MS, hNow: 300, track: [{ t: 0, h: 300 }, { t: 20, h: 200 }] }
  };
  const A: SeriesShape = { P: rows(60, () => 260), r: { tNow: T, hNow: 260, track: null } };
  it('30 days: a line comes in at the left edge and a projection leaves at the right, each read where it crosses', () => {
    const v = frameView([A, B], { p: 'alt', r: '30d' })!;
    expect([v.t0, v.t1, v.zoomed, v.why]).toEqual([T - 30 * DAY_MS, T, false, null]);
    /* in: 320 km (between 321 and 314); out: 250 km, halfway along the projection's first 20 days; padded by 8 % of 70 km */
    expect(v.frame!.hMax).toBeCloseTo(320 + 5.6, 9);
    expect(v.frame!.hMin).toBeCloseTo(250 - 5.6, 9);
  });
  it('a zoom clips a history on both sides, read where it crosses each edge', () => {
    const v = frameView([B], { p: 'alt', r: 'all' }, { t0: T - 100.5 * DAY_MS, t1: T - 50.5 * DAY_MS })!;
    expect([v.zoomed, v.t0, v.t1, v.frame!.zoomed]).toEqual([true, T - 100.5 * DAY_MS, T - 50.5 * DAY_MS, true]);
    expect(v.frame!.hMax).toBeCloseTo(390.5 + 4, 9);
    expect(v.frame!.hMin).toBeCloseTo(340.5 - 4, 9);
    expect(v.base).toEqual({ t0: B.P[0]!.t, t1: seriesEnd(B) });
  });
  it('pads by the quantity\'s least pad: a flat eccentricity of 0.001 gives 0.00095 to 0.00105', () => {
    const f = frameView([withEcc(series(100, 0, 500, 490), () => 0.001)], { p: 'ecc', r: 'auto' })!.frame!;
    expect(f.hMin).toBeCloseTo(0.00095, 12);
    expect(f.hMax).toBeCloseTo(0.00105, 12);
  });
  it('lets the decay rate go below zero, and keeps every other quantity at zero or above', () => {
    const s: SeriesShape = { P: rows(120, i => 500 - 0.5 * i), r: { tNow: T, hNow: 440.5, track: null } };
    const f = frameView([s], { p: 'rate', r: 'auto' })!.frame!;
    expect(f.hMin).toBeCloseTo(-0.51, 12);
    expect(f.hMax).toBeCloseTo(-0.49, 12);
    expect(PARAMS.filter(p => !MEASURE[p].min0)).toEqual(['rate', 'raan']);      // and the RAAN offset (L68), either way of 0
    expect(frameView([withEcc(series(100, 0, 500, 490), () => 0.00001)], { p: 'ecc', r: 'auto' })!.frame!.hMin).toBe(0);
  });
  it('says why nothing is drawn: no history carries the quantity, or none has a value in the window', () => {
    const none = withEcc(series(100, 0, 500, 490, 30), () => null), f = frame([none])!;
    const a = frameView([none], { p: 'hp', r: 'auto' })!;
    expect([a.frame, a.why, a.t0, a.t1, a.zoomed]).toEqual([null, 'param', f.t0, f.tEnd, false]);
    const e = withEcc(series(100, 0, 500, 490, 30), () => 0.001), future = { t0: T + 5 * DAY_MS, t1: T + 20 * DAY_MS };
    const z = frameView([e], { p: 'hp', r: 'auto' }, future)!;
    expect([z.frame, z.why, z.zoomed, z.t0, z.t1]).toEqual([null, 'range', true, future.t0, future.t1]);
    expect(frameView([e], { p: 'per', r: 'auto' }, future)!.frame).not.toBeNull();     // the period has the projection there
  });
  it('fits the heights to `yfit`, and the window to `fit`', () => {
    const lo = withEcc(series(400, 1, 460, 410, 300), () => 0.001), hi = withEcc(series(400, 1, 900, 880), () => 0.001);
    const v = frameView([lo], { p: 'hp', r: '90d' }, null, [hi])!;
    expect([v.t0, v.t1]).toEqual([frameView([lo], { p: 'hp', r: '90d' })!.t0, frameView([lo], { p: 'hp', r: '90d' })!.t1]);
    expect(v.frame!.hMin).toBeGreaterThan(800);
  });
  it('ignores a zoom outside the range\'s window, or narrower than a day', () => {
    const fx = [series(100, 0, 500, 490, 30)], w = baseWindow(fx, '30d')!;
    for (const win of [{ t0: w.t0 - 1, t1: w.t1 }, { t0: w.t0, t1: w.t1 + 1 }, { t0: w.t0 + DAY_MS, t1: w.t0 + 2 * DAY_MS - 1 }]) {
      const v = frameView(fx, { p: 'alt', r: '30d' }, win)!;
      expect([v.zoomed, v.t0, v.t1, v.frame!.zoomed]).toEqual([false, w.t0, w.t1, false]);
    }
    const ok = frameView(fx, { p: 'alt', r: '30d' }, { t0: w.t0 + DAY_MS, t1: w.t0 + 2 * DAY_MS })!;
    expect([ok.zoomed, ok.t0, ok.t1]).toEqual([true, w.t0 + DAY_MS, w.t0 + 2 * DAY_MS]);
    /* a zoom in the default view leaves the legacy frame */
    const az = frameView(fx, VIEW_DEFAULT, { t0: T - 10 * DAY_MS, t1: T })!;
    expect([az.zoomed, az.frame!.t0, az.frame!.tEnd]).toEqual([true, T - 10 * DAY_MS, T]);
  });
});

describe('the readout of a view (L67)', () => {
  const s = withEcc(series(10, 0, 400, 390, 20), i => (i === 4 ? NaN : 0.001));
  const tNow = s.r.tNow!, A = s.r.track!;
  const hp = (i: number) => (RE + s.P[i]!.sma) * (1 - 0.001) - RE;
  it('reads mean altitude with valueAt itself', () => {
    for (const t of [s.P[0]!.t - 1, s.P[0]!.t, s.P[3]!.t + DAY_MS / 4, s.P[4]!.t, tNow, tNow + DAY_MS, tNow + 2 * DAY_MS, tNow + 20 * DAY_MS,
      tNow + 20 * DAY_MS + 1]) expect(valueIn(s, t, 'alt')).toEqual(valueAt(s, t));
  });
  it('reads nothing on or beside a set without the quantity, and the line between two that have it', () => {
    expect(valueIn(s, s.P[3]!.t + DAY_MS / 2, 'ecc')).toBeNull();
    expect(valueIn(s, s.P[4]!.t, 'hp')).toBeNull();
    expect(valueIn(s, s.P[4]!.t + DAY_MS / 2, 'hp')).toBeNull();
    expect(valueIn(s, s.P[6]!.t, 'ecc')).toEqual({ h: 0.001, projected: false });
    const q = valueIn(s, s.P[6]!.t + DAY_MS / 4, 'hp')!;
    expect(q.projected).toBe(false);
    expect(q.h).toBeCloseTo(hp(6) + (hp(7) - hp(6)) / 4, 9);
    expect(valueIn(s, s.P[0]!.t - 1, 'ecc')).toBeNull();
  });
  it('a quantity without a forecast reads nothing after the last set; the period and mean motion read the projection, mapped', () => {
    expect(valueIn(s, tNow, 'hp')).toEqual({ h: hp(10), projected: false });
    expect(valueIn(s, tNow + DAY_MS, 'hp')).toBeNull();
    const p = valueIn(s, tNow + DAY_MS, 'per')!;                             // halfway between the first two points, 2 days apart
    expect(p.projected).toBe(true);
    expect(p.h).toBeCloseTo((periodMin(A[0]!.h) + periodMin(A[1]!.h)) / 2, 10);
    const mm = (h: number) => 1440 / periodMin(h), m = valueIn(s, tNow + 3.5 * DAY_MS, 'mm')!;
    expect(m.h).toBeCloseTo(mm(A[1]!.h) + (mm(A[2]!.h) - mm(A[1]!.h)) * 0.75, 10);
    expect(valueIn(s, tNow + 20 * DAY_MS, 'per')).toEqual({ h: periodMin(120), projected: true });
    expect(valueIn(s, tNow + 20 * DAY_MS + 1, 'per')).toBeNull();
  });
});

describe('the grid step, the dot and the ring (L67)', () => {
  /* draw-compare.ts's private step, as it was before L67 */
  const tickStep = (span: number): number => {
    const raw = span / 5, p = 10 ** Math.floor(Math.log10(raw)), e = raw / p;
    return Math.max(1, (e >= Math.sqrt(50) ? 10 : e >= Math.sqrt(10) ? 5 : e >= Math.SQRT2 ? 2 : 1) * p);
  };
  it('a round step, at least the least; with a least of 1 the chart\'s km step for every span', () => {
    expect(niceStep(8, 1)).toBe(2);
    expect(niceStep(0.0004, 0.00001)).toBe(0.0001);
    expect(niceStep(0.003, 1)).toBe(1);
    for (const span of [0.004, 0.5, 1, 3, 7.07, 7.08, 7.9, 8, 13, 15.8, 47, 70.7, 99.9, 120, 352, 470, 999, 5000, 38000]) {
      expect(niceStep(span, 1), String(span)).toBe(tickStep(span));
    }
    expect([stepDecimals(0.05), stepDecimals(2), stepDecimals(0.0001), stepDecimals(1), stepDecimals(0.001)]).toEqual([2, 0, 4, 0, 3]);
  });
  const s = withEcc(series(10, 0, 400, 390, 20), i => (i === 10 ? NaN : 0.001));
  it('the dot: mean altitude at the last set exactly, the period there in minutes, the others at their last finite point', () => {
    expect(lastOf(s, 'alt')).toEqual({ t: s.r.tNow, v: s.r.hNow });
    expect(lastOf(s, 'per')).toEqual({ t: s.r.tNow, v: periodMin(390) });
    expect(lastOf(s, 'hp')).toEqual({ t: s.P[9]!.t, v: (RE + s.P[9]!.sma) * (1 - 0.001) - RE });
    expect(lastOf(s, 'rate')!.t).toBe(s.P[10]!.t);
    expect(lastOf(withEcc(series(10, 0, 400, 390), () => NaN), 'ecc')).toBeNull();
  });
  it('the ring: only in a projected quantity, and only where the projection reaches 120.5 km or lower', () => {
    const end = s.r.tNow! + 20 * DAY_MS;
    expect(ringOf(s, 'alt')).toEqual({ t: end, v: 120 });
    expect(ringOf(s, 'per')).toEqual({ t: end, v: periodMin(120) });
    for (const p of ['hp', 'ha', 'rate', 'ecc'] as const) expect(ringOf(s, p)).toBeNull();
    const ending = (h: number): SeriesShape => ({ ...s, r: { ...s.r, track: [{ t: 0, h: 390 }, { t: 9, h }] } });
    expect(ringOf(ending(120.5), 'mm')).toEqual({ t: s.r.tNow! + 9 * DAY_MS, v: 1440 / periodMin(120.5) });
    expect(ringOf(ending(120.6), 'alt')).toBeNull();
    expect(ringOf({ ...s, r: { ...s.r, track: [{ t: 0, h: 120 }] } }, 'alt')).toBeNull();
  });
});

describe('the inclination and the RAAN offset from the selected spacecraft (L68)', () => {
  const daily = (n: number, raan: (i: number) => number | null, inc: (i: number) => number | null = () => 51.64, end = T) =>
    rows(n, i => 420 - 0.1 * i, DAY_MS, end).map((r, i) => ({ ...r, ecc: 0.0005, inc: inc(i), raan: raan(i) }));
  const shape = (P: SeriesShape['P'], ref?: SeriesShape['P'] | null): SeriesShape =>
    ({ P, r: { tNow: P[P.length - 1]!.t, hNow: P[P.length - 1]!.sma, track: [{ t: 0, h: 380 }, { t: 30, h: 120 }] }, ref });

  it('are history only: no forecast, no ring, no 120 km line, and the offset may go below zero', () => {
    for (const p of ['inc', 'raan'] as const) {
      expect(projects(p), p).toBe(false);
      expect(MEASURE[p].floor, p).toBe(false);
    }
    expect([MEASURE.inc.pad, MEASURE.inc.step, stepDecimals(MEASURE.inc.step), MEASURE.inc.min0]).toEqual([0.005, 0.0001, 4, true]);
    expect(MEASURE.raan.min0).toBe(false);
    const own = daily(5, i => 100 + i);
    expect(ringOf(shape(own, own), 'raan')).toBeNull();
    expect(projected(shape(own, own), 'inc')).toBeNull();
  });

  it('the inclination is each element set\'s own, NaN where a row has none (blank: NaN; through JSON: null; kept before L68: absent)', () => {
    const P = [...daily(3, () => 10, i => [51.6, 51.6001, 51.6002][i]!), { t: T + DAY_MS, sma: 400, ecc: 0, inc: NaN }, { t: T + 2 * DAY_MS, sma: 400, ecc: 0, inc: null },
      { t: T + 3 * DAY_MS, sma: 400, ecc: 0 }];
    expect(Array.from(points(P, 'inc').v)).toEqual([51.6, 51.6001, 51.6002, NaN, NaN, NaN]);
    expect(Array.from(points(P, 'inc').t)).toEqual(P.map(r => r.t));
    expect([angleOf(5), angleOf(null), angleOf(undefined), angleOf(NaN), angleOf(Infinity)]).toEqual([5, NaN, NaN, NaN, NaN]);
  });

  it('tells a history kept with its plane from one cached before L68, whose rows have neither key', () => {
    expect(hasPlane(daily(3, () => 10))).toBe(true);
    expect(hasPlane(daily(3, () => null, () => null))).toBe(true);           // kept, and blank: the line breaks, nothing is said
    expect(hasPlane(rows(3, () => 400))).toBe(false);                         // the hist:<n> copy of an earlier visit
    expect(hasPlane([])).toBe(false);
  });

  it('the offset is 0 against itself, and its RAAN less the selected one\'s at the same instant, wrapped to -180..180', () => {
    const sel = daily(10, i => (350 + 4 * i) % 360);                         // 350, 354, 358, 2, 6, ...: through 0
    expect(Array.from(points(sel, 'raan', sel).v)).toEqual(new Array(10).fill(0));
    const other = daily(10, i => (20 + 4 * i) % 360);                         // 30 deg further east all along
    expect(Array.from(points(other, 'raan', sel).v).map(v => +v.toFixed(9))).toEqual(new Array(10).fill(30));
    const west = daily(10, i => (190 + 4 * i) % 360);                         // 200 deg east is 160 deg west
    expect(Array.from(points(west, 'raan', sel).v).map(v => +v.toFixed(9))).toEqual(new Array(10).fill(-160));
    expect([wrap180(180), wrap180(-180), wrap180(540), wrap180(-190), wrap180(359.5)]).toEqual([-180, -180, -180, 170, -0.5]);
  });

  it('reads the selected one\'s RAAN between its two nearest sets, the shorter way round, never past its record or across 10 days', () => {
    const sel = [{ t: T, sma: 400, raan: 358 }, { t: T + DAY_MS, sma: 400, raan: 4 }, { t: T + 21 * DAY_MS, sma: 400, raan: 50 }];
    const at = (t: number, raan: number) => ({ t, sma: 400, raan });
    const P = [at(T - DAY_MS, 0), at(T + DAY_MS / 2, 11), at(T + DAY_MS, 14), at(T + 5 * DAY_MS, 0), at(T + 22 * DAY_MS, 0)];
    const v = Array.from(raanSeries(P, sel).v);
    expect(Number.isNaN(v[0]!)).toBe(true);                                  // before its record
    expect(v[1]).toBeCloseTo(10, 9);                                           // 358 -> 4 the short way: 1 deg at half a day
    expect(v[2]).toBe(10);                                                     // a set of its own at that instant
    expect(Number.isNaN(v[3]!)).toBe(true);                                  // 20 days between its sets: not read
    expect(Number.isNaN(v[4]!)).toBe(true);                                  // past its record
    expect(RAAN_GAP_DAYS).toBe(10);
    const ten = [at(T, 0), at(T + 10 * DAY_MS, 50)];
    expect(raanSeries([at(T + 5 * DAY_MS, 30)], ten).v[0]).toBeCloseTo(5, 9);   // ten days apart is read
  });

  it('breaks a line where the offset wraps, instead of drawing it across the chart, and reads no value across the break', () => {
    const sel = daily(6, () => 0);
    const other = daily(6, i => 170 + 4 * i);                                 // 170, 174, 178, 182 (-178), ...
    const q = points(other, 'raan', sel);
    expect(Array.from(q.v).map(v => (Number.isNaN(v) ? 'gap' : +v.toFixed(9)))).toEqual([170, 174, 178, 'gap', -178, -174, -170]);
    expect(q.t[3]).toBe((other[2]!.t + other[3]!.t) / 2);
    const s = shape(other, sel);
    expect(valueIn(s, other[2]!.t + DAY_MS / 4, 'raan')).toBeNull();
    expect(valueIn(s, other[1]!.t + DAY_MS / 2, 'raan')!.h).toBeCloseTo(176, 9);
    expect(lastOf(s, 'raan')).toEqual({ t: other[5]!.t, v: q.v[6] });
  });

  it('with no history of the selected spacecraft, or one cached without its RAAN, no line carries the offset (nothing is fetched for it)', () => {
    const other = daily(30, () => 40);
    for (const ref of [null, undefined, [], rows(30, () => 400)]) {
      const s = shape(other, ref as SeriesShape['P'] | null | undefined);
      expect(Array.from(points(other, 'raan', ref as SeriesShape['P']).v).every(Number.isNaN)).toBe(true);
      expect(frameView([s], { p: 'raan', r: 'auto' })!.why).toBe('param');
    }
    const mine = shape(other, other);
    const v = frameView([mine, shape(daily(30, () => 70), other)], { p: 'raan', r: 'auto' })!;
    expect(v.why).toBeNull();
    expect([v.frame!.hMin, v.frame!.hMax].map(x => +x.toFixed(9))).toEqual([-2.4, 32.4]);        // 0 and 70 - 40, padded by 8 % of 30
  });

  it('is memoised per history and per reference: another selected spacecraft is another line', () => {
    const P = daily(5, () => 30), a = daily(5, () => 10), b = daily(5, () => 20);
    expect(points(P, 'raan', a)).toBe(points(P, 'raan', a));
    expect(points(P, 'raan', b)).not.toBe(points(P, 'raan', a));
    expect(points(P, 'raan', b).v[0]).toBe(10);
  });

  it('fits the inclination\'s heights with its least pad of 0.005 deg', () => {
    const f = frameView([shape(daily(60, () => 10, () => 97.4))], { p: 'inc', r: 'auto' })!.frame!;
    expect([f.hMin, f.hMax].map(x => +x.toFixed(9))).toEqual([97.395, 97.405]);
  });
});
