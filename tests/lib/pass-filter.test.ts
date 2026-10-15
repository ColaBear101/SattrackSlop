import { describe, expect, it, vi } from 'vitest';
import { filterOn, filterPasses, inSpan, NO_FILTER, parseClock, PEAKS, readFilter, siteMinute, type PassFilter } from '../../src/lib/analysis/pass-filter';
import { passRowText, siteClock } from '../../src/lib/text/passfacts';
import { clockText, FILTER_BUTTON, FILTER_BUTTON_ON, FILTER_TITLE, filterWords, hiddenSay, shownSay } from '../../src/lib/text/passfilter';
import { EYE_LABEL, filterNote, fromName, peakLabel, RESET_LABEL, toName, zoneSpan } from '../../src/lib/text/passfilter-panel';
import type { Pass } from '../../src/lib/types';
import { BANGKOK, byName, world } from './helpers';

/* The pass list's filter (CHANGES-FROM-LEGACY.md, L56): which passes the rail's list shows, as the analysis's own indices. A
   filter of the list only: the analysis it reads is the engine's, untouched, and every test here checks the indices against
   the passes themselves (their culmination, their AOS on the site's clock, the optics' verdict), worked out here. */
const { eng, optics } = world();
/** a week of the ISS from Bangkok, 15 days after its element set's epoch: 24 passes, low and high, by day and by night, six of
 *  them naked-eye visible and one bright enough only in penumbra */
const ISS = eng.compute(byName('ISS (ZARYA)'), Date.parse('2026-09-27T07:29:09.993Z'), 168);
const BKK = siteClock(BANGKOK);
const eyeOf = (i: number) => optics.passOptical(ISS.track, ISS.passes[i]!)?.eye === 'yes';
const all = (P: readonly Pass[]) => P.map((_, i) => i);
const f = (g: Partial<PassFilter> & { hours?: Partial<PassFilter['hours']> }): PassFilter =>
  ({ ...NO_FILTER, ...g, hours: { ...NO_FILTER.hours, ...g.hours } });
/** an instant given as the site's wall clock at a fixed offset */
const at = (d: string, hm: string, tz: number) => Date.parse(d + 'T' + hm + ':00Z') - tz * 3600000;
/** a pass that is only what the filter reads: its culmination and its AOS */
const pass = (t0ms: number, maxEl = 30) => ({ t0ms, maxEl }) as unknown as Pass;

describe('nothing chosen', () => {
  it('hides nothing, and never asks the optics', () => {
    expect(filterOn(NO_FILTER)).toBe(false);
    const eye = vi.fn(() => false);
    expect(filterPasses(ISS.passes, NO_FILTER, BKK.offsetAt, eye)).toEqual(all(ISS.passes));
    expect(eye).not.toHaveBeenCalled();
  });
  it('is on as soon as one test is, and the span\'s hours alone are not a test until it is on', () => {
    expect(filterOn(f({ minPeak: 10 }))).toBe(true);
    expect(filterOn(f({ eye: true }))).toBe(true);
    expect(filterOn(f({ hours: { on: true } }))).toBe(true);
    expect(filterOn(f({ hours: { from: 0, to: 60, out: true } }))).toBe(false);
  });
});

describe('the highest point', () => {
  it('keeps the passes whose row reads the chosen elevation or higher, by their own indices, in order', () => {
    expect(ISS.passes.length).toBe(24);
    for (const minPeak of PEAKS.slice(1)) {
      const want = all(ISS.passes).filter(i => parseInt(passRowText(ISS.passes[i]!, BKK).peak) >= minPeak);
      const got = filterPasses(ISS.passes, f({ minPeak }), BKK.offsetAt, eyeOf);
      expect(got).toEqual(want);
      expect(got.length).toBeLessThan(ISS.passes.length);
    }
    expect(filterPasses(ISS.passes, f({ minPeak: 45 }), BKK.offsetAt, eyeOf).length).toBeGreaterThan(0);
  });
  /* It compared the culmination itself until the review of f13c3dd: a row reading "30°" (29.944, ALSAT 2B from London) was hidden by
     "30°", under a line saying "peaking at 30° or more". The test is the row's own figure, so what the reader sees is what is kept. */
  it('compares the peak as the row shows it, to the whole degree: a row that reads 20° is kept by 20°', () => {
    const P = [pass(0, 19.49), pass(1, 19.5), pass(2, 19.96), pass(3, 20), pass(4, 20.04)];
    const row = (p: Pass) => passRowText({ ...p, aos: new Date(p.t0ms), dur: 300 } as Pass, { offsetAt: () => 0, labelAt: () => 'UTC' }).peak;
    expect(P.map(row)).toEqual(['19°', '20°', '20°', '20°', '20°']);
    expect(filterPasses(P, f({ minPeak: 20 }), () => 0, () => true)).toEqual([1, 2, 3, 4]);
  });
});

