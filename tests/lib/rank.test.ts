import { describe, expect, it } from 'vitest';
import { rank } from '../../src/lib/catalogue/rank';
import { CATALOGUE } from './helpers';

/* The picker's order, with and without the reader's own orbits (legacy rank(), index.html 10864-10885). */
const cat = [
  { name: 'ISS (ZARYA)', satnum: '25544' }, { name: 'CUBESAT ONE', satnum: '40001' }, { name: 'ZARYA 2', satnum: '25545' },
  { name: 'SCOUT', satnum: '12345' }
];
const mine = [{ name: 'My Cube' }, { name: 'Sun-sync' }];

describe('rank', () => {
  it('lists the catalogue in order for the empty query, the reader\'s orbits first', () => {
    expect(rank(cat, '')).toEqual([0, 1, 2, 3]);
    expect(rank(cat, '  ', mine)).toEqual([4, 5, 0, 1, 2, 3]);
  });
  it('puts starts before contains, in each group, the reader\'s own leading their group', () => {
    expect(rank(cat, 'zarya', mine)).toEqual([2, 0]);                 // "ZARYA 2" starts with it, "ISS (ZARYA)" merely contains it
    expect(rank(cat, 'cube', mine)).toEqual([1, 4]);                  // catalogue start, then (a custom that only contains it comes before the catalogue contains)
    expect(rank(cat, 'my', mine)).toEqual([4]);
  });
  it('matches a catalogue number as a start, never a custom one by its placeholder number', () => {
    expect(rank(cat, '2554', mine)).toEqual([0, 2]);
    expect(rank(cat, 'o000', mine)).toEqual([]);
  });
  it('matches every custom orbit on the word they are tagged with', () => {
    expect(rank(cat, 'cu', mine)).toEqual([4, 5, 1]);                 // 'custom'.startsWith('cu'): both of theirs, then the catalogue's CUBESAT
    expect(rank(cat, 'custom', mine)).toEqual([4, 5]);
    expect(rank(cat, 'customs', mine)).toEqual([]);
  });
});

/* The lowest tier, word by word (CHANGES-FROM-LEGACY.md, L58): what the four tiers above did not list, matched on every word of the query
   in the name with everything but a-z and 0-9 taken out, or on a word of digits that is the whole catalogue number without its leading zeros. */
const legacy = (c: readonly { name: string; satnum: string }[], query: string, m: readonly { name: string }[] = []): number[] => {
  /* the old page's four tiers, as rank() was before the last one was added: what every order must still begin with */
  const q = query.trim().toLowerCase();
  const cStarts: number[] = [], cHas: number[] = [];
  for (let k = 0; k < m.length; k++) {
    const n = m[k]!.name.toLowerCase();
    if (!q || n.startsWith(q) || 'custom'.startsWith(q)) cStarts.push(c.length + k);
    else if (n.indexOf(q) >= 0) cHas.push(c.length + k);
  }
  if (!q) return cStarts.concat(c.map((_, i) => i));
  const starts: number[] = [], has: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const n = c[i]!.name.toLowerCase(), id = c[i]!.satnum;
    if (n.startsWith(q) || id.startsWith(q)) starts.push(i);
    else if (n.indexOf(q) >= 0 || id.indexOf(q) >= 0) has.push(i);
  }
  return cStarts.concat(starts, cHas, has);
};
const real = (q: string, m: readonly { name: string }[] = []) => rank(CATALOGUE, q, m).map(i => (i < CATALOGUE.length ? CATALOGUE[i]!.name : 'mine: ' + m[i - CATALOGUE.length]!.name));
const cat2 = [
  { name: 'OSCAR 7', satnum: '07530' }, { name: 'AO-91', satnum: '43017' }, { name: 'LANDSAT 8', satnum: '39084' },
  { name: 'LANDSAT 9', satnum: '49260' }, { name: 'ISS (ZARYA)', satnum: '25544' }
];

