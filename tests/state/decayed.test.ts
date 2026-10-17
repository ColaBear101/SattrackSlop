import { afterEach, describe, expect, it, vi } from 'vitest';
import * as satellite from 'satellite.js';
import { decayedAt } from '../../src/lib/catalogue/decayed';
import { BODY, byName, CATALOGUE } from '../lib/helpers';

/* The picker's "decayed now" as a store (CHANGES-FROM-LEGACY.md, L59): nothing is worked out until the list asks; then the 2,158
   propagations go in slices (an idle moment is used while it lasts, and a fixed slice is the least done in one go), the marks
   appear together once the last slice is through, at the clock's instant (not the wall clock's: a load puts the clock at the start
   of the window it analyses). A set is not worked out again while it is fresh: the same list, the same live sets, and a clock
   within the hour of its instant. The lines asked about are the ones a pick would analyse (a live set taken for an entry, not the
   embedded one, whether it was taken before the first opening or after), and nothing is fetched. Each test loads the store afresh.
   The instants are fixed: what has come down depends on when you ask. */
const W0 = Date.UTC(2026, 8, 14, 0, 0, 0);
const EPOCH = Date.parse('2026-09-12T07:29:09.993Z');          // KNACKSAT-2's set: the Window popover's "Epoch" puts the window there
type Idle = { timeRemaining(): number; didTimeout: boolean };
type Step = (d?: Idle) => void;

async function load() {
  vi.resetModules();
  const [{ decayed, SLICE }, { live }, { clock }] = await Promise.all([
    import('../../src/state/decayed.svelte'), import('../../src/state/live.svelte'), import('../../src/state/clock.svelte')]);
  return { decayed, SLICE, live, clock };
}
/** a scheduler that keeps the slices for the test to run */
function queue() {
  const q: Step[] = [];
  const run = (f: Step) => { q.push(f); };
  const drain = (d?: Idle) => { let n = 0; while (q.length) { q.shift()!(d); n++; } return n; };
  return { q, run, drain };
}
const downAt = (ms: number) => [...decayedAt(CATALOGUE, ms, satellite as never, BODY)];
const positions = (nums: string[]) => CATALOGUE.flatMap((e, i) => (nums.includes(e.satnum) ? [i] : [])).sort((a, b) => a - b);
const marked = (set: ReadonlySet<number> | null) => [...set!].sort((a, b) => a - b);

