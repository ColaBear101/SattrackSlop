/*
 * Does verify-custom.js notice when a guard of the REBUILT page is taken away?
 *
 * A check that cannot fail is not a check. This takes ONE guard out of a scratch copy of the page's source (verification/mutants-new.json:
 * one exact-text edit of one file under src/), builds that copy with vite, runs verify-custom.js against the build on the groups that were
 * written to catch it, and says whether a check died (CAUGHT, and which) or the suite let it through (SURVIVED). A survivor that is not
 * marked equivalent is a gap in the suite: fix the suite, not the list. A mutant marked equivalent is a guard nothing in the page can
 * reach (a second layer behind a first that is itself tested); it is run too and is expected to SURVIVE, and one that dies is a finding.
 *
 * For every mutant, a scratch folder is made under the temp directory with a copy of src/, shared/, data/, public/ and the build configs and a
 * link to the shared node_modules; the mutant is applied to the COPY; the build goes to a folder inside it; the folder is deleted when the
 * mutant is done (the link first, on its own, so that nothing can ever delete through it). Nothing is written in the repository or in dist/,
 * dist-c/ or dist-u/. (Chromium and the suite's downloads go to the temp directory as they always do.)
 *
 *   node verification/mutate-new.js --list                 every mutant, its groups, and whether its anchor still matches exactly once (no build)
 *   node verification/mutate-new.js                        all of them, one at a time (a mutant is a build and a browser: 25 s on average, 10 s to 1.5 minutes; the whole
 *                                                          list is about 36 minutes at one job, about 20 at two)
 *   node verification/mutate-new.js --only m01,g5-list-html   just these
 *   node verification/mutate-new.js --jobs 2               two at a time (each is a build and a Chromium: the suite's time budgets are for a quiet machine)
 *   node verification/mutate-new.js --full                 a mutant that survives the groups meant to catch it is then run against every group, to say
 *                                                          where else it is caught (a survivor of the groups is still reported as SURVIVED)
 *   node verification/mutate-new.js --keep                 leave each scratch folder where it is (its path is printed), for looking at a mutant by hand
 *   npm run mutate -- --only m01                           the same, through npm
 *
 * Exit status: 0 when every mutant that is not equivalent is caught and every equivalent one survived; 1 otherwise (a survivor, an equivalent that
 * died, an anchor that does not match exactly once, a build that failed, a run that timed out).
 *
 * "Caught" prints the check that died first. Read it: a check that dies of a time budget on a loaded machine (a "fast" or "under N s" check)
 * would say CAUGHT for the wrong reason, and a mutant whose groups were chosen for a behaviour should be caught by a check about that behaviour.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SUITE = path.join(__dirname, 'verify-custom.js');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const COPY_DIRS = ['src', 'shared', 'data', 'public'];
const COPY_FILES = ['index.html', 'vite.config.ts', 'svelte.config.js', 'tsconfig.json', 'package.json'];
const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const BUILD_TIMEOUT_MS = 5 * 60 * 1000;

/* ---- arguments ------------------------------------------------------------------------------------------------ */
const argv = process.argv.slice(2);
const FLAGS = new Set(['--list', '--full', '--keep']);
const OPTS = new Set(['--only', '--jobs']);
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (FLAGS.has(a)) opts[a] = true;
  else if (OPTS.has(a)) { opts[a] = argv[++i]; if (opts[a] === undefined) die('missing a value after ' + a); }
  else die('unknown argument ' + a + '\n  usage: node verification/mutate-new.js [--list] [--only id,id] [--jobs N] [--full] [--keep]');
}
function die(msg) { console.error(msg); process.exit(2); }

/* ---- the list ------------------------------------------------------------------------------------------------- */
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'mutants-new.json'), 'utf8'));
const MUTANTS = raw.mutants;

function problems(list) {
  const out = [], ids = new Set();
  for (const m of list) {
    const at = (m && m.id) || '?';
    if (!m || typeof m.id !== 'string' || !m.id) { out.push(at + ': no id'); continue; }
    if (ids.has(m.id)) out.push(m.id + ': listed twice');
    ids.add(m.id);
    if (typeof m.intent !== 'string' || m.intent.length < 15) out.push(m.id + ': no intent');
    if (typeof m.file !== 'string' || !m.file) out.push(m.id + ': no file');
    if (typeof m.find !== 'string' || !m.find) out.push(m.id + ': no find text');
    if (typeof m.replace !== 'string') out.push(m.id + ': no replacement');
    if (m.find === m.replace) out.push(m.id + ': the replacement is the find text');
    if (!Array.isArray(m.groups) || !m.groups.length || !m.groups.every(g => Number.isInteger(g) && g >= 1 && g <= 24)) out.push(m.id + ': groups must be a list of group numbers (1-24)');
    if (m.equivalent && (typeof m.reason !== 'string' || m.reason.length < 15)) out.push(m.id + ': an equivalent mutant needs its reason');
    if (typeof m.file === 'string' && (path.isAbsolute(m.file) || m.file.split(/[\\/]/).includes('..'))) out.push(m.id + ': the file is a path under src/');
  }
  return out;
}
/** How many times the find text occurs in the file of the real tree (read only). */
function occurrences(m) {
  const p = path.join(SRC, m.file);
  if (!fs.existsSync(p)) return -1;
  return fs.readFileSync(p, 'utf8').split(m.find).length - 1;
}

