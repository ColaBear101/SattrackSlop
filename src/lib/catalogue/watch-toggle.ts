import { NUM, WATCH_MAX } from './watch';

/* A press of the watchlist's star, on the list (CHANGES-FROM-LEGACY.md, L60): a module of its own, apart from watch.ts, so that it
 * travels with the press's chunk (state/watch-press.ts) and the entry carries only the reading of the list. Pure. */

/** The list after a press of the star for `n`: taken off if it was on, put at the end if not. Null when the list is full; the list
 *  itself, unchanged, when `n` is not a catalogue number. */
export function toggleWatch(list: readonly string[], n: string): readonly string[] | null {
  if (list.includes(n)) return list.filter(x => x !== n);
  if (!NUM.test(n)) return list;
  return list.length < WATCH_MAX ? [...list, n] : null;
}
