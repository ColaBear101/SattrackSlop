const path = require('path');
/* End-to-end: baked daily elements -> anchoredTrack -> Body.Moon rotation ->
 * sub-spacecraft lat/lon, compared against Horizons' own sub-observer point.
 *
 * This is the test that matters. The rotation was already checked against
 * Horizons using Horizons' OWN state vectors, which isolated the frame. Here
 * the state comes from the stored element sets instead, so the number includes
 * everything the page will actually do wrong: Kepler propagation away from an
 * anchor, the daily anchor spacing, and the rounding applied when baking.
 */
const fs = require('fs');
const TMP = process.env.CLAUDE_JOB_DIR + '/tmp/';
require(path.join(__dirname, '..', 'core/body.js'));
require(path.join(__dirname, '..', 'core/propagator.js'));
const M = globalThis.Body.Moon(), P = globalThis.Propagator, DEG = 180/Math.PI;

const orb = JSON.parse(fs.readFileSync(TMP + 'orbiters.json', 'utf8'));
const track = P.anchoredTrack(M, orb.lro.sets, {name:'LRO'});

const sub = fs.readFileSync(TMP + 'lro_sub.txt', 'utf8');
const B = sub.slice(sub.indexOf('$$SOE')+5, sub.indexOf('$$EOE'));
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const O = [];
for (const ln of B.split('\n')) {
  const f = ln.trim().split(/\s+/);
  if (f.length < 4 || !/^\d{4}-[A-Z]/.test(f[0])) continue;
  const [y,mo,d] = f[0].split('-');
  const [hh,mm] = f[1].split(':');
  O.push({ ms: Date.UTC(+y, MON[mo], +d, +hh, +mm), lon: +f[2], lat: +f[3] });
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
  all.push(e);
  const h = Math.abs(track.ageHours(o.ms));
  const b = Math.min(12, Math.floor(h/2)*2);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(e);
}
const stat = a => { const s=a.slice().sort((x,y)=>x-y);
  return { med:s[Math.floor(s.length/2)], max:s[s.length-1], n:s.length }; };

const A = stat(all);
console.log('LRO sub-spacecraft point: baked elements vs Horizons');
console.log('  ' + A.n + ' samples over 6 days, 30-minute spacing\n');
console.log('  hours from anchor    n    median error        max error');
for (const b of [...buckets.keys()].sort((x,y)=>x-y)) {
  const s = stat(buckets.get(b));
  console.log('    ' + String(b).padStart(2) + ' - ' + String(b+2).padStart(2) + ' h' +
    String(s.n).padStart(8) + '   ' + s.med.toFixed(3).padStart(7) + ' deg (' +
    (s.med*K).toFixed(1).padStart(6) + ' km)  ' +
    s.max.toFixed(3).padStart(7) + ' deg (' + (s.max*K).toFixed(1) + ' km)');
}
console.log('\n  overall median ' + A.med.toFixed(3) + ' deg = ' + (A.med*K).toFixed(1) +
            ' km,  max ' + A.max.toFixed(3) + ' deg = ' + (A.max*K).toFixed(1) + ' km');

/* What a SINGLE element set would have done over the same six days - the
   comparison that justifies storing one per day. */
const one = P.keplerTrack(M, orb.lro.sets[13], {});
const singles = [];
for (const o of O) {
  const st = one.at(o.ms);
  if (!st) continue;
  const g = M.toGeodetic(st.r, M.spin(new Date(o.ms)));
  singles.push({ d:(o.ms - orb.lro.sets[13].epoch)/86400000,
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
