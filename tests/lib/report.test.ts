import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeElementsReporter } from '../../src/lib/analysis/reporter';
import { markup } from '../../src/lib/text/markup';
import { b, br, plain, type Inline } from '../../src/lib/text/rich';
import { fetchingView, lifeAccuracy, lifeAxis, lifeFmtDays, lifePaint, lifeSpan, lifeWhyNot, offerView } from '../../src/lib/text/life';
import { Lifetime } from '../../src/lib/planner/lifetime';
import { GLOSSARY } from '../../src/lib/text/glossary';
import { byName, world } from './helpers';

/* The report's prose. The elements section and the Decay section were written, sentence by sentence, in the old page;
   they are moved into data (src/lib/analysis/elements-report.ts, src/lib/text/life-words.ts) with the sentences untouched.
   verification/golden.js compares them with the old page's own output across 38 spacecraft; these are the fast checks
   that sit beside it: the strings below are what the OLD page printed for LANDSAT 9 at 2026-09-13T00:00Z from Bangkok. */

describe('markup() reads the old page\'s inline strings into data', () => {
  it('understands <b>, </b> and <br>, and decodes entities as text', () => {
    expect(markup('plain')).toBe('plain');
    expect(markup('a <b>bold</b>')).toEqual(['a ', b(['bold'])]);
    expect(markup('x<br><br>y')).toEqual(['x', br, br, 'y']);
    expect(plain(markup('A &amp; B &rsquo;s &mdash; &lt;ok&gt;'))).toBe('A & B ’s — <ok>');
    expect(plain(markup('1&nbsp;km'))).toBe('1 km');
  });
  it('anything else that looks like a tag is text, so a name from the network can never become an element', () => {
    const hostile = 'x <i>y</i> <script>alert(1)</script> <b onclick="z">q</b> <img src=x>';
    expect(plain(markup(hostile))).toBe(hostile.replace('<b onclick="z">q</b>', '<b onclick="z">q'));
    expect(markup('&foo; stays')).toBe('&foo; stays');
  });
  it('a stray close is ignored and an unclosed bold runs to the end', () => {
    expect(plain(markup('a</b> b'))).toBe('a b');
    expect(markup('a <b>b')).toEqual(['a ', b(['b'])]);
  });
});

describe('the Decay section\'s durations and axis', () => {
  it('lifeFmtDays: days under two months, then months, then years', () => {
    expect([1, 30, 59.6, 60, 200, 399, 400, 1500].map(lifeFmtDays))
      .toEqual(['1 days', '30 days', '60 days', '2.0 months', '6.6 months', '13.1 months', '1.1 years', '4.1 years']);
  });
  it('lifeSpan: hours under two days, a century at infinity', () => {
    expect([Infinity, 0.5, 1 / 48, 1.99, 2, 100].map(lifeSpan))
      .toEqual(['more than a century', '12 hours', '1 hour', '48 hours', '2 days', '3.3 months']);
  });
  it('lifeAxis: hours, days, then years with one decimal under ten', () => {
    expect([0.01, 1, 30, 119.6, 120, 986, 4000].map(lifeAxis))
      .toEqual(['1 h', '24 h', '30 d', '120 d', '0.3 y', '2.7 y', '11 y']);
  });
});

describe('what the backtest says about a forecast, by range', () => {
  const from = new Date(Date.UTC(2026, 9, 1));
  const say = (days: number) => plain(markup(lifeAccuracy(days, from)));
  it('three weeks to 130 days; two months early to 220, with the month it moves to; five months to 330; no forecast after', () => {
    expect(say(100)).toMatch(/^Backtested against objects that really re-entered, a forecast at this range ran within about three weeks of the truth \(median −20 to \+12 d\)\./);
    expect(say(200)).toMatch(/about two months early \(median −63 d at a 180-day horizon\).*it falls in December 2026\./);
    expect(say(300)).toMatch(/about five months early \(median −144 d at a 270-day horizon\).*measured at the nearest horizon the backtest has, February 2027\./);
    expect(say(400)).toMatch(/^Beyond a year this is not a forecast\./);
  });
  it('every range carries the one-fortnight caveat', () => {
    for (const d of [100, 200, 300, 400]) expect(say(d)).toMatch(/Every object in that check re-entered within the same fortnight/);
  });
});

