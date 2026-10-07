import { describe, expect, it } from 'vitest';
import { Advisor } from '../../src/lib/planner/advisor';
import { Lifetime } from '../../src/lib/planner/lifetime';
import { lifeCustomFailed, lifeCustomKey, lifeCustomPaint, type AdvisorLife, type CustomElements, type LifeCustomPaint } from '../../src/lib/text/life-custom';
import { plain, type Inline } from '../../src/lib/text/rich';

/* The Decay section's words for a planned orbit. They were written in lifeCustom() in the old page (legacy/index.html,
   lines 11689-11762) and are moved into data with every word kept. The strings below were read off that function, branch by
   branch, not produced by running the new one: a planned orbit has no calendar, so none of them is a date (the old suite's
   check, verify-custom.js group 9, is repeated for every branch). The life results are made by hand, in the shape that
   Advisor.life() returns; the last block runs the real one. */

const EPOCH = Date.UTC(2026, 2, 1, 6, 0, 0);
const el = (o: Partial<CustomElements> = {}): CustomElements => ({ a: 6878.137, e: 0.0001, i: 51.6, am: 0.0123, epoch: EPOCH, ...o });
const pts = (end: number) => [{ t: 0, h: 500.04 }, { t: end / 2, h: 300 }, { t: end, h: 120 }];

const SPAN_NONE = 'planned orbit — nothing was requested';
const SPAN = 'forecast from your drag assumption, not from a history';
const NO_ELEMENTS = 'This entry carries no elements to forecast from.';
const HEAD = (am: string) => 'This is the page’s atmosphere model run forward from the area-to-mass ratio you typed, ' + am + '. ' +
  'It has no history to fit, so the range is wide on purpose: the drag as a whole, air density and your guess together, ' +
  'is allowed a factor of 3 either way, and a solar cycle alone swings the air at 400 km by about a factor of ten. ' +
  'The globe’s own propagation starts at this rate and ';
const TAIL_CIRCULAR = 'then decays more slowly, because SGP4’s air density falls off more gently with height; scrolled years ahead it can reach the ground up to about three times later than the mid-case.';
const TAIL_ECCENTRIC = 'then follows its own atmosphere, so it can reach the ground sooner or later than this (against SGP4 the ratio has run from about a third to nearly three times): a rough cross-check only.';
const NO_HISTORY = ' No element-set history was requested, because none exists.';

/* a date is what a planned orbit must never print: an ISO date, a year, a month's name */
const DATE = /\d{4}-\d{2}-\d{2}/, YEAR = /\b(19|20)\d\d\b/;
const MONTH = /January|February|March|April|May|June|July|August|September|October|November|December/;

function bolds(x: Inline): string[] {
  if (typeof x === 'string') return [];
  if (Array.isArray(x)) return x.flatMap(bolds);
  return 'b' in x ? [plain(x.b)] : [];
}
/* every word the panel shows, for the checks that read them all */
const everything = (r: LifeCustomPaint) => [r.view.big, r.view.sub, plain(r.view.note), r.view.span, ...Object.values(r.fields)].join(' | ');
const noDate = (r: LifeCustomPaint) => {
  const all = everything(r);
  expect(all).not.toMatch(DATE);
  expect(all).not.toMatch(YEAR);
  expect(all).not.toMatch(MONTH);
};
const said = (r: LifeCustomPaint) => ({ big: r.view.big, sub: r.view.sub, note: plain(r.view.note), span: r.view.span });

const none = (why: string | null, h0?: number): AdvisorLife => ({ model: 'none', why, h0 });
const circular = (o: Partial<AdvisorLife> = {}): AdvisorLife => ({
  model: 'circular', why: null, mid: 1000, lo: 200, hi: 3000, h0: 500.04, rate0: -0.0123456,
  track: pts(1000), fastTrack: pts(200), slowTrack: pts(3000), ...o
});
const eccentric = (o: Partial<AdvisorLife> = {}): AdvisorLife => ({
  model: 'eccentric', why: null, mid: 2000, lo: 2000 / 3, hi: 6000, h0: 521.6, rate0: -0.00456,
  track: pts(2000), fastTrack: pts(2000 / 3), slowTrack: pts(6000), ...o
});
const DASHES = { alt: '—', rate: '—', hist: '—' };

