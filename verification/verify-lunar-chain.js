const H = require('./lib/harness');
const path = require('path');
/* End-to-end: baked daily elements -> anchoredTrack -> Body.Moon rotation ->
 * sub-spacecraft lat/lon, compared against Horizons' own sub-observer point.
 *
 * This is the test that matters. The rotation was already checked against
 * Horizons using Horizons' OWN state vectors, which isolated the frame. Here
 * the state comes from the stored element sets instead, so the number includes
 * everything the page will actually do wrong: Kepler propagation away from an
 * anchor, the daily anchor spacing, the rounding applied when baking, and the
 * time scale of the anchor epochs.
 *
 * Two choices keep it honest about that last one:
 *   - the element sets are the ones the page SHIPS, read from moon/moondata.js,
 *     not a side file from the bake - a unit mistake between the two is exactly
 *     what this has to see;
 *   - the reference tables are in UTC, the page's clock (npm run moon fetches
 *     them with TIME_TYPE='UT'). It used to run in TT against TDB epochs, which
 *     agreed with itself to 2 ms while the page, on UTC, sat 69 s - about
 *     113 km of LRO's orbit - away from Horizons.
 */
const fs = require('fs');
const os = require('os');
const TMP = path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp')
                                                 : path.join(os.tmpdir(), 'gtc-lunar'), '/');
H.loadClassic(path.join(H.ROOT, 'public', 'core', 'body.js'));
H.loadClassic(path.join(H.ROOT, 'public', 'core', 'propagator.js'));
H.loadClassic(path.join(H.ROOT, 'public', 'moon', 'moondata.js'));
const M = globalThis.Body.Moon(), P = globalThis.Propagator, MD = globalThis.MoonData;
const DEG = 180/Math.PI;

/* unpacked exactly as moon-track.html does it */
const lro = MD.tracked.find(t => t.key === 'lro');
const sets = lro.sets.map(s => ({epoch:s[0], a:s[1], e:s[2], i:s[3], raan:s[4], argp:s[5], M:s[6]}));
const track = P.anchoredTrack(M, sets, {name:'LRO'});

if (!fs.existsSync(TMP + 'lro_sub_ut.txt') || !fs.existsSync(TMP + 'lro_vec_ut.txt')) {
  console.log('no UTC reference tables in ' + TMP + ' - run `npm run moon` first, which fetches them');
  process.exitCode = 1;
  return;
}
const block = s => s.slice(s.indexOf('$$SOE')+5, s.indexOf('$$EOE'));
const sub = fs.readFileSync(TMP + 'lro_sub_ut.txt', 'utf8');
const vec = fs.readFileSync(TMP + 'lro_vec_ut.txt', 'utf8');
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const O = [];
for (const ln of block(sub).split('\n')) {
  const f = ln.trim().split(/\s+/);
  if (f.length < 4 || !/^\d{4}-[A-Z]/.test(f[0])) continue;
  const [y,mo,d] = f[0].split('-');
  const [hh,mm] = f[1].split(':');
  O.push({ ms: Date.UTC(+y, MON[mo], +d, +hh, +mm), lon: +f[2], lat: +f[3] });
}
/* Horizons' own position at the same UTC instants, for the error in space
   rather than on the ground: "JDUT = A.D. ..." then " X = .. Y = .. Z = .." */
const R = new Map();
const vl = block(vec).split('\n');
for (let i = 0; i < vl.length; i++) {
  const m = vl[i].match(/^(\d+\.\d+)\s*=\s*A\.D\./);
  const xyz = m && (vl[i+1]||'').match(
    /X\s*=\s*(-?[\d.]+E[+-]\d+)\s*Y\s*=\s*(-?[\d.]+E[+-]\d+)\s*Z\s*=\s*(-?[\d.]+E[+-]\d+)/);
  if (xyz) R.set(Math.round((+m[1] - 2440587.5)*1440)*60000, {x:+xyz[1], y:+xyz[2], z:+xyz[3]});
}

