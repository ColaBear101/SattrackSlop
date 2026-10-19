/* The decay comparison's model, pure (CHANGES-FROM-LEGACY.md, L66): the list the reader keeps under the Decay section, its colours,
 * which forecasts can be drawn, the frame the comparison chart is fitted to, and the readings of that chart.
 *
 * New in the rebuild. The list is catalogue numbers in the order they were added, each with the colour slot it is highlighted in,
 * if it is: slot 1 is the selected spacecraft's (the page's cyan) and is never stored; slots 2 to 8 are the seven colours a
 * listed spacecraft can be given. A colour follows its spacecraft: a highlight takes the LOWEST free slot, a slot is freed only
 * by turning that highlight off, removing the row, or the row ending with nothing to draw, and nothing already highlighted is
 * ever given another. Every other listed spacecraft with a forecast is drawn as a thin grey line, so the list can hold as many
 * as the watchlist (50) and the chart still never shows a ninth hue.
 *
 * The frame is fitted to the decay, not to every record: CelesTrak sends every element set it holds, so the ISS beside a
 * satellite launched last year would otherwise put a quarter of a century on the axis and squeeze the young one's whole record
 * into a few pixels. The axis runs from a year (or as long as the future it shows, if that is longer) before the earliest last
 * element set to the latest end of a projection; older history is clipped. Above 2,000 km mean altitude drag does not matter
 * and one such line would flatten every other, so such an object is listed but not drawn.
 *
 * The chart's view (L67): the quantity it shows (mean altitude, mean perigee and apogee altitude, the decay rate, eccentricity,
 * orbital period or mean motion), all worked out from the history the page already holds, and the time range (Auto, today's
 * frame, or the 30 days, 90 days or year up to the newest element set, or all of it). The time window never depends on the
 * quantity, so switching it only refits the heights; the default view (Auto, mean altitude) is the frame above, unchanged.
 *
 * Travels with the comparison's chunk (DecayCompare): the store (state/decay-compare.svelte.ts) and the chart
 * (components/report/draw-compare.ts) read it; the Decay section itself does not. */

/** the most spacecraft the comparison keeps: the watchlist's own cap */
export const COMPARE_MAX = 50;
/** the colours a listed spacecraft can be given (slots 2..8); the selected spacecraft's is slot 1, and is not one of them */
export const HIGHLIGHT_MAX = 7;
export const SLOT_FIRST = 2;
export const SLOT_LAST = SLOT_FIRST + HIGHLIGHT_MAX - 1;
/** the most requests one press of the panel starts */
export const FETCH_PER_PRESS = 7;
/** above this mean altitude (km) a forecast is listed, not drawn */
export const DRAW_MAX_KM = 2000;
/** the rows shown before "Show the other N" */
export const ROWS_SHOWN = 8;
/** the least time between two history requests started while the page's API is answering (ms): it allows ten a minute */
export const API_SPACING_MS = 7000;

export const DAY_MS = 86400000;
const YEAR_MS = 365 * DAY_MS;
const NUM = /^\d{1,5}$/;

/** The chart's view: the quantity it shows and its time range. */
export type CmpParam = 'alt' | 'hp' | 'ha' | 'rate' | 'ecc' | 'per' | 'mm';
export type CmpRange = 'auto' | '30d' | '90d' | '1y' | 'all';
export interface CmpView { readonly p: CmpParam; readonly r: CmpRange }
export const PARAMS: readonly CmpParam[] = ['alt', 'hp', 'ha', 'rate', 'ecc', 'per', 'mm'];
export const RANGES: readonly CmpRange[] = ['auto', '30d', '90d', '1y', 'all'];
export const VIEW_DEFAULT: CmpView = { p: 'alt', r: 'auto' };
/** a span of time (ms) */
export interface Win { readonly t0: number; readonly t1: number }

/** A listed spacecraft: its catalogue number as the catalogue writes it (five digits, zero-padded, as entry.satnum and the
 *  hist:<n> cache key), and the colour slot it is highlighted in. */
