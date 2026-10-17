import type { PlotRow } from '../../shared/plot';
import {
  addItem, API_SPACING_MS, COMPARE_MAX, compareNum, drawable, FETCH_PER_PRESS, lightItem, notDrawn, readCompare, removeItem, rowOrder,
  writeCompare, type CompareItem, type CompareRecord, type NotDrawn
} from '../lib/decay/compare';
import { createHistorySource, type HistoryOutcome } from '../lib/net/history-source';
import { isCustom } from '../lib/planner/custom';
import {
  cmpAdded, cmpAddFull, cmpBatch, cmpCannotHighlight, cmpCleared, cmpDone, cmpFailShort, cmpFetchingSay, cmpHighlightFull, cmpRemoved,
  cmpRemovedWaiting, CMP_CODE_FAILED, type CmpNotDrawn
} from '../lib/text/life-compare';
import { app } from './app.svelte';
import { life } from './life.svelte';
import { historyCtx } from './net';
import { localStore } from './storage';
import { watch } from './watch.svelte';

/* The decay comparison (CHANGES-FROM-LEGACY.md, L66): the spacecraft the reader has listed under the Decay section to set beside the
   selected one, which of them are in colour, and what each one's history said. The model is lib/decay/compare.ts; this is its state,
   the fetching, and the record kept in the browser.

   The list is the reader's: it is read from its own key (gt.decaycmp) when this chunk arrives and written only by what the reader
   does here (add, remove, highlight, clear, open or shut the panel), never for having been read, nor when an answer comes in; an
   empty list with the panel shut leaves nothing stored. Another tab's change is heard through the storage event and the list read
   again (this tab's panel stays open or shut as it is). Where the browser refuses storage the list holds for the visit.

   Nothing is fetched unless asked, by the Decay section's own rule (state/life.svelte.ts): CelesTrak rebuilds a history on each
   request and has taken from a few seconds to over a minute. Reading the list back fetches nothing: a history cached in the last
   12 hours (hist:<n>, the Decay section's own cache) is drawn from there, and the rest wait for Fetch. What asks is a press: adding
   one spacecraft asks for its history; "Add watched" and "Fetch" ask for at most seven; turning a highlight on asks for that one.
   The requests go one at a time, through one history source, so a spacecraft asked for twice shares one request. A request cannot be
   called back: a row removed while its request is out lets it finish (the answer still fills the cache) and drops it, and the queue
   waits for it; listing that spacecraft again meanwhile takes the answer it is waiting for. While the page's API is answering, two
   requests start at least seven seconds apart (it allows ten a minute, and a refusal switches it off for ten minutes for the
   element-set checks too); answers from the cache are not held back.

   The selected spacecraft is the comparison's first line, from the Decay section's own forecast (life.chart). If that one has not
   been estimated, the first press here that asks for anything asks for it first, with the same request the section's Estimate
   button makes (life.start()), in the same queue; and when a listed spacecraft's answer comes in while it is the one selected and
   still not estimated, the section is offered it again (life.offer), so its panel paints from the cache just written.

   A forecast is worked out from a history with the Decay section's own code and words (lib/text/life.ts, the `life` chunk): one per
   task, those in colour first, and kept, so the same history is never worked out twice. The histories and forecasts are held in a
   plain map, never in reactive state: a row's state is a small object replaced whole when it changes. */
export const COMPARE_KEY = 'gt.decaycmp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** A listed spacecraft's history and, once worked out, its forecast. */
export interface Forecast { P: PlotRow[]; r: Any }
/** What a row shows. `reading`: its cached history is being worked out; `wait`: nothing cached, it waits for Fetch; `shown`: the
 *  forecast's headline and figures (lifePaint's), and why it is not drawn if it is not; `failed`: what came back instead of a
 *  history (lifeWhyNot's headline, short), and whether trying again is worth it. */
export type CmpRow =
  | { st: 'reading' | 'wait' | 'queued' | 'fetching' }
  | { st: 'shown'; big: string; sub: string; alt: string; rate: string; not: NotDrawn | null }
  | { st: 'failed'; big: string; short: string; retry: boolean; not: Exclude<CmpNotDrawn, NotDrawn> };
