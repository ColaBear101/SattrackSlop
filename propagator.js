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

global.Propagator = { sgp4Track };

})(typeof window !== 'undefined' ? window : globalThis);
