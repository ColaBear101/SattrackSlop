/* run.js - run the suites, stop early only on the numbers, and say what happened to all of them.
 *
 * The old `npm test` was a chain of `&&`: the first failure hid every later stage, and on a day when
 * verify-ar's highest pass is near the zenith that meant layout and planner-ui were never reached.
 * This runs the stages that guard the NUMBERS first and stops there if one fails (nothing else is worth
 * reading while the numbers have moved); then it runs every remaining stage, prints one table, and exits
 * non-zero if any stage failed.
 *
 *   node verification/run.js                       everything
 *   node verification/run.js --only verify,gate    just these
 *   node verification/run.js --skip custom,planner-ui
 *   node verification/run.js --fast                the quick subset (no browser-heavy suites)
 *   GT_TARGET=legacy|new node verification/run.js  which build the browser stages open
 *
 * Output of every stage goes to verification/.logs/<stage>.log; the table shows the last line. A summary
 * is written to verification/last-run.json (HEAD, whether the tree was dirty, per-stage result).
 * Timing-sensitive stages run alone; the other browser stages run two at a time.
 */
'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ROOT = path.join(DIR, '..');
const LOGS = path.join(DIR, '.logs');

/* kind: 'numbers' stops the run on failure; alone = timing-sensitive, never overlapped */
const STAGES = [
  { name: 'verify',      script: 'verify.js',            kind: 'numbers', fast: true },
  { name: 'evec',        script: 'verify-evec.js',       kind: 'numbers', fast: true },
  { name: 'planner',     script: 'verify-planner.js',    kind: 'numbers', fast: true },
  { name: 'gate',        script: 'regress.js',           kind: 'numbers', fast: true },
  { name: 'slice',       script: 'verify-slice.js',      kind: 'numbers', fast: true, target: 'new' },
  { name: 'advisor',     script: 'verify-advisor.js',    alone: true, fast: true },
  /* the report's words against the old page's: five spacecraft that differ in kind, from one site, for a day; the whole matrix
     (38 x 2 spans x 3 sites, ten minutes) is the stage after it */
  { name: 'golden-lite', script: 'golden.js',          fast: true, target: 'new', args: ['--sats', 'KNACKSAT-2;ISS (ZARYA);CLUSTER II-FM8;INTELSAT 10-02;TEN-KOH', '--sites', 'svalbard', '--spans', '24'] },
  { name: 'golden',      script: 'golden.js',           alone: true, target: 'new' },
  { name: 'refresh',     script: 'verify-refresh.js',    alone: true },
  { name: 'refresh-api', script: 'verify-refresh.js',    alone: true, env: { GT_API: 'up' }, target: 'new' },
  { name: 'pov',         script: 'verify-pov.js' },
  { name: 'doppler',     script: 'verify-doppler.js' },
  { name: 'optical',     script: 'verify-optical.js' },
  { name: 'site',        script: 'verify-site.js' },
  { name: 'export',      script: 'verify-export.js' },
  { name: 'catalogue',   script: 'verify-catalogue.js' },
  { name: 'custom',      script: 'verify-custom.js',     alone: true },
  { name: 'timeline',    script: 'verify-timeline.js' },
  { name: 'elements',    script: 'verify-elements.js' },
  { name: 'lifetime',    script: 'verify-lifetime.js' },
  { name: 'ar',          script: 'verify-ar.js',         alone: true },
  { name: 'layout',      script: 'verify-layout.js',     alone: true },
  { name: 'planner-ui',  script: 'verify-planner-ui.js', alone: true }
];

const argv = process.argv.slice(2);
const list = n => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] || '').split(',').filter(Boolean) : null; };
/* --target legacy|new overrides GT_TARGET for every stage (children inherit the environment) */
const argTarget = argv.indexOf('--target');
if (argTarget >= 0) process.env.GT_TARGET = argv[argTarget + 1];
const only = list('--only'), skip = list('--skip') || [];
const TARGET = process.env.GT_TARGET || 'legacy';
let stages = STAGES.filter(s => (!only || only.includes(s.name)) && !skip.includes(s.name) && (!s.target || s.target === TARGET));
if (argv.includes('--fast')) stages = stages.filter(s => s.fast);
for (const n of (only || [])) if (!STAGES.some(s => s.name === n)) { console.error('unknown stage: ' + n); process.exit(2); }