describe('why there is no history, in the words of what happened', () => {
  const e = { satnum: '25544' };
  const w = (got: Parameters<typeof lifeWhyNot>[1]) => lifeWhyNot(e, got);
  it('a failed request is worth trying again, an answer is not', () => {
    expect(w({ why: 'timeout' })).toMatchObject({ big: 'Not received', action: 'retry' });
    expect(w({ why: 'http', status: 503 })).toMatchObject({ big: 'Not received', action: 'retry' });
    expect(w({ why: 'unreadable' })).toMatchObject({ big: 'Not received', action: 'retry' });
    expect(w(null)).toMatchObject({ big: 'Not received', action: 'retry' });
    expect(w({ why: 'empty' })).toMatchObject({ big: 'No history', action: undefined });
    expect(w({ why: 'outside', rows: 779 })).toMatchObject({ big: 'Out of range', action: undefined });
  });
  it('names the object, and the status or the count that was actually seen', () => {
    expect(plain(w({ why: 'timeout' }).note)).toMatch(/^CelesTrak did not answer for NORAD 25544 within 75 seconds\./);
    expect(plain(w({ why: 'http', status: 503 }).note)).toMatch(/with HTTP 503, an error rather than a history\./);
    const o = w({ why: 'outside', rows: 779 }).note as Inline[];
    expect(plain(o)).toMatch(/^CelesTrak returned 779 element sets for NORAD 25544, and none has a mean altitude between \d+ km and [\d,]+ km/);
    expect(JSON.stringify(o)).toContain('"b":["779"]');           // the count is bold, as it was
  });
  it('the offer and the wait say what is about to happen, and for how long', () => {
    expect(offerView()).toMatchObject({ big: 'Not estimated yet', action: 'estimate' });
    expect(plain(offerView().note)).toMatch(/has taken anywhere from a few seconds to over a minute to answer, so it is fetched only when you ask\. It is then cached for 12 hours\.$/);
    expect(fetchingView(7)).toMatchObject({ big: 'Fetching…', sub: '7 s' });
    expect(plain(fetchingView(7).note)).toMatch(/the page waits up to 75 seconds\.$/);
  });
});

describe('the verdict for a history (lifePaint)', () => {
  const DAY = 86_400_000, T = Date.UTC(2026, 8, 13);
  const history = (n: number, spanDays: number, sma: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ t: T - (n - 1 - i) * (spanDays / (n - 1)) * DAY, sma: sma(i), ecc: 0.0002 }));

  it('too few sets, or too short a record, is said as such with its own count', () => {
    const P = history(30, 20, () => 700);
    const { view, fields } = lifePaint(Lifetime.predict(P), P, T);
    expect(view.big).toBe('Too little history');
    expect(plain(view.note)).toMatch(/^Only 30 element sets over 20 days\. A decay fit needs a couple of months of record/);
    expect(fields.span).toBe('20 days of element sets, 30 of them');
    const few = history(10, 5, () => 700);                         // under 25 sets the span is not even worked out
    expect(plain(lifePaint(Lifetime.predict(few), few, T).view.note)).toMatch(/^Only 10 element sets\. A decay fit/);
  });
  it('a record with no decay in it offers no date', () => {
    const P = history(80, 80, () => 700);
    const r = Lifetime.predict(P);
    expect(r.verdict).toBe('stable');
    const { view, fields } = lifePaint(r, P, T);
    expect(view).toMatchObject({ big: 'No measurable decay', sub: 'station-kept or near-stable' });
    expect(fields).toMatchObject({ alt: '700.0 km', hist: '2026-06-25 → 2026-09-13' });
  });
  it('a falling orbit gets a date, the two models, the rate and the backtest', () => {
    const P = history(150, 150, i => 380 - 0.2 * i - 0.0008 * i * i);
    const r = Lifetime.predict(P);
    expect(r.verdict).toBe('decaying');
    const { view, fields } = lifePaint(r, P, T);
    expect(view.big).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.sub).toMatch(/ from the last element set$/);
    expect(plain(view.note)).toMatch(/Backtested against objects that really re-entered/);
    expect(fields.rate).toMatch(/^-\d+\.\d{3} km\/day$/);
  });
  it('a forecast already in the past is not offered as a date', () => {
    const P = history(150, 150, i => 380 - 0.2 * i - 0.0008 * i * i);
    const r = Lifetime.predict(P);
    expect(r.days).toBeGreaterThan(0);
    const { view } = lifePaint(r, P, r.tNow + (r.days + 10) * DAY);
    expect(view.big).toBe('Probably re-entered');
    expect(view.sub).toMatch(/^forecast \d{4}-\d{2}-\d{2}, 10 days ago$/);
    expect(plain(view.note)).not.toMatch(/Backtested/);       // the backtest measured dates still to come
  });
  it('an eccentric orbit is refused in the words of where its perigee is', () => {
    const P = history(80, 80, () => 20_000).map(p => ({ ...p, ecc: 0.7 }));
    const { view } = lifePaint(Lifetime.predict(P), P, T);
    expect(['Eccentric orbit', 'No drag decay', 'Re-entering']).toContain(view.big);
    expect(view.sub).toMatch(/^perigee .* · e 0\.7/);
  });
});

