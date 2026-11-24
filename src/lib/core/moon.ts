// @ts-nocheck - moved verbatim; see the note below. MoonState and moonState(), at the foot of the file, are new: the typed surface.
/* lunar.js — geocentric Moon, Sun, and Earth–Moon Lagrange points.
 *
 * Self-contained analytic ephemeris. No dependencies, no network at runtime.
 * Loads as a plain <script> (sets window.Lunar) or under node (globalThis.Lunar).
 *
 * FRAME — everything returned as x,y,z is:
 *   kilometres, GEOCENTRIC EQUATORIAL, MEAN equinox and MEAN equator OF DATE,
 *   right-handed, +Z = north celestial pole, +X = mean equinox of date.
 * That is the frame the rest of this app already assumes: it rotates ECI->ECEF
 * by GMST, and GMST is measured from the MEAN equinox. Using the true (nutated)
 * equinox here would be inconsistent with GMST by the equation of the equinoxes,
 * up to ~1.1 s of time ~ 17 arcsec of arc. Nutation is therefore COMPUTED and
 * returned (dpsi, deps, epsTrue) but deliberately NOT folded into x,y,z; see
 * moonApparent() below for the observational (true-of-date, light-time
 * corrected) position used to check this file against JPL Horizons.
 *
 * WHY A SERIES AND NOT A KEPLER ORBIT
 *   The Moon is the textbook case where two-body motion is simply wrong. The
 *   three biggest solar perturbations are
 *       evection          1.27 deg   (period 31.8 d)
 *       variation         0.66 deg   (period 14.8 d)
 *       annual equation   0.19 deg   (period 1 yr)
 *   A circular or osculating-Kepler Moon is off by degrees, i.e. by many lunar
 *   diameters. What follows is the truncated ELP-2000/82B of Meeus,
 *   "Astronomical Algorithms" 2nd ed., ch. 47: 60 periodic terms in longitude
 *   and radius (table 47.A), 60 in latitude (table 47.B), plus the planetary and
 *   figure-of-the-Earth additive terms. Meeus quotes ~10" in longitude, ~4" in
 *   latitude and ~20 km in distance against the full ELP theory; measured here
 *   against JPL Horizons/DE441 it holds to ~11" and ~30 km over 2016-2034.
 *
 * TIME
 *   The series argument is Julian centuries of TERRESTRIAL TIME (TT). Callers
 *   pass a JS Date, which is UTC. TT - UT1 = dT is presently ~69 s, and the Moon
 *   moves 0.549 arcsec per second of time, so ignoring dT would cost ~38 arcsec
 *   — four times the theory's own error. dT is therefore modelled (see below).
 */
/* ---- Moved from public/moon/lunar.js, lines 1-36 (the header above) and 39-436, and public/core/body.js, lines 30 and 117-161,
 * for the realistic globe's Moon (CHANGES-FROM-LEGACY.md, L75). Both files stay where they are, byte for byte
 * (tests/fixtures/moon-sha256.json), because the Moon pages load them as classic scripts, so this is a second copy:
 * tests/lib/moon-equivalence.test.ts runs the two classic files in node:vm beside it and demands the same bits from every
 * function carried, and the same text.
 *
 * From lunar.js, everything from the top of its IIFE to the end of moon(): Delta T and the time scales, the mean obliquity, the
 * nutation, the ELP-2000/82B series, the Sun of Meeus ch. 25, the phase and the selenographic points. moonApparent() and the
 * Lagrange points (lines 438-618) are not carried, though the header above still names them; lunar.js's own moonState(jde) (line
 * 561, the state vector the Lagrange points need) is one of them, and has nothing to do with moonState() at the foot of this file.
 * From body.js, moonOrientation(): the Moon's IAU/NAIF orientation (pck00011: the pole, the prime meridian and the 13-term
 * libration series, in ICRF), which body.js hands out as Body.Moon().orientation and .spin.
 *
 * The changes: lunar.js's IIFE head and its 'use strict' (lines 37-38) are gone, a module being strict and scoped already; and, at
 * lines marked CHANGED, `export const Lunar` stands where `global.Lunar =` stood, less what the lines not carried define, and
 * body.js's lines sit in a closure of their own, as they sat in its IIFE, because its RAD is pi/180 where lunar.js's is 180/pi.
 * Arithmetic, order and comments are untouched.
 *
 * Below the port, and not part of it: MoonState and moonState(), the typed surface the scene reads.
 */

const DEG = Math.PI/180, RAD = 180/Math.PI;
const J2000 = 2451545.0;
const AU    = 149597870.700;      // km, IAU 2012 defining value
const CKMS  = 299792.458;         // km/s

