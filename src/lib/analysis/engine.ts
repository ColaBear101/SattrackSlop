// @ts-nocheck - verbatim; the typed surface is Engine in ../types.ts
/* The analysis engine: elements, propagation adapters, passes, compute().
 *
 * Moved VERBATIM from legacy/index.html (main@4eadd7a), lines 8420, 8425, 8449-8454, 8503-8534, 8576-8703, 8754-8960. The arithmetic, its order
 * and the comments are untouched: the regression gate compares 67,488 values with ===, so this file
 * is not the place to tidy. What changed is only where the names come from. The page's closures over
 * BODY, OBS, MASK and satellite.js are now the arguments of makeEngine(), and the observer is a value
 * the caller replaces (a new engine) rather than an object mutated in place.
 */
import { sgp4Track } from '../core/propagator';

export function makeEngine(env) {
  const { satellite, BODY, OBS, MASK } = env;
  const Propagator = { sgp4Track };
const RAD = Math.PI/180, DEG = 180/Math.PI;
const MU = BODY.mu, RE = BODY.Re;
const stepFor = hrs => hrs <= 48 ? 10 : 30;      // display sample step, seconds
/* The horizon scan runs finer than the display sampling: bisection only refines
   a crossing it has already bracketed, so a pass shorter than the step is not
   merely imprecise, it is invisible. A 6.0 s pass of FENGYUN 3E was being lost
   at 10 s. */
const passStepFor = hrs => hrs <= 48 ? 4 : 15;

function expField(s){                     // " 12345-3" -> 0.12345e-3
  s = s.trim();
  if(!s || /^[+-]?0+$/.test(s)) return 0;
  const sign = s[0]==='-' ? -1 : 1;
  if(s[0]==='+'||s[0]==='-') s = s.slice(1);
  const m = s.match(/^(\d+)([+-]\d)$/);
  return m ? sign*parseFloat('0.'+m[1])*Math.pow(10,parseInt(m[2],10))
           : sign*parseFloat('0.'+s);
}
/* (a) the six elements, straight out of the fixed TLE columns */
function elements(l1,l2){
  const yy = parseInt(l1.substring(18,20),10);
  const doy = parseFloat(l1.substring(20,32));
  const year = yy < 57 ? 2000+yy : 1900+yy;
  const epoch = new Date(Date.UTC(year,0,1) + (doy-1)*86400000);
  const inc  = parseFloat(l2.substring(8,16));
  const raan = parseFloat(l2.substring(17,25));
  const ecc  = parseFloat('0.'+l2.substring(26,33).trim());
  const argp = parseFloat(l2.substring(34,42));
  const ma   = parseFloat(l2.substring(43,51));
  const n    = parseFloat(l2.substring(52,63));           // rev/day
  const nRad = n*2*Math.PI/86400;                          // rad/s
  const a    = Math.cbrt(MU/(nRad*nRad));                  // km
  return {
    epoch, inc, raan, ecc, argp, ma, n, a,
    period: 86400/n,
    perigeeAlt: a*(1-ecc)-RE, apogeeAlt: a*(1+ecc)-RE,
    satnum: l1.substring(2,7).trim(), cospar: l1.substring(9,17).trim(),
    rev: parseInt(l2.substring(63,68),10) || 0,
    bstar: expField(l1.substring(53,61)), ndot: parseFloat(l1.substring(33,43))
  };
}

/* ---- propagation --------------------------------------------------------- */
// the same state as sample(), but at an arbitrary instant - used when the clock
// sits outside the 24 h window, where there is no stored sample to read
/* ---- propagation adapters ------------------------------------------------
 * These four were the same three lines written out four times, each calling
 * satellite.js directly and each closing over OBS. That is now the ONE place
 * the page turns a propagated state into something a human reads, and it asks
 * the Track for the state and the Body for the frame. Swapping either is a
 * change of argument, not a change of code.
 *
 * The maths is untouched — same calls, same order, same objects — because this
 * phase has to come out bit-identical against verification/baseline.json.     */
function look(track, r, theta){
  return track.body.lookAngles(OBS, track.body.toFixed(r, theta));
}
function fix(track, ms){                       // the state + frame angle at ms
  const t = new Date(ms);
  const st = track.at(ms);
  return st ? { t, r: st.r, v: st.v, theta: track.body.spin(t) } : null;
}
function subPoint(track, s){
  const gd = track.body.toGeodetic(s.r, s.theta);
  let lon = gd.longitude*DEG; while(lon>180) lon-=360; while(lon<-180) lon+=360;
  const la = look(track, s.r, s.theta);
  return { t: s.t, lat: gd.latitude*DEG, lon, alt: gd.height,
           el: la.elevation*DEG, az: ((la.azimuth*DEG)%360+360)%360, rng: la.rangeSat };
}
function sampleMs(track, ms){
  const s = fix(track, ms);
  return s ? subPoint(track, s) : null;
}
function sample(track, start, k, step){
  return sampleMs(track, start.getTime()+k*step*1000);
}
function elevationAt(track, ms){
  const s = fix(track, ms);
  if(!s) return -90;
  return look(track, s.r, s.theta).elevation*DEG;
}
/* Range rate, and therefore Doppler. Taken in the BODY-FIXED frame, because
   that is the one frame where the ground station is genuinely at rest: the site
   is a constant vector there, so the closing speed is just the projection of the
   spacecraft's fixed-frame velocity onto the line of sight.

   That velocity is NOT the propagated velocity with its axes turned, which is
   the classic error. Turning the axes leaves the frame's own rotation
   unaccounted for; the transport term -omega x r is what carries the observer,
   and dropping it costs 0.452 km/s at Bangkok - about 0.65 kHz at 435 MHz. */
function rangeRateAt(track, s){
  const b = track.body;
  if(!b.omega || !b.siteFixed) return null;      // a body that declares no rotation
  const rf = b.toFixed(s.r, s.theta);            // spacecraft, body-fixed
  const vf = b.toFixed(s.v, s.theta);            // its velocity, axes turned only
  const sf = b.siteFixed(OBS);
  const w = b.omega;                             // omega is along +z in this frame
  const vx = vf.x + w*rf.y, vy = vf.y - w*rf.x, vz = vf.z;
  const dx = rf.x - sf.x, dy = rf.y - sf.y, dz = rf.z - sf.z;
  const rng = Math.hypot(dx, dy, dz);
  return rng > 0 ? (dx*vx + dy*vy + dz*vz)/rng : null;   // km/s, + is receding
}
function rangeRateMs(track, ms){
  const s = fix(track, ms);
  return s ? rangeRateAt(track, s) : null;
}
/* Doppler: a receding source is shifted DOWN, hence the sign. c in km/s to match
   the range rate; the shift comes back in the same unit the frequency went in. */
const C_KMS = 299792.458;
function dopplerHz(freqHz, rrKms){
  return (freqHz === null || rrKms === null) ? null : -freqHz*rrKms/C_KMS;
}

function stateAt(track, ms){
  const s = fix(track, ms);
  if(!s) return null;
  const la = look(track, s.r, s.theta);
  return { el: la.elevation*DEG, az: ((la.azimuth*DEG)%360+360)%360, rng: la.rangeSat,
           rr: rangeRateAt(track, s) };
}

/* (c) access windows: coarse scan, then bisect each horizon crossing */
function findPasses(track, t0, t1, step){
  const f = ms => elevationAt(track, ms) - MASK;
  const bisect = (lo,hi) => {
    let flo = f(lo);
    while(hi-lo > 1){                       // 1 ms
      const mid = (lo+hi)/2, fm = f(mid);
      if((flo<0) === (fm<0)){ lo = mid; flo = fm; } else hi = mid;
    }
    return (lo+hi)/2;
  };
  const stepMs = step*1000, passes = [];
  let prev = t0, prevF = f(t0), open = prevF >= 0 ? t0 : null, clipStart = prevF >= 0;
  for(let t = t0+stepMs; t <= t1; t += stepMs){
    const cur = f(t);
    if(prevF < 0 && cur >= 0) open = bisect(prev, t);
    else if(prevF >= 0 && cur < 0 && open !== null){
      passes.push(build(track, open, bisect(prev,t), clipStart, false)); open = null; clipStart = false;
    }
    prev = t; prevF = cur;
  }
  if(open !== null) passes.push(build(track, open, t1, clipStart, true));
  return passes;
}
function build(track, aos, los, clipA, clipL){
  let best = {el:-90, ms:aos, az:0, rng:0};
  const n = 150;
  for(let i=0;i<=n;i++){
    const ms = aos + (los-aos)*i/n, s = stateAt(track, ms);
    if(s && s.el > best.el) best = {el:s.el, ms, az:s.az, rng:s.rng};
  }
  let w = (los-aos)/n;                       // refine the culmination
  for(let i=0;i<40 && w>1;i++){
    // stay inside the pass: an unclamped climb walks past AOS/LOS on a window-
    // clipped pass and reports a peak that never happens while in view
    const ta = Math.max(aos, best.ms - w), tb = Math.min(los, best.ms + w);
    const a = stateAt(track, ta), b = stateAt(track, tb);
    if(a && a.el > best.el) best = {el:a.el, ms:ta, az:a.az, rng:a.rng};
    else if(b && b.el > best.el) best = {el:b.el, ms:tb, az:b.az, rng:b.rng};
    else w /= 2;
  }
  best.ms = Math.min(los, Math.max(aos, best.ms));
  const A = stateAt(track,aos), L = stateAt(track,los);
  const arc = [];
  for(let i=0;i<=90;i++){ const s = stateAt(track, aos+(los-aos)*i/90); if(s) arc.push(s); }
  return { aos:new Date(aos), los:new Date(los), dur:(los-aos)/1000,
           maxEl:best.el, maxAt:new Date(best.ms), maxAz:best.az, minRng:best.rng,
           aosAz:A?A.az:0, losAz:L?L.az:0, arc, clipA, clipL, t0ms:aos, t1ms:los };
}

/* The entry interface - conventionally 400,000 ft, about 122 km - below which a
   returning object is taken to be re-entering. Nothing stays in orbit there. */
const REENTRY_KM = 120;
/* satellite.js's refusal codes, in words. 6 is the one this catalogue meets:
   objects that were in orbit when it was built and are not now. */
const SGP4_WHY = {
  1: 'mean eccentricity or semi-major axis out of range',
  2: 'mean motion below zero',
  3: 'perturbed eccentricity out of range',
  4: 'semi-latus rectum below zero',
  6: 'decayed'
};
/* SGP4's own gravitational parameter - WGS-72, 398600.8 km^3/s^2 - for
   anything worked out from its Brouwer a or from its r and v. The WGS-84 MU
   above is 0.36 km^3/s^2 smaller; mixing the two sets moves an osculating a
   by about 6 m, which is nothing, but there is no reason to mix them. */
const SGP4_MU = (satellite.constants && satellite.constants.mu) || MU;
const sgp4Why = code => code === null || code === undefined ? 'the element set could not be read'
  : SGP4_WHY[code] ? 'error ' + code + ': ' + SGP4_WHY[code]
  : 'no usable position';

function compute(entry, t0ms, hours){
  const track = Propagator.sgp4Track(BODY, entry, satellite);
  const E = elements(entry.l1, entry.l2);
  const step = stepFor(hours);
  const start = new Date(t0ms), end = new Date(t0ms + hours*3600000);
  const pts = [];
  const N = Math.round(hours*3600/step);
  /* A sample SGP4 refuses is skipped, as it always was - but no longer
     forgotten. The first refusal says why there is nothing to analyse, if there
     is nothing; and an error 6 anywhere in the window is SGP4 reporting that the
     orbit has met the ground at that instant, which is the re-entry test below. */
  let lost = null, groundAt = null;
  for(let k=0;k<=N;k++){
    const s = sample(track,start,k,step);
    if(s){ pts.push(s); continue; }
    const code = track.lastError;
    if(!lost) lost = {code};
    if(code === 6 && groundAt === null) groundAt = start.getTime()+k*step*1000;
  }
  if(!pts.length){
    /* Nothing to analyse at all. The reason travels with the error, so load()
       can say "SGP4 has this object decayed" rather than "something failed". */
    const err = new Error('no propagable samples for '+entry.name);
    err.sgp4 = lost ? lost.code : null;
    throw err;
  }

  /* The TLE mean motion is the KOZAI mean motion, so a = (mu/n^2)^(1/3) is not
     the orbit's semi-major axis - it is short by a few km, and by up to 6.4 km
     in this catalogue. SGP4 un-Kozai's it during init and leaves the recovered
     Brouwer value in satrec.a. The propagator knows how to un-normalise it -
     on WGS-72, which is SGP4's own radius and 2 m off WGS-84. A propagator
     without that recovered value (a lunar element set, say) returns null and
     the TLE-derived a stands. The two-body value is kept beside it, only so
     the card can say how far apart the two are for this element set. */
  const recovered = track.recoveredA;
  E.aNaive = E.a;
  if(recovered !== null){
    E.a = recovered;
    E.aSource = 'sgp4';
  }

  /* Nodal period, measured rather than assumed: 86400/n is the mean-motion
     period and runs a few seconds long against the actual node-to-node time. */
  const nodeCross = ms => {
    const s = fix(track, ms);
    return s ? track.body.toGeodetic(s.r, s.theta).latitude : null;
  };
  (function(){
    const approx = 86400/E.n, t0 = start.getTime();
    const hits = [];
    let prev = nodeCross(t0);
    for(let t = t0 + 20000; t < t0 + approx*2200 && hits.length < 2; t += 20000){
      const cur = nodeCross(t);
      if(prev !== null && cur !== null && prev < 0 && cur >= 0){   // northbound crossing
        let lo = t - 20000, hi = t, flo = prev;
        for(let k=0;k<40 && hi-lo>1;k++){
          const mid=(lo+hi)/2, fm=nodeCross(mid);
          if(fm === null) break;
          if((flo<0) === (fm<0)){ lo=mid; flo=fm; } else hi=mid;
        }
        hits.push((lo+hi)/2);
      }
      prev = cur;
    }
    if(hits.length === 2){ E.period = (hits[1]-hits[0])/1000; E.periodMeasured = true; }
  })();

  /* Which period to SHOW. The node-to-node time is the right figure wherever
     the node is a definite point, and it stays in E.period - the apsis
     sampling below and the regression baseline are both built on it. For a
     near-equatorial orbit in deep space it is not a definite point. At
     i = 0.03 deg the latitude being bisected never gets beyond a few
     hundredths of a degree, and the Moon and Sun move it by as much, so one
     node-to-node time says little about the next. Measured across this
     catalogue with the window at the regression baseline's start, 2026-09-13
     00:00 UTC, deep-space objects below 0.3 deg came out anywhere from 1307 min
     (NUSANTARA TIGA) to 1543 min (JCSAT-18) against a sidereal day of
     1436.07, and GOES 18 read 1461.4. Started at each object's own epoch
     instead, the low end is 724 min (ASTRA 2G), about half a revolution: the
     spread moves with the window, which is the point. Between 0.3 and 1 deg
     they still stray up to 1.3 min from the Keplerian period.
     A LEO orbit does not have the problem even at i = 0.23 deg (IXPE agrees
     with SGP4's own mean nodal rate to 0.001 %): J2 is symmetric about the
     equator and leaves an equatorial orbit's latitude alone, and the lunisolar
     terms that do not are applied only beyond 225 min. So there, and wherever
     the search found no two nodes at all, the period shown is Keplerian,
     2 pi sqrt(a^3/mu) from the semi-major axis on the card, on the mu that a
     was recovered with - which makes it exactly 2 pi/n'' for SGP4's value -
     and it is labelled as such. New fields only; E.period does not move.
     The two tests are kept too, because the panel's RAAN and phase notes ask
     the same question: is the node a definite point for this orbit? */
  (function(){
    const mu = E.aSource === 'sgp4' ? SGP4_MU : MU;
    const kepler = 2*Math.PI*Math.sqrt(E.a*E.a*E.a/mu);
    const deepSpace = kepler >= 225*60;
    const planeUnclear = deepSpace && Math.min(E.inc, 180-E.inc) < 1;
    const nodal = E.periodMeasured && !planeUnclear;
    E.periodShown = nodal ? E.period : kepler;
    E.periodKind  = nodal ? 'nodal' : 'keplerian';
    E.periodWhy   = nodal ? null : planeUnclear ? 'equatorial' : 'nonodes';
    E.deepSpace = deepSpace; E.planeUnclear = planeUnclear;
  })();

  /* Apsis altitudes from the propagation, not from a(1 -+ e) - Re. The mean-
     element form misses two things, each the size of 2ae itself on a near-
     circular LEO orbit. The orbit radius swings more than the mean e says,
     because SGP4's periodic terms move it: for KNACKSAT-2's README set 19.5 km
     against 2ae = 10.7, and of the difference 8.3 km is J3's long-period
     eccentricity term and under 1 km J2's short-period one. And altitude is
     measured above the WGS-84 ellipsoid, whose surface is 13 km lower at
     51.6 deg than at the equator. The mean-element form also goes NEGATIVE on
     eccentric objects: CLUSTER II-FM8 printed a perigee altitude of -142.6 km,
     below the surface.
     The radius and the surface radius under the track are kept alongside, as
     new fields, so the eccentricity card can say which of the two the swing
     is made of; so is the osculating a, which the mean a on the card is not.
     lo, hi and the sampling are exactly what they were. */
  (function(){
    let lo = Infinity, hi = -Infinity;
    let rLo = Infinity, rHi = -Infinity, sLo = Infinity, sHi = -Infinity,
        oLo = Infinity, oHi = -Infinity;
    const Re = track.body.Re, e2 = track.body.flattening*(2 - track.body.flattening);
    const P = E.period, t0 = start.getTime();
    // an eccentric orbit sweeps perigee fast; sample harder so the minimum
    // is not stepped over
    const N2 = Math.round(720 + 3000*Math.min(0.95, E.ecc));
    for(let k=0;k<=N2;k++){
      const s = fix(track, t0 + k*P*1000/N2);
      if(!s){
        // a perigee SGP4 puts underground; noted for the re-entry test below
        const ms = t0 + k*P*1000/N2;
        if(track.lastError === 6 && (groundAt === null || ms < groundAt)) groundAt = ms;
        continue;
      }
      const gd = track.body.toGeodetic(s.r, s.theta);
      const g = gd.height;
      if(g < lo) lo = g; if(g > hi) hi = g;
      const r = Math.hypot(s.r.x, s.r.y, s.r.z);
      if(r < rLo) rLo = r; if(r > rHi) rHi = r;
      // geocentric radius of the ellipsoid point the height is measured from
      const sl = Math.sin(gd.latitude), cl = Math.cos(gd.latitude);
      const Nv = Re/Math.sqrt(1 - e2*sl*sl);
      const Rs = Math.hypot(Nv*cl, Nv*(1 - e2)*sl);
      if(Rs < sLo) sLo = Rs; if(Rs > sHi) sHi = Rs;
      // the osculating a, by vis-viva, for how far it strays from the mean a
      const v2 = s.v.x*s.v.x + s.v.y*s.v.y + s.v.z*s.v.z;
      const aOsc = 1/(2/r - v2/SGP4_MU);
      if(aOsc < oLo) oLo = aOsc; if(aOsc > oHi) oHi = aOsc;
    }
    if(isFinite(lo) && isFinite(hi)){ E.perigeeAlt = lo; E.apogeeAlt = hi; E.altMeasured = true;
      E.rMin = rLo; E.rMax = rHi; E.surfMin = sLo; E.surfMax = sHi;
      E.oscAMin = oLo; E.oscAMax = oHi; }
  })();
  const passes = findPasses(track, start.getTime(), end.getTime(), passStepFor(hours));
  const totalS = passes.reduce((s,p)=>s+p.dur, 0);
  const meanAlt = pts.reduce((s,p)=>s+p.alt,0)/pts.length;
  // 5° access footprint: central angle from the observer, at mean altitude
  const eps = MASK*RAD;
  const lambda = Math.acos(BODY.Re*Math.cos(eps)/(BODY.Re+meanAlt)) - eps;
  // a long window can hold tens of thousands of samples; the flat map only needs
  // enough to draw a smooth line
  const drawStride = Math.max(1, Math.ceil(pts.length/8640));
  /* Re-entry. SGP4 has no notion that an orbit can end: handed the element set
     of an object that came down last week it goes on producing positions - at
     40 km, then at 20 - and refuses only once the radius is inside the Earth.
     Everything downstream then quotes passes, naked-eye verdicts and Doppler
     for a spacecraft that is not there. So ask the propagation how low it goes.
     Below the ~120 km entry interface an orbit does not last more than a
     revolution or two; an error 6 is SGP4 itself saying the orbit reached the
     ground. Both are read from everything propagated above: the window's own
     samples, and the densely-sampled revolution from its start, whether or not
     that revolution ends inside the window. The revolution matters on its own
     account - CLUSTER II-FM8 has a 53 h period, so a 24 h window can hold
     nothing but apogee arcs from an object whose perigee is underground. A new
     field only: nothing above reads it, so no number the gate compares can
     move. */
  let lowest = E.altMeasured ? E.perigeeAlt : Infinity;
  for(const p of pts) if(p.alt < lowest) lowest = p.alt;
  const reentry = (lowest < REENTRY_KM || groundAt !== null)
    ? {minAlt: lowest, groundAt} : null;
  /* satrec stays on the returned object because orbitviz reads SGP4's own
     fields from it; track is what everything else should use. */
  return {entry, track, satrec: track.raw, E, start, end, pts, passes, totalS,
          meanAlt, lambda, step, hours, drawStride, reentry};
}

  return {
    compute, elements, expField, stepFor, passStepFor,
    look, fix, subPoint, sample, sampleMs, elevationAt, stateAt,
    rangeRateAt, rangeRateMs, dopplerHz, C_KMS, findPasses, build,
    RAD, DEG, MU, RE, REENTRY_KM, SGP4_MU, sgp4Why, BODY, OBS, MASK
  };
}
