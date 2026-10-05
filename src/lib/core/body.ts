// @ts-nocheck - verbatim; the typed surface is Body in ../types.ts
/* The central body: what is a property of the planet, not of the orbit.
 *
 * The Earth half of core/body.js, moved VERBATIM from legacy/core/body.js (main@4eadd7a), lines 30-95.
 * The Moon half stays in public/core/body.js, where the Moon pages load it as a classic script. Nothing
 * here is rewritten: EarthWGS84 DELEGATES to satellite.js (its own WGS-84 ellipsoid and IAU-1982 GMST
 * series), because any hand-rolled replacement would differ in the last bits and the gate is bit-identical.
 * A permanent test (tests/lib/core-equivalence.test.ts) compares this file with the classic one.
 */
import type * as SatelliteJs from 'satellite.js';
import type { Body } from '../types';

const RAD = Math.PI/180;

/* ---- Earth ---------------------------------------------------------------
 * `sat` is the satellite.js namespace, injected rather than imported so this
 * file stays loadable in node for the verification harness.
 */
export function Earth(sat: typeof SatelliteJs): Body {
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

    /* Rotation rate, and the site as a fixed-frame vector. Both exist for range
       rate: a ground station is NOT at rest in the inertial frame, and Bangkok
       is carried east at 0.452 km/s. That is 0.65 kHz at 435 MHz - small beside
       a spacecraft's 7.7 km/s, and far too large to drop from a Doppler figure
       quoted in kHz. In the body-fixed frame the site is genuinely stationary,
       so that is where the closing speed is taken. */
    omega: 7.292115e-5,                          // rad/s, WGS-84 sidereal
    siteFixed: site => sat.geodeticToEcf({ longitude: site.lon*RAD,
      latitude: site.lat*RAD, height: site.altKm || 0 }),

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
