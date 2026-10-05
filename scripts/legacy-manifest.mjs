/* legacy-manifest.mjs - pin legacy/ so it can be trusted as the reference.
 *
 *   node scripts/legacy-manifest.mjs           write legacy/MANIFEST.sha256
 *   node scripts/legacy-manifest.mjs --check   fail if any file under legacy/ differs, is missing or is new
 *
 * legacy/ is the pre-rewrite Earth console, kept only to calibrate the harness and to A/B the
 * rewrite against. If it drifted, "passes against legacy" would mean nothing, so test:fast checks it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = path.join(ROOT, 'legacy');
const MANIFEST = path.join(LEGACY, 'MANIFEST.sha256');

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

const files = walk(LEGACY).filter(f => path.basename(f) !== 'MANIFEST.sha256')
  .map(f => [rel(f), sha(f)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const body = files.map(([f, h]) => h + '  ' + f).join('\n') + '\n';

if (process.argv.includes('--check')) {
  if (!fs.existsSync(MANIFEST)) { console.error('legacy/MANIFEST.sha256 is missing'); process.exit(1); }
  const want = new Map(fs.readFileSync(MANIFEST, 'utf8').trim().split('\n').map(l => { const i = l.indexOf('  '); return [l.slice(i + 2), l.slice(0, i)]; }));
  const bad = [];
  for (const [f, h] of files) { if (want.get(f) !== h) bad.push((want.has(f) ? 'changed ' : 'new     ') + f); want.delete(f); }
  for (const f of want.keys()) bad.push('missing ' + f);
  if (bad.length) { console.error('legacy/ differs from its manifest:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('legacy/ matches its manifest (' + files.length + ' files)');
} else {
  fs.writeFileSync(MANIFEST, body);
  console.log('wrote legacy/MANIFEST.sha256 (' + files.length + ' files)');
}
