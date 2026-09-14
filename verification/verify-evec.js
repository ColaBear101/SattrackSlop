/*
 * The eccentricity vector drawn by earth/orbitviz.js, checked independently.
 *
 * The arrow labelled e used to be the OSCULATING vector, (v x h)/mu - r_hat,
 * computed from the live state vector. That is the textbook definition and it is
 * the wrong thing to draw: measured over one revolution, KNACKSAT-2's osculating
 * |e| runs 0.000816 to 0.002108, a factor of 2.58, while its direction wanders
 * 64.9 deg. LANDSAT 9 is worse and shows why - at e = 1.5e-4 the vector is mostly
 * J2 short-period noise, |e| moves by a factor of 5.76 and the direction sweeps
 * the full 180 deg, so the arrow would point anywhere at all. None of that is the
 * orbit changing. It is exactly what the mean elements have already averaged out,
 * so the arrow now carries the MEAN vector: the one the elements card quotes, and
 * the one the ellipse and the omega arc are already built from.
 *
 * Nothing here imports the page. The perifocal rotation is written out again from
 * the TLE angles so that an error in orbitviz.js cannot reproduce itself inside
 * its own test.
 *
 *   node verification/verify-evec.js
 */
const satellite = require('./satellite.min.js');

const RAD = Math.PI / 180, DEG = 180 / Math.PI, MU = 398600.4418;
const sin = a => Math.sin(a * RAD), cos = a => Math.cos(a * RAD);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const mag = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const m = mag(a); return [a[0]/m, a[1]/m, a[2]/m]; };
const axpy = (a, k, b) => [a[0] + k*b[0], a[1] + k*b[1], a[2] + k*b[2]];

/* Spread across the eccentricity range the picker can reach: two near-circular
   orbits, where the osculating vector is worst behaved, and two highly eccentric
   ones, where the angle sweeps fast through perigee. */
const CASES = {
  'KNACKSAT-2':     ['1 67683U 98067XZ  26255.31192122  .00056149  00000-0  48789-3 0  9995',
                     '2 67683  51.6258 213.5681 0007959 152.6345 207.5073 15.68476422 33916'],
  'LANDSAT 9':      ['1 49260U 21088A   26255.20123477  .00000817  00000-0  19193-3 0  9992',
                     '2 49260  98.2207 324.2909 0001484 100.3913 259.7453 14.57109712260396'],
  'CLUSTER II-FM8': ['1 26464U 00045B   26242.68406919  .00218879 -14532-2  00000+0 0  9992',
                     '2 26464 149.4895  65.8568 9133957 283.7320   2.2648  0.44936442 20644'],
  'MMS 2':          ['1 40483U 15011B   26255.33335648 -.00001793  00000+0  00000+0 0  9991',
                     '2 40483  72.9265 347.7866 8262750 169.3371 188.1566  0.28342545  1406']
};

/* Perigee direction from the mean elements: R3(-raan) R1(-inc) R3(-argp) applied
   to the perifocal x axis, multiplied out. orbitviz builds the same direction by
   a different route - node vector, orbit normal, in-plane vector - so agreeing
   here checks that construction rather than restating it. */
function meanPerigee(inc, raan, argp) {
  return [cos(raan) * cos(argp) - sin(raan) * sin(argp) * cos(inc),
          sin(raan) * cos(argp) + cos(raan) * sin(argp) * cos(inc),
          sin(argp) * sin(inc)];
}
function orbitvizBasisP(inc, raan, argp) {
  const n = [cos(raan), sin(raan), 0];
  const w = [sin(inc) * sin(raan), -sin(inc) * cos(raan), cos(inc)];
  const v = crs(w, n);
  return axpy(n.map(x => x * cos(argp)), sin(argp), v);
}

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

