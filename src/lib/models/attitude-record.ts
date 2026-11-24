/* How the reader flies each model in the close-up, as it is kept in localStorage (CHANGES-FROM-LEGACY.md, L77).
 *
 * New in the rebuild. Per model, not per spacecraft: the ISS's three catalogue numbers are one model. The page's own models are filed
 * by their registry id (lib/models/registry.ts), and a model a reader gave the page by ownId, `own:<spacecraft>@<when it was kept>`, so
 * that a model kept in its place starts from its own attitude. Only what differs from a model's own is kept: state/attitude.svelte.ts
 * deletes an entry set back to it, and the key with the last one. `{"v":1,"items":{"iss":{"pointing":"sun","face":"+Y","ypr":[0,0,0],
 * "spin":{"rate":[0,5,-2.5]}}}}`: the spin's rates about the model's own X, Y and Z, degrees a second, or null.
 *
 * Untrusted text in, only valid entries out, as the page's other records are read: anything that is not an object of this version is
 * nothing; an id that is neither a registry id nor a reader's model's is dropped; so is an entry whose pointing is not one of the three
 * (the model flies its own); a face that is not an axis is the front; each of the three angles must be a finite number of degrees and
 * is brought into -180 to 180 (one outside it is wrapped round); each of the three rates must be a finite number (one that is not is
 * 0), is held to MAX_SPIN degrees a second either way, and all three 0 is no spin. A spin kept before the three rates, one axis and
 * one rate (`{"axis":"-Z","degPerSec":2}`), is read as the same spin in three rates. At most ATTITUDE_MAX entries are read. Pure. */
import { AXES, MAX_SPIN, POINTINGS, spinFrom, type Attitude, type Axis, type Pointing, type Spin, type V3 } from './attitude';
import { BUILT_IN } from './registry';

export const ATTITUDE_KEY = 'gt.attitude';
/** the page's models and the most a reader may keep (lib/models/validate.ts MODEL_MAX_COUNT), with room to spare */
export const ATTITUDE_MAX = 32;

/** The id a reader's kept model's attitude is filed under: the spacecraft (validate.ts modelKey) and when the model was kept. */
export const ownId = (key: string, added: string): string => 'own:' + key + '@' + added;

const OWN_ID = /^own:(?:\d{1,5}|custom:c[1-9]\d{0,3})@[\dA-Za-z:.+-]{0,40}$/;
const isId = (id: string): boolean => BUILT_IN.some(b => b.id === id) || OWN_ID.test(id);

/** An angle in degrees brought into -180..180: as it is when it is there already, wrapped round when it is not, 0 when it is no number. */
function angle(x: unknown): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 0;
  if (x >= -180 && x <= 180) return x;
  const w = ((x + 180) % 360 + 360) % 360 - 180;
  return w === -180 && x > 0 ? 180 : w;
}

const rate = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(-MAX_SPIN, Math.min(MAX_SPIN, x)) : 0);

function spinOf(x: unknown): Spin | null {
  const o = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
  if (!o) return null;
  if (Array.isArray(o.rate)) {
    const r: V3 = [rate(o.rate[0]), rate(o.rate[1]), rate(o.rate[2])];
    return r[0] || r[1] || r[2] ? { rate: r } : null;
  }
  /* kept before the three rates: one axis and one rate */
  if (!AXES.includes(o.axis as Axis) || typeof o.degPerSec !== 'number' || !Number.isFinite(o.degPerSec)) return null;
  return spinFrom({ axis: o.axis as Axis, degPerSec: rate(o.degPerSec) });
}

/** One attitude, from whatever was stored; null when it is not one (the model then flies its own). */
export function readAttitude(x: unknown): Attitude | null {
  const o = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
  if (!o || !POINTINGS.includes(o.pointing as Pointing)) return null;
  const y = Array.isArray(o.ypr) ? o.ypr as unknown[] : [];
  const ypr: V3 = [angle(y[0]), angle(y[1]), angle(y[2])];
  return { pointing: o.pointing as Pointing, face: AXES.includes(o.face as Axis) ? o.face as Axis : '+Z', ypr, spin: spinOf(o.spin) };
}

/** The record, by model id. */
export function readAttitudes(raw: string | null): Record<string, Attitude> {
  let j: unknown;
  try { j = JSON.parse(raw || 'null'); } catch { return {}; }
  const rec = j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : null;
  const items = rec && rec.v === 1 && rec.items && typeof rec.items === 'object' && !Array.isArray(rec.items) ? rec.items as Record<string, unknown> : null;
  const out: Record<string, Attitude> = {};
  if (!items) return out;
  let n = 0;
  for (const id of Object.keys(items)) {
    if (n >= ATTITUDE_MAX) break;
    if (!isId(id)) continue;
    const a = readAttitude(items[id]);
    if (!a) continue;
    out[id] = a;
    n++;
  }
  return out;
}

export const writeAttitudes = (items: Readonly<Record<string, Attitude>>): string => JSON.stringify({ v: 1, items });
