import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import raw from '../../data/aliases.json';
import { aliasFinder, byAlias, parts, type AliasTable } from '../../src/lib/catalogue/alias';
import { loadAliases } from '../../src/lib/data/aliases';
import { rank } from '../../src/lib/catalogue/rank';
import { aliasSaid } from '../../src/lib/text/alias';
import { CATALOGUE } from './helpers';

/* The picker's other names (CHANGES-FROM-LEGACY.md, L61): SatNOGS DB's names for the catalogue's spacecraft, baked into data/aliases.json by
   verification/tools/fetch-aliases.js, matched after rank()'s own rows by a wrapper that leaves rank.ts alone. */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const T = raw.a as AliasTable;
const bare = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const unpad = (s: string) => s.replace(/^0+/, '');
const mine = [{ name: 'RS-44' }, { name: 'My Cube' }];
/* what the picker lists for a query: rank()'s rows, then the alias rows, as names (and the name that matched) */
const listed = (q: string, m: readonly { name: string }[] = []) => {
  const r = rank(CATALOGUE, q, m);
  return { rank: r, alias: [...byAlias(CATALOGUE, q, T, r)].map(([i, n]) => CATALOGUE[i]!.name + ' = ' + n), idx: [...byAlias(CATALOGUE, q, T, r).keys()] };
};

