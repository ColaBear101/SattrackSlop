import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/* The downlink table and the picker's other names are files of the page's own, fetched (src/lib/net/file.ts; CHANGES-FROM-LEGACY.md, L65)
   rather than imported as chunks: a browser keeps a failed import() for the life of the page, so a second import() of a chunk that did
   not arrive could never ask again. Here the fetch is stood in for: it answers with the baked file, or fails the first `fail` times. */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const fileOf = (name: string) => fs.readFileSync(path.join(ROOT, 'data', name), 'utf8');
function fetcher(text: string, fail = 0) {
  let n = 0;
  return vi.fn(async (_url: string) => {
    if (++n <= fail) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => JSON.parse(text) as unknown };
  });
}
const answer = (status: number, body: unknown) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

describe('a table file of the page\'s own', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is its JSON when the answer is the table\'s shape', async () => {
    const { fetchTable } = await import('../../src/lib/net/file');
    vi.stubGlobal('fetch', answer(200, { built: 'b', tx: {} }));
    expect(await fetchTable('/t.json', 'tx')).toEqual({ built: 'b', tx: {} });
  });
  it('fails on a refusal, and on an answer that is not the table: an error page read as JSON, a field missing or not an object', async () => {
    const { fetchTable } = await import('../../src/lib/net/file');
    vi.stubGlobal('fetch', answer(404, { tx: {} }));
    await expect(fetchTable('/t.json', 'tx')).rejects.toThrow('HTTP 404');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })));
    await expect(fetchTable('/t.json', 'tx')).rejects.toThrow('Unexpected token');
    for (const bad of [null, 'tx', 5, [], {}, { a: {} }, { tx: null }, { tx: 'x' }, { tx: 1 }]) {
      vi.stubGlobal('fetch', answer(200, bad));
      await expect(fetchTable('/t.json', 'tx'), JSON.stringify(bad)).rejects.toThrow('not the table');
    }
  });
});

describe('the two tables the page loads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the downlink table: fetched from its file once for every caller, and asked for again after a failure', async () => {
    vi.resetModules();
    const fetch = fetcher(fileOf('transmitters.json'), 1);
    vi.stubGlobal('fetch', fetch);
    const { loadTransmitters } = await import('../../src/lib/data/transmitters');
    const [p, q] = [loadTransmitters(), loadTransmitters()];
    expect(p).toBe(q);
    await expect(p).rejects.toThrow('Failed to fetch');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toMatch(/transmitters[^/]*\.json$/);
    const t = await loadTransmitters();
    expect(t.forSat('01804')[0]).toMatchObject({ hz: 136981000, mode: 'USB' });
    expect(await loadTransmitters()).toBe(t);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('the other names: the same', async () => {
    vi.resetModules();
    const fetch = fetcher(fileOf('aliases.json'), 1);
    vi.stubGlobal('fetch', fetch);
    const { loadAliases } = await import('../../src/lib/data/aliases');
    await expect(loadAliases()).rejects.toThrow('Failed to fetch');
    expect(fetch.mock.calls[0]![0]).toMatch(/aliases[^/]*\.json$/);
    const a = await loadAliases();
    expect(a.a['44909']).toContain('RS-44');
    expect(await loadAliases()).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
