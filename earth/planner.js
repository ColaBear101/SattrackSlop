/* planner.js - the maths behind "design your own orbit": mean orbital elements in,
 * a Two-Line Element set out, plus everything the planner form needs to check what
 * was typed. Pure: no DOM, no storage, no network, no clock. Node can require() it.
 *
 * What a custom orbit IS here. The console already knows how to treat a catalogue
 * spacecraft: it reads a TLE, runs SGP4, and draws, lists passes, brings in Doppler
 * and so on from the result. So a planned orbit is not a second kind of object. The
 * elements typed into the form are turned into the same two 69-character lines a
 * catalogue entry has, and from there nothing downstream can tell the difference
 * (index.html proves it by feeding a real spacecraft's own lines down this path and
 * comparing 987,552 bytes of output). That makes the quality of this file a matter
 * of one question: when SGP4 reads the lines written here, does it recover exactly
 * the orbit the student typed? Every function that touches a number answers to that.
 *
 * The elements are SGP4 MEAN elements, not osculating ones. A TLE's inclination, node,
 * argument of perigee, eccentricity and mean anomaly are the averages SGP4 was fitted
 * with, and typing them back in reproduces the satellite SGP4 would draw. An osculating
 * semi-major axis read off a state vector differs from the mean one by up to about 9 km.
 *
 * The traps this file exists to step around (measured, not guessed; the numbers are in
 * verification/verify-planner.js, which compares everything here against satellite.js):
 *
 *   - A TLE carries the KOZAI mean motion; SGP4 turns it into the BROUWER semi-major
 *     axis (satrec.a, which the page prints as "a"). They are not (mu/n^2)^(1/3):
 *     that is 6.41 km off at i = 0 and 3.02 km at i = 97.8. Writing a TLE for a typed
 *     "a" therefore needs the inverse of SGP4's own un-Kozai step (kozaiFromBrouwer).
 *   - Which radius is which. 6378.135 km (WGS-72) un-normalises satrec.a; 6378.137 km
 *     (WGS-84) is the altitude datum the page and every student use. They are two metres
 *     apart and must never swap places, so the two constants are named for their job.
 *   - Rounding order. The TLE holds e to 1e-7 and i to 1e-4 degrees. If the inversion
 *     is run on the typed values and the line is then rounded, SGP4 reads back an a
 *     that is up to 9.5e-6 km off (7,010 of 20,000 random LEO sets): small, but it is
 *     the margin the round-trip check lives on. Round e and i FIRST, invert with the
 *     rounded values, then round n.
 *   - GMST. satellite.gstime builds a Julian date from the date's fields and that
 *     double carries a 4e-5 s rounding the page's globe inherits. A "more exact" JD
 *     differs from it by 7e-8 rad, so gmstDeg repeats satellite.js's own arithmetic.
 *   - The repeat-ground-track rate is gstime's rotation rate (360.98564736629 deg/day),
 *     not BODY.omega (7.292115e-5 rad/s = 360.985605 deg/day): 4.2e-5 deg/day, which is
 *     enough to move the 233/16 node return from 7.2e-5 to 7.5e-4 degrees.
 *   - Drag. The student types area over mass, not B*. B* is derived so SGP4's decay
 *     rate at the epoch equals the rate of the page's own atmosphere (Lifetime.rho),
 *     because the textbook constant (0.5*Cd*A/m*0.15696615) made the globe lose height
 *     2x to 13x faster than the Professor says it will.
 *
 * Formats of the three kinds of object that flow through the planner are in SPEC 2.1:
 * `el` (canonical elements), `form` (what the UI holds, possibly raw text), and the
 * error objects {field, code, msg, ...params} that validate/fromForm return.
 *
 * The one thing read from outside is globalThis.Lifetime.rho (the atmosphere), and only
 * by the four drag functions, lazily, at call time, so script order does not matter. It
 * is a programmer error for the page to show the planner without it, so those throw.
 */
