/* The list of models a reader has given the page, as it is kept in localStorage (CHANGES-FROM-LEGACY.md, L73).
 *
 * The models themselves are files, and live in the browser's IndexedDB (state/models.svelte.ts). This is the small record beside them
 * that says which spacecraft have one, under the page's own `gt.` namespace, so the close-up knows without opening a database and
 * "Forget" can count them (lib/forget.ts reads it synchronously, as it reads everything else). One entry per spacecraft: its key (a
 * catalogue number, or `custom:<id>` for an orbit of the reader's own; lib/models/validate.ts modelKey), the file's name as shown, its
 * size, and how to read it: the units the file is in, and which of its axes is forward and which is up.
 *
 * Untrusted text in, only valid entries out, as the other records are read: anything that is not a list of entries of this version is
 * nothing, an entry with a key that cannot be ours is dropped, a key is kept once, the units and axes fall back to glTF's own, and past
 * MODEL_MAX_COUNT the rest is left out. Pure. */
import { AXES, modelFrame, type Axis } from './attitude';
import { cleanModelName, MODEL_MAX_COUNT, UNITS, type Units } from './validate';

export const MODELS_KEY = 'gt.models';

export interface ModelEntry {
  key: string;
  name: string;
  size: number;
  units: Units;
  forward: Axis;
  up: Axis;
  /** when it was given, ISO 8601 */
  added: string;
}

const KEY = /^(\d{1,5}|custom:c[1-9]\d{0,3})$/;

export function readIndex(raw: string | null): ModelEntry[] {
  let j: unknown;
  try { j = JSON.parse(raw || 'null'); } catch { return []; }
  const rec = j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : null;
  if (!rec || rec.v !== 1 || !Array.isArray(rec.items)) return [];
  const out: ModelEntry[] = [];
  for (const it of rec.items as unknown[]) {
    if (out.length >= MODEL_MAX_COUNT) break;
    const o = it && typeof it === 'object' && !Array.isArray(it) ? it as Record<string, unknown> : null;
    if (!o || typeof o.key !== 'string' || !KEY.test(o.key) || out.some(x => x.key === o.key)) continue;
    let forward = AXES.includes(o.forward as Axis) ? o.forward as Axis : '+Z';
    let up = AXES.includes(o.up as Axis) ? o.up as Axis : '+Y';
    if (!modelFrame(forward, up)) { forward = '+Z'; up = '+Y'; }
    out.push({
      key: o.key, name: cleanModelName(typeof o.name === 'string' ? o.name : ''),
      size: typeof o.size === 'number' && Number.isFinite(o.size) && o.size > 0 ? o.size : 0,
      units: UNITS.includes(o.units as Units) ? o.units as Units : 'm', forward, up,
      added: typeof o.added === 'string' && !Number.isNaN(Date.parse(o.added)) ? o.added : ''
    });
  }
  return out;
}

export const writeIndex = (items: readonly ModelEntry[]): string => JSON.stringify({ v: 1, items });
