/* check-deps.mjs - the dependency direction is a rule, not a convention.
 *
 *   lib  <-  state  <-  components          (src/lib knows nothing about the DOM or the stores)
 *   scene, workers import lib (and shared), never state or components
 *   server imports shared (and itself), never src/
 *   shared imports shared only
 *
 *   node scripts/check-deps.mjs              check the tree, exit 1 on a violation
 *   node scripts/check-deps.mjs --self-test  prove the checker can fail (it must, on planted violations)
 *
 * It reads import specifiers with a regex rather than a parser. That is enough for this tree (static
 * imports, dynamic import('...'), and `new URL('...', import.meta.url)`), and the self-test pins it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* layer of a path relative to the repo root, or null when it is outside the rules */
export function layerOf(rel) {
  /* a directory (import '../../scene') is the folder's index: it is in the layer of the folder */
  rel = rel.split(path.sep).join('/') + '/';
  if (rel.startsWith('src/lib/')) return 'lib';
  if (rel.startsWith('src/state/')) return 'state';
  if (rel.startsWith('src/scene/')) return 'scene';
  if (rel.startsWith('src/workers/')) return 'workers';
  if (rel.startsWith('src/components/')) return 'components';
  if (rel.startsWith('src/assets/')) return 'assets';    // images and the like: imported by URL, importing nothing
  if (rel.startsWith('src/')) return 'app';           // main.ts, App.svelte, testing/, contract/
  if (rel.startsWith('server/')) return 'server';
  if (rel.startsWith('shared/')) return 'shared';
  return null;
}

/* what each layer may import (itself is always allowed) */
export const ALLOWED = {
  lib: ['shared'],
  state: ['lib', 'shared'],
  scene: ['lib', 'shared', 'assets'],
  workers: ['lib', 'shared'],
  components: ['lib', 'state', 'scene', 'shared', 'assets'],
  app: ['lib', 'state', 'scene', 'workers', 'components', 'shared', 'assets', 'app'],
  server: ['shared'],
  shared: [],
  assets: []
};

const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]|new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g;

export function importsOf(code) {
  const out = [];
  let m;
  SPEC.lastIndex = 0;
  while ((m = SPEC.exec(code))) out.push(m[1] || m[2]);
  return out;
}

/* `import type { X } from '...'` and `export type { X } from '...'`: erased when the code is built, so they carry a
   name across a boundary without carrying any code. */
const TYPE_ONLY = /\b(?:import|export)\s+type\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
function typeOnlyCounts(code) {
  const n = new Map();
  let m;
  TYPE_ONLY.lastIndex = 0;
  while ((m = TYPE_ONLY.exec(code))) n.set(m[1], (n.get(m[1]) || 0) + 1);
  return n;
}

export function violations(files) {            // files: [{ rel, code }]
  const bad = [];
  for (const { rel, code } of files) {
    const from = layerOf(rel);
    if (!from) continue;
    /* One exception, on purpose: the browser's API client may name the server's `Api` type (that is how a route's
       schema becomes a compile error in the client), as a type-only import. A value import of server code would put
       the server in the bundle, and is still a violation: a specifier imported both ways is exempted once per
       type-only statement and flagged for the rest. */
    const typeOnly = typeOnlyCounts(code), used = new Map();
    for (const spec of importsOf(code)) {
      if (!spec.startsWith('.')) continue;     // packages are not layered
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel.split(path.sep).join('/')), spec));
      const to = layerOf(target);
      if (!to || to === from) continue;
      if (to === 'server' && (used.get(spec) || 0) < (typeOnly.get(spec) || 0)) { used.set(spec, (used.get(spec) || 0) + 1); continue; }
      if (!ALLOWED[from].includes(to)) bad.push(rel + ' (' + from + ') imports ' + spec + ' (' + to + ')');
    }
  }
  return bad;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(abs, out); }
    else if (/\.(ts|js|mjs|svelte)$/.test(e.name) && !/\.test\.(ts|js)$/.test(e.name)) out.push(abs);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const planted = [
      { rel: 'src/lib/analysis/x.ts', code: "import { clock } from '../../state/clock.svelte';" },
      { rel: 'src/state/y.svelte.ts', code: "import Foo from '../components/Foo.svelte';" },
      { rel: 'server/app.ts', code: "const m = await import('../src/lib/core/body.js');" },
      { rel: 'shared/tle.ts', code: "export * from '../src/lib/catalogue/parse.js';" },
      { rel: 'src/scene/globe.ts', code: "import { ui } from '../state/ui.svelte';" },
      { rel: 'src/workers/a.worker.ts', code: "const w = new URL('../components/B.svelte', import.meta.url);" },
      { rel: 'src/lib/net/api.ts', code: "import { treaty } from '@elysia/eden'; import { createApi } from '../../../server/app';" },
      { rel: 'src/lib/net/api.ts', code: "import type { Api } from '../../../server/app'; import { createApi } from '../../../server/app';" }
    ];
    const fine = [
      { rel: 'src/lib/analysis/x.ts', code: "import { RE } from '../core/constants.js'; import { tleOk } from '../../../shared/tle.js'; import sat from 'satellite.js';" },
      { rel: 'src/components/A.svelte', code: "import { clock } from '../state/clock.svelte'; const s = await import('../scene/globe.js');" },
      { rel: 'server/app.ts', code: "import { tleOk } from '../shared/tle.js'; import { Elysia } from 'elysia';" },
      { rel: 'src/lib/net/api.ts', code: "import { treaty } from '@elysia/eden';\nimport type { Api } from '../../../server/app';\nimport type {\n  A,\n  B\n} from '../../../server/app';" }
    ];
    const got = violations(planted), ok = violations(fine);
    if (got.length !== planted.length || ok.length !== 0) {
      console.error('check-deps self-test FAILED: planted ' + planted.length + ', flagged ' + got.length + ', false positives ' + ok.length);
      process.exit(1);
    }
    console.log('check-deps self-test ok: flagged all ' + planted.length + ' planted violations, 0 false positives');
    process.exit(0);
  }
  const files = ['src', 'server', 'shared'].flatMap(d => walk(path.join(ROOT, d)))
    .map(abs => ({ rel: path.relative(ROOT, abs), code: fs.readFileSync(abs, 'utf8') }));
  const bad = violations(files);
  if (bad.length) { console.error('dependency direction violated:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('check-deps ok: ' + files.length + ' files respect lib <- state <- components, server -> shared');
}
