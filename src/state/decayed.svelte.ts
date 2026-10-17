import type { CatalogueEntry } from '../lib/catalogue/parse';
import { decayAt } from '../lib/catalogue/decayed';
import { DECAYED_NOW, decayedNote } from '../lib/text/decayed';
import { clock } from './clock.svelte';
import { BODY, satellite } from './engine';
import { live } from './live.svelte';

/* What the picker marks "decayed now" (CHANGES-FROM-LEGACY.md, L59): the entries of the catalogue SGP4 has come down at the clock's
   instant when the list is opened, one propagation each (src/lib/catalogue/decayed.ts). The clock's, not the wall clock's: a load
   puts the clock at the start of the window it analyses, so moving the window (to a set's epoch, say) moves the instant the marks
   are for with it, and a mark does not contradict the window a pick then loads. While the clock runs at real time it is now. Its
   own chunk, asked for by the picker the first time it opens and never in the snapshot (?tle=embedded, where each window opens at
   its own set's epoch, so a mark for one instant could contradict a window that loads): a visit that never opens the list computes
   none of it.

   The 2,158 propagations (a few tens of milliseconds) are spread over the browser's idle moments where it has them, and slices of a
   fixed size where it does not, so the list can be typed into while they run; the marks appear together, once every entry has been
   through. The lines asked about are the ones a pick would analyse: the embedded set, or the live one taken for it. Nothing is
   stored, nothing is fetched, and app.catalogue is never filtered: a mark takes no row away. A set is worked out again at the next
   opening when the catalogue is another, when a live set has been taken or given back since (live.check adopts one after a pick,
   and the next opening must mark the lines a pick would now analyse), or when the clock is more than an hour from the instant it
   was worked out for, so "now" stays near enough to the clock.

   The set holds positions in the catalogue, which are the picker's own indices for it (rank.ts: 0 to 2,157 the catalogue, the
   reader's orbits after it), so an orbit of the reader's own is never marked, whatever number it carries. */
const FRESH_MS = 3600e3;
/** entries per slice: the least done in one go, whether the browser idles (it goes on while the idle moment lasts) or not */
export const SLICE = 240;

type Idle = { timeRemaining(): number; didTimeout: boolean };
type Later = (f: (d?: Idle) => void) => void;
const later: Later = f => {
  const ric = (globalThis as { requestIdleCallback?: (cb: (d: Idle) => void, o: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(f, { timeout: 400 });
  else setTimeout(f, 0);
};

/** The live sets as they stand, as one string: any set taken, replaced or given back changes it. A handful of entries at most
 *  (one per spacecraft put on screen), so this is cheap to build at every opening. */
const liveKey = (): string => [...live.sets].map(([n, s]) => n + ' ' + s.l1 + ' ' + s.l2).join('\n');

class Decayed {
  /** the catalogue positions SGP4 has down at `at`, once the whole list has been through; null until then */
  set = $state.raw<ReadonlySet<number> | null>(null);
  /** the instant the set is for (ms, the clock's) */
  at = 0;
  readonly label = DECAYED_NOW;
  readonly note = decayedNote(BODY.reentryAltKm);
  private of: readonly CatalogueEntry[] | null = null;
  private sets = '';
  private busy = false;

  /** Is the row at this picker index marked? */
  has(i: number): boolean { return !!this.set?.has(i); }
  /** Is any of these rows marked (the line under the list is shown while one is)? */
  any(rows: readonly number[]): boolean { return rows.some(i => this.has(i)); }

  /** Work the set out for these entries at `ms` (the clock's instant), unless it is under way or still fresh for them: the same
   *  list, the same live sets, and an instant within the hour. Returns the store, for the picker to hold. */
  ensure(entries: readonly CatalogueEntry[], run: Later = later, ms: number = clock.now()): this {
    if (this.busy || !entries.length) return this;
    const sets = liveKey();
    if (this.of === entries && this.sets === sets && Math.abs(ms - this.at) < FRESH_MS) return this;
    this.busy = true;
    const out = new Set<number>(), lines = entries.map(e => live.effective(e));
    let i = 0;
    const step = (d?: Idle) => {
      const t0 = i;
      for (; i < lines.length && (i - t0 < SLICE || (d && !d.didTimeout && d.timeRemaining() > 2)); i++) {
        if (decayAt(lines[i]!, ms, satellite, BODY)) out.add(i);
      }
      if (i < lines.length) { run(step); return; }
      this.of = entries; this.sets = sets; this.at = ms; this.busy = false;
      this.set = out;
    };
    run(step);
    return this;
  }
}

export const decayed = new Decayed();