/* ---- the scratch copy ----------------------------------------------------------------------------------------- */
function makeScratch() {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tmp, 'gt-mutate-'));
  if (dir === ROOT || dir.startsWith(ROOT + path.sep)) throw new Error('the scratch folder ' + dir + ' is inside the repository');
  for (const d of COPY_DIRS) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  for (const f of COPY_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  return dir;
}
/** Delete a scratch folder. The link to node_modules goes first and alone; only when it is gone, and the real node_modules is still there, does
 *  anything delete recursively. If the link cannot be removed the folder is left (and said), never deleted through it. */
function removeScratch(dir) {
  const link = path.join(dir, 'node_modules');
  try {
    let st = null;
    try { st = fs.lstatSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (st) { try { fs.unlinkSync(link); } catch (e) { fs.rmdirSync(link); } }
    if (fs.existsSync(link)) throw new Error('the link is still there');
    if (!fs.existsSync(path.join(ROOT, 'node_modules', 'vite', 'package.json'))) throw new Error('the real node_modules is not there any more: nothing more is deleted');
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    console.log('  (scratch folder left at ' + dir + ': ' + e.message + ')');
  }
}

/* ---- running things ------------------------------------------------------------------------------------------- */
function run(cmd, args, o) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = cp.spawn(cmd, args, { cwd: o.cwd, env: o.env || process.env, windowsHide: true });
    let out = '', killed = false;
    const add = d => { out += d; if (out.length > 4e6) out = out.slice(-2e6); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const timer = setTimeout(() => { killed = true; child.kill(); }, o.timeout);
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, out: out + String(e), ms: Date.now() - t0, killed }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - t0, killed }); });
  });
}
const suiteEnv = (dist, groups) => {
  const env = Object.assign({}, process.env, { GT_TARGET: 'new', GT_DIST: dist, CUSTOM_FAILFAST: '1' });
  delete env.GT_URL; delete env.CUSTOM_INDEX_HTML;          // the suite must read the build made here, and nothing else
  if (groups) env.CUSTOM_GROUPS = groups.join(','); else delete env.CUSTOM_GROUPS;
  return env;
};
/** What a run of verify-custom.js says. */
function verdict(r) {
  const ff = /FIRST FAILURE \(CUSTOM_FAILFAST\): (.*)/.exec(r.out);
  if (ff) return { caught: true, by: ff[1].trim() };
  const crash = /SUITE CRASHED: (.*)/.exec(r.out);
  if (crash) return { caught: true, by: 'the suite crashed: ' + crash[1].trim().slice(0, 120) };
  if (r.killed) return { error: 'the run did not finish in ' + RUN_TIMEOUT_MS / 60000 + ' minutes' };
  const pe = /PAGE ERRORS: (\d+) (.*)/.exec(r.out);
  if (/ALL CHECKS PASS/.test(r.out) && !pe && r.code === 0) return { caught: false };
  if (pe) return { caught: true, by: 'a page error: ' + pe[2].trim().slice(0, 120) };
  const fail = /^  FAIL  (.*)$/m.exec(r.out);
  if (fail) return { caught: true, by: fail[1].trim() };
  return { error: 'the suite said nothing it can be read by (exit ' + r.code + '): ' + r.out.trim().split('\n').slice(-3).join(' | ').slice(0, 200) };
}

