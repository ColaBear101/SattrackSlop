/* The Earth's magnetic field, so that a compass heading can be made a true one.
 *
 * Every azimuth this site gives - where a pass rises, where to point an
 * antenna, the sky track - is measured from true north, the direction of the
 * geographic pole. A compass, the one in a phone included, points along the
 * horizontal part of the Earth's magnetic field, which is somewhere else. The
 * angle between the two is the magnetic declination, and it is not small: late
 * in 2026 it is about +15 degrees in Seattle, -12.5 in New York and -27 in
 * Cape Town. A phone held along an azimuth read off this page, uncorrected,
 * points that far from the satellite. In Bangkok it is under a degree, which
 * is why leaving the correction out is easy to overlook from there.
 *
 * The browser does not correct it. On iOS, webkitCompassHeading is a heading
 * from magnetic north. On Android, the alpha of a deviceorientationabsolute
 * event is measured in a frame whose north is the magnetometer's, which is
 * magnetic north again. Neither applies the declination, and neither could
 * without knowing where the phone is and what the field there looks like. The
 * page knows the first; this file supplies the second, and the correction is
 *
 *     true azimuth = magnetic azimuth + D
 *
 * with D positive when magnetic north lies east of true north.
 *
 * The model is WMM2025, the World Magnetic Model made by NOAA's National
 * Centers for Environmental Information (NCEI) and the British Geological
 * Survey (BGS). Its epoch is 2025.0 and it is valid from 2025.0 to 2030.0. It
 * is a spherical-harmonic expansion of the main field to degree and order 12:
 * 90 rows of coefficients, each a pair g, h in nT at the epoch and the yearly
 * rate of change of each, which carries the field through the five years. It
 * is a work of the US Government and is in the public domain.
 *
 *   https://www.ncei.noaa.gov/products/world-magnetic-model
 *   https://www.ncei.noaa.gov/sites/default/files/2024-12/WMM2025COF.zip
 *
 * The coefficients are NOAA's WMM.COF from that zip, embedded below verbatim.
 * A script copied them in from the file; no digit of them was typed by hand,
 * so none can have been typed wrong. verification/WMM.COF is the same file,
 * committed byte for byte as a second copy, and the check compares the string
 * here against it before running all 100 rows of NOAA's own test values
 * (verification/WMM2025_TestValues.txt, from the same zip) through field().
 * D and I agree with every row to the 0.01 degree they are printed to, and
 * each field component to within 0.001 nT.
 *
 * One trap in that zip. Its README-WMM-COEFS.txt offers "a few" test values as
 * an example to confirm an installation with, and they are WMM2020's: dated
 * 2020.0 and 2020.5, at four positions the 2025 file also lists, under 2025.0
 * and 2025.5. The two disagree by up to 0.31 degrees of declination, and
 * WMM2025 carried back to the README's dates misses its figures by up to 0.09,
 * which looks like a small bug in an implementation and is a stale README. The
 * test-values file is the one to check against.
 *
 * What the model is not. It is the field of the Earth's core, smoothed to
 * features some thousands of km across; it knows nothing of the rock under a
 * particular town, and nothing of a steel desk, a car, or the magnet in a
 * phone case, any of which can turn a compass by more than the declination.
 * Near the magnetic poles the horizontal part of the field, the only part a
 * compass can use, is too weak to steer by: NOAA calls H under 2000 nT the
 * blackout zone and 2000 to 6000 nT the caution zone, and field() says which
 * one a place is in. After 2030.0 the yearly rates are carried past the years
 * they were fitted to; field() still answers, and says the model has expired.
 *
 * Nothing here touches the DOM.
 */
