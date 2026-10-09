// @ts-nocheck - moved verbatim; see the note below
/* PORTED VERBATIM from legacy/earth/advisor.js (main@4eadd7a), lines 49-811 of that file.
 * The only changes: the IIFE wrapper and 'use strict' are gone (an ES module is already strict and scoped),
 * the export is `export const Advisor` instead of `global.Advisor = `, and the lazy `global.X` lookups are imports.
 * Arithmetic, order and comments are untouched; the Node suites that guard this module run against both the
 * old file and the bundle of this one (verification/lib/harness.js, GT_TARGET).
 */
import { Planner } from './planner';
import { Lifetime } from './lifetime';
import { AdvisorCopy } from './advisor-copy';

/* advisor.js - the numbers behind the Professor: kernels, the context dictionary, and the
 * lifetime model. Pure: no DOM, no storage, no network, and no clock (it never asks what
 * time it is: every date it uses comes in through `el.epoch` and `env.window`, so the same
 * (el, env) always gives the same answer). Node can require() it.
 *
 * The Professor is two layers with one contract between them. This file works the numbers
 * out of a set of mean elements and hands over a flat dictionary `c` -- {h_mean: 700,
 * period: 98.8, sso_inc: 98.21, life_mid: 4380, ...}. earth/advisor-copy.js holds the 87
 * situations that can be said about an orbit and decides, from `c` alone, which of them
 * fire. Nothing here knows a sentence and nothing there knows a formula: a new sentence
 * needs new maths only when it needs a new key, and a new kernel stays invisible until
 * some record reads its key. advise() joins the two.
 *
 * Every kernel answers to a second implementation (verification/verify-advisor.js compares
 * them with SGP4 in satellite.js, with Meeus's Sun, and with real catalogue TLEs). The
 * traps it exists to step around, all measured, are in Planner's header and in SPEC 3.1;
 * the ones that bite here:
 *
 *   - Rates. The node, perigee and mean-anomaly rates are SGP4's own secular terms
 *     (Planner.rates, copied from sgp4init), not first-order J2: that one puts the
 *     sun-synchronous inclination 0.024 to 0.028 degrees low, a local-time slide of
 *     4.7 minutes a year at 500 km. From a Kepler period of 225 minutes SGP4 also adds
 *     the Moon and the Sun; those terms live in the satrec, so a context built with
 *     env.sat includes them and one without says so in __errors.
 *   - Which constant. Period <-> a uses SGP4's mu (398600.8), the repeat-track maths uses
 *     gstime's rotation rate (360.98564736629 deg/day) and the mean Sun's rate
 *     (360/365.2421897), and altitudes are measured from 6378.137 km. Planner holds all of
 *     them; this file reads them from there.
 *   - The Sun is the page's own low-precision Sun, copied byte for byte from index.html's
 *     sunEci, so the eclipse and beta angle the Professor quotes are the ones the globe's
 *     shading uses (verify-custom.js asserts equality on 500 random dates).
 *   - Eclipse. A circular orbit has a closed form (a cylindrical shadow: umbra only; against
 *     SGP4 plus the page's cone test it runs from 0.45 of a percentage point of the orbit too
 *     short to 0.15 too long, and 1 point short near the critical beta). That formula is off
 *     by up to 29 eclipse-free days and 11 minutes once e reaches 0.04, so from e = 0.005
 *     the year is sampled (eclipseYear) and from e = 0.05 the sun items stay silent.
 *   - Lifetime. One physical model for every number a student reads: the page's own
 *     atmosphere (Lifetime.rho) marched for a circular orbit by Lifetime.integrate and for
 *     an eccentric one by an orbit-averaged march (lifeEcc). The range is drag x3 / x1 /
 *     x1/3: an ASSUMED band, never a forecast and never a date. Lifetime.integrate takes
 *     1000 x (Cd*A/m in m2/kg); lifeCirc hides that unit so nobody else has to remember it.
 *
 * Planner and Lifetime are read lazily from the global at call time (never at load), so
 * script order does not matter. With Lifetime absent every life and fix key is simply
 * undefined and the items that need them do not fire.
 */

const PI = Math.PI, D2R = PI/180, R2D = 180/PI;
const RAD = Math.PI/180;                           // the name index.html's sunEci uses

const RE = 6378.137;                    // altitude datum, footprints, the shadow's radius: Planner.RE
const DAY_MS = 86400000;
const CAP_DAYS = 40000;                 // the lifetime model's own cap (Lifetime.integrate returns null past it)
const ENTRY_KM = 120;                   // the decay model's floor: below it re-entry is hours away
const UNCERT = 3;                       // the drag band: x3 / x1 / x1/3
const MOON_KM = 384400;
const DEEP_SHADOW_SAMPLES = 360;        // eclipseYear: samples uniform in mean anomaly per day

const isNum = x => typeof x === 'number' && isFinite(x);
const wrap360 = x => ((x % 360) + 360) % 360;
const wrap180 = x => ((x % 360) + 540) % 360 - 180;
const mod24 = h => ((h % 24) + 24) % 24;
const clamp1 = x => Math.max(-1, Math.min(1, x));
const fold = i => i > 90 ? 180 - i : i;

function planner(){
  const P = Planner;
  if(!P || typeof P.rates !== 'function') throw new Error('Advisor: Planner not loaded');
  return P;
}
function lifetime(){
  const L = Lifetime;
  if(!L || typeof L.integrate !== 'function' || typeof L.rho !== 'function') throw new Error('Advisor: Lifetime not loaded');
  return L;
}
const hasLifetime = () => !!(Lifetime && typeof Lifetime.integrate === 'function' && typeof Lifetime.rho === 'function');

/* ---------- the Sun --------------------------------------------------------------- */

/* The Sun, low-precision (NOAA/USNO almanac form): right ascension and declination good
   to about 0.01 deg, the distance to about 0.02 %. This is index.html's sunEci, character
   for character in the arithmetic (it is the Sun the globe's terminator and shadow test
   use, so the Professor and the picture cannot disagree); the only change is that it takes
   a number of milliseconds as well as a Date, because the year loops below call it 365
   times and a Date per call is allocation for nothing. */
