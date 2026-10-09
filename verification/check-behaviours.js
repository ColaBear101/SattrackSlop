/*
 * Does verification/behaviours.json still say what verify-planner-ui.js says?
 *
 * The file is the traceability of the orbit planner's seventy behaviours (SPEC 7.5): for each number, what it promises, the groups of the
 * suite that check it, the checks (or Vitest tests) that cover it, what kind of promise it is, and what the port to the rebuilt page did
 * to it. A map that is not read rots, so this reads it:
 *   - the numbers 1 to 70 each appear exactly once, every entry has its fields, its class and port are from the lists below;
 *   - every covering reference resolves: "verify-planner-ui g<N> check <text>" is a check of the suite in group N whose name contains the
 *     text (where a name is put together at run time the part that varies is written <...>, as the suite's own call reads),
 *     "tests/<file> <test name>" is a Vitest test by its title, "not applicable: <why>" says why a mechanism cannot exist;
 *   - every check of the suite whose name starts with behaviour numbers is listed by each of them (a check added to the suite shows up here
 *     until the map says so), and every other check is one of the few that belong to no behaviour (the group's "no page error", the boot
 *     gate, the "page did not answer" report, the visual rhythm of the Professor and the saved list, the closing coverage report);
 *   - `groups` is the groups of the references.
 *
 *   node verification/check-behaviours.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const suite = fs.readFileSync(path.join(__dirname, 'verify-planner-ui.js'), 'utf8').replace(/\r\n/g, '\n');
const BS = String.fromCharCode(92);
const unescape = s => s.split(BS + "'").join("'").split(BS + '"').join('"').split(BS + '`').join('`').split(BS + BS).join(BS);

/* the suite, group by group: the text between one "// ---- N." heading and the next */
const heads = [...suite.matchAll(/^  \/\/ ---- (\d+)\. /gm)].map(m => ({ g: +m[1], at: m.index }));
const groupAt = at => { let g = null; for (const h of heads) if (h.at <= at) g = h.g; return g; };

