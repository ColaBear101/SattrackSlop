/*
 * Bake data/transponders.json from SatNOGS DB: what the catalogue's spacecraft listen on, and what they send back.
 *
 * The downlink table (data/transmitters.json, fetch-transmitters.js) is a reference for listening: it drops every
 * uplink, keeps a mode and a frequency, and caps each object at four records, lowest first. Working a satellite
 * needs what it leaves out: the uplink the spacecraft listens on, the edges of a linear transponder's passband,
 * whether it inverts, the uplink mode and the CTCSS tone of an FM repeater. They come from the same anonymous
 * endpoint and the same records (SatNOGS DB, CC BY-SA 4.0), adapted a second time into a file of the page's own,
 * so the page never asks SatNOGS anything. data/transmitters.json is not touched: its records, and the #dopsel
 * options and Doppler rows read from them, stay as they are.
 *
 * Polite: one request per page of the API, with a User-Agent that names the repository. On 2026-10-17 at 05:01:30
 * UTC it answered with one unpaginated list, 5,118 records (3,947,602 bytes); that answer was kept, and the file
 * is baked from it with --from, no request. A page of a paginated answer ({count, next, results}) would be
 * followed by its `next` link, one page at a time, up to MAX_PAGES; an answer with pages still to come after
 * those, or with fewer or more records than the count it gives, writes nothing and exits with an error, as a
 * partial table would leave spacecraft out without a word.
 *
 * What is kept, and why (each record is one SatNOGS transmitter record):
 *   - objects in the embedded catalogue (data/catalogue.txt) only, by NORAD number. The rest cannot be picked.
 *   - status 'active' only, as in the downlink table: a dead transponder on a live satellite relays nothing.
 *   - an uplink and a downlink, both present (uplink_low and downlink_low positive numbers). A downlink-only
 *     record is the downlink table's business; the uplink-only ones (CHUBUSAT 2 and 3) cannot be heard back.
 *   - every edge in an amateur band (ITU amateur service, any region: BANDS below), each leg inside one band. Not
 *     the narrower amateur-satellite sub-bands: AO-7's Mode B uplink at 432.125 MHz predates them. This drops
 *     the S-band TT&C links of commercial cubesats, the maritime VDES link of NORSAT 2, a laser retroreflector
 *     filed at 40 GHz and the like, which no amateur station is meant to transmit to.
 *   - a LINEAR passband (type 'Transponder', a range on both legs, the two ranges of equal width, which is what
 *     lets the transponder map one to the other point for point) or a single-frequency PAIR (no range on either
 *     leg: an FM repeater, a digipeater, a transceiver). Anything else (KOSEN-1: an HF receive range reporting on
 *     one UHF frequency) is dropped and logged. A range filed high to low is sorted into ascending order first
 *     ("range normalised"); the invert flag is kept as filed.
 *   - the invert flag of a passband, reconciled: a transponder is one piece of hardware, so every record of an
 *     object on the same four edges must agree. When they do not, a record whose sidebands bear out its own flag
 *     settles it: one filed inverting with its sidebands swapped (USB in, LSB out: the inversion shows) makes all of
 *     them inverting ("invert reconciled"; JO-97's CW record, filed non-inverting beside its inverting SSB record
 *     on the same passband), and one filed non-inverting with the same sideband on both legs (USB in, USB out)
 *     makes all of them non-inverting. When no record settles it, or records settle it both ways, the passband is
 *     dropped. A record whose own sidebands contradict its own flag (swapped but filed non-inverting, or given the
 *     same on both legs but filed inverting) is no evidence, and is dropped too.
 *   - a linear passband's mode "FM" (or "FMN", ...) is written as no mode ("mode dropped"): SatNOGS files QO-100's
 *     SSB-only and digimode segments as FM, the one mode its band plan excludes, and a passband carries what is
 *     put into it; the description says what the segment is for.
 *   - no cap per object (the ISS keeps its five), and records equal in every field the page works with (the four
 *     edges, the invert flag, both modes and the tone) are kept once.
 *   - the CTCSS tone, read from the description ("CTCSS 67.0 Hz", "PL 88.5Hz", "67.0 PL") and kept only when it
 *     is one of the 50 tones of EIA/TIA-603 (CTCSS_HZ below); "no CTCSS any longer" names none.
 *
 * Shape (compact: a lazy chunk the transponder panel asks for at its first opening):
 *   { built, source, licence: 'CC BY-SA 4.0', objects, records,
 *     x: { "<NORAD number, no leading zeros>": [[ulLo, ulHi, dlLo, dlHi, inv, mode, upMode, tone, desc], ...] } }
 *   ulLo..dlHi integer Hz (a pair has ulHi === ulLo and dlHi === dlLo); inv 1 when the passband inverts, else 0
 *   (always 0 for a pair); mode SatNOGS's downlink mode, '' when none; upMode its uplink mode, '' when absent or
 *   the same as mode; tone the CTCSS tone in Hz, 0 when none; desc the description, whitespace folded, cut to 44
 *   characters with an ellipsis (fetch-transmitters.js's rule). Per object: the linear passbands first, then the
 *   pairs, each by uplink, then downlink, then mode. Keys are integer-like, so JSON.stringify writes them in
 *   ascending order: a re-bake that changes nothing changes no byte but `built`.
 * The file is SatNOGS DB data, and so under its licence, CC BY-SA 4.0 (the code that reads it is the repository's).
 *
 *   node verification/tools/fetch-transponders.js                  fetch, write data/transponders.json
 *   node verification/tools/fetch-transponders.js --save <file>    ...and keep the raw answer in <file>
 *   node verification/tools/fetch-transponders.js --from <file>    write data/transponders.json from a kept answer
 *                                                                   ({fetched, transmitters}, no request); a bare
 *                                                                   list of records needs --built <ISO time>
 *
 * The pure part (bake, render, toneOf, BANDS, CTCSS_HZ) is exported, so tests/lib/transponders-data.test.ts can
 * feed it records of its own; run as a script, it bakes.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const API = 'https://db.satnogs.org/api/transmitters/?format=json';
const UA = 'SattrackSlop-build (github.com/ColaBear101/SattrackSlop; verification/tools/fetch-transponders.js)';
const CATALOG = path.join(__dirname, '..', '..', 'data', 'catalogue.txt');
const OUT = path.join(__dirname, '..', '..', 'data', 'transponders.json');
const SOURCE = 'SatNOGS DB \u2014 db.satnogs.org/api/transmitters/';
const MAX_PAGES = 50;
const DESC_MAX = 44;

/* The amateur service's allocations, MHz, any ITU region (the HF bands a satellite uses, then VHF up). */
const BANDS = [
  [7, 7.3], [14, 14.35], [18.068, 18.168], [21, 21.45], [24.89, 24.99], [28, 29.7], [50, 54], [144, 148], [220, 225],
  [420, 450], [902, 928], [1240, 1300], [2300, 2450], [3300, 3500], [5650, 5925], [10000, 10500], [24000, 24250],
  [47000, 47200]
].map(([lo, hi]) => [Math.round(lo * 1e6), Math.round(hi * 1e6)]);