function sunEci(date){
  const jd = (typeof date === 'number' ? date : date.getTime())/86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474*n) % 360;
  const g = ((357.528 + 0.9856003*n) % 360)*RAD;
  const lam = (L + 1.915*Math.sin(g) + 0.020*Math.sin(2*g))*RAD;
  const eps = (23.439 - 0.0000004*n)*RAD;
  const dec = Math.asin(Math.sin(eps)*Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps)*Math.sin(lam), Math.cos(lam));
  // astronomical unit varies by +-1.7% over the year; the shadow cone cares
  const distKm = 1.495979e8*(1.00014 - 0.01671*Math.cos(g) - 0.00014*Math.cos(2*g));
  return { ra, dec, distKm,
           x: Math.cos(dec)*Math.cos(ra), y: Math.cos(dec)*Math.sin(ra), z: Math.sin(dec) };
}

/* ---------- node, local time, beta angle ------------------------------------------- */

const ssoInc = (aKm, e, env) => planner().ssoInclination(aKm, e, env);
const nodeRate = (aKm, e, iDeg, satrec) => planner().rates(aKm, e, iDeg, satrec).nodedot;
/* Local MEAN solar time of the ascending node, hours. The equation of time (+-16 min) is
   not applied; mean solar time is UTC + longitude/15 exactly, which is what the check
   against the SGP4 node crossing uses. */
const ltan = (raanDeg, ms) => planner().ltanFromRaan(raanDeg, ms);

/* The angle between the Sun and the orbit PLANE: beta = asin(S . n), n the unit normal
   (sin i sin RAAN, -sin i cos RAAN, cos i), S the unit vector to the Sun. |beta| can reach
   i + 23.44 for i <= 90. */
function betaDeg(raanDeg, incDeg, ms){
  const S = sunEci(ms), O = raanDeg*D2R, i = incDeg*D2R;
  const nx = Math.sin(i)*Math.sin(O), ny = -Math.sin(i)*Math.cos(O), nz = Math.cos(i);
  return Math.asin(clamp1(S.x*nx + S.y*ny + S.z*nz))*R2D;
}
/* beta on `days` consecutive days from ms0 with the node regressing at nodeRate deg/day. */
function betaSeries(raanDeg, incDeg, nodeRateDegDay, ms0, days){
  const n = Math.max(0, Math.floor(days)), out = new Float64Array(n);
  for(let d = 0; d < n; d++) out[d] = betaDeg(raanDeg + nodeRateDegDay*d, incDeg, ms0 + d*DAY_MS);
  return out;
}
/* The range of beta over `days` days sampled every `step` days. */
function betaRange(raanDeg, incDeg, nodeRateDegDay, ms0, days, step){
  const nd = isNum(days) ? days : 365, st = isNum(step) && step > 0 ? step : 1;
  let mn = 91, mx = -91, mnAbs = 91, mxAbs = 0;
  for(let d = 0; d < nd; d += st){
    const b = betaDeg(raanDeg + nodeRateDegDay*d, incDeg, ms0 + d*DAY_MS);
    if(b < mn) mn = b;
    if(b > mx) mx = b;
    const ab = Math.abs(b);
    if(ab < mnAbs) mnAbs = ab;
    if(ab > mxAbs) mxAbs = ab;
  }
  return {min: mn, max: mx, minAbs: mnAbs, maxAbs: mxAbs};
}

/* ---------- eclipse ----------------------------------------------------------------- */

/* A circular orbit of radius r (km) at beta: the share of a revolution in the Earth's
   shadow, a cylinder of radius RE (umbra only; the penumbra adds about 0.3 point). Zero
   for |beta| at or above asin(RE/r), the angle at which the shadow misses the orbit. NaN
   for r <= RE (no orbit). */
function eclipseFrac(rKm, betaDegV){
  const s = RE/rKm;
  if(!(s < 1)) return NaN;
  const bs = Math.asin(s), b = Math.abs(betaDegV)*D2R;
  if(b >= bs) return 0;
  return Math.acos(Math.sqrt(1 - s*s)/Math.cos(b))/PI;
}
const betaCritDeg = rKm => Math.asin(RE/rKm)*R2D;

/* Where an eccentric orbit's samples sit on its own plane, N of them uniform in mean
   anomaly (so uniform in time): perifocal x, y and the squared radius. None of it depends
   on the day, only on a and e, which is what lets a whole year be sampled cheaply. */
function perifocalSamples(aKm, e, N){
  const px = new Float64Array(N), py = new Float64Array(N), r2 = new Float64Array(N), b = Math.sqrt(1 - e*e);
  for(let k = 0; k < N; k++){
    const M = 2*PI*k/N;
    let E = e < 0.8 ? M + e*Math.sin(M) : PI;
    for(let it = 0; it < 50; it++){
      const d = (E - e*Math.sin(E) - M)/(1 - e*Math.cos(E));
      E -= d;
      if(Math.abs(d) < 1e-13) break;
    }
    px[k] = aKm*(Math.cos(E) - e); py[k] = aKm*b*Math.sin(E); r2[k] = px[k]*px[k] + py[k]*py[k];
  }
  return {px, py, r2};
}
/* The Sun's direction on the orbit's plane: (u, w) = (S . P, S . Q) with P toward perigee
   and Q a quarter turn on, from RAAN, argument of perigee and inclination (radians). A
   point (x, y) of the orbit is then at S-distance x*u + y*w, which is all a shadow test
   needs. */
function sunOnPlane(S, O, w, i){
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  const Px = cO*cw - sO*sw*ci, Py = sO*cw + cO*sw*ci, Pz = sw*si;
  const Qx = -cO*sw - sO*cw*ci, Qy = -sO*sw + cO*cw*ci, Qz = cw*si;
  return {u: Px*S.x + Py*S.y + Pz*S.z, w: Qx*S.x + Qy*S.y + Qz*S.z};
}
/* How many of the samples are in the cylindrical shadow; `run`, if given, receives the
   per-sample flags so the longest unbroken stretch can be found. */
function shadowCount(smp, N, u, w, flags){
  let n = 0;
  for(let k = 0; k < N; k++){
    const along = smp.px[k]*u + smp.py[k]*w;
    const inside = along < 0 && smp.r2[k] - along*along < RE*RE;
    if(inside) n++;
    if(flags) flags[k] = inside ? 1 : 0;
  }
  return n;
}

/* Any eccentricity, one revolution with the mean elements frozen: 1,440 samples uniform
   in mean anomaly. Returns the umbra fraction, the longest unbroken eclipse in minutes
   and the Kepler period. Against SGP4 plus the page's cone test it is within 0.2 point
   (GTO on 21 December: 9.17 % against 8.97 %). */
