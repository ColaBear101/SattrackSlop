import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PLOT, plotPage } from '../server/helpers/tle';

/* the console's own store and the Decay section's, stood in for by reactive fakes (decay-compare-fakes.svelte.ts) */
vi.mock('../../src/state/app.svelte', () => import('./decay-compare-fakes.svelte'));
vi.mock('../../src/state/life.svelte', () => import('./decay-compare-fakes.svelte'));

/* The decay comparison as a store (CHANGES-FROM-LEGACY.md, L66). The list is read from its own key and written only for what the
   reader does; reading it back fetches nothing (the cached are worked out, the rest wait). Adding asks for one history; "Add
   watched" and Fetch ask for seven at most; the requests go one at a time, and a row removed while its request is out lets it
   finish (the answer is cached, not shown) while the queue waits; listing it again meanwhile takes that answer. Seven colours, the
   lowest free one first, given back by a row with nothing to draw; with seven taken a highlight is refused and said. The selected
   spacecraft, not yet estimated, is asked for first with the Decay section's own request, and a listed spacecraft's answer that is
   the selected one's is offered to the section. While the page's API answers, requests start seven seconds apart. Another tab's
   list is heard. Each test loads the store afresh over a window of its own: its storage, its fetch (CelesTrak's history page, held
   or answered at once, counted per CATNR with the most in flight at once), and its storage listeners. */

type Answer = { status: number; body: string };
type Store = { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
function storage(init: Record<string, string>): Store {
  const m = new Map(Object.entries(init));
  return {
    getItem: vi.fn((k: string) => (m.has(k) ? m.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => { m.set(k, String(v)); }),
    removeItem: vi.fn((k: string) => { m.delete(k); })
  };
}

const DAY = 86400000;
/** n daily element sets from `from` km down to `to` km, the last a day ago: a falling orbit (or a still one, for from = to) */
function fall(n: number, from: number, to: number) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => ({ t: now - (n - i) * DAY, sma: from - (from - to) * (i / (n - 1)), ecc: 0.0005 }));
}
const FALLING = () => fall(100, 400, 300);
const GEO = () => fall(100, 35786, 35786);
const cached = (rows: ReturnType<typeof fall>) => JSON.stringify({ at: Date.now(), P: rows });
const OK = (): Answer => ({ status: 200, body: plotPage(FALLING()) });

function world(init: Record<string, string> = {}, o: { hold?: boolean; answer?: (n: string) => Answer; refuse?: boolean } = {}) {
  const st = storage(init);
  const heard: ((e: { key: string | null }) => void)[] = [];
  const asked: string[] = [], times: number[] = [];
  const held = new Map<string, (a: Answer) => void>();
  let out = 0, most = 0;
  const answer = o.answer ?? OK;
  const fetch = vi.fn(async (url: string) => {
    const n = /CATNR=(\d+)/.exec(url)?.[1] ?? '?';
    asked.push(n); times.push(Date.now());
    most = Math.max(most, ++out);
    try {
      const a = o.hold ? await new Promise<Answer>(res => held.set(n, res)) : answer(n);
      return { ok: a.status === 200, status: a.status, text: async () => a.body };
    } finally { out--; }
  });
  const win: Record<string, unknown> = {
    fetch,
    addEventListener: vi.fn((type: string, f: (e: { key: string | null }) => void) => { if (type === 'storage') heard.push(f); })
  };
  if (o.refuse) Object.defineProperty(win, 'localStorage', { get() { throw new DOMException('no', 'SecurityError'); } });
  else win.localStorage = st;
  return {
    win, st, asked, times, fetch,
    most: () => most,
    held: () => [...held.keys()],
    release(n: string, a: Answer = answer(n)) { const f = held.get(n)!; held.delete(n); f(a); },
    /** another tab wrote (or the origin's storage was cleared): the browser tells every listener */
    hear(key: string | null) { for (const f of heard) f({ key }); },
    /** what was written under the comparison's key */
    writes: () => st.setItem.mock.calls.filter(c => c[0] === 'gt.decaycmp').map(c => c[1] as string)
  };
}

