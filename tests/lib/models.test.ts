import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { AXES, axisVector, frameMatrix, lvlh, modelFrame, spinAngle, type V3 } from '../../src/lib/models/attitude';
import { dayBelow, sunlight, RE_KM } from '../../src/lib/models/sunlight';
import { BUILT_IN, builtInFor } from '../../src/lib/models/registry';
import {
  checkSize, cleanModelName, ELEMENTS_MAX, inspect, isRefusal, MODEL_MAX_BYTES, modelKey, readGlb, readGltf, sniff, suggestUnits,
  TRIANGLES_MAX, TRIANGLES_WARN, type Refusal
} from '../../src/lib/models/validate';
import { refusal, sizeLine } from '../../src/lib/text/models';
import { MODELS_KEY, readIndex, writeIndex, type ModelEntry } from '../../src/lib/models/index-record';
import { CREDITS, MODEL_NAMES } from '../../src/lib/text/closeup-card';
import { plain } from '../../src/lib/text/rich';
import { byName } from './helpers';

/* The close-up's arithmetic and the checks on a reader's model (CHANGES-FROM-LEGACY.md, L72 and L73): the frame a model is turned
   into, the sunlight that reaches it, which spacecraft wear which model, and every way a model file is refused. */

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]!) < eps);
const v = (x: Vector3): V3 => [x.x, x.y, x.z];

/** aimPov (scene/orbit3d.ts:1051-1071), as it is, for the frame it builds: the camera's up and the way it looks. */
function aimPovFrame(satPos: Vector3, satVel: Vector3 | null): { up: V3; look: V3 } {
  const zenith = satPos.clone().normalize();
  const ahead = (satVel && satVel.lengthSq() > 1e-12) ? satVel.clone() : new Vector3(0, 1, 0);
  ahead.addScaledVector(zenith, -ahead.dot(zenith));
  if (ahead.lengthSq() < 1e-12) {
    ahead.set(0, 1, 0).addScaledVector(zenith, -zenith.y);
    if (ahead.lengthSq() < 1e-12) ahead.set(1, 0, 0).addScaledVector(zenith, -zenith.x);
  }
  ahead.normalize();
  const right = new Vector3().crossVectors(ahead, zenith).normalize();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, zenith, ahead.clone().negate()));
  return { up: v(new Vector3(0, 1, 0).applyQuaternion(q)), look: v(new Vector3(0, 0, -1).applyQuaternion(q)) };
}

describe('the frame a model flies in (LVLH)', () => {
  const cases: [V3, V3 | null][] = [
    [[1.06, 0.2, -0.3], [-0.1, 7.6, 0.4]], [[0.1, -1.1, 0.05], [7.5, 0.3, -1.2]], [[-0.7, 0.5, 0.8], [3, -4, 5]],
    [[0, 1.07, 0], [0, 7.6, 0]], [[0, 0, 1.2], null], [[0, 1, 0], null]
  ];
  it('is orthonormal and right-handed, with up along the radius', () => {
    for (const [r, vel] of cases) {
      const f = lvlh(r, vel);
      for (const a of [f.left, f.up, f.forward]) expect(Math.hypot(...a)).toBeCloseTo(1, 12);
      const d = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(Math.abs(d(f.left, f.up)) + Math.abs(d(f.up, f.forward)) + Math.abs(d(f.left, f.forward))).toBeLessThan(1e-12);
      const m = new Matrix4().makeBasis(new Vector3(...f.left), new Vector3(...f.up), new Vector3(...f.forward));
      expect(m.determinant()).toBeCloseTo(1, 12);
      expect(near(f.up, v(new Vector3(...r).normalize()), 1e-12)).toBe(true);
    }
  });
  it('is the POV camera\'s frame: up is the camera\'s up, forward is where it looks, with the same fallbacks', () => {
    for (const [r, vel] of cases) {
      const f = lvlh(r, vel), pov = aimPovFrame(new Vector3(...r), vel ? new Vector3(...vel) : null);
      expect(near(f.up, pov.up, 1e-12)).toBe(true);
      expect(near(f.forward, pov.look, 1e-12)).toBe(true);
    }
  });
  it('as a matrix, takes the canonical axes to the frame\'s', () => {
    const f = lvlh([1.06, 0.2, -0.3], [-0.1, 7.6, 0.4]);
    const m = new Matrix4().makeBasis(new Vector3(...f.left), new Vector3(...f.up), new Vector3(...f.forward));
    expect(near(v(new Vector3(0, 0, 1).applyMatrix4(m)), f.forward, 1e-12)).toBe(true);
    expect(frameMatrix(f)).toEqual([...f.left, ...f.up, ...f.forward]);
  });
});