/** A line of the comparison chart: slot 1 the selected spacecraft, 2..8 one in colour, 0 a grey one. */
export interface CmpLine { n: string; slot: number; P: readonly { t: number; sma: number }[]; r: Any }

type Task = { kind: 'row'; n: string; tok: number } | { kind: 'life'; n: string; asked: boolean };

const engine = () => import('../lib/text/life');            // the Decay section's own chunk: the drag model and its words

type Idle = { timeRemaining(): number; didTimeout: boolean };
/** one task later: an idle moment where the browser has them */
const later = (f: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: (d: Idle) => void, o: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(() => f(), { timeout: 400 });
  else setTimeout(f, 0);
};

const stored = (): CompareRecord => {
  try { return readCompare(localStore().getItem(COMPARE_KEY)); } catch { return { open: false, items: [] }; }   // storage refused
};

/* One source for every request this asks: its map of requests in flight is what lets a second ask for the same spacecraft share the
   first. The page's API and its breaker are the ones the whole page shares (state/net.ts). */
const ctx = historyCtx(false);
const src = createHistorySource(ctx);

class DecayCompare {
  /** the listed spacecraft, in the order they were added, with their colour slots; replaced whole */
  items = $state.raw<readonly CompareItem[]>([]);
  /** the panel is open */
  open = $state(false);
  /** what each listed row shows, by catalogue number; replaced whole */
  rows = $state.raw<Readonly<Record<string, CmpRow>>>({});
  /** the numbers waiting their turn, in order (the selected spacecraft's own ask among them): a row's place is its index + 1 */
  queue = $state.raw<readonly string[]>([]);
  /** seconds since the request out now was started: the only thing that changes every second */
  secs = $state(0);
  /** the status line: set only for what the reader did and when the queue is through, cleared first so a repeat is heard */
  say = $state('');
  /** the last refusal of a highlight, said on that row as well */
  refusal = $state.raw<{ n: string; text: string } | null>(null);

  /** the selected spacecraft's number, null for a planned orbit (or none): a window move that reloads the same one changes nothing */
  selected = $derived(app.entry && !isCustom(app.entry) ? app.entry.satnum : null);
  /** a planned orbit is selected: the panel says only why it is put away */
  planned = $derived(!!app.entry && isCustom(app.entry));
  /** the rows on the page, after the selected spacecraft's: the highlighted by colour, then the rest as added */
  shown = $derived(rowOrder(this.items, this.selected));
  /** rows that wait for Fetch, in the order shown */
  waiting = $derived(this.shown.filter(n => this.rows[n]?.st === 'wait'));
  /** watched catalogue spacecraft not listed and not selected: what "Add watched" adds */
  watchable = $derived.by(() => {
    void app.catalogue;
    return watch.list.filter(n => !!app.embedded(n) && n !== this.selected && !this.items.some(i => i.n === n));
  });
  /** what the chart draws: the selected spacecraft's forecast (when it can be drawn), the highlighted by slot, then the grey ones */
  lines = $derived.by((): CmpLine[] => {
    const out: CmpLine[] = [], grey: CmpLine[] = [];
    const sel = this.selected, ch = life.chart;
    if (sel && ch && !ch.custom && ch.P.length && drawable(ch.r)) out.push({ n: sel, slot: 1, P: ch.P, r: ch.r });
    const rows = this.rows;
    for (const n of this.shown) {
      const row = rows[n], f = this.data.get(n);
      if (row?.st !== 'shown' || row.not || !f?.r) continue;
      const h = this.slotOf(n);
      (h ? out : grey).push({ n, slot: h, P: f.P, r: f.r });
    }
    return out.concat(grey);
  });

  private data = new Map<string, Forecast>();
  private memo = new Map<string, { key: string; r: Any; row: CmpRow }>();
  /** the current ask of each row that has one out (queued or in flight): an answer under another number is not this row's */
  private tok = new Map<string, number>();
  private seq = 0;
  private q: Task[] = [];
  private pumping = false;
  /** the request out now, even when its row has been removed since */
  private flight: { n: string; tok: number } | null = null;
  private lifeOut = false;
  private lastNet = -Infinity;
  private tally = { ok: 0, failed: 0, name: '' };
  private cq: string[] = [];
  private computing = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private sayT: ReturnType<typeof setTimeout> | undefined;

