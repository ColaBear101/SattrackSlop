/* extract-data.mjs - turn what the old page carried inline into standalone data files.
 *
 *   legacy/index.html  <script id="tledata">      -> data/catalogue.txt   (+ data/catalogue.meta.json)
 *   legacy/index.html  <script id="worlddata">    -> data/world.json
 *   legacy/earth/transmitters.js  const TX = {...} -> data/transmitters.json
 *
 *   node scripts/extract-data.mjs            write the files
 *   node scripts/extract-data.mjs --check    re-extract in memory and fail if data/ differs
 *
 * The catalogue text is written exactly as the page held it, so the same 2,158 element sets
 * (and the same parse) reach the new app; verification/catalog.txt is an independent copy of
 * it and is compared byte for byte. Nothing here rounds, re-orders or re-serialises a number.
 * Once legacy/ is deleted at cutover the data files are the source of truth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const check = process.argv.includes('--check');

const html = rd('legacy/index.html');

function scriptBody(id) {
  const m = new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>').exec(html);
  if (!m) throw new Error('<script id="' + id + '"> not found in legacy/index.html');
  return m[1];
}

/* ---- catalogue ------------------------------------------------------------------ */
const tle = scriptBody('tledata');
const fetched = /const FETCHED\s*=\s*new Date\('([^']+)'\)/.exec(html);
const source = /const SOURCE\s*=\s*'([^']+)'/.exec(html);
if (!fetched || !source) throw new Error('FETCHED / SOURCE constants not found in legacy/index.html');

function parseCatalog(txt) {            // the page's own parseCatalog, kept to count what it counts
  const lines = txt.split(/\r?\n/).map(s => s.replace(/\s+$/, '')).filter(s => s.length);
  const out = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (lines[i + 1][0] === '1' && lines[i + 2][0] === '2' && lines[i][0] !== '1' && lines[i][0] !== '2') {
      out.push(lines[i].trim()); i += 2;
    }
  }
  return out;
}
const names = parseCatalog(tle);
if (names.length !== 2158) throw new Error('expected 2158 element sets, parsed ' + names.length);

const meta = { fetched: fetched[1], source: source[1], count: names.length };

/* ---- world map ------------------------------------------------------------------ */
const worldText = scriptBody('worlddata').trim();
const world = JSON.parse(worldText);
const polys = world.features.length;
if (polys !== 127) throw new Error('expected 127 polygons, found ' + polys);

/* ---- transmitters --------------------------------------------------------------- */
const tx = rd('legacy/earth/transmitters.js');
const built = /const BUILT = "([^"]+)"/.exec(tx), txSource = /const SOURCE = '([^']+)'/.exec(tx);
const counts = /objects:\s*(\d+),\s*records:\s*(\d+)/.exec(tx);
const open = tx.indexOf('const TX = {'), close = tx.indexOf('\n  };', open);
if (!built || !txSource || !counts || open < 0 || close < 0) throw new Error('transmitters.js has an unexpected shape');
const TX = new Function('return {' + tx.slice(open + 'const TX = {'.length, close) + '\n}')();
const objects = Object.keys(TX).length, records = Object.values(TX).reduce((n, l) => n + l.length, 0);
if (objects !== +counts[1] || records !== +counts[2]) {
  throw new Error('transmitters: found ' + objects + '/' + records + ', the file says ' + counts[1] + '/' + counts[2]);
}
const transmitters = { built: built[1], source: txSource[1], objects, records, tx: TX };

/* ---- compare with the independent copy, then write or check --------------------- */
const catalogOnDisk = fs.readFileSync(path.join(ROOT, 'verification/catalog.txt'), 'utf8');
const normalise = s => s.replace(/\r\n/g, '\n').replace(/^\n/, '').replace(/\n+$/, '\n');
const sameAsVerification = normalise(tle) === normalise(catalogOnDisk);

const files = {
  'data/catalogue.txt': normalise(tle),
  'data/catalogue.meta.json': JSON.stringify(meta, null, 2) + '\n',
  'data/world.json': worldText + '\n',
  'data/transmitters.json': JSON.stringify(transmitters) + '\n'
};

console.log('catalogue: ' + names.length + ' element sets; identical to verification/catalog.txt: ' + sameAsVerification);
console.log('world: ' + polys + ' polygons; transmitters: ' + objects + ' objects, ' + records + ' records');
if (!sameAsVerification) throw new Error('the page and verification/catalog.txt disagree');

let bad = 0;
for (const [rel, body] of Object.entries(files)) {
  const abs = path.join(ROOT, rel);
  if (check) {
    const have = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    const ok = have === body;
    if (!ok) bad++;
    console.log((ok ? 'ok      ' : 'DIFFERS ') + rel);
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    console.log('wrote   ' + rel + '  (' + (Buffer.byteLength(body) / 1024).toFixed(1) + ' KB)');
  }
}
if (bad) process.exit(1);