fs.mkdirSync(LOGS, { recursive: true });

function run(stage) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const log = fs.createWriteStream(path.join(LOGS, stage.name + '.log'));
    const child = cp.spawn(process.execPath, [path.join(DIR, stage.script)].concat(stage.args || []), { cwd: ROOT, env: Object.assign({}, process.env, stage.env || {}) });
    let tail = '';
    const take = d => { log.write(d); tail = (tail + d).slice(-4000); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    child.on('close', code => {
      log.end();
      const lines = tail.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      resolve({ name: stage.name, ok: code === 0, code, seconds: (Date.now() - t0) / 1000, last: lines[lines.length - 1] || '' });
    });
    child.on('error', e => resolve({ name: stage.name, ok: false, code: -1, seconds: (Date.now() - t0) / 1000, last: String(e) }));
  });
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function report(results, stopped) {
  console.log('\n' + pad('stage', 12) + pad('result', 8) + pad('seconds', 9) + 'last line');
  console.log('-'.repeat(78));
  for (const r of results) console.log(pad(r.name, 12) + pad(r.ok ? 'pass' : 'FAIL', 8) + pad(r.seconds.toFixed(1), 9) + r.last.slice(0, 80));
  const failed = results.filter(r => !r.ok);
  console.log('-'.repeat(78));
  console.log(stopped ? 'STOPPED after a failure in the numbers: ' + stopped
                      : failed.length ? failed.length + ' of ' + results.length + ' stages FAILED: ' + failed.map(r => r.name).join(', ')
                                      : 'all ' + results.length + ' stages passed');
  let head = '', dirty = null;
  try { head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
        dirty = cp.execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0; } catch (e) { /* no git */ }
  fs.writeFileSync(path.join(DIR, 'last-run.json'), JSON.stringify({
    when: new Date().toISOString(), head, dirty, target: process.env.GT_TARGET || 'legacy', stopped: stopped || null,
    stages: results.map(r => ({ name: r.name, ok: r.ok, seconds: +r.seconds.toFixed(1), last: r.last }))
  }, null, 2));
  return failed.length === 0 && !stopped;
}

(async () => {
  console.log('target: ' + (process.env.GT_TARGET || 'legacy') + '   stages: ' + stages.map(s => s.name).join(', '));
  const results = [];
  /* 1. the numbers, in order, fail fast */
  for (const s of stages.filter(s => s.kind === 'numbers')) {
    process.stdout.write('  running ' + s.name + ' ... ');
    const r = await run(s); results.push(r);
    console.log(r.ok ? 'pass (' + r.seconds.toFixed(1) + ' s)' : 'FAIL');
    if (!r.ok) process.exit(report(results, s.name) ? 0 : 1);
  }
  /* 2. everything else: timing-sensitive stages alone, the rest two at a time */
  const rest = stages.filter(s => s.kind !== 'numbers');
  const parallel = rest.filter(s => !s.alone), alone = rest.filter(s => s.alone);
  for (const s of alone) {
    process.stdout.write('  running ' + s.name + ' ... ');
    const r = await run(s); results.push(r);
    console.log(r.ok ? 'pass (' + r.seconds.toFixed(1) + ' s)' : 'FAIL');
  }
  const queue = parallel.slice();
  async function worker() {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const r = await run(s); results.push(r);
      console.log('  ' + s.name + ': ' + (r.ok ? 'pass (' + r.seconds.toFixed(1) + ' s)' : 'FAIL'));
    }
  }
  await Promise.all([worker(), worker()]);
  const order = new Map(STAGES.map((s, i) => [s.name, i]));
  results.sort((a, b) => order.get(a.name) - order.get(b.name));
  process.exit(report(results, null) ? 0 : 1);
})();
