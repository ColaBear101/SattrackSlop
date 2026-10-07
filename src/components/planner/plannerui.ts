// @ts-nocheck - verbatim; see the header
/* plannerui.js — the orbit planner's controller: the form, the Professor's notes beside it,
 * the saved list under them.
 *
 * What it is for. A student types the mean elements of an orbit they are designing; the page
 * writes them as a two-line element set (earth/planner.js), runs it down the same SGP4 path as
 * any catalogue spacecraft, and this file is the part of that you can see: the form, the notes
 * that explain the orbit while it is being shaped, and the list of the ones you kept. Everything
 * the Professor says comes from earth/advisor-copy.js; every number it says it from
 * earth/advisor.js; every conversion and every validation from earth/planner.js. This file
 * decides none of them. It owns timing, focus, and what is on screen.
 *
 * It does nothing at load. PlannerUI.init(host) wires the markup that index.html already holds
 * (the pill, the panel, the chip, the buttons under the element set) and is called by the page
 * only when every module is present; the page's own side of the planner (adding, updating and
 * removing a custom spacecraft, the store) is reached only through the `host` it hands over, so
 * this file can be driven by a stand-in in a test.
 *
 * Five things decide how it behaves, and each is a defect avoided:
 *
 * - Typing is never blocked or rewritten. The fields are text inputs (a number input throws away
 *   "97." and "-" mid-typing, scrolls on the wheel and reads commas by locale); what the student
 *   typed is kept as typed until a preset, a fix or a lens switch writes the field. The model is
 *   numbers at full precision and strings the student has typed; text is rounded for display
 *   only, which is what lets Altitudes 700/700 -> a and e -> Period -> back close to 1e-6 km.
 * - Nothing is loaded per keystroke. The closed-form pass runs 160 ms after the last input, the
 *   page's own pass finder (host.trial, 56 to 70 ms, pure) 500 ms after it; the console, globe
 *   and rail change only on Add or Update. A list of notes that rebuilt itself on every pass
 *   would lose the reader's place, an open group and the focus on a fix button, so notes are
 *   keyed by id and an unchanged one keeps its DOM node.
 * - Live regions speak rarely. The list of notes has no aria-live; #pl-say speaks 1,200 ms after
 *   the last change and only when the set of things to check changed; #pl-status writes only on
 *   a commit, a fix, a delete, a reset, a copy or a preset, never per keystroke.
 * - Nothing the student typed or the network sent is ever parsed as markup: every node is built
 *   with createElement and textContent, and no string in this file becomes HTML.
 * - The primary button is never disabled: a disabled button cannot be focused and cannot say
 *   why. It carries aria-disabled while the form cannot be added or is unchanged, and pressing
 *   it focuses the first field that is wrong and says which.
 *
 * Three presentations share one DOM: a drawer in the rail's cell (901 px and wider, 561 px tall
 * or more), a panel under the globe (900 px and narrower), and a full-screen sheet where the
 * stage is too short for a drawer (wide but 560 px tall or less). The sheet is a dialog: the
 * siblings along the path from the panel up to <body> are made inert, never the panel's own
 * ancestors, and Add closes it onto the globe.
 */
/* ---- Moved from legacy/earth/plannerui.js (main@4eadd7a), lines 46-1821.
 * The wrapper is the only change: the old file was an IIFE over `global` that attached `PlannerUI`; this is a factory over an
 * object that gives it what it reached for as globals (Planner, Advisor, AdvisorCopy, Lifetime, and the window's own functions)
 * and that returns it. Its host, its markup (components/planner/PlannerPanel.svelte and the other components that carry the
 * ids it expects) and every behaviour are the old page's: the suites that pin them (verify-planner-ui.js) are the oracle.
 */
export function makePlannerUI(global) {

const FAST_MS = 160, TRIAL_MS = 500, SAY_MS = 1200, UNDO_MS = 8000;
const MQ_SHEET = '(min-width:901px) and (max-height:560px)';
const MQ_FLOW = '(max-width:900px)';
const SVGNS = 'http://www.w3.org/2000/svg';
const GLYPH = { good: 'sv-good', info: 'sv-info', warn: 'sv-warn', bad: 'sv-bad', error: 'sv-bad' };

/* form key -> the input that shows it. ltan lives in the same box as raan (the node lens
   decides which); e is shown in two boxes, one per lens, kept equal. */
const FIELD_ID = { name: 'pl-name', hp: 'pl-hp', ha: 'pl-ha', a: 'pl-a', e: 'pl-e', period: 'pl-period',
  inc: 'pl-inc', raan: 'pl-raan', ltan: 'pl-raan', argp: 'pl-argp', ma: 'pl-ma', epoch: 'pl-epoch', am: 'pl-am' };
/* the order a student meets them in; errors and the first-wrong-field focus follow it */
const DOM_ORDER = ['name', 'hp', 'a', 'period', 'ha', 'e', 'inc', 'raan', 'ltan', 'argp', 'ma', 'epoch', 'am'];
/* the paragraphs under the fields (pl-err-<key>); e has one per lens, ltan shares raan's */
const ERR_KEYS = ['name', 'hp', 'ha', 'a', 'e', 'e-p', 'period', 'inc', 'raan', 'argp', 'ma', 'epoch', 'am'];
/* what a fix calls the field it wrote, in the status line: "Set i to 97.43 (was 51.64)." */
const SAY_FIELD = { hp: 'perigee', ha: 'apogee', a: 'a', e: 'e', period: 'the period', inc: 'i', raan: 'RAAN',
  ltan: 'LTAN', argp: 'ω', ma: 'M', epoch: 'the epoch', am: 'A/m', name: 'the name' };

const S = {
  host: null, ready: false, off: false,
  model: null,            // the form: numbers at full precision, strings the student typed
  editing: null,          // the custom entry the form was opened from, or null for a new one
  open: false, opener: null,
  fr: null,               // Planner.fromForm of the model, at the last closed-form pass
  adv: null,              // Advisor.advise of it, or null while the form is invalid
  nameChk: null,          // the name's verdict at the last pass
  items: [], from: 'closed', problems: [], msgs: [], kept: {},
  meas: null,             // {key, value}: the last trial result and what it was run for
  formErr: null,          // what the page said when it refused a commit; gone at the next edit
  tFast: 0, tTrial: 0, tSay: 0, tUndo: 0, idle: 0,
  spoken: '', undo: null, presetSig: '', presetVal: 'sso',
  inerted: [], mqSheet: null, mqFlow: null, storageNoted: false, lastKey: ''
};

/* ---------------------------------------------------------------------------- small helpers */

const $ = id => document.getElementById(id);
const P = () => global.Planner;
const AC = () => global.AdvisorCopy;
const isNum = x => typeof x === 'number' && isFinite(x);

function el(tag, cls, text){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(text !== undefined && text !== null) n.textContent = text;
  return n;
}
function glyph(sev){
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#' + (GLYPH[sev] || 'sv-info'));
  s.appendChild(u);
  return s;
}
function abbr(text, title){ const a = el('abbr', null, text); a.title = title; return a; }
/* Parts -> nodes: {t} is text, {n} a figure worked out from the student's elements or the page's own run */
function partsInto(node, parts){
  for(let i = 0; i < parts.length; i++){
    const p = parts[i];
    if(p.t !== undefined) node.appendChild(document.createTextNode(p.t));
    else node.appendChild(el('b', 'n', p.n));
  }
  return node;
}
const plain = parts => parts.map(p => p.t !== undefined ? p.t : p.n).join('');
const first17 = s => Array.from(s).slice(0, 17).join('');
const floorSecond = ms => Math.floor(ms/1000)*1000;
const wrap360 = x => ((x % 360) + 360) % 360;
function setText(node, text){ if(node.textContent !== text) node.textContent = text; }

/* ---------------------------------------------------------------------------- formats (display only) */

/* A model number written for a box: rounded for reading, never for keeping, and trimmed so
   700 is "700" and not "700.000". */
function trimNum(x, dp){
  let s = x.toFixed(dp);
  if(s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
const fmtKm = x => trimNum(x, 3);
const fmtAng = x => trimNum(x, 4);
const fmtE = x => trimNum(x, 7);
/* four significant digits: 0.0043 stays 0.0043, 0.00430000001 does not grow a tail */
function fmtAm(x){ return x === 0 ? '0' : String(Number(x.toPrecision(4))); }
const fmtLtan = h => AC().FMT.ltan(h);

/* What a field shows for a model value: a number is formatted by what it measures, a string
   is what the student typed and stays exactly that. */
function fieldText(key, v){
  if(typeof v === 'string') return v;
  if(!isNum(v)) return '';
  switch(key){
    case 'hp': case 'ha': case 'a': case 'period': return fmtKm(v);
    case 'e': return fmtE(v);
    case 'inc': case 'raan': case 'argp': case 'ma': return fmtAng(v);
    case 'ltan': return fmtLtan(v);
    case 'am': return fmtAm(v);
    case 'epoch': return P().formatEpoch(v);
    default: return String(v);
  }
}
/* a value as the status line says it: angles to the hundredth, the rest with their unit */
function sayVal(key, v){
  if(typeof v === 'string'){
    /* a figure typed as text is said as the figure; anything else is quoted as typed */
    const r = key === 'epoch' ? P().parseEpoch(v) : key === 'ltan' ? P().parseLtan(v) : P().parseNumber(v);
    if(key === 'name' || !r.ok) return '“' + v + '”';
    v = r.value;
  }
  if(!isNum(v)) return '—';
  const F = AC().FMT;
  switch(key){
    case 'hp': case 'ha': return F.km1(v).replace(/\.0 km$/, ' km');
    case 'a': return F.km1(v);
    case 'period': return F.min2(v);
    case 'e': return fmtE(v);
    case 'inc': case 'raan': case 'argp': case 'ma': return trimNum(v, 2);
    case 'ltan': return fmtLtan(v);
    case 'am': return F.am(v);
    case 'epoch': return P().formatEpoch(v);
    default: return String(v);
  }
}

/* ---------------------------------------------------------------------------- the model */

/* The first open has no draft: it is the default form (the sun-synchronous preset, "My
   orbit"), dated now to the second. After that the draft survives closing; reloading loses it. */
function ensureModel(){
  if(S.model) return S.model;
  S.model = P().defaultForm(S.host.obs(), floorSecond(S.host.now()));
  S.model.name = 'My orbit';
  S.presetVal = 'sso';
  return S.model;
}
const modelEpochMs = () => { const r = P().parseEpoch(S.model.epoch); return r.ok ? r.value : null; };

/* Which key the node box holds, and the box a form key is shown in right now. */
const nodeKey = () => S.model.nodeMode === 'ltan' ? 'ltan' : 'raan';
function inputFor(key){
  if(key === 'e' && S.model && S.model.shape === 'per') return $('pl-e-p');
  return $(FIELD_ID[key]);
}

function setVal(id, text){
  const n = $(id);
  if(n && n.value !== text) n.value = text;
}
/* Every box from the model. Called after something other than typing changed the model (a
   preset, a fix, a lens switch, Reset, Open, Now): never per keystroke, so what the student
   typed is never rewritten under their fingers. */
function writeFields(){
  const m = S.model;
  setVal('pl-name', typeof m.name === 'string' ? m.name : '');
  setVal('pl-hp', fieldText('hp', m.hp)); setVal('pl-ha', fieldText('ha', m.ha));
  setVal('pl-a', fieldText('a', m.a));
  setVal('pl-e', fieldText('e', m.e)); setVal('pl-e-p', fieldText('e', m.e));
  setVal('pl-period', fieldText('period', m.period));
  setVal('pl-inc', fieldText('inc', m.inc));
  setVal('pl-raan', fieldText(nodeKey(), m[nodeKey()]));
  setVal('pl-argp', fieldText('argp', m.argp)); setVal('pl-ma', fieldText('ma', m.ma));
  setVal('pl-epoch', fieldText('epoch', m.epoch));
  setVal('pl-am', fieldText('am', m.am));
  applyLens();
  syncCraft();
  paintEpochNote();
}

/* Which shape lens and which node lens are showing. The node box is text while the node is a
   local time (hh:mm needs a colon, which a phone's decimal keypad lacks) and decimal otherwise. */
function applyLens(){
  const m = S.model;
  document.querySelectorAll('.pl-shape[data-lens]').forEach(g => { g.hidden = g.getAttribute('data-lens') !== m.shape; });
  document.querySelectorAll('button[data-shape]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-shape') === m.shape)));
  document.querySelectorAll('button[data-node]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-node') === m.nodeMode)));
  const raan = $('pl-raan');
  raan.setAttribute('inputmode', m.nodeMode === 'ltan' ? 'text' : 'decimal');
  setText($('pl-raan-u'), m.nodeMode === 'ltan' ? 'hh:mm' : '°');
}

