import { describe, expect, it } from 'vitest';
import { CIVIL_DEG, RISE_SET_DEG, SCAN_MS, sunEvents, sunTimes } from '../../src/lib/analysis/sun-times';
import { localDay, passDays, siteClock } from '../../src/lib/text/passfacts';
import { plain } from '../../src/lib/text/rich';
import {
  DARK_ALL_DAY, dayHead, dayName, flownNote, hhmm, NEVER_DARK, SUN_DOWN_ALL_DAY, SUN_UP_ALL_DAY, sunWords
} from '../../src/lib/text/suntimes';
import { BANGKOK, byName, world } from './helpers';

/* The Sun's times over each of the observer's days in the pass list (CHANGES-FROM-LEGACY.md, L55). The page's own Sun
   (core/sun.ts, sunElevation) is asked every 10 minutes and each crossing bisected to a second; these tests hold the result to
   the NOAA Solar Calculator, to a brute-force search of the same Sun at every second, and to the polar day and night. */
const { sun } = world();
const SVALBARD = { lat: 78.2297, lon: 15.4075 };     // the golden capture's far-north site (verification/gate/golden.js)
/** an instant given as the site's wall clock at a fixed offset */
const at = (d: string, hms: string, tz: number) => Date.parse(d + 'T' + hms + 'Z') - tz * 3600000;
const fixed = (tz: number) => siteClock({ tz, zone: null });
const day = (d: string, tz: number) => [at(d, '00:00:00', tz), at(d, '00:00:00', tz) + 86400000] as const;

/* Reference values: the NOAA Solar Calculator (NOAA Global Monitoring Laboratory, https://gml.noaa.gov/grad/solcalc/), from the
   equations it publishes with itself (calcdetails.html and the NOAA_Solar_Calculations spreadsheets, after Meeus, Astronomical
   Algorithms): sunrise and sunset at a solar zenith of 90.833 deg, each worked out at the date's 0 h UT and then once more at
   the event's own time, as the calculator does. The calculator gives only sunrise and sunset, so the dark-sky times are the
   same equations at a zenith of 96 deg, the USNO's civil twilight. The equations were evaluated for these sites and dates by
   a short independent script, not by the code under test; the calculator shows them rounded to the minute, and they are
   given here to the second, as the site's wall clock at the offset in the row. null: the calculator finds no such event
   that day. Bangkok is the page's default site (13.75 N, 100.52 E); Svalbard is 78.2297 N, 15.4075 E. */
type Ref = [site: 'Bangkok' | 'Svalbard', date: string, tz: number, rise: string | null, set: string | null, darkUntil: string | null, darkFrom: string | null];
const NOAA: Ref[] = [
  ['Bangkok', '2026-03-20', 7, '06:22:19', '18:28:44', '06:01:03', '18:50:01'],
  ['Bangkok', '2026-06-21', 7, '05:51:30', '18:47:52', '05:28:00', '19:11:22'],
  ['Bangkok', '2026-10-15', 7, '06:08:38', '17:58:40', '05:47:09', '18:20:09'],
  ['Bangkok', '2026-12-21', 7, '06:36:20', '17:55:22', '06:13:10', '18:18:33'],
  ['Svalbard', '2026-03-20', 1, '05:52:37', '18:22:56', '04:06:49', '20:10:39'],
  ['Svalbard', '2026-04-15', 2, '02:45:23', '23:25:42', null, null],
  ['Svalbard', '2026-10-15', 2, '09:26:16', '15:59:20', '07:30:37', '17:54:28'],
  ['Svalbard', '2026-11-05', 1, null, null, '09:21:34', '14:00:07'],
  ['Svalbard', '2026-02-10', 1, null, null, '09:08:40', '15:18:46']
];
/** the page's Sun and NOAA's differ by about 0.01 deg; at these sites that is seconds (11 s at most here), shown to the minute */
const TOL_MS = 30_000;

