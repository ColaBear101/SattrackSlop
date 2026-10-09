import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* The data files are what the old page carried inline. They must be the same data. */
describe('data/ extracted from the pre-rewrite page', () => {
  const catalogue = read('data/catalogue.txt');
  const lines = catalogue.split(/\r?\n/).filter(Boolean);

  it('is byte-for-byte verification/catalog.txt, the independent copy', () => {
    expect(catalogue.replace(/\r\n/g, '\n')).toBe(read('verification/catalog.txt').replace(/\r\n/g, '\n'));
  });

  it('holds 2,158 three-line element sets with valid shapes', () => {
    expect(lines.length).toBe(2158 * 3);
    for (let i = 0; i < lines.length; i += 3) {
      expect(lines[i + 1]![0]).toBe('1');
      expect(lines[i + 2]![0]).toBe('2');
      expect(lines[i + 1]!.length).toBe(69);
      expect(lines[i + 2]!.length).toBe(69);
    }
  });

  it('has unique NORAD ids, so the id can be the entry key', () => {
    const ids = new Set<string>();
    for (let i = 1; i < lines.length; i += 3) ids.add(lines[i]!.substring(2, 7).trim());
    expect(ids.size).toBe(2158);
  });

  it('records its provenance', () => {
    const meta = JSON.parse(read('data/catalogue.meta.json'));
    expect(meta).toEqual({ fetched: '2026-09-12T17:09:02.884Z', source: 'SatNOGS DB + CelesTrak mirror', count: 2158 });
  });

  it('keeps the 127 world polygons', () => {
    const world = JSON.parse(read('data/world.json'));
    expect(world.type).toBe('FeatureCollection');
    expect(world.features.length).toBe(127);
  });

  it('keeps every transmitter record', () => {
    const t = JSON.parse(read('data/transmitters.json'));
    expect(Object.keys(t.tx).length).toBe(t.objects);
    expect(Object.values<unknown[]>(t.tx).reduce((n, l) => n + l.length, 0)).toBe(t.records);
    expect(t.objects).toBe(1213);
    expect(t.records).toBe(2037);
  });
});