/* Switching the size and shape lens converts what is showing through the elements, so nothing
   is lost; a form that cannot be read yet keeps its boxes as they are (a hidden lens keeps its
   last values). */
function setShape(shape){
  ensureModel();
  if(shape !== 'alt' && shape !== 'ae' && shape !== 'per') return;
  if(S.model.shape === shape) return;
  const r = P().fromForm(S.model);
  const next = Object.assign({}, S.model, { shape: shape });
  S.model = r.derived ? P().patchForm(next, { a: r.derived.a, e: r.derived.e }) : next;
  writeFields();
  clearChanged();
  schedule();
}
/* The same for the node: RAAN and LTAN are one number at the epoch, so switching converts
   through it. Local time is mean solar time, not apparent. */
function setNode(mode){
  ensureModel();
  if(mode !== 'raan' && mode !== 'ltan') return;
  if(S.model.nodeMode === mode) return;
  const m = Object.assign({}, S.model, { nodeMode: mode });
  const ep = P().parseEpoch(m.epoch);
  if(ep.ok){
    if(mode === 'raan'){
      const lt = P().parseLtan(m.ltan);
      if(lt.ok) m.raan = P().raanFromLtan(lt.value, ep.value);
    } else {
      const rn = P().parseNumber(m.raan);
      if(rn.ok) m.ltan = P().ltanFromRaan(wrap360(rn.value), ep.value);
    }
  }
  S.model = m;
  writeFields();
  clearChanged();
  schedule();
}

/* the craft select follows the area over mass: typing a figure that is a craft's within 1e-6
   selects it, anything else is Custom */
function syncCraft(){
  const sel = $('pl-craft'), crafts = P().CRAFTS;
  if(!sel || !sel.options.length) return;
  const r = P().parseNumber(S.model.am);
  const key = r.ok ? P().craftForAm(r.value) : 'custom';
  if(sel.value !== key) sel.value = key;
  const c = crafts.find(x => x.key === key);
  setText($('pl-craft-note'), key === 'custom' ? 'As typed.' : (c ? c.why : ''));
}

/* "UTC, as in a TLE": the window bar says its own zone and this is not it. The word is the
   window bar's own label (UTC+7 for Bangkok), so the two never disagree. */
function paintEpochNote(){
  const z = $('winTz'), obs = S.host.obs();
  let zone = z && z.textContent.trim();
  if(!zone){ const t = isNum(obs.tz) ? obs.tz : 0; zone = 'UTC' + (t < 0 ? '−' : '+') + Math.abs(t); }
  setText($('pl-epoch-note'), 'UTC, as in a TLE — not the window bar’s ' + zone + '. The mean anomaly below is where the satellite is at this instant.');
}

/* ---------------------------------------------------------------------------- derived read-outs */

/* "= a 7,078.1 km · e 0.0010 · ..." : every group of fields ends in one line that says what the
   numbers above come to. Pieces are [text] (bold) or [lead, bold]. */
function fillDerived(node, pieces){
  node.textContent = '';
  if(!pieces){ node.textContent = '—'; return; }
  node.appendChild(document.createTextNode('='));
  pieces.forEach((p, i) => {
    node.appendChild(document.createTextNode(i === 0 ? ' ' : ' · '));
    if(p.length === 2) node.appendChild(document.createTextNode(p[0]));
    node.appendChild(el('b', null, p[p.length - 1]));
  });
}
function paintReadouts(r){
  const F = AC().FMT, d = r ? r.derived : null;
  fillDerived($('pl-d-shape'), d ? [
    ['a ' + F.km1(d.a)], ['e ' + F.e4(d.e)], [F.min1(d.periodMin) + ' Kepler'], [F.rev2(d.revsPerDay)], [F.kms(d.vCircKms)]
  ] : null);
  let node = null;
  if(d){
    const typedLtan = S.model.nodeMode === 'ltan';
    node = [[typedLtan ? 'RAAN ' + F.deg2(d.raan) : 'LTAN ' + fmtLtan(d.ltan)],
            ['node turns ', F.ddeg(d.nodeRate) || '0°/day'], ['u = ω + M ' + F.deg2(d.u)]];
  }
  fillDerived($('pl-d-orient'), node);
  const drag = $('pl-d-drag');
  drag.textContent = '';
  if(!d || d.bstar === null || d.bstar === undefined || !isNum(d.bstar)){ drag.textContent = '—'; return; }
  drag.appendChild(document.createTextNode('= '));
  drag.appendChild(abbr('B*', 'B*, SGP4’s drag term, in inverse Earth radii'));
  drag.appendChild(document.createTextNode(' '));
  drag.appendChild(el('b', null, F.sci(d.bstar)));
  drag.appendChild(document.createTextNode(' at this height · worked out from '));
  drag.appendChild(abbr('A/m', 'area over mass: the cross-section the air pushes on, per kilogram'));
  drag.appendChild(document.createTextNode(' · a guess, not a measurement'));
}

/* ---------------------------------------------------------------------------- the name */

/* Names are unique across the catalogue and the student's own, ignoring case: a spoken name
   must be unambiguous, and Enter on a shared name in the picker must reach the real object.
   The catalogue does not change, so its names are collected once. */
let CAT_NAMES = null;
function catalogueNames(){
  if(CAT_NAMES) return CAT_NAMES;
  CAT_NAMES = new Set();
  const cat = S.host.catalogue();
  for(let i = 0; i < cat.length; i++) CAT_NAMES.add(String(cat[i].name).toLowerCase());
  return CAT_NAMES;
}
/* "NAME (mine)", then "NAME (mine 2)"...: NAME is cut so the whole always fits the 24 code
   points a name may have (the first 17 plus the 7 of " (mine)": 190 of the 2,158 catalogue
   names are 18 characters or longer, and a plain suffix would be cut off). The label of the
   fix shows exactly the string the field receives. */
function freeName(name, ignore){
  const cat = catalogueNames();
  const used = new Set(S.host.customs().filter(e => e !== ignore).map(e => e.name.toLowerCase()));
  for(let k = 1; k < 1000; k++){
    const suffix = k === 1 ? ' (mine)' : ' (mine ' + k + ')';
    const cand = Array.from(name).slice(0, 24 - suffix.length).join('').replace(/\s+$/, '') + suffix;
    const low = cand.toLowerCase();
    if(!cat.has(low) && !used.has(low)) return cand;
  }
  return Array.from(name).slice(0, 17).join('') + ' (mine)';
}
/* What the name comes to. `ignore` is the entry being edited: its own name is not a clash. */
function checkName(ignore){
  const typed = typeof S.model.name === 'string' ? S.model.name : '';
  const cleaned = P().cleanName(typed);
  const out = { typed: typed, cleaned: cleaned, empty: cleaned === '', taken: false, takenCat: false, free: null, changed: false };
  if(out.empty) return out;
  /* a trailing space or a doubled one is tidied without a word; a removed character is a Note */
  const tidy = typed.replace(/\s+/g, ' ').replace(/^ | $/g, '').normalize('NFC');
  out.changed = cleaned !== tidy;
  const low = cleaned.toLowerCase();
  out.takenCat = catalogueNames().has(low);
  out.taken = out.takenCat || S.host.customs().some(e => e !== ignore && e.name.toLowerCase() === low);
  if(out.taken) out.free = freeName(cleaned, ignore);
  return out;
}
/* the entry the form was opened from, if it is still in the list */
function liveEditing(){
  return S.editing && S.host.customs().indexOf(S.editing) >= 0 ? S.editing : null;
}

/* ---------------------------------------------------------------------------- messages under the fields */

/* One input item rendered from the params of the error that raised it. The copy is the
   catalogue's (err.*, sgp4.retro); when it cannot be written the error's own plain message
   stands in, so a field is never left marked with no words. */
function inputItem(code, params, sev){
  try { return AC().renderInput(code, params); }
  catch(e){
    const msg = (params && params.msg) || code;
    return { id: code, group: 'input', sev: sev || 'error', word: sev === 'info' ? 'Note' : 'Fix this',
      title: [{ t: msg }], body: [], titleText: msg, bodyText: '', basis: null, term: null, fixes: [], values: {} };
  }
}
/* every message the form has now: the name's, then the planner's errors and notes in DOM order */
function collectMsgs(fr, nm){
  const out = [];
  if(nm.empty) out.push({ field: 'name', kind: 'error', item: inputItem('err.name.empty', {}) });
  else {
    if(nm.taken) out.push({ field: 'name', kind: 'error', item: inputItem('err.name.taken', { name: nm.cleaned, name_free: nm.free }) });
    if(nm.changed) out.push({ field: 'name', kind: 'note', item: inputItem('err.name.cleaned', { cleaned: nm.cleaned }, 'info') });
  }
  fr.errors.forEach(e => out.push({ field: e.field, kind: 'error', item: inputItem(e.code, e), raw: e }));
  fr.notes.forEach(n => out.push({ field: n.field, kind: 'note', item: inputItem(n.code, n, 'info'), raw: n }));
  return out;
}
/* the planner's field key -> the paragraph under the box that shows it, or null (no box) */
function paraKey(field){
  if(field === 'ltan') return 'raan';
  if(field === 'e') return S.model.shape === 'per' ? 'e-p' : 'e';
  return ERR_KEYS.indexOf(field) >= 0 ? field : null;
}
const inputIdOf = key => key === 'e-p' ? 'pl-e-p' : 'pl-' + key;

/* A field in trouble gets its box marked (a bar and a border, not colour alone), aria-invalid,
   and an aria-describedby to a paragraph with a glyph and the words. A Note (an angle taken
   modulo 360, a name tidied) has the paragraph and the glyph and none of the rest. Only a
   paragraph whose words changed is rewritten, so a reader is not re-read to. */
