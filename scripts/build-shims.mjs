/* build-shims.mjs - bundle parts of src/lib for the Node-side suites.
 *
 *   node scripts/build-shims.mjs
 *
 * The verification suites are CommonJS scripts that load a module, find what it attached to
 * globalThis, and test it. The rewritten library is TypeScript, so each module the Node suites need gets
 * a one-file shim in src/lib/shims/ that attaches the same global, and this bundles every shim with
 * esbuild into verification/.build/<name>.cjs as a self-contained script (an IIFE, so it also loads in
 * the bare vm contexts some suites use). `H.earthFile(name)` in verification/lib/harness.js points at
 * these files when GT_TARGET=new, and at legacy/earth/*.js when GT_TARGET=legacy, so one suite can be run
 * against old and new code and the outputs compared.
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIMS = path.join(ROOT, 'src', 'lib', 'shims');
const OUT = path.join(ROOT, 'verification', '.build');

const entries = Object.fromEntries(
  fs.readdirSync(SHIMS).filter(f => f.endsWith('.ts')).map(f => [f.replace(/\.ts$/, ''), path.join(SHIMS, f)])
);
if (!Object.keys(entries).length) { console.error('no shims in src/lib/shims'); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: entries,
  outdir: OUT,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning'
});
for (const name of Object.keys(entries)) {
  const f = path.join(OUT, name + '.cjs');
  console.log('built verification/.build/' + name + '.cjs  (' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB)');
}
