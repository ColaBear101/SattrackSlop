/* The realistic surface's detail close up (CHANGES-FROM-LEGACY.md, L74): NASA's Blue Marble Next Generation at up to 500 m a pixel,
 * streamed from NASA GIBS for the part of the Earth in view, over the shipped map (bmng-<width>.jpg, 4.9 km a texel at 8192, from the
 * same month, August 2004, so the two agree in colour).
 *
 * One window of N x N tiles (8 x 8 on a fine pointer, 4 x 4 on a coarse one), each a 512-pixel JPEG of GIBS's EPSG:4326 "500m" tile
 * matrix set at level 5, 6 or 7 (9, 4.5 or 2.25 degrees a tile; about 2, 1 and 0.5 km a pixel), whichever makes a texel about a pixel
 * at the ground under the view. Its tiles sit in one texture (512 N square, no mipmaps) addressed round: a tile's slot is its column
 * and row modulo N, so when the window moves only the tiles it gains are fetched. A small N x N texture says which slots hold the
 * tile the window wants there; the Earth's shader (realism.ts, dayColor) samples a tile only where one has arrived, feathers it into
 * the map toward the window's edge, and keeps the map everywhere else.
 *
 * Nothing is added to the scene: two textures and four uniforms on the realistic Earth's own material. Only the realistic surface asks,
 * only when a pixel covers less than four fifths of the shipped map's texel (about 3.9 km), never on a lean connection; the default globe asks nobody. Tiles
 * are loaded as images with crossOrigin 'anonymous' (GIBS answers Access-Control-Allow-Origin: *, and the page's img-src allows it),
 * six at a time, nearest the window's middle first, and the browser keeps them for the three days GIBS says.
 */
import { DataTexture, LinearFilter, LuminanceFormat, NearestFilter, RGBAFormat, Texture, UnsignedByteType, Vector2, Vector3, Vector4 } from 'three';
import type { PerspectiveCamera, WebGLRenderer } from 'three';

