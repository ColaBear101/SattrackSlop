import type { KeyValue } from '../lib/observer';

/** What a page may keep. Where the browser refuses to hand out `window.localStorage` (blocked site data, a sandboxed frame) merely naming
 *  the global throws, and a page that names it while it starts is a blank page: this is a store that holds nothing and says so at the first
 *  write, which every writer here already handles (the site still applies for this visit; the form says an orbit will not be remembered). */
const NOTHING: KeyValue & { removeItem(k: string): void } = {
  getItem: () => null,
  setItem: () => { throw new DOMException('storage is not available here', 'SecurityError'); },
  removeItem: () => {}
};

export function localStore(): KeyValue & { removeItem(k: string): void } {
  try { return window.localStorage; } catch { return NOTHING; }
}

/** The browser's own store, to be walked as well as read (forgetting what the page stored, lib/forget.ts), or null where the browser
 *  refuses it: there, nothing was ever stored. */
export function browserStore(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
