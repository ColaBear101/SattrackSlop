/* What the one-pass calendar button says once pressed, beside it, for six seconds (CHANGES-FROM-LEGACY.md, L57).
 *
 * In the chunk that writes the file, fetched on the first press; the button's own words are in pass-ics.ts. A share sheet the
 * reader closes is a cancel, and says nothing. */

/** The file was downloaded: which pass, and the file's name, since that is what the reader looks for next. */
export const passSaved = (n: number, name: string): string => 'Pass ' + n + ' written as a calendar event: open ' + name + ' to add it.';
/** The file went to the share sheet, and the reader sent it on. */
export const passShared = (n: number): string => 'Pass ' + n + ' shared as a calendar event.';
/** The button is offered for a pass; this is for the analysis that changed under a press, and has no pass there now. */
export const NO_PASS = 'No pass in this window to export.';
/** The full export's refusal, for one pass: once it is an alarm on someone's phone, the re-entry warning is no longer beside it. */
export const passReentry = (name: string, km: number): string =>
  'Not exported — SGP4 takes ' + name + ' below the ' + km + ' km entry interface, so this pass will not happen.';