describe('the Sun\'s times against the NOAA Solar Calculator', () => {
  for (const [name, d, tz, rise, set, dawn, dusk] of NOAA) {
    it(name + ' ' + d + ': ' + [rise, set, dawn, dusk].map(x => x ?? 'none').join(', '), () => {
      const site = name === 'Bangkok' ? BANGKOK : SVALBARD;
      const [t0, t1] = day(d, tz);
      const s = sunTimes(sun, site, t0, t1);
      for (const [ref, got] of [[rise, s.rise], [set, s.set], [dawn, s.dawn], [dusk, s.dusk]] as const) {
        if (ref === null) { expect(got).toEqual([]); continue; }
        expect(got).toHaveLength(1);
        expect(Math.abs(got[0]! - at(d, ref, tz))).toBeLessThanOrEqual(TOL_MS);
      }
      /* no sunrise or sunset that day is the polar night here (the Sun stays below the horizon); no dark-sky time is a
         night that never gets dark (it stays in twilight) */
      expect(s.polarNight).toBe(rise === null);
      expect(s.neverDark).toBe(dawn === null);
      expect(s.polarDay || s.darkAll).toBe(false);
    });
  }
  it('says the times to the minute the calculator rounds them to (Bangkok, 2026-10-15)', () => {
    const [t0, t1] = day('2026-10-15', 7);
    expect(sunWords(sunTimes(sun, BANGKOK, t0, t1), fixed(7)))
      .toEqual(['Dark until 05:47', 'Sunrise 06:09', 'Sunset 17:59', 'Dark from 18:20']);
  });
});

describe('the polar day and the polar night, said in so many words', () => {
  it('midsummer at Svalbard: the Sun never sets, so the sky is never dark', () => {
    const [t0, t1] = day('2026-06-21', 2);
    const s = sunTimes(sun, SVALBARD, t0, t1);
    expect(s).toMatchObject({ rise: [], set: [], dawn: [], dusk: [], polarDay: true, polarNight: false, darkAll: false, neverDark: true });
    expect(sunWords(s, fixed(2))).toEqual([SUN_UP_ALL_DAY]);
  });
  it('midwinter at Svalbard: the Sun never rises, and never comes within 6 deg of the horizon either', () => {
    const [t0, t1] = day('2026-12-21', 1);
    const s = sunTimes(sun, SVALBARD, t0, t1);
    expect(s).toMatchObject({ rise: [], set: [], dawn: [], dusk: [], polarDay: false, polarNight: true, darkAll: true, neverDark: false });
    expect(sunWords(s, fixed(1))).toEqual([DARK_ALL_DAY]);
  });
  it('early November at Svalbard: the Sun stays down, and the sky lightens for a few hours about noon', () => {
    const [t0, t1] = day('2026-11-05', 1);
    expect(sunWords(sunTimes(sun, SVALBARD, t0, t1), fixed(1))).toEqual([SUN_DOWN_ALL_DAY, 'Dark until 09:22', 'Dark from 14:00']);
  });
  it('mid-April at Svalbard: it sets near midnight and rises soon after, and the night is never dark', () => {
    const [t0, t1] = day('2026-04-15', 2);
    expect(sunWords(sunTimes(sun, SVALBARD, t0, t1), fixed(2))).toEqual(['Sunrise 02:45', 'Sunset 23:26', NEVER_DARK]);
  });
  it('the first night of the year at Svalbard (2026-08-25, UTC+2): it sets just after midnight, rises an hour later and sets again before the next', () => {
    const [t0, t1] = day('2026-08-25', 2);
    expect(sunWords(sunTimes(sun, SVALBARD, t0, t1), fixed(2))).toEqual(['Sunset 00:31', 'Sunrise 01:32', 'Sunset 23:57', NEVER_DARK]);
  });
});

/* The same Sun, read at every second of the day: every crossing the scan finds is there, to within two seconds, and there are
   no others. The days are the ones a coarse scan gets wrong if anything does: the first sunsets and the last sunrises at
   Svalbard, where the Sun grazes the horizon, a day of 25 minutes of Sun, and ordinary days at both sites. */
