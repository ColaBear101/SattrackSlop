import * as satellite from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { buildExports } from '../../src/lib/export';
import { CUSTOM_SOURCE } from '../../src/lib/export/source';
import { Planner } from '../../src/lib/planner/planner';
import { makeCustom, readStore, storedRecord, type CustomEntry, type PlannerCore } from '../../src/lib/planner/custom';
import { outOfBrief } from '../../src/lib/text/notices';
import { BANGKOK, byName, MASK, world } from './helpers';

/* What the old page's verify-custom-mutants.js took away one guard at a time, for the parts of it that are pure functions: a custom
   orbit is judged by its FLAG and never by its number or its name, what it writes into the files a reader takes away says what it is,
   and a planner that throws is not taken for a bad record. (The same behaviours on the screen are verify-custom.js; the map from each
   mutant to the check or the test that now guards it is verification/behaviours-custom.json.) */
const P = Planner as unknown as PlannerCore;
const sat = satellite as never;
const START = Date.parse('2026-09-12T07:29:09.993Z');
const SITE = { lat: 13.7563, lon: 100.5018, altKm: 0.002, name: 'Bangkok', tz: 7 };

function made(id: string, name: string, over: Record<string, unknown> = {}): CustomEntry {
  const f = Object.assign({}, Planner.defaultForm(SITE, START), over);
  const r = Planner.fromForm(f) as { ok: boolean; el: Record<string, unknown> };
  const v = Planner.validate(r.el) as { ok: boolean; el: never };
  expect(v.ok).toBe(true);
  const m = makeCustom(P, sat, { id, name, el: v.el, made: 1 });
  expect(m.entry).toBeTruthy();
  return m.entry as CustomEntry;
}

describe('a custom orbit is told apart by its flag, never by its name or its number', () => {
  it('a custom orbit named like the default does not raise "Outside the brief"; the catalogue\'s own does', () => {
    expect(outOfBrief('KNACKSAT-2', false)).toBe(true);
    expect(outOfBrief('KNACKSAT-2 what-if', true)).toBe(false);
    expect(outOfBrief('KNACKSAT 2', true)).toBe(false);
    expect(outOfBrief('Polar 600', false)).toBe(false);
  });

  it('an orbit with the ISS\'s own lines (and its real number) is not "docked to" it: an assumed brightness, or the one the reader typed', () => {
    const { optics } = world();
    const iss = byName('ISS (ZARYA)');
    const known = optics.stdMagOf({ entry: iss } as never);
    expect(known.known).toBe(true);
    const hook = { ...iss, name: 'ISS what-if', custom: true, cid: 'c1', el: null, made: 1 };
    expect(optics.stdMagOf({ entry: hook } as never)).toEqual({ mag: optics.STD_MAG, known: false, via: null });
    expect(optics.stdMagOf({ entry: { ...hook, stdMag: 3.5 } } as never)).toEqual({ mag: 3.5, known: false, via: null });
  });
});

describe('what a custom orbit writes into an export', () => {
  const run = (entry: CustomEntry | ReturnType<typeof byName>, sourceText = CUSTOM_SOURCE) => {
    const { eng, optics } = world(BANGKOK);
    const D = eng.compute(entry, START, 24);
    return { D, x: buildExports({ D, OBS: BANGKOK, MASK, dopHz: null, eng, optics, sourceText, stampAt: new Date(Date.UTC(2026, 8, 20, 6)) }) };
  };
  const entry = made('c1', 'Polar 600');
  const { D, x } = run(entry);

  it('has a pass to write (so the checks below are not about an empty file)', () => {
    expect(D.passes.length).toBeGreaterThan(0);
  });
  it('the CSV names the orbit as custom, keeps the placeholder number, and says where the lines came from', () => {
    const f = x.exportCSV();
    const rows = f.text.trim().split(/\r?\n/), h = rows[0]!.split(','), c1 = rows[1]!.split(',');
    expect(c1[h.indexOf('satellite')]).toBe('Polar 600 (custom orbit)');
    expect(c1[h.indexOf('norad')]).toBe('O0001');
    expect(c1[h.indexOf('tle_source')]).toBe('custom orbit planned on this page from user-entered elements; not a catalogue object; nothing was fetched');
    expect(h.slice(-8)).toEqual(['tle_epoch_utc', 'tle_line1', 'tle_line2', 'tle_source', 'window_start_utc', 'window_span_h', 'mask_deg', 'site_alt_km']);
  });
  it('the calendar entry is marked hypothetical in its title and its description, and its UID is the placeholder', () => {
    const f = x.exportICS();
    const flat = f.text.replace(/\r\n /g, '');
    expect(flat).toMatch(/SUMMARY:\[custom orbit\] Polar 600/);
    expect(flat).toMatch(/Hypothetical orbit planned on the Ground Track Console/);
    expect(flat).toMatch(/UID:O0001-\d+@ground-track/);
    expect(f.text.split('\r\n').every(l => Buffer.byteLength(l) <= 75)).toBe(true);
  });
  it('the file names say "custom", and a name with no Latin letter or digit falls back to "orbit"', () => {
    expect(x.exportCSV().name).toBe('passes-custom-polar-600-bangkok-2026-09-12.csv');
    expect(x.exportICS().name).toBe('passes-custom-polar-600-bangkok.ics');
    const thai = run(made('c2', 'ดาวเทียม')).x;
    expect(thai.exportStem()).toBe('custom-orbit');
    expect(thai.exportCSV().name).toBe('passes-custom-orbit-bangkok-2026-09-12.csv');
    expect(thai.exportICS().name).toBe('passes-custom-orbit-bangkok.ics');
  });
  it('control: a catalogue spacecraft carries none of those marks', () => {
    const cat = run(byName('KNACKSAT-2'), 'embedded').x;
    const csv = cat.exportCSV(), ics = cat.exportICS().text.replace(/\r\n /g, '');
    expect(csv.name).toBe('passes-knacksat-2-bangkok-2026-09-12.csv');
    expect(csv.text).not.toMatch(/custom orbit/);
    expect(ics).not.toMatch(/\[custom orbit\]|Hypothetical orbit/);
  });
});

describe('a planner that faults while a stored record is rebuilt', () => {
  it('is reported as a fault, not counted as a bad record, so the saved list is not rewritten without the orbit it could not rebuild', () => {
    const raw = storedRecord(P, [made('c1', 'Kept')], 2)!;
    const boom = { ...P, toTLE: () => { throw new Error('planner fault (test)'); } } as PlannerCore;
    const quiet = console.error;
    console.error = () => {};
    try {
      const got = readStore(boom, sat, raw);
      expect(got).toMatchObject({ why: null, entries: [], bad: 1, fault: true });
    } finally { console.error = quiet; }
    // a record that is merely bad is not a fault: the page rewrites the list without it
    const j = JSON.parse(raw);
    j.items[0].el.e = 5;
    expect(readStore(P, sat, JSON.stringify(j))).toMatchObject({ entries: [], bad: 1, fault: false });
  });
});