export interface CompareItem { readonly n: string; readonly h?: number }
/** The stored record; `view` only when it is not the default, with only the keys that differ from it. */
export interface CompareRecord { open: boolean; items: CompareItem[]; view?: Partial<CmpView> }

/** A catalogue number as the catalogue writes it, or null for anything else. */
export function compareNum(x: unknown): string | null {
  return typeof x === 'string' && NUM.test(x) ? x.padStart(5, '0') : null;
}

const isSlot = (h: unknown): h is number => Number.isInteger(h) && (h as number) >= SLOT_FIRST && (h as number) <= SLOT_LAST;

/** The stored record, {"o":1,"l":[{"n":"25544","h":2},{"n":"07530"}]}, read as far as it can be: anything that is not one is an
 *  empty, closed list; a number that is not a catalogue number is left out, and so is a second copy of one; past 50 the rest
 *  are left out; a slot that is not 2..8, or one already taken by a row above it, is dropped (the row stays, not highlighted).
 *  The view's keys, "p" (a quantity other than mean altitude) and "r" (a range other than Auto), are read when they are one of
 *  those; anything else is the default, and the list is kept. */
export function readCompare(raw: string | null): CompareRecord {
  let j: unknown;
  try { j = JSON.parse(raw ?? 'null'); } catch { return { open: false, items: [] }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { open: false, items: [] };
  const rec = j as { o?: unknown; l?: unknown; p?: unknown; r?: unknown };
  const items: CompareItem[] = [], seen = new Set<string>(), slots = new Set<number>();
  for (const x of Array.isArray(rec.l) ? rec.l : []) {
    if (items.length >= COMPARE_MAX) break;
    const n = x && typeof x === 'object' ? compareNum((x as { n?: unknown }).n) : null;
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const h = (x as { h?: unknown }).h;
    if (isSlot(h) && !slots.has(h)) { slots.add(h); items.push({ n, h }); } else items.push({ n });
  }
  const view: { p?: CmpParam; r?: CmpRange } = {};
  if (typeof rec.p === 'string' && rec.p !== VIEW_DEFAULT.p && (PARAMS as readonly string[]).includes(rec.p)) view.p = rec.p as CmpParam;
  if (typeof rec.r === 'string' && rec.r !== VIEW_DEFAULT.r && (RANGES as readonly string[]).includes(rec.r)) view.r = rec.r as CmpRange;
  return view.p || view.r ? { open: rec.o === 1, items, view } : { open: rec.o === 1, items };
}

/** The record as it is stored, the view's keys after the list and only where it differs from the default: without a view, or
 *  with the default one, exactly what was stored before the view existed. */
export function writeCompare(open: boolean, items: readonly CompareItem[], view?: CmpView): string {
  const rec: { o: number; l: CompareItem[]; p?: CmpParam; r?: CmpRange } =
    { o: open ? 1 : 0, l: items.map(i => (i.h ? { n: i.n, h: i.h } : { n: i.n })) };
  if (view && view.p !== VIEW_DEFAULT.p) rec.p = view.p;
  if (view && view.r !== VIEW_DEFAULT.r) rec.r = view.r;
  return JSON.stringify(rec);
}

/** The lowest colour slot no listed spacecraft holds, or null with all seven taken. */
export function lowestFree(items: readonly CompareItem[]): number | null {
  const used = new Set(items.map(i => i.h));
  for (let s = SLOT_FIRST; s <= SLOT_LAST; s++) if (!used.has(s)) return s;
  return null;
}

/** How many of the seven colours are held. */
export const highlighted = (items: readonly CompareItem[]): number => items.filter(i => i.h).length;

/** The list with `n` added at the end, highlighted in the lowest free slot when `light` asks for it and one is free; null when it
 *  is listed already, is not a catalogue number, or the list is full. Nobody else's slot moves. */
export function addItem(items: readonly CompareItem[], n: string, light: boolean): CompareItem[] | null {
  const k = compareNum(n);
  if (!k || items.length >= COMPARE_MAX || items.some(i => i.n === k)) return null;
  const h = light ? lowestFree(items) : null;
  return [...items, h ? { n: k, h } : { n: k }];
}

/** The list without `n`; its slot, if it had one, is free again. */
export const removeItem = (items: readonly CompareItem[], n: string): CompareItem[] => items.filter(i => i.n !== n);

/** `n` highlighted (in the lowest free slot) or not. Null when it cannot be: not listed, or no slot free. A row already in the
 *  state asked for is given back as it is. */
export function lightItem(items: readonly CompareItem[], n: string, on: boolean): readonly CompareItem[] | null {
  const at = items.findIndex(i => i.n === n);
  if (at < 0) return null;
  const it = items[at]!;
  if (!!it.h === on) return items;
  const h = on ? lowestFree(items) : null;
  if (on && !h) return null;
  const out = items.slice();
  out[at] = h ? { n: it.n, h } : { n: it.n };
  return out;
}

/** The order of the list on the page (the selected spacecraft, first, is not among these): the highlighted by slot, then the rest
 *  in the order they were added. `hidden` is a listed spacecraft that is now the selected one: its row is not shown. */
export function rowOrder(items: readonly CompareItem[], hidden: string | null): string[] {
  const on = items.filter(i => i.h && i.n !== hidden).sort((a, b) => a.h! - b.h!);
  const off = items.filter(i => !i.h && i.n !== hidden);
  return [...on, ...off].map(i => i.n);
}

/** What a press of the panel's Fetch asks for: k of the waiting rows, and whether more will still wait ("Fetch 7 more") or
 *  these are the rest ("Fetch the rest (k)"). */
export function fetchPlan(waiting: number): { k: number; more: boolean } {
  return { k: Math.min(FETCH_PER_PRESS, Math.max(0, waiting)), more: waiting > FETCH_PER_PRESS };
}

/* ---- what can be drawn, and where -------------------------------------------------------------------------------- */

/** A history and its forecast, as far as the chart needs them: P the element sets (t ms, sma the mean altitude in km, ecc the
 *  mean eccentricity where the history carries it), r the prediction (tNow and hNow its last set; track the projection, t in days
 *  after tNow). */
export interface SeriesShape {
  readonly P: readonly { t: number; sma: number; ecc?: number | null }[];
  readonly r: { tNow?: number; hNow?: number; track?: readonly { t: number; h: number }[] | null };
}
export type NotDrawn = 'thin' | 'high';

/** Why a forecast is not drawn: too little history for even a last altitude, or too high for drag to matter. Null: it is drawn. */
export function notDrawn(r: SeriesShape['r'] | null | undefined): NotDrawn | null {
  if (!r || r.hNow === undefined || r.tNow === undefined) return 'thin';
  return r.hNow > DRAW_MAX_KM ? 'high' : null;
}
export const drawable = (r: SeriesShape['r'] | null | undefined): boolean => notDrawn(r) === null;

/** Where a series' projection ends (ms), or its last element set when it has none. */
export function seriesEnd(s: SeriesShape): number {
  const tr = s.r.track;
  return tr && tr.length ? s.r.tNow! + tr[tr.length - 1]!.t * DAY_MS : s.r.tNow!;
}

export interface Frame { t0: number; tEnd: number; hMin: number; hMax: number }

/** The chart's frame for these (drawable) series: tA the earliest last element set, tEnd the latest end of a projection (or of a
 *  record, for one with none), t0 = max(the first element set of all, tA - max(a year, tEnd - tA)). Heights are taken over what
 *  is in view (t >= t0) of each history and projection (the headline's own projection, not the two models' runs), with the
 *  height where a clipped line enters the view, padded by 8 % of the range and at least 4 km. Null with nothing to draw. */
export function frame(series: readonly SeriesShape[]): Frame | null {
  const S = series.filter(s => s.P.length && drawable(s.r));
  if (!S.length) return null;
  let tA = Infinity, tEnd = -Infinity, tFirst = Infinity;
  for (const s of S) {
    tA = Math.min(tA, s.r.tNow!);
    tEnd = Math.max(tEnd, seriesEnd(s));
    tFirst = Math.min(tFirst, s.P[0]!.t);
  }
  const t0 = Math.max(tFirst, tA - Math.max(YEAR_MS, tEnd - tA));
  let hMin = Infinity, hMax = -Infinity;
  const take = (h: number) => { if (h < hMin) hMin = h; if (h > hMax) hMax = h; };
  for (const s of S) {
    const P = s.P;
    for (let i = 0; i < P.length; i++) {
      const p = P[i]!;
      if (p.t < t0) continue;
      if (i > 0 && P[i - 1]!.t < t0) {                       // the line comes in from the left edge: where it enters
        const q = P[i - 1]!;
        take(q.sma + (p.sma - q.sma) * (t0 - q.t) / (p.t - q.t));
      }
      take(p.sma);
    }
    for (const p of s.r.track || []) if (s.r.tNow! + p.t * DAY_MS >= t0) take(p.h);
  }
  const pad = Math.max(4, (hMax - hMin) * 0.08);
  return { t0, tEnd: tEnd > t0 ? tEnd : t0 + DAY_MS, hMin: Math.max(0, hMin - pad), hMax: hMax + pad };
}

/** The height on the straight segment between the points of `xs` either side of x (xs sorted by x; x inside their span). */
function along<T>(xs: readonly T[], x: number, at: (p: T) => number, h: (p: T) => number): number {
  let lo = 0, hi = xs.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (at(xs[m]!) < x) lo = m + 1; else hi = m; }
  const b = xs[lo]!, a = lo > 0 ? xs[lo - 1]! : null;
  return !a || at(b) === x ? h(b) : h(a) + (h(b) - h(a)) * (x - at(a)) / (at(b) - at(a));
}

