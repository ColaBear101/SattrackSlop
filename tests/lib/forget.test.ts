import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORGET_KEYS, FORGET_PREFIXES, forget, ours, searchAfterForget, survey, type ForgetStore } from '../../src/lib/forget';
import { FORGET_ARMED_LABEL, FORGET_BLOCKED, FORGET_LABEL, FORGET_NOTHING, forgetArmed, forgetLeft, partWords } from '../../src/lib/text/forget';

/* Forgetting what the page stored (CHANGES-FROM-LEGACY.md, L50): what is counted, what is removed and what is left alone, the address the
   page opens afterwards, the words, and a scan of the source that fails when the code keeps something under a key lib/forget.ts does not
   know. */

/** A Storage as the browser has it: insertion-ordered keys, `length` and `key(i)`; `refuse` names keys whose removal throws. */
class FakeStore implements ForgetStore {
  private m = new Map<string, string>();
  constructor(init: Record<string, string> = {}, private refuse: string[] = []) { for (const [k, v] of Object.entries(init)) this.m.set(k, v); }
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { if (this.refuse.includes(k)) throw new DOMException('no', 'SecurityError'); this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}

const SITE = JSON.stringify({ lat: 51.5, lon: -0.12, altKm: 0.02, name: 'London', tz: 0, zone: 'Europe/London', where: 'England' });
const RECENT = JSON.stringify([{ name: 'London', lat: 51.5, lon: -0.12 }, { name: 'Oslo', lat: 59.9, lon: 10.7 }]);
const CUSTOM = JSON.stringify({ v: 1, next: 3, items: [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }] });
const EVERYTHING = {
  'obs-site': SITE, 'obs-recent': RECENT, 'gt.prefs': '{"theme":"dark","tab":"map"}', 'gt.surface': 'vector', 'gt.custom': CUSTOM, 'gt.custom.bak': 'x',
  'gt.arlens': '60', 'gt.araim': 'head', 'gt.arradar': '0', 'tle:25544': '{}', 'tle:07530': '{}', 'hist:25544': '{}',
  'someone-else': 'keep me', 'gtx': 'keep me', 'GT.prefs': 'keep me', 'tle': 'keep me'
};

describe('what is the page\'s', () => {
  it('is a key in one of its four namespaces, and nothing else on the origin', () => {
    for (const k of ['obs-site', 'obs-recent', 'gt.prefs', 'gt.anything.later', 'tle:25544', 'hist:1']) expect(ours(k)).toBe(true);
    for (const k of ['someone-else', 'gtx', 'GT.prefs', 'tle', 'hist', 'obs', 'gt', '']) expect(ours(k)).toBe(false);
  });
  it('covers every fixed key it names', () => {
    for (const k of FORGET_KEYS) expect(ours(k)).toBe(true);
    expect(new Set(FORGET_KEYS).size).toBe(FORGET_KEYS.length);
  });
});

describe('survey', () => {
  it('is null where the store cannot be read, and says nothing is stored on an empty one or one of somebody else\'s keys only', () => {
    expect(survey(null)).toBeNull();
    const broken: ForgetStore = { get length(): number { throw new DOMException('no', 'SecurityError'); }, key: () => null, getItem: () => null, removeItem: () => {} };
    expect(survey(broken)).toBeNull();
    expect(survey(new FakeStore())).toEqual({ keys: [], parts: [] });
    expect(survey(new FakeStore({ 'someone-else': '1' }))).toEqual({ keys: [], parts: [] });
  });
  it('counts what is there, in the order the page says it', () => {
    const s = survey(new FakeStore(EVERYTHING))!;
    expect(s.keys).toEqual(['obs-site', 'obs-recent', 'gt.prefs', 'gt.surface', 'gt.custom', 'gt.custom.bak', 'gt.arlens', 'gt.araim', 'gt.arradar', 'tle:25544', 'tle:07530', 'hist:25544']);
    expect(s.parts).toEqual([
      { kind: 'site' }, { kind: 'recents', n: 2 }, { kind: 'choices', n: 5 }, { kind: 'orbits', n: 2 }, { kind: 'tle', n: 2 }, { kind: 'hist', n: 1 }
    ]);
  });
  it('says a record it cannot read without a count, and a later version\'s gt. key as a choice', () => {
    expect(survey(new FakeStore({ 'obs-recent': 'not json', 'gt.custom': '{"items":7}' }))!.parts).toEqual([{ kind: 'recents', n: null }, { kind: 'orbits', n: null }]);
    expect(survey(new FakeStore({ 'gt.custom.bak': 'old' }))!.parts).toEqual([{ kind: 'orbits', n: null }]);
    expect(survey(new FakeStore({ 'gt.watch': '[]' }))!.parts).toEqual([{ kind: 'choices', n: 1 }]);
  });
  it('does not call an empty list of orbits nothing to lose while a record this version could not read is kept beside it', () => {
    /* restore() moves an unreadable record to .bak; an orbit made and deleted afterwards leaves {v, next:2, items:[]} (an empty list keeps
       the counter). The second press removes the .bak, the only copy of those orbits, so the warning stays. */
    const EMPTY = '{"v":1,"next":2,"items":[]}';
    expect(survey(new FakeStore({ 'gt.custom': EMPTY }))!.parts).toEqual([{ kind: 'orbits', n: 0 }]);
    const both = survey(new FakeStore({ 'gt.custom': EMPTY, 'gt.custom.bak': 'old' }))!.parts;
    expect(both).toEqual([{ kind: 'orbits', n: null }]);
    expect(forgetArmed(both)).toBe('Press again to forget these and reload the page: the record of your own orbits. Your own orbits cannot be brought back.');
    expect(survey(new FakeStore({ 'gt.custom': CUSTOM, 'gt.custom.bak': 'old' }))!.parts).toEqual([{ kind: 'orbits', n: 2 }]);
  });
});

