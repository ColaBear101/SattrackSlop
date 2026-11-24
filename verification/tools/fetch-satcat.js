/*
 * Bake data/satcat.json from CelesTrak: what each of the catalogue's objects is, for the globe's colours by class
 * (CHANGES-FROM-LEGACY.md, L76).
 *
 * The catalogue (data/catalogue.txt) holds a name and an element set for each object, and nothing of what the object is.
 * Two of the Layers panel's colourings need that. "By type" is SATCAT's OBJECT_TYPE (payload, rocket body, debris, unknown).
 * "By purpose" CelesTrak says only by the lists it files an object in (celestrak.org/NORAD/elements/): there is no purpose
 * column anywhere. The third colouring, "By orbit", is read from the elements in the page (src/lib/catalogue/classify.ts)
 * and needs nothing from here.
 *
 * Polite: one request per file, one after the other with a pause between, with a User-Agent that names no one.
 *   - the SATCAT, https://celestrak.org/pub/satcat.csv: every object ever catalogued, about 6.8 MB (71,367 rows on 2026-11-20);
 *   - each list below, https://celestrak.org/NORAD/elements/gp.php?GROUP=<list>&FORMAT=csv, of which only NORAD_CAT_ID is read.
 *
 * What is kept, and why:
 *   - the catalogue's 2,158 objects only, in data/catalogue.txt's order: one letter each for the type and one for the purpose,
 *     as two strings. The file is the smallest that says it (4,479 bytes, 757 gzipped), and the page reads it by position. `n` and `sum`
 *     (FNV-1a over the catalogue's NORAD numbers, in order) say which catalogue it was baked against; the page treats a table
 *     whose sum is not its catalogue's as no table (classify.ts, tableFits), and tests/lib/classify.test.ts holds the two together.
 *   - an object is joined to SATCAT by its NORAD number, and only when the international designator on its first line names the
 *     same launch as SATCAT's (the piece letter may differ: SATCAT re-letters the cubesats released from the ISS, 1998-067XS to
 *     1998-067XT, and the catalogue's sets are older), or the line has none (LAPAN-A2). The 13 objects SatNOGS numbers itself
 *     (98247 to 99416, BLUEBIRD-11 to Unknown 3 T17) are not SATCAT's, and a number of that range in SATCAT would be another
 *     object: they have no record ('N'), and no purpose either.
 *   - type: P payload, R rocket body, D debris, U unknown (SATCAT's UNK), N no SATCAT record. The page colours U and N alike.
 *   - purpose: the first of these that lists the object (PURPOSE below), else o (other or unknown). An object is often on
 *     several lists, so the order is the rule: a military list first; an operator's fleet before navigation, because the
 *     satellites that carry an augmentation payload (SBAS, which the GNSS list holds too) are an operator's communications
 *     satellites (SES-15, GALAXY 30, EUTELSAT 117 WEST B); weather and Earth resources before science (TERRA); the CubeSats
 *     list before the stations list, because CelesTrak lists the cubesats just released from the ISS with the station
 *     (KNACKSAT-2); the stations before amateur radio (the ISS carries an amateur station); and the geostationary list, which
 *     is nearly all communications satellites, only after every list that says more. Lists that say what an object carries,
 *     uses or is heard by rather than what it is for are not read: search and rescue (SARSAT, a payload on weather and
 *     navigation satellites), TDRSS (the relays and the spacecraft that use them), SatNOGS (what its stations can hear),
 *     engineering and radar calibration.
 *   - CelesTrak's lists hold the objects it has sorted, not everything in orbit: from its files of 2026-11-20, 1,091 of the
 *     catalogue's 2,158 are on none of them, 896 of those working by SATCAT's status and 785 launched since 2020 as well as the
 *     old and the dead. They are "other or unknown": the colours say what CelesTrak's lists say, no more.
 *
 * Shape: { built, source, n, sum, type: "PPRP...", purpose: "cneo..." } (one letter per catalogue entry, in its order).
 * The data is CelesTrak's (Dr T.S. Kelso), as the README's provenance section says.
 *
 *   node verification/tools/fetch-satcat.js                    fetch, write data/satcat.json
 *   node verification/tools/fetch-satcat.js --save <folder>    ...and keep each answer in <folder> (satcat.csv, <list>.csv)
 *   node verification/tools/fetch-satcat.js --from <folder>    write data/satcat.json from kept answers (no request); a list
 *                                                              whose file is not there is named and left out
 *   --date YYYY-MM-DD                                          the date the answers are of (--from takes satcat.csv's own
 *                                                              file date otherwise; a fetch, today)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SATCAT = 'https://celestrak.org/pub/satcat.csv';
const GROUP = g => 'https://celestrak.org/NORAD/elements/gp.php?GROUP=' + encodeURIComponent(g) + '&FORMAT=csv';
const UA = 'satcat-bake/1.0 (node)';
const PAUSE_MS = 1500;
const CATALOG = path.join(__dirname, '..', '..', 'data', 'catalogue.txt');
const OUT = path.join(__dirname, '..', '..', 'data', 'satcat.json');

/* The purpose letters (src/lib/catalogue/classify.ts reads them) and the lists that give each, the first that lists an object
   winning: m military, c communications, n navigation, e Earth observation and weather, s science, a amateur and education,
   h crewed stations, o other or unknown. */