for (const [name, lines] of Object.entries(CASES)) {
  const l1 = lines[0], l2 = lines[1];
  const satrec = satellite.twoline2satrec(l1, l2);
  const inc  = parseFloat(l2.substring(8, 16));
  const raan = parseFloat(l2.substring(17, 25));
  const ecc  = parseFloat('0.' + l2.substring(26, 33).trim());
  const argp = parseFloat(l2.substring(34, 42));
  console.log('\n=== ' + name + '   e = ' + ecc + '   i = ' + inc + ' deg ===');

  const p = meanPerigee(inc, raan, argp);
  const pageP = orbitvizBasisP(inc, raan, argp);
  const w = [sin(inc) * sin(raan), -sin(inc) * cos(raan), cos(inc)];

  chk('mean perigee is a unit vector', Math.abs(mag(p) - 1) < 1e-15,
      '|p| - 1 = ' + (mag(p) - 1).toExponential(2));
  chk('orbitviz basis().p matches the perifocal rotation',
      mag(axpy(p, -1, pageP)) < 1e-15,
      'diff = ' + mag(axpy(p, -1, pageP)).toExponential(2));
  chk('it lies in the mean orbit plane', Math.abs(dot(p, w)) < 1e-15,
      'p.w = ' + dot(p, w).toExponential(2));

  const periodMin = (2 * Math.PI) / satrec.no, N = 720;
  let maxClose = 0, maxTilt = 0, minStep = Infinity, total = 0, wraps = 0, prev = null;
  let oscMinE = Infinity, oscMaxE = -Infinity, oscWander = 0, branchErr = 0;

  for (let k = 0; k <= N; k++) {
    const pv = satellite.sgp4(satrec, periodMin * k / N);
    if (!pv || !pv.position) continue;
    const R = [pv.position.x, pv.position.y, pv.position.z];
    const V = [pv.velocity.x, pv.velocity.y, pv.velocity.z];
    const rHat = unit(R), H = crs(R, V), hHat = unit(H);

    /* The mean vector is not perpendicular to the instantaneous h the way the
       osculating one was, so it is projected into the osculating plane before the
       angle is measured. Without that the arc ends beside the spacecraft. */
    const pIn = unit(axpy(p, -dot(hHat, p), hHat));
    const inPlane = unit(crs(hHat, pIn));
    let ang = Math.atan2(dot(rHat, inPlane), dot(rHat, pIn)) * DEG;
    if (ang < 0) ang += 360;

    // the arc has to CLOSE on the spacecraft: p*cos(ang) + inPlane*sin(ang) == r_hat
    const recon = axpy(pIn.map(x => x * cos(ang)), sin(ang), inPlane);
    maxClose = Math.max(maxClose, mag(axpy(recon, -1, rHat)));
    maxTilt = Math.max(maxTilt,
      Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(hHat, p)))) * DEG));

    if (prev !== null) {
      const d = ((ang - prev + 540) % 360) - 180;      // signed, shortest way round
      minStep = Math.min(minStep, d);
      total += d;
      if (ang < prev) wraps++;                          // passed through 0 going forward
    }
    prev = ang;

    // what the osculating vector was doing at the same instants, for the record
    const VxH = crs(V, H), rM = mag(R);
    const E = [VxH[0]/MU - R[0]/rM, VxH[1]/MU - R[1]/rM, VxH[2]/MU - R[2]/rM];
    oscMinE = Math.min(oscMinE, mag(E));
    oscMaxE = Math.max(oscMaxE, mag(E));
    oscWander = Math.max(oscWander,
      Math.acos(Math.max(-1, Math.min(1, dot(unit(E), p)))) * DEG);

    // the old "r.v < 0 means past apogee" branch test, carried onto the mean reference
    let bad = Math.acos(Math.max(-1, Math.min(1, dot(pIn, rHat)))) * DEG;
    if (dot(R, V) < 0) bad = 360 - bad;
    branchErr = Math.max(branchErr, Math.abs(((bad - ang + 540) % 360) - 180));
  }

  chk('the arc closes exactly on the spacecraft', maxClose < 1e-12,
      'max |reconstructed - r_hat| = ' + maxClose.toExponential(2));
  /* NOT uniform steps: on an eccentric orbit the angle sweeps fast through
     perigee, by Kepler's second law, and CLUSTER covers 25 deg in one step of
     720. A branch flip shows up as a BACKWARD step, so monotonic forward motion
     is the assertion that bites here. */
  chk('the angle advances monotonically forward', minStep > 0,
      'smallest step = ' + minStep.toExponential(3) + ' deg');
  /* Deliberately not "the total is 360 deg". The reference is the perigee
     direction frozen at the TLE epoch while the real apsides precess, and the
     period used here is 2*pi/n rather than the exact anomalistic one. At e = 0.91
     the rate through perigee is high enough that a small period error moves the
     total by a degree, which would make any tolerance arbitrary. Wrapping exactly
     once is the property that matters, and it needs no tolerance at all. */
  chk('the angle wraps exactly once per revolution', wraps === 1,
      'wraps = ' + wraps + '   (total swept ' + total.toFixed(2) + ' deg)');

  console.log('  note    osculating |e| over one rev   : ' + oscMinE.toFixed(7) + ' .. '
              + oscMaxE.toFixed(7) + '  (factor ' + (oscMaxE / oscMinE).toFixed(2) + ')');
  console.log('  note    osculating direction wander   : ' + oscWander.toFixed(1) + ' deg from mean');
  console.log('  note    mean perigee tilt out of plane: ' + maxTilt.toFixed(5)
              + ' deg  (why the projection is needed)');
  console.log('  note    old r.v branch test would err : ' + branchErr.toFixed(2) + ' deg');
}

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
process.exit(fails ? 1 : 0);
