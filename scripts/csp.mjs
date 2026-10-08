/* The one inline script of the built page (the theme, set before the first paint) and the Content-Security-Policy-Report-Only header in
 * vercel.json that names it by hash.
 *
 *   node scripts/csp.mjs            print the hash of the inline script in dist/index.html
 *   node scripts/csp.mjs --check    fail unless vercel.json's policy carries exactly that hash (a changed script, a stale header)
 *
 * The header is report-only: it says what an enforcing policy would refuse and refuses nothing. It is only on the page itself (`/` and
 * `/index.html`): the Moon pages load three.js from cdnjs under integrity hashes, which is another policy. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');

const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (inline.length !== 1) {
  console.error('csp: expected exactly one inline script in dist/index.html, found ' + inline.length + ' (run `npm run build` first)');
  process.exit(1);
}
const hash = "'sha256-" + createHash('sha256').update(inline[0], 'utf8').digest('base64') + "'";

if (!process.argv.includes('--check')) {
  console.log(hash);
  process.exit(0);
}

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const policies = (vercel.headers || []).flatMap(h => (h.headers || []).filter(x => x.key === 'Content-Security-Policy-Report-Only').map(x => x.value));
if (!policies.length) {
  console.error('csp: vercel.json has no Content-Security-Policy-Report-Only header');
  process.exit(1);
}
const script = policies.map(p => (/(?:^|;)\s*script-src\s+([^;]*)/.exec(p) || [])[1] || '');
const bad = script.filter(s => !s.split(/\s+/).includes(hash) || /'unsafe-inline'/.test(s));
if (bad.length) {
  console.error('csp: the policy in vercel.json does not name the inline script by ' + hash + ' (script-src: ' + script.join(' | ') + ')');
  process.exit(1);
}
console.log('csp ok: vercel.json names the page\'s inline script ' + hash + ' and allows no other inline script');
