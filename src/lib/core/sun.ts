// @ts-nocheck - verbatim; the typed surface is Sun in ../types.ts
/* The Sun, low-precision, and where it is overhead.
 *
 * Moved VERBATIM from legacy/index.html (main@4eadd7a), lines 9258-9299: sunEci, subsolar, sunElevation. The
 * page's closure over satellite.js (for gstime) is the argument of makeSun(). The legacy comment below notes
 * that earth/orbit3d.js and earth/advisor.js carry their own copies; consolidating them to this one is a
 * recorded, bounded change (CHANGES-FROM-LEGACY.md, item 2), not made here.
 */
export function makeSun(satellite) {
  const RAD = Math.PI/180, DEG = 180/Math.PI;
// sub-solar point (NOAA low-precision solar position, good to ~0.01°)
/* The Sun, low-precision (NOAA/USNO almanac form): right ascension and
   declination good to about 0.01 deg, and the distance to about 0.02 %. That is
   several hundred times finer than anything asked of it here - a terminator
   drawn at map resolution, and a shadow test whose own hard edge is a
   simplification worth far more than 0.01 deg.

   earth/orbit3d.js carries its own copy for the directional light. That is
   deliberate: it is a standalone renderer that has to work without this page,
   and the two are used for different things. Same model, stated once here. */
function sunEci(date){
  const jd = date.getTime()/86400000 + 2440587.5;
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
function subsolar(date){
  const S = sunEci(date);
  const gmst = satellite.gstime(date)*DEG;
  let lon = S.ra*DEG - gmst; while(lon>180) lon-=360; while(lon<-180) lon+=360;
  return {lat: S.dec*DEG, lon};
}
/* Solar elevation at a surface site: the same spherical triangle the look
   angles use, with the Sun's sub-point standing in for the spacecraft's. */
function sunElevation(site, date){
  const ss = subsolar(date);
  const p = site.lat*RAD, d = ss.lat*RAD, H = (site.lon - ss.lon)*RAD;
  /* Clamped, and not defensively: with the site AT the sub-solar point the
     expression is sin^2 + cos^2, which rounds to 1.0000000000000002 and takes
     asin to NaN. That is not a corner case here - the sub-solar point crosses
     Bangkok's latitude twice a year. */
  const c = Math.sin(p)*Math.sin(d) + Math.cos(p)*Math.cos(d)*Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, c)))*DEG;
}
  return { sunEci, subsolar, sunElevation };
}