  constructor(rec: CompareRecord) {
    this.items = rec.items;
    this.open = rec.open;
    const rows: Record<string, CmpRow> = {};
    for (const n of rowOrder(rec.items, null)) { rows[n] = { st: 'reading' }; this.cq.push(n); }
    this.rows = rows;
    if (this.cq.length) { this.computing = true; later(() => void this.step()); }
  }

  /** a spacecraft's name, from the catalogue */
  name(n: string): string { return app.embedded(n)?.name ?? 'NORAD ' + Number(n); }
  listed(n: string): boolean { return this.items.some(i => i.n === n); }
  /** its colour slot, 0 when it has none */
  slotOf(n: string): number { return this.items.find(i => i.n === n)?.h ?? 0; }
  /** its history and forecast, once there (not reactive: read it where its row is read) */
  forecast(n: string): Forecast | null { return this.data.get(n) ?? null; }
  /** its place in the queue, 1 next; 0 when it is not waiting there */
  queuePos(n: string): number { return this.queue.indexOf(n) + 1; }

  /* ---- what the reader does ------------------------------------------------------------------------------------------- */

  /** Add a catalogue spacecraft (from the search): listed, in colour if one is free, and its history asked for. False when it is
   *  not added: listed already, the selected one, or the list full (which is said). */
  add(n: string): boolean {
    const k = compareNum(n);
    if (!k || k === this.selected || this.listed(k)) return false;
    const name = this.name(k), next = addItem(this.items, k, true);
    this.refusal = null;
    if (!next) { this.speak(cmpAddFull(name)); return false; }
    this.items = next;
    this.ask([k]);
    this.write();
    this.speak(cmpAdded(name, this.items.length));
    return true;
  }

  /** Add every watched catalogue spacecraft not listed, in the order they were starred, up to the list's cap: the free colours go to
   *  the first of them, and only those are asked for (at most seven); the cached are read at once; the rest wait for Fetch. */
  addWatched(): void {
    const want = this.watchable;
    if (!want.length) return;
    const take = want.slice(0, Math.max(0, COMPARE_MAX - this.items.length));
    let items = this.items;
    const lit: string[] = [], rest: string[] = [];
    for (const n of take) {
      const next = addItem(items, n, true);
      if (!next) continue;
      items = next;
      (next[next.length - 1]!.h ? lit : rest).push(n);
    }
    this.items = items;
    this.refusal = null;
    const { queued, cached } = this.ask(lit);
    let fromCache = cached;
    for (const n of rest) if (!this.fromCache(n)) this.setRow(n, { st: 'wait' }); else fromCache++;
    this.write();
    this.speak(cmpBatch({ added: lit.length + rest.length, cached: fromCache, fetching: queued, waiting: lit.length + rest.length - fromCache - queued, left: want.length - take.length }));
  }

  /** "Fetch 7 more" / "Fetch the rest (k)": the next seven rows that wait, in the order shown, in colour while colours are free. */
  fetchMore(): void {
    const ns = this.waiting.slice(0, FETCH_PER_PRESS);
    if (!ns.length) return;
    let items = this.items;
    for (const n of ns) if (!items.find(i => i.n === n)?.h) items = lightItem(items, n, true) ?? items;
    this.items = items;
    this.refusal = null;
    const { queued } = this.ask(ns);
    this.write();
    this.speak(cmpFetchingSay(queued, this.waiting.length));
  }

  /** A row's own Fetch, or Try again: its history asked for, and in colour if one is free. */
  fetch(n: string): void {
    if (!this.listed(n)) return;
    this.refusal = null;
    if (!this.slotOf(n)) {
      const next = lightItem(this.items, n, true);
      if (next) { this.items = next; this.write(); }
    }
    this.ask([n]);
  }

  /** The selected spacecraft's row's Fetch (or Try again): the Decay section's own request, in this queue so it is still one at a
   *  time. */
  fetchSelected(): void {
    this.refusal = null;
    this.selectedFirst(true);
    this.mirror();
    void this.pump();
  }