/** A series' value at instant t, read off the line the chart draws there (straight between two element sets, or between two
 *  points of the projection, which are 4 km of height apart): from the record while t is inside it, else from the projection;
 *  null before the record starts or past the projection's end. So the readout ranks the lines as they are drawn. */
export function valueAt(s: SeriesShape, t: number): { h: number; projected: boolean } | null {
  const P = s.P;
  if (!P.length || t < P[0]!.t) return null;
  if (t <= P[P.length - 1]!.t) return { h: along(P, t, p => p.t, p => p.sma), projected: false };
  const A = s.r.track;
  if (!A || !A.length || s.r.tNow === undefined) return null;
  const d = (t - s.r.tNow) / DAY_MS;
  if (d > A[A.length - 1]!.t) return null;
  return { h: along(A, d, p => p.t, p => p.h), projected: true };
}

/* ---- the chart's view: the quantity and the time range (L67) ------------------------------------------------------- */

/** WGS-84, the page's pair (km, km^3/s^2): lib/core/body.ts L31/L36 (Re and mu inside Earth()) and lib/planner/lifetime.ts L44
 *  (RE, MU), copied, because importing them would put a new export on the entry (body.ts) or pull in the lifetime chunk. A unit
 *  test pins them to Lifetime.RE and Lifetime.MU. */
