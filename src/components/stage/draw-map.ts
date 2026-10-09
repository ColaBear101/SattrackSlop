import type { Analysis, Sample, Site } from '../../lib/types';
import type { WorldData } from '../../state/app.svelte';
import { hms } from '../../lib/text/fmt';

/* The flat ground-track map: the old page's drawMap, with the same pictures in the same order, split so the
   expensive, unchanging parts are painted once and kept.
 *
 *   ocean + land           painted once per size, theme and world           (cached)
 *   day/night              moves with the clock                              (every frame)
 *   graticule, observer's footprint, spacecraft's footprint                  (every frame, a few hundred points)
 *   the 24 h track and its in-view arcs, 8,641 points                        (cached per analysis)
 *   observer, spacecraft and the time label                                  (every frame)
 *
 * The old code repainted all 127 polygons and the whole track on every redraw and read colours with
 * getComputedStyle for every stroke. Here colours are read once per theme. */

export interface MapColors {
  ocean: string; land: string; landline: string; grat: string; night: string; day: string; ring: string;
  track: string; contact: string; observer: string; ink: string; panel: string; rule: string; fov: string;
}

export function readColors(): MapColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue('--' + n).trim();
  return {
    ocean: v('ocean'), land: v('land'), landline: v('landline'), grat: v('grat'), night: v('night'), day: v('day'),
    ring: v('ring'), track: v('track'), contact: v('contact'), observer: v('observer'), ink: v('ink'),
    panel: v('panel'), rule: v('rule'), fov: v('fov')
  };
}

export interface MapInput {
  analysis: Analysis; site: Site; mask: number; world: WorldData | null;
  cur: Sample | null; subsolar: { lat: number; lon: number }; footprint: boolean; colors: MapColors;
}

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
type Ctx = CanvasRenderingContext2D;
type Pt = { lat: number; lon: number };

export class MapPainter {
  private ctx: Ctx;
  private w = 0; private h = 0; private dpr = 1;
  private base: HTMLCanvasElement | null = null; private baseKey = '';
  private trackLayer: HTMLCanvasElement | null = null; private trackKey: unknown = null; private trackColors = '';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Match the canvas to its CSS size at the device pixel ratio (capped at 2). Returns true if it changed. */
  resize(): boolean {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round(r.width)), h = Math.round(w / 2);
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  private px = (lon: number) => (lon + 180) / 360 * this.w;
  private py = (lat: number) => (90 - lat) / 180 * this.h;

  /* ---- layers ----------------------------------------------------------------------------------- */

  private layer(): { c: HTMLCanvasElement; g: Ctx } {
    const c = document.createElement('canvas');
    c.width = Math.round(this.w * this.dpr); c.height = Math.round(this.h * this.dpr);
    const g = c.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return { c, g };
  }

