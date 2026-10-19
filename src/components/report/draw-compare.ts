import type { Geom } from './draw-life';
import {
  DAY_MS, drawable, frameView, labelPlan, lastOf, MEASURE, niceStep, points, projected, projects, ringOf, shortName, stepDecimals,
  tipOrder, valueIn, type CmpParam, type CmpRange, type SeriesShape, type Win
} from '../../lib/decay/compare';
import {
  CMP_KEY_OBSERVED, CMP_KEY_PROJECTED, CMP_REENTRY, cmpChartName, cmpDay, cmpGrey, cmpMonth, cmpOthers, cmpTick, cmpValue
} from '../../lib/text/life-compare';

/* The decay comparison's chart (CHANGES-FROM-LEGACY.md, L66): many spacecraft's mean altitude histories and projected decay on one
 * canvas of its own (#cmpcv), under the comparison's list. New in the rebuild. The Decay section's own chart (#lifecv, draw-life.ts)
 * is not touched: this one is drawn beside it with the same idiom (fonts, grid, margins, km on the left, YYYY-MM along the bottom),
 * and only draw-life's types are borrowed.
 *
 * What differs from the single chart, and why:
 * - The frame is fitted to the decay, not to every record (lib/decay/compare.ts frame()): a year or more of the past before the
 *   earliest last element set, to the latest end of a projection. Older history runs in from the left edge, clipped to the plot.
 *   It is fitted to the lines in colour (to the grey ones only when none is): a grey line is context, clipped like old history.
 * - Up to eight lines are in colour: the selected spacecraft in slot 1, the page's cyan (--track), drawn last and a pixel heavier,
 *   so it can be told apart without its hue; up to seven others in slots 2..8. Every further line with a forecast is a thin grey
 *   context line, drawn first, with no dot and no name. Never a ninth hue.
 * - Each coloured line has a dot at its last element set (radius 4, with a 2 px ring of the panel's colour), and a ring of the same
 *   size where its projection reaches the 120 km floor. There is no "now" line: each dot marks its own last set.
 * - Names are written on the chart at the dots only when all of them fit (four at most, a plot at least 400 px wide, no two within
 *   13 px), with a halo of the panel's colour; otherwise none, and the key under the chart names them. A name is never moved away
 *   from its line to make room. No text is drawn with textBaseline 'top'.
 *
 * The view (L67): the chart can show another quantity than mean altitude (lib/decay/compare.ts MEASURE) over another time window
 * (a range, or a zoom inside it). The window is cut from the same lines as the frame above, so it never depends on the quantity;
 * the heights are fitted to the lines that carry the quantity. A line with no value of it is not drawn, named or keyed; a missing
 * value breaks a line rather than bridging it; the forecast is drawn only in a quantity it converts into (the period, the mean
 * motion); a dot or ring outside the window is left out, and then no name is written. The left margin widens for longer labels
 * (eccentricity's), and the bottom labels are days where months would repeat. The default view (Auto, mean altitude) draws what
 * it drew before, call for call, but for those day labels on a span too short for distinct months.
 *
 * The colours: slot 1 is --track as the page has it; slots 2..8 are constants for each theme (the dataviz reference palette,
 * checked against --panel #FFFFFF and #121A20: adjacent pairs at least dE 9.1 / 8.4 under colour-vision deficiency and 19.6 / 19.3
 * for normal vision). The same constants colour the list's row swatches.
 *
 * Travels with the comparison's chunk (DecayCompare), with the model and its words. */

export type Theme = 'light' | 'dark';