describe('forget', () => {
  it('removes every key of the page\'s and leaves somebody else\'s', () => {
    const st = new FakeStore(EVERYTHING);
    const r = forget(st);
    expect(r.left).toEqual([]);
    expect(r.removed.sort()).toEqual(Object.keys(EVERYTHING).filter(ours).sort());
    expect(st.keys()).toEqual(['someone-else', 'gtx', 'GT.prefs', 'tle']);
    expect(survey(st)).toEqual({ keys: [], parts: [] });
  });
  it('says what the browser would not remove, and removes the rest', () => {
    const st = new FakeStore(EVERYTHING, ['gt.custom']);
    const r = forget(st);
    expect(r.left).toEqual(['gt.custom']);
    expect(r.removed).not.toContain('gt.custom');
    expect(st.keys().filter(ours)).toEqual(['gt.custom']);
  });
  it('does nothing to an empty store', () => {
    const st = new FakeStore();
    expect(forget(st)).toEqual({ removed: [], left: [] });
  });
});

describe('the address it opens afterwards', () => {
  it('drops the site and the tab, and keeps the spacecraft, the span and the snapshot', () => {
    expect(searchAfterForget('?sat=67683&span=72&site=51.5000%2C-0.1200&tab=map')).toBe('?sat=67683&span=72');
    expect(searchAfterForget('?site=51.5,-0.12')).toBe('');
    expect(searchAfterForget('?tle=embedded&tab=globe')).toBe('?tle=embedded');
    expect(searchAfterForget('sat=25544')).toBe('?sat=25544');
    expect(searchAfterForget('')).toBe('');
    expect(searchAfterForget('?')).toBe('');
    expect(searchAfterForget('?%73ite=1,2&tabs=1')).toBe('?tabs=1');     // an encoded name is still the site; a longer name is not the tab
  });
});

describe('the words', () => {
  it('names the button and its second press', () => {
    expect(FORGET_LABEL).toBe('Forget what this page stored');
    expect(FORGET_ARMED_LABEL).toBe('Forget and reload');
    expect(FORGET_NOTHING).toBe('This page has stored nothing in this browser.');
    expect(FORGET_BLOCKED).toBe('This browser does not let the page store anything, so there is nothing to forget.');
  });
  it('says what the second press forgets, and that orbits of your own do not come back', () => {
    expect(forgetArmed(survey(new FakeStore(EVERYTHING))!.parts)).toBe('Press again to forget these and reload the page: your saved site, 2 recent places, your display choices, 2 orbits of your own, 2 cached element sets and 1 cached decay history. Your own orbits cannot be brought back.');
    expect(forgetArmed([{ kind: 'choices', n: 1 }])).toBe('Press again to forget these and reload the page: your display choices.');
    expect(forgetArmed([{ kind: 'tle', n: 1 }, { kind: 'hist', n: 3 }])).toBe('Press again to forget these and reload the page: 1 cached element set and 3 cached decay histories.');
    expect(forgetArmed([{ kind: 'orbits', n: 0 }])).toBe('Press again to forget these and reload the page: the record of your own orbits.');
    expect(forgetArmed([{ kind: 'orbits', n: null }])).toMatch(/the record of your own orbits\. Your own orbits cannot be brought back\.$/);
  });
  it('says each part', () => {
    expect(partWords({ kind: 'site' })).toBe('your saved site');
    expect(partWords({ kind: 'recents', n: 1 })).toBe('1 recent place');
    expect(partWords({ kind: 'recents', n: null })).toBe('your recent places');
    expect(partWords({ kind: 'orbits', n: 1 })).toBe('1 orbit of your own');
  });
  it('says when the browser kept some of it', () => {
    expect(forgetLeft(1)).toBe('This browser refused to remove 1 item, so the page has not been reloaded.');
    expect(forgetLeft(3)).toBe('This browser refused to remove 3 items, so the page has not been reloaded.');
  });
});

