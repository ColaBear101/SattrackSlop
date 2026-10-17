import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import raw from '../../data/transponders.json';
import { CTCSS_HZ, makeTransponders, retrying, tableLoader, type TransponderData, type XpRecord } from '../../src/lib/data/transponders';
import { CATALOGUE } from './helpers';

/* The uplink and transponder table (CHANGES-FROM-LEGACY.md, L62): every active SatNOGS DB record of a catalogue object with both an
   uplink and a downlink in the amateur bands, a linear passband or a single-frequency pair, baked into data/transponders.json by
   verification/tools/fetch-transponders.js from the answer kept on 2026-10-17. The downlink table, data/transmitters.json, is not
   touched: #dopsel and the Doppler rows the golden capture reads come from it. */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);
type Rec = Record<string, unknown>;
interface Baked {
  x: Record<string, XpRecord[]>; objects: number; records: number;
  funnel: Record<string, number>; dropped: Record<string, string[]>; notes: Record<string, string[]>;
}
const baker = require('../../verification/tools/fetch-transponders.js') as {
  bake(list: Rec[], cat: Map<string, string>): Baked;
  render(built: string, b: Baked): string;
  toneOf(desc: string): number;
  CTCSS_HZ: number[]; DESC_MAX: number; SOURCE: string;
};

const D = raw as unknown as TransponderData;
const text = fs.readFileSync(path.join(ROOT, 'data', 'transponders.json'), 'utf8');
const all = Object.entries(D.x).flatMap(([k, l]) => l.map(t => [k, t] as const));
const linear = (t: XpRecord) => t[1] > t[0] && t[3] > t[2];
const MHz = (m: number) => Math.round(m * 1e6);
const unpad = (s: string) => s.replace(/^0+/, '');
/* the amateur service's allocations, any ITU region, MHz: the test's own copy, not the baker's */
const AMATEUR = [[7, 7.3], [14, 14.35], [18.068, 18.168], [21, 21.45], [24.89, 24.99], [28, 29.7], [50, 54], [144, 148], [220, 225],
  [420, 450], [902, 928], [1240, 1300], [2300, 2450], [3300, 3500], [5650, 5925], [10000, 10500], [24000, 24250], [47000, 47200]];
const band = (hz: number) => AMATEUR.findIndex(([lo, hi]) => hz >= MHz(lo!) && hz <= MHz(hi!));
const SIDEBAND = new Set(['USB', 'LSB']);