/* ---- the elements section ------------------------------------------------------------------------------- */
describe('the orbital elements section, as the old page printed it for LANDSAT 9', () => {
  const { eng } = world();
  const report = makeElementsReporter(eng);
  const D = eng.compute(byName('LANDSAT 9'), Date.UTC(2026, 8, 13), 24);
  const R = report(D);

  it('six cards: symbol, name, value, unit, note and where on the TLE it came from', () => {
    expect(R.cells.map(c => c[0] + c[1])).toEqual(['aSemi-major axis', 'eEccentricity', 'iInclination', 'ΩRAAN', 'ωArgument of perigee', 'MMean anomaly']);
    expect(R.cells.map(c => c[2] + (c[3] ? (c[3] === '°' ? '' : ' ') + c[3] : ''))).toEqual(
      ['7077.7 km', '0.0001484', '98.2207°', '324.2909°', '100.3913°', '259.7453°']);
    expect(R.cells[0]![4]).toBe('Recovered by SGP4 from the Kozai mean motion; the two-body (μ/n²)^⅓ gives 7080.7, 2.92 km long. Half the major axis — not a mean radius, which is a(1+e²/2).');
    expect(R.cells[0]![5]).toBe('SGP4 Brouwer mean value, WGS-72');
    expect(R.cells[1]![4]).toBe('Effectively circular. Altitude still swings 27.5 km over a revolution. The orbit radius varies 16.9 km (2ae alone gives 2.1; the difference is SGP4\'s periodic terms), and the WGS-84 surface beneath the track is 20.9 km lower at its highest latitude than at the equator. The two combine by phase, so the swing is at most their sum.');
    expect(R.cells[1]![5]).toBe('line 2 cols 27–33, leading decimal implied');
    expect(R.cells[2]![4]).toBe('Retrograde. Sun-synchronous — the node drifts ~0.986°/day to hold a fixed local solar time.');
    expect(R.cells[4]![4]).toBe('Perigee position measured within the orbit plane from the ascending node. A mean-element perigee: at this e it is barely defined, and the osculating ω at epoch is 70.2°.');
    expect(R.cells[5]![4]).toBe('Phase around the orbit at the epoch instant — the anchor the propagation starts from. Read it with ω: their sum, the mean argument of latitude, is 0.14° and is well defined.');
  });
  it('the osculating elements are the same instant from the state vector, with the phase that survives a circular orbit', () => {
    expect(R.oscRows).toEqual([
      ['a', '7086.9 km'], ['e', '0.0012678'], ['i', '98.2154°'], ['Ω', '324.2909°'], ['ω', '70.15°'],
      ['ν', '289.85°', 'true anomaly'], ['u = ω + ν', '0.00°', 'argument of latitude']]);
    expect(R.oscNote).toBe('The two-body orbit through SGP4\'s position and velocity at the epoch, on its own μ = 398 600.8 km³/s². These are not the TLE\'s elements: the mean elements above have SGP4\'s periodic terms averaged out, and the osculating a alone moves 18.3 km over a revolution. At e this small ω and the true anomaly ν are each poorly defined; u, the argument of latitude, measured from the node, is the phase to trust.');
  });
  it('the derived values say what they are measured over', () => {
    expect(R.derived.map(r => [plain(r[0]), plain(r[1])])).toEqual([
      ['Mean motion', '14.57109712 rev/day'], ['Nodal period', '98.88 min'], ['Mean altitude', '714.6 km'], ['Min altitude', '704.4 km'],
      ['Max altitude', '731.9 km'], ['Revs in 24 h', '14.56'], ['B* drag term', '5.6390e-5 1/ER'], ['Rev. no. @ epoch', '26367']]);
    expect(R.dnote).toBe('The period and the min and max altitude are propagated over the first revolution from the window start, 2026-09-13 00:00:00Z, and the mean altitude over the whole 24 h window, so they move slightly as the window does. Revs in 24 h is 86 400 s divided by the period; the mean motion is the TLE\'s own, Kozai\'s.');
  });
  it('B* carries its unit as an abbreviation that spells itself out', () => {
    const unit = (R.derived[6]![1] as Inline[]).find(x => typeof x === 'object' && x !== null && 'abbr' in x) as { abbr: { text: string; title: string } };
    expect(unit.abbr).toEqual({ text: '1/ER', title: 'per Earth radius, the unit SGP4 carries B* in' });
  });
  it('the rail\'s four figures', () => {
    expect(R.mini).toEqual([['Inclination', '98.22°'], ['Period', '98.9 min'], ['Mean alt.', '715 km'], ['Revs / day', '14.56']]);
  });
  it('a planned orbit has no revolution count to print', () => {
    const custom = { ...D, entry: { ...D.entry, custom: true } };
    expect(plain(report(custom).derived[7]![1])).toBe('n/a (planned)');
  });
  it('an element set SGP4 gives no state for says so instead of printing zeros', () => {
    const none = { ...D, track: Object.assign(Object.create(D.track), { at: () => null }) };
    const r = report(none);
    expect(r.oscRows).toEqual([]);
    expect(r.oscNote).toBe('SGP4 gives no state at the epoch for this element set.');
  });
});