describe('data/aliases.json', () => {
  const text = fs.readFileSync(path.join(ROOT, 'data', 'aliases.json'), 'utf8');
  const byNum = new Map(CATALOGUE.map(c => [unpad(c.satnum), c]));

  it('says where it is from, when it was baked and under which licence, and holds nothing else', () => {
    expect(Object.keys(raw)).toEqual(['built', 'source', 'licence', 'a']);
    expect(raw.built).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
    expect(Number.isFinite(Date.parse(raw.built))).toBe(true);
    expect(raw.source).toBe('SatNOGS DB — db.satnogs.org/api/satellites/');
    expect(raw.licence).toBe('CC BY-SA 4.0');
  });
  it('is keyed by catalogue objects only, by NORAD number without leading zeros, in number order in the file itself', () => {
    const keys = Object.keys(T);
    expect(keys.length).toBeGreaterThan(400);
    for (const k of keys) {
      expect(k).toMatch(/^[1-9]\d*$/);
      expect(byNum.has(k)).toBe(true);
    }
    /* read from the text: a parsed object lists integer-like keys in ascending order whatever order the file has them in */
    const written = [...text.matchAll(/"(\d+)":\[/g)].map(m => m[1]!);
    expect(written).toEqual(keys);
    expect(written).toEqual(written.slice().sort((a, b) => Number(a) - Number(b)));
  });
  it('holds only names a search of the catalogue name would miss: none empty, none the number, none in the name, none twice, none over 30 characters', () => {
    for (const [k, names] of Object.entries(T)) {
      expect(names.length).toBeGreaterThan(0);
      const own = bare(byNum.get(k)!.name), seen = new Set<string>();
      for (const n of names) {
        const b = bare(n);
        expect(n).toBe(n.trim());
        expect(n.length).toBeLessThanOrEqual(30);
        expect(b.length).toBeGreaterThan(0);
        expect(b).not.toBe(k);
        expect(own.includes(b)).toBe(false);
        expect(seen.has(b)).toBe(false);
        seen.add(b);
      }
    }
  });
  it('holds no name that is another object\'s catalogue name (where SatNOGS and the catalogue disagree on which object is which)', () => {
    const owner = new Map<string, string[]>();
    for (const c of CATALOGUE) owner.set(bare(c.name), (owner.get(bare(c.name)) ?? []).concat(unpad(c.satnum)));
    const clash = Object.entries(T).flatMap(([k, names]) => names.filter(n => (owner.get(bare(n)) ?? []).some(o => o !== k)).map(n => k + ' ' + n));
    expect(clash).toEqual([]);
    /* the two the first bake kept: CBERS-4A on 44879 (OBJECT A; the catalogue's CBERS 4A is 44883), GRUS-1D on 47935 (GRUS-1E; GRUS-1D is 47936) */
    expect(T['44879']).toBeUndefined();
    expect(T['47935']).toBeUndefined();
    expect(byNum.get('44883')!.name).toBe('CBERS 4A');
    expect(byNum.get('47936')!.name).toBe('GRUS-1D');
  });
  it('holds no international designator, date or placeholder of an unidentified object', () => {
    for (const n of Object.values(T).flat()) {
      expect(n).not.toMatch(/\b\d{4}-\d{3}[A-Z]{0,3}\b|^\d{5}[A-Z]{1,3}$|\b\d{4}-\d{2}-\d{2}\b/);
      expect(n).not.toMatch(/^objec?x?t [a-z]{1,3}$|^unknown/i);
    }
  });
  it('has the AMSAT designators the catalogue names lack', () => {
    expect(T['7530']).toContain('AO-7');            // OSCAR 7
    expect(T['27607']).toContain('SO-50');          // SAUDISAT 1C
    expect(T['24278']).toContain('FO-29');          // JAS 2
    expect(T['44909']).toContain('RS-44');          // BREEZE-KM R/B
    expect(T['43678']).toContain('PO-101');         // DIWATA 2B
    expect(T['43700']).toContain('QO-100');         // ES'HAIL 2
  });
  it('is small: a lazy chunk the picker asks for once, a few kilobytes gzipped', () => {
    expect(Buffer.byteLength(text)).toBeLessThan(16_000);      // bytes, not characters: Cyrillic, CJK, Ø and the like are more than one
    expect(zlib.gzipSync(text, { level: 9 }).length).toBeLessThan(7_000);
  });
});

describe('parts', () => {
  it('strips a name as rank() does and says where each of its words starts (a run of letters and marks, or of digits)', () => {
    expect(parts('RS-44')).toEqual({ b: 'rs44', at: [0, 2] });
    expect(parts('RS0ISS')).toEqual({ b: 'rs0iss', at: [0, 2, 3] });
    expect(parts('HEO-09 (a.k.a Ornella Vanono)')).toEqual({ b: 'heo09akaornellavanono', at: [0, 3, 5, 6, 7, 8, 15] });
    expect(parts('Геоскан-6')).toEqual({ b: 'геоскан6', at: [0, 7] });
    expect(parts('ＲＳ－４４')).toEqual({ b: 'rs44', at: [0, 2] });     // full width, NFKC
    expect(parts('- ')).toEqual({ b: '', at: [] });
  });
});

describe('byAlias over the real catalogue', () => {
  it('finds RS-44 however it is typed, where rank() finds nothing', () => {
    for (const q of ['rs44', 'rs-44', 'RS 44', 'RS-44', ' rs 44 ', '44 rs']) {
      const l = listed(q);
      expect(l.rank).toEqual([]);
      expect(l.alias).toEqual(['BREEZE-KM R/B = RS-44']);
    }
  });
  it('finds SO-50, FO-29, PO-101 and QO-100 by their designators', () => {
    expect(listed('so50').alias).toEqual(['SAUDISAT 1C = SO-50']);
    expect(listed('fo29').alias).toEqual(['JAS 2 = FO-29']);
    expect(listed('po-101').alias).toEqual(['DIWATA 2B = PO-101']);
    expect(listed('qo100').alias).toEqual(["ES'HAIL 2 = QO-100"]);
  });
  it('puts the name that is the whole query first: "ao7" lists OSCAR 7 (AO-7) before FUNCUBE 1 (AO-73)', () => {
    expect(listed('ao7').alias).toEqual(['OSCAR 7 = AO-7', 'FUNCUBE 1 = AO-73']);
    expect(listed('ao-73').alias).toEqual(['FUNCUBE 1 = AO-73']);
  });
  it('matches a word at the start of a word of the name only, so "iss" is not found in "Mission"', () => {
    expect(listed('iss').alias).toEqual([]);
    expect(listed('ission').alias).toEqual([]);
    expect(listed('mission').alias.length).toBeGreaterThan(0);
  });
  it('comes after rank()\'s rows and repeats none of them: OSCAR 7 by "oscar 7" is rank()\'s, not an alias row', () => {
    expect(listed('oscar 7').alias.some(s => s.startsWith('OSCAR 7 ='))).toBe(false);
    for (const q of ['a', 'ao', 'ao-', 'rs', 'iss', 'noaa', 'fox', '44', '7', 'sitro', 'jilin-01 gaofen 3', 'dp0', 'heo 09']) {
      const l = listed(q);
      expect(l.idx.filter(i => l.rank.includes(i))).toEqual([]);
      expect(new Set(l.idx).size).toBe(l.idx.length);
    }
  });
  it('never matches an orbit of the reader\'s own, by name or by its placeholder number: only catalogue rows', () => {
    const l = listed('rs44', mine);
    expect(l.rank).toEqual([CATALOGUE.length]);           // the reader's "RS-44", by rank()'s word tier, by its name
    expect(l.alias).toEqual(['BREEZE-KM R/B = RS-44']);  // and the catalogue's, by its other name
    for (const q of ['o000', 'O0001', 'customs', 'custom', 'my cube', 'zzqq nothing', 'qqzz', 'zqx', 'ดาวเทียม 2']) {
      const r = rank(CATALOGUE, q, mine);
      const a = [...byAlias(CATALOGUE, q, T, r).keys()];
      expect(a.every(i => i < CATALOGUE.length)).toBe(true);
      if (q !== 'custom' && q !== 'my cube') expect(a).toEqual([]);
    }
  });
  it('lists nothing for the empty query (rank() lists the whole catalogue there)', () => {
    expect(byAlias(CATALOGUE, '', T, []).size).toBe(0);
    expect(byAlias(CATALOGUE, '   ', T, []).size).toBe(0);
  });
});

describe('byAlias', () => {
  const cat = [{ satnum: '00005' }, { satnum: '00007' }, { satnum: '12345' }, { satnum: 'constructor' }];
  const t: AliasTable = { 5: ['ZETA AB', 'AB-1', 'AB-2'], 7: ['AB', 'XAB'], 12345: ['QAB 1', 'ZZ AB 1'] };
  it('orders by how the name matched (the whole query, then starting with the first word, then holding the words), catalogue order within each', () => {
    expect([...byAlias(cat, 'ab', t, [])]).toEqual([[1, 'AB'], [0, 'AB-1'], [2, 'ZZ AB 1']]);       // XAB and QAB do not start a word with it
    expect([...byAlias(cat, 'ab 1', t, [])]).toEqual([[0, 'AB-1'], [2, 'ZZ AB 1']]);
  });
  it('takes each row by its best name, the first of that kind', () => {
    expect(byAlias(cat, 'zeta', t, []).get(0)).toBe('ZETA AB');
    expect(byAlias(cat, 'ab', t, []).get(0)).toBe('AB-1');       // AB-1 and AB-2 start with it, ZETA AB only holds it
  });
  it('leaves out the rows it is told are listed, and reads the number without its leading zeros', () => {
    expect([...byAlias(cat, 'ab', t, [1, 2]).keys()]).toEqual([0]);
    expect(byAlias([{ satnum: '5' }], 'zeta', t, []).get(0)).toBe('ZETA AB');
  });
  it('looks only at the table\'s own keys', () => {
    expect(byAlias(cat, 'function', t, []).size).toBe(0);
    expect(byAlias([{ satnum: 'toString' }], 'tostring', {}, []).size).toBe(0);
  });
});

describe('the finder the picker calls', () => {
  afterEach(() => vi.unstubAllGlobals());
  /* the table is a file of the page's own, fetched (L65; a failure asked again is tests/net/file.test.ts's): the fetch is stood in for */
  it('loads the baked table once, as a file of its own, and words each row as its option says it', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'aliases.json'), 'utf8')) as unknown }));
    vi.stubGlobal('fetch', fetch);
    const [a, b] = [await loadAliases(), await loadAliases()];
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.a['44909']).toEqual(T['44909']);
    const f = aliasFinder(a.a);
    expect([...f(CATALOGUE, 'rs44', [])]).toEqual([[CATALOGUE.findIndex(c => c.satnum === '44909'), 'matches RS-44']]);
    expect(f(CATALOGUE, 'rs44', [CATALOGUE.findIndex(c => c.satnum === '44909')]).size).toBe(0);
    expect(aliasSaid('RS-44')).toBe('matches RS-44');
  });
  it('is over the table it is given, so the picker can ask for the table and the finder\'s chunk at once', () => {
    expect([...aliasFinder({ 5: ['ZETA AB'] })([{ satnum: '00005' }], 'zeta', [])]).toEqual([[0, 'matches ZETA AB']]);
    expect(aliasFinder({})([{ satnum: '00005' }], 'zeta', []).size).toBe(0);
  });
});
