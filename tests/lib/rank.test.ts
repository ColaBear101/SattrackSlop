import { describe, expect, it } from 'vitest';
import { rank } from '../../src/lib/catalogue/rank';

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
