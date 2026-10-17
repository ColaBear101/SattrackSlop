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

/** A listed spacecraft: its catalogue number as the catalogue writes it (five digits, zero-padded, as entry.satnum and the
 *  hist:<n> cache key), and the colour slot it is highlighted in. */
export interface CompareItem { readonly n: string; readonly h?: number }
export interface CompareRecord { open: boolean; items: CompareItem[] }

/** A catalogue number as the catalogue writes it, or null for anything else. */
export function compareNum(x: unknown): string | null {
  return typeof x === 'string' && NUM.test(x) ? x.padStart(5, '0') : null;
}

const isSlot = (h: unknown): h is number => Number.isInteger(h) && (h as number) >= SLOT_FIRST && (h as number) <= SLOT_LAST;

/** The stored record, {"o":1,"l":[{"n":"25544","h":2},{"n":"07530"}]}, read as far as it can be: anything that is not one is an
 *  empty, closed list; a number that is not a catalogue number is left out, and so is a second copy of one; past 50 the rest
 *  are left out; a slot that is not 2..8, or one already taken by a row above it, is dropped (the row stays, not highlighted). */
export function readCompare(raw: string | null): CompareRecord {
  let j: unknown;
  try { j = JSON.parse(raw ?? 'null'); } catch { return { open: false, items: [] }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { open: false, items: [] };
  const rec = j as { o?: unknown; l?: unknown };
  const items: CompareItem[] = [], seen = new Set<string>(), slots = new Set<number>();
  for (const x of Array.isArray(rec.l) ? rec.l : []) {
    if (items.length >= COMPARE_MAX) break;
    const n = x && typeof x === 'object' ? compareNum((x as { n?: unknown }).n) : null;
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const h = (x as { h?: unknown }).h;
    if (isSlot(h) && !slots.has(h)) { slots.add(h); items.push({ n, h }); } else items.push({ n });
  }
  return { open: rec.o === 1, items };
}

/** The record as it is stored. */
export function writeCompare(open: boolean, items: readonly CompareItem[]): string {
  return JSON.stringify({ o: open ? 1 : 0, l: items.map(i => (i.h ? { n: i.n, h: i.h } : { n: i.n })) });
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

/** A history and its forecast, as far as the chart needs them: P the element sets (t ms, sma the mean altitude in km), r the
 *  prediction (tNow and hNow its last set; track the projection, t in days after tNow). */
export interface SeriesShape {
  readonly P: readonly { t: number; sma: number }[];
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

/** A series' value at instant t: the element set at or after t while t is inside the record, else the projection's point at or
 *  after it (draw-life's hover reads the single chart the same way); null before the record starts or past the projection's end. */
export function valueAt(s: SeriesShape, t: number): { h: number; projected: boolean } | null {
  const P = s.P;
  if (!P.length || t < P[0]!.t) return null;
  if (t <= P[P.length - 1]!.t) {
    let lo = 0, hi = P.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P[m]!.t < t) lo = m + 1; else hi = m; }
    return { h: P[lo]!.sma, projected: false };
  }
  const A = s.r.track;
  if (!A || !A.length || s.r.tNow === undefined) return null;
  const d = (t - s.r.tNow) / DAY_MS;
  if (d > A[A.length - 1]!.t) return null;
  let lo = 0, hi = A.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (A[m]!.t < d) lo = m + 1; else hi = m; }
  return { h: A[lo]!.h, projected: true };
}

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
