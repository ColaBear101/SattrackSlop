const path = require('path');
/* Validate Body.Moon()'s rotation against JPL Horizons.
 *
 * Two requests, deliberately matched in time system:
 *   VECTORS   LRO relative to the Moon, REF_PLANE='FRAME' (ICRF equatorial,
 *             which is what the IAU rotation expects - the DEFAULT is ECLIPTIC
 *             and using it silently tilts everything by the obliquity).
 *   OBSERVER  the Moon as seen FROM LRO, QUANTITIES='14' - the sub-observer
 *             point, which IS the sub-spacecraft point, with Horizons' own
 *             full libration applied. TIME_TYPE='TT' so the epochs line up with
 *             the TDB-labelled vectors to ~2 ms instead of 69 s. At 7009 s per
 *             revolution, 69 s is 3.5 degrees of orbit - it would swamp the
 *             very error being measured.
 */
const fs = require('fs');
const TMP = process.env.CLAUDE_JOB_DIR + '/tmp/';
require(path.join(__dirname, '..', 'core/body.js'));
const M = globalThis.Body.Moon();
const DEG = 180/Math.PI;

/* STEP_SIZE contains a space, so it must be QUOTED as well as encoded:
   %27 is the quote, %20 the space. Unquoted, Horizons parses "30 M" as two
   constants and rejects the whole request. Dates must NOT be quoted, which is
   the opposite rule and the reason the first attempt silently returned a year
   of defaults instead of the range asked for. */
const START = '2026-09-14', STOP = '2026-09-20', STEP = '%2730%20m%27';
const base = 'https://ssd.jpl.nasa.gov/api/horizons.api?format=text&OBJ_DATA=NO&MAKE_EPHEM=YES';

async function get(url, file){
  if (fs.existsSync(TMP+file)) return fs.readFileSync(TMP+file, 'utf8');
  const r = await fetch(url);
  const t = await r.text();
  fs.writeFileSync(TMP+file, t);
  return t;
}

(async () => {
  const vecs = await get(base + "&EPHEM_TYPE=VECTORS&COMMAND='-85'&CENTER='500@301'" +
    "&REF_PLANE='FRAME'&VEC_TABLE='2'&OUT_UNITS='KM-S'" +
    `&START_TIME=${START}&STOP_TIME=${STOP}&STEP_SIZE=${STEP}`, 'lro_vec.txt');
  const obs = await get(base + "&EPHEM_TYPE=OBSERVER&COMMAND='301'&CENTER='500@-85'" +
    "&QUANTITIES='14'&ANG_FORMAT=DEG&EXTRA_PREC=YES&TIME_TYPE='TT'" +
    `&START_TIME=${START}&STOP_TIME=${STOP}&STEP_SIZE=${STEP}`, 'lro_sub.txt');

  const body = s => s.slice(s.indexOf('$$SOE')+5, s.indexOf('$$EOE'));
  if (vecs.indexOf('$$SOE') < 0) { console.log('VECTORS failed:\n' + vecs.slice(0,900)); return; }
  if (obs.indexOf('$$SOE') < 0) { console.log('OBSERVER failed:\n' + obs.slice(0,900)); return; }

  /* "JD = A.D. date TDB" on one line, " X = .. Y = .. Z = .." on the next */
  const V = [];
  const lines = body(vecs).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+\.\d+)\s*=\s*A\.D\./);
    if (!m) continue;
    const xyz = (lines[i+1]||'').match(
      /X\s*=\s*(-?[\d.]+E[+-]\d+)\s*Y\s*=\s*(-?[\d.]+E[+-]\d+)\s*Z\s*=\s*(-?[\d.]+E[+-]\d+)/);
    if (!xyz) continue;
    V.push({ jd: +m[1], r: {x:+xyz[1], y:+xyz[2], z:+xyz[3]} });
  }
  /* observer: date, sub-lon, sub-lat */
  const O = [];
  for (const ln of body(obs).split('\n')) {
    const f = ln.trim().split(/\s+/);
    if (f.length < 4 || !/^\d{4}-[A-Z]/.test(f[0])) continue;
    O.push({ lon: +f[2], lat: +f[3] });
  }
  console.log('vector rows ' + V.length + ', sub-point rows ' + O.length);
  const n = Math.min(V.length, O.length);
  if (!n) return;

  const errs = [], errsNoLib = [];
  for (let i = 0; i < n; i++) {
    const date = new Date((V[i].jd - 2440587.5) * 86400000);
    const g = M.toGeodetic(V[i].r, M.spin(date));
    const lat = g.latitude*DEG, lon = ((g.longitude*DEG)%360+360)%360;
    /* great-circle separation on the 1737.4 km sphere */
    const sep = (la1, lo1, la2, lo2) => {
      const p1=la1/DEG, p2=la2/DEG, dl=(lo2-lo1)/DEG;
      return Math.acos(Math.max(-1,Math.min(1,
        Math.sin(p1)*Math.sin(p2)+Math.cos(p1)*Math.cos(p2)*Math.cos(dl))))*DEG;
    };
    errs.push(sep(lat, lon, O[i].lat, O[i].lon));

    /* and again with the libration series switched off, to show what it buys */
    const d = (date.getTime() - Date.UTC(2000,0,1,12))/86400000, T = d/36525;
    const o0 = { ra:(269.9949+0.0031*T)/DEG, dec:(66.5392+0.0130*T)/DEG,
                 W:((((38.3213+13.17635815*d-1.4e-12*d*d)%360)+360)%360)/DEG };
    const g0 = M.toGeodetic(V[i].r, o0);
    errsNoLib.push(sep(g0.latitude*DEG, ((g0.longitude*DEG)%360+360)%360, O[i].lat, O[i].lon));
  }
  const stat = a => { const s=a.slice().sort((x,y)=>x-y);
    return { med:s[Math.floor(s.length/2)], max:s[s.length-1],
             p90:s[Math.floor(0.9*(s.length-1))] }; };
  const K = 1737.4*Math.PI/180;   // km per degree on the lunar surface
  const E = stat(errs), N = stat(errsNoLib);
  console.log('\nsub-spacecraft point vs Horizons, ' + n + ' epochs over 6 days:');
  console.log('  WITH libration     median ' + E.med.toFixed(4) + ' deg  (' + (E.med*K).toFixed(2) +
              ' km)   p90 ' + E.p90.toFixed(4) + '   max ' + E.max.toFixed(4) + ' deg (' + (E.max*K).toFixed(2) + ' km)');
  console.log('  WITHOUT libration  median ' + N.med.toFixed(4) + ' deg  (' + (N.med*K).toFixed(1) +
              ' km)   max ' + N.max.toFixed(4) + ' deg (' + (N.max*K).toFixed(1) + ' km)');
  console.log('  -> the 13-term series is worth ' + (N.med/E.med).toFixed(0) + 'x');
})();
