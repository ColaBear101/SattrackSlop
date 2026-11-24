import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCatalog } from '../../src/lib/catalogue/parse';
import {
  GEO_INC_DEG, GSO_BAND, HEO_ECC, LEO_APOGEE_KM, catSum, orbitOf, purposeAt, tableFits, typeAt, unrecorded, type Orbit, type SatcatTable
} from '../../src/lib/catalogue/classify';
import { ORBIT_COLOUR, PURPOSE_COLOUR, TYPE_COLOUR, seenAs, tintFor } from '../../src/components/stage/catcolour';
import { ORBIT_NAME, ORBIT_ROWS, PURPOSE_NAME, PURPOSE_ROWS, STALE_NOTE, TYPE_NAME, TYPE_ROWS } from '../../src/lib/text/catcolour-key';
import { CATCOL_CHOICES } from '../../src/lib/text/catcolour';

/* The catalogue's colours by class (CHANGES-FROM-LEGACY.md, L76): the orbit classes read from the elements, CelesTrak's table baked
   against this catalogue (verification/tools/fetch-satcat.js), what the colours' chunk makes of both, and the palette as the dots are
   seen at rest. The counts are the catalogue's as it ships (data/catalogue.txt, 2,158 objects) and the table's as it was baked from
   CelesTrak's files of 2026-11-20; a re-bake that moves them is a change to look at, not to wave through. */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CAT = parseCatalog(fs.readFileSync(path.join(ROOT, 'data', 'catalogue.txt'), 'utf8'));
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'satcat.json'), 'utf8')) as SatcatTable;
const at = (name: string) => { const i = CAT.findIndex(e => e.name === name); expect(i, name).toBeGreaterThanOrEqual(0); return i; };
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => { m[x] = (m[x] ?? 0) + 1; return m; }, {});

/* a second line with these elements in satellite.js's columns (the rest of it is what orbitOf does not read) */
const line2 = (inc: number, ecc: number, revs: number) =>
  '2 99999 ' + inc.toFixed(4).padStart(8) + ' 123.4567 ' + ecc.toFixed(7).slice(2) + ' 123.4567 123.4567 ' + revs.toFixed(8).padStart(11) + '123456';

describe('the orbit classes, from the elements', () => {
  it('reads the columns satellite.js reads', () => {
    const l = line2(51.6318, 0.0007419, 15.49491575);
    expect(l.substring(8, 16)).toBe(' 51.6318');
    expect(l.substring(26, 33)).toBe('0007419');
    expect(l.substring(52, 63)).toBe('15.49491575');
  });
  it('splits the catalogue as it ships', () => {
    expect(CAT).toHaveLength(2158);
    expect(tally(CAT.map(e => orbitOf(e.l2)))).toEqual({ leo: 367, sso: 1183, meo: 18, geo: 547, igso: 23, heo: 17, beyond: 3 });
  });
  it('puts the objects one knows where they belong', () => {
    const cls = (n: string) => orbitOf(CAT[at(n)]!.l2);
    const want: [string, Orbit][] = [
      ['ISS (ZARYA)', 'leo'], ['STARLINK-3100', 'leo'], ['TERRA', 'sso'], ['NOAA 20', 'sso'], ['NAVSTAR 56 (USA 180)', 'meo'], ['LARES-2', 'meo'],
      ['INTELSAT 40E (IS-40E)', 'geo'], ['TDRS 3', 'geo'], ['QZS-2 (MICHIBIKI-2)', 'igso'], ['BEIDOU-3 IGSO-1', 'igso'], ['SDO', 'igso'],
      ['MMS 1', 'heo'], ['ARKTIKA-M 1', 'heo'], ['CXO', 'heo'], ['SYRACUSE 3B', 'beyond'], ['EUTE 1-F4 (ECS 4)', 'beyond']
    ];
    for (const [n, c] of want) expect(cls(n), n).toBe(c);
  });
  it('draws its lines where it says: eccentricity 0.25, a sidereal day to 1.5 %, 15° of inclination, 2,000 km of apogee, the Sun\'s 0.9856° a day', () => {
    const day = 1440 / 1436.0682;                                   // revolutions a day of a sidereal-day period
    expect(orbitOf(line2(0.1, 0.2499999, day))).toBe('geo');
    expect(orbitOf(line2(0.1, 0.25, day))).toBe('heo');
    expect(orbitOf(line2(14.99, 0.0002, day))).toBe('geo');
    expect(orbitOf(line2(15, 0.0002, day))).toBe('igso');
    expect(orbitOf(line2(0.1, 0.0002, day / 1.014))).toBe('geo');     // a period 1.4 % long
    expect(orbitOf(line2(0.1, 0.0002, day / 1.016))).toBe('beyond');  // 1.6 %
    expect(orbitOf(line2(55, 0.0002, day * 1.016))).toBe('meo');
    expect(orbitOf(line2(55, 0.0002, 2.00561))).toBe('meo');          // GPS
    /* a 2,000 km circle goes round 11.32 times a day: 11.2 is about 2,060 km up, 11.45 about 1,935 km */
    expect(orbitOf(line2(55, 0.0002, 11.2))).toBe('meo');
    expect(orbitOf(line2(55, 0.0002, 11.45))).toBe('leo');
    /* at 500 km the sun-synchronous inclination is 97.4°, and each degree off it turns the plane 0.13° a day more or less: a few
       tenths of a degree off is still within 0.1° a day of the Sun, a degree off is not */
    expect(orbitOf(line2(97.4, 0.001, 15.22))).toBe('sso');
    expect(orbitOf(line2(97.0, 0.001, 15.22))).toBe('sso');           // 0.05° a day off the Sun's rate
    expect(orbitOf(line2(96.5, 0.001, 15.22))).toBe('leo');           // 0.12°
    expect(orbitOf(line2(98.6, 0.001, 15.22))).toBe('leo');           // 0.16°
  });
});

