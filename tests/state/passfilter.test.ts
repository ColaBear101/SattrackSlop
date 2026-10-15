import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_FILTER, type PassFilter } from '../../src/lib/analysis/pass-filter';
import { siteClock } from '../../src/lib/text/passfacts';
import { BANGKOK, byName } from '../lib/helpers';

/* The pass list's filter as a store (CHANGES-FROM-LEGACY.md, L56): what the reader chose is read from its own key when the store
   is first asked for, and written only when the reader changes it; "Show every pass" leaves nothing stored; a browser that
   refuses storage still filters for the visit; and the optical verdict of a pass is worked out once for an analysis. Each
   test loads the store afresh over a storage of its own (window.localStorage, as the page's storage.ts reads it). */
type Store = { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
function storage(init: Record<string, string> = {}): Store {
  const m = new Map(Object.entries(init));
  return {
    getItem: vi.fn((k: string) => (m.has(k) ? m.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => { m.set(k, String(v)); }),
    removeItem: vi.fn((k: string) => { m.delete(k); })
  };
}
async function load(win: object) {
  vi.resetModules();
  vi.stubGlobal('window', win);
  const [{ passfilter }, engine] = await Promise.all([import('../../src/state/passfilter.svelte'), import('../../src/state/engine')]);
  return { passfilter, engine };
}
const TWENTY: PassFilter = { ...NO_FILTER, minPeak: 20 };

describe('the pass list\'s filter, kept', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('with nothing stored, filters nothing and writes nothing', async () => {
    const st = storage();
    const { passfilter } = await load({ localStorage: st });
    expect(st.getItem).toHaveBeenCalledWith('gt.passfilter');
    expect(passfilter.spec).toBeNull();
    expect(passfilter.on).toBe(false);
    expect(passfilter.shown(null, () => 7)).toBeNull();
    expect(st.setItem).not.toHaveBeenCalled();
    expect(st.removeItem).not.toHaveBeenCalled();
  });

  it('reads a stored filter, and writes nothing for having read it', async () => {
    const st = storage({ 'gt.passfilter': JSON.stringify(TWENTY) });
    const { passfilter } = await load({ localStorage: st });
    expect(passfilter.spec).toEqual(TWENTY);
    expect(passfilter.on).toBe(true);
    expect(st.setItem).not.toHaveBeenCalled();
  });

  it('takes an unreadable record as nothing stored', async () => {
    const { passfilter } = await load({ localStorage: storage({ 'gt.passfilter': '{not json' }) });
    expect(passfilter.spec).toBeNull();
  });

  it('writes the reader\'s change under its own key, and "Show every pass" removes it', async () => {
    const st = storage();
    const { passfilter } = await load({ localStorage: st });
    passfilter.set(TWENTY);
    expect(st.setItem).toHaveBeenCalledWith('gt.passfilter', JSON.stringify(TWENTY));
    expect(passfilter.on).toBe(true);
    passfilter.set(NO_FILTER);
    expect(passfilter.on).toBe(false);
    passfilter.clear();
    expect(st.removeItem).toHaveBeenCalledWith('gt.passfilter');
    expect(st.getItem('gt.passfilter')).toBeNull();
    expect(passfilter.spec).toBeNull();
  });

  it('filters for the visit where the browser refuses storage', async () => {
    const { passfilter } = await load(Object.defineProperty({}, 'localStorage', { get() { throw new DOMException('no', 'SecurityError'); } }));
    expect(passfilter.spec).toBeNull();
    expect(() => passfilter.set(TWENTY)).not.toThrow();
    expect(passfilter.on).toBe(true);
    expect(() => passfilter.clear()).not.toThrow();
  });

  it('shows the analysis\'s own indices, and asks the optics for a pass\'s verdict once per analysis', async () => {
    const { passfilter, engine } = await load({ localStorage: storage() });
    const D = engine.getEngine().compute(byName('ISS (ZARYA)'), Date.parse('2026-09-27T07:29:09.993Z'), 168);
    const spy = vi.spyOn(engine.getOptics(), 'passOptical');
    const c = siteClock(BANGKOK);
    passfilter.set({ ...NO_FILTER, minPeak: 20, eye: true });
    const first = passfilter.shown(D, c.offsetAt)!;
    const high = D.passes.map((_, i) => i).filter(i => D.passes[i]!.maxEl >= 20);
    expect(spy).toHaveBeenCalledTimes(high.length);
    expect(first).toEqual(high.filter(i => engine.getOptics().passOptical(D.track, D.passes[i]!)?.eye === 'yes'));
    expect(first.length).toBeGreaterThan(0);
    spy.mockClear();
    expect(passfilter.shown(D, c.offsetAt)).toEqual(first);
    passfilter.set({ ...NO_FILTER, eye: true });
    passfilter.shown(D, c.offsetAt);
    expect(spy).toHaveBeenCalledTimes(D.passes.length - high.length);   // only the passes not asked about before
    /* a new site makes new optics: the verdicts are asked of them afresh */
    engine.setObserver({ ...BANGKOK });
    const again = vi.spyOn(engine.getOptics(), 'passOptical');
    passfilter.shown(D, c.offsetAt);
    expect(again).toHaveBeenCalledTimes(D.passes.length);
  });
});
