import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as satellite from 'satellite.js';
import { createGt } from '../../src/lib/gt';
import {
  TLE_LINE, canonicalNorad, isNewerSet, isNoGpData, isNoradId, tleEpochMs, tleFromMirrorJson, tleFromText, tleOk, tleOkForNorad
} from '../../shared/tle.js';
import { ISS, celestrakText, checksum, makeTle, mirrorJson, withChecksum } from '../server/helpers/tle.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CATALOGUE = fs.readFileSync(path.join(ROOT, 'data', 'catalogue.txt'), 'utf8');
const gt = createGt({ satellite: satellite as never, catalogueText: CATALOGUE });

/* What follows is the page's own rule, moved to shared/tle.ts (legacy/index.html 11463-11484) and pinned from every
   side the page, verify-refresh.js and verify-custom.js ever pushed on it. */

describe('tleOk - what a usable element set is', () => {
  it('accepts a real set for the number it was asked about, given as a string or a number', () => {
    expect(tleOk(ISS, '25544')).toBe(true);
    expect(tleOk(ISS, 25544)).toBe(true);
  });

  it('accepts all 2,158 sets of the embedded catalogue for their own number: it is no stricter than real data', () => {
    expect(gt.CAT.length).toBe(2158);
    const bad = gt.CAT.filter(e => !tleOk(e, e.satnum));
    expect(bad.map(e => e.name)).toEqual([]);
    // ...and tleOkForNorad takes the same sets by their canonical number, whatever zero-padding the lines carry
    expect(gt.CAT.filter(e => !tleOkForNorad(e, String(Number(e.satnum)))).map(e => e.name)).toEqual([]);
  });

  it('asks for 69 to 71 characters: 70 and 71 pass (the original range), 68 and 72 do not', () => {
    expect(ISS.l1.length).toBe(69);
    expect(tleOk({ l1: ISS.l1 + '0', l2: ISS.l2 }, '25544')).toBe(true);
    expect(tleOk({ l1: ISS.l1 + '00', l2: ISS.l2 + '00' }, '25544')).toBe(true);
    expect(tleOk({ l1: ISS.l1 + '000', l2: ISS.l2 }, '25544')).toBe(false);
    expect(tleOk({ l1: ISS.l1, l2: ISS.l2 + '000' }, '25544')).toBe(false);
    expect(tleOk({ l1: ISS.l1.slice(0, 68), l2: ISS.l2 }, '25544')).toBe(false);
    expect(tleOk({ l1: ISS.l1, l2: ISS.l2.slice(0, 68) }, '25544')).toBe(false);
  });

  it('refuses what was appended past the end of a line - the hole the old check left (line 1 only had a minimum)', () => {
    const long = ISS.l1 + ' ' + 'x'.repeat(40);
    expect(tleOk({ l1: long, l2: ISS.l2 }, '25544')).toBe(false);
    // the old check: l1.length >= 69 and the number matches. It would have taken this.
    expect(long.length >= 69 && long.substring(2, 7).trim() === '25544').toBe(true);
  });

  it('asks the same of line 2 as of line 1 (the old check asked nothing of it)', () => {
    expect(tleOk({ l1: ISS.l1, l2: 'garbage' }, '25544')).toBe(false);
    expect(tleOk({ l1: ISS.l1, l2: ISS.l2 + 'y'.repeat(40) }, '25544')).toBe(false);
  });

  it('allows only printable ASCII: no tab, DEL, NUL, accents, no-break space, and no line ending left on', () => {
    const swap = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i + 1);
    for (const c of ['\t', '\x7f', '\x00', 'é', ' ', '–', '\r', '\n']) {
      expect(tleOk({ l1: swap(ISS.l1, 30, c), l2: ISS.l2 }, '25544'), JSON.stringify(c) + ' in line 1').toBe(false);
      expect(tleOk({ l1: ISS.l1, l2: swap(ISS.l2, 30, c) }, '25544'), JSON.stringify(c) + ' in line 2').toBe(false);
    }
    expect(tleOk({ l1: ISS.l1 + '\r', l2: ISS.l2 }, '25544')).toBe(false);   // a 70-character line only because of its CR
    expect(tleOk({ l1: ISS.l1 + '\n', l2: ISS.l2 }, '25544')).toBe(false);
    expect(TLE_LINE.test(ISS.l1)).toBe(true);                                // control: the regex itself accepts a clean line
  });

  it('wants the number on BOTH lines, and it has to be the one asked for', () => {
    const other = makeTle(25545, tleEpochMs(ISS.l1));
    expect(tleOk({ l1: other.l1, l2: other.l2 }, '25545')).toBe(true);        // control: a consistent pair for 25545
    expect(tleOk({ l1: other.l1, l2: other.l2 }, '25544')).toBe(false);       // right shape, wrong object
    expect(tleOk({ l1: ISS.l1, l2: other.l2 }, '25544')).toBe(false);         // line 2 of another object
    expect(tleOk({ l1: other.l1, l2: ISS.l2 }, '25544')).toBe(false);         // line 1 of another object
  });

  it('compares the number as the lines spell it: "01804" is not "1804" (the catalogue asks with the line\'s own spelling)', () => {
    const alouette = gt.CAT.find(e => e.name === 'ALOUETTE 2')!;
    expect(alouette.satnum).toBe('01804');
    expect(tleOk(alouette, '01804')).toBe(true);
    expect(tleOk(alouette, '1804')).toBe(false);
    expect(tleOk(alouette, 1804)).toBe(false);
  });

  it('tleOkForNorad accepts either spelling of the same number, and only that number', () => {
    const alouette = gt.CAT.find(e => e.name === 'ALOUETTE 2')!;
    expect(tleOkForNorad(alouette, '1804')).toBe(true);
    expect(tleOkForNorad(alouette, '1805')).toBe(false);
    expect(tleOkForNorad(alouette, '18040')).toBe(false);          // a prefix is not the number
    expect(tleOkForNorad(ISS, '25544')).toBe(true);
    // a space-padded number (never what a TLE does, but the original would have accepted it for the unpadded ask)
    const spaced = { l1: ISS.l1.substring(0, 2) + ' 1804' + ISS.l1.substring(7), l2: ISS.l2.substring(0, 2) + ' 1804' + ISS.l2.substring(7) };
    expect(tleOk(spaced, '1804')).toBe(true);
    expect(tleOkForNorad(spaced, '1804')).toBe(true);
  });

  it('refuses a record that is not two strings', () => {
    for (const rec of [null, undefined, {}, { l1: ISS.l1 }, { l2: ISS.l2 }, { l1: 1, l2: 2 }, { l1: null, l2: ISS.l2 },
      { l1: ISS.l1, l2: ['2 25544'] }, { l1: new String(ISS.l1), l2: ISS.l2 }]) {
      expect(tleOk(rec as never, '25544'), JSON.stringify(rec)).toBe(false);
    }
  });

  it('is what the page said it was and not more: no checksum test and no "1 "/"2 " test (legacy behaviour, kept)', () => {
    // The original's network and cache paths asked for neither. The planner checks checksums for the orbits a reader
    // designs ("the checksum they never asked for", index.html 10972); a reply from CelesTrak was never held to it.
    const badSum = { l1: ISS.l1.slice(0, 68) + String((Number(ISS.l1[68]) + 1) % 10), l2: ISS.l2 };
    expect(checksum(badSum.l1)).not.toBe(Number(badSum.l1[68]));
    expect(tleOk(badSum, '25544')).toBe(true);
    const noLineNumbers = { l1: 'X' + ISS.l1.slice(1), l2: 'Y' + ISS.l2.slice(1) };
    expect(tleOk(noLineNumbers, '25544')).toBe(true);
  });

  it('works on the manufactured sets verify-refresh.js uses: the epoch moved a day either way, checksums recomputed', () => {
    const base = tleEpochMs(ISS.l1);
    for (const days of [1, -3, 0]) {
      const t = makeTle(25544, base + days * 86400000);
      expect(tleOk(t, '25544'), 'epoch ' + days + ' d').toBe(true);
      expect(Math.abs(tleEpochMs(t.l1) - (base + days * 86400000))).toBeLessThan(1);
      expect(checksum(t.l1)).toBe(Number(t.l1[68]));
      expect(checksum(t.l2)).toBe(Number(t.l2[68]));
    }
    // the later set with the orbit inside the Earth (verify-refresh phase 7) is still a well-formed element set:
    // SGP4 refuses it in the browser, not here
    expect(tleOk(makeTle(25544, base + 86400000, { meanMotion: 17.5 }), '25544')).toBe(true);
  });
});

