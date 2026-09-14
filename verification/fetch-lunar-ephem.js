/* Bake lunar orbiter ephemerides from JPL Horizons.
 *
 * Horizons sends no Access-Control-Allow-Origin, so a browser cannot fetch it.
 * This runs once, here, and the result is embedded — the same arrangement as
 * the Earth TLE catalogue.
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
const TMP = process.env.CLAUDE_JOB_DIR + '/tmp/';

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
  const file = TMP + 'el_' + c.key + '.txt';
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const url = base + "&COMMAND=%27" + encodeURIComponent(c.id) + "%27"
            + '&START_TIME=' + c.from + '&STOP_TIME=' + c.to
            + "&STEP_SIZE=%271%20d%27";
  const r = await fetch(url);
  const t = await r.text();
  fs.writeFileSync(file, t);
  return t;
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

function meta(txt){
  const rev = (txt.match(/Revised\s*:\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4})/) || [])[1] || null;
  const cov = [];
  const re = /^\s{2}(\S.*?)\s{2,}(\d{4}-[A-Z][a-z]{2}-\d{2}\s+\d{2}:\d{2})\s{2,}(\d{4}-[A-Z][a-z]{2}-\d{2}\s+\d{2}:\d{2})\s*$/gm;
  let m; while ((m = re.exec(txt)) && cov.length < 6) cov.push(m[1].trim()+' : '+m[2]+' -> '+m[3]);
  return { revised: rev, trajectory: cov };
}

(async () => {
  const out = {};
  for (const c of CRAFT) {
    const txt = await grab(c);
    const rows = parseElements(txt);
    if (!rows || !rows.length) {
      console.log(c.name + ': FAILED\n' + txt.slice(0, 400));
      continue;
    }
    const sets = rows.map(r => ({
      epoch: Math.round((r.jd - 2440587.5) * 86400000),
      a: +r.A.toFixed(3), e: +r.EC.toFixed(7),
      i: +r.IN.toFixed(4), raan: +r.OM.toFixed(4),
      argp: +r.W.toFixed(4), M: +r.MA.toFixed(4)
    }));
    const first = sets[0], last = sets[sets.length-1];
    const alt = s => [ (s.a*(1-s.e) - 1737.4), (s.a*(1+s.e) - 1737.4) ];
    const [p0,ap0] = alt(first);
    console.log(c.name.padEnd(24) + sets.length + ' daily sets   ' +
      new Date(first.epoch).toISOString().slice(0,10) + ' -> ' +
      new Date(last.epoch).toISOString().slice(0,10));
    console.log('  a ' + first.a.toFixed(1) + ' km  e ' + first.e.toFixed(6) +
      '  i ' + first.i.toFixed(2) + '  alt ' + p0.toFixed(0) + ' x ' + ap0.toFixed(0) + ' km' +
      '  period ' + (2*Math.PI*Math.sqrt(Math.pow(first.a,3)/4902.800066)/60).toFixed(1) + ' min');
    const m = meta(txt);
    console.log('  Horizons record revised ' + m.revised);
    out[c.key] = { name: c.name, horizons: c.id, sets, meta: m };
  }
  fs.writeFileSync(TMP + 'orbiters.json', JSON.stringify(out));
  const kb = (fs.statSync(TMP + 'orbiters.json').size/1024).toFixed(0);
  console.log('\nwrote orbiters.json  ' + kb + ' KB raw');
})();
