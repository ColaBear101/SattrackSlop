/* The words of the one-pass calendar button, under the selected pass's facts (CHANGES-FROM-LEGACY.md, L57).
 *
 * New in the rebuild; the old page wrote the whole window's calendar only. The button writes the selected pass alone as a
 * calendar file (lib/export, exportPassICS): the same event the whole window's file has for it, alarm and UID included. On a
 * phone or tablet the file goes to the share sheet where the browser takes it there (a calendar app can be picked from it);
 * anywhere else, and where the sheet does not take it, it is a download. These are the words the page cannot start without:
 * what a press says once the file is written is in pass-ics-said.ts, with the code that writes it, fetched on the first press. */

export const PASS_ICS = 'Add this pass to your calendar';
/** what the button makes, for the pointer that rests on it */
export const PASS_ICS_TITLE = 'This pass alone, as a calendar file (.ics) with an alarm 10 minutes before AOS';
/** a press whose code did not arrive (the connection dropped, or the tab outlived a deploy): the words the full export says then */
export const EXPORT_NOT_LOADED = 'Not exported — the code that writes the file could not be loaded. Check the connection and press again.';
