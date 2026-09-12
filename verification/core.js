// Shared computation core: TLE -> elements, ground track, Bangkok access.
// Verified in node, then embedded in the page.
const MU = 398600.4418;          // km^3/s^2  (WGS-84 / EGM-96 standard gravitational parameter)
const RE = 6378.137;             // km        equatorial radius
const DEG = 180 / Math.PI;

// --- a. Extract the six Keplerian elements straight from the TLE columns -----
function parseTLE(l1, l2) {
  const epochYY = parseInt(l1.substring(18, 20), 10);
  const epochDay = parseFloat(l1.substring(20, 32));
  const year = epochYY < 57 ? 2000 + epochYY : 1900 + epochYY;
  // day-of-year (1-based, fractional) -> UTC Date
  const epoch = new Date(Date.UTC(year, 0, 1) + (epochDay - 1) * 86400000);

  const inc  = parseFloat(l2.substring( 8, 16));            // deg
  const raan = parseFloat(l2.substring(17, 25));            // deg
  const ecc  = parseFloat('0.' + l2.substring(26, 33).trim()); // implied decimal point
  const argp = parseFloat(l2.substring(34, 42));            // deg
  const ma   = parseFloat(l2.substring(43, 51));            // deg
  const n    = parseFloat(l2.substring(52, 63));            // rev/day (mean motion)
  const revNum = parseInt(l2.substring(63, 68), 10);

  const ndot  = parseFloat(l1.substring(33, 43));           // rev/day^2 /2
  const bstar = expField(l1.substring(53, 61));
  const satnum = l1.substring(2, 7).trim();
  const intl = l1.substring(9, 17).trim();
  const classification = l1.substring(7, 8);

  // Semi-major axis from the mean motion: n [rad/s], a = (mu / n^2)^(1/3)
  const nRad = n * 2 * Math.PI / 86400;
  const a = Math.cbrt(MU / (nRad * nRad));

  const period = 86400 / n;                                  // s
  const rp = a * (1 - ecc), ra = a * (1 + ecc);               // km from geocentre
  return { satnum, intl, classification, epoch, epochYear: year, epochDay,
           inc, raan, ecc, argp, ma, n, nRad, a, period, revNum, ndot, bstar,
           perigeeAlt: rp - RE, apogeeAlt: ra - RE, rp, ra };
}
// TLE exponential field e.g. " 12345-3" -> 0.12345e-3
function expField(s) {
  s = s.trim();
  if (!s || /^[+-]?0+$/.test(s)) return 0;
  const sign = s[0] === '-' ? -1 : 1;
  if (s[0] === '+' || s[0] === '-') s = s.slice(1);
  const m = s.match(/^(\d+)([+-]\d)$/);
  if (!m) return sign * parseFloat('0.' + s);
  return sign * parseFloat('0.' + m[1]) * Math.pow(10, parseInt(m[2], 10));
}
module.exports = { parseTLE, expField, MU, RE, DEG };
