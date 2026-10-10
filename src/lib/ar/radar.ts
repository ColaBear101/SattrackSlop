/* The radar in the AR view: the sky as a polar plot, north up, the horizon at the rim and the zenith at the centre, with the
   spacecraft, its pass and - in blue - where the phone points.

   The camera's picture shows a few tens of degrees of sky. The radar shows all of it, so a reader who has turned the wrong way
   sees at once which way the spacecraft is and how far round to go, and brings the blue crosshair onto it. It is the plot the
   console draws for the selected pass (src/components/rail/draw-sky.ts) with the same geometry - r = R (90 - el) / 90, east to the
   right - drawn on a canvas of its own over the AR view's, in the AR view's palette.

   The functions take what to draw and draw it. Nothing here reads the page, the sensors or the clock: arview.ts hands over the
   pose and the pass it is already drawing, so the crosshair and the camera's picture can never disagree. */

const RAD = Math.PI / 180;

/** Room round the disc for the compass letters. */
const RIM = 15;

const FONT = '"IBM Plex Mono", ui-monospace, monospace';

export interface RadarPoint { az: number; el: number }

/** The part of a pass the radar reads. `clipA` and `clipL`: the analysis window, not the horizon, cut the pass off at its start or its end. */
export interface RadarPass { arc: RadarPoint[]; t0ms: number; t1ms: number; maxAz: number; maxEl: number; clipA?: boolean; clipL?: boolean }

export interface RadarPalette { ink: string; ink2: string; halo: string; grid: string; horizon: string; mask: string; pass: string; craft: string; aim: string }

export interface RadarFrame {
  /** CSS pixels, a square */
  size: number;
  /** device pixels per CSS pixel the backing store is made for */
  dpr: number;
  /** the elevation mask, degrees */
  mask: number;
  /** the clock, in ms: how much of the pass is already flown */
  ms: number;
  /** the current pass, or the next one */
  pass: RadarPass | null;
  /** the spacecraft now; nothing is drawn for one below the horizon */
  craft: RadarPoint | null;
  /** where the phone's camera points; null while that is not known (an iPhone still finding north). Within 5 degrees of straight down it is
   *  not drawn either: the azimuth there is the direction of a tiny tilt, and swings right round the rim with the tremor of a hand. */
  aim: RadarPoint | null;
}

/** Where a direction falls on the plot, in CSS pixels from the canvas's top left. `clamped`: it was below the horizon and is on the rim. */
export interface RadarMark { x: number; y: number; clamped: boolean }

export interface RadarGeometry { R: number; cx: number; cy: number }

/** What a frame drew and where, for the checks. */
export interface RadarProbe { size: number; R: number; cx: number; cy: number; aim: RadarMark | null; craft: RadarMark | null; pass: boolean }

type Layer = { width: number; height: number; getContext(kind: '2d'): CanvasRenderingContext2D | null } & CanvasImageSource;

/** What a caller keeps between frames so that what does not change is not drawn again: the disc with its rings and letters, and the pass,
 *  each on a canvas of its own and laid down in one call, and the key of the last frame, so that a frame that would be the same as it is
 *  not drawn at all. `make` makes a canvas of a given size in device pixels; without it every frame is drawn from scratch. */
export interface RadarCache {
  make?: (w: number, h: number) => Layer;
  layers?: Record<string, { key: string; cv: Layer }>;
  last?: { key: string; probe: RadarProbe };
}

/** Below this elevation the crosshair is left out: the readout says "straight down" from 85 degrees too. */
const AIM_FLOOR = -85;

/** The side of the radar for a screen W x H: two fifths of the short side, from a thumb-sized 112 px to 200 px on a tablet. */
export function radarSize(W: number, H: number): number {
  return Math.round(Math.max(112, Math.min(200, Math.min(W, H) * 0.4)));
}

export function radarGeometry(size: number): RadarGeometry {
  return { R: size / 2 - RIM, cx: size / 2, cy: size / 2 };
}

/** The plot's own transform. Elevation is clamped to 0..90: a direction below the horizon is put on the rim at its azimuth. */
export function radarPoint(g: RadarGeometry, az: number, el: number): RadarMark {
  const e = el < 0 ? 0 : el > 90 ? 90 : el;
  const r = g.R * (90 - e) / 90, a = az * RAD;
  return { x: g.cx + r * Math.sin(a), y: g.cy - r * Math.cos(a), clamped: el < 0 };
}