export const RE = 6378.137, MU = 398600.4418;
/** The period (min) of an orbit whose mean altitude is h km: its semi-major axis is RE + h. */
export const periodMin = (h: number): number => 2 * Math.PI * Math.sqrt((RE + h) ** 3 / MU) / 60;
const meanMotion = (h: number): number => 1440 / periodMin(h);
const FLOOR_KM = 120;                     // the line where an object stops being in orbit (draw-compare.ts FLOOR)

/** How a quantity is drawn. */
export interface Measure {
  readonly proj: ((h: number) => number) | null;   // the projection in this quantity; null: history only
  readonly pad: number; readonly step: number;      // least padding of the value range; least grid step
  readonly floor: boolean; readonly min0: boolean;  // the 120 km line applies; the axis never goes below 0
}
/** The quantities. The forecast is of mean altitude, so only those worked out from it alone (the period and the mean motion) are
 *  projected; the least pads are about 4 km of altitude at 400 km. The decay rate can go above zero (a raised orbit). */
export const MEASURE: Readonly<Record<CmpParam, Measure>> = {
  alt: { proj: h => h, pad: 4, step: 1, floor: true, min0: true },
  hp: { proj: null, pad: 4, step: 1, floor: true, min0: true },
  ha: { proj: null, pad: 4, step: 1, floor: true, min0: true },
  rate: { proj: null, pad: 0.01, step: 0.001, floor: false, min0: false },
  ecc: { proj: null, pad: 0.00005, step: 0.00001, floor: false, min0: true },
  per: { proj: periodMin, pad: 0.08, step: 0.01, floor: false, min0: true },
  mm: { proj: meanMotion, pad: 0.014, step: 0.001, floor: false, min0: true }
};
/** whether the forecast is drawn in this quantity */
export const projects = (p: CmpParam): boolean => MEASURE[p].proj !== null;

