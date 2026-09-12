// verify.js -- INDEPENDENT verification harness.
//
// Cross-checks core.js / propagate.js against a second implementation written
// here from first principles. satellite.min.js is used ONLY for SGP4
// propagation + gstime (both sides need the same orbit model); every piece of
// coordinate, element and elevation math below is derived independently.
//
//   node verify.js
//
'use strict';

const fs   = require('fs');
const path = require('path');

const DIR  = __dirname;
const satellite = require(path.join(DIR, 'satellite.min.js'));

// ---------------------------------------------------------------- constants
const MU  = 398600.4418;          // km^3/s^2
const REQ = 6378.137;             // km, WGS-84 semi-major axis
const FLT = 1 / 298.257223563;    // WGS-84 flattening
const E2  = FLT * (2 - FLT);      // first eccentricity squared
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const OBS = { latDeg: 13.75, lonDeg: 100.52, hKm: 0.0 };   // Bangkok
const MASK_DEG = 5;

// ---------------------------------------------------------------- TLE source
const FALLBACK = {
  name: 'LANDSAT 8',
  l1: '1 39084U 13008A   24001.50000000  .00000200  00000+0  50000-4 0  9995',
  l2: '2 39084  98.2210  80.0000 0001200  90.0000 270.0000 14.57100000567890',
  stale: true
};

function pickTLE() {
  const f = path.join(DIR, 'resource.txt');
  if (!fs.existsSync(f)) return FALLBACK;
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).map(s => s.replace(/\s+$/, ''));
  const sats = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (/^1 /.test(lines[i + 1]) && /^2 /.test(lines[i + 2]) &&
        lines[i + 1].length >= 69 && lines[i + 2].length >= 69) {
      sats.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2], stale: false });
      i += 2;
    }
  }
  if (!sats.length) return FALLBACK;
  const by = n => sats.find(s => s.name.toUpperCase().replace(/\s+/g, ' ') === n);
  return by('LANDSAT 9') || by('LANDSAT 8') || sats[0];
}

// ================================================================ CHECK 1
// Independent TLE field extraction + element derivation.
// Column indices taken from the TLE format definition, written fresh here.
function myParseTLE(l1, l2) {
  const num = (line, from, to) => parseFloat(line.slice(from, to));

  // --- epoch: columns 19-32 of line 1 (1-based) => slice(18,32)
  const yy = parseInt(l1.slice(18, 20), 10);
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const doy = parseFloat(l1.slice(20, 32));          // fractional day-of-year, 1-based
  // Build the Date from scratch: Jan 1 00:00 UTC of `year` plus (doy-1) days.
  const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
  const epoch = new Date(epochMs);

  // --- line 2 angular elements
  const inc  = num(l2,  8, 16);                              // deg
  const raan = num(l2, 17, 25);                              // deg
  const ecc  = parseFloat('0.' + l2.slice(26, 33).trim());   // leading decimal implied
  const argp = num(l2, 34, 42);                              // deg
  const ma   = num(l2, 43, 51);                              // deg
  const n    = num(l2, 52, 63);                              // rev/day

  // --- derived quantities, from first principles
  // n [rev/day] -> [rad/s]:  rev/day * 2pi rad/rev / 86400 s/day
  const nRad = n * (2 * Math.PI) / 86400;
  // Kepler third law: n^2 a^3 = mu  =>  a = (mu / n^2)^(1/3)
  const a = Math.pow(MU / (nRad * nRad), 1 / 3);
  const period = (2 * Math.PI) / nRad;                // s  (equivalently 86400/n)
  const rp = a * (1 - ecc);                           // perigee radius
  const ra = a * (1 + ecc);                           // apogee radius

  return { epoch, epochMs, inc, raan, ecc, argp, ma, n, nRad, a, period,
           rp, ra, perigeeAlt: rp - REQ, apogeeAlt: ra - REQ };
}

// ================================================================ CHECK 2
// Independent ECI -> ECEF -> ENU topocentric elevation.