/* The 50 CTCSS tones of EIA/TIA-603, Hz, ascending (src/lib/data/transponders.ts carries the same list; a test holds
   the two equal). */
const CTCSS_HZ = [
  67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8,
  123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9,
  183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1
];

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const fold = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const mhz = hz => (hz / 1e6).toFixed(hz % 1000 ? 4 : 3);
const leg = (lo, hi) => lo === hi ? mhz(lo) : mhz(lo) + '-' + mhz(hi);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/* the band an edge lies in, or -1 */
const bandOf = hz => BANDS.findIndex(([lo, hi]) => hz >= lo && hz <= hi);

/* The tone a description names, Hz: "CTCSS 67.0 Hz" or "PL 88.5Hz", else "67.0 PL"; 0 when it names none. */
function toneOf(desc) {
  const m = /\b(?:CTCSS|PL)\s*(\d{2,3}(?:\.\d)?)\s*(?:Hz)?/i.exec(desc) || /(\d{2,3}\.\d)\s*(?:Hz\s*)?(?:PL|CTCSS)\b/i.exec(desc);
  return m ? Number(m[1]) : 0;
}

/* One leg's edges as integer Hz, ascending: { lo, hi, swapped }, or null when there is no such leg, or 'bad' when an edge
   is there but is not a frequency. A missing high edge is the low one (a single frequency). */
function edges(lo, hi) {
  if (typeof lo !== 'number' || !Number.isFinite(lo) || lo <= 0) return null;
  if (hi == null) hi = lo;
  if (typeof hi !== 'number' || !Number.isFinite(hi) || hi <= 0) return 'bad';
  lo = Math.round(lo); hi = Math.round(hi);
  return hi < lo ? { lo: hi, hi: lo, swapped: true } : { lo, hi, swapped: false };
}

