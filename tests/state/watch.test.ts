import { afterEach, describe, expect, it, vi } from 'vitest';

/* the console's own store, stood in for by its note alone (app.svelte.ts starts the whole page) */
const app = vi.hoisted(() => ({ note: '' }));
vi.mock('../../src/state/app.svelte', () => ({ app }));

/* The watchlist as a store (CHANGES-FROM-LEGACY.md, L60): the list is read from its own key when the page starts and written only by
   a press of the star (state/watch-press.ts, the press's own chunk); the last one taken off leaves nothing stored; with the list full
   a press puts nothing on and says why in the note under the bar, and the next press that goes through takes that sentence away
   (and no other); a browser that refuses storage still keeps the list for the visit; another tab's change is heard through the
   storage event and the list read again. Each test loads the store afresh over a window of its own (window.localStorage, as the
   page's storage.ts reads it, and the window's storage listener). */
type Store = { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
function storage(init: Record<string, string> = {}): Store {
  const m = new Map(Object.entries(init));
  return {
    getItem: vi.fn((k: string) => (m.has(k) ? m.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => { m.set(k, String(v)); }),
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
async function load(localStorage: Store | null) {
  vi.resetModules();
  const { w, heard } = win(localStorage);
  vi.stubGlobal('window', w);
  app.note = '';
  const [{ watch, WATCH_KEY }, { press }] = await Promise.all([import('../../src/state/watch.svelte'), import('../../src/state/watch-press')]);
  return { watch, WATCH_KEY, press, heard };
}
const ISS = { satnum: '25544', name: 'ISS (ZARYA)' }, OSCAR7 = { satnum: '07530', name: 'OSCAR 7' };
const nums = (n: number): string[] => Array.from({ length: n }, (_, i) => String(10000 + i));
const FULL = 'You are watching 50 spacecraft, the most this page keeps: take the star off one of them to watch ISS (ZARYA).';

describe('the watchlist, kept', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('with nothing stored, watches nothing and writes nothing', async () => {
    const st = storage();
    const { watch, WATCH_KEY } = await load(st);
    expect(WATCH_KEY).toBe('gt.watch');
    expect(st.getItem).toHaveBeenCalledWith('gt.watch');
    expect(watch.list).toEqual([]);
    expect(st.setItem).not.toHaveBeenCalled();
    expect(st.removeItem).not.toHaveBeenCalled();
  });

  it('reads the stored list when the page starts, and writes nothing for having read it', async () => {
    const st = storage({ 'gt.watch': '["25544","07530"]' });
    const { watch } = await load(st);
    expect(watch.list).toEqual(['25544', '07530']);
    expect(st.setItem).not.toHaveBeenCalled();
    expect(st.removeItem).not.toHaveBeenCalled();
  });

  it('takes a record that is not a list as nothing stored, and leaves it there until a press', async () => {
    for (const raw of ['{not json', '{"list":["25544"]}', '"25544"']) {
      const st = storage({ 'gt.watch': raw });
      const { watch } = await load(st);
      expect(watch.list).toEqual([]);
      expect(st.setItem).not.toHaveBeenCalled();
      expect(st.removeItem).not.toHaveBeenCalled();
    }
  });

  it('writes a press under its own key, in the order of the presses, and the last one taken off leaves nothing stored', async () => {
    const st = storage();
    const { watch, press } = await load(st);
    press(ISS);
    expect(watch.list).toEqual(['25544']);
    expect(st.setItem).toHaveBeenLastCalledWith('gt.watch', '["25544"]');
    press(OSCAR7);
    expect(watch.list).toEqual(['25544', '07530']);
    expect(st.setItem).toHaveBeenLastCalledWith('gt.watch', '["25544","07530"]');
    press(ISS);
    expect(watch.list).toEqual(['07530']);
    expect(st.setItem).toHaveBeenLastCalledWith('gt.watch', '["07530"]');
    press(OSCAR7);
    expect(watch.list).toEqual([]);
    expect(st.removeItem).toHaveBeenCalledWith('gt.watch');
    expect(st.getItem('gt.watch')).toBeNull();
    expect(st.setItem).toHaveBeenCalledTimes(3);
  });

  it('keeps nothing for an orbit of the reader\'s own (its number is a placeholder), and says nothing', async () => {
    const st = storage();
    const { watch, press } = await load(st);
    press({ satnum: 'O0001', name: 'My orbit' });
    expect(watch.list).toEqual([]);
    expect(st.setItem).not.toHaveBeenCalled();
    expect(app.note).toBe('');
  });

  it('with the list full puts nothing on and says why under the bar; a press that goes through takes that away, and only that', async () => {
    const st = storage({ 'gt.watch': JSON.stringify(nums(50)) });
    const { watch, press } = await load(st);
    expect(watch.list).toHaveLength(50);
    press(ISS);
    expect(watch.list).toHaveLength(50);
    expect(watch.list).not.toContain('25544');
    expect(st.setItem).not.toHaveBeenCalled();
    expect(app.note).toBe(FULL);
    press({ satnum: '10003', name: 'TEN THOUSAND AND THREE' });       // one taken off: room again, and the sentence is gone
    expect(watch.list).toHaveLength(49);
    expect(app.note).toBe('');
    press(ISS);
    expect(watch.list.at(-1)).toBe('25544');
    app.note = 'ODIN cannot be propagated in this window (error 6: decayed).';   // a refused load's note stays through a press
    press(ISS);
    expect(app.note).toBe('ODIN cannot be propagated in this window (error 6: decayed).');
  });

  it('keeps the list for the visit where the browser refuses storage', async () => {
    const { watch, press } = await load(null);
    expect(watch.list).toEqual([]);
    expect(() => press(ISS)).not.toThrow();
    expect(watch.list).toEqual(['25544']);
    expect(() => press(ISS)).not.toThrow();
    expect(watch.list).toEqual([]);
  });

  it('hears another tab: its list is read again on its key, and on a cleared storage; another key is not its business', async () => {
    const st = storage({ 'gt.watch': '["25544"]' });
    const { watch, heard } = await load(st);
    expect(heard).toHaveLength(1);
    st.setItem('gt.watch', '["25544","07530"]');
    heard[0]!({ key: 'gt.watch' });
    expect(watch.list).toEqual(['25544', '07530']);
    const before = watch.list;
    st.setItem('gt.prefs', '{}');
    heard[0]!({ key: 'gt.prefs' });
    expect(watch.list).toBe(before);
    st.removeItem('gt.watch');
    heard[0]!({ key: null });
    expect(watch.list).toEqual([]);
    expect(st.setItem).toHaveBeenCalledTimes(2);                   // the two above, the test's own: hearing writes nothing
  });
});
