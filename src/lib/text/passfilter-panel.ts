/* The words of the pass list's filter panel (CHANGES-FROM-LEGACY.md, L56): what it offers, and what it does not touch.
 *
 * New in the rebuild. The panel opens under the list's Filter button (the words over the list are in passfilter.ts). It is a
 * chunk of its own with these words, asked for at the button's first press. The span of hours is read on the site's clock,
 * which the time fields' names and the offset beside them say. */

export const PEAK_HEAD = 'Peaks at least';
/** the culmination buttons, as a screen reader names the group */
export const PEAK_NAME = 'Lowest peak elevation shown';
/** a culmination button: 0 is every pass */
export const peakLabel = (deg: number): string => (deg > 0 ? deg + '°' : 'Any');

export const EYE_LABEL = 'Only passes the naked eye can see';
export const EYE_NOTE = 'Those the facts under the sky plot call "Naked eye: yes": fully sunlit against a dark sky, at magnitude +6 or ' +
  'brighter. A pass bright enough only in partial shadow is left out.';

export const HOURS_LABEL = 'Only passes that rise between';
/** between the two time fields */
export const HOURS_AND = 'and';
/** the time fields, as a screen reader names them: the site's clock, with its offset */
export const fromName = (zone: string): string => 'Rising from, in the site\'s time (' + zone + ')';
export const toName = (zone: string): string => 'Rising before, in the site\'s time (' + zone + ')';
export const OUT_LABEL = 'Outside these hours instead';
export const HOURS_NOTE = 'In the site\'s time. A span that ends earlier than it starts runs past midnight: 18:00 and 06:00 is the night.';

export const RESET_LABEL = 'Show every pass';
/** What the filter does not touch. */
export const filterNote = (mask: number): string => 'Only this list is filtered. The minutes in view, the countdown, the marks on the ' +
  'timeline, the report and the exports still count every pass over the ' + mask + '° mask.';