describe('data/transponders.json', () => {
  const byNum = new Map(CATALOGUE.map(c => [unpad(c.satnum), c]));

  it('says where it is from, when it was fetched and under which licence, and holds nothing else', () => {
    expect(Object.keys(raw)).toEqual(['built', 'source', 'licence', 'objects', 'records', 'x']);
    expect(D.built).toBe('2026-10-17T05:01:30.000Z');
    expect(D.source).toBe('SatNOGS DB — db.satnogs.org/api/transmitters/');
    expect(D.source).toBe(baker.SOURCE);
    expect(D.licence).toBe('CC BY-SA 4.0');
  });
  it('counts what it holds: 71 records on 47 objects, 17 of them linear passbands on 9', () => {
    expect(D.objects).toBe(Object.keys(D.x).length);
    expect(D.records).toBe(all.length);
    expect([D.objects, D.records]).toEqual([47, 71]);
    expect(all.filter(([, t]) => linear(t)).length).toBe(17);
    expect(new Set(all.filter(([, t]) => linear(t)).map(([k]) => k)).size).toBe(9);
  });
  it('is keyed by catalogue objects only, by NORAD number without leading zeros, in number order in the file itself', () => {
    const keys = Object.keys(D.x);
    for (const k of keys) {
      expect(k).toMatch(/^[1-9]\d*$/);
      expect(byNum.has(k)).toBe(true);
      expect(D.x[k]!.length).toBeGreaterThan(0);
    }
    /* read from the text: a parsed object lists integer-like keys in ascending order whatever order the file has them in */
    const written = [...text.matchAll(/"(\d+)":\[\[/g)].map(m => m[1]!);
    expect(written).toEqual(keys);
    expect(written).toEqual(written.slice().sort((a, b) => Number(a) - Number(b)));
    expect(text.endsWith('}}\n')).toBe(true);
    expect(text.split('\n').length).toBe(2);
  });
  it('holds records of one shape: integer hertz, a passband of equal widths or a single-frequency pair, and nothing else', () => {
    for (const [k, t] of all) {
      const at = k + ' ' + JSON.stringify(t);
      expect(t.length, at).toBe(9);
      for (const hz of t.slice(0, 4)) { expect(Number.isInteger(hz), at).toBe(true); expect(hz as number, at).toBeGreaterThan(0); }
      expect(t[1] >= t[0] && t[3] >= t[2], at).toBe(true);
      if (linear(t)) expect(t[1] - t[0], at).toBe(t[3] - t[2]);
      else { expect(t[1], at).toBe(t[0]); expect(t[3], at).toBe(t[2]); expect(t[4], at).toBe(0); }
      expect([0, 1], at).toContain(t[4]);
      expect(typeof t[5] === 'string' && typeof t[6] === 'string', at).toBe(true);
      expect(t[6] === '' || t[6] !== t[5], at).toBe(true);
      expect(t[8], at).toBe(t[8].replace(/\s+/g, ' ').trim());
      expect(t[8].length, at).toBeLessThanOrEqual(44);
    }
  });
  it('puts every edge in an amateur band, each leg inside one band', () => {
    for (const [k, t] of all) {
      const at = k + ' ' + JSON.stringify(t);
      expect(band(t[0]), at).toBeGreaterThanOrEqual(0);
      expect(band(t[1]), at).toBe(band(t[0]));
      expect(band(t[2]), at).toBeGreaterThanOrEqual(0);
      expect(band(t[3]), at).toBe(band(t[2]));
    }
  });
  it('gives a passband one invert flag: every record of an object on the same four edges agrees, and so do its sidebands', () => {
    for (const [k, l] of Object.entries(D.x)) {
      const flags = new Map<string, Set<number>>();
      for (const t of l.filter(linear)) {
        const e = t.slice(0, 4).join(',');
        flags.set(e, (flags.get(e) ?? new Set()).add(t[4]));
        /* USB in and LSB out (or the other way) is an inversion (upMode is written only when it differs from mode) */
        if (SIDEBAND.has(t[5]) && SIDEBAND.has(t[6])) expect(t[4], k + ' ' + JSON.stringify(t)).toBe(1);
      }
      for (const [e, s] of flags) expect(s.size, k + ' ' + e).toBe(1);
    }
    /* JO-97: SatNOGS files its CW record non-inverting beside its inverting SSB record on the one passband; the bake makes both
       inverting, so 435.105 MHz on board comes down on 145.870 MHz through either option, not 145.860 */
    expect(D.x['43803']).toEqual([
      [435100000, 435120000, 145855000, 145875000, 1, 'CW', '', 0, 'U/V CW Transponder'],
      [435100000, 435120000, 145855000, 145875000, 1, 'USB', 'LSB', 0, 'U/V SSB Transponder']
    ]);
  });
  it('names no FM mode for a linear passband (SatNOGS files QO-100\'s SSB-only and digimode segments as FM)', () => {
    for (const [k, t] of all) if (linear(t)) expect(/^FM/i.test(t[5]) || /^FM/i.test(t[6]), k + ' ' + JSON.stringify(t)).toBe(false);
    const qo = D.x['43700']!.filter(linear);
    expect(qo.map(t => t[5])).toEqual(['CW', '', '', '', '', '']);
    expect(qo.map(t => t[8])).toContain('SSB Only Transpoder');
  });
  it('keeps a tone only when the description names it and it is one of the 50 EIA/TIA-603 tones', () => {
    for (const [k, t] of all) {
      if (!t[7]) continue;
      expect(CTCSS_HZ, k).toContain(t[7]);
      expect(t[8], k).toMatch(/CTCSS|PL/i);
      expect(t[8], k).toContain(t[7].toFixed(1));
    }
    expect(all.filter(([, t]) => t[7]).map(([k, t]) => k + ':' + t[7])).toEqual(['25544:67', '27607:67', '40931:88.5', '40931:88.5', '44530:67', '67291:67']);
  });
  it('holds no duplicate, and lists each object\'s passbands first, then its pairs, each by uplink, then downlink, then mode', () => {
    for (const [k, l] of Object.entries(D.x)) {
      const seen = new Set(l.map(t => JSON.stringify(t.slice(0, 8))));
      expect(seen.size, k).toBe(l.length);
      const key = (t: XpRecord) => [linear(t) ? 0 : 1, t[0], t[2]];
      for (let i = 1; i < l.length; i++) {
        const [a, b] = [key(l[i - 1]!), key(l[i]!)];
        const c = a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || (l[i - 1]![5] < l[i]![5] ? -1 : l[i - 1]![5] > l[i]![5] ? 1 : 0);
        expect(c, k + ' at ' + i).toBeLessThanOrEqual(0);
      }
    }
  });
  it('has the linear transponders and repeaters a station works', () => {
    const lin = (k: string) => D.x[k]!.filter(linear);
    /* AO-7 (OSCAR 7): Mode A, CW and SSB on one non-inverting passband, and Mode B, inverting, its uplink at 432.125 MHz */
    expect(lin('7530').map(t => t.slice(0, 7))).toEqual([
      [145850000, 145950000, 29400000, 29500000, 0, 'CW', ''],
      [145850000, 145950000, 29400000, 29500000, 0, 'USB', ''],
      [432125000, 432175000, 145925000, 145975000, 1, 'USB', 'LSB']
    ]);
    /* FO-29 (JAS 2): V/U, inverting, LSB up and USB down */
    expect(D.x['24278']).toEqual([[145900000, 146000000, 435800000, 435900000, 1, 'USB', 'LSB', 0, 'Mode V/U Linear Transponder']]);
    /* RS-44, filed as its rocket stage (BREEZE-KM R/B), and AO-73 (FUNCUBE 1) */
    expect(lin('44909').map(t => t.slice(0, 5))).toEqual([[145935000, 145995000, 435610000, 435670000, 1]]);
    expect(lin('39444').map(t => t.slice(0, 5))).toEqual([[435130000, 435150000, 145950000, 145970000, 1]]);
    /* QO-100 (ES'HAIL 2): six segments, each moved by the same 8,089.5 MHz, and the emergency frequency as a pair inside the sixth
       (2400.350-2400.495 MHz, mixed modes) */
    const qo = D.x['43700']!;
    expect(qo.filter(linear).length).toBe(6);
    for (const t of qo.filter(linear)) { expect(t[2] - t[0]).toBe(8_089_500_000); expect(t[4]).toBe(0); }
    expect(qo.filter(t => !linear(t))).toEqual([[2400360000, 2400360000, 10489860000, 10489860000, 0, 'USB', '', 0, 'International Emergency Frequency']]);
    /* SO-50 (SAUDISAT 1C), CTCSS 67.0 Hz; AO-91 says it no longer wants one */
    expect(D.x['27607']).toEqual([[145850000, 145850000, 436795000, 436795000, 0, 'FM', '', 67, 'Mode V/U FM Voice CTCSS 67.0 Hz']]);
    expect(D.x['43017']!.map(t => t[7])).toEqual([0]);
    /* the ISS: the crew's two FM channels down on 145.800 MHz, which the downlink table's cap leaves out, and the voice repeater */
    const iss = D.x['25544']!.map(t => [t[0], t[2], t[5], t[7]]);
    expect(iss).toContainEqual([144490000, 145800000, 'FM', 0]);
    expect(iss).toContainEqual([145200000, 145800000, 'FM', 0]);
    expect(iss).toContainEqual([145990000, 437800000, 'FM', 67]);
    expect(D.x['25544']!.length).toBe(5);
  });
  it('leaves out what is not there to work: XW-2 and CAS-4 (not in the catalogue), XW-3\'s inactive transponder, KOSEN-1\'s HF range', () => {
    for (const k of ['40903', '40906', '40907', '40909', '40910', '40911', '42759', '42761']) {
      expect(byNum.has(k), k).toBe(false);
      expect(D.x[k], k).toBeUndefined();
    }
    expect(byNum.get('50466')).toBeDefined();
    expect(D.x['50466']).toBeUndefined();
    expect(D.x['49402']).toBeUndefined();
  });
  it('is small: a file the transponder panel fetches once, under 2 KB gzipped', () => {
    expect(Buffer.byteLength(text)).toBeLessThan(8_000);
    expect(zlib.gzipSync(text, { level: 9 }).length).toBeLessThan(2_000);
  });
});

describe('data/transmitters.json, the downlink table', () => {
  const file = fs.readFileSync(path.join(ROOT, 'data', 'transmitters.json'));
  const t = JSON.parse(file.toString('utf8')) as { objects: number; records: number; tx: Record<string, [number, string][]> };
  it('is not touched: the same bytes, so #dopsel and the Doppler rows the golden capture reads stay as they are', () => {
    expect(crypto.createHash('sha256').update(file).digest('hex')).toBe('b13300f07bf3fd57ea8d9fe9c3484afda9cad58860356df9b17d7f730d6104b2');
    expect([t.objects, t.records]).toEqual([1213, 2037]);
  });
  it('keeps its cap of four records an object, lowest first, which is why its ISS list has no 145.800 MHz', () => {
    for (const l of Object.values(t.tx)) {
      expect(l.length).toBeLessThanOrEqual(4);
      for (let i = 1; i < l.length; i++) expect(l[i]![0]).toBeGreaterThanOrEqual(l[i - 1]![0]);
    }
    expect(t.tx['25544']!.length).toBe(4);
    expect(t.tx['25544']!.map(r => r[0])).not.toContain(145800000);
  });
});

describe('the loader', () => {
  const T = makeTransponders(D);
  it('reads a record into named fields, keyed by the NORAD number however it is spelt', () => {
    expect(T.forSat('07530')).toEqual(T.forSat(7530));
    expect(T.forSat(' 7530 ')).toEqual(T.forSat('7530'));
    expect(T.forSat(24278)).toEqual([{
      ulLo: 145900000, ulHi: 146000000, dlLo: 435800000, dlHi: 435900000, inv: true, linear: true,
      mode: 'USB', upMode: 'LSB', tone: 0, desc: 'Mode V/U Linear Transponder'
    }]);
    expect(T.forSat(27607)[0]).toMatchObject({ linear: false, inv: false, mode: 'FM', upMode: '', tone: 67 });
    expect(T.has('07530') && T.has(25544)).toBe(true);
    expect([T.built, T.source, T.licence, T.objects, T.records]).toEqual([D.built, D.source, D.licence, 47, 71]);
  });
  it('finds nothing, and never throws, for what is not in the table: an unknown number, an orbit of the reader\'s own, an object\'s own keys', () => {
    for (const s of ['99999', 'O0001', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', '7530x', 0]) {
      expect(T.forSat(s), String(s)).toEqual([]);
      expect(T.has(s), String(s)).toBe(false);
    }
  });
  it('gives a fresh list each time, so a caller cannot change the table', () => {
    const a = T.forSat(24278);
    a[0]!.ulLo = 1;
    a.pop();
    expect(T.forSat(24278)[0]!.ulLo).toBe(145900000);
  });
  /* the page fetches the file (state/transponder.svelte.ts, L63) rather than importing it as a chunk: a browser keeps a failed import()
     for the life of the page, so Try again could not ask again */
  it('loads the baked table once from what it is handed, the file\'s JSON', async () => {
    let calls = 0;
    const load = tableLoader(async () => { calls++; return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'transponders.json'), 'utf8')); });
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toBe(b);
    expect(await load()).toBe(a);
    expect(calls).toBe(1);
    expect(a.forSat(43803)).toEqual(T.forSat(43803));
  });
  it('takes what is not the table\'s shape as a failure, and asks again after it', async () => {
    const answers: unknown[] = [null, '<!doctype html>', [], { x: [] }, { x: null }, { built: 'x' }];
    for (const bad of answers) await expect(tableLoader(async () => bad)(), JSON.stringify(bad)).rejects.toThrow('not the transponder table');
    let n = 0;
    const load = tableLoader(async () => (++n === 1 ? { x: null } : { built: 'b', source: 's', licence: 'l', objects: 0, records: 0, x: {} }));
    await expect(load()).rejects.toThrow();
    expect((await load()).built).toBe('b');
    expect(n).toBe(2);
  });
  it('asks again after a failure, and keeps what came', async () => {
    let calls = 0;
    const get = retrying(async () => { calls++; if (calls === 1) throw new Error('lost'); return { n: calls }; });
    const [p, q] = [get(), get()];
    expect(p).toBe(q);
    await expect(p).rejects.toThrow('lost');
    expect(calls).toBe(1);
    const r = await get();
    expect(r).toEqual({ n: 2 });
    expect(await get()).toBe(r);
    expect(calls).toBe(2);
  });
  it('has the 50 CTCSS tones of EIA/TIA-603, ascending, the same list as the baker\'s', () => {
    expect(CTCSS_HZ.length).toBe(50);
    expect(CTCSS_HZ[0]).toBe(67);
    expect(CTCSS_HZ[49]).toBe(254.1);
    for (let i = 1; i < 50; i++) expect(CTCSS_HZ[i]!).toBeGreaterThan(CTCSS_HZ[i - 1]!);
    expect([...CTCSS_HZ]).toEqual(baker.CTCSS_HZ);
    for (const hz of [88.5, 100, 159.8, 199.5, 206.5]) expect(CTCSS_HZ).toContain(hz);
  });
});