const sep = (la1, lo1, la2, lo2) => {
  const p1=la1/DEG, p2=la2/DEG, dl=(lo2-lo1)/DEG;
  return Math.acos(Math.max(-1, Math.min(1,
    Math.sin(p1)*Math.sin(p2) + Math.cos(p1)*Math.cos(p2)*Math.cos(dl))))*DEG;
};
const K = 1737.4*Math.PI/180;

/* Bucket the error by how far the sample sits from its daily anchor. If the
   anchoring story is right, error should grow with that distance and be small
   near zero. */
const buckets = new Map();
const all = [];
for (const o of O) {
  const st = track.at(o.ms);
  if (!st) continue;
  const g = M.toGeodetic(st.r, M.spin(new Date(o.ms)));
  const e = sep(g.latitude*DEG, ((g.longitude*DEG)%360+360)%360, o.lat, o.lon);
  const h3 = R.get(o.ms);
  const d3 = h3 ? Math.hypot(st.r.x-h3.x, st.r.y-h3.y, st.r.z-h3.z) : NaN;
  all.push(e);
  const h = Math.abs(track.ageHours(o.ms));
  const b = Math.min(12, Math.floor(h/2)*2);
  if (!buckets.has(b)) buckets.set(b, {g:[], s:[]});
  buckets.get(b).g.push(e);
  if (isFinite(d3)) buckets.get(b).s.push(d3);
}
const stat = a => { const s=a.slice().sort((x,y)=>x-y);
  return { med:s[Math.floor(s.length/2)], max:s[s.length-1], n:s.length }; };

const A = stat(all);
console.log('LRO sub-spacecraft point: shipped elements (moon/moondata.js) vs Horizons, in UTC');
console.log('  ' + A.n + ' samples over 6 days, 30-minute spacing\n');
console.log('  hours from anchor    n    median ground error        max       median in space');
for (const b of [...buckets.keys()].sort((x,y)=>x-y)) {
  const s = stat(buckets.get(b).g), q = stat(buckets.get(b).s);
  console.log('    ' + String(b).padStart(2) + ' - ' + String(b+2).padStart(2) + ' h' +
    String(s.n).padStart(8) + '   ' + s.med.toFixed(3).padStart(7) + ' deg (' +
    (s.med*K).toFixed(1).padStart(6) + ' km)  ' +
    s.max.toFixed(3).padStart(7) + ' deg (' + (s.max*K).toFixed(1).padStart(5) + ' km)' +
    (q.n ? (q.med.toFixed(1) + ' km').padStart(14) : ''));
}
console.log('\n  overall median ' + A.med.toFixed(3) + ' deg = ' + (A.med*K).toFixed(1) +
            ' km,  max ' + A.max.toFixed(3) + ' deg = ' + (A.max*K).toFixed(1) + ' km');

/* What a SINGLE element set would have done over the same six days - the
   comparison that justifies storing one per day. Set 13 is the anchor at the
   start of this window. */
const one = P.keplerTrack(M, sets[13], {});
const singles = [];
for (const o of O) {
  const st = one.at(o.ms);
  if (!st) continue;
  const g = M.toGeodetic(st.r, M.spin(new Date(o.ms)));
  singles.push({ d:(o.ms - sets[13].epoch)/86400000,
    e: sep(g.latitude*DEG, ((g.longitude*DEG)%360+360)%360, o.lat, o.lon) });
}
console.log('\n  one element set, held for days (why daily anchors exist):');
for (const day of [0,1,2,3,4,5]) {
  const w = singles.filter(s => Math.abs(s.d - day) < 0.25).map(s=>s.e);
  if (!w.length) continue;
  const s = stat(w);
  console.log('    day ' + day + '   median ' + s.med.toFixed(2).padStart(6) +
    ' deg = ' + (s.med*K).toFixed(0).padStart(5) + ' km');
}

/* The one number that has to hold: near an anchor the page must agree with
   Horizons to about a kilometre. A time-scale slip shows up here as ~100 km,
   which is what it did before the bake converted TDB to UTC. */