  /** A row's highlight on or off. On takes the lowest free colour, and asks for the row's history if it has none yet; it is refused
   *  (and said, there and in the status line) with seven in colour, or for a row with nothing to draw. */
  highlight(n: string, on: boolean): boolean {
    if (!this.listed(n)) return false;
    this.refusal = null;
    if (!on) { this.items = lightItem(this.items, n, false)!; this.write(); return true; }
    if (this.slotOf(n)) return true;
    const row = this.rows[n], name = this.name(n);
    const not = row?.st === 'shown' ? row.not : row?.st === 'failed' && !row.retry ? row.not : null;
    if (not) return this.refuse(n, cmpCannotHighlight(name, not));
    const next = lightItem(this.items, n, true);
    if (!next) return this.refuse(n, cmpHighlightFull(name));
    this.items = next;
    if (row?.st === 'wait' || (row?.st === 'failed' && row.retry)) this.ask([n]);
    this.write();
    return true;
  }

  /** Take a row off: its colour is free again. A request of its that is out is left to finish (it cannot be called back): its answer
   *  fills the cache and is not shown, and the next request waits for it, which is said when one is waiting. */
  remove(n: string): void {
    if (!this.listed(n)) return;
    const name = this.name(n);
    const orphan = !!this.flight && this.flight.n === n && this.tok.get(n) === this.flight.tok;
    this.items = removeItem(this.items, n);
    this.forget(n);
    this.mirror();
    this.write();
    this.speak(orphan && this.q.some(t => t.kind === 'row') ? cmpRemovedWaiting(name, this.items.length) : cmpRemoved(name, this.items.length));
  }

  /** Clear the whole list (the panel's second press of Clear). */
  clear(): void {
    const n = this.items.length;
    if (!n) return;
    this.items = [];
    for (const k of Object.keys(this.rows)) this.forget(k);
    this.q = [];
    this.mirror();
    this.write();
    this.speak(cmpCleared(n));
  }

  /** The panel opened or shut (kept with the list; shutting keeps the list). */
  setOpen(o: boolean): void {
    if (this.open === o) return;
    this.open = o;
    this.write();
  }

  /** Another tab wrote the list, removed it, or the origin's storage was cleared: the list is read again. */
  heard(): void {
    const rec = stored(), was = new Set(this.items.map(i => i.n)), now = new Set(rec.items.map(i => i.n));
    for (const n of was) if (!now.has(n)) this.forget(n);
    this.items = rec.items;
    for (const { n } of rec.items) if (!was.has(n)) { this.setRow(n, { st: 'reading' }); this.compute(n); }
    for (const { n, h } of rec.items) { const row = this.rows[n]; if (h && (row?.st === 'failed' || (row?.st === 'shown' && row.not))) this.release(n); }
    this.mirror();
  }

  /* ---- the queue ------------------------------------------------------------------------------------------------------ */

  /** Ask for these listed rows' histories: the cached are read at once, the rest queued (each once). */
  private ask(ns: readonly string[]): { queued: number; cached: number } {
    let queued = 0, cached = 0;
    for (const n of ns) {
      const st = this.rows[n]?.st;
      if (this.tok.has(n) && (st === 'queued' || st === 'fetching')) continue;              // asked for already
      if (this.flight && this.flight.n === n && !this.tok.has(n)) {                       // still out from before it was removed: join it
        this.tok.set(n, this.flight.tok);
        this.setRow(n, { st: 'fetching' });
        queued++;
        continue;
      }
      if (this.fromCache(n, true)) { cached++; continue; }
      const tok = ++this.seq;
      this.tok.set(n, tok);
      this.q.push({ kind: 'row', n, tok });
      this.setRow(n, { st: 'queued' });
      queued++;
    }
    if (queued) this.selectedFirst(false);
    this.mirror();
    void this.pump();
    return { queued, cached };
  }

  /** A row's history from the cache, if it is there: it is worked out next. */
  private fromCache(n: string, front = false): boolean {
    const P = src.cached(n);
    if (!P) return false;
    this.data.set(n, { P, r: null });
    this.setRow(n, { st: 'reading' });
    this.compute(n, front);
    return true;
  }