/* ---- masses ---------------------------------------------------------------
   Earth 5.97217e24 kg and Moon 7.34767309e22 kg. These are the IAU 2015 /
   DE430-consistent values: GM_E = 3.986004e14 and GM_M = 4.9028e12 m^3/s^2
   divided by CODATA-2018 G = 6.67430e-11. The CR3BP mass parameter is

       mu = m_moon / (m_earth + m_moon) = 0.01215058...

   equivalently a mass ratio of 1 : 81.30057. mu also fixes the barycentre, at
   mu*R from Earth's centre: at the mean distance 384400 km that is 4671 km —
   INSIDE the Earth, whose mean radius is 6371 km. The Earth does not circle a
   point out in space; it wobbles about one buried 1700 km under its surface. */
/* Take mu from GM, not from masses in kilogrammes.
   Nobody measures the mass of the Earth: what spacecraft tracking measures is
   the PRODUCT GM, and it measures it superbly - JPL DE440 carries GM_earth and
   GM_moon to about one part in 1e11. Converting those to kilogrammes means
   dividing by G, which is the worst-known constant in physics at roughly
   2.2e-5 relative, so a mass in kg throws away six orders of magnitude of
   precision before you start. Since the CR3BP only ever wants the RATIO, the
   division is pure loss.
   It is not merely tidy: mu from kg came out 0.0253% high, which moved L2 by
   5.7 km and the barycentre by 1.2 km - visible at the resolution this page
   quotes. */
const GM_EARTH = 398600.435507, GM_MOON = 4902.800118;        // km^3 s^-2, DE440
const GM_TOT   = GM_EARTH + GM_MOON;
const MU       = GM_MOON / GM_TOT;                            // 0.0121505839
const GCONST   = 6.67430e-11;                                 // m^3 kg^-1 s^-2, CODATA 2018
/* Masses, for display only — never fed back into the dynamics. */
const M_EARTH  = GM_EARTH*1e9 / GCONST, M_MOON = GM_MOON*1e9 / GCONST;

/* ---- dT = TT - UT1 --------------------------------------------------------
   Observed values (IERS / Espenak-Meeus tabulation) at the start of each year.
   Linear interpolation inside the table; Espenak's polynomials outside it.
   NOTE the flat tail: Earth's rotation has been speeding up since ~2016, so dT
   has been FALLING, which no long-term polynomial predicts — the usual
   2005-2050 formula 62.92 + 0.32217t + 0.005589t^2 reads 75.1 s for 2026 when
   the truth is 69.2 s, a 6 s (3.3 arcsec) blunder. For dates past the table the
   last value is simply held. Future dT is genuinely unknowable — it is set by
   the fluid core, not by a formula — so a date a decade out carries a couple of
   arcsec of irreducible timing error on top of the theory error. */
const DT_Y0 = 1960;
const DT_TAB = [
  33.15,33.59,34.00,34.47,35.03,35.73,36.54,37.43,38.29,39.20,   // 1960-69
  40.18,41.17,42.23,43.37,44.49,45.48,46.46,47.52,48.53,49.59,   // 1970-79
  50.54,51.38,52.17,52.96,53.79,54.34,54.87,55.32,55.82,56.30,   // 1980-89
  56.86,57.57,58.31,59.12,59.98,60.78,61.63,62.30,62.97,63.47,   // 1990-99
  63.83,64.09,64.30,64.47,64.57,64.69,64.85,65.15,65.46,65.78,   // 2000-09
  66.07,66.32,66.60,66.91,67.28,67.64,68.10,68.59,68.97,69.22,   // 2010-19
  69.36,69.36,69.29,69.22,69.18,69.19,69.20                      // 2020-26
];
function deltaT(year){
  const i = Math.floor(year) - DT_Y0;
  if(i >= 0 && i < DT_TAB.length-1){
    const f = year - Math.floor(year);
    return DT_TAB[i] + f*(DT_TAB[i+1]-DT_TAB[i]);
  }
  if(i >= DT_TAB.length-1) return DT_TAB[DT_TAB.length-1];       // held, see above
  let t;
  if(year >= 1941){ t = year-1950; return 29.07 + 0.407*t - t*t/233 + t*t*t/2547; }
  if(year >= 1920){ t = year-1920; return 21.20 + 0.84493*t - 0.076100*t*t + 0.0020936*t*t*t; }
  if(year >= 1900){ t = year-1900; return -2.79 + 1.494119*t - 0.0598939*t*t + 0.0061966*t*t*t - 0.000197*t*t*t*t; }
  if(year >= 1860){ t = year-1860; return 7.62 + 0.5737*t - 0.251754*t*t + 0.01680668*t*t*t - 0.0004473624*t*t*t*t + t*t*t*t*t/233174; }
  if(year >= 1800){ t = year-1800; return 13.72 - 0.332447*t + 0.0068612*t*t + 0.0041116*t*t*t - 0.00037436*t*t*t*t
      + 0.0000121272*t*t*t*t*t - 0.0000001699*t*t*t*t*t*t + 0.000000000875*t*t*t*t*t*t*t; }
  const u = (year-1820)/100;                                     // long-term parabola
  return -20 + 32*u*u;
}