describe('the elements section over the whole baseline: no hole in any sentence', () => {
  const { eng } = world();
  const report = makeElementsReporter(eng);
  const names = Object.keys(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'verification', 'baseline.json'), 'utf8')).sats);
  it('has 38 spacecraft to look at', () => { expect(names.length).toBe(38); });

  it('every card, row and note is whole, whichever kind of orbit it is (LEO, GEO, Molniya, near-equatorial)', { timeout: 120_000 }, () => {
    for (const name of names) {
      const D = eng.compute(byName(name), Date.UTC(2026, 8, 13), 24);
      const R = report(D);
      const all = [
        ...R.cells.flatMap(c => c.map(String)), ...R.oscRows.flatMap(r => r.map(x => String(x ?? ''))), R.oscNote,
        ...R.derived.flatMap(r => [plain(r[0]), plain(r[1])]), R.dnote, ...R.mini.flat()
      ].join(' | ');
      expect(all, name).not.toMatch(/NaN|undefined|Infinity|null|\[object/);
      expect(R.cells.length, name).toBe(6);
      expect(R.derived.length, name).toBe(8);
      expect(R.mini.length, name).toBe(4);
      expect(R.oscRows.length === 7 || R.oscRows.length === 0, name).toBe(true);
      /* the label follows what the period is: nodal where the node can be timed, Keplerian where it cannot */
      const nodal = D.E.periodKind === 'nodal';
      expect(plain(R.derived[1]![0]), name).toBe(nodal ? 'Nodal period' : 'Kepler period');
      expect(R.mini[1]![0], name).toBe(nodal ? 'Period' : 'Kepler period');
      expect(R.dnote.length, name).toBeGreaterThan(60);
    }
  });
});

/* ---- the glossary --------------------------------------------------------------------------------------- */
describe('the glossary: a note that names a term must find it', () => {
  const ROOT = path.resolve(import.meta.dirname, '..', '..');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|svelte)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const ids = new Set(GLOSSARY.map(t => t.id));

  it('has the old page\'s 28 terms, each with a unique id of the form t-name', () => {
    expect(GLOSSARY.length).toBe(28);
    expect(ids.size).toBe(28);
    for (const t of GLOSSARY) { expect(t.id).toMatch(/^t-[a-z0-9]+$/); expect(t.term.length).toBeGreaterThan(1); expect(t.text.length).toBeGreaterThan(40); }
  });
  it('every #t-... link anywhere in the source lands on a term (the Professor\'s notes link to #t-sso and #t-ltan)', () => {
    const refs = new Map<string, string>();
    for (const f of walk(path.join(ROOT, 'src'))) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/#(t-[a-z0-9]+)/g)) refs.set(m[1]!, path.relative(ROOT, f));
    }
    expect([...refs.keys()].sort()).toEqual(expect.arrayContaining(['t-ltan', 't-reentry', 't-sso']));
    for (const [id, file] of refs) expect(ids.has(id), id + ' (' + file + ')').toBe(true);
  });
});
