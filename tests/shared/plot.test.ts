import { describe, expect, it } from 'vitest';
import { SMA_MAX, SMA_MIN, parsePlot, readPlot } from '../../shared/plot.js';
import { Lifetime } from '../../src/lib/planner/lifetime';
import { EMPTY_PLOT, falling, plotPage, type PlotRowSpec } from '../server/helpers/tle.js';

const NOW = Date.UTC(2026, 8, 13);
const DAY = 86400000;
const row = (t: number, sma: number, ecc: number | null = 0.0008): PlotRowSpec => ({ t, sma, ecc });

describe('shared/plot.ts - the one reader of CelesTrak\'s history page', () => {
  it('is the very function the decay module exposes: the server and the browser share one implementation', () => {
    expect(Lifetime.readPlot).toBe(readPlot);
    expect(Lifetime.parsePlot).toBe(parsePlot);
    expect(Lifetime.SMA_MIN).toBe(SMA_MIN);
    expect(Lifetime.SMA_MAX).toBe(SMA_MAX);
    expect([SMA_MIN, SMA_MAX]).toEqual([80, 400000]);
  });

  it('reads a page into rows of epoch (ms), mean altitude and eccentricity, in time order', () => {
    const rows = falling(NOW, 0.0008, 2, 420, 359);
    const got = readPlot(plotPage(rows));
    expect(got.found).toBe(true);
    expect(got.rows).toBe(221);
    expect(got.P).toHaveLength(221);
    expect(got.P![0]!.t).toBe(rows[0]!.t);                    // 'Z' is appended to the page's own UTC stamps
    expect(got.P![0]!.sma).toBe(rows[0]!.sma);
    expect(got.P![220]!.ecc).toBe(0.0008);
    for (let i = 1; i < got.P!.length; i++) expect(got.P![i]!.t).toBeGreaterThan(got.P![i - 1]!.t);
  });

  it('sorts rows that arrive out of order', () => {
    const rows = [row(NOW - DAY, 400), row(NOW - 3 * DAY, 401), row(NOW - 2 * DAY, 402)];
    expect(parsePlot(plotPage(rows))!.map(r => r.sma)).toEqual([401, 402, 400]);
  });

  it('keeps a mean altitude strictly between 80 and 400,000 km: the edges and beyond are thrown out, and counted', () => {
    const rows = [row(NOW - 6 * DAY, 80), row(NOW - 5 * DAY, 80.0001), row(NOW - 4 * DAY, 399999.9), row(NOW - 3 * DAY, 400000),
      row(NOW - 2 * DAY, 79.9), row(NOW - 1 * DAY, 0), row(NOW, -5)];
    const got = readPlot(plotPage(rows));
    expect(got.P!.map(r => r.sma)).toEqual([80.0001, 399999.9]);
    expect(got.rows).toBe(7);                                  // every row there was, before the bounds
  });

  it('reads a high eccentric orbit whole: XMM-NEWTON\'s 60,555 km is not "no history" (the old ceiling was 60,000)', () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(NOW - (200 - i) * DAY, 60555 + 6 * Math.sin(i / 3), 0.465));
    const got = readPlot(plotPage(rows));
    expect(got.P).toHaveLength(200);
    expect(got.rows).toBe(200);
  });

  it('tells the three ways of having no rows apart: no plotData at all, a header with no rows, rows all outside', () => {
    expect(readPlot('<html>down for maintenance</html>')).toEqual({ P: null, rows: 0, found: false });
    expect(readPlot('')).toEqual({ P: null, rows: 0, found: false });
    expect(readPlot(EMPTY_PLOT)).toEqual({ P: null, rows: 0, found: true });
    expect(readPlot(plotPage([row(NOW - DAY, 50, 0), row(NOW, 40, 0)]))).toEqual({ P: null, rows: 2, found: true });
  });

  it('skips a row with fewer than six fields, and does not count it', () => {
    const page = 'var plotData = "Date,RAAN,Inclination,Arg of Perigee,SMA,Eccentricity|2026-09-01T00:00:00,0,0,0,400|2026-09-02T00:00:00,0,0,0,401,0.001|short|"';
    const got = readPlot(page);
    expect(got.rows).toBe(1);
    expect(got.P).toEqual([{ t: Date.parse('2026-09-02T00:00:00Z'), sma: 401, ecc: 0.001 }]);
  });

  it('counts a row with an unreadable date or altitude (six fields, nothing usable) and drops it', () => {
    const page = 'var plotData = "H|not a date,0,0,0,400,0.001|2026-09-02T00:00:00,0,0,0,abc,0.001|2026-09-03T00:00:00,0,0,0,402,0.001"';
    const got = readPlot(page);
    expect(got.rows).toBe(3);
    expect(got.P!.map(r => r.sma)).toEqual([402]);
  });

  it('gives a row with no eccentricity a NaN one - a number, as it always did (it becomes null only on the wire)', () => {
    const got = parsePlot(plotPage([row(NOW - DAY, 400, null), row(NOW, 401, 0.002)]))!;
    expect(Number.isNaN(got[0]!.ecc)).toBe(true);
    expect(got[1]!.ecc).toBe(0.002);
  });

  it('reads only the first plotData string, and only up to its closing quote', () => {
    const page = 'var plotData = "H|2026-09-01T00:00:00,0,0,0,400,0.001"; var other = "2026-09-02T00:00:00,0,0,0,999,0.5"; var plotData = "H|x"';
    expect(parsePlot(page)).toEqual([{ t: Date.parse('2026-09-01T00:00:00Z'), sma: 400, ecc: 0.001 }]);
  });

  it('parsePlot is readPlot().P', () => {
    const page = plotPage(falling(NOW, 0.0008, 2, 420, 359));
    expect(parsePlot(page)).toEqual(readPlot(page).P);
    expect(parsePlot('nothing')).toBeNull();
  });

  it('is pure: the same page twice is the same answer, and nothing is shared between calls', () => {
    const page = plotPage(falling(NOW, 0.0008, 2, 420, 359));
    const a = readPlot(page), b = readPlot(page);
    expect(a).toEqual(b);
    expect(a.P).not.toBe(b.P);
  });
});
