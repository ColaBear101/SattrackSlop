/*
 * Bake data/aliases.json from SatNOGS DB: the other names of the catalogue's spacecraft.
 *
 * The catalogue names an object as its element-set source does, and that is often not the name a radio amateur
 * knows it by: AO-7 is 'OSCAR 7', SO-50 is 'SAUDISAT 1C', FO-29 is 'JAS 2', and RS-44 is filed as the rocket
 * stage it rode on, 'BREEZE-KM R/B'. SatNOGS DB, which the community maintains and which already supplies the
 * transmitter table (fetch-transmitters.js), keeps each satellite's name and its alternative names, anonymously,
 * under CC BY-SA 4.0. The picker matches a search against these as well (src/lib/catalogue/alias.ts), so this
 * bakes the few it needs into a small file of the page's own: the page never asks SatNOGS anything.
 *
 * Polite: one request per page of the API, with a User-Agent that names the repository. On 2026-10-16 it answered
 * with one unpaginated list, 2,839 records in one request of about 5 s; a page of a paginated answer
 * ({count, next, results}) would be followed by its `next` link, one page at a time. A record carries, among
 * others, `norad_cat_id` (a number, or null), `name` (SatNOGS's own: 'DOSAAF-85') and `names` (the alternative
 * names, one string, comma-separated: 'RS-44'; 'AO-7, AMSAT OSCAR 7').
 *
 * What is kept, and why:
 *   - objects in the embedded catalogue (data/catalogue.txt) only, by NORAD number. The rest cannot be picked.
 *   - for each, the SatNOGS name and its alternative names (split at commas and semicolons), but only those a
 *     search would not find already. They are compared as the picker compares a search (NFKC, lowercase, only
 *     letters, marks and digits: "RS-44", "rs44" and "RS 44" are one name), and a name is dropped when that form
 *     is empty, is the catalogue number, or is held in the catalogue name's own form (rank()'s word tier finds
 *     whatever such a name would: ISS for ISS (ZARYA)). One spelling of each form, the first SatNOGS gives.
 *   - what is not a name is dropped (NOT_A_NAME below), and so is a name of more than MAX_LEN characters: those
 *     are acronyms spelled out ('Television Infrared Observation Satellite-N' for TIROS N), which nobody types to
 *     find a spacecraft and which would be a sixth of the file.
 *
 * Shape (as small as it can be: a lazy chunk the picker asks for the first time something is typed):
 *   { built, source, licence: 'CC BY-SA 4.0', a: { "<NORAD number, no leading zeros>": ["AO-7", ...] } }
 * The file is SatNOGS DB data, and so under its licence, CC BY-SA 4.0 (the code that reads it is the repository's).
 *
 *   node verification/tools/fetch-aliases.js                  fetch, write data/aliases.json
 *   node verification/tools/fetch-aliases.js --save <file>    ...and keep the raw answer in <file>
 *   node verification/tools/fetch-aliases.js --from <file>    write data/aliases.json from a kept answer (no request)
 */
const fs = require('fs');
const path = require('path');

const API = 'https://db.satnogs.org/api/satellites/?format=json';
const UA = 'SattrackSlop-build (github.com/ColaBear101/SattrackSlop; verification/tools/fetch-aliases.js)';
const CATALOG = path.join(__dirname, '..', '..', 'data', 'catalogue.txt');
const OUT = path.join(__dirname, '..', '..', 'data', 'aliases.json');
const MAX_PAGES = 50;
const MAX_LEN = 30;

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

/* Not names: an international designator, whole or in a name ("2009-041A", "24128A", "USA 210 2009-057A"), a date ("2010-09-22"), and
   the placeholders of an object nobody has identified yet ("Object A", "Objext AX", "Unknown Satellite - 19093H", "Unknown_3_T11"). A
   search for them would find rows by what is not a name of theirs. */