const PURPOSE = [
  ['m', ['military']],
  ['c', ['intelsat', 'ses', 'eutelsat', 'telesat', 'starlink', 'oneweb', 'qianfan', 'hulianwang', 'kuiper', 'iridium-NEXT', 'orbcomm', 'globalstar']],
  ['n', ['gps-ops', 'glo-ops', 'galileo', 'beidou', 'gnss', 'sbas', 'nnss', 'musson']],
  ['e', ['weather', 'goes', 'resource', 'sar', 'planet', 'spire', 'dmc', 'argos']],
  ['s', ['science', 'geodetic']],
  ['a', ['cubesat']],
  ['h', ['stations']],
  ['c', ['x-comm', 'other-comm', 'geo']],
  ['a', ['amateur', 'education']]
];
const LISTS = [...new Set(PURPOSE.flatMap(p => p[1]))];
const TYPE = { PAY: 'P', 'R/B': 'R', DEB: 'D', UNK: 'U' };

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* FNV-1a, 32 bits, over the catalogue's NORAD numbers as its lines give them, one per line (classify.ts, catSum: the same) */
function catSum(nums) {
  let h = 0x811c9dc5;
  const s = nums.join('\n');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/* the catalogue, in its order: the NORAD number as the page reads it (parseCatalog: columns 3-7, trimmed), the name, and the launch
   the designator names ('24128B' is '2024-128') */
function catalogue() {
  const lines = fs.readFileSync(CATALOG, 'utf8').split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const l1 = lines[i];
    if (!l1.startsWith('1 ') || l1.length < 17) continue;
    const d = l1.substring(9, 17).trim(), yy = +d.slice(0, 2);
    out.push({ satnum: l1.substring(2, 7).trim(), name: lines[i - 1].trim(), launch: d ? (yy < 57 ? 2000 + yy : 1900 + yy) + '-' + d.slice(2, 5) : '' });
  }
  return out;
}

/* a CSV as CelesTrak writes it: a header row, commas, and a field in double quotes when it holds one */
function csv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv,text/plain' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.text();
}