/** An element set's eccentricity, NaN where it has none: NaN on a fresh read and from the API, null from the hist:<n> cache,
 *  absent in test fixtures (the global isFinite(null) is true, so it is not used). */
export function eccOf(row: { ecc?: number | null }): number {
  return typeof row.ecc === 'number' && Number.isFinite(row.ecc) ? row.ecc : NaN;
}

/** A line in one quantity: instants (ms) and values, NaN where there is none (the line breaks there). */
export interface Pts { readonly t: Float64Array; readonly v: Float64Array }

type Rows = SeriesShape['P'];
/* keyed by the history (or the projection's track) array: a new history is a new array, so it gets a new entry */
const ptsMemo = new WeakMap<object, Map<CmpParam, Pts>>();
const projMemo = new WeakMap<object, Map<CmpParam, Pts>>();
function memo(m: WeakMap<object, Map<CmpParam, Pts>>, key: object, p: CmpParam, make: () => Pts): Pts {
  let byP = m.get(key);
  if (!byP) m.set(key, byP = new Map());
  let q = byP.get(p);
  if (!q) byP.set(p, q = make());
  return q;
}

/** A history in a quantity, one value per element set (the decay rate: one per instant, rateSeries). Memoised per history. */
export function points(P: Rows, p: CmpParam): Pts {
  if (p === 'rate') return rateSeries(P);
  return memo(ptsMemo, P, p, () => {
    const n = P.length, t = new Float64Array(n), v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const row = P[i]!, h = row.sma;
      t[i] = row.t;
      if (p === 'alt') v[i] = h;
      else if (p === 'per') v[i] = periodMin(h);
      else if (p === 'mm') v[i] = meanMotion(h);
      else {
        const e = eccOf(row), a = RE + h;
        v[i] = p === 'ecc' ? e : p === 'hp' ? a * (1 - e) - RE : a * (1 + e) - RE;
      }
    }
    return { t, v };
  });
}

/** The projection in a quantity (t = tNow + days, v = the quantity at the projected mean altitude), or null when the quantity is
 *  not projected or there is no track. Memoised per track. */
export function projected(s: SeriesShape, p: CmpParam): Pts | null {
  const f = MEASURE[p].proj, A = s.r.track, tNow = s.r.tNow;
  if (!f || !A || !A.length || tNow === undefined) return null;
  return memo(projMemo, A, p, () => {
    const n = A.length, t = new Float64Array(n), v = new Float64Array(n);
    for (let i = 0; i < n; i++) { const q = A[i]!; t[i] = tNow + q.t * DAY_MS; v[i] = f(q.h); }
    return { t, v };
  });
}

/** the decay rate's window (days), the fewest element sets in it, and the most points drawn */
export const RATE_DAYS = 45, RATE_MIN_ROWS = 8, RATE_MAX_POINTS = 2000;
/* lifetime.ts L113's median, copied (that file is a verbatim port in another chunk) */
const med = (arr: number[]): number => { const s = arr.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };

