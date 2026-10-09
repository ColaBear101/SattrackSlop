import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PlannerPanel from '../../src/components/planner/PlannerPanel.svelte';
import PlannerLive from '../../src/components/planner/PlannerLive.svelte';
import PlannerSprite from '../../src/components/planner/PlannerSprite.svelte';
import ProfessorSection from '../../src/components/report/ProfessorSection.svelte';
import ProfessorLink from '../../src/components/report/ProfessorLink.svelte';
import { planner, ready, mounted } from '../../src/components/planner/load.svelte';

/* The planner's markup is the old page's, because plannerui.ts (the old controller, moved unchanged) finds its nodes by id and
   writes into them. These are the cheap guards around that: the ids, the aria wiring, the hidden states, the five static
   group shells, and that nothing here is a handler or a binding. The node-for-node comparison with legacy/index.html is
   scripts/compare-planner-markup.mjs, which needs a browser and so is not run by Vitest. */

/* ---- a small HTML reader: the server's output is well formed, and Vitest runs here without a DOM ---------------------- */
interface El { tag: string; attrs: Record<string, string>; kids: (El | string)[]; parent: El | null }
const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'col']);
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parse(html: string): El {
  const root: El = { tag: '#root', attrs: {}, kids: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (let m: RegExpExecArray | null; (m = re.exec(html)); ) {
    if (m[1]) { if (cur.tag !== m[1]) throw new Error(`</${m[1]}> closes <${cur.tag}>`); cur = cur.parent!; }
    else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of m[3]!.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[a[1]!] = unescape(a[2] ?? a[3] ?? a[4] ?? '');
      const el: El = { tag: m[2], attrs, kids: [], parent: cur };
      cur.kids.push(el);
      if (!m[4] && !VOID.has(m[2])) cur = el;
    } else if (m[5] !== undefined) cur.kids.push(unescape(m[5]));
  }
  if (cur !== root) throw new Error('<' + cur.tag + '> is not closed');
  return root;
}

const FRAGMENTS = {
  panel: parse(render(PlannerPanel).body), live: parse(render(PlannerLive).body), sprite: parse(render(PlannerSprite).body),
  section: parse(render(ProfessorSection).body), link: parse(render(ProfessorLink).body)
};
/* the whole of it, as it is in the page: the planner's three pieces and the report's two */
const DOC: El = { tag: '#root', attrs: {}, parent: null, kids: Object.values(FRAGMENTS).flatMap(f => f.kids) };

function walk(n: El, f: (e: El, order: number) => void): void {
  let order = 0;
  const go = (e: El) => { f(e, order++); for (const k of e.kids) if (typeof k !== 'string') go(k); };
  go(n);
}
const all = (n: El = DOC) => { const out: El[] = []; walk(n, e => { if (e !== n) out.push(e); }); return out; };
const byId = (id: string, n: El = DOC) => all(n).filter(e => e.attrs.id === id);
const one = (id: string, n: El = DOC): El => { const f = byId(id, n); expect(f, '#' + id).toHaveLength(1); return f[0]!; };
const text = (e: El | string): string => (typeof e === 'string' ? e : e.kids.map(text).join(''));
const kids = (e: El) => e.kids.filter((k): k is El => typeof k !== 'string');
const within = (e: El, anc: El): boolean => { for (let p: El | null = e; p; p = p.parent) if (p === anc) return true; return false; };

/* ---- the ids -------------------------------------------------------------------------------------------------------- */
/* plannerui.ts NEED_IDS, copied: init fails, and hides the whole planner, when any one is missing. */
const NEED_IDS = ['planner', 'planopen', 'plannote', 'pl-live', 'pl-form', 'pl-name', 'pl-preset', 'pl-preset-note', 'pl-hp', 'pl-ha',
  'pl-a', 'pl-e', 'pl-e-p', 'pl-period', 'pl-inc', 'pl-raan', 'pl-raan-u', 'pl-argp', 'pl-ma', 'pl-epoch', 'pl-epoch-note', 'pl-now',
  'pl-craft', 'pl-craft-note', 'pl-am', 'pl-d-shape', 'pl-d-orient', 'pl-d-drag', 'pl-add', 'pl-savenew', 'pl-reset', 'pl-status',
  'pl-err-form', 'pl-close', 'pf-title', 'pf-count', 'pf-verdict', 'pf-head', 'pf-sub', 'pf-errs', 'pf-empty', 'pf-foot', 'pl-saved-list',
  'pl-saved-count', 'pl-saved-none', 'pl-say'];