describe('a model\'s own axes, turned into the canonical frame', () => {
  it('maps forward to +Z and up to +Y for every pair at right angles, always as a proper rotation', () => {
    let pairs = 0;
    for (const fw of AXES) for (const up of AXES) {
      const m = modelFrame(fw, up);
      const a = axisVector(fw), b = axisVector(up);
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] !== 0) { expect(m).toBeNull(); continue; }
      pairs++;
      const r = new Matrix4().set(m![0]!, m![3]!, m![6]!, 0, m![1]!, m![4]!, m![7]!, 0, m![2]!, m![5]!, m![8]!, 0, 0, 0, 0, 1);
      expect(r.determinant()).toBe(1);
      expect(near(v(new Vector3(...a).applyMatrix4(r)), [0, 0, 1])).toBe(true);
      expect(near(v(new Vector3(...b).applyMatrix4(r)), [0, 1, 0])).toBe(true);
    }
    expect(pairs).toBe(24);
  });
  it('leaves a model drawn the glTF way (+Z forward, +Y up) as it is', () => {
    expect(modelFrame('+Z', '+Y')).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it('turns with the clock, not the wall: the same instant is the same angle, and a full turn comes back', () => {
    expect(spinAngle(2, 1_790_000_000_000)).toBe(spinAngle(2, 1_790_000_000_000));
    expect(spinAngle(2, 0)).toBe(0);
    expect(spinAngle(2, 45_000)).toBeCloseTo(Math.PI / 2, 12);
    expect(spinAngle(2, 180_000)).toBeCloseTo(0, 9);
  });
});

describe('the sunlight on a spacecraft', () => {
  const s: V3 = [1, 0, 0];
  const at = (hKm: number, sunward = -1.0): V3 => [sunward, 1 + hKm / RE_KM, 0];  // the ray from (x, y) towards +x passes at height y
  it('is the full Sun on the sunward side', () => {
    expect(sunlight([0.5, 1.0, 0], s)).toEqual({ rgb: [1, 1, 1], geometric: 1, tangentKm: Infinity });
  });
  it('is none deep in the Earth\'s shadow, and all of it once the ray clears the air', () => {
    expect(sunlight([-1.06, 0, 0], s).rgb).toEqual([0, 0, 0]);
    expect(sunlight(at(150), s).rgb).toEqual([1, 1, 1]);
  });
  it('reddens through the limb: red outlasts green, which outlasts blue', () => {
    const { rgb } = sunlight(at(18), s);
    expect(rgb[0]).toBeGreaterThan(rgb[1]);
    expect(rgb[1]).toBeGreaterThan(rgb[2]);
    expect(rgb[0]).toBeLessThan(1);
    expect(rgb[2]).toBeGreaterThan(0);
  });
  it('dims steadily as the craft goes into the shadow', () => {
    let last = 2;
    for (let h = 120; h >= -30; h -= 2) {
      const g = sunlight(at(h), s).rgb[1];
      expect(g).toBeLessThanOrEqual(last + 1e-15);
      last = g;
    }
    expect(last).toBe(0);
  });
  it('sees the day below in proportion to where the Sun is', () => {
    expect(dayBelow([1.06, 0, 0], s)).toBeCloseTo(1, 12);
    expect(dayBelow([-1.06, 0, 0], s)).toBeCloseTo(0, 12);
    expect(dayBelow([0, 1.06, 0], s)).toBeCloseTo(0.5, 12);
  });
});