/* The name of a check as written at a chk( call: the first argument, its string pieces joined and every other term "<...>". */
function nameAt(s) {
  let i = 0, depth = 0, cur = '', terms = [], lit = null;
  const push = () => { if (cur.trim() !== '' || lit !== null) terms.push(lit !== null && cur.trim() === '' ? lit : '<...>'); cur = ''; lit = null; };
  s = s.slice(s.indexOf('(') + 1);
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\'' || c === '`' || c === '"') {
      let j = i + 1, body = '';
      while (j < s.length && s[j] !== c) { if (s[j] === BS) { body += s[j + 1]; j += 2; continue; } body += s[j++]; }
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

/* every chk( call of the suite: its group, its name, the behaviour numbers its label starts with */
const sites = [];
for (const m of suite.matchAll(/\bchk\(/g)) {
  const name = nameAt(suite.slice(m.index)), lab = /^(\d+(?:[\/,]\d+)*) /.exec(name);
  sites.push({ g: groupAt(m.index), name, nums: lab ? lab[1].split(/[\/,]/).map(Number) : [] });
}
/* the checks that are no behaviour's */
const UNNUMBERED = [/^the page did not answer: /, /^the page boots to a loaded analysis/, /^visual: the Professor and the saved list/, /^every one of the 70 behaviours/];
const isMeta = s => / no page error$/.test(s.name) || (!s.nums.length && UNNUMBERED.some(r => r.test(s.name)));

const testSrc = {};
const readTest = f => testSrc[f] ??= (fs.existsSync(path.join(ROOT, 'tests', f)) ? unescape(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8')) : null);

function resolves(ref) {
  let m = /^verify-planner-ui g(\d+) check (.+)$/s.exec(ref);
  if (m) {
    const g = +m[1];
    if (!heads.some(h => h.g === g)) return 'no group ' + g;
    return sites.some(s => s.g === g && s.name.includes(m[2])) ? null : 'no check with that text in group ' + g;
  }
  m = /^tests\/(\S+\.test\.ts) (.+)$/s.exec(ref);
  if (m) {
    const s = readTest(m[1]);
    if (s === null) return 'no such test file';
    for (const p of m[2].split(' > ')) if (!s.includes(p)) return 'no test or group titled "' + p.slice(0, 60) + '" in ' + m[1];
    return null;
  }
  if (/^not applicable: \S/.test(ref)) return null;
  return 'a reference is "verify-planner-ui g<N> check <text>", "tests/<file> <test name>" or "not applicable: <why>"';
}

if (require.main === module) {
  const J = JSON.parse(fs.readFileSync(path.join(__dirname, 'behaviours.json'), 'utf8'));
  let bad = 0;
  const fail = msg => { bad++; console.log('  FAIL  ' + msg); };
  const CLASSES = ['product', 'structure', 'layout', 'fault-injection'], PORTS = ['as-is', 'helper', 'retarget', 'replaced'];
  if (!Array.isArray(J)) { fail('the file is not an array'); process.exit(1); }
  const have = new Map();
  for (const e of J) {
    if (!Number.isInteger(e.n) || e.n < 1 || e.n > 70) { fail('an entry with n = ' + e.n); continue; }
    if (have.has(e.n)) fail(e.n + ': twice');
    have.set(e.n, e);
    const w = e.n + ': ';
    if (typeof e.behaviour !== 'string' || e.behaviour.length < 20) fail(w + 'no behaviour');
    if (!Array.isArray(e.class) || !e.class.length || !e.class.every(c => CLASSES.includes(c))) fail(w + 'class is a list of ' + CLASSES.join(', '));
    if (!PORTS.includes(e.port)) fail(w + 'port is one of ' + PORTS.join(', '));
    if (!Array.isArray(e.covering) || !e.covering.length) { fail(w + 'nothing covers it'); continue; }
    const gs = new Set();
    for (const ref of e.covering) {
      const why = resolves(ref);
      if (why) fail(w + why + '   [' + ref.slice(0, 120) + ']');
      const g = /^verify-planner-ui g(\d+) /.exec(ref);
      if (g) gs.add(+g[1]);
    }
    if (JSON.stringify([...gs].sort((a, b) => a - b)) !== JSON.stringify(e.groups)) fail(w + 'groups should be ' + JSON.stringify([...gs].sort((a, b) => a - b)) + ' (the groups of its references), not ' + JSON.stringify(e.groups));
    if (e.port !== 'as-is' && !e.note) fail(w + 'a behaviour the port touched says what it did (note)');
  }
  for (let n = 1; n <= 70; n++) if (!have.has(n)) fail(n + ': missing');
  /* a check that names a behaviour is listed under it; one that names none is one of the few that belong to no behaviour */
  let listed = 0;
  for (const s of sites) {
    if (isMeta(s)) continue;
    if (!s.nums.length) { fail('a check no behaviour owns, and not one of the unnumbered ones: ' + s.name.slice(0, 90)); continue; }
    for (const n of s.nums) {
      const e = have.get(n);
      if (!e) continue;
      const pre = 'verify-planner-ui g' + s.g + ' check ';
      if (e.covering.some(r => r.startsWith(pre) && s.name.includes(r.slice(pre.length)))) listed++;
      else fail('g' + s.g + ' has a check that names behaviour ' + n + ' and the map does not list it: ' + s.name.slice(0, 90));
    }
  }
  const refs = J.reduce((n, e) => n + (e.covering ? e.covering.length : 0), 0);
  console.log(J.length + ' behaviours, ' + refs + ' references, ' + sites.length + ' checks in the suite (' + sites.filter(isMeta).length + ' that belong to no behaviour), ' + listed + ' check-to-behaviour links, ' +
    J.filter(e => e.port === 'as-is').length + ' ported as they were, ' + J.filter(e => e.port === 'helper').length + ' through a helper, ' + J.filter(e => e.port === 'retarget').length + ' retargeted, ' + J.filter(e => e.port === 'replaced').length + ' with the mechanism replaced');
  console.log(bad ? bad + ' PROBLEM(S)' : 'THE MAP RESOLVES');
  process.exit(bad ? 1 : 0);
}
module.exports = { sites, resolves };