/* ---- time conversions ----------------------------------------------------- */
function jdFrom(date){
  const ms = (date instanceof Date) ? date.getTime()
           : (typeof date === 'number') ? date
           : new Date(date).getTime();
  return ms/86400000 + 2440587.5;              // Unix epoch = JD 2440587.5 (UT)
}
/* JD(UT) -> JDE (TT). The year fed to deltaT is approximate to a day or so,
   which is far finer than dT itself is known. */
function toJDE(jd){
  const year = 2000 + (jd - J2000)/365.25;
  return jd + deltaT(year)/86400;
}
const centuries = jde => (jde - J2000)/36525;

const norm360 = x => { x %= 360; return x < 0 ? x+360 : x; };
const norm180 = x => { x = norm360(x); return x > 180 ? x-360 : x; };

/* ---- nutation (Meeus ch. 22, the four leading terms) -----------------------
   Good to ~0.5" in dpsi and ~0.1" in deps, i.e. below the lunar theory's own
   error. Returned, not applied — see the frame note at the top of the file. */
function nutation(T){
  const om = (125.04452 - 1934.136261*T + 0.0020708*T*T + T*T*T/450000)*DEG;
  const ls = (280.4665 + 36000.7698*T)*DEG;
  const lm = (218.3165 + 481267.8813*T)*DEG;
  return {
    dpsi: (-17.20*Math.sin(om) - 1.32*Math.sin(2*ls) - 0.23*Math.sin(2*lm) + 0.21*Math.sin(2*om))/3600,
    deps: (  9.20*Math.cos(om) + 0.57*Math.cos(2*ls) + 0.10*Math.cos(2*lm) - 0.09*Math.cos(2*om))/3600
  };
}
/* Mean obliquity of the ecliptic, Laskar's polynomial as given by Meeus 22.3. */
function meanObliquity(T){
  const u = T/100;
  let s = 21.448, p = 1;
  const c = [-4680.93, -1.55, 1999.25, -51.38, -249.67, -39.05, 7.12, 27.87, 5.79, 2.45];
  for(let i = 0; i < c.length; i++){ p *= u; s += c[i]*p; }
  return 23 + 26/60 + s/3600;
}

/* ---- ELP-2000/82B truncated, Meeus table 47.A ------------------------------
   Columns: D, M, M-prime, F, coefficient of sin(arg) for Sigma-l in 1e-6 degree,
   coefficient of cos(arg) for Sigma-r in 1e-3 km. Sixty terms. The first row is
   the equation of the centre (6.289 deg), the second the evection, the third the
   variation — the three that make a Keplerian Moon useless. */
const T47A = [
  0, 0, 1, 0,  6288774, -20905355,
  2, 0,-1, 0,  1274027,  -3699111,
  2, 0, 0, 0,   658314,  -2955968,
  0, 0, 2, 0,   213618,   -569925,
  0, 1, 0, 0,  -185116,     48888,
  0, 0, 0, 2,  -114332,     -3149,
  2, 0,-2, 0,    58793,    246158,
  2,-1,-1, 0,    57066,   -152138,
  2, 0, 1, 0,    53322,   -170733,
  2,-1, 0, 0,    45758,   -204586,
  0, 1,-1, 0,   -40923,   -129620,
  1, 0, 0, 0,   -34720,    108743,
  0, 1, 1, 0,   -30383,    104755,
  2, 0, 0,-2,    15327,     10321,
  0, 0, 1, 2,   -12528,         0,
  0, 0, 1,-2,    10980,     79661,
  4, 0,-1, 0,    10675,    -34782,
  0, 0, 3, 0,    10034,    -23210,
  4, 0,-2, 0,     8548,    -21636,
  2, 1,-1, 0,    -7888,     24208,
  2, 1, 0, 0,    -6766,     30824,
  1, 0,-1, 0,    -5163,     -8379,
  1, 1, 0, 0,     4987,    -16675,
  2,-1, 1, 0,     4036,    -12831,
  2, 0, 2, 0,     3994,    -10445,
  4, 0, 0, 0,     3861,    -11650,
  2, 0,-3, 0,     3665,     14403,
  0, 1,-2, 0,    -2689,     -7003,
  2, 0,-1, 2,    -2602,         0,
  2,-1,-2, 0,     2390,     10056,
  1, 0, 1, 0,    -2348,      6322,
  2,-2, 0, 0,     2236,     -9884,
  0, 1, 2, 0,    -2120,      5751,
  0, 2, 0, 0,    -2069,         0,
  2,-2,-1, 0,     2048,     -4950,
  2, 0, 1,-2,    -1773,      4130,
  2, 0, 0, 2,    -1595,         0,
  4,-1,-1, 0,     1215,     -3958,
  0, 0, 2, 2,    -1110,         0,
  3, 0,-1, 0,     -892,      3258,
  2, 1, 1, 0,     -810,      2616,
  4,-1,-2, 0,      759,     -1897,
  0, 2,-1, 0,     -713,     -2117,
  2, 2,-1, 0,     -700,      2354,
  2, 1,-2, 0,      691,         0,
  2,-1, 0,-2,      596,         0,
  4, 0, 1, 0,      549,     -1423,
  0, 0, 4, 0,      537,     -1117,
  4,-1, 0, 0,      520,     -1571,
  1, 0,-2, 0,     -487,     -1739,
  2, 1, 0,-2,     -399,         0,
  0, 0, 2,-2,     -381,     -4421,
  1, 1, 1, 0,      351,         0,
  3, 0,-2, 0,     -340,         0,
  4, 0,-3, 0,      330,         0,
  2,-1, 2, 0,      327,         0,
  0, 2, 1, 0,     -323,      1165,
  1, 1,-1, 0,      299,         0,
  2, 0, 3, 0,      294,         0,
  2, 0,-1,-2,        0,      8752
];
/* Meeus table 47.B: D, M, M-prime, F, coefficient of sin(arg) for Sigma-b,
   in 1e-6 degree. Sixty terms. */