describe('the hours', () => {
  it('reads the minute of the site\'s day at an instant, at the offset given', () => {
    expect(siteMinute(at('2026-10-15', '18:00', 7), 7)).toBe(1080);
    expect(siteMinute(at('2026-10-15', '00:00', 7), 7)).toBe(0);
    expect(siteMinute(at('2026-10-15', '23:59', 7), 7)).toBe(1439);
    expect(siteMinute(at('2026-10-15', '06:30', 5.5), 5.5)).toBe(390);
    expect(siteMinute(at('2026-10-15', '21:15', -3), -3)).toBe(1275);
    expect(siteMinute(Date.parse('2026-10-15T17:59:59.999Z'), 0)).toBe(1079);   // a pass at 17:59:59 rose before 18:00
  });
  it('takes a span from its first minute up to, not including, its last; past midnight when it ends earlier than it starts; the whole day when the two are the same', () => {
    expect([1079, 1080, 1200, 1259, 1260].map(m => inSpan(m, 1080, 1260))).toEqual([false, true, true, true, false]);
    expect([1079, 1080, 1439, 0, 359, 360].map(m => inSpan(m, 1080, 360))).toEqual([false, true, true, true, true, false]);
    expect([0, 700, 1439].every(m => inSpan(m, 600, 600))).toBe(true);
  });
  it('keeps the passes whose AOS is in the span on the site\'s clock, or outside it when asked; the two are each other\'s complement', () => {
    const night = f({ hours: { on: true, from: 18 * 60, to: 6 * 60 } });
    const inside = filterPasses(ISS.passes, night, BKK.offsetAt, eyeOf);
    const want = all(ISS.passes).filter(i => { const m = siteMinute(ISS.passes[i]!.t0ms, 7); return m >= 1080 || m < 360; });
    expect(inside).toEqual(want);
    const outside = filterPasses(ISS.passes, f({ hours: { ...night.hours, out: true } }), BKK.offsetAt, eyeOf);
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
    expect([...inside, ...outside].sort((a, b) => a - b)).toEqual(all(ISS.passes));
  });
  it('follows the site\'s clock across a change of offset: 18:30 UTC is 18:30 in London on 28 March and 19:30 on 29 March', () => {
    const london = siteClock({ tz: 0, zone: 'Europe/London' });
    const P = [pass(Date.parse('2026-03-28T18:30:00Z')), pass(Date.parse('2026-03-29T18:30:00Z'))];
    expect(filterPasses(P, f({ hours: { on: true, from: 19 * 60, to: 20 * 60 } }), london.offsetAt, () => true)).toEqual([1]);
    expect(filterPasses(P, f({ hours: { on: true, from: 18 * 60, to: 19 * 60 } }), london.offsetAt, () => true)).toEqual([0]);
  });
  it('shows every pass for a span of the whole day, and none outside it', () => {
    expect(filterPasses(ISS.passes, f({ hours: { on: true, from: 600, to: 600 } }), BKK.offsetAt, eyeOf)).toEqual(all(ISS.passes));
    expect(filterPasses(ISS.passes, f({ hours: { on: true, from: 600, to: 600, out: true } }), BKK.offsetAt, eyeOf)).toEqual([]);
  });
});

describe('the eye', () => {
  it('keeps exactly the passes the optics call naked-eye visible: "yes", and not "penumbra only"', () => {
    const verdicts = ISS.passes.map(p => optics.passOptical(ISS.track, p)?.eye);
    const got = filterPasses(ISS.passes, f({ eye: true }), BKK.offsetAt, eyeOf);
    expect(got).toEqual(all(ISS.passes).filter(i => verdicts[i] === 'yes'));
    expect(got.length).toBe(6);
    expect(verdicts.filter(v => v === 'penumbra only').length).toBe(1);
  });
  it('asks the optics only while the test is on, and only of a pass the other tests kept', () => {
    const eye = vi.fn((i: number) => eyeOf(i));
    filterPasses(ISS.passes, f({ minPeak: 30 }), BKK.offsetAt, eye);
    expect(eye).not.toHaveBeenCalled();
    filterPasses(ISS.passes, f({ minPeak: 30, eye: true }), BKK.offsetAt, eye);
    expect(eye.mock.calls.map(c => c[0])).toEqual(all(ISS.passes).filter(i => +ISS.passes[i]!.maxEl.toFixed(0) >= 30));
  });
});

describe('all three', () => {
  it('keeps a pass only when it passes every test that is on: the intersection of each alone', () => {
    const peak = f({ minPeak: 20 }), eye = f({ eye: true }), night = f({ hours: { on: true, from: 17 * 60, to: 7 * 60 } });
    const each = [peak, eye, night].map(x => new Set(filterPasses(ISS.passes, x, BKK.offsetAt, eyeOf)));
    const both = filterPasses(ISS.passes, f({ minPeak: 20, eye: true, hours: night.hours }), BKK.offsetAt, eyeOf);
    expect(both).toEqual(all(ISS.passes).filter(i => each.every(s => s.has(i))));
  });
});