function paintFieldMsgs(msgs){
  const want = {};
  msgs.forEach(m => {
    const k = paraKey(m.field);
    if(k === null) return;
    const cur = want[k];
    if(!cur || (cur.kind === 'note' && m.kind === 'error')) want[k] = m;
  });
  ERR_KEYS.forEach(k => {
    const p = $('pl-err-' + k), inp = $(inputIdOf(k));
    if(!p || !inp) return;
    const m = want[k] || null, wrap = inp.closest('.pl-f');
    const sig = m ? m.kind + '|' + m.item.titleText : '';
    if(p.getAttribute('data-sig') !== sig){
      p.textContent = '';
      if(m){
        p.appendChild(glyph(m.kind === 'error' ? 'bad' : 'info'));
        p.appendChild(el('span', null, m.item.titleText));
        p.setAttribute('data-kind', m.kind);
      } else p.removeAttribute('data-kind');
      p.setAttribute('data-sig', sig);
      p.hidden = !m;
    }
    const base = inp.getAttribute('data-base') || '';
    if(m && m.kind === 'error'){
      wrap.setAttribute('data-invalid', '');
      inp.setAttribute('aria-invalid', 'true');
    } else {
      wrap.removeAttribute('data-invalid');
      inp.removeAttribute('aria-invalid');
    }
    const desc = (m ? p.id + ' ' : '') + base;
    if(desc.trim()) inp.setAttribute('aria-describedby', desc.trim()); else inp.removeAttribute('aria-describedby');
  });
}
/* the one message that belongs to no field: what the page said when it refused a commit
   (SGP4 cannot start, the list is full, storage is blocked) */
function paintFormErr(item, kind){
  const p = $('pl-err-form');
  p.textContent = '';
  if(!item){ p.hidden = true; p.removeAttribute('data-kind'); return; }
  p.appendChild(glyph(kind === 'warn' ? 'warn' : 'bad'));
  p.appendChild(el('span', null, item.titleText));
  p.setAttribute('data-kind', kind || 'error');
  p.hidden = false;
}

/* ---------------------------------------------------------------------------- the notes: keyed, never rebuilt */

/* Items are keyed. A pass that finds an item's words unchanged leaves its node where it is
   (so scroll, an open group and the focus on a fix button survive), replaces a changed one in
   place, inserts a new one in order and removes one that is gone. Nothing animates and
   nothing scrolls into view. */
function syncList(ul, entries){
  const old = new Map();
  for(let n = ul.firstElementChild; n; n = n.nextElementSibling) old.set(n.getAttribute('data-key'), n);
  const had = document.activeElement;
  let cursor = ul.firstElementChild;
  const keep = new Set();
  entries.forEach(en => {
    let n = old.get(en.key);
    if(n && n._sig !== en.sig){
      const fresh = en.build();
      if(had && n.contains(had)){
        /* the node under the reader's focus is being replaced: keep the focus on the same button */
        const at = Array.prototype.indexOf.call(n.querySelectorAll('.fixes .btn'), had);
        ul.replaceChild(fresh, n);
        if(cursor === n) cursor = fresh;
        const btn = at >= 0 ? fresh.querySelectorAll('.fixes .btn')[at] : null;
        if(btn) btn.focus({ preventScroll: true });
        n = fresh;
      } else {
        if(cursor === n) cursor = fresh;
        ul.replaceChild(fresh, n);
        n = fresh;
      }
    } else if(!n) n = en.build();
    keep.add(en.key);
    if(n === cursor) cursor = cursor.nextElementSibling;
    else ul.insertBefore(n, cursor);
  });
  old.forEach((n, k) => { if(!keep.has(k) && n.parentNode === ul) ul.removeChild(n); });
}

/* one note as DOM: severity glyph and word (so colour is never the only signal), title, body,
   the basis with its link into the Terms, and the fixes. `opt.readonly` is the Professor on a
   catalogue spacecraft (the report's own section): it never draws a fix, whatever the item
   carries, because nothing there is a form a fix could write to, and the one note that sends
   the reader elsewhere (life.tracked: the forecast is under Orbital decay) gets the link. */
function buildItem(it, key, opt){
  const ro = !!(opt && opt.readonly);
  const li = el('li', 'adv');
  li.setAttribute('data-sev', it.sev);
  li.setAttribute('data-id', it.id);
  li.setAttribute('data-key', key);
  const sev = el('span', 'sev');
  sev.appendChild(glyph(it.sev));
  sev.appendChild(el('span', null, it.word));
  li.appendChild(sev);
  li.appendChild(partsInto(el('h4'), it.title));
  if(it.body.length) li.appendChild(partsInto(el('p'), it.body));
  if(it.basis){
    const b = el('p', 'basis');
    b.title = AC().ADVISOR_LABEL + ': what this rests on';
    b.appendChild(document.createTextNode('Basis: ' + it.basis));
    if(it.term){
      b.appendChild(document.createTextNode(' · '));
      const a = el('a', null, 'Terms');
      a.setAttribute('href', '#' + it.term);
      b.appendChild(a);
    }
    li.appendChild(b);
  }
  if(ro && it.id === 'life.tracked'){
    const j = el('p', 'basis');
    j.appendChild(document.createTextNode('Go to '));
    const a = el('a', null, 'Orbital decay');
    a.setAttribute('href', '#sec-life');
    j.appendChild(a);
    li.appendChild(j);
  }
  if(!ro && it.fixes.length){
    const f = el('div', 'fixes');
    it.fixes.forEach(fx => {
      const btn = el('button', 'btn');
      btn.type = 'button';
      partsInto(btn, fx.label);
      btn.addEventListener('click', () => applyFix(it, fx));
      f.appendChild(btn);
    });
    li.appendChild(f);
  }
  return li;
}
const itemSig = it => JSON.stringify([it.sev, it.title, it.body, it.basis, it.term,
  it.fixes.map(f => [f.label, f.set, f.focus])]);
function entryFor(it, key, opt){
  const sig = itemSig(it);
  return { key: key, sig: sig, item: it, build: () => { const li = buildItem(it, key, opt); li._sig = sig; return li; } };
}

/* the order Advisor/AdvisorCopy gives, for putting a kept note back among fresh ones */
function orderOf(it){
  const items = AC().ITEMS, gs = AC().GROUPS;
  let at = items.length;
  for(let i = 0; i < items.length; i++) if(items[i].id === it.id){ at = i; break; }
  let g = gs.length;
  for(let i = 0; i < gs.length; i++) if(gs[i].id === it.group){ g = i; break; }
  return { g: g, at: at, rank: AC().SEV[it.sev].rank };
}
function sortLikeAdvise(list){
  return list.map(it => ({ it: it, o: orderOf(it) })).sort((a, b) => {
    if(a.o.g !== b.o.g) return a.o.g - b.o.g;
    if(a.it.group !== 'type' && a.o.rank !== b.o.rank) return b.o.rank - a.o.rank;
    return a.o.at - b.o.at;
  }).map(x => x.it);
}
/* does this item read the page's own pass finder? (then it can only be said once a trial ran) */
function needsMeasured(it){
  const items = AC().ITEMS;
  for(let i = 0; i < items.length; i++) if(items[i].id === it.id) return !!(items[i].flags && items[i].flags.needs === 'measured');
  return false;
}

/* "1 Problem, 2 Checks, 6 notes" on a group's summary: the glyphs carry the shape, the words
   the meaning, and the label spells it out for a reader that does not see the glyph */
function paintSummary(det, title, items){
  const sum = det.querySelector('summary');
  const nBad = items.filter(i => i.sev === 'bad' || i.sev === 'error').length;
  const nWarn = items.filter(i => i.sev === 'warn').length;
  const sig = title + '|' + nBad + '|' + nWarn + '|' + items.length;
  if(sum.getAttribute('data-sig') === sig) return;
  sum.setAttribute('data-sig', sig);
  sum.textContent = '';
  sum.appendChild(el('span', 'gt', title));
  const c = el('span', 'pf-count');
  const chip = (sev, n, word) => {
    const s = el('span');
    s.setAttribute('aria-label', n + ' ' + word);
    s.appendChild(glyph(sev));
    s.appendChild(document.createTextNode(String(n)));
    c.appendChild(s);
  };
  if(nBad) chip('bad', nBad, nBad === 1 ? 'problem' : 'problems');
  if(nWarn) chip('warn', nWarn, 'to check');
  c.appendChild(el('span', null, items.length + (items.length === 1 ? ' note' : ' notes')));
  sum.appendChild(c);
}

/* The five groups of notes under one heading, for whichever panel `root` is: the planner's own
   (#prof) or the report's read-only section (#sec-prof). The shells are static, in the markup,
   and are never rebuilt (the reader's open and closed groups survive); a shell with nothing in
   it is hidden; each list is synced by key, so a note whose words did not change keeps its node.
   `opt` is passed on to every note (buildItem). */
function paintGroups(root, shown, site, opt){
  const groups = AC().GROUPS;
  const bySlot = {};
  groups.forEach(g => { bySlot[g.id] = []; });
  shown.forEach(it => { if(bySlot[it.group]) bySlot[it.group].push(it); });
  groups.forEach(g => {
    const det = root.querySelector('details.pf-grp[data-group="' + g.id + '"]');
    if(!det) return;
    const list = bySlot[g.id];
    const wasHidden = det.hidden;
    det.hidden = list.length === 0;
    if(list.length){
      let title;
      try { title = AC().render(g.title, { site: site }); } catch(e){ title = g.title.replace('{site}', site); }
      paintSummary(det, title, list);
      syncList(det.querySelector('.pf-list'), list.map(it => entryFor(it, it.id, opt)));
      /* open on first show when it holds something to check (the kind of orbit is always open);
         after that the reader's own choice stands, until a Check or Problem arrives in a
         group they never touched */
      const urgent = list.some(i => i.sev === 'bad' || i.sev === 'error' || i.sev === 'warn');
      if(wasHidden) det.open = urgent || g.id === 'type';
      else if(opt && opt.readonly){
        /* a new spacecraft is a new subject: a group the reader never touched goes back to what it opens as (a Problem on the
           last one must not leave its group open on the next); one they opened or closed themselves stays as they left it */
        if(!det.getAttribute('data-touched')) det.open = urgent || g.id === 'type';
      }
      else if(urgent && !det.getAttribute('data-touched')) det.open = true;
    }
  });
}

/* Everything the Professor's panel shows, from what the last passes found. `retain` keeps the
   notes that read the page's pass finder as they stand while a new trial is pending: they are
   about the orbit the student has just edited away from, but they are not removed and brought
   back 340 ms later (nothing jumps), and the verdict strip carries data-stale until the trial
   answers. */
function renderNotes(retain){
  const fr = S.fr, adv = S.adv;
  const msgs = S.msgs.filter(m => m.kind === 'error');
  /* an empty form (nothing typed yet) says how to begin instead of listing a missing figure per field */
  const empty = !fr.ok && fr.errors.length > 0 && fr.errors.every(e => e.code === 'err.missing') &&
    ['hp', 'ha', 'a', 'e', 'period', 'inc'].filter(k => fr.errors.some(e => e.field === k)).length >= 3;
  const errEntries = [];
  if(!empty) msgs.forEach(m => {
    const key = m.item.id + '@' + m.field;
    m.item._k = key;
    errEntries.push(entryFor(m.item, key));
  });
  syncList($('pf-errs'), errEntries);

  let shown = [];
  if(fr.ok && adv){
    shown = adv.items.slice();
    if(retain){
      const have = new Set(shown.map(i => i.id));
      (S.items || []).forEach(it => {
        if(S.adv && !have.has(it.id) && it.group !== 'input' && S.kept && S.kept[it.id]) shown.push(it);
      });
      shown = sortLikeAdvise(shown);
    }
  }
  shown.forEach(it => { it._k = it.id; });
  paintGroups($('prof'), shown, S.host.obs().name, null);
  S.kept = {};
  shown.forEach(it => { if(needsMeasured(it)) S.kept[it.id] = true; });
  S.items = (empty ? [] : msgs.map(m => m.item)).concat(shown);
  S.problems = msgs;

  /* heading, verdict, empty-state */
  const nCheck = S.items.filter(i => i.sev === 'error' || i.sev === 'bad' || i.sev === 'warn').length;
  setText($('pf-count'), empty || (fr.ok && !adv) ? '' : (nCheck ? nCheck + ' to check' : 'nothing to fix'));
  const verdict = $('pf-verdict');
  if(fr.ok && adv){
    verdict.hidden = false;
    verdict.setAttribute('data-worst', adv.worst);
    setText($('pf-head'), plain(adv.verdict.head));
  } else {
    verdict.hidden = true;
  }
  const emptyP = $('pf-empty');
  emptyP.hidden = !empty;
  if(empty) setText(emptyP, 'Type an altitude and an inclination and the notes start. Or start from a preset above.');
  paintVerdictSub(retain);
  scheduleSay();
}