const T47B = [
  0, 0, 0, 1,  5128122,
  0, 0, 1, 1,   280602,
  0, 0, 1,-1,   277693,
  2, 0, 0,-1,   173237,
  2, 0,-1, 1,    55413,
  2, 0,-1,-1,    46271,
  2, 0, 0, 1,    32573,
  0, 0, 2, 1,    17198,
  2, 0, 1,-1,     9266,
  0, 0, 2,-1,     8822,
  2,-1, 0,-1,     8216,
  2, 0,-2,-1,     4324,
  2, 0, 1, 1,     4200,
  2, 1, 0,-1,    -3359,
  2,-1,-1, 1,     2463,
  2,-1, 0, 1,     2211,
  2,-1,-1,-1,     2065,
  0, 1,-1,-1,    -1870,
  4, 0,-1,-1,     1828,
  0, 1, 0, 1,    -1794,
  0, 0, 0, 3,    -1749,
  0, 1,-1, 1,    -1565,
  1, 0, 0, 1,    -1491,
  0, 1, 1, 1,    -1475,
  0, 1, 1,-1,    -1410,
  0, 1, 0,-1,    -1344,
  1, 0, 0,-1,    -1335,
  0, 0, 3, 1,     1107,
  4, 0, 0,-1,     1021,
  4, 0,-1, 1,      833,
  0, 0, 1,-3,      777,
  4, 0,-2, 1,      671,
  2, 0, 0,-3,      607,
  2, 0, 2,-1,      596,
  2,-1, 1,-1,      491,
  2, 0,-2, 1,     -451,
  0, 0, 3,-1,      439,
  2, 0, 2, 1,      422,
  2, 0,-3,-1,      421,
  2, 1,-1, 1,     -366,
  2, 1, 0, 1,     -351,
  4, 0, 0, 1,      331,
  2,-1, 1, 1,      315,
  2,-2, 0,-1,      302,
  0, 0, 1, 3,     -283,
  2, 1, 1,-1,     -229,
  1, 1, 0,-1,      223,
  1, 1, 0, 1,      223,
  0, 1,-2,-1,     -220,
  2, 1,-1,-1,     -220,
  1, 0, 1, 1,     -185,
  2,-1,-2,-1,      181,
  0, 1, 2, 1,     -177,
  4, 0,-2,-1,      176,
  4,-1,-1,-1,      166,
  1, 0, 1,-1,     -164,
  4, 0, 1,-1,      132,
  1, 0,-1,-1,     -119,
  4,-1, 0,-1,      115,
  2,-2, 0, 1,      107
];

/* Geometric geocentric ecliptic position of the Moon, mean equinox of date.
   Degrees and km. T is Julian centuries of TT from J2000. */
