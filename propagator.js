/* propagator.js — everything that is a property of how an object moves.
 *
 * The app used to pass a raw SGP4 `satrec` everywhere, which meant every layer
 * that wanted a position also had to know it was talking to SGP4. That is fine
 * until you want a second central body, at which point it is fatal: SGP4 is
 * defined ONLY for Earth satellites described by TLEs. There are no TLEs for
 * lunar orbiters and there is no lunar SGP4. A different body needs a different
 * propagator, and the rest of the page should not have to care which.
 *
 * So: one interface, several implementations.
 *
 *   track.at(ms) -> {r, v} | null      body-centred inertial, km and km/s
 *
 * plus metadata the page displays but never computes with. A Track is a
 * propagator already bound to a Body, because in practice they always travel
 * together and binding them removes a whole class of mismatch.
 *
 * `r` and `v` are returned as the propagator's own objects, not copies — the
 * SGP4 path must hand satellite.js's output straight through so the downstream
 * geodetic conversion sees bit-for-bit what it saw before this file existed.
 */
(function(global){
'use strict';

/* ---- SGP4 / TLE — Earth only --------------------------------------------- */
function sgp4Track(body, entry, sat){
  let satrec = null;
  try { satrec = sat.twoline2satrec(entry.l1, entry.l2); } catch(e){ satrec = null; }

  return {
    kind: 'sgp4',
    body, entry,
    /* The escape hatch. SGP4 carries state nothing else models — the un-Kozai'd
       semi-major axis, B*, the error flag — and the elements panel legitimately
       wants it. Generic code must not reach in here; anything that does is a
       bug waiting for the second body. */
    raw: satrec,
    ok: !!satrec && !satrec.error,

    at(ms){
      if(!satrec) return null;
      let pv = null;
      try { pv = sat.propagate(satrec, new Date(ms)); } catch(e){ return null; }
      if(!pv || !pv.position || !isFinite(pv.position.x)) return null;
      return { r: pv.position, v: pv.velocity };
    },

    /* SGP4 recovers the Brouwer semi-major axis during initialisation and
       leaves it in satrec.a, normalised to WGS-72 Earth radii. The TLE's own
       mean motion is the KOZAI value, so deriving a from it double-counts J2 —
       across this catalogue that is a median 2.95 km error and up to 6.38 km.
       Hence: take SGP4's, on SGP4's radius. */
    get recoveredA(){
      return (satrec && isFinite(satrec.a) && satrec.a > 0.9)
        ? satrec.a * body.sgp4Re : null;
    }
  };
}

/* ---- classical two-body, for any central body -----------------------------
 * Osculating elements at an epoch, propagated by Kepler. This is what a lunar
 * orbiter gets, because SGP4 does not exist for the Moon and nothing else is
 * publishable as a compact element set.
 *
 * Angles in DEGREES on the way in (that is how every source quotes them),
 * radians only inside. Elements are referred to the same frame the body's
 * rotation expects — for the Moon that is ICRF equatorial, so a Horizons query
 * must carry REF_PLANE='FRAME'; its default is the ecliptic and mixing the two
 * tilts everything by the obliquity.
 */
const D2R = Math.PI/180;

/* Kepler's equation. Newton from a starting guess that is already good for
   moderate e; the fallback matters for the relay orbits, where Queqiao-2 sits
   near e = 0.78 and a naive E = M start converges slowly or not at all. */
function solveKepler(M, e){
  M = ((M % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
  let E = e < 0.8 ? M : Math.PI;
  for(let i = 0; i < 60; i++){
    const f = E - e*Math.sin(E) - M;
    const fp = 1 - e*Math.cos(E);
    const dE = f/fp;
    E -= dE;
    if(Math.abs(dE) < 1e-13) break;
  }
  return E;
}

/* elements -> {r, v} in the frame the elements are referred to */
function stateFrom(el, mu, ms){
  const a = el.a, e = el.e;
  if(!(a > 0) || !(e >= 0) || e >= 1) return null;
  const n = Math.sqrt(mu/(a*a*a));                       // rad/s
  const dt = (ms - el.epoch)/1000;
  const M = el.M*D2R + n*dt;
  const E = solveKepler(M, e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const r = a*(1 - e*cE);
  const b = Math.sqrt(1 - e*e);
  /* perifocal position and velocity, straight from E */
  const px = a*(cE - e),        py = a*b*sE;
  const f = Math.sqrt(mu*a)/r;
  const vx = -f*sE,             vy = f*b*cE;
  const i = el.i*D2R, O = el.raan*D2R, w = el.argp*D2R;
  const cO = Math.cos(O), sO = Math.sin(O),
        ci = Math.cos(i), si = Math.sin(i),
        cw = Math.cos(w), sw = Math.sin(w);
  /* Rz(-O) Rx(-i) Rz(-w) applied to the perifocal vectors */
  const R11 =  cO*cw - sO*sw*ci, R12 = -cO*sw - sO*cw*ci;
  const R21 =  sO*cw + cO*sw*ci, R22 = -sO*sw + cO*cw*ci;
  const R31 =  sw*si,            R32 =  cw*si;
  return {
    r: { x: R11*px + R12*py, y: R21*px + R22*py, z: R31*px + R32*py },
    v: { x: R11*vx + R12*vy, y: R21*vx + R22*vy, z: R31*vx + R32*vy }
  };
}

function keplerTrack(body, el, meta){
  return {
    kind: 'kepler',
    body, entry: meta || {}, raw: null, ok: !!(el && el.a > 0),
    elements: el,
    meta: meta || {},
    at(ms){ return stateFrom(el, body.mu, ms); },
    get recoveredA(){ return null; }      // an SGP4 concept; no analogue here
  };
}

/* ---- daily-anchored ephemeris ---------------------------------------------
 * The honest one, and the reason it exists is worth stating.
 *
 * A single element set is not enough for a lunar orbit. The Moon's gravity
 * field is mascon-dominated rather than J2-dominated, and the elements a
 * Keplerian propagator holds constant do not stay constant: measured from
 * Horizons, LRO's argument of periapsis moves ~3.1 deg/day and its period grows
 * ~1.7 s every four hours. Period error integrates into along-track error, so
 * within a couple of weeks a single-element-set model puts the spacecraft on
 * the wrong side of the Moon.
 *
 * Adding J2 does not rescue this — it captures nodal regression and misses the
 * mascon-driven evolution of omega and e, which is the part that hurts. The fix
 * is not a better force model, it is a fresh anchor: store one element set per
 * day and Kepler-propagate only WITHIN that day, which keeps every evaluation
 * inside the hours-long window where Kepler is genuinely honest.
 *
 * ageHours() exposes how far the requested time is from its anchor so the page
 * can show staleness rather than imply a precision it does not have.
 */
function anchoredTrack(body, sets, meta){
  const S = (sets || []).slice().sort((p,q) => p.epoch - q.epoch);
  const pick = ms => {
    if(!S.length) return null;
    let lo = 0, hi = S.length - 1;
    if(ms <= S[0].epoch) return S[0];
    if(ms >= S[hi].epoch) return S[hi];
    while(hi - lo > 1){ const m = (lo+hi)>>1; if(S[m].epoch <= ms) lo = m; else hi = m; }
    return (ms - S[lo].epoch) <= (S[hi].epoch - ms) ? S[lo] : S[hi];
  };
  return {
    kind: 'anchored',
    body, entry: meta || {}, raw: null, ok: S.length > 0,
    meta: meta || {},
    sets: S,
    span: S.length ? {from: S[0].epoch, to: S[S.length-1].epoch} : null,
    anchorAt: pick,
    /* hours from the nearest anchor; the sign says which side */
    ageHours(ms){ const p = pick(ms); return p ? (ms - p.epoch)/3600000 : null; },
    /* true once the request falls outside the stored coverage, where the
       nearest anchor is being stretched rather than interpolated */
    beyond(ms){ return !S.length || ms < S[0].epoch || ms > S[S.length-1].epoch; },
    get elements(){ return S.length ? S[0] : null; },
    at(ms){ const p = pick(ms); return p ? stateFrom(p, body.mu, ms) : null; },
    get recoveredA(){ return null; }
  };
}

global.Propagator = { sgp4Track, keplerTrack, anchoredTrack, stateFrom, solveKepler };

})(typeof window !== 'undefined' ? window : globalThis);
