/* The words of the decay comparison (CHANGES-FROM-LEGACY.md, L66): the panel under the Decay section's chart that sets other
 * spacecraft's decay beside the selected one's, on a chart of its own.
 *
 * New in the rebuild. Every word the panel says is here: its toolbar, the search that adds a spacecraft, the list's rows and their
 * buttons' names, the status line, the chart's name, key and readout, and the one sentence it says while a planned orbit is
 * selected. They travel with the comparison's own chunk (DecayCompare), asked for at the first press of "Compare with other
 * spacecraft" or when the section comes near with the panel left open; the opener's own two sentences are life-compare-open.ts,
 * in the report's chunk. A row's verdict (the re-entry date, "No measurable decay", "Not received") is the Decay section's own,
 * read from the same history by life.ts; these only add what a list of many needs. */
import { COMPARE_MAX, HIGHLIGHT_MAX } from '../decay/compare';

const count = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);
/** a, b and c */
const andList = (xs: readonly string[]): string => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

/* ---- the toolbar ------------------------------------------------------------------------------------------------- */

/** the button that opens the search */
export const CMP_ADD = 'Add spacecraft';
/** adds every watched catalogue spacecraft not yet listed (n of them) */
export const cmpAddWatched = (n: number): string => 'Add watched (' + n + ')';
/** asks for the histories of the rows that wait: seven at most, or the rest */
export const cmpFetchMore = (k: number, more: boolean): string => (more ? 'Fetch ' + k + ' more' : 'Fetch the rest (' + k + ')');
export const CMP_CLEAR = 'Clear';
/** said at the first press of Clear: a second press clears */
export const cmpClearArmed = (n: number): string => 'Press again to clear the comparison of ' + count(n, 'spacecraft', 'spacecraft') + '.';
/** said once, under the toolbar, while anything is asked for */
export const CMP_WAIT_NOTE = 'The histories are fetched one at a time, and CelesTrak can take up to 75 seconds each.';

/* ---- the search -------------------------------------------------------------------------------------------------- */

/** the popover, as a screen reader names it */
export const CMP_ADD_DIALOG = 'Add a spacecraft to compare';
export const CMP_SEARCH_PLACEHOLDER = 'Search the catalogue or a NORAD ID';
/** the search field's name (the placeholder goes when something is typed) */
export const CMP_SEARCH_NAME = 'Spacecraft to add to the comparison';
/** the list under it */
export const CMP_LIST_NAME = 'Catalogue spacecraft';
/** the groups of the list on an empty search */
export const CMP_WATCHED = 'Watched';
export const CMP_CATALOGUE = 'Catalogue';
/** marks in an option, as plain text: such an option is not added again */
export const CMP_LISTED = 'in the comparison';
export const CMP_SELECTED = 'selected';
export const CMP_NO_MATCH = 'Nothing in the catalogue matches that.';
export const cmpMoreMatch = (n: number): string => n + ' more match. Keep typing…';
/** the count line in the search, after an add: "Added ISS (ZARYA) · 3 in the comparison" */
export const cmpAdded = (name: string, n: number): string => 'Added ' + name + ' · ' + n + ' in the comparison';

/* ---- the list ---------------------------------------------------------------------------------------------------- */

/** a row's toggle, named for its spacecraft; aria-pressed says whether it is on */
export const cmpHighlightName = (name: string): string => 'Highlight ' + name;
export const cmpRemoveName = (name: string): string => 'Remove ' + name + ' from the comparison';
export const CMP_FETCH = 'Fetch';
export const cmpFetchName = (name: string): string => 'Fetch the history of ' + name;
export const CMP_RETRY = 'Try again';
export const cmpRetryName = (name: string): string => 'Try again for ' + name;
/** in front of a row's two figures, for a screen reader */
export const CMP_ALT_NAME = 'Mean altitude';
export const CMP_RATE_NAME = 'Decay rate';
/** the folded rows */
export const cmpShowOthers = (n: number): string => 'Show the other ' + n;

/** 1st, 2nd, 3rd, 4th, 11th, 21st */
export function ordinal(n: number): string {
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
}
/** a row's state while it waits in the queue, `pos` its place (1 is next) */
export const cmpQueued = (pos: number): string => 'Queued, ' + ordinal(pos);
/** a row's state while its history is asked for */
export const cmpFetching = (s: number): string => 'Fetching… ' + s + ' s';
/** a row whose cached history is being read and its forecast worked out */
export const CMP_READING = 'Reading…';

/** A row's failure, short, beside its headline ("Not received", from the Decay section's own words). `why` is the history's
 *  answer (lib/net/history-source.ts), 'code' when the part of the page that reads one did not arrive. */
export function cmpFailShort(got: { why: string | null; status?: number; rows?: number } | null | 'code'): string {
  if (got === 'code') return 'the page’s code for it did not load';
  const why = got ? got.why : 'unreachable';
  if (why === 'timeout') return 'no answer within 75 seconds';
  if (why === 'http') return 'CelesTrak answered HTTP ' + (got && got.status);
  if (why === 'unreadable') return 'CelesTrak’s answer was not a history';
  if (why === 'empty') return 'CelesTrak holds no history for it';
  if (why === 'outside') return count((got && got.rows) || 0, 'element set', 'element sets') + ', none in range';
  return 'CelesTrak could not be reached';
}
/** the headline of a row whose forecast could not be worked out because that code did not arrive */
export const CMP_CODE_FAILED = 'Not worked out';