const near = stat(buckets.get(0).g).med*K;
console.log('\n  ' + (near < 3 ? 'PASS' : 'FAIL') + '  median within two hours of an anchor ' +
            near.toFixed(2) + ' km (limit 3 km)');
if (!(near < 3)) process.exitCode = 1;

/* ---- every tracked craft, in space ------------------------------------------
 * The panel quotes an expected error per craft (MoonData.anchorErrorKm), and a
 * single LRO curve used to stand in for all three. Chandrayaan-2's orbit
 * loosens faster between anchors, so check each craft's figure against its own
 * Horizons vectors, same window, same UTC grid. */
async function vectors(t){
  const file = TMP + (t.key === 'lro' ? 'lro_vec_ut.txt' : 'vec_' + t.key + '_ut.txt');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const url = 'https://ssd.jpl.nasa.gov/api/horizons.api?format=text&OBJ_DATA=NO&MAKE_EPHEM=YES' +
    "&EPHEM_TYPE=VECTORS&COMMAND='" + t.horizons + "'&CENTER='500@301'&REF_PLANE='FRAME'" +
    "&VEC_TABLE='2'&OUT_UNITS='KM-S'&TIME_TYPE='UT'" +
    "&START_TIME=2026-09-14&STOP_TIME=2026-09-20&STEP_SIZE='30%20m'";
  for (let k = 1; ; k++) {
    try { const tx = await (await fetch(url)).text(); fs.writeFileSync(file, tx); return tx; }
    catch (e) { if (k === 3) throw e; console.log('  ' + t.key + ': ' + e.message + ', retrying'); }
  }
}
(async () => {
  console.log('\n  every tracked craft, median error in space vs Horizons, and what the panel says:');
  console.log('    hours from anchor    ' + MD.tracked.map(t => t.key.padStart(18)).join(''));
  const rows = new Map();
  for (const t of MD.tracked) {
    const tr = P.anchoredTrack(M, t.sets.map(s => ({epoch:s[0], a:s[1], e:s[2], i:s[3],
      raan:s[4], argp:s[5], M:s[6]})), {});
    const L = block(await vectors(t)).split('\n');
    for (let i = 0; i < L.length; i++) {
      const m = L[i].match(/^(\d+\.\d+)\s*=\s*A\.D\./);
      const xyz = m && (L[i+1]||'').match(
        /X\s*=\s*(-?[\d.]+E[+-]\d+)\s*Y\s*=\s*(-?[\d.]+E[+-]\d+)\s*Z\s*=\s*(-?[\d.]+E[+-]\d+)/);
      if (!xyz) continue;
      const ms = Math.round((+m[1] - 2440587.5)*1440)*60000, st = tr.at(ms);
      const b = Math.min(12, Math.floor(Math.abs(tr.ageHours(ms))/2)*2);
      if (b > 10) continue;
      const key = b + '|' + t.key;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(Math.hypot(st.r.x-xyz[1], st.r.y-xyz[2], st.r.z-xyz[3]));
    }
  }
  let bad = 0;
  for (let b = 0; b <= 10; b += 2) {
    let line = '    ' + String(b).padStart(2) + ' - ' + String(b+2).padStart(2) + ' h        ';
    for (const t of MD.tracked) {
      const got = stat(rows.get(b + '|' + t.key) || [NaN]).med, said = MD.anchorErrorKm(b + 1, t.key);
      /* the stated figure has to be the measured one, to a kilometre or 20 % */
      const ok = Math.abs(said - got) <= Math.max(1, 0.2*got);
      if (!ok) bad++;
      line += (got.toFixed(1) + ' / ' + said.toFixed(1) + (ok ? '  ' : ' !')).padStart(18);
    }
    console.log(line);
  }
  console.log('    (measured / stated by the panel, km)');
  console.log('\n  ' + (bad ? 'FAIL' : 'PASS') + '  the panel\'s expected error matches measurement for every craft' +
              (bad ? ' (' + bad + ' cells off)' : ''));
  if (bad) process.exitCode = 1;
})();