function moonEcliptic(T){
  const T2 = T*T, T3 = T2*T, T4 = T3*T;
  /* Meeus 47.1 - 47.5 */
  const Lp = 218.3164477 + 481267.88123421*T - 0.0015786*T2 + T3/538841   - T4/65194000;
  const D  = 297.8501921 + 445267.1114034*T  - 0.0018819*T2 + T3/545868   - T4/113065000;
  const M  = 357.5291092 +  35999.0502909*T  - 0.0001536*T2 + T3/24490000;
  const Mp = 134.9633964 + 477198.8675055*T  + 0.0087414*T2 + T3/69699    - T4/14712000;
  const F  =  93.2720950 + 483202.0175233*T  - 0.0036539*T2 - T3/3526000  + T4/863310000;
  const A1 = 119.75 +    131.849*T;
  const A2 =  53.09 + 479264.290*T;
  const A3 = 313.45 + 481266.484*T;
  /* Terms involving M arise from the Sun's eccentricity, which is slowly
     shrinking, so they carry a factor E (Meeus 47.6) raised to |M|. */
  const E = 1 - 0.002516*T - 0.0000074*T2, E2 = E*E;

  const dR = D*DEG, mR = M*DEG, mpR = Mp*DEG, fR = F*DEG;
  let sl = 0, sr = 0, sb = 0;
  for(let i = 0; i < T47A.length; i += 6){
    const m = T47A[i+1];
    const a = T47A[i]*dR + m*mR + T47A[i+2]*mpR + T47A[i+3]*fR;
    const e = m === 0 ? 1 : (m === 1 || m === -1) ? E : E2;
    sl += T47A[i+4]*e*Math.sin(a);
    sr += T47A[i+5]*e*Math.cos(a);
  }
  for(let i = 0; i < T47B.length; i += 5){
    const m = T47B[i+1];
    const a = T47B[i]*dR + m*mR + T47B[i+2]*mpR + T47B[i+3]*fR;
    const e = m === 0 ? 1 : (m === 1 || m === -1) ? E : E2;
    sb += T47B[i+4]*e*Math.sin(a);
  }
  /* Additive terms: A1 is the action of Venus, A2 that of Jupiter, and the
     sin(L' - F) term is the flattening of the Earth. */
  const a1 = A1*DEG, a2 = A2*DEG, a3 = A3*DEG, lpR = Lp*DEG;
  sl += 3958*Math.sin(a1) + 1962*Math.sin(lpR - fR) + 318*Math.sin(a2);
  sb += -2235*Math.sin(lpR) + 382*Math.sin(a3) + 175*Math.sin(a1 - fR)
        + 175*Math.sin(a1 + fR) + 127*Math.sin(lpR - mpR) - 115*Math.sin(lpR + mpR);

  return {
    lon: norm360(Lp + sl/1e6),
    lat: sb/1e6,
    dist: 385000.56 + sr/1000,
    Lp: norm360(Lp), D: norm360(D), M: norm360(M), Mp: norm360(Mp), F: norm360(F),
    /* Mean longitude of the ascending node (Meeus 47.7) — the 18.6-year
       regression of the node; needed for the librations below. */
    om: norm360(125.0445479 - 1934.1362891*T + 0.0020754*T2 + T3/467441 - T4/60616000)
  };
}

/* ---- Sun, Meeus ch. 25 "low accuracy" (~0.01 deg) --------------------------
   Geometric geocentric position, mean equinox of date. Ecliptic latitude stays
   under 1.2" (the wobble imposed by the Moon and the planets) and is dropped. */
function sunEcliptic(T){
  const T2 = T*T;
  const L0 = 280.46646 + 36000.76983*T + 0.0003032*T2;      // geometric mean longitude
  const M  = 357.52911 + 35999.05029*T - 0.0001537*T2;      // mean anomaly
  const e  = 0.016708634 - 0.000042037*T - 0.0000001267*T2;
  const mR = M*DEG;
  const C  = (1.914602 - 0.004817*T - 0.000014*T2)*Math.sin(mR)   // equation of centre
           + (0.019993 - 0.000101*T)*Math.sin(2*mR)
           +  0.000289*Math.sin(3*mR);
  const trueLon = L0 + C, v = M + C;
  const R = 1.000001018*(1 - e*e)/(1 + e*Math.cos(v*DEG));        // AU
  return {lon: norm360(trueLon), lat: 0, dist: R*AU, M: norm360(M)};
}

/* Ecliptic (deg, deg, km) -> equatorial cartesian (km) about the same equinox. */
function eclToEq(lon, lat, r, eps){
  const l = lon*DEG, b = lat*DEG, e = eps*DEG;
  const cb = Math.cos(b);
  const x  = r*cb*Math.cos(l);
  const y0 = r*cb*Math.sin(l), z0 = r*Math.sin(b);
  return {x: x, y: y0*Math.cos(e) - z0*Math.sin(e), z: y0*Math.sin(e) + z0*Math.cos(e)};
}

/* ---- public: Sun ---------------------------------------------------------- */
function sun(date){
  const jd = jdFrom(date), jde = toJDE(jd), T = centuries(jde);
  const s = sunEcliptic(T);
  const eps = meanObliquity(T);
  const p = eclToEq(s.lon, 0, s.dist, eps);
  return {x: p.x, y: p.y, z: p.z, r: s.dist,
          /* extras beyond the contract */
          lon: s.lon, lat: 0,
          ra: norm360(Math.atan2(p.y, p.x)*RAD), dec: Math.asin(p.z/s.dist)*RAD,
          eps: eps, jd: jd, jde: jde};
}

/* ---- selenographic longitude of the sub-solar point (Meeus ch. 53) ---------
   The Moon keeps one face towards us only on average: optical libration in
   longitude swings the sub-Earth point by +/-7.9 deg, so "where is local noon on
   the Moon" is not simply the phase angle. This is the optical part; the
   physical libration it omits is under 0.04 deg. */