function eclipseNumeric(aKm, e, incDeg, raanDeg, argpDeg, ms){
  const N = 1440, smp = perifocalSamples(aKm, e, N);
  const sp = sunOnPlane(sunEci(ms), raanDeg*D2R, argpDeg*D2R, incDeg*D2R);
  const flags = new Uint8Array(N), n = shadowCount(smp, N, sp.u, sp.w, flags);
  let best = 0, cur = 0;
  for(let k = 0; k < 2*N; k++){ if(flags[k % N]){ cur++; if(Math.min(cur, N) > best) best = Math.min(cur, N); } else cur = 0; }
  const per = planner().periodMin(aKm);
  return {fraction: n/N, maxMinutes: best/N*per, periodMin: per};
}

/* The year of eclipse for 0.005 <= e < 0.05: 365 days from the epoch, the node and the
   argument of perigee moved at SGP4's own secular rates from what was typed, the Sun from
   sunEci, a cylindrical shadow, DEEP_SHADOW_SAMPLES samples uniform in mean anomaly per
   day. Cost: the orbit's own sample points are computed once and each day only rotates the
   Sun into the plane, so a year is a few milliseconds. Returns the share of each day's
   revolution in shadow. `env.rates` ({nodedot, argpdot}, deg/day) may be passed to reuse
   the dictionary's. */
function eclipseYear(el, env){
  const P = planner();
  const rt = (env && env.rates && isNum(env.rates.nodedot)) ? env.rates : P.rates(el.a, el.e, el.i);
  const days = (env && isNum(env.days)) ? Math.max(1, Math.floor(env.days)) : 365;
  const N = (env && isNum(env.samples)) ? Math.max(8, Math.floor(env.samples)) : DEEP_SHADOW_SAMPLES;
  const smp = perifocalSamples(el.a, el.e, N), frac = new Float64Array(days), i = el.i*D2R;
  let free = 0, maxFrac = 0, minPos = 1;
  for(let d = 0; d < days; d++){
    const S = sunEci(el.epoch + d*DAY_MS);
    const sp = sunOnPlane(S, (el.raan + rt.nodedot*d)*D2R, (el.argp + rt.argpdot*d)*D2R, i);
    const f = shadowCount(smp, N, sp.u, sp.w, null)/N;
    frac[d] = f;
    if(f === 0) free++;
    else { if(f > maxFrac) maxFrac = f; if(f < minPos) minPos = f; }
  }
  return {frac, days, free, maxFrac, minPosFrac: free === days ? 0 : minPos};
}

/* ---------- what a site can see ------------------------------------------------------ */

/* The Earth-central half-angle (deg) inside which a satellite at radius r is above the
   elevation mask eps: lambda = acos(RE cos(eps)/r) - eps. At 300 / 500 / 800 / 2000 /
   35786 km with a 5 degree mask: 12.928 / 17.515 / 22.728 / 35.678 / 76.333 degrees. */
function accessAngleDeg(rKm, epsDeg){
  const eps = epsDeg*D2R;
  return (Math.acos(Math.min(1, RE*Math.cos(eps)/rKm)) - eps)*R2D;
}
/* The smallest altitude (km) from which a site lamDeg away from the sub-satellite point
   is seen above eps: the inverse of the above. */
function altForAccessDeg(lamDeg, epsDeg){
  const eps = epsDeg*D2R;
  return RE*Math.cos(eps)/Math.cos(lamDeg*D2R + eps) - RE;
}
/* The geometry of a track and an observer, from the orbit's mean height, its tilt and the
   site's latitude: the footprint radius, how far north or south of the equator a pass can
   be seen from, how close the track can come, the highest elevation that implies, the
   tilt that would reach the site, and the share of the Earth in view. */
function coverage(hMeanKm, foldIncDeg, latAbsDeg, maskDeg){
  const hm = Math.max(hMeanKm, 1), r = RE + hm;
  const lambda = accessAngleDeg(r, maskDeg);
  const reach = Math.min(90, foldIncDeg + lambda);
  const offtrack = Math.max(0, latAbsDeg - foldIncDeg);
  const psi = offtrack*D2R, rr = RE/r;
  const elBest = offtrack <= 0 ? 90 : Math.max(-90, Math.atan((Math.cos(psi) - rr)/Math.sin(psi))*R2D);
  const incNeed = Math.min(90, Math.ceil(Math.max(0, latAbsDeg - lambda)*2)/2 + 0.5);
  return {lambda, reach, offtrack, elBest, incNeed, footPct: (1 - rr)/2*100};
}
/* The mean local solar time (hours) at which an orbit of tilt inc and node time ltanH
   passes the site's latitude by day. The sub-satellite point at argument of latitude u
   is at local time ltan + atan2(cos i sin u, cos u)/15, and a latitude is crossed twice
   per revolution: northbound at u1 = asin(sin(lat)/sin i), southbound at 180 - u1. The
   daytime crossing is the ascending one when the ascending node is in daylight (LTAN in
   [06:00, 18:00)), the descending one otherwise -- the same rule as ltan_day. Signed
   latitude, so a southern site mirrors correctly. Measured against SGP4 at 13.75 N for LTAN 10:30: 10:22 predicted,
   passes between 09:12 and 10:49. */
function passClock(ltanH, incDeg, latDeg){
  const i = incDeg*D2R, s = Math.sin(i);
  if(!(Math.abs(s) > 1e-9)) return undefined;
  const u1 = Math.asin(clamp1(Math.sin(latDeg*D2R)/s));
  const ascendingByDay = ltanH >= 6 && ltanH < 18;
  const u = ascendingByDay ? u1 : PI - u1;
  return mod24(ltanH + Math.atan2(Math.cos(i)*Math.sin(u), Math.cos(u))*R2D/15);
}

/* ---------- repeat ground tracks ------------------------------------------------------ */

const gcd = (x, y) => y ? gcd(y, x % y) : x;
/* The ways an orbit with Q revolutions per nodal day closes up: K revolutions in D nodal
   days for D = 1..dMax, reduced fractions only. `ph` is how far Q*D is from the whole
   number K (revolutions); the ground track misses its start by `off` km at the equator
   after one cycle (each revolution shifts the track 360/Q degrees), the cycle lasts
   `days` solar days (the NODAL day, not D: an ISS-like 61/4 is 3.94 days) and neighbouring
   tracks lie `gap` km apart. `exact` means the miss is a twentieth of a revolution or
   better over the whole cycle. */
