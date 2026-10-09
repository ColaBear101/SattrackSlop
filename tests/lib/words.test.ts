import { describe, expect, it } from 'vitest';
import { ago, compass, hhmmss, iso, localMinute, mmss, spanLabel, whenLocal, whenZ, ymd } from '../../src/lib/text/fmt';
import { liveLine, ages, type Prov } from '../../src/lib/text/provenance';
import { plain, b, abbr, link, warn, type Inline } from '../../src/lib/text/rich';
import { tleSourceText } from '../../src/lib/export/source';
import { countdown } from '../../src/lib/text/countdown';
import { siteNote } from '../../src/lib/text/site';
import { passFacts, clipText, atEdge, siteClock } from '../../src/lib/text/passfacts';
import { BANGKOK, byName, world, MASK } from './helpers';

/* The sentences the page says about where its numbers came from and when the next pass is. The old page wrote them
   into the DOM; these are the same words as data, and the wording is what the suites (and the README) rely on. */
describe('formatters', () => {
  it('mmss keeps an hour as an hour, and rounds before it splits', () => {
    expect(mmss(59.7)).toBe('1m 00s');
    expect(mmss(352)).toBe('5m 52s');
    expect(mmss(3900)).toBe('1h 05m');
  });
  it('ago picks the unit that reads best', () => {
    expect(ago(12_000)).toBe('12 s');
    expect(ago(40 * 60_000)).toBe('40 min');
    expect(ago(3.5 * 3_600_000)).toBe('3.5 h');
    expect(ago(4.25 * 86_400_000)).toBe('4.3 days');
    expect(ago(-5)).toBe('0 s');
  });
  it('hhmmss does not wrap at 24 hours', () => { expect(hhmmss(26 * 3_600_000 + 61_000)).toBe('26:01:01'); });
  it('spanLabel counts days from two', () => { expect([6, 24, 48, 72, 168].map(spanLabel)).toEqual(['6 h', '24 h', '2 d', '3 d', '7 d']); });
  it('whenLocal names the date only when the local day differs', () => {
    const d = new Date(Date.UTC(2026, 8, 12, 20, 0, 0));
    expect(whenLocal(d, 7, 'UTC+7')).toBe('09-13 03:00:00 UTC+7');
    expect(whenLocal(new Date(Date.UTC(2026, 8, 12, 3, 0, 0)), 7, 'UTC+7')).toBe('10:00:00 UTC+7');
    expect(whenZ(d)).toBe('09-12 20:00:00Z');
    expect(localMinute(d, 7)).toBe('2026-09-13 03:00');
    expect(ymd(d)).toBe('2026-09-12');
    expect(iso(d)).toBe('2026-09-12 20:00:00Z');
  });
  it('compass names sixteen points and wraps', () => {
    expect(compass(0)).toBe('N'); expect(compass(90)).toBe('E'); expect(compass(359)).toBe('N'); expect(compass(-10)).toBe('N');
  });
});

describe('the rich text AST', () => {
  it('flattens to the words a reader or a test would read', () => {
    const x: Inline = ['a ', b('bold'), ' ', abbr({ text: 'AOS', title: 't' }), ' ', warn('late'), ' ', link('#x', 'see'), { br: true }, 'end'];
    expect(plain(x)).toBe('a bold AOS late see\nend');
  });
});

