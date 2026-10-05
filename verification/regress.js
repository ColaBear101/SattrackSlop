/* regress.js - take the measurements again and assert nothing moved.
 *
 * The gate for the body-agnostic refactor, and now for the rewrite. Exit 0 means the Earth console
 * computes byte-for-byte what it computed before; anything else is a diff to explain, and the default
 * assumption is that it is a bug rather than an improvement.
 *
 *   node verification/regress.js            compare the chosen target against baseline.json
 *   node verification/regress.js --tol 1e-9 allow a relative tolerance
 *
 *   GT_TARGET=legacy|new   which build is judged (default legacy while the rewrite is in progress)
 *
 * The tolerance flag exists for one legitimate case: if a later phase deliberately replaces
 * satellite.js's geodetic maths with a generalised version, the result will differ in the last bits.
 * That is a change to be argued for explicitly and measured, never one to wave through - so it has to
 * be typed on the command line, and the report always prints the worst offender so the size of the
 * change is visible. The rewrite does not use it.
 *
 * Unlike the version this replaced, nothing here copies another script, rewrites its source text, or
 * writes next to baseline.json: the measurements come from snapshot.js in memory, so a failing run
 * cannot overwrite the very baseline it is being judged against.
 */
'use strict';
const fs = require('fs');
const { measure, BASELINE } = require('./snapshot');

const argTarget = process.argv.indexOf('--target');
if (argTarget >= 0) process.env.GT_TARGET = process.argv[argTarget + 1];
const argTol = process.argv.indexOf('--tol');
const TOL = argTol >= 0 ? parseFloat(process.argv[argTol + 1]) : 0;
/* --mode page (default): the shipping build in a real browser, the authoritative gate.
   --mode lib: the library bundle (`npm run build:shims`) in a blank Chromium page, seconds, the fast
   pre-gate - exact, because it runs in the same engine that made the baseline (see snapshot.js). */
const argMode = process.argv.indexOf('--mode');
const MODE = argMode >= 0 ? process.argv[argMode + 1] : 'page';
if (MODE !== 'page' && MODE !== 'lib') { console.error('--mode must be page or lib'); process.exit(2); }

(async () => {
  if (!fs.existsSync(BASELINE)) {
    console.error('no baseline.json - it is written only from the legacy page: GT_TARGET=legacy node verification/snapshot.js --write-baseline');
    process.exit(2);
  }
  let run;
  try { run = await measure({ mode: MODE }); }
  catch (e) { console.error('snapshot run failed: ' + (e && e.stack || e)); process.exit(2); }
  if (run.errs.length) { console.error('page errors during snapshot:\n  ' + run.errs.join('\n  ')); process.exit(2); }

  const a = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const b = JSON.parse(JSON.stringify(run.result));
  delete a.meta.written; delete b.meta.written;

  const diffs = [];
  let worst = { rel: 0 };
  let compared = 0;

  function walk(x, y, p) {
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
      if (!(k in x)) { diffs.push({ p: p + '.' + k, x: '(absent)', y: y[k] }); continue; }
      if (!(k in y)) { diffs.push({ p: p + '.' + k, x: x[k], y: '(absent)' }); continue; }
      walk(x[k], y[k], p + '.' + k);
    }
  }
  walk(a, b, '');

  console.log('\ntarget: ' + run.target);
  console.log('compared ' + compared.toLocaleString('en-US') + ' values against the pre-refactor baseline');
  if (TOL > 0) console.log('tolerance: ' + TOL + ' relative');

  if (!diffs.length) {
    if (worst.rel > 0)
      console.log('largest difference within tolerance: ' + worst.rel.toExponential(2) +
                  ' at ' + worst.p + '  (' + worst.x + ' -> ' + worst.y + ')');
    else
      console.log('BIT-IDENTICAL - every value matches exactly.');
    process.exit(0);
  }

  console.log('\n' + diffs.length + ' DIFFERENCE' + (diffs.length === 1 ? '' : 'S') + ':\n');
  for (const d of diffs.slice(0, 40)) {
    console.log('  ' + d.p);
    console.log('      was ' + d.x);
    console.log('      now ' + d.y + (d.rel != null ? '   (relative ' + d.rel.toExponential(2) + ')' : ''));
  }
  if (diffs.length > 40) console.log('  ... and ' + (diffs.length - 40) + ' more');
  console.log('\nworst relative change: ' + worst.rel.toExponential(2) + ' at ' + worst.p);
  process.exit(1);
})();