describe('isNoradId / canonicalNorad - the digits guard', () => {
  it('passes one to five digits, as a string or a number', () => {
    for (const n of ['25544', 25544, '0', '00001', '1', '99999', 7]) expect(isNoradId(n), String(n)).toBe(true);
  });

  it('refuses everything verify-custom group 11 throws at fetchTLE, and a little more', () => {
    for (const n of ['O0001', 'O1', '25544x', '123456', ' 25544', '', null, undefined, '25544\n', '2554 4',
      '-1', '1e3', '0x1f', '٢٥٥٤٤', '１２３', '25544\u0000', '25/44', '../1', {}, NaN, 123456, -5, 1.5]) {
      expect(isNoradId(n), JSON.stringify(n)).toBe(false);
    }
  });

  it('coerces as the original did: String(x) is what is tested', () => {
    expect(isNoradId(['25544'])).toBe(true);                        // String(['25544']) === '25544'
    expect(isNoradId({ toString: () => '25544' })).toBe(true);
  });

  it('canonicalNorad is the numeric value, so "01804" and "1804" are one object', () => {
    expect(canonicalNorad('01804')).toBe('1804');
    expect(canonicalNorad('1804')).toBe('1804');
    expect(canonicalNorad('25544')).toBe('25544');
    expect(canonicalNorad('00000')).toBe('0');
    expect(canonicalNorad('99999')).toBe('99999');
  });

  it('canonicalNorad refuses what is not one to five digits', () => {
    for (const n of ['', 'abc', '123456', '-1', ' 1', '1 ', '1\n', 25544, null, undefined, '٢']) {
      expect(canonicalNorad(n), JSON.stringify(n)).toBeNull();
    }
  });
});

