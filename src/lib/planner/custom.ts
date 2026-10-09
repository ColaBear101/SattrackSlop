/* The reader's own orbits, as pure functions: what a custom entry is, how one is made from the planner's elements, what is
 * stored and what is read back, how a name is kept unique, and the refusals that are answered when it cannot be made.
 *
 * From legacy/index.html (main@4eadd7a), lines 10938-11219 (mkCustom, uniqueName, saveCustoms, restoreCustoms, the
 * refusal builders, the storage listener's merge). The page's side - the list itself, the screen, the window, the
 * event - is state/custom.svelte.ts; this file has no DOM, no storage handle, no state, and imports nothing from the
 * planner (the planner is a chunk of its own: it is handed in as `P`, and only its types are named here).
 *
 * A custom entry is the same {name, l1, l2, satnum} a catalogue entry is, made by writing the elements into a TLE so
 * the whole existing pipeline runs on it unchanged, plus custom:true. THAT flag is what every guard tests - never the
 * shape of the number. */
import { tleOk } from '../../../shared/tle';
import type { CatalogueEntry } from '../catalogue/parse';
import type { Satellite } from '../types';

export const CUSTOM_KEY = 'gt.custom';
/** c1 ... c9999: the id a saved orbit keeps for good. */
export const CID_RE = /^c[1-9]\d{0,3}$/;

/** What the planner says when it refuses something: the field it concerns ('' for none), a code, a sentence, and whatever
 *  the code carries (`sgp4` is the number satellite.js gave, `cap` the limit). */
export interface PlannerError { field: string; code: string; msg: string; sgp4?: number; cap?: number; [k: string]: unknown }

/** The planner's elements, as validate() returns them: opaque here apart from the two members read below. */
export interface PlannedElements { a: number; e: number; i: number; am: number; epoch: number; [k: string]: unknown }

export interface CustomEntry extends CatalogueEntry {
  custom: true;
  /** the id the saved record keeps ("c3"); the number is 'O' + 4 digits of it */
  cid: string;
  /** null only for the test hook's entry, which has lines and no elements */
  el: PlannedElements | null;
  made: number;
  /** claimed standard magnitude and downlink, kept for the session only, and only if in range */
  stdMag?: number;
  dlHz?: number;
  /** the decay estimate's memo, cleared by an edit: [a, e, i, am] -> the estimate */
  __life?: { key: string; life: unknown } | null;
}

/** The part of the planner module this file reads. */
export interface PlannerCore {
  SCHEMA: number;
  LIMITS: { maxCustom: number; nameMax: number; deepFarDays: number; deepTrialDays: number };
  sanitizeStore(raw: string | null): { items: { id: string; name: string; made: number; el: PlannedElements }[]; next: number; dropped: number; why?: string | null };
  storable(el: PlannedElements): unknown;
  toTLE(el: PlannedElements, satnum: string): { l1: string; l2: string };
  verifyTLE(l1: string, l2: string, el: PlannedElements, sat: Satellite): { ok: boolean; errors: PlannerError[] };
  validate(raw: unknown): { ok: boolean; el?: PlannedElements; errors: PlannerError[] };
  cleanName(raw: unknown): string;
  isDeep(a: number): boolean;
}

/** An orbit the reader designed. The flag, never the shape of the number. */
export const isCustom = (e: unknown): e is CustomEntry => !!e && !!(e as { custom?: unknown }).custom;

/** 'O', because NORAD's Alpha-5 scheme skips I and O (they read as 1 and 0): no real catalogue number can ever begin with
 *  it, in any future numbering. Digits would collide - this catalogue already holds 98247 to 99416. */
export const customSatnum = (n: number): string => 'O' + String(n).padStart(4, '0');

/* ---- making one ------------------------------------------------------------------------------------------ */

export interface Made {
  entry: CustomEntry | null;
  /** why SGP4 would not start from the lines: verifyTLE's own error, which carries `sgp4` */
  why: PlannerError | null;
  /** the planner THREW, as opposed to refusing: a fault of the planner, not a bad record */
  fault: boolean;
}