/** The decay rate (km/day) at each instant of a history: the Decay section's own estimator (lifetime.ts calibrate(P, 45)) over
 *  the 45 days up to it, the median height and instant of the first and last fifth (two sets at least) of the window, without its
 *  "must be falling" rule (a raised orbit shows above zero) and without integrating. NaN with fewer than 8 sets in the window or
 *  its two ends 5 days apart or less. One point per instant (the last set of a run that shares one), every k-th counted back from
 *  the last past 2,000 of them. At the last set it is calibrate's figure exactly. Memoised per history. */
export function rateSeries(P: Rows): Pts {
  return memo(ptsMemo, P, 'rate', () => {
    const n = P.length, ep: number[] = [];
    for (let i = 0; i < n; i++) if (i === n - 1 || P[i + 1]!.t !== P[i]!.t) ep.push(i);
    const m = ep.length, k = Math.ceil(m / RATE_MAX_POINTS);
    const E = k > 1 ? ep.filter((_, j) => (m - 1 - j) % k === 0) : ep;
    const t = new Float64Array(E.length), v = new Float64Array(E.length);
    let lo = 0;
    E.forEach((i, j) => {
      const ti = P[i]!.t;
      while (P[lo]!.t < ti - RATE_DAYS * DAY_MS) lo++;
      t[j] = ti;
      const len = i - lo + 1;
      if (len < RATE_MIN_ROWS) { v[j] = NaN; return; }
      const q = Math.max(2, Math.floor(len / 5)), head = P.slice(lo, lo + q), tail = P.slice(i + 1 - q, i + 1);
      const h1 = med(head.map(r => r.sma)), h2 = med(tail.map(r => r.sma));
      const t1 = med(head.map(r => r.t)), t2 = med(tail.map(r => r.t));
      const dt = (t2 - t1) / DAY_MS;
      v[j] = dt > 5 ? (h2 - h1) / dt : NaN;
    });
    return { t, v };
  });
}

/** Where a line's dot goes: its last element set in this quantity (for mean altitude exactly where it goes today), or null. */
export function lastOf(s: SeriesShape, p: CmpParam): { t: number; v: number } | null {
  const f = MEASURE[p].proj, { tNow, hNow } = s.r;
  if (f) return tNow === undefined || hNow === undefined ? null : { t: tNow, v: p === 'alt' ? hNow : f(hNow) };
  const q = points(s.P, p);
  for (let i = q.t.length - 1; i >= 0; i--) if (Number.isFinite(q.v[i]!)) return { t: q.t[i]!, v: q.v[i]! };
  return null;
}

/** Where a line's end ring goes: the end of its projection when that reaches the 120 km floor, in a projected quantity; or null. */
export function ringOf(s: SeriesShape, p: CmpParam): { t: number; v: number } | null {
  const f = MEASURE[p].proj, A = s.r.track, e = A && A.length > 1 ? A[A.length - 1]! : null;
  return f && e && s.r.tNow !== undefined && e.h <= FLOOR_KM + .5 ? { t: s.r.tNow + e.t * DAY_MS, v: f(e.h) } : null;
}

const RANGE_DAYS: Readonly<Record<'30d' | '90d' | '1y', number>> = { '30d': 30, '90d': 90, '1y': 365 };

/** The time window of a range, over the drawable series fitted (the same set frame() takes), which never depends on the quantity:
 *  Auto is frame()'s; 30 d, 90 d and 1 y end at the newest element set (tLast), not clamped to the first; All runs from the first
 *  element set to the latest end of a projection. Null with nothing drawable. */
export function baseWindow(fit: readonly SeriesShape[], r: CmpRange): (Win & { tLast: number }) | null {
  const S = fit.filter(s => s.P.length && drawable(s.r));
  if (!S.length) return null;
  let tFirst = Infinity, tLast = -Infinity, tEnd = -Infinity;
  for (const s of S) {
    tFirst = Math.min(tFirst, s.P[0]!.t);
    tLast = Math.max(tLast, s.r.tNow!);
    tEnd = Math.max(tEnd, seriesEnd(s));
  }
  if (r === 'auto') { const f = frame(S)!; return { t0: f.t0, t1: f.tEnd, tLast }; }
  if (r === 'all') return { t0: tFirst, t1: tEnd > tFirst ? tEnd : tFirst + DAY_MS, tLast };
  return { t0: tLast - RANGE_DAYS[r] * DAY_MS, t1: tLast, tLast };
}

