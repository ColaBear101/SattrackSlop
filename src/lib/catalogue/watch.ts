/* The reader's watchlist: the spacecraft they starred, by NORAD number, which the picker lists first (CHANGES-FROM-LEGACY.md, L60).
 *
 * New in the rebuild; the old page had none. The record is a JSON array of catalogue numbers as the catalogue writes them ("25544",
 * "07530"), in the order they were starred, at most WATCH_MAX of them. Only a catalogue number is ever kept: an orbit of the reader's
 * own has a placeholder ("O0001"), not a number, and is never starred. A record that is not ours, or a part of one, is read as
 * nothing: what cannot be a number is dropped, a number twice is kept once, and past the cap the rest is left out.
 *
 * The picker's "Watched" group is a wrapper around rank() (rank.ts is the old page's order with a tier added, pinned by its own tests
 * and mutants, so it is not touched): the same rows, the watched ones moved to the front. Pure. readWatch and watchedFirst are in
 * the entry chunk (the star says at once whether the spacecraft on screen is watched), so they are kept small; a press of the
 * star is watch-toggle.ts, which travels with the press's own chunk (state/watch-press.ts). */

/** The most the page keeps. */
export const WATCH_MAX = 50;

/** a catalogue number as the catalogue writes it */
export const NUM = /^\d{1,5}$/;

/** The stored record, as the list it holds (none stored is the empty list). Throws on a record that is not a list: the caller, which
 *  reads the storage and may be refused it too, takes either as nothing stored. */
export const readWatch = (raw: string | null): string[] =>
  [...new Set((JSON.parse(raw || '[]') as unknown[]).filter((n): n is string => typeof n === 'string' && NUM.test(n)))].slice(0, WATCH_MAX);

/** rank()'s rows with `lead` (the watched rows, in the order they were starred) moved to the front: the same rows, none twice, as
 *  long as every row of `lead` is one of them, which on the empty query it is (rank() lists the whole catalogue there). With none,
 *  the rows are handed back as they are. */
export const watchedFirst = (rows: number[], lead: readonly number[]): number[] =>
  lead.length ? lead.concat(rows.filter(i => !lead.includes(i))) : rows;