/* ---------------------------------------------------------------------------- the passes */

const siteCopy = () => { const o = S.host.obs(); return { name: o.name, lat: o.lat, lon: o.lon, altKm: o.altKm, tz: o.tz }; };
/* A trial result is good for exactly what it was run for: the elements, the window (to the
   minute: "now" is a window start that moves), the span, the observer and the mask. The
   transport, the window bar and the span buttons stay live while the planner is open, and
   without this key the notes would quote a pass count for a window nobody is looking at. */
const measKey = (el, w, o) => JSON.stringify([el.a, el.e, el.i, el.raan, el.argp, el.M, el.epoch, el.am,
  Math.floor(w.startMs/60000), w.hours, o.lat, o.lon, o.altKm, S.host.mask]);
function cancelIdle(){
  if(S.idle && global.cancelIdleCallback) global.cancelIdleCallback(S.idle);
  S.idle = 0;
}

/* The Professor's numbers for this element set. `measured` is what the page's own pass finder
   said for the same key, else null, and then the items that need it are simply not said. */
function runAdvise(fr, measured){
  const w = S.host.window(), o = siteCopy();
  let m = measured;
  if(m === undefined) m = S.meas && S.meas.key === measKey(fr.el, w, o) ? S.meas.value : null;
  try {
    return global.Advisor.advise(fr.el, { nowMs: S.host.now(), site: o, maskDeg: S.host.mask,
      window: { startMs: w.startMs, hours: w.hours }, measured: m, tracked: false, host: 'draft', sat: S.host.sat },
      { host: 'draft' });
  } catch(e){ console.error(e); return null; }
}

/* The closed-form pass: what the form comes to, now. 160 ms after the last input. `interim`:
   a trial is on its way, so the notes that read it stay as they stand. */
function passFast(interim){
  S.tFast = 0;
  if(!S.ready || !S.model) return;
  const fr = P().fromForm(S.model);
  const nm = checkName(liveEditing());
  S.fr = fr; S.nameChk = nm; S.from = 'closed';
  S.msgs = collectMsgs(fr, nm);
  paintReadouts(fr);
  paintFieldMsgs(S.msgs);
  S.adv = fr.ok ? runAdvise(fr) : null;
  renderNotes(!!interim && fr.ok);
  paintPrimary();
}
/* The trial pass: the page's own pass finder run on the draft, 500 ms after the last input, on
   an idle callback where there is one, never while the form is invalid, and cancelled by the
   next input. It assigns nothing: `D`, the globe and the clock are what they were. */
function passTrial(sync){
  S.tTrial = 0;
  if(!S.ready || !S.model || !S.fr || !S.fr.ok) return;
  const fr = S.fr;
  const run = () => {
    S.idle = 0;
    if(!S.ready || S.fr !== fr) return;               // a later input has taken this pass's place
    const w = S.host.window(), o = siteCopy();
    let value = null;
    try {
      const t = P().toTLE(fr.el, 'O0000');
      value = S.host.trial({ name: 'draft', l1: t.l1, l2: t.l2, satnum: 'O0000', custom: true, el: fr.el }, w.startMs, w.hours) || null;
    } catch(e){ value = null; }
    S.meas = { key: measKey(fr.el, w, o), value: value };
    S.adv = runAdvise(fr, value);
    S.from = 'trial';
    renderNotes(false);
    paintPrimary();
  };
  if(sync || !global.requestIdleCallback) run();
  else S.idle = global.requestIdleCallback(run, { timeout: 600 });
}
function schedule(){
  if(!S.ready) return;
  clearTimeout(S.tFast); clearTimeout(S.tTrial); cancelIdle();
  if(S.formErr){ S.formErr = null; paintFormErr(null); }
  S.tFast = setTimeout(() => passFast(true), FAST_MS);
  S.tTrial = setTimeout(() => passTrial(false), TRIAL_MS);
}
/* both passes, now: what a test waits for instead of timers */
function flush(){
  if(!S.ready) return;
  clearTimeout(S.tFast); clearTimeout(S.tTrial); cancelIdle();
  ensureModel();
  passFast(true);
  passTrial(true);
}

/* The page's own run for the orbit on the globe, in the shape the trial gives. Used so that,
   once the orbit in the form is the one on screen, the notes quote `D` itself. */
function measuredFromD(D){
  return { n: D.passes.length, totalS: D.totalS,
    longestS: D.passes.reduce((m, p) => Math.max(m, p.dur), 0), bestEl: D.passes.reduce((m, p) => Math.max(m, p.maxEl), 0),
    altMin: D.E.perigeeAlt, altMax: D.E.apogeeAlt, surfSwing: D.E.surfMax - D.E.surfMin, rSwing: D.E.rMax - D.E.rMin,
    reentry: !!D.reentry };
}
function adoptFromD(D){
  const ed = liveEditing();
  if(!D || !ed || D.entry !== ed || !S.fr || !S.fr.ok || !formUnchanged(ed)) return false;
  try {
    S.meas = { key: measKey(S.fr.el, { startMs: D.start.getTime(), hours: D.hours }, siteCopy()), value: measuredFromD(D) };
    S.adv = runAdvise(S.fr, S.meas.value);
    renderNotes(false);
    return true;
  } catch(e){ return false; }
}

/* ---------------------------------------------------------------------------- what is on the globe, and the buttons */

function sameEl(a, b){
  const near = (x, y, t) => Math.abs(x - y) <= t;
  const ang = (x, y) => { const d = Math.abs(wrap360(x) - wrap360(y)); return Math.min(d, 360 - d) <= 1e-7; };
  if(!isNum(a.am) || !isNum(b.am)) return false;
  return near(a.a, b.a, 1e-6) && near(a.e, b.e, 1e-9) && near(a.i, b.i, 1e-9) && ang(a.raan, b.raan) &&
    ang(a.argp, b.argp) && ang(a.M, b.M) && Math.abs(a.epoch - b.epoch) < 1000 && near(a.am, b.am, 1e-9*Math.max(1, Math.abs(b.am)));
}
/* is the form the very orbit it was opened from? Compared as elements, not as text: typing the
   same figure again is not a change, and the epoch is whole seconds in a form. */
function formUnchanged(ed){
  const fr = S.fr, nm = S.nameChk;
  return !!(fr && fr.ok && nm && !nm.empty && nm.cleaned === ed.name && sameEl(fr.el, ed.el));
}
/* "4 passes from Bangkok in 24 h": what a commit says; the verdict line adds the minutes */
function passLine(D){
  const site = S.host.obs().name, n = D.passes.length;
  if(!n) return 'no pass above ' + S.host.mask + '° from ' + site + ' in this window';
  return n + (n === 1 ? ' pass' : ' passes') + ' from ' + site + ' in ' + D.hours + ' h';
}
function passLineLong(D){
  const site = S.host.obs().name, n = D.passes.length;
  if(!n) return 'no pass above ' + S.host.mask + '° from ' + site + ' in this window';
  return n + (n === 1 ? ' pass' : ' passes') + ' from ' + site + ', ' + (D.totalS/60).toFixed(1) + ' min in ' + D.hours + ' h';
}
/* the line under the verdict: where this orbit stands against the globe. It carries data-stale
   while the form has moved away from what is on the globe, or a trial is on its way. */
function paintVerdictSub(retain){
  const v = $('pf-verdict');
  if(v.hidden) return;
  const D = S.host.current(), ed = liveEditing();
  let text, stale = !!retain;
  if(ed && D && D.entry === ed){
    if(formUnchanged(ed)) text = 'On the globe now: ' + ed.name + ' · ' + passLineLong(D);
    else { text = 'On the globe: ' + ed.name + ' as added. The form has changed — press Update'; stale = true; }
  } else text = 'Not on the globe yet — press Add to console';
  setText($('pf-sub'), text);
  if(stale) v.setAttribute('data-stale', ''); else v.removeAttribute('data-stale');
}
/* The primary button is never disabled (a disabled button cannot be focused and cannot say
   why): aria-disabled while the form cannot be added, or is already what the globe shows. */
function paintPrimary(){
  const add = $('pl-add'), sv = $('pl-savenew');
  const ed = liveEditing(), D = S.host.current(), fr = S.fr, nm = S.nameChk;
  const formOk = !!(fr && fr.ok && nm && !nm.empty);
  const valid = formOk && !nm.taken;
  let label = 'Add to console', blocked = !valid;
  if(ed){
    if(valid && D && D.entry === ed && formUnchanged(ed)){ label = 'Shown on globe'; blocked = true; }
    else label = 'Update on globe';
  }
  setText(add, label);
  if(blocked) add.setAttribute('aria-disabled', 'true'); else add.removeAttribute('aria-disabled');
  sv.hidden = !ed;
  if(!formOk || nm.takenCat) sv.setAttribute('aria-disabled', 'true'); else sv.removeAttribute('aria-disabled');
}

/* ---------------------------------------------------------------------------- the status line and the spoken summary */

function liveSay(text){
  /* the sheet closes itself on Add and its status line goes with it: the sentence is also
     written where a screen reader still hears it */
  if(!S.open || mode() === 'sheet') $('pl-live').textContent = text;
}
/* #pl-status: written only on a commit, a fix, a delete, a reset, a copy or a preset, never
   per keystroke. `undo` and `globe` add a button; `ttl` takes the Undo away after that long. */
