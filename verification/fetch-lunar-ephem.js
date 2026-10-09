/* Bake lunar orbiter ephemerides from JPL Horizons.
 *
 * Horizons sends no Access-Control-Allow-Origin, so a browser cannot fetch it.
 * This runs once, here, and the result is embedded — the same arrangement as
 * the Earth TLE catalogue. It writes the TRACKED table and the bake instant
 * straight into moon/moondata.js, so what the page ships is exactly what this
 * script produced: there is no hand-copying step for a unit mistake to hide in.
 *
 * Element sets are requested daily, Moon-centred, in ICRF EQUATORIAL
 * (REF_PLANE='FRAME'). The default is the ecliptic, and silently taking it
 * would tilt every sub-spacecraft point by the obliquity.
 *
 * URL quoting rules the hard way: COMMAND/CENTER/REF_PLANE/STEP_SIZE must be
 * quoted (%27), START_TIME/STOP_TIME must NOT be, and a wrongly quoted
 * parameter is ignored in silence rather than rejected — a run that looks fine
 * can be answering a completely different question.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
/* Raw Horizons responses are cached here, one file per craft per day, so a
   rerun the same day does not hit JPL again and a bake on a later day always
   fetches fresh. */
const TMP = path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp')
                                                 : path.join(os.tmpdir(), 'gtc-lunar'), '/');
fs.mkdirSync(TMP, { recursive: true });
const MOONDATA = path.join(__dirname, '..', 'public', 'moon', 'moondata.js');

const CRAFT = [
  { id: '-85',  key: 'lro',  name: 'LRO',
    from: '2026-09-01', to: '2027-12-31' },
  { id: '-152', key: 'ch2',  name: 'Chandrayaan-2 Orbiter',
    from: '2026-09-01', to: '2026-10-10' },
  { id: '-155', key: 'kplo', name: 'Danuri (KPLO)',
    from: '2026-09-01', to: '2027-04-01' }
];

const base = 'https://ssd.jpl.nasa.gov/api/horizons.api?format=text'
           + '&OBJ_DATA=YES&MAKE_EPHEM=YES&EPHEM_TYPE=ELEMENTS'
           + "&CENTER=%27500@301%27&REF_PLANE=%27FRAME%27&OUT_UNITS=%27KM-S%27";

async function grab(c){
  const file = TMP + 'el_' + c.key + '_' + new Date().toISOString().slice(0,10) + '.txt';
  if (fs.existsSync(file)) return { txt: fs.readFileSync(file, 'utf8'), at: fs.statSync(file).mtimeMs };
  const url = base + "&COMMAND=%27" + encodeURIComponent(c.id) + "%27"
            + '&START_TIME=' + c.from + '&STOP_TIME=' + c.to
            + "&STEP_SIZE=%271%20d%27";
  /* A long LRO request takes about a minute to generate, and the connection is
     sometimes reset partway through. Three tries, then give up loudly. */
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url);
      const t = await r.text();
      fs.writeFileSync(file, t);
      return { txt: t, at: Date.now() };
    } catch (e) {
      if (k === 3) throw e;
      console.log('  ' + c.name + ': ' + e.message + ', retrying');
    }
  }
}

/* ---- TDB -> UTC ------------------------------------------------------------
 * Horizons gives osculating elements in TDB and nothing else — asking for
 * TIME_TYPE='UT' is refused outright ("Only TDB is allowed for osculating
 * element TIME_TYPE"). The page's clock is UTC. This script used to turn the
 * TDB Julian date into Unix milliseconds as if it were UTC, which put every
 * anchor 69.184 s late: LRO covers 3.5 degrees of orbit in that time, so every
 * position the page drew was ~113 km behind the one Horizons gives for the same
 * UTC instant, against a claimed ~1 km at an anchor. The validation missed it
 * because it compared in TT throughout and was consistent with itself.
 *
 *   TDB - UTC = (TT - TAI) + (TAI - UTC) = 32.184 s + 37 s
 *
 * The periodic TDB - TT term, under 1.7 ms, is dropped: LRO moves 3 m in it.
 * TAI - UTC has been 37 s since 2017-01-01, and IERS Bulletin C 72 (July 2026)
 * rules out a leap second at the end of December 2026, so 37 s is certain up to
 * 2027-06-30. A later epoch still gets 37 s, with a warning, because the leap
 * second that could change it had not been decided when this was written.  */