  private paintBase(world: WorldData | null, col: MapColors) {
    const { c, g } = this.layer();
    g.fillStyle = col.ocean; g.fillRect(0, 0, this.w, this.h);
    if (world) {
      g.beginPath();
      for (const f of world.features) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][]);
        for (const poly of polys) for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const x = this.px(ring[i]![0]!), y = this.py(ring[i]![1]!);
            i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
          }
          g.closePath();
        }
      }
      g.fillStyle = col.land; g.fill();
      g.strokeStyle = col.landline; g.lineWidth = 0.6; g.stroke();
    }
    return c;
  }

  /* a polyline that breaks at the antimeridian */
  private stroke(g: Ctx, points: readonly Pt[], color: string, width: number) {
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      if (i > 0 && Math.abs(p.lon - points[i - 1]!.lon) > 180) started = false;
      const x = this.px(p.lon), y = this.py(p.lat);
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.stroke();
  }

  private paintTrack(a: Analysis, mask: number, col: MapColors) {
    const { c, g } = this.layer();
    const pts = a.drawStride > 1 ? a.pts.filter((_, i) => i % a.drawStride === 0) : a.pts;
    this.stroke(g, pts, col.track, 1.5);
    // in-view arcs on top, thicker: identity is carried by width as well as hue
    let run: Sample[] = [];
    for (const p of a.pts) {
      if (p.el >= mask) run.push(p);
      else if (run.length) { this.stroke(g, run, col.contact, 4); run = []; }
    }
    if (run.length) this.stroke(g, run, col.contact, 4);
    return c;
  }

  /* ---- per-frame pieces -------------------------------------------------------------------------- */

  private terminator(date: Date, ss: Pt, col: MapColors) {
    const g = this.ctx, dec = ss.lat * RAD;
    if (Math.abs(dec) < 1e-4) return;                         // equinox degeneracy: no fill
    const curve: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 1) {
      const h = (lon - ss.lon) * RAD;
      curve.push([this.px(lon), this.py(Math.atan(-Math.cos(h) / Math.tan(dec)) * DEG)]);
    }
    const cap = (toBottom: boolean, fill: string) => {
      if (!fill || fill === 'transparent') return;
      g.beginPath();
      curve.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
      if (toBottom) { g.lineTo(this.w, this.h); g.lineTo(0, this.h); } else { g.lineTo(this.w, 0); g.lineTo(0, 0); }
      g.closePath(); g.fillStyle = fill; g.fill();
    };
    cap(dec > 0, col.night);                                   // dec > 0: the north pole is lit, darkness lies below
    cap(dec <= 0, col.day);
    g.beginPath();
    curve.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
    g.strokeStyle = col.ring; g.lineWidth = 1; g.globalAlpha = .75; g.stroke(); g.globalAlpha = 1;
    void date;
  }

  private graticule(col: MapColors) {
    const g = this.ctx;
    g.strokeStyle = col.grat; g.lineWidth = 0.7; g.beginPath();
    for (let lon = -150; lon <= 150; lon += 30) { g.moveTo(this.px(lon), 0); g.lineTo(this.px(lon), this.h); }
    for (let lat = -60; lat <= 60; lat += 30) { g.moveTo(0, this.py(lat)); g.lineTo(this.w, this.py(lat)); }
    g.stroke();
    g.setLineDash([3, 4]); g.strokeStyle = col.grat; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, this.py(0)); g.lineTo(this.w, this.py(0)); g.stroke();
    g.setLineDash([]);
  }

  /* the small circle of angular radius `lam` round a point, as map points */
  private circle(lat0: number, lon0: number, lam: number): Pt[] {
    const lat1 = lat0 * RAD, lon1 = lon0 * RAD, pts: Pt[] = [];
    for (let b = 0; b <= 360; b += 2) {
      const th = b * RAD;
      const la = Math.asin(Math.sin(lat1) * Math.cos(lam) + Math.cos(lat1) * Math.sin(lam) * Math.cos(th));
      const lo = lon1 + Math.atan2(Math.sin(th) * Math.sin(lam) * Math.cos(lat1), Math.cos(lam) - Math.sin(lat1) * Math.sin(la));
      let d = lo * DEG; while (d > 180) d -= 360; while (d < -180) d += 360;
      pts.push({ lat: la * DEG, lon: d });
    }
    return pts;
  }

  private haloText(s: string, x: number, y: number, fill: string, halo: string) {
    const g = this.ctx;
    g.lineJoin = 'round'; g.miterLimit = 2; g.lineWidth = 3.5; g.strokeStyle = halo; g.strokeText(s, x, y);
    g.fillStyle = fill; g.fillText(s, x, y);
  }

  /** Paint one frame. */
  draw(inp: MapInput): void {
    const { analysis: a, site, mask, world, cur, colors: col } = inp;
    if (!this.w) this.resize();
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);

    const baseKey = [this.w, this.h, this.dpr, col.ocean, col.land, col.landline, world ? 'w' : '-'].join('|');
    if (!this.base || this.baseKey !== baseKey) { this.base = this.paintBase(world, col); this.baseKey = baseKey; }
    g.drawImage(this.base, 0, 0, this.w, this.h);

    if (cur) this.terminator(cur.t, inp.subsolar, col);
    this.graticule(col);

    // the ground the observer holds the spacecraft above the mask can reach, at the mean altitude
    g.save(); g.setLineDash([5, 4]);
    this.stroke(g, this.circle(site.lat, site.lon, a.lambda), col.observer, 1.6);
    g.restore();

    // the ground the spacecraft currently holds above the mask: same geometry, centred under it, sized by its altitude
    if (inp.footprint && cur) {
      const RE = a.track.body.Re, eps = mask * RAD, inner = RE * Math.cos(eps) / (RE + cur.alt);
      if (inner <= 1) {
        g.save(); g.globalAlpha = .85;
        this.stroke(g, this.circle(cur.lat, cur.lon, Math.acos(inner) - eps), col.fov, 1.4);
        g.restore();
      }
    }

    const tk = [this.w, this.h, this.dpr, col.track, col.contact].join('|');
    if (!this.trackLayer || this.trackKey !== a || this.trackColors !== tk) {
      this.trackLayer = this.paintTrack(a, mask, col); this.trackKey = a; this.trackColors = tk;
    }
    g.drawImage(this.trackLayer, 0, 0, this.w, this.h);

    this.markers(site, cur, mask, col);

    g.strokeStyle = col.rule; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);
  }

  private markers(site: Site, cur: Sample | null, mask: number, col: MapColors) {
    const g = this.ctx, W = this.w;
    // the observer, under its own name; a name that would run off the right edge is set to the left of the ring
    const bx = this.px(site.lon), by = this.py(site.lat);
    g.beginPath(); g.arc(bx, by, 5.5, 0, 7); g.fillStyle = col.panel; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = col.observer; g.stroke();
    g.font = '600 11px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    const txt = site.name.toUpperCase();
    const flip = bx + 10 + g.measureText(txt).width > W - 4;
    g.textAlign = flip ? 'right' : 'left';
    this.haloText(txt, flip ? bx - 10 : bx + 10, by + 0.5, col.observer, col.ocean);
    if (!cur) return;
    const sx = this.px(cur.lon), sy = this.py(cur.lat), hot = cur.el >= mask, c = hot ? col.contact : col.track;
    g.beginPath(); g.arc(sx, sy, 10, 0, 7);
    g.strokeStyle = c; g.lineWidth = 1.2; g.globalAlpha = .55; g.stroke(); g.globalAlpha = 1;
    g.beginPath(); g.arc(sx, sy, 4.5, 0, 7); g.fillStyle = c; g.fill();
    g.lineWidth = 2; g.strokeStyle = col.panel; g.stroke();
    g.font = '600 11px "IBM Plex Mono", monospace';
    g.textAlign = sx > W - 90 ? 'right' : 'left';
    this.haloText(hms(cur.t) + 'Z', sx + (sx > W - 90 ? -12 : 12), sy - 12, col.ink, col.ocean);
  }
}
