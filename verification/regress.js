/* regress.js — re-run the snapshot and assert nothing moved.
 *
 * The gate for the body-agnostic refactor. Exit 0 means the Earth console
 * computes byte-for-byte what it computed before; anything else is a diff to
 * explain, and the default assumption is that it is a bug rather than an
 * improvement.
 *
 *   node verification/regress.js            compare against baseline.json
 *   node verification/regress.js --tol 1e-9 allow a relative tolerance
 *
 * The tolerance flag exists for one legitimate case: if a later phase
 * deliberately replaces satellite.js's geodetic maths with a generalised
 * version, the result will differ in the last bits. That is a change to be
 * argued for explicitly and measured, never one to wave through — so it has to
 * be typed on the command line, and the report always prints the worst
 * offender so the size of the change is visible.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, 'baseline.json');
const TMP  = path.join(__dirname, '.regress-current.json');

const argTol = process.argv.indexOf('--tol');
const TOL = argTol >= 0 ? parseFloat(process.argv[argTol + 1]) : 0;

if (!fs.existsSync(BASE)) {
  console.error('no baseline.json — run: node verification/snapshot.js');
  process.exit(2);
}

/* Re-run snapshot.js, but write somewhere else so a failing run cannot
   overwrite the very baseline it is being judged against. */
const snap = fs.readFileSync(path.join(__dirname, 'snapshot.js'), 'utf8')
  .replace("const OUT  = path.join(__dirname, 'baseline.json');",
           "const OUT  = path.join(__dirname, '.regress-current.json');");
fs.writeFileSync(path.join(__dirname, '.regress-snap.js'), snap);
try {
  execFileSync(process.execPath, [path.join(__dirname, '.regress-snap.js')],
    { stdio: 'inherit', env: Object.assign({}, process.env,
      { NODE_PATH: 'C:/Users/Lenovo/AppData/Roaming/npm/node_modules' }) });
} catch (e) {
  console.error('snapshot run failed');
  process.exit(2);
} finally {
  try { fs.unlinkSync(path.join(__dirname, '.regress-snap.js')); } catch (e) {}
}

const a = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const b = JSON.parse(fs.readFileSync(TMP, 'utf8'));
delete a.meta.written; delete b.meta.written;

const diffs = [];
let worst = { rel: 0 };
let compared = 0;

function walk(x, y, p){
  if (diffs.length > 400) return;
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
    compared++;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x === y) return;
      const rel = x === 0 ? Math.abs(y) : Math.abs((y - x) / x);
      if (rel > worst.rel) worst = { rel, p, x, y };
      if (rel > TOL) diffs.push({ p, x, y, rel });
      return;
    }
    if (x !== y) diffs.push({ p, x, y, rel: null });
    return;
  }
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) {
    if (!(k in x)) { diffs.push({ p: p+'.'+k, x: '(absent)', y: y[k] }); continue; }
    if (!(k in y)) { diffs.push({ p: p+'.'+k, x: x[k], y: '(absent)' }); continue; }
    walk(x[k], y[k], p + '.' + k);
  }
}
walk(a, b, '');

try { fs.unlinkSync(TMP); } catch (e) {}

console.log('\ncompared ' + compared.toLocaleString('en-US') + ' values against the pre-refactor baseline');
if (TOL > 0) console.log('tolerance: ' + TOL + ' relative');

if (!diffs.length) {
  if (worst.rel > 0)
    console.log('largest difference within tolerance: ' + worst.rel.toExponential(2) +
                ' at ' + worst.p + '  (' + worst.x + ' -> ' + worst.y + ')');
  else
    console.log('BIT-IDENTICAL — every value matches exactly.');
  process.exit(0);
}

console.log('\n' + diffs.length + ' DIFFERENCE' + (diffs.length===1?'':'S') + ':\n');
for (const d of diffs.slice(0, 40)) {
  console.log('  ' + d.p);
  console.log('      was ' + d.x);
  console.log('      now ' + d.y +
    (d.rel != null ? '   (relative ' + d.rel.toExponential(2) + ')' : ''));
}
if (diffs.length > 40) console.log('  … and ' + (diffs.length-40) + ' more');
console.log('\nworst relative change: ' + worst.rel.toExponential(2) + ' at ' + worst.p);
process.exit(1);
