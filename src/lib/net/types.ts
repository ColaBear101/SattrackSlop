/* The collaborators the network code takes as arguments, so it runs in a browser, a worker, Node and Vitest
 * without a DOM: nothing in src/lib/net reaches for `window`, `localStorage` or the global clock itself. */

/** `fetch`, as this code uses it: a string URL in, a Response out. The browser's own fetch is assignable. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The part of Storage this code uses. `window.localStorage` is assignable; `null` stands for "no storage" (blocked,
 *  a private window): every read and write is already wrapped, and the code works without it. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The three-hour and twelve-hour lifetimes of what the page keeps in localStorage (`tle:<n>`, `hist:<n>`). */
export const TLE_TTL = 3 * 3600 * 1000;
export const HIST_TTL = 12 * 3600 * 1000;
