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

global.Body = { Earth };

})(typeof window !== 'undefined' ? window : globalThis);
