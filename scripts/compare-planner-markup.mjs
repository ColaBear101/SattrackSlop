/* compare-planner-markup.mjs - the planner's markup in the Svelte components against the old page's, node for node.
 *
 *   node scripts/compare-planner-markup.mjs            server render and client render, both compared
 *   node scripts/compare-planner-markup.mjs --server   the server render only (no page mounted, quicker)
 *   node scripts/compare-planner-markup.mjs --verbose  also print the fragments' sizes
 *
 * plannerui.ts is the old controller moved unchanged: it finds its nodes by id, writes into them and wires them itself, so the
 * components must hand it the old page's markup exactly. This cuts the five fragments out of legacy/index.html (the aside and
 * the sprite before it, the #pl-live region, the read-only Professor section and the link to it), renders PlannerPanel,
 * PlannerSprite, PlannerLive, ProfessorSection and ProfessorLink the two ways a browser can meet them, loads both into Chromium
 * and compares the DOM trees: tag, attributes, and text with runs of ASCII whitespace collapsed. Comments are ignored; so is the
 * order of attributes; whitespace between the children of a block container (div, form, ul, ...) is ignored, because it is not
 * drawn there, but a space inside a line of text or between inline elements is compared, because it is. Exit status 1 when any
 * tree differs.
 *
 * "Server" is svelte/server's render(), which is what vitest can see (tests/components/planner-markup.test.ts). "Client" is what
 * the app does: mount() into a node, from the template the compiler builds, through a throwaway Vite dev server on a free port.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const OLD = fs.readFileSync(path.join(ROOT, 'legacy', 'index.html'), 'utf8');

/* the old fragment that starts with `open` and runs to the first `close` after it (none of these nest their own end tag) */
function cut(open, close) {
  const a = OLD.indexOf(open);
  if (a < 0) throw new Error('legacy/index.html has no ' + open);
  const b = OLD.indexOf(close, a);
  if (b < 0) throw new Error('legacy/index.html has no ' + close + ' after ' + open);
  return OLD.slice(a, b + close.length);
}

const FRAGMENTS = [
  { name: 'PlannerPanel', file: 'src/components/planner/PlannerPanel.svelte', old: cut('<aside class="planner" id="planner"', '</aside>') },
  { name: 'PlannerSprite', file: 'src/components/planner/PlannerSprite.svelte', old: cut('<svg width="0" height="0" style="position:absolute"', '</svg>') },
  { name: 'PlannerLive', file: 'src/components/planner/PlannerLive.svelte', old: cut('<p class="pl-say" id="pl-live"', '</p>') },
  { name: 'ProfessorSection', file: 'src/components/report/ProfessorSection.svelte', old: cut('<section id="sec-prof"', '</section>') },
  { name: 'ProfessorLink', file: 'src/components/report/ProfessorLink.svelte', old: cut('<span id="rp-nav"', '</span>') }
];

/* ---- the DOM tree of a fragment, read in the page ------------------------------------------------------------------ */
/* Runs in the browser: the children of #t as plain data. Elements: tag, namespace, attributes in source order, children. */
const READ_TREE = () => {
  const ser = n => n.nodeType === 3
    ? n.nodeValue
    : { tag: n.localName, svg: n.namespaceURI === 'http://www.w3.org/2000/svg', attrs: [...n.attributes].map(a => [a.name, a.value]), kids: [...n.childNodes].filter(c => c.nodeType === 1 || c.nodeType === 3).map(ser) };
  return [...document.getElementById('t').childNodes].filter(c => c.nodeType === 1 || c.nodeType === 3).map(ser);
};

/* parents whose children are laid out as blocks, flex items or grid items, or are not text at all: a space between two of
   their children is never drawn, so whether it is there is no difference */
const BLOCKY = new Set(['div', 'form', 'fieldset', 'section', 'aside', 'ul', 'details', 'select', 'svg', 'symbol']);
const ws = s => s.replace(/[ \t\n\r\f]+/g, ' ');