describe('tleFromText - CelesTrak\'s reply', () => {
  const t = makeTle(25544, tleEpochMs(ISS.l1));

  it('finds the pair behind a name line, whichever way the lines end', () => {
    for (const eol of ['\r\n', '\n']) {
      const body = 'ISS (ZARYA)             ' + eol + t.l1 + eol + t.l2 + eol;
      expect(tleFromText(body)).toEqual({ l1: t.l1, l2: t.l2 });
    }
    expect(tleFromText(celestrakText('ISS (ZARYA)', t))).toEqual({ l1: t.l1, l2: t.l2 });
  });

  it('works with no name line, and strips trailing spaces from the lines', () => {
    expect(tleFromText(t.l1 + '\n' + t.l2)).toEqual({ l1: t.l1, l2: t.l2 });
    expect(tleFromText(t.l1 + '   \r\n' + t.l2 + '\t \r\n')).toEqual({ l1: t.l1, l2: t.l2 });
  });

  it('finds nothing in an error page, an empty body, "No GP data found", or a pair that is out of order', () => {
    for (const body of ['', '   ', 'No GP data found', '<html><body>404 Not Found</body></html>', 'ISS\n' + t.l2 + '\n' + t.l1 + '\n',
      t.l1 + '\n\n' + t.l2, t.l1, t.l2, 'a\nb\nc']) {
      expect(tleFromText(body), JSON.stringify(body.slice(0, 30))).toBeNull();
    }
  });

  it('takes the first pair when there are several, and needs both lines to be consecutive', () => {
    const t2 = makeTle(25545, tleEpochMs(ISS.l1));
    expect(tleFromText(celestrakText('A', t) + celestrakText('B', t2))).toEqual({ l1: t.l1, l2: t.l2 });
    expect(tleFromText(t.l1 + '\nnoise\n' + t.l2)).toBeNull();
  });

  it('does not look at what the lines say: a pair for another object is still a pair (tleOk is the judge of that)', () => {
    const other = makeTle(11111, tleEpochMs(ISS.l1));
    expect(tleFromText(other.l1 + '\n' + other.l2)).toEqual({ l1: other.l1, l2: other.l2 });
  });
});

describe('tleFromMirrorJson - the mirror\'s reply', () => {
  const t = makeTle(25544, tleEpochMs(ISS.l1));

  it('reads line1 and line2 out of the JSON whatever else it carries', () => {
    expect(tleFromMirrorJson(mirrorJson('ISS', t, 25544))).toEqual({ l1: t.l1, l2: t.l2 });
  });

  it('is null for a missing line, not JSON, null, an array, a number, and an empty line', () => {
    for (const body of [JSON.stringify({ line1: t.l1 }), JSON.stringify({ line2: t.l2 }), 'not json', '', 'null', '[]', '7',
      JSON.stringify({ line1: '', line2: t.l2 }), '<html>', '{"line1": ']) {
      expect(tleFromMirrorJson(body), body.slice(0, 30)).toBeNull();
    }
  });

  it('passes a non-string line through for tleOk to refuse (this only reads, it does not judge)', () => {
    const got = tleFromMirrorJson(JSON.stringify({ line1: 5, line2: ['x'] }));
    expect(got).toEqual({ l1: 5, l2: ['x'] });
    expect(tleOk(got, '25544')).toBe(false);
  });
});

describe('isNoGpData - a withdrawal is read before the status, as text', () => {
  it('matches CelesTrak\'s answer, in any case, anywhere in the body', () => {
    for (const body of ['No GP data found', 'no gp data found', 'NO GP DATA FOUND', '<p>Error: No GP data found for 1.</p>', '\n  No GP data found\n']) {
      expect(isNoGpData(body), body).toBe(true);
    }
  });

  it('does not match an ordinary outage, an error page, or a TLE', () => {
    for (const body of ['', 'Service Unavailable', '<html>500</html>', 'Not found', 'No data', celestrakText('X', ISS)]) {
      expect(isNoGpData(body), body.slice(0, 30)).toBe(false);
    }
  });
});