/** the colours of slots 2..8, by theme */
export const CMP_PALETTE: Readonly<Record<Theme, readonly string[]>> = {
  light: ['#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
};

/** The chart's colours: the page's ink, grid and panel, and the eight line colours (slots[0] is slot 1, the selected spacecraft's). */
export interface CmpColors { ink2: string; muted: string; rule: string; panel: string; slots: readonly string[] }

/** The colours for the theme now shown: slot 1 is the page's --track, the rest are CMP_PALETTE's. */
export function readCmpColors(theme: Theme): CmpColors {
  const s = getComputedStyle(document.documentElement);
  const t = (n: string) => s.getPropertyValue(n).trim();
  return { ink2: t('--ink2'), muted: t('--muted'), rule: t('--rule'), panel: t('--panel'), slots: [t('--track'), ...CMP_PALETTE[theme]] };
}

/** A slot's colour: 1..8 the line colours, anything else (0, a grey line) the muted grey. */
export const colorOf = (c: CmpColors, slot: number): string => (slot >= 1 && c.slots[slot - 1]) || c.muted;

/** A line to draw: a listed spacecraft's history and forecast, its colour slot (1 the selected one, 2..8 highlighted, 0 grey) and
 *  its name. */
export interface CmpSeries extends SeriesShape { readonly n: string; readonly slot: number; readonly name: string }
/** An item of the key under the chart. */
export interface CmpKeyItem { color: string; text: string; dashed?: boolean; grey?: boolean }
/** A row of the hover's readout: the value first, then the name; `projected` when the value is the projection's. */
export interface CmpTipRow { n: string; color: string; value: string; name: string; projected: boolean; h: number }

/** What to draw: the quantity (mean altitude when left out), the range (Auto) and a zoom inside the range's window, if any. */
export interface DrawView { readonly p?: CmpParam; readonly r?: CmpRange; readonly win?: Win | null }
/** The drawn chart's geometry, with the quantity it shows (the readout reads that one). */
export interface CmpGeom extends Geom { readonly p: CmpParam }
/** What was drawn, for the caption: the quantity, the window (t0..t1), the range's own window, whether a zoom is drawn, the newest
 *  element set, and why nothing is drawn when the frame is empty ('param': no line carries the quantity; 'range': none has a value
 *  in the window). */
export interface DrawInfo {
  readonly p: CmpParam; readonly t0: number; readonly t1: number; readonly base: Win; readonly zoomed: boolean;
  readonly tLast: number; readonly why: 'param' | 'range' | null;
}

const HC = 320;
const L0 = 46, R = 30, T = 14, B = 26;    // draw-life's margins (L0 the least left one): R leaves room for the last date label
const FONT = '11px "IBM Plex Mono",monospace';
const FLOOR = 120;                        // km: the line where an object stops being in orbit

/** The lines that can be drawn: the grey ones in the order given, and the coloured ones by slot (the selected one first). */
function sortLines(lines: readonly CmpSeries[]): { grey: CmpSeries[]; col: CmpSeries[] } {
  const S = lines.filter(s => s.P.length && drawable(s.r));
  return { grey: S.filter(s => !(s.slot >= 1)), col: S.filter(s => s.slot >= 1).sort((a, b) => a.slot - b.slot) };
}
/** those of the lines that have a value of quantity p somewhere (for mean altitude, every one) */
const carrying = (S: readonly CmpSeries[], p: CmpParam): CmpSeries[] => S.filter(s => points(s.P, p).v.some(Number.isFinite));

/** Draw the comparison in a view (mean altitude over Auto when none is given) and return the canvas's name, its geometry (for the
 *  hover), whether the names were written on it, and what was drawn (for the caption). With nothing to draw, a dash: `info` is
 *  null when no line is drawable at all, and says why when the view holds nothing. */
export function drawCompare(cv: HTMLCanvasElement, lines: readonly CmpSeries[], c: CmpColors, view: DrawView = {}):
  { label: string; geom: CmpGeom | null; labelled: boolean; info: DrawInfo | null } {
  const g = cv.getContext('2d')!;
  const Wc = Math.max(280, Math.round(cv.getBoundingClientRect().width)), Hc = HC;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Wc * dpr; cv.height = Hc * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, Wc, Hc);

  const p = view.p ?? 'alt', M = MEASURE[p];
  const { grey, col } = sortLines(lines);
  /* a line with no value of the quantity is not drawn, counted or named */
  const colP = carrying(col, p), greyP = carrying(grey, p);
  const all = [...colP, ...greyP];
  /* the spacecraft are named when they are four or fewer, all of them: a count followed by some of the names would read as all */
  const label = cmpChartName(all.length, all.length > 0 && all.length <= 4 ? all.map(s => s.name) : null, p);
  /* the window is cut from the coloured lines when there are any (a grey one is context, clipped to the plot, and a high flat one
     or a long slow projection would otherwise squeeze every coloured line into a few pixels), whatever the quantity; the heights
     are fitted to those of them that carry it */
  const F = frameView(col.length ? col : grey, { p, r: view.r ?? 'auto' }, view.win, colP.length ? colP : greyP);
  if (!F || !F.frame) {
    g.fillStyle = c.muted; g.font = '12px "IBM Plex Mono",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('—', Wc / 2, Hc / 2);
    return { label, geom: null, labelled: false, info: F && { p, t0: F.t0, t1: F.t1, base: F.base, zoomed: F.zoomed, tLast: F.tLast, why: F.why } };
  }
  const { t0, tEnd, hMin, hMax } = F.frame;
  const info: DrawInfo = { p, t0: F.t0, t1: F.t1, base: F.base, zoomed: F.zoomed, tLast: F.tLast, why: null };

  /* the grid's round values, and the left margin their labels need: mean altitude's always fit in draw-life's 46 px */
  const step = niceStep(hMax - hMin, M.step), dec = stepDecimals(step);
  const ticks: number[] = [];
  for (let i = Math.ceil(hMin / step); i * step <= hMax; i++) ticks.push(i * step);
  g.font = FONT;
  const L = p === 'alt' ? L0 : Math.max(L0, Math.ceil(Math.max(...ticks.map(v => g.measureText(cmpTick(v, dec)).width))) + 13);
  const X = (t: number) => L + (t - t0) / (tEnd - t0) * (Wc - L - R);
  const Y = (v: number) => T + (hMax - v) / (hMax - hMin) * (Hc - T - B);

  // grid + y labels, at round values
  g.strokeStyle = c.rule; g.lineWidth = 1;
  g.fillStyle = c.muted; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of ticks) {
    const y = Y(v);
    g.globalAlpha = .5; g.beginPath(); g.moveTo(L, y); g.lineTo(Wc - R, y); g.stroke();
    g.globalAlpha = 1; g.fillText(cmpTick(v, dec), L - 7, y);
  }
  /* x labels, the outer two anchored inward; on the alphabetic baseline, where draw-life's 'top' ones sit. Four, or three where four
     would run into each other (a phone): the first centred one keeps 8 px from the left one. Months while they are 31 days apart
     or more (two such instants never share a month); else days, at least a day apart (so never the same day twice) */
  g.textBaseline = 'alphabetic';
  const plotW = Wc - L - R, fits = (s: string) => Math.max(1, Math.floor(plotW / (1.5 * g.measureText(s).width + 8)));
  const kM = Math.min(3, fits(cmpMonth(t0))), months = (tEnd - t0) / kM >= 31 * DAY_MS;
  const k = months ? kM : Math.min(3, fits(cmpDay(t0)), Math.max(1, Math.floor((tEnd - t0) / DAY_MS)));
  const tick = months ? cmpMonth : cmpDay;
  for (let i = 0; i <= k; i++) {
    const t = t0 + (tEnd - t0) * i / k;
    g.textAlign = i === 0 ? 'left' : i === k ? 'right' : 'center';
    g.fillText(tick(t), X(t), Hc - B + 16);
  }
  // the 120 km line, in a height (its words go over the lines, below)
  const floor = M.floor && hMin <= FLOOR;
  if (floor) {
    g.strokeStyle = c.muted; g.lineWidth = 1.4; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(L, Y(FLOOR)); g.lineTo(Wc - R, Y(FLOOR)); g.stroke(); g.setLineDash([]);
  }

  /* The record in the quantity from the last element set before the window (so the line comes in from the left edge) to the first
     after it (so it leaves through the right one), a missing value ending the stroke's piece there; and the projection in it. */
  const history = (s: CmpSeries) => {
    const q = points(s.P, p), n = q.t.length;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (q.t[m]! < t0) lo = m + 1; else hi = m; }
    const from = Math.max(0, lo - 1);
    g.beginPath();
    let pen = false;
    for (let i = from; i < n; i++) {
      const v = q.v[i]!;
      if (!Number.isFinite(v)) pen = false;
      else { const x = X(q.t[i]!), y = Y(v); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; }
      if (q.t[i]! > tEnd) break;
    }
    g.stroke();
  };
  const projection = (s: CmpSeries) => {
    const q = projected(s, p);
    if (!q || q.t.length < 2) return;
    g.beginPath();
    for (let i = 0; i < q.t.length; i++) { const x = X(q.t[i]!), y = Y(q.v[i]!); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  };

  g.save();
  g.beginPath(); g.rect(L, T, Wc - L - R, Hc - T - B); g.clip();
  g.lineJoin = 'round';
  // the grey context lines first, thin and faint
  g.strokeStyle = c.muted; g.lineWidth = 1; g.globalAlpha = .45;
  for (const s of greyP) { g.setLineDash([]); history(s); g.setLineDash([3, 3]); projection(s); }
  g.setLineDash([]); g.globalAlpha = 1;
  // then the coloured ones by slot, the selected one last and a pixel heavier
  const drawn = [...colP.filter(s => s.slot !== 1), ...colP.filter(s => s.slot === 1)];
  for (const s of drawn) {
    g.strokeStyle = colorOf(c, s.slot); g.lineWidth = s.slot === 1 ? 3 : 2;
    g.setLineDash([6, 3]); projection(s);
    g.setLineDash([]); history(s);
  }
  g.restore();

  /* the 120 km line's words, over the lines on the names' halo of the panel's colour (on a phone the projections that end near the
     left run through them), under the dots and rings */
  if (floor) {
    g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.lineJoin = 'round'; g.miterLimit = 2; g.lineWidth = 3; g.strokeStyle = c.panel; g.fillStyle = c.muted;
    g.strokeText(CMP_REENTRY, L + 5, Y(FLOOR) - 3); g.fillText(CMP_REENTRY, L + 5, Y(FLOOR) - 3);
  }

  /* the dots at the last element sets, and the rings where a projection reaches the floor: each only inside the window */
  const inView = (t: number) => t >= t0 && t <= tEnd;
  const dots = drawn.map(s => { const d = lastOf(s, p); return d && inView(d.t) ? d : null; });
  drawn.forEach((s, i) => {
    const k = colorOf(c, s.slot), d = dots[i], e = ringOf(s, p);
    if (d) {
      const x = X(d.t), y = Y(d.v);
      g.fillStyle = c.panel; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      g.fillStyle = k; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    }
    if (e && inView(e.t)) {
      const xe = X(e.t), ye = Y(e.v);
      g.fillStyle = c.panel; g.beginPath(); g.arc(xe, ye, 6, 0, 7); g.fill();
      g.strokeStyle = k; g.lineWidth = 2; g.beginPath(); g.arc(xe, ye, 3, 0, 7); g.stroke();
    }
  });

  // the names, at the dots, all or none: none when a dot is outside the window
  g.font = FONT;
  const names = drawn.map(s => shortName(s.name));
  const plan = dots.every(d => d)
    ? labelPlan(drawn.map((_, i) => ({ x: X(dots[i]!.t), y: Y(dots[i]!.v), w: g.measureText(names[i]!).width })), { left: L, right: Wc - R, top: T })
    : null;
  if (plan) {
    g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.lineJoin = 'round'; g.miterLimit = 2; g.lineWidth = 3; g.strokeStyle = c.panel; g.fillStyle = c.ink2;
    plan.forEach((q, i) => { g.strokeText(names[i]!, q.x, q.y); g.fillText(names[i]!, q.x, q.y); });
  }

  return { label, geom: { X, Y, L, R, T, B, Wc, Hc, t0, tEnd, hMin, hMax, p }, labelled: !!plan, info };
}

