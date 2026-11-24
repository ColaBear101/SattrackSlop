/* The models a reader has given the page, kept only in this browser (CHANGES-FROM-LEGACY.md, L73).
 *
 * New in the rebuild. A model is a file of up to 50 MB, too big for localStorage, so the files are in the browser's IndexedDB, in one
 * database (`gt-models`, one store, keyed by the spacecraft: lib/models/validate.ts modelKey), and nothing ever leaves the browser:
 * there is no upload, the page's server never sees one, and another reader never does. The small index beside them is in localStorage
 * with the page's other records (lib/models/index-record.ts), so the close-up knows synchronously which spacecraft have one, and the
 * database is opened only to read or write a model, never to find out whether there is one.
 *
 * This is the one module of the page that names IndexedDB (tests/lib/forget.test.ts holds it to that). Where the browser keeps nothing
 * for the page (a private window, site data refused) or under the assignment snapshot (?tle=embedded, which reads and writes nothing,
 * as the reader's orbits do not), a model is kept in memory for the visit and the panel says so. Another tab of the page adding or
 * removing one is heard through the index's storage event. "Forget what this page stored" removes the index with the page's other keys
 * (lib/forget.ts) and the database with forgetModels(). */
import { MODELS_KEY, readIndex, writeIndex, type ModelEntry } from '../lib/models/index-record';

/* app.svelte's PINNED, read again here: importing it would tie this chunk to the entry's (see components/closeup/closeup.ts) */
const PINNED = /(?:^|[?&])tle=embedded(?:&|$)/.test(location.search);
const DB = 'gt-models', STORE = 'models';

const ls = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('the models database is held by another tab'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(r.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}

class Models {
  /** the reader's models, as the index lists them (plus this visit's, where nothing can be kept) */
  list = $state.raw<ModelEntry[]>(PINNED ? [] : readIndex(ls()?.getItem(MODELS_KEY) ?? null));
  private memory = new Map<string, Blob>();

  constructor() {
    try {
      window.addEventListener('storage', e => {
        if (e.key === MODELS_KEY && !PINNED) this.list = [...readIndex(e.newValue), ...this.list.filter(m => this.memory.has(m.key))];
      });
    } catch { /* no window events: nothing to hear */ }
  }

  entry(key: string): ModelEntry | null { return this.list.find(m => m.key === key) ?? null; }

  /** The model's file, or null when there is none (or the browser will not give it back). */
  async bytes(key: string): Promise<ArrayBuffer | null> {
    const m = this.memory.get(key);
    if (m) return m.arrayBuffer();
    if (PINNED || !this.entry(key)) return null;
    try {
      const b = await run<Blob | undefined>('readonly', s => s.get(key) as IDBRequest<Blob | undefined>);
      return b ? await b.arrayBuffer() : null;
    } catch { return null; }
  }

  /** Keep a model for a spacecraft, replacing the one it had: 'kept' in this browser, or 'memory' for this visit only. */
  async put(e: ModelEntry, file: Blob): Promise<'kept' | 'memory'> {
    const next = [...this.list.filter(x => x.key !== e.key), e];
    let where: 'kept' | 'memory' = 'memory';
    if (!PINNED) {
      try {
        await run('readwrite', s => s.put(file, e.key));
        const st = ls();
        if (!st) throw new Error('no storage');
        st.setItem(MODELS_KEY, writeIndex(next.filter(x => x.key === e.key || !this.memory.has(x.key))));
        where = 'kept';
      } catch {
        try { await run('readwrite', s => s.delete(e.key)); } catch { /* nothing was kept */ }
      }
    }
    if (where === 'memory') this.memory.set(e.key, file); else this.memory.delete(e.key);
    this.list = next;
    return where;
  }

  /** Give a spacecraft its own model back (the page's, if it has one). */
  async remove(key: string): Promise<void> {
    const kept = !this.memory.has(key);
    this.memory.delete(key);
    this.list = this.list.filter(x => x.key !== key);
    if (PINNED || !kept) return;
    try {
      const st = ls(), rest = this.list.filter(x => !this.memory.has(x.key));
      if (rest.length) st?.setItem(MODELS_KEY, writeIndex(rest)); else st?.removeItem(MODELS_KEY);
    } catch { /* the index is the page's; it goes with "Forget" */ }
    try { await run('readwrite', s => s.delete(key)); } catch { /* nothing was there */ }
  }
}

export const models = new Models();

/** Delete the database ("Forget what this page stored"). A tab of the page still open elsewhere holds it open, and the deletion then
 *  waits for that tab to close: this waits two seconds for it at most, and the page reloads either way. */
export function forgetModels(): Promise<void> {
  return new Promise(resolve => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.deleteDatabase(DB); } catch { resolve(); return; }
    req.onsuccess = req.onerror = () => resolve();
    req.onblocked = () => { setTimeout(resolve, 2000); };
  });
}
