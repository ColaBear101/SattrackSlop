import { describe, expect, it } from 'vitest';
import { cellReachKm, fromLocator, locatorPart, siteLocator, toLocator, LOCATOR } from '../../src/lib/maidenhead';
import * as shape from '../../src/lib/gridshape';
import { gridShaped } from '../../src/lib/gridshape';
import * as kit from '../../src/lib/text/grid';
import { GRID_PLACES_HINT, gridHitLine, gridOffer, gridPartial, gridPlacesLabel } from '../../src/lib/text/grid';
import { gridUnread, SEARCH_TITLE } from '../../src/lib/text/site';

/* The Maidenhead locator (CHANGES-FROM-LEGACY.md, L51). The expected locators are worked by hand from the IARU definition, not
   taken from the code: field A-R of 20° of longitude by 10° of latitude counted from 180° W and 90° S, square 0-9 of 2° by 1°,
   subsquare a-x of 5' by 2.5', extended square 0-9 of 0.5' by 0.25', longitude first in each pair. */

describe('toLocator', () => {
  it('puts Bangkok (13.7563° N, 100.5018° E) in OK03gs', () => {
    /* 280.5018° east of 180° W: field 14 (O), 0.5018° into it is square 0, 30.1' into that is subsquare 6 (g), 0.1' is extended 0.
       103.7563° north of 90° S: field 10 (K), square 3, 45.4' is subsquare 18 (s), 1.5 quarter-minutes is extended 1. */
    expect(toLocator(13.7563, 100.5018)).toBe('OK03gs');
    expect(toLocator(13.7563, 100.5018, 2)).toBe('OK03');
    expect(toLocator(13.7563, 100.5018, 4)).toBe('OK03gs01');
    expect(toLocator(13.7563, 100.5018, 1)).toBe('OK');
  });
  it('agrees with squares any operator would know', () => {
    expect(toLocator(13.75, 100.52)).toBe('OK03gs');               // the page's default site, on the subsquare's south edge
    expect(toLocator(51.50853, -0.12574)).toBe('IO91wm');           // London
    expect(toLocator(41.7148, -72.7272)).toBe('FN31pr');            // W1AW, Newington, Connecticut
    expect(toLocator(-33.8688, 151.2093)).toBe('QF56od');           // Sydney: south and east
    expect(toLocator(-34.6037, -58.3816)).toBe('GF05tj');           // Buenos Aires: south and west
    expect(toLocator(35.6895, 139.69171)).toBe('PM95uq');           // Tokyo
  });
  it('counts a cell edge in the cell it opens, the same way at every level', () => {
    expect(toLocator(13.75, 100.5)).toBe('OK03gs');                 // both edges of the subsquare's south-west corner
    expect(toLocator(13.75 - 1e-9, 100.5 - 1e-9)).toBe('OK03fr');
    expect(toLocator(0, 0, 4)).toBe('JJ00aa00');
    expect(toLocator(-1e-9, -1e-9, 4)).toBe('II99xx99');
  });
  it('holds the poles and the antimeridian just inside the globe: there is no nineteenth field', () => {
    expect(toLocator(90, 0)).toBe('JR09ax');
    expect(toLocator(-90, 0)).toBe('JA00aa');
    expect(toLocator(0, 180)).toBe('RJ90xa');
    expect(toLocator(0, -180)).toBe('AJ00aa');
    expect(toLocator(90, 180, 4)).toBe('RR99xx99');
    expect(toLocator(-90, -180, 4)).toBe('AA00aa00');
    expect(toLocator(89.9999, 179.9999)).toBe('RR99xx');
  });
  it('answers null for a position that is not one, or a length it does not have', () => {
    for (const [lat, lon] of [[NaN, 0], [0, NaN], [Infinity, 0], [90.0001, 0], [-90.0001, 0], [0, 180.0001], [0, -180.0001]])
      expect(toLocator(lat!, lon!)).toBeNull();
    for (const p of [0, 5, 2.5, -1]) expect(toLocator(0, 0, p)).toBeNull();
  });
});

