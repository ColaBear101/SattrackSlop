import { describe, expect, it } from 'vitest';
import {
  addItem, COMPARE_MAX, DAY_MS, DRAW_MAX_KM, drawable, fetchPlan, frame, HIGHLIGHT_MAX, labelPlan, lightItem, lowestFree, notDrawn, readCompare,
  removeItem, rowOrder, seriesEnd, shortName, tipOrder, valueAt, writeCompare, type CompareItem, type SeriesShape
} from '../../src/lib/decay/compare';

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
