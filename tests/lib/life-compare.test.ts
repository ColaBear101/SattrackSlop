import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { plain } from '../../src/lib/text/rich';
import * as W from '../../src/lib/text/life-compare';
import { CMP_OPEN, CMP_OPEN_FAILED } from '../../src/lib/text/life-compare-open';

/* The decay comparison's words (CHANGES-FROM-LEGACY.md, L66), as a reader or a screen reader gets them: the toolbar's labels, the
   rows' button names (each begins with the word on the button and names its spacecraft), the status line's sentences, the chart's
   name and key, the planned-orbit sentence; and the opener's two, which are a module of their own because they travel with the
   report's chunk while the rest travel with the comparison's. */

const ISS = 'ISS (ZARYA)';

describe('the opener', () => {
  it('is one constant name, and one sentence when the comparison does not arrive', () => {
    expect(CMP_OPEN).toBe('Compare with other spacecraft');
    expect(CMP_OPEN_FAILED).toBe('The comparison could not be loaded. Press again to retry.');
  });
  it('is imported by none of the comparison\'s own modules, whose words do not repeat it', () => {
    const root = path.resolve(__dirname, '../..');
    for (const f of ['src/lib/decay/compare.ts', 'src/lib/text/life-compare.ts', 'src/state/decay-compare.svelte.ts',
      'src/components/report/draw-compare.ts', 'src/components/report/DecayCompare.svelte']) {
      const code = fs.readFileSync(path.join(root, f), 'utf8');
      expect(code, f).not.toMatch(/(?:from\s*|import\s*\(\s*)['"][^'"]*life-compare-open/);
    }
    expect(Object.values(W)).not.toContain(CMP_OPEN);
    expect(Object.values(W)).not.toContain(CMP_OPEN_FAILED);
  });
});

describe('the toolbar and the search', () => {
  it('labels', () => {
    expect(W.CMP_ADD).toBe('Add spacecraft');
    expect(W.cmpAddWatched(4)).toBe('Add watched (4)');
    expect(W.cmpFetchMore(7, true)).toBe('Fetch 7 more');
    expect(W.cmpFetchMore(5, false)).toBe('Fetch the rest (5)');
    expect(W.CMP_CLEAR).toBe('Clear');
    expect(W.cmpClearArmed(3)).toBe('Press again to clear the comparison of 3 spacecraft.');
    expect(W.CMP_WAIT_NOTE).toMatch(/one at a time, and CelesTrak can take up to 75 seconds each\.$/);
  });
  it('the search: its names, its marks, and the line after an add', () => {
    expect(W.CMP_ADD_DIALOG).toBe('Add a spacecraft to compare');
    expect(W.CMP_SEARCH_PLACEHOLDER).toBe('Search the catalogue or a NORAD ID');
    expect([W.CMP_LISTED, W.CMP_SELECTED]).toEqual(['in the comparison', 'selected']);
    expect(W.CMP_NO_MATCH).toBe('Nothing in the catalogue matches that.');
    expect(W.cmpMoreMatch(12)).toBe('12 more match. Keep typing…');
    expect(W.cmpAdded(ISS, 3)).toBe('Added ISS (ZARYA) · 3 in the comparison');
    expect(W.CMP_DECAYED_NOTE).toMatch(/^Decayed now: .* Its history still shows how it came down, and is fetched when it is added\.$/);
    expect(W.CMP_DECAYED_NOTE).not.toMatch(/picking/);
  });
});

describe('a row', () => {
  it('names each button by the word on it, then the spacecraft', () => {
    expect(W.cmpHighlightName(ISS)).toBe('Highlight ISS (ZARYA)');
    expect(W.cmpRemoveName(ISS)).toBe('Remove ISS (ZARYA) from the comparison');
    expect(W.cmpFetchName(ISS).startsWith(W.CMP_FETCH)).toBe(true);
    expect(W.cmpFetchName(ISS)).toBe('Fetch the history of ISS (ZARYA)');
    expect(W.cmpRetryName(ISS).startsWith(W.CMP_RETRY)).toBe(true);
    expect(W.cmpRetryName(ISS)).toBe('Try again for ISS (ZARYA)');
    expect([W.CMP_ALT_NAME, W.CMP_RATE_NAME]).toEqual(['Mean altitude', 'Decay rate']);
    expect(W.cmpShowOthers(42)).toBe('Show the other 42');
    expect(W.CMP_ROWS_NAME).toBe('Spacecraft in the comparison');
  });
  it('says its place in the queue in English ordinals, and the seconds of its wait', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(W.ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
    expect(W.cmpQueued(2)).toBe('Queued, 2nd');
    expect(W.cmpFetching(12)).toBe('Fetching… 12 s');
  });
  it('says what came back instead of a history, short', () => {
    expect(W.cmpFailShort({ why: 'timeout' })).toBe('no answer within 75 seconds');
    expect(W.cmpFailShort({ why: 'http', status: 503 })).toBe('CelesTrak answered HTTP 503');
    expect(W.cmpFailShort({ why: 'unreadable' })).toBe('CelesTrak’s answer was not a history');
    expect(W.cmpFailShort({ why: 'unreachable' })).toBe('CelesTrak could not be reached');
    expect(W.cmpFailShort(null)).toBe('CelesTrak could not be reached');
    expect(W.cmpFailShort({ why: 'empty' })).toBe('CelesTrak holds no history for it');
    expect(W.cmpFailShort({ why: 'outside', rows: 779 })).toBe('779 element sets, none in range');
    expect(W.cmpFailShort({ why: 'outside', rows: 1 })).toBe('1 element set, none in range');
    expect(W.cmpFailShort('code')).toBe('the page’s code for it did not load');
  });
  it('says why it is not drawn, and why its highlight is refused', () => {
    expect(W.cmpNotDrawn('high')).toBe('too high for drag to matter, not drawn');
    expect(W.cmpNotDrawn('thin')).toBe('too little history, not drawn');
    expect(W.cmpCannotHighlight('INTELSAT 901', 'high')).toBe('INTELSAT 901 is not drawn: too high for drag to matter.');
    for (const k of ['thin', 'high', 'answer', 'failed', 'code'] as const) expect(W.cmpNotDrawn(k)).toMatch(/^[a-z].*, not drawn$/);
  });
});

describe('the status line', () => {
  it('a batch: how many were added, read from the cache, asked for and left to wait, and what did not fit', () => {
    expect(W.cmpBatch({ added: 12, cached: 0, fetching: 7, waiting: 5 })).toBe('12 added: 7 are being fetched one at a time, 5 wait for Fetch.');
    expect(W.cmpBatch({ added: 3, cached: 2, fetching: 1, waiting: 0 })).toBe('3 added: 2 from the cache, 1 is being fetched.');
    expect(W.cmpBatch({ added: 2, cached: 0, fetching: 0, waiting: 1 + 1 })).toBe('2 added: 2 wait for Fetch.');
    expect(W.cmpBatch({ added: 48, cached: 0, fetching: 7, waiting: 41, left: 2 }))
      .toBe('48 added: 7 are being fetched one at a time, 41 wait for Fetch. 2 more did not fit: the comparison holds 50.');
  });
  it('refusals, removals and the clearing', () => {
    expect(W.cmpHighlightFull(ISS)).toBe('Seven are highlighted: turn one off to highlight ISS (ZARYA).');
    expect(W.cmpAddFull(ISS)).toBe('The comparison holds 50 spacecraft, the most it keeps: remove one to add ISS (ZARYA).');
    expect(W.cmpRemoved(ISS, 2)).toBe('Removed ISS (ZARYA) · 2 in the comparison');
    expect(W.cmpRemovedWaiting(ISS, 2)).toBe('Removed ISS (ZARYA) · 2 in the comparison. Its history had already been asked for: the next one waits until that answer is in.');
    expect(W.cmpCleared(1)).toBe('Cleared the comparison of 1 spacecraft.');
    expect(W.cmpFetchingSay({ cached: 0, fetching: 7, waiting: 5 })).toBe('7 are being fetched one at a time, 5 still wait for Fetch.');
    expect(W.cmpFetchingSay({ cached: 0, fetching: 1, waiting: 0 })).toBe('1 is being fetched.');
    expect(W.cmpFetchingSay({ cached: 0, fetching: 2, waiting: 1 })).toBe('2 are being fetched one at a time, 1 still waits for Fetch.');
    // every row the press took was cached since: no "0 are being fetched"
    expect(W.cmpFetchingSay({ cached: 2, fetching: 0, waiting: 2 })).toBe('2 from the cache, 2 still wait for Fetch.');
  });
  it('a press whose first request is the selected spacecraft\'s own names it: it is one of the seven', () => {
    expect(W.cmpFetchingSay({ cached: 0, fetching: 6, waiting: 7, first: 'KNACKSAT-2' }))
      .toBe('KNACKSAT-2 and 6 more are being fetched one at a time, 7 still wait for Fetch.');
    expect(W.cmpBatch({ added: 10, cached: 1, fetching: 5, waiting: 4, first: 'KNACKSAT-2' }))
      .toBe('10 added: 1 from the cache, KNACKSAT-2 and 5 more are being fetched one at a time, 4 wait for Fetch.');
  });
  it('a highlight refused while a listed spacecraft, now the selected one, keeps its colour out of sight names it', () => {
    expect(W.cmpHighlightFull(ISS, 'KNACKSAT-2'))
      .toBe('Seven are highlighted, one of them KNACKSAT-2, now the selected spacecraft: turn one off to highlight ISS (ZARYA).');
  });
  it('a listed spacecraft the catalogue does not hold is named by its number, as the Decay section names one', () => {
    expect(W.cmpUnnamed('07530')).toBe('NORAD 07530');
  });
  it('the queue through: one named, several counted', () => {
    expect(W.cmpDone(6, 1)).toBe('6 fetched, 1 not received.');
    expect(W.cmpDone(3, 0)).toBe('3 fetched.');
    expect(W.cmpDone(0, 2)).toBe('2 not received.');
    expect(W.cmpDone(1, 0, ISS)).toBe('The history of ISS (ZARYA) arrived.');
    expect(W.cmpDone(0, 1, ISS)).toBe('The history of ISS (ZARYA) was not received.');
  });
  it('with a planned orbit selected, one sentence and no date in it', () => {
    expect(plain(W.CMP_PLANNED)).toMatch(/^The comparison is put away while a planned orbit is selected/);
    expect(W.CMP_PLANNED).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('the chart', () => {
  it('its name says how many, and which when four or fewer are drawn', () => {
    expect(W.cmpChartName(9, null)).toBe('Mean altitude history and projected decay of 9 spacecraft');
    expect(W.cmpChartName(3, ['KNACKSAT-2', ISS, 'OSCAR 7'])).toBe('Mean altitude history and projected decay of 3 spacecraft: KNACKSAT-2, ISS (ZARYA) and OSCAR 7');
    expect(W.cmpChartName(1, ['KNACKSAT-2'])).toBe('Mean altitude history and projected decay of 1 spacecraft: KNACKSAT-2');
  });
  it('its key, its line and its axis', () => {
    expect([W.CMP_KEY_OBSERVED, W.CMP_KEY_PROJECTED, W.cmpOthers(1), W.cmpOthers(12)]).toEqual(['observed', 'projected', '1 other', '12 others']);
    expect([W.cmpGrey(1), W.cmpGrey(3)]).toEqual(['1 spacecraft', '3 spacecraft']);     // the grey lines, with none in colour
    expect(W.CMP_REENTRY).toBe('120 km — re-entry');
    const t = Date.UTC(2026, 9, 18, 23, 59);
    expect([W.cmpMonth(t), W.cmpDay(t), W.cmpKm(412.345)]).toEqual(['2026-10', '2026-10-18', '412.3 km']);
  });
  it('every word is plain text: no markup a name could ride in', () => {
    for (const [k, v] of Object.entries(W)) if (typeof v === 'string') expect(v, k).not.toMatch(/<[a-z/]/i);
    expect(W.cmpAdded('<img src=x>', 1)).toBe('Added <img src=x> · 1 in the comparison');     // a string, rendered as text
  });
});