describe('fromLocator', () => {
  it('reads OK03gs as its centre and its size', () => {
    const c = fromLocator('OK03gs')!;
    expect(c.locator).toBe('OK03gs');
    /* subsquare g of square 0 of field O starts 6 x 5' east of 100° E; s of square 3 of field K starts 18 x 2.5' north of 13° N */
    expect(c.lon).toBeCloseTo(100 + 6 * 5 / 60 + 2.5 / 60, 12);
    expect(c.lat).toBeCloseTo(13 + 18 * 2.5 / 60 + 1.25 / 60, 12);
    expect(c.halfLonDeg).toBeCloseTo(2.5 / 60, 15);
    expect(c.halfLatDeg).toBeCloseTo(1.25 / 60, 15);
  });
  it('takes 4, 6 and 8 characters, each a cell of the one before', () => {
    const [a, b, d] = ['OK03', 'OK03gs', 'OK03gs01'].map(s => fromLocator(s)!);
    expect([a!.lat, a!.lon, a!.halfLatDeg, a!.halfLonDeg]).toEqual([13.5, 101, 0.5, 1]);
    expect(b!.halfLatDeg * 24).toBeCloseTo(a!.halfLatDeg, 15);
    expect(d!.halfLonDeg * 10).toBeCloseTo(b!.halfLonDeg, 15);
    for (const [inner, outer] of [[b!, a!], [d!, b!]]) {
      expect(Math.abs(inner.lat - outer.lat)).toBeLessThan(outer.halfLatDeg);
      expect(Math.abs(inner.lon - outer.lon)).toBeLessThan(outer.halfLonDeg);
    }
  });
  it('does not care about case or the space round it, and writes the result the conventional way', () => {
    for (const s of ['ok03gs', 'OK03GS', 'oK03gS', '  OK03gs\t']) expect(fromLocator(s)?.locator).toBe('OK03gs');
    expect(fromLocator('io91WM05')?.locator).toBe('IO91wm05');
  });
  it('is not fooled by things that are not locators', () => {
    for (const s of ['', ' ', 'O', 'OK', 'OK0', 'OK03g', 'OK03gs0', 'OK03gs012', 'OK03gs01a', 'OK03gs01ab', 'SK03', 'OS03',
      'OK03ys', 'OK03gy', '0K03', 'OK3', 'OK 03', 'OK03 gs', 'Tokyo', 'London', '13.75,100.52', 'OK०३'])
      expect(fromLocator(s), JSON.stringify(s)).toBeNull();
    expect(fromLocator(undefined as unknown as string)).toBeNull();
    expect(fromLocator(null as unknown as string)).toBeNull();
  });
  it('answers the far corners', () => {
    const ne = fromLocator('RR99xx99')!, sw = fromLocator('AA00aa00')!;
    expect(ne.lat + ne.halfLatDeg).toBeCloseTo(90, 12);
    expect(ne.lon + ne.halfLonDeg).toBeCloseTo(180, 12);
    expect(sw.lat - sw.halfLatDeg).toBeCloseTo(-90, 12);
    expect(sw.lon - sw.halfLonDeg).toBeCloseTo(-180, 12);
  });
});

describe('the round trip', () => {
  /* a fixed spread of positions, poles and the antimeridian included: no randomness, so a failure names its input */
  const points: [number, number][] = [[90, 180], [-90, -180], [0, 0], [13.7563, 100.5018], [-77.85, 166.67], [64.84, -147.72]];
  for (let i = 0; i < 400; i++) points.push([((i * 7919) % 18001) / 100 - 90, ((i * 104729) % 36001) / 100 - 180]);

  it('puts every position inside the square its locator names, at every length', () => {
    for (const [lat, lon] of points) for (const p of [2, 3, 4]) {
      const loc = toLocator(lat, lon, p)!, c = fromLocator(loc)!;
      expect(c.locator, loc).toBe(loc);
      expect(Math.abs(lat - c.lat), loc).toBeLessThanOrEqual(c.halfLatDeg + 1e-12);
      expect(Math.abs(lon - c.lon), loc).toBeLessThanOrEqual(c.halfLonDeg + 1e-12);
    }
  });
  it('gives the centre of a square back the same square', () => {
    for (const [lat, lon] of points) for (const p of [2, 3, 4]) {
      const loc = toLocator(lat, lon, p)!, c = fromLocator(loc)!;
      expect(toLocator(c.lat, c.lon, p)).toBe(loc);
    }
  });
});

describe('locatorPart', () => {
  it('knows a locator caught half way through its last pair, and nothing else', () => {
    for (const s of ['OK03g', 'ok03G', 'OK03gs0', ' OK03g ']) expect(locatorPart(s), s).toBe(true);
    for (const s of ['O', 'OK', 'OK0', 'OK03', 'OK03gs', 'OK03gs01', 'OK03y', 'Tokyo', 'BN11', 'SW1A']) expect(locatorPart(s), s).toBe(false);
  });
  it('knows one with a fifth pair, which the page does not read, typed or half typed', () => {
    /* a GPS or a logger can give ten characters, a square about 40 m by 20 m: it must not reach the place search */
    for (const s of ['OK03gs01a', 'OK03gs01ab', 'ok03GS01AB', ' IO91wm05xx ']) expect(locatorPart(s), s).toBe(true);
    for (const s of ['OK03gs01y', 'OK03gs01ay', 'OK03gs01a1', 'OK03gs01ab2', 'OK03gs01abc']) expect(locatorPart(s), s).toBe(false);
  });
  it('and a whole locator is never also a part one', () => {
    for (const s of ['OK03', 'OK03gs', 'OK03gs01']) expect(LOCATOR.test(s) && !locatorPart(s)).toBe(true);
  });
});

