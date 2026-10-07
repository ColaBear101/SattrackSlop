import { flushSync } from 'svelte';
import type { CatalogueEntry } from '../lib/catalogue/parse';
import {
  allocCid, CUSTOM_KEY, customFail, deepStart, isCustom, makeCustom, mergeStore, mkRefusal, offMsg, readStore, sgp4Refusal, storedRecord,
  uniqueName, type CustomEntry, type PlannedElements, type PlannerCore, type PlannerError, type Refusal
} from '../lib/planner/custom';
import { app, PINNED } from './app.svelte';
import { getEngine, satellite } from './engine';
import { plannerMods } from './planner-mods';

/* The reader's own orbits: the list, the one place that changes it, what is stored, and the signal that it changed.
 *
 * From legacy/index.html (main@4eadd7a), lines 10938-11219 (restoreCustoms, saveCustoms, addCustom, commitCustom, addCustomTLE,
 * updateCustom, removeCustom, the storage listener, paintCount's count) with the same rules; the pure parts are
 * lib/planner/custom.ts. The planner's maths is a chunk of its own, so the store is "on" only once it has been attached: until then
 * nothing here reads or writes the saved record, and the page is the console it was.
 *
 * A custom entry is a plain object that is edited IN PLACE. Everything that holds it - the analysis, the window, the clock, a
 * Doppler frequency the reader typed, the globe - keeps holding it; the planner's own panel compares by identity. So the list is one
 * array, spliced in place, and `rev` is what tells a view that something in it changed (a reactive read of a field of an object whose
 * identity did not change does not notice).
 *
 * input: {name, el, dlHz?, stdMag?, cid?, at?, show?}. Nothing is kept unless the analysis loads. `cid` and `at` hand back the same
 * number and place (Undo of a delete); `show: false` is the Undo of an orbit that was not on screen, which must not take over the
 * globe or the clock. */

export interface CustomInput { name?: unknown; el?: unknown; dlHz?: unknown; stdMag?: unknown; cid?: unknown; at?: unknown; show?: unknown }
export type CustomDone = { ok: true; entry: CustomEntry; saved: boolean; windowMoved: boolean };

/** One signal for "the list of the reader's orbits changed": the planner repaints its saved list on it. A listener that throws is
 *  reported by the browser, not here; a throw from dispatch itself is not worth a page. */
const customsChanged = (): void => { try { window.dispatchEvent(new CustomEvent('gt-customs-changed')); } catch (e) { console.error(e); } };

const KEYS = ['name', 'l1', 'l2', 'el', 'dlHz', 'stdMag', '__life'] as const;
type Fields = Pick<CustomEntry, 'name' | 'l1' | 'l2' | 'el' | 'dlHz' | 'stdMag' | '__life'>;
/** Copy the entry's own fields from one object to another, an absent one removing it (an in-place edit and its rollback). */
function take(to: CustomEntry | Partial<Fields>, from: Partial<Fields>): void {
  const t = to as Record<string, unknown>, f = from as Record<string, unknown>;
  for (const k of KEYS) { if (f[k] === undefined) delete t[k]; else t[k] = f[k]; }
}

class CustomStore {
  /** The list. One array for good: `__gt.CUSTOM` and the planner's host are this object. */
  readonly list: CustomEntry[] = [];
  /** Bumped by every change to the list or to an entry in it. */
  rev = $state(0);

  private P: PlannerCore | null = null;
  private next = 1;
  private saveOk = true;
  private restored = false;

  /** The planner's maths is here: the store is on. */
  get on(): boolean { return !!this.P; }
  get core(): PlannerCore | null { return this.P; }
  /** Did the last save reach storage? (blocked, full, or a private window: the session still works) */
  storageOk(): boolean { return this.saveOk; }
  get count(): number { void this.rev; return this.list.length; }

  /** The picker's one index space: 0..catalogue-1 is the catalogue, the rest are the reader's orbits in order. The 3D cloud, the
   *  hover label and `__gt.CAT` stay on catalogue indices and never see a custom one. */
  entryAt(i: number): CatalogueEntry | undefined {
    const n = app.catalogue.length;
    return i < n ? app.catalogue[i] : this.list[i - n];
  }
  indexOf(e: CatalogueEntry | null | undefined): number {
    if (!e) return -1;
    if (isCustom(e)) { const k = this.list.indexOf(e); return k >= 0 ? app.catalogue.length + k : -1; }
    return app.catIndex(e);
  }

  /* ---- switching on ----------------------------------------------------------------------------------------- */

  /** The planner's maths has arrived. Idempotent. The storage listener exists only from here: sanitizeStore calls validate, and an
   *  uncaught throw in a listener is a page error, so its whole body is guarded. */
  attach(P: PlannerCore): void {
    if (this.P) return;
    this.P = P;
    app.deepStart = (entry, ws) => deepStart(P, entry, ws, Date.now());
    window.addEventListener('storage', this.onStorage);
  }

  /* ---- what is stored --------------------------------------------------------------------------------------- */