(function(global){
'use strict';

const PI = Math.PI, D2R = PI/180, R2D = 180/PI;

const SCHEMA = 1;

/* The numbers every limit in the planner comes from. aMax is the Moon's distance and
   the largest a whose written mean motion (n to 8 places) still reproduces a to a few
   centimetres; amMax and bstarMax together cap drag at what SGP4's series can follow
   (B* = 0.5 at 500 km returned error 6 after 3,086 minutes). */
const LIMITS = Object.freeze({
  maxCustom: 12, nameMax: 24, storeMaxChars: 65536,
  epochMin: Date.UTC(2000, 0, 1), epochMax: Date.UTC(2056, 11, 31, 23, 59, 59),
  aMax: 400000, amMax: 10, bstarMax: 0.1, bstarFloorKm: 120,
  retroBlockKm: 100, retroNoteKm: 1, retroWarnKm: 10, nMaxRevDay: 100,
  deepPeriodMin: 225, deepTrialDays: 3, deepFarDays: 10
});

/* WGS-72, the constant set satellite.js 6.0.1 hard-codes. verify-planner.js (V0)
   compares every one of these with satellite.constants bit for bit: a satellite.js
   upgrade that changes one would otherwise change every number in this file silently. */
const C72 = Object.freeze({
  Re: 6378.135, mu: 398600.8, J2: 0.001082616, J3: -0.00000253881, J4: -0.00000165597,
  xke: 60/Math.sqrt(650942.9922085947),
  xpdotp: 1440/(2*PI)
});

const RE = 6378.137;                      // altitude datum (WGS-84 equatorial), footprints, eclipse radius
const CD = 2.2;                           // drag coefficient: shown, never typed
const MU_SI = 3.986004418e14;             // m^3/s^2: the page's MU, used ONLY inside the drag integral,
                                          // where it has to agree with Lifetime.integrate (which uses MU)
const SIDEREAL_DAY_S = 86164.0905, SIDEREAL_MIN = 1436.0682;
const WE_DEG_DAY = 360.98564736629;       // gstime's rotation rate, deg per mean solar day. NOT BODY.omega
const MEAN_SUN_RATE = 360/365.2421897;    // deg/day, 0.98564736: the node rate of a sun-synchronous orbit

/* a for a given Keplerian period, with SGP4's mu. DEEP_A_KM is the period of 225 minutes,
   where SGP4 hands over to its deep-space (SDP4) branch; GEO_A_KM the sidereal day. Both
   are computed, not typed in, so they cannot disagree with aFromPeriodMin. */
const aFromPeriodMin = min => Math.cbrt(C72.mu * Math.pow(min*60/(2*PI), 2));
const periodMin = aKm => 2*PI*Math.sqrt(aKm*aKm*aKm/C72.mu)/60;
const DEEP_A_KM = aFromPeriodMin(LIMITS.deepPeriodMin);
const GEO_A_KM = Math.cbrt(C72.mu * Math.pow(SIDEREAL_DAY_S/(2*PI), 2));
const isDeep = aKm => aKm >= DEEP_A_KM;

const FIELD_LABEL = Object.freeze({
  hp: 'Mean perigee altitude', ha: 'Mean apogee altitude', a: 'Semi-major axis', e: 'Eccentricity',
  period: 'Keplerian period', inc: 'Inclination', raan: 'Node (RAAN)', ltan: 'Node (LTAN)',
  argp: 'Argument of perigee', ma: 'Mean anomaly', epoch: 'Epoch', am: 'Area over mass', name: 'Name'
});

/* What the "what it is" select offers. Area over mass in m2/kg; Cd is fixed at 2.2. The
   default is a measured figure, worked back from the B* of the catalogue's own sets with
   elementsFromTLE: the median Cd*A/m of the near-circular ones (e < 0.02) with a perigee
   of 500 to 700 km is 0.0095, i.e. am = 0.0043. It is NOT one figure for every low orbit:
   the median over every low-orbit cut is 0.0091 and it rises with height (0.0078 at
   300-500 km, 0.0095 at 500-700, 0.0150 at 700-1000). An earlier sentence here claimed
   "1,311 satellites, median 0.0095, flat with height": none of the three held, and nothing
   checked it. verify-planner.js now pins the three medians the sentence quotes. */
const CRAFTS = Object.freeze([
  Object.freeze({key: 'typical', label: 'Typical satellite', am: 0.0043,
    why: 'Worked back from the B* of the tracked satellites in the page’s catalogue: Cd x A/m of 0.0095 m²/kg is the median for near-circular orbits with a perigee of 500 to 700 km. It rises with height: 0.0078 at 300 to 500 km, 0.015 at 700 to 1,000 km.'}),
  Object.freeze({key: 'small', label: 'Small satellite, 100 kg and 1 m²', am: 0.010,
    why: 'A compact microsatellite presenting a full square metre to the air.'}),
  Object.freeze({key: 'cubesat', label: '3U CubeSat, tumbling', am: 0.009,
    why: '4 kg and about 0.035 m² average cross-section.'}),
  Object.freeze({key: 'dense', label: 'Dense and compact', am: 0.002,
    why: 'A heavy, blunt craft.'}),
  Object.freeze({key: 'large', label: 'Large satellite or station', am: 0.0012,
    why: 'The ISS’s own B* (2026-09-12 set), worked back at its height. Its area over its mass would suggest 0.0038; the fitted figure is what its element set says.'}),
  Object.freeze({key: 'custom', label: 'Custom', am: null, why: ''})
]);
const PRESETS_KEYS = Object.freeze(['iss', 'sso', 'dd', 'landsat', 'thai', 'cube', 'knack', 'gps', 'geo', 'molniya', 'tundra']);

/* ---------- small helpers --------------------------------------------------------- */

const isNum = x => typeof x === 'number' && isFinite(x);
const wrap360 = x => ((x % 360) + 360) % 360;
const mod24 = h => ((h % 24) + 24) % 24;
const craftAm = key => { for(let k = 0; k < CRAFTS.length; k++) if(CRAFTS[k].key === key) return CRAFTS[k].am; return null; };

/* Read a property only if the object owns it. Everything that comes from a form, a
   store or a caller goes through this, so a `__proto__` key or an inherited property
   can never be mistaken for a field. */
function own(o, k){
  return (o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : undefined;
}
/* Text that came from outside and ends up inside an error object is cut short: a
   70,000-character paste must not travel through the planner into the DOM. */
function clip(x, n){
  let s;
  try { s = String(x); } catch(e){ s = ''; }
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ---------- time and geometry ----------------------------------------------------- */

/* Julian date exactly the way satellite.js computes it (its jday from a Date's UTC
   fields). Not the "obvious" ms/86400000 + 2440587.5: that is a different double and
   leaves gmstDeg 7e-8 rad away from satellite.gstime, which is what the globe turns by. */
function jdSat(ms){
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return 367*y - Math.floor(7*(y + Math.floor((m + 9)/12))*0.25) + Math.floor(275*m/9) + d.getUTCDate() +
    1721013.5 + ((d.getUTCMilliseconds()/6e4 + d.getUTCSeconds()/60 + d.getUTCMinutes())/60 + d.getUTCHours())/24;
}
/* IAU-82 Greenwich mean sidereal time in degrees [0,360), == satellite.gstime to 1e-9 rad. */
function gmstDeg(ms){
  const t = (jdSat(ms) - 2451545)/36525;
  const sec = -6.2e-6*t*t*t + 0.093104*t*t + (876600*3600 + 8640184.812866)*t + 67310.54841;
  return wrap360(sec/240);
}
/* Right ascension of the MEAN Sun. "Local time" below is mean local solar time:
   the equation of time (up to +-16 minutes) is not applied. */
function meanSunRaDeg(ms){
  const d = ms/86400000 + 2440587.5 - 2451545.0;
  return wrap360(280.46061837 + 0.98564736629*d);
}
const ltanFromRaan = (raanDeg, ms) => mod24(12 + (raanDeg - meanSunRaDeg(ms))/15);
const raanFromLtan = (h, ms) => wrap360(meanSunRaDeg(ms) + 15*(h - 12));

function apsides(aKm, e){
  const rp = aKm*(1 - e), ra = aKm*(1 + e);
  return {rp, ra, hp: rp - RE, ha: ra - RE};
}

/* ---------- SGP4 mean-element maths ---------------------------------------------- */

/* SGP4's initl step, verbatim: the Kozai mean motion no (rad/min) -> the Brouwer
   ("un-Kozai'd") one. */
function unkozai(noRadMin, e, incRad){
  const omeosq = 1 - e*e, rteosq = Math.sqrt(omeosq), cosio2 = Math.cos(incRad) * Math.cos(incRad);
  const ak = Math.pow(C72.xke/noRadMin, 2/3);
  const d1 = 0.75*C72.J2*(3*cosio2 - 1)/(rteosq*omeosq);
  let del = d1/(ak*ak);
  const adel = ak*(1 - del*del - del*(1/3 + 134*del*del/81));
  del = d1/(adel*adel);
  return {noUn: noRadMin/(1 + del), del};
}
/* Forward: the TLE's mean motion (rev/day, Kozai) -> Brouwer a in km on the WGS-72
   radius, i.e. exactly satrec.a * 6378.135. */
function brouwerFromKozai(nRevDay, e, iDeg){
  const no = nRevDay/C72.xpdotp, u = unkozai(no, e, iDeg*D2R);
  return Math.pow(C72.xke/u.noUn, 2/3)*C72.Re;
}
/* Inverse: the Kozai n (rev/day, UNROUNDED) that SGP4 will turn back into the typed
   Brouwer a. The step above is a fixed point in n and each pass gains about three
   digits, so 4 to 7 passes reach the limit of a double; 12 is a cap for absurd inputs, not a
   target. "Converged" is a step of 2.5e-16 relative, a pass or two of last-bit jitter: with the
   stricter 1e-16 a few of every hundred thousand valid orbits (a 27,350 km, e 0.59, i 82.1)
   bounce between two neighbouring doubles for ever and run to the cap, which is harmless to
   the value (it differs by under 3e-16 relative) but made the pass count 13 instead of 7. */
function kozaiFromBrouwer(aKm, e, iDeg){
  if(!isNum(aKm) || !(aKm > 0) || !isNum(e) || !isNum(iDeg)) return {nRevDay: NaN, iters: 0};
  const noUn = C72.xke/Math.pow(aKm/C72.Re, 1.5);
  let no = noUn, it = 0;
  for(; it < 12; it++){
    const u = unkozai(no, e, iDeg*D2R), nxt = noUn*(1 + u.del);
    const done = Math.abs(nxt - no) <= 2.5e-16*no;
    no = nxt;
    if(done) break;
  }
  return {nRevDay: no*C72.xpdotp, iters: it + 1};
}

/* SGP4's own secular rates (the near-earth branch of sgp4init), NOT the textbook
   first-order J2 formula: that one puts the sun-synchronous inclination 0.024 to
   0.028 degrees low. rad/min -> deg/day below. For a Kepler period of 225 minutes or
   more SGP4 also adds Moon and Sun terms; they live in the satrec, so they are added
   when one is passed and otherwise the result is flagged `deep` and is good to about 5 %. */
const PERDAY = 1440*R2D;
function rates(aKm, e, iDeg, satrec){
  const ao = aKm/C72.Re, inc = iDeg*D2R;
  const noUn = C72.xke/Math.pow(ao, 1.5);
  const cosio = Math.cos(inc), cosio2 = cosio*cosio, cosio4 = cosio2*cosio2;
  const omeosq = 1 - e*e, rteosq = Math.sqrt(omeosq);
  const con41 = 3*cosio2 - 1, con42 = 1 - 5*cosio2;
  const posq = (ao*omeosq)*(ao*omeosq), pinvsq = 1/posq;
  const temp1 = 1.5*C72.J2*pinvsq*noUn;
  const temp2 = 0.5*temp1*C72.J2*pinvsq;
  const temp3 = -0.46875*C72.J4*pinvsq*pinvsq*noUn;
  let mdot = (noUn + 0.5*temp1*rteosq*con41 + 0.0625*temp2*rteosq*(13 - 78*cosio2 + 137*cosio4))*PERDAY;
  let argpdot = (-0.5*temp1*con42 + 0.0625*temp2*(7 - 114*cosio2 + 395*cosio4) + temp3*(3 - 36*cosio2 + 49*cosio4))*PERDAY;
  let nodedot = (-temp1*cosio + (0.5*temp2*(4 - 19*cosio2) + 2*temp3*(3 - 7*cosio2))*cosio)*PERDAY;
  const deep = isDeep(aKm);
  let source = 'sgp4init';
  if(deep && satrec && typeof satrec === 'object' && isNum(satrec.dnodt)){
    mdot += (isNum(satrec.dmdt) ? satrec.dmdt : 0)*PERDAY;
    argpdot += (isNum(satrec.domdt) ? satrec.domdt : 0)*PERDAY;
    nodedot += satrec.dnodt*PERDAY;
    source = 'satrec';
  }
  return {mdot, argpdot, nodedot, nodalPeriodS: 360/(mdot + argpdot)*86400, deep, source};
}

/* The inclination that makes the node precess with the Sun, found with SGP4's own rate
   (bisection on (90,180]; the rate rises monotonically towards 180). null when even 180
   is too slow, i.e. the orbit is too high. Above DEEP_A_KM the Moon and Sun terms matter,
   and they come from a satrec: with env.sat a TLE is written at each trial inclination
   and read back, which costs 80 twoline2satrec calls and only ever happens for the sliver
   of sun-synchronous orbits between 12,254 and 12,360 km. env = {sat, epoch?}: the epoch (ms)
   the lunisolar terms are taken at, a fixed 2026-10-01T12Z when absent (this file has no clock). */
function ssoInclination(aKm, e, env){
  if(!isNum(aKm) || !(aKm > 0) || !isNum(e) || !(e >= 0 && e < 1)) return null;
  const epoch = (env && isNum(env.epoch)) ? env.epoch : Date.UTC(2026, 9, 1, 12);
  const useSat = !!(env && env.sat && typeof env.sat.twoline2satrec === 'function' && isDeep(aKm));
  const node = i => {
    if(useSat){
      try {
        const t = toTLE({a: aKm, e, i, raan: 0, argp: 0, M: 0, epoch, am: null, bstar: 0}, '99901');
        return rates(aKm, e, i, env.sat.twoline2satrec(t.l1, t.l2)).nodedot;
      } catch(err){ /* fall through to the closed form */ }
    }
    return rates(aKm, e, i).nodedot;
  };
  let lo = 90, hi = 180;
  if(!(node(hi) >= MEAN_SUN_RATE)) return null;
  for(let k = 0; k < 80; k++){ const mid = (lo + hi)/2; if(node(mid) < MEAN_SUN_RATE) lo = mid; else hi = mid; }
  return (lo + hi)/2;
}
/* The largest a (km, a radius) at which a sun-synchronous inclination exists: where the
   node rate at i = 180 degrees has fallen to the Sun's. About 12,359.8 km at e = 0, an
   altitude of 5,981.7 km. */
function ssoAmaxKm(e){
  if(!isNum(e) || !(e >= 0 && e < 1)) return null;
  let lo = 6478, hi = 100000;
  if(rates(lo, e, 180).nodedot < MEAN_SUN_RATE) return null;
  for(let k = 0; k < 100; k++){ const mid = (lo + hi)/2; if(rates(mid, e, 180).nodedot >= MEAN_SUN_RATE) lo = mid; else hi = mid; }
  return (lo + hi)/2;
}

/* Revolutions per NODAL day: how many times the satellite goes round while the ground
   below turns once relative to its (precessing) orbit plane. A ground track repeats when
   this is a ratio of small integers. */
function revsPerNodalDay(aKm, e, iDeg){
  const r = rates(aKm, e, iDeg);
  return (r.mdot + r.argpdot)/(WE_DEG_DAY - r.nodedot);
}
/* The a that makes Q exactly the target (Q falls as a rises); null when not bracketed. */
function aForRevsPerDay(Q, e, iDeg){
  let lo = 6478, hi = 60000;
  if(!(revsPerNodalDay(lo, e, iDeg) >= Q) || !(revsPerNodalDay(hi, e, iDeg) <= Q)) return null;
  for(let k = 0; k < 100; k++){ const mid = (lo + hi)/2; if(revsPerNodalDay(mid, e, iDeg) > Q) lo = mid; else hi = mid; }
  return (lo + hi)/2;
}

/* How far SGP4 is wrong near i = 180 degrees when e > 0. SGP4's short-period correction
   to the mean longitude contains xlcof = -0.25*(J3/J2)*sin(i)*(3+5cos i)/(1+cos i), which
   blows up as 1+cos i -> 0. This is that term, turned into an along-track distance
   (Re72 * e/(1-e^2) * |xlcof|), from the e and i the TLE will actually hold. It does NOT
   depend on a, which is why the first draft's formula (proportional to a*e/delta,
   fitted at a = 7000 only) was 13 % low there and 5x high at GEO. Measured against the
   y-mirror of the prograde twin over 24 h: 863.8 to 865.0 km for a = 6700 to 11500 km
   (e = 0.01, i = 179.99) against 857.1 km from this formula. The amplitude is the upper
   envelope (at argp = 90 the first day shows 4 to 29 % of it). It is capped at 2a. */
const J3_OVER_J2 = Math.abs(C72.J3/C72.J2);
function retroErrorKm(aKm, e, iDeg){
  if(!isNum(aKm) || !isNum(e) || !isNum(iDeg)) return 0;
  const e1 = Math.round(e*1e7)/1e7, i1 = Math.round(iDeg*1e4)/1e4;
  if(e1 <= 0 || e1 >= 1 || i1 >= 180 || i1 < 150) return 0;
  const r = i1*D2R, ci = Math.cos(r), si = Math.sin(r);
  if(Math.abs(1 + ci) < 1.5e-12) return 0;
  const xl = 0.25*J3_OVER_J2*si*Math.abs(3 + 5*ci)/(1 + ci);
  return Math.min(2*aKm, C72.Re*e1/(1 - e1*e1)*xl);
}

/* ---------- drag: area over mass -> B* ------------------------------------------- */

function atmosphere(){
  const L = global.Lifetime;
  if(!L || typeof L.rho !== 'function') throw new Error('Planner: atmosphere (Lifetime.rho) not loaded');
  return L;
}
/* The page's piecewise-exponential density, zero above 1,000 km where its table ends
   (Lifetime.rho itself holds the 1,000 km value flat, which would drag an orbit that
   has left the air forever). */
const rhoAt = (L, h) => h > 1000 ? 0 : L.rho(h < 0 ? 0 : h);

/* Orbit-averaged da/dt (km/day) and de/dt (1/day) for drag accel = 1/2 rho Cd*A/m v^2,
   rho x mult. Midpoint rule in eccentric anomaly over half an orbit, doubled (the
   integrand is symmetric in E), and only up to the point where the orbit leaves the
   1,000 km atmosphere: integrating a whole eccentric orbit through the model's step at
   1,000 km was off by up to 96 %. With the apogee below 1,000 km the 48 nodes are exactly
   the 96 of a whole-orbit rule (differences 1.9e-15). B is Cd*A/m in m2/kg. */
function dragAvg(aKm, e, B, mult){
  const L = atmosphere();
  const m = mult === undefined || mult === null ? 1 : mult;
  const N = 48, aM = aKm*1000;
  let Ec = PI;
  if(e > 0 && aKm*(1 + e) > RE + 1000){
    if(aKm*(1 - e) >= RE + 1000) return {dadt_kmday: 0, dedt_day: 0};
    Ec = Math.acos(Math.max(-1, Math.min(1, (aKm - RE - 1000)/(aKm*e))));
  }
  let da = 0, de = 0;
  for(let k = 0; k < N; k++){
    const E = Ec*(k + 0.5)/N, cE = Math.cos(E), r = aM*(1 - e*cE), h = r/1000 - RE;
    const v2 = MU_SI*(2/r - 1/aM), v = Math.sqrt(v2), cn = (cE - e)/(1 - e*cE);
    const f = 0.5*rhoAt(L, h)*m*B*v2;                                   // m/s^2
    const w = (1 - e*cE)*(Ec/N)/(2*PI);
    da += -2*aM*aM*v*f/MU_SI*w;
    de += -2*f*(e + cn)/v*w;
  }
  return {dadt_kmday: 2*da/1000*86400 + 0, dedt_day: 2*de*86400 + 0};
}

/* SGP4's drag coefficient cc2, replicated from the near-earth block of sgp4init. SGP4
   scales B* by a height-dependent factor, so the same B* means different decay rates
   at different heights: B* per unit of Cd*A/m is 0.0506 per m2/kg at 360 km, 0.0225 at 500, 0.0055
   at 700. The parameter s switches at a perigee of 156 km (and again at 98), which makes
   B* NOT monotone in perigee between about 135 and 300 km. */
function sgp4Cc2(aKm, e, iDeg){
  const ao = aKm/C72.Re, inc = iDeg*D2R, noUn = C72.xke/Math.pow(ao, 1.5);
  const cosio = Math.cos(inc), con41 = 3*cosio*cosio - 1;
  const rp = ao*(1 - e), perige = (rp - 1)*C72.Re;
  let s = 78/C72.Re + 1, qzms24 = Math.pow((120 - 78)/C72.Re, 4);
  if(perige < 156){
    let s4 = perige - 78;
    if(perige < 98) s4 = 20;
    qzms24 = Math.pow((120 - s4)/C72.Re, 4);
    s = s4/C72.Re + 1;
  }
  const tsi = 1/(ao - s), eta = ao*e*tsi, etasq = eta*eta, eeta = e*eta, psisq = Math.abs(1 - etasq);
  const coef = qzms24*Math.pow(tsi, 4), coef1 = coef/Math.pow(psisq, 3.5);
  const cc2 = coef1*noUn*(ao*(1 + 1.5*etasq + eeta*(4 + etasq)) +
    0.375*C72.J2*tsi/psisq*con41*(8 + 3*etasq*(8 + etasq)));
  return {cc2, ao};
}

/* The B* that makes SGP4's initial decay rate equal the physical rate of the page's
   own atmosphere (D7). SGP4's rate is -2*a*cc1 with cc1 = B* x cc2, so B* = -adot/(2 ao cc2).
   Below a perigee of 120 km the match is made as if the perigee were 120 km (apogee kept)
   and held there: SGP4's coefficient is built from a height parameter that makes an
   unclamped match meaningless under about 100 km (circular, i = 51.6, am 0.0043: B* 70.6
   at 0 km, 0.23 at 50 km, 2e-19 at 20 km). Such an orbit is a re-entry anyway and the
   Professor says so. 0 when there is no drag (am = 0) or the whole orbit is above 1,000 km.
   The TLE is still written from the typed a and e; only the match uses the lifted orbit. */
function bstarFromAm(am, aKm, e, iDeg){
  atmosphere();
  if(am === 0) return 0;
  const rpe = Math.max(aKm*(1 - e), RE + LIMITS.bstarFloorKm);
  const rae = Math.max(aKm*(1 + e), rpe);
  if(rpe >= RE + 1000) return 0;
  const a2 = (rpe + rae)/2, e2 = (rae - rpe)/(rae + rpe);
  const adotErMin = dragAvg(a2, e2, CD*am, 1).dadt_kmday/C72.Re/1440;
  const c = sgp4Cc2(a2, e2, iDeg);
  return -adotErMin/(2*c.ao*c.cc2) + 0;
}
/* Linear in am, so the inverse needs one evaluation. null when B* carries no drag
   information (every orbit entirely above 1,000 km has a unit B* of 0). */
function amFromBstar(bstar, aKm, e, iDeg){
  atmosphere();
  if(!isNum(bstar)) return null;
  const u = bstarFromAm(1, aKm, e, iDeg);
  return (u > 0 && isFinite(u)) ? Math.max(0, bstar/u) : null;
}
/* The largest am whose B* stays within what SGP4's drag series can follow. Not monotone
   in height (see sgp4Cc2); its smallest value is 0.61 m2/kg, at 120 km. */
function amMax(aKm, e, iDeg){
  atmosphere();
  const u = bstarFromAm(1, aKm, e, iDeg);
  return LIMITS.bstarMax/u;
}
/* floor to two significant digits, never below 0.001: the number a student is told to
   type must itself pass the check it failed. */
function floorSig2(x){
  if(!(x > 0) || !isFinite(x)) return x;
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.max(0.001, Number((Math.floor(x/p + 1e-9)*p).toPrecision(2)));   // toPrecision: 41*0.1 is 4.1000000000000005
}

/* ---------- parsing: never throws ------------------------------------------------- */

const RE_NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const RE_THOUSANDS = /^[+-]?[1-9]\d{0,2},\d{3}$/;
function parseNumber(text){
  try {
    if(typeof text === 'number') return isFinite(text) ? {ok: true, value: text} : {ok: false, code: 'err.notnum'};
    if(text === undefined || text === null) return {ok: false, code: 'err.missing'};
    if(typeof text !== 'string') return {ok: false, code: 'err.notnum'};      // an array would read as "1,2" -> 1.2
    let s = text.trim();
    if(s === '') return {ok: false, code: 'err.missing'};
    if(s.length > 100) return {ok: false, code: 'err.notnum'};
    /* One comma is a decimal separator when there is no point. But "35,786" and "6,878" read
       as thousands in half the world and as decimals in the other half, and silently taking
       35.786 for 35,786 km is worse than asking: they are refused, with the usual hint to
       use a point. "0,125", "97,4" and "1234,567" are not thousands groups and still read. */
    if(RE_THOUSANDS.test(s)) return {ok: false, code: 'err.notnum'};
    if(s.indexOf('.') < 0 && s.split(',').length === 2) s = s.replace(',', '.');
    if(!RE_NUM.test(s)) return {ok: false, code: 'err.notnum'};
    const v = Number(s);
    return isFinite(v) ? {ok: true, value: v} : {ok: false, code: 'err.notnum'};
  } catch(e){
    return {ok: false, code: 'err.notnum'};
  }
}
function parseLtan(text){
  try {
    if(typeof text === 'number'){
      if(!isFinite(text) || text < 0 || text > 24) return {ok: false, code: 'err.ltan.range'};
      return {ok: true, value: text === 24 ? 0 : text};
    }
    if(text === undefined || text === null) return {ok: false, code: 'err.missing'};
    if(typeof text !== 'string') return {ok: false, code: 'err.ltan.range'};
    const s = text.trim();
    if(s === '') return {ok: false, code: 'err.missing'};
    if(s.length > 100) return {ok: false, code: 'err.ltan.range'};
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if(m){
      const hh = +m[1], mm = +m[2];
      if(hh > 24 || mm > 59 || (hh === 24 && mm > 0)) return {ok: false, code: 'err.ltan.range'};
      return {ok: true, value: hh === 24 ? 0 : hh + mm/60};
    }
    const r = parseNumber(s);
    if(!r.ok || r.value < 0 || r.value > 24) return {ok: false, code: 'err.ltan.range'};
    return {ok: true, value: r.value === 24 ? 0 : r.value};
  } catch(e){
    return {ok: false, code: 'err.ltan.range'};
  }
}
const RE_EPOCH = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
/* 'YYYY-MM-DDTHH:MM[:SS]' as UTC. Date.UTC quietly normalises what it is given (Feb 30
   becomes March 2, hour 24 the next day, second 60 the next minute), so the result is
   rendered back and must match the text; never `new Date(string)` and never the browser's
   zone, so the same text is the same instant in Bangkok and in New York. */
function parseEpoch(text){
  try {
    const inRange = ms => ms >= LIMITS.epochMin && ms <= LIMITS.epochMax;
    if(typeof text === 'number'){
      const ms = Math.round(text);
      return (isFinite(text) && inRange(ms)) ? {ok: true, value: ms} : {ok: false, code: 'err.epoch.range'};
    }
    if(text === undefined || text === null) return {ok: false, code: 'err.missing'};
    if(typeof text !== 'string') return {ok: false, code: 'err.epoch.range'};
    const s = text.trim();
    if(s === '') return {ok: false, code: 'err.missing'};
    if(s.length > 40) return {ok: false, code: 'err.epoch.range'};
    const m = RE_EPOCH.exec(s);
    if(!m) return {ok: false, code: 'err.epoch.range'};
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] === undefined ? 0 : +m[6]);
    const typed = m[6] === undefined ? s.slice(0, 16) : s.slice(0, 19);
    if(!isFinite(ms) || new Date(ms).toISOString().slice(0, typed.length) !== typed) return {ok: false, code: 'err.epoch.range'};
    return inRange(ms) ? {ok: true, value: ms} : {ok: false, code: 'err.epoch.range'};
  } catch(e){
    return {ok: false, code: 'err.epoch.range'};
  }
}
function formatEpoch(ms){
  if(!isNum(ms) || Math.abs(ms) > 8.64e15) return '';
  return new Date(ms).toISOString().slice(0, 19);
}
/* 'YYYY-MM-DD HH:MM:SSZ', the way the Professor's {epoch_utc} placeholder prints it. */
function epochUtcText(ms){
  if(!isNum(ms) || Math.abs(ms) > 8.64e15) return clip(ms, 30);
  return new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z').replace('T', ' ');
}

/* ---------- errors ---------------------------------------------------------------- */

const MSG = {
  'err.ecc.neg': 'Eccentricity cannot be negative.',
  'err.ecc.parabola': 'Eccentricity 1 is a parabola: a closed orbit needs e below 1.',
  'err.ecc.hyper': 'Eccentricity above 1 is a hyperbola: a closed orbit needs e below 1.',
  'err.inc.range': 'Inclination runs from 0 to 180 degrees.',
  'err.apo.lt.peri': 'Apogee is below perigee.',
  'err.perigee.surface': 'Perigee is inside the Earth.',
  'err.a.range': 'The orbit is larger than the Moon’s distance.',
  'err.epoch.range': 'Epoch must be between 2000 and 2056 (UTC).',
  'err.am.range': 'Area over mass runs from 0 to 10 m2/kg.',
  'err.bstar.range': 'Too much drag for SGP4 at this height.',
  'sgp4.retro': 'SGP4 is not reliable this close to 180 degrees with e above 0.',
  'err.ltan.range': 'Local time must be hh:mm or hours from 0 to 24.'
};
/* {field, code, msg, ...params}. `field` is always the key of the field the message
   belongs under; a parameter can never overwrite it (err.missing's label is `label`). */
function mkErr(field, code, msg, params){
  const o = {field, code, msg};
  if(params) for(const k of Object.keys(params)) if(k !== 'field' && k !== 'code' && k !== 'msg') o[k] = params[k];
  return o;
}
function epochTextOf(raw){
  const m = typeof raw === 'string' ? RE_EPOCH.exec(raw.trim()) : null;
  if(!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] === undefined ? 0 : +m[6]);
  return isFinite(ms) ? epochUtcText(ms) : null;
}
/* The error object for text that did not parse. `field` is the FORM KEY (the field the message sits
   under, and what the DOM-order sort reads); the human name of that field is `label`. The copy's
   err.missing / err.notnum templates say {field:txt}, and what they mean by it is this `label`, so
   whoever renders them passes the label in under that placeholder name. */
function parseErr(formKey, code, raw){
  const label = FIELD_LABEL[formKey] || formKey, r = clip(raw === undefined || raw === null ? '' : raw, 40);
  if(code === 'err.missing') return mkErr(formKey, code, label + ' is empty.', {label, raw: r});
  if(code === 'err.notnum') return mkErr(formKey, code, '"' + r + '" is not a number.', {label, raw: r});
  if(code === 'err.ltan.range') return mkErr(formKey, code, MSG[code], {label, raw: r});
  return mkErr(formKey, code, MSG[code] || 'Invalid value.', {label, raw: r, epoch_utc: epochTextOf(raw) || r});
}

/* ---------- validation ------------------------------------------------------------ */

const EL_KEYS = ['a', 'e', 'i', 'raan', 'argp', 'M', 'epoch'];
/* validate(raw): raw is el-like {a,e,i,raan,argp,M,epoch, am | bstar}. Returns
   {ok, errors, warnings, el}; `el` is a NEW object of exactly the nine named keys, so a
   `__proto__` key or an extra property in the input goes nowhere. Errors are keyed by el
   key; fromForm maps them to form keys. Every check runs; none stops the others, except
   that a check whose input did not parse is skipped. */
function validate(raw){
  const errors = [], warnings = [];
  const v = {};
  const bad = {};
  for(const k of EL_KEYS){
    const x = own(raw, k);
    if(x === undefined || x === null){ errors.push(mkErr(k, 'err.missing', k + ' is missing.', {raw: ''})); bad[k] = true; }
    else if(!isNum(x)){ errors.push(mkErr(k, 'err.notnum', k + ' is not a number.', {raw: clip(x, 40)})); bad[k] = true; }
    else v[k] = x;
  }
  let am = own(raw, 'am'), bstarIn = own(raw, 'bstar'), amBad = false, explicitB = false;
  if(am === undefined || am === null){
    if(isNum(bstarIn)) explicitB = true;
    else { errors.push(mkErr('am', 'err.missing', 'am is missing.', {raw: ''})); amBad = true; }
    am = null;
  } else if(!isNum(am)){ errors.push(mkErr('am', 'err.notnum', 'am is not a number.', {raw: clip(am, 40)})); amBad = true; }

  /* angles are wrapped, and the student is told so */
  for(const k of ['raan', 'argp', 'M']){
    if(bad[k]) continue;
    const w = wrap360(v[k]);
    if(w !== v[k]) warnings.push(mkErr(k, 'err.angle.wrap', v[k] + ' degrees is taken as ' + w.toFixed(2) + '.', {raw: v[k], wrapped: w}));
    v[k] = w;
  }
  if(!bad.epoch) v.epoch = Math.round(v.epoch);

  const eOk = !bad.e && v.e >= 0 && v.e < 1, aOk = !bad.a, iOk = !bad.i;
  // 1-3 eccentricity
  if(!bad.e){
    if(v.e < 0) errors.push(mkErr('e', 'err.ecc.neg', MSG['err.ecc.neg'], {e: v.e}));
    else if(v.e === 1) errors.push(mkErr('e', 'err.ecc.parabola', MSG['err.ecc.parabola'], {e: v.e}));
    else if(v.e > 1) errors.push(mkErr('e', 'err.ecc.hyper', MSG['err.ecc.hyper'], {e: v.e}));
  }
  // 4 inclination
  if(iOk && (v.i < 0 || v.i > 180)) errors.push(mkErr('i', 'err.inc.range', MSG['err.inc.range'], {inc: v.i}));
  // 6 perigee below the surface, 7 beyond the Moon
  let geometryOk = false;
  if(aOk){
    if(v.a <= 0 || (eOk && v.a*(1 - v.e) < RE)){
      errors.push(mkErr('a', 'err.perigee.surface', MSG['err.perigee.surface'], {rp: eOk ? v.a*(1 - v.e) : v.a, fix_hp: 200}));
    } else geometryOk = eOk;
    if(v.a > LIMITS.aMax) { errors.push(mkErr('a', 'err.a.range', MSG['err.a.range'], {a: v.a, a_max: LIMITS.aMax})); geometryOk = false; }
  }
  // 8 epoch
  if(!bad.epoch && (v.epoch < LIMITS.epochMin || v.epoch > LIMITS.epochMax))
    errors.push(mkErr('epoch', 'err.epoch.range', MSG['err.epoch.range'], {epoch_utc: epochUtcText(v.epoch)}));
  // 9 area over mass
  let amOk = false;
  if(!amBad && am !== null){
    if(am < 0 || am > LIMITS.amMax) errors.push(mkErr('am', 'err.am.range', MSG['err.am.range'], {am}));
    else amOk = true;
  }
  /* B*: derived from am (the match of D7) unless supplied explicitly. Check 10 below needs
     checks 1-7 and 9 to have passed, so the derivation waits for a sound orbit and inclination. */
  const sound = geometryOk && iOk && v.i >= 0 && v.i <= 180;
  let bstar = null;
  if(explicitB) bstar = bstarIn;
  else if(amOk && sound) bstar = bstarFromAm(am, v.a, v.e, v.i);
  // 10 too much drag, only above 120 km (below it B* is held at its 120 km value)
  if(bstar !== null && sound){
    const hp = v.a*(1 - v.e) - RE;
    if(!isFinite(bstar) || (Math.abs(bstar) > LIMITS.bstarMax && hp >= LIMITS.bstarFloorKm)){
      errors.push(mkErr(explicitB ? 'bstar' : 'am', 'err.bstar.range', MSG['err.bstar.range'],
        {am: explicitB ? amFromBstar(bstar, v.a, v.e, v.i) : am, h_mean: v.a - RE, bstar, bstar_max: LIMITS.bstarMax,
         am_max: floorSig2(amMax(v.a, v.e, v.i))}));
    }
  }
  // 11 SGP4 near i = 180
  if(aOk && iOk && !bad.e && eOk){
    const re = retroErrorKm(v.a, v.e, v.i);
    /* retro_lead is the one word the sentence needs beyond the numbers: the distance is "about"
       857 km for a near-Earth orbit, where it was measured against SGP4 itself, and "on the order
       of" it for a deep-space one, where the Sun and the Moon spoil the measurement (3.6). */
    if(re > LIMITS.retroBlockKm)
      errors.push(mkErr('i', 'sgp4.retro', MSG['sgp4.retro'],
        {off180: 180 - v.i, retro_err: re, e: v.e, inc: v.i, retro_lead: isDeep(v.a) ? 'on the order of' : 'about'}));
  }

  if(errors.length) return {ok: false, errors, warnings, el: null};
  return {ok: true, errors, warnings, el: {a: v.a, e: v.e, i: v.i, raan: v.raan, argp: v.argp, M: v.M,
    epoch: v.epoch, am, bstar}};
}

/* el -> what is stored: the inputs only. B* is derived from am on every read, so it is
   kept only when it was supplied explicitly. */
function storable(el){
  const o = {a: el.a, e: el.e, i: el.i, raan: el.raan, argp: el.argp, M: el.M, epoch: el.epoch, am: el.am};
  if(el.am === null || el.am === undefined) o.bstar = el.bstar;
  return o;
}

/* ---------- forms ----------------------------------------------------------------- */

const SHAPES = {alt: 1, ae: 1, per: 1}, NODEMODES = {raan: 1, ltan: 1};
const FORM_KEYS = ['shape', 'nodeMode', 'name', 'hp', 'ha', 'a', 'e', 'period', 'inc', 'raan', 'ltan', 'argp', 'ma', 'epoch', 'am'];
const shapeOf = f => { const s = own(f, 'shape'); return (typeof s === 'string' && SHAPES[s] === 1) ? s : 'alt'; };
const nodeModeOf = f => { const s = own(f, 'nodeMode'); return (typeof s === 'string' && NODEMODES[s] === 1) ? s : 'raan'; };

/* The order the fields sit in the DOM, so the first error is the first thing the student
   sees: hp|a|period, ha|e, inc, raan|ltan, argp, ma, epoch, am. */
const DOM_RANK = {hp: 0, a: 0, period: 0, ha: 1, e: 1, inc: 2, raan: 3, ltan: 3, argp: 4, ma: 5, epoch: 6, am: 7};
function sortByDom(list){
  return list.map((x, i) => ({x, i, r: DOM_RANK[x.field] === undefined ? 8 : DOM_RANK[x.field]}))
    .sort((p, q) => p.r - q.r || p.i - q.i).map(p => p.x);
}

/* (a, e) -> every lens, at full precision. patchForm and toForm never round: the UI keeps
   its model in numbers and rounds for display only, which is what lets Altitudes
   700/700 -> a 7078.137 -> period 98.77 -> back close to 1e-6 km. */
function lensFields(a, e){
  const ap = apsides(a, e);
  return {hp: ap.hp, ha: ap.ha, a, e, period: periodMin(a)};
}
function craftForAm(am){
  for(let k = 0; k < CRAFTS.length; k++) if(CRAFTS[k].am !== null && Math.abs(CRAFTS[k].am - am) <= 1e-6) return CRAFTS[k].key;
  return 'custom';
}

function fromForm(form){
  const f = (form !== null && typeof form === 'object') ? form : {};
  const shape = shapeOf(f), nodeMode = nodeModeOf(f);
  const errors = [];
  const P = {};
  const need = key => {
    const r = parseNumber(own(f, key));
    if(r.ok) P[key] = r.value; else errors.push(parseErr(key, r.code, own(f, key)));
  };
  if(shape === 'alt'){ need('hp'); need('ha'); }
  else if(shape === 'ae'){ need('a'); need('e'); }
  else { need('period'); need('e'); }
  need('inc');
  need('argp'); need('ma'); need('am');
  const ep = parseEpoch(own(f, 'epoch'));
  if(ep.ok) P.epoch = ep.value; else errors.push(parseErr('epoch', ep.code, own(f, 'epoch')));
  let ltanTyped = null;
  if(nodeMode === 'raan') need('raan');
  else {
    const lt = parseLtan(own(f, 'ltan'));
    if(lt.ok){ P.ltan = lt.value; ltanTyped = lt.value; } else errors.push(parseErr('ltan', lt.code, own(f, 'ltan')));
  }
  if(errors.length) return {ok: false, errors: sortByDom(errors), notes: [], el: null, derived: null};

  /* size and shape: the two numbers every lens is a view of */
  let a, e, inverted = false;
  if(shape === 'alt'){
    let rp = RE + P.hp, ra = RE + P.ha;
    if(P.ha < P.hp){
      errors.push(mkErr('ha', 'err.apo.lt.peri', MSG['err.apo.lt.peri'], {ha: P.ha, hp: P.hp}));
      inverted = true;
      const t = rp; rp = ra; ra = t;
    }
    a = (rp + ra)/2;
    e = (rp + ra) > 0 ? (ra - rp)/(ra + rp) : 0;
  } else if(shape === 'ae'){
    a = P.a; e = P.e;
  } else {
    a = P.period > 0 ? aFromPeriodMin(P.period) : 0;
    e = P.e;
  }
  let sizeInf = false;
  if(!isFinite(a)){ sizeInf = true; a = LIMITS.aMax*1000; e = 0; errors.push(mkErr('a', 'err.a.range', MSG['err.a.range'], {a: Infinity, a_max: LIMITS.aMax})); }
  if(!isFinite(e)) e = 0;
  const raan = nodeMode === 'ltan' ? raanFromLtan(ltanTyped, P.epoch) : P.raan;

  const v = validate({a, e, i: P.inc, raan, argp: P.argp, M: P.ma, epoch: P.epoch, am: P.am});
  /* the validator's field names (el keys) -> the form's, by lens. In the Altitudes lens
     e is not a field the student can touch, so a complaint about it belongs on hp. */
  const mapKey = (k, code) => {
    switch(k){
      case 'i': return 'inc';
      case 'M': return 'ma';
      case 'e': return shape === 'alt' ? 'hp' : 'e';
      case 'a':
        if(code === 'err.a.range') return shape === 'alt' ? 'ha' : shape === 'per' ? 'period' : 'a';
        return shape === 'alt' ? 'hp' : shape === 'per' ? 'period' : 'a';
      default: return k;
    }
  };
  const SIZE_CODES = {'err.ecc.neg': 1, 'err.ecc.parabola': 1, 'err.ecc.hyper': 1, 'err.perigee.surface': 1,
    'err.a.range': 1, 'err.bstar.range': 1, 'sgp4.retro': 1};
  const mapped = [];
  for(const x of v.errors){
    if(inverted && SIZE_CODES[x.code] === 1) continue;                       // a and e are not meaningful
    if(sizeInf && x.code === 'err.a.range') continue;                        // reported once, above
    if(shape === 'alt' && (x.code === 'err.ecc.neg' || x.code === 'err.ecc.parabola' || x.code === 'err.ecc.hyper')
       && v.errors.some(y => y.code === 'err.perigee.surface')) continue;    // the perigee is the cause
    const o = Object.assign({}, x);
    o.field = mapKey(x.field, x.code);
    mapped.push(o);
  }
  const notes = v.warnings.map(w => { const o = Object.assign({}, w); o.field = mapKey(w.field, w.code); return o; });
  const all = errors.concat(mapped);

  /* the read-outs stay alive whenever a and e make sense */
  let derived = null;
  if(!inverted && !sizeInf && a > 0 && e >= 0 && e < 1){
    const ap = apsides(a, e), per = periodMin(a);
    const iOk = P.inc >= 0 && P.inc <= 180;
    const i1 = Math.round(P.inc*1e4)/1e4, e1 = Math.round(e*1e7)/1e7;
    let bstar = null;
    if(v.ok) bstar = v.el.bstar;
    else if(iOk && P.am >= 0 && P.am <= LIMITS.amMax && ap.rp >= RE && a <= LIMITS.aMax){
      const b = bstarFromAm(P.am, a, e, P.inc);
      bstar = isFinite(b) ? b : null;
    }
    const kn = (iOk && ap.rp > 0) ? kozaiFromBrouwer(a, e1, i1).nRevDay : NaN;
    derived = {a, e, hp: ap.hp, ha: ap.ha, periodMin: per, revsPerDay: 1440/per, vCircKms: Math.sqrt(C72.mu/a),
      raan: wrap360(raan), ltan: nodeMode === 'ltan' ? ltanTyped : ltanFromRaan(raan, P.epoch),
      u: wrap360(P.argp + P.ma), nodeRate: rates(a, e, P.inc).nodedot, bstar, kozaiN: isFinite(kn) ? kn : null};
  }
  return {ok: all.length === 0, errors: sortByDom(all), notes: sortByDom(notes),
    el: all.length === 0 ? v.el : null, derived};
}

function defaultAmForEl(el){
  if(isNum(el.am)) return el.am;
  if(isNum(el.bstar)){
    const am = amFromBstar(el.bstar, el.a, el.e, el.i);
    if(am !== null) return am;
  }
  return craftAm('typical');
}
/* el -> form with NUMBER values. nodeMode defaults to LTAN for a sun-synchronous orbit,
   where the local time is the number a mission is designed around. */
function toForm(el, opts){
  const o = (opts && typeof opts === 'object') ? opts : {};
  const lf = lensFields(el.a, el.e);
  let nodeMode = o.nodeMode === 'ltan' || o.nodeMode === 'raan' ? o.nodeMode : null;
  if(nodeMode === null){
    const nd = rates(el.a, el.e, el.i).nodedot;
    nodeMode = (Math.abs(nd - MEAN_SUN_RATE) <= 0.01 && el.i > 90 && el.i < 180) ? 'ltan' : 'raan';
  }
  return {shape: (o.shape === 'ae' || o.shape === 'per' || o.shape === 'alt') ? o.shape : 'alt', nodeMode,
    name: typeof o.name === 'string' ? o.name : '',
    hp: lf.hp, ha: lf.ha, a: lf.a, e: lf.e, period: lf.period,
    inc: el.i, raan: el.raan, ltan: ltanFromRaan(el.raan, el.epoch), argp: el.argp, ma: el.M,
    epoch: formatEpoch(el.epoch), am: defaultAmForEl(el)};
}

/* How a fix works in any lens (a fix names canonical keys: hp, ha, a, e, period, inc, raan,
   ltan, argp, ma, epoch, am, name). The current form is read leniently; what the patch
   names is applied; the result is a NEW form (the input is never changed) and fields that
   were not touched keep the text the student typed. */
function patchForm(form, patch){
  const f = (form !== null && typeof form === 'object') ? form : {};
  const p = (patch !== null && typeof patch === 'object') ? patch : {};
  const shape = shapeOf(f), nodeMode = nodeModeOf(f);
  const out = {};
  for(const k of FORM_KEYS){ const x = own(f, k); out[k] = x === undefined ? '' : x; }
  out.shape = shape; out.nodeMode = nodeMode;
  const has = k => Object.prototype.hasOwnProperty.call(p, k);
  const pnum = k => { if(!has(k)) return null; const r = parseNumber(p[k]); return r.ok ? r.value : null; };
  const fnum = k => { const r = parseNumber(own(f, k)); return r.ok ? r.value : null; };

  /* size and shape */
  const pHp = pnum('hp'), pHa = pnum('ha'), pA = pnum('a'), pE = pnum('e'), pPer = pnum('period');
  let cur = null;                                   // the current (a, e), when the form holds one
  if(shape === 'alt'){
    const hp = fnum('hp'), ha = fnum('ha');
    if(hp !== null && ha !== null && (2*RE + hp + ha) > 0) cur = {hp, ha, a: (2*RE + hp + ha)/2, e: (ha - hp)/(2*RE + hp + ha)};
  } else if(shape === 'ae'){
    const a = fnum('a'), e = fnum('e');
    if(a !== null && e !== null && a > 0){ const ap = apsides(a, e); cur = {a, e, hp: ap.hp, ha: ap.ha}; }
  } else {
    const per = fnum('period'), e = fnum('e');
    if(per !== null && e !== null && per > 0){ const a = aFromPeriodMin(per), ap = apsides(a, e); cur = {a, e, hp: ap.hp, ha: ap.ha}; }
  }
  const hp0 = cur ? cur.hp : 700, ha0 = cur ? cur.ha : 700;
  const a0 = cur ? cur.a : RE + 700, e0 = cur ? cur.e : 0;
  let na = null, ne = null, exact = null;
  if(pHp !== null || pHa !== null){
    let hp = pHp !== null ? pHp : hp0, ha = pHa !== null ? pHa : ha0;
    if(pHp !== null && pHa === null && hp > ha) ha = hp;          // the other follows, rather than invert the orbit
    if(pHa !== null && pHp === null && ha < hp) hp = ha;
    na = (2*RE + hp + ha)/2; ne = (ha - hp)/(2*RE + hp + ha);
    exact = {hp, ha};
  } else if(pA !== null || pE !== null){
    na = pA !== null ? pA : a0; ne = pE !== null ? pE : e0;
    exact = {a: na, e: ne};
  } else if(pPer !== null){
    na = aFromPeriodMin(pPer); ne = e0;
    exact = {period: pPer};
  }
  if(na !== null && isFinite(na) && isFinite(ne)){
    const lf = lensFields(na, ne);
    out.hp = lf.hp; out.ha = lf.ha; out.a = lf.a; out.e = lf.e; out.period = lf.period;
    if(shape === 'alt'){ out.hp = exact.hp !== undefined ? exact.hp : out.hp; out.ha = exact.ha !== undefined ? exact.ha : out.ha; }
    else if(shape === 'ae'){ if(exact.a !== undefined) out.a = exact.a; if(exact.e !== undefined) out.e = exact.e; }
    else if(exact.period !== undefined) out.period = exact.period;
  }

  /* orientation */
  for(const k of ['inc', 'argp', 'ma', 'am']){ const x = pnum(k); if(x !== null) out[k] = x; }
  if(has('name') && typeof p.name === 'string') out.name = p.name;

  /* epoch and node: the authoritative node survives a new epoch */
  let epochMs = null, newEpoch = null;
  const curEp = parseEpoch(out.epoch);
  if(curEp.ok) epochMs = curEp.value;
  if(has('epoch')){
    const r = parseEpoch(p.epoch);
    if(r.ok){ newEpoch = r.value; epochMs = r.value; out.epoch = formatEpoch(r.value); }
  }
  const pL = has('ltan') ? parseLtan(p.ltan) : null, pR = pnum('raan');
  if(pL && pL.ok){
    out.ltan = pL.value;
    if(epochMs !== null) out.raan = raanFromLtan(pL.value, epochMs);
  } else if(pR !== null){
    out.raan = pR;
    if(epochMs !== null) out.ltan = ltanFromRaan(pR, epochMs);
  } else if(newEpoch !== null){
    if(nodeMode === 'ltan'){
      const l = parseLtan(out.ltan);
      if(l.ok){ out.ltan = l.value; out.raan = raanFromLtan(l.value, newEpoch); }
    } else {
      const r = parseNumber(out.raan);
      if(r.ok) out.ltan = ltanFromRaan(r.value, newEpoch);
    }
  }
  return out;
}

/* ---------- kinds, for the saved-orbit row ---------------------------------------- */

function kindWord(el){
  if(!el || !isNum(el.a) || !isNum(el.e) || !isNum(el.i) || !(el.a > 0) || !(el.e >= 0 && el.e < 1)) return '';
  const nd = rates(el.a, el.e, el.i).nodedot, hp = el.a*(1 - el.e) - RE;
  if(Math.abs(nd - MEAN_SUN_RATE) <= 0.01 && el.i > 90 && el.i < 180 && el.e < 0.05 && hp < 6000) return 'SSO';
  if(Math.abs(periodMin(el.a) - SIDEREAL_MIN)/SIDEREAL_MIN <= 0.0002 && el.e < 0.01 && Math.min(el.i, 180 - el.i) < 1) return 'GEO';
  if(el.e >= 0.25) return 'HEO';
  return '';
}

/* ---------- the two lines --------------------------------------------------------- */

/* sum of the digits in columns 1..68, a '-' counting 1, anything else 0, mod 10. Checked
   against all 4,316 lines of the catalogue. */
function checksum(line68){
  let c = 0;
  const s = String(line68);
  for(let k = 0; k < 68 && k < s.length; k++){
    const ch = s[k];
    if(ch >= '0' && ch <= '9') c += ch.charCodeAt(0) - 48;
    else if(ch === '-') c += 1;
  }
  return c % 10;
}
function checksumOk(line69){
  return typeof line69 === 'string' && line69.length === 69 &&
    line69[68] >= '0' && line69[68] <= '9' && checksum(line69) === line69.charCodeAt(68) - 48;
}

/* An 8-character implied-decimal exponent field: sign, five digits, exponent sign, one
   exponent digit; the value is 0.DDDDD x 10^exp. Zero and an exponent of 0 are spelled
   with +0. `value` is what the field really holds after rounding. */
function expField(x){
  if(typeof x !== 'number' || !isFinite(x)) throw new RangeError('expField: not a finite number');
  const ax = Math.abs(x);
  if(ax >= 1e9) throw new RangeError('expField: |x| must be below 1e9 (one exponent digit)');
  if(ax < 5e-11) return {txt: ' 00000+0', value: 0};
  let ex = Math.floor(Math.log10(ax)) + 1;
  let m = Math.round(ax/Math.pow(10, ex)*1e5);
  if(m >= 100000){ m = 10000; ex++; }          // the mantissa rounded up to 1.00000: carry, or the field is six digits wide
  if(m < 10000){ m *= 10; ex--; }              // log10 landed just under an integer
  if(ex > 9) throw new RangeError('expField: too large for one exponent digit');
  if(ex < -9) return {txt: ' 00000+0', value: 0};
  const sign = x < 0 ? '-' : ' ';
  return {txt: sign + String(m).padStart(5, '0') + (ex < 0 ? '-' : '+') + Math.abs(ex),
    value: (x < 0 ? -1 : 1)*m*Math.pow(10, ex - 5)};
}

/* epoch ms -> the two-digit year and day of year (1.0 = Jan 1 00:00 UTC) with 8 decimals.
   Rounds FIRST and tests the year end afterwards: 365.999999996 days would otherwise print
   as day 366.00000000 in a 365-day year. The quantum is 1e-8 day = 0.864 ms. */
function epochFields(ms){
  if(!isNum(ms) || Math.abs(ms) > 8.64e15) throw new RangeError('epochFields: epoch is not a date');
  let y = new Date(ms).getUTCFullYear();
  const start = yy => Date.UTC(yy, 0, 1);
  const len = yy => (Date.UTC(yy + 1, 0, 1) - Date.UTC(yy, 0, 1))/86400000;
  let scaled = Math.round(((ms - start(y))/86400000 + 1)*1e8);
  if(scaled >= (len(y) + 1)*1e8){ y++; scaled = 1e8; }
  if(!(y >= 1957 && y <= 2056)) throw new RangeError('epochFields: year outside 1957..2056');
  const doy = Math.floor(scaled/1e8), frac = scaled - doy*1e8;
  return {year: y, yy: String(y % 100).padStart(2, '0'),
    doyTxt: String(doy).padStart(3, '0') + '.' + String(frac).padStart(8, '0'),
    epochMsExact: start(y) + (scaled/1e8 - 1)*86400000};
}

function angText(x){
  if(!isNum(x)) throw new RangeError('toTLE: angle is not a number');
  const s = wrap360(x).toFixed(4);
  return (+s >= 360 ? '0.0000' : s).padStart(8, ' ');
}

/* The TLE for an element set, written the way the catalogue's are and nothing else varies:
   classification U, no international designator, ndot and nddot zero, ephemeris type 0,
   element-set number 1, revolution number 0 (none of those change the position; checked
   at +3 days). `satnum` is five characters of [0-9A-Z]; the page passes 'O0001'. el is NOT
   validated here (call validate first); a value that does not fit the format throws
   RangeError. Deterministic, because index.html rebuilds the lines on every restore. */
function toTLE(el, satnum){
  if(typeof satnum !== 'string' || !/^[0-9A-Z]{5}$/.test(satnum)) throw new RangeError('toTLE: satnum must be exactly 5 characters from 0-9 and A-Z');
  if(el === null || typeof el !== 'object') throw new RangeError('toTLE: no element set');
  // rounding order (mandatory): e and i first, invert with those, then n
  const e1 = Math.round(el.e*1e7)/1e7, i1 = Math.round(el.i*1e4)/1e4;
  if(!(e1 >= 0 && e1 <= 0.9999999)) throw new RangeError('toTLE: eccentricity not representable (0 <= e <= 0.9999999)');
  if(!(i1 >= 0 && i1 <= 180)) throw new RangeError('toTLE: inclination outside 0..180');
  if(!isNum(el.a) || !(el.a > 0)) throw new RangeError('toTLE: semi-major axis must be positive');
  const k = kozaiFromBrouwer(el.a, e1, i1);
  const n = Math.round(k.nRevDay*1e8)/1e8;
  if(!(n > 0 && n < LIMITS.nMaxRevDay)) throw new RangeError('toTLE: mean motion does not fit 11.8f (n >= 100 rev/day)');
  if(!isNum(el.bstar)) throw new RangeError('toTLE: el.bstar missing (run Planner.validate first)');
  const ep = epochFields(el.epoch);
  const bs = expField(el.bstar);
  let l1 = '1 ' + satnum + 'U' + ' ' + '        ' + ' ' + ep.yy + ep.doyTxt + ' ' + ' .00000000' + ' ' + ' 00000-0' +
    ' ' + bs.txt + ' ' + '0' + ' ' + '   1';
  if(l1.length !== 68) throw new Error('toTLE: line 1 is ' + l1.length + ' characters');
  l1 += checksum(l1);
  let l2 = '2 ' + satnum + ' ' + i1.toFixed(4).padStart(8, ' ') + ' ' + angText(el.raan) + ' ' +
    String(Math.round(e1*1e7)).padStart(7, '0') + ' ' + angText(el.argp) + ' ' + angText(el.M) + ' ' +
    n.toFixed(8).padStart(11, ' ') + '    0';
  if(l2.length !== 68) throw new Error('toTLE: line 2 is ' + l2.length + ' characters');
  l2 += checksum(l2);
  return {l1, l2, epochMsExact: ep.epochMsExact, nRevDay: n, eccValue: e1, bstarValue: bs.value};
}

/* ---------- reading the lines back ------------------------------------------------ */

/* satellite.js validates NOTHING: garbage lines give error 0 and NaN, a 60-character line
   silently reads B* as 0.1027, a bad checksum is accepted, and a propagation SGP4 refuses
   comes back as null. So this is the only guard between the planner and the globe. */
const SGP4_ERRORS = Object.freeze({
  0: {why: 'no usable position', hint: 'Try a higher perigee.'},
  1: {why: 'mean eccentricity or semi-major axis out of range', hint: 'Raise perigee or lower the area-to-mass ratio, so that drag cannot round the orbit off.'},
  2: {why: 'mean motion below zero', hint: 'Lower the area-to-mass ratio.'},
  3: {why: 'perturbed eccentricity out of range', hint: 'Lower e or the apogee: very eccentric orbits can leave the model’s range.'},
  4: {why: 'semi-latus rectum below zero', hint: 'Raise perigee or lower e.'},
  6: {why: 'decayed', hint: 'Raise perigee above the air, or lower the area-to-mass ratio.'}
});
function sgp4Err(code, msg){
  const c = SGP4_ERRORS[code] ? code : 0, info = SGP4_ERRORS[c];
  return mkErr('', 'err.sgp4', msg || ('SGP4 cannot start from those elements: ' + info.why + '.'),
    {sgp4: isNum(code) ? code : 0, why: info.why, hint: info.hint});
}
const RE_L1 = /^1 [0-9A-Z]{5}U .{8} \d{5}\.\d{8} [ +-]\.\d{8} [ +-]\d{5}[+-]\d [ +-]\d{5}[+-]\d 0 [ \d]{4}\d$/;
const RE_L2 = /^2 [0-9A-Z]{5} [ \d]{3}\.\d{4} [ \d]{3}\.\d{4} \d{7} [ \d]{3}\.\d{4} [ \d]{3}\.\d{4} [ \d]{2}\.\d{8}[ \d]{5}\d$/;
const angDiff = (x, y) => Math.abs(((x - y) % 360 + 540) % 360 - 180);

function satrecEpochMs(s){
  const y = s.epochyr < 57 ? 2000 + s.epochyr : 1900 + s.epochyr;
  return Date.UTC(y, 0, 1) + (s.epochdays - 1)*86400000;
}

function verifyTLE(l1, l2, el, sat){
  const errors = [], warnings = [];
  const probe = {n: 0, refused: 0, firstError: null};
  const result = () => ({ok: errors.length === 0, errors, warnings, probe});
  const printable69 = s => typeof s === 'string' && s.length === 69 && /^[\x20-\x7e]{69}$/.test(s);
  if(!printable69(l1) || !printable69(l2)){ errors.push(sgp4Err(0, 'Each line of a TLE is exactly 69 printable characters.')); return result(); }
  if(!checksumOk(l1) || !checksumOk(l2)){ errors.push(sgp4Err(0, 'A line’s checksum does not match.')); return result(); }
  if(!RE_L1.test(l1) || !RE_L2.test(l2)){ errors.push(sgp4Err(0, 'The lines do not follow the TLE layout this planner writes.')); return result(); }
  if(!sat || typeof sat.twoline2satrec !== 'function' || typeof sat.propagate !== 'function'){
    errors.push(sgp4Err(0, 'satellite.js is not available to check the lines.')); return result();
  }
  let s;
  try { s = sat.twoline2satrec(l1, l2); } catch(e){ errors.push(sgp4Err(0)); return result(); }
  if(!s || s.error !== 0){ errors.push(sgp4Err(s ? s.error : 0)); return result(); }

  /* does SGP4 read back the orbit that was typed? */
  const haveEl = el !== null && typeof el === 'object' && isNum(el.a) && isNum(el.e) && isNum(el.i);
  let epochMs = satrecEpochMs(s);
  if(haveEl){
    const nWritten = parseFloat(l2.slice(52, 63));
    const tolA = 1.2*(2/3)*el.a*5e-9/nWritten + 1e-6;
    const miss = [];
    if(!(Math.abs(s.a*C72.Re - el.a) <= tolA)) miss.push('semi-major axis');
    if(!(Math.abs(s.ecco - Math.round(el.e*1e7)/1e7) <= 5e-8)) miss.push('eccentricity');
    if(!(Math.abs(s.inclo*R2D - Math.round(el.i*1e4)/1e4) <= 6e-5)) miss.push('inclination');
    if(isNum(el.raan) && !(angDiff(s.nodeo*R2D, Math.round(wrap360(el.raan)*1e4)/1e4) <= 6e-5)) miss.push('node');
    if(isNum(el.argp) && !(angDiff(s.argpo*R2D, Math.round(wrap360(el.argp)*1e4)/1e4) <= 6e-5)) miss.push('argument of perigee');
    if(isNum(el.M) && !(angDiff(s.mo*R2D, Math.round(wrap360(el.M)*1e4)/1e4) <= 6e-5)) miss.push('mean anomaly');
    if(isNum(el.epoch)){
      if(!(Math.abs(epochMs - el.epoch) <= 1)) miss.push('epoch');
      else { try { epochMs = epochFields(el.epoch).epochMsExact; } catch(e){ /* keep the satrec's */ } }
    }
    if(isNum(el.bstar)){
      let bv = null;
      try { bv = expField(el.bstar).value; } catch(e){ bv = null; }
      if(bv === null || !(Math.abs(s.bstar - bv) <= 1e-12 + 1e-5*Math.abs(bv))) miss.push('B*');
    }
    if(miss.length){ errors.push(sgp4Err(0, 'SGP4 reads back a different ' + miss.join(', ') + ' from the one typed.')); return result(); }
  }

  /* can SGP4 fly it? null (or no position) means it refused */
  const fly = ms => {
    let pv = null;
    try { pv = sat.propagate(s, new Date(ms)); } catch(e){ pv = null; }
    if(!pv || !pv.position || !pv.velocity || typeof pv.position !== 'object') return null;
    const p = pv.position, v = pv.velocity;
    if(!(isFinite(p.x) && isFinite(p.y) && isFinite(p.z) && isFinite(v.x) && isFinite(v.y) && isFinite(v.z))) return null;
    const r = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
    return (r >= 0.9*6378 && r <= 1e6) ? pv : null;
  };
  if(fly(epochMs) === null){ errors.push(sgp4Err(s.error || 0)); return result(); }
  const period = 2*PI*Math.sqrt(Math.pow(s.a*C72.Re, 3)/C72.mu)*1000;           // ms, Keplerian
  const N = 400;
  probe.n = N;
  for(let k = 0; k < N; k++){
    if(fly(epochMs + k/N*period) === null){ probe.refused++; if(probe.firstError === null) probe.firstError = s.error || 0; }
  }
  if(probe.refused === N){ errors.push(sgp4Err(probe.firstError)); return result(); }
  if(probe.refused > 0)
    warnings.push(mkErr('', 'probe.partial', 'Part of each orbit is underground or decayed (' + probe.refused + ' of ' + N + ' samples refused).',
      {refused: probe.refused, firstError: probe.firstError}));
  return result();
}

/* The element set a real TLE describes, for the read-only Professor and "the spacecraft on
   screen". NOT validated: catalogue sets include ones with a negative perigee and an e
   above 0.9. am is B* worked back to area over mass (fitted, not measured), null when the
   orbit is wholly above the air. */
function elementsFromTLE(l1, l2, sat){
  const s = sat.twoline2satrec(l1, l2);
  const a = s.a*C72.Re, e = s.ecco, i = s.inclo*R2D;
  return {a, e, i, raan: s.nodeo*R2D, argp: s.argpo*R2D, M: s.mo*R2D, epoch: Math.round(satrecEpochMs(s)),
    am: amFromBstar(s.bstar, a, e, i), bstar: s.bstar};
}

/* ---------- names and the store --------------------------------------------------- */

/* What a name may contain. It ends up in textContent and value (safe), escaped HTML
   (safe), a CSV cell (formula injection if it starts with = + - @), an ICS TEXT value (whose
   escaper handles \n but not \r), a file name (slugged) and a canvas label. So: no control
   or invisible or bidirectional characters, no leading spreadsheet-formula character, 24
   characters. & < > " stay (the catalogue has AT&T T-16; every sink escapes). */
const BAD_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const BAD_CHARS = new RegExp('[' + BAD_RANGES.map(r => String.fromCharCode(r[0]) + (r[1] > r[0] ? '-' + String.fromCharCode(r[1]) : '')).join('') + ']', 'g');
/* "has a letter or digit", Unicode-wide so a Thai name counts. Property escapes are
   ES2018, so the pattern is built at run time: an older engine falls back to "any
   character above U+007F that is not in a punctuation or symbol block". */
const LETTER_DIGIT = (() => {
  try { return new RegExp('[\\p{L}\\p{N}]', 'u'); } catch(e){ return null; }
})();
function hasLetterOrDigit(t){
  if(LETTER_DIGIT !== null) return LETTER_DIGIT.test(t);
  for(const ch of t){
    const c = ch.codePointAt(0);
    if((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return true;
    if(c > 0xBF && !(c >= 0x2000 && c <= 0x2BFF) && !(c >= 0x3000 && c <= 0x303F) && !(c >= 0xFE00 && c <= 0xFE0F) && c < 0x1F000) return true;
  }
  return false;
}
function cleanName(s){
  if(typeof s !== 'string') return '';
  if(s.length > 100000) s = s.slice(0, 100000);
  let t = s.normalize('NFC').replace(BAD_CHARS, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[=+\-@|'"\s]+/, '');
  t = Array.from(t).slice(0, LIMITS.nameMax).join('').trim();
  return hasLetterOrDigit(t) ? t : '';
}

/* Untrusted text in, only validated records out. The store is JSON in localStorage that
   other code on the origin can write, so: a size cap before the parse, typed field
   extraction (no spread, no Object.assign from storage: __proto__ and unknown keys die),
   no stored TLE or flag ever returned, an id pattern that cannot be a property name, and
   every element set through the same validate the form uses. */
function sanitizeStore(raw){
  const out = {items: [], next: 1, dropped: 0, why: null};
  if(typeof raw !== 'string' || raw === '') return out;
  if(raw.length > LIMITS.storeMaxChars){ out.why = 'too-large'; return out; }
  let j;
  try { j = JSON.parse(raw); } catch(e){ out.why = 'unreadable'; return out; }
  if(j === null || typeof j !== 'object' || Array.isArray(j) || own(j, 'v') !== SCHEMA || !Array.isArray(own(j, 'items'))){
    out.why = 'version'; return out;
  }
  const seen = {};
  for(const it of own(j, 'items')){
    if(out.items.length >= LIMITS.maxCustom){ out.dropped++; continue; }
    const id = own(it, 'id');
    if(typeof id !== 'string' || !/^c[1-9]\d{0,3}$/.test(id) || Object.prototype.hasOwnProperty.call(seen, id)){ out.dropped++; continue; }
    const name = cleanName(own(it, 'name'));
    if(name === ''){ out.dropped++; continue; }
    const v = validate(own(it, 'el'));
    if(!v.ok){ out.dropped++; continue; }
    seen[id] = true;
    const made = own(it, 'made');
    out.items.push({id, name, made: isNum(made) ? made : 0, el: v.el});
  }
  let top = 0;
  for(const it of out.items) top = Math.max(top, +it.id.slice(1));
  const stored = own(j, 'next');
  out.next = Math.min(10000, Math.max(isNum(stored) && stored >= 1 ? Math.floor(stored) : 1, top + 1));
  return out;
}

/* ---------- presets --------------------------------------------------------------- */

const DEFAULT_EPOCH = Date.UTC(2026, 9, 1, 12);
const DEFAULT_SITE = {name: 'Bangkok', lat: 13.75, lon: 100.52};

function presetForm(a, e, inc, node, argp, ma, epochMs, am, name){
  const lf = lensFields(a, e);
  let raan, ltan;
  if(node.ltan !== undefined){ ltan = node.ltan; raan = raanFromLtan(ltan, epochMs); }
  else { raan = node.raan; ltan = ltanFromRaan(raan, epochMs); }
  return {shape: 'alt', nodeMode: node.ltan !== undefined ? 'ltan' : 'raan', name: name || '',
    hp: lf.hp, ha: lf.ha, a: lf.a, e: lf.e, period: lf.period,
    inc, raan, ltan, argp, ma, epoch: formatEpoch(epochMs), am};
}

function presets(site, epochMs){
  const ep = isNum(epochMs) ? epochMs : DEFAULT_EPOCH;
  const st = (site !== null && typeof site === 'object') ? site : DEFAULT_SITE;
  const lat = isNum(st.lat) ? st.lat : DEFAULT_SITE.lat, lon = isNum(st.lon) ? st.lon : DEFAULT_SITE.lon;
  const moved = typeof st.name === 'string' && st.name !== '' && st.name !== 'Bangkok';
  const place = moved ? cleanName(st.name) : 'Bangkok';
  const circ = (hp, inc, node, am, craft) => ({craft, form: presetForm(RE + hp, 0, inc, node, 0, 0, ep, am)});
  const am = key => craftAm(key);
  const list = [];
  const add = (key, group, label, why, pre) => list.push({key, group, label, why, craft: pre.craft, form: pre.form});
  const LEO = 'Low Earth orbit', HIGH = 'Medium and high';

  add('iss', LEO, 'ISS-like, 420 km',
    'The orbit every CubeSat released from the station starts in, and the one the page’s default lives in.',
    circ(420, 51.64, {raan: 0}, am('large'), 'large'));
  add('sso', LEO, 'Earth observation, sun-synchronous, 700 km',
    'Earth observation wants the same light on every pass, so it flies sun-synchronous, at a local time chosen for the job.',
    circ(700, ssoInclination(RE + 700, 0), {ltan: 10.5}, am('typical'), 'typical'));
  add('dd', LEO, 'Dawn-dusk, sun-synchronous, 700 km',
    'The orbit that rides the day–night boundary: almost no eclipse, which small satellites and radar like.',
    circ(700, ssoInclination(RE + 700, 0), {ltan: 6}, am('typical'), 'typical'));
  /* 233 revolutions in exactly 16 days, sun-synchronous: a and i depend on each other
     (the node rate sets i, i sets the repeat rate that sets a), so iterate to the fixed point */
  let aL = RE + 700, iL = ssoInclination(aL, 0);
  for(let k = 0; k < 40; k++){
    iL = ssoInclination(aL, 0);
    const an = aForRevsPerDay(233/16, 0, iL);
    if(an === null) break;
    const done = Math.abs(an - aL) < 1e-10;
    aL = an;
    if(done) break;
  }
  iL = ssoInclination(aL, 0);
  add('landsat', LEO, 'Repeating ground track, 16 days',
    'Landsat’s kind of orbit: 233 revolutions in exactly 16 days, so the same scene comes round again.',
    {craft: 'typical', form: presetForm(aL, 0, iL, {ltan: 10}, 0, 0, ep, am('typical'))});
  add('thai', LEO, moved ? 'Low inclination over ' + place + ', 550 km' : 'Low inclination over Thailand, 550 km',
    'A tilt near ' + place + '’s own latitude, which gives the site its highest passes, most of them near overhead.',
    circ(550, Math.round(Math.abs(lat)), {raan: 0}, am('typical'), 'typical'));
  add('cube', LEO, '3U CubeSat, 500 km',
    'Where most CubeSats end up: a rideshare to a sun-synchronous orbit, small and light, so drag decides how long they last.',
    circ(500, ssoInclination(RE + 500, 0), {ltan: 10.5}, am('cubesat'), 'cubesat'));
  add('knack', LEO, 'KNACKSAT-2-like, 360 km',
    'Close to the page’s default. Its drag is worked back from KNACKSAT-2’s own B*, which is fitted, not measured.',
    circ(360, 51.63, {raan: 0}, 0.0045, 'custom'));
  add('gps', HIGH, 'GPS-like, 20,200 km',
    'Half a sidereal day per orbit, so the track repeats every day; a navigation constellation’s height.',
    circ(20182, 55, {raan: 0}, am('typical'), 'typical'));
  add('geo', HIGH, 'Geostationary, over the observer',
    'One sidereal day over the equator: it stands still over one place, here set to the observer’s longitude.',
    {craft: 'typical', form: presetForm(GEO_A_KM, 0, 0, {raan: 0}, 0, wrap360(lon + gmstDeg(ep)), ep, am('typical'))});
  add('molniya', HIGH, 'Molniya',
    'Twelve hours, steeply tilted, apogee parked over the north: how to cover high latitudes without a geostationary slot.',
    {craft: 'typical', form: presetForm(26554.137, 0.74, 63.4, {raan: 0}, 270, 0, ep, am('typical'))});
  add('tundra', HIGH, 'Tundra',
    'A geosynchronous cousin of Molniya: a day long, tilted to the critical inclination, dwelling over one hemisphere.',
    {craft: 'typical', form: presetForm(GEO_A_KM, 0.27, 63.4, {raan: 0}, 270, 0, ep, am('typical'))});
  return list;
}
function defaultForm(site, epochMs){
  const p = presets(site, epochMs)[1];
  const f = Object.assign({}, p.form);
  f.name = 'My orbit';
  return f;
}

global.Planner = {
  SCHEMA, LIMITS, C72, RE, CD, SIDEREAL_DAY_S, SIDEREAL_MIN, WE_DEG_DAY, MEAN_SUN_RATE, DEEP_A_KM, GEO_A_KM,
  FIELD_LABEL, CRAFTS, PRESETS_KEYS, SGP4_ERRORS,
  parseNumber, parseLtan, parseEpoch, formatEpoch,
  gmstDeg, meanSunRaDeg, ltanFromRaan, raanFromLtan, periodMin, isDeep, aFromPeriodMin, apsides,
  kozaiFromBrouwer, brouwerFromKozai, rates, ssoInclination, ssoAmaxKm, revsPerNodalDay, aForRevsPerDay, retroErrorKm,
  dragAvg, sgp4Cc2, bstarFromAm, amFromBstar, amMax,
  fromForm, toForm, patchForm, presets, defaultForm, kindWord, validate, craftForAm,
  checksum, checksumOk, expField, epochFields, toTLE, verifyTLE, elementsFromTLE,
  cleanName, storable, sanitizeStore
};
})(typeof window !== 'undefined' ? window : globalThis);