describe('an entry with nothing to forecast from', () => {
  it('says so, with no figures and no chart (the test hook entry carries no elements)', () => {
    const r = lifeCustomPaint(circular(), null);
    expect(said(r)).toEqual({ big: 'Not forecast', sub: '', note: NO_ELEMENTS, span: '' });
    expect(r.fields).toEqual(DASHES);
    expect(r.chart).toBeNull();
    noDate(r);
  });
  it('is the same when the forecast is not there to read (the old page tested window.Advisor)', () => {
    expect(lifeCustomPaint(null, el())).toEqual(lifeCustomPaint(circular(), null));
    expect(lifeCustomPaint(undefined, undefined)).toEqual(lifeCustomPaint(null, null));
  });
  it('is the answer when Advisor.life() threw: nothing worked out, the three figures left as dashes', () => {
    const r = lifeCustomFailed();
    expect(said(r)).toEqual({ big: 'Not forecast', sub: '', note: 'The decay could not be worked out for this orbit.', span: '' });
    expect(r.fields).toEqual(DASHES);
    expect(r.chart).toBeNull();
    noDate(r);
  });
});

describe('an orbit the model gives no forecast for (model "none")', () => {
  const HIST = { alt: '—', rate: '—', hist: 'none — planned orbit' };

  it('deep: the Moon and the Sun, not drag, and the perigee as a number with a thousands comma', () => {
    const r = lifeCustomPaint(none('deep', 35786.4), el({ a: 42164.182 }));
    expect(said(r)).toEqual({
      big: 'Not forecast', sub: 'perigee 35,786 km', span: SPAN_NONE,
      note: 'A period of 225 minutes or more. What shortens the life of an orbit this high is the Moon and the Sun pulling on its perigee, not drag, and this page models neither, so no estimate is offered.'
    });
    expect(bolds(r.view.note)).toEqual([]);
    expect(r.fields).toEqual(HIST);
    expect(r.chart).toBeNull();
    noDate(r);
  });
  it('high perigee: above the 1,000 km where the table ends, with the perigee in bold', () => {
    const r = lifeCustomPaint(none('high-perigee', 1500.4), el());
    expect(said(r)).toEqual({
      big: 'No drag estimate', sub: 'perigee 1,500 km', span: SPAN_NONE,
      note: 'Perigee is 1,500 km, above the 1,000 km where the atmosphere this page knows ends, so no estimate is offered. For a compact satellite the air does not decide how long this orbit lasts; for a very light sail or balloon it still might.'
    });
    expect(bolds(r.view.note)).toEqual(['1,500 km']);
    expect(r.fields).toEqual(HIST);
    expect(r.chart).toBeNull();
    noDate(r);
  });
  it.each(['high-apogee', 'ecc-high'])('%s: one sentence for both, the Moon and the Sun decide where the perigee goes', why => {
    const r = lifeCustomPaint(none(why, 600.4), el({ e: 0.35 }));
    expect(said(r)).toEqual({
      big: 'Not forecast', sub: 'perigee 600 km', span: SPAN_NONE,
      note: 'This orbit reaches beyond 5,000 km or is more eccentric than 0.3: the Moon and the Sun, not drag, decide where its perigee goes, and this page models neither.'
    });
    expect(bolds(r.view.note)).toEqual([]);
    expect(r.fields).toEqual(HIST);
    expect(r.chart).toBeNull();
    noDate(r);
  });
  it('re-entry: under the 120 km line, with the perigee in bold', () => {
    const r = lifeCustomPaint(none('reentry', 100.4), el());
    expect(said(r)).toEqual({
      big: 'Re-entering', sub: 'perigee 100 km', span: SPAN_NONE,
      note: 'Perigee is 100 km, under the 120 km line this page calls re-entry; it does not come round many more times.'
    });
    expect(bolds(r.view.note)).toEqual(['100 km']);
    expect(r.fields).toEqual(HIST);
    expect(r.chart).toBeNull();
    noDate(r);
  });
  it.each(['no-drag', null, 'anything else'])('%s: an area over mass of 0 never decays, and there is no sub-line', why => {
    const r = lifeCustomPaint({ model: 'none', why, mid: Infinity, lo: Infinity, hi: Infinity, h0: 500 }, el({ am: 0 }));
    expect(said(r)).toEqual({ big: 'No drag', sub: '', note: 'An area-to-mass ratio of 0 never decays.', span: SPAN_NONE });
    expect(r.fields).toEqual(HIST);
    expect(r.chart).toBeNull();
    noDate(r);
  });
  it('a perigee that is not a number is a dash, not "NaN" or "undefined"', () => {
    for (const h0 of [undefined, NaN, Infinity]) {
      expect(lifeCustomPaint(none('deep', h0), el()).view.sub).toBe('perigee — km');
      expect(bolds(lifeCustomPaint(none('reentry', h0), el()).view.note)).toEqual(['— km']);
    }
  });
  it('asks for nothing: no button in any of them', () => {
    for (const why of ['deep', 'high-perigee', 'high-apogee', 'ecc-high', 'reentry', 'no-drag']) {
      const r = lifeCustomPaint(none(why, 500), el());
      expect('action' in r.view).toBe(false);
    }
  });
});

