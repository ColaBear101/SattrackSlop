import { describe, expect, it } from 'vitest';
import raw from '../../data/transmitters.json';
import { makeTransmitters, type TransmitterData } from '../../src/lib/data/transmitters';
import { fromSiteInput, offsetAt, toSite, toSiteInput, tzAt, tzLabelAt, zoneKnown } from '../../src/lib/places';
import { txFor, dopRows, opticalRows } from '../../src/lib/analysis/doppler';
import { CATALOGUE, byName, world } from './helpers';

/* The observer's offset is not one number (summer time, a zone that is not longitude / 15), and the table of downlinks
   was keyed by a number that the page asked for by its zero-padded text. */
describe('the transmitter table', () => {
  const table = makeTransmitters(raw as unknown as TransmitterData);

  it('finds a downlink by the number however it is spelt (the old page asked for "01804" in a table keyed 1804)', () => {
    expect(table.forSat(1804).length).toBe(1);
    expect(table.forSat('1804')).toEqual(table.forSat('01804'));
    expect(table.forSat('01804')[0]).toMatchObject({ hz: 136981000, mode: 'USB' });
    expect(table.has('01804')).toBe(true);
    expect(table.primary('01804')?.hz).toBe(136981000);
  });
  it('is empty, never null, for an object with no published downlink or a junk id', () => {
    expect(table.forSat('99999')).toEqual([]);
    expect(table.forSat('')).toEqual([]);
    expect(table.forSat('constructor')).toEqual([]);        // not the table's own prototype
    expect(table.primary('99999')).toBeNull();
  });
  it('every catalogue entry whose number is in the table is found by the spelling the catalogue uses', () => {
    const inTable = new Set(Object.keys(raw.tx));
    let found = 0, lowNumbered = 0;
    for (const c of CATALOGUE) {
      const want = inTable.has(String(Number(c.satnum)));
      expect(table.forSat(c.satnum).length > 0).toBe(want);
      if (want) { found++; if (Number(c.satnum) < 10000) lowNumbered++; }
    }
    expect(found).toBeGreaterThan(1000);
    expect(lowNumbered).toBeGreaterThan(0);        // the objects the old lookup lost
  });
  it('a planned orbit is never looked up: its own downlink or none', () => {
    expect(txFor({ satnum: '98247', custom: true }, table)).toEqual([]);
    expect(txFor({ satnum: '98247', custom: true, dlHz: 437_000_000 }, table)).toEqual([{ hz: 437_000_000, mode: 'user', baud: 0, desc: 'entered in the planner', service: '' }]);
    expect(txFor({ satnum: '98247' }, table).length).toBe(1);
    expect(txFor({ satnum: '1804' }, null)).toEqual([]);
  });
});