describe('what is stored', () => {
  it('reads back what it wrote', () => {
    const x = f({ minPeak: 30, eye: true, hours: { on: true, from: 1170, to: 330, out: true } });
    expect(readFilter(JSON.stringify(x))).toEqual(x);
    expect(readFilter(JSON.stringify(NO_FILTER))).toEqual(NO_FILTER);
  });
  it('is null when there is nothing to read, and takes NO_FILTER\'s value for a field the page could not have written', () => {
    for (const raw of [null, '', 'null', 'not json', '"x"', '7']) expect(readFilter(raw)).toBeNull();
    expect(readFilter('{}')).toEqual(NO_FILTER);
    expect(readFilter('[]')).toEqual(NO_FILTER);
    expect(readFilter('{"minPeak":15,"eye":"yes","hours":{"on":1,"from":1440,"to":-1,"out":null}}')).toEqual(NO_FILTER);
    expect(readFilter('{"minPeak":45,"hours":{"from":90.5,"to":120}}')).toEqual(f({ minPeak: 45, hours: { to: 120 } }));
  });
  it('reads a time field\'s value as minutes after midnight, with or without seconds', () => {
    expect(parseClock('18:00')).toBe(1080);
    expect(parseClock('06:05')).toBe(365);
    expect(parseClock('23:59:30')).toBe(1439);
    expect(parseClock('00:00:00.000')).toBe(0);
    for (const s of ['', '7:00', '24:00', '12:60', '12', 'noon']) expect(parseClock(s)).toBeNull();
  });
});

describe('the words', () => {
  it('names the button, the panel and what it offers', () => {
    expect([FILTER_BUTTON, FILTER_BUTTON_ON, FILTER_TITLE]).toEqual(['Filter', 'Filter · on', 'Filter the pass list']);
    expect(PEAKS.map(peakLabel)).toEqual(['Any', '10°', '20°', '30°', '45°']);
    expect(EYE_LABEL).toBe('Only passes the naked eye can see');
    expect(RESET_LABEL).toBe('Show every pass');
    expect(fromName('UTC+7')).toBe('Rising from, in the site\'s time (UTC+7)');
    expect(toName('UTC+5:30')).toBe('Rising before, in the site\'s time (UTC+5:30)');
    expect(filterNote(5)).toBe('Only this list is filtered. The minutes in view, the countdown, the marks on the timeline, the report and the exports still count every pass over the 5° mask.');
  });
  it('names the offset the span is read at, and both when the site\'s clock changes inside the window', () => {
    const london = siteClock({ tz: 0, zone: 'Europe/London' }), H = 3600000;
    /* a week opening on 20 October: UTC+1 until 02:00 on the 25th, which is 01:00 UTC+0 */
    const t0 = Date.parse('2026-10-20T07:29:09Z');
    expect(zoneSpan(t0, t0 + 168 * H, london)).toBe('UTC+1, then UTC+0 from 10-25');
    expect(zoneSpan(Date.parse('2026-03-26T12:00:00Z'), Date.parse('2026-04-02T12:00:00Z'), london)).toBe('UTC+0, then UTC+1 from 03-29');
    expect(zoneSpan(t0, Date.parse('2026-10-25T00:59:59Z'), london)).toBe('UTC+1');
    expect(zoneSpan(t0, t0 + 168 * H, BKK)).toBe('UTC+7');
    /* the pass the review named: 19:30 UTC on the 26th is 19:30 at UTC+0, the offset named for it, and kept by 19:00 to 20:00 */
    expect(filterPasses([pass(Date.parse('2026-10-26T19:30:00Z')), pass(Date.parse('2026-10-26T18:30:00Z'))],
      f({ hours: { on: true, from: 19 * 60, to: 20 * 60 } }), london.offsetAt, () => true)).toEqual([0]);
  });
  it('says how many passes are shown and by what', () => {
    expect(clockText(365)).toBe('06:05');
    expect(filterWords(NO_FILTER)).toEqual([]);
    expect(shownSay(4, 12, f({ minPeak: 20 }))).toBe('Showing 4 of 12 passes: peaking at 20° or more.');
    expect(shownSay(0, 1, f({ eye: true }))).toBe('Showing 0 of 1 pass: visible to the naked eye.');
    expect(shownSay(3, 40, f({ minPeak: 10, eye: true, hours: { on: true, from: 1080, to: 360 } })))
      .toBe('Showing 3 of 40 passes: peaking at 10° or more, visible to the naked eye, rising between 18:00 and 06:00 site time.');
    expect(shownSay(9, 40, f({ hours: { on: true, from: 1080, to: 360, out: true } }))).toBe('Showing 9 of 40 passes: rising outside 18:00–06:00 site time.');
    expect(filterWords(f({ hours: { on: true, from: 60, to: 60 } }))).toEqual(['rising at any hour of the day']);
    expect(filterWords(f({ hours: { on: true, from: 60, to: 60, out: true } }))).toEqual(['rising at no hour of the day']);
  });
  it('says when the selected pass is one of those hidden', () => {
    expect(hiddenSay(4)).toBe('Pass 5, the one selected, is hidden by the filter; the sky plot and the facts under it still show it.');
  });
});
