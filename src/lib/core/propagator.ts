// @ts-nocheck - verbatim; the typed surface is Track in ../types.ts
/* How an object moves: the SGP4 track bound to a body.
 *
 * sgp4Track, moved VERBATIM from legacy/core/propagator.js (main@4eadd7a), lines 25-71. The Kepler and
 * daily-anchored tracks are Moon-only and stay in public/core/propagator.js. The SGP4 path hands
 * satellite.js's output straight through, so the downstream geodetic conversion sees bit-for-bit what it
 * saw before this file existed.
 */
import type * as SatelliteJs from 'satellite.js';
import type { Body, Tle, Track } from '../types';

/* ---- SGP4 / TLE — Earth only --------------------------------------------- */
export function sgp4Track(body: Body, entry: Tle, sat: typeof SatelliteJs): Track {
  let satrec = null;
  try { satrec = sat.twoline2satrec(entry.l1, entry.l2); } catch(e){ satrec = null; }
  /* Why the most recent refused request was refused. SGP4 does not fail
     quietly - it sets satrec.error and returns nothing - but at() used to turn
     that into a bare null, so a page asked to show an object SGP4 has decayed
     could say only that there were no positions, not that the orbit had reached
     the ground. The code is satellite.js's own (1-4: elements out of range,
     6: decayed); 0 means it refused without naming a reason, null that nothing
     has been refused yet. Recorded on failure only, so the success path - and
     the r and v it hands through - is exactly what it was. */
  let lastError = null;

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
      try { pv = sat.propagate(satrec, new Date(ms)); } catch(e){ lastError = 0; return null; }
      if(!pv || !pv.position || !isFinite(pv.position.x)){
        lastError = satrec.error || 0;
        return null;
      }
      return { r: pv.position, v: pv.velocity };
    },
    get lastError(){ return lastError; },

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