async function one(m) {
  const res = { id: m.id, groups: m.groups, equivalent: !!m.equivalent };
  const n = occurrences(m);
  if (n !== 1) return Object.assign(res, { status: 'ERROR', note: 'ANCHOR ' + (n < 0 ? 'FILE MISSING' : n === 0 ? 'MISSING' : 'AMBIGUOUS (' + n + ')') + ' in src/' + m.file });
  let dir = null;
  try {
    dir = makeScratch();
    const target = path.join(dir, 'src', m.file);
    const text = fs.readFileSync(target, 'utf8');
    if (text.split(m.find).length - 1 !== 1) return Object.assign(res, { status: 'ERROR', note: 'ANCHOR does not match exactly once in the copy' });
    fs.writeFileSync(target, text.replace(m.find, () => m.replace));
    const out = path.join(dir, 'out');
    const b = await run(process.execPath, [VITE, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error', '--configLoader', 'runner'], { cwd: dir, timeout: BUILD_TIMEOUT_MS });
    res.buildMs = b.ms;
    if (b.code !== 0 || !fs.existsSync(path.join(out, 'index.html'))) return Object.assign(res, { status: 'ERROR', note: 'BUILD FAILED: ' + b.out.trim().split('\n').slice(-4).join(' | ').slice(0, 300) });
    let r = await run(process.execPath, [SUITE], { cwd: ROOT, env: suiteEnv(out, m.groups), timeout: RUN_TIMEOUT_MS });
    res.runMs = r.ms;
    let v = verdict(r);
    if (v.error) return Object.assign(res, { status: 'ERROR', note: v.error });
    if (!v.caught && opts['--full']) {
      const r2 = await run(process.execPath, [SUITE], { cwd: ROOT, env: suiteEnv(out, null), timeout: RUN_TIMEOUT_MS });
      res.runMs += r2.ms;
      const v2 = verdict(r2);
      if (v2.error) return Object.assign(res, { status: 'ERROR', note: v2.error });
      if (v2.caught) res.elsewhere = v2.by;
    }
    if (opts['--keep']) { res.kept = dir; dir = null; }
    return Object.assign(res, v.caught ? { status: 'CAUGHT', by: v.by } : { status: 'SURVIVED' });
  } catch (e) {
    return Object.assign(res, { status: 'ERROR', note: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') });
  } finally {
    if (dir) removeScratch(dir);
  }
}

/* ---- main ----------------------------------------------------------------------------------------------------- */
(async () => {
  const bad = problems(MUTANTS);
  if (bad.length) { console.log('mutants-new.json is not well formed:\n  ' + bad.join('\n  ')); process.exit(1); }
  let list = MUTANTS;
  if (opts['--only']) {
    const want = opts['--only'].split(',').map(s => s.trim()).filter(Boolean);
    const unknown = want.filter(id => !MUTANTS.some(m => m.id === id));
    if (unknown.length) die('no such mutant: ' + unknown.join(', ') + '  (--list shows them)');
    list = MUTANTS.filter(m => want.includes(m.id));
  }

  if (opts['--list']) {
    let wrong = 0;
    for (const m of list) {
      const n = occurrences(m);
      if (n !== 1) wrong++;
      console.log((m.id.padEnd(22)) + ' g' + String(m.groups.join(',')).padEnd(8) + (m.equivalent ? ' EQUIVALENT' : '           ') + '  ' + (n === 1 ? 'anchor ok  ' : 'ANCHOR ' + (n < 0 ? 'FILE MISSING' : n === 0 ? 'MISSING' : 'AMBIGUOUS') + '  ') + 'src/' + m.file);
      console.log('      ' + m.intent);
    }
    console.log('\n' + list.length + ' mutants, ' + list.filter(m => m.equivalent).length + ' equivalent, groups covered: ' +
      [...new Set(list.flatMap(m => m.groups))].sort((a, b) => a - b).join(' ') + (wrong ? '\n' + wrong + ' ANCHOR PROBLEM(S): a refactor of src/ has moved a guard; update the find text' : '\nevery anchor matches exactly once'));
    process.exit(wrong ? 1 : 0);
  }

  const jobs = Math.max(1, parseInt(opts['--jobs'] || '1', 10) || 1);
  console.log(list.length + ' mutant(s), ' + jobs + ' at a time. Each is a scratch copy of src/, a vite build, and verify-custom.js on its groups (fail fast).');
  const results = new Array(list.length);
  let next = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      const m = list[i];
      const r = await one(m);
      results[i] = r;
      done++;
      const secs = x => x === undefined ? '' : Math.round(x / 1000) + 's';
      console.log('[' + done + '/' + list.length + '] ' + r.id.padEnd(22) + ' ' + r.status.padEnd(8) + ' g' + r.groups.join(',') + (r.equivalent ? ' (equivalent)' : '') + '  ' +
        (r.status === 'CAUGHT' ? 'by: ' + r.by.slice(0, 170) : r.status === 'SURVIVED' ? (r.elsewhere ? 'caught only elsewhere, by: ' + r.elsewhere.slice(0, 150) : r.equivalent ? 'as expected' : 'THE GROUPS LET IT THROUGH') : r.note) +
        (r.kept ? '  [kept: ' + r.kept + ']' : '') + '   (' + secs(r.buildMs) + ' build, ' + secs(r.runMs) + ' run)');
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));

  const caught = results.filter(r => r.status === 'CAUGHT' && !r.equivalent);
  const survivors = results.filter(r => r.status === 'SURVIVED' && !r.equivalent);
  const eqOk = results.filter(r => r.status === 'SURVIVED' && r.equivalent);
  const eqDied = results.filter(r => r.status === 'CAUGHT' && r.equivalent);
  const errors = results.filter(r => r.status === 'ERROR');
  console.log('\n' + caught.length + ' caught, ' + survivors.length + ' SURVIVED, ' + eqOk.length + ' equivalent survived (expected), ' + eqDied.length + ' equivalent DIED, ' + errors.length + ' ERROR');
  for (const r of survivors) console.log('  SURVIVED  ' + r.id + (r.elsewhere ? ' (caught only elsewhere: ' + r.elsewhere.slice(0, 100) + ')' : '') + '  groups ' + r.groups.join(','));
  for (const r of eqDied) console.log('  EQUIVALENT DIED  ' + r.id + ': ' + r.by.slice(0, 160));
  for (const r of errors) console.log('  ERROR  ' + r.id + ': ' + r.note);
  process.exit(survivors.length || eqDied.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(2); });