/* USB in, LSB out (or the other way): the sidebands show an inversion. Modes as SatNOGS files them, upper-cased; an uplink mode
   SatNOGS does not give shows nothing either way (the file writes it as '', and the page derives it from the flag). */
const SIDEBANDS = new Set(['USB', 'LSB']);
const sidebands = (down, up) => SIDEBANDS.has(down) && SIDEBANDS.has(up);

/* Bake a list of SatNOGS transmitter records for a catalogue (Map of NORAD number without leading zeros -> name).
   Returns the table and what was dropped or changed, by reason, one line per record. Pure: no file, no network. */
function bake(list, cat) {
  const funnel = { records: list.length, ours: 0, active: 0, uplink: 0, downlink: 0, bands: 0, shape: 0, invert: 0, kept: 0 };
  const dropped = { noUplink: [], noDownlink: [], outOfBand: [], shape: [], widths: [], invert: [], sideband: [], duplicate: [] };
  const notes = { normalised: [], fmDropped: [], reconciled: [], toneRefused: [], drift: [] };
  const by = new Map();

  for (const r of list) {
    const id = r && r.norad_cat_id != null ? String(r.norad_cat_id) : null;
    if (!id || !cat.has(id)) continue;
    funnel.ours++;
    if (r.status !== 'active') continue;
    funnel.active++;
    const name = cat.get(id);
    const desc = fold(r.description);
    const say = (s) => String(id).padStart(5) + ' ' + name + ': ' + s + (desc ? '  "' + desc + '"' : '');
    const ul = edges(r.uplink_low, r.uplink_high), dl = edges(r.downlink_low, r.downlink_high);
    if (ul === null) { dropped.noUplink.push(say('no uplink')); continue; }
    funnel.uplink++;
    if (dl === null) { dropped.noDownlink.push(say('uplink ' + leg(ul.lo, ul.hi) + ', no downlink')); continue; }
    funnel.downlink++;
    if (ul === 'bad' || dl === 'bad') { dropped.shape.push(say('an edge that is not a frequency')); continue; }
    const where = leg(ul.lo, ul.hi) + ' -> ' + leg(dl.lo, dl.hi) + ' MHz';
    if (bandOf(ul.lo) < 0 || bandOf(ul.lo) !== bandOf(ul.hi) || bandOf(dl.lo) < 0 || bandOf(dl.lo) !== bandOf(dl.hi)) {
      dropped.outOfBand.push(say(where)); continue;
    }
    funnel.bands++;
    const ranged = ul.hi > ul.lo || dl.hi > dl.lo;
    const linear = r.type === 'Transponder' && ul.hi > ul.lo && dl.hi > dl.lo;
    if (ranged && !linear) { dropped.shape.push(say(String(r.type) + ' ' + where)); continue; }
    if (linear && ul.hi - ul.lo !== dl.hi - dl.lo) { dropped.widths.push(say(where + ': widths ' + (ul.hi - ul.lo) + ' and ' + (dl.hi - dl.lo) + ' Hz')); continue; }
    funnel.shape++;
    if (ul.swapped || dl.swapped) notes.normalised.push(say('range normalised to ' + where));

    const rawDown = fold(r.mode), rawUp = fold(r.uplink_mode);
    let mode = rawDown, up = rawUp;
    if (linear && (/^FM/i.test(mode) || /^FM/i.test(up))) {
      notes.fmDropped.push(say(where + ': linear passband filed as ' + (mode || '-') + '/' + (up || '-') + ', mode dropped'));
      if (/^FM/i.test(mode)) mode = '';
      if (/^FM/i.test(up)) up = '';
    }
    const named = toneOf(desc);
    const tone = CTCSS_HZ.includes(named) ? named : 0;
    if (named && !tone) notes.toneRefused.push(say(named + ' Hz is not an EIA/TIA-603 tone'));
    if (r.downlink_drift || r.uplink_drift) notes.drift.push(say('drift: uplink ' + (r.uplink_drift || 0) + ', downlink ' + (r.downlink_drift || 0) + ' ppb'));
    const cut = desc.length > DESC_MAX ? desc.slice(0, DESC_MAX - 1).trimEnd() + '\u2026' : desc;
    const c = {
      id, linear, say, where,
      down: rawDown.toUpperCase(), up: rawUp.toUpperCase(),
      rec: [ul.lo, ul.hi, dl.lo, dl.hi, linear && r.invert === true ? 1 : 0, mode, up === mode ? '' : up, tone, cut]
    };
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(c);
  }

  const x = {};
  let records = 0;
  /* x lists integer-like keys in ascending order whatever order they are set in, and JSON.stringify writes them so */
  for (const [id, cands] of by) {
    /* the invert flag: one per passband (the four edges) */
    const groups = new Map();
    for (const c of cands) if (c.linear) {
      const k = c.rec.slice(0, 4).join(',');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    const gone = new Set();
    for (const g of groups.values()) {
      if (new Set(g.map(c => c.rec[4])).size < 2) continue;
      /* what settles it: a record whose sidebands bear out its own flag, either way. Swapped (USB in, LSB out) and filed
         inverting shows the inversion; the same sideband on both legs and filed non-inverting shows there is none. A record
         whose sidebands contradict its own flag is no evidence (the sideband rule below drops it). */
      const inv = g.filter(c => c.rec[4] === 1 && sidebands(c.down, c.up) && c.down !== c.up);
      const non = g.filter(c => c.rec[4] === 0 && sidebands(c.down, c.up) && c.down === c.up);
      const shows = (inv.length > 0) !== (non.length > 0) ? (inv[0] || non[0]) : null;
      if (shows) {
        const to = shows.rec[4];
        for (const c of g) if (c.rec[4] !== to) {
          c.rec[4] = to;
          notes.reconciled.push(c.say(c.where + ' ' + (c.down || '-') + ': filed ' + (to ? 'non-inverting beside an inverting' : 'inverting beside a non-inverting')
            + ' record, ' + shows.up + ' in, ' + shows.down + ' out'));
        }
      } else {
        const why = inv.length
          ? 'and its records show both: ' + inv[0].up + ' in, ' + inv[0].down + ' out, filed inverting, and ' + non[0].up + ' in, ' + non[0].down + ' out, filed non-inverting'
          : 'and no record shows which is right';
        for (const c of g) { gone.add(c); dropped.invert.push(c.say(c.where + ': invert flags disagree on one passband, ' + why)); }
      }
    }
    let list = cands.filter(c => !gone.has(c));
    funnel.invert += list.length;
    list = list.filter(c => {
      if (!c.linear || !sidebands(c.down, c.up) || (c.down !== c.up) === (c.rec[4] === 1)) return true;
      dropped.sideband.push(c.say(c.where + ': ' + c.up + ' in, ' + c.down + ' out, filed ' + (c.rec[4] ? 'inverting' : 'non-inverting')));
      return false;
    });
    /* by every field, so the order, and which of two duplicates is kept, do not depend on the order SatNOGS answers in */
    list.sort((a, b) => (a.linear === b.linear ? 0 : a.linear ? -1 : 1)
      || a.rec[0] - b.rec[0] || a.rec[2] - b.rec[2] || cmp(a.rec[5], b.rec[5]) || cmp(a.rec[6], b.rec[6])
      || a.rec[1] - b.rec[1] || a.rec[3] - b.rec[3] || a.rec[4] - b.rec[4] || a.rec[7] - b.rec[7] || cmp(a.rec[8], b.rec[8]));
    const seen = new Set();
    list = list.filter(c => {
      const k = JSON.stringify(c.rec.slice(0, 8));
      if (!seen.has(k)) { seen.add(k); return true; }
      dropped.duplicate.push(c.say(c.where + ': the same as a record kept'));
      return false;
    });
    if (list.length) { x[id] = list.map(c => c.rec); records += list.length; }
  }
  funnel.kept = records;
  return { x, objects: Object.keys(x).length, records, funnel, dropped, notes };
}

/* The file's text, as data/transponders.json holds it. */
function render(built, b) {
  return JSON.stringify({ built, source: SOURCE, licence: 'CC BY-SA 4.0', objects: b.objects, records: b.records, x: b.x }) + '\n';
}

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
  let url = API, pages = 0, count = null;
  const t0 = Date.now();
  while (url && pages < MAX_PAGES) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) { console.error('SatNOGS returned HTTP ' + res.status + ' for ' + url); process.exit(1); }
    const body = await res.json();
    pages++;
    if (Array.isArray(body)) { out.push(...body); url = null; }
    else if (body && Array.isArray(body.results)) {
      out.push(...body.results); url = body.next || null;
      if (count === null && Number.isInteger(body.count)) count = body.count;
    }
    else { console.error('SatNOGS answered with neither a list nor a page of one: ' + JSON.stringify(body).slice(0, 200)); process.exit(1); }
  }
  /* a partial list would bake a table with spacecraft missing and say nothing: write nothing instead */
  if (url) {
    console.error('SatNOGS has pages still to come after ' + MAX_PAGES + ' (' + out.length + ' records read, next ' + url + '): nothing written');
    process.exit(1);
  }
  if (count !== null && out.length !== count) {
    console.error('SatNOGS counts ' + count + ' records, and its pages held ' + out.length + ': nothing written');
    process.exit(1);
  }
  console.log('SatNOGS DB        : ' + out.length + ' transmitter records in ' + pages + ' request(s), ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  return { fetched: new Date().toISOString(), pages, url: API, transmitters: out };
}