function norm(kids, parentTag) {
  const out = [];
  for (const k of kids) {
    if (typeof k === 'string') {
      if (typeof out[out.length - 1] === 'string') out[out.length - 1] += ws(k); else out.push(ws(k));
    } else {
      out.push({
        tag: k.tag, svg: k.svg,
        attrs: k.attrs.map(([n, v]) => [n, ws(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
        kids: norm(k.kids, k.tag)
      });
    }
  }
  return BLOCKY.has(parentTag) ? out.filter(k => typeof k !== 'string' || k.trim() !== '') : out;
}

/* ---- comparing two trees ------------------------------------------------------------------------------------------- */
const label = n => n.tag + (n.attrs.find(a => a[0] === 'id') ? '#' + n.attrs.find(a => a[0] === 'id')[1] : '');

function diff(a, b, at, out) {
  if (typeof a === 'string' || typeof b === 'string') {
    if (a !== b) out.push(`${at}: text ${JSON.stringify(a)} (old) != ${JSON.stringify(b)} (new)`);
    return;
  }
  const here = at + '/' + label(a);
  if (a.tag !== b.tag) { out.push(`${here}: tag <${a.tag}> (old) != <${b.tag}> (new)`); return; }
  const am = new Map(a.attrs), bm = new Map(b.attrs);
  for (const [n, v] of a.attrs) {
    if (!bm.has(n)) out.push(`${here}: attribute ${n}=${JSON.stringify(v)} is missing from the new markup`);
    else if (bm.get(n) !== v) out.push(`${here}: attribute ${n} ${JSON.stringify(v)} (old) != ${JSON.stringify(bm.get(n))} (new)`);
  }
  for (const [n, v] of b.attrs) if (!am.has(n)) out.push(`${here}: attribute ${n}=${JSON.stringify(v)} is new`);
  if (a.kids.length !== b.kids.length) out.push(`${here}: ${a.kids.length} children (old) != ${b.kids.length} (new)`);
  for (let i = 0; i < Math.min(a.kids.length, b.kids.length); i++) {
    diff(a.kids[i], b.kids[i], here, out);
  }
}

function compareTrees(oldKids, newKids) {
  const out = [];
  const a = norm(oldKids, 'div'), b = norm(newKids, 'div');
  if (a.length !== b.length) out.push(`root: ${a.length} nodes (old) != ${b.length} (new)`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], '', out);
  return out;
}

/* ---- the new markup, rendered on the server -------------------------------------------------------------------------- */
async function serverTrees(vite, page) {
  const { render } = await vite.ssrLoadModule('svelte/server');
  const trees = {};
  for (const f of FRAGMENTS) {
    const mod = await vite.ssrLoadModule('/' + f.file);
    const body = render(mod.default).body;
    await page.setContent('<!doctype html><meta charset="utf-8"><div id="t">' + body + '</div>');
    trees[f.name] = await page.evaluate(READ_TREE);
  }
  return trees;
}

/* ---- the new markup, mounted in a browser --------------------------------------------------------------------------------- */
async function clientTrees(vite, page, base) {
  const trees = {};
  for (const f of FRAGMENTS) {
    await page.goto(base + '/__cmp?c=' + f.name);
    await page.waitForFunction(() => window.__mounted === true, null, { timeout: 30000 });
    trees[f.name] = await page.evaluate(READ_TREE);
  }
  return trees;
}

/* a dev-server plugin: /__cmp?c=Name serves a page that mounts that one component into #t */
function cmpPlugin() {
  return {
    name: 'cmp-page',
    resolveId(id) { return id === 'virtual:cmp-entry' ? '\0virtual:cmp-entry' : null; },
    load(id) {
      if (id !== '\0virtual:cmp-entry') return null;
      const lines = ["import { mount } from 'svelte';"];
      for (const f of FRAGMENTS) lines.push(`import ${f.name} from '/${f.file}';`);
      lines.push('const all = { ' + FRAGMENTS.map(f => f.name).join(', ') + ' };');
      lines.push("mount(all[new URLSearchParams(location.search).get('c')], { target: document.getElementById('t') });");
      lines.push('window.__mounted = true;');
      return lines.join('\n');
    },
    configureServer(server) {
      server.middlewares.use('/__cmp', (req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/styles/tokens.css"><div id="t"></div><script type="module" src="/@id/__x00__virtual:cmp-entry"></script>');
      });
    }
  };
}

/* ---- run ------------------------------------------------------------------------------------------------------------------------ */
const vite = await createServer({
  root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), logLevel: 'error', clearScreen: false,
  server: { host: '127.0.0.1', port: 5290, strictPort: false },
  optimizeDeps: { noDiscovery: false },
  plugins: [cmpPlugin()]
});
/* listening starts the plugins' buildStart, which the CSS plugin needs before the first stylesheet is imported, server side included */
await vite.listen();
let failed = 0;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const oldTrees = {};
  for (const f of FRAGMENTS) {
    await page.setContent('<!doctype html><meta charset="utf-8"><div id="t">' + f.old + '</div>');
    oldTrees[f.name] = await page.evaluate(READ_TREE);
    if (args.has('--verbose')) console.log(`${f.name}: old fragment ${f.old.length} chars`);
  }
  const runs = [['server', await serverTrees(vite, page)]];
  if (!args.has('--server')) {
    const base = vite.resolvedUrls.local[0].replace(/\/$/, '');
    runs.push(['client', await clientTrees(vite, page, base)]);
  }
  for (const [how, trees] of runs) {
    for (const f of FRAGMENTS) {
      const d = compareTrees(oldTrees[f.name], trees[f.name]);
      console.log(`${f.name} (${how}): ${d.length ? d.length + ' difference' + (d.length > 1 ? 's' : '') : 'identical'}`);
      for (const line of d) console.log('  ' + line);
      failed += d.length;
    }
  }
} finally {
  await browser.close();
  await vite.close();
}
process.exit(failed ? 1 : 0);
