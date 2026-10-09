import { iso } from '../../lib/text/fmt';
import { lifeAxis } from '../../lib/text/life';
import type { LifeChartState } from '../../lib/text/life-offer';

/* The decay chart: one axis, altitude. Observed history, then the projection, then the 120 km line where the object stops
 * being in orbit; the band between the two models; "now". Moved from drawLife() and lifeHover() in legacy/index.html
 * (main@4eadd7a), lines 11971-12127, with their comments: the drawing, the order of the layers and every figure are the
 * original's. What changed is where things come from: colours are read once and passed in, the canvas is an argument, the
 * key is returned as data instead of written into the page, and the hover readout is a function of the pointer's x. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface LifeColors { ink: string; muted: string; rule: string; track: string; contact: string; obs: string }
export function readLifeColors(): LifeColors {
  const s = getComputedStyle(document.documentElement);
  const t = (n: string) => s.getPropertyValue(n).trim();
  return { ink: t('--ink'), muted: t('--muted'), rule: t('--rule'), track: t('--track'), contact: t('--contact'), obs: t('--observer') };
}


export interface Geom { X: (t: number) => number; Y: (v: number) => number; L: number; R: number; T: number; B: number; Wc: number; Hc: number; t0: number; tEnd: number; hMin: number; hMax: number }
export interface KeyItem { color: string; opacity?: number; text: string }

/** Draw the chart and return its geometry (for the hover) and its key. With nothing to show, a dash. */
export function drawLife(cv: HTMLCanvasElement, st: LifeChartState | null, c: LifeColors): { geom: Geom | null; key: KeyItem[] } {
  const g = cv.getContext('2d')!;
  const box = cv.getBoundingClientRect();
  const Wc = Math.max(280, Math.round(box.width)), Hc = 290;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Wc * dpr; cv.height = Hc * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, Wc, Hc);
  const L = 46, R = 30, T = 14, B = 26;   // R leaves room for the last date label
  const { ink: _ink, muted, rule, track, contact, obs } = c;
  if (!st || !st.r || st.r.hNow === undefined) {
    g.fillStyle = muted; g.font = '12px "IBM Plex Mono",monospace'; g.textAlign = 'center';
    g.fillText('—', Wc / 2, Hc / 2); return { geom: null, key: [] };
  }
  const { P, r } = st;
  const proj = r.track || null;
  /* A planned orbit's forecast: the axis runs to the END OF THE LONGEST of the three runs. The stock code takes the end from
     the mid-case run, but here the x1/3 run is three times longer and is the one that sets the headline's upper bound, so most
     of the band would be clipped at the canvas edge; and the bottom of the height range takes in all three, since the x3 run
     drops below the mid-case one. No calendar date is drawn anywhere for it: the labels are days after the epoch. */
  const cust = !!st.custom;
  const lastT = (a: Any) => a && a.length ? a[a.length - 1].t : 0;
  const t0 = P[0]!.t, tEnd = cust ? r.tNow + (Math.max(lastT(r.track), lastT(r.simpleTrack), lastT(r.trendTrack)) || 1) * 86400000
                                 : proj ? r.tNow + proj[proj.length - 1].t * 86400000
                                 : P[P.length - 1]!.t;
  let hMin = Infinity, hMax = -Infinity;
  P.forEach(p => { if (p.sma < hMin) hMin = p.sma; if (p.sma > hMax) hMax = p.sma; });
  if (proj) proj.forEach((p: Any) => { if (p.h < hMin) hMin = p.h; if (p.h > hMax) hMax = p.h; });
  if (cust) [r.simpleTrack, r.trendTrack].forEach((a: Any) => { if (a) a.forEach((p: Any) => { if (p.h < hMin) hMin = p.h; if (p.h > hMax) hMax = p.h; }); });
  const pad = Math.max(4, (hMax - hMin) * 0.08);
  hMin = Math.max(0, hMin - pad); hMax = hMax + pad;
  const X = (t: number) => L + (t - t0) / (tEnd - t0) * (Wc - L - R);
  const Y = (v: number) => T + (hMax - v) / (hMax - hMin) * (Hc - T - B);

  // grid + y labels
  g.strokeStyle = rule; g.lineWidth = 1; g.font = '11px "IBM Plex Mono",monospace';
  g.fillStyle = muted; g.textAlign = 'right'; g.textBaseline = 'middle';
  const nTick = 5;
  for (let i = 0; i <= nTick; i++) {
    const v = hMin + (hMax - hMin) * i / nTick, y = Y(v);
    g.globalAlpha = .5; g.beginPath(); g.moveTo(L, y); g.lineTo(Wc - R, y); g.stroke();
    g.globalAlpha = 1; g.fillText(v.toFixed(0), L - 7, y);
  }
  // x labels — the outer two are anchored inward so they cannot run off the edge
  g.textBaseline = 'top';
  for (let i = 0; i <= 3; i++) {
    const t = t0 + (tEnd - t0) * i / 3;
    g.textAlign = i === 0 ? 'left' : i === 3 ? 'right' : 'center';
    g.fillText(cust ? (i === 0 ? 'epoch' : '+' + lifeAxis((t - t0) / 86400000)) : iso(new Date(t)).slice(0, 7), X(t), Hc - B + 7);
  }
  // the 120 km line
  if (hMin <= 130) {
    g.save(); g.strokeStyle = obs; g.setLineDash([4, 3]); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(L, Y(120)); g.lineTo(Wc - R, Y(120)); g.stroke(); g.restore();
    g.fillStyle = obs; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText('120 km — re-entry', L + 5, Y(120) - 3);
  }
  /* The band between the two models. It is how far they disagree, and it is labelled so: it was "estimator spread", which
     reads as an uncertainty band, and at a 180-day range the backtest put the truth about two months past the headline -
     outside the band, when the atmosphere is thinning. */
  if (r.simpleTrack && r.trendTrack) {
    const a = r.simpleTrack, b = r.trendTrack;
    g.fillStyle = contact; g.globalAlpha = .13; g.beginPath();
    a.forEach((p: Any, i: number) => { const x = X(r.tNow + p.t * 86400000), y = Y(p.h);
      i ? g.lineTo(x, y) : g.moveTo(x, y); });
    for (let i = b.length - 1; i >= 0; i--) g.lineTo(X(r.tNow + b[i].t * 86400000), Y(b[i].h));
    g.closePath(); g.fill(); g.globalAlpha = 1;
  }
  // projection line
  if (proj) {
    g.strokeStyle = contact; g.lineWidth = 2; g.setLineDash([5, 4]);
    g.beginPath();
    proj.forEach((p: Any, i: number) => { const x = X(r.tNow + p.t * 86400000), y = Y(p.h);
      i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke(); g.setLineDash([]);
  }
  // observed history
  g.strokeStyle = track; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
  P.forEach((p, i) => { const x = X(p.t), y = Y(p.sma); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
  // "now"
  const xn = X(r.tNow);
  g.strokeStyle = muted; g.globalAlpha = .55; g.lineWidth = 1; g.setLineDash([2, 3]);
  g.beginPath(); g.moveTo(xn, T); g.lineTo(xn, Hc - B); g.stroke();
  g.setLineDash([]); g.globalAlpha = 1;
  g.fillStyle = track; g.beginPath(); g.arc(xn, Y(r.hNow), 3.2, 0, 7); g.fill();

  const geom: Geom = { X, Y, L, R, T, B, Wc, Hc, t0, tEnd, hMin, hMax };
  /* A key only for what can be seen. A record that ends hours short of its own forecast - ICEYE-X34's, 2.5 years long and
     projected 0.06 days on, now read as probably re-entered - drew a projection and a band a twentieth of a pixel wide, and
     the key still offered swatches for both. */
  const seen = (a: Any) => !!a && X(r.tNow + a[a.length - 1].t * 86400000) - xn >= 3;
  if (cust) {
    /* the stock legend says "observed (N element sets)", which would be false: there is one point, the epoch, and nothing was
       observed. */
    return { geom, key: [
      { color: contact, text: 'model, ' + (st.eccentric ? 'perigee height' : 'your drag') },
      { color: contact, opacity: .35, text: 'drag three times as strong to a third' }] };
  }
  const key: KeyItem[] = [{ color: track, text: 'observed (' + P.length + ' element sets)' }];
  if (seen(proj)) key.push({ color: contact, text: 'projected decay' });
  if (r.simpleTrack && r.trendTrack && (seen(r.simpleTrack) || seen(r.trendTrack))) key.push({ color: contact, opacity: .35, text: 'model disagreement' });
  return { geom, key };
}

/** The hover readout at a pointer position x (CSS px from the canvas's left edge): what to say, and where the box goes. */
export function lifeTipAt(geom: Geom, st: LifeChartState, x: number): { text: string; y: number; x: number } | null {
  if (x < geom.L || x > geom.Wc - geom.R) return null;
  const t = geom.t0 + (x - geom.L) / (geom.Wc - geom.L - geom.R) * (geom.tEnd - geom.t0);
  const { P, r } = st;
  let h: number | null = null, kind = '';
  if (!st.custom && t <= P[P.length - 1]!.t) {
    let lo = 0, hi = P.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P[m]!.t < t) lo = m + 1; else hi = m; }
    h = P[lo]!.sma; kind = 'observed';
  } else if (r.track) {
    const d = (t - r.tNow) / 86400000;
    let A = r.track;
    /* A planned orbit's axis runs to the end of its LONGEST run, the x1/3-drag one (D42), which is three times longer than the
       mid-case run for a decaying orbit. Past the end of the mid-case run that is the only model still above the 120 km line,
       and the band drawn there is its upper edge: reading the mid-case run's last point ("120.0 km") over two thirds of the
       chart would contradict the picture, so the readout follows the x1/3 run from there (the words stay "model": the legend
       under the chart names the band). */
    if (st.custom && r.trendTrack && r.trendTrack.length && d > A[A.length - 1].t) A = r.trendTrack;
    let lo = 0, hi = A.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (A[m].t < d) lo = m + 1; else hi = m; }
    h = A[lo].h; kind = 'projected';
  }
  if (h === null) return null;
  const text = st.custom
    ? '+' + lifeAxis((t - r.tNow) / 86400000) + ' after epoch\n' + h.toFixed(1) + ' km · model'    // numbers only, no date
    : iso(new Date(t)).slice(0, 10) + '\n' + h.toFixed(1) + ' km · ' + kind;
  return { text, x, y: geom.Y(h) - 8 };
}