describe('CelesTrak\'s table', () => {
  it('is this catalogue\'s: its length and the sum of its numbers in order', () => {
    expect(TABLE.n).toBe(2158);
    expect(TABLE.sum).toBe(catSum(CAT));
    expect(tableFits(TABLE, CAT)).toBe(true);
    expect(TABLE.built).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('is not another catalogue\'s: one object fewer, two swapped, or one renumbered, and it is not read', () => {
    expect(tableFits(TABLE, CAT.slice(1))).toBe(false);
    const swapped = CAT.slice(); [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(tableFits(TABLE, swapped)).toBe(false);
    expect(tableFits(TABLE, CAT.map((e, i) => i === 1000 ? { ...e, satnum: '99999' } : e))).toBe(false);
  });
  it('holds only the letters it documents, and the counts it was baked with', () => {
    expect(TABLE.type).toMatch(/^[PRDUN]{2158}$/);
    expect(TABLE.purpose).toMatch(/^[cnesmhao]{2158}$/);
    expect(tally([...TABLE.type])).toEqual({ P: 2132, R: 6, D: 6, U: 1, N: 13 });
    expect(tally([...TABLE.purpose])).toEqual({ c: 520, n: 47, e: 289, s: 45, h: 12, m: 24, a: 130, o: 1091 });
  });
  it('has no record of exactly the 13 objects SatNOGS numbers itself, and gives them no purpose', () => {
    const none = CAT.filter((_, i) => unrecorded(TABLE, i));
    expect(none.map(e => e.satnum).sort()).toEqual(CAT.filter(e => +e.satnum >= 90000).map(e => e.satnum).sort());
    expect(none).toHaveLength(13);
    for (let i = 0; i < CAT.length; i++) if (unrecorded(TABLE, i)) expect(purposeAt(TABLE, i), CAT[i]!.name).toBe('other');
  });
  it('says what SATCAT and CelesTrak\'s lists say of the objects one knows', () => {
    const t = (n: string) => typeAt(TABLE, at(n)), p = (n: string) => purposeAt(TABLE, at(n));
    expect([t('ISS (ZARYA)'), t('PEGASUS R/B'), t('FREGAT DEB'), t('OBJECT X'), t('BLUEBIRD-11')]).toEqual(['pay', 'rb', 'deb', 'unk', 'unk']);
    const want: [string, string][] = [
      ['ISS (ZARYA)', 'crew'],             // on the amateur list too: the station comes first
      ['KNACKSAT-2', 'edu'],               // listed with the station when just released from it: the CubeSats come first
      ['SES-15', 'comms'], ['GALAXY 30 (G-30)', 'comms'],   // an augmentation payload on an operator's satellite: the fleet comes first
      ['QZS-3 (MICHIBIKI-3)', 'nav'], ['NAVSTAR 56 (USA 180)', 'nav'],
      ['TERRA', 'eo'], ['NOAA 20', 'eo'], ['HST', 'sci'], ['SDO', 'sci'], ['PRAETORIAN SDA_601', 'mil'],
      ['ES\'HAIL 2', 'comms'],              // geostationary, with an amateur transponder
      ['INTELSAT 40E (IS-40E)', 'comms'], ['AMSAT OSCAR 40', 'other']
    ];
    for (const [n, c] of want) expect(p(n), n).toBe(c);
  });
  it('reads a letter it does not know as unknown, and other', () => {
    const odd = { ...TABLE, type: 'X' + TABLE.type.slice(1), purpose: 'x' + TABLE.purpose.slice(1) };
    expect(typeAt(odd, 0)).toBe('unk');
    expect(purposeAt(odd, 0)).toBe('other');
  });
});

/* OKLab, and the Machado, Oliveira & Fernandes (2009) simulations at full severity, for the dots as they are seen */
const lin = (h: string) => [1, 3, 5].map(i => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]
};
function oklab([r, g, b]: number[]) {
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const sim = (h: string, M?: number[][]) => { const c = lin(h); return M ? M.map(row => Math.max(0, Math.min(1, row[0]! * c[0]! + row[1]! * c[1]! + row[2]! * c[2]!))) : c; };
const dE = (a: string, b: string, M?: number[][]) => { const x = oklab(sim(a, M)), y = oklab(sim(b, M)); return 100 * Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!); };
const cvd = (a: string, b: string) => Math.min(dE(a, b, MACHADO.protan), dE(a, b, MACHADO.deutan));

describe('the palette, as the dots are seen', () => {
  it('is the one colour\'s formula: the old swatch, the hovered dot and the selected one', () => {
    expect(seenAs('#17A3CC')).toBe('#3A93A3');                       // the key's "Rest of the catalogue", Globe.svelte .k-cat
    expect(seenAs('#17A3CC', 1)).toBe('#4EC0D5');
    expect(seenAs('#CE801A', 1)).toBe('#D6AD53');
  });
  const modes = { orbit: ORBIT_COLOUR, type: TYPE_COLOUR, purpose: PURPOSE_COLOUR } as Record<string, Record<string, string>>;
  /* the two pairs that do not meet on the globe (see catcolour.ts): LEO below 2,000 km and IGSO at 36,000; navigation in medium and
     geosynchronous orbits, amateur and education in low ones */
  const apart = new Set(['orbit leo/igso', 'purpose nav/edu']);
  it('keeps every pair of classes apart to normal sight, and to protanopia and deuteranopia but the two pairs that never meet', () => {
    for (const [mode, pal] of Object.entries(modes)) {
      const ks = Object.keys(pal);
      expect(new Set(Object.values(pal)).size, mode).toBe(ks.length);
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
        const a = seenAs(pal[ks[i]!]!), b = seenAs(pal[ks[j]!]!), pair = mode + ' ' + ks[i] + '/' + ks[j];
        expect(dE(a, b), pair).toBeGreaterThanOrEqual(14.5);
        expect(cvd(a, b), pair).toBeGreaterThanOrEqual(apart.has(pair) ? 4.5 : 8.5);
      }
    }
  });
  it('by type, the four classes clear the all-pairs floors outright (15 to normal sight, 8 under either simulation)', () => {
    const s = Object.values(TYPE_COLOUR).map(h => seenAs(h));
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      expect(dE(s[i]!, s[j]!)).toBeGreaterThanOrEqual(15);
      expect(cvd(s[i]!, s[j]!)).toBeGreaterThanOrEqual(8);
    }
  });
  it('uses neither the selected spacecraft\'s gold, the in-view track\'s, nor the observer\'s pink', () => {
    for (const h of new Set([...Object.values(ORBIT_COLOUR), ...Object.values(TYPE_COLOUR), ...Object.values(PURPOSE_COLOUR)])) {
      for (const r of ['#D6AD53', '#E8BC5A', '#E2557E']) for (const dim of [0.55, 1]) expect(dE(seenAs(h, dim), r), h + ' vs ' + r).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('what the colours\' chunk makes', () => {
  const rgbOf = (h: string) => [1, 3, 5].map(i => Math.fround(parseInt(h.slice(i, i + 2), 16) / 255));
  it('by orbit: every dot its class\'s colour, its tag, a key with each class once, and the counts in the note', async () => {
    const t = await tintFor(CAT, 'orbit');
    expect(t.rgb).toHaveLength(CAT.length * 3);
    expect(t.tags).toHaveLength(CAT.length);
    for (const n of ['ISS (ZARYA)', 'INTELSAT 40E (IS-40E)', 'MMS 1']) {
      const i = at(n), c = orbitOf(CAT[i]!.l2);
      expect([...t.rgb.slice(i * 3, i * 3 + 3)]).toEqual(rgbOf(ORBIT_COLOUR[c]));
      expect(t.tags[i]).toBe(' · ' + ORBIT_NAME[c]);
    }
    expect(t.key.flat().map(k => k.t).sort()).toEqual(Object.values(ORBIT_NAME).sort());
    expect(t.key.map(r => r.map(k => k.t))).toEqual(ORBIT_ROWS.map(r => r.map(k => ORBIT_NAME[k])));
    expect(t.key[0]![1]).toEqual({ t: 'SSO', c: '#3A93A3' });
    expect(t.note).toBe('Read from each object\'s own elements, the first that fits: HEO, an eccentricity of 0.25 or more (17); GEO, a period within 1.5 % '
      + 'of a sidereal day and under 15° of inclination (547), or IGSO, inclined geosynchronous, at more (23); LEO, an apogee under 2,000 km (367), or SSO, '
      + 'sun-synchronous, a low orbit whose plane turns with the Sun (1,183); MEO, higher, with a shorter period than GEO\'s (18); beyond GEO, a longer one (3).');
    /* the lines it states are the ones orbitOf draws */
    for (const s of [HEO_ECC + ' or more', GSO_BAND * 100 + ' % of a sidereal day', 'under ' + GEO_INC_DEG + '° of inclination', 'under ' + LEO_APOGEE_KM.toLocaleString('en-US') + ' km']) {
      expect(t.note).toContain(s);
    }
  });
  it('by type and by purpose, from the table, with what it is of and the day', async () => {
    const ty = await tintFor(CAT, 'type'), pu = await tintFor(CAT, 'purpose');
    expect(ty.note).toBe('SATCAT\'s object type, as CelesTrak had it on 2026-11-20: 2,132 payloads, 6 rocket bodies, 6 pieces of debris and 14 unknown, 13 of them objects SATCAT has no record of, which SatNOGS numbers itself.');
    expect(pu.note).toBe('From the lists CelesTrak files objects in, as they were on 2026-11-20, the first that has it of: military, an operator\'s fleet (communications), '
      + 'navigation, weather and Earth resources, science, CubeSats (amateur & education), space stations (crewed), other communications, amateur radio and '
      + 'education. 1,091 are on none of them and are other or unknown: the lists hold what CelesTrak has sorted, not everything in orbit.');
    /* ...which is the bake's order of lists, by the letter each gives (fetch-satcat.js, PURPOSE): the note says it, so the two move together */
    const bake = fs.readFileSync(path.join(ROOT, 'verification', 'tools', 'fetch-satcat.js'), 'utf8');
    expect([...bake.matchAll(/^\s*\['([a-z])', \[/gm)].map(m => m[1]).join('')).toBe('mcnesahca');
    expect(ty.key.flat().map(k => k.t)).toEqual(TYPE_ROWS.flat().map(k => TYPE_NAME[k]));
    expect(pu.key.flat().map(k => k.t).sort()).toEqual(Object.values(PURPOSE_NAME).sort());
    expect(pu.key.map(r => r.map(k => k.t))).toEqual(PURPOSE_ROWS.map(r => r.map(k => PURPOSE_NAME[k])));
    const iss = at('ISS (ZARYA)');
    expect(pu.tags[iss]).toBe(' · Crewed stations');
    expect([...pu.rgb.slice(iss * 3, iss * 3 + 3)]).toEqual(rgbOf(PURPOSE_COLOUR.crew));
  });
  it('reads no table that is not this catalogue\'s: every object unknown, and says why', async () => {
    const other = CAT.slice(0, -1);
    for (const m of ['type', 'purpose'] as const) {
      const t = await tintFor(other, m);
      expect(t.note).toBe(STALE_NOTE);
      expect(new Set(t.tags)).toEqual(new Set([' · ' + (m === 'type' ? TYPE_NAME.unk : PURPOSE_NAME.other)]));
    }
  });
});

describe('the choice', () => {
  it('offers the one colour first, then the three classings the chunk colours', () => {
    expect(CATCOL_CHOICES.map(c => c[0])).toEqual(['one', 'orbit', 'type', 'purpose']);
  });
  /* A lazy chunk that imports a module the entry holds makes the bundler split that module out of the entry into a file of its own, which
     the first screen then fetches (CLAUDE.md): the colours' chunk is these three files and the table, and the controller asks for it by
     import() alone (its one static import of it is a type, which the build erases). */
  it('is a chunk that imports nothing the entry holds, and the entry asks for it only by import()', () => {
    const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const specs = (rel: string) => [...src(rel).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(specs('src/components/stage/catcolour.ts')).toEqual(['../../lib/catalogue/classify', '../../lib/text/catcolour-key', '../../../data/satcat.json']);
    expect(specs('src/lib/text/catcolour-key.ts')).toEqual(['../catalogue/classify']);
    expect(src('src/lib/text/catcolour-key.ts')).toMatch(/^import type \{[^}]*\} from '\.\.\/catalogue\/classify';$/m);
    expect(specs('src/lib/catalogue/classify.ts')).toEqual([]);
    const state = src('src/components/stage/globe-state.svelte.ts');
    expect([...state.matchAll(/^import (type )?[^;]*from '\.\/catcolour';$/gm)].map(m => m[1])).toEqual(['type ']);
    expect(state).toContain("import('./catcolour')");
  });
});
