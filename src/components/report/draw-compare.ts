import type { Geom } from './draw-life';
import { DAY_MS, drawable, frame, labelPlan, shortName, tipOrder, valueAt, type SeriesShape } from '../../lib/decay/compare';
import {
  CMP_KEY_OBSERVED, CMP_KEY_PROJECTED, CMP_REENTRY, cmpChartName, cmpDay, cmpGrey, cmpKm, cmpMonth, cmpOthers
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

const HC = 320;
const L = 46, R = 30, T = 14, B = 26;     // draw-life's margins: R leaves room for the last date label
const FONT = '11px "IBM Plex Mono",monospace';
const FLOOR = 120;                        // km: the line where an object stops being in orbit

/** A round step (1, 2 or 5 x 10^k km, 1 km at least) for about five grid lines over `span` km. */
function tickStep(span: number): number {
  const raw = span / 5, p = 10 ** Math.floor(Math.log10(raw)), e = raw / p;
  return Math.max(1, (e >= Math.sqrt(50) ? 10 : e >= Math.sqrt(10) ? 5 : e >= Math.SQRT2 ? 2 : 1) * p);
}

/** The lines that can be drawn: the grey ones in the order given, and the coloured ones by slot (the selected one first). */
function sortLines(lines: readonly CmpSeries[]): { grey: CmpSeries[]; col: CmpSeries[] } {
  const S = lines.filter(s => s.P.length && drawable(s.r));
  return { grey: S.filter(s => !(s.slot >= 1)), col: S.filter(s => s.slot >= 1).sort((a, b) => a.slot - b.slot) };
}

/** Draw the comparison and return the canvas's name, its geometry (for the hover) and whether the names were written on it. With
 *  nothing to draw, a dash. */
export function drawCompare(cv: HTMLCanvasElement, lines: readonly CmpSeries[], c: CmpColors): { label: string; geom: Geom | null; labelled: boolean } {
  const g = cv.getContext('2d')!;
  const Wc = Math.max(280, Math.round(cv.getBoundingClientRect().width)), Hc = HC;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Wc * dpr; cv.height = Hc * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, Wc, Hc);

  const { grey, col } = sortLines(lines);
  const all = [...col, ...grey];
  /* the spacecraft are named when they are four or fewer, all of them: a count followed by some of the names would read as all */
  const label = cmpChartName(all.length, all.length > 0 && all.length <= 4 ? all.map(s => s.name) : null);
  /* fitted to the coloured lines when there are any: a grey one is context, clipped to the plot, and a high flat one or a long
     slow projection would otherwise squeeze every coloured line into a few pixels */
  const f = frame(col.length ? col : grey);
  if (!f) {
    g.fillStyle = c.muted; g.font = '12px "IBM Plex Mono",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('—', Wc / 2, Hc / 2);
    return { label, geom: null, labelled: false };
  }
  const { t0, tEnd, hMin, hMax } = f;
  const X = (t: number) => L + (t - t0) / (tEnd - t0) * (Wc - L - R);
  const Y = (v: number) => T + (hMax - v) / (hMax - hMin) * (Hc - T - B);

  // grid + y labels, at round heights
  g.strokeStyle = c.rule; g.lineWidth = 1; g.font = FONT;
  g.fillStyle = c.muted; g.textAlign = 'right'; g.textBaseline = 'middle';
  const step = tickStep(hMax - hMin);
  for (let v = Math.ceil(hMin / step) * step; v <= hMax; v += step) {
    const y = Y(v);
    g.globalAlpha = .5; g.beginPath(); g.moveTo(L, y); g.lineTo(Wc - R, y); g.stroke();
    g.globalAlpha = 1; g.fillText(v.toFixed(0), L - 7, y);
  }
  /* x labels, the outer two anchored inward; on the alphabetic baseline, where draw-life's 'top' ones sit. Four, or three where four
     would run into each other (a phone): the first centred one keeps 8 px from the left one */
  g.textBaseline = 'alphabetic';
  const k = Math.min(3, Math.max(1, Math.floor((Wc - L - R) / (1.5 * g.measureText(cmpMonth(t0)).width + 8))));
  for (let i = 0; i <= k; i++) {
    const t = t0 + (tEnd - t0) * i / k;
    g.textAlign = i === 0 ? 'left' : i === k ? 'right' : 'center';
    g.fillText(cmpMonth(t), X(t), Hc - B + 16);
  }
  // the 120 km line
  if (hMin <= FLOOR) {
    g.strokeStyle = c.muted; g.lineWidth = 1.4; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(L, Y(FLOOR)); g.lineTo(Wc - R, Y(FLOOR)); g.stroke(); g.setLineDash([]);
    g.fillStyle = c.muted; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText(CMP_REENTRY, L + 5, Y(FLOOR) - 3);
  }

  /* The record from the last element set before the frame's start (so the line comes in from the left edge), and the projection. */
  const history = (s: CmpSeries) => {
    const P = s.P;
    let lo = 0, hi = P.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P[m]!.t < t0) lo = m + 1; else hi = m; }
    const from = Math.max(0, lo - 1);
    g.beginPath();
    for (let i = from; i < P.length; i++) { const x = X(P[i]!.t), y = Y(P[i]!.sma); i > from ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  };
  const projection = (s: CmpSeries) => {
    const A = s.r.track;
    if (!A || A.length < 2) return;
    g.beginPath();
    A.forEach((p, i) => { const x = X(s.r.tNow! + p.t * DAY_MS), y = Y(p.h); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  };

  g.save();
  g.beginPath(); g.rect(L, T, Wc - L - R, Hc - T - B); g.clip();
  g.lineJoin = 'round';
  // the grey context lines first, thin and faint
  g.strokeStyle = c.muted; g.lineWidth = 1; g.globalAlpha = .45;
  for (const s of grey) { g.setLineDash([]); history(s); g.setLineDash([3, 3]); projection(s); }
  g.setLineDash([]); g.globalAlpha = 1;
  // then the coloured ones by slot, the selected one last and a pixel heavier
  const drawn = [...col.filter(s => s.slot !== 1), ...col.filter(s => s.slot === 1)];
  for (const s of drawn) {
    g.strokeStyle = colorOf(c, s.slot); g.lineWidth = s.slot === 1 ? 3 : 2;
    g.setLineDash([6, 3]); projection(s);
    g.setLineDash([]); history(s);
  }
  g.restore();

  // the dots at the last element sets, and the rings where a projection reaches the floor
  for (const s of drawn) {
    const k = colorOf(c, s.slot), x = X(s.r.tNow!), y = Y(s.r.hNow!);
    g.fillStyle = c.panel; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    g.fillStyle = k; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    const A = s.r.track, e = A && A.length > 1 ? A[A.length - 1]! : null;
    if (e && e.h <= FLOOR + .5) {
      const xe = X(s.r.tNow! + e.t * DAY_MS), ye = Y(e.h);
      g.fillStyle = c.panel; g.beginPath(); g.arc(xe, ye, 6, 0, 7); g.fill();
      g.strokeStyle = k; g.lineWidth = 2; g.beginPath(); g.arc(xe, ye, 3, 0, 7); g.stroke();
    }
  }

  // the names, at the dots, all or none
  g.font = FONT;
  const names = drawn.map(s => shortName(s.name));
  const plan = labelPlan(drawn.map((s, i) => ({ x: X(s.r.tNow!), y: Y(s.r.hNow!), w: g.measureText(names[i]!).width })),
    { left: L, right: Wc - R, top: T });
  if (plan) {
    g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.lineJoin = 'round'; g.miterLimit = 2; g.lineWidth = 3; g.strokeStyle = c.panel; g.fillStyle = c.ink2;
    plan.forEach((p, i) => { g.strokeText(names[i]!, p.x, p.y); g.fillText(names[i]!, p.x, p.y); });
  }

  return { label, geom: { X, Y, L, R, T, B, Wc, Hc, t0, tEnd, hMin, hMax }, labelled: !!plan };
}

/** The key under the chart: the coloured lines (the selected one first, then by slot), "N others" for the grey ones ("N spacecraft"
 *  when none is in colour), and the two line styles. Nothing with nothing drawn. */
export function compareKey(lines: readonly CmpSeries[], c: CmpColors): CmpKeyItem[] {
  const { grey, col } = sortLines(lines);
  if (!grey.length && !col.length) return [];
  const key: CmpKeyItem[] = col.map(s => ({ color: colorOf(c, s.slot), text: s.name }));
  if (grey.length) key.push({ color: c.muted, text: col.length ? cmpOthers(grey.length) : cmpGrey(grey.length), grey: true });
  key.push({ color: c.muted, text: CMP_KEY_OBSERVED }, { color: c.muted, text: CMP_KEY_PROJECTED, dashed: true });
  return key;
}

/** The hover's readout at a pointer position x (CSS px from the canvas's left edge): the day, then each coloured line's value there,
 *  highest first (the grey lines are not read). Null outside the plot. */
export function compareTipAt(geom: Geom, lines: readonly CmpSeries[], x: number, c: CmpColors): { x: number; t: number; day: string; rows: CmpTipRow[] } | null {
  if (x < geom.L || x > geom.Wc - geom.R) return null;
  const t = geom.t0 + (x - geom.L) / (geom.Wc - geom.L - geom.R) * (geom.tEnd - geom.t0);
  const rows: CmpTipRow[] = [];
  for (const s of sortLines(lines).col) {
    const v = valueAt(s, t);
    if (v) rows.push({ n: s.n, color: colorOf(c, s.slot), value: cmpKm(v.h), name: shortName(s.name), projected: v.projected, h: v.h });
  }
  return { x, t, day: cmpDay(t), rows: tipOrder(rows) };
}
