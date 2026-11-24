/* A model file a reader offers the page, checked before anything is built from it (CHANGES-FROM-LEGACY.md, L73).
 *
 * New in the rebuild. A reader can give a spacecraft a 3D model of their own (glTF 2.0, as a binary .glb or a .gltf that carries its
 * data inside it); the page keeps it only in that browser (state/models.svelte.ts). The file is untrusted, so it is read in this
 * order and refused at the first thing wrong, with the reason said (lib/text/models.ts):
 *
 *   1. its size, before a byte is read (MODEL_MAX_BYTES);
 *   2. its first bytes: a GLB header (magic "glTF", version 2, a length that is the file's own) or the "{" of glTF's JSON;
 *   3. the JSON, read on its own and capped (JSON_MAX_BYTES), before three is given any of it: the glTF version; every extension
 *      the file says it cannot be drawn without, against what three r128's loader reads with no decoder (the page ships none,
 *      and the compressed forms need WebAssembly); every buffer and image, which must carry its bytes inside the file (a GLB's own
 *      binary chunk, a view into a buffer, or a data: URI), so that a model can never make the browser fetch anything; and the
 *      sum of what its accessors would allocate, so a hostile count is refused before three makes an array of it;
 *   4. the triangles, which past TRIANGLES_MAX are more than a page should draw (and past TRIANGLES_WARN are said to be slow).
 *
 * three's own parse comes after all of that (scene/closeup-pass.ts), with a URL guard of its own as a second line. Pure. */
import type { V3 } from './attitude';

export const MODEL_MAX_BYTES = 50 * 1024 * 1024;
export const MODEL_MAX_COUNT = 12;
export const JSON_MAX_BYTES = 16 * 1024 * 1024;
/** numbers the accessors would hold in all (sixty million floats are 240 MB) */
export const ELEMENTS_MAX = 60_000_000;
export const TRIANGLES_WARN = 1_000_000;
export const TRIANGLES_MAX = 3_000_000;

/** What three r128's GLTFLoader reads with nothing else loaded (examples/jsm/loaders/GLTFLoader.js:406-417), less the three below. */
export const READABLE: readonly string[] = [
  'KHR_materials_clearcoat', 'KHR_materials_pbrSpecularGlossiness', 'KHR_materials_transmission', 'KHR_materials_unlit',
  'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_lights_punctual', 'EXT_texture_webp'
];
/** Compressed forms the loader reads only with a decoder, which the page does not ship. */
export const NEEDS_DECODER: readonly string[] = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];

export type Refusal =
  | { why: 'empty' }
  | { why: 'too-big'; bytes: number }
  | { why: 'not-gltf' }
  | { why: 'version'; version: string }
  | { why: 'truncated' }
  | { why: 'json' }
  | { why: 'external'; uri: string }
  | { why: 'decoder'; ext: string }
  | { why: 'extension'; ext: string }
  | { why: 'no-mesh' }
  | { why: 'too-much-data'; elements: number }
  | { why: 'too-many-triangles'; triangles: number };

export const isRefusal = (x: unknown): x is Refusal => !!x && typeof x === 'object' && 'why' in x;

/** The size, before anything is read. */
export const checkSize = (bytes: number): Refusal | null =>
  !(bytes > 0) ? { why: 'empty' } : bytes > MODEL_MAX_BYTES ? { why: 'too-big', bytes } : null;

const GLB_MAGIC = 0x46546c67;      // "glTF", little-endian
const CHUNK_JSON = 0x4e4f534a;     // "JSON"
const CHUNK_BIN = 0x004e4942;      // "BIN\0"

/** What the first bytes say the file is: a GLB, glTF's JSON (after any byte-order mark and white space), or neither. */
export function sniff(head: Uint8Array): 'glb' | 'gltf' | null {
  if (head.length >= 4 && head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46) return 'glb';
  for (const c of head) {
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0xef || c === 0xbb || c === 0xbf) continue;
    return c === 0x7b ? 'gltf' : null;
  }
  return null;
}

/** A GLB's JSON, from its header and first chunk, and the length of its binary chunk (0 when it has none). The rest is not read. */
export function readGlb(buf: ArrayBuffer): { json: unknown; binBytes: number } | Refusal {
  if (buf.byteLength < 20) return { why: 'truncated' };
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== GLB_MAGIC) return { why: 'not-gltf' };
  const version = dv.getUint32(4, true);
  if (version !== 2) return { why: 'version', version: String(version) };
  const length = dv.getUint32(8, true);
  if (length !== buf.byteLength) return { why: 'truncated' };
  const jsonBytes = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== CHUNK_JSON) return { why: 'not-gltf' };
  if (20 + jsonBytes > length) return { why: 'truncated' };
  if (jsonBytes > JSON_MAX_BYTES) return { why: 'too-much-data', elements: jsonBytes };
  let json: unknown;
  try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonBytes))); } catch { return { why: 'json' }; }
  /* the next chunk starts right after the JSON's (whose length already includes its padding), as three's reader takes it */
  let binBytes = 0;
  const at = 20 + jsonBytes;
  if (at + 8 <= length && dv.getUint32(at + 4, true) === CHUNK_BIN) {
    binBytes = dv.getUint32(at, true);
    if (at + 8 + binBytes > length) return { why: 'truncated' };
  }
  return { json, binBytes };
}

