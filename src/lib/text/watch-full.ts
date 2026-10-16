/* The refusal of a press of the watchlist's star with the list full (CHANGES-FROM-LEGACY.md, L60), said in the note under the bar,
 * where a refused load is said. A module of its own, not watch.ts, so that it travels with the press's chunk (state/watch-press.ts),
 * not the entry. */

/** Said under the bar when the star is pressed with the list full; nothing is put on, nothing is taken off. */
export const watchFull = (max: number, name: string): string =>
  'You are watching ' + max + ' spacecraft, the most this page keeps: take the star off one of them to watch ' + name + '.';