/** rec: {id, name, el, made, dlHz?, stdMag?}, every field already validated. Never throws to its caller: restore, add and the
 *  storage merge count a null entry as a refused record. A THROW (as opposed to a refusal) sets `fault`, so that a restore does
 *  not take a fault of the planner for a record that was bad and rewrite the saved list without it. */
export function makeCustom(P: PlannerCore, sat: Satellite, rec: { id: string; name: string; el: PlannedElements; made: number; dlHz?: unknown; stdMag?: unknown }): Made {
  try {
    const satnum = customSatnum(+rec.id.slice(1)), t = P.toTLE(rec.el, satnum);
    const entry: CustomEntry = { name: rec.name, l1: t.l1, l2: t.l2, satnum, custom: true, cid: rec.id, el: rec.el, made: rec.made };
    /* copied only after a range test; absent means "no claim", never an error */
    const sm = rec.stdMag, dl = rec.dlHz;
    if (typeof sm === 'number' && Number.isFinite(sm) && sm >= -10 && sm <= 25) entry.stdMag = sm;
    if (typeof dl === 'number' && Number.isFinite(dl) && dl >= 1e6 && dl <= 1e11) entry.dlHz = dl;
    /* The gate the network and cache paths pass, plus the checksum they never asked for, plus one more thing no text check can:
       SGP4 has to be able to start from it. satellite.js validates nothing - a garbage pair reads back error 0 and a NaN a - so
       verifyTLE is the only guard. */
    if (!tleOk(entry, satnum)) return { entry: null, why: null, fault: false };
    const v = P.verifyTLE(entry.l1, entry.l2, entry.el!, sat);
    if (!v.ok) return { entry: null, why: v.errors.length ? v.errors[0]! : null, fault: false };
    return { entry, why: null, fault: false };
  } catch (e) {
    console.error(e);
    return { entry: null, why: null, fault: true };
  }
}

/** A deep-space orbit (period of 225 minutes or more) far from the window: the window goes to its epoch (D39). Returns where to
 *  open it, or null when the window can stay. Used by a change of spacecraft and by add/update, which own the epoch change; never
 *  when the reader moves the window by hand. */
export function deepStart(P: PlannerCore, entry: unknown, winStart: number | null, now: number): number | null {
  if (!isCustom(entry) || !entry.el || !P.isDeep(entry.el.a)) return null;
  const ws = winStart === null ? now : winStart;
  return Math.abs(ws - entry.el.epoch) <= P.LIMITS.deepFarDays * 864e5 ? null : entry.el.epoch;
}

/** Unique among the READER's orbits only (case-insensitive; the planner's own form checks the catalogue): "Name (2)" to "(99)", the
 *  base cut by code points to leave room. */
export function uniqueName(P: PlannerCore, others: readonly { name: string }[], n: string): string {
  const have = new Set(others.map(c => c.name.toLowerCase()));
  if (!have.has(n.toLowerCase())) return n;
  const max = P.LIMITS.nameMax;
  for (let k = 2; k < 100; k++) {
    const t = Array.from(n).slice(0, max - String(k).length - 3).join('') + ' (' + k + ')';
    if (!have.has(t.toLowerCase())) return t;
  }
  return n;
}

/** The id for a new orbit: the one asked for if it is well formed and free (Undo of a delete hands back its own), else the first
 *  free number from the counter. null when all 9,999 are taken. */
export function allocCid(used: ReadonlySet<string>, wanted: unknown, next: number): string | null {
  if (typeof wanted === 'string' && CID_RE.test(wanted) && !used.has(wanted)) return wanted;
  let n = Math.max(1, next);
  while (n <= 9999 && used.has('c' + n)) n++;
  return n > 9999 ? null : 'c' + n;
}

/* ---- what is stored -------------------------------------------------------------------------------------- */

/** What is stored is the planner's inputs and nothing derived: no lines, no flags, no number. The lines are rebuilt on read, so every
 *  stored byte passes the same validator as the form. An empty list keeps the counter ({v, next, items:[]}), or the first orbit after
 *  a reload would be c1 / O0001 again. null means "remove the key" (nothing was ever made). */