// Observer ECEF, proper WGS-84 ellipsoid.
function observerEcef(latDeg, lonDeg, hKm) {
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const N = REQ / Math.sqrt(1 - E2 * sl * sl);        // prime vertical radius of curvature
  return {
    x: (N + hKm) * cl * Math.cos(lon),
    y: (N + hKm) * cl * Math.sin(lon),
    z: (N * (1 - E2) + hKm) * sl,
    lat, lon
  };
}
const OBS_ECEF = observerEcef(OBS.latDeg, OBS.lonDeg, OBS.hKm);

// ECI (TEME) -> ECEF: rotate about the z axis by the Greenwich sidereal angle.
function eci2ecef(p, gmst) {
  const c = Math.cos(gmst), s = Math.sin(gmst);
  return { x:  p.x * c + p.y * s,
           y: -p.x * s + p.y * c,
           z:  p.z };
}

// Elevation of satellite above observer local horizon (geodetic ENU), degrees.
function myElevation(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position) return null;
  const gmst = satellite.gstime(date);
  const s = eci2ecef(pv.position, gmst);

  const rx = s.x - OBS_ECEF.x, ry = s.y - OBS_ECEF.y, rz = s.z - OBS_ECEF.z;
  const rng = Math.sqrt(rx * rx + ry * ry + rz * rz);

  const sl = Math.sin(OBS_ECEF.lat), cl = Math.cos(OBS_ECEF.lat);
  const so = Math.sin(OBS_ECEF.lon), co = Math.cos(OBS_ECEF.lon);

  const east  = -so * rx + co * ry;
  const north = -sl * co * rx - sl * so * ry + cl * rz;
  const up    =  cl * co * rx + cl * so * ry + sl * rz;

  return { elDeg: Math.asin(up / rng) * R2D,
           azDeg: (Math.atan2(east, north) * R2D + 360) % 360,
           rangeKm: rng };
}

// satellite.js own look angles, for comparison.
function sjElevation(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position) return null;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const la = satellite.ecfToLookAngles(
    { longitude: OBS.lonDeg * D2R, latitude: OBS.latDeg * D2R, height: OBS.hKm }, ecf);
  return { elDeg: la.elevation * R2D, azDeg: la.azimuth * R2D, rangeKm: la.rangeSat };
}

// ================================================================ reporting
function relDiff(mine, theirs) {
  const d = Math.abs(mine - theirs);
  const s = Math.max(Math.abs(mine), Math.abs(theirs));
  return s === 0 ? d : d / s;
}
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - String(s).length));
function hdr(t) { console.log('\n' + '='.repeat(78) + '\n' + t + '\n' + '='.repeat(78)); }