function repeatCandidates(Q, nodeDegDay, dMax){
  const out = [], we = planner().WE_DEG_DAY;
  for(let D = 1; D <= (dMax || 16); D++){
    const K = Math.round(Q*D);
    if(K < 1 || gcd(K, D) !== 1) continue;
    const ph = Math.abs(Q*D - K);
    out.push({K, D, ph, exact: ph*D <= 0.05, days: D*360/(we - nodeDegDay), off: 360*ph/Q*111.32, gap: 40075/K});
  }
  return out;
}
/* The semi-major axis (and inclination) of the orbit that repeats exactly: Q(a) = K/D by
   bisection on a. With opts.sso the inclination is re-solved inside the loop (the node
   rate sets i, i sets the repeat rate that sets a), 40 passes. Landsat's 233 revolutions
   in 16 days comes out at a = 7077.735 km, i = 98.2113. */
function repeatSolve(K, D, e, incDeg, opts){
  const P = planner(), target = K/D, sso = !!(opts && opts.sso);
  let a = RE + 700, inc = incDeg;
  for(let it = 0; it < 40; it++){
    if(sso){ inc = P.ssoInclination(a, e); if(inc === null) return null; }
    const an = P.aForRevsPerDay(target, e, inc);
    if(an === null) return null;
    const done = Math.abs(an - a) < 1e-10;
    a = an;
    if(done) break;
  }
  return {a, inc};
}
/* The nearest repeat among cycles of one to three days that the orbit does NOT already
   make: for each D the circular height (tilt held) at which Q = K/D exactly, and the
   closest one within 10 km. */
function repeatNear(Q, e, incDeg, hMeanKm){
  const P = planner();
  let best = null;
  for(let D = 1; D <= 3; D++){
    const K = Math.round(Q*D);
    if(K < 1) continue;
    const an = P.aForRevsPerDay(K/D, e, incDeg);
    if(an === null) continue;
    const h = an - RE, dh = Math.abs(h - hMeanKm);
    if(dh <= 10 && (!best || dh < best.dh - 2)) best = {K, D, h, dh};
  }
  return best;
}

/* ---------- geostationary helpers ----------------------------------------------------- */

/* The elevation (deg) of a point on the geostationary ring at longitude lonSat, seen from
   `site` (spherical Earth: cos g = cos(lat) cos(dLon), el = atan2(cos g - RE/r, sin g)).
   From Bangkok at 100.52 E it is 73.837 degrees, against 73.88 from the page's look-angle
   code. */
function geoElevation(lonSatDeg, site){
  const cg = Math.cos(site.lat*D2R)*Math.cos(wrap180(site.lon - lonSatDeg)*D2R);
  return Math.atan2(cg - RE/planner().GEO_A_KM, Math.sqrt(Math.max(0, 1 - cg*cg)))*R2D;
}
/* The longitudes from which the ring is above the mask, west and east edge: half-width
   acos(cos(lambda)/cos(lat)) about the site's longitude, 75.9 degrees at 13.75 N with a 5
   degree mask. */
function geoVisibleLongitudes(site, maskDeg){
  const r = planner().GEO_A_KM, lam = accessAngleDeg(r, maskDeg);
  const cl = Math.cos(site.lat*D2R);
  const half = cl > 1e-9 ? Math.acos(Math.min(1, Math.cos(lam*D2R)/cl))*R2D : 0;
  return {lo: site.lon - half, hi: site.lon + half, half, lambda: lam};
}
/* The longest geostationary eclipse (minutes, the dark core of the shadow) and the length
   of one eclipse season (days): the shadow's half-angle seen from the Earth's centre
   against the Sun's declination swing. */
function geoEclipse(){
  const P = planner(), b0 = Math.asin(RE/P.GEO_A_KM);
  return {maxMin: 2*b0/(2*PI)*P.SIDEREAL_MIN, seasonDays: 2*Math.asin(Math.sin(b0)/Math.sin(23.4393*D2R))/(2*PI)*365.2422};
}
/* Share of an orbit spent above its mean radius: 1/2 + e/pi (Kepler's equation). */
const hiDwell = e => 50 + 100*e/PI;
/* The e a textbook frozen orbit has, e_f = -(J3/2J2)(Re/a) sin i. In SGP4's MEAN elements
   the J3 offset is already inside the model, so the frozen orbit is e = 0 and this number
   is what a student must NOT type (verified by an SGP4 run over 180 days). */
function frozenE(aKm, incDeg){
  const C = planner().C72;
  return -(C.J3/(2*C.J2))*(C.Re/aKm)*Math.sin(incDeg*D2R);
}

/* ---------- drag and lifetime ---------------------------------------------------------- */

const dragAvg = (aKm, e, B, mult) => planner().dragAvg(aKm, e, B, mult);

/* Time from a circular orbit of radius aKm to the 120 km floor, days (null past the
   40,000-day cap), for a ballistic coefficient B = Cd*A/m in m2/kg and a drag multiplier.
   Lifetime.integrate takes 1000 x m2/kg -- hand it B unscaled and it returns null for
   everything -- so the unit lives here and nowhere else. T(k*B) = T(B)/k exactly. */
function lifeCirc(aKm, B, mult, sample){
  const m = isNum(mult) ? mult : 1;
  return lifetime().integrate(aKm, 1000*B*m, ENTRY_KM, !!sample);
}

/* The same for an eccentric orbit, by marching the ORBIT-AVERAGED a and e (Planner.dragAvg)
   with a midpoint step limited to half a kilometre of perigee motion, five days, and the
   distance left to the floor. Ends when the perigee altitude reaches floorKm; days is null
   past maxDays. As e -> 0 it equals Lifetime.integrate (1e-5 relative); against SGP4's own
   mean-element drift of a and e it is within 0.2 %. `sample` adds a track of {t, h} with h
   the PERIGEE height. */