export function storedRecord(P: PlannerCore, list: readonly CustomEntry[], next: number): string | null {
  const items = list.filter(c => c.el).map(c => ({ id: c.cid, name: c.name, made: c.made, el: P.storable(c.el!) }));
  if (!items.length && next <= 1) return null;
  return JSON.stringify({ v: P.SCHEMA, next, items });
}

export interface Restored {
  /** a record of another version, or not ours at all ('too-large', 'unreadable', 'version'): kept as .bak and removed, but not 'too-large' */
  why: string | null;
  next: number;
  entries: CustomEntry[];
  /** records refused (by sanitize or by make): when > 0 and no fault, the saved list is rewritten without them */
  bad: number;
  fault: boolean;
}

export function readStore(P: PlannerCore, sat: Satellite, raw: string | null): Restored {
  const got = P.sanitizeStore(raw);
  if (got.why) return { why: got.why, next: 1, entries: [], bad: 0, fault: false };
  let bad = got.dropped, fault = false;
  const entries: CustomEntry[] = [];
  for (const rec of got.items) {
    const m = makeCustom(P, sat, rec);
    if (m.entry) entries.push(m.entry); else bad++;
    if (m.fault) fault = true;
  }
  return { why: null, next: got.next, entries, bad, fault };
}

/** Another tab changed the saved orbits. Take what it added; never pull the orbit on screen out from under the reader. Last writer wins
 *  otherwise: the merge adds and never removes, so an orbit deleted in this tab comes back here when the other tab next saves (the
 *  README says so). */
export function mergeStore(P: PlannerCore, sat: Satellite, raw: string | null, have: readonly CustomEntry[], next: number): { added: CustomEntry[]; next: number } | null {
  const got = P.sanitizeStore(raw);
  if (got.why) return null;
  const added: CustomEntry[] = [];
  for (const rec of got.items) {
    if (have.length + added.length >= P.LIMITS.maxCustom) break;
    if (have.some(c => c.cid === rec.id) || added.some(c => c.cid === rec.id)) continue;
    const m = makeCustom(P, sat, rec);
    if (m.entry) added.push(m.entry);
  }
  return { added, next: Math.max(next, got.next) };
}

/* ---- what is said when it cannot be done ------------------------------------------------------------------ */

export interface Refusal { ok: false; errors: PlannerError[] }

export const customFail = (code: string, msg: string, extra?: Record<string, unknown> | null, field?: string): Refusal =>
  ({ ok: false, errors: [Object.assign({ field: field || '', code, msg }, extra || {}) as PlannerError] });

export const offMsg = (pinned: boolean): string => pinned
  ? 'The orbit planner is off in the assignment snapshot (?tle=embedded).'
  : 'The orbit planner is not available on this page.';

/** SGP4's refusal, as the planner's error object. The code is the number satellite.js gave (1 = a mean element out of range, 6 =
 *  decayed ...), 0 when it gave none; `why` is the engine's sentence for it. */
export function sgp4Refusal(name: string, code: unknown, why: string): PlannerError {
  const c = typeof code === 'number' ? code : 0;
  return { field: '', code: 'err.sgp4', sgp4: c, msg: name + ' cannot be propagated anywhere in this window (' + why + ').' };
}

/** Why makeCustom said no: verifyTLE's own err.sgp4 object when it refused the lines, else the plain sentence. makeCustom never throws,
 *  so a planner that faulted lands here too, and the reader is told the elements were refused, not that the page broke. */
export const mkRefusal = (why: PlannerError | null): PlannerError =>
  why || { field: '', code: 'err.sgp4', sgp4: 0, msg: 'SGP4 cannot start from those elements.' };

/** The "this orbit is fictional" disclosure the console paints for an orbit the reader designed, for tests and for the one place that
 *  writes it: shown, never derived from a module. */
export const CUSTOM_SRCLINE = 'Synthesized from your elements · not a real TLE';