describe('where the element set came from (liveLine)', () => {
  const NOW = 1_800_000_000_000;
  const line = (prov: Prov | null, o: { custom?: boolean; embedded?: boolean } = {}) =>
    liveLine({ custom: !!o.custom, prov, embedded: o.embedded ?? true, now: NOW });
  const say = (prov: Prov | null, o = {}) => plain(line(prov, o)[1]);

  it('says it is still checking until a check has been recorded', () => {
    expect(line(null)).toEqual(['checking', 'Checking for a newer element set…']);
  });
  it('a custom orbit is never checked and says so first, whatever else is on record', () => {
    expect(line({ src: 'CelesTrak', at: NOW }, { custom: true })[0]).toBe('custom');
    expect(say(null, { custom: true })).toMatch(/nothing was fetched/);
  });
  it('the pinned snapshot says it is not refreshed', () => {
    expect(say({ pinned: true })).toBe('Assignment snapshot — the embedded element set, not refreshed.');
  });
  it('confirmed and updated say when the check happened, in the unit that reads best', () => {
    expect(say({ src: 'CelesTrak', at: NOW - 10_000 })).toBe('Confirmed current against CelesTrak · checked just now.');
    expect(say({ src: 'CelesTrak', at: NOW - 4 * 60_000 })).toBe('Confirmed current against CelesTrak · checked 4 min ago.');
    expect(say({ src: 'TLE API', at: NOW - 3 * 3_600_000, updated: true })).toBe('Updated live from TLE API · checked 3.0 h ago.');
  });
  it('a withdrawal and a set SGP4 cannot propagate are reported as what they are, not as an outage', () => {
    expect(say({ gone: 'CelesTrak', at: NOW })).toMatch(/^CelesTrak has no current elements for this object · checked just now — it may have re-entered\.$/);
    expect(say({ dead: 'CelesTrak', at: NOW, code: 6, why: 'error 6: decayed' })).toMatch(/cannot propagate in this window \(error 6: decayed\).*the object may have re-entered\.$/);
    expect(say({ dead: 'CelesTrak', at: NOW, code: 1, why: 'x' })).not.toMatch(/re-entered/);
  });
  it('an older set and an unreachable source name which set is being kept, read off the lines', () => {
    expect(say({ src: null, older: 'TLE API' }, { embedded: true })).toBe('TLE API offered an older set — keeping the embedded one.');
    expect(say({ src: null, older: 'TLE API' }, { embedded: false })).toMatch(/keeping the newer one on screen, fetched live earlier\.$/);
    expect(say({ src: null }, { embedded: true })).toBe('No live source reachable — showing the embedded snapshot.');
    expect(say({ src: null }, { embedded: false })).toBe('No live source reachable — keeping the set on screen, fetched live earlier.');
  });
});

describe('the age chip', () => {
  const epoch = new Date(Date.UTC(2026, 8, 12, 7, 29, 9));
  const base = { custom: false, prov: null, embedded: true, epoch, name: 'X', satnum: '1', fetched: new Date(Date.UTC(2026, 8, 12, 17, 9, 2)), source: 'S', pinned: false };
  it('flags a set over three days old as stale, with the reason', () => {
    const young = ages({ ...base, now: epoch.getTime() + 2 * 86_400_000 });
    const old = ages({ ...base, now: epoch.getTime() + 4 * 86_400_000 });
    expect(young.chip).toMatchObject({ text: 'epoch 2.0 days old', stale: false });
    expect(old.chip.stale).toBe(true);
    expect(old.chip.title).toMatch(/over three days old/);
  });
  it('a planned orbit has no measured set to age, so nothing about it goes stale', () => {
    const a = ages({ ...base, custom: true, now: epoch.getTime() + 40 * 86_400_000 });
    expect(a.chip.stale).toBe(false);
    expect(a.chip.text).toMatch(/^custom orbit · epoch 40\.0 days ago$/);
    expect(ages({ ...base, custom: true, now: epoch.getTime() - 5 * 86_400_000 }).chip.text).toBe('custom orbit · epoch in 5.0 days');
  });
});

describe('where the element set came from, as the CSV states it (tleSourceText)', () => {
  const at = Date.UTC(2026, 8, 20, 6);
  const t = (o: Partial<Parameters<typeof tleSourceText>[0]>) =>
    tleSourceText({ custom: false, prov: null, embedded: true, l1: 'a', l2: 'b', cached: null, ...o });
  it('embedded, confirmed or not', () => {
    expect(t({})).toBe('embedded');
    expect(t({ prov: { src: 'CelesTrak', at } })).toBe('embedded, confirmed current by CelesTrak 2026-09-20T06:00:00.000Z');
  });
  it('says what the last check said against the set when it was not a newer one', () => {
    expect(t({ prov: { gone: 'CelesTrak', at } })).toBe('embedded; CelesTrak reports no current set 2026-09-20T06:00:00.000Z');
    expect(t({ prov: { dead: 'CelesTrak', at } })).toMatch(/^embedded; CelesTrak has a newer set SGP4 cannot propagate/);
  });
  it('a set taken live is the live one, whatever the last check said', () => {
    expect(t({ embedded: false, prov: { src: 'TLE API', at } })).toBe('TLE API, fetched 2026-09-20T06:00:00.000Z');
    expect(t({ embedded: false, prov: { src: null }, l1: 'x', l2: 'y', cached: { l1: 'x', l2: 'y', src: 'CelesTrak', at } })).toBe('CelesTrak, fetched 2026-09-20T06:00:00.000Z');
    expect(t({ embedded: false, prov: null })).toBe('fetched live, source not recorded');
  });
  it('a custom orbit is never embedded and never fetched', () => {
    expect(t({ custom: true, prov: { src: 'CelesTrak', at } })).toMatch(/^custom orbit planned on this page/);
  });
});