/* every answer, from CelesTrak or from a folder of kept ones: { date, satcat (text), lists: { name: text } }, the missing lists named */
async function answers() {
  const from = arg('--from'), save = arg('--save');
  const out = { date: arg('--date'), satcat: null, lists: {}, missing: [] };
  if (from) {
    const f = path.join(from, 'satcat.csv');
    out.satcat = fs.readFileSync(f, 'utf8');
    out.date ??= fs.statSync(f).mtime.toISOString().slice(0, 10);
    for (const g of LISTS) {
      const p = path.join(from, g + '.csv');
      if (fs.existsSync(p)) out.lists[g] = fs.readFileSync(p, 'utf8'); else out.missing.push(g);
    }
    return out;
  }
  if (save) fs.mkdirSync(save, { recursive: true });
  const t0 = Date.now();
  out.date ??= new Date().toISOString().slice(0, 10);
  out.satcat = await get(SATCAT);
  if (save) fs.writeFileSync(path.join(save, 'satcat.csv'), out.satcat);
  for (const g of LISTS) {
    await sleep(PAUSE_MS);
    try {
      const t = await get(GROUP(g));
      /* a list CelesTrak does not have is answered with a line of text, not a header */
      if (!/^OBJECT_NAME,/.test(t)) { out.missing.push(g); continue; }
      out.lists[g] = t;
      if (save) fs.writeFileSync(path.join(save, g + '.csv'), t);
    } catch (e) { console.error('  ' + g + ': ' + e.message); out.missing.push(g); }
  }
  console.log('CelesTrak         : SATCAT and ' + Object.keys(out.lists).length + ' lists in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  return out;
}

(async () => {
  const cat = catalogue();
  console.log('embedded catalogue: ' + cat.length + ' objects');
  const a = await answers();

  const rows = csv(a.satcat);
  if (!rows.length || !('OBJECT_TYPE' in rows[0]) || !('NORAD_CAT_ID' in rows[0])) { console.error('satcat.csv has no OBJECT_TYPE or NORAD_CAT_ID column'); process.exit(1); }
  const byNum = new Map(rows.map(r => [String(+r.NORAD_CAT_ID), r]));
  console.log('SATCAT            : ' + rows.length + ' records');
  const on = {};
  for (const [g, t] of Object.entries(a.lists)) on[g] = new Set(csv(t).map(r => String(+r.NORAD_CAT_ID)));
  console.log('lists read        : ' + Object.keys(on).length + ' of ' + LISTS.length + (a.missing.length ? ' (not there: ' + a.missing.join(', ') + ')' : ''));

  let type = '', purpose = '';
  const other = [], counts = {};
  for (const e of cat) {
    const n = String(+e.satnum), r = byNum.get(n);
    const same = r && (!e.launch || String(r.OBJECT_ID || '').startsWith(e.launch));
    if (r && !same) other.push(e.satnum + ' ' + e.name + ': the line names ' + e.launch + ', SATCAT ' + r.OBJECT_ID + ' ' + r.OBJECT_NAME);
    const t = same ? (TYPE[r.OBJECT_TYPE] || 'U') : 'N';
    let p = 'o';
    if (same) for (const [code, lists] of PURPOSE) if (lists.some(g => on[g] && on[g].has(n))) { p = code; break; }
    type += t; purpose += p;
    counts['type ' + t] = (counts['type ' + t] || 0) + 1;
    counts['purpose ' + p] = (counts['purpose ' + p] || 0) + 1;
  }
  if (other.length) console.log('\nanother object under the same number (left without a record):\n  ' + other.join('\n  '));
  console.log('\n' + Object.entries(counts).sort().map(([k, v]) => k.padEnd(10) + ' ' + v).join('\n'));

  const out = JSON.stringify({
    built: a.date,
    source: 'CelesTrak (celestrak.org): SATCAT (pub/satcat.csv) and the GP element-set lists',
    n: cat.length,
    sum: catSum(cat.map(e => e.satnum)),
    type, purpose
  }) + '\n';
  fs.writeFileSync(OUT, out);
  console.log('\nwritten: ' + OUT + '  (' + Buffer.byteLength(out) + ' bytes, ' + zlib.gzipSync(out, { level: 9 }).length + ' gzipped)');
})().catch(e => { console.error(e); process.exit(1); });
