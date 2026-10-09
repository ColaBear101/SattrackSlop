import { describe, expect, it } from 'vitest';
import { buildExports } from '../../src/lib/export';
import { BANGKOK, byName, world, MASK } from './helpers';

/* The files a reader takes away. The writers are the old page's, moved verbatim; what is checked here is what a
   spreadsheet and a calendar app will hold them to. */
const START = Date.parse('2026-09-12T07:29:09.993Z');
const STAMP = new Date(Date.UTC(2026, 8, 20, 6, 0, 0));

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  return rows;
}

function exportsFor(opts: { site?: typeof BANGKOK; name?: string; dopHz?: number | null; entry?: ReturnType<typeof byName> } = {}) {
  const site = opts.site ?? BANGKOK;
  const { eng, optics } = world(site);
  const entry = opts.entry ?? byName('KNACKSAT-2');
  const D = eng.compute(opts.name ? { ...entry, name: opts.name } : entry, START, 24);
  return { D, x: buildExports({ D, OBS: site, MASK, dopHz: opts.dopHz ?? null, eng, optics, sourceText: 'embedded', stampAt: STAMP }) };
}

describe('the CSV', () => {
  const { D, x } = exportsFor({ dopHz: 437_000_000 });
  const f = x.exportCSV();
  const rows = csvRows(f.text);

  it('is named for the spacecraft, the site and the date of the window', () => {
    expect(f.name).toBe('passes-knacksat-2-bangkok-2026-09-12.csv');
    expect(f.mime).toBe('text/csv');
    expect(f.hint).toBe(D.passes.length + ' pass' + (D.passes.length === 1 ? '' : 'es') + ' written as CSV');
  });
  it('has the 34 columns, in the order readers find them by name, provenance last', () => {
    expect(rows[0]).toEqual(['pass', 'satellite', 'norad', 'site', 'site_lat_deg', 'site_lon_deg', 'aos_utc', 'los_utc', 'duration_s',
      'max_elevation_deg', 'culmination_utc', 'max_azimuth_deg', 'aos_azimuth_deg', 'los_azimuth_deg', 'min_range_km',
      'range_rate_aos_kms', 'range_rate_los_kms', 'downlink_mhz', 'doppler_aos_khz', 'doppler_los_khz', 'naked_eye',
      'sun_elevation_deg', 'spacecraft', 'aos_clipped', 'los_clipped', 'est_magnitude', 'tle_epoch_utc', 'tle_line1', 'tle_line2',
      'tle_source', 'window_start_utc', 'window_span_h', 'mask_deg', 'site_alt_km']);
    expect(rows.length).toBe(D.passes.length + 1);
    for (const r of rows) expect(r).toHaveLength(34);
  });
  it('writes each pass at full precision, in machine time, with the window it was computed over on every row', () => {
    const h = rows[0]!, col = (r: string[], n: string) => r[h.indexOf(n)]!;
    D.passes.forEach((p, i) => {
      const r = rows[i + 1]!;
      expect(col(r, 'aos_utc')).toBe(p.aos.toISOString());
      expect(col(r, 'los_utc')).toBe(p.los.toISOString());
      expect(Number(col(r, 'max_elevation_deg'))).toBeCloseTo(p.maxEl, 3);
      expect(col(r, 'downlink_mhz')).toBe('437.000');
      expect(col(r, 'tle_epoch_utc')).toBe(D.E.epoch.toISOString());
      expect(col(r, 'tle_line1')).toBe(byName('KNACKSAT-2').l1);
      expect(col(r, 'tle_source')).toBe('embedded');
      expect(col(r, 'window_start_utc')).toBe(D.start.toISOString());
      expect(col(r, 'window_span_h')).toBe('24');
      expect(col(r, 'mask_deg')).toBe('5');
    });
  });
  it('leaves the Doppler columns empty without a downlink, rather than writing zeros', () => {
    const r = csvRows(exportsFor().x.exportCSV().text);
    const h = r[0]!;
    expect(r[1]![h.indexOf('downlink_mhz')]).toBe('');
    expect(r[1]![h.indexOf('doppler_aos_khz')]).toBe('');
  });
  it('quotes a field with a comma or a quote, so the columns do not shift', () => {
    const site = { ...BANGKOK, name: 'Bangkok, "KMUTNB" site' };
    const r = csvRows(exportsFor({ site }).x.exportCSV().text);
    expect(r.every(row => row.length === 34)).toBe(true);
    expect(r[1]![r[0]!.indexOf('site')]).toBe('Bangkok, "KMUTNB" site');
  });
});

describe('the calendar', () => {
  const sat = 'SAT — Ünïcode 🛰 with, a comma; and a semicolon';
  const { D, x } = exportsFor({ name: sat, site: { ...BANGKOK, name: 'Bangkok, Thailand' } });
  const f = x.exportICS();
  const lines = f.text.split('\r\n');

  it('uses CRLF throughout and ends with the calendar', () => {
    expect(f.text.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(f.text)).toBe(false);
    expect(f.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(f.text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(f.name).toBe('passes-sat-n-code-with-a-comma-and-a-semicolon-bangkok-thailand.ics');   // letters outside a-z slug away
  });
  it('folds no line past 75 octets, counting bytes not characters, and never inside a character', () => {
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const unfolded = f.text.replace(/\r\n[ \t]/g, '');
    expect(unfolded).toContain('🛰');                     // a surrogate pair survives a fold intact
    expect(unfolded).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it('escapes commas, semicolons and backslashes in text values, the site name included', () => {
    const unfolded = f.text.replace(/\r\n[ \t]/g, '');
    expect(unfolded).toContain('LOCATION:Bangkok\\, Thailand');
    expect(unfolded).toMatch(/SUMMARY:.*with\\, a comma\\; and a semicolon/);
    expect(unfolded).toContain('Site Bangkok\\, Thailand');
  });
  it('has one event per pass, with UTC stamps, a ten-minute alarm and a UID that is its own', () => {
    const unfolded = f.text.replace(/\r\n[ \t]/g, '');
    const events = unfolded.split('BEGIN:VEVENT').slice(1);
    expect(events).toHaveLength(D.passes.length);
    const uids = unfolded.match(/UID:\S+/g)!;
    expect(new Set(uids).size).toBe(D.passes.length);
    expect(unfolded.match(/TRIGGER:-PT10M/g)).toHaveLength(D.passes.length);
    expect(unfolded).toContain('DTSTAMP:20260920T060000Z');
    D.passes.forEach((p, i) => {
      expect(events[i]).toContain('DTSTART:' + p.aos.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
      expect(events[i]).toContain('DTEND:' + p.los.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
    });
  });
});

describe('a pass the window cuts', () => {
  it('says so in the CSV flags and, in words, in the calendar (a GEO is up the whole window)', () => {
    const { D, x } = exportsFor({ entry: byName('INTELSAT 36 (IS-36)') });
    expect(D.passes).toHaveLength(1);
    expect(D.passes[0]).toMatchObject({ clipA: true, clipL: true });
    const r = csvRows(x.exportCSV().text);
    expect(r[1]![r[0]!.indexOf('aos_clipped')]).toBe('true');
    expect(r[1]![r[0]!.indexOf('los_clipped')]).toBe('true');
    const ics = x.exportICS().text.replace(/\r\n[ \t]/g, '');
    expect(ics).toContain('X-GT-CLIPPED:AOS,LOS');
    expect(ics).toMatch(/SUMMARY:.*window-clipped/);
    expect(ics).not.toMatch(/AOS in 10 minutes/);
  });
});