  /** The record is the planner's inputs and nothing derived. An empty list keeps the counter, or the first orbit after a reload would
   *  be c1 / O0001 again. Under the assignment snapshot nothing is read or written. */
  private save(): boolean {
    if (PINNED) return true;
    const P = this.P;
    if (!P) return true;
    let ok = true;
    try {
      const rec = storedRecord(P, this.list, this.next);
      if (rec === null) localStorage.removeItem(CUSTOM_KEY); else localStorage.setItem(CUSTOM_KEY, rec);
    } catch { ok = false; }
    this.saveOk = ok;
    return ok;
  }

  /** Read the saved orbits into the list. The stored record stays exactly as it is when the planner is not here or under the snapshot. A
   *  record of another version, or not ours at all, is kept as .bak (unless it was only too large) and removed. */
  restore(): void {
    const P = this.P;
    if (PINNED || !P || this.restored) return;
    this.restored = true;
    try {
      let raw: string | null = null;
      try { raw = localStorage.getItem(CUSTOM_KEY); } catch { return; }
      const got = readStore(P, satellite, raw);
      if (got.why) {
        try {
          if (got.why !== 'too-large') localStorage.setItem(CUSTOM_KEY + '.bak', String(raw));
          localStorage.removeItem(CUSTOM_KEY);
        } catch { /* nothing more to do */ }
        return;
      }
      this.next = got.next;
      for (const e of got.entries) this.list.push(e);
      if (got.bad && !got.fault) this.save();        // what was refused does not come back next time; a fault of the planner is not a bad record
      if (this.list.length) { this.rev++; customsChanged(); }
    } catch (e) { console.error(e); }                // a throw leaves the list as it is and the console running
  }

  /** Another tab changed the saved orbits. Take what it added; never pull the orbit on screen out from under the reader. */
  private onStorage = (e: StorageEvent): void => {
    try {
      const P = this.P;
      if (!P || PINNED || e.key !== CUSTOM_KEY || (e.storageArea && e.storageArea !== localStorage)) return;
      const m = mergeStore(P, satellite, e.newValue, this.list, this.next);
      if (!m) return;
      for (const c of m.added) this.list.push(c);
      this.next = m.next;
      this.rev++;
      if (m.added.length) customsChanged();
    } catch (err) { console.error(err); }
  };

  /* ---- changing it ------------------------------------------------------------------------------------------ */

  /** SGP4's refusal of the last load, in the planner's words. */
  private refusalOf(name: string): PlannerError {
    const f = app.lastFailure, code = f && typeof f === 'object' && 'sgp4' in f ? f.sgp4 : null;
    return sgp4Refusal(name, code, getEngine().sgp4Why(typeof code === 'number' ? code : null));
  }

  add(input: CustomInput | null | undefined): CustomDone | Refusal {
    input = input || {};
    const P = this.P;
    if (PINNED || !P) return customFail('planner.off', offMsg(PINNED));
    if (this.list.length >= P.LIMITS.maxCustom)
      return customFail('err.cap', 'At most ' + P.LIMITS.maxCustom + ' custom orbits; remove one first.', { cap: P.LIMITS.maxCustom });
    const name = P.cleanName(input.name);
    if (!name) return customFail('err.name.empty', 'Give the orbit a name.', null, 'name');
    const v = P.validate(input.el);
    if (!v.ok) return { ok: false, errors: v.errors };
    const cid = allocCid(new Set(this.list.map(c => c.cid)), input.cid, this.next);
    if (!cid) return customFail('planner.full', 'This browser has used every orbit number; delete the saved orbits.');
    const made = makeCustom(P, satellite, { id: cid, name: uniqueName(P, this.list, name), el: v.el!, made: Date.now(), dlHz: input.dlHz, stdMag: input.stdMag });
    if (!made.entry) return { ok: false, errors: [mkRefusal(made.why)] };
    return this.commit(made.entry, input.at, input.show, true);
  }

  private commit(entry: CustomEntry, at: unknown, show: unknown, persist: boolean): CustomDone | Refusal {
    const prevNext = this.next, n = +entry.cid.slice(1);
    this.list.splice(typeof at === 'number' && Number.isInteger(at) && at >= 0 && at <= this.list.length ? at : this.list.length, 0, entry);
    this.next = Math.max(this.next, n + 1);
    let moved = false;
    if (show !== false) {
      /* The TRIAL form: the console's #loadnote is written only when trial is false, and a failed Add is the planner's message, not the
         console's. A trial load does not clear an older note, so a success clears it here. */
      const ds = this.P ? deepStart(this.P, entry, app.startMs, Date.now()) : null;
      moved = ds !== null;
      if (!app.load(entry, { trial: true, start: ds ?? undefined })) {    // nothing was committed: the screen, the window and the clock are as they were
        this.list.splice(this.list.indexOf(entry), 1);
        this.next = prevNext;
        return { ok: false, errors: [this.refusalOf(entry.name)] };
      }
      app.note = '';
    }
    this.rev++;
    const saved = persist ? this.save() : true;
    customsChanged();
    return { ok: true, entry, saved, windowMoved: moved };
  }

