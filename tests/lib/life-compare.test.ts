import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { plain } from '../../src/lib/text/rich';
import * as W from '../../src/lib/text/life-compare';
import { CMP_OPEN, CMP_OPEN_FAILED } from '../../src/lib/text/life-compare-open';
import { PARAMS, RANGES } from '../../src/lib/decay/compare';

/* The decay comparison's words (CHANGES-FROM-LEGACY.md, L66), as a reader or a screen reader gets them: the toolbar's labels, the
   rows' button names (each begins with the word on the button and names its spacecraft), the status line's sentences, the chart's
   name and key, the planned-orbit sentence; and the opener's two, which are a module of their own because they travel with the
   report's chunk while the rest travel with the comparison's. */

const ISS = 'ISS (ZARYA)';

describe('the opener', () => {
  it('is one constant name, and one sentence when the comparison does not arrive', () => {
    expect(CMP_OPEN).toBe('Compare with other spacecraft');
    /* a reload, not another press: the browser keeps a failed import in its module map for the rest of the page */
    expect(CMP_OPEN_FAILED).toBe('The comparison could not be loaded. Reload the page to try again.');
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
    expect(W.cmpShowFirst(8)).toBe('Show only the first 8');
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
    /* what was just asked for waits behind a request out for nothing on the page now */
    expect(W.CMP_BEHIND).toBe('It waits for the answer to a request already out, which cannot be called back.');
    expect(W.cmpAddedBehind('HST', 1)).toBe('Added HST · 1 in the comparison. It waits for the answer to a request already out, which cannot be called back.');
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

describe('the chart\'s view (L67)', () => {
  const t0 = Date.UTC(2026, 6, 19), t1 = Date.UTC(2026, 9, 17);
  it('the range: its group\'s name, its five buttons, and what each shows', () => {
    expect(W.CMP_RANGE).toBe('Range');
    expect(W.CMP_RANGES).toEqual({ auto: 'Auto', '30d': '30 d', '90d': '90 d', '1y': '1 y', all: 'All' });
    expect(Object.keys(W.CMP_RANGES)).toEqual(RANGES);
    expect(W.CMP_RANGE_TITLES).toEqual({
      /* Auto starts at the first set held when every history fitted is younger than its year; All has no forecast to end on when no
         line in colour has one (stable, maneuvered, slow): both say so */
      auto: 'Fitted to the decay: a year or more before the earliest last element set (from the oldest set held, when that is later), ' +
        'to the latest projected re-entry or newest set',
      '30d': 'The 30 days up to the newest element set',
      '90d': 'The 90 days up to the newest element set',
      '1y': 'The year up to the newest element set',
      all: 'Every element set held, and the forecast to the latest projected re-entry where there is one'
    });
  });
  it('the quantity: its label and seven choices, mean altitude and the decay rate in the rows\' own words', () => {
    expect(W.CMP_SHOW).toBe('Show');
    expect(W.CMP_PARAMS).toEqual({
      alt: 'Mean altitude', hp: 'Mean perigee altitude', ha: 'Mean apogee altitude', rate: 'Decay rate',
      ecc: 'Eccentricity', per: 'Orbital period', mm: 'Mean motion'
    });
    expect(Object.keys(W.CMP_PARAMS)).toEqual(PARAMS);
    expect(W.CMP_PARAMS.alt).toBe(W.CMP_ALT_NAME);
    expect(W.CMP_PARAMS.rate).toBe(W.CMP_RATE_NAME);
  });
  it('the caption\'s, the zoom\'s and the scrubber\'s words', () => {
    expect([W.CMP_ZOOMED, W.CMP_NOTHING_HERE]).toEqual(['zoomed in', 'nothing drawn falls between these dates']);
    expect(W.CMP_RESET).toBe('Reset zoom');
    expect(W.CMP_DRAG_HINT).toBe('Drag across the chart, or double-click it, to zoom in.');
    expect(W.CMP_SCRUB_NAME).toBe('Read the chart at a date');
    expect(W.CMP_SCRUB_KEYS).toBe('Left and right arrows move the reading, Page Up and Page Down further; plus and minus zoom in and out.');
    expect(W.CMP_NO_VALUE).toBe('no line has a value here');
    expect(W.CMP_SCRUB_HINT).toBe('Arrow keys move the reading; plus and minus zoom in and out.');
  });
  it('after plus or minus, the scrubber says the span now drawn, and "zoomed in" while zoomed', () => {
    expect(W.cmpScrubView('2026-04-21: KNACKSAT-2 352.1 km', Date.UTC(2026, 2, 10), Date.UTC(2026, 4, 30), true))
      .toBe('2026-04-21: KNACKSAT-2 352.1 km · 2026-03-10 to 2026-05-30 · zoomed in');
    expect(W.cmpScrubView('2026-04-21: no line has a value here', t0, t1, false)).toBe('2026-04-21: no line has a value here · 2026-07-19 to 2026-10-17');
  });
  it('the canvas\'s name says the quantity, and whether the forecast is drawn in it; mean altitude says what it always said', () => {
    expect(W.cmpChartName(3, ['A', 'B', 'C'], 'per')).toBe('Orbital period history and projection of 3 spacecraft: A, B and C');
    expect(W.cmpChartName(9, null, 'hp')).toBe('Mean perigee altitude history of 9 spacecraft');
    expect(W.cmpChartName(1, ['KNACKSAT-2'], 'rate')).toBe('Decay rate history of 1 spacecraft: KNACKSAT-2');
    expect(W.cmpChartName(0, null, 'ecc')).toBe('Eccentricity history of 0 spacecraft');
    expect(W.cmpChartName(2, ['A', 'B'], 'mm')).toBe('Mean motion history and projection of 2 spacecraft: A and B');
    expect(W.cmpChartName(9, null, 'alt')).toBe('Mean altitude history and projected decay of 9 spacecraft');
    expect(W.cmpChartName(3, ['KNACKSAT-2', ISS, 'OSCAR 7'], 'alt')).toBe('Mean altitude history and projected decay of 3 spacecraft: KNACKSAT-2, ISS (ZARYA) and OSCAR 7');
    expect(W.cmpChartName(1, ['KNACKSAT-2'], 'alt')).toBe('Mean altitude history and projected decay of 1 spacecraft: KNACKSAT-2');
  });
  it('the caption: the quantity, its unit and the dates drawn, "zoomed in" while zoomed, and a span with nothing in it', () => {
    expect(W.cmpAxis('hp', t0, t1)).toBe('Mean perigee altitude, km · 2026-07-19 to 2026-10-17');
    expect(W.cmpAxis('ecc', t0, t1, true)).toBe('Eccentricity · 2026-07-19 to 2026-10-17 · zoomed in');
    expect(W.cmpAxis('rate', t0, t1, false, true)).toBe('Decay rate, km/day · 2026-07-19 to 2026-10-17 · nothing drawn falls between these dates');
    expect(W.cmpAxis('per', Date.UTC(2025, 9, 4), Date.UTC(2027, 2, 14))).toBe('Orbital period, min · 2025-10-04 to 2027-03-14');
    expect(W.cmpAxis('mm', t0, t1, true, true)).toBe('Mean motion, rev/day · 2026-07-19 to 2026-10-17 · zoomed in · nothing drawn falls between these dates');
    expect(W.cmpAxis('alt', t0, t1)).toBe('Mean altitude, km · 2026-07-19 to 2026-10-17');
    expect(W.cmpNoParam('ecc')).toBe('None of these histories carries eccentricity.');
    expect(W.cmpNoParam('hp')).toBe('None of these histories carries mean perigee altitude.');
  });
  it('a value: the number first, the decay rate signed, never "-0"', () => {
    expect(W.cmpValue('alt', 412.345)).toBe(W.cmpKm(412.345));
    expect(W.cmpValue('hp', 341.39)).toBe('341.4 km');
    expect(W.cmpValue('ha', 354.32)).toBe('354.3 km');
    expect(W.cmpValue('rate', -0.398)).toBe('-0.398 km/day');
    expect(W.cmpValue('rate', 0.012)).toBe('+0.012 km/day');
    expect(W.cmpValue('ecc', 0.00078)).toBe('0.00078');
    expect(W.cmpValue('per', 91.8088)).toBe('91.81 min');
    expect(W.cmpValue('mm', 15.68476422)).toBe('15.6848 rev/day');
    expect(W.cmpValue('rate', -0.0004)).toBe('0.000 km/day');
    expect(W.cmpValue('rate', 0.0004)).toBe('0.000 km/day');
  });
  it('a grid label: the step\'s decimals, never "-0"', () => {
    expect(W.cmpTick(-0.0000001, 3)).toBe('0.000');
    expect(W.cmpTick(496, 0)).toBe('496');
    expect(W.cmpTick(0.0012, 4)).toBe('0.0012');
    expect(W.cmpTick(-0.25, 2)).toBe('-0.25');
  });
  it('the scrubber says the day and every value there, or that there is none', () => {
    expect(W.cmpScrubText('2026-07-09', [])).toBe('2026-07-09: no line has a value here');
    expect(W.cmpScrubText('2026-07-09', [{ name: 'KNACKSAT-2', value: '352.1 km', projected: false }])).toBe('2026-07-09: KNACKSAT-2 352.1 km');
    expect(W.cmpScrubText('2026-07-09', [
      { name: ISS, value: '418.0 km', projected: false }, { name: 'KNACKSAT-2', value: '352.1 km', projected: false },
      { name: 'HST', value: '511.9 km', projected: true }
    ])).toBe('2026-07-09: ISS (ZARYA) 418.0 km, KNACKSAT-2 352.1 km, HST 511.9 km projected');
  });
  it('the note under the key: what a quantity is, and why it has no dashed forecast; none for mean altitude', () => {
    const noForecast = 'The forecast is of mean altitude only, so these lines stop at each last element set.';
    const meanEl = 'Worked out from each element set’s mean altitude and eccentricity, above a sphere of the Earth’s equatorial radius: ' +
      'a height found by propagating the orbit differs by a few km. ';
    const converted = 'Worked out from the mean altitude, so the forecast is drawn in it too.';
    expect(W.cmpNote('alt')).toBe('');
    expect(W.cmpNote('hp')).toBe(meanEl + noForecast);
    expect(W.cmpNote('ha')).toBe(meanEl + noForecast);
    expect(W.cmpNote('rate')).toBe('Each point is the change in mean altitude per day over the 45 days up to it, measured as the Decay ' +
      'section measures its decay rate; above zero, the orbit was raised. ' + noForecast);
    expect(W.cmpNote('ecc')).toBe(noForecast);
    expect(W.cmpNote('per')).toBe(converted);
    expect(W.cmpNote('mm')).toBe(converted);
  });
  it('the words in its tables are plain text too', () => {
    for (const v of [...Object.values(W.CMP_RANGES), ...Object.values(W.CMP_RANGE_TITLES), ...Object.values(W.CMP_PARAMS)]) {
      expect(v).not.toMatch(/<[a-z/]/i);
    }
  });
});