const TT_TAI = 32.184, TAI_UTC = 37;
const LEAP_FROM = Date.UTC(2017, 0, 1), LEAP_KNOWN_TO = Date.UTC(2027, 6, 1);
let leapWarned = false;
function tdbJdToUtcMs(jd){
  const ms = Math.round((jd - 2440587.5) * 86400000 - (TT_TAI + TAI_UTC) * 1000);
  if (ms < LEAP_FROM) throw new Error('epoch before 2017: TAI-UTC was not 37 s then');
  if (ms >= LEAP_KNOWN_TO && !leapWarned) {
    leapWarned = true;
    console.log('  note: epochs after 2027-06-30 assume TAI-UTC is still 37 s — check IERS Bulletin C');
  }
  return ms;
}

/* Horizons ELEMENTS blocks look like:
     2461284.500000000 = A.D. 2026-Sep-01 00:00:00.0000 TDB
      EC= 1.2e-02 QR= 1.8e+03 IN= 8.2e+01
      OM= 2.4e+01 W = 5.2e+01 Tp=  2461284.6
      N = 5.1e-02 MA= 3.0e+02 TA= 3.0e+02
      A = 1.8e+03 AD= 1.8e+03 PR= 7.0e+03
   so the keys are scattered across three lines per epoch. Scrape by key name
   rather than by column, which is fragile against Horizons' spacing. */
function parseElements(txt){
  const i = txt.indexOf('$$SOE'), j = txt.indexOf('$$EOE');
  if (i < 0 || j < 0) return null;
  /* The conversion above is only right if the epochs really are TDB. Horizons
     says so in the table header; refuse to guess if it ever says otherwise. */
  if (!/^JDTDB/m.test(txt.slice(0, i))) throw new Error('element epochs are not labelled TDB');
  const rows = [];
  let cur = null;
  for (const ln of txt.slice(i+5, j).split('\n')) {
    const jd = ln.match(/^(\d+\.\d+)\s*=\s*A\.D\./);
    if (jd) { if (cur) rows.push(cur); cur = { jd: +jd[1] }; continue; }
    if (!cur) continue;
    /* The key MUST be anchored to start-of-line or whitespace. Without that,
       the pattern for "A" happily matches the A inside "MA=" and "TA=", and
       the semi-major axis comes back as the mean anomaly — which is exactly
       what happened: LRO appeared to have a = 113.9 km and a 1.8-minute
       period, i.e. an orbit inside the Moon. */
    const grab1 = k => {
      const m = ln.match(new RegExp('(?:^|\\s)' + k + '\\s*=\\s*(-?[\\d.]+E?[+-]?\\d*)'));
      return m ? +m[1] : undefined;
    };
    for (const k of ['EC','IN','OM','W','MA','A','PR','QR','AD']) {
      const v = grab1(k);
      if (v !== undefined && cur[k] === undefined) cur[k] = v;
    }
  }
  if (cur) rows.push(cur);
  return rows.filter(r => r.A > 0 && r.EC !== undefined && r.MA !== undefined);
}

/* ---- where the tracking data stops -----------------------------------------
 * A Horizons spacecraft trajectory is a fit to tracking data up to some date
 * and a PREDICTION after it, and a prediction cannot know about manoeuvres or
 * the next orbit determination. The record header says where the join is, in
 * wording that differs per mission:
 *   LRO     "... with prediction after 2026-Aug-04."
 *   CH2     "... fit to tracking data through 2026-Sep-13, with a prediction thereafter."
 *   Danuri  "Tag-up w/data through September 21, prediction thereafter."   (no year)
 * Returned as the UTC midnight after the last day of data — the first instant
 * that is purely predicted — or null if no pattern matched, which the bake
 * reports rather than papering over. */
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function predictFrom(txt, revised){
  const hdr = txt.slice(0, txt.indexOf('$$SOE') >= 0 ? txt.indexOf('$$SOE') : undefined).replace(/\s+/g, ' ');
  let m = hdr.match(/prediction after (\d{4})-([A-Z][a-z]{2})-(\d{2})/i)
       || hdr.match(/data through (\d{4})-([A-Z][a-z]{2})-(\d{2})/i);
  const mon = s => MON[s[0].toUpperCase() + s.slice(1,3).toLowerCase()];
  if (m && mon(m[2]) !== undefined) return Date.UTC(+m[1], mon(m[2]), +m[3] + 1);
  m = hdr.match(/data through ([A-Z][a-z]+) (\d{1,2})(?:,? (\d{4}))?/);
  if (m && mon(m[1]) !== undefined) {
    const y = m[3] ? +m[3] : +((revised || '').match(/\d{4}/) || [])[0];
    if (y) return Date.UTC(y, mon(m[1]), +m[2] + 1);
  }
  return null;
}