/** A frame with the window it was cut from: the range's own (base), whether a zoom is drawn, and the newest element set. */
export interface ViewFrame extends Frame { readonly base: Win; readonly zoomed: boolean; readonly tLast: number }

/* the values of a polyline inside [t0, t1], with the value where it comes in at t0 and where it leaves at t1; never across a NaN */
function extent(q: Pts, t0: number, t1: number, take: (v: number) => void): void {
  for (let i = 0; i < q.t.length; i++) {
    const t = q.t[i]!, v = q.v[i]!;
    if (t < t0) continue;
    const ok = Number.isFinite(v), pt = i > 0 ? q.t[i - 1]! : NaN, pv = i > 0 ? q.v[i - 1]! : NaN, pok = i > 0 && Number.isFinite(pv);
    if (pok && ok && pt < t0) take(pv + (v - pv) * (t0 - pt) / (t - pt));             // comes in at the left edge (as frame())
    if (t > t1) { if (pok && ok && i > 0) take(pv + (v - pv) * (t1 - pt) / (t - pt)); break; }   // leaves at the right edge
    if (ok) take(v);
  }
}

/** The chart's frame for a view: the range's window over the series fitted (`fit`, the legacy fitted set), or the zoom `win` when
 *  it lies inside that window and spans a day at least, and the heights over the values in view of the series in `yfit` that
 *  carry the quantity (their history, and their projection when the quantity is projected), padded by 8 % and at least the
 *  quantity's least pad. The default view (mean altitude, Auto, not zoomed) is frame() itself. `frame` is null with `why`:
 *  'param' when no series carries the quantity, 'range' when none has a value in the window. Null with nothing drawable. */
export function frameView(fit: readonly SeriesShape[], v: CmpView, win?: Win | null, yfit: readonly SeriesShape[] = fit): {
  frame: ViewFrame | null; why: 'param' | 'range' | null; t0: number; t1: number; base: Win; zoomed: boolean; tLast: number } | null {
  const B = baseWindow(fit, v.r);
  if (!B) return null;
  const base: Win = { t0: B.t0, t1: B.t1 }, tLast = B.tLast;
  const zoomed = !!win && win.t0 >= B.t0 && win.t1 <= B.t1 && win.t1 - win.t0 >= DAY_MS;
  const t0 = zoomed ? win!.t0 : B.t0, t1 = zoomed ? win!.t1 : B.t1;
  const at = { t0, t1, base, zoomed, tLast };
  /* the default does not move: the legacy frame, unchanged */
  if (v.p === 'alt' && v.r === 'auto' && !zoomed) return { ...at, frame: { ...frame(fit)!, base, zoomed: false, tLast }, why: null };
  const p = v.p, M = MEASURE[p];
  const Sp = yfit.filter(s => s.P.length && drawable(s.r) && points(s.P, p).v.some(x => Number.isFinite(x)));
  if (!Sp.length) return { ...at, frame: null, why: 'param' };
  let hMin = Infinity, hMax = -Infinity;
  const take = (h: number) => { if (h < hMin) hMin = h; if (h > hMax) hMax = h; };
  for (const s of Sp) {
    extent(points(s.P, p), t0, t1, take);
    const q = projected(s, p);
    if (q) extent(q, t0, t1, take);
  }
  if (!(hMin <= hMax)) return { ...at, frame: null, why: 'range' };
  const pad = Math.max(M.pad, (hMax - hMin) * 0.08);
  return {
    ...at, why: null,
    frame: { t0, tEnd: t1 > t0 ? t1 : t0 + DAY_MS, hMin: M.min0 ? Math.max(0, hMin - pad) : hMin - pad, hMax: hMax + pad, base, zoomed, tLast }
  };
}

/** A series' value of a quantity at instant t, read off the line the chart draws there: mean altitude is valueAt() itself; any
 *  other from its history (straight between two element sets, null where either is NaN), then, for a projected quantity, from
 *  the projection mapped into it; null before the history and past what is drawn. */
