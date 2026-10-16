import { afterEach, describe, expect, it, vi } from 'vitest';
import * as satellite from 'satellite.js';
import { decayedAt } from '../../src/lib/catalogue/decayed';
import { BODY, byName, CATALOGUE } from '../lib/helpers';

/* The picker's "decayed now" as a store (CHANGES-FROM-LEGACY.md, L59): nothing is worked out until the list asks; then the 2,158
   propagations go in slices (an idle moment is used while it lasts, and a fixed slice is the least done in one go), the marks
   appear together once the last slice is through, a set less than an hour old is not worked out again, the lines asked about are
   the ones a pick would analyse (a live set taken for an entry, not the embedded one), and nothing is fetched. Each test loads the
   store afresh. The instant is fixed: what has come down depends on when you ask. */
const W0 = Date.UTC(2026, 8, 14, 0, 0, 0);
type Idle = { timeRemaining(): number; didTimeout: boolean };
type Step = (d?: Idle) => void;

async function load() {
  vi.resetModules();
  const [{ decayed, SLICE }, { live }] = await Promise.all([import('../../src/state/decayed.svelte'), import('../../src/state/live.svelte')]);
  return { decayed, SLICE, live };
}
/** a scheduler that keeps the slices for the test to run */
function queue() {
  const q: Step[] = [];
  const run = (f: Step) => { q.push(f); };
  const drain = (d?: Idle) => { let n = 0; while (q.length) { q.shift()!(d); n++; } return n; };
  return { q, run, drain };
}
const atW0 = () => [...decayedAt(CATALOGUE, W0, satellite as never, BODY)];
const positions = (nums: string[]) => CATALOGUE.flatMap((e, i) => (nums.includes(e.satnum) ? [i] : [])).sort((a, b) => a - b);

describe('the decayed-now store', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('works nothing out until asked, then marks, in slices, the catalogue positions SGP4 has down at that moment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed, SLICE } = await load();
    expect(decayed.set).toBeNull();
    const { q, run, drain } = queue();
    expect(decayed.ensure(CATALOGUE, run)).toBe(decayed);
    expect(q.length).toBe(1);
    expect(decayed.set).toBeNull();                       // nothing until a slice has run, and nothing marked part-way
    q.shift()!();
    expect(decayed.set).toBeNull();
    const slices = 1 + drain();
    expect(slices).toBe(Math.ceil(CATALOGUE.length / SLICE));
    const want = positions(atW0());
    expect([...decayed.set!].sort((a, b) => a - b)).toEqual(want);
    expect(want.length).toBe(13);
    expect(decayed.at).toBe(W0);
    const odin = CATALOGUE.indexOf(byName('ODIN')), knack = CATALOGUE.indexOf(byName('KNACKSAT-2'));
    expect(decayed.has(odin)).toBe(true);
    expect(decayed.has(knack)).toBe(false);
    expect(decayed.has(CATALOGUE.length)).toBe(false);     // the picker's first index for an orbit of the reader's own
    expect(decayed.any([knack, odin])).toBe(true);
    expect(decayed.any([knack, CATALOGUE.length])).toBe(false);
    expect(decayed.label).toBe('decayed now');
    expect(decayed.note).toMatch(/^Decayed now: at this moment SGP4 has it below the 120 km entry interface/);
  });

  it('goes on while an idle moment lasts, and does one fixed slice when the wait for one ran out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed, SLICE } = await load();
    let { run, drain } = queue();
    decayed.ensure(CATALOGUE, run);
    expect(drain({ didTimeout: false, timeRemaining: () => 50 })).toBe(1);     // a long idle moment: the whole list in one go
    expect(decayed.set!.size).toBe(13);

    vi.setSystemTime(W0 + 3600e3 + 1);                    // stale: worked out again
    ({ run, drain } = queue());
    decayed.ensure(CATALOGUE, run);
    expect(drain({ didTimeout: true, timeRemaining: () => 50 })).toBe(Math.ceil(CATALOGUE.length / SLICE));
    /* Playwright's fake idle callback hands over no time at all: the slice still makes progress */
    vi.setSystemTime(W0 + 2 * 3600e3 + 2);
    ({ run, drain } = queue());
    decayed.ensure(CATALOGUE, run);
    expect(drain({ didTimeout: false, timeRemaining: () => 0 })).toBe(Math.ceil(CATALOGUE.length / SLICE));
  });

  it('is not worked out again within the hour, nor twice at once, nor for an empty catalogue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed } = await load();
    const run = vi.fn();
    decayed.ensure([], run);
    expect(run).not.toHaveBeenCalled();
    const { q, run: keep, drain } = queue();
    decayed.ensure(CATALOGUE, keep);
    decayed.ensure(CATALOGUE, run);                       // under way: not started twice
    expect(run).not.toHaveBeenCalled();
    drain();
    vi.setSystemTime(W0 + 3599e3);
    decayed.ensure(CATALOGUE, run);
    expect(run).not.toHaveBeenCalled();
    expect(q.length).toBe(0);
    decayed.ensure(CATALOGUE.slice(), run);                // another list (the catalogue read again): worked out for it
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('asks about the lines a pick would analyse: a live set taken for an entry, not the embedded one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed, live } = await load();
    const odin = byName('ODIN'), knack = byName('KNACKSAT-2');
    live.sets.set(odin.satnum, { l1: knack.l1, l2: knack.l2, src: 'test', at: W0 });
    const { run, drain } = queue();
    decayed.ensure(CATALOGUE, run);
    drain();
    expect(decayed.has(CATALOGUE.indexOf(odin))).toBe(false);
    expect(decayed.set!.size).toBe(12);
  });

  it('falls back to timers where the browser has no idle callback, fetches nothing, and leaves the catalogue as it was', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(W0);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { decayed } = await load();
    const list = Object.freeze(CATALOGUE.slice());
    decayed.ensure(list);
    expect(decayed.set).toBeNull();
    vi.runAllTimers();
    expect(decayed.set!.size).toBe(13);
    expect(list.length).toBe(2158);
    expect(list.every((e, i) => e === CATALOGUE[i])).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