const I_MOON = 1.54242*DEG;          // inclination of the lunar equator to the ecliptic
function selenographic(lon, lat, om, F){
  const W = (lon - om)*DEG, b = lat*DEG;
  const sW = Math.sin(W), cW = Math.cos(W), sb = Math.sin(b), cb = Math.cos(b);
  const A = Math.atan2(sW*cb*Math.cos(I_MOON) - sb*Math.sin(I_MOON), cW*cb);
  return {l: norm180(A*RAD - F),
          b: Math.asin(-sW*cb*Math.sin(I_MOON) - sb*Math.cos(I_MOON))*RAD};
}

/* ---- public: Moon --------------------------------------------------------- */
function moon(date){
  const jd = jdFrom(date), jde = toJDE(jd), T = centuries(jde);
  const m = moonEcliptic(T);
  const s = sunEcliptic(T);
  const eps = meanObliquity(T);
  const nut = nutation(T);
  const p = eclToEq(m.lon, m.lat, m.dist, eps);

  /* Phase angle i at the Moon, Meeus 48.2/48.3 — the proper triangle solution,
     not the flat (1 - cos elongation)/2 shortcut, because the Sun is not at
     infinity: the two differ by up to 0.15 deg of phase angle, which is a
     visible shift of a rendered terminator. */
  const psi = Math.acos(Math.cos(m.lat*DEG)*Math.cos((m.lon - s.lon)*DEG));
  const i = Math.atan2(s.dist*Math.sin(psi), m.dist - s.dist*Math.cos(psi));
  const illum = (1 + Math.cos(i))/2;

  /* phase 0..1 from the elongation in longitude: 0 = new, 0.25 = first quarter,
     0.5 = full, 0.75 = last quarter. Monotone in time, so it is safe to animate
     and safe to difference; illum is NOT (it turns round at full). */
  const phase = norm360(m.lon - s.lon)/360;

  /* Sub-solar point. The Sun's apparent ecliptic place AS SEEN FROM THE MOON
     differs from the geocentric one by the parallax Delta/R, about 0.15 deg. */
  const k = m.dist/s.dist;
  const lonH = s.lon + 180 + k*RAD*Math.cos(m.lat*DEG)*Math.sin((s.lon - m.lon)*DEG);
  const latH = k*m.lat;
  const sub  = selenographic(lonH, latH, m.om, m.F);
  const lib  = selenographic(m.lon, m.lat, m.om, m.F);

  return {
    /* --- the contract --- */
    x: p.x, y: p.y, z: p.z,
    r: m.dist,                                  // km, centre to centre
    ra: norm360(Math.atan2(p.y, p.x)*RAD),      // DEGREES 0..360, mean equinox of date
    dec: Math.asin(p.z/m.dist)*RAD,             // degrees, -90..+90
    lon: m.lon, lat: m.lat,                     // ecliptic of date, degrees
    phase: phase,                               // 0 = new, 0.5 = full
    illum: illum,                               // illuminated fraction, 0..1
    subsolarLon: sub.l,                         // selenographic deg, -180..180, east +
    /* --- extras; purely additive, the contract above is unchanged --- */
    raHours: norm360(Math.atan2(p.y, p.x)*RAD)/15,
    subsolarLat: sub.b,
    colongitude: norm360(90 - sub.l),           // the almanac convention
    libLon: lib.l, libLat: lib.b,               // optical libration, degrees
    phaseAngle: i*RAD, elongation: psi*RAD,
    waxing: phase < 0.5,
    eps: eps, dpsi: nut.dpsi, deps: nut.deps, epsTrue: eps + nut.deps,
    jd: jd, jde: jde
  };
}

/* CHANGED: lunar.js's `global.Lunar = { ... }` (lines 620-627) as an export, less lagrange, moonApparent, moonState, collinear,
   gradOmega, fAxis, dfAxis and solveAxis, which the lines not carried define. */
export const Lunar = {
  moon, sun,
  /* internals, exported for the tests and for anyone wanting the raw series */
  moonEcliptic, sunEcliptic, nutation, meanObliquity, eclToEq, selenographic,
  deltaT, jdFrom, toJDE, centuries,
  MU, M_EARTH, M_MOON, G: GCONST, GM_TOT, AU, J2000
};

