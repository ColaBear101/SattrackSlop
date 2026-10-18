/* What this page keeps in the browser, and forgetting all of it (CHANGES-FROM-LEGACY.md, L50).
 *
 * New in the rebuild; the old page had no way to take back what it had stored. Everything the page keeps is in
 * localStorage (no session storage, cookie, IndexedDB, Cache Storage or service worker), under one of four
 * namespaces: the observer's two keys from the old page (`obs-site`, `obs-recent`), the page's own choices, the
 * spacecraft the reader watches and the reader's orbits (`gt.*`), and the two caches, the element set of an object
 * (`tle:<n>`) and its history of element sets (`hist:<n>`). A cached copy is used for three hours (TLE_TTL) or twelve (HIST_TTL), and an old one
 * stays until that object's is fetched again, or until it is forgotten here (a history past its twelve hours is also taken out by the decay
 * comparison, state/decay-compare.svelte.ts, before it asks for one). A key of any of them is the
 * page's; any other key on the origin is somebody else's and is left alone (the page never calls `clear()`).
 *
 * FORGET_KEYS names every fixed key the code uses, so that the words can say what each one is; tests/lib/forget.test.ts
 * scans the source for every key handed to getItem, setItem and removeItem and fails on one this file does not cover,
 * or on a name here that the code no longer uses. A `gt.` key added later and not yet listed is still forgotten (the
 * namespace is a prefix), and is said as one of "your display choices".
 *
 * Pure: the storage is an argument (`window.localStorage` is one), and the address is a string. */

/** The part of the DOM's Storage this needs: enumerating it as well as reading and removing. */
export interface ForgetStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/** Every fixed key the page writes. */
export const FORGET_KEYS = [
  'obs-site', 'obs-recent',                                // lib/observer.ts: the saved site and the recent places (the old page's keys)
  'gt.prefs', 'gt.surface',                                // state/prefs.svelte.ts (the theme and the tab), the globe's surface
  'gt.custom', 'gt.custom.bak',                            // state/custom.svelte.ts: the reader's orbits, and a record this version could not read
  'gt.arlens', 'gt.araim', 'gt.arradar',                   // lib/ar/arview.ts: the AR view's lens, aim and radar
  'gt.passfilter',                                         // state/passfilter.svelte.ts: the pass list's filter (L56)
  'gt.watch',                                              // state/watch.svelte.ts: the spacecraft the reader starred (L60)
  'gt.decaycmp'                                            // state/decay-compare.svelte.ts: the decay comparison's list and whether it is open (L66)
] as const;

/** The page's namespaces: a key that starts with one of these is the page's. */
export const FORGET_PREFIXES = ['obs-', 'gt.', 'tle:', 'hist:'] as const;

export const ours = (key: string): boolean => FORGET_PREFIXES.some(p => key.startsWith(p));

/** What is stored, in the terms the page says it in. A count is null when the record is there and cannot be read. */
export type ForgetPart =
  | { kind: 'site' }
  | { kind: 'recents'; n: number | null }
  | { kind: 'choices'; n: number }
  | { kind: 'watch'; n: number | null }
  | { kind: 'orbits'; n: number | null }
  | { kind: 'tle'; n: number }
  | { kind: 'hist'; n: number };

export interface ForgetSurvey {
  /** every key of the page's, in the order the browser lists them */
  keys: string[];
  /** in the order the page says them; empty when nothing is stored */
  parts: ForgetPart[];
}

/** Every key in the store, read before anything is removed (removing while walking `key(i)` moves the indices). */
function keysOf(store: ForgetStore): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k !== null) out.push(k); }
  return out;
}

/** The length of the array a record holds (at `field`, or the record itself), or null when it is not one. */
function countIn(raw: string | null, field?: string): number | null {
  try {
    const j: unknown = JSON.parse(raw || 'null');
    const a = field ? (j && typeof j === 'object' ? (j as Record<string, unknown>)[field] : null) : j;
    return Array.isArray(a) ? a.length : null;
  } catch { return null; }
}

/** What the page has stored. Null when the store cannot be read at all (a browser that refuses site data). */
export function survey(store: ForgetStore | null): ForgetSurvey | null {
  if (!store) return null;
  let keys: string[];
  try { keys = keysOf(store).filter(ours); } catch { return null; }
  const has = (k: string) => keys.includes(k);
  const get = (k: string) => { try { return store.getItem(k); } catch { return null; } };
  const parts: ForgetPart[] = [];
  if (has('obs-site')) parts.push({ kind: 'site' });
  if (has('obs-recent')) parts.push({ kind: 'recents', n: countIn(get('obs-recent')) });
  const orbitKeys = ['gt.custom', 'gt.custom.bak'];
  /* every other key of the page's that is not a cache, nor the watchlist, is a choice: the listed ones, and a gt. key of a later version */
  const choices = keys.filter(k => !orbitKeys.includes(k) && k !== 'gt.watch' && !k.startsWith('tle:') && !k.startsWith('hist:') && k !== 'obs-site' && k !== 'obs-recent').length;
  if (choices) parts.push({ kind: 'choices', n: choices });
  /* the spacecraft starred (L60): a list of numbers, counted */
  if (has('gt.watch')) parts.push({ kind: 'watch', n: countIn(get('gt.watch')) });
  /* gt.custom.bak is orbits this version could not read: with it there, an empty list is not "nothing to lose", so it is said without a
     count (and with the warning) */
  if (has('gt.custom') || has('gt.custom.bak')) {
    let n = has('gt.custom') ? countIn(get('gt.custom'), 'items') : null;
    if (n === 0 && has('gt.custom.bak')) n = null;
    parts.push({ kind: 'orbits', n });
  }
  const tle = keys.filter(k => k.startsWith('tle:')).length, hist = keys.filter(k => k.startsWith('hist:')).length;
  if (tle) parts.push({ kind: 'tle', n: tle });
  if (hist) parts.push({ kind: 'hist', n: hist });
  return { keys, parts };
}

/** Remove every key of the page's, and nothing else. `left` is what is still there afterwards (a browser that refused). */
export function forget(store: ForgetStore): { removed: string[]; left: string[] } {
  const removed: string[] = [];
  for (const k of keysOf(store).filter(ours)) {
    try { store.removeItem(k); removed.push(k); } catch { /* said below, as what is left */ }
  }
  let left: string[];
  try { left = keysOf(store).filter(ours); } catch { left = []; }
  return { removed: removed.filter(k => !left.includes(k)), left };
}

/** The address to open once it is forgotten: the same, without the two parameters that would bring some of it back. `site`
 *  carries the observer's position (the page puts it there itself), and `tab` is written straight into `gt.prefs` by the page
 *  that opens it. The spacecraft, the span and `?tle=embedded` stay. `search` is `location.search`, with or without its `?`. */
export function searchAfterForget(search: string): string {
  const kept = search.replace(/^\?/, '').split('&').filter(p => {
    if (!p) return false;
    let name = p.split('=')[0]!;
    try { name = decodeURIComponent(name.replace(/\+/g, ' ')); } catch { /* not encoded as we would: compared as it is */ }
    return name !== 'site' && name !== 'tab';
  });
  return kept.length ? '?' + kept.join('&') : '';
}