describe('a forecast: three runs from the drag the reader typed', () => {
  it('circular: a duration for the headline, the range after the epoch, and the model of the old page in the note', () => {
    const L = circular(), e = el();
    const r = lifeCustomPaint(L, e);
    expect(said(r)).toEqual({
      big: '2.7 years',
      sub: 'between 6.6 months and 8.2 years after the epoch',
      note: HEAD('0.0123 m²/kg') + TAIL_CIRCULAR + NO_HISTORY,
      span: SPAN
    });
    expect(bolds(r.view.note)).toEqual(['0.0123 m²/kg']);
    expect(r.fields).toEqual({ alt: '500.0 km', rate: '-0.012 km/day', hist: 'none — planned orbit' });
    noDate(r);
  });
  it('circular: the chart is drawn from the three runs, at the epoch, with no history behind it', () => {
    const L = circular(), e = el();
    const { chart } = lifeCustomPaint(L, e);
    expect(chart).toEqual({
      custom: true, eccentric: false,
      P: [{ t: EPOCH, sma: 500.04, ecc: 0.0001 }],
      r: { hNow: 500.04, tNow: EPOCH, rate: -0.0123456, verdict: 'custom', track: L.track, simpleTrack: L.fastTrack, trendTrack: L.slowTrack }
    });
    // the arrays are the forecast's own, not copies: three runs, the mid case, drag x3 (fast) and drag x1/3 (slow)
    expect(chart!.r.track).toBe(L.track);
    expect(chart!.r.simpleTrack).toBe(L.fastTrack);
    expect(chart!.r.trendTrack).toBe(L.slowTrack);
    expect(chart!.P).toHaveLength(1);
  });
  it('eccentric: the note changes its middle, adds the perigee, and the chart says so', () => {
    const L = eccentric(), e = el({ e: 0.04, a: 6378.135 + 900 });
    const r = lifeCustomPaint(L, e);
    expect(said(r)).toEqual({
      big: '5.5 years',
      sub: 'between 1.8 years and 16.4 years after the epoch',
      note: HEAD('0.0123 m²/kg') + TAIL_ECCENTRIC + NO_HISTORY +
        ' Drag is applied orbit-averaged, so it bites at perigee, 522 km, and the chart shows perigee height.',
      span: SPAN
    });
    expect(bolds(r.view.note)).toEqual(['0.0123 m²/kg', '522 km']);
    expect(r.fields).toEqual({ alt: '521.6 km', rate: '-0.005 km/day', hist: 'none — planned orbit' });
    expect(r.chart).toMatchObject({ custom: true, eccentric: true, P: [{ t: EPOCH, sma: 521.6, ecc: 0.04 }], r: { hNow: 521.6, tNow: EPOCH, verdict: 'custom' } });
    noDate(r);
  });
  it('the area over mass is printed as a number without padding zeros', () => {
    const table: [number, string][] = [[0.0123, '0.0123'], [0.0043, '0.0043'], [0.0001, '0.0001'], [0.01, '0.01'], [0.005, '0.005'],
      [0.25, '0.25'], [1, '1'], [2.5, '2.5'], [10, '10']];
    for (const [am, shown] of table)
      expect(bolds(lifeCustomPaint(circular(), el({ am })).view.note)[0]).toBe(shown + ' m²/kg');
  });
  it('a low orbit is hours, with the singular for one, never a date', () => {
    const low = circular({ mid: 0.5, lo: 0.2, hi: 1.5, h0: 130.2, rate0: -30.1234 });
    const r = lifeCustomPaint(low, el({ a: 6378.135 + 130 }));
    expect(r.view.big).toBe('12 hours');
    expect(r.view.sub).toBe('between 5 hours and 36 hours after the epoch');
    expect(r.fields).toEqual({ alt: '130.2 km', rate: '-30.123 km/day', hist: 'none — planned orbit' });
    noDate(r);
    const brief = lifeCustomPaint(circular({ mid: 1 / 48, lo: 1 / 144, hi: 1 / 16 }), el());
    expect(brief.view.big).toBe('1 hour');
    expect(brief.view.sub).toBe('between 1 hour and 2 hours after the epoch');
  });
  it('days, then months, then years: lifeSpan\'s own thresholds', () => {
    const at = (d: number) => lifeCustomPaint(circular({ mid: d, lo: d, hi: d }), el()).view.big;
    expect([2, 59.6, 60, 399, 400].map(at)).toEqual(['2 days', '60 days', '2.0 months', '13.1 months', '1.1 years']);
  });
  it('a century and more: Infinity in the headline, in the low end, in the high end', () => {
    // nothing in the whole window decays, even at drag x3
    const open = lifeCustomPaint(circular({ mid: Infinity, lo: Infinity, hi: Infinity }), el({ a: 6378.135 + 900, e: 0.0001 }));
    expect(open.view.big).toBe('More than a century');
    expect(open.view.sub).toBe('more than a century even with drag three times as strong');
    // the mid case is past the cap but drag x3 is not
    const mid = lifeCustomPaint(circular({ mid: Infinity, lo: 30000, hi: Infinity }), el());
    expect(mid.view.big).toBe('More than a century');
    expect(mid.view.sub).toBe('between 82.1 years and more than a century after the epoch');
    // the high end alone is open (the eccentric march: hi = 3 x mid past the cap)
    const hiOpen = lifeCustomPaint(eccentric({ mid: 5000, lo: 5000 / 3, hi: Infinity }), el());
    expect(hiOpen.view.big).toBe('13.7 years');
    expect(hiOpen.view.sub).toBe('between 4.6 years and more than a century after the epoch');
    for (const r of [open, mid, hiOpen]) { noDate(r); expect(r.chart).not.toBeNull(); }
  });
  it('asks for nothing, and says there is no history behind it', () => {
    for (const L of [circular(), eccentric()]) {
      const r = lifeCustomPaint(L, el());
      expect('action' in r.view).toBe(false);
      expect(plain(r.view.note)).toContain('No element-set history was requested, because none exists.');
      expect(r.view.span).toBe(SPAN);
      expect(r.fields.hist).toBe('none — planned orbit');
    }
  });
  it('leaves the forecast and the elements it was given as they were', () => {
    const L = circular(), e = el();
    const before = JSON.stringify([L, e]);
    Object.freeze(L); Object.freeze(e);
    lifeCustomPaint(L, e);
    expect(JSON.stringify([L, e])).toBe(before);
  });
  it('is a pure function of its arguments: the same answer twice', () => {
    expect(lifeCustomPaint(eccentric(), el())).toEqual(lifeCustomPaint(eccentric(), el()));
  });
});