describe('every crossing, and no other: the scan against the Sun at every second', () => {
  const CASES: [string, { lat: number; lon: number }, string, number][] = [
    ['Svalbard', SVALBARD, '2026-08-25', 2], ['Svalbard', SVALBARD, '2026-04-17', 2], ['Svalbard', SVALBARD, '2026-04-18', 2],
    ['Svalbard', SVALBARD, '2026-10-26', 1], ['Svalbard', SVALBARD, '2026-02-15', 1], ['Bangkok', BANGKOK, '2026-10-15', 7]
  ];
  for (const [name, site, d, tz] of CASES) {
    it(name + ' ' + d, () => {
      const [t0, t1] = day(d, tz);
      const sides = sunEvents(sun, site, t0, t1);
      expect(sides.map(s => s.h0)).toEqual([RISE_SET_DEG, CIVIL_DEG]);
      for (const side of sides) {
        const brute: { ms: number; up: boolean }[] = [];
        let was = sun.sunElevation(site, new Date(t0)) >= side.h0;
        expect(side.above).toBe(was);
        for (let t = t0 + 1000; t <= t1; t += 1000) {
          const now = sun.sunElevation(site, new Date(t)) >= side.h0;
          if (now !== was) brute.push({ ms: t, up: now });
          was = now;
        }
        expect(side.crossings.map(x => x.up)).toEqual(brute.map(x => x.up));
        side.crossings.forEach((x, i) => expect(Math.abs(x.ms - brute[i]!.ms)).toBeLessThanOrEqual(2000));
      }
    });
  }
});

describe('the scan', () => {
  /* A Sun that comes above the threshold for four minutes at the top of a 20 deg daily swing, between two of the scan's
     samples, which both see it below: only the turning point finds it. The swing is a sine of a day, as the real one is. */
  it('finds a Sun that grazes a threshold between two samples', () => {
    const t0 = Date.UTC(2026, 0, 1), top = t0 + 5 * 3600000 + SCAN_MS / 2, A = 20, eps = 0.00076, W = 2 * Math.PI / 86400000;
    const fake = { sunElevation: (_s: unknown, d: Date) => RISE_SET_DEG + eps - A * (1 - Math.cos(W * (d.getTime() - top))) };
    expect(fake.sunElevation(null, new Date(top - SCAN_MS / 2))).toBeLessThan(RISE_SET_DEG);
    expect(fake.sunElevation(null, new Date(top + SCAN_MS / 2))).toBeLessThan(RISE_SET_DEG);
    const [s] = sunEvents(fake, BANGKOK, t0, t0 + 86400000, [RISE_SET_DEG]);
    const half = Math.acos(1 - eps / A) / W;       // when it crosses, either side of the top
    expect(half).toBeGreaterThan(100_000);
    expect(half).toBeLessThan(150_000);
    expect(s!.above).toBe(false);
    expect(s!.crossings.map(x => x.up)).toEqual([true, false]);
    expect(Math.abs(s!.crossings[0]!.ms - (top - half))).toBeLessThanOrEqual(1000);
    expect(Math.abs(s!.crossings[1]!.ms - (top + half))).toBeLessThanOrEqual(1000);
  });
  it('costs a few hundred elevations a day, and only asks inside the span and one step either side of it', () => {
    let n = 0, lo = Infinity, hi = -Infinity;
    const counting = { sunElevation: (s: { lat: number; lon: number }, d: Date) => { n++; lo = Math.min(lo, d.getTime()); hi = Math.max(hi, d.getTime()); return sun.sunElevation(s, d); } };
    const [t0, t1] = day('2026-10-15', 7);
    sunTimes(counting, BANGKOK, t0, t1);
    expect(n).toBeLessThan(400);
    expect(lo).toBeGreaterThanOrEqual(t0 - SCAN_MS);
    expect(hi).toBeLessThanOrEqual(t1 + SCAN_MS);
  });
  it('puts the dark sky where the optics put it: the Sun 6 deg below the horizon, to the second', () => {
    const [t0, t1] = day('2026-10-15', 7);
    const s = sunTimes(sun, BANGKOK, t0, t1);
    const el = (ms: number) => sun.sunElevation(BANGKOK, new Date(ms));
    expect(el(s.dusk[0]! - 1000)).toBeGreaterThanOrEqual(CIVIL_DEG);
    expect(el(s.dusk[0]! + 1000)).toBeLessThan(CIVIL_DEG);
    expect(el(s.dawn[0]! - 1000)).toBeLessThan(CIVIL_DEG);
    expect(el(s.dawn[0]! + 1000)).toBeGreaterThanOrEqual(CIVIL_DEG);
  });
});