/* ---- public/core/body.js: the Moon's orientation ------------------------------------------------------------------------ */
export const moonOrientation = (function(){   // CHANGED: body.js's IIFE, cut to what this needs: its RAD is pi/180, lunar.js's 180/pi
const RAD = Math.PI/180;

/* NAIF pck00011.tpc, BODY3_NUT_PREC_ANGLES: the 13 arguments E1..E13, each
   given as (constant, rate) in degrees.
   The rate is per Julian CENTURY, not per day — a trap, because every other
   term in this model is per day. The check that settles it: E1 is the lunar
   node, and -1935.5364525/36525 = -0.052992 deg/day, which is the 18.6-year
   nodal regression. Using the raw number as a daily rate advances the arguments
   36525x too fast and produces a pole ~2 deg out — measured, before it was
   fixed. */
const MOON_E = [
  [125.045,  -1935.5364525000], [250.089,  -3871.0729050000],
  [260.008, 475263.3328725000], [176.625, 487269.6299850000],
  [357.529,  35999.0509575000], [311.589, 964468.4993100000],
  [134.963, 477198.8693250000], [276.617,  12006.3007650000],
  [ 34.226,  63863.5132425000], [ 15.134,  -5806.6093575000],
  [119.743,    131.8406400000], [239.961,   6003.1503825000],
  [ 25.053, 473327.7964200000]
];
/* BODY301_NUT_PREC_RA / _DEC / _PM, degrees. Zeros are real - not every
   argument contributes to every quantity. */
const MOON_DRA = [-3.8787, -0.1204,  0.0700, -0.0172, 0,       0.0072, 0,
                   0,       0,      -0.0052, 0,       0,       0.0043];
const MOON_DDEC = [1.5419,  0.0239, -0.0278,  0.0068, 0,      -0.0029, 0.0009,
                   0,       0,       0.0008, 0,       0,      -0.0009];
const MOON_DPM  = [3.5610,  0.1208, -0.0642,  0.0158, 0.0252, -0.0066, -0.0047,
                  -0.0046,  0.0028,  0.0052,  0.0040,  0.0019, -0.0044];

/* Days from J2000. UTC is used where TDB is meant; the difference is ~70 s,
   which moves W by 13.17635815 deg/day * 70/86400 = 1.1e-5 deg, about 0.3 m on
   the surface. Irrelevant here, and stated rather than hidden. */
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const moonDays = date => (date.getTime() - J2000_MS)/86400000;

function moonOrientation(date){
  const d = moonDays(date), T = d/36525;
  let ra = 269.9949 + 0.0031*T;
  let dec = 66.5392 + 0.0130*T;
  let W = 38.3213 + 13.17635815*d - 1.4e-12*d*d;
  for(let i=0;i<13;i++){
    const E = (MOON_E[i][0] + MOON_E[i][1]*T) * RAD;    // T: centuries, see above
    if(MOON_DRA[i])  ra  += MOON_DRA[i]  * Math.sin(E);
    if(MOON_DDEC[i]) dec += MOON_DDEC[i] * Math.cos(E);
    if(MOON_DPM[i])  W   += MOON_DPM[i]  * Math.sin(E);
  }
  return { ra: ra*RAD, dec: dec*RAD, W: ((W % 360) + 360) % 360 * RAD };
}

return moonOrientation;   // CHANGED: was `global.Body = { Earth, Moon }` (line 256), whose Moon() hands this out as .orientation and .spin
})();

/* ===============================================================================================================================
 * Not a port: new in the rebuild (CHANGES-FROM-LEGACY.md, L75). The Moon as the realistic sky draws it, from the two models above
 * and nothing else: where it is (lunar.js), how it is lit (lunar.js's phase, and Meeus 48.5 for the bright limb) and how it is
 * turned (body.js's IAU orientation, precessed to the date). The `@ts-nocheck` at the top covers these lines too, so the types
 * below are declarations the compiler does not check against the code; tests/lib/moon.test.ts holds the numbers. DEG and RAD here
 * are lunar.js's: DEG = pi/180 takes degrees to radians, RAD = 180/pi takes them back.
 * =============================================================================================================================== */

/** The Moon at one instant. Every vector is in one frame, lunar.js's: geocentric, equatorial, the mean equator and mean equinox of
 *  the date, right-handed, +Z the mean north celestial pole and +X the mean equinox. GMST is measured from that equinox, so this is
 *  the scene's ECI, to within the nutation (under 20 arcsec), drawn in the scene's axes as (x, z, -y) in Earth radii of
 *  6378.137 km. Angles are in degrees. */
export interface MoonState {
  /** the Moon's centre from the Earth's, km; geometric: no light time (1.3 s), aberration or nutation */
  eci: [number, number, number];
  /** from the Earth's centre to the Moon's, km */
  distanceKm: number;
  /** the angle Sun-Moon-Earth at the Moon (Meeus 48.3): 0 at full Moon, 180 at new. It comes no nearer to either than about the
   *  Moon's distance from the ecliptic at the time, up to 5.3, which is small only near an eclipse */
  phaseAngle: number;
  /** the lit share of the disc, (1 + cos phaseAngle) / 2, 0 to 1 (Meeus 48.1) */
  illuminated: number;
  /** the position angle of the midpoint of the bright limb (Meeus 48.5): from the disc's north point, towards the mean pole of the
   *  date, through east, 0 to 360; near 270 while the Moon waxes and near 90 while it wanes, and meaningless at new and full */
  brightLimbAngle: number;
  /** where on the Moon the Earth's centre is overhead: selenographic latitude and longitude (east +, -180 to 180). That is the
   *  libration, optical and physical */
  subEarth: { lat: number; lon: number };
  /** where on the Moon the Sun is overhead, likewise; the morning terminator is 90 degrees west of it */
  subSolar: { lat: number; lon: number };
  /** the Moon's north pole, a unit vector */
  poleEci: [number, number, number];
  /** from the Moon's centre towards selenographic 0 N 0 E, a unit vector at right angles to poleEci. With east = poleEci x primeEci,
   *  selenographic (lat, lon) lies along cos(lat) cos(lon) primeEci + cos(lat) sin(lon) east + sin(lat) poleEci; so a sphere
   *  whose local +X, +Y and +Z are primeEci, poleEci and -east, each in the scene's axes, carries an equirectangular map centred on
   *  longitude 0 the way three's SphereGeometry lays it on the Earth */
  primeEci: [number, number, number];
}

