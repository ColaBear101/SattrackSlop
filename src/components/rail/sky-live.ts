import { app } from '../../state/app.svelte';
import { flownSamples, skyXY } from '../../lib/analysis/sky-now';
import type { Pass, Sample } from '../../lib/types';
import { drawSky, type SkyColors } from './draw-sky';

/* The sky plot while its pass is being flown (CHANGES-FROM-LEGACY.md, L54): the spacecraft as a dot where it is at the clock's
   instant, and the stretch of the pass already behind it drawn faint, as the AR radar draws them. A chunk of its own, which
   SkyPlot.svelte asks for the first time the clock is inside the pass it shows; whenever the clock is outside the pass, the plot
   is drawSky's, drawn at once as it always was.

   The spacecraft is where app.exactAt puts it (the "Elevation now" figure's own call: propagated to the instant, not read off
   the stored samples, which near the top of a pass are degrees apart), worked out once a tick for both plots.

   What does not move between ticks is not drawn again. drawSky draws the disc, its rings and letters and the pass with its flown
   stretch faint, sizing the canvas to its box as it always does; that picture is kept on a canvas of its own, and each tick lays
   it back down and draws only the dot over it, without reading the layout. It is drawn again when the pass, the colours, the
   mask, the device pixel ratio, the box's size (a ResizeObserver says) or the flown stretch change: the arc has 91 samples, so at
   real time that is once every ninetieth of the pass. A plot out of view (the report's copy below the fold, the rail's in a
   closed sheet or behind another tab) is not drawn at all: an IntersectionObserver draws it when it comes into view. The clock
   publishes no ticks while it is paused, so nothing is drawn then either.

   The canvas carries the instant it last drew the spacecraft at, as data-live (gone once the plot is drawSky's again), for
   whoever checks it (verify-timeline.js). */

interface Plot {
  p: Pass; mask: number; col: SkyColors; ms: number;
  /** in view, as the IntersectionObserver last said */
  seen: boolean;
  /** the box's CSS size at the last drawing, and what that drawing was of: the kept picture is good while the key holds */
  S?: number; key?: unknown[]; off?: HTMLCanvasElement;
}
const plots = new WeakMap<HTMLCanvasElement, Plot>();
let io: IntersectionObserver | null = null, ro: ResizeObserver | null = null;

function drop(c: HTMLCanvasElement): void { plots.delete(c); io?.unobserve(c); ro?.unobserve(c); }

function watch(c: HTMLCanvasElement): void {
  io ??= new IntersectionObserver(es => {
    for (const e of es) {
      const t = e.target as HTMLCanvasElement, q = plots.get(t);
      if (!q) continue;
      if (!t.isConnected) { drop(t); continue; }
      q.seen = e.isIntersecting;
      if (q.seen) frame(t, q);
    }
  });
  ro ??= new ResizeObserver(es => {
    for (const e of es) {
      const t = e.target as HTMLCanvasElement, q = plots.get(t);
      if (q && Math.round(e.contentRect.width) !== q.S) { q.key = undefined; if (q.seen) frame(t, q); }
    }
  });
  io.observe(c); ro.observe(c);
}

/** Draws the plot of pass `p` on `c`: with the spacecraft at instant `ms`, or, for null (the clock outside the pass), drawSky's. */
export function paintSky(c: HTMLCanvasElement, p: Pass | null, mask: number, col: SkyColors, ms: number | null): void {
  const pl = plots.get(c);
  if (ms === null || !p) {
    if (pl) drop(c);
    delete c.dataset.live;
    drawSky(c, p, mask, col);
    return;
  }
  if (pl) { Object.assign(pl, { p, mask, col, ms }); if (pl.seen) frame(c, pl); }
  else { plots.set(c, { p, mask, col, ms, seen: false }); watch(c); }
}

/* the look at an instant, worked out once for the two plots */
let last: { D: unknown; ms: number; s: Sample | null } | null = null;
function lookAt(ms: number): Sample | null {
  const D = app.analysis;
  if (!last || last.D !== D || last.ms !== ms) last = { D, ms, s: app.exactAt(ms) };
  return last.s;
}

function frame(c: HTMLCanvasElement, pl: Plot): void {
  const { p, mask, col, ms } = pl;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), k = flownSamples(p, ms), key = [p, mask, col, dpr, k];
  const g = c.getContext('2d')!;
  if (!pl.off || !pl.key || key.some((v, i) => v !== pl.key![i])) {
    pl.S = Math.round(c.getBoundingClientRect().width) || 268;   // what drawSky sizes the canvas by
    drawSky(c, p, mask, col, k);
    const off = pl.off ??= document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    off.getContext('2d')!.drawImage(c, 0, 0);
    pl.key = key;
  } else {
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.drawImage(pl.off, 0, 0);
  }
  /* the spacecraft: a solid dot in ink, ringed as the map rings its marker, over the arc and the dot at its highest point */
  const s = lookAt(ms);
  if (s && s.el >= 0) {
    const [x, y] = skyXY(pl.S!, s.az, s.el);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.beginPath(); g.arc(x, y, 9, 0, 7); g.lineWidth = 1.5; g.strokeStyle = col.ink; g.globalAlpha = .45; g.stroke(); g.globalAlpha = 1;
    g.beginPath(); g.arc(x, y, 5, 0, 7); g.fillStyle = col.ink; g.fill(); g.lineWidth = 2; g.strokeStyle = col.panel; g.stroke();
  }
  c.dataset.live = String(ms);
}