async function main() {
  const cat = catalogue();
  console.log('embedded catalogue: ' + cat.size + ' objects');

  const from = arg('--from'), save = arg('--save');
  let raw = from ? JSON.parse(fs.readFileSync(from, 'utf8')) : await download();
  if (save && !from) { fs.writeFileSync(save, JSON.stringify(raw)); console.log('raw answer kept in ' + save); }
  if (Array.isArray(raw)) {
    const built = arg('--built');
    if (!built || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(built) || !Number.isFinite(Date.parse(built))) {
      console.error('a bare list of records says not when it was fetched: give --built <ISO time, UTC, e.g. 2026-10-17T05:01:30.000Z>');
      process.exit(1);
    }
    raw = { fetched: built, transmitters: raw };
  }
  if (!raw || !Array.isArray(raw.transmitters) || typeof raw.fetched !== 'string') {
    console.error('not a kept answer: expected {fetched, transmitters: [...]} or a list of records');
    process.exit(1);
  }
  if (from) console.log('kept answer       : ' + raw.transmitters.length + ' records, fetched ' + raw.fetched + ' (' + from + ')');

  const b = bake(raw.transmitters, cat);
  const f = b.funnel, d = b.dropped, n = b.notes;
  const row = (label, s) => console.log('  ' + label.padEnd(30) + ': ' + s);
  console.log('\nSatNOGS records   : ' + f.records);
  row('of catalogue objects', f.ours + ' (' + (f.records - f.ours) + ' are not)');
  row('active', f.active + ' (' + (f.ours - f.active) + ' are not)');
  row('with an uplink', f.uplink + ' (' + d.noUplink.length + ' have none)');
  row('...and a downlink', f.downlink + ' (' + d.noDownlink.length + ' uplink-only)');
  row('every edge in an amateur band', f.bands + ' (' + d.outOfBand.length + ' out)');
  row('a linear passband or a pair', f.shape + ' (' + (d.shape.length + d.widths.length) + ' neither, or widths that differ)');
  row('invert flags that agree', f.invert + ' (' + d.invert.length + ' dropped, ' + n.reconciled.length + ' reconciled)');
  row('sidebands as the flag says', (f.invert - d.sideband.length) + ' (' + d.sideband.length + ' dropped)');
  row('exact duplicates', String(d.duplicate.length));
  console.log('kept              : ' + b.records + ' records on ' + b.objects + ' objects ('
    + Object.values(b.x).flat().filter(t => t[1] > t[0]).length + ' linear passbands on '
    + Object.values(b.x).filter(l => l.some(t => t[1] > t[0])).length + ' objects)');

  const block = (title, lines) => { console.log('\n' + title + ' (' + lines.length + ')'); for (const l of lines) console.log('  ' + l); };
  block('uplink-only', d.noDownlink);
  block('out of the amateur bands', d.outOfBand);
  block('neither a passband nor a pair', d.shape);
  block('passband widths differ', d.widths);
  block('invert flags disagree', d.invert);
  block('sidebands contradict the invert flag', d.sideband);
  block('duplicates', d.duplicate);
  block('range normalised', n.normalised);
  block('invert reconciled', n.reconciled);
  block('linear passband filed as FM: mode dropped', n.fmDropped);
  block('tone not an EIA/TIA-603 tone', n.toneRefused);
  block('drift given (not used)', n.drift);

  console.log('\nrecords');
  for (const [id, list] of Object.entries(b.x))
    for (const t of list) console.log('  ' + id.padStart(5) + ' ' + (cat.get(id) || '').padEnd(22) + ' ' + JSON.stringify(t));

  const out = render(raw.fetched, b);
  fs.writeFileSync(OUT, out);
  console.log('\nwritten: ' + OUT + '  (' + Buffer.byteLength(out) + ' bytes, ' + zlib.gzipSync(out, { level: 9 }).length + ' gzipped)');
}

module.exports = { bake, render, toneOf, BANDS, CTCSS_HZ, DESC_MAX, SOURCE };
if (require.main === module) main();