/** The key under the chart for quantity p: the coloured lines that carry it (the selected one first, then by slot), "N others" for
 *  the grey ones ("N spacecraft" when none is in colour), the observed line's style, and the projected one's in a quantity the
 *  forecast is drawn in. Nothing with nothing drawn. */
export function compareKey(lines: readonly CmpSeries[], c: CmpColors, p: CmpParam = 'alt'): CmpKeyItem[] {
  const { grey, col } = sortLines(lines), greyP = carrying(grey, p), colP = carrying(col, p);
  if (!greyP.length && !colP.length) return [];
  const key: CmpKeyItem[] = colP.map(s => ({ color: colorOf(c, s.slot), text: s.name }));
  if (greyP.length) key.push({ color: c.muted, text: colP.length ? cmpOthers(greyP.length) : cmpGrey(greyP.length), grey: true });
  key.push({ color: c.muted, text: CMP_KEY_OBSERVED });
  if (projects(p)) key.push({ color: c.muted, text: CMP_KEY_PROJECTED, dashed: true });
  return key;
}

/** The hover's readout at a pointer position x (CSS px from the canvas's left edge), in the quantity drawn: the day, then each
 *  coloured line's value there, highest first (the grey lines are not read). Null outside the plot. */
export function compareTipAt(geom: CmpGeom, lines: readonly CmpSeries[], x: number, c: CmpColors): { x: number; t: number; day: string; rows: CmpTipRow[] } | null {
  if (x < geom.L || x > geom.Wc - geom.R) return null;
  const t = geom.t0 + (x - geom.L) / (geom.Wc - geom.L - geom.R) * (geom.tEnd - geom.t0);
  const p = geom.p, rows: CmpTipRow[] = [];
  for (const s of carrying(sortLines(lines).col, p)) {
    const v = valueIn(s, t, p);
    if (v) rows.push({ n: s.n, color: colorOf(c, s.slot), value: cmpValue(p, v.h), name: shortName(s.name), projected: v.projected, h: v.h });
  }
  return { x, t, day: cmpDay(t), rows: tipOrder(rows) };
}