(function(global){
'use strict';

/* NOAA's WMM.COF, verbatim. The first line is the epoch, the model's name and
   its release date; then one row per n, m: n, m, g, h (nT), then the rates of
   g and h (nT a year); then two lines of 9s, which end the file. */
const COF = `    2025.0            WMM-2025     11/13/2024
  1  0  -29351.8       0.0       12.0        0.0
  1  1   -1410.8    4545.4        9.7      -21.5
  2  0   -2556.6       0.0      -11.6        0.0
  2  1    2951.1   -3133.6       -5.2      -27.7
  2  2    1649.3    -815.1       -8.0      -12.1
  3  0    1361.0       0.0       -1.3        0.0
  3  1   -2404.1     -56.6       -4.2        4.0
  3  2    1243.8     237.5        0.4       -0.3
  3  3     453.6    -549.5      -15.6       -4.1
  4  0     895.0       0.0       -1.6        0.0
  4  1     799.5     278.6       -2.4       -1.1
  4  2      55.7    -133.9       -6.0        4.1
  4  3    -281.1     212.0        5.6        1.6
  4  4      12.1    -375.6       -7.0       -4.4
  5  0    -233.2       0.0        0.6        0.0
  5  1     368.9      45.4        1.4       -0.5
  5  2     187.2     220.2        0.0        2.2
  5  3    -138.7    -122.9        0.6        0.4
  5  4    -142.0      43.0        2.2        1.7
  5  5      20.9     106.1        0.9        1.9
  6  0      64.4       0.0       -0.2        0.0
  6  1      63.8     -18.4       -0.4        0.3
  6  2      76.9      16.8        0.9       -1.6
  6  3    -115.7      48.8        1.2       -0.4
  6  4     -40.9     -59.8       -0.9        0.9
  6  5      14.9      10.9        0.3        0.7
  6  6     -60.7      72.7        0.9        0.9
  7  0      79.5       0.0       -0.0        0.0
  7  1     -77.0     -48.9       -0.1        0.6
  7  2      -8.8     -14.4       -0.1        0.5
  7  3      59.3      -1.0        0.5       -0.8
  7  4      15.8      23.4       -0.1        0.0
  7  5       2.5      -7.4       -0.8       -1.0
  7  6     -11.1     -25.1       -0.8        0.6
  7  7      14.2      -2.3        0.8       -0.2
  8  0      23.2       0.0       -0.1        0.0
  8  1      10.8       7.1        0.2       -0.2
  8  2     -17.5     -12.6        0.0        0.5
  8  3       2.0      11.4        0.5       -0.4
  8  4     -21.7      -9.7       -0.1        0.4
  8  5      16.9      12.7        0.3       -0.5
  8  6      15.0       0.7        0.2       -0.6
  8  7     -16.8      -5.2       -0.0        0.3
  8  8       0.9       3.9        0.2        0.2
  9  0       4.6       0.0       -0.0        0.0
  9  1       7.8     -24.8       -0.1       -0.3
  9  2       3.0      12.2        0.1        0.3
  9  3      -0.2       8.3        0.3       -0.3
  9  4      -2.5      -3.3       -0.3        0.3
  9  5     -13.1      -5.2        0.0        0.2
  9  6       2.4       7.2        0.3       -0.1
  9  7       8.6      -0.6       -0.1       -0.2
  9  8      -8.7       0.8        0.1        0.4
  9  9     -12.9      10.0       -0.1        0.1
 10  0      -1.3       0.0        0.1        0.0
 10  1      -6.4       3.3        0.0        0.0
 10  2       0.2       0.0        0.1       -0.0
 10  3       2.0       2.4        0.1       -0.2
 10  4      -1.0       5.3       -0.0        0.1
 10  5      -0.6      -9.1       -0.3       -0.1
 10  6      -0.9       0.4        0.0        0.1
 10  7       1.5      -4.2       -0.1        0.0
 10  8       0.9      -3.8       -0.1       -0.1
 10  9      -2.7       0.9       -0.0        0.2
 10 10      -3.9      -9.1       -0.0       -0.0
 11  0       2.9       0.0        0.0        0.0
 11  1      -1.5       0.0       -0.0       -0.0
 11  2      -2.5       2.9        0.0        0.1
 11  3       2.4      -0.6        0.0       -0.0
 11  4      -0.6       0.2        0.0        0.1
 11  5      -0.1       0.5       -0.1       -0.0
 11  6      -0.6      -0.3        0.0       -0.0
 11  7      -0.1      -1.2       -0.0        0.1
 11  8       1.1      -1.7       -0.1       -0.0
 11  9      -1.0      -2.9       -0.1        0.0
 11 10      -0.2      -1.8       -0.1        0.0
 11 11       2.6      -2.3       -0.1        0.0
 12  0      -2.0       0.0        0.0        0.0
 12  1      -0.2      -1.3        0.0       -0.0
 12  2       0.3       0.7       -0.0        0.0
 12  3       1.2       1.0       -0.0       -0.1
 12  4      -1.3      -1.4       -0.0        0.1
 12  5       0.6      -0.0       -0.0       -0.0
 12  6       0.6       0.6        0.1       -0.0
 12  7       0.5      -0.1       -0.0       -0.0
 12  8      -0.1       0.8        0.0        0.0
 12  9      -0.4       0.1        0.0       -0.0
 12 10      -0.2      -1.0       -0.1       -0.0
 12 11      -1.3       0.1       -0.0        0.0
 12 12      -0.7       0.2       -0.1       -0.1
999999999999999999999999999999999999999999999999
999999999999999999999999999999999999999999999999
`;

/* WGS-84, on which the model is defined: latitudes are geodetic, heights are
   above the ellipsoid. */
const WGS_A = 6378.137, WGS_F = 1/298.257223563, WGS_E2 = WGS_F*(2 - WGS_F);
/* The model's reference radius, the geomagnetic convention: a sphere of about
   the Earth's mean radius, which is neither axis of the ellipsoid. */
const REF_R = 6371.2;
const NMAX = 12, MODEL = 'WMM2025', EPOCH = 2025.0, VALID_TO = 2030.0;
const RAD = Math.PI/180;

/* Read on first use, not at load: most visits never ask for a compass, and
   the page should not pay for one it does not show. */
let M = null;
function model(){
  if(M) return M;
  const lines = COF.split('\n');
  const head = lines[0].trim().split(/\s+/);
  const epoch = +head[0], name = head[1] || '';
  /* The epoch the time term is taken from is the file's, and it has to be the
     one this file says it is; a different COF pasted in would otherwise be
     evaluated from the wrong year without a word. */
  if(epoch !== EPOCH || name.replace(/-/g, '') !== MODEL)
    throw new Error('WMM.COF header is "' + lines[0].trim() + '", not ' + MODEL + ' at ' + EPOCH);
  const grid = () => Array.from({length: NMAX + 1}, () => new Float64Array(NMAX + 1));
  const g = grid(), h = grid(), gd = grid(), hd = grid(), rows = [];
  for(let i = 1; i < lines.length; i++){
    const s = lines[i].trim();
    if(/^9+$/.test(s)) break;
    if(!s) continue;
    const v = s.split(/\s+/).map(Number), n = v[0], m = v[1];
    if(v.length !== 6 || !v.every(isFinite) || !(n >= 1 && n <= NMAX && m >= 0 && m <= n))
      throw new Error('WMM.COF line ' + (i + 1) + ' cannot be read: ' + s);
    g[n][m] = v[2]; h[n][m] = v[3]; gd[n][m] = v[4]; hd[n][m] = v[5];
    rows.push({n, m, g: v[2], h: v[3], gd: v[4], hd: v[5]});
  }
  if(rows.length !== NMAX*(NMAX + 3)/2)
    throw new Error('WMM.COF has ' + rows.length + ' coefficient rows, not ' + NMAX*(NMAX + 3)/2);
  M = {epoch, name, released: head[2] || null, g, h, gd, hd, rows,
       P: grid(), dP: grid(), cm: new Float64Array(NMAX + 1), sm: new Float64Array(NMAX + 1)};
  return M;
}

/* The field at a place and a time.
 *
 * latDeg, lonDeg geodetic degrees, east positive; hKm above the WGS-84
 * ellipsoid, taken as 0 when missing; decYear a decimal year (decimalYear()
 * below), taken as now when missing.
 *
 * Returns X north, Y east, Z down, H horizontal and F total intensity, in nT;
 * D, the declination, and I, the inclination (dip, positive down), in degrees;
 * zone, 'ok', 'caution' or 'blackout' by NOAA's thresholds on H; and expired,
 * true from 2030.0 on. A date before 2025.0 is carried back by the same rates,
 * which is as far outside the model as a date after 2030.0 is, but this site
 * only ever asks about now. Null when either coordinate is not a number.
 *
 * The method is the WMM technical report's, step for step. */
function field(latDeg, lonDeg, hKm, decYear){
  if(!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  if(!Number.isFinite(hKm)) hKm = 0;
  if(!Number.isFinite(decYear)) decYear = decimalYear(Date.now());
  const W = model(), P = W.P, dP = W.dP, cm = W.cm, sm = W.sm;

  /* At a geographic pole the east component divides by cos(latitude), which is
     zero there, and declination has no meaning anyway: every way is south.
     89.999 degrees is 111 m short of it. */
  const lat = Math.max(-89.999, Math.min(89.999, latDeg));
  const phi = lat*RAD, lam = lonDeg*RAD;

  /* Geodetic to geocentric. The harmonics are in spherical coordinates about
     the Earth's centre, so the point on the ellipsoid is put there first: Rc is
     the radius of curvature in the prime vertical, p the distance from the
     axis, z the height above the equatorial plane. */
  const sphi = Math.sin(phi), cphi = Math.cos(phi);
  const Rc = WGS_A/Math.sqrt(1 - WGS_E2*sphi*sphi);
  const p = (Rc + hKm)*cphi, z = (Rc*(1 - WGS_E2) + hKm)*sphi;
  const r = Math.sqrt(p*p + z*z), phic = Math.asin(z/r);

  /* The coefficients move linearly from the epoch. */
  const dt = decYear - W.epoch;

  /* Schmidt semi-normalised associated Legendre functions of sin(phic), with
     no Condon-Shortley phase (the geomagnetic convention: every P is positive
     near the equator), and their derivatives with respect to phic. The
     diagonal is built up from P(0,0) = 1; each column below it from the two
     above, P(n-2,m) being zero where it does not exist. */
  const x = Math.sin(phic), c = Math.cos(phic);
  P[0][0] = 1; dP[0][0] = 0;
  for(let n = 1; n <= NMAX; n++){
    for(let m = 0; m < n; m++){
      const a = 2*n - 1, b = Math.sqrt((n - 1)*(n - 1) - m*m), k = Math.sqrt(n*n - m*m);
      const p2 = n - 2 >= m ? P[n - 2][m] : 0, d2 = n - 2 >= m ? dP[n - 2][m] : 0;
      P[n][m] = (a*x*P[n - 1][m] - b*p2)/k;
      dP[n][m] = (a*(x*dP[n - 1][m] + c*P[n - 1][m]) - b*d2)/k;
    }
    /* P(1,1) = cos(phic) exactly; from n = 2 on the Schmidt factor for m > 0
       leaves sqrt((2n-1)/2n) at each step. */
    const k = n === 1 ? 1 : Math.sqrt((2*n - 1)/(2*n));
    P[n][n] = k*c*P[n - 1][n - 1];
    dP[n][n] = k*(c*dP[n - 1][n - 1] - x*P[n - 1][n - 1]);
  }
  for(let m = 0; m <= NMAX; m++){ cm[m] = Math.cos(m*lam); sm[m] = Math.sin(m*lam); }

  /* The field in the geocentric frame: X' north along the meridian, Y' east,
     Z' toward the centre. The radial factor is (A/r)^(n+2). */
  const ar = REF_R/r;
  let arn = ar*ar, Xs = 0, Ys = 0, Zs = 0;
  for(let n = 1; n <= NMAX; n++){
    arn *= ar;
    for(let m = 0; m <= n; m++){
      const gt = W.g[n][m] + dt*W.gd[n][m], ht = W.h[n][m] + dt*W.hd[n][m];
      const cs = gt*cm[m] + ht*sm[m];
      Xs -= arn*cs*dP[n][m];
      Ys += arn*m*(gt*sm[m] - ht*cm[m])*P[n][m];
      Zs -= arn*(n + 1)*cs*P[n][m];
    }
  }
  Ys /= c;

  /* Back to the local geodetic frame: north and down are tilted from their
     geocentric directions by the difference of the two latitudes. East is the
     same in both. */
  const psi = phic - phi, cpsi = Math.cos(psi), spsi = Math.sin(psi);
  const X = Xs*cpsi - Zs*spsi, Z = Xs*spsi + Zs*cpsi, Y = Ys;
  const H = Math.sqrt(X*X + Y*Y), F = Math.sqrt(H*H + Z*Z);
  return {
    X, Y, Z, H, F,
    D: Math.atan2(Y, X)/RAD,
    I: Math.atan2(Z, H)/RAD,
    zone: H >= 6000 ? 'ok' : H >= 2000 ? 'caution' : 'blackout',
    expired: decYear >= VALID_TO
  };
}

/* Declination alone, degrees east of true north: true = magnetic + D. */
function declination(latDeg, lonDeg, hKm, decYear){
  const f = field(latDeg, lonDeg, hKm, decYear);
  return f ? f.D : null;
}

/* A UTC instant as a decimal year, the way the model counts time: the
   fraction is of this year's own length, so 1 July is not the same fraction
   of a leap year as of any other. */
function decimalYear(ms){
  const y = new Date(ms).getUTCFullYear();
  const y0 = Date.UTC(y, 0, 1), y1 = Date.UTC(y + 1, 0, 1);
  return y + (ms - y0)/(y1 - y0);
}

/* The rows of the file, in its order, as copies: the model's own stay put. */
function coefficients(){
  return model().rows.map(r => ({n: r.n, m: r.m, g: r.g, h: r.h, gd: r.gd, hd: r.hd}));
}

global.WMM = {
  field,
  declination,
  decimalYear,
  coefficients,
  coefficientText: COF,
  model: MODEL,
  epoch: EPOCH,
  validTo: VALID_TO,
  credit: 'World Magnetic Model WMM2025, NOAA NCEI and BGS'
};

})(typeof window !== 'undefined' ? window : globalThis);
