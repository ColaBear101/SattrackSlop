/* body.js — everything that is a property of the central body.
 *
 * The ground-track console was written for the Earth and the Earth leaked into
 * every layer: RE and MU at module scope, the rotation angle from GMST, the
 * sub-satellite point from a WGS-84 geodetic conversion, the observer's
 * look angles from an Earth ellipsoid. None of that is wrong, but all of it is
 * an assumption rather than a parameter, and the Moon needs the same page with
 * different answers to the same questions.
 *
 * A Body answers exactly those questions:
 *
 *   spin(date)            where is the prime meridian now?     GMST / IAU W
 *   toFixed(r, theta)     inertial -> body-fixed
 *   toGeodetic(r, theta)  -> {latitude, longitude, height} radians and km
 *   lookAngles(site, rf)  -> {azimuth, elevation, rangeSat} from a surface site
 *
 * plus the constants that used to be globals. Nothing here knows about orbits,
 * propagation or element sets — that is the Propagator's job, and keeping the
 * two apart is what lets an Earth TLE and a lunar element set share a page.
 *
 * IMPORTANT, and the reason this file looks thin for the Earth: EarthWGS84
 * DELEGATES to satellite.js rather than reimplementing it. satellite.js carries
 * its own WGS-84 ellipsoid and its own IAU-1982 GMST series, and any hand-rolled
 * replacement would differ in the last bits. This phase is a pure restructuring
 * and has to come out bit-identical, so the maths is not touched — only moved.
 */