// ================================================================ main
function main() {
  const tle = pickTLE();

  hdr('SATELLITE / TLE');
  console.log('Name : ' + tle.name);
  console.log('L1   : ' + tle.l1);
  console.log('L2   : ' + tle.l2);
  if (tle.stale) {
    console.log('');
    console.log('*** WARNING: resource.txt was NOT found. ***');
    console.log('*** The TLE above is the HARD-CODED STALE FALLBACK -- NOT CURRENT DATA. ***');
    console.log('*** Its checksum may also be invalid. No number produced below is a real');
    console.log('*** answer; the run must be repeated once resource.txt lands. ***');
  } else {
    console.log('Source: resource.txt (real data)');
  }

  const satrec = satellite.twoline2satrec(tle.l1, tle.l2);
  if (satrec.error) { console.log('twoline2satrec error code ' + satrec.error); process.exit(1); }

  const mine = myParseTLE(tle.l1, tle.l2);

  // ---------------------------------------------------------- CHECK 1
  hdr('CHECK 1 -- ORBITAL ELEMENTS  (core.js parseTLE  vs  independent)');
  const core = require(path.join(DIR, 'core.js'));
  const theirs = core.parseTLE(tle.l1, tle.l2);

  const TOL = 1e-9;
  const rows = [
    ['inclination (deg)',      theirs.inc,             mine.inc],
    ['RAAN (deg)',             theirs.raan,            mine.raan],
    ['eccentricity',           theirs.ecc,             mine.ecc],
    ['arg of perigee (deg)',   theirs.argp,            mine.argp],
    ['mean anomaly (deg)',     theirs.ma,              mine.ma],
    ['mean motion (rev/day)',  theirs.n,               mine.n],
    ['epoch (ms since 1970)',  theirs.epoch.getTime(), mine.epochMs],
    ['semi-major axis a (km)', theirs.a,               mine.a],
    ['period (s)',             theirs.period,          mine.period],
    ['perigee altitude (km)',  theirs.perigeeAlt,      mine.perigeeAlt],
    ['apogee altitude (km)',   theirs.apogeeAlt,       mine.apogeeAlt]
  ];
  console.log(pad('FIELD', 24) + pad('core.js (yours)', 25) + pad('independent (mine)', 25) + 'rel.diff');
  console.log('-'.repeat(86));
  let c1fail = 0;
  for (const row of rows) {
    const rd = relDiff(row[2], row[1]);
    if (rd > TOL) c1fail++;
    console.log(pad(row[0], 24) + pad(row[1], 25) + pad(row[2], 25) +
                rd.toExponential(3) + (rd > TOL ? '   <<< MISMATCH' : ''));
  }
  console.log('');
  console.log('Epoch UTC : core.js = ' + theirs.epoch.toISOString());
  console.log('            mine    = ' + mine.epoch.toISOString());
  const c1pass = c1fail === 0;
  console.log('');
  console.log('CHECK 1: ' + (c1pass ? 'PASS' : 'FAIL') +
              '  (' + c1fail + ' field(s) exceeding ' + TOL + ' relative)');

  // ---------------------------------------------------------- CHECK 2
  hdr('CHECK 2 -- TOPOCENTRIC ELEVATION  (mine  vs  satellite.js ecfToLookAngles)');
  const epoch = mine.epoch;
  const N2 = 200;
  let maxAbs = 0, maxAt = null, sum = 0, cnt = 0, maxAbsVis = 0;
  let minSigned = Infinity, maxSigned = -Infinity;
  for (let i = 0; i < N2; i++) {
    const t = new Date(epoch.getTime() + Math.round(i * 86400000 / N2));
    const m = myElevation(satrec, t), s = sjElevation(satrec, t);
    if (!m || !s) continue;
    const d = m.elDeg - s.elDeg;
    sum += d; cnt++;
    if (d < minSigned) minSigned = d;
    if (d > maxSigned) maxSigned = d;
    if (Math.abs(d) > maxAbs) { maxAbs = Math.abs(d); maxAt = t; }
    if (s.elDeg >= 0 && Math.abs(d) > maxAbsVis) maxAbsVis = Math.abs(d);
  }
  const meanD = sum / cnt;
  console.log('samples compared            : ' + cnt);
  console.log('max |mine - satellite.js|   : ' + maxAbs.toExponential(4) + ' deg' +
              (maxAt ? '   at ' + maxAt.toISOString() : ''));
  console.log('max |diff| above horizon    : ' + maxAbsVis.toExponential(4) + ' deg');
  console.log('mean signed diff (bias)     : ' + meanD.toExponential(4) + ' deg');
  console.log('signed diff range           : [' + minSigned.toExponential(4) + ', ' +
              maxSigned.toExponential(4) + '] deg');
  if (maxAbs < 1e-9) {
    console.log('=> No systematic offset. Both sides use the WGS-84 ELLIPSOIDAL (geodetic)');
    console.log('   local horizon; agreement is at floating-point round-off level.');
  } else if (Math.abs(meanD) > 0.5 * maxAbs && maxAbs > 1e-6) {
    console.log('=> SYSTEMATIC OFFSET of ~' + meanD.toFixed(6) + ' deg detected.');
    console.log('   Mine is the WGS-84 ELLIPSOIDAL (geodetic) elevation by construction;');
    console.log('   an offset of this sign and size indicates satellite.js is using a');
    console.log('   different (e.g. spherical / geocentric) local vertical.');
  } else {
    console.log('=> Scattered, non-systematic difference: numerical noise only.');
  }
  const c2pass = maxAbs <= 0.02;
  console.log('');
  console.log('CHECK 2: ' + (c2pass ? 'PASS' : 'FAIL') +
              '  (threshold 0.02 deg; observed max ' + maxAbs.toExponential(4) + ' deg)');

  // ---------------------------------------------------------- CHECK 3
  hdr('CHECK 3 -- CUMULATIVE VISIBILITY (el >= ' + MASK_DEG + ' deg, 24 h from epoch)');
  // Brute force: 86400 one-second samples, count the ones at or above the mask.
  let bfCount = 0, bfRuns = 0, prevVis = false, runStart = 0;
  const runs = [];
  for (let k = 0; k < 86400; k++) {
    const t = new Date(epoch.getTime() + k * 1000);
    const m = myElevation(satrec, t);
    const vis = !!m && m.elDeg >= MASK_DEG;
    if (vis) bfCount++;
    if (vis && !prevVis) { bfRuns++; runStart = k; }
    if (!vis && prevVis) runs.push([runStart, k - 1]);
    prevVis = vis;
  }
  if (prevVis) runs.push([runStart, 86399]);

  const GT = require(path.join(DIR, 'propagate.js'));
  const passes = GT.findPasses(satrec, epoch, 24, GT.BANGKOK, MASK_DEG, 10);
  const mineTotal = passes.reduce((s, p) => s + p.durationS, 0);

  console.log('brute force (1 s scan, own math) : ' + bfCount + ' s  in ' + bfRuns + ' contiguous run(s)');
  console.log('propagate.js findPasses          : ' + mineTotal.toFixed(3) + ' s  in ' + passes.length + ' pass(es)');
  console.log('difference (findPasses - brute)  : ' + (mineTotal - bfCount).toFixed(3) + ' s');
  if (runs.length) {
    console.log('');
    console.log('brute-force runs (seconds offset from epoch):');
    runs.forEach((r, i) => console.log('  #' + (i + 1) + '  ' + r[0] + ' .. ' + r[1] +
                 '   (' + (r[1] - r[0] + 1) + ' s)'));
  }
  if (passes.length) {
    console.log('');
    console.log('findPasses windows:');
    passes.forEach((p, i) => console.log('  #' + (i + 1) + '  ' + p.aos.toISOString() + ' -> ' +
                 p.los.toISOString() + '  ' + p.durationS.toFixed(1) + ' s, maxEl ' +
                 p.maxEl.toFixed(2) + ' deg' + (p.clipped ? '  [clipped]' : '')));
  }
  const dt = Math.abs(mineTotal - bfCount);
  const c3pass = (passes.length === bfRuns) && dt <= 2 * Math.max(1, passes.length);
  console.log('');
  console.log('CHECK 3: ' + (c3pass ? 'PASS' : 'FAIL') +
              '  (|diff| = ' + dt.toFixed(3) + ' s; pass counts ' +
              passes.length + ' vs ' + bfRuns + ')');

  // ---------------------------------------------------------- verdict
  hdr('VERDICT');
  console.log('CHECK 1 orbital elements      : ' + (c1pass ? 'PASS' : 'FAIL'));
  console.log('CHECK 2 topocentric elevation : ' + (c2pass ? 'PASS' : 'FAIL'));
  console.log('CHECK 3 cumulative visibility : ' + (c3pass ? 'PASS' : 'FAIL'));
  if (tle.stale) {
    console.log('');
    console.log('(!) Ran on the STALE FALLBACK TLE -- these are NOT real-data results.');
  }
  process.exitCode = (c1pass && c2pass && c3pass) ? 0 : 1;
}

main();