/** Why a row is not on the chart. */
export type CmpNotDrawn = 'thin' | 'high' | 'answer' | 'failed' | 'code';
const WHY_NOT: Record<CmpNotDrawn, string> = {
  thin: 'too little history',
  high: 'too high for drag to matter',
  answer: 'nothing in its history to fit',
  failed: 'its history was not received',
  code: 'its forecast was not worked out'
};
/** in the row, after its figures */
export const cmpNotDrawn = (k: CmpNotDrawn): string => WHY_NOT[k] + ', not drawn';
/** said when the toggle of such a row is pressed (it is aria-disabled, and described by this) */
export const cmpCannotHighlight = (name: string, k: CmpNotDrawn): string => name + ' is not drawn: ' + WHY_NOT[k] + '.';

/* ---- the status line --------------------------------------------------------------------------------------------- */

export const cmpAddFull = (name: string): string =>
  'The comparison holds ' + COMPARE_MAX + ' spacecraft, the most it keeps: remove one to add ' + name + '.';
export const cmpHighlightFull = (name: string): string =>
  (HIGHLIGHT_MAX === 7 ? 'Seven' : String(HIGHLIGHT_MAX)) + ' are highlighted: turn one off to highlight ' + name + '.';
export const cmpRemoved = (name: string, n: number): string => 'Removed ' + name + ' · ' + n + ' in the comparison';
/** a row removed while its request was out: a request cannot be called back, and the next waits for its answer */
export const cmpRemovedWaiting = (name: string, n: number): string => cmpRemoved(name, n) +
  '. Its history had already been asked for: the next one waits until that answer is in.';
export const cmpCleared = (n: number): string => 'Cleared the comparison of ' + count(n, 'spacecraft', 'spacecraft') + '.';

/** What a press that asked for several came to: "12 added: 7 are being fetched one at a time, 5 wait for Fetch." */
export function cmpBatch(o: { added: number; cached: number; fetching: number; waiting: number; left?: number }): string {
  const parts: string[] = [];
  if (o.cached) parts.push(o.cached + ' from the cache');
  if (o.fetching) parts.push(o.fetching === 1 ? '1 is being fetched' : o.fetching + ' are being fetched one at a time');
  if (o.waiting) parts.push(o.waiting === 1 ? '1 waits for Fetch' : o.waiting + ' wait for Fetch');
  const said = o.added + ' added' + (parts.length ? ': ' + parts.join(', ') : '') + '.';
  return o.left ? said + ' ' + count(o.left, 'more did', 'more did') + ' not fit: the comparison holds ' + COMPARE_MAX + '.' : said;
}
/** What a press of Fetch asked for. */
export const cmpFetchingSay = (k: number, left: number): string =>
  (k === 1 ? '1 is being fetched' : k + ' are being fetched one at a time') + (left ? ', ' + left + ' still wait for Fetch.' : '.');
/** Said once the queue is through: "6 fetched, 1 not received." One alone is named. */
export function cmpDone(ok: number, failed: number, name?: string): string {
  if (ok + failed === 1 && name) return 'The history of ' + name + (ok ? ' arrived.' : ' was not received.');
  if (!failed) return ok + ' fetched.';
  return (ok ? ok + ' fetched, ' : '') + failed + ' not received.';
}

/** All the panel says while a planned orbit is selected: no rows, figures or chart (a planned orbit's forecast is a span of time
 *  from its epoch, never a date, and the section shows no date for one). */
export const CMP_PLANNED = 'The comparison is put away while a planned orbit is selected: it has no history of element sets to set ' +
  'beside the others, and no dates. It comes back when a catalogue spacecraft is selected.';

/* ---- the chart --------------------------------------------------------------------------------------------------- */

/** The canvas's name: how many are drawn, and which, when no more than four are in colour. */
export const cmpChartName = (n: number, named: readonly string[] | null): string =>
  'Mean altitude history and projected decay of ' + count(n, 'spacecraft', 'spacecraft') + (named && named.length ? ': ' + andList(named) : '');
/** the line where an object stops being in orbit */
export const CMP_REENTRY = '120 km — re-entry';
/** the key: the grey lines, and the two line styles */
export const cmpOthers = (n: number): string => count(n, 'other', 'others');
export const CMP_KEY_OBSERVED = 'observed';
export const CMP_KEY_PROJECTED = 'projected';
/** in place of the chart while nothing listed has a forecast to draw */
export const CMP_NOTHING_DRAWN = 'Nothing to draw yet: a line appears once a history with a forecast in it is here.';
/** the axis: km on the left, months along the bottom */
export const cmpMonth = (t: number): string => new Date(t).toISOString().slice(0, 7);
/** the readout: the day, then a value per line */
export const cmpDay = (t: number): string => new Date(t).toISOString().slice(0, 10);
export const cmpKm = (h: number): string => h.toFixed(1) + ' km';