const dot3 = (a: number[], b: number[]): number => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a: number[], b: number[]): [number, number, number] =>
  [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];

/* IAU 1976 precession (Lieske 1977; Meeus 21.2 and 21.4), from J2000 to the mean equator and equinox of the date: the longitude
   gains zeta, the pole tilts by theta, and the longitude gains z. T is Julian centuries of TT from J2000. These are the
   polynomials orbitviz's precess() turns the star field by, so the Moon and the stars move together. */
function precessFromJ2000(v: number[], T: number): [number, number, number] {
  const as = DEG/3600;
  const zeta  = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T)*as;
  const z     = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T)*as;
  const theta = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T)*as;
  const c1 = Math.cos(zeta), s1 = Math.sin(zeta), c2 = Math.cos(theta), s2 = Math.sin(theta), c3 = Math.cos(z), s3 = Math.sin(z);
  const x1 = c1*v[0] - s1*v[1], y1 = s1*v[0] + c1*v[1];
  const x2 = c2*x1 - s2*v[2], z2 = s2*x1 + c2*v[2];
  return [c3*x2 - s3*y1, s3*x2 + c3*y1, z2];
}

/* The selenographic latitude and longitude of a direction from the Moon's centre, given the Moon's axes. */
function selenographicOf(v: number[], pole: number[], prime: number[], east: number[]): { lat: number; lon: number } {
  const x = dot3(v, prime), y = dot3(v, east), z = dot3(v, pole);
  return { lat: Math.atan2(z, Math.hypot(x, y))*RAD, lon: Math.atan2(y, x)*RAD };
}

/** The Moon at `date`, a UTC instant (lunar.js takes it to TT by its own Delta T). See MoonState. */
export function moonState(date: Date): MoonState {
  const m = moon(date), s = sun(date), o = moonOrientation(date);

  /* The Moon's axes. body.js's toFixed() takes ICRF to the Moon by turning the frame through Rz(90 + ra), Rx(90 - dec) and Rz(W),
     so the Moon's own axes, in ICRF, are those turns undone: the pole is at (ra, dec), and the prime meridian lies W round the
     Moon's equator from that equator's ascending node on the ICRF equator, at right ascension ra + 90. ICRF is J2000's mean equator
     and equinox to 0.02 arcsec, so precession brings both to the date; without it the libration is wrong by as much as the
     precession, 0.36 degrees in 2026. */
  const T = centuries(m.jde);
  const ca = Math.cos(o.ra), sa = Math.sin(o.ra), cd = Math.cos(o.dec), sd = Math.sin(o.dec), cw = Math.cos(o.W), sw = Math.sin(o.W);
  const pole = precessFromJ2000([cd*ca, cd*sa, sd], T);
  const prime = precessFromJ2000([-cw*sa - sw*sd*ca, cw*ca - sw*sd*sa, sw*cd], T);
  const east = cross3(pole, prime);

  /* Meeus 48.5. It takes the Sun's place from the Earth: the bright limb faces the Sun as seen from the Moon, but the part of that
     direction that lies across the sky is the same seen from either. */
  const a = m.ra*DEG, d = m.dec*DEG, a0 = s.ra*DEG, d0 = s.dec*DEG;
  const chi = Math.atan2(Math.cos(d0)*Math.sin(a0 - a),
                         Math.sin(d0)*Math.cos(d) - Math.cos(d0)*Math.sin(d)*Math.cos(a0 - a))*RAD;

  return {
    eci: [m.x, m.y, m.z],
    distanceKm: m.r,
    phaseAngle: m.phaseAngle,
    illuminated: m.illum,
    brightLimbAngle: norm360(chi),
    /* From the IAU axes, not from lunar.js's libLon/libLat and subsolarLon/Lat (Meeus ch. 53: the optical libration alone), so
       that they are the points the textured Moon shows. The two agree to 0.05 degrees over 1990-2050. */
    subEarth: selenographicOf([-m.x, -m.y, -m.z], pole, prime, east),
    subSolar: selenographicOf([s.x - m.x, s.y - m.y, s.z - m.z], pole, prime, east),
    poleEci: pole,
    primeEci: prime
  };
}
