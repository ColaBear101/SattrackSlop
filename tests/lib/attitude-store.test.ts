import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownAttitude, type Attitude } from '../../src/lib/models/attitude';
import { ownId } from '../../src/lib/models/attitude-record';

/* How the reader flies each model in the close-up, as a store (CHANGES-FROM-LEGACY.md, L77): it reads its key when the close-up's chunk
   is loaded and writes nothing for having read it; a change is written under its key, a slider moving only once it is let go (flush);
   a model set back to its own has its entry deleted, and the last one takes the key with it; under the snapshot (?tle=embedded) it reads
   and writes nothing and holds a setting for the visit, as it does where the browser refuses storage; another tab's change, or the
   storage cleared, is heard; a reader's model removed or kept anew takes its setting with it. Each test loads the store afresh over a
   window of its own (window.localStorage, the window's storage listener) and an address of its own (the snapshot flag). */
type Store = { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
function storage(init: Record<string, string> = {}, refuseWrites = false): Store {
  const m = new Map(Object.entries(init));
  return {
    getItem: vi.fn((k: string) => (m.has(k) ? m.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => { if (refuseWrites) throw new DOMException('full', 'QuotaExceededError'); m.set(k, String(v)); }),
    removeItem: vi.fn((k: string) => { m.delete(k); })
  };
}
type Heard = (e: { key: string | null; newValue: string | null }) => void;
function win(localStorage: Store | null) {
  const heard: Heard[] = [];
  const w: Record<string, unknown> = { addEventListener: vi.fn((type: string, f: Heard) => { if (type === 'storage') heard.push(f); }) };
  if (localStorage) w.localStorage = localStorage;
  else Object.defineProperty(w, 'localStorage', { get() { throw new DOMException('no', 'SecurityError'); } });
  return { w, heard };
}
async function load(localStorage: Store | null, search = '') {
  vi.resetModules();
  const { w, heard } = win(localStorage);
  vi.stubGlobal('window', w);
  vi.stubGlobal('location', { search });
  const { attitudes } = await import('../../src/state/attitude.svelte');
  return { attitudes, heard, tell: (key: string | null, newValue: string | null) => { for (const f of heard) f({ key, newValue }); } };
}

const OWN_K = ownAttitude({ axis: '+Z', degPerSec: 2 }), OWN_I = ownAttitude();
const FAST: Attitude = { ...OWN_K, spin: { rate: [0, 0, 30] } };
const SUN: Attitude = { pointing: 'sun', face: '+Y', ypr: [0, 0, 0], spin: null };
const rec = (items: Record<string, Attitude>) => JSON.stringify({ v: 1, items });

describe('how the reader flies the close-up\'s models, kept', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads its key when it is loaded, and writes nothing for having read it', async () => {
    const st = storage({ 'gt.attitude': rec({ iss: SUN }) });
    const { attitudes } = await load(st);
    expect(st.getItem).toHaveBeenCalledWith('gt.attitude');
    expect(attitudes.get('iss')).toEqual(SUN);
    expect(attitudes.get('knacksat2')).toBeNull();
    expect(attitudes.get('constructor')).toBeNull();
    expect(attitudes.where).toBe('');
    expect(st.setItem).not.toHaveBeenCalled();
    expect(st.removeItem).not.toHaveBeenCalled();
  });

  it('with nothing stored, has nothing and writes nothing', async () => {
    const st = storage();
    const { attitudes } = await load(st);
    expect(attitudes.items).toEqual({});
    attitudes.flush();
    expect(st.setItem).not.toHaveBeenCalled();
    expect(st.removeItem).not.toHaveBeenCalled();
  });

  it('writes a change at once, and a slider moving only when it is let go', async () => {
    const st = storage();
    const { attitudes } = await load(st);
    attitudes.set('knacksat2', FAST, OWN_K, false);
    expect(attitudes.get('knacksat2')).toEqual(FAST);
    expect(st.setItem).not.toHaveBeenCalled();
    attitudes.flush();
    expect(st.setItem).toHaveBeenLastCalledWith('gt.attitude', rec({ knacksat2: FAST }));
    attitudes.flush();
    expect(st.setItem).toHaveBeenCalledTimes(1);
    attitudes.set('iss', SUN, OWN_I);
    expect(JSON.parse(st.getItem('gt.attitude') as string)).toEqual({ v: 1, items: { knacksat2: FAST, iss: SUN } });
    expect(attitudes.where).toBe('kept');
  });

  it('deletes a model set back to its own, and the key with the last one', async () => {
    const st = storage({ 'gt.attitude': rec({ knacksat2: FAST, iss: SUN }) });
    const { attitudes } = await load(st);
    attitudes.set('iss', { ...SUN, pointing: 'track', face: '+Z' }, OWN_I);       // its own, written out in full
    expect(attitudes.get('iss')).toBeNull();
    expect(st.setItem).toHaveBeenLastCalledWith('gt.attitude', rec({ knacksat2: FAST }));
    attitudes.set('knacksat2', null, OWN_K);
    expect(attitudes.items).toEqual({});
    expect(st.removeItem).toHaveBeenCalledWith('gt.attitude');
    expect(st.getItem('gt.attitude')).toBeNull();
  });

  it('under the snapshot reads nothing, writes nothing, and holds a setting for the visit', async () => {
    const st = storage({ 'gt.attitude': rec({ iss: SUN }) });
    const { attitudes, tell } = await load(st, '?sat=25544&tle=embedded');
    expect(st.getItem).not.toHaveBeenCalled();
    expect(attitudes.get('iss')).toBeNull();
    attitudes.set('knacksat2', FAST, OWN_K);
    expect(attitudes.get('knacksat2')).toEqual(FAST);
    expect(attitudes.where).toBe('memory');
    tell('gt.attitude', rec({}));                                                 // another tab's record is not the snapshot's
    expect(attitudes.get('knacksat2')).toEqual(FAST);
    expect(st.setItem).not.toHaveBeenCalled();
    expect(st.removeItem).not.toHaveBeenCalled();
  });

  it('where the browser refuses storage or a write, holds a setting for the visit and says so', async () => {
    const { attitudes } = await load(null);
    expect(attitudes.items).toEqual({});
    attitudes.set('iss', SUN, OWN_I);
    expect(attitudes.get('iss')).toEqual(SUN);
    expect(attitudes.where).toBe('memory');
    const full = storage({}, true);
    const second = await load(full);
    second.attitudes.set('iss', SUN, OWN_I);
    expect(second.attitudes.get('iss')).toEqual(SUN);
    expect(second.attitudes.where).toBe('memory');
  });

  it('hears another tab: its record written or removed, or the origin\'s storage cleared', async () => {
    const st = storage();
    const { attitudes, tell } = await load(st);
    tell('gt.attitude', rec({ iss: SUN }));
    expect(attitudes.get('iss')).toEqual(SUN);
    tell('gt.prefs', '{}');
    expect(attitudes.get('iss')).toEqual(SUN);
    tell('gt.attitude', null);
    expect(attitudes.get('iss')).toBeNull();
    tell('gt.attitude', rec({ knacksat2: FAST }));
    tell(null, null);
    expect(attitudes.items).toEqual({});
    expect(st.setItem).not.toHaveBeenCalled();
  });

  it('lets a reader\'s model removed, or kept anew in its place, take its setting with it, and no other\'s', async () => {
    const st = storage();
    const { attitudes } = await load(st);
    const A = ownId('25544', '2026-11-19T10:00:00.000Z'), B = ownId('2554', '2026-11-19T11:00:00.000Z'), C = ownId('custom:c3', '2026-11-19T12:00:00.000Z');
    attitudes.set(A, SUN, OWN_I); attitudes.set(B, SUN, OWN_I); attitudes.set(C, FAST, OWN_I); attitudes.set('iss', SUN, OWN_I);
    st.setItem.mockClear();
    attitudes.dropOwn('99999');
    expect(st.setItem).not.toHaveBeenCalled();
    attitudes.dropOwn('25544');
    expect(Object.keys(JSON.parse(st.getItem('gt.attitude') as string).items)).toEqual([B, C, 'iss']);
    attitudes.dropOwn('custom:c3');
    attitudes.dropOwn('2554');
    expect(Object.keys(attitudes.items)).toEqual(['iss']);
  });
});