describe('rank: the words of a query', () => {
  it('finds a name whatever stands between its words, and in any order of them', () => {
    expect(rank(cat, 'iss zarya')).toEqual([0]);                      // "iss zarya" is not in "iss (zarya)"; both words are in "isszarya"
    expect(rank(cat, 'zarya iss')).toEqual([0]);
    expect(rank(cat, 'ISS(ZARYA)')).toEqual([0]);
    expect(rank(cat, 'cube-sat')).toEqual([1]);
    expect(rank(cat2, 'ao91')).toEqual([1]);
    expect(rank(cat2, 'ao 91')).toEqual([1]);
    expect(rank(cat2, 'oscar7')).toEqual([0]);
  });
  it('matches a word of digits to the whole catalogue number without its leading zeros, and to nothing inside it', () => {
    expect(rank(cat2, '7530')).toEqual([0]);                          // already a contains of "07530", in the old tier
    expect(rank(cat2, '007530')).toEqual([0]);                        // only here: "007530" is in neither name nor number
    expect(rank(cat2, 'oscar 7530')).toEqual([0]);
    expect(rank(cat2, '0043017')).toEqual([1]);
    expect(rank(cat2, 'landsat 9')).toEqual([3]);                     // LANDSAT 8's 39084 has a 9 in it, but 9 is not its number
    expect(rank(cat2, 'oscar 753')).toEqual([]);
  });
  it('comes after the four tiers, the reader\'s own leading it, and lists nothing twice', () => {
    expect(rank(cat, 'sun sync', mine)).toEqual([5]);
    expect(rank(cat, 'c u b e', mine)).toEqual([4, 1]);               // My Cube and CUBESAT ONE hold every letter; Sun-sync no b, SCOUT no b or e
    expect(rank(cat2, 'landsat', mine)).toEqual([2, 3]);
    const both = [...cat, { name: 'ZARYA (ISS)', satnum: '25546' }];
    expect(rank(both, 'zarya', mine)).toEqual([2, 4, 0]);             // a start, a start, a contains: the last tier adds nothing here
    expect(rank(both, 'zarya (iss', mine)).toEqual([4, 0]);           // the start, then ISS (ZARYA), found by its words alone
  });
  it('never finds the reader\'s orbits by their placeholder numbers, and a query of no letters or digits finds nothing', () => {
    const placed = [{ name: 'Alpha orbit', satnum: 'O0001' }, { name: 'Bravo orbit', satnum: 'O0002' }];
    expect(rank(cat, 'o000', placed)).toEqual([]);
    expect(rank(cat, 'O0001', placed)).toEqual([]);
    expect(rank(cat, 'o 0001', placed)).toEqual([]);
    expect(rank(cat, '0001', placed)).toEqual([1]);                  // CUBESAT ONE's 40001 holds it (the old contains tier); O0001 is not looked at
    expect(rank(cat, 'customs', placed)).toEqual([]);
    expect(rank(cat, 'alpha-orbit', placed)).toEqual([4]);            // by the words of its name
    expect(rank(cat, '( - )', mine)).toEqual([]);
    expect(rank(cat, '0000', mine)).toEqual([]);                     // no number is 0, and no name holds 0000
  });
  it('finds ISS (ZARYA), OSCAR 7 and AO-91 in the real catalogue by the words people type', () => {
    expect(real('iss zarya')).toEqual(['ISS (ZARYA)']);
    expect(real('7530')).toEqual(['OSCAR 7']);
    expect(real('007530')).toEqual(['OSCAR 7']);
    expect(real('oscar 7530')).toEqual(['OSCAR 7']);
    expect(real('ao91')).toEqual(['AO-91']);
    expect(real('knacksat 2')).toEqual(['KNACKSAT-2']);
    expect(real('noaa19')).toEqual(['NOAA 19']);
  });
  it('keeps every order the old page gave as the start of its own, in the real catalogue', () => {
    const m = [{ name: 'Alpha orbit' }, { name: 'Zqx alpha' }, { name: 'My Cube-sat' }];
    const qs = new Set<string>(['iss zarya', 'goes 1', 'landsat 9', 'custom', 'cu', 'zqx', 'o0001', 'zzqq nothing', '0', '00', '-', 'iss (']);
    /* every ninth entry's name, number and first three letters (all 2,158 take 20 s, each query a pass over the catalogue) */
    CATALOGUE.forEach((c, i) => { if (i % 9 === 0) { qs.add(c.name); qs.add(c.satnum); qs.add(c.name.slice(0, 3)); } });
    let grew = 0;
    for (const q of qs) for (const mm of [[], m]) {
      const was = legacy(CATALOGUE, q, mm), now = rank(CATALOGUE, q, mm);
      expect(now.slice(0, was.length)).toEqual(was);
      expect(new Set(now).size).toBe(now.length);
      if (now.length > was.length) grew++;
    }
    expect(grew).toBeGreaterThan(0);
    expect(rank(CATALOGUE, 'zzqq nothing', m)).toEqual([]);           // what the suites type to reach the Plan row still matches nothing
    expect(rank(CATALOGUE, 'qqzz', m)).toEqual([]);
  });
});
