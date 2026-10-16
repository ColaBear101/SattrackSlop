import { describe, expect, it } from 'vitest';
import { rank } from '../../src/lib/catalogue/rank';
import { NUM, readWatch, WATCH_MAX, watchedFirst } from '../../src/lib/catalogue/watch';
import { toggleWatch } from '../../src/lib/catalogue/watch-toggle';
import { WATCH_LABEL, WATCHED } from '../../src/lib/text/watch';
import { watchFull } from '../../src/lib/text/watch-full';
import { CATALOGUE } from './helpers';

/* The watchlist (CHANGES-FROM-LEGACY.md, L60): the record as it is read, a press of the star on the list, the picker's "Watched"
   group as a wrapper around rank() (whose own order is not touched), and the words. */
const nums = (n: number, from = 10000): string[] => Array.from({ length: n }, (_, i) => String(from + i));

describe('the record', () => {
  it('is the empty list when nothing is stored', () => {
    expect(readWatch(null)).toEqual([]);
    expect(readWatch('')).toEqual([]);
    expect(readWatch('[]')).toEqual([]);
  });
  it('is the catalogue numbers it holds, in the order they were starred', () => {
    expect(readWatch('["25544","07530","43017"]')).toEqual(['25544', '07530', '43017']);
  });
  it('drops what cannot be a catalogue number, keeps a number once, and stops at the cap', () => {
    expect(readWatch(JSON.stringify(['25544', 'O0001', 25544, '123456', '', ' 25544', 'abc', null, { n: '1' }, '07530', '25544']))).toEqual(['25544', '07530']);
    expect(readWatch(JSON.stringify(nums(WATCH_MAX + 7)))).toEqual(nums(WATCH_MAX));
  });
  it('throws on a record that is not a list (the store takes it as nothing stored)', () => {
    for (const raw of ['{not json', '{}', '"25544"', '25544', 'null', 'true']) expect(() => readWatch(raw)).toThrow();
  });
  it('is the catalogue\'s own writing of a number: five digits at most, every one in this catalogue among them', () => {
    expect(WATCH_MAX).toBe(50);
    expect(CATALOGUE.every(e => NUM.test(e.satnum))).toBe(true);
    for (const n of ['O0001', 'A1234', '123456', '2554 4', '']) expect(NUM.test(n)).toBe(false);
  });
});

describe('a press of the star', () => {
  it('puts a number at the end, or takes it off, and leaves the list it was given as it was', () => {
    const list = ['25544', '07530'];
    expect(toggleWatch(list, '43017')).toEqual(['25544', '07530', '43017']);
    expect(toggleWatch(list, '25544')).toEqual(['07530']);
    expect(toggleWatch(['25544'], '25544')).toEqual([]);
    expect(list).toEqual(['25544', '07530']);
  });
  it('puts nothing on with the list full (null), and still takes one off', () => {
    const full = nums(WATCH_MAX);
    expect(toggleWatch(full, '25544')).toBeNull();
    expect(toggleWatch(full, full[3]!)).toEqual(full.filter((_, i) => i !== 3));
    expect(toggleWatch(nums(WATCH_MAX - 1), '25544')).toHaveLength(WATCH_MAX);
  });
  it('keeps nothing for what is not a catalogue number: the list itself comes back', () => {
    const list = ['25544'];
    for (const n of ['O0001', '', 'iss']) expect(toggleWatch(list, n)).toBe(list);
  });
});

describe('the picker\'s "Watched" group', () => {
  it('hands rank()\'s rows back as they are with nothing watched', () => {
    const rows = rank(CATALOGUE, '');
    expect(watchedFirst(rows, [])).toBe(rows);
  });
  it('moves the watched rows to the front, in the order they were starred, and keeps every other row in rank()\'s order', () => {
    expect(watchedFirst([4, 5, 0, 1, 2, 3], [3, 1])).toEqual([3, 1, 4, 5, 0, 2]);
    expect(watchedFirst([0, 1, 2], [2])).toEqual([2, 0, 1]);
  });
  it('on the empty query is the same rows as rank()\'s, none twice: rank() lists the whole catalogue there, so every watched row is one', () => {
    const mine = [{ name: 'My Cube' }, { name: 'Sun-sync' }];
    const rows = rank(CATALOGUE, '', mine);
    expect(rows).toHaveLength(CATALOGUE.length + mine.length);
    const iss = CATALOGUE.findIndex(e => e.name === 'ISS (ZARYA)'), last = CATALOGUE.length - 1;
    const out = watchedFirst(rows, [last, iss, 0]);
    expect(out.slice(0, 3)).toEqual([last, iss, 0]);
    expect(out.slice(3, 5)).toEqual([CATALOGUE.length, CATALOGUE.length + 1]);       // the reader's orbits next, as rank() has them
    expect([...out].sort((a, b) => a - b)).toEqual([...rows].sort((a, b) => a - b));
    expect(out.slice(3)).toEqual(rows.filter(r => ![last, iss, 0].includes(r)));
  });
});

describe('the words', () => {
  it('name the star, the group and the refusal at the cap', () => {
    expect(WATCH_LABEL).toBe('Watch');
    expect(WATCHED).toBe('Watched');
    expect(watchFull(50, 'ISS (ZARYA)')).toBe('You are watching 50 spacecraft, the most this page keeps: take the star off one of them to watch ISS (ZARYA).');
  });
});