export const GIBS_TILE = (z: number, row: number, col: number) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/500m/${z}/${row}/${col}.jpeg`;

const TILE = 512;
const LEVELS = [5, 6, 7];
/** degrees a tile spans at level z (EPSG:4326 "500m": 288 degrees at level 0) */
const span = (z: number) => 288 / 2 ** z;
/** the shipped map's texel at 8192, in km (360 degrees over 8192 pixels, 111.32 km a degree) */
const BASE_KM = 360 / 8192 * 111.32;
const IN_FLIGHT = 6;

export interface DetailUniforms {
  uDetail: { value: Texture | null };
  uDetailOk: { value: Texture | null };
  uDetailWin: { value: Vector4 };
  uDetailOn: { value: number };
}

export interface Detail {
  uniforms: DetailUniforms;
  /** per frame, before the render: where the view is, and what to fetch and lay in */
  frame(cam: PerspectiveCamera, earthTurn: number, pxHeight: number): void;
  dispose(): void;
}

/** The shader's side: the day map's colour at a point of the sphere's uv, from the window where a tile has arrived. */
export const DETAIL_GLSL = `
uniform sampler2D uDetail;
uniform sampler2D uDetailOk;
uniform vec4 uDetailWin;      /* the window's first column and row, its size in tiles, and a tile's span in degrees */
uniform float uDetailOn;
vec3 dayColor(sampler2D base, vec2 uv){
  vec3 c = texture2D(base, uv).rgb;
  if (uDetailOn < 0.5) return c;
  float s = uDetailWin.w, n = uDetailWin.z, cols = 360.0 / s;
  float east = uv.x * 360.0, south = (1.0 - uv.y) * 180.0;   /* degrees east of -180, and south of the north pole */
  vec2 t = vec2(mod(east / s - uDetailWin.x, cols), south / s - uDetailWin.y);
  if (t.x < 0.0 || t.y < 0.0 || t.x >= n || t.y >= n) return c;
  vec2 cell = floor(t);
  vec2 slot = mod(cell + uDetailWin.xy, n);
  if (texture2D(uDetailOk, (slot + 0.5) / n).r < 0.5) return c;
  vec2 f = clamp(t - cell, 0.5 / 512.0, 1.0 - 0.5 / 512.0);
  vec3 d = texture2D(uDetail, (slot + f) / n).rgb;
  float edge = min(min(t.x, n - t.x), min(t.y, n - t.y));
  return mix(c, d, smoothstep(0.0, 0.6, edge));
}`;

interface Slot { key: string; ok: boolean }

export function makeDetail(renderer: WebGLRenderer, opts: { small: boolean; wake?: () => void }): Detail {
  const n = opts.small ? 4 : 8;
  const size = n * TILE;
  /* the tiles' texture: allocated on the GPU without a copy in memory (no data), filled tile by tile with copyTextureToTexture */
  const win = new DataTexture(null as unknown as BufferSource, size, size, RGBAFormat, UnsignedByteType);
  win.generateMipmaps = false;
  win.minFilter = LinearFilter; win.magFilter = LinearFilter;
  win.flipY = false;
  win.needsUpdate = true;
  const okData = new Uint8Array(n * n);
  const ok = new DataTexture(okData, n, n, LuminanceFormat, UnsignedByteType);
  ok.minFilter = NearestFilter; ok.magFilter = NearestFilter; ok.generateMipmaps = false;
  ok.needsUpdate = true;

  const uniforms: DetailUniforms = {
    uDetail: { value: win }, uDetailOk: { value: ok }, uDetailWin: { value: new Vector4(0, 0, n, span(5)) }, uDetailOn: { value: 0 }
  };
  const slots: Slot[] = Array.from({ length: n * n }, () => ({ key: '', ok: false }));
  const ready: { slot: number; key: string; img: HTMLImageElement }[] = [];
  const pending = new Set<string>();
  const failed = new Set<string>();
  let z = 0, col0 = 0, row0 = 0, uploaded = false, frames = 0, gone = false;
  const dir = new Vector3(), p = new Vector3(), pos = new Vector2();

  const keyOf = (zz: number, row: number, col: number) => zz + '/' + row + '/' + col;
  const cols = (zz: number) => Math.round(360 / span(zz));
  const rows = (zz: number) => Math.round(180 / span(zz));

  /* every slot the window wants, nearest its middle first, with the tile that belongs there */
  function wanted() {
    const out: { slot: number; row: number; col: number; key: string; d: number }[] = [];
    const c = cols(z);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const row = row0 + j, col = (((col0 + i) % c) + c) % c;
      const slot = (row % n) * n + (col % n);
      out.push({ slot, row, col, key: keyOf(z, row, col), d: Math.abs(i - (n - 1) / 2) + Math.abs(j - (n - 1) / 2) });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  function fetchTile(t: { slot: number; row: number; col: number; key: string }) {
    pending.add(t.key);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => { pending.delete(t.key); if (!gone) { ready.push({ slot: t.slot, key: t.key, img }); opts.wake?.(); } };
    img.onerror = () => { pending.delete(t.key); failed.add(t.key); };
    img.src = GIBS_TILE(z, t.row, t.col);
  }

  function setOk(slot: number, v: boolean) {
    slots[slot]!.ok = v;
    okData[slot] = v ? 255 : 0;
    ok.needsUpdate = true;
  }

  return {
    uniforms,
    frame(cam, earthTurn, pxHeight) {
      if (gone) return;
      frames++;
      /* the ground under the middle of the view (or under the camera, when the view's middle misses the Earth) */
      cam.getWorldDirection(dir);
      const C = cam.position, b = C.dot(dir), cc = C.lengthSq() - 1, disc = b * b - cc;
      let dist: number;
      if (disc > 0 && -b - Math.sqrt(disc) > 0) { dist = -b - Math.sqrt(disc); p.copy(C).addScaledVector(dir, dist); }
      else { p.copy(C).normalize(); dist = C.length() - 1; }
      /* into the Earth's own frame (undo the group's turn about the pole), then to longitude and latitude as the sphere's uv has them */
      const a = -earthTurn, ca = Math.cos(a), sa = Math.sin(a);
      const x = ca * p.x + sa * p.z, y = p.y, zz = -sa * p.x + ca * p.z;
      const lat = Math.asin(Math.max(-1, Math.min(1, y))) * 180 / Math.PI;
      const lon = Math.atan2(-zz, x) * 180 / Math.PI;
      /* what a pixel covers there, in km, and the level whose texel is about that */
      const pixKm = Math.max(dist, 1e-4) * 6378.137 * (cam.fov * Math.PI / 180) / Math.max(pxHeight, 1);
      if (pixKm * 1.25 >= BASE_KM) { uniforms.uDetailOn.value = 0; return; }
      let want = LEVELS[LEVELS.length - 1]!;
      for (const lv of LEVELS) { if (span(lv) / TILE * 111.32 <= pixKm * 1.25) { want = lv; break; } }
      /* the window: moved only when its middle tile is more than a tile from where the view now is */
      const s = span(want), cx = Math.floor((lon + 180) / s), cy = Math.floor((90 - lat) / s);
      const midC = col0 + n / 2 - 0.5, midR = row0 + n / 2 - 0.5;
      const c = cols(want);
      const dc = Math.abs(((cx - midC) % c + c + c / 2) % c - c / 2);
      if (want !== z || dc > 1.5 || Math.abs(cy - midR) > 1.5) {
        z = want;
        col0 = cx - Math.floor(n / 2);
        row0 = Math.max(0, Math.min(rows(z) - n, cy - Math.floor(n / 2)));
        uniforms.uDetailWin.value.set(((col0 % c) + c) % c, row0, n, s);
        /* a slot keeps its tile only if the window still wants that tile there */
        const keep = new Set(wanted().map(t => t.key));
        slots.forEach((sl, i) => { if (sl.ok && !keep.has(sl.key)) setOk(i, false); });
      }
      uniforms.uDetailOn.value = 1;
      /* the texture is on the GPU once a frame has drawn with it; tiles that came before wait for that */
      if (!uploaded) { if (frames > 1) uploaded = true; }
      if (uploaded && ready.length) {
        const keep = new Set(wanted().map(t => t.key + '@' + t.slot));
        for (const r of ready.splice(0)) {
          if (!keep.has(r.key + '@' + r.slot)) continue;
          const tex = new Texture(r.img);
          pos.set((r.slot % n) * TILE, Math.floor(r.slot / n) * TILE);
          renderer.copyTextureToTexture(pos, tex, win);
          tex.dispose();
          slots[r.slot]!.key = r.key;
          setOk(r.slot, true);
        }
      }
      /* ask for what is missing, nearest first, a few at a time */
      for (const t of wanted()) {
        if (pending.size >= IN_FLIGHT) break;
        const sl = slots[t.slot]!;
        if ((sl.ok && sl.key === t.key) || pending.has(t.key) || failed.has(t.key)) continue;
        fetchTile(t);
      }
    },
    dispose() {
      gone = true;
      ready.length = 0;
      win.dispose(); ok.dispose();
    }
  };
}