describe('gridShaped, the shape the entry knows before the code that reads a square has come', () => {
  it('is every locator the page reads, and every one it holds back', () => {
    for (const s of ['OK03', 'OK03gs', 'OK03gs01', 'OK03g', 'OK03gs0', 'OK03gs01a', 'OK03gs01ab', ' ok03gs ', 'BN11'])
      expect(gridShaped(s), s).toBe(true);
    for (const s of ['', 'OK', 'OK0', 'OK03gs01abc', 'SK03', 'Tokyo', 'SW1A', '13.75,100.52', 'OK 03'])
      expect(gridShaped(s), s).toBe(false);
    expect(gridShaped(undefined as unknown as string)).toBe(false);
  });
  it('agrees with the code that reads a square: shaped is read or held back, never sent unasked', () => {
    const samples = ['OK03', 'OK03gs', 'OK03gs01', 'OK03g', 'OK03gs0', 'OK03gs01a', 'OK03gs01ab', 'OK03gs01abc', 'OK',
      'Tokyo', 'BN11', 'SW1A', 'RR99xx99', 'SS00', 'AA00aa00aa'];
    for (const s of samples) expect(gridShaped(s), s).toBe(fromLocator(s) !== null || locatorPart(s));
  });
  it('is one pattern, not two copies: the chunk reads with the very patterns the entry holds', () => {
    expect(LOCATOR).toBe(shape.LOCATOR);
  });
});

describe('siteLocator, the square at the head of the form', () => {
  it('is the six characters of the square a site is in', () => {
    expect(siteLocator({ name: 'Bangkok', lat: 13.75, lon: 100.52 })).toEqual({ locator: 'OK03gs', given: false });
  });
  it('is the square a site was picked as, as long as it was given, while the site is that square\'s centre', () => {
    /* OK03's centre, 13.5° N 101° E, is the corner of OK03ll, lm, ml and mm: worked out again it would be OK03mm, only
       because an edge is counted in the cell it opens, a subsquare the reader never gave */
    expect(toLocator(13.5, 101)).toBe('OK03mm');
    const four = fromLocator('OK03')!, eight = fromLocator('OK03gs01')!, six = fromLocator('OK03gs')!;
    expect(siteLocator({ name: 'OK03', lat: four.lat, lon: four.lon })).toEqual({ locator: 'OK03', given: true });
    expect(siteLocator({ name: 'OK03gs01', lat: eight.lat, lon: eight.lon })).toEqual({ locator: 'OK03gs01', given: true });
    expect(siteLocator({ name: 'OK03gs', lat: six.lat, lon: six.lon })).toEqual({ locator: 'OK03gs', given: true });
    expect(siteLocator({ name: 'ok03', lat: 13.5, lon: 101 })).toEqual({ locator: 'OK03', given: true });
  });
  it('is the six characters again once the site has moved off that centre, or is named otherwise', () => {
    expect(siteLocator({ name: 'OK03', lat: 13.75, lon: 100.52 })).toEqual({ locator: 'OK03gs', given: false });
    expect(siteLocator({ name: 'Somewhere', lat: 13.5, lon: 101 })).toEqual({ locator: 'OK03mm', given: false });
    expect(siteLocator({ lat: 13.75, lon: 100.52 })).toEqual({ locator: 'OK03gs', given: false });
    expect(siteLocator({ name: 'OK03', lat: NaN, lon: 101 })).toBeNull();
  });
});

describe('cellReachKm', () => {
  it('is half a square each way: 55.6 km north and south everywhere, 111 km east and west at the equator', () => {
    const r = cellReachKm(fromLocator('JJ00')!);                   // centred on 0.5° N, 1° E
    expect(r.ns).toBeCloseTo(Math.PI * 6371 / 360, 9);
    expect(r.ew).toBeCloseTo(Math.PI * 6371 / 180 * Math.cos(0.5 * Math.PI / 180), 9);
  });
  it('narrows east to west with latitude', () => {
    expect(cellReachKm(fromLocator('JR09')!).ew).toBeLessThan(cellReachKm(fromLocator('JJ00')!).ew / 10);
  });
});