export function valueIn(s: SeriesShape, t: number, p: CmpParam): { h: number; projected: boolean } | null {
  if (p === 'alt') return valueAt(s, t);
  const q = points(s.P, p), n = q.t.length;
  if (!n || t < q.t[0]!) return null;
  if (t <= q.t[n - 1]!) {
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (q.t[m]! < t) lo = m + 1; else hi = m; }
    const vb = q.v[lo]!;
    if (q.t[lo] === t && Number.isFinite(vb)) return { h: vb, projected: false };
    if (lo === 0) return null;
    const ta = q.t[lo - 1]!, va = q.v[lo - 1]!, tb = q.t[lo]!;
    return Number.isFinite(va) && Number.isFinite(vb) ? { h: va + (vb - va) * (t - ta) / (tb - ta), projected: false } : null;
  }
  const f = MEASURE[p].proj, A = s.r.track;
  if (!f || !A || !A.length || s.r.tNow === undefined) return null;
  const d = (t - s.r.tNow) / DAY_MS;
  if (d > A[A.length - 1]!.t) return null;
  return { h: along(A, d, x => x.t, x => f(x.h)), projected: true };
}

/** A round step (1, 2 or 5 x 10^k) for about five grid lines over `span`, `least` at least. With least = 1 it is the chart's
 *  km step as it always was; a negative power of ten is divided out, so 0.0001 is 0.0001 and not 0.00009999999999999999. */
export function niceStep(span: number, least: number): number {
  const raw = span / 5, n = Math.floor(Math.log10(raw)), p = n >= 0 ? 10 ** n : 1 / 10 ** -n, e = raw / p;
  const m = e >= Math.sqrt(50) ? 10 : e >= Math.sqrt(10) ? 5 : e >= Math.SQRT2 ? 2 : 1;
  return Math.max(least, n >= 0 ? m * p : m / 10 ** -n);
}
/** the decimals a grid step needs */
export const stepDecimals = (step: number): number => (step >= 1 ? 0 : Math.ceil(-Math.log10(step) - 1e-9));

/** the most highlighted series that get their names written on the chart, the least plot width for it (px), and the least
 *  distance two names may sit apart (px) */
export const LABEL_MAX = 4;
export const LABEL_MIN_PLOT = 400;
export const LABEL_GAP = 13;

/** Where the names go: each at its series' last element set (x, y: the dot), right-aligned 6 px to its left and 6 px above, `w`
 *  wide. All or none: none with more than four, with a plot under 400 px, with a name that would leave the plot, or with any two
 *  closer than 13 px (baselines under 13 px apart while their spans come within 13 px of each other). A name is never nudged
 *  away from its line to make room. */
export function labelPlan(at: readonly { x: number; y: number; w: number }[], plot: { left: number; right: number; top: number }): { x: number; y: number }[] | null {
  if (!at.length || at.length > LABEL_MAX || plot.right - plot.left < LABEL_MIN_PLOT) return null;
  const out = at.map(a => ({ x: a.x - 6, y: a.y - 6, w: a.w }));
  if (out.some(o => o.x - o.w < plot.left || o.x > plot.right || o.y - 9 < plot.top)) return null;
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i]!, b = out[j]!;
    const gapX = Math.max(a.x - a.w - b.x, b.x - b.w - a.x, 0);
    if (Math.abs(a.y - b.y) < LABEL_GAP && gapX < LABEL_GAP) return null;
  }
  return out.map(o => ({ x: o.x, y: o.y }));
}

/** The hover's rows, highest first (a stable sort: two at the same height keep their order). */
export const tipOrder = <T extends { h: number }>(rows: readonly T[]): T[] => rows.slice().sort((a, b) => b.h - a.h);

/** A name cut to `max` characters, the last of them an ellipsis. */
export function shortName(name: string, max = 18): string {
  const c = [...name];
  return c.length > max ? c.slice(0, max - 1).join('') + '…' : name;
}