(function(global){
'use strict';

const RAD = Math.PI/180;

/* ---- Earth ---------------------------------------------------------------
 * `sat` is the satellite.js namespace, injected rather than imported so this
 * file stays loadable in node for the verification harness.
 */
function Earth(sat){
  return {
    id: 'earth',
    name: 'Earth',
    symbol: '⊕',

    /* Three radii, and they are genuinely different things:
       - Re/Rp: the WGS-84 ellipsoid, which is what a sub-satellite point and a
         ground station are defined against.
       - sgp4Re: WGS-72, 2 m smaller. SGP4's own constant set, the sphere its
         theory is defined on, and the right one for un-normalising satrec.a.
         Using WGS-84 there would silently shift every semi-major axis by 2 m. */
    Re: 6378.137,
    Rp: 6356.7523142,
    flattening: 1/298.257223563,
    sgp4Re: 6378.135,

    mu: 398600.4418,
    J2: 1.08262668e-3,

    /* Rotation. GMST is the angle TEME is defined against, so this is the
       rotation that takes a propagated position to the ground. */
    spin: date => sat.gstime(date),

    toFixed:    (r, theta) => sat.eciToEcf(r, theta),
    toGeodetic: (r, theta) => sat.eciToGeodetic(r, theta),

    /* site is {lat, lon, altKm} in degrees/km — the app's own shape, converted
       here so callers never have to remember which way round satellite.js
       wants it. */
    lookAngles: (site, rFixed) => sat.ecfToLookAngles(
      { longitude: site.lon*RAD, latitude: site.lat*RAD, height: site.altKm },
      rFixed),

    /* A day, for the "revolutions per day" the TLE mean motion is quoted in.
       Solar, not sidereal — that is the convention TLEs use. */
    daySeconds: 86400,

    hasAtmosphere: true,
    reentryAltKm: 120,

    defaultSite: { lat: 13.75, lon: 100.52, altKm: 0, name: 'Bangkok', tz: 7 },

    /* Sun-synchrony is an Earth-J2 coincidence, not a general orbital property:
       the node drifts ~0.9856 deg/day only for this J2, this radius and this
       mu. A body without that resonance answers false to everything. */
    sunSyncBand: [95, 104],
    sunSyncDriftDegPerDay: 0.9856
  };
}

/* ---- the Moon -------------------------------------------------------------
 * Self-contained: no satellite.js, because satellite.js is an Earth library all
 * the way down. Everything below is the IAU/NAIF model, implemented directly.
 *
 * Three ways this is genuinely simpler than the Earth, and one way it is much
 * harder.
 *
 * Simpler: the Moon is a SPHERE. NAIF pck00011.tpc gives
 * BODY301_RADII = (1737.4 1737.4 1737.4) - all three axes equal - so there is
 * no flattening, no prime-vertical radius of curvature, and geodetic latitude
 * is identical to geocentric latitude. Earth's WGS-84 machinery has no analogue
 * here and is not needed.
 *
 * Harder: the rotation. Earth's GMST is a smooth polynomial in time. The Moon's
 * orientation is a polynomial PLUS a 13-term libration series, and that series
 * is not a rounding detail - the leading prime-meridian coefficient is
 * 3.5610 DEGREES, which is 108 km along the lunar equator. Drop it and a ground
 * track lands on the wrong side of a named crater. It is implemented in full.
 */

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

function Moon(){
  /* Inertial (ICRF/J2000 equatorial) -> body-fixed is the standard IAU triple
     rotation Rz(W) . Rx(90-dec) . Rz(90+ra). Written out rather than composed
     from a matrix library so the three angles stay visible. */
  const toFixed = (r, o) => {
    const sa = Math.sin(o.ra + Math.PI/2), ca = Math.cos(o.ra + Math.PI/2);
    const x1 =  ca*r.x + sa*r.y, y1 = -sa*r.x + ca*r.y, z1 = r.z;
    const b  = Math.PI/2 - o.dec, sb = Math.sin(b), cb = Math.cos(b);
    const x2 = x1, y2 =  cb*y1 + sb*z1, z2 = -sb*y1 + cb*z1;
    const sw = Math.sin(o.W), cw = Math.cos(o.W);
    return { x:  cw*x2 + sw*y2, y: -sw*x2 + cw*y2, z: z2 };
  };

  return {
    id: 'moon',
    name: 'Moon',
    symbol: '☾',

    /* A sphere, per pck00011.tpc. Rp === Re is not laziness, it is the model. */
    Re: 1737.4, Rp: 1737.4, flattening: 0, sgp4Re: null,
    /* GM from the Horizons Moon record. Measured directly by tracking, so it
       carries none of G's ~2.2e-5 uncertainty - same argument as lunar.js. */
    mu: 4902.800066,
    J2: 2.034e-4,

    /* The whole orientation, not just the spin angle, because unlike Earth the
       pole itself librates. Callers hand this straight back to toFixed. */
    spin: date => moonOrientation(date),
    orientation: moonOrientation,

    toFixed,

    toGeodetic(r, o){
      const f = toFixed(r, o);
      const m = Math.hypot(f.x, f.y, f.z);
      return { latitude: Math.asin(f.z/m),
               longitude: Math.atan2(f.y, f.x),   // east-positive, IAU
               height: m - 1737.4 };
    },

    /* ENU from a site on a sphere. No ellipsoid term, so this is the textbook
       form rather than Earth's prime-vertical version. */
    lookAngles(site, rFixed){
      const la = site.lat*RAD, lo = site.lon*RAD;
      const rs = 1737.4 + (site.altKm || 0);
      const sx = rs*Math.cos(la)*Math.cos(lo),
            sy = rs*Math.cos(la)*Math.sin(lo),
            sz = rs*Math.sin(la);
      const dx = rFixed.x - sx, dy = rFixed.y - sy, dz = rFixed.z - sz;
      const sl = Math.sin(la), cl = Math.cos(la),
            so = Math.sin(lo), co = Math.cos(lo);
      const e = -so*dx + co*dy;
      const n = -sl*co*dx - sl*so*dy + cl*dz;
      const u =  cl*co*dx + cl*so*dy + sl*dz;
      const rng = Math.hypot(dx, dy, dz);
      return { azimuth: (Math.atan2(e, n) + 2*Math.PI) % (2*Math.PI),
               elevation: Math.asin(u/rng),
               rangeSat: rng };
    },

    /* A synodic lunar day, because that is what governs sunlight at a landing
       site: ~29.53 Earth days, half of it dark. The sidereal rotation period is
       27.32 d and is not the number a surface mission cares about. */
    daySeconds: 29.530589*86400,
    siderealDaySeconds: 27.321661*86400,

    hasAtmosphere: false,
    reentryAltKm: null,

    /* Chang'e-4 in Von Karman crater: the first far-side landing, and the one
       site that makes the Earth-visibility story immediate - from here the
       Earth never rises, which is the entire reason Queqiao exists. */
    defaultSite: { lat: -45.4446, lon: 177.5991, altKm: 0,
                   name: "Chang'e-4", tz: 0 },

    sunSyncBand: null,
    sunSyncDriftDegPerDay: 0
  };
}

global.Body = { Earth, Moon };

})(typeof window !== 'undefined' ? window : globalThis);
