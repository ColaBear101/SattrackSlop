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