describe('what the forecast is cached on (entry.__life.key)', () => {
  it('is the four numbers it depends on, joined, and nothing about the orbit\'s place or time', () => {
    expect(lifeCustomKey(el())).toBe('6878.137,0.0001,51.6,0.0123');
    const moved = { ...el(), raan: 10, argp: 20, M: 30, epoch: EPOCH + 86400000 };
    expect(lifeCustomKey(moved)).toBe(lifeCustomKey(el()));
  });
  it('changes with each of the four', () => {
    const base = lifeCustomKey(el());
    for (const o of [{ a: 6879 }, { e: 0.001 }, { i: 98 }, { am: 0.02 }]) expect(lifeCustomKey(el(o))).not.toBe(base);
  });
});

/* The real Advisor.life(), on the orbits the old suite's decay guards used (verify-custom.js group 9): the shape it returns is
   the shape read above, and the words that come out are the ones that suite looked for. */
describe('with the real Advisor.life()', () => {
  const full = (o: Partial<CustomElements> & { a?: number } = {}) => ({ a: 6378.135 + 600, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: EPOCH, am: 0.0043, ...o });
  const run = (o: Parameters<typeof full>[0]) => { const e = full(o), t = performance.now(), L = Advisor.life(e, undefined) as AdvisorLife; const ms = performance.now() - t; return { e, L, r: lifeCustomPaint(L, e), ms }; };

  it('a circular orbit: the headline is Lifetime.integrate run forward, in years, with the figures beside it', () => {
    const { e, L, r } = run({});
    const days = Lifetime.integrate(e.a, 1000 * 2.2 * e.am, 120, false).days as number;
    expect(days).toBeGreaterThan(400);
    expect(r.view.big).toBe((days / 365.25).toFixed(1) + ' years');
    expect(plain(r.view.note)).toMatch(/atmosphere model run forward/);
    expect(plain(r.view.note)).toMatch(/factor of 3 either way/);
    expect(plain(r.view.note)).toMatch(/scrolled years ahead/);
    expect(r.view.span).toBe(SPAN);
    expect(r.fields.alt).toBe(L.h0!.toFixed(1) + ' km');
    expect(r.fields.rate).toBe(L.rate0!.toFixed(3) + ' km/day');
    expect(r.chart).toMatchObject({ custom: true, eccentric: false, r: { hNow: L.h0, tNow: EPOCH, verdict: 'custom' } });
    // three runs of {days after the epoch, height}, the x3 run the shortest and the x1/3 run the longest
    const last = (a: { t: number }[]) => a[a.length - 1]!.t;
    const c = r.chart!.r;
    expect(c.track.length).toBeGreaterThan(1);
    expect(last(c.simpleTrack)).toBeLessThan(last(c.track));
    expect(last(c.track)).toBeLessThan(last(c.trendTrack));
    noDate(r);
  });
  it('an eccentric orbit: "sooner or later", the perigee, and the chart says perigee height', () => {
    const { r, ms } = run({ a: 6378.135 + 900, e: 0.04, i: 51.6 });
    const note = plain(r.view.note);
    expect(note).toMatch(/sooner or later/);
    expect(note).not.toMatch(/scrolled years ahead/);
    expect(note).toMatch(/bites at perigee/);
    expect(r.chart!.eccentric).toBe(true);
    expect(ms).toBeLessThan(4000);
    noDate(r);
  });
  it('a geostationary orbit is not integrated at all (unguarded it took 30.7 s) and is given no figure', () => {
    const { r, ms } = run({ a: 42164.182, e: 0.0002, i: 0.05 });
    expect(ms).toBeLessThan(4000);
    expect(r.view.big).toBe('Not forecast');
    expect(r.view.sub).toMatch(/^perigee 3\d,\d{3} km$/);
    expect(plain(r.view.note)).toMatch(/Moon and the Sun/);
    expect(r.chart).toBeNull();
    noDate(r);
  });
  it('a perigee above the atmosphere table is told drag does not decide it', () => {
    const { r } = run({ a: 6378.135 + 1500, e: 0.0001 });
    expect(r.view.big).toBe('No drag estimate');
    expect(plain(r.view.note)).toMatch(/1,000 km/);
    noDate(r);
  });
  it('an area-to-mass ratio of 0 never decays', () => {
    const { r } = run({ am: 0 });
    expect(r.view.big).toBe('No drag');
    expect(plain(r.view.note)).toMatch(/never decays/);
    noDate(r);
  });
  it('a perigee under the 120 km line is "Re-entering"', () => {
    const { r } = run({ a: 6378.135 + 100, e: 0.0001, i: 51.6 });
    expect(r.view.big).toBe('Re-entering');
    expect(plain(r.view.note)).toMatch(/120 km line/);
    noDate(r);
  });
  it('a low orbit is a number of hours, never a date', () => {
    const { r } = run({ a: 6378.135 + 130, e: 0.0001, i: 51.6 });
    expect(r.view.big).toMatch(/^\d+ hours?$/);
    noDate(r);
  });
});