function meta(txt){
  const rev = (txt.match(/Revised\s*:\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4})/) || [])[1] || null;
  const cov = [];
  const re = /^\s{2}(\S.*?)\s{2,}(\d{4}-[A-Z][a-z]{2}-\d{2}\s+\d{2}:\d{2})\s{2,}(\d{4}-[A-Z][a-z]{2}-\d{2}\s+\d{2}:\d{2})\s*$/gm;
  let m; while ((m = re.exec(txt)) && cov.length < 6) cov.push(m[1].trim()+' : '+m[2]+' -> '+m[3]);
  return { revised: rev, trajectory: cov, predictFrom: predictFrom(txt, rev) };
}

(async () => {
  const out = {}, packed = [];
  let bakedAt = Infinity;
  for (const c of CRAFT) {
    const { txt, at } = await grab(c);
    const rows = parseElements(txt);
    if (!rows || !rows.length) {
      console.log(c.name + ': FAILED\n' + txt.slice(0, 400));
      process.exitCode = 1;
      return;
    }
    bakedAt = Math.min(bakedAt, at);
    const sets = rows.map(r => ({
      epoch: tdbJdToUtcMs(r.jd),
      a: +r.A.toFixed(3), e: +r.EC.toFixed(7),
      i: +r.IN.toFixed(4), raan: +r.OM.toFixed(4),
      argp: +r.W.toFixed(4), M: +r.MA.toFixed(4)
    }));
    const first = sets[0], last = sets[sets.length-1];
    const alt = s => [ (s.a*(1-s.e) - 1737.4), (s.a*(1+s.e) - 1737.4) ];
    const [p0,ap0] = alt(first);
    console.log(c.name.padEnd(24) + sets.length + ' daily sets   ' +
      new Date(first.epoch).toISOString().slice(0,19) + 'Z -> ' +
      new Date(last.epoch).toISOString().slice(0,19) + 'Z');
    console.log('  a ' + first.a.toFixed(1) + ' km  e ' + first.e.toFixed(6) +
      '  i ' + first.i.toFixed(2) + ' (ICRF)  alt ' + p0.toFixed(0) + ' x ' + ap0.toFixed(0) + ' km' +
      '  period ' + (2*Math.PI*Math.sqrt(Math.pow(first.a,3)/4902.800066)/60).toFixed(1) + ' min');
    const m = meta(txt);
    const nPred = m.predictFrom === null ? null : sets.filter(s => s.epoch >= m.predictFrom).length;
    console.log('  Horizons record revised ' + m.revised + ';  ' + (m.predictFrom === null
      ? 'NO prediction boundary found in the header — check it by hand'
      : 'predicted from ' + new Date(m.predictFrom).toISOString().slice(0,10) +
        ', which is ' + nPred + ' of ' + sets.length + ' anchors'));
    out[c.key] = { name: c.name, horizons: c.id, sets, meta: m };
    packed.push({ key: c.key, name: c.name, horizons: c.id, revised: m.revised,
      predictFrom: m.predictFrom,
      sets: sets.map(s => [s.epoch, s.a, s.e, s.i, s.raan, s.argp, s.M]) });
  }
  fs.writeFileSync(TMP + 'orbiters.json', JSON.stringify(out));

  /* Into the shipped data file. Two lines change and nothing else: the TRACKED
     table and the bake instant, which is when Horizons was actually asked. */
  let src = fs.readFileSync(MOONDATA, 'utf8');
  const n0 = src.length;
  src = src.replace(/^const TRACKED = .*;$/m, () => 'const TRACKED = ' + JSON.stringify(packed) + ';')
           .replace(/^(\s*baked: )\d+,/m, (s, p) => p + Math.round(bakedAt) + ',');
  if (!/^const TRACKED = \[\{"key"/m.test(src)) throw new Error('TRACKED line not found in moondata.js');
  fs.writeFileSync(MOONDATA, src);
  console.log('\nwrote moon/moondata.js  ' + (src.length/1024).toFixed(0) + ' KB (was ' +
    (n0/1024).toFixed(0) + ' KB), baked ' + new Date(bakedAt).toISOString());
})();