describe('time zones', () => {
  it('reads the offset by formatting the instant in the zone, so summer time follows the date', () => {
    expect(offsetAt('Europe/London', Date.UTC(2026, 0, 15, 12))).toBe(0);
    expect(offsetAt('Europe/London', Date.UTC(2026, 6, 15, 12))).toBe(1);
    expect(offsetAt('Asia/Kolkata', Date.UTC(2026, 0, 15))).toBe(5.5);
    expect(offsetAt('Asia/Kathmandu', Date.UTC(2026, 0, 15))).toBe(5.75);
    expect(offsetAt('Nowhere/Land', 0)).toBeNull();
    expect(offsetAt(null, 0)).toBeNull();
  });
  it('knows a zone only if this engine resolves it', () => {
    expect(zoneKnown('Asia/Tokyo')).toBe(true);
    expect(zoneKnown('Europe/London')).toBe(true);
    expect(zoneKnown('Nowhere/Land')).toBe(false);
    expect(zoneKnown(null)).toBe(false);
  });
  it('tzAt prefers the zone to the typed number, and the label goes with the instant', () => {
    const london = { tz: 0, zone: 'Europe/London' };
    const jul = Date.UTC(2026, 6, 1), jan = Date.UTC(2026, 0, 1);
    expect(tzAt(london, jul)).toBe(1); expect(tzAt(london, jan)).toBe(0);
    expect(tzLabelAt(london, jul)).toBe('UTC+1'); expect(tzLabelAt(london, jan)).toBe('UTC+0');
    expect(tzAt({ tz: 7, zone: null }, jul)).toBe(7);
    expect(tzAt({ tz: 5.5 }, jul)).toBe(5.5);
    expect(tzLabelAt({ tz: -3.5 }, jul)).toBe('UTC−3.5');
  });
  it('the window start is typed and shown in the observer\'s time, and round-trips on both sides of a clock change', () => {
    const london = { tz: 0, zone: 'Europe/London' };
    // 2026-03-29 01:00Z is the spring change (00:59 is GMT, 02:00 is BST); 2026-10-25 01:00Z the autumn one. The hour that
    // happens twice in the autumn (01:00-02:00 local) cannot round-trip: a wall time there names two instants
    for (const ms of [Date.UTC(2026, 2, 29, 0, 30), Date.UTC(2026, 2, 29, 1, 30), Date.UTC(2026, 9, 24, 22, 30), Date.UTC(2026, 9, 25, 2, 30), Date.UTC(2026, 6, 1, 12)]) {
      const shown = toSiteInput(london, ms);
      expect(fromSiteInput(london, shown)).toBe(Math.floor(ms / 60000) * 60000);
    }
    expect(toSiteInput({ tz: 7 }, Date.UTC(2026, 8, 12, 7, 29))).toBe('2026-09-12T14:29');
    expect(fromSiteInput({ tz: 7 }, '2026-09-13T14:00')).toBe(Date.UTC(2026, 8, 13, 7, 0));
    expect(fromSiteInput({ tz: 7 }, '')).toBeNaN();
    expect(fromSiteInput({ tz: 7 }, 'junk')).toBeNaN();
  });
});

describe('a place from the geocoder', () => {
  it('is flattened to what the observer needs, naming the region only when it is not the place itself', () => {
    expect(toSite({ id: 1, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, elevation: 40, country: 'Japan', admin1: 'Tokyo', timezone: 'Asia/Tokyo' }))
      .toMatchObject({ name: 'Tokyo', where: 'Japan', lat: 35.6895, lon: 139.69171, altKm: 0.04, zone: 'Asia/Tokyo' });
    expect(toSite({ name: 'Springfield', latitude: '39.8', longitude: '-89.6', country: 'United States', admin1: 'Illinois' }))
      .toMatchObject({ where: 'Illinois, United States', lat: 39.8, lon: -89.6, altKm: 0, zone: null });
    expect(toSite({ name: 'x'.repeat(40), latitude: 0, longitude: 0 }).name).toHaveLength(24);
  });
});

describe('the pass rows beside the optical and Doppler facts', () => {
  const { eng, optics } = world();
  const D = eng.compute(byName('KNACKSAT-2'), Date.parse('2026-09-12T07:29:09.993Z'), 24);
  it('Doppler is three figures and a swing, with the true minus sign, or nothing without a downlink', () => {
    const p = D.passes[0]!;
    expect(dopRows(p, null, D.track, eng)).toEqual([]);
    const rows = dopRows(p, 437_000_000, D.track, eng);
    expect(rows.map(r => r[0])).toEqual(['Doppler', 'Swing']);
    expect(String(rows[0]![1])).toMatch(/^[+−]\d+\.\d\d → [+−]\d+\.\d\d → [+−]\d+\.\d\d kHz$/);
    expect(String(rows[1]![1])).toMatch(/^\d+\.\d\d kHz at 437\.000 MHz$/);
  });
  it('the naked-eye row is one of the four verdicts, and a pass with nothing lit says why it is radio only', () => {
    for (const p of D.passes) {
      const o = optics.passOptical(D.track, p)!;
      const rows = opticalRows(o, optics.NAKED_EYE_MAG);
      expect(String(rows[0]![1])).toMatch(/^(yes|penumbra only|too faint|radio only) — /);
      expect(rows[rows.length - 1]![0]).toBe('At mid-pass');
    }
  });
});