/** A .gltf's JSON, read from its text. */
export function readGltf(text: string): { json: unknown } | Refusal {
  if (text.length > MODEL_MAX_BYTES) return { why: 'too-big', bytes: text.length };
  try { return { json: JSON.parse(text) }; } catch { return { why: 'json' }; }
}

export interface Inspection {
  triangles: number;
  /** the numbers the accessors would hold */
  elements: number;
  /** more triangles than draw comfortably (TRIANGLES_WARN) */
  heavy: boolean;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const obj = (x: unknown): Record<string, unknown> | null => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
const arr = (x: unknown): unknown[] => Array.isArray(x) ? x : [];
const num = (x: unknown): number => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
const shown = (uri: unknown): string => typeof uri === 'string' ? (uri.length > 60 ? uri.slice(0, 57) + '...' : uri) : 'nothing';

/** Everything in the JSON that has to be right before three is handed the file. `kind` is what sniff() said: a GLB's first buffer
 *  is its own binary chunk and needs no address. */
export function inspect(json: unknown, kind: 'glb' | 'gltf'): Inspection | Refusal {
  const j = obj(json);
  if (!j) return { why: 'json' };
  const version = obj(j.asset)?.version;
  if (typeof version !== 'string' || !/^2(\.|$)/.test(version)) return { why: 'version', version: typeof version === 'string' ? version.slice(0, 12) : '?' };
  for (const e of arr(j.extensionsRequired)) {
    const ext = String(e).slice(0, 60);
    if (NEEDS_DECODER.includes(ext)) return { why: 'decoder', ext };
    if (!READABLE.includes(ext)) return { why: 'extension', ext };
  }
  const buffers = arr(j.buffers);
  for (let i = 0; i < buffers.length; i++) {
    const uri = obj(buffers[i])?.uri;
    if (uri === undefined && kind === 'glb' && i === 0) continue;
    if (typeof uri !== 'string' || !/^data:/i.test(uri)) return { why: 'external', uri: shown(uri) };
  }
  for (const im of arr(j.images)) {
    const o = obj(im);
    if (!o || o.bufferView !== undefined) continue;
    if (typeof o.uri !== 'string' || !/^data:/i.test(o.uri)) return { why: 'external', uri: shown(o.uri) };
  }
  const accessors = arr(j.accessors);
  let elements = 0;
  for (const a of accessors) {
    const o = obj(a);
    if (!o) continue;
    elements += num(o.count) * (COMPONENTS[String(o.type)] ?? 16);
    const sparse = obj(o.sparse);
    if (sparse) elements += num(sparse.count) * 2;
  }
  if (elements > ELEMENTS_MAX) return { why: 'too-much-data', elements };
  let triangles = 0, primitives = 0;
  for (const m of arr(j.meshes)) for (const p of arr(obj(m)?.primitives)) {
    const o = obj(p);
    if (!o) continue;
    primitives++;
    const mode = o.mode === undefined ? 4 : num(o.mode);
    const indices = o.indices !== undefined ? obj(accessors[num(o.indices)]) : null;
    const positions = obj(accessors[num(obj(o.attributes)?.POSITION)]);
    const n = num((indices ?? positions)?.count);
    triangles += mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
  }
  if (!primitives) return { why: 'no-mesh' };
  if (triangles > TRIANGLES_MAX) return { why: 'too-many-triangles', triangles };
  return { triangles, elements, heavy: triangles > TRIANGLES_WARN };
}

export type Units = 'm' | 'cm' | 'mm';
export const UNITS: readonly Units[] = ['m', 'cm', 'mm'];
export const UNIT_SCALE: Record<Units, number> = { m: 1, cm: 0.01, mm: 0.001 };

/** What the file's numbers most likely are. glTF says metres, but CAD exports are often millimetres, which make a CubeSat three
 *  hundred metres long; nothing in orbit is wider than the ISS's 109 m, so past 150 units across millimetres is the better bet.
 *  The reader sees the size it gives and can say otherwise. */
export const suggestUnits = (size: V3): Units => Math.max(size[0], size[1], size[2]) > 150 ? 'mm' : 'm';

/** A file's name as the page shows it: the extension off, control and direction-changing characters out, no leading character a
 *  spreadsheet would take for a formula, at most 60 characters, and "Model" when nothing is left. */
export function cleanModelName(file: string): string {
  let t = String(file).slice(0, 1000).replace(/\.(glb|gltf)$/i, '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^[=+\-@|'"\s]+/, '');
  t = Array.from(t).slice(0, 60).join('').trim();
  return t || 'Model';
}

/** Where a reader's model is filed: a catalogue object by its number, one of the reader's own orbits by its id (its number is a
 *  placeholder that another orbit can be given after this one is removed). */
export const modelKey = (e: { satnum: string; custom?: boolean; cid?: string }): string =>
  e.custom && e.cid ? 'custom:' + e.cid : e.satnum;