  /** The selected spacecraft's own request, first in the queue, when it is a catalogue one the section has not estimated (or, asked
   *  for from its row, one whose request failed). */
  private selectedFirst(asked: boolean): void {
    const e = app.entry, a = life.view.action;
    if (!e || isCustom(e) || !(a === 'estimate' || (asked && a === 'retry'))) return;
    if (this.lifeOut || this.q.some(t => t.kind === 'life')) return;
    this.q.unshift({ kind: 'life', n: e.satnum, asked });
  }

  /** One request at a time, started by a press and by its own completion (never by an effect). */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    this.tally = { ok: 0, failed: 0, name: '' };
    try {
      for (let t = this.q.shift(); t; t = this.q.shift()) {
        this.mirror();
        try {
          if (t.kind === 'life') await this.runLife(t);
          else if (this.tok.get(t.n) === t.tok) await this.runRow(t);
        } catch (err) { console.error(err); }
      }
    } finally {
      this.pumping = false;
      this.mirror();
    }
    const { ok, failed, name } = this.tally;
    if (ok + failed) this.speak(cmpDone(ok, failed, name));
  }

  /** Hold a request back until seven seconds after the last one, while the page's API is the one being asked. */
  private async spacing(): Promise<void> {
    if (!ctx.api || ctx.breaker.isOpen()) return;
    const wait = this.lastNet + API_SPACING_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }

  private async runLife(t: { n: string; asked: boolean }): Promise<void> {
    const still = () => {
      const e = app.entry, a = life.view.action;
      return !!e && !isCustom(e) && e.satnum === t.n && (a === 'estimate' || (t.asked && a === 'retry'));
    };
    if (!still()) return;
    this.lifeOut = true;                                      // from here to its answer: not asked for twice
    try {
      await this.spacing();
      if (!still()) return;
      this.lastNet = Date.now();
      await life.start();
    } finally { this.lifeOut = false; }
  }

  private async runRow(t: { n: string; tok: number }): Promise<void> {
    const { n, tok } = t;
    let got: HistoryOutcome | null;
    const hit = src.cached(n);
    if (hit) got = { P: hit, why: null };
    else {
      await this.spacing();
      if (this.tok.get(n) !== tok) return;                    // removed while it waited: nothing was asked
      this.lastNet = Date.now();
      this.flight = { n, tok };
      this.setRow(n, { st: 'fetching' });
      const t0 = Date.now();
      this.secs = 0;
      clearInterval(this.timer);
      this.timer = setInterval(() => { this.secs = Math.round((Date.now() - t0) / 1000); }, 1000);
      try { got = await src.history(n); } catch { got = null; }
      clearInterval(this.timer);
      this.flight = null;
    }
    if (this.tok.get(n) !== tok) return;                      // removed while its answer was on its way: it is in the cache, not here
    this.tok.delete(n);
    this.tally.name = this.name(n);
    if (got && got.P) {
      this.tally.ok++;
      this.data.set(n, { P: got.P, r: null });
      this.setRow(n, { st: 'reading' });
      this.compute(n, true);
      const e = app.entry;
      if (e && !isCustom(e) && e.satnum === n && life.view.action === 'estimate') life.offer(e);
    } else {
      this.tally.failed++;
      void this.fail(n, got);
    }
  }

  /** What came back instead of a history, in the Decay section's words: its colour is given back. */
  private async fail(n: string, got: HistoryOutcome | null): Promise<void> {
    let row: CmpRow;
    try {
      const v = (await engine()).lifeWhyNot({ satnum: n }, got);
      row = { st: 'failed', big: v.big, short: cmpFailShort(got), retry: v.action === 'retry', not: v.action === 'retry' ? 'failed' : 'answer' };
    } catch {
      row = { st: 'failed', big: CMP_CODE_FAILED, short: cmpFailShort('code'), retry: true, not: 'code' };
    }
    if (!this.listed(n) || this.tok.has(n)) return;           // removed, or asked for again
    this.setRow(n, row);
    this.release(n);
  }

  /* ---- working out the forecasts -------------------------------------------------------------------------------------- */

  private compute(n: string, front = false): void {
    const i = this.cq.indexOf(n);
    if (i >= 0) this.cq.splice(i, 1);
    if (front) this.cq.unshift(n); else this.cq.push(n);
    if (!this.computing) { this.computing = true; later(() => void this.step()); }
  }

  /** one forecast per task */
  private async step(): Promise<void> {
    const n = this.cq.shift();
    if (n !== undefined) { try { await this.work(n); } catch (err) { console.error(err); } }
    if (this.cq.length) later(() => void this.step());
    else this.computing = false;
  }

  private async work(n: string): Promise<void> {
    if (!this.listed(n) || this.tok.has(n)) return;           // removed, or asked for again since
    let f = this.data.get(n);
    if (!f) {
      const P = src.cached(n);
      if (!P) { this.setRow(n, { st: 'wait' }); return; }
      f = { P, r: null };
      this.data.set(n, f);
    }
    const key = f.P.length + ':' + f.P[f.P.length - 1]!.t;
    let m = this.memo.get(n);
    if (!m || m.key !== key) {
      let L;
      try { L = await engine(); }
      catch {
        if (this.listed(n) && !this.tok.has(n)) {
          this.setRow(n, { st: 'failed', big: CMP_CODE_FAILED, short: cmpFailShort('code'), retry: true, not: 'code' });
          this.release(n);
        }
        return;
      }
      if (!this.listed(n) || this.tok.has(n)) return;
      const r = L.Lifetime.predict(f.P);
      const { view, fields } = L.lifePaint(r, f.P, Date.now());
      m = { key, r, row: { st: 'shown', big: view.big, sub: view.sub, alt: fields.alt ?? '—', rate: fields.rate ?? '—', not: notDrawn(r) } };
      this.memo.set(n, m);
    }
    this.data.set(n, { P: f.P, r: m.r });
    this.setRow(n, m.row);
    if ((m.row as { not: NotDrawn | null }).not) this.release(n);
  }

  /* ---- bookkeeping ---------------------------------------------------------------------------------------------------- */

  private refuse(n: string, text: string): false {
    this.refusal = { n, text };
    this.speak(text);
    return false;
  }

  /** a row with nothing to draw gives its colour back (kept that way at the reader's next press; not written for this) */
  private release(n: string): void {
    if (this.slotOf(n)) this.items = lightItem(this.items, n, false)!;
  }

  /** everything kept for a row that is no longer listed (a request of its that is out is left to finish) */
  private forget(n: string): void {
    this.tok.delete(n);
    this.q = this.q.filter(t => t.kind !== 'row' || t.n !== n);
    const i = this.cq.indexOf(n);
    if (i >= 0) this.cq.splice(i, 1);
    this.data.delete(n);
    if (n in this.rows) { const rows = { ...this.rows }; delete rows[n]; this.rows = rows; }
    if (this.refusal?.n === n) this.refusal = null;
  }

  private setRow(n: string, row: CmpRow): void { this.rows = { ...this.rows, [n]: row }; }
  private mirror(): void {
    const q = this.q.map(t => t.n);
    if (q.length !== this.queue.length || q.some((n, i) => n !== this.queue[i])) this.queue = q;
  }

  /** the record, written for what the reader did; an empty list with the panel shut leaves nothing stored */
  private write(): void {
    try {
      if (!this.items.length && !this.open) localStore().removeItem(COMPARE_KEY);
      else localStore().setItem(COMPARE_KEY, writeCompare(this.open, this.items));
    } catch { /* private window or full storage: the list holds for this visit */ }
  }

  /** cleared, then set a moment later, so the same sentence twice is still heard */
  private speak(s: string): void {
    clearTimeout(this.sayT);
    this.say = '';
    this.sayT = setTimeout(() => { this.say = s; }, 0);
  }
}

export const compare = new DecayCompare(stored());

/* another tab wrote the list, removed it, or cleared the origin's storage (a null key) */
try { window.addEventListener('storage', e => { if (e.key === null || e.key === COMPARE_KEY) compare.heard(); }); } catch { /* no window to hear from */ }
