/* legacy-manifest.mjs - pin the old page so it can be trusted as the reference.
 *
 *   node scripts/legacy-manifest.mjs           write scripts/legacy.sha256 from the old page's files
 *   node scripts/legacy-manifest.mjs --check   fail if any of them differs, is missing or is new
 *
 * The old Earth console is not in the tree any more: it is in git at the tag `legacy-earth-console` (main at 4eadd7a), and to run a suite
 * against it (GT_TARGET=legacy) it is checked out where the harness looks:
 *
 *   git worktree add legacy legacy-earth-console
 *
 * What is pinned is what the old page IS: index.html, earth/*.js and core/*.js. (The checkout is the whole old repository: its README, its
 * verification/ and the rest are not the page.) If a file drifted, "passes against the old page" would mean nothing, so --check says so.
 * LEGACY_DIR=<folder> checks a checkout somewhere else.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = process.env.LEGACY_DIR ? path.resolve(process.env.LEGACY_DIR) : path.join(ROOT, 'legacy');
const MANIFEST = path.join(ROOT, 'scripts', 'legacy.sha256');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}
const rel = abs => path.relative(LEGACY, abs).split(path.sep).join('/');
const sha = abs => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');

if (!fs.existsSync(path.join(LEGACY, 'index.html'))) {
  console.error('the old page is not checked out at ' + LEGACY + ' (git worktree add legacy legacy-earth-console)');
  process.exit(1);
}
const files = [path.join(LEGACY, 'index.html'), ...walk(path.join(LEGACY, 'earth')), ...walk(path.join(LEGACY, 'core'))]
  .map(f => [rel(f), sha(f)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const body = files.map(([f, h]) => h + '  ' + f).join('\n') + '\n';

if (process.argv.includes('--check')) {
  if (!fs.existsSync(MANIFEST)) { console.error('scripts/legacy.sha256 is missing'); process.exit(1); }
  const want = new Map(fs.readFileSync(MANIFEST, 'utf8').trim().split('\n').map(l => { const i = l.indexOf('  '); return [l.slice(i + 2), l.slice(0, i)]; }));
  const bad = [];
  for (const [f, h] of files) { if (want.get(f) !== h) bad.push((want.has(f) ? 'changed ' : 'new     ') + f); want.delete(f); }
  for (const f of want.keys()) bad.push('missing ' + f);
  if (bad.length) { console.error('the old page differs from its manifest:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('the old page matches its manifest (' + files.length + ' files)');
} else {
  fs.writeFileSync(MANIFEST, body);
  console.log('wrote scripts/legacy.sha256 (' + files.length + ' files)');
}