describe('tleEpochMs / isNewerSet - forward only', () => {
  const at = (year: number, doy: string) => ISS.l1.substring(0, 18) + String(year % 100).padStart(2, '0') + doy + ISS.l1.substring(32);

  it('is the epoch of line 1 exactly as elements() computes it, for every set of the catalogue', () => {
    let worst = 0;
    for (const e of gt.CAT) {
      const ref = gt.elements(e.l1, e.l2).epoch.getTime();
      worst = Math.max(worst, Math.abs(tleEpochMs(e.l1) - ref));
      expect(tleEpochMs(e.l1), e.name).toBe(ref);
    }
    expect(worst).toBe(0);
  });

  it('puts the two-digit year on the page\'s pivot: 57-99 is the 1900s, 00-56 the 2000s', () => {
    expect(tleEpochMs(at(57, '001.00000000'))).toBe(Date.UTC(1957, 0, 1));
    expect(tleEpochMs(at(98, '001.00000000'))).toBe(Date.UTC(1998, 0, 1));
    expect(tleEpochMs(at(99, '001.00000000'))).toBe(Date.UTC(1999, 0, 1));
    expect(tleEpochMs(at(0, '001.00000000'))).toBe(Date.UTC(2000, 0, 1));
    expect(tleEpochMs(at(26, '001.00000000'))).toBe(Date.UTC(2026, 0, 1));
    expect(tleEpochMs(at(56, '001.00000000'))).toBe(Date.UTC(2056, 0, 1));
  });

  it('counts the day of the year from 1, with its fraction, and a leap year has a day 366', () => {
    expect(tleEpochMs(at(26, '001.50000000'))).toBe(Date.UTC(2026, 0, 1, 12));
    expect(tleEpochMs(at(26, '032.00000000'))).toBe(Date.UTC(2026, 1, 1));
    expect(tleEpochMs(at(24, '366.00000000'))).toBe(Date.UTC(2024, 11, 31));
    expect(tleEpochMs(at(26, '365.99999999'))).toBe(Date.UTC(2026, 11, 31, 23, 59, 59, 999));
  });

  it('is a whole number of milliseconds, like the Date elements() builds - and a bare float sum would not be', () => {
    const l1 = ISS.l1;
    const yy = parseInt(l1.substring(18, 20), 10), doy = parseFloat(l1.substring(20, 32));
    const bare = Date.UTC(2000 + yy, 0, 1) + (doy - 1) * 86400000;
    expect(Number.isInteger(bare)).toBe(false);                      // control: the raw sum has a fraction of a millisecond
    expect(Number.isInteger(tleEpochMs(l1))).toBe(true);
    expect(tleEpochMs(l1)).toBe(Math.trunc(bare));
  });

  it('says "newer" only for a strictly later epoch', () => {
    const base = tleEpochMs(ISS.l1);
    const later = makeTle(25544, base + 86400000), earlier = makeTle(25544, base - 3 * 86400000);
    expect(isNewerSet(later, ISS)).toBe(true);
    expect(isNewerSet(earlier, ISS)).toBe(false);                    // verify-refresh phase 4: an older set is refused
    expect(isNewerSet(ISS, ISS)).toBe(false);                        // the same set is "confirmed current", not newer
  });

  it('two epochs less than a millisecond apart are the same epoch, as they were for the page', () => {
    const a = { l1: at(26, '100.00000000') }, b = { l1: at(26, '100.00000001') };   // 0.864 ms apart
    expect(parseFloat(b.l1.substring(20, 32)) > parseFloat(a.l1.substring(20, 32))).toBe(true);   // control: a float compare calls b newer
    expect(isNewerSet(b, a)).toBe(false);
    expect(tleEpochMs(a.l1)).toBe(tleEpochMs(b.l1));
    expect(isNewerSet({ l1: at(26, '100.00000002') }, a)).toBe(true); // 1.7 ms apart: a different millisecond
  });

  it('an epoch that is not a date is never newer, and is NaN', () => {
    const junk = { l1: ISS.l1.substring(0, 18) + 'ab' + 'xxxxxxxxxxxx' + ISS.l1.substring(32) };
    expect(Number.isNaN(tleEpochMs(junk.l1))).toBe(true);
    expect(isNewerSet(junk, ISS)).toBe(false);
    expect(isNewerSet(ISS, junk)).toBe(false);
  });
});

describe('the fixtures themselves', () => {
  it('makeTle writes a checksum that is correct, and withChecksum agrees with the catalogue\'s own', () => {
    for (const e of gt.CAT.slice(0, 200)) {
      expect(checksum(e.l1), e.name).toBe(Number(e.l1[68]));
      expect(withChecksum(e.l2.slice(0, 68))).toBe(e.l2);
    }
  });
});