/* the pill and its note are the header's (the hint row beside the picker), not the panel's */
const HEADER_OWNED = ['planopen', 'plannote'];
/* the controller also finds these without needing them: the field messages, the stray panel nodes, the report's copy */
const ERR_KEYS = ['name', 'hp', 'ha', 'a', 'e', 'e-p', 'period', 'inc', 'raan', 'argp', 'ma', 'epoch', 'am'];
const ALSO = ['prof', 'pl-undo', ...ERR_KEYS.map(k => 'pl-err-' + k),
  'sec-prof', 'rp-title', 'rp-count', 'rp-verdict', 'rp-head', 'rp-foot', 'rp-nav', 'rp-link'];
const GROUPS = ['type', 'survive', 'sun', 'ground', 'caveat'];

describe('the ids the controller looks for', () => {
  it('has every NEED_IDS id the planner owns, exactly once', () => {
    for (const id of NEED_IDS.filter(i => !HEADER_OWNED.includes(i))) expect(byId(id), '#' + id).toHaveLength(1);
  });
  it('leaves the pill and its note to the header, so that they are not there twice', () => {
    for (const id of HEADER_OWNED) expect(byId(id), '#' + id).toHaveLength(0);
  });
  it('has the nodes it finds without needing (the field messages, #prof, #pl-undo and the report copy), once each', () => {
    for (const id of ALSO) expect(byId(id), '#' + id).toHaveLength(1);
  });
  it('has no id twice anywhere in the five pieces', () => {
    const seen = new Map<string, number>();
    for (const e of all()) if (e.attrs.id) seen.set(e.attrs.id, (seen.get(e.attrs.id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });
  it('puts #pl-live and the sprite outside the panel, and the panel in one piece', () => {
    expect(within(one('pl-live'), one('planner'))).toBe(false);
    expect(kids(FRAGMENTS.sprite)[0]!.tag).toBe('svg');
    expect(kids(FRAGMENTS.panel).map(k => k.tag)).toEqual(['aside']);
    expect(kids(FRAGMENTS.live).map(k => k.attrs.id)).toEqual(['pl-live']);
  });
});

/* ---- the wiring ----------------------------------------------------------------------------------------------------- */
describe('the aria wiring', () => {
  const ids = new Set(all().map(e => e.attrs.id).filter(Boolean));
  const refs: [string, string, string][] = [];   // [element, attribute, target id]
  for (const e of all()) {
    for (const a of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'for', 'form']) {
      for (const t of (e.attrs[a] ?? '').split(/\s+/).filter(Boolean)) refs.push([e.attrs.id ?? e.tag, a, t]);
    }
    if (e.tag === 'a' && e.attrs.href?.startsWith('#')) refs.push([e.attrs.id ?? 'a', 'href', e.attrs.href.slice(1)]);
  }
  it('points every labelledby, describedby, for, form and in-page link at a node that exists', () => {
    expect(refs.length).toBeGreaterThan(25);   // 15 labels, 5 describedby, 3 fieldsets, 4 headings, the form attribute, the link
    expect(refs.filter(([, , t]) => !ids.has(t))).toEqual([]);
  });
  it('names the planner, the notes and the saved list by their headings', () => {
    const pl = one('planner');
    expect(pl.attrs.role).toBe('region');
    expect(pl.attrs['aria-labelledby']).toBe('pl-title');
    expect(text(one('pl-title'))).toBe('Design a satellite');
    expect(one('prof').attrs['aria-labelledby']).toBe('pf-title');
    expect(one('sec-prof').attrs['aria-labelledby']).toBe('rp-title');
    const saved = all(pl).find(e => e.tag === 'section' && e.attrs.class === 'pl-saved')!;
    expect(saved.attrs['aria-labelledby']).toBe('pl-saved-h');
  });
  it('gives each fieldset a legend and the read-out it is described by', () => {
    const sets = all(one('planner')).filter(e => e.tag === 'fieldset');
    expect(sets.map(s => s.attrs['aria-describedby'])).toEqual(['pl-d-shape', 'pl-d-orient', 'pl-d-drag']);
    for (const s of sets) expect(kids(s)[0]!.tag).toBe('legend');
  });
  it('gives each input and select a label that says which it is for, and the controller the static describedby it merges with', () => {
    const labels = new Map<string, number>();
    for (const e of all(one('planner'))) if (e.tag === 'label') labels.set(e.attrs.for!, (labels.get(e.attrs.for!) ?? 0) + 1);
    const controls = all(one('planner')).filter(e => e.tag === 'input' || e.tag === 'select');
    expect(controls).toHaveLength(15);
    for (const c of controls) expect(labels.get(c.attrs.id!), '#' + c.attrs.id).toBe(1);
    expect(one('pl-name').attrs['aria-describedby']).toBe('pl-name-hint');
    expect(one('pl-preset').attrs['aria-describedby']).toBe('pl-preset-note');
    expect(one('pl-craft').attrs['aria-describedby']).toBe('pl-craft-note');
    expect(one('pl-raan').attrs['aria-describedby']).toBe('pl-d-orient');
    expect(one('pl-epoch').attrs['aria-describedby']).toBe('pl-epoch-note');
  });
  it('names both groups of switches, and starts them on Altitudes and RAAN', () => {
    const groups = all(one('planner')).filter(e => e.attrs.role === 'group');
    expect(groups.map(g => g.attrs['aria-label'])).toEqual(['How to describe the size and shape', 'Give the node as']);
    const pressed = all(one('planner')).filter(e => e.attrs['aria-pressed']).map(e => [e.attrs['data-shape'] ?? e.attrs['data-node'], e.attrs['aria-pressed']]);
    expect(pressed).toEqual([['alt', 'true'], ['ae', 'false'], ['per', 'false'], ['raan', 'true'], ['ltan', 'false']]);
  });
  it('has exactly the live regions the old page had: #pl-status and #pl-say in the panel, #pl-live outside it', () => {
    const live = all().filter(e => e.attrs['aria-live'] || e.attrs.role === 'status' || e.attrs.role === 'alert');
    expect(live.map(e => e.attrs.id)).toEqual(['pl-status', 'pl-say', 'pl-live']);
    for (const e of live) { expect(e.attrs.role).toBe('status'); expect(e.attrs['aria-live']).toBe('polite'); }
    expect(live.every(e => e.attrs.class === 'pl-status' || e.attrs.class === 'pl-say')).toBe(true);
  });
});

/* ---- what starts hidden --------------------------------------------------------------------------------------------- */
describe('the hidden states at load', () => {
  const name = (e: El) => e.attrs.id ?? (e.attrs['data-group'] ? `${e.tag}[data-group=${e.attrs['data-group']}]` : e.attrs['data-lens'] ? `${e.tag}[data-lens=${e.attrs['data-lens']}]` : e.tag);
  it('hides the planner, the field messages, the form message, Save as new, the verdict, the empty note, the undo, the none-yet note and two of the three lenses', () => {
    const panel = all(FRAGMENTS.panel).filter(e => 'hidden' in e.attrs).map(name);
    const expected = ['planner', ...ERR_KEYS.map(k => 'pl-err-' + k), 'pl-err-form', 'pl-savenew', 'pf-verdict', 'div[data-lens=ae]', 'div[data-lens=per]',
      ...GROUPS.map(g => `details[data-group=${g}]`), 'pf-empty', 'pl-undo', 'pl-saved-none'];
    expect([...panel].sort()).toEqual([...expected].sort());   // the same set, and none of them twice
  });
  it('shows the Altitudes lens, the action bar, the notes list, and everything the controller never hides', () => {
    for (const id of ['pl-add', 'pl-reset', 'pl-close', 'pl-status', 'pl-say', 'prof', 'pf-errs', 'pf-foot', 'pf-title', 'pf-count', 'pl-d-shape', 'pl-saved-list', 'pl-form'])
      expect(one(id).attrs, '#' + id).not.toHaveProperty('hidden');
    const alt = all(FRAGMENTS.panel).find(e => e.attrs['data-lens'] === 'alt')!;
    expect(alt.attrs).not.toHaveProperty('hidden');
  });
  it('hides the report copy of the Professor and the link to it, until the controller has built them', () => {
    expect(one('sec-prof').attrs).toHaveProperty('hidden');
    expect(one('rp-nav').attrs).toHaveProperty('hidden');
    expect(one('rp-verdict').attrs).not.toHaveProperty('hidden');
    expect(all(FRAGMENTS.section).filter(e => 'hidden' in e.attrs).map(name)).toEqual(['sec-prof', ...GROUPS.map(g => `details[data-group=${g}]`)]);
  });
  it('never sets `disabled` on anything: the primary button must stay pressable to say why it will not act', () => {
    expect(all().filter(e => 'disabled' in e.attrs)).toEqual([]);
  });
});

/* ---- the five group shells ------------------------------------------------------------------------------------------ */
describe('the Professor group shells', () => {
  for (const [where, root] of [['the planner panel', 'prof'], ['the report section', 'sec-prof']] as const) {
    it(`are five, in order, empty and hidden, in ${where}`, () => {
      const shells = all(one(root)).filter(e => e.tag === 'details');
      expect(shells.map(s => s.attrs['data-group'])).toEqual(GROUPS);
      for (const s of shells) {
        expect(s.attrs.class).toBe('pf-grp');
        expect(s.attrs).toHaveProperty('hidden');
        expect(s.attrs).not.toHaveProperty('open');
        expect(kids(s).map(k => k.tag)).toEqual(['summary', 'ul']);
        expect(kids(s)[1]!.attrs.class).toBe('pf-list');
        expect(s.kids.filter(k => typeof k === 'string' && k.trim())).toEqual([]);
        for (const k of kids(s)) expect(k.kids).toEqual([]);
      }
    });
  }
  it('have the verdict, the error list and the footer around them, as the controller expects', () => {
    const prof = one('prof');
    expect(kids(prof).map(e => e.attrs.id ?? e.attrs.class)).toEqual(['pf-head', 'pf-verdict', 'pf-errs', 'pf-grp', 'pf-grp', 'pf-grp', 'pf-grp', 'pf-grp', 'pf-empty', 'pf-foot']);
    expect(kids(one('pf-verdict')).map(e => e.attrs.id)).toEqual(['pf-head', 'pf-sub']);
    expect(kids(one('rp-verdict')).map(e => e.attrs.id)).toEqual(['rp-head']);
    expect(one('pf-errs').tag).toBe('ul');
  });
});

/* ---- the controller's nodes are left empty --------------------------------------------------------------------------------- */
describe('the nodes the controller writes', () => {
  const EMPTY = ['pl-preset', 'pl-craft', 'pl-preset-note', 'pl-craft-note', 'pl-epoch-note', 'pl-status', 'pl-say', 'pl-live', 'pl-err-form', 'pl-undo',
    'pf-title', 'pf-count', 'pf-head', 'pf-sub', 'pf-errs', 'pf-empty', 'pf-foot', 'pl-saved-list', 'pl-saved-count',
    'rp-title', 'rp-count', 'rp-head', 'rp-foot', 'rp-link', ...ERR_KEYS.map(k => 'pl-err-' + k)];
  it('start with nothing in them (selects with no options, notes and lists with no children): the controller builds them', () => {
    for (const id of EMPTY) expect(one(id).kids, '#' + id).toEqual([]);
  });
  it('start the read-outs at a dash, and the drag read-out with its abbreviations in place', () => {
    expect(text(one('pl-d-shape'))).toBe('—');
    expect(text(one('pl-d-orient'))).toBe('—');
    expect(text(one('pl-d-drag'))).toBe('= B* ... at this height · worked out from A/m · a guess, not a measurement');
    expect(kids(one('pl-d-drag')).map(e => [e.tag, e.attrs.title])).toEqual([['abbr', "B*, SGP4's drag term, in inverse Earth radii"], ['abbr', 'area over mass: the cross-section the air pushes on, per kilogram']]);
    expect(one('pl-raan-u').kids).toEqual(['°']);
  });
  it('says the static sentences the old page said', () => {
    expect(text(one('pl-name-hint'))).toBe('Up to 24 characters. It is kept in this browser, and listed in the search box under Your orbits.');
    expect(text(one('pl-saved-none'))).toBe('None yet. An orbit you add is kept here, in this browser, for the next visit.');
    expect(text(one('pl-saved-h'))).toBe('Your orbits ');
    expect(text(one('pl-add'))).toBe('Add to console');
    expect(text(one('pl-savenew'))).toBe('Save as new');
    expect(text(one('pl-reset'))).toBe('Reset');
    expect(text(one('pl-now'))).toBe('Now');
    expect(text(one('pl-close'))).toBe('Close');
    expect(one('pl-close').attrs['aria-label']).toBe('Close the orbit planner');
    expect(all(one('planner')).filter(e => e.tag === 'legend').map(text)).toEqual(['Size and shape', 'Orientation', 'Epoch and drag']);
    expect(text(one('rp-nav'))).toBe(' · ');       // the space before the dot is inside the span, where the sentence's own end is not
  });
  it('gives every abbreviation its explanation, and none of the planner\'s own svgs is read out', () => {
    for (const a of all().filter(e => e.tag === 'abbr')) expect(a.attrs.title, text(a)).toBeTruthy();
    for (const s of all(one('planner')).filter(e => e.tag === 'svg')) expect(s.attrs['aria-hidden']).toBe('true');
  });
});

/* ---- forms, buttons and the order the keyboard meets them in -------------------------------------------------------------- */
describe('the form and its buttons', () => {
  it('has one submit button, outside the form, naming it, and every other button a plain button', () => {
    const buttons = all(one('planner')).filter(e => e.tag === 'button');
    expect(buttons.filter(b => b.attrs.type === 'submit').map(b => b.attrs.id)).toEqual(['pl-add']);
    for (const b of buttons.filter(b => b.attrs.type !== 'submit')) expect(b.attrs.type).toBe('button');
    expect(one('pl-add').attrs.form).toBe('pl-form');
    expect(within(one('pl-add'), one('pl-form'))).toBe(false);
    expect(within(one('pl-err-form'), one('pl-form'))).toBe(false);
    expect(one('pl-form').attrs).toMatchObject({ novalidate: '', autocomplete: 'off' });
  });
  it('makes every number box a text box with a decimal keypad: a number input would drop "97." and a lone "-" as they are typed', () => {
    for (const id of ['pl-hp', 'pl-ha', 'pl-a', 'pl-e', 'pl-e-p', 'pl-period', 'pl-inc', 'pl-raan', 'pl-argp', 'pl-ma', 'pl-am']) {
      expect(one(id).attrs, '#' + id).toMatchObject({ type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' });
    }
    expect(one('pl-name').attrs).toMatchObject({ type: 'text', autocomplete: 'off', spellcheck: 'false' });
    expect(one('pl-epoch').attrs).toMatchObject({ type: 'datetime-local', step: '1' });
  });
  it('puts Close first, then the form, then the action bar, then the Professor, then the saved list, and #pl-say last', () => {
    const order: Record<string, number> = {};
    walk(one('planner'), (e, i) => { const k = e.attrs.id ?? e.attrs.class; if (k && !(k in order)) order[k] = i; });
    const seq = ['pl-close', 'pl-form', 'pl-add', 'prof', 'pl-saved-h', 'pl-say'].map(k => order[k]!);
    expect(seq.every(n => n !== undefined)).toBe(true);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
    expect(order['pl-actions']!).toBeGreaterThan(order['pl-form']!);
    expect(order['pl-actions']!).toBeLessThan(order['prof']!);
    const planner = one('planner');
    expect(kids(planner).at(-1)!.attrs.id).toBe('pl-say');
  });
  it('keeps the headings in order, none skipped: h2, then h3 twice', () => {
    expect(all(one('planner')).filter(e => /^h[1-6]$/.test(e.tag)).map(e => e.tag + '#' + e.attrs.id)).toEqual(['h2#pl-title', 'h3#pf-title', 'h3#pl-saved-h']);
    expect(all(one('sec-prof')).filter(e => /^h[1-6]$/.test(e.tag)).map(e => e.tag + '#' + e.attrs.id)).toEqual(['h2#rp-title']);
  });
  it('has the three lens grids in order, and a switch button for each, keyed the way the controller finds them', () => {
    expect(all(one('planner')).filter(e => e.attrs['data-lens']).map(e => e.attrs['data-lens'])).toEqual(['alt', 'ae', 'per']);
    expect(all(one('planner')).filter(e => e.tag === 'button' && e.attrs['data-shape']).map(e => e.attrs['data-shape'])).toEqual(['alt', 'ae', 'per']);
    expect(all(one('planner')).filter(e => e.tag === 'button' && e.attrs['data-node']).map(e => e.attrs['data-node'])).toEqual(['raan', 'ltan']);
  });
});

describe('the sprite', () => {
  it('holds the four severity glyphs the notes point into, and is not read out', () => {
    const svg = kids(FRAGMENTS.sprite)[0]!;
    expect(svg.attrs).toMatchObject({ width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' });
    expect(kids(svg).map(s => [s.tag, s.attrs.id, s.attrs.viewBox])).toEqual(['good', 'info', 'warn', 'bad'].map(k => ['symbol', 'sv-' + k, '0 0 12 12']));
  });
});

/* ---- nothing is wired or bound here --------------------------------------------------------------------------------------- */
describe('no handlers and no bindings', () => {
  it('renders no element with an on* attribute, a javascript: link or a style that hides', () => {
    for (const e of all()) {
      for (const [k, v] of Object.entries(e.attrs)) {
        expect(/^on/i.test(k), `${e.tag}#${e.attrs.id ?? ''} ${k}`).toBe(false);
        expect(/^\s*javascript:/i.test(v)).toBe(false);
      }
    }
  });
  const SRC = path.resolve(import.meta.dirname, '..', '..', 'src', 'components');
  const markup = (p: string) => { const s = fs.readFileSync(path.join(SRC, p), 'utf8'); return s.slice(s.lastIndexOf('</script>') + 1).replace(/<!--[\s\S]*?-->/g, ''); };
  for (const f of ['planner/PlannerPanel.svelte', 'planner/PlannerLive.svelte', 'planner/PlannerSprite.svelte', 'report/ProfessorSection.svelte']) {
    it(`${f} has no expression, block, handler, directive or binding in its markup (the server render would hide a handler)`, () => {
      const m = markup(f);
      expect(m).not.toMatch(/[{}]/);
      expect(m).not.toMatch(/\son[a-z]+\s*=/i);
      expect(m).not.toMatch(/\s(bind|use|class|style|transition|animate|in|out):/);
      expect(m).not.toMatch(/<(svelte|[A-Z])/);
    });
  }
  it('report/ProfessorLink.svelte has one expression, the space that Svelte would trim from the start of the span', () => {
    const m = markup('report/ProfessorLink.svelte');
    expect([...m.matchAll(/\{[^}]*\}/g)].map(x => x[0])).toEqual(["{' '}"]);
    expect(m).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe('the lazy-load switch', () => {
  it('starts unasked, and request() asks once for good, also when handed on as a bare callback', () => {
    expect(planner.wanted).toBe(false);
    const { request } = planner;
    request();
    expect(planner.wanted).toBe(true);
    request();
    expect(planner.wanted).toBe(true);
  });
  it('says ready only when the panel and the body-level pieces have both mounted', async () => {
    const state = { done: false };
    void ready.then(() => { state.done = true; });
    mounted('panel');
    await Promise.resolve();
    expect(state.done).toBe(false);
    mounted('root');
    await ready;
    expect(state.done).toBe(true);
  });
});
