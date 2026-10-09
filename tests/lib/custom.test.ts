import * as satellite from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { Planner } from '../../src/lib/planner/planner';
import {
  allocCid, customFail, customSatnum, deepStart, isCustom, makeCustom, mergeStore, mkRefusal, offMsg, readStore, sgp4Refusal, storedRecord,
  uniqueName, type CustomEntry, type PlannerCore
} from '../../src/lib/planner/custom';

/* The pure half of the reader's own orbits: what an entry is, what is stored and what comes back, which names and ids are free, and the
   words said when it cannot be made. (The list and the screen are state/custom.svelte.ts, driven by verification/verify-custom.js.) */
const P = Planner as unknown as PlannerCore;
const sat = satellite as never;
const SITE = { lat: 13.7563, lon: 100.5018, altKm: 0.002, name: 'Bangkok', tz: 7 };
const EPOCH = Date.UTC(2026, 9, 1, 12);

function elements(over: Record<string, unknown> = {}) {
  const f = Object.assign({}, Planner.defaultForm(SITE, EPOCH), over);
  const r = Planner.fromForm(f) as { ok: boolean; el: Record<string, unknown> };
  expect(r.ok).toBe(true);
  const v = Planner.validate(r.el) as { ok: boolean; el: never };
  expect(v.ok).toBe(true);
  return v.el;
}
const rec = (n: number, name = 'My orbit', over: Record<string, unknown> = {}) => ({ id: 'c' + n, name, el: elements(over), made: 1700000000000 });

describe('the entry', () => {
  it('is a catalogue-shaped record with a placeholder number that no real number can equal', () => {
    const m = makeCustom(P, sat, rec(3));
    const e = m.entry as CustomEntry;
    expect(e).toBeTruthy();
    expect(e.custom).toBe(true);
    expect(e.cid).toBe('c3');
    expect(e.satnum).toBe('O0003');
    expect(customSatnum(12)).toBe('O0012');
    expect(e.l1).toHaveLength(69);
    expect(e.l2).toHaveLength(69);
    expect(e.l1.substring(2, 7).trim()).toBe('O0003');
    expect(isCustom(e)).toBe(true);
    expect(isCustom({ ...e, custom: false })).toBe(false);
    expect(isCustom(null)).toBe(false);
  });

  it('keeps a claimed magnitude and downlink only inside their ranges', () => {
    expect(makeCustom(P, sat, { ...rec(1), stdMag: 3.5, dlHz: 437.8e6 }).entry).toMatchObject({ stdMag: 3.5, dlHz: 437.8e6 });
    const out = makeCustom(P, sat, { ...rec(1), stdMag: 99, dlHz: 5 }).entry as CustomEntry;
    expect('stdMag' in out).toBe(false);
    expect('dlHz' in out).toBe(false);
    const nan = makeCustom(P, sat, { ...rec(1), stdMag: NaN, dlHz: '437' }).entry as CustomEntry;
    expect('stdMag' in nan).toBe(false);
    expect('dlHz' in nan).toBe(false);
  });

  it('is refused when SGP4 cannot start from the lines; and a planner that throws is a fault, not a refusal', () => {
    const bad = { ...rec(1), el: { ...rec(1).el, e: 0.99999 } } as never;
    const m = makeCustom(P, sat, bad);
    expect(m.entry).toBeNull();
    expect(m.fault).toBe(false);
    const boom = { ...P, toTLE: () => { throw new Error('boom'); } } as PlannerCore;
    const quiet = console.error;
    console.error = () => {};
    try {
      const f = makeCustom(boom, sat, rec(1));
      expect(f.entry).toBeNull();
      expect(f.fault).toBe(true);
    } finally { console.error = quiet; }
  });
});

describe('names, ids and the window', () => {
  it('keeps names unique among the reader\'s own, case-insensitively, within the length limit', () => {
    const mine = [{ name: 'Alpha' }, { name: 'alpha (2)' }];
    expect(uniqueName(P, [], 'Alpha')).toBe('Alpha');
    expect(uniqueName(P, mine, 'ALPHA')).toBe('ALPHA (3)');
    const long = 'x'.repeat(P.LIMITS.nameMax);
    const t = uniqueName(P, [{ name: long }], long);
    expect(Array.from(t).length).toBeLessThanOrEqual(P.LIMITS.nameMax);
    expect(t.endsWith(' (2)')).toBe(true);
  });

  it('hands out the id asked for when it is well formed and free, else the first free from the counter', () => {
    const used = new Set(['c1', 'c2']);
    expect(allocCid(used, 'c7', 3)).toBe('c7');
    expect(allocCid(used, 'c2', 1)).toBe('c3');
    expect(allocCid(used, 'x9', 1)).toBe('c3');
    expect(allocCid(used, 'c0', 1)).toBe('c3');
    expect(allocCid(used, undefined, 0)).toBe('c3');
    expect(allocCid(new Set(Array.from({ length: 9999 }, (_, i) => 'c' + (i + 1))), undefined, 1)).toBeNull();
  });

  it('moves the window to the epoch of a deep-space orbit that is far from it, and only that', () => {
    const geo = makeCustom(P, sat, rec(1, 'Geo', { shape: 'ae', a: '42164', e: '0.0001', inc: '0.05' })).entry as CustomEntry;
    const leo = makeCustom(P, sat, rec(2)).entry as CustomEntry;
    const day = 864e5;
    expect(geo).toBeTruthy();
    expect(deepStart(P, geo, EPOCH + 2 * day, EPOCH)).toBeNull();                   // within ten days of the epoch
    expect(deepStart(P, geo, EPOCH + 30 * day, EPOCH)).toBe(geo.el!.epoch);
    expect(deepStart(P, geo, null, EPOCH + 40 * day)).toBe(geo.el!.epoch);          // no window yet: now
    expect(deepStart(P, leo, EPOCH + 300 * day, EPOCH)).toBeNull();
    expect(deepStart(P, { name: 'x', l1: '', l2: '', satnum: '1' }, EPOCH, EPOCH)).toBeNull();
  });
});