function lifeEcc(aKm, e, B, mult, floorKm, maxDays, sample){
  const P = planner();
  const m = isNum(mult) ? mult : 1, floor = isNum(floorKm) ? floorKm : ENTRY_KM, cap = isNum(maxDays) ? maxDays : CAP_DAYS;
  let a = aKm, ee = e, t = 0, steps = 0;
  const pg = () => a*(1 - ee) - RE;
  const track = sample ? [{t: 0, h: pg()}] : null;
  let lastH = pg(), lastT = 0;
  while(pg() > floor && t < cap){
    const r1 = P.dragAvg(a, ee, B, m);
    const rate = Math.max(Math.abs(r1.dadt_kmday)*(1 - ee) + a*Math.abs(r1.dedt_day), 1e-12);   // km/day of perigee motion, bounded above
    /* Step: half a kilometre of perigee motion, or the distance left to the floor, or five
       days -- and the five days grow with the elapsed time (2 % of it), because an orbit that
       never decays inside the 40,000-day cap would otherwise take 8,000 identical steps
       (187 ms against the 150 ms budget); with the growth it takes about 300 and the lifetimes
       move by under 1e-5 relative over a 360-orbit grid. The rule also scales with time, so
       drag x3 is the same march three times as fast. */
    let dt = Math.min(0.5/rate, Math.max(5, t/50), (pg() - floor)/rate + 1e-6);
    if(!(dt > 1e-7)) dt = 1e-7;
    const a2 = a + r1.dadt_kmday*dt/2, e2 = Math.max(0, ee + r1.dedt_day*dt/2);
    const r2 = P.dragAvg(a2, e2, B, m);
    a += r2.dadt_kmday*dt; ee = Math.max(0, ee + r2.dedt_day*dt); t += dt;
    if(track && (lastH - pg() >= 4 || t - lastT >= 100)){ lastH = pg(); lastT = t; track.push({t, h: lastH}); }
    if(++steps > 400000) return {days: null, track};
  }
  if(track) track.push({t, h: pg()});
  return {days: t >= cap ? null : t, track};
}

const lifeDays = d => (d === null || d === undefined || !(d <= CAP_DAYS)) ? Infinity : d;

/* The lifetime of an element set after the epoch. Decision order, first match:
     no area over mass known           -> none, 'no-drag'
     area over mass 0                  -> none, 'no-drag' (every figure Infinity)
     perigee under 120 km              -> none, 'reentry'
     Kepler period of 225 min or more  -> none, 'deep'         (SGP4 changes model; Moon and Sun, not drag)
     perigee above 1,000 km            -> none, 'high-perigee' (the atmosphere table ends there)
     e under 0.002                     -> circular
     e above 0.3                       -> none, 'ecc-high'
     apogee above 5,000 km             -> none, 'high-apogee'
     otherwise                         -> eccentric
   (The design lists the apogee test before the e test. With a perigee of at least 120 km an e above
   0.3 puts the apogee above 5,690 km, so that order could never answer 'ecc-high': the test below
   would be dead code and the reason unreachable. The two reasons are told apart only here; the
   Decay section says the same thing for both.)
   The boundary at e = 0.002 is where the two models agree to 1.1 % (500 km: 5.39 y circular
   against 5.36 y eccentric), so a student turning the e knob never meets a jump; the old
   boundary at 0.02 had a factor-2 step in it. mid is the drag as given; lo is drag x3, hi is
   drag x1/3. The band is an ASSUMPTION about drag as a whole (density and area over mass
   together), not an interval; a solar cycle alone swings the density at 400 km by about a
   factor of ten. It is days after the epoch, never a date. */
function life(el, opts){
  const P = planner(), o = opts || {};
  const withTracks = o.tracks !== false;
  const given = el !== null && typeof el === 'object';
  const a = given ? el.a : NaN, e = given ? el.e : NaN, am = given ? el.am : undefined;
  const hp = a*(1 - e) - RE, ha = a*(1 + e) - RE;
  const out = {model: 'none', why: null, mid: undefined, lo: undefined, hi: undefined, h0: hp, rate0: undefined,
    track: undefined, fastTrack: undefined, slowTrack: undefined, capDays: CAP_DAYS};
  /* An element set with no usable size or shape gets no figure, not an exception: the Decay section
     calls this on every entry it loads. */
  if(!given || !isNum(a) || !(a > 0) || !isNum(e) || !(e >= 0 && e < 1)){ out.h0 = undefined; out.why = 'no-drag'; return out; }
  if(!isNum(am)){ out.why = 'no-drag'; return out; }
  if(am === 0){ out.why = 'no-drag'; out.mid = out.lo = out.hi = Infinity; return out; }
  if(hp < ENTRY_KM){ out.why = 'reentry'; return out; }
  if(P.periodMin(a) >= P.LIMITS.deepPeriodMin){ out.why = 'deep'; return out; }
  if(hp > 1000){ out.why = 'high-perigee'; return out; }
  const B = P.CD*am;
  if(e < 0.002){
    lifetime();
    const r1 = kernels.lifeCirc(a, B, 1, withTracks), r3 = kernels.lifeCirc(a, B, UNCERT, withTracks), rh = kernels.lifeCirc(a, B, 1/UNCERT, withTracks);
    out.model = 'circular'; out.h0 = a - RE;
    out.mid = lifeDays(r1.days); out.lo = lifeDays(r3.days); out.hi = lifeDays(rh.days);
    out.rate0 = P.dragAvg(a, 0, B, 1).dadt_kmday;
    if(withTracks){ out.track = r1.track; out.fastTrack = r3.track; out.slowTrack = rh.track; }
    return out;
  }
  if(e > 0.3){ out.why = 'ecc-high'; return out; }
  if(ha > 5000){ out.why = 'high-apogee'; return out; }
  lifetime();
  const r1 = kernels.lifeEcc(a, e, B, 1, ENTRY_KM, CAP_DAYS, withTracks);
  out.model = 'eccentric'; out.h0 = hp;
  out.mid = lifeDays(r1.days);
  out.rate0 = P.dragAvg(a, e, B, 1).dadt_kmday;
  /* The eccentric march is autonomous and its rates are linear in B, so drag x3 is the
     same path walked three times as fast: lo = mid/3 and hi = 3*mid, exactly. If the
     middle run hit the cap, the fast one is a second march (its own cap) and hi is open. */
  let fast = null;
  if(out.mid === Infinity){
    fast = kernels.lifeEcc(a, e, B, UNCERT, ENTRY_KM, CAP_DAYS, withTracks);
    out.lo = lifeDays(fast.days);
    out.hi = Infinity;
  } else {
    out.lo = out.mid/UNCERT;
    out.hi = out.mid*UNCERT > CAP_DAYS ? Infinity : out.mid*UNCERT;
  }
  if(withTracks){
    const scaled = (tr, k) => tr.map(p => ({t: p.t*k, h: p.h})).filter(p => p.t <= CAP_DAYS);
    out.track = r1.track;
    out.fastTrack = fast ? fast.track : scaled(r1.track, 1/UNCERT);
    out.slowTrack = scaled(r1.track, UNCERT);
  }
  return out;
}

