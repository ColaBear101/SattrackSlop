/* The Snap button's work: make one picture of what the view shows, and hand it to the reader.

   Nothing here runs until the reader presses Snap. The camera's picture is drawn into a canvas of this file's own making, once, for that one
   press; the view itself never draws, reads back or keeps the picture, and nothing here sends it anywhere. What happens to the file is the
   reader's choice: the phone's share sheet where there is one (so Save Image, Messages, a cloud drive are theirs to pick), or a plain download
   into the phone's own storage where there is not.

   The picture is what is on the screen without the buttons: the camera's picture (object-fit: cover, as the view lays it) with the sky drawn
   over it and the radar in its corner; or, in the radar view, which has no camera, the radar on a dark ground. A strip along the foot says what
   it is a picture of: the spacecraft and where it was, from where, and when. */

export interface SnapSource {
  /** the picture's size in device pixels */
  width: number;
  height: number;
  /** device pixels per CSS pixel: the boxes below are in CSS pixels */
  scale: number;
  /** the camera's picture, when it is live; `vw` x `vh` is its own size */
  video: { el: CanvasImageSource; vw: number; vh: number } | null;
  /** the canvas the sky is drawn on, laid over the picture in full */
  overlay: CanvasImageSource | null;
  /** the radar's canvas and the box it is shown in */
  radar: { cv: CanvasImageSource; x: number; y: number; w: number; h: number } | null;
  /** the strip along the foot, a line each */
  caption: string[];
}

type Maker = { createElement(tag: string): HTMLElement };

const GROUND = '#05090C';

/** A name for the file: what it is a picture of, where, and the instant in UTC, as sortable digits. */
export function snapName(kind: 'sky' | 'radar', site: string, ms: number, ext: 'jpg' | 'png'): string {
  const slug = String(site || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'site';
  const t = new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return 'sattrack-' + kind + '-' + slug + '-' + t + '.' + ext;
}

/** Where a picture of `vw` x `vh` falls on a `w` x `h` screen under object-fit: cover. */
export function coverRect(vw: number, vh: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const k = Math.max(w / vw, h / vh), dw = vw * k, dh = vh * k;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh };
}

/** Draws the picture and encodes it: a JPEG when there is a camera's picture in it (a photograph), a PNG when there is not (a drawing). */
export function composeSnap(doc: Maker, s: SnapSource): Promise<Blob> {
  const cv = doc.createElement('canvas') as HTMLCanvasElement;
  cv.width = s.width; cv.height = s.height;
  const g = cv.getContext('2d');
  if (!g) return Promise.reject(new Error('this browser gave no canvas to draw it on'));
  const w = s.width, h = s.height, sc = s.scale;
  g.fillStyle = GROUND; g.fillRect(0, 0, w, h);
  const v = s.video;
  if (v && v.vw > 0 && v.vh > 0) { const r = coverRect(v.vw, v.vh, w, h); g.drawImage(v.el, r.x, r.y, r.w, r.h); }
  if (s.overlay) g.drawImage(s.overlay, 0, 0, w, h);
  if (s.radar) g.drawImage(s.radar.cv, s.radar.x * sc, s.radar.y * sc, s.radar.w * sc, s.radar.h * sc);
  if (s.caption.length) {
    const px = 13 * sc, lh = 17 * sc, pad = 10 * sc, band = s.caption.length * lh + 2 * pad, room = w - 2 * pad;
    /* The strip goes along the foot, unless the radar's box reaches into it (held sideways the radar stands 12 px up from the foot): then it
       goes along the top, where there is room, and the plot is not covered. */
    const r = s.radar, onTop = !!r && (r.y + r.h) * sc > h - band && r.y * sc >= band;
    const y0 = onTop ? 0 : h - band;
    g.fillStyle = 'rgba(5,9,12,.78)'; g.fillRect(0, y0, w, band);
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const font = (p: number) => '500 ' + p + 'px "IBM Plex Mono", ui-monospace, monospace';
    s.caption.forEach((line, i) => {
      g.font = font(px);
      const m = (g.measureText(line) || { width: 0 }).width;
      // a line too wide for the picture is set smaller, down to 72%; the squeeze fillText's maxWidth gives is only the last resort
      if (m > room) g.font = font(Math.max(px * 0.72, px * room / m));
      g.fillStyle = i === 0 ? '#EAF2F6' : '#AFC3CE';
      g.fillText(line, pad, y0 + pad + lh * i + lh / 2, room);
    });
  }
  const type = v && v.vw > 0 ? 'image/jpeg' : 'image/png';
  return new Promise((resolve, reject) => cv.toBlob(b => (b ? resolve(b) : reject(new Error('the picture could not be encoded'))), type, 0.92));
}

/** Hands the picture to the reader: the share sheet where the browser has one that takes files, a download otherwise. A reader who closes the
 *  sheet has cancelled, which is not an error. `host` is a node inside the view, since everything else on the page is inert while it is open.
 *  The code is src/lib/share.ts's deliverFile, moved there unchanged when the one-pass calendar file came to need it too
 *  (CHANGES-FROM-LEGACY.md, L57). */
export { deliverFile as deliverSnap } from '../share';