describe('the countdown, against a real analysis', () => {
  const { eng } = world();
  const entry = byName('KNACKSAT-2');
  const start = Date.parse('2026-09-12T07:29:09.993Z');
  const D = eng.compute(entry, start, 24);
  const c = siteClock(BANGKOK);
  const cd = (ms: number, after: Parameters<typeof countdown>[5] = () => null) => countdown(D, ms, ms, MASK, c, after);

  it('before the first pass it counts down to it, with its AOS in both zones and its peak', () => {
    const r = cd(start);
    expect(r.label).toBe('Next pass in');
    expect(r.live).toBe(false);
    expect(r.value).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(plain(r.when)).toMatch(/^AOS \d\d-\d\d \d\d:\d\d:\d\dZ · .* UTC\+7 · max \d+\.\d°$/);
  });
  it('inside a pass it counts down to the set', () => {
    const p = D.passes[0]!;
    const r = cd((p.t0ms + p.t1ms) / 2);
    expect(r.label).toBe('In view now — sets in');
    expect(r.live).toBe(true);
    expect(plain(r.when)).toMatch(/^LOS .*(culminates|highest in window) \d+\.\d°$/);
  });
  it('past the window it says so and tells you how to move it', () => {
    const r = cd(D.end.getTime() + 3_600_000);
    expect(r.label).toBe('Outside the window');
    expect(r.value).toBe('—');
    expect(plain(r.when)).toMatch(/Press Now or Epoch/);
  });
  it('past the last pass it asks for the first pass after the window, and says when none comes', () => {
    const last = D.passes[D.passes.length - 1]!;
    const none = cd(last.t1ms + 60_000, () => null);
    expect(none).toMatchObject({ label: 'Next pass', value: 'none' });
    expect(plain(none.when)).toBe('Nothing clears the 5° mask in the rest of this window or the 48 h after it.');
    const later = D.passes[0]!;
    const r = cd(last.t1ms + 60_000, () => ({ ...later, t0ms: D.end.getTime() + 1000 }));
    expect(plain(r.when)).toMatch(/after this window$/);
  });
  it('a clock that is not now says so', () => {
    expect(countdown(D, start, start + 3_600_000, MASK, c, () => null).label).toMatch(/· sim time$/);
  });
});

describe('the facts about a pass', () => {
  const { eng } = world();
  const D = eng.compute(byName('KNACKSAT-2'), Date.parse('2026-09-12T07:29:09.993Z'), 24);
  const c = siteClock(BANGKOK);
  it('lists the pass, its times in both zones, its culmination and its duration', () => {
    const p = D.passes[0]!;
    const rows = passFacts(p, 0, D.passes.length, c, []);
    expect(rows.map(r => plain(r[0]))).toEqual(['Pass', 'AOS', atEdge(p) ? 'Highest in window' : 'Culmination', 'LOS', 'Duration']);
    expect(plain(rows[0]![1])).toBe('1 of ' + D.passes.length);
    expect(plain(rows[4]![1])).toMatch(/^\d+m \d\ds {2}· {2}min range \d+ km$/);
  });
  it('a pass cut by the window edge says so, in words', () => {
    const p = { ...D.passes[0]!, clipA: true, clipL: false };
    expect(plain(clipText(p)!)).toBe('already up when the window opens; true AOS is earlier');
    expect(passFacts(p, 0, 1, c, []).some(r => plain(r[0]) === '* Window edge')).toBe(true);
    expect(clipText({ ...p, clipA: false })).toBeNull();
  });
});

describe('what the observer form says about the offset', () => {
  const home = { ...BANGKOK };
  const say = (site: object, pinned = false) => plain(siteNote({ site: { ...home, ...site }, home, pinned, tzLabel: 'UTC+7' }));
  it('the assignment site says so, and points at the snapshot', () => {
    expect(say({})).toMatch(/^The assignment site\. The README’s figures use it.*assignment snapshot reproduces them\..*UTC\+7, which Bangkok keeps all year\.$/);
    expect(say({}, true)).toMatch(/^The assignment site, in the assignment snapshot/);
  });
  it('a moved site says the README no longer describes the page, and why its offset is what it is', () => {
    expect(say({ lat: 51.5, lon: -0.12, tz: 0, zone: 'Europe/London' })).toMatch(/^Moved from Bangkok.*Europe\/London, so the offset follows summer time where it is kept\.$/);
    expect(say({ lat: 18.78, lon: 98.98, tz: 7 })).toMatch(/is an estimate: the nearest hour of solar time\. Correct it under Enter coordinates\.$/);
    expect(say({ lat: 18.78, lon: 98.98, tz: 8 })).toMatch(/is the offset as entered, and does not follow summer time\.$/);
  });
});