describe('which spacecraft wear which model', () => {
  it('are the catalogue\'s own numbers, each in one model only', () => {
    expect(builtInFor('67683')?.id).toBe('knacksat2');
    expect(builtInFor('25544')?.id).toBe('iss');
    expect(builtInFor('48274')?.id).toBe('css');
    expect(builtInFor('43017')).toBeNull();
    const all = BUILT_IN.flatMap(m => m.sats);
    expect(new Set(all).size).toBe(all.length);
    expect(byName('KNACKSAT-2').satnum).toBe('67683');
    expect(['ISS (ZARYA)', 'ISS (NAUKA)', 'POISK'].map(n => builtInFor(byName(n).satnum)?.id)).toEqual(['iss', 'iss', 'iss']);
    expect(['CSS (TIANHE-1)', 'CSS (WENTIAN)', 'CSS (MENGTIAN)'].map(n => builtInFor(byName(n).satnum)?.id)).toEqual(['css', 'css', 'css']);
  });
  it('each has a name and a credit to show', () => {
    for (const m of BUILT_IN) {
      expect(MODEL_NAMES[m.id].length).toBeGreaterThan(2);
      expect(plain(CREDITS[m.id]).length).toBeGreaterThan(20);
    }
    expect(plain(CREDITS.css)).toMatch(/w29572227.*CC BY 4\.0/);
    expect(plain(CREDITS.iss)).toMatch(/NASA does not endorse/);
  });
});

/* ---- a reader's model file -------------------------------------------------------------------------------------------- */

/** A GLB as the spec lays it out: the 12-byte header, the JSON chunk padded with spaces to four bytes, and an optional binary chunk. */
function glb(json: unknown, bin = 0, o: { magic?: number; version?: number; length?: number; jsonType?: number } = {}): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jlen = (text.length + 3) & ~3, blen = (bin + 3) & ~3;
  const total = 12 + 8 + jlen + (bin ? 8 + blen : 0);
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, o.magic ?? 0x46546c67, true); dv.setUint32(4, o.version ?? 2, true); dv.setUint32(8, o.length ?? total, true);
  dv.setUint32(12, jlen, true); dv.setUint32(16, o.jsonType ?? 0x4e4f534a, true);
  u8.fill(0x20, 20, 20 + jlen); u8.set(text, 20);
  if (bin) { dv.setUint32(20 + jlen, blen, true); dv.setUint32(24 + jlen, 0x004e4942, true); }
  return buf;
}
/** The smallest model worth the name: one triangle, its three corners in a buffer. */
const triangle = (extra: Record<string, unknown> = {}) => ({
  asset: { version: '2.0' },
  buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], ...extra
});
const why = (x: unknown) => (isRefusal(x) ? x.why : 'ok');