const NOT_A_NAME = [/\b\d{4}-\d{3}[A-Z]{0,3}\b/, /^\d{2,5}-\d{2,3}/, /^\d{5}[A-Z]{1,3}$/, /\b\d{4}-\d{2}-\d{2}\b/, /^objec?x?t [a-z]{1,3}$/i, /^unknown/i, /unknown satellite/i];

/* the picker's own comparison (src/lib/catalogue/alias.ts, and rank()'s word tier) */
const bare = s => String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');

/* NORAD number (no leading zeros) -> catalogue name */
function catalogue() {
  const lines = fs.readFileSync(CATALOG, 'utf8').split(/\r?\n/);
  const by = new Map();
  for (let i = 1; i < lines.length; i++)
    if (lines[i].startsWith('1 ') && lines[i].length > 7) by.set(String(parseInt(lines[i].substring(2, 7), 10)), lines[i - 1].trim());
  return by;
}

async function download() {
  const out = [];
  let url = API, pages = 0;
  const t0 = Date.now();
  while (url && pages < MAX_PAGES) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) { console.error('SatNOGS returned HTTP ' + res.status + ' for ' + url); process.exit(1); }
    const body = await res.json();
    pages++;
    if (Array.isArray(body)) { out.push(...body); url = null; }
    else if (body && Array.isArray(body.results)) { out.push(...body.results); url = body.next || null; }
    else { console.error('SatNOGS answered with neither a list nor a page of one: ' + JSON.stringify(body).slice(0, 200)); process.exit(1); }
  }
  console.log('SatNOGS DB        : ' + out.length + ' satellites in ' + pages + ' request(s), ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  return { fetched: new Date().toISOString(), pages, satellites: out };
}

(async () => {
  const cat = catalogue();
  console.log('embedded catalogue: ' + cat.size + ' objects');

  const from = arg('--from'), save = arg('--save');
  const raw = from ? JSON.parse(fs.readFileSync(from, 'utf8')) : await download();
  if (save && !from) { fs.writeFileSync(save, JSON.stringify(raw)); console.log('raw answer kept in ' + save); }

  const a = {};
  let ours = 0, offered = 0, kept = 0, notNames = 0, long = 0;
  for (const s of raw.satellites) {
    const id = s.norad_cat_id == null ? null : String(s.norad_cat_id);
    if (!id || !cat.has(id)) continue;
    ours++;
    const own = bare(cat.get(id));
    const names = [s.name].concat(String(s.names || '').split(/[,;\n]/)).map(n => String(n || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const list = a[id] || [];
    const seen = new Set(list.map(bare));
    for (const n of names) {
      offered++;
      const b = bare(n);
      if (!b || b === id || own.includes(b) || seen.has(b)) continue;
      if (NOT_A_NAME.some(re => re.test(n))) { notNames++; continue; }
      if (n.length > MAX_LEN) { long++; continue; }
      seen.add(b); list.push(n); kept++;
    }
    if (list.length) a[id] = list;
  }
  /* in catalogue-number order, so that a re-bake that changes nothing changes no byte but `built` */
  const sorted = {};
  for (const id of Object.keys(a).sort((x, y) => Number(x) - Number(y))) sorted[id] = a[id];

  console.log('\nin the catalogue  : ' + ours + ' SatNOGS records');
  console.log('names offered     : ' + offered);
  console.log('  not names       : ' + notNames + ' (designators, dates, placeholders)');
  console.log('  over ' + MAX_LEN + ' chars   : ' + long);
  console.log('kept              : ' + kept + ' names on ' + Object.keys(sorted).length + ' objects');

  const out = JSON.stringify({
    built: raw.fetched,
    source: 'SatNOGS DB — db.satnogs.org/api/satellites/',
    licence: 'CC BY-SA 4.0',
    a: sorted
  }) + '\n';
  fs.writeFileSync(OUT, out);
  console.log('\nwritten: ' + OUT + '  (' + out.length + ' bytes, ' + require('zlib').gzipSync(out, { level: 9 }).length + ' gzipped)');
})();
