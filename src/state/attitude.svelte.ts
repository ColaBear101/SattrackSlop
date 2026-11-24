/* How the reader flies each model in the close-up, kept only in this browser (CHANGES-FROM-LEGACY.md, L77).
 *
 * New in the rebuild. In the close-up's chunk, which reads it the first time the Close-up camera is pressed: a visit that never opens
 * the "How it flies" panel reads one key and writes nothing. The record is lib/models/attitude-record.ts's, by model (a registry id,
 * or ownId for a model a reader kept). It is written only by a change in the panel: a slider as it is let go (while it moves, the model
 * follows it from memory), a choice or a number at once. A model set back to its own attitude has its entry deleted, and the last one
 * deleted takes the key with it. Under the assignment snapshot (?tle=embedded), which keeps nothing, or where the browser keeps nothing
 * for the page, a setting holds for the visit and the panel says so. Another tab's change is heard through the storage event, and the
 * close-up's card follows it. A reader's model removed, or kept anew in its place, takes its entry with it (dropOwn, from the model's
 * panel). "Forget what this page stored" removes the key with the page's others (lib/forget.ts), where it counts among the display
 * choices. */
import { sameAttitude, type Attitude } from '../lib/models/attitude';
import { ATTITUDE_KEY, readAttitudes, writeAttitudes } from '../lib/models/attitude-record';

/* app.svelte's PINNED, read again here: importing it would tie the close-up's chunk to the entry's (components/closeup/closeup.ts) */
const PINNED = /(?:^|[?&])tle=embedded(?:&|$)/.test(location.search);

const ls = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const stored = (): string | null => { try { return ls()?.getItem(ATTITUDE_KEY) ?? null; } catch { return null; } };

class Attitudes {
  /** the reader's settings, by model id; a model with none flies its own */
  items = $state.raw<Readonly<Record<string, Attitude>>>(PINNED ? {} : readAttitudes(stored()));
  /** where the last change went: 'kept' in this browser, 'memory' for this visit only, '' before any */
  where = $state<'kept' | 'memory' | ''>('');
  private dirty = false;

  constructor() {
    try {
      window.addEventListener('storage', e => {
        /* another tab wrote the record or removed it, or the origin's storage was cleared (a null key) */
        if (!PINNED && (e.key === null || e.key === ATTITUDE_KEY)) { this.items = readAttitudes(e.newValue); this.dirty = false; }
      });
    } catch { /* no window events: nothing to hear */ }
  }

  /** The reader's setting for a model, or null for its own. */
  get(id: string): Attitude | null {
    return Object.prototype.hasOwnProperty.call(this.items, id) ? this.items[id]! : null;
  }

  /** Fly a model as `a` (null, or its own, deletes its entry). `keep` false holds it in memory until flush() or the next kept change:
   *  a slider moving. */
  set(id: string, a: Attitude | null, own: Attitude, keep = true): void {
    const next: Record<string, Attitude> = { ...this.items };
    if (!a || sameAttitude(a, own)) delete next[id]; else next[id] = a;
    this.items = next;
    if (keep) this.write(); else this.dirty = true;
  }

  /** Keep what a slider left in memory. */
  flush(): void { if (this.dirty) this.write(); }

  /** A reader's model removed, or kept anew in its place: its setting goes with it (the next one starts from its own). */
  dropOwn(key: string): void {
    const pre = 'own:' + key + '@';
    if (!Object.keys(this.items).some(k => k.startsWith(pre))) return;
    this.items = Object.fromEntries(Object.entries(this.items).filter(([k]) => !k.startsWith(pre)));
    this.write();
  }

  private write(): void {
    this.dirty = false;
    if (PINNED) { this.where = 'memory'; return; }
    try {
      const st = ls();
      if (!st) throw new Error('no storage');
      if (Object.keys(this.items).length) st.setItem(ATTITUDE_KEY, writeAttitudes(this.items));
      else st.removeItem(ATTITUDE_KEY);
      this.where = 'kept';
    } catch { this.where = 'memory'; }
  }
}

export const attitudes = new Attitudes();