function setStatus(text, o){
  const opt = o || {}, st = $('pl-status');
  clearTimeout(S.tUndo);
  st.textContent = '';
  st.appendChild(document.createTextNode(text));
  const button = (label, fn) => {
    const b = el('button', 'btn', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    st.appendChild(b);
    return b;
  };
  clearLocalUndo();
  let undoBtn = null;
  if(opt.undo) undoBtn = button('Undo', () => { clearTimeout(S.tUndo); opt.undo(); });
  if(opt.globe) button('Show globe', () => {
    const vp = document.querySelector('.viewport');
    if(vp) scrollBelowHeader(vp);
  });
  if(opt.ttl && undoBtn) S.tUndo = setTimeout(() => {
    if(undoBtn.parentNode === st){
      const had = document.activeElement === undoBtn;
      st.removeChild(undoBtn);
      if(had && S.open) $('pl-reset').focus({ preventScroll: true });
    }
    if(clearLocalUndo() && S.open) focusRow($('pl-saved-list').querySelectorAll('li').length);   // the focus was on the copy under the list: the last row's Open, else the fallback
  }, opt.ttl);
  if(opt.live !== false) liveSay(text);
}

/* #pl-say: what is to be checked, after 1,200 ms of quiet, and only when the SET of things to
   check changed; only the new ones are named, and Notes and Goods are never spoken. */
function scheduleSay(){
  const hot = S.items.filter(it => it.sev === 'error' || it.sev === 'bad' || it.sev === 'warn');
  const keys = hot.map(it => it._k).sort().join('|');
  clearTimeout(S.tSay);
  if(keys === S.spoken) return;
  S.tSay = setTimeout(() => {
    const was = new Set(S.spoken ? S.spoken.split('|') : []);
    const fresh = hot.filter(it => !was.has(it._k));
    const label = AC().ADVISOR_LABEL;
    let text = label + ': nothing to check.';
    if(hot.length) text = label + ': ' + hot.length + ' to check.' + (fresh.length ? ' ' + fresh.map(it => it.titleText).join('. ') + '.' : '');
    S.spoken = keys;
    $('pl-say').textContent = text;
  }, SAY_MS);
}

/* ---------------------------------------------------------------------------- fixes */

function clearChanged(){
  document.querySelectorAll('.planner .changed').forEach(n => n.classList.remove('changed'));
}
/* the boxes a student can see now, in the order they meet them */
function visibleKeys(){
  const m = S.model, size = m.shape === 'alt' ? ['hp', 'ha'] : m.shape === 'ae' ? ['a', 'e'] : ['period', 'e'];
  return ['name'].concat(size, ['inc', nodeKey(), 'argp', 'ma', 'epoch', 'am']);
}
function focusKey(key){
  const inp = inputFor(key === 'ltan' ? 'raan' : key);
  if(!inp) return;
  inp.focus();
  try { inp.select(); } catch(e){ /* a date box has nothing to select */ }
}
const FORM_KEYS = ['name', 'hp', 'ha', 'a', 'e', 'period', 'inc', 'raan', 'ltan', 'argp', 'ma', 'epoch', 'am'];

/* A fix writes the fields it names (through patchForm, so it works in whichever lens is
   showing), tints them, moves the focus to the first one and says what it did, with an Undo.
   It never commits: the globe changes only on Add. A sun-synchronous orbit that is made taller
   or shorter stays sun-synchronous: its inclination is solved again for the new height. */
function applyFix(it, fx){
  ensureModel();
  const before = Object.assign({}, S.model);
  let next = P().patchForm(S.model, fx.set);
  const keys = Object.keys(fx.set);
  const sizeFix = keys.some(k => k === 'hp' || k === 'ha' || k === 'a' || k === 'period');
  let sso = false;
  try { sso = !!(S.adv && S.adv.c && AC().helpers.sunsync(S.adv.c)); } catch(e){ sso = false; }
  if(sizeFix && sso && keys.indexOf('inc') < 0){
    const r2 = P().fromForm(next);
    if(r2.derived){
      const inc = P().ssoInclination(r2.derived.a, r2.derived.e);
      if(isNum(inc)) next = P().patchForm(next, { inc: Math.round(inc*1e4)/1e4 });
    }
  }
  const seen = visibleKeys();
  const changed = seen.filter(k => fieldText(k, before[k]) !== fieldText(k, next[k]));
  const written = FORM_KEYS.filter(k => before[k] !== next[k]);
  S.model = next;
  writeFields();
  clearChanged();
  changed.forEach(k => {
    const inp = inputFor(k === 'ltan' ? 'raan' : k), box = inp && inp.closest('.pl-num, .pl-text');
    if(box) box.classList.add('changed');
  });
  if(changed.length) focusKey(changed[0]);
  const said = changed.map(k => 'Set ' + SAY_FIELD[k] + ' to ' + sayVal(k, next[k]) + ' (was ' + sayVal(k, before[k]) + ').').join(' ');
  schedule();
  setStatus(said || 'Nothing to change: the form already says that.', {
    undo: () => {
      written.forEach(k => { S.model[k] = before[k]; });
      writeFields();
      clearChanged();
      if(changed.length) focusKey(changed[0]);
      schedule();
      setStatus('Put back ' + changed.map(k => SAY_FIELD[k] + ' (' + sayVal(k, before[k]) + ')').join(', ') + '.');
    }
  });
}

/* ---------------------------------------------------------------------------- presets, craft, Now */

/* The "Start from" list: the spacecraft on screen, the student's own orbits, then the eleven
   presets of earth/planner.js. Rebuilt only when what it lists changed (a rebuild while the
   student has the list open would close it). */
function buildPresets(){
  const sel = $('pl-preset'), host = S.host, D = host.current(), customs = host.customs();
  const ep = S.model ? modelEpochMs() : null;
  const pre = P().presets(host.obs(), ep === null ? floorSecond(host.now()) : ep);
  const sig = JSON.stringify([D && D.entry ? D.entry.name : '', customs.map(c => c.cid + c.name), pre.map(p => p.label)]);
  if(sig !== S.presetSig || !sel.options.length){
    S.presetSig = sig;
    sel.textContent = '';
    const group = label => { const g = document.createElement('optgroup'); g.label = label; sel.appendChild(g); return g; };
    const opt = (parent, value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; parent.appendChild(o); };
    if(D && D.entry) opt(group('On screen'), 'screen', 'The spacecraft on screen: ' + D.entry.name);
    if(customs.length){ const g = group('Your orbits'); customs.forEach(c => opt(g, 'c:' + c.cid, c.name)); }
    const by = {};
    pre.forEach(p => { if(!by[p.group]) by[p.group] = group(p.group); opt(by[p.group], p.key, p.label); });
  }
  const has = v => Array.prototype.some.call(sel.options, o => o.value === v);
  sel.value = has(S.presetVal) ? S.presetVal : (has('sso') ? 'sso' : '');
  if(!$('pl-preset-note').textContent){
    const p = pre.find(x => x.key === S.presetVal);
    setText($('pl-preset-note'), p ? p.why : '');
  }
}
/* Choosing one fills the form and nothing else: the console does not change until Add. The
   typed name stays (a preset has none), except for the spacecraft on screen, which becomes
   "<its name> (mine)" so it cannot be mistaken for it. */
function loadPreset(v){
  ensureModel();
  const host = S.host;
  let form = null, note = '', said = '', name = null;
  try {
    if(v === 'screen'){
      const D = host.current();
      if(!D || !D.entry) return;
      const e = D.entry;
      if(e.custom && e.el){ form = P().toForm(e.el, { name: '' }); note = 'The elements as you typed them.'; }
      else {
        const el = P().elementsFromTLE(e.l1, e.l2, host.sat);
        form = P().toForm(el, { name: '' });
        note = el.am === null ? 'No drag information at this height: a typical satellite is assumed'
                              : 'B* from its TLE, worked back to A/m: fitted, not measured';
      }
      name = first17(e.name) + ' (mine)';
      said = 'Loaded ' + e.name + ' into the form. Nothing is on the globe until you add it.';
    } else if(v.indexOf('c:') === 0){
      const e = host.customs().find(c => c.cid === v.slice(2));
      if(!e) return;
      form = P().toForm(e.el, { name: '' });
      note = 'The elements as you typed them.';
      said = 'Loaded ' + e.name + ' into the form. Nothing is on the globe until you add it.';
    } else {
      const ep = modelEpochMs();
      const p = P().presets(host.obs(), ep === null ? floorSecond(host.now()) : ep).find(x => x.key === v);
      if(!p) return;
      form = p.form;
      note = p.why;
      said = 'Loaded the ' + p.label + ' preset into the form. Nothing is on the globe until you add it.';
    }
  } catch(err){
    console.error(err);
    setStatus('That starting point could not be read.');
    return;
  }
  S.model = Object.assign({}, form, { name: name === null ? S.model.name : name });
  S.presetVal = v;
  setText($('pl-preset-note'), note);
  writeFields();
  clearChanged();
  schedule();
  setStatus(said);
}
function onCraft(){
  ensureModel();
  const key = $('pl-craft').value, c = P().CRAFTS.find(x => x.key === key);
  if(!c) return;
  if(c.am !== null){
    S.model.am = c.am;
    setVal('pl-am', fieldText('am', c.am));
  }
  clearChanged();
  syncCraft();
  schedule();
}
/* Now sets the epoch and keeps M: a satellite does not wait for the clock, and the mean
   anomaly belongs to the epoch (a minute moves a geostationary one a quarter of a degree).
   The node that was typed, RAAN or local time, keeps its meaning against the new epoch. */
function onNow(){
  ensureModel();
  S.model = P().patchForm(S.model, { epoch: floorSecond(S.host.now()) });
  writeFields();
  clearChanged();
  schedule();
}
function onEdited(key, inp){
  if(key === 'e'){
    const other = $(inp.id === 'pl-e' ? 'pl-e-p' : 'pl-e');
    if(other) other.value = inp.value;
  }
  if(key === 'am') syncCraft();
  clearChanged();
  schedule();
}
function resetForm(){
  const ed = liveEditing();
  if(ed){
    S.model = P().toForm(ed.el, { name: ed.name });
    S.presetVal = 'c:' + ed.cid;
    setText($('pl-preset-note'), 'The elements as you typed them.');
  } else {
    S.model = P().defaultForm(S.host.obs(), floorSecond(S.host.now()));
    S.model.name = 'My orbit';
    S.presetVal = 'sso';
    setText($('pl-preset-note'), '');
  }
  buildPresets();
  writeFields();
  clearChanged();
  S.formErr = null; paintFormErr(null);
  schedule();
  setStatus(ed ? 'Back to the orbit on the globe.' : 'Back to the starting orbit.');
}

/* ---------------------------------------------------------------------------- Add, Update, Save as new */

/* "SGP4 cannot fly this orbit (error 6: decayed)": the reason is SGP4's own, from the table in
   earth/planner.js, whichever side noticed */
function sgp4Said(err){
  const code = isNum(err.sgp4) ? err.sgp4 : 0, t = P().SGP4_ERRORS, info = t[code] || t[0];
  return 'SGP4 cannot fly this orbit (error ' + code + ': ' + info.why + ')';
}
function failCommit(err, verb){
  const e = Object.assign({}, err);
  let text;
  if(e.code === 'err.sgp4'){
    const t = P().SGP4_ERRORS, info = t[isNum(e.sgp4) ? e.sgp4 : 0] || t[0];
    if(e.why === undefined) e.why = info.why;
    if(e.hint === undefined) e.hint = info.hint;
    text = sgp4Said(e);
  }
  const item = e.code === 'planner.off' || e.code === 'planner.full' ? inputItem('x', { msg: e.msg }) : inputItem(e.code, e);
  S.formErr = item;
  paintFormErr(item, e.code === 'err.cap' || e.code === 'err.storage' ? 'warn' : 'error');
  setStatus(verb + ': ' + (text || item.titleText) + '.');
}
/* Commit. 1: the form must read; 2: the name must be free; 3: the page adds or updates the
   spacecraft and loads it, and refuses with SGP4's reason before anything is kept; 4: say what
   happened. A refused commit changes nothing: the previous spacecraft stays on the globe. */
function commit(kind){
  if(!S.ready || S.off) return;
  clearTimeout(S.tFast); clearTimeout(S.tTrial); cancelIdle();
  passFast(false);
  const host = S.host, ed = liveEditing(), fr = S.fr, D0 = host.current();
  const asNew = kind === 'new' || !ed;
  const verb = ed && kind !== 'new' ? 'Not updated' : 'Not added';
  const nm = asNew ? checkName(null) : S.nameChk;
  let prob = null;
  if(nm.empty) prob = { field: 'name', item: inputItem('err.name.empty', {}) };
  else if(kind === 'new' ? nm.takenCat : nm.taken) prob = { field: 'name', item: inputItem('err.name.taken', { name: nm.cleaned, name_free: nm.free }) };
  if(!prob && !fr.ok){
    const m = S.msgs.find(x => x.kind === 'error' && paraKey(x.field) !== null) || S.msgs.find(x => x.kind === 'error');
    if(m) prob = { field: m.field, item: m.item };
  }
  if(prob){
    focusKey(prob.field);
    setStatus(verb + ': ' + prob.item.titleText + '. The field is marked.');
    return;
  }
  if(kind === 'primary' && ed && D0 && D0.entry === ed && formUnchanged(ed)){
    setStatus('Already on the globe.');
    return;
  }
  const name = nm.cleaned, wasOn = !!(ed && D0 && D0.entry === ed);
  let res;
  try {
    res = asNew ? host.add({ name: name, el: fr.el }) : host.update(ed, { name: name, el: fr.el });
  } catch(err){
    console.error(err);
    res = { ok: false, errors: [{ field: '', code: 'err.sgp4', sgp4: 0, msg: 'The page could not start this orbit.' }] };
  }
  if(!res || !res.ok){
    const errs = res && res.errors && res.errors.length ? res.errors : [{ field: '', code: 'err.sgp4', sgp4: 0 }];
    failCommit(errs[0], verb);
    return;
  }
  const entry = res.entry;
  if(!asNew && !wasOn){ try { host.show(entry); } catch(err){ console.error(err); } }
  S.editing = entry;
  S.formErr = null; paintFormErr(null);
  S.presetVal = 'c:' + entry.cid;
  // The select now reads the orbit just kept, so the sentence under it must be about that: left
  // alone it went on describing the preset the form was started from (for the ISS-like one, "The
  // orbit every CubeSat released from the station starts in") under the saved orbit's own name.
  // The words are loadEntryIntoForm's.
  setText($('pl-preset-note'), 'The elements as you typed them.');
  if(entry.name !== name){ S.model.name = entry.name; setVal('pl-name', entry.name); }
  if(res.saved === false && !S.storageNoted){
    S.storageNoted = true;
    S.formErr = inputItem('err.storage', {});
    paintFormErr(S.formErr, 'warn');
  }
  const D = host.current();
  let text;
  if(kind === 'new' && entry.name !== name) text = 'Saved as ' + entry.name + '.';
  else if(D && D.reentry) text = (asNew ? 'Added ' : 'Updated ') + entry.name + '. SGP4 takes it below 120 km: these passes will not happen.';
  else if(!asNew) text = 'Updated ' + entry.name + '.';
  else text = 'Added ' + entry.name + ' and loaded it' + (D ? ': ' + passLine(D) : '') + '.';
  if(res.windowMoved) text += ' The window now opens at the epoch: an orbit this high is slow to analyse far from it.';
  const flow = mode() === 'flow';
  if(flow) text += ' The globe is above.';
  buildPresets();
  refreshSaved();
  flushFastOnly();
  adoptFromD(D);
  paintVerdictSub(false);
  paintPrimary();
  setStatus(text, { globe: flow });
  if(mode() === 'sheet') closePlanner();
}
/* the closed-form pass without the trial: after a commit the notes already know the orbit */
function flushFastOnly(){
  clearTimeout(S.tFast); clearTimeout(S.tTrial); cancelIdle();
  passFast(true);
}

/* ---------------------------------------------------------------------------- saved orbits */

function savedSummary(e){
  const F = AC().FMT, a = P().apsides(e.el.a, e.el.e), kind = P().kindWord(e.el);
  const height = e.el.e < 0.01 ? F.km(e.el.a - P().RE) : F.km(a.hp).replace(' km', '') + ' × ' + F.km(a.ha);
  const sso = kind === 'SSO';
  const node = sso ? 'LTAN ' + fmtLtan(P().ltanFromRaan(e.el.raan, e.el.epoch)) : 'RAAN ' + F.deg1(e.el.raan);
  return (kind ? kind + ' ' : '') + height + ' · i ' + F.deg2(e.el.i) + ' · ' + node;
}
/* "Your orbits": a row per saved orbit, Open (loads it on the globe and into the form) and
   Delete. The list is repainted whenever the page says it changed; if the focus was in it, it
   is put back on the same row, so a repaint never leaves it on <body>. */
function refreshSaved(){
  if(!S.ready || S.off) return;
  const host = S.host, ul = $('pl-saved-list'), list = host.customs(), D = host.current();
  const act = document.activeElement;
  let back = null;
  if(act && ul.contains(act)){
    const li = act.closest('li');
    if(li) back = { cid: li.getAttribute('data-cid'), del: act.classList.contains('pl-del') };
  }
  ul.textContent = '';
  list.forEach(e => {
    let sum = '';
    try { sum = savedSummary(e); } catch(err){ sum = ''; }
    const li = el('li');
    li.setAttribute('data-cid', e.cid);
    const open = el('button', 'pl-open');
    open.type = 'button';
    open.appendChild(el('b', null, e.name));
    open.appendChild(el('small', null, sum));
    if(D && D.entry === e) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => openEntry(e));
    const del = el('button', 'pl-del', '✕');
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete ' + e.name);
    del.addEventListener('click', () => deleteEntry(e));
    li.appendChild(open);
    li.appendChild(del);
    ul.appendChild(li);
  });
  setText($('pl-saved-count'), list.length + ' of ' + P().LIMITS.maxCustom + ', kept in this browser');
  $('pl-saved-none').hidden = list.length > 0;
  if(back){
    const li = ul.querySelector('li[data-cid="' + back.cid + '"]');
    const b = li && li.querySelector(back.del ? '.pl-del' : '.pl-open');
    if(b) b.focus({ preventScroll: true });
  }
  buildPresets();
}
/* the form becomes the orbit it was opened from (the typed values, not the TLE's rounding) */
function loadEntryIntoForm(entry){
  S.editing = entry;
  S.model = P().toForm(entry.el, { name: entry.name });
  S.presetVal = 'c:' + entry.cid;
  setText($('pl-preset-note'), 'The elements as you typed them.');
  S.formErr = null; paintFormErr(null);
  buildPresets();
  writeFields();
  clearChanged();
}
function openEntry(entry){
  loadEntryIntoForm(entry);
  try { S.host.show(entry); } catch(err){ console.error(err); }
  flush();
}
/* where the focus goes when a row is gone: the next row's Open, else the previous one's, else the
   pill that opened the list; in the sheet the pill is behind the dialog (inert), so the first
   field of the form takes it. Never <body>. */