describe('the observer\'s days', () => {
  it('runs from the site\'s midnight to the next, at a fixed offset', () => {
    const c = siteClock(BANGKOK);
    expect(localDay(Date.parse('2026-10-15T16:59:59Z'), c)).toEqual({ key: '2026-10-15', t0: Date.parse('2026-10-14T17:00:00Z'), t1: Date.parse('2026-10-15T17:00:00Z') });
    expect(localDay(Date.parse('2026-10-15T17:00:00Z'), c).key).toBe('2026-10-16');
    expect(localDay(Date.parse('2026-10-15T10:00:00Z'), siteClock({ tz: -3.5, zone: null })).t0).toBe(Date.parse('2026-10-15T03:30:00Z'));
  });
  it('is 23 or 25 hours long across a summer-time change, midnight to midnight on the site\'s clock', () => {
    const c = siteClock({ tz: 0, zone: 'Europe/London' });
    const spring = localDay(Date.parse('2026-03-29T12:00:00Z'), c), autumn = localDay(Date.parse('2026-10-25T12:00:00Z'), c);
    expect(spring).toEqual({ key: '2026-03-29', t0: Date.parse('2026-03-29T00:00:00Z'), t1: Date.parse('2026-03-29T23:00:00Z') });
    expect(autumn).toEqual({ key: '2026-10-25', t0: Date.parse('2026-10-24T23:00:00Z'), t1: Date.parse('2026-10-26T00:00:00Z') });
  });
  it('groups a week of passes by the site\'s date of their AOS, in order, every pass once', () => {
    const { eng } = world();
    const D = eng.compute(byName('ISS (ZARYA)'), Date.parse('2026-09-12T07:29:09.993Z'), 168);
    const c = siteClock(BANGKOK), days = passDays(D.passes, c);
    expect(days.length).toBeGreaterThanOrEqual(7);
    expect(days.flatMap(d => d.i)).toEqual(D.passes.map((_, i) => i));
    for (const d of days) {
      expect(d.t1 - d.t0).toBe(86400000);
      for (const i of d.i) {
        const p = D.passes[i]!;
        expect(p.t0ms).toBeGreaterThanOrEqual(d.t0);
        expect(p.t0ms).toBeLessThan(d.t1);
        expect(localDay(p.t0ms, c).key).toBe(d.key);
      }
    }
    expect(new Set(days.map(d => d.key)).size).toBe(days.length);
    expect(passDays([], c)).toEqual([]);
  });
});

describe('the words', () => {
  it('names a day the way the header does', () => {
    expect(dayName('2026-10-15')).toBe('Thu 15 Oct');
    expect(dayName('2027-01-03')).toBe('Sun 3 Jan');
  });
  it('gives the site\'s time to the nearest minute', () => {
    expect(hhmm(Date.parse('2026-10-14T23:08:29Z'), fixed(7))).toBe('06:08');
    expect(hhmm(Date.parse('2026-10-14T23:08:30Z'), fixed(7))).toBe('06:09');
    expect(hhmm(Date.parse('2026-10-15T10:00:00Z'), fixed(-3.5))).toBe('06:30');
  });
  it('heads a day with its date, whose date it is, and the Sun\'s line, broken only between phrases', () => {
    const c = fixed(7), d = localDay(Date.parse('2026-10-15T05:00:00Z'), c);
    const h = dayHead(d, c, sun, BANGKOK);
    expect(plain(h)).toBe('Thu 15 Oct local date, UTC+7\nDark\u00a0until\u00a005:47 · Sunrise\u00a006:09 · Sunset\u00a017:59 · Dark\u00a0from\u00a018:20');
  });
  it('says what the grey and the ringed rows mean, and that the clock is not now when it is not', () => {
    const now = Date.parse('2026-10-15T05:00:00Z');
    expect(flownNote(0, -1, now, now)).toBe('');
    expect(flownNote(3, -1, now, now)).toBe('Grey: already flown.');
    expect(flownNote(3, 3, now + 4000, now)).toBe('Grey: already flown. Ringed: in view now.');
    expect(flownNote(0, 0, now, now)).toBe('Ringed: in view now.');
    expect(flownNote(3, 3, now + 6000, now)).toBe('Grey: flown before the clock\'s instant. Ringed: in view at the clock\'s instant. The clock is on sim time, not now.');
    expect(flownNote(2, -1, now - 86400000, now)).toBe('Grey: flown before the clock\'s instant. The clock is on sim time, not now.');
    expect(flownNote(0, -1, now - 86400000, now)).toBe('');
  });
});