describe('a model file, before anything is built from it', () => {
  it('is refused when empty or past the size the page takes, before a byte is read', () => {
    expect(checkSize(0)).toEqual({ why: 'empty' });
    expect(checkSize(MODEL_MAX_BYTES + 1)).toEqual({ why: 'too-big', bytes: MODEL_MAX_BYTES + 1 });
    expect(checkSize(1024)).toBeNull();
  });
  it('says what it is from its first bytes', () => {
    expect(sniff(new Uint8Array(glb(triangle()), 0, 16))).toBe('glb');
    expect(sniff(new TextEncoder().encode('﻿ \n {"asset":{}}'))).toBe('gltf');
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();      // a PNG
    expect(sniff(new Uint8Array([]))).toBeNull();
  });
  it('reads a GLB\'s JSON and nothing else, and refuses a header that is wrong', () => {
    const ok = readGlb(glb(triangle(), 36));
    expect(why(ok)).toBe('ok');
    expect(isRefusal(ok) ? 0 : ok.binBytes).toBe(36);
    expect(why(readGlb(glb(triangle(), 0, { magic: 0x12345678 })))).toBe('not-gltf');
    expect(readGlb(glb(triangle(), 0, { version: 1 }))).toEqual({ why: 'version', version: '1' });
    expect(why(readGlb(glb(triangle(), 0, { length: 99999 })))).toBe('truncated');
    expect(why(readGlb(glb(triangle(), 0, { jsonType: 0x004e4942 })))).toBe('not-gltf');
    expect(why(readGlb(new ArrayBuffer(10)))).toBe('truncated');
    const broken = glb(triangle());
    new Uint8Array(broken)[20] = 0x7d;                                         // "}" where the JSON starts
    expect(why(readGlb(broken))).toBe('json');
    expect(why(readGltf('{"asset":'))).toBe('json');
  });
  it('takes a model that carries everything inside it', () => {
    expect(inspect(triangle(), 'glb')).toEqual({ triangles: 1, elements: 9, heavy: false });
    const data = triangle({ buffers: [{ byteLength: 36, uri: 'data:application/octet-stream;base64,AAAA' }],
      images: [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }, { bufferView: 0, mimeType: 'image/png' }] });
    expect(why(inspect(data, 'gltf'))).toBe('ok');
    expect(why(inspect(triangle({ extensionsRequired: ['KHR_texture_transform', 'KHR_mesh_quantization'] }), 'glb'))).toBe('ok');
  });
  it('refuses anything that would make the browser fetch: a web address, a file beside it, a buffer with no bytes', () => {
    expect(inspect(triangle({ buffers: [{ byteLength: 36, uri: 'https://example.com/a.bin' }] }), 'gltf'))
      .toEqual({ why: 'external', uri: 'https://example.com/a.bin' });
    expect(why(inspect(triangle({ buffers: [{ byteLength: 36, uri: 'model.bin' }] }), 'gltf'))).toBe('external');
    expect(why(inspect(triangle(), 'gltf'))).toBe('external');                // a .gltf's buffer with no address at all
    expect(why(inspect(triangle({ images: [{ uri: 'texture.png' }] }), 'glb'))).toBe('external');
    expect(why(inspect(triangle({ images: [{ uri: '//tracker.example/p.png' }] }), 'glb'))).toBe('external');
  });
  it('refuses compression it has no decoder for, and anything else it cannot draw without', () => {
    expect(inspect(triangle({ extensionsRequired: ['KHR_draco_mesh_compression'] }), 'glb')).toEqual({ why: 'decoder', ext: 'KHR_draco_mesh_compression' });
    expect(why(inspect(triangle({ extensionsRequired: ['EXT_meshopt_compression'] }), 'glb'))).toBe('decoder');
    expect(why(inspect(triangle({ extensionsRequired: ['KHR_texture_basisu'] }), 'glb'))).toBe('decoder');
    expect(why(inspect(triangle({ extensionsRequired: ['VENDOR_magic'] }), 'glb'))).toBe('extension');
  });
  it('refuses a version it does not read, a file with no shapes, a hostile count, and too many triangles', () => {
    expect(inspect(triangle({ asset: { version: '1.0' } }), 'glb')).toEqual({ why: 'version', version: '1.0' });
    expect(why(inspect({ asset: { version: '2.0' } }, 'glb'))).toBe('no-mesh');
    expect(why(inspect(null, 'glb'))).toBe('json');
    expect(why(inspect(triangle({ accessors: [{ count: ELEMENTS_MAX, type: 'VEC3' }] }), 'glb'))).toBe('too-much-data');
    const many = (n: number) => triangle({ accessors: [{ count: 3, type: 'VEC3' }, { count: n * 3, type: 'SCALAR' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }] });
    expect(inspect(many(TRIANGLES_MAX + 1), 'glb')).toEqual({ why: 'too-many-triangles', triangles: TRIANGLES_MAX + 1 });
    expect(inspect(many(TRIANGLES_WARN + 1), 'glb')).toMatchObject({ heavy: true });
    const strip = triangle({ meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }] });
    expect(inspect(strip, 'glb')).toMatchObject({ triangles: 1 });
  });
  it('guesses millimetres for a CAD export bigger than anything in orbit, and metres otherwise', () => {
    expect(suggestUnits([100, 100, 340.5])).toBe('mm');                       // a 3U CubeSat from CAD
    expect(suggestUnits([0.1, 0.1, 0.3405])).toBe('m');
    expect(suggestUnits([109, 73, 20])).toBe('m');                            // the ISS
  });
  it('shows a file\'s name cleaned, and files a reader\'s orbit by its id', () => {
    expect(cleanModelName('KNACKSAT-4 Assembly.glb')).toBe('KNACKSAT-4 Assembly');
    expect(cleanModelName('=cmd|calc.gltf')).toBe('cmd|calc');
    expect(cleanModelName('a‮evil\u0000name.GLB')).toBe('a evil name');
    expect(cleanModelName('x'.repeat(200) + '.glb')).toBe('x'.repeat(60));
    expect(cleanModelName('.glb')).toBe('Model');
    expect(modelKey({ satnum: '25544' })).toBe('25544');
    expect(modelKey({ satnum: 'O0001', custom: true, cid: 'c3' })).toBe('custom:c3');
  });
  it('keeps the list of a reader\'s models as valid entries only, under the page\'s namespace', () => {
    expect(MODELS_KEY).toBe('gt.models');
    const e: ModelEntry = { key: '25544', name: 'My ISS', size: 1234, units: 'mm', forward: '+X', up: '+Z', added: '2026-11-19T10:00:00.000Z' };
    expect(readIndex(writeIndex([e]))).toEqual([e]);
    for (const raw of [null, '', 'not json', '[]', '{"v":2,"items":[]}', '{"v":1}', '"x"']) expect(readIndex(raw)).toEqual([]);
    const messy = JSON.stringify({ v: 1, items: [
      e, { ...e, name: 'again' },                                   // a key twice: the first is kept
      { key: '__proto__' }, { key: 'O0001' }, { key: 'custom:c3', name: '=cmd', units: 'yards', forward: '+Y', up: '+Y', size: -1, added: 'soon' },
      null, 7, { key: 123 }
    ] });
    expect(readIndex(messy)).toEqual([e, { key: 'custom:c3', name: 'cmd', size: 0, units: 'm', forward: '+Z', up: '+Y', added: '' }]);
  });
  it('has a sentence for every refusal, and says a size in the unit that reads best', () => {
    const all: Refusal[] = [
      { why: 'empty' }, { why: 'too-big', bytes: 60 * 1048576 }, { why: 'not-gltf' }, { why: 'version', version: '1.0' },
      { why: 'truncated' }, { why: 'json' }, { why: 'external', uri: 'a.bin' }, { why: 'decoder', ext: 'KHR_draco_mesh_compression' },
      { why: 'extension', ext: 'X' }, { why: 'no-mesh' }, { why: 'too-much-data', elements: 1e9 }, { why: 'too-many-triangles', triangles: 4e6 }
    ];
    for (const r of all) expect(refusal(r)).toMatch(/^[A-Z].+\.$/);
    expect(refusal({ why: 'too-big', bytes: 60 * 1048576 })).toBe('That file is 60 MB; the page takes models of up to 50 MB.');
    expect(sizeLine(0.1, 0.1, 0.34)).toBe('Size: 10.0 cm × 10.0 cm × 34.0 cm');
    expect(sizeLine(109, 73.2, 2.5)).toBe('Size: 109 m × 73.2 m × 2.50 m');
    expect(sizeLine(340.5, 1500, 12000)).toBe('Size: 341 m × 1.5 km × 12 km');
  });
});