/* ---- the source: every key the code keeps is one lib/forget.ts knows ------------------------------------------------------------------------ */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
type Src = { rel: string; code: string };
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some(x => e.name.endsWith(x)) && !e.name.endsWith('.test.ts')) out.push(rel);
  }
  return out;
}
/* Everything the browser runs from this origin: the console's source and its page, and the Moon pages. lib/forget.ts is the one file left
   out: it removes whatever key is the page's, so its own calls name no key. */
const SOURCES: Src[] = [...walk('src', ['.ts', '.svelte']), 'index.html', ...walk('public', ['.html', '.js'])]
  .filter(rel => rel !== 'src/lib/forget.ts')
  .map(rel => ({ rel, code: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));

type Key = { exact: string } | { prefix: string };

/** The text of the first argument of a call whose '(' is just before `i`. */
function firstArg(code: string, i: number): string {
  let depth = 0, q = '', out = '';
  for (; i < code.length; i++) {
    const c = code[i]!;
    if (q) { out += c; if (c === '\\') { out += code[++i]; continue; } if (c === q) q = ''; continue; }
    if (c === '\'' || c === '"' || c === '`') { q = c; out += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    if (c === ',' && depth === 0) break;
    out += c;
  }
  return out.trim();
}
/** `a + 'b' + c` into its terms (top level only). */
function terms(expr: string): string[] {
  const out: string[] = [];
  let depth = 0, q = '', cur = '';
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (q) { cur += c; if (c === '\\') { cur += expr[++i]; continue; } if (c === q) q = ''; continue; }
    if (c === '\'' || c === '"' || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === '+' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
const lineOf = (code: string, at: number) => code.slice(0, at).split('\n').length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The initialiser of `const|let|var name = ...`: the last one before `at` in the same file, else the only one in the file, else the only one
 *  anywhere (an imported constant). Two different ones anywhere is not a guess this makes. */
function declared(name: string, src: Src, at: number, all: Src[]): string | null {
  const re = new RegExp('\\b(?:const|let|var)\\s+' + esc(name) + '\\s*(?::[^=\\n]+)?=\\s*([^;\\n]+)', 'g');
  const found = (s: Src) => [...s.code.matchAll(re)].map(m => ({ at: m.index!, init: m[1]!.trim() }));
  const here = found(src);
  const before = here.filter(d => d.at < at);
  if (before.length) return before[before.length - 1]!.init;
  if (here.length === 1) return here[0]!.init;
  const there = [...new Set(all.filter(s => s !== src).flatMap(s => found(s).map(d => d.init)))];
  return there.length === 1 ? there[0]! : null;
}
/** `OBJ = { ..., field: 'value' }` in the same file. */
function member(obj: string, field: string, src: Src): string | null {
  const m = new RegExp('\\b' + esc(obj) + '\\s*=\\s*\\{([^}]*)\\}').exec(src.code);
  const f = m && new RegExp('\\b' + esc(field) + '\\s*:\\s*([\'"])([^\'"]*)\\1').exec(m[1]!);
  return f ? f[2]! : null;
}
function resolve(expr: string, src: Src, at: number, all: Src[], depth = 0): Key | null {
  if (depth > 6) return null;
  let acc = '';
  const ts = terms(expr);
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k]!;
    let v: Key | null = null;
    const lit = /^(['"`])([^'"`$]*)\1$/.exec(t);
    if (lit) v = { exact: lit[2]! };
    else if (/^[A-Za-z_$][\w$]*$/.test(t)) { const init = declared(t, src, at, all); v = init ? resolve(init, src, at, all, depth + 1) : null; }
    else if (/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(t)) { const [o, f] = t.split('.'); const s = member(o!, f!, src); v = s === null ? null : { exact: s }; }
    if (v === null) return k === 0 ? null : { prefix: acc };          // what follows a known start is the variable part of the key
    if ('prefix' in v) return { prefix: acc + v.prefix };
    acc += v.exact;
  }
  return { exact: acc };
}

/** Every key the code hands to getItem, setItem or removeItem, or the expression that could not be read as one. */
function storageKeys(all: Src[]) {
  const keys: { where: string; key: Key }[] = [], unread: string[] = [];
  for (const src of all) {
    for (const m of src.code.matchAll(/\.(getItem|setItem|removeItem)\(/g)) {
      const at = m.index! + m[0].length, arg = firstArg(src.code, at), where = src.rel + ':' + lineOf(src.code, at) + ' ' + m[1] + '(' + arg + ')';
      const key = resolve(arg, src, at, all);
      if (key) keys.push({ where, key }); else unread.push(where);
    }
  }
  return { keys, unread };
}
/** What lib/forget.ts does not cover: an exact key it does not list, a prefix that is not one of its namespaces. */
const uncovered = (keys: { where: string; key: Key }[]) => keys.filter(({ key }) => 'exact' in key
  ? !(FORGET_KEYS as readonly string[]).includes(key.exact) : !(FORGET_PREFIXES as readonly string[]).includes(key.prefix));

describe('every key the code keeps is one forget knows', () => {
  const { keys, unread } = storageKeys(SOURCES);

  it('reads the key of every storage call in the page\'s source', () => {
    expect(unread).toEqual([]);
    expect(keys.length).toBeGreaterThanOrEqual(25);
  });
  it('covers every one of them: each fixed key is in FORGET_KEYS, each key made from a number is under a namespace of FORGET_PREFIXES', () => {
    expect(uncovered(keys).map(k => k.where)).toEqual([]);
  });
  it('lists no key the code no longer uses, and the made keys are the two caches', () => {
    const exact = new Set(keys.flatMap(k => 'exact' in k.key ? [k.key.exact] : []));
    expect([...exact].sort()).toEqual([...FORGET_KEYS].sort());
    expect([...new Set(keys.flatMap(k => 'prefix' in k.key ? [k.key.prefix] : []))].sort()).toEqual(['hist:', 'tle:']);
  });
  it('finds no gt. name in the source that FORGET_KEYS does not list, but the advisor\'s rule ids', () => {
    const names: string[] = [], ids: string[] = [];
    for (const src of SOURCES) for (const m of src.code.matchAll(/(\bid:\s*)?['"`](gt\.[A-Za-z][\w.-]*)['"`]/g)) {
      if (m[1] && src.rel === 'src/lib/planner/advisor-copy.ts') ids.push(m[2]!); else names.push(src.rel + ' ' + m[2]);
    }
    expect(names.filter(n => !(FORGET_KEYS as readonly string[]).includes(n.split(' ')[1]!))).toEqual([]);
    expect(ids.length).toBeGreaterThanOrEqual(12);         // gt.count ... gt.sso.clock: the Professor's ground-track rules, not storage
  });
  it('keeps nothing anywhere but localStorage (no session storage, IndexedDB, Cache Storage, cookie or service worker)', () => {
    const found = SOURCES.flatMap(s => [...s.code.matchAll(/\b(sessionStorage|indexedDB|caches\.open|document\.cookie|serviceWorker)\b/g)].map(m => s.rel + ' ' + m[1]));
    expect(found).toEqual([]);
  });
  it('would fail on a key it does not know (the scan, shown violators)', () => {
    const planted: Src[] = [
      { rel: 'a.ts', code: "localStorage.setItem('gt.watch', '[]');" },
      { rel: 'b.ts', code: "const WATCH = 'watchlist';\nstore.setItem(WATCH, v);" },
      { rel: 'c.ts', code: "const P = 'pass:';\nconst key = P + n;\nstore.getItem(key);" },
      { rel: 'd.ts', code: 'store.removeItem(somethingFromElsewhere);' },
      { rel: 'e.ts', code: "store.setItem('obs-site', x); store.getItem('tle:' + n); s.setItem(CUSTOM + '.bak', v);\nconst CUSTOM = 'gt.custom';" }
    ];
    const r = storageKeys(planted);
    expect(r.unread).toEqual(['d.ts:1 removeItem(somethingFromElsewhere)']);
    expect(uncovered(r.keys).map(k => k.key)).toEqual([{ exact: 'gt.watch' }, { exact: 'watchlist' }, { prefix: 'pass:' }]);
    expect(r.keys.filter(k => !uncovered(r.keys).includes(k)).map(k => k.key)).toEqual([{ exact: 'obs-site' }, { prefix: 'tle:' }, { exact: 'gt.custom.bak' }]);
  });
});