  /** Test hook only (`__gt.addCustomTLE`): a custom entry from raw lines, so a catalogue entry's own TLE can be run down the custom
   *  path and compared. Not persisted: it has no elements to store. */
  addTLE(name: string, l1: string, l2: string): CustomDone | Refusal {
    const entry: CustomEntry = { name, l1, l2, satnum: l1.substring(2, 7).trim(), custom: true, cid: 'c' + this.next, el: null, made: Date.now() };
    return this.commit(entry, undefined, true, false);
  }

  /** Editing is in place. The entry keeps its object identity, so the window, the span and a typed Doppler frequency survive; it keeps
   *  its id and its number, so nothing keyed on either moves. If the new elements cannot be analysed the old ones are put back - the
   *  pattern a newer element set that SGP4 cannot run gets. */
  update(entry: CustomEntry, input: CustomInput | null | undefined): CustomDone | Refusal {
    input = input || {};
    const P = this.P;
    if (PINNED || !P) return customFail('planner.off', offMsg(PINNED));
    if (this.list.indexOf(entry) < 0) return customFail('planner.nothing', 'That orbit is no longer in the list.');
    const name = P.cleanName(input.name);
    if (!name) return customFail('err.name.empty', 'Give the orbit a name.', null, 'name');
    const v = P.validate(input.el);
    if (!v.ok) return { ok: false, errors: v.errors };
    const made = makeCustom(P, satellite, {
      id: entry.cid, name: uniqueName(P, this.list.filter(c => c !== entry), name), el: v.el as PlannedElements, made: entry.made,
      dlHz: input.dlHz !== undefined ? input.dlHz : entry.dlHz, stdMag: input.stdMag !== undefined ? input.stdMag : entry.stdMag
    });
    const next = made.entry;
    if (!next) return { ok: false, errors: [mkRefusal(made.why)] };
    const onScreen = !!app.analysis && app.analysis.entry === entry;
    let moved = false;
    if (onScreen) {
      const held: Partial<Fields> = {};
      take(held, entry);
      take(entry, next);
      entry.__life = null;
      const ds = deepStart(P, entry, app.startMs, Date.now());
      moved = ds !== null;
      /* The reader's instant stays unless the window moved: load() leaves the clock where it is when asked to, and a window that moved
         needs the clock at its start, or the clock's own bounds would roll the window straight back. */
      if (!app.load(entry, { trial: true, start: ds ?? undefined, keepClock: !moved })) {    // the old elements go back; nothing was committed
        take(entry, held);
        return { ok: false, errors: [this.refusalOf(next.name)] };
      }
      app.note = '';
    } else {
      /* Off screen: analyse the candidate where it would be loaded (the epoch, for a deep-space orbit far from the window, as the load
         would put it) before anything is stored. */
      const ws = app.startMs === null ? Date.now() : app.startMs;
      const t0 = P.isDeep(next.el!.a) && Math.abs(ws - next.el!.epoch) > P.LIMITS.deepFarDays * 864e5 ? next.el!.epoch : ws;
      try { getEngine().compute(next, t0, app.hours); }
      catch (err) {
        const code = err && typeof err === 'object' && 'sgp4' in err ? (err as { sgp4: unknown }).sgp4 : null;
        return { ok: false, errors: [sgp4Refusal(next.name, code, getEngine().sgp4Why(typeof code === 'number' ? code : null))] };
      }
      take(entry, next);
      entry.__life = null;
    }
    this.rev++;
    const saved = this.save();
    customsChanged();
    return { ok: true, entry, saved, windowMoved: moved };
  }

  /** Remove an orbit. One on screen is left first, for a catalogue spacecraft, and only then let go; if nothing will load, it stays. */
  remove(entry: CustomEntry): boolean {
    const k = this.list.indexOf(entry);
    if (k < 0) return false;
    if (app.analysis && app.analysis.entry === entry && !app.loadFallback()) return false;
    this.list.splice(this.list.indexOf(entry), 1);
    this.rev++;
    this.save();
    customsChanged();
    return true;
  }
}

export const custom = new CustomStore();

/** What the old page guaranteed and a caller of these may rely on: when one returns, the screen already says what it did (the picker, the
 *  header, the marks, the count). Svelte batches its writes to the end of the task; flushing makes them land first. A caller that is itself
 *  inside an effect cannot flush, and does not need to: it is in the middle of one. */
function settled<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  return (...a: A) => {
    const r = fn(...a);
    try { flushSync(); } catch { /* inside an effect: the flush that is running will do it */ }
    return r;
  };
}

/** The store's operations as plain functions, bound once: the planner's host and the test surface hand out these very objects
 *  (`host.add === __gt.addCustom` is asserted by identity). */
export const customApi = {
  add: settled((input: CustomInput | null | undefined) => custom.add(input)),
  update: settled((entry: CustomEntry, input: CustomInput | null | undefined) => custom.update(entry, input)),
  remove: settled((entry: CustomEntry) => custom.remove(entry)),
  addTLE: settled((name: string, l1: string, l2: string) => custom.addTLE(name, l1, l2)),
  indexOf: (e: CatalogueEntry | null | undefined) => custom.indexOf(e),
  entryAt: (i: number) => custom.entryAt(i)
};
export { plannerMods };
