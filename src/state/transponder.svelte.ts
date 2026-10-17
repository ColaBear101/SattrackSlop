import TABLE_URL from '../../data/transponders.json?url';
import { centreFor, defaultHold, offsetKey, offsetOf, readOffsets, withOffset, type Hold } from '../lib/analysis/transponder';
import { tableLoader, type Transponder, type TransponderTable } from '../lib/data/transponders';
import { localStore } from './storage';

/* The transponder calculator's store (CHANGES-FROM-LEGACY.md, L63). Lazy: only the panel imports it (components/rail/TransponderPanel.svelte,
   in the chunk xpdr), so nothing here runs, reads storage or fetches anything until the reader first opens "Uplink and transponders".

   The table is data/transponders.json, a file of the page's own fetched then (L62); a failure is said, and Try again asks again. What the
   reader chooses (the record, what is held, the held frequency) is in memory, for the spacecraft it was chosen for: another spacecraft starts
   afresh, and a reload forgets it. The one thing kept is each spacecraft's offset, under gt.xpdr = {"<NORAD number>": Hz}, written only by
   the panel's Set offset and Reset presses (setOffset, the one writer); the last offset reset removes the key. Where the browser refuses
   storage the offset holds for the visit, and the press says so. Another tab's write, or Forget what this page stored, is heard through the
   storage event and the offsets read again, as the watchlist's are (watch.svelte.ts). */
export const XPDR_KEY = 'gt.xpdr';

const stored = (): Record<string, number> => {
  try { return readOffsets(localStore().getItem(XPDR_KEY)); } catch { return {}; }   // storage refused: nothing kept
};

const load = tableLoader(() => fetch(TABLE_URL).then(r => {
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json() as Promise<unknown>;
}));

/** What the reader has chosen for one spacecraft: which of its records (an index into the table's list for it), what is held, and the
 *  held frequency, Hz (null while the box holds something that is not a frequency; `text` is then what was typed, kept in the box). */
export interface Pick { sat: string; i: number; hold: Hold; hz: number | null; text: string }

type Entry = { satnum: string; custom?: boolean } | null | undefined;

class TransponderState {
  table = $state.raw<TransponderTable | null>(null);
  failed = $state(false);
  pick = $state.raw<Pick | null>(null);
  /** per spacecraft, Hz, from gt.xpdr: read when this chunk first runs, at the first opening, never at boot */
  offsets = $state.raw<Readonly<Record<string, number>>>(stored());
  private busy: Promise<void> | null = null;

  /** Fetch the table, once; after a failure, `failed` is set and the next call asks again. */
  ensure(): Promise<void> {
    if (this.table) return Promise.resolve();
    this.failed = false;
    return (this.busy ??= load().then(t => { this.table = t; }, () => { this.failed = true; }).finally(() => { this.busy = null; }));
  }

  /** The records for the spacecraft on screen; none for an orbit of the reader's own (its number may be a real NORAD number, taken from
   *  a pasted element set's first line, but the orbit is not that spacecraft), and none before the table has come. */
  list(entry: Entry): Transponder[] {
    return !entry || entry.custom || !this.table ? [] : this.table.forSat(entry.satnum);
  }

  /** The choice for a spacecraft: the one made for it, or its first record, held on the lower-frequency leg at its centre. */
  pickFor(sat: string, list: readonly Transponder[]): Pick | null {
    const p = this.pick;
    if (p && p.sat === sat && p.i < list.length) return p;
    return list.length ? this.fresh(sat, 0, list[0]!) : null;
  }

  private fresh(sat: string, i: number, t: Transponder): Pick {
    const hold = defaultHold(t);
    return { sat, i, hold, hz: centreFor(t, hold), text: '' };
  }

  /** A record chosen: held on its lower-frequency leg, the dial at that leg's centre, to the hertz. Memory only. */
  choose(sat: string, list: readonly Transponder[], i: number): void {
    const t = list[i];
    if (t) this.pick = this.fresh(sat, i, t);
  }

  /** Another leg held, the dial given (the figure that leg had, so that nothing moves). Memory only. */
  setHold(sat: string, list: readonly Transponder[], hold: Hold, hz: number | null): void {
    const p = this.pickFor(sat, list);
    if (p) this.pick = { ...p, hold, hz, text: '' };
  }

  /** The held frequency typed (null for text that is not one, kept as typed). Memory only. */
  setDial(sat: string, list: readonly Transponder[], hz: number | null, text: string): void {
    const p = this.pickFor(sat, list);
    if (p) this.pick = { ...p, hz, text: hz === null ? text : '' };
  }

  /** The held frequency moved by d Hz; nothing while the box holds no frequency. Memory only. */
  nudge(sat: string, list: readonly Transponder[], d: number): void {
    const p = this.pickFor(sat, list);
    if (p && p.hz !== null && p.hz + d > 0) this.pick = { ...p, hz: p.hz + d, text: '' };
  }

  /** A spacecraft's kept offset, Hz (0 when none). */
  offsetFor(satnum: string): number { return offsetOf(this.offsets, satnum); }

  /** THE ONE WRITER of gt.xpdr: a spacecraft's offset set (0 takes it out; the last one out removes the key). 'kept' when the browser kept
   *  it, 'visit' when it refused (the offset holds for this visit), 'cleared' for 0; null for a satnum that is not a NORAD number. */
  setOffset(satnum: string, hz: number): 'kept' | 'visit' | 'cleared' | null {
    const next = withOffset(this.offsets, satnum, hz);
    if (!next) return null;
    this.offsets = next;
    const k = offsetKey(satnum)!;
    const kept = Object.prototype.hasOwnProperty.call(next, k);
    try {
      if (Object.keys(next).length) localStore().setItem(XPDR_KEY, JSON.stringify(next));
      else localStore().removeItem(XPDR_KEY);
    } catch { return 'visit'; }                     // private window or full storage
    return kept ? 'kept' : 'cleared';
  }

  /** gt.xpdr read again (another tab wrote it, or forgot everything). */
  reread(): void { this.offsets = stored(); }
}

export const xpdr = new TransponderState();

/* another tab wrote the offsets, removed them, or cleared the origin's storage (a null key) */
try { window.addEventListener('storage', e => { if (e.key === null || e.key === XPDR_KEY) xpdr.reread(); }); } catch { /* no window to hear from */ }