/* The baker's rules on records of the test's own, so a re-bake from a later SatNOGS answer is held to them as well. */
describe('the baker', () => {
  const cat = new Map([['99001', 'ONE'], ['99002', 'TWO'], ['99003', 'THREE'], ['7', 'SEVEN']]);
  const xp = (o: Rec): Rec => ({
    norad_cat_id: 99001, status: 'active', type: 'Transponder', description: 'Linear', mode: 'USB', uplink_mode: 'LSB', invert: true,
    uplink_low: 145900000, uplink_high: 146000000, downlink_low: 435800000, downlink_high: 435900000, ...o
  });
  const pair = (o: Rec): Rec => ({
    norad_cat_id: 99002, status: 'active', type: 'Transceiver', description: 'FM', mode: 'FM', uplink_mode: null, invert: false,
    uplink_low: 145850000, uplink_high: null, downlink_low: 436795000, downlink_high: null, ...o
  });

  it('keeps an inverting passband and a pair as the file holds them', () => {
    const b = baker.bake([xp({}), pair({ description: 'Mode V/U FM Voice CTCSS 67.0 Hz' })], cat);
    expect(b.x).toEqual({
      99001: [[145900000, 146000000, 435800000, 435900000, 1, 'USB', 'LSB', 0, 'Linear']],
      99002: [[145850000, 145850000, 436795000, 436795000, 0, 'FM', '', 67, 'Mode V/U FM Voice CTCSS 67.0 Hz']]
    });
    expect([b.objects, b.records]).toEqual([2, 2]);
  });
  it('drops what is not a catalogue object, not active, uplink-only, downlink-only, or out of the amateur bands', () => {
    const b = baker.bake([
      xp({ norad_cat_id: 12345 }), xp({ norad_cat_id: null }), xp({ status: 'inactive' }),
      pair({ downlink_low: null }), pair({ uplink_low: null }), pair({ uplink_low: 0 }),
      pair({ uplink_low: 157187500 }), pair({ downlink_low: 2210000000 }), pair({ uplink_low: 40000000000, downlink_low: 40000000000 }),
      xp({ uplink_low: 143900000 }),       // a leg across the edge of 144-148
      pair({ norad_cat_id: 99003 })
    ], cat);
    expect(Object.keys(b.x)).toEqual(['99003']);
    expect(b.funnel).toMatchObject({ records: 11, ours: 9, active: 8, uplink: 6, downlink: 5, bands: 1, kept: 1 });
    expect([b.dropped.noUplink!.length, b.dropped.noDownlink!.length, b.dropped.outOfBand!.length]).toEqual([2, 1, 4]);
  });
  it('drops what is neither a passband of equal widths nor a pair: an HF range reporting on one frequency, a Transceiver with ranges', () => {
    const b = baker.bake([
      xp({ uplink_low: 21125000, uplink_high: 21150000, downlink_low: 435525000, downlink_high: null }),
      xp({ type: 'Transceiver' }),
      xp({ downlink_high: 435950000 }),
      xp({ uplink_high: 'x' })
    ], cat);
    expect(b.x).toEqual({});
    expect([b.dropped.shape!.length, b.dropped.widths!.length]).toEqual([3, 1]);
  });
  it('sorts a range filed high to low into ascending order, keeps the invert flag as filed, and says so', () => {
    const b = baker.bake([xp({ uplink_low: 146000000, uplink_high: 145900000, downlink_low: 435900000, downlink_high: 435800000 })], cat);
    expect(b.x['99001']).toEqual([[145900000, 146000000, 435800000, 435900000, 1, 'USB', 'LSB', 0, 'Linear']]);
    expect(b.notes.normalised!.length).toBe(1);
    expect(b.notes.normalised![0]).toContain('range normalised');
  });
  it('makes a passband inverting when one of its records shows the inversion in its sidebands (JO-97), and drops it when none does', () => {
    const b = baker.bake([
      xp({ mode: 'CW', uplink_mode: 'CW', invert: false, description: 'CW' }), xp({ description: 'SSB' }),
      xp({ norad_cat_id: 99003, mode: 'CW', uplink_mode: 'CW', invert: false }), xp({ norad_cat_id: 99003, mode: 'CW', uplink_mode: null, invert: true })
    ], cat);
    expect(b.x['99001']!.map(t => [t[4], t[5]])).toEqual([[1, 'CW'], [1, 'USB']]);
    expect(b.notes.reconciled!.length).toBe(1);
    expect(b.notes.reconciled![0]).toMatch(/^99001 ONE: .* CW: filed non-inverting beside an inverting record, LSB in, USB out/);
    expect(b.x['99003']).toBeUndefined();
    expect(b.dropped.invert!.length).toBe(2);
    expect(b.dropped.invert![0]).toContain('no record shows which is right');
  });
  it('makes a passband non-inverting when one of its records shows there is no inversion, the same sideband on both legs (AO-7 Mode A)', () => {
    /* AO-7's Mode A as filed, SSB on USB in and USB out, beside a CW record wrongly filed inverting: the SSB record settles it */
    const modeA = (o: Rec) => xp({ norad_cat_id: 7, invert: false, uplink_low: 145850000, uplink_high: 145950000, downlink_low: 29400000, downlink_high: 29500000, ...o });
    const b = baker.bake([modeA({ mode: 'USB', uplink_mode: 'USB', description: 'SSB' }), modeA({ mode: 'CW', uplink_mode: 'CW', invert: true, description: 'CW' })], cat);
    expect(b.x['7']!.map(t => t.slice(4, 7))).toEqual([[0, 'CW', ''], [0, 'USB', '']]);
    expect(b.dropped.invert!.length).toBe(0);
    expect(b.notes.reconciled!.length).toBe(1);
    expect(b.notes.reconciled![0]).toMatch(/^ {4}7 SEVEN: .* CW: filed inverting beside a non-inverting record, USB in, USB out/);
  });
  it('drops a passband whose records show both, an inversion in one and none in another, and makes nothing of it', () => {
    const b = baker.bake([xp({ description: 'inverting' }), xp({ uplink_mode: 'USB', invert: false, description: 'not' }), xp({ mode: 'CW', uplink_mode: 'CW', invert: false })], cat);
    expect(b.x).toEqual({});
    expect(b.notes.reconciled!.length).toBe(0);
    expect(b.dropped.sideband!.length).toBe(0);
    expect(b.dropped.invert!.length).toBe(3);
    for (const l of b.dropped.invert!) expect(l).toContain('its records show both: LSB in, USB out, filed inverting, and USB in, USB out, filed non-inverting');
  });
  it('drops a passband whose own sidebands contradict its invert flag, not one with no uplink mode, and leaves the flag of a pair at 0', () => {
    const b = baker.bake([
      xp({ invert: false }), xp({ norad_cat_id: 99003, uplink_mode: 'USB' }),
      xp({ norad_cat_id: 7, mode: 'USB', uplink_mode: 'USB', invert: false }),
      xp({ norad_cat_id: 7, uplink_low: 145800000, uplink_high: 145900000, uplink_mode: null }),
      pair({ invert: true })
    ], cat);
    expect(Object.keys(b.x)).toEqual(['7', '99002']);
    expect(b.x['7']!.map(t => t.slice(4, 7))).toEqual([[1, 'USB', ''], [0, 'USB', '']]);
    expect(b.x['99002']![0]![4]).toBe(0);
    expect(b.dropped.sideband!.length).toBe(2);
  });
  it('writes no mode for a linear passband filed as FM, and says so; a pair keeps its FM', () => {
    const b = baker.bake([xp({ mode: 'FM', uplink_mode: 'FM', invert: false, description: 'SSB Only Transpoder' }), xp({ uplink_low: 145800000, uplink_high: 145900000, mode: 'FM', uplink_mode: 'USB', invert: false }), pair({})], cat);
    expect(b.x['99001']!.map(t => t.slice(4, 7))).toEqual([[0, '', 'USB'], [0, '', '']]);
    expect(b.x['99002']![0]![5]).toBe('FM');
    expect(b.notes.fmDropped!.length).toBe(2);
  });
  it('keeps no cap, drops records equal in everything the page works with, and orders passbands first, then pairs, by uplink', () => {
    const b = baker.bake([
      pair({ norad_cat_id: 99001, uplink_low: 437000000, downlink_low: 145900000 }),
      pair({ norad_cat_id: 99001, uplink_low: 145200000, downlink_low: 145800000, description: 'B second' }),
      pair({ norad_cat_id: 99001, uplink_low: 145200000, downlink_low: 145800000, description: 'A first' }),
      pair({ norad_cat_id: 99001, uplink_low: 144490000, downlink_low: 145800000 }),
      pair({ norad_cat_id: 99001, uplink_low: 144490000, downlink_low: 145800000, mode: 'AFSK' }),
      xp({ uplink_low: 432125000, uplink_high: 432175000, downlink_low: 145925000, downlink_high: 145975000 }),
      xp({})
    ], cat);
    expect(b.x['99001']!.map(t => [t[0], t[5], t[8]])).toEqual([
      [145900000, 'USB', 'Linear'], [432125000, 'USB', 'Linear'],
      [144490000, 'AFSK', 'FM'], [144490000, 'FM', 'FM'], [145200000, 'FM', 'A first'], [437000000, 'FM', 'FM']
    ]);
    expect(b.dropped.duplicate!.length).toBe(1);
  });
  it('reads a tone from the description, keeps it only when it is an EIA/TIA-603 tone, and cuts the description to 44 characters', () => {
    expect(baker.toneOf('Mode V/U FM Voice CTCSS 67.0 Hz')).toBe(67);
    expect(baker.toneOf('SSDV (PL 88.5Hz)')).toBe(88.5);
    expect(baker.toneOf('Mode V/U FM 67.0 PL')).toBe(67);
    expect(baker.toneOf('ctcss 100')).toBe(100);
    expect(baker.toneOf('Mode U/V FM Voice (no CTCSS any longer)')).toBe(0);
    expect(baker.toneOf('Mode V/U FM')).toBe(0);
    const b = baker.bake([
      pair({ description: 'Voice CTCSS 65.0 Hz' }),
      pair({ norad_cat_id: 99003, description: 'Mode V/U -  200 bps UP,\n800 bps DOWN - TLM, SSDV and more besides' }),
      pair({ norad_cat_id: 7, description: 'A'.repeat(60) })
    ], cat);
    expect(b.x['99002']![0]![7]).toBe(0);
    expect(b.notes.toneRefused!.length).toBe(1);
    /* whitespace folded, then cut at 43 characters, a space at the cut dropped, and an ellipsis */
    expect(b.x['99003']![0]![8]).toBe('Mode V/U - 200 bps UP, 800 bps DOWN - TLM,…');
    expect(b.x['7']![0]![8]).toBe('A'.repeat(43) + '…');
    expect(b.x['7']![0]![8].length).toBe(baker.DESC_MAX);
  });
  it('writes the file as one line, its keys in number order, with the time the answer was fetched', () => {
    const b = baker.bake([pair({ norad_cat_id: 99002 }), pair({ norad_cat_id: 7 })], cat);
    const s = baker.render('2026-10-17T05:01:30.000Z', b);
    expect(s).toBe('{"built":"2026-10-17T05:01:30.000Z","source":"SatNOGS DB — db.satnogs.org/api/transmitters/","licence":"CC BY-SA 4.0","objects":2,"records":2,'
      + '"x":{"7":[[145850000,145850000,436795000,436795000,0,"FM","",0,"FM"]],"99002":[[145850000,145850000,436795000,436795000,0,"FM","",0,"FM"]]}}\n');
  });
});
