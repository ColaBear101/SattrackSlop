/* noaa-sun.js - sunrise, sunset and the end of civil twilight, from the NOAA Solar Calculator's own equations.
 *
 * An independent reference for the pass list's day headers (CHANGES-FROM-LEGACY.md, L55), which take their times from the
 * page's Sun (src/lib/core/sun.ts) by a scan and a bisection. This is a different Sun and a different method: the equations
 * the NOAA Solar Calculator (NOAA Global Monitoring Laboratory, https://gml.noaa.gov/grad/solcalc/) publishes with itself
 * (calcdetails.html and the NOAA_Solar_Calculations spreadsheets, after Meeus, Astronomical Algorithms: the Sun's apparent
 * longitude, the obliquity, the equation of time, and the hour angle at a given zenith), solved in closed form for the hour
 * angle at the date's 0 h UT and then once more at the event's own time, as the calculator does. The zenith is 90.833 deg
 * for sunrise and sunset (the calculator's) and 96 deg for civil twilight (the USNO's definition; the calculator gives only
 * sunrise and sunset). It agrees with the page to seconds at Bangkok and Svalbard (tests/lib/sun-times.test.ts holds a
 * table of its values); NOAA states its own accuracy as a minute within 72 deg of the equator.
 *
 *   const { event } = require('./noaa-sun');
 *   event(true, 2026, 10, 15, 13.75, 100.52, 90.833)   // the UTC instant (ms) of that date's sunrise, or null if there is none
 *
 * The date is the one the calculator is given: the site's calendar date, read at 0 h UT of it (an event east of Greenwich
 * can fall on the UTC day before). Longitude east positive. */
'use strict';
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const cent = jd => (jd - 2451545.0) / 36525.0;
const meanLong = t => { let l = 280.46646 + t * (36000.76983 + t * 0.0003032); while (l > 360) l -= 360; while (l < 0) l += 360; return l; };
const meanAnom = t => 357.52911 + t * (35999.05029 - 0.0001537 * t);
const ecc = t => 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
const centre = t => {
  const m = rad(meanAnom(t));
  return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289;
};
const appLong = t => meanLong(t) + centre(t) - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));
const obliquity = t => 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));
const declination = t => deg(Math.asin(Math.sin(rad(obliquity(t))) * Math.sin(rad(appLong(t)))));
/** minutes */
const eqTime = t => {
  const l0 = rad(meanLong(t)), e = ecc(t), m = rad(meanAnom(t));
  let y = Math.tan(rad(obliquity(t)) / 2); y *= y;
  return 4 * deg(y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0)
    - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m));
};
/** minutes after 0 h UT of the day `jd` begins (may be negative, or past 1440), or NaN when the Sun does not reach the zenith */
function utcMinutes(rise, jd, lat, lon, zenith) {
  const t = cent(jd), dec = rad(declination(t)), phi = rad(lat);
  let ha = Math.acos(Math.cos(rad(zenith)) / (Math.cos(phi) * Math.cos(dec)) - Math.tan(phi) * Math.tan(dec));
  if (!rise) ha = -ha;
  return 720 - 4 * (lon + deg(ha)) - eqTime(t);
}
function event(rise, y, m, d, lat, lon, zenith) {
  const day = Date.UTC(y, m - 1, d), jd = day / 86400000 + 2440587.5;
  const first = utcMinutes(rise, jd, lat, lon, zenith);
  const again = utcMinutes(rise, jd + first / 1440, lat, lon, zenith);
  return Number.isFinite(again) ? day + again * 60000 : null;
}
module.exports = { event, RISE_SET_ZENITH: 90.833, CIVIL_ZENITH: 96 };
