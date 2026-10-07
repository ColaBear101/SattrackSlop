/*
 * Does verification/behaviours-custom.json still say what the suites say?
 *
 * The file maps each of the 79 mutants of verify-custom-mutants.js (and its 3 equivalents) and each of the 24 groups of verify-custom.js to
 * the check or the test that guards the same behaviour in the rebuilt page. A map that is not read rots, so this reads it: every
 * reference must resolve (a check of the suite by its text, in the group named; a Vitest test by its it() title in the file named), every
 * mutant and every group must have an entry with something covering it, and every group's list must be exactly the checks that group has.
 *
 * A reference to a check is "verify-custom g<N> check <text>". The text is the check's name as the suite writes it, where a name is put
 * together at run time (a loop over the modules, the stored records, the steps) the part that varies is written <...>; a reference may
 * name just a stretch of the fixed part, and may end with " [with <value>]" for the one case of a loop it is about, which must appear in
 * the group's source.
 *
 *   node verification/check-behaviours-custom.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const suite = fs.readFileSync(path.join(__dirname, 'verify-custom.js'), 'utf8');
const unescape = s => s.replace(/\\(['"`\\])/g, '$1');

/* the suite, group by group: the text between one "// ---- N." heading and the next */
const heads = [...suite.matchAll(/^  \/\/ ---- (\d+)\. /gm)].map(m => ({ g: +m[1], at: m.index }));
function region(g) {
  const i = heads.findIndex(h => h.g === g);
  return i < 0 ? null : suite.slice(heads[i].at, i + 1 < heads.length ? heads[i + 1].at : suite.length);
}

/* The name of a check as written at a chk( call: the first argument, its string pieces joined and every other term "<...>". */
function nameAt(s) {
  let i = 0, depth = 0, cur = '', terms = [], lit = null;
  const push = () => { if (cur.trim() !== '' || lit !== null) terms.push(lit !== null && cur.trim() === '' ? lit : '<...>'); cur = ''; lit = null; };
  s = s.slice(s.indexOf('(') + 1);
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\'' || c === '`' || c === '"') {
      let j = i + 1, body = '';
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') { body += s[j + 1]; j += 2; continue; } body += s[j++]; }
      if (depth === 0 && cur.trim() === '' && lit === null && !(c === '`' && body.includes('${'))) lit = body; else cur += 'x';
      i = j; continue;
    }
    if ('([{'.includes(c)) { depth++; cur += c; continue; }
    if (')]}'.includes(c)) { if (depth === 0) break; depth--; cur += c; continue; }
    if (depth === 0 && c === ',') break;
    if (depth === 0 && c === '+') { push(); continue; }
    if (!/\s/.test(c)) cur += c;
  }
  push();
  return terms.join('').replace(/(<\.\.\.>)+/g, '<...>');
}
function checksOf(g) {
  const r = region(g), out = [];
  for (const m of r.matchAll(/\bchk\(/g)) { const n = nameAt(r.slice(m.index)); if (n && !out.includes(n)) out.push(n); }
  return out;
}

const testSrc = {};
const readTest = f => testSrc[f] ??= (fs.existsSync(path.join(ROOT, 'tests', f)) ? unescape(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8')) : null);

function resolves(ref) {
  let m = /^verify-custom g(\d+) check (.+)$/s.exec(ref);
  if (m) {
    const g = +m[1], r = region(g);
    if (r === null) return 'no group ' + g;
    let text = m[2], withv = null;
    const w = /^(.*) \[with (.+)\]$/s.exec(text);
    if (w) { text = w[1]; withv = w[2]; }
    if (!checksOf(g).some(n => n.includes(text))) return 'no check with that text in group ' + g;
    if (withv !== null && !unescape(r).includes(withv)) return 'group ' + g + ' does not have "' + withv + '" in it';
    return null;
  }
  m = /^tests\/(\S+\.test\.ts) (.+)$/s.exec(ref);
  if (m) {
    const s = readTest(m[1]);
    if (s === null) return 'no such test file';
    for (const p of m[2].split(' > ')) if (!s.includes(p)) return 'no test or group titled "' + p.slice(0, 60) + '" in ' + m[1];
    return null;
  }
  if (/^not applicable: \S/.test(ref)) return null;
  return 'a reference is "verify-custom g<N> check <text>", "tests/<file> <test name>" or "not applicable: <why>"';
}

if (require.main === module) {
  const J = JSON.parse(fs.readFileSync(path.join(__dirname, 'behaviours-custom.json'), 'utf8'));
  let bad = 0;
  const fail = msg => { bad++; console.log('  FAIL  ' + msg); };
  const want = [];
  for (let n = 1; n <= 79; n++) want.push('m' + String(n).padStart(2, '0'));
  want.push('e1', 'e2', 'e3');
  for (let g = 1; g <= 24; g++) want.push('g' + g);
  const have = new Map();
  for (const e of J.entries) {
    if (have.has(e.id)) fail(e.id + ': twice');
    have.set(e.id, e);
    if (typeof e.intent !== 'string' || e.intent.length < 20) fail(e.id + ': no intent');
    if (!Array.isArray(e.covering) || !e.covering.length) fail(e.id + ': nothing covers it');
    for (const ref of e.covering || []) { const why = resolves(ref); if (why) fail(e.id + ': ' + why + '   [' + ref.slice(0, 120) + ']'); }
  }
  for (const id of want) if (!have.has(id)) fail(id + ': missing');
  for (const id of have.keys()) if (!want.includes(id)) fail(id + ': not a mutant or a group');
  /* a group's list is the checks that group has: a check added to the suite shows up here until the map says so */
  for (let g = 1; g <= 24; g++) {
    const e = have.get('g' + g);
    if (!e) continue;
    const pre = 'verify-custom g' + g + ' check ';
    const listed = e.covering.filter(r => r.startsWith(pre)).map(r => r.slice(pre.length));
    const real = checksOf(g);
    for (const l of real) if (!listed.includes(l)) fail('g' + g + ': the suite has a check the map does not list: ' + l.slice(0, 90));
    for (const l of listed) if (!real.includes(l)) fail('g' + g + ': the map lists a check the suite does not have: ' + l.slice(0, 90));
  }
  const mut = J.entries.filter(e => /^[me]/.test(e.id)), grp = J.entries.filter(e => /^g/.test(e.id));
  console.log(mut.length + ' mutants (' + mut.filter(e => e.covering.some(r => r.startsWith('not applicable'))).length + ' with a part that cannot exist in the rebuilt page), ' + grp.length + ' groups, ' +
    J.entries.reduce((n, e) => n + e.covering.length, 0) + ' references');
  console.log(bad ? bad + ' PROBLEM(S)' : 'THE MAP RESOLVES');
  process.exit(bad ? 1 : 0);
}
module.exports = { checksOf, resolves };