function focusFallback(){
  if(S.open && mode() === 'sheet') $('pl-name').focus(); else $('planopen').focus();
}
function focusRow(index){
  const rows = $('pl-saved-list').querySelectorAll('li');
  const row = rows[index] || rows[index - 1];
  const b = row && row.querySelector('.pl-open');
  if(b) b.focus(); else focusFallback();
}
/* Is a node wholly on screen now: inside the part of the drawer or the sheet that is showing (the
   planner scrolls on its own there) and inside the window (in the flow the page scrolls). */
function onScreen(node){
  const r = node.getBoundingClientRect();
  let top = 0, bottom = global.innerHeight;
  const sc = document.querySelector('.pl-scroll');
  if(sc && sc.scrollHeight > sc.clientHeight + 1){
    const s = sc.getBoundingClientRect();
    top = Math.max(top, s.top); bottom = Math.min(bottom, s.bottom);
  }
  return r.height > 0 && r.top >= top && r.bottom <= bottom;
}
/* The Undo of a Delete is written into #pl-status, which lives in the action bar under the form, and
   the list of saved orbits is below the Professor: in the drawer at 1440 x 900 the bar was 447 px
   above the visible part of the drawer when the x of a row was pressed, and 589 px above the screen
   in the flow, so for its eight seconds the Undo was out of sight (the sheet keeps both on screen).
   When the status line is not on screen the same words and the same Undo are also shown under the
   list. #pl-status stays the live region and the one the Undo of SPEC 5.6 lives in; this is a second
   button for the same action, and it goes with the first (a newer status, the eight seconds, a click). */
function paintLocalUndo(text, undo){
  const box = $('pl-undo');
  if(!box) return;
  box.textContent = '';
  box.appendChild(el('span', '', text));
  const b = el('button', 'btn', 'Undo');
  b.type = 'button';
  b.addEventListener('click', () => { clearTimeout(S.tUndo); undo(); });
  box.appendChild(b);
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });          // at the very end of the list it would sit half under the edge of the drawer
}
/* returns whether the focus was inside it, so that its caller can put the focus somewhere real */
function clearLocalUndo(){
  const box = $('pl-undo');
  if(!box || box.hidden) return false;
  const had = box.contains(document.activeElement);
  box.hidden = true;
  box.textContent = '';
  return had;
}
/* Delete has no confirmation and an Undo for eight seconds. Undo hands the page the same id
   and the same place in the list, so the O#### number, a typed Doppler frequency and the row
   order come back; it brings the orbit back onto the globe only if it had been there. */
function deleteEntry(entry){
  const host = S.host, at = host.customs().indexOf(entry);
  if(at < 0) return;
  const D = host.current(), wasOn = !!(D && D.entry === entry), wasEditing = S.editing === entry;
  const snap = { name: entry.name, el: entry.el, cid: entry.cid, dlHz: entry.dlHz, stdMag: entry.stdMag, at: at };
  let ok = false;
  try { ok = host.remove(entry); } catch(err){ console.error(err); }
  if(!ok){ setStatus('Could not delete ' + snap.name + '.'); return; }
  if(wasEditing) S.editing = null;
  const D2 = host.current();
  const text = 'Deleted ' + snap.name + '.' + (wasOn && D2 && D2.entry ? ' Showing ' + D2.entry.name + ' again.' : '');
  refreshSaved();
  paintPrimary(); paintVerdictSub(false);
  const undo = () => undoDelete(snap, wasOn, wasEditing);
  setStatus(text, { undo: undo, ttl: UNDO_MS });
  focusRow(at);
  if(!onScreen($('pl-status'))) paintLocalUndo(text, undo);
}
function undoDelete(snap, wasOn, wasEditing){
  const input = { name: snap.name, el: snap.el, cid: snap.cid, at: snap.at, show: wasOn };
  if(isNum(snap.dlHz)) input.dlHz = snap.dlHz;
  if(isNum(snap.stdMag)) input.stdMag = snap.stdMag;
  let res = null;
  try { res = S.host.add(input); } catch(err){ console.error(err); }
  if(!res || !res.ok){ setStatus('Could not bring ' + snap.name + ' back.'); return; }
  if(wasEditing) S.editing = res.entry;
  refreshSaved();
  paintPrimary(); paintVerdictSub(false);
  setStatus('Restored ' + snap.name + '.');
  const li = $('pl-saved-list').querySelector('li[data-cid="' + res.entry.cid + '"]');
  const b = li && li.querySelector('.pl-open');
  if(b) b.focus(); else focusFallback();
}

/* ---------------------------------------------------------------------------- the element set card */

function selectTleLines(){
  const raw = $('tleraw');
  if(!raw) return;
  const last = raw.lastChild;
  const sel = global.getSelection && global.getSelection();
  if(!sel) return;
  const r = document.createRange();
  if(last && last.nodeType === 3 && last.data.charAt(0) === '\n'){ r.setStart(last, 1); r.setEnd(last, last.length); }
  else r.selectNodeContents(raw);
  sel.removeAllRanges();
  sel.addRange(r);
}
/* Copy as TLE: the two lines exactly as the page runs them. The status is written only after
   the clipboard says yes; with no clipboard (a plain-http address) or a refusal the two lines
   are selected for the reader to copy, and the promise is always caught. */
