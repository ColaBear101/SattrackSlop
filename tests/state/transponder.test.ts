import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/* The transponder calculator's store (CHANGES-FROM-LEGACY.md, L63), src/state/transponder.svelte.ts, on watch.test.ts's pattern: the offsets
   are read from gt.xpdr (made safe) when the store first loads, which is when the panel is first opened, and written only by setOffset, the
   Set offset and Reset presses; loading, fetching the table, choosing, holding, nudging and typing write nothing; the last offset taken out
   removes the key; a browser that refuses storage keeps the offset for the visit and says so; another tab's change is heard through the
   storage event. The table is the baked file, handed to a fetch stood in for here (the page fetches it: a browser keeps a failed import()
   for the life of the page, so Try again could not ask again). Each test loads the store afresh over a window of its own. */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FILE = fs.readFileSync(path.join(ROOT, 'data', 'transponders.json'), 'utf8');

type Store = { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
function storage(init: Record<string, string> = {}, refuse = false): Store {
  const m = new Map(Object.entries(init));
  return {
    getItem: vi.fn((k: string) => (m.has(k) ? m.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => { if (refuse) throw new DOMException('full', 'QuotaExceededError'); m.set(k, String(v)); }),
    removeItem: vi.fn((k: string) => { m.delete(k); })
  };
}
type Heard = (e: { key: string | null }) => void;
function win(localStorage: Store | null) {
  const heard: Heard[] = [];
  const w: Record<string, unknown> = { addEventListener: vi.fn((type: string, f: Heard) => { if (type === 'storage') heard.push(f); }) };
  if (localStorage) w.localStorage = localStorage;
  else Object.defineProperty(w, 'localStorage', { get() { throw new DOMException('no', 'SecurityError'); } });
  return { w, heard };
}
/** a fetch that answers with the baked file, or fails the first `fail` times */
function fetcher(fail = 0) {
  let n = 0;
  return vi.fn(async () => {
    if (++n <= fail) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => JSON.parse(FILE) as unknown };
  });
}
async function load(localStorage: Store | null, fetch = fetcher()) {
  vi.resetModules();
  const { w, heard } = win(localStorage);
  vi.stubGlobal('window', w);
  vi.stubGlobal('fetch', fetch);
  const { xpdr, XPDR_KEY } = await import('../../src/state/transponder.svelte');
  return { xpdr, XPDR_KEY, heard, fetch };
}
const JAS2 = { satnum: '24278' }, QO100 = { satnum: '43700' }, OSCAR7 = { satnum: '07530' };
const wrote = (st: Store) => st.setItem.mock.calls.length + st.removeItem.mock.calls.length;

describe('the transponder store', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads gt.xpdr when it first loads, made safe, and writes nothing for having read it', async () => {
    const st = storage({ 'gt.xpdr': '{"24278":400,"07530":5,"7530":-1200,"43700":"9","99999":70000,"x":1,"25544":0}' });
    const { xpdr, XPDR_KEY, fetch } = await load(st);
    expect(XPDR_KEY).toBe('gt.xpdr');
    expect(st.getItem).toHaveBeenCalledWith('gt.xpdr');
    expect(xpdr.offsets).toEqual({ 24278: 400, 7530: -1200, 99999: 50000 });
    expect(xpdr.offsetFor('24278')).toBe(400);
    expect(xpdr.offsetFor('07530')).toBe(-1200);           // the catalogue's own field for OSCAR 7
    expect(xpdr.offsetFor('O0001')).toBe(0);
    expect(fetch).not.toHaveBeenCalled();                    // the table is fetched when the panel asks, not when the store loads
    expect(wrote(st)).toBe(0);
  });

  it('with nothing stored, or a record that is not one, keeps no offsets and leaves the record alone', async () => {
    for (const init of [{}, { 'gt.xpdr': '{not json' }, { 'gt.xpdr': '[400]' }, { 'gt.xpdr': '"400"' }]) {
      const st = storage(init);
      const { xpdr } = await load(st);
      expect(xpdr.offsets).toEqual({});
      expect(wrote(st)).toBe(0);
    }
  });

  it('fetches the table once, lists a spacecraft\'s records, and none for the reader\'s own orbit even with a real NORAD number', async () => {
    const st = storage();
    const { xpdr, fetch } = await load(st);
    expect(xpdr.list(JAS2)).toEqual([]);                     // before the table has come
    await Promise.all([xpdr.ensure(), xpdr.ensure()]);
    await xpdr.ensure();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(xpdr.table!.records).toBe(71);
    expect(xpdr.list(JAS2).map(t => [t.ulLo, t.dlHi, t.inv])).toEqual([[145_900_000, 435_900_000, true]]);
    expect(xpdr.list(OSCAR7)).toHaveLength(3);
    expect(xpdr.list({ satnum: '24278', custom: true })).toEqual([]);    // custom.svelte.ts takes the number from a pasted line 1
    expect(xpdr.list({ satnum: 'O0001', custom: true })).toEqual([]);
    expect(xpdr.list(null)).toEqual([]);
    expect(xpdr.list(undefined)).toEqual([]);
    expect(wrote(st)).toBe(0);
  });

  it('says a table that did not come, and the next ensure asks again', async () => {
    const st = storage();
    const { xpdr, fetch } = await load(st, fetcher(1));
    await xpdr.ensure();
    expect(xpdr.failed).toBe(true);
    expect(xpdr.table).toBeNull();
    await xpdr.ensure();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(xpdr.failed).toBe(false);
    expect(xpdr.table!.forSat(24278)).toHaveLength(1);
  });

  it('takes an answer that is not the table (an error page) as a failure', async () => {
    const { xpdr } = await load(storage(), vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await xpdr.ensure();
    expect(xpdr.failed).toBe(true);
    const { xpdr: x2 } = await load(storage(), vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ hello: 1 }) })));
    await x2.ensure();
    expect(x2.failed).toBe(true);
  });

  it('starts a spacecraft on its first record, held on the lower-frequency leg at its centre; a choice belongs to its spacecraft', async () => {
    const st = storage();
    const { xpdr } = await load(st);
    await xpdr.ensure();
    const jas = xpdr.list(JAS2), qo = xpdr.list(QO100), ao = xpdr.list(OSCAR7);
    expect(xpdr.pickFor('24278', jas)).toEqual({ sat: '24278', i: 0, hold: 'tx', hz: 145_950_000, text: '' });
    expect(xpdr.pickFor('07530', ao)).toEqual({ sat: '07530', i: 0, hold: 'rx', hz: 29_450_000, text: '' });
    expect(xpdr.pickFor('25544', [])).toBeNull();
    xpdr.choose('43700', qo, 3);
    expect(xpdr.pickFor('43700', qo)).toEqual({ sat: '43700', i: 3, hold: 'tx', hz: 2_400_197_500, text: '' });
    expect(xpdr.pickFor('24278', jas)).toEqual({ sat: '24278', i: 0, hold: 'tx', hz: 145_950_000, text: '' });   // another spacecraft starts afresh
    xpdr.choose('07530', ao, 2);                             // Mode B: U/V, inverting; the lower leg is the downlink
    expect(xpdr.pickFor('07530', ao)).toEqual({ sat: '07530', i: 2, hold: 'rx', hz: 145_950_000, text: '' });
    xpdr.choose('07530', ao, 9);                             // no such record: nothing changes
    expect(xpdr.pickFor('07530', ao)!.i).toBe(2);
    expect(wrote(st)).toBe(0);
  });

  it('holds, types and nudges in memory only: another hold keeps the figure it is given, text that is no frequency is kept as typed', async () => {
    const st = storage();
    const { xpdr } = await load(st);
    await xpdr.ensure();
    const jas = xpdr.list(JAS2);
    xpdr.setHold('24278', jas, 'rx', 435_847_101);
    expect(xpdr.pickFor('24278', jas)).toEqual({ sat: '24278', i: 0, hold: 'rx', hz: 435_847_101, text: '' });
    xpdr.nudge('24278', jas, 1000);
    xpdr.nudge('24278', jas, -100);
    expect(xpdr.pickFor('24278', jas)!.hz).toBe(435_848_001);
    xpdr.setDial('24278', jas, null, '145.95.5');
    expect(xpdr.pickFor('24278', jas)).toEqual({ sat: '24278', i: 0, hold: 'rx', hz: null, text: '145.95.5' });
    xpdr.nudge('24278', jas, 100);                           // nothing to nudge
    expect(xpdr.pickFor('24278', jas)!.hz).toBeNull();
    xpdr.setDial('24278', jas, 145_952_000, '145,952');
    expect(xpdr.pickFor('24278', jas)).toEqual({ sat: '24278', i: 0, hold: 'rx', hz: 145_952_000, text: '' });
    xpdr.setHold('24278', jas, 'sat', 145_950_540);
    expect(xpdr.pickFor('24278', jas)!.hold).toBe('sat');
    expect(wrote(st)).toBe(0);
  });

  it('writes an offset only when set, under the NORAD number without leading zeros; 0 takes it out, and the last one out removes the key', async () => {
    const st = storage();
    const { xpdr } = await load(st);
    expect(xpdr.setOffset('24278', 400)).toBe('kept');
    expect(st.setItem).toHaveBeenLastCalledWith('gt.xpdr', '{"24278":400}');
    expect(xpdr.setOffset('07530', -1200)).toBe('kept');
    expect(st.setItem).toHaveBeenLastCalledWith('gt.xpdr', '{"7530":-1200,"24278":400}');
    expect(xpdr.offsetFor('07530')).toBe(-1200);
    expect(xpdr.setOffset('24278', 0)).toBe('cleared');
    expect(st.setItem).toHaveBeenLastCalledWith('gt.xpdr', '{"7530":-1200}');
    expect(xpdr.setOffset('07530', 0)).toBe('cleared');
    expect(st.removeItem).toHaveBeenCalledWith('gt.xpdr');
    expect(st.getItem('gt.xpdr')).toBeNull();
    expect(xpdr.offsets).toEqual({});
  });

  it('keeps nothing for what is not a NORAD number, and says so to the caller', async () => {
    const st = storage();
    const { xpdr } = await load(st);
    expect(xpdr.setOffset('O0001', 400)).toBeNull();
    expect(xpdr.offsets).toEqual({});
    expect(wrote(st)).toBe(0);
  });

  it('keeps the offset for the visit where the browser refuses storage, and says so', async () => {
    for (const st of [storage({}, true), null]) {
      const { xpdr } = await load(st);
      expect(xpdr.offsets).toEqual({});
      expect(xpdr.setOffset('24278', 400)).toBe('visit');
      expect(xpdr.offsetFor('24278')).toBe(400);
    }
  });

  it('reads the offsets again when another tab writes them, removes them, or the origin\'s storage is cleared', async () => {
    const st = storage({ 'gt.xpdr': '{"24278":400}' });
    const { xpdr, heard } = await load(st);
    expect(heard).toHaveLength(1);
    st.setItem('gt.xpdr', '{"24278":-300,"43700":2000}');
    heard[0]!({ key: 'gt.prefs' });                         // somebody else's key: not read again
    expect(xpdr.offsets).toEqual({ 24278: 400 });
    heard[0]!({ key: 'gt.xpdr' });
    expect(xpdr.offsets).toEqual({ 24278: -300, 43700: 2000 });
    st.removeItem('gt.xpdr');
    heard[0]!({ key: null });
    expect(xpdr.offsets).toEqual({});
  });
});