/* The circular height (km, 150 to 1,000) whose mid-case life is `targetDays` at this area
   over mass, by bisection on altitude. undefined when no such height exists: the life at
   150 km is already longer than the target (the area over mass is too small) or the life at
   1,000 km is still shorter (it is too large: a two-year orbit needs am below about 5, a
   25-year one below about 0.5). 36 halvings leave the answer 1e-8 km from the root (the design said 60,
   which only made the lazy keys slower: each step is a whole decay march); the caller rounds. */
function fixHeight(am, targetDays){
  if(!(am > 0) || !hasLifetime()) return undefined;
  const B = Planner.CD*am;
  const T = h => lifeDays(kernels.lifeCirc(RE + h, B, 1, false).days);
  let lo = 150, hi = 1000;
  if(T(lo) > targetDays || T(hi) < targetDays) return undefined;
  for(let k = 0; k < 36; k++){ const m = (lo + hi)/2; if(T(m) < targetDays) lo = m; else hi = m; }
  return (lo + hi)/2;
}
const up10 = h => h === undefined ? undefined : Math.ceil(h/10)*10;      // "raise to": never below the target life
const down10 = h => h === undefined ? undefined : Math.floor(h/10)*10;   // "lower to": never above it

/* A number floored to two significant digits and never below 0.001: the figure a student
   is told to type must itself pass the check it failed (Planner.validate uses the same
   rule for err.bstar.range). */
function floorSig2(x){
  if(!(x > 0) || !isFinite(x)) return x;
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.max(0.001, Number((Math.floor(x/p + 1e-9)*p).toPrecision(2)));
}

/* ---------- the context dictionary --------------------------------------------------- */

const isoZ = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z').replace('T', ' ');

/* The dictionary for an element set seen from an observer. env is SPEC 2.3's: nowMs (required of
   the caller, and never read here: the advisor has no clock), site, maskDeg, window, measured,
   tracked, host, sat; plus an optional name (the planner's name box; 'My orbit' if absent).
   Never throws for an el with a finite a > 0 and 0 <= e < 1: each kernel runs inside its own
   try, and what it could not say is left undefined and noted in c.__errors. */