async function load(w: ReturnType<typeof world>) {
  vi.resetModules();
  vi.stubGlobal('window', w.win);
  type Fakes = typeof import('./decay-compare-fakes.svelte');
  const { app } = (await import('../../src/state/app.svelte')) as unknown as Fakes;     // the stand-ins, as the store has them
  const { life } = (await import('../../src/state/life.svelte')) as unknown as Fakes;
  app.reset();
  life.reset();
  const { compare, COMPARE_KEY } = await import('../../src/state/decay-compare.svelte');
  return { compare, COMPARE_KEY, app, life };
}
const later = (ms = 30) => new Promise(r => setTimeout(r, ms));
const until = (f: () => void) => vi.waitFor(f, { timeout: 5000, interval: 5 });
const nums = (k: number, from = 40000) => Array.from({ length: k }, (_, i) => String(from + i));

describe('the decay comparison, kept', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock('../../src/state/net'); });

  it('with nothing stored, lists nothing, and fetches and writes nothing', async () => {
    const w = world();
    const { compare, COMPARE_KEY } = await load(w);
    expect(COMPARE_KEY).toBe('gt.decaycmp');
    expect(w.st.getItem).toHaveBeenCalledWith('gt.decaycmp');
    expect(compare.items).toEqual([]);
    expect(compare.open).toBe(false);
    await later();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.st.setItem).not.toHaveBeenCalled();
    expect(w.st.removeItem).not.toHaveBeenCalled();
  });

  it('reads a stored list back and fetches nothing: the cached are worked out, the rest wait, and nothing is written', async () => {
    const w = world({
      'gt.decaycmp': '{"o":1,"l":[{"n":"07530"},{"n":"25544","h":3},{"n":"43017","h":2}]}',
      'hist:25544': cached(FALLING())
    });
    const { compare } = await load(w);
    expect(compare.open).toBe(true);
    expect(compare.items).toEqual([{ n: '07530' }, { n: '25544', h: 3 }, { n: '43017', h: 2 }]);
    expect(compare.shown).toEqual(['43017', '25544', '07530']);
    expect(Object.values(compare.rows).map(r => r.st)).toEqual(['reading', 'reading', 'reading']);
    await until(() => expect(compare.rows['25544']).toMatchObject({ st: 'shown', not: null }));
    await until(() => expect(compare.rows['07530']).toEqual({ st: 'wait' }));
    expect(compare.rows['43017']).toEqual({ st: 'wait' });
    expect(compare.rows['25544']).toMatchObject({ big: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), alt: '300.0 km', rate: expect.stringMatching(/^-\d+\.\d{3} km\/day$/) });
    expect(compare.slotOf('43017')).toBe(2);                    // a waiting row keeps its colour
    expect(compare.waiting).toEqual(['43017', '07530']);
    expect(compare.lines.map(l => [l.n, l.slot])).toEqual([['25544', 3]]);
    await later();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.st.setItem).not.toHaveBeenCalled();
    expect(w.st.removeItem).not.toHaveBeenCalled();
  });

  it('adds a spacecraft in the lowest free colour, asks for its history once, and writes the list for the add alone', async () => {
    const w = world({}, { hold: true });
    const { compare } = await load(w);
    expect(compare.add('25544')).toBe(true);
    expect(compare.items).toEqual([{ n: '25544', h: 2 }]);
    expect(w.writes()).toEqual(['{"o":0,"l":[{"n":"25544","h":2}]}']);
    await until(() => expect(w.asked).toEqual(['25544']));
    expect(compare.rows['25544']).toEqual({ st: 'fetching' });
    await until(() => expect(compare.say).toBe('Added ISS (ZARYA) · 1 in the comparison'));
    expect(compare.add('25544')).toBe(false);                    // listed already
    w.release('25544');
    await until(() => expect(compare.rows['25544']).toMatchObject({ st: 'shown', not: null }));
    expect(w.st.setItem).toHaveBeenCalledWith('hist:25544', expect.any(String));     // the Decay section's own cache
    await until(() => expect(compare.say).toBe('The history of ISS (ZARYA) arrived.'));
    expect(compare.lines.map(l => [l.n, l.slot])).toEqual([['25544', 2]]);
    expect(w.asked).toEqual(['25544']);
    expect(w.writes()).toHaveLength(1);                           // the answer wrote nothing to the list
  });

  it('draws a spacecraft cached in the last 12 hours without asking anyone', async () => {
    const w = world({ 'hist:07530': cached(FALLING()) });
    const { compare } = await load(w);
    compare.add('7530');                                          // the number as typed: listed as the catalogue writes it
    expect(compare.items).toEqual([{ n: '07530', h: 2 }]);
    await until(() => expect(compare.rows['07530']).toMatchObject({ st: 'shown', not: null }));
    await later();
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it('works a forecast out once: the same history listed again is not worked out again', async () => {
    const w = world({ 'hist:25544': cached(FALLING()) });
    const { compare } = await load(w);
    const { Lifetime } = await import('../../src/lib/text/life');      // the chunk the store asks for, as it has it
    const predict = vi.spyOn(Lifetime, 'predict');
    compare.add('25544');
    await until(() => expect(compare.rows['25544']).toMatchObject({ st: 'shown' }));
    compare.remove('25544');
    compare.add('25544');
    await until(() => expect(compare.rows['25544']).toMatchObject({ st: 'shown' }));
    expect(predict).toHaveBeenCalledTimes(1);
  });

  it('turning a waiting row\'s highlight on is an ask: its history is asked for', async () => {
    const w = world({ 'gt.decaycmp': '{"o":1,"l":[{"n":"25544"}]}' });
    const { compare } = await load(w);
    await until(() => expect(compare.rows['25544']).toEqual({ st: 'wait' }));
    await later();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(compare.highlight('25544', true)).toBe(true);
    expect(compare.slotOf('25544')).toBe(2);
    await until(() => expect(compare.rows['25544']).toMatchObject({ st: 'shown' }));
    expect(w.asked).toEqual(['25544']);
    expect(w.writes()).toEqual(['{"o":1,"l":[{"n":"25544","h":2}]}']);
  });

  it('does not add the selected spacecraft, and refuses a 51st with a sentence', async () => {
    const w0 = world();
    const first = await load(w0);
    first.app.entry = { satnum: '67683', name: 'KNACKSAT-2', l1: '', l2: '' };
    expect(first.compare.add('67683')).toBe(false);
    expect(first.compare.items).toEqual([]);
    expect(w0.writes()).toEqual([]);
    const seed: Record<string, string> = { 'gt.decaycmp': JSON.stringify({ o: 1, l: nums(50).map(n => ({ n })) }) };
    const w = world(seed);
    const { compare } = await load(w);
    expect(compare.add('25544')).toBe(false);
    expect(compare.items).toHaveLength(50);
    await until(() => expect(compare.say).toBe('The comparison holds 50 spacecraft, the most it keeps: remove one to add ISS (ZARYA).'));
    expect(w.writes()).toEqual([]);
  });

  it('holds seven colours: an eighth highlight is refused and said; a colour turned off goes to the next, and nobody is repainted', async () => {
    const seed: Record<string, string> = {};
    for (const n of nums(8)) seed['hist:' + n] = cached(FALLING());
    const w = world(seed);
    const { compare } = await load(w);
    for (const n of nums(8)) compare.add(n);
    expect(compare.items.map(i => i.h)).toEqual([2, 3, 4, 5, 6, 7, 8, undefined]);
    await until(() => expect(compare.lines).toHaveLength(8));
    expect(compare.lines.map(l => l.slot)).toEqual([2, 3, 4, 5, 6, 7, 8, 0]);       // the eighth is a grey line
    expect(compare.highlight('40007', true)).toBe(false);
    expect(compare.refusal).toEqual({ n: '40007', text: 'Seven are highlighted: turn one off to highlight SAT 40007.' });
    await until(() => expect(compare.say).toBe('Seven are highlighted: turn one off to highlight SAT 40007.'));
    expect(compare.highlight('40007', true)).toBe(false);         // the same refusal again: cleared first, so it is heard again
    expect(compare.say).toBe('');
    await until(() => expect(compare.say).toBe('Seven are highlighted: turn one off to highlight SAT 40007.'));
    const before = compare.items;
    expect(compare.highlight('40002', false)).toBe(true);
    expect(compare.highlight('40007', true)).toBe(true);
    expect(compare.refusal).toBeNull();
    expect(compare.slotOf('40007')).toBe(4);
    for (const i of before) if (i.n !== '40002' && i.n !== '40007') expect(compare.slotOf(i.n)).toBe(i.h);
    expect(compare.shown.slice(0, 7)).toEqual(['40000', '40001', '40007', '40003', '40004', '40005', '40006']);
    expect(JSON.parse(w.writes().at(-1)!).l.find((x: { n: string }) => x.n === '40007').h).toBe(4);
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it('a row with nothing to draw gives its colour back and cannot be highlighted; a failed one gives it back and does not block one', async () => {
    const seed: Record<string, string> = { 'hist:26931': cached(GEO()) };
    for (const n of nums(7)) seed['hist:' + n] = cached(FALLING());
    const w = world(seed, { answer: n => (n === '43017' ? { status: 503, body: '' } : OK()) });
    const { compare } = await load(w);
    compare.add('26931');                                         // INTELSAT 901, geostationary
    expect(compare.slotOf('26931')).toBe(2);
    await until(() => expect(compare.rows['26931']).toMatchObject({ st: 'shown', big: 'No measurable decay', not: 'high' }));
    expect(compare.slotOf('26931')).toBe(0);
    expect(compare.lines).toEqual([]);
    expect(compare.highlight('26931', true)).toBe(false);
    expect(compare.refusal?.text).toBe('INTELSAT 901 is not drawn: too high for drag to matter.');
    for (const n of nums(6)) compare.add(n);                      // 2..7
    compare.add('43017');                                         // 8, and its request fails
    compare.add('40006');                                         // none free
    expect(compare.slotOf('43017')).toBe(8);
    expect(compare.slotOf('40006')).toBe(0);
    await until(() => expect(compare.rows['43017']).toMatchObject({ st: 'failed', big: 'Not received', short: 'CelesTrak answered HTTP 503', retry: true, not: 'failed' }));
    expect(compare.slotOf('43017')).toBe(0);
    expect(compare.highlight('40006', true)).toBe(true);
    expect(compare.slotOf('40006')).toBe(8);
    compare.fetch('43017');                                       // Try again: asked again, no colour free for it
    await until(() => expect(w.asked).toEqual(['43017', '43017']));
    expect(compare.slotOf('43017')).toBe(0);
  });

  it('an answer with no history in it is final: no Try again, and no highlight', async () => {
    const w = world({}, { answer: () => ({ status: 200, body: EMPTY_PLOT }) });
    const { compare } = await load(w);
    compare.add('43017');
    await until(() => expect(compare.rows['43017']).toMatchObject({ st: 'failed', big: 'No history', retry: false, not: 'answer' }));
    expect(compare.highlight('43017', true)).toBe(false);
    expect(compare.refusal?.text).toBe('FOX-1B is not drawn: nothing in its history to fit.');
  });

  it('asks one at a time; a row removed while its request is out lets it finish, cached and not shown, and the queue waits for it', async () => {
    const w = world({}, { hold: true });
    const { compare } = await load(w);
    compare.add('25544'); compare.add('07530'); compare.add('43017');
    await until(() => expect(w.asked).toEqual(['25544']));
    expect(compare.rows['07530']).toEqual({ st: 'queued' });
    expect([compare.queuePos('07530'), compare.queuePos('43017'), compare.queuePos('25544')]).toEqual([1, 2, 0]);
    compare.remove('25544');
    expect(compare.rows['25544']).toBeUndefined();
    await until(() => expect(compare.say).toBe('Removed ISS (ZARYA) · 2 in the comparison. Its history had already been asked for: the next one waits until that answer is in.'));
    await later();
    expect(w.asked).toEqual(['25544']);                          // nothing else is asked while it is out
    w.release('25544');
    await until(() => expect(w.asked).toEqual(['25544', '07530']));
    expect(w.st.setItem).toHaveBeenCalledWith('hist:25544', expect.any(String));
    expect(compare.rows['25544']).toBeUndefined();
    expect(compare.queuePos('43017')).toBe(1);
    w.release('07530');
    await until(() => expect(w.asked).toEqual(['25544', '07530', '43017']));
    w.release('43017');
    await until(() => expect(compare.say).toBe('2 fetched.'));
    expect(w.most()).toBe(1);
  });

  it('a spacecraft listed again while its old request is out takes that answer: no second request', async () => {
    const w = world({}, { hold: true });
    const { compare } = await load(w);
    compare.add('25544');
    await until(() => expect(w.asked).toEqual(['25544']));
    compare.remove('25544');
    compare.add('25544');
    expect(compare.rows['25544']).toEqual({ st: 'fetching' });
    w.release('25544');
    await until(() => expect(compare.rows['25544']).toMatchObject({ st: 'shown' }));
    expect(w.asked).toEqual(['25544']);
  });

  it('removes a row that waits in the queue without asking for it; Clear drops the queue and says how many went', async () => {
    const seed: Record<string, string> = { 'hist:40000': cached(FALLING()) };
    const w = world(seed, { hold: true });
    const { compare } = await load(w);
    compare.add('25544'); compare.add('07530'); compare.add('40000');
    await until(() => expect(w.asked).toEqual(['25544']));
    compare.remove('07530');
    await until(() => expect(compare.say).toBe('Removed OSCAR 7 · 2 in the comparison'));
    compare.clear();
    expect(compare.items).toEqual([]);
    expect(compare.rows).toEqual({});
    await until(() => expect(compare.say).toBe('Cleared the comparison of 2 spacecraft.'));
    expect(w.st.removeItem).toHaveBeenLastCalledWith('gt.decaycmp');       // empty, and the panel shut
    w.release('25544');
    await later();
    expect(w.asked).toEqual(['25544']);
    expect(compare.rows).toEqual({});
  });

  it('Add watched lists them in starring order, highlights seven and asks for those only; Fetch asks for seven more at most', async () => {
    const watched = ['99999', '67683', ...nums(20)];               // one not in the catalogue, and the selected one
    const w = world({ 'gt.watch': JSON.stringify(watched), 'hist:40001': cached(FALLING()) }, { hold: true });
    const { compare, app } = await load(w);
    app.entry = { satnum: '67683', name: 'KNACKSAT-2', l1: '', l2: '' };
    compare.add('40019');
    await until(() => expect(w.asked).toEqual(['40019']));
    expect(compare.watchable).toEqual(nums(19));
    compare.addWatched();
    expect(compare.items.map(i => i.n)).toEqual(['40019', ...nums(19)]);
    expect(compare.items.filter(i => i.h).map(i => i.n)).toEqual(['40019', ...nums(6)]);
    await until(() => expect(compare.say).toBe('19 added: 1 from the cache, 5 are being fetched one at a time, 13 wait for Fetch.'));
    expect(compare.waiting).toEqual(nums(13, 40006));
    expect(compare.watchable).toEqual([]);
    for (let i = 0; i < 6; i++) { await until(() => expect(w.held()).toHaveLength(1)); w.release(w.held()[0]!); }
    await until(() => expect(compare.say).toBe('6 fetched.'));
    expect(w.asked).toEqual(['40019', '40000', '40002', '40003', '40004', '40005']);
    compare.fetchMore();
    await until(() => expect(compare.say).toBe('7 are being fetched one at a time, 6 still wait for Fetch.'));
    for (let i = 0; i < 7; i++) { await until(() => expect(w.held()).toHaveLength(1)); w.release(w.held()[0]!); }
    await until(() => expect(compare.say).toBe('7 fetched.'));
    expect(w.asked.slice(6)).toEqual(nums(7, 40006));
    expect(compare.waiting).toEqual(nums(6, 40013));
    expect(compare.items.filter(i => i.h)).toHaveLength(7);        // no colour was free: the seven asked for are grey
    expect(w.most()).toBe(1);
  });

  it('asks for the selected spacecraft first, with the Decay section\'s own request, when it has not been estimated', async () => {
    const w = world({}, { hold: true });
    const { compare, app, life } = await load(w);
    app.entry = { satnum: '67683', name: 'KNACKSAT-2', l1: '', l2: '' };
    life.view = { big: 'Not estimated yet', action: 'estimate' };
    compare.add('25544');
    compare.add('07530');
    await until(() => expect(life.start).toHaveBeenCalledTimes(1));
    expect(compare.queue).toEqual(['25544', '07530']);
    await later();
    expect(w.asked).toEqual([]);                                  // its turn first
    life.view = { big: 'Fetching…' };
    life.finish();
    await until(() => expect(w.asked).toEqual(['25544']));
    w.release('25544');
    await until(() => expect(w.asked).toEqual(['25544', '07530']));
    expect(life.start).toHaveBeenCalledTimes(1);
  });

  it('asks nothing of the section once it is estimated, or for a planned orbit; the selected row\'s Fetch asks it in the queue', async () => {
    const w = world({ 'hist:25544': cached(FALLING()) }, { hold: true });
    const { compare, app, life } = await load(w);
    app.entry = { satnum: '67683', name: 'KNACKSAT-2', l1: '', l2: '' };
    life.view = { big: '2027-01-01' };
    compare.add('07530');
    await until(() => expect(w.asked).toEqual(['07530']));
    expect(life.start).not.toHaveBeenCalled();
    app.entry = { satnum: 'O0001', name: 'My orbit', l1: '', l2: '', custom: true };
    life.view = { big: '—' };
    expect(compare.selected).toBeNull();
    expect(compare.planned).toBe(true);
    compare.add('25544');                                         // cached: nothing asked
    compare.fetchSelected();
    expect(life.start).not.toHaveBeenCalled();
    app.entry = { satnum: '67683', name: 'KNACKSAT-2', l1: '', l2: '' };
    life.view = { big: 'Not received', action: 'retry' };
    compare.fetchSelected();                                      // its row's Try again: after the one that is out
    expect(compare.queue).toEqual(['67683']);
    expect(compare.queuePos('67683')).toBe(1);
    w.release('07530');
    await until(() => expect(life.start).toHaveBeenCalledTimes(1));
  });

  it('offers the section the answer for a listed spacecraft that is now the selected one, not yet estimated, and hides its row', async () => {
    const w = world({}, { hold: true });
    const { compare, app, life } = await load(w);
    app.entry = { satnum: '67683', name: 'KNACKSAT-2', l1: '', l2: '' };
    compare.add('07530');
    await until(() => expect(w.asked).toEqual(['07530']));
    const oscar = { satnum: '07530', name: 'OSCAR 7', l1: '1', l2: '2' };
    app.entry = oscar;                                            // picked in the main picker while its request is out
    life.view = { big: 'Not estimated yet', action: 'estimate' };
    expect(compare.selected).toBe('07530');
    expect(compare.shown).toEqual([]);
    expect(compare.slotOf('07530')).toBe(2);                      // kept for when the selection moves on
    w.release('07530');
    await until(() => expect(life.offer).toHaveBeenCalledWith(oscar));
  });

  it('draws the selected spacecraft first, then the highlighted by colour, then the grey', async () => {
    const w = world({ 'hist:25544': cached(FALLING()), 'hist:07530': cached(FALLING()), 'hist:43017': cached(FALLING()) });
    const { compare, app, life } = await load(w);
    app.entry = { satnum: '67683', name: 'KNACKSAT-2', l1: '', l2: '' };
    const P = FALLING();
    life.chart = { P, r: { tNow: P.at(-1)!.t, hNow: 300, track: [] } };
    compare.add('25544'); compare.add('07530'); compare.add('43017');
    compare.highlight('25544', false);
    await until(() => expect(compare.lines).toHaveLength(4));
    expect(compare.lines.map(l => [l.n, l.slot])).toEqual([['67683', 1], ['07530', 3], ['43017', 4], ['25544', 0]]);
    life.chart = { P, r: { tNow: P.at(-1)!.t, hNow: 300, track: [] }, custom: true };
    expect(compare.lines.map(l => l.n)).toEqual(['07530', '43017', '25544']);
    life.chart = { P, r: { tNow: P.at(-1)!.t, hNow: 36000, track: [] } };
    expect(compare.lines.map(l => l.n)).toEqual(['07530', '43017', '25544']);
  });

  it('while the page\'s API answers, starts two requests at least seven seconds apart; answers from the cache are not held back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const api = { tle: vi.fn(), history: vi.fn(async () => ({ kind: 'down', why: 'api_error', error: 'upstream_unavailable' })) };
    vi.doMock('../../src/state/net', () => ({
      historyCtx: () => ({
        fetch: (u: string, i: unknown) => (window as unknown as { fetch: (u: string, i: unknown) => unknown }).fetch(u, i),
        now: () => Date.now(), storage: (window as unknown as { localStorage: unknown }).localStorage, isCustom: false, api,
        breaker: { isOpen: () => false, trip: () => {}, reset: () => {} }
      })
    }));
    const w = world({ 'hist:43017': cached(FALLING()) });
    const { compare } = await load(w);
    compare.add('25544');
    compare.add('07530');
    await vi.advanceTimersByTimeAsync(1);
    expect(w.asked).toEqual(['25544']);
    compare.add('43017');
    await vi.advanceTimersByTimeAsync(200);
    expect(compare.rows['43017']).toMatchObject({ st: 'shown' });  // from the cache, at once
    await vi.advanceTimersByTimeAsync(6500);
    expect(w.asked).toEqual(['25544']);
    await vi.advanceTimersByTimeAsync(500);
    expect(w.asked).toEqual(['25544', '07530']);
    expect(w.times[1]! - w.times[0]!).toBeGreaterThanOrEqual(7000);
    expect(api.history).toHaveBeenCalledTimes(2);
  });

  it('without an API, asks the next as soon as the last is in', async () => {
    const w = world();
    const { compare } = await load(w);
    compare.add('25544'); compare.add('07530');
    await until(() => expect(w.asked).toEqual(['25544', '07530']));
    expect(w.times[1]! - w.times[0]!).toBeLessThan(2000);
    await until(() => expect(compare.say).toBe('2 fetched.'));
  });

  it('says what the queue came to: so many fetched, so many not received', async () => {
    const w = world({}, { answer: n => (n === '43017' ? { status: 503, body: '' } : OK()) });
    const { compare } = await load(w);
    compare.add('25544'); compare.add('07530'); compare.add('43017');
    await until(() => expect(compare.say).toBe('2 fetched, 1 not received.'));
  });

  it('writes the list only for what the reader does; an empty list with the panel shut leaves nothing stored', async () => {
    const w = world({ 'hist:25544': cached(FALLING()) });
    const { compare } = await load(w);
    compare.setOpen(true);
    expect(w.writes()).toEqual(['{"o":1,"l":[]}']);
    compare.setOpen(true);                                        // no change, nothing written
    compare.add('25544');
    await until(() => expect(compare.rows['25544']).toMatchObject({ st: 'shown' }));
    compare.highlight('25544', false);
    expect(w.writes()).toEqual(['{"o":1,"l":[]}', '{"o":1,"l":[{"n":"25544","h":2}]}', '{"o":1,"l":[{"n":"25544"}]}']);
    compare.setOpen(false);
    expect(w.writes().at(-1)).toBe('{"o":0,"l":[{"n":"25544"}]}');
    compare.remove('25544');
    expect(w.st.removeItem).toHaveBeenLastCalledWith('gt.decaycmp');
    expect(w.st.getItem('gt.decaycmp')).toBeNull();
  });

  it('keeps the list for the visit where the browser refuses storage', async () => {
    const w = world({}, { refuse: true });
    const { compare } = await load(w);
    expect(compare.items).toEqual([]);
    expect(() => { compare.setOpen(true); compare.add('25544'); }).not.toThrow();
    expect(compare.items).toEqual([{ n: '25544', h: 2 }]);
    await until(() => expect(compare.rows['25544']).toMatchObject({ st: 'shown' }));
  });

  it('hears another tab: its list is read again (this panel stays as it is), and nothing is fetched or written for it', async () => {
    const w = world({ 'gt.decaycmp': '{"o":1,"l":[{"n":"25544","h":2}]}', 'hist:07530': cached(FALLING()) });
    const { compare } = await load(w);
    await until(() => expect(compare.rows['25544']).toEqual({ st: 'wait' }));
    w.st.setItem('gt.decaycmp', '{"o":0,"l":[{"n":"07530","h":2},{"n":"43017"}]}');
    w.hear('gt.decaycmp');
    expect(compare.items).toEqual([{ n: '07530', h: 2 }, { n: '43017' }]);
    expect(compare.open).toBe(true);
    expect(compare.rows['25544']).toBeUndefined();
    await until(() => expect(compare.rows['07530']).toMatchObject({ st: 'shown' }));
    await until(() => expect(compare.rows['43017']).toEqual({ st: 'wait' }));
    const before = compare.items;
    w.hear('gt.prefs');
    expect(compare.items).toBe(before);
    w.st.removeItem('gt.decaycmp');
    w.hear(null);
    expect(compare.items).toEqual([]);
    expect(compare.rows).toEqual({});
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.writes()).toHaveLength(1);                           // the test's own, as the other tab
  });
});