describe('what is stored', () => {
  const entries = () => [makeCustom(P, sat, rec(1, 'One')).entry, makeCustom(P, sat, rec(2, 'Two')).entry] as CustomEntry[];

  it('is the planner\'s inputs and nothing derived: no lines, no flag, no number', () => {
    const raw = storedRecord(P, entries(), 3)!;
    const j = JSON.parse(raw);
    expect(Object.keys(j)).toEqual(['v', 'next', 'items']);
    expect(j.v).toBe(P.SCHEMA);
    expect(j.next).toBe(3);
    expect(Object.keys(j.items[0]).sort()).toEqual(['el', 'id', 'made', 'name']);
    expect(raw).not.toMatch(/O000|custom|l1|l2/);
  });

  it('keeps the counter for an empty list once an orbit has been made, and removes the key before that', () => {
    expect(storedRecord(P, [], 1)).toBeNull();
    expect(storedRecord(P, [], 4)).toBe('{"v":1,"next":4,"items":[]}');
    const hook = { name: 'h', l1: '', l2: '', satnum: '25544', custom: true, cid: 'c1', el: null, made: 1 } as CustomEntry;
    expect(storedRecord(P, [hook], 2)).toBe('{"v":1,"next":2,"items":[]}');           // the test hook's entry has no elements to store
  });

  it('reads back what it wrote, rebuilding the lines', () => {
    const before = entries();
    const got = readStore(P, sat, storedRecord(P, before, 3));
    expect(got.why).toBeNull();
    expect(got.next).toBe(3);
    expect(got.bad).toBe(0);
    expect(got.entries.map(e => [e.cid, e.name, e.l1, e.l2])).toEqual(before.map(e => [e.cid, e.name, e.l1, e.l2]));
  });

  it('refuses a record of another version or one that is not ours, and says why', () => {
    expect(readStore(P, sat, '{"v":2,"next":1,"items":[]}').why).toBe('version');
    expect(readStore(P, sat, 'not json').why).toBe('unreadable');
    expect(readStore(P, sat, 'x'.repeat(70000)).why).toBe('too-large');
    expect(readStore(P, sat, null)).toMatchObject({ why: null, entries: [], bad: 0 });
  });

  it('counts a stored record that no longer passes as refused, and keeps the rest', () => {
    const j = JSON.parse(storedRecord(P, entries(), 3)!);
    j.items[1].el.e = 5;
    const got = readStore(P, sat, JSON.stringify(j));
    expect(got.entries.map(e => e.cid)).toEqual(['c1']);
    expect(got.bad).toBe(1);
  });

  it('merges what another tab added, never removing, never over the cap, never twice', () => {
    const have = [entries()[0]!];
    const m = mergeStore(P, sat, storedRecord(P, entries(), 3), have, 2)!;
    expect(m.added.map(e => e.cid)).toEqual(['c2']);
    expect(m.next).toBe(3);
    expect(mergeStore(P, sat, '{"v":9}', have, 2)).toBeNull();
    expect(mergeStore(P, sat, null, have, 5)).toEqual({ added: [], next: 5 });        // the key was removed elsewhere: nothing is taken away here
    const full = Array.from({ length: P.LIMITS.maxCustom }, (_, i) => ({ ...have[0]!, cid: 'c' + (i + 5) }));
    expect(mergeStore(P, sat, storedRecord(P, entries(), 3), full, 1)!.added).toEqual([]);
  });
});

describe('what is said when it cannot be done', () => {
  it('has one shape of refusal', () => {
    expect(customFail('err.name.empty', 'Give the orbit a name.', null, 'name')).toEqual({ ok: false, errors: [{ field: 'name', code: 'err.name.empty', msg: 'Give the orbit a name.' }] });
    expect(customFail('err.cap', 'x', { cap: 12 }).errors[0]).toMatchObject({ field: '', cap: 12 });
    expect(offMsg(true)).toMatch(/assignment snapshot/);
    expect(offMsg(false)).toMatch(/not available/);
  });
  it('carries the number SGP4 gave', () => {
    expect(sgp4Refusal('Orb', 6, 'error 6: decayed')).toEqual({ field: '', code: 'err.sgp4', sgp4: 6, msg: 'Orb cannot be propagated anywhere in this window (error 6: decayed).' });
    expect(sgp4Refusal('Orb', null, 'why').sgp4).toBe(0);
    expect(mkRefusal(null)).toMatchObject({ code: 'err.sgp4', sgp4: 0, msg: 'SGP4 cannot start from those elements.' });
    const why = { field: '', code: 'err.sgp4', sgp4: 1, msg: 'm' };
    expect(mkRefusal(why)).toBe(why);
  });
});