function label(ctx: CanvasRenderingContext2D, pal: RadarPalette, s: string, x: number, y: number, fill: string, font: string): void {
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = 3.5; ctx.strokeStyle = pal.halo; ctx.strokeText(s, x, y);
  ctx.fillStyle = fill; ctx.fillText(s, x, y);
}

/* The disc, its rings, the mask, the horizon and the compass letters: all that does not change while the view is open. */
function paintBase(ctx: CanvasRenderingContext2D, g: RadarGeometry, mask: number, pal: RadarPalette): void {
  const { R, cx, cy } = g;
  // dark glass, so the plot reads over a daylit sky and over a black one
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(5,9,12,.62)'; ctx.fill();
  // elevation rings 30 and 60, and the spokes every 45 degrees
  ctx.lineWidth = 1; ctx.strokeStyle = pal.grid;
  for (const e of [30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, R * (90 - e) / 90, 0, 2 * Math.PI); ctx.stroke(); }
  ctx.beginPath();
  for (let k = 0; k < 8; k++) { const a = k * 45 * RAD; ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.sin(a), cy - R * Math.cos(a)); }
  ctx.stroke();
  // the mask, in the globe key's pink, and the horizon
  ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = pal.mask;
  ctx.beginPath(); ctx.arc(cx, cy, R * (90 - mask) / 90, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  ctx.lineWidth = 1.5; ctx.strokeStyle = pal.horizon;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
  ['N', 'E', 'S', 'W'].forEach((d, i) => {
    const a = i * 90 * RAD;
    label(ctx, pal, d, cx + (R + 8) * Math.sin(a), cy - (R + 8) * Math.cos(a), pal.ink2, '600 11px ' + FONT);
  });
}

/** How many samples of the pass are already flown at `ms`; 0 while it has not begun or once it is over. */
function flown(p: RadarPass, ms: number): number {
  const n = p.arc.length - 1;
  if (!(ms >= p.t0ms && ms <= p.t1ms)) return 0;
  return Math.max(0, Math.min(n, Math.floor((ms - p.t0ms) / (p.t1ms - p.t0ms) * n)));
}

