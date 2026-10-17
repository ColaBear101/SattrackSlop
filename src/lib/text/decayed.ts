/* The picker's mark on a spacecraft SGP4 has come down at the clock's instant, and the line under the list that says what it means
 * (CHANGES-FROM-LEGACY.md, L59).
 *
 * New in the rebuild. The mark is one SGP4 sample per entry at the clock's instant when the list was opened (lib/catalogue/decayed.ts):
 * not compute()'s test, so it takes no row away, and picking the spacecraft still asks SGP4 for the whole window, which is the
 * answer. These words are a module of their own, not notices.ts beside the re-entry note: notices.ts is in the entry chunk, and
 * these travel with the mark's own chunk (state/decayed.svelte.ts), asked for the first time the list opens. */

/** the mark, in the option, beside the catalogue number */
export const DECAYED_NOW = 'decayed now';

/** under the list, while a row in it carries the mark. A body with no entry interface has no atmosphere, so no drag either: only
 *  SGP4's error 6 is named there. */
export const decayedNote = (reentryKm: number | null): string =>
  "Decayed now: at the clock's instant SGP4 " + (reentryKm === null ? 'refuses it as decayed (error 6). '
    : 'has it below the ' + reentryKm + ' km entry interface, or refuses it as decayed (error 6), or its drag terms have carried it '
      + "past what they can model (after the set's epoch: refused with error 1 to 4, or put above its own apogee). ")
  + 'It is still listed; picking it asks SGP4 for its whole window.';