describe('the decayed-now store', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('works nothing out until asked, then marks, in slices, the catalogue positions SGP4 has down at the clock\'s instant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed, SLICE, clock } = await load();
    expect(clock.now()).toBe(W0);
    expect(decayed.set).toBeNull();
    const { q, run, drain } = queue();
    expect(decayed.ensure(CATALOGUE, run)).toBe(decayed);
    expect(q.length).toBe(1);
    expect(decayed.set).toBeNull();                       // nothing until a slice has run, and nothing marked part-way
    q.shift()!();
    expect(decayed.set).toBeNull();
    const slices = 1 + drain();
    expect(slices).toBe(Math.ceil(CATALOGUE.length / SLICE));
    const want = positions(downAt(W0));
    expect(marked(decayed.set)).toEqual(want);
    expect(want.length).toBe(14);
    expect(decayed.at).toBe(W0);
    const odin = CATALOGUE.indexOf(byName('ODIN')), knack = CATALOGUE.indexOf(byName('KNACKSAT-2'));
    expect(decayed.has(odin)).toBe(true);
    expect(decayed.has(CATALOGUE.indexOf(byName('STARLINK-2342')))).toBe(true);    // refused with error 1 a month after its epoch: spent
    expect(decayed.has(knack)).toBe(false);
    expect(decayed.has(CATALOGUE.length)).toBe(false);     // the picker's first index for an orbit of the reader's own
    expect(decayed.any([knack, odin])).toBe(true);
    expect(decayed.any([knack, CATALOGUE.length])).toBe(false);
    expect(decayed.label).toBe('decayed now');
    expect(decayed.note).toMatch(/^Decayed now: at the clock's instant SGP4 has it below the 120 km entry interface/);
  });

  it('marks for the clock\'s instant, not the wall clock\'s: with the window moved to a set\'s epoch, what is down there', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 16));               // the wall clock: 16 October, when twenty-four are down
    const { decayed, clock } = await load();
    clock.seek(EPOCH);                                    // a load puts the clock at the start of the window it analyses
    const { run, drain } = queue();
    decayed.ensure(CATALOGUE, run);
    drain();
    expect(decayed.at).toBe(EPOCH);
    expect(marked(decayed.set)).toEqual(positions(downAt(EPOCH)));
    expect(decayed.set!.size).toBe(13);
    expect(downAt(Date.UTC(2026, 9, 16)).length).toBe(24);
    expect(decayed.has(CATALOGUE.indexOf(byName('COSMOS 2558')))).toBe(false);     // not yet under 120 km at that epoch
    /* the instant can be handed in as well */
    const again = queue();
    decayed.ensure(CATALOGUE, again.run, W0);
    again.drain();
    expect(decayed.at).toBe(W0);
    expect(decayed.set!.size).toBe(14);
  });

  it('goes on while an idle moment lasts, and does one fixed slice when the wait for one ran out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed, SLICE, clock } = await load();
    let { run, drain } = queue();
    decayed.ensure(CATALOGUE, run);
    expect(drain({ didTimeout: false, timeRemaining: () => 50 })).toBe(1);     // a long idle moment: the whole list in one go
    expect(decayed.set!.size).toBe(14);

    clock.seek(W0 + 3600e3 + 1);                          // stale: worked out again
    ({ run, drain } = queue());
    decayed.ensure(CATALOGUE, run);
    expect(drain({ didTimeout: true, timeRemaining: () => 50 })).toBe(Math.ceil(CATALOGUE.length / SLICE));
    /* Playwright's fake idle callback hands over no time at all: the slice still makes progress */
    clock.seek(W0 + 2 * 3600e3 + 2);
    ({ run, drain } = queue());
    decayed.ensure(CATALOGUE, run);
    expect(drain({ didTimeout: false, timeRemaining: () => 0 })).toBe(Math.ceil(CATALOGUE.length / SLICE));
  });

  it('is not worked out again within the hour of the clock, nor twice at once, nor for an empty catalogue; an hour back is stale too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed, clock } = await load();
    const run = vi.fn();
    decayed.ensure([], run);
    expect(run).not.toHaveBeenCalled();
    const { q, run: keep, drain } = queue();
    decayed.ensure(CATALOGUE, keep);
    decayed.ensure(CATALOGUE, run);                       // under way: not started twice
    expect(run).not.toHaveBeenCalled();
    drain();
    clock.seek(W0 + 3599e3);
    vi.setSystemTime(W0 + 5 * 3600e3);                    // the wall clock does not count: the clock is within the hour
    decayed.ensure(CATALOGUE, run);
    expect(run).not.toHaveBeenCalled();
    expect(q.length).toBe(0);
    clock.seek(W0 - 3601e3);                              // put back more than an hour: worked out again
    decayed.ensure(CATALOGUE, run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is worked out again for another list (the catalogue read again)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed } = await load();
    const { run, drain } = queue();
    decayed.ensure(CATALOGUE, run);
    drain();
    const other = vi.fn();
    decayed.ensure(CATALOGUE.slice(), other);
    expect(other).toHaveBeenCalledTimes(1);
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
    expect(decayed.set!.size).toBe(13);
  });

  it('follows a live set taken after the list was first opened (live.check adopts one after a pick), and one given back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(W0);
    const { decayed, live } = await load();
    const odin = byName('ODIN'), knack = byName('KNACKSAT-2'), cosmos = byName('COSMOS 2558');
    const iOdin = CATALOGUE.indexOf(odin), iKnack = CATALOGUE.indexOf(knack);
    let { run, drain } = queue();
    decayed.ensure(CATALOGUE, run);
    drain();
    expect(decayed.has(iOdin)).toBe(true);
    expect(decayed.has(iKnack)).toBe(false);
    /* within the hour, the same list: a newer set for ODIN that has it in orbit, and one for KNACKSAT-2 that has it under 120 km */
    live.sets.set(odin.satnum, { l1: knack.l1, l2: knack.l2, src: 'test', at: W0 });
    live.sets.set(knack.satnum, { l1: cosmos.l1, l2: cosmos.l2, src: 'test', at: W0 });
    ({ run, drain } = queue());
    decayed.ensure(CATALOGUE, run);
    expect(drain()).toBeGreaterThan(0);                   // worked out again, though the list and the hour are the same
    expect(decayed.has(iOdin)).toBe(false);
    expect(decayed.has(iKnack)).toBe(true);
    /* a set the check took and then gave back (a newer set SGP4 could not propagate in the window): the embedded lines again */
    live.sets.delete(odin.satnum);
    ({ run, drain } = queue());
    decayed.ensure(CATALOGUE, run);
    drain();
    expect(decayed.has(iOdin)).toBe(true);
    /* and nothing changed since: fresh */
    const still = vi.fn();
    decayed.ensure(CATALOGUE, still);
    expect(still).not.toHaveBeenCalled();
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
    expect(decayed.set!.size).toBe(14);
    expect(list.length).toBe(2158);
    expect(list.every((e, i) => e === CATALOGUE[i])).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