describe('what the page says about a grid square', () => {
  it('the result line: what it is, how big, and where its centre is', () => {
    expect(gridHitLine(fromLocator('OK03gs')!)).toBe('Maidenhead grid square, 9.0 km × 4.6 km · 13.77° N 100.54° E');
    expect(gridHitLine(fromLocator('OK03')!)).toBe('Maidenhead grid square, 216 km × 111 km · 13.50° N 101.00° E');
    expect(gridHitLine(fromLocator('OK03gs01')!)).toBe('Maidenhead grid square, 900 m × 460 m · 13.76° N 100.50° E');
  });
  it('a square at a pole is a few metres wide at its centre, not nought', () => {
    /* JA00aa's centre is 1.25' from the South Pole: 9.27 km of longitude there is cos(89.979°) of it, 3.4 m */
    expect(gridHitLine(fromLocator('JA00aa')!)).toBe('Maidenhead grid square, 3 m × 4.6 km · 89.98° S 0.04° E');
    expect(gridHitLine(fromLocator('JR09ax')!)).toBe('Maidenhead grid square, 3 m × 4.6 km · 89.98° N 0.04° E');
    /* ...and an eight-character square there is 3.4 cm */
    expect(gridHitLine(fromLocator('JA00aa00')!)).toMatch(/^Maidenhead grid square, under 1 m × 460 m · /);
    expect(gridHitLine(fromLocator('JA00ac')!)).toBe('Maidenhead grid square, 17 m × 4.6 km · 89.90° S 0.04° E');
  });
  it('the offer says that it asked nobody, how far a corner is, and what is assumed', () => {
    /* a corner of OK03gs is 4.50 km east and 2.32 km north of its centre: 5.06 km */
    expect(gridOffer(fromLocator('OK03gs')!)).toBe('OK03gs is a Maidenhead grid square, found on this page with no request. Its centre'
      + ' stands for all of it: a station in a corner is 5.1 km from it, and two more characters narrow it 10 times each way. Picked,'
      + ' the ground is taken as sea level and the offset as the nearest hour of solar time; correct either under Enter coordinates.');
    /* ...of OK03, 108.1 km and 55.6 km: 121.6 km */
    expect(gridOffer(fromLocator('OK03')!)).toBe('OK03 is a Maidenhead grid square, 2° of longitude by 1° of latitude, found on this page'
      + ' with no request. Its centre stands for all of it: a station in a corner is 122 km from it, and two more characters narrow it'
      + ' 24 times each way. Picked, the ground is taken as sea level and the offset as the nearest hour of solar time; correct either'
      + ' under Enter coordinates.');
    const eight = gridOffer(fromLocator('OK03gs01')!);
    expect(eight).toMatch(/a station in a corner is 510 m from it\. Picked,/);
    expect(eight).not.toMatch(/two more characters/);
  });
  it('a half-typed square, and the way to the place search under a four-character one', () => {
    expect(gridPartial('OK03g')).toBe('OK03g is the start of a Maidenhead grid square, which has 4, 6 or 8 characters. It is not sent to'
      + ' the place search.');
    expect(gridPartial('ok03gs01ab')).toBe('ok03gs01ab has more characters than this page reads: a Maidenhead grid square here has 4, 6'
      + ' or 8. Type its first 8, OK03gs01, for the square it is in. It is not sent to the place search.');
    expect(gridPartial('OK03gs01a')).toMatch(/^OK03gs01a has more characters than this page reads: .* Type its first 8, OK03gs01,/);
    expect(gridUnread('OK03gs')).toBe('OK03gs has the shape of a Maidenhead grid square, but the page could not load the code that'
      + ' reads one, so it is neither read nor sent to the place search. Reload the page, or enter coordinates instead.');
    expect(gridPlacesLabel('BN11')).toBe('Search places for “BN11” instead');
    expect(GRID_PLACES_HINT).toMatch(/postcode/);
  });
  it('the search field\'s title, in the entry, says it takes a square', () => {
    expect(SEARCH_TITLE).toMatch(/Maidenhead grid square of 4, 6 or 8 characters such as OK03gs/);
  });
  it('the chunk the form loads carries the code with the words: one import gives the form all it uses', () => {
    expect(kit.fromLocator).toBe(fromLocator);
    expect(kit.locatorPart).toBe(locatorPart);
    expect(kit.toLocator).toBe(toLocator);
    expect(kit.siteLocator).toBe(siteLocator);
  });
});