function context(el, env){
  const E = (env !== null && typeof env === 'object') ? env : {};
  const c = {__errors: []};
  const note = (kernel, e) => { c.__errors.push({kernel, msg: String(e && e.message ? e.message : e)}); };
  /* A number goes in only if it is finite (Infinity too where "beyond the cap" is the
     answer): a NaN or an undefined never reaches a sentence, it is a missing key. */
  const put = (k, v, inf) => { if(typeof v === 'number' ? (isFinite(v) || (inf === true && v === Infinity)) : v !== undefined) c[k] = v; };
  const run = (kernel, fn) => { try { fn(); } catch(e){ note(kernel, e); } };
  /* A key that is worked out only when something reads it, once. */
  const lazy = (key, fn, inf) => {
    let done = false, val;
    const get = () => {
      if(!done){
        done = true;
        try { val = fn(); } catch(e){ note(key, e); val = undefined; }
        if(typeof val === 'number' && !(isFinite(val) || (inf === true && val === Infinity))) val = undefined;
      }
      return val;
    };
    Object.defineProperty(c, key, {enumerable: true, configurable: true, get,
      set(v){ Object.defineProperty(c, key, {value: v, enumerable: true, writable: true, configurable: true}); }});
  };

  if(el === null || typeof el !== 'object' || !isNum(el.a) || !(el.a > 0) || !isNum(el.e) || !(el.e >= 0 && el.e < 1) || !isNum(el.i)){
    note('input', 'el needs a finite a > 0, 0 <= e < 1 and a finite i');
    return c;
  }
  let P;
  try { P = planner(); } catch(e){ note('planner', e); return c; }

  const a = el.a, e = el.e, inc = el.i, raan = el.raan, argp = el.argp, M = el.M, epoch = el.epoch;
  const mask = isNum(E.maskDeg) ? E.maskDeg : 5;
  const siteIn = (E.site !== null && typeof E.site === 'object') ? E.site : null;
  if(!siteIn) note('env', 'env.site is missing: the observer is a placeholder');
  if(!isNum(E.nowMs)) note('env', 'env.nowMs is missing (the advisor never reads the clock; the caller supplies it)');
  const site = {name: siteIn && typeof siteIn.name === 'string' && siteIn.name !== '' ? siteIn.name : 'the observer',
    lat: siteIn && isNum(siteIn.lat) ? siteIn.lat : 0, lon: siteIn && isNum(siteIn.lon) ? siteIn.lon : 0, tz: siteIn && isNum(siteIn.tz) ? siteIn.tz : 0};

  /* ---- who and what ---- */
  put('name', typeof E.name === 'string' && E.name !== '' ? E.name.slice(0, 80) : 'My orbit');
  put('a', a); put('e', e); put('inc', inc); put('raan', raan); put('argp', argp); put('ma', M);
  const am = isNum(el.am) ? el.am : undefined;
  put('am', am);
  put('cd', P.CD); put('cap', P.LIMITS.maxCustom); put('a_max', P.LIMITS.aMax);
  put('mask', mask); put('entry', ENTRY_KM); put('uncert', UNCERT);
  run('epoch', () => { put('epoch_utc', isoZ(epoch)); });

  /* ---- size, shape, period, speed ---- */
  const ap = P.apsides(a, e);
  const hp = ap.hp, ha = ap.ha, hMean = a - RE;
  put('rp', ap.rp); put('hp', hp); put('ha', ha); put('h_mean', hMean);
  const period = P.periodMin(a);
  put('period', period); put('revs', 1440/period);
  put('v', Math.sqrt(P.C72.mu/a));
  put('vp', Math.sqrt(P.C72.mu*(1 + e)/(a*(1 - e)))); put('va', Math.sqrt(P.C72.mu*(1 - e)/(a*(1 + e))));
  const foldInc = fold(inc);
  put('fold_inc', foldInc); put('off180', 180 - inc);
  put('sidereal', P.SIDEREAL_MIN); put('geo_a', P.GEO_A_KM); put('geo_alt', P.GEO_A_KM - RE);
  put('deep_alt', P.aFromPeriodMin(P.LIMITS.deepPeriodMin) - RE);

  /* ---- SGP4's own secular rates ---- */
  let rt = null;
  run('rates', () => {
    let satrec;
    if(P.isDeep(a) && E.sat && typeof E.sat.twoline2satrec === 'function'){
      try {
        const t = P.toTLE({a, e, i: inc, raan, argp, M, epoch, am: null, bstar: 0}, 'O0000');
        satrec = E.sat.twoline2satrec(t.l1, t.l2);
      } catch(err){ satrec = undefined; }
    }
    rt = P.rates(a, e, inc, satrec);
    if(rt.deep && rt.source !== 'satrec') note('rates', 'deep rates +-5 %');
  });
  if(rt){
    put('node', rt.nodedot); put('argp_rate', rt.argpdot); put('sso_rate', P.MEAN_SUN_RATE);
    put('period_nodal', rt.nodalPeriodS/60);
    const drift = rt.mdot + rt.argpdot + rt.nodedot - P.WE_DEG_DAY;
    put('drift', drift); put('drift_abs', Math.abs(drift)); put('drift_dir', drift > 0 ? 'east' : 'west');
    put('argp_q_days', Math.abs(rt.argpdot) > 0 ? 90/Math.abs(rt.argpdot) : Infinity, true);
    const dper = period - P.SIDEREAL_MIN;
    put('plonger', dper > 0 ? 'longer' : 'shorter'); put('dperiod_abs', Math.abs(dper));
  }

  /* ---- sun-synchronous, local time of the node ---- */
  run('sso', () => {
    const si = P.ssoInclination(a, e, {sat: E.sat, epoch});
    c.sso_inc = si;                                       // null above the limit, never undefined
    const amax = P.ssoAmaxKm(e);
    if(amax !== null) put('sso_amax_alt', amax - RE);
  });
  run('ltan', () => {
    const lt = P.ltanFromRaan(raan, epoch);
    put('ltan', lt); put('ltdn', (lt + 12) % 24);
    const day = (lt >= 6 && lt < 18) ? lt : (lt + 12) % 24;
    put('ltan_day', day); put('ltan_night', (day + 12) % 24);
    if(rt){
      const drift = (rt.nodedot - P.MEAN_SUN_RATE)*4;     // minutes of clock time per day
      put('ltan_drift', drift); put('ltan_drift_abs', Math.abs(drift));
      put('ltan_dir', drift < 0 ? 'earlier' : 'later'); put('ltan_drift_year', drift*365/60);
    }
  });

  /* ---- the Sun: beta angle and eclipse (circular below e 0.005, sampled below 0.05) ---- */
  if(rt && e < 0.05 && a > RE){
    run('sun', () => {
      const days = 365, bs = betaSeries(raan, inc, rt.nodedot, epoch, days);
      let bmin = 91, bmax = -91, bminAbs = 91;
      for(let d = 0; d < days; d++){ const b = bs[d]; if(b < bmin) bmin = b; if(b > bmax) bmax = b; if(Math.abs(b) < bminAbs) bminAbs = Math.abs(b); }
      put('beta_min', bmin); put('beta_max', bmax); put('beta_min_abs', bminAbs);
      put('beta_crit', betaCritDeg(a));
      let frac;
      if(e < 0.005){
        frac = new Float64Array(days);
        for(let d = 0; d < days; d++) frac[d] = eclipseFrac(a, bs[d]);
      } else {
        frac = kernels.eclipseYear({a, e, i: inc, raan, argp, epoch}, {rates: rt, days}).frac;
      }
      let free = 0, fmax = 0, fminPos = 1;
      for(let d = 0; d < days; d++){
        const f = frac[d];
        if(f === 0) free++;
        else { if(f > fmax) fmax = f; if(f < fminPos) fminPos = f; }
      }
      put('free_days', free); put('ecl_max_pct', 100*fmax); put('ecl_max_min', fmax*period);
      put('cycles', (1440/period)*(days - free));
      const lo = Math.round((free === days ? 0 : fminPos)*period), hi = Math.round(fmax*period);
      put('ecl_txt', free === days ? '0 min' : lo === hi ? hi + ' min' : lo + ' to ' + hi + ' min');
    });
  }

  /* ---- geosynchronous ---- */
  run('geo', () => {
    const gm = P.gmstDeg(epoch);
    const lon = wrap180(raan + argp + M - gm);
    put('geo_lon', lon);
    put('eight_lat', foldInc); put('ew_amp', 2*e*R2D);
    put('gnss_slide', Math.abs(360*(2*period - P.SIDEREAL_MIN)/P.SIDEREAL_MIN));
    const el0 = kernels.geoElevation(lon, site);
    put('el_geo', el0); c.geo_vis = el0 >= mask;
    const vis = kernels.geoVisibleLongitudes(site, mask);
    put('vis_lo', vis.lo); put('vis_hi', vis.hi);
    put('ma_site', wrap360(site.lon + gm - raan - argp));
    const ge = kernels.geoEclipse();
    put('geo_ecl_max', ge.maxMin); put('geo_season_days', ge.seasonDays);
  });

  /* ---- the shape in words ---- */
  put('apo_lat', Math.asin(clamp1(Math.sin(inc*D2R)*Math.sin((argp + 180)*D2R)))*R2D);
  put('hi_dwell_pct', kernels.hiDwell(e)); put('ha_moon_pct', ha/MOON_KM*100);
  put('u', wrap360(argp + M)); put('lon_sum', wrap360(raan + argp + M));
  put('inc_crit', inc > 90 ? 116.6 : 63.4);
  put('e_f', kernels.frozenE(a, inc));
  run('retro', () => {
    put('retro_err', P.retroErrorKm(a, e, inc));
    c.retro_lead = P.isDeep(a) ? 'on the order of' : 'about';
  });

  /* ---- the observer ---- */
  put('site', site.name); put('site_lat', site.lat); put('site_lon', site.lon);
  put('site_lat_abs', Math.abs(site.lat)); put('site_lat_round', Math.round(Math.abs(site.lat)));
  run('coverage', () => {
    const cv = kernels.coverage(hMean, foldInc, Math.abs(site.lat), mask);
    put('lambda', cv.lambda); put('reach', cv.reach); put('offtrack', cv.offtrack); put('el_best', cv.elBest);
    put('inc_need', cv.incNeed); put('foot_pct', cv.footPct);
    put('foot_pct_500', kernels.coverage(500, 0, 0, mask).footPct);
    if(c.ltan_day !== undefined){
      const clk = kernels.passClock(c.ltan, inc, site.lat);
      if(clk !== undefined){
        put('lt_pass_day', clk); put('pass_spread_h', cv.lambda/15);
        put('pass_day_clock', mod24(clk + (site.tz - site.lon/15)));
      }
    }
  });

  /* ---- repeat ground tracks: K revolutions in D days ---- */
  if(rt){
    const Q = (rt.mdot + rt.argpdot)/(P.WE_DEG_DAY - rt.nodedot);
    put('Q', Q); put('shift_deg', 360/Q); put('shift_km', 360/Q*111.32); put('rgt_days_max', 16);
    if(e < 0.05){
      let exact;                                           // the first (shortest) exact cycle, found once, when a key asks
      const find = () => {
        if(exact === undefined){
          exact = null;
          const cand = kernels.repeatCandidates(Q, rt.nodedot, 16);
          for(let k = 0; k < cand.length; k++) if(cand[k].exact){ exact = cand[k]; break; }
        }
        return exact;
      };
      lazy('K', () => { const x = find(); return x ? x.K : undefined; });
      lazy('D', () => { const x = find(); return x ? x.D : undefined; });
      lazy('rgt_days', () => { const x = find(); return x ? x.days : undefined; });
      lazy('rgt_off', () => { const x = find(); return x ? x.off : undefined; });
      lazy('rgt_gap', () => { const x = find(); return x ? x.gap : undefined; });
      let near;
      const findNear = () => { if(near === undefined) near = kernels.repeatNear(Q, e, inc, hMean); return near; };
      lazy('near_K', () => { const x = findNear(); return x ? x.K : undefined; });
      lazy('near_D', () => { const x = findNear(); return x ? x.D : undefined; });
      lazy('near_h', () => { const x = findNear(); return x ? x.h : undefined; });
      lazy('near_dh', () => { const x = findNear(); return x ? x.dh : undefined; });
    }
  }

  /* ---- drag, lifetime and the fixes that come from it ---- */
  if(am !== undefined && isNum(el.bstar)) put('bstar', el.bstar);
  run('amMax', () => {
    if(am === undefined) return;
    put('bstar_max', P.LIMITS.bstarMax);
    const m = P.amMax(a, e, inc);
    if(isFinite(m)) put('am_max', floorSig2(m));
  });
  /* A tracked spacecraft (the read-only host) has a history-fitted forecast in the Decay section, and
     life.tracked says the notes leave lifetime to it. An assumed-drag figure must not sit beside it
     (a Sentinel-2A at 786 km would be told its orbit is "above the air" by a model that has not read its
     history), so no life or fix key is worked out for it. */
  if(hasLifetime() && am !== undefined && !E.tracked){
    run('life', () => {
      const lf = kernels.life({a, e, i: inc, am}, {tracks: false});
      if(lf.model !== 'none'){ put('life_lo', lf.lo, true); put('life_mid', lf.mid, true); put('life_hi', lf.hi, true); }
    });
    if(e < 0.002 && am > 0){
      lazy('fix_h', () => up10(kernels.fixHeight(am, 2*365.25)));
      lazy('fix_life', () => { const h = c.fix_h; return h === undefined ? undefined : lifeDays(kernels.lifeCirc(RE + h, P.CD*am, 1, false).days); }, true);
      lazy('fix_h25', () => down10(kernels.fixHeight(am, 25*365.25)));
      lazy('fix_h5', () => down10(kernels.fixHeight(am, 5*365.25)));
    }
    /* fix_hp: the perigee a "raise perigee" button offers. A circular orbit is lifted to
       the two-year height; an eccentric one to 20 km under its apogee, at most 500 km, so
       the fix can never turn the orbit inside out and "leaves the apogee where it is" stays
       true. Absent where the key it needs does not exist. */
    lazy('fix_hp', () => e < 0.002 ? c.fix_h : (ha - 20 >= 150 ? Math.min(500, ha - 20) : undefined));
  } else {
    lazy('fix_hp', () => e < 0.002 ? undefined : (ha - 20 >= 150 ? Math.min(500, ha - 20) : undefined));
  }

  /* ---- the page's analysis window ---- */
  const win = (E.window !== null && typeof E.window === 'object') ? E.window : null;
  if(win && isNum(win.startMs)){
    run('window', () => {
      const off = (win.startMs - epoch)/DAY_MS;
      put('epoch_off', off); put('epoch_off_abs', Math.abs(off)); put('epoch_dir', off >= 0 ? 'after' : 'before');
      put('hours', win.hours); put('window_ms', win.startMs);
      const s = isoZ(win.startMs).slice(0, 16) + 'Z';
      put('start', s); put('window_start', s);
    });
  }
  /* ---- what the page's own trial run measured ---- */
  const ms = (E.measured !== null && typeof E.measured === 'object') ? E.measured : null;
  if(ms){
    run('measured', () => {
      if(isNum(ms.n)){ put('n', ms.n); put('passes', ms.n === 1 ? 'pass' : 'passes'); }
      if(isNum(ms.totalS)) put('total_min', ms.totalS/60);
      if(isNum(ms.longestS)) put('longest_min', ms.longestS/60);
      put('best_el', isNum(ms.bestEl) ? ms.bestEl : undefined);
      put('alt_min', isNum(ms.altMin) ? ms.altMin : undefined); put('alt_max', isNum(ms.altMax) ? ms.altMax : undefined);
      if(isNum(ms.altMin) && isNum(ms.altMax)) put('swing', ms.altMax - ms.altMin);
      put('surf_swing', isNum(ms.surfSwing) ? ms.surfSwing : undefined); put('r_swing', isNum(ms.rSwing) ? ms.rSwing : undefined);
    });
  }
  c.tracked = !!E.tracked;
  return c;
}

/* Which items fire for an element set, written out: the dictionary joined to the
   catalogue. env.host ('draft' or 'readonly') is the default for opts.host. */
function advise(el, env, opts){
  const AC = AdvisorCopy;
  if(!AC || typeof AC.advise !== 'function') throw new Error('Advisor: AdvisorCopy not loaded');
  const o = Object.assign({}, opts || {});
  if(o.host === undefined && env && env.host) o.host = env.host;
  const c = context(el, env);
  const r = AC.advise(c, o);
  r.c = c;
  return r;
}

const kernels = {
  sunEci, ssoInc, nodeRate, ltan, betaDeg, betaSeries, betaRange, eclipseFrac, betaCritDeg, eclipseNumeric, eclipseYear,
  accessAngleDeg, altForAccessDeg, coverage, passClock, repeatCandidates, repeatSolve, repeatNear,
  dragAvg, lifeCirc, lifeEcc, life, fixHeight, geoElevation, geoVisibleLongitudes, geoEclipse, hiDwell, frozenE
};

export const Advisor = {context, advise, life, kernels, sunEci};