function copyTle(){
  const D = S.host.current();
  if(!D || !D.entry || !D.entry.custom) return;
  const t = S.host.entryTle(D.entry), text = t.l1 + '\n' + t.l2, num = D.entry.satnum;
  const said = msg => {
    setStatus(msg);
    const tip = $('tle-said');
    if(tip){
      tip.textContent = msg;
      clearTimeout(S.tTip);
      S.tTip = setTimeout(() => { tip.textContent = ''; }, 10000);
    }
    $('pl-live').textContent = msg;
  };
  const ok = () => said('Copied the two lines. Some tools want a numeric catalogue number; replace ' + num + '.');
  const fail = () => { selectTleLines(); said('Select and copy the two lines above.'); };
  try {
    if(global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) global.navigator.clipboard.writeText(text).then(ok, fail);
    else fail();
  } catch(err){ fail(); }
}

/* ---------------------------------------------------------------------------- the three presentations */

function mode(){
  if(global.matchMedia(MQ_SHEET).matches) return 'sheet';
  if(global.matchMedia(MQ_FLOW).matches) return 'flow';
  return 'drawer';
}
/* The sheet is a dialog, so what is behind it must not be reachable. The planner sits inside
   main.stage inside div.app, a direct child of <body>: "every other child of body" would make
   the planner itself inert, and leaving div.app alone would leave the header, the picker, the
   globe's buttons and the transport tabbable under aria-modal. So the siblings along the path
   from the planner up to <body> are made inert and the path itself never is. The icon
   sprite (an svg) and the confirmation region (#pl-live) are siblings that must stay as they
   are; a node that was already inert (the AR view's own list) is left alone and stays so. */
function sheetInert(on){
  if(!on){
    S.inerted.forEach(n => { n.inert = false; });
    S.inerted = [];
    return;
  }
  if(S.inerted.length) return;
  for(let n = $('planner'); n && n !== document.body; n = n.parentElement){
    const par = n.parentElement;
    if(!par) break;
    for(let s = par.firstElementChild; s; s = s.nextElementSibling){
      if(s === n || s.inert || s.id === 'pl-live' || s.localName === 'script' || s.localName === 'svg') continue;
      s.inert = true;
      S.inerted.push(s);
    }
  }
}
/* role, aria-modal, inert and the page's scroll lock follow the width and height, also while
   the planner is open and the window is resized across the boundary */
function applyMode(){
  const pl = $('planner'), sheet = S.open && mode() === 'sheet';
  if(sheet){
    pl.setAttribute('role', 'dialog');
    pl.setAttribute('aria-modal', 'true');
    document.documentElement.classList.add('pl-sheet');
    sheetInert(true);
  } else {
    pl.setAttribute('role', 'region');
    pl.removeAttribute('aria-modal');
    document.documentElement.classList.remove('pl-sheet');
    sheetInert(false);
  }
}
/* in the sheet the browser's own tab order would walk off the page, so Tab goes round the planner */
function trapTab(e){
  /* what Tab can reach: not disabled, drawn, and not inside a group that is shut (its summary is
     reachable, what is inside it is not even though it still has a box) */
  const nodes = Array.prototype.filter.call($('planner').querySelectorAll('a[href], button, input, select, textarea, summary'), n => {
    if(n.disabled || n.tabIndex < 0 || !n.getClientRects().length || n.closest('[hidden]')) return false;
    const d = n.closest('details');
    return !d || d.open || (n.localName === 'summary' && n.parentNode === d);
  });
  if(!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1], act = document.activeElement;
  if(e.shiftKey && (act === first || !$('planner').contains(act))){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && (act === last || !$('planner').contains(act))){ e.preventDefault(); first.focus(); }
}
function visibleNode(n){ return !!n && !n.hidden && n.getClientRects().length > 0 && !n.closest('[inert]'); }

/* where focus goes back to: the thing that opened the planner (for the picker's Plan row that
   is the pill, not the search box, whose focus handler would open the 2,158-row list again) */
function pickOpener(from){
  const id = { pill: 'planopen', picker: 'planopen', chip: 'customchip', tle: 'tle-edit' }[from];
  if(id) return $(id);
  const a = document.activeElement;
  return a && a !== document.body && !$('planner').contains(a) ? a : $('planopen');
}
function paintStatic(){
  setText($('pf-title'), AC().ADVISOR_LABEL);
  setText($('pf-foot'), AC().FOOTER);
}
/* Open. With an entry (the chip, Edit in planner, a saved row) the form is that orbit; with a
   name (the picker) it is the kept draft under that name; with neither, the kept draft, and
   the first time the default form. The draft survives closing; reloading loses it. */
function openPlanner(o){
  if(!S.ready || S.off) return false;
  const opt = o || {};
  ensureModel();
  paintStatic();
  const was = S.open;
  if(!was || !S.opener) S.opener = pickOpener(opt.from);
  if(opt.entry && S.host.customs().indexOf(opt.entry) >= 0) loadEntryIntoForm(opt.entry);
  else if(typeof opt.name === 'string'){
    const nm = P().cleanName(opt.name);
    if(nm) S.model.name = nm;
  }
  const pl = $('planner'), app = document.querySelector('.app');
  pl.hidden = false;
  app.setAttribute('data-planning', '');
  $('planopen').setAttribute('aria-expanded', 'true');
  S.open = true;
  applyMode();
  buildPresets();
  writeFields();
  refreshSaved();
  flush();
  if(mode() === 'flow') scrollBelowHeader(pl.querySelector('.pl-head'));
  const name = $('pl-name');
  name.focus({ preventScroll: true });
  try { name.select(); } catch(e){ /* nothing to select */ }
  return true;
}
/* Scroll a node to the top of the screen, and below the page's header where that is sticky (a
   tablet 641 to 900 px wide and taller than 700 px): the header lives inside the console, so
   it stays pinned over everything the planner scrolls under, and a heading brought to the top
   edge would be hidden by it. The margin of 16 px the report's own sections use. */
function scrollBelowHeader(node){
  node.scrollIntoView({ block: 'start' });
  const bar = document.querySelector('.bar-top');
  if(bar && global.getComputedStyle(bar).position === 'sticky') global.scrollBy(0, -bar.getBoundingClientRect().height);
}
function closePlanner(){
  if(!S.open) return false;
  S.open = false;
  clearTimeout(S.tFast); clearTimeout(S.tTrial); clearTimeout(S.tSay); cancelIdle();
  const pl = $('planner'), inside = pl.contains(document.activeElement) || document.activeElement === document.body;
  pl.hidden = true;
  document.querySelector('.app').removeAttribute('data-planning');
  $('planopen').setAttribute('aria-expanded', 'false');
  applyMode();                                   // inert off first: an inert opener cannot take focus
  if(inside){
    const back = visibleNode(S.opener) ? S.opener : $('planopen');
    if(visibleNode(back)) back.focus();
  }
  S.opener = null;
  /* what was laid out while the rail was display:none (the sky plot read a width of 0 and used
     its fallback) is laid out again by the page's own debounced resize handler */
  global.dispatchEvent(new Event('resize'));
  return true;
}

/* ---------------------------------------------------------------------------- the Professor on a catalogue spacecraft */

/* SPEC 5.11, D28. The same advisor, run read-only on whatever spacecraft is on screen, in the
   report's own section (#sec-prof, after the Orbital elements): the same five groups and the
   same keyed renderer as the planner's panel (paintGroups, buildItem), so the two cannot drift
   apart in how a note looks. What differs is what it is given and what it may say:
   - the elements are read back from the spacecraft's own two lines (Planner.elementsFromTLE),
     NOT validated: the catalogue holds sets a validator would refuse (2 of the 2,158 have a
     perigee under the ground, 2 an e above 0.9, 1 a |B*| above 0.1) and the Professor is
     there to explain a spacecraft, not to judge its element set;
   - the figures the page measured come from D itself (measuredFromD: the pass finder has
     already run for the console, so nothing is computed twice and the notes cannot disagree
     with the passes table);
   - host 'readonly': no note that talks about what was typed (the ones flagged draftOnly) and
     no fixes, because there is no form to write to; and tracked: a catalogue spacecraft has a
     history-fitted forecast under Orbital decay, which an assumed-drag lifetime here must not
     contradict, so no lifetime figure is worked out and life.tracked points at that section.
   It is a section of the report, so it is hidden for an orbit the reader designed: the planner
   is that orbit's host (load() hides it itself for a custom entry, with the other marks, so a
   fault here cannot leave it showing). It is not built in the assignment snapshot either
   (?tle=embedded): the planner is off there by design (D21), init returns before it is ready, so
   onLoad is a no-op and the section keeps the `hidden` of the markup; what the snapshot computes
   and shows is what it was.

   Off the critical path. load() reaches only roSchedule, which cancels what is pending and
   books one idle callback (a zero timer where there is none): the work is done after load() has
   returned and the frame is drawn, so nothing the console computes or paints waits for it, and
   the gate (which compares what compute() and elements() return) cannot see it. And the WHOLE
   callback is inside a try: it runs after load()'s own try/catch has returned, so an exception in
   it would be an uncaught page error, which every browser suite and verification/snapshot.js
   count as a failure. A failure says so on the console and hides the section: a panel left over
   from the previous spacecraft, under this one's name, would be worse than none. */
const RO_MS = 1000;           // the longest an idle callback may wait: a page that is never idle still gets its notes
const RO = { idle: 0, timer: 0 };
function roCancel(){
  if(RO.idle && global.cancelIdleCallback) global.cancelIdleCallback(RO.idle);
  clearTimeout(RO.timer);
  RO.idle = 0; RO.timer = 0;
}
/* the section and the link to it in the Elements hint go together: a link to a hidden section is a dead one */
function roHide(){
  const s = $('sec-prof'), n = $('rp-nav');
  if(s) s.hidden = true;
  if(n) n.hidden = true;
}
const roTracked = entry => typeof S.host.tracked === 'function' ? !!S.host.tracked(entry) : !entry.custom;
function roBuild(){
  RO.idle = 0; RO.timer = 0;
  try {
    const sec = $('sec-prof'), D = S.host.current();
    if(!sec) return;
    if(!S.ready || S.off || !D || !D.entry || D.entry.custom || !roTracked(D.entry)){ roHide(); return; }
    const o = siteCopy();
    const el = P().elementsFromTLE(D.entry.l1, D.entry.l2, S.host.sat);
    const adv = global.Advisor.advise(el, { nowMs: S.host.now(), site: o, maskDeg: S.host.mask, name: D.entry.name,
      window: { startMs: D.start.getTime(), hours: D.hours }, measured: measuredFromD(D), tracked: true, host: 'readonly', sat: S.host.sat },
      { host: 'readonly' });
    if(!adv.items.length){ roHide(); return; }       // nothing to say about it: no heading over an empty panel
    const nCheck = adv.items.filter(i => i.sev === 'error' || i.sev === 'bad' || i.sev === 'warn').length;
    setText($('rp-title'), AC().ADVISOR_LABEL + ' on ' + D.entry.name);
    setText($('rp-count'), adv.items.length + (adv.items.length === 1 ? ' note' : ' notes') + (nCheck ? ' · ' + nCheck + ' to check' : ''));
    $('rp-verdict').removeAttribute('data-worst');       // the strip names the orbit; the colour of the worst note belongs to a design being judged, and a healthy GEO parked below Bangkok's horizon is not a red one
    setText($('rp-head'), plain(adv.verdict.head));
    setText($('rp-foot'), AC().FOOTER);
    paintGroups(sec, adv.items, o.name, { readonly: true });
    const lk = $('rp-link'), nav = $('rp-nav');
    if(lk) setText(lk, AC().ADVISOR_LABEL);
    sec.hidden = false;
    if(nav) nav.hidden = false;
  } catch(e){
    console.error(e);
    roHide();
  } finally {
    const s = document.getElementById('sec-prof');
    if(s) s.removeAttribute('aria-busy');
  }
}
/* Called by every load(). Cheap by construction: cancel, then either hide (a custom entry, or no
   entry) or book the build. aria-busy says the section is about to change. */
