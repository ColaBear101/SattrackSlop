import type { Pass } from '../../lib/types';

/* The sky track of one pass: a polar plot, north up, the horizon at the rim and the zenith at the centre. The
   old page's drawSky, with the colours read once per theme instead of once per stroke. */

export interface SkyColors { sunk: string; ring: string; observer: string; ink2: string; panel: string; muted: string; contact: string }

export function readSkyColors(): SkyColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue('--' + n).trim();
  return { sunk: v('sunk'), ring: v('ring'), observer: v('observer'), ink2: v('ink2'), panel: v('panel'), muted: v('muted'), contact: v('contact') };
}

const RAD = Math.PI / 180;

export function drawSky(c: HTMLCanvasElement, p: Pass | null, mask: number, col: SkyColors): void {
  const g = c.getContext('2d')!;
  // size the backing store to the CSS box so the labels stay crisp at any device pixel ratio
  const S = Math.round(c.getBoundingClientRect().width) || 268;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(S * dpr); c.height = Math.round(S * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S);
  const R = S / 2 - 22, cx = S / 2, cy = S / 2;

  g.fillStyle = col.sunk; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
  // elevation rings 0/30/60, the spokes, and the mask
  g.strokeStyle = col.ring; g.lineWidth = 1.2;
  [0, 30, 60].forEach(e => { g.beginPath(); g.arc(cx, cy, R * (90 - e) / 90, 0, 7); g.stroke(); });
  g.beginPath();
  for (let k = 0; k < 8; k++) { const a = k * 45 * RAD; g.moveTo(cx, cy); g.lineTo(cx + R * Math.sin(a), cy - R * Math.cos(a)); }
  g.stroke();
  g.setLineDash([4, 3]); g.strokeStyle = col.observer; g.lineWidth = 1.6;
  g.beginPath(); g.arc(cx, cy, R * (90 - mask) / 90, 0, 7); g.stroke(); g.setLineDash([]);

  const halo = (s: string, x: number, y: number, fill: string, bg: string) => {
    g.lineJoin = 'round'; g.miterLimit = 2; g.lineWidth = 3.5; g.strokeStyle = bg; g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y);
  };
  g.font = '600 11px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  ['N', 'E', 'S', 'W'].forEach((d, i) => { const a = i * 90 * RAD; halo(d, cx + (R + 12) * Math.sin(a), cy - (R + 12) * Math.cos(a), col.ink2, col.panel); });
  // ring labels sit on the SW diagonal, clear of the N cardinal where AOS/LOS cluster
  g.font = '500 11px "IBM Plex Mono", monospace';
  const ringLabel = (txt: string, e: number) => { const r = R * (90 - e) / 90, a = 225 * RAD; halo(txt, cx + r * Math.sin(a), cy - r * Math.cos(a), col.muted, col.sunk); };
  ringLabel('30°', 30); ringLabel('60°', 60);
  if (!p) return;

  const pt = (s: { el: number; az: number }): [number, number] => { const r = R * (90 - s.el) / 90, a = s.az * RAD; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  g.strokeStyle = col.contact; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); p.arc.forEach((s, i) => { const q = pt(s); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
  const A = pt(p.arc[0]!), L = pt(p.arc[p.arc.length - 1]!), M = pt({ el: p.maxEl, az: p.maxAz });
  g.fillStyle = col.contact; g.beginPath(); g.arc(M[0], M[1], 5, 0, 7); g.fill();
  g.lineWidth = 2; g.strokeStyle = col.panel; g.stroke();
  g.font = '600 11px "IBM Plex Mono", monospace'; g.textAlign = 'center';
  // AOS/LOS sit on the mask ring: pull the labels inward so they clear the cardinals
  const inward = (q: [number, number], d: number): [number, number] => { const vx = cx - q[0], vy = cy - q[1], m = Math.hypot(vx, vy) || 1; return [q[0] + vx / m * d, q[1] + vy / m * d]; };
  const al = inward(A, 19), ll = inward(L, 19);
  halo('AOS', al[0], al[1], col.ink2, col.sunk); halo('LOS', ll[0], ll[1], col.ink2, col.sunk);
}
