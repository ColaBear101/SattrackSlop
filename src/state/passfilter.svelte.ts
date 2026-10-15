import { filterOn, filterPasses, readFilter, type PassFilter } from '../lib/analysis/pass-filter';
import type { Analysis, Optics } from '../lib/types';
import { getOptics } from './engine';
import { localStore } from './storage';

/* The pass list's filter (CHANGES-FROM-LEGACY.md, L56): which passes the rail's list shows. A filter of the list only - the
   analysis, its mask, the countdown, the totals, the timeline's marks, the report and the exports are untouched.

   What the reader chose is kept under a key of its own, not in gt.prefs (which index.html reads before the first paint), and
   written only when the reader changes it: a visit that never touches the filter stores nothing. Read when this module is
   first asked for, which is with the filter's bar (components/rail/PassFilterBar.svelte), a chunk of its own the list asks
   for once there are passes: the entry carries none of it. */
const KEY = 'gt.passfilter';

function stored(): PassFilter | null {
  try { return readFilter(localStore().getItem(KEY)); } catch { return null; }   // storage refused: nothing was stored
}

class PassFilterState {
  /** what the reader chose; null is nothing chosen (or forgotten with "Show every pass") */
  spec = $state.raw<PassFilter | null>(stored());
  /* the optical verdict of each pass, worked out once for an analysis (and the optics it was asked of: a new site makes new ones) */
  private eyes = new WeakMap<Analysis, { o: Optics; v: boolean[] }>();

  /** Is the list filtered? */
  get on(): boolean { return !!this.spec && filterOn(this.spec); }

  /** The reader changed the filter: it holds for this visit whatever the browser lets the page keep. */
  set(f: PassFilter): void {
    this.spec = f;
    try { localStore().setItem(KEY, JSON.stringify(f)); } catch { /* private window or full storage */ }
  }
  /** The reader asked for every pass: nothing is left stored. */
  clear(): void {
    this.spec = null;
    try { localStore().removeItem(KEY); } catch { /* as above */ }
  }

  /** Is pass i of this analysis naked-eye visible? The optics' verdict on the whole pass (passOptical's eye), once per pass. */
  eye(D: Analysis, i: number): boolean {
    const o = getOptics();
    let m = this.eyes.get(D);
    if (!m || m.o !== o) this.eyes.set(D, (m = { o, v: [] }));
    return (m.v[i] ??= o.passOptical(D.track, D.passes[i]!)?.eye === 'yes');
  }

  /** The indices of the passes the list shows, in the analysis's order, or null when it shows every one. */
  shown(D: Analysis | null, offsetAt: (ms: number) => number): number[] | null {
    const f = this.spec;
    return D && f && filterOn(f) ? filterPasses(D.passes, f, offsetAt, i => this.eye(D, i)) : null;
  }
}

export const passfilter = new PassFilterState();