function roSchedule(D){
  roCancel();
  const sec = $('sec-prof');
  if(!sec) return;
  if(!D || !D.entry || D.entry.custom){ sec.removeAttribute('aria-busy'); roHide(); return; }
  sec.setAttribute('aria-busy', 'true');
  if(global.requestIdleCallback) RO.idle = global.requestIdleCallback(roBuild, { timeout: RO_MS });
  else RO.timer = setTimeout(roBuild, 0);
}
/* for tests: the pending build, now */
function roFlush(){
  if(!S.ready || S.off) return false;
  roCancel();
  roBuild();
  return true;
}

/* ---------------------------------------------------------------------------- the page tells us */

/* The page calls this at the end of every load(), inside its own try/catch. Until init has
   succeeded it is a no-op, so the boot load can never reach an uninitialised controller. */
function onLoad(D){
  if(!S.ready || S.off) return;
  try { roSchedule(D); } catch(e){ console.error(e); }   // first, so a fault below cannot leave the previous spacecraft's notes up
  const tip = $('tle-said');
  if(tip && tip.textContent) tip.textContent = '';
  refreshSaved();                               // aria-current, and "the spacecraft on screen"
  if(!S.open || !S.model) return;
  paintEpochNote();
  if(S.meas && S.fr && S.fr.ok){
    let stale = true;
    try { stale = measKey(S.fr.el, S.host.window(), siteCopy()) !== S.meas.key; } catch(e){ stale = true; }
    if(stale){
      S.meas = null;
      S.adv = runAdvise(S.fr);
      renderNotes(false);
      schedule();
    }
  }
  if(!adoptFromD(D)) paintVerdictSub(false);
  paintPrimary();
}

/* ---------------------------------------------------------------------------- init */

const NEED_IDS = ['planner', 'planopen', 'plannote', 'pl-live', 'pl-form', 'pl-name', 'pl-preset', 'pl-preset-note', 'pl-hp', 'pl-ha',
  'pl-a', 'pl-e', 'pl-e-p', 'pl-period', 'pl-inc', 'pl-raan', 'pl-raan-u', 'pl-argp', 'pl-ma', 'pl-epoch', 'pl-epoch-note', 'pl-now',
  'pl-craft', 'pl-craft-note', 'pl-am', 'pl-d-shape', 'pl-d-orient', 'pl-d-drag', 'pl-add', 'pl-savenew', 'pl-reset', 'pl-status',
  'pl-err-form', 'pl-close', 'pf-title', 'pf-count', 'pf-verdict', 'pf-head', 'pf-sub', 'pf-errs', 'pf-empty', 'pf-foot', 'pl-saved-list',
  'pl-saved-count', 'pl-saved-none', 'pl-say'];
const HOST_FNS = ['obs', 'now', 'catalogue', 'customs', 'current', 'window', 'trial', 'add', 'update', 'remove', 'show', 'storageOk', 'entryTle'];

/* the assignment snapshot (?tle=embedded) turns the planner off by design: the pill is there,
   reachable, and says why it does nothing */
function paintPinned(){
  const pill = $('planopen'), note = $('plannote');
  const sentence = 'The orbit planner is off in the assignment snapshot (?tle=embedded).';
  pill.hidden = false;
  pill.setAttribute('aria-disabled', 'true');
  pill.title = sentence;
  note.textContent = '';
  note.appendChild(document.createTextNode(sentence + ' '));
  const a = el('a', null, 'Back to the live element sets');
  a.setAttribute('href', '?');
  note.appendChild(a);
  note.appendChild(document.createTextNode('.'));
  note.hidden = false;
}

function wireField(id, keyOf){
  const inp = $(id);
  inp.setAttribute('data-base', inp.getAttribute('aria-describedby') || '');
  const on = () => {
    if(!S.ready) return;
    ensureModel();
    const key = keyOf();
    S.model[key] = inp.value;                    // as typed: never rewritten under the student's fingers
    onEdited(key, inp);
  };
  inp.addEventListener('input', on);
  inp.addEventListener('change', on);
  inp.addEventListener('blur', () => { if(S.ready) schedule(); });
}
function wire(){
  wireField('pl-name', () => 'name');
  ['hp', 'ha', 'a', 'e', 'period', 'inc', 'argp', 'ma', 'epoch', 'am'].forEach(k => wireField('pl-' + k, () => k));
  wireField('pl-e-p', () => 'e');
  wireField('pl-raan', nodeKey);
  document.querySelectorAll('button[data-shape]').forEach(b => b.addEventListener('click', () => setShape(b.getAttribute('data-shape'))));
  document.querySelectorAll('button[data-node]').forEach(b => b.addEventListener('click', () => setNode(b.getAttribute('data-node'))));
  $('pl-craft').addEventListener('change', onCraft);
  $('pl-preset').addEventListener('change', () => loadPreset($('pl-preset').value));
  $('pl-now').addEventListener('click', onNow);
  $('pl-reset').addEventListener('click', resetForm);
  $('pl-savenew').addEventListener('click', () => commit('new'));
  $('pl-form').addEventListener('submit', e => { e.preventDefault(); commit('primary'); });
  $('pl-close').addEventListener('click', closePlanner);
  $('planopen').addEventListener('click', () => { if(S.open) closePlanner(); else openPlanner({ from: 'pill' }); });
  const cur = from => () => { const D = S.host.current(); if(D && D.entry && D.entry.custom) openPlanner({ from: from, entry: D.entry }); };
  $('customchip').addEventListener('click', cur('chip'));
  $('tle-edit').addEventListener('click', cur('tle'));
  $('tle-copy').addEventListener('click', copyTle);
  /* a group the reader has opened or closed themselves is theirs from then on */
  document.querySelectorAll('details.pf-grp > summary').forEach(s => s.addEventListener('click', () => s.parentNode.setAttribute('data-touched', '1')));
  /* Escape with the focus inside closes it and hands the focus back, as the layers panel does.
     A native <select> popup that has the key keeps it: the browser does not pass it on. */
  $('planner').addEventListener('keydown', e => {
    if(e.key === 'Escape' && !e.defaultPrevented && !e.isComposing){ e.preventDefault(); closePlanner(); }
    else if(e.key === 'Tab' && S.open && mode() === 'sheet') trapTab(e);
  });
  global.addEventListener('gt-customs-changed', () => {
    if(!S.ready) return;
    refreshSaved();
    if(S.editing && !liveEditing()) S.editing = null;
    if(S.open){ paintPrimary(); paintVerdictSub(false); schedule(); }
  });
  const onMq = () => { if(S.ready) applyMode(); };
  S.mqSheet = global.matchMedia(MQ_SHEET);
  if(S.mqSheet.addEventListener) S.mqSheet.addEventListener('change', onMq); else if(S.mqSheet.addListener) S.mqSheet.addListener(onMq);
}
function prepare(){
  paintStatic();
  const sel = $('pl-craft');
  sel.textContent = '';
  P().CRAFTS.forEach(c => { const o = document.createElement('option'); o.value = c.key; o.textContent = c.label; sel.appendChild(o); });
  sel.value = 'typical';
  S.presetVal = 'sso';
  paintEpochNote();
}

/* The hook the tests drive: setModel applies a patch as if it had been typed, flush runs both
   passes now so nothing waits on a timer. */
function exposeHook(){
  const hook = {
    get ADVISOR_LABEL(){ return AC().ADVISOR_LABEL; },
    model(){ ensureModel(); return Object.assign({}, S.model); },
    setModel(patch){
      ensureModel();
      const p = Object.assign({}, patch || {});
      if(p.shape){ setShape(p.shape); delete p.shape; }
      if(p.nodeMode){ setNode(p.nodeMode); delete p.nodeMode; }
      const m = P().patchForm(S.model, p);
      /* as if typed: a text that cannot be read is kept as typed (patchForm leaves the old
         value alone), so the error the student would have seen is the one that shows */
      Object.keys(p).forEach(k => {
        const v = p[k];
        if(typeof v !== 'string' || k === 'name') return;
        const ok = k === 'epoch' ? P().parseEpoch(v).ok : k === 'ltan' ? P().parseLtan(v).ok : P().parseNumber(v).ok;
        if(!ok) m[k] = v;
      });
      S.model = m;
      writeFields();
      clearChanged();
      schedule();
      return Object.assign({}, S.model);
    },
    flush(){ flush(); },
    flushReadOnly(){ return roFlush(); },
    result(){
      const fr = S.fr;
      return { from: S.from, items: S.items.slice(), c: S.adv ? S.adv.c : null, measured: S.meas ? S.meas.value : null,
        ok: !!(fr && fr.ok), el: fr ? fr.el : null, errors: fr ? fr.errors : [], notes: fr ? fr.notes : [], advice: S.adv };
    },
    advise(){ return S.adv; },
    items(){ return S.items.slice(); },
    get presets(){ return P().presets(S.host.obs(), floorSecond(S.host.now())); },
    saved(){ return S.host.customs().map(e => ({ cid: e.cid, name: e.name, el: e.el, current: !!(S.host.current() && S.host.current().entry === e) })); },
    open(o){ return openPlanner(o); },
    close(){ return closePlanner(); },
    mode: mode
  };
  global.__planner = hook;
}

/* Wire the markup index.html holds. False, and the planner stays hidden, when a module or a
   piece of the page is missing or the planner is off by design (the assignment snapshot);
   an exception anywhere in here is logged and gives false, never a page error. */
function init(host){
  if(S.ready) return true;
  try {
    if(typeof document === 'undefined' || S.dead) return false;
    if(!global.Planner || !global.Advisor || !global.AdvisorCopy || !global.Lifetime) return false;
    if(!host || HOST_FNS.some(k => typeof host[k] !== 'function') || !host.sat || typeof host.mask !== 'number'){
      console.error('PlannerUI.init: the host is incomplete');
      return false;
    }
    const missing = NEED_IDS.filter(id => !$(id));
    if(missing.length){ console.error('PlannerUI.init: the page has no #' + missing.join(', #')); return false; }
    S.host = host;
    if(host.pinned){ S.off = true; paintPinned(); return false; }
    prepare();
    wire();
    S.ready = true;
    exposeHook();
    refreshSaved();
    $('planopen').hidden = false;
    /* the boot load ran before this and reached a no-op onLoad: the spacecraft already on screen
       gets its notes now (the same booking every later load makes) */
    try { roSchedule(host.current()); } catch(e){ console.error(e); }
    return true;
  } catch(e){
    console.error(e);
    S.ready = false; S.dead = true;
    try { $('planopen').hidden = true; $('planner').hidden = true; } catch(err){ /* nothing to hide */ }
    return false;
  }
}

const PlannerUI = {
  init: init,
  open: openPlanner,
  close: closePlanner,
  isOpen: () => S.open,
  enabled: () => S.ready && !S.off,
  onLoad: onLoad,
  refreshSaved: refreshSaved
};
return PlannerUI;
}