/* The pass: the stretch already flown faint, the rest bright, its highest point, and its two ends. */
function paintPass(ctx: CanvasRenderingContext2D, g: RadarGeometry, p: RadarPass, k: number, pal: RadarPalette): void {
  const { cx, cy } = g, n = p.arc.length - 1, pt = (s: RadarPoint) => radarPoint(g, s.az, s.el);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seg = (from: number, to: number, alpha: number) => {
    ctx.beginPath();
    for (let i = from; i <= to; i++) { const q = pt(p.arc[i]!); if (i === from) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 5.5; ctx.strokeStyle = 'rgba(5,9,12,.55)'; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = pal.pass; ctx.stroke();
    ctx.globalAlpha = 1;
  };
  if (k > 0) seg(0, k, 0.45);
  seg(k, n, 1);
  // the highest point is a small ring: the spacecraft is the one solid dot on the plot, and is not to be mistaken for it
  const top = radarPoint(g, p.maxAz, p.maxEl);
  ctx.beginPath(); ctx.arc(top.x, top.y, 3.5, 0, 2 * Math.PI);
  ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(5,9,12,.55)'; ctx.stroke();
  ctx.lineWidth = 1.75; ctx.strokeStyle = pal.pass; ctx.stroke();
  // AOS and LOS sit on the mask ring: the labels are pulled in towards the centre, clear of the compass letters
  const inward = (q: RadarMark, d: number): [number, number] => {
    const vx = cx - q.x, vy = cy - q.y, m = Math.hypot(vx, vy) || 1;
    return [q.x + vx / m * d, q.y + vy / m * d];
  };
  const a = inward(pt(p.arc[0]!), 15), l = inward(pt(p.arc[n]!), 15);
  // an end the window cut off, not the horizon, is starred, as the main view stars it
  label(ctx, pal, 'AOS' + (p.clipA ? '*' : ''), a[0], a[1], pal.ink2, '600 10px ' + FONT);
  label(ctx, pal, 'LOS' + (p.clipL ? '*' : ''), l[0], l[1], pal.ink2, '600 10px ' + FONT);
}

/** Draws one frame on `ctx`, a canvas whose backing store is size x dpr device pixels square, and says what it drew and where. */
export function drawRadar(ctx: CanvasRenderingContext2D, f: RadarFrame, pal: RadarPalette, cache?: RadarCache): RadarProbe {
  const S = f.size, g = radarGeometry(S);
  const p = f.pass && f.pass.arc.length > 1 ? f.pass : null, k = p ? flown(p, f.ms) : 0;
  const craft = f.craft && f.craft.el >= 0 ? f.craft : null;
  const aim = f.aim && f.aim.el >= AIM_FLOOR ? f.aim : null;
  const probe: RadarProbe = {
    size: S, R: g.R, cx: g.cx, cy: g.cy, pass: !!p,
    aim: aim ? radarPoint(g, aim.az, aim.el) : null,
    craft: craft ? radarPoint(g, craft.az, craft.el) : null
  };

  /* A frame that would come out as the last one is not drawn: a phone held still, a spacecraft that has not moved a tenth of a degree.
     The canvas keeps what is on it. The pose and the spacecraft are keyed to a tenth of a degree: at most 0.15 px on the rim of the
     largest radar, 0.11 px on a phone's. */
  const tenth = (v: number) => Math.round(v * 10);
  const baseKey = [S, f.dpr, f.mask, pal.grid, pal.mask, pal.horizon, pal.ink2, pal.halo].join('|');
  const passKey = p ? [baseKey, p.t0ms, p.t1ms, p.arc.length, p.maxAz, p.maxEl, p.clipA ? 1 : 0, p.clipL ? 1 : 0, k, pal.pass].join('|') : '';
  const key = [passKey || baseKey, aim ? tenth(aim.az) + ',' + tenth(aim.el) : '-',
               craft ? tenth(craft.az) + ',' + tenth(craft.el) + ',' + (craft.el >= f.mask) : '-', pal.pass, pal.craft, pal.aim].join('#');
  if (cache && cache.last && cache.last.key === key) return cache.last.probe;

  const dev = Math.round(S * f.dpr);
  /* One of the parts that does not change from frame to frame: painted on its own canvas when its key changes, and laid down on this one. */
  const layer = (name: string, lkey: string, paint: (c: CanvasRenderingContext2D) => void): boolean => {
    if (!cache || !cache.make) return false;
    const layers = cache.layers ??= {};
    let L = layers[name];
    if (!L || L.key !== lkey) {
      const cv = L ? L.cv : cache.make(dev, dev);
      if (cv.width !== dev || cv.height !== dev) { cv.width = dev; cv.height = dev; }
      const c = cv.getContext('2d');
      if (!c) return false;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, dev, dev);
      c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      paint(c);
      L = layers[name] = { key: lkey, cv };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(L.cv, 0, 0);
    return true;
  };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dev, dev);
  if (!layer('base', baseKey, c => paintBase(c, g, f.mask, pal))) { ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0); paintBase(ctx, g, f.mask, pal); }
  if (p && !layer('pass', passKey, c => paintPass(c, g, p, k, pal))) { ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0); paintPass(ctx, g, p, k, pal); }
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // the spacecraft, where it is now: the pass's colour once it clears the mask, cyan between the mask and the horizon
  if (craft && probe.craft) {
    const q = probe.craft;
    ctx.beginPath(); ctx.arc(q.x, q.y, 5.5, 0, 2 * Math.PI);
    ctx.fillStyle = craft.el >= f.mask ? pal.pass : pal.craft; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = pal.halo; ctx.stroke();
  }

  // the phone: a blue crosshair, last, so that nothing hides it. Below the horizon it stays on the rim, fainter and with a broken ring.
  if (probe.aim) {
    const q = probe.aim, r0 = 4.5, r1 = 12;
    const arms = () => {
      ctx.beginPath();
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { ctx.moveTo(q.x + ux * r0, q.y + uy * r0); ctx.lineTo(q.x + ux * r1, q.y + uy * r1); }
    };
    ctx.save();
    if (q.clamped) ctx.globalAlpha = 0.6;
    arms(); ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(5,9,12,.7)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, 2 * Math.PI);
    if (q.clamped) ctx.setLineDash([3, 3]);
    ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(5,9,12,.7)'; ctx.stroke();
    ctx.lineWidth = 1.75; ctx.strokeStyle = pal.aim; ctx.stroke(); ctx.setLineDash([]);
    arms(); ctx.lineWidth = 1.75; ctx.strokeStyle = pal.aim; ctx.stroke();
    ctx.restore();
  }
  if (cache) cache.last = { key, probe };
  return probe;
}
