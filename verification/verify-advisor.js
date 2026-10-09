/*
 * The Professor's numbers, checked against SGP4 and against a second Sun: earth/advisor.js.
 *
 * advisor.js turns a set of mean elements into the dictionary the catalogue (advisor-copy.js)
 * reads, and into a lifetime. Every number in it is only worth printing if something that
 * is not advisor.js agrees, so nothing here compares the advisor with itself:
 *
 *  - SGP4 (satellite.js 6.0.1, verification/satellite.min.js) is flown for the node crossing
 *    that LTAN predicts, the eclipse that the shadow formula predicts (with a cone test and a
 *    second, Meeus, Sun that this file carries), the repeat of a ground track, a geostationary
 *    satellite's look angle and drift, the critical inclination, the speed at perigee and
 *    apogee, the decay of a satellite whose B* was matched, the pass times over Bangkok.
 *  - The Sun in advisor.js is index.html's sunEci. Its source is read out of index.html and run
 *    on 500 dates beside advisor.js's copy (they must agree to the last bit), and both are held
 *    to 0.02 degrees of a Meeus implementation written in this file.
 *  - The drag integral is held to a 32,768-node reference written here; the lifetime to an
 *    SI-units time march with its own step control (Lifetime.integrate marches in altitude).
 *  - Real element sets (Landsat 8, Sentinel-2A, TerraSAR-X, ISS, ... from verification/catalog.txt)
 *    must give the numbers their missions publish.
 *  - Then the catalogue is run on the REAL dictionary: advisor-copy-checks.js is called with this
 *    advisor's context, so its 50 orbits, 851-orbit kind grid and 400 seeded forms run on real
 *    kernels; and this file adds the orbits it cannot know about (the Check/Note branches of
 *    kind.heo.drift and sgp4.retro, each input message, the eleven presets of Appendix A, 300
 *    seeded forms through Planner.fromForm, the 782-orbit grid of the kind scan).
 *
 * Why each group exists is a number that was measured or a defect that would otherwise have
 * shipped. Each has a mutation (SPEC 7.7) that makes one named check here fail.
 *
 *   node verification/verify-advisor.js
 *   ADVISOR_JS=/abs/path/to/advisor.js node verification/verify-advisor.js        (a mutant)
 *   ADVISOR_COPY_JS=/abs/path/to/advisor-copy.js node verification/verify-advisor.js   (a mutant of the words)
 *
 * The env overrides exist so a deliberately broken copy can be run against this suite without
 * touching earth/*.js: a check that cannot fail is not a check.
 *
 * No page and no browser: node and satellite.js only. Ends ALL CHECKS PASS.
 */
'use strict';
const H = require('./lib/harness');
const path = require('path');
const fs = require('fs');

require(H.earthFile('lifetime'));
require(H.earthFile('planner'));
const CC = require('./advisor-copy-checks.js');           // loads the real earth/advisor-copy.js
const ADVISOR_JS = process.env.ADVISOR_JS ? path.resolve(process.env.ADVISOR_JS) : H.earthFile('advisor');
require(ADVISOR_JS);
if (process.env.ADVISOR_COPY_JS) require(path.resolve(process.env.ADVISOR_COPY_JS));      // after CC, so it replaces the real words
const sat = require('./satellite.min.js');
const P = globalThis.Planner, A = globalThis.Advisor, AC = globalThis.AdvisorCopy, L = globalThis.Lifetime;
const K = A.kernels;

let fails = 0, total = 0;
const chk = (name, ok, detail) => {
  total++;
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok && process.env.ADVISOR_BAIL) process.exit(1);          // a mutant run needs only the first check that dies
};
const near = (name, got, want, tol, note) =>
  chk(name, Math.abs(got - want) <= tol, 'got ' + got + ' want ' + want + ' +-' + tol + (note ? ' ' + note : ''));
/* a group of checks that throws is one failed check, named for the group, not a crash */
const group = (id, fn) => {
  console.log('\n' + id);
  const t0 = Date.now();
  try { fn(); } catch (e) { chk(id + ': ran to the end', false, 'threw ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
  console.log('  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
};
function rng(seed) {                                    // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const RE = 6378.137, RE72 = 6378.135, MU72 = 398600.8, MU_SI = 3.986004418e14;
const D2R = Math.PI / 180, R2D = 180 / Math.PI, PERDAY = 1440 * R2D;
const EP = Date.UTC(2026, 9, 1, 12);
const BKK = { name: 'Bangkok', lat: 13.75, lon: 100.52, altKm: 0, tz: 7 };
const wrap360 = x => ((x % 360) + 360) % 360;
const wrap180 = x => ((x % 360) + 540) % 360 - 180;
const angDiff = (x, y) => Math.abs(wrap180(x - y));
/* Wall-clock milliseconds. The budgets are statements about work, and another job on the machine can double a timing (CPU time is no better here: Windows counts it in 15.6 ms ticks and the JIT and the collector run on other threads), so the cost group times each call twice and keeps the faster, and the guard against a slow march is a COUNT of drag integrals, which no load can change. */
const cpuMs = () => Number(process.hrtime.bigint()) / 1e6;
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const elOf = (a, e, i, o) => Object.assign({ a, e, i, raan: 30, argp: 0, M: 0, epoch: EP, am: 0.0043, bstar: 0 }, o || {});
const elHH = (hp, ha, i, o) => { const rp = RE + hp, ra = RE + ha; return elOf((rp + ra) / 2, (ra - rp) / (ra + rp), i, o); };
const baseEnv = o => Object.assign({ nowMs: EP, site: BKK, maskDeg: 5, window: { startMs: EP, hours: 24 }, measured: null, tracked: false, sat }, o || {});
const ctx = (el, o) => A.context(el, baseEnv(o));
/* SGP4 on a synthesised TLE (the planner is only the TLE writer here; verify-planner.js is its judge) */
const mkSat = el => { const t = P.toTLE(Object.assign({ am: null, bstar: 0 }, el), '99901'); return sat.twoline2satrec(t.l1, t.l2); };
const pvAt = (s, ms) => sat.propagate(s, new Date(ms));
const geod = (pv, ms) => sat.eciToGeodetic(pv.position, sat.gstime(new Date(ms)));
const lonAt = (s, ms) => geod(pvAt(s, ms), ms).longitude * R2D;
const latAt = (s, ms) => geod(pvAt(s, ms), ms).latitude;
/* first northbound crossing of the equator after startMs (sub-satellite latitude) */
function nodeAfter(s, startMs, step) {
  const st = step || 20000;
  let prev = latAt(s, startMs), t = startMs;
  for (let k = 0; k < 20000; k++) {
    const tn = t + st, c = latAt(s, tn);
    if (prev < 0 && c >= 0) { let lo = t, hi = tn; for (let j = 0; j < 40; j++) { const m = (lo + hi) / 2; if (latAt(s, m) < 0) lo = m; else hi = m; } return (lo + hi) / 2; }
    prev = c; t = tn;
  }
  return null;
}
const mlstAt = (s, ms) => {                              // mean local solar time at the sub-satellite point, hours
  const d = new Date(ms), ut = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + d.getUTCMilliseconds() / 3.6e6;
  return (((ut + lonAt(s, ms) / 15) % 24) + 24) % 24;
};

/* ---- Meeus's low-accuracy Sun (chapter 25), written here: a second implementation of the Sun ---- */
function meeusSun(ms) {
  const jd = ms / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = wrap360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = wrap360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const C = (1.914602 - 0.004817 * T) * Math.sin(M * D2R) + 0.019993 * Math.sin(2 * M * D2R) + 0.000289 * Math.sin(3 * M * D2R);
  const lam = (L0 + C) * D2R, eps = (23.439291 - 0.0130042 * T) * D2R;
  const ra = wrap360(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * R2D), dec = Math.asin(Math.sin(eps) * Math.sin(lam)) * R2D;
  const ecc = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T, nu = (M + C) * D2R;
  const au = 1.000001018 * (1 - ecc * ecc) / (1 + ecc * Math.cos(nu));
  const d = dec * D2R, r = ra * D2R;
  return { ra, dec, distKm: au * 149597870.7, x: Math.cos(d) * Math.cos(r), y: Math.cos(d) * Math.sin(r), z: Math.sin(d) };
}
/* fraction of N SGP4 samples spread over periodMs from `when` that are in the conical umbra (the page's own test:
   behind the Earth and closer to the axis than RE - behind * tan(umbra half-angle)), with the Meeus Sun */
function umbraFraction(s, when, periodMs, N) {
  let um = 0, tot = 0, longest = 0, run = 0; const flags = [];
  for (let k = 0; k < N; k++) {
    const ms = when + k * periodMs / N, pv = pvAt(s, ms);
    if (!pv || !pv.position) { flags.push(false); continue; }
    const r = pv.position, S = meeusSun(ms), along = r.x * S.x + r.y * S.y + r.z * S.z;
    let inU = false;
    if (along < 0) {
      const px = r.x - along * S.x, py = r.y - along * S.y, pz = r.z - along * S.z, off = Math.hypot(px, py, pz);
      inU = off < RE - (-along) * (696000 - RE) / S.distKm;
    }
    flags.push(inU); tot++; if (inU) um++;
  }
  for (let k = 0; k < 2 * N; k++) { if (flags[k % N]) { run++; longest = Math.max(longest, Math.min(run, N)); } else run = 0; }
  return { frac: um / tot, longestFrac: longest / N };
}

/* the catalogue */
const catLines = fs.readFileSync(path.join(__dirname, 'catalog.txt'), 'utf8').split(/\r?\n/).filter(x => x.length);
const CAT = [];
for (let k = 0; k + 2 < catLines.length; k += 3) CAT.push({ name: catLines[k].trim(), l1: catLines[k + 1], l2: catLines[k + 2] });
const real = name => { const e = CAT.find(x => x.name === name); if (!e) throw new Error('catalogue has no ' + name); return e; };
const realEl = e => P.elementsFromTLE(e.l1, e.l2, sat);
const ISS = real('ISS (ZARYA)'), LANDSAT = real('LANDSAT 8'), S2A = real('SENTINEL-2A'), TSX = real('TERRA SAR X');

/* ======================================================================================= */
group('A0 the Sun: advisor.js carries index.html\'s sunEci, and a second Sun agrees with it', () => {
  const R = rng(7); let wRa = 0, wDec = 0, wDist = 0;
  const dates = [];
  for (let k = 0; k < 500; k++) dates.push(Date.UTC(2000, 0, 1) + R() * (Date.UTC(2056, 11, 31) - Date.UTC(2000, 0, 1)));
  for (const ms of dates) {
    const s = A.sunEci(new Date(ms)), m = meeusSun(ms);
    wRa = Math.max(wRa, angDiff(s.ra * R2D, m.ra)); wDec = Math.max(wDec, Math.abs(s.dec * R2D - m.dec)); wDist = Math.max(wDist, Math.abs(s.distKm / m.distKm - 1));
  }
  chk('A0 sunEci agrees with an independent Meeus Sun to 0.02 deg in RA and in Dec on 500 random dates 2000-2056', wRa <= 0.02 && wDec <= 0.02, 'worst RA ' + wRa.toFixed(4) + ' Dec ' + wDec.toFixed(4) + ' deg');
  chk('A0 ... and the distance to 0.1 %', wDist <= 1e-3, 'worst ' + wDist.toExponential(2));
  const s0 = A.sunEci(new Date(EP));
  chk('A0 sunEci returns {ra, dec, distKm, x, y, z}, a unit vector, from a Date or from milliseconds alike',
    JSON.stringify(Object.keys(s0)) === '["ra","dec","distKm","x","y","z"]' && Math.abs(Math.hypot(s0.x, s0.y, s0.z) - 1) < 1e-12 && JSON.stringify(A.sunEci(EP)) === JSON.stringify(s0) && JSON.stringify(K.sunEci(EP)) === JSON.stringify(s0));
  /* byte for byte, in two ways. The old page's function was run once over these 500 dates and the outputs hashed (SUN_GOLDEN: made from
     `git show legacy-earth-console:index.html`, never from this code), so no checkout of the old page is needed to hold the Sun to it... */
  const SUN_GOLDEN = '63358177a8f22ae5f581295a144d87350eb60b60a3d8189a9dc92ed8ad704c42';
  const here = dates.map(ms => JSON.stringify(A.sunEci(new Date(ms)))).join('\n');
  chk('A0 Advisor.sunEci equals the old index.html\'s sunEci, to the last bit, on all 500 dates (the outputs hash to what the old function made)', require('crypto').createHash('sha256').update(here).digest('hex') === SUN_GOLDEN);
  /* ...and, where the old page is checked out as legacy/, its function is also read out of index.html and run beside ours */
  const oldHtml = path.join(H.TARGETS.legacy, 'index.html');
  const html = fs.existsSync(oldHtml) ? fs.readFileSync(oldHtml, 'utf8') : '';
  const m = html ? /function sunEci\(date\)\{[\s\S]*?\n\}/.exec(html) : null;
  if (html) chk('A0 index.html still has a function sunEci(date) to compare with', !!m);
  if (m) {
    const ref = new Function('RAD', 'DEG', m[0] + '\nreturn sunEci;')(Math.PI / 180, 180 / Math.PI);
    let diff = 0;
    for (const ms of dates) if (JSON.stringify(ref(new Date(ms))) !== JSON.stringify(A.sunEci(new Date(ms)))) diff++;
    chk('A0 index.html\'s own sunEci, run here, equals Advisor.sunEci on all 500 dates to the last bit', diff === 0, diff + ' dates differ');
  }
});

group('A1 LTAN against the SGP4 node crossing (mean solar time = UTC + longitude/15)', () => {
  const cases = [['SSO 600 RAAN 123.4', 600, 0, 123.4, Date.UTC(2026, 9, 1, 0), 'sso'], ['SSO 800 e 0.001 RAAN 300', 800, 0.001, 300, Date.UTC(2027, 0, 10, 6), 'sso'],
    ['SSO 500 RAAN 10', 500, 0, 10, Date.UTC(2026, 5, 21, 12), 'sso'], ['SSO 700 e 0.02 RAAN 200', 700, 0.02, 200, Date.UTC(2027, 2, 20, 18), 'sso'],
    ['ISS-like 420 e 0.0005', 420, 0.0005, 250, Date.UTC(2026, 9, 1), 51.64]];
  for (const [name, h, e, raan, when, tilt] of cases) {
    const a = RE + h, inc = tilt === 'sso' ? +P.ssoInclination(a, e).toFixed(4) : tilt;
    const el = elOf(a, e, inc, { raan, epoch: when, M: 200 }), c = A.context(el, baseEnv()), s = mkSat(el);
    const out = []; let worst = 0;
    for (const dd of [0, 3, 30, 90]) {
      const tn = nodeAfter(s, when + dd * 86400000);
      const raanAtNode = raan + c.node * (tn - when) / 86400000;
      const f = K.ltan(raanAtNode, tn), meas = mlstAt(s, tn), dmin = (wrap180((f - meas) * 15) / 15) * 60;
      worst = Math.max(worst, Math.abs(dmin)); out.push('+' + dd + 'd ' + dmin.toFixed(3));
    }
    chk('A1 LTAN ' + name + ': formula minus SGP4 node crossing at +0, +3, +30, +90 d within 0.05 min', worst <= 0.05, out.join(' | '));
    chk('A1 LTAN ' + name + ': the dictionary\'s ltan is the formula at the epoch and ltdn is 12 h on', Math.abs(c.ltan - P.ltanFromRaan(raan, when)) < 1e-12 && Math.abs(((c.ltdn - c.ltan) % 24 + 24) % 24 - 12) < 1e-12);
  }
  /* 0.1 degrees off sun-synchronous: the local time slides 0.050 min a day (0.31 h a year) and SGP4 agrees */
  const a = RE + 600, iOff = +(P.ssoInclination(a, 0) + 0.1).toFixed(4), when = Date.UTC(2026, 9, 1);
  const el = elOf(a, 0, iOff, { raan: 123.4, epoch: when, M: 200 }), c = A.context(el, baseEnv()), s = mkSat(el);
  const t0 = nodeAfter(s, when), t1 = nodeAfter(s, when + 90 * 86400000);
  const meas = wrap180((mlstAt(s, t1) - mlstAt(s, t0)) * 15) / 15 * 60 / ((t1 - t0) / 86400000);
  near('A1 LTAN drift 0.1 degrees off sun-synchronous: ltan_drift (min/day) equals the SGP4 drift over 90 days', c.ltan_drift, meas, 0.004, 'predicted ' + c.ltan_drift.toFixed(4) + ' measured ' + meas.toFixed(4));
  chk('A1 LTAN drift: 0.05 min/day = 0.31 h/yr, later (the node is faster than the Sun), ltan_drift_abs and ltan_drift_year consistent',
    Math.abs(c.ltan_drift - 0.050) < 0.005 && c.ltan_dir === 'later' && Math.abs(c.ltan_drift_year - 0.31) < 0.03 && c.ltan_drift_abs === Math.abs(c.ltan_drift) && Math.abs(c.ltan_drift_year - c.ltan_drift * 365 / 60) < 1e-12);
  /* the daytime node: whichever of LTAN and LTDN is in [06:00, 18:00), and the night one is 12 h on */
  const dn = h => { const x = ctx(elOf(RE + 700, 0, 98.2, { raan: P.raanFromLtan(h, EP) })); return [x.ltan_day, x.ltan_night]; };
  chk('A1 ltan_day is the node in [06:00, 18:00) (LTAN 6.5 -> 6.5, 5.9 -> 17.9, 18.0 -> 6.0, 18.5 -> 6.5, 6.0 -> 6.0, 17.9 -> 17.9) and ltan_night is 12 h from it',
    [[6.5, 6.5], [5.9, 17.9], [18.0, 6.0], [18.5, 6.5], [6.0, 6.0], [17.9, 17.9], [0.2, 12.2], [12.0, 12.0]].every(([h, want]) => { const [d, n] = dn(h); return Math.abs(d - want) < 1e-6 && Math.abs(((n - d) % 24 + 24) % 24 - 12) < 1e-9; }));
  const slow = A.context(elOf(RE + 420, 0.0005, 51.64), baseEnv());
  chk('A1 LTAN drift direction: an ISS-like node (-4.9 deg/day) is slower than the Sun, so the crossing time goes earlier', slow.ltan_dir === 'earlier' && slow.ltan_drift < 0);
});

group('A1 beta angle and eclipse against SGP4, a cone test and the second Sun', () => {
  near('A1 V11 beta(RAAN 100, i 51.64, 2026-03-20 12Z) = 50.489', K.betaDeg(100, 51.64, Date.UTC(2026, 2, 20, 12)), 50.489, 0.01);
  near('A1 V11 beta(RAAN 100, i 51.64, 2026-06-21 12Z) = 21.705', K.betaDeg(100, 51.64, Date.UTC(2026, 5, 21, 12)), 21.705, 0.01);
  /* beta from SGP4's own mean node and tilt at the date, with the second Sun, against the kernel's yearly series */
  let worst = 0, n = 0;
  for (const [h, e, inc, raan] of [[420, 0.0005, 51.64, 100], [600, 0, 97.8123, 40], [800, 0, 90, 200], [500, 0, 28.5, 300]]) {
    const el = elOf(RE + h, e, inc, { raan, epoch: EP }), s = mkSat(el), c = A.context(el, baseEnv());
    const series = K.betaSeries(raan, inc, c.node, EP, 365);
    for (const d of [0, 30, 90, 180, 270, 330, 364]) {
      const ms = EP + d * 86400000, me = pvAt(s, ms).meanElements, Om = me.Om, i = me.im, S = meeusSun(ms);
      const bs = Math.asin(S.x * Math.sin(i) * Math.sin(Om) - S.y * Math.sin(i) * Math.cos(Om) + S.z * Math.cos(i)) * R2D;
      worst = Math.max(worst, Math.abs(series[d] - bs)); n++;
    }
  }
  chk('A1 beta: the yearly series (node at SGP4\'s rate, Sun by sunEci) is within 0.15 deg of beta from SGP4\'s own mean node and tilt with the Meeus Sun, ' + n + ' dates', worst <= 0.15, 'worst ' + worst.toFixed(3) + ' deg');
  const rI = K.betaRange(100, 51.64, P.rates(RE + 420, 0.0005, 51.64).nodedot, EP, 365.25, 0.25);
  chk('A1 beta: |beta| never exceeds i + 23.44 and an ISS-like year runs about -73.4 .. 74.8 (bound 75.08)', rI.maxAbs <= 51.64 + 23.44 + 0.05 && Math.abs(rI.min + 73.4) < 1.2 && Math.abs(rI.max - 74.8) < 1.2, JSON.stringify(rI));
  const a6 = RE + 600, i6 = P.ssoInclination(a6, 0), nd6 = P.rates(a6, 0, i6).nodedot, raan6 = P.raanFromLtan(6, Date.UTC(2026, 9, 1));
  const r6 = K.betaRange(raan6, i6, nd6, Date.UTC(2026, 9, 1), 365.25, 1);
  let free = 0, nn = 0; for (let d = 0; d <= 365; d++) { const b = K.betaDeg(raan6 + nd6 * d, i6, Date.UTC(2026, 9, 1) + d * 86400000); if (K.eclipseFrac(a6, b) === 0) free++; nn++; }
  chk('A1 V11 dawn-dusk SSO 600 km (LTAN 06:00): beta -89.9 .. -58.8, eclipse-free on 274 of 366 days (beta* 66.07)', Math.abs(r6.min + 89.9) < 0.3 && Math.abs(r6.max + 58.8) < 0.3 && free === 274 && nn === 366 && Math.abs(K.betaCritDeg(a6) - 66.07) < 0.01,
    'beta ' + r6.min.toFixed(1) + '..' + r6.max.toFixed(1) + ', ' + free + ' of ' + nn);
  /* the circular formula */
  near('A1 V11 beta* at r 6878.137 km = 68.0187 deg', K.betaCritDeg(6878.137), 68.0187, 2e-4);
  near('A1 V11 eclipse share at beta 0 = 0.377882 (35.754 min of 94.6163)', K.eclipseFrac(6878.137, 0), 0.377882, 2e-6);
  near('A1 V11 ... at beta 50 = 0.302147', K.eclipseFrac(6878.137, 50), 0.302147, 2e-6);
  chk('A1 V11 ... zero at and beyond beta*, and the sign of beta does not matter; no orbit under the Earth\'s radius', K.eclipseFrac(6878.137, 68.02) === 0 && K.eclipseFrac(6878.137, -50) === K.eclipseFrac(6878.137, 50) && Number.isNaN(K.eclipseFrac(6000, 0)));
  near('A1 V11 ... in minutes: 35.754 of 94.6163', K.eclipseFrac(6878.137, 0) * P.periodMin(6878.137), 35.754, 0.005);

  /* 35 cases: seven circular orbits x five dates, one revolution of SGP4 and the page's cone test */
  const dates = [Date.UTC(2026, 2, 20, 12), Date.UTC(2026, 5, 21, 12), Date.UTC(2026, 8, 22, 12), Date.UTC(2026, 11, 21, 12), Date.UTC(2026, 9, 1, 0)];
  const orbits = [['ISS 420 km i 51.64', RE + 420, 51.64, 100], ['SSO 600 km RAAN 40', RE + 600, 97.8123, 40], ['SSO 600 km RAAN 130', RE + 600, 97.8123, 130], ['equatorial 500 km', RE + 500, 0, 0],
    ['polar 800 km', RE + 800, 90, 200], ['GPS 26560 km i 55', 26560, 55, 60], ['GEO i 0', 42164.18, 0, 0]];
  let lo = 9, hi = -9, nearCrit = 0, cases = 0, outside = [];
  for (const [name, a, inc, raan] of orbits) for (const when of dates) {
    const el = elOf(a, 0, inc, { raan, epoch: when }), s = mkSat(el), per = P.periodMin(a) * 60000;
    const m = umbraFraction(s, when, per, 3000), beta = K.betaDeg(raan, inc, when), f = K.eclipseFrac(a, beta);
    const d = 100 * (m.frac - f), crit = Math.abs(beta) > 0.9 * K.betaCritDeg(a) && f > 0;
    cases++; if (crit) nearCrit++;
    if (!crit) { lo = Math.min(lo, d); hi = Math.max(hi, d); if (d < -0.5 || d > 0.2) outside.push(name + ' ' + new Date(when).toISOString().slice(0, 10) + ' ' + d.toFixed(2)); }
    else if (d < -1.2 || d > 0.2) outside.push('NEAR beta* ' + name + ' ' + d.toFixed(2));
  }
  chk('A1 eclipse: the circular formula against SGP4 plus a cone test and the Meeus Sun, ' + cases + ' cases: between -0.5 and +0.2 points (measured ' + lo.toFixed(2) + ' .. ' + hi.toFixed(2) + '), worst -1.2 near beta* (' + nearCrit + ' such cases)',
    cases === 35 && outside.length === 0, outside.join('; '));
  /* eccentric: the numeric kernel, 5 orbits x 3 dates */
  const ecc = [['GTO 250 x 35786 i 28.5', (2 * RE + 250 + 35786) / 2, (35786 - 250) / (2 * RE + 250 + 35786), 28.5, 30, 180], ['Molniya i 63.43', 26562, 0.74, 63.4349, 100, 270], ['Tundra e 0.3', 42164.18, 0.3, 63.4349, 100, 270],
    ['LEO e 0.05 perigee 500', (RE + 500) / 0.95, 0.05, 51.6, 40, 90], ['HEO 500 x 8000 i 60', (2 * RE + 500 + 8000) / 2, 7500 / (2 * RE + 8500), 60, 200, 270]];
  const dates3 = [Date.UTC(2026, 2, 20, 12), Date.UTC(2026, 9, 1, 0), Date.UTC(2026, 11, 21, 12)];
  let wf = 0, wm = 0, nEcc = 0, anyShadow = 0;
  for (const [name, a, e, inc, raan, argp] of ecc) for (const when of dates3) {
    const el = elOf(a, e, inc, { raan, argp, epoch: when }), s = mkSat(el), pa = 2 * Math.PI / s.mdot * 60000;
    const m = umbraFraction(s, when, pa, 6000), f = K.eclipseNumeric(a, e, inc, raan, argp, when);
    wf = Math.max(wf, Math.abs(f.fraction - m.frac) * 100); wm = Math.max(wm, Math.abs(f.maxMinutes - m.longestFrac * pa / 60000)); nEcc++; if (f.fraction > 0) anyShadow++;
  }
  chk('A1 eclipseNumeric (1,440 samples uniform in M) against SGP4 plus the cone test on ' + nEcc + ' cases: within 0.3 points of the orbit and 1.5 min', nEcc === 15 && wf <= 0.3 && wm <= 1.5, 'worst ' + wf.toFixed(3) + ' pt, ' + wm.toFixed(2) + ' min; ' + anyShadow + ' cases have a shadow');
});

group('A1 eclipseYear (0.005 <= e < 0.05): a sampled year, against a 1,440-sample brute force', () => {
  /* the reference: Kepler solve and the full rotation matrix per sample, the node and perigee moved at the SATREC's own rates */
  function refYear(el, N) {
    const s = mkSat(el), nd = s.nodedot * PERDAY, wd = s.argpdot * PERDAY, a = el.a, e = el.e, b = Math.sqrt(1 - e * e), i = el.i * D2R;
    const px = [], py = [];
    for (let k = 0; k < N; k++) {
      const M = 2 * Math.PI * k / N; let E = M + e * Math.sin(M);
      for (let it = 0; it < 60; it++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-13) break; }
      px.push(a * (Math.cos(E) - e)); py.push(a * b * Math.sin(E));
    }
    let free = 0, mx = 0;
    for (let d = 0; d < 365; d++) {
      const S = A.sunEci(el.epoch + d * 86400000), O = (el.raan + nd * d) * D2R, w = (el.argp + wd * d) * D2R;
      const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
      const R11 = cO * cw - sO * sw * ci, R12 = -cO * sw - sO * cw * ci, R21 = sO * cw + cO * sw * ci, R22 = -sO * sw + cO * cw * ci, R31 = sw * si, R32 = cw * si;
      let inS = 0;
      for (let k = 0; k < N; k++) {
        const x = R11 * px[k] + R12 * py[k], y = R21 * px[k] + R22 * py[k], z = R31 * px[k] + R32 * py[k], al = x * S.x + y * S.y + z * S.z;
        if (al < 0) { const qx = x - al * S.x, qy = y - al * S.y, qz = z - al * S.z; if (qx * qx + qy * qy + qz * qz < RE * RE) inS++; }
      }
      const f = inS / N; if (f === 0) free++; if (f > mx) mx = f;
    }
    return { free, maxMin: mx * P.periodMin(a) };
  }
  const raanForLtan = (h, ms) => P.raanFromLtan(h, ms);
  const cases = [[1000, 0.04, 6, 90], [1000, 0.04, 6, 270], [700, 0.049, 6, 90], [700, 0.049, 6, 270], [700, 0.01, 6, 90], [700, 0.01, 6, 270], [600, 0.02, 10.5, 90], [600, 0.005, 10.5, 270]];
  let eq = 0, worstMin = 0, worstMs = 0; const rows = [];
  for (const [h, e, ltanH, w0] of cases) {
    const a = RE + h, inc = P.ssoInclination(a, e), el = elOf(a, e, inc, { raan: raanForLtan(ltanH, EP), argp: w0 });
    const t0 = cpuMs(); const y = K.eclipseYear(el, {}); const ms = cpuMs() - t0;
    const r = refYear(el, 1440);
    const my = y.maxFrac * P.periodMin(a);
    if (y.free === r.free) eq++;
    worstMin = Math.max(worstMin, Math.abs(my - r.maxMin)); worstMs = Math.max(worstMs, ms);
    rows.push(h + '/' + e + '/w' + w0 + ': ' + y.free + ' vs ' + r.free + ', ' + my.toFixed(1) + ' vs ' + r.maxMin.toFixed(1) + ' min');
  }
  chk('A1 eclipseYear: eclipse-free days equal to a 1,440-sample brute force on all ' + cases.length + ' cases', eq === cases.length, rows.join(' | '));
  chk('A1 eclipseYear: the longest eclipse within 0.5 min of the brute force on all ' + cases.length + ' cases', worstMin <= 0.5, 'worst ' + worstMin.toFixed(2) + ' min');
  chk('A1 eclipseYear: a year in under 40 ms', worstMs < 40, 'slowest ' + worstMs.toFixed(2) + ' ms');
  /* the circular formula's miss at 1000 km, e 0.04, LTAN 06:00 is asserted, so the switch cannot be reverted silently */
  for (const [w0, want] of [[90, 329], [270, 300]]) {
    const a = RE + 1000, inc = P.ssoInclination(a, 0.04), el = elOf(a, 0.04, inc, { raan: raanForLtan(6, EP), argp: w0 });
    const c = A.context(el, baseEnv({ window: null }));
    const ref = refYear(el, 1440);
    const bs = K.betaSeries(el.raan, inc, c.node, EP, 365); let circ = 0; for (let d = 0; d < 365; d++) if (K.eclipseFrac(a, bs[d]) === 0) circ++;
    chk('A1 eclipseYear: 1000 km, e 0.04, LTAN 06:00, argp ' + w0 + ': the dictionary says ' + c.free_days + ' eclipse-free days (brute force ' + ref.free + ', about ' + want + '); the circular formula would say ' + circ,
      c.free_days === ref.free && Math.abs(c.free_days - want) <= 3 && Math.abs(circ - 310) <= 3 && Math.abs(c.free_days - circ) >= 5, 'dictionary ' + c.free_days + ', circular ' + circ);
  }
  /* the three regimes of the sun keys, and where the first two meet: below e = 0.005 the circular formula and the sampled year
     agree within a day (the design's claim, measured here on the same orbit), so the switch at 0.005 has no step in it */
  const sun = e => { const a = RE + 700, inc = P.ssoInclination(a, e); return A.context(elOf(a, e, inc, { raan: raanForLtan(6, EP) }), baseEnv({ window: null })); };
  const cHigh = sun(0.06);
  const cLow = sun(0.0), cMid = sun(0.01);
  chk('A1 the sun keys: none from e 0.05 on (the sun items stay silent), all of them below it',
    ['free_days', 'ecl_max_min', 'ecl_max_pct', 'ecl_txt', 'cycles', 'beta_min', 'beta_max', 'beta_min_abs', 'beta_crit'].every(k => cHigh[k] === undefined && cMid[k] !== undefined && cLow[k] !== undefined));
  let worstGap = 0, worstLow = 0; const gaps = [];
  for (const e of [0.001, 0.003, 0.0049]) {
    const a = RE + 700, inc = P.ssoInclination(a, e), el = elOf(a, e, inc, { raan: raanForLtan(6, EP) });
    const circ = A.context(el, baseEnv({ window: null })).free_days, num = K.eclipseYear(el, {}).free;
    worstGap = Math.max(worstGap, Math.abs(circ - num)); if (e <= 0.003) worstLow = Math.max(worstLow, Math.abs(circ - num)); gaps.push('e ' + e + ': ' + circ + ' vs ' + num);
  }
  /* measured, and not as the design says: "the two agree within 1 day below e = 0.005" holds to e = 0.003; at 0.0049 the radius
     varies by +-36 km, which moves the critical beta by 0.6 degrees and the dawn-dusk free days by three */
  chk('A1 the circular formula and the sampled year agree within a day up to e = 0.003, and within three days at the switch (e 0.0049)', worstLow <= 1 && worstGap <= 3, gaps.join(' | '));
  chk('A1 the dictionary switches at e = 0.005: just below it the circular count, at it the sampled year (the step is at most 4 days)', (() => {
    const a = RE + 1000, e1 = 0.00499, e2 = 0.005, mk = e => elOf(a, e, P.ssoInclination(a, e), { raan: raanForLtan(6, EP), argp: 270 });
    const c1 = A.context(mk(e1), baseEnv({ window: null })), c2 = A.context(mk(e2), baseEnv({ window: null }));
    const bs = K.betaSeries(c1.raan, c1.inc, c1.node, EP, 365); let circ = 0; for (let d = 0; d < 365; d++) if (K.eclipseFrac(a, bs[d]) === 0) circ++;
    return c1.free_days === circ && c2.free_days === K.eclipseYear(mk(e2), {}).free && Math.abs(c1.free_days - c2.free_days) <= 4;
  })());
});

group('A1 coverage geometry: lambda, the footprint, the equatorial threshold (SGP4 look angles and a bisection)', () => {
  for (const [h, lam, km] of [[300, 12.9282, 1439.2], [500, 17.5153, 1949.8], [800, 22.7276, 2530.0], [2000, 35.6778, 3971.6], [35786, 76.3329, 8497.3]]) {
    near('A1 V12 lambda(' + h + ' km, 5 deg mask) = ' + lam, K.accessAngleDeg(RE + h, 5), lam, 1e-3);
    near('A1 V12 ... footprint radius ' + km + ' km', K.accessAngleDeg(RE + h, 5) * D2R * RE, km, 0.2);
    /* SGP4's own look-angle code: a satellite exactly lambda away (spherical) is at the mask, in four bearings */
    const L1 = K.accessAngleDeg(RE + h, 5), site = { latitude: BKK.lat * D2R, longitude: BKK.lon * D2R, height: 0 };
    const gc = Math.atan((1 - 1 / 298.257223563) ** 2 * Math.tan(site.latitude)), out = [];
    for (const brg of [0, 90, 180, 270]) {
      const b = brg * D2R, d = L1 * D2R, p2 = Math.asin(Math.sin(gc) * Math.cos(d) + Math.cos(gc) * Math.sin(d) * Math.cos(b));
      const l2 = site.longitude + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(gc), Math.cos(d) - Math.sin(gc) * Math.sin(p2)), r = RE + h;
      out.push(sat.ecfToLookAngles(site, { x: r * Math.cos(p2) * Math.cos(l2), y: r * Math.cos(p2) * Math.sin(l2), z: r * Math.sin(p2) }).elevation * R2D);
    }
    chk('A1 V12 satellite.js puts a satellite lambda(' + h + ' km) away at 5 degrees elevation in all four bearings (within 0.2)', out.every(v => Math.abs(v - 5) <= 0.2), out.map(v => v.toFixed(2)).join(' '));
  }
  near('A1 V12 an equatorial orbit needs a mean altitude of 331.83 km (spherical formula)', K.altForAccessDeg(13.75, 5), 331.83, 0.02);
  /* SGP4 bisection: the lowest equatorial circular orbit from which Bangkok is ever above 5 degrees in 2 days */
  const seen = h => {
    const s = mkSat(elOf(RE + h, 0, 0, { raan: 0, argp: 0, M: 0 }));
    for (let ms = EP; ms <= EP + 2 * 86400000; ms += 20000) {
      const pv = pvAt(s, ms); if (!pv || !pv.position) continue;
      const g = sat.gstime(new Date(ms)), la = sat.ecfToLookAngles({ latitude: BKK.lat * D2R, longitude: BKK.lon * D2R, height: 0 }, sat.eciToEcf(pv.position, g));
      if (la.elevation * R2D >= 5) return true;
    }
    return false;
  };
  let lo = 300, hi = 360; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (seen(m)) hi = m; else lo = m; }
  near('A1 V12 ... SGP4 finds 339.5 km (the formula plus 8: J2 lowers an equatorial orbit by 9.6 km)', (lo + hi) / 2, 339.5, 1.5);
  const cv = K.coverage(500, 51.6, 13.75, 5);
  chk('A1 coverage: reach = min(90, fold i + lambda); offtrack, the best elevation, the tilt that reaches a site, the share of the Earth in view',
    Math.abs(cv.reach - Math.min(90, 51.6 + cv.lambda)) < 1e-12 && cv.offtrack === 0 && cv.elBest === 90 && Math.abs(cv.footPct - (1 - RE / (RE + 500)) / 2 * 100) < 1e-12 &&
    K.coverage(500, 28.5, 69.65, 5).reach < 69.65 && K.coverage(500, 28.5, 69.65, 5).incNeed >= 69.65 - K.coverage(500, 28.5, 69.65, 5).lambda &&
    Math.abs(K.coverage(400, 0, 13.75, 5).elBest - Math.atan((Math.cos(13.75 * D2R) - RE / (RE + 400)) / Math.sin(13.75 * D2R)) * R2D) < 1e-9);
  /* the dictionary carries the same numbers for the observer (and moves with the observer) */
  const c = A.context(elOf(RE + 500, 0, 51.6), baseEnv()), c2 = A.context(elOf(RE + 500, 0, 51.6), baseEnv({ site: { name: 'Tromso', lat: 69.65, lon: 18.96, tz: 1 } }));
  chk('A1 the dictionary: lambda, reach, foot_pct and the site keys follow env.site and env.maskDeg; the literal Bangkok is nowhere',
    Math.abs(c.lambda - cv.lambda) < 1e-12 && c.site === 'Bangkok' && c2.site === 'Tromso' && c2.site_lat === 69.65 && c2.site_lat_round === 70 && c2.reach < c2.site_lat_abs && c.reach >= c.site_lat_abs &&
    Math.abs(A.context(elOf(RE + 500, 0, 51.6), baseEnv({ maskDeg: 10 })).lambda - K.accessAngleDeg(RE + 500, 10)) < 1e-12 && c.mask === 5 && Math.abs(c.foot_pct_500 - c.foot_pct) < 1e-12);
});

group('A1 repeat ground tracks: the solver reproduces six published missions, SGP4 brings the node back, the claimed miss is SGP4\'s', () => {
  const missions = [['Landsat 8/9 233/16', 233, 16, 0.0001, null, 7077.735, 98.2113], ['Sentinel-2 143/10', 143, 10, 0.0001, null, 7164.271, 98.5700], ['Sentinel-1 175/12', 175, 12, 0.0001, null, 7070.979, 98.1838],
    ['Envisat 501/35', 501, 35, 0.0012, null, 7159.494, 98.5499], ['TOPEX/Jason 127/10', 127, 10, 0.0008, 66.04, 7714.438, 66.04]];
  for (const [name, k, d, e, inc, a0, i0] of missions) {
    const r = K.repeatSolve(k, d, e, inc, { sso: inc === null });
    chk('A1 V13 ' + name + ': a ' + a0 + ' (+-0.02 km), i ' + i0 + ' (+-0.002)', r && Math.abs(r.a - a0) <= 0.02 && Math.abs(r.inc - i0) <= 0.002, r ? 'a ' + r.a.toFixed(3) + ' i ' + r.inc.toFixed(4) : 'null');
  }
  const tx = realEl(TSX), q = P.revsPerNodalDay(tx.a, tx.e, tx.i), rs = K.repeatSolve(167, 11, tx.e, null, { sso: true });
  chk('A1 V13 TerraSAR-X 167/11 (the sixth, from the catalogue): the solved a is within 0.5 km of the real set\'s, Q = 15.18182', Math.abs(rs.a - tx.a) < 0.5 && Math.abs(q - 15.18182) < 2e-5, 'solved ' + rs.a.toFixed(3) + ' real ' + tx.a.toFixed(3) + ' Q ' + q.toFixed(5));
  near('A1 V13 TOPEX cycle in solar days = 9.9157', 10 * 360 / (P.WE_DEG_DAY - P.rates(7714.438, 0.0008, 66.04).nodedot), 9.9157, 2e-4);
  chk('A1 V13 the equator track spacing of 233 revolutions is 1.5451 degrees', Math.abs(360 / 233 - 1.5451) < 1e-4 && Math.abs(40075 / 233 - 172) < 0.1);
  /* SGP4: after K revolutions from an ascending node the node's longitude must return */
  function nodeReturn(a, e, inc, K_, argp) {
    const s = mkSat(elOf(a, e, +inc.toFixed(4), { raan: 50, argp: argp || 0, M: 0, epoch: Date.UTC(2026, 9, 1) })), when = Date.UTC(2026, 9, 1);
    const Tn = 2 * Math.PI / (s.mdot + s.argpdot) * 60000;                     // nodal period, ms, from the satrec's own rates
    const t1 = nodeAfter(s, when), t2 = nodeAfter(s, t1 + K_ * Tn - Tn * 0.5);
    return { dl: wrap180(lonAt(s, t2) - lonAt(s, t1)), days: (t2 - t1) / 86400000 };
  }
  for (const [name, k, d, e, inc, tol] of [['Landsat 233/16, e 0', 233, 16, 0, null, 2e-4], ['Sentinel-2 143/10', 143, 10, 0.0001, null, 0.01], ['TOPEX 127/10', 127, 10, 0.0008, 66.04, 0.01], ['Sentinel-1 175/12', 175, 12, 0.0001, null, 0.01]]) {
    const r = K.repeatSolve(k, d, e, inc, { sso: inc === null }), m = nodeReturn(r.a, e, r.inc, k);
    chk('A1 V13 SGP4 node longitude after ' + k + ' revolutions of ' + name + ' returns to within ' + tol + ' deg', Math.abs(m.dl) <= tol, 'miss ' + m.dl.toExponential(2) + ' deg, ' + m.days.toFixed(4) + ' days');
  }
  /* the claimed miss (rgt_off) against SGP4 node to node, six orbits; within 4 km */
  const epochOf = s => (s.jdsatepoch - 2440587.5) * 86400000;
  const miss = (s, K_) => {
    const when = epochOf(s) + (s.jdsatepochF ? s.jdsatepochF * 86400000 : 0);
    const Tn = 2 * Math.PI / (s.mdot + s.argpdot) * 60000, t1 = nodeAfter(s, when), t2 = nodeAfter(s, t1 + K_ * Tn - Tn * 0.5);
    return Math.abs(wrap180(lonAt(s, t2) - lonAt(s, t1))) * 111.32;
  };
  const rows = [], worst = [];
  const claim = (name, el, s, Kx, Dx) => {
    const c = A.context(el, baseEnv({ window: null }));
    const ok = c.K === Kx && c.D === Dx, m = miss(s, Kx);
    rows.push(name + ': K/D ' + c.K + '/' + c.D + ' claimed ' + (c.rgt_off === undefined ? '-' : c.rgt_off.toFixed(1)) + ' km, SGP4 ' + m.toFixed(1));
    worst.push(ok && c.rgt_off !== undefined ? Math.abs(c.rgt_off - m) : Infinity);
  };
  for (const [nm, e0, kx, dx] of [['ISS', ISS, 61, 4], ['Landsat 8', LANDSAT, 233, 16], ['Sentinel-2A', S2A, 143, 10], ['TerraSAR-X', TSX, 167, 11]]) {
    const el = realEl(e0); claim(nm, el, sat.twoline2satrec(e0.l1, e0.l2), kx, dx);
  }
  { const r = K.repeatSolve(76, 5, 0, 51.6, { sso: false }), el = elOf(r.a + 0.12, 0, 51.6, { epoch: Date.UTC(2026, 9, 1) }); claim('76/5 at 51.6', el, mkSat(el), 76, 5); }
  { const r = K.repeatSolve(15, 1, 0, 130, { sso: false }), el = elOf(r.a - 0.15, 0, 130, { epoch: Date.UTC(2026, 9, 1) }); claim('retrograde 15/1 at 130', el, mkSat(el), 15, 1); }
  chk('A1 the claimed miss (rgt_off) is within 4 km of SGP4 node to node on six orbits, and K/D are recognised: ' + rows.join(' | '), worst.length === 6 && worst.every(w => w <= 4), 'worst ' + Math.max.apply(null, worst).toFixed(2) + ' km');
  const cl = A.context(realEl(LANDSAT), baseEnv({ window: null }));
  chk('A1 the repeat keys for Landsat 8: K 233, D 16, rgt_days in nodal days (about 16.1 solar days), rgt_gap = 40075/233, shift_deg = 360/Q, no near-repeat when there is an exact one',
    cl.K === 233 && cl.D === 16 && Math.abs(cl.rgt_days - 16 * 360 / (P.WE_DEG_DAY - cl.node)) < 1e-9 && cl.rgt_days > 16 && cl.rgt_days < 16.2 && Math.abs(cl.rgt_gap - 40075 / 233) < 1e-9 && Math.abs(cl.shift_deg - 360 / cl.Q) < 1e-12 && cl.near_K === undefined && cl.rgt_days_max === 16);
  const iss = A.context(realEl(ISS), baseEnv({ window: null }));
  near('A1 an ISS-like 61/4 cycle is 3.94 solar days, not 4 (the nodal day)', iss.rgt_days, 3.935, 0.01);
  /* the near repeat: 5 km above a 29/2 height there is no exact cycle (the miss would be 0.06 of a revolution over the 2 days),
     but there is one within 10 km, and its height is the one that repeats exactly; 25 km above it there is none within 10 km */
  const r292 = K.repeatSolve(29, 2, 0, 98, { sso: false }), off = A.context(elOf(r292.a + 5, 0, 98), baseEnv({ window: null })), far = A.context(elOf(r292.a + 25, 0, 98), baseEnv({ window: null }));
  chk('A1 near repeat: 5 km above a 29/2 height there is no exact cycle but a near one (29/2, dh 5), at the height that repeats exactly; 25 km above, none',
    off.K === undefined && off.near_K === 29 && off.near_D === 2 && Math.abs(off.near_dh - 5) < 0.01 && Math.abs(off.near_h - (r292.a - RE)) < 1e-6 && far.near_K === undefined,
    'near ' + off.near_K + '/' + off.near_D + ' at ' + (off.near_h && off.near_h.toFixed(2)) + ' km, dh ' + (off.near_dh && off.near_dh.toFixed(2)));
});

group('A1 geostationary helpers against SGP4 look angles, longitude and drift', () => {
  const gm = P.gmstDeg(EP);
  const place = L => elOf(P.GEO_A_KM, 0, 0, { raan: 0, argp: 0, M: wrap360(L + gm) });
  const look = (L, ms) => { const s = mkSat(place(L)), pv = pvAt(s, ms || EP); return sat.ecfToLookAngles({ latitude: BKK.lat * D2R, longitude: BKK.lon * D2R, height: 0 }, sat.eciToEcf(pv.position, sat.gstime(new Date(ms || EP)))).elevation * R2D; };
  near('A1 V16 a_GEO = 42164.182 km, altitude 35786.045 (mu 398600.8, a sidereal day)', P.GEO_A_KM, 42164.182, 1e-3);
  near('A1 V16 the elevation of a GEO at 100.52E from Bangkok = 73.837 by the formula', K.geoElevation(100.52, BKK), 73.837, 2e-3);
  let w = 0; const rows = [];
  for (const L of [100.52, 75, 120, 50, 0, -30]) { const f = K.geoElevation(L, BKK), p = look(L); w = Math.max(w, Math.abs(f - p)); rows.push(L + ': ' + f.toFixed(2) + '/' + p.toFixed(2)); }
  chk('A1 V16 the formula against satellite.js look angles at six longitudes: within 0.05 degrees (73.84 / 73.88 ...)', w <= 0.05, rows.join('  ') + '  worst ' + w.toFixed(3));
  const vis = K.geoVisibleLongitudes(BKK, 5);
  near('A1 V16 the visible half-width from 13.75 N with a 5 degree mask = 75.9', vis.half, 75.9, 0.05);
  chk('A1 V16 satellite.js: 4.98 and 4.97 degrees at the visibility edges 24.6E and 176.5E, and below the mask just beyond them', Math.abs(look(vis.lo) - 5) < 0.1 && Math.abs(look(vis.hi) - 5) < 0.1 && look(vis.lo - 1) < 5 && look(vis.hi + 1) < 5, vis.lo.toFixed(2) + ' -> ' + look(vis.lo).toFixed(2) + ', ' + vis.hi.toFixed(2) + ' -> ' + look(vis.hi).toFixed(2));
  const c = A.context(place(100.52), baseEnv()), s = mkSat(place(100.52)), g = geod(pvAt(s, EP), EP);
  chk('A1 the dictionary for a GEO placed at 100.52E: geo_lon, el_geo, geo_vis, vis_lo/vis_hi; the SGP4 sub-point is within 0.05 deg of 100.52',
    Math.abs(c.geo_lon - 100.52) < 1e-9 && Math.abs(c.el_geo - 73.837) < 0.01 && c.geo_vis === true && Math.abs(c.vis_lo - vis.lo) < 1e-12 && Math.abs(c.vis_hi - vis.hi) < 1e-12 && Math.abs(wrap180(g.longitude * R2D - BKK.lon)) < 0.05 && c.eight_lat === 0);
  const far = A.context(place(100.52 + 180), baseEnv());
  const fix = elOf(P.GEO_A_KM, 0, 0, { raan: 0, argp: 0, M: far.ma_site }), sub = geod(pvAt(mkSat(fix), EP), EP);
  chk('A1 ma_site (the fix\'s mean anomaly) from the far side puts the GEO over the observer: geo_vis false before, true after, SGP4 sub-point within 0.05 deg', far.geo_vis === false && Math.abs(wrap180(sub.longitude * R2D - BKK.lon)) < 0.05 && A.context(fix, baseEnv()).geo_vis === true);
  const ge = K.geoEclipse();
  chk('A1 GEO eclipse: dark core about 69 minutes at the equinox, a season of about 45 days', Math.abs(ge.maxMin - 69.4) < 1 && Math.abs(ge.seasonDays - 44.7) < 2 && c.geo_ecl_max === ge.maxMin && c.geo_season_days === ge.seasonDays, ge.maxMin.toFixed(1) + ' min, ' + ge.seasonDays.toFixed(1) + ' d');
  /* east-west libration: a sidereal-day orbit with e swings 2e radians, SGP4 agrees */
  for (const e of [0.002, 0.005]) {
    /* the amplitude of the once-a-day swing, by least squares on [1, t, sin, cos] over three days (a straight line fitted to exactly one period of a sine is itself tilted) */
    const s2 = mkSat(elOf(P.GEO_A_KM, e, 0.05, { raan: 0, argp: 0, M: wrap360(100.52 + gm) })), ts = [], ys = [], w0 = 2 * Math.PI / P.SIDEREAL_MIN;
    for (let m = 0; m <= 3 * 1440; m += 5) { ts.push(m); ys.push(lonAt(s2, EP + m * 60000)); }
    for (let k = 1; k < ys.length; k++) { while (ys[k] - ys[k - 1] > 180) ys[k] -= 360; while (ys[k] - ys[k - 1] < -180) ys[k] += 360; }
    const N4 = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    ts.forEach((t, k) => { const r = [1, t, Math.sin(w0 * t), Math.cos(w0 * t)]; for (let p = 0; p < 4; p++) { for (let q = 0; q < 4; q++) N4[p][q] += r[p] * r[q]; N4[p][4] += r[p] * ys[k]; } });
    for (let p = 0; p < 4; p++) { let m = p; for (let q = p + 1; q < 4; q++) if (Math.abs(N4[q][p]) > Math.abs(N4[m][p])) m = q; const t = N4[p]; N4[p] = N4[m]; N4[m] = t; for (let q = p + 1; q < 4; q++) { const f = N4[q][p] / N4[p][p]; for (let z = p; z < 5; z++) N4[q][z] -= f * N4[p][z]; } }
    const sol = [0, 0, 0, 0]; for (let p = 3; p >= 0; p--) { let v = N4[p][4]; for (let q = p + 1; q < 4; q++) v -= N4[p][q] * sol[q]; sol[p] = v / N4[p][p]; }
    near('A1 ew_amp: SGP4 longitude libration for e ' + e + ' = 2e radians', Math.hypot(sol[2], sol[3]), A.context(elOf(P.GEO_A_KM, e, 0.05), baseEnv()).ew_amp, 0.01, '(' + (2 * e * R2D).toFixed(4) + ' deg)');
  }
  /* figure of eight: tan^2(i/2) in longitude */
  for (const inc of [5, 10]) {
    const s2 = mkSat(elOf(P.GEO_A_KM, 0, inc, { raan: 0, argp: 0, M: 0 })), nm = s2.mdot + s2.argpdot, nd = s2.nodedot; let lo = 1e9, hi = -1e9;
    for (let k = 0; k <= 8640; k++) {
      const ms = EP + k * 10000, pv = pvAt(s2, ms), ra = Math.atan2(pv.position.y, pv.position.x), u0 = nm * (ms - EP) / 60000 + nd * (ms - EP) / 60000;
      let d = ra - u0; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; lo = Math.min(lo, d); hi = Math.max(hi, d);
    }
    near('A1 figure of eight at i ' + inc + ': SGP4 right ascension against the mean longitude has half-range tan^2(i/2) = ' + (Math.tan(inc * D2R / 2) ** 2 * R2D).toFixed(5), (hi - lo) / 2 * R2D, Math.tan(inc * D2R / 2) ** 2 * R2D, 0.0015, 'SGP4 ' + ((hi - lo) / 2 * R2D).toFixed(5));
  }
  /* the direction words: a ring 60 km low goes round faster than the Earth turns and drifts east, 60 km high drifts west; SGP4's own longitude agrees */
  for (const dA of [-60, 60]) {
    const el = elOf(P.GEO_A_KM + dA, 0, 0.1, { raan: 0, argp: 0, M: 0 }), s3 = mkSat(el), cc = ctx(el), ys = [];
    for (let d = 0; d <= 4; d += 0.5) ys.push(lonAt(s3, EP + d * 86400000));
    let tot = 0; for (let k = 1; k < ys.length; k++) { let dd = ys[k] - ys[k - 1]; while (dd > 180) dd -= 360; while (dd < -180) dd += 360; tot += dd; }
    const slope = tot / 4;
    chk('A1 drift words: a ring ' + Math.abs(dA) + ' km ' + (dA < 0 ? 'low' : 'high') + ' has a period ' + (dA < 0 ? 'shorter' : 'longer') + ' than a sidereal day and drifts ' + (dA < 0 ? 'east' : 'west') + ' (SGP4: ' + slope.toFixed(3) + ' deg/day; dictionary ' + cc.drift.toFixed(3) + ')',
      (slope > 0) === (dA < 0) && cc.drift_dir === (slope > 0 ? 'east' : 'west') && cc.plonger === (dA < 0 ? 'shorter' : 'longer') && Math.abs(cc.drift - slope) < 0.03 && Math.abs(cc.drift_abs - Math.abs(cc.drift)) < 1e-12 && Math.abs(cc.dperiod_abs - Math.abs(P.periodMin(P.GEO_A_KM + dA) - P.SIDEREAL_MIN)) < 1e-9);
  }
  /* the drift: mdot + argpdot + nodedot - the Earth's rotation, against SGP4's 10 day longitude slope for real geostationary sets */
  const geoCat = CAT.filter(x => { const n = +x.l2.slice(52, 63), i = +x.l2.slice(8, 16); return n > 0.995 && n < 1.006 && i < 3; });
  let wBare = 0, wSat = 0, sumBare = 0, sumSat = 0, nG = 0;
  for (const g1 of geoCat.slice(0, 150)) {
    const s1 = sat.twoline2satrec(g1.l1, g1.l2); if (s1.error) continue;
    const ep = (s1.jdsatepoch - 2440587.5) * 86400000 + (s1.jdsatepochF ? s1.jdsatepochF * 86400000 : 0), el1 = realEl(g1);
    const ys = []; for (let d = 0; d <= 10; d += 0.5) ys.push(lonAt(s1, ep + d * 86400000));
    const u = [ys[0]]; for (let k = 1; k < ys.length; k++) { let d = ys[k] - ys[k - 1]; while (d > 180) d -= 360; while (d < -180) d += 360; u.push(u[k - 1] + d); }
    const n = u.length, mt = (n - 1) / 2, my = u.reduce((x, y) => x + y) / n; let sxy = 0, sxx = 0; for (let k = 0; k < n; k++) { sxy += (k - mt) * (u[k] - my); sxx += (k - mt) ** 2; }
    const slope = sxy / sxx / 0.5;
    const withSat = A.context(el1, baseEnv({ window: null })).drift, bare = A.context(el1, baseEnv({ window: null, sat: null })).drift;
    wSat = Math.max(wSat, Math.abs(slope - withSat)); wBare = Math.max(wBare, Math.abs(slope - bare)); sumSat += slope - withSat; sumBare += slope - bare; nG++;
  }
  chk('A1 V16 drift: ' + nG + ' real geostationary sets, the dictionary\'s drift (rates with the satrec) against SGP4\'s 10 day longitude slope: worst ' + wSat.toFixed(4) + ' deg/day (closed form without a satrec: ' + wBare.toFixed(4) + '); within 0.03', nG >= 100 && wSat <= 0.03,
    'mean error with satrec ' + (sumSat / nG).toFixed(4) + ', without ' + (sumBare / nG).toFixed(4));
});

group('A1 the secular rates and the sun-synchronous inclination through the dictionary (SGP4\'s own, not first-order J2)', () => {
  /* V9 through context(): the inclination a student is told to type must be the one SGP4 itself holds to the Sun */
  const tbl = [[300, 96.6953], [400, 97.0538], [500, 97.4260], [600, 97.8123], [700, 98.2130], [800, 98.6285], [1000, 99.5054], [1200, 100.4462], [2000, 104.9182], [5000, 138.5430]];
  for (const [h, want] of tbl) {
    const c = ctx(elOf(RE + h, 0, 97)), s = mkSat(elOf(RE + h, 0, +c.sso_inc.toFixed(4))), rate = s.nodedot * PERDAY;
    chk('A1 V9 sso_inc at ' + h + ' km = ' + want + ' (+-2e-4) and SGP4\'s node rate at that inclination is the Sun\'s 0.98565 (+-1e-4)', Math.abs(c.sso_inc - want) <= 2e-4 && Math.abs(rate - P.MEAN_SUN_RATE) <= 1e-4, 'sso_inc ' + c.sso_inc.toFixed(4) + ', node ' + rate.toFixed(6));
  }
  near('A1 V9 the first-order inclination would be 0.024 lower at 500 km (97.4019): the dictionary is not it', ctx(elOf(RE + 500, 0, 97)).sso_inc - 97.4019, 0.0241, 0.002);
  near('A1 V9 e 0.05 at 7078.137 km: 98.1718', ctx(elOf(7078.137, 0.05, 98)).sso_inc, 98.1718, 2e-4);
  chk('A1 V9 sso_inc is null (not undefined) above 5985 km, a number at 5975; sso_amax_alt = 5981.7 km at e = 0', ctx(elOf(RE + 5985, 0, 98)).sso_inc === null && ctx(elOf(RE + 5975, 0, 98)).sso_inc !== null && Math.abs(ctx(elOf(RE + 700, 0, 98)).sso_amax_alt - 5981.7) < 0.1);
  /* the rates themselves against the satrec, through context(): node, argp, nodal period */
  let w1 = 0, w2 = 0, w3 = 0, n = 0;
  const R = rng(5);
  for (let k = 0; k < 120; k++) {
    const a = 6700 + R() * 5400, e = R() < 0.4 ? 0 : R() * 0.2, rpOk = a * (1 - e) > 6600, inc = R() * 180;
    if (!rpOk) continue;
    const s = mkSat(elOf(a, e, inc, { raan: R() * 360, argp: R() * 360, M: R() * 360 }));
    /* the satrec's own a, e and i (what the written lines hold): the dictionary and SGP4 must agree on THOSE; the typed values differ by the quantum of the TLE (i to 5e-5 degrees moves the node 6e-6 deg/day) */
    const c = ctx(elOf(s.a * RE72, s.ecco, s.inclo * R2D, { raan: s.nodeo * R2D, argp: s.argpo * R2D, M: s.mo * R2D }));
    w1 = Math.max(w1, Math.abs(c.node - s.nodedot * PERDAY)); w2 = Math.max(w2, Math.abs(c.argp_rate - s.argpdot * PERDAY)); w3 = Math.max(w3, Math.abs(c.period_nodal - 2 * Math.PI / (s.mdot + s.argpdot))); n++;
  }
  chk('A1 V8 node, argp_rate and period_nodal equal the satrec\'s nodedot, argpdot, mdot + argpdot on ' + n + ' random near-Earth orbits (1e-9 deg/day, 1e-8 min)', w1 <= 1e-9 && w2 <= 1e-8 && w3 <= 1e-8, 'worst ' + w1.toExponential(1) + ' ' + w2.toExponential(1) + ' ' + w3.toExponential(1));
  const c8 = ctx(elOf(6878.137, 0, 97.426));
  chk('A1 V8 (6878.137, 0, 97.426): node 0.985650, argp_rate -3.497181 deg/day, nodal period 94.7395 min, Kepler period 94.6163', Math.abs(c8.node - 0.985650) < 2e-6 && Math.abs(c8.argp_rate + 3.497181) < 2e-6 && Math.abs(c8.period_nodal - 94.7395) < 5e-5 && Math.abs(c8.period - 94.616258) < 5e-4);
  /* deep space: the lunisolar terms ride in on the satrec, and the dictionary says so when it has none */
  const mol = elOf(26562, 0.74, 63.4349, { argp: 270 }), withSat = ctx(mol), bare = A.context(mol, baseEnv({ sat: null })), s = mkSat(mol);
  chk('A1 V8 deep space (Molniya): with env.sat the rates include dnodt, domdt (equal to the satrec\'s own sum within 1e-7); without it the dictionary notes "deep rates +-5 %" in __errors',
    Math.abs(withSat.node - (s.nodedot + s.dnodt) * PERDAY) < 1e-7 && Math.abs(withSat.argp_rate - (s.argpdot + s.domdt) * PERDAY) < 1e-7 && withSat.__errors.length === 0 && bare.__errors.length === 1 && bare.__errors[0].msg === 'deep rates +-5 %' && Math.abs(withSat.node - bare.node) > 0.001);
  near('A1 V8 Molniya osculating RAAN slope -0.15610 vs J2/J4 -0.14765 vs with the lunisolar terms -0.15540: the dictionary says', withSat.node, -0.1554, 0.0008);
  chk('A1 V8 nothing is deep below 12254.0 km and everything is from 12254.3 (the SGP4 method switch), and the dictionary agrees with Planner.isDeep', !P.isDeep(12254.0) && P.isDeep(12254.3) && ctx(elOf(12254.0, 0, 50)).__errors.length === 0 && ctx(elOf(12254.3, 0, 50), { sat: null }).__errors.length === 1);
});

group('A1 critical inclination, frozen orbit, perigee and apogee speed, dwell, the retrograde bound', () => {
  /* V17: the root of argpdot against the satrec (independent): at the root SGP4's own argpdot is zero */
  const root = (a, e) => { let lo = 55, hi = 70; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (P.rates(a, e, m).argpdot > 0) lo = m; else hi = m; } return (lo + hi) / 2; };
  for (const [name, a, e, want] of [['Molniya a 26562 e .74', 26562, 0.74, 63.4263], ['LEO 700 km e .001', RE + 700, 0.001, 63.4100], ['Tundra a 42164 e .3', 42164.18, 0.3, 63.4341]]) {
    const r = root(a, e), s = mkSat(elOf(a, e, +r.toFixed(5), { argp: 270 }));
    chk('A1 V17 the critical inclination of ' + name + ' is ' + want + ' (+-2e-4) and SGP4\'s own argpdot there is under 2e-3 deg/day (the satrec J2/J4 part)', Math.abs(r - want) <= 2e-4 && Math.abs(s.argpdot * PERDAY) < 2e-3, 'root ' + r.toFixed(5) + ', satrec argpdot ' + (s.argpdot * PERDAY).toExponential(2));
    chk('A1 V17 inc_crit (63.4 or 116.6) is within 0.04 degrees of that root (0.034 for the Tundra: the design says 0.03)', Math.abs(ctx(elOf(a, e, r)).inc_crit - r) <= 0.04 && ctx(elOf(a, e, 116.5)).inc_crit === 116.6);
  }
  near('A1 V17 first-order critical inclination = 63.43495', Math.acos(1 / Math.sqrt(5)) * R2D, 63.43495, 1e-5);
  /* argp_rate with the lunisolar terms, total, from the satrec: the numbers behind kind.heo.drift */
  const tot = [['Molniya preset', 26554.137, 0.74, 63.4, 0.0029], ['Molniya at 60.43', 26554.137, 0.74, 60.43, 0.0392], ['Molniya at 55', 26554.137, 0.74, 55, 0.1111], ['Molniya at 45', 26554.137, 0.74, 45, 0.2538], ['Molniya at 28.5', 26554.137, 0.74, 28.5, 0.4772],
    ['Tundra preset', P.GEO_A_KM, 0.27, 63.4, -0.0008], ['Tundra at 55', P.GEO_A_KM, 0.27, 55, 0.0079], ['GTO i 7', 24396.137, 0.728312, 7, 0.8100], ['53,622 x 233,622 at 63.4', (53622 + 233622) / 2 + RE, (233622 - 53622) / (53622 + 233622 + 2 * RE), 63.4, 0.0152]];
  const bad = [];
  for (const [nm, a, e, i, want] of tot) {
    const w = nm.indexOf('GTO') === 0 ? 180 : 270, o = { raan: 10, argp: w, M: 0 };     // the lunisolar terms depend on the node: the design measured at RAAN 10
    const c = ctx(elOf(a, e, i, o)), s = mkSat(elOf(a, e, i, o)), indep = (s.argpdot + s.domdt) * PERDAY;
    if (Math.abs(c.argp_rate - indep) > 1e-7 || Math.abs(c.argp_rate - want) > 0.0006) bad.push(nm + ' ' + c.argp_rate.toFixed(4) + ' vs satrec ' + indep.toFixed(4) + ' vs spec ' + want);
  }
  chk('A1 V17 argp_rate with the lunisolar terms: the Molniya and Tundra presets stay under 0.0055 deg/day (silent), the Molniya at 55 and the GTO do not; equal to the satrec\'s argpdot + domdt', bad.length === 0, bad.join(' | '));
  /* frozen orbit */
  near('A1 e_f at 700 km, 98.2 degrees = 0.001046', K.frozenE(RE + 700, 98.2), 0.001046, 2e-6);
  near('A1 e_f at 600 km, 97.8 degrees = 0.001062', K.frozenE(RE + 600, 97.8), 0.001062, 2e-6);
  chk('A1 the dictionary: e_f is the kernel\'s', Math.abs(ctx(elOf(RE + 700, 0, 98.2)).e_f - K.frozenE(RE + 700, 98.2)) < 1e-15);
  /* SGP4's osculating elements at constant phase (once per nodal period) for 180 days */
  const osc = (a, e, inc, w0) => {
    const s = mkSat(elOf(a, e, inc, { raan: 30, argp: w0, M: 0 })), Tn = 2 * Math.PI / (s.mdot + s.argpdot) * 60000, out = [];
    for (let k = 0; k * Tn <= 180 * 86400000; k++) {
      const pv = pvAt(s, EP + k * Tn), r = pv.position, v = pv.velocity, rr = Math.hypot(r.x, r.y, r.z), v2 = v.x * v.x + v.y * v.y + v.z * v.z, rv = r.x * v.x + r.y * v.y + r.z * v.z;
      const ev = [((v2 - MU72 / rr) * r.x - rv * v.x) / MU72, ((v2 - MU72 / rr) * r.y - rv * v.y) / MU72, ((v2 - MU72 / rr) * r.z - rv * v.z) / MU72];
      const h = [r.y * v.z - r.z * v.y, r.z * v.x - r.x * v.z, r.x * v.y - r.y * v.x], hh = Math.hypot(h[0], h[1], h[2]), nh = Math.hypot(h[0], h[1]);
      const N = [-h[1] / nh, h[0] / nh, 0], Q = [(h[1] * N[2] - h[2] * N[1]) / hh, (h[2] * N[0] - h[0] * N[2]) / hh, (h[0] * N[1] - h[1] * N[0]) / hh];
      out.push({ e: Math.hypot(ev[0], ev[1], ev[2]), ey: ev[0] * Q[0] + ev[1] * Q[1] + ev[2] * Q[2] });
    }
    return out;
  };
  const efSgp4 = K.frozenE(RE + 700, 98.2);
  const zero = osc(RE + 700, 0, 98.2, 0), froz = osc(RE + 700, +efSgp4.toFixed(7), 98.2, 90);
  const eMin = a => Math.min.apply(null, a.map(p => p.e)), eMax = a => Math.max.apply(null, a.map(p => p.e));
  const eyMean = zero.reduce((x, p) => x + p.ey, 0) / zero.length;
  chk('A1 e_f: SGP4 with the TLE e = 0 holds the osculating e-vector near (0, e_f): mean ey ' + eyMean.toFixed(6) + ' against ' + efSgp4.toFixed(6) + ', the osculating e stays within 0.001138 .. 0.001140 over 180 days', Math.abs(eyMean - efSgp4) < 4e-5 && eMin(zero) > 0.00113 && eMax(zero) < 0.00115);
  chk('A1 e_f: typing the textbook value (e = e_f, w = 90) makes the osculating e swing by more than 2.5x (' + eMin(froz).toFixed(5) + ' .. ' + eMax(froz).toFixed(5) + ') where e = 0 holds steady', eMax(froz) / eMin(froz) > 2.5 && eMax(zero) / eMin(zero) < 1.15);
  /* speeds and dwell: vis-viva with mu72 against SGP4's fastest and slowest */
  const m = ctx(elOf(26562, 0.74, 63.4349, { argp: 270 })), sM = mkSat(elOf(26562, 0.74, 63.4349, { argp: 270 })); let vmax = 0, vmin = 1e9;
  for (let k = 0; k <= 720; k++) { const v = pvAt(sM, EP + k * 60000).velocity; const sp = Math.hypot(v.x, v.y, v.z); vmax = Math.max(vmax, sp); vmin = Math.min(vmin, sp); }
  chk('A1 Molniya vp 10.0214, va 1.4974 km/s; SGP4\'s maximum and minimum speed are 0.3 % under and over them', Math.abs(m.vp - 10.0214) < 2e-3 && Math.abs(m.va - 1.4974) < 2e-4 && Math.abs(vmax / m.vp - 1) < 0.005 && Math.abs(vmin / m.va - 1) < 0.005, 'vp ' + m.vp.toFixed(4) + ' (SGP4 ' + vmax.toFixed(4) + '), va ' + m.va.toFixed(4) + ' (SGP4 ' + vmin.toFixed(4) + ')');
  let above = 0; for (let k = 0; k < 2880; k++) { const r = pvAt(sM, EP + k / 2880 * 2 * Math.PI / sM.mdot * 60000).position; if (Math.hypot(r.x, r.y, r.z) > sM.a * RE72) above++; }
  chk('A1 hi_dwell_pct = 50 + 100 e / pi (73.6 % for the Molniya) and SGP4 spends that share of the orbit above the mean radius (within 1 point); ha_moon_pct, apo_lat', Math.abs(m.hi_dwell_pct - 73.55) < 0.05 && Math.abs(above / 2880 * 100 - m.hi_dwell_pct) < 1 && Math.abs(m.apo_lat - 63.4349) < 0.01 && Math.abs(m.ha_moon_pct - (26562 * 1.74 - RE) / 384400 * 100) < 1e-9,
    'dwell ' + m.hi_dwell_pct.toFixed(2) + ' vs SGP4 ' + (above / 28.8).toFixed(2));
  /* the nodal period against the page's own node to node measurement */
  for (const [nm, el, tol] of [['ISS-like', elOf(RE + 420, 0.0005, 51.64), 0.005], ['SSO 500', elOf(RE + 500, 0, 97.426), 0.005], ['Molniya', elOf(26562, 0.74, 63.4349, { argp: 270 }), 0.03]]) {
    const s = mkSat(el), c = ctx(el), t1 = nodeAfter(s, EP), t2 = nodeAfter(s, t1 + c.period_nodal * 60000 * 0.5);
    near('A1 period_nodal (the figure the element card prints) of ' + nm + ' equals the SGP4 node to node time', c.period_nodal, (t2 - t1) / 60000, tol);
  }
  /* the retrograde bound: a dictionary key that is Planner's, and its lead word */
  const r1 = ctx(elOf(7000, 0.01, 179.99)), r2 = ctx(elOf(26554, 0.01, 179.99)), r3 = ctx(elOf(7000, 0.01, 180)), r4 = ctx(elOf(7000, 0, 179.99));
  chk('A1 retro_err is Planner\'s (857 km at a 7000, e 0.01, i 179.99), retro_lead is "about" near the Earth and "on the order of" from the 225-minute line; 0 at i = 180 and at e = 0; off180',
    Math.abs(r1.retro_err - P.retroErrorKm(7000, 0.01, 179.99)) < 1e-9 && Math.abs(r1.retro_err - 857.1) < 0.5 && r1.retro_lead === 'about' && r2.retro_lead === 'on the order of' && r3.retro_err === 0 && r4.retro_err === 0 && Math.abs(r1.off180 - 0.01) < 1e-9);
  /* V18 against the SGP4 mirror test: the prograde twin reflected in y */
  const maxErr = (a, e, i, argp) => {
    const sr = mkSat(elOf(a, e, i, { raan: 40, argp, M: 0 })), sp = mkSat(elOf(a, e, 180 - i, { raan: 320, argp, M: 0 })); let w = 0;
    for (let t = 0; t <= 24 * 60; t += 3) { const d = EP + t * 60000, r = pvAt(sr, d), p = pvAt(sp, d); w = Math.max(w, Math.hypot(r.position.x - p.position.x, r.position.y + p.position.y, r.position.z - p.position.z)); }
    return w;
  };
  let worstRatio = 0, lowArgp0 = 1e9, nCases = 0;
  for (const a of [6700, 7000, 9000, 11500]) for (const e of [1e-5, 1e-4, 1e-2]) for (const argp of [0, 90]) for (const i of [179.99, 179.9]) {
    const mErr = maxErr(a, e, i, argp), f = ctx(elOf(a, e, i)).retro_err; nCases++;
    worstRatio = Math.max(worstRatio, mErr / f); if (argp === 0) lowArgp0 = Math.min(lowArgp0, mErr / f);
  }
  chk('A1 V18 retro_err against the SGP4 mirror test over ' + nCases + ' cases (a 6700..11500, e 1e-5..1e-2, argp 0 and 90, i 179.99 and 179.9): measured at most 1.15 x the figure, and at least 0.95 x at argp 0', nCases === 48 && worstRatio <= 1.15 && lowArgp0 >= 0.95, 'worst ' + worstRatio.toFixed(3) + ', lowest at argp 0 ' + lowArgp0.toFixed(3));
  const e4 = ctx(elOf(7000, 1e-4, 179.9999)).retro_err;
  chk('A1 V18 e 1e-4 at i 179.9999: 855 km measured against 857 (no silent floor); i 179.99996 and 180: 0 km by both', Math.abs(e4 - 857) < 2 && Math.abs(maxErr(7000, 1e-4, 179.9999, 0) - 855.4) < 3 && ctx(elOf(7000, 0.01, 179.99996)).retro_err === 0 && maxErr(7000, 0.01, 179.99996, 0) < 0.05 && maxErr(7000, 0.01, 180, 0) < 0.05);
  chk('A1 V18 the first draft\'s 1.87e-3 * a * e / delta is a mutant: it says 1,232 km at a 11500 where SGP4 measures 865', (() => { const first = (a, e, i) => 1.87e-3 * a * e / ((180 - i) * D2R); return Math.abs(first(11500, 0.01, 179.99) - 1232) < 5 && first(11500, 0.01, 179.99) > 1.15 * maxErr(11500, 0.01, 179.99, 0); })());
});

group('A1 V19 real catalogue element sets through the dictionary (Landsat 8, Sentinel-2A, TerraSAR-X, ISS, KNACKSAT-2)', () => {
  for (const [nm, e0, Q, ltanH, iSso] of [['LANDSAT 8', LANDSAT, 14.56242, 22.204, 98.2115], ['SENTINEL-2A', S2A, 14.29999, 22.505, 98.5699], ['TERRA SAR X', TSX, 15.18182, 18.031, 97.4464]]) {
    const el = realEl(e0), c = A.context(el, baseEnv({ window: null }));
    chk('A1 V19 ' + nm + ': Q ' + Q + ' (+-2e-5), LTAN ' + ltanH + ' h (+-2e-3), i_SSO(a, e) ' + iSso + ' (+-5e-4), and it is sun-synchronous to within its drift', Math.abs(c.Q - Q) <= 2e-5 && Math.abs(c.ltan - ltanH) <= 2e-3 && Math.abs(c.sso_inc - iSso) <= 5e-4, 'Q ' + c.Q.toFixed(5) + ' LTAN ' + c.ltan.toFixed(3) + ' i_SSO ' + c.sso_inc.toFixed(4));
  }
  const k = A.context(realEl(real('KNACKSAT-2')), baseEnv({ window: null })), is = A.context(realEl(ISS), baseEnv({ window: null }));
  chk('A1 V19 the ISS and KNACKSAT-2 sets are kind.iss material (inc 51.63, 300-470 km, e < 0.01) and their B* works back to an area over mass near 0.001 and 0.0045 m2/kg',
    AC.helpers.issLike(k) && AC.helpers.issLike(is) && Math.abs(is.am - 0.0012) < 0.0003 && Math.abs(k.am - 0.0045) < 0.001, 'ISS am ' + is.am.toFixed(5) + ', KNACKSAT-2 am ' + k.am.toFixed(5));
  /* the element card's a is satrec.a: the dictionary quotes it back */
  const li = realEl(LANDSAT), cl = A.context(li, baseEnv({ window: null }));
  chk('A1 the dictionary quotes a, e, inc, raan, argp and ma as given (the real set\'s own, a = satrec.a * 6378.135)', cl.a === li.a && cl.e === li.e && cl.inc === li.i && cl.raan === li.raan && cl.argp === li.argp && cl.ma === li.M && Math.abs(cl.a - sat.twoline2satrec(LANDSAT.l1, LANDSAT.l2).a * RE72) < 1e-9);
});

group('A1 the daytime pass clock (gt.sso.clock) against SGP4 passes over Bangkok', () => {
  /* every pass above 5 degrees in three days; the mean solar time of its highest point, at the sub-satellite longitude */
  function passes(s, from, days) {
    const out = []; let open = null, best = -90, tBest = 0;
    const el = ms => { const pv = pvAt(s, ms); return sat.ecfToLookAngles({ latitude: BKK.lat * D2R, longitude: BKK.lon * D2R, height: 0 }, sat.eciToEcf(pv.position, sat.gstime(new Date(ms)))).elevation * R2D; };
    for (let ms = from; ms <= from + days * 86400000; ms += 15000) {
      const e = el(ms);
      if (e >= 5) { if (open === null) { open = ms; best = -90; } if (e > best) { best = e; tBest = ms; } }
      else if (open !== null) { out.push({ ms: tBest, el: best, mst: mlstAt(s, tBest) }); open = null; }
    }
    return out;
  }
  const cases = [['LTAN 10:30, 700 km', 10.5], ['LTAN 22:30 (the descending node is by day)', 22.5], ['LTAN 06:00 dawn-dusk', 6], ['LTAN 13:30', 13.5], ['LTAN 12:00 noon', 12]];
  for (const [nm, ltanH] of cases) for (const site of [BKK, { name: 'Hobart', lat: -42.88, lon: 147.33, tz: 10 }]) {
    const a = RE + 700, inc = P.ssoInclination(a, 0), el = elOf(a, 0, +inc.toFixed(4), { raan: P.raanFromLtan(ltanH, EP), M: 0 }), c = A.context(el, baseEnv({ site, window: null })), s = mkSat(el);
    const ps = passes(s, EP, 3).filter(p => 5 <= p.el);
    // the site is whatever the observer is; local time at the SITE's longitude is what a pass over it has
    const ps2 = []; {
      let open = null, best = -90, tBest = 0;
      const el2 = ms => { const pv = pvAt(s, ms); return sat.ecfToLookAngles({ latitude: site.lat * D2R, longitude: site.lon * D2R, height: 0 }, sat.eciToEcf(pv.position, sat.gstime(new Date(ms)))).elevation * R2D; };
      for (let ms = EP; ms <= EP + 3 * 86400000; ms += 15000) { const e = el2(ms); if (e >= 5) { if (open === null) { open = ms; best = -90; } if (e > best) { best = e; tBest = ms; } } else if (open !== null) { ps2.push({ el: best, mst: mlstAt(s, tBest) }); open = null; } }
    }
    const cd = (h, t) => { const d = Math.abs(((h - t) % 24 + 24) % 24); return Math.min(d, 24 - d); };
    const day = ps2.filter(p => cd(p.mst, c.lt_pass_day) <= c.pass_spread_h + 0.3), night = ps2.filter(p => cd(p.mst, (c.lt_pass_day + 12) % 24) <= c.pass_spread_h + 0.3);
    chk('A1 gt.sso.clock ' + nm + ' from ' + site.name + ': predicted ' + c.lt_pass_day.toFixed(2) + ' h; all ' + ps2.length + ' passes in 3 days (' + ps2.map(p => p.mst.toFixed(1)).join(' ') + ') fall within the spread (' + c.pass_spread_h.toFixed(2) + ' h) of it or of 12 h on',
      ps2.length > 0 && day.length + night.length === ps2.length && day.length > 0, '');
    /* and the prediction is the centre of the daytime passes, not just inside the spread: a branch or a sign wrong in passClock moves it by a quarter of an hour or more */
    const sgn = (h, t) => ((h - t + 36) % 24) - 12, meanDay = day.reduce((x, p) => x + sgn(p.mst, c.lt_pass_day), 0) / Math.max(1, day.length);
    chk('A1 gt.sso.clock ' + nm + ' from ' + site.name + ': lt_pass_day ' + c.lt_pass_day.toFixed(2) + ' is a daytime hour (within 6.3 h of noon: the night pass is not the one named)', cd(c.lt_pass_day, 12) <= 6.3);
    chk('A1 gt.sso.clock ' + nm + ' from ' + site.name + ': the mean of the ' + day.length + ' daytime passes is within 0.1 h of the predicted ' + c.lt_pass_day.toFixed(2) + ' (offset ' + meanDay.toFixed(3) + ' h)', Math.abs(meanDay) <= 0.1);
    if (site === BKK && ltanH === 10.5) near('A1 gt.sso.clock the daytime pass for LTAN 10:30 at 13.75 N is predicted at 10:22 (10.37 h); SGP4 puts its passes between 09:12 and 10:49', c.lt_pass_day, 10.37, 0.02);
  }
  const d1 = ctx(elOf(RE + 700, 0, +P.ssoInclination(RE + 700, 0).toFixed(4), { raan: P.raanFromLtan(6, EP) })), d2 = ctx(elOf(RE + 700, 0, +P.ssoInclination(RE + 700, 0).toFixed(4), { raan: P.raanFromLtan(12, EP) }));
  chk('A1 gt.sso.clock V19: dawn-dusk is predicted at 05:52 (SGP4: 05:53) and noon at 11:52', Math.abs(d1.lt_pass_day - 5.87) < 0.02 && Math.abs(d2.lt_pass_day - 11.87) < 0.02, d1.lt_pass_day.toFixed(3) + ' ' + d2.lt_pass_day.toFixed(3));
  const c0 = ctx(elOf(RE + 700, 0, 98.213, { raan: P.raanFromLtan(10.5, EP) }));
  chk('A1 pass_day_clock is the pass time on the site\'s clock: lt_pass_day + (tz - lon/15) (Bangkok: +7 h less 6.70 h)', Math.abs(((c0.pass_day_clock - c0.lt_pass_day - (7 - 100.52 / 15)) % 24 + 24) % 24) < 1e-9 || Math.abs(((c0.pass_day_clock - c0.lt_pass_day - (7 - 100.52 / 15)) % 24 + 24) % 24 - 24) < 1e-9);
});

/* ======================================================================================= */
/* Forms the way a student types them: 300 seeded, all valid for the planner, in every lens; the eleven presets. Built once, used by A2, A3 and A5. */
const SITES = [BKK, { name: 'Tromso', lat: 69.65, lon: 18.96, tz: 1 }, { name: 'Quito', lat: -0.18, lon: -78.5, tz: -5 }, { name: 'Hobart', lat: -42.88, lon: 147.33, tz: 10 }, { name: 'Kuala Lumpur', lat: 3.14, lon: 101.69, tz: 8 }];
function genForms(n, seed) {
  const R = rng(seed), U = (lo, hi) => lo + (hi - lo) * R(), LU = (lo, hi) => Math.exp(U(Math.log(lo), Math.log(hi))), pick = a => a[Math.floor(R() * a.length)];
  const out = []; let tries = 0;
  while (out.length < n && tries++ < n * 20) {
    const cls = R(), form = { shape: pick(['alt', 'ae', 'per']), nodeMode: R() < 0.3 ? 'ltan' : 'raan', name: 'Seeded ' + out.length, epoch: P.formatEpoch(EP + Math.round(U(-400, 400)) * 86400000 + Math.round(U(0, 86400)) * 1000) };
    let hp, ha;
    if (cls < 0.4) { hp = LU(160, 2000); ha = hp + (R() < 0.5 ? 0 : U(0, 25)); }
    else if (cls < 0.6) { hp = LU(160, 1500); ha = hp + LU(50, 7000); }
    else if (cls < 0.75) { hp = LU(2000, 60000); ha = hp + (R() < 0.6 ? 0 : LU(10, 20000)); }
    else if (cls < 0.85) { hp = LU(200, 20000); ha = hp + LU(5000, 90000); }
    else { hp = pick([35786.045, 35786.045 + U(-200, 200), 20182, 526, 24401.5]); ha = pick([hp, hp, 39826, 47170.4, hp + U(0, 100)]); if (ha < hp) ha = hp; }
    const rp = RE + hp, ra = RE + ha, a = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
    if (form.shape === 'alt') { form.hp = hp; form.ha = ha; } else if (form.shape === 'ae') { form.a = a; form.e = e; } else { form.period = P.periodMin(a); form.e = e; }
    form.inc = R() < 0.35 ? pick([0, 0.3, 5, 28.5, 51.64, 63.4, 90, 97.4, 98.2, 116.6, 160, 180]) : U(0, 180);
    if (R() < 0.15 && e < 0.05 && hp < 5900) { const si = P.ssoInclination(a, e); if (si !== null) form.inc = si; }
    form.raan = U(0, 360); form.ltan = U(0, 24); form.argp = R() < 0.4 ? 0 : U(0, 360); form.ma = U(0, 360);
    form.am = R() < 0.55 ? 0.0043 : R() < 0.1 ? pick([0, 0.5, 2]) : LU(0.0005, 0.1);
    const r = P.fromForm(form);
    if (!r.ok) continue;
    const env = { site: pick(SITES) };
    if (R() < 0.5) env.window = { startMs: r.el.epoch + U(-5, 12) * 86400000, hours: pick([6, 24, 168]) };
    if (R() < 0.5) { env.measured = { n: Math.floor(U(0, 12)), totalS: U(0, 7200), longestS: U(0, 900), bestEl: U(5, 90), altMin: U(100, 900), altMax: U(100, 900), surfSwing: U(0, 25), rSwing: U(0, 30) }; env.measured.altMax = Math.max(env.measured.altMax, env.measured.altMin); }
    out.push({ form, el: r.el, env });
  }
  return out;
}
const FORMS = genForms(300, 20261001);
const PRESETS = P.presets(BKK, EP).map(p => { const r = P.fromForm(p.form); return { key: p.key, form: p.form, craft: p.craft, el: r.el, ok: r.ok && r.notes.length === 0 }; });
const advStrict = (el, env, o) => A.advise(el, baseEnv(env), Object.assign({ strict: true }, o || {}));

group('A2 the lifetime model: Lifetime.integrate\'s unit, scaling, the eccentric march, the drag integral', () => {
  /* V15: Lifetime.integrate takes 1000 x (Cd A/m): lifeCirc hides the unit */
  for (const [h, B, d] of [[500, 0.0165, 1129.73], [400, 0.0165, 187.55], [300, 0.0165, 23.49], [600, 0.005, 19014.04]]) near('A2 V15 lifeCirc(Re + ' + h + ', B ' + B + ') = ' + d + ' days', K.lifeCirc(RE + h, B).days, d, 0.02);
  chk('A2 V15 the unit trap: Lifetime.integrate with B unscaled returns null (more than 40,000 days), with the 1000 it does not; lifeCirc agrees with the scaled call', L.integrate(RE + 500, 0.0165, 120).days === null && L.integrate(RE + 500, 16.5, 120).days > 1000 && K.lifeCirc(RE + 500, 0.0165).days === L.integrate(RE + 500, 16.5, 120).days);
  near('A2 V15 T(3B) = T(B) / 3 to 1e-6 relative (circular)', K.lifeCirc(RE + 500, 0.0165, 3).days * 3 / K.lifeCirc(RE + 500, 0.0165).days, 1, 1e-6);
  near('A2 V15 T(B / 3) = 3 T(B) to 1e-6 relative (circular)', K.lifeCirc(RE + 500, 0.0165, 1 / 3).days / 3 / K.lifeCirc(RE + 500, 0.0165).days, 1, 1e-6);
  for (const [h, B] of [[500, 0.0165], [200, 2.2 * 0.05]]) {
    const le = K.lifeEcc(RE + h, 1e-9, B, 1, 120, 40000).days, li = K.lifeCirc(RE + h, B).days;
    chk('A2 V15 lifeEcc(e = 1e-9) at ' + h + ' km equals the circular march to 2e-4 relative (the port misses by 1.2e-5 at 500 km and 1.0e-4 for the short 200 km life)', Math.abs(le / li - 1) <= 2e-4, 'ratio - 1 = ' + (le / li - 1).toExponential(2));
  }
  /* the drag integral against a 32,768-node whole-orbit reference written here */
  const rho = h => h > 1000 ? 0 : L.rho(Math.max(h, 0));
  const dragRef = (a, e, B, N) => {
    const aM = a * 1000; let da = 0, de = 0;
    for (let k = 0; k < N; k++) {
      const E = 2 * Math.PI * (k + 0.5) / N, ce = Math.cos(E), r = aM * (1 - e * ce), h = r / 1000 - RE, v2 = MU_SI * (2 / r - 1 / aM), v = Math.sqrt(v2), cn = (ce - e) / (1 - e * ce), f = 0.5 * rho(h) * B * v2, w = (1 - e * ce) / N;
      da += -2 * aM * aM * v * f / MU_SI * w; de += -2 * f * (e + cn) / v * w;
    }
    return { da: da / 1000 * 86400, de: de * 86400 };
  };
  let worstLow = 0, worstHigh = 0, worstOld = 0, nD = 0, nOld = 0;
  for (const hp of [120, 200, 300, 500, 800, 950]) for (const ha of [hp + 1, hp + 50, 1000, 2000, 5000, 20000, 35786, 100000, 200000, 400000]) {
    if (ha <= hp) continue;
    const rp = RE + hp, ra = RE + ha, a = (rp + ra) / 2, e = (ra - rp) / (ra + rp), B = 2.2 * 0.0043;
    const ref = dragRef(a, e, B, 32768), got = K.dragAvg(a, e, B, 1);
    if (!(Math.abs(ref.da) > 0)) continue;
    const err = Math.abs(got.dadt_kmday / ref.da - 1); nD++;
    if (hp <= 500) worstLow = Math.max(worstLow, err); else worstHigh = Math.max(worstHigh, err);
    if (ha <= 1000) { worstOld = Math.max(worstOld, Math.abs(got.dadt_kmday / dragRef(a, e, B, 96).da - 1)); nOld++; }
  }
  chk('A2 V15 dragAvg against a 32,768-node whole-orbit reference over ' + nD + ' orbits (hp 120..950, ha to 400,000 km): at most 5e-4 relative for hp <= 500, 2e-3 for hp 800 and 950',
    nD >= 50 && worstLow <= 5e-4 && worstHigh <= 2e-3, 'worst ' + worstLow.toExponential(2) + ' (hp <= 500), ' + worstHigh.toExponential(2) + ' (hp > 500)');
  chk('A2 V15 ... and with the apogee under 1,000 km it is the old 96-node whole-orbit rule to 1e-12 (' + nOld + ' orbits)', nOld >= 10 && worstOld <= 1e-12, 'worst ' + worstOld.toExponential(2));
  /* the decision table: every reason, first match */
  const why = (el) => { const l = A.life(el, { tracks: false }); return l.model + '/' + l.why; };
  chk('A2 life: no area over mass known -> none/no-drag, no figure', why(elOf(RE + 500, 0, 51.6, { am: null })) === 'none/no-drag' && A.life(elOf(RE + 500, 0, 51.6, { am: null })).mid === undefined);
  const zero = A.life(elOf(RE + 500, 0, 51.6, { am: 0 }));
  chk('A2 life: area over mass 0 -> none/no-drag with every figure Infinity', zero.model === 'none' && zero.why === 'no-drag' && zero.mid === Infinity && zero.lo === Infinity && zero.hi === Infinity);
  chk('A2 life: perigee under 120 km -> none/reentry (before anything else, a deep or an eccentric orbit too)', why(elHH(100, 100, 51.6)) === 'none/reentry' && why(elHH(100, 30000, 51.6)) === 'none/reentry' && why(elHH(119.9, 400, 51.6)) === 'none/reentry');
  chk('A2 life: a Kepler period of 225 minutes or more -> none/deep, even for a circular orbit', why(elOf(P.DEEP_A_KM + 1, 0, 50)) === 'none/deep' && why(elOf(26554.137, 0.74, 63.4)) === 'none/deep' && why(elOf(P.GEO_A_KM, 0, 0)) === 'none/deep' && why(elOf(P.DEEP_A_KM - 1, 0, 50)) === 'none/high-perigee');
  chk('A2 life: perigee above 1,000 km -> none/high-perigee (circular 1,500 km, an eccentric 1,200 x 2,000 km)', why(elHH(1500, 1500, 51.6)) === 'none/high-perigee' && why(elHH(1200, 2000, 51.6)) === 'none/high-perigee' && why(elHH(1000.5, 1000.5, 51.6)) === 'none/high-perigee' && why(elHH(999, 999, 51.6)) === 'circular/null');
  chk('A2 life: e under 0.002 -> circular; at 0.002 and above the eccentric march (up to apogee 5,000 km and e 0.3)', why(elOf(RE + 500, 0.0019, 51.6)) === 'circular/null' && why(elOf(RE + 500, 0.002, 51.6)) === 'eccentric/null' && why(elHH(300, 4999, 51.6)) === 'eccentric/null' && why(elHH(130, 4999, 51.6)) === 'eccentric/null');
  chk('A2 life: apogee above 5,000 km -> none/high-apogee; e above 0.3 -> none/ecc-high (that test is reached first, or it could never answer: e > 0.3 puts the apogee above 5,690 km)', why(elHH(500, 6000, 51.6)) === 'none/high-apogee' && why(elHH(300, 5001, 51.6)) === 'none/high-apogee' && why(elHH(130, 6000, 51.6)) === 'none/ecc-high' && why(elHH(300, 9000, 51.6)) === 'none/ecc-high');
  /* continuity across the model boundary at e = 0.002 */
  const cont = [400, 500, 600].map(h => { const c1 = A.life(elOf(RE + h, 0.0019, 51.6, { am: 0.0043 }), { tracks: false }), c2 = A.life(elOf(RE + h, 0.002, 51.6, { am: 0.0043 }), { tracks: false }); return { h, r: c2.mid / c1.mid, m: c1.model + '>' + c2.model }; });
  chk('A2 life: the circular and eccentric models meet at e = 0.002 within 2 % (400 / 500 / 600 km: ' + cont.map(c => c.r.toFixed(4)).join(' / ') + ')', cont.every(c => Math.abs(c.r - 1) < 0.02 && c.m === 'circular>eccentric'));
  /* the band is symmetric: a factor of three either way */
  for (const [nm, el] of [['circular 500 km', elOf(RE + 500, 0, 51.6)], ['circular 350 km', elOf(RE + 350, 0, 51.6)], ['eccentric 400 x 1,400 km at 0.02', elHH(400, 1400, 51.6, { am: 0.02 })], ['eccentric 300 x 2,800 km at 0.02', elHH(300, 2800, 51.6, { am: 0.02 })]]) {
    const l = A.life(el), tol = l.model === 'circular' ? 1e-6 : 1e-12;
    chk('A2 life ' + nm + ': lo = mid / 3 and hi = 3 mid (drag x3 / x1 / x1/3, a factor of 3 either way, the same distance on a log scale)', l.hi !== Infinity && Math.abs(l.lo * 3 / l.mid - 1) < tol + 1e-12 && Math.abs(l.hi / 3 / l.mid - 1) < tol + 1e-12, 'lo ' + (l.lo / 365.25).toFixed(3) + ' mid ' + (l.mid / 365.25).toFixed(3) + ' hi ' + (l.hi / 365.25).toFixed(3) + ' y');
    chk('A2 life ' + nm + ': a track for each run, in days since the epoch from the epoch height, the slow run the longest', l.track[0].t === 0 && Math.abs(l.track[0].h - l.h0) < 1e-6 && l.fastTrack.length > 1 && l.slowTrack.length > 1 && l.slowTrack[l.slowTrack.length - 1].t > l.track[l.track.length - 1].t && l.fastTrack[l.fastTrack.length - 1].t < l.track[l.track.length - 1].t && l.capDays === 40000 && l.rate0 < 0);
  }
  /* T(kB) = T(B)/k for the eccentric march to 1e-4: a second, independent march at 3 B */
  for (const [hp, ha] of [[400, 800], [300, 2800], [500, 1500]]) {
    const el = elHH(hp, ha, 51.6, { am: 0.02 }), l = A.life(el, { tracks: false }), B = 2.2 * 0.02;
    const fast = K.lifeEcc(el.a, el.e, B, 3, 120, 40000).days, slow = K.lifeEcc(el.a, el.e, B / 3, 1, 120, 40000).days;
    chk('A2 life: the eccentric march at 3 B (and at B / 3) takes mid / 3 (and 3 mid) to 1e-4 relative: ' + hp + ' x ' + ha + ' km', Math.abs(fast * 3 / l.mid - 1) < 1e-4 && (slow === null ? l.hi === Infinity : Math.abs(slow / 3 / l.mid - 1) < 1e-4), 'x3 ' + (fast * 3 / l.mid - 1).toExponential(1) + ', x1/3 ' + (slow === null ? 'cap' : (slow / 3 / l.mid - 1).toExponential(1)));
  }
  /* an open-ended band: a long-lived eccentric orbit has hi = Infinity and lo from a second march */
  const longE = A.life(elHH(800, 1500, 51.6, { am: 0.0012 }), { tracks: false });
  chk('A2 life: an eccentric orbit that outlives the cap has mid, hi = Infinity and a finite or open lo from its own x3 march', longE.model === 'eccentric' && longE.mid === Infinity && longE.hi === Infinity && longE.lo > 30000);
  /* reference values at the typical satellite: an SI-units time march with its own step control (Lifetime.integrate marches in altitude) */
  const siDays = (h0, B, floorKm) => {
    const f = x => rho(x / 1000 - RE) * B * Math.sqrt(MU_SI * x); let a = (RE + h0) * 1000, t = 0;
    while (a / 1000 - RE > floorKm && t < 40000 * 86400) { const dt = Math.max(1, Math.min(86400, 400 / f(a))), k1 = f(a), k2 = f(a - dt * k1 / 2), k3 = f(a - dt * k2 / 2), k4 = f(a - dt * k3); a -= dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4); t += dt; }
    return t >= 40000 * 86400 ? Infinity : t / 86400;
  };
  const refTbl = [[250, [4, 'd'], [11, 'd'], [33, 'd']], [300, [14, 'd'], [41, 'd'], [4.0, 'mo']], [350, [41, 'd'], [4.0, 'mo'], [12, 'mo']], [400, [3.6, 'mo'], [10.7, 'mo'], [2.7, 'y']], [450, [9.0, 'mo'], [2.3, 'y'], [6.8, 'y']],
    [500, [1.8, 'y'], [5.4, 'y'], [16, 'y']], [550, [4.1, 'y'], [12, 'y'], [37, 'y']], [600, [9.2, 'y'], [27, 'y'], [82, 'y']], [650, [20, 'y'], [59, 'y'], [Infinity, 'y']], [700, [41, 'y'], [Infinity, 'y'], [Infinity, 'y']]];
  const unit = { d: 1, mo: 30.4375, y: 365.25 }, bad = [], siBad = [];
  for (const [h, lo, mid, hi] of refTbl) {
    const l = A.life(elOf(RE + h, 0, 51.6, { am: 0.0043 }), { tracks: false });
    [[lo, l.lo], [mid, l.mid], [hi, l.hi]].forEach(([want, got]) => {
      const v = want[0] * unit[want[1]];
      if (want[0] === Infinity) { if (got !== Infinity) bad.push(h + ' km expected more than a century, got ' + (got / 365.25).toFixed(1) + ' y'); return; }
      const digit = String(want[0]).indexOf('.') >= 0 ? 0.05 : want[0] >= 10 ? 1 : 0.5, tol = Math.max(0.005 * v, digit * unit[want[1]]);     // whole numbers of years are the design's loose rounding (27.5 is printed 27)
      if (Math.abs(got - v) > tol) bad.push(h + ' km ' + want[0] + ' ' + want[1] + ' vs ' + (got / unit[want[1]]).toFixed(2));
    });
    if (h <= 600) { const si = siDays(h, 2.2 * 0.0043, 120); if (Math.abs(si / l.mid - 1) > 0.005) siBad.push(h + ' km SI ' + si.toFixed(1) + ' vs ' + l.mid.toFixed(1)); }
  }
  chk('A2 the reference values of 4.6 (250..700 km, drag x3 / x1 / x1/3 at the typical satellite, am 0.0043), each to the digit shown (or 0.5 %)', bad.length === 0, bad.join(' | '));
  chk('A2 the mid-case lifetime of 250..600 km is within 0.5 % of an SI-units RK4 time march with its own step control (not the altitude march Lifetime.integrate uses)', siBad.length === 0, siBad.join(' | '));
  const otherCrafts = [[420, 0.0012, 1.6, 4.7, 14], [500, 0.009, 10.3 / 12, 2.6, 7.7], [360, 0.0045, 47 / 365.25, 4.7 / 12, 1.2], [700, 0.010, 17.5, 52, Infinity]];
  chk('A2 other crafts: 0.0012 at 420 km 1.6 / 4.7 / 14 y; 0.009 at 500 km 10.3 mo / 2.6 / 7.7 y; 0.0045 at 360 km 47 d / 4.7 mo / 1.2 y; 0.010 at 700 km 17.5 y / 52 y / more than a century',
    otherCrafts.every(([h, am, lo, mid, hi]) => { const l = A.life(elOf(RE + h, 0, 51.6, { am }), { tracks: false }); const ok = (g, w) => w === Infinity ? g === Infinity : Math.abs(g / 365.25 / w - 1) < 0.04; return ok(l.lo, lo) && ok(l.mid, mid) && ok(l.hi, hi); }));
});

group('A2 the fixes: raise to / lower to heights, their rounding, their absence, and what the dictionary computes only when asked', () => {
  const typ = elOf(RE + 600, 0, 51.6, { am: 0.0043 });
  const c = ctx(typ);
  /* the unrounded heights, by a bisection written here on Lifetime.integrate itself */
  const T = (h, am) => { const d = L.integrate(RE + h, 1000 * 2.2 * am, 120, false).days; return d === null ? Infinity : d; };
  const root = (am, days) => { let lo = 150, hi = 1000; for (let k = 0; k < 45; k++) { const m = (lo + hi) / 2; if (T(m, am) < days) lo = m; else hi = m; } return (lo + hi) / 2; };
  const y = 365.25;
  near('A2 fix heights, unrounded at the typical satellite: a mid-case 2 years is 443.2 km', root(0.0043, 2 * y), 443.2, 0.1);
  near('A2 ... a mid-case 5 years is 495.5 km', root(0.0043, 5 * y), 495.5, 0.1);
  near('A2 ... a mid-case 25 years is 594.0 km', root(0.0043, 25 * y), 594.0, 0.1);
  for (const [days, want] of [[2 * y, 443.2], [5 * y, 495.5], [25 * y, 594.0]]) near('A2 kernel fixHeight (' + (days / y) + ' years, typical) is the unrounded root to 1e-4 km', K.fixHeight(0.0043, days), root(0.0043, days), 1e-4, '(' + want + ')');
  chk('A2 fix_h 450 (raised, round UP to 10), fix_h25 590 and fix_h5 490 (lowered, round DOWN to 10) at the typical satellite; fix_life is the mid-case life there, 2.3 years', c.fix_h === 450 && c.fix_h25 === 590 && c.fix_h5 === 490 && Math.abs(c.fix_life / y - 2.3) < 0.05, JSON.stringify([c.fix_h, c.fix_h25, c.fix_h5, c.fix_life]));
  chk('A2 each gives the life it names, never above the 25- and 5-year targets: T(590) <= 25 y < T(600), T(490) <= 5 y < T(500), T(450) >= 2 y > T(440)', T(590, 0.0043) <= 25 * y && T(600, 0.0043) > 25 * y && T(490, 0.0043) <= 5 * y && T(500, 0.0043) > 5 * y && T(450, 0.0043) >= 2 * y && T(440, 0.0043) < 2 * y);
  /* other crafts */
  for (const am of [0.0012, 0.009, 0.0043, 0.05]) {
    const cc = ctx(elOf(RE + 600, 0, 51.6, { am })), r2 = root(am, 2 * y), r5 = root(am, 5 * y), r25 = root(am, 25 * y);
    chk('A2 fix heights at am ' + am + ': fix_h = ceil(' + r2.toFixed(1) + '), fix_h5 = floor(' + r5.toFixed(1) + '), fix_h25 = floor(' + r25.toFixed(1) + ') to 10 km',
      cc.fix_h === Math.ceil(r2 / 10) * 10 && cc.fix_h5 === Math.floor(r5 / 10) * 10 && cc.fix_h25 === Math.floor(r25 / 10) * 10, JSON.stringify([cc.fix_h, cc.fix_h5, cc.fix_h25]));
  }
  /* absence */
  chk('A2 fix_h is undefined at am 8 (a two-year orbit needs am below about 5), fix_h25 at am 0.5 (below about 0.5); the others stay', ctx(elOf(RE + 300, 0, 51.6, { am: 8 })).fix_h === undefined && ctx(elOf(RE + 300, 0, 51.6, { am: 0.5 })).fix_h25 === undefined && ctx(elOf(RE + 300, 0, 51.6, { am: 0.5 })).fix_h5 !== undefined && ctx(elOf(RE + 300, 0, 51.6, { am: 8 })).fix_life === undefined);
  chk('A2 fix_hp: undefined at hp 100 x ha 130; 430 (not 500) at hp 150 x ha 450; 500 at 150 x 5,000; the circular two-year height for a circular orbit; undefined where fix_h is',
    ctx(elHH(100, 130, 51.6)).fix_hp === undefined && ctx(elHH(150, 450, 51.6)).fix_hp === 430 && ctx(elHH(150, 5000, 51.6)).fix_hp === 500 && ctx(elOf(RE + 90, 0, 51.6)).fix_hp === 450 && ctx(elOf(RE + 90, 0, 51.6, { am: 8 })).fix_hp === undefined);
  chk('A2 the lifetime keys exist only where the model does: nothing for a decayed, deep, high-perigee or no-drag orbit; an eccentric 300 x 5000 km has a life and no circular fix', (() => {
    const has = el => ctx(el).life_mid !== undefined;
    const e5 = ctx(elHH(300, 5000, 51.6, { am: 0.0043 }));
    return !has(elHH(90, 90, 51.6)) && !has(elOf(P.GEO_A_KM, 0, 0)) && !has(elHH(1500, 1500, 51.6)) && !has(elOf(RE + 500, 0, 51.6, { am: 0 })) && !has(elOf(RE + 500, 0, 51.6, { am: null })) && has(elHH(300, 5000, 51.6)) &&
      e5.fix_h === undefined && e5.fix_h25 === undefined && e5.fix_hp === 500;
  })());
  chk('A2 am_max: 2 significant digits, never below 0.001 (0.61 at 120 km .. 8.2 m2/kg at 700 km; undefined above 1,000 km where B* carries no drag)', (() => {
    const am = h => ctx(elOf(RE + h, 0, 51.6)).am_max, two = x => Number(x.toPrecision(2)) === x;
    return Math.abs(am(120) - 0.61) <= 0.011 && Math.abs(am(200) - 0.74) <= 0.011 && Math.abs(am(400) - 1.1) <= 0.011 && Math.abs(am(500) - 2.0) <= 0.021 && Math.abs(am(600) - 4.1) <= 0.051 && Math.abs(am(700) - 8.2) <= 0.11 && [120, 200, 400, 500, 600, 700, 900].every(h => two(am(h)) && am(h) >= 0.001) && am(1200) === undefined && ctx(elOf(RE + 90, 0, 51.6)).am_max === am(120);
  })());
  /* laziness: the bisections run only when an item that fires reads them */
  const calls = {}, orig = {};
  ['fixHeight', 'repeatNear', 'repeatSolve', 'lifeEcc', 'lifeCirc', 'eclipseYear'].forEach(k => { orig[k] = K[k]; K[k] = function () { calls[k] = (calls[k] || 0) + 1; return orig[k].apply(this, arguments); }; });
  const count = (name, fn) => { for (const k in calls) delete calls[k]; fn(); return Object.assign({}, calls); };
  try {
    const none = count('ctx only', () => { const cx = ctx(elOf(RE + 500, 0, 51.6)); void cx.hp; });
    chk('A2 lazy: building the dictionary for a circular 500 km orbit runs no fix bisection (fixHeight 0 calls), and the life itself is three circular marches, no eccentric one', !none.fixHeight && none.lifeCirc === 3 && !none.lifeEcc, JSON.stringify(none));
    const reads = count('read fix_h', () => { const cx = ctx(elOf(RE + 500, 0, 51.6)); void cx.fix_h; void cx.fix_h; void cx.fix_life; });
    chk('A2 lazy: reading fix_h twice and fix_life once costs one bisection (the value is kept)', reads.fixHeight === 1, JSON.stringify(reads));
    const lg = count('life.long', () => { const r = advStrict(elOf(RE + 700, 0, 98.213, { raan: 100 }), {}); chk('A2 lazy: (life.long fired)', r.items.some(i => i.id === 'life.long' && i.fixes.length === 2)); });
    chk('A2 lazy: life.long at 700 km works out the 25-year and the 5-year heights and not the 2-year one (two bisections)', lg.fixHeight === 2, JSON.stringify(lg));
    const dy = count('life.days', () => { advStrict(elOf(RE + 200, 0, 51.6), {}); });
    chk('A2 lazy: life.days at 200 km works out the two-year height once (one bisection)', dy.fixHeight === 1, JSON.stringify(dy));
    const quiet = count('no life item', () => { advStrict(elOf(RE + 450, 0, 51.64, { am: 0.0012 }), {}); });
    chk('A2 lazy: an ISS-like orbit (life.range) works out no fix height at all', !quiet.fixHeight, JSON.stringify(quiet));
    const ey = count('eccentric', () => { ctx(elOf(RE + 500, 0.01, 51.6)); });
    chk('A2 lazy: an eccentric orbit samples the eclipse year once and marches the lifetime once', ey.eclipseYear === 1 && ey.lifeEcc === 1, JSON.stringify(ey));
  } finally { Object.keys(orig).forEach(k => { K[k] = orig[k]; }); }
  /* fixes with an undefined key leave the item in place */
  const no = advStrict(elOf(RE + 300, 0, 51.6, { am: 8 }), {});
  const d8 = no.items.find(i => i.id === 'life.days');
  chk('A2 absence: at am 8 and 300 km life.days still fires, with no button; no firing item is dropped for the want of a fix (dropped.items stays 0)', !!d8 && d8.fixes.length === 0 && no.dropped.items.length === 0 && no.dropped.fixes.some(f => f.id === 'life.days'));
  /* direction: 500 .. 640 km in 5 km steps at the typical satellite */
  const bad = [], pres = [];
  for (let h = 500; h <= 640; h += 5) {
    const r = advStrict(elOf(RE + h, 0, 51.6, { am: 0.0043 }), {}), cx = r.c;
    r.items.forEach(it => it.fixes.forEach(f => {
      const raise = /^Raise\b/.test(f.labelText), lower = /^Lower\b/.test(f.labelText);
      if ((raise || lower) && typeof f.set.hp === 'number') {
        if (raise && !(f.set.hp > cx.hp + 5 && (f.set.ha === undefined || f.set.ha > cx.ha + 5))) bad.push(h + ' ' + f.labelText);
        if (lower && !(f.set.hp < cx.hp - 5 && (f.set.ha === undefined || f.set.ha < cx.ha - 5))) bad.push(h + ' ' + f.labelText);
      }
    }));
    if (h === 550) pres.push(r.items.find(i => i.id === 'life.long').fixes.map(f => f.labelText));
  }
  chk('A2 direction: from 500 to 640 km in 5 km steps, a button that says Raise or Lower moves hp and ha that way by more than 5 km', bad.length === 0, bad.slice(0, 4).join(' | '));
  chk('A2 direction: at 550 km (typical) there is no 25-year button and "Lower it to 490 km (about 5 years)" is there', pres.length === 1 && JSON.stringify(pres[0]) === JSON.stringify(['Lower it to 490 km (about 5 years)']), JSON.stringify(pres));
  const at = h => advStrict(elOf(RE + h, 0, 51.6, { am: 0.0043 }), {}).items.find(i => i.id === 'life.long');
  chk('A2 direction: the 25-year button appears once the orbit is more than 5 km above 590 km (595 no, 600 yes), the 5-year one from 500 km up', at(595).fixes.length === 1 && at(600).fixes.length === 2 && at(600).fixes[0].labelText === 'Lower the orbit to 590 km (about 25 years)' && at(530).fixes.length === 1);
});

/* ======================================================================================= */
/* The real dictionary, for the catalogue's own checks: a planner form -> an element set -> A.context. A form the planner would refuse only for
   SGP4 near 180 degrees or for too much drag is still given a dictionary (the Professor has things to say about it; the Add button is what is blocked). */
function elFromForm(form) {
  const base = Object.assign({ shape: form.a !== undefined ? 'ae' : 'alt', nodeMode: 'raan', epoch: '2026-10-01T12:00:00', am: 0.0043, argp: 0, ma: 0, raan: 0 }, form);
  const r = P.fromForm(base);
  if (r.el) return r.el;
  const soft = { 'sgp4.retro': 1, 'err.bstar.range': 1 };
  if (r.derived && r.errors.every(x => soft[x.code])) {
    const d = r.derived;
    return { a: d.a, e: d.e, i: +base.inc, raan: d.raan, argp: +base.argp, M: +base.ma, epoch: P.parseEpoch(base.epoch).value, am: +base.am, bstar: d.bstar };
  }
  throw new Error('the planner refuses this form: ' + r.errors.map(x => x.code).join(','));
}
const realContext = (form, env) => A.context(elFromForm(form), Object.assign({ nowMs: EP, sat }, env || {}));
const ids = r => r.items.map(i => i.id);
const warnUp = r => r.items.filter(i => i.sev === 'warn' || i.sev === 'bad' || i.sev === 'error').map(i => i.id);

group('A3 the catalogue on the real dictionary: advisor-copy-checks.js, run with this advisor\'s context', () => {
  chk('A3 ITEMS.length === 87 (67 advisory, 20 input), ids unique', AC.ITEMS.length === 87 && AC.ITEMS.filter(i => i.group !== 'input').length === 67 && new Set(AC.ITEMS.map(i => i.id)).size === 87);
  const sum = CC.run(chk, { context: realContext, Planner: P });
  chk('A3 advisor-copy-checks ran its ' + sum.scenarios + ' orbits, ' + sum.grid + ' grid orbits and ' + sum.random + ' seeded forms on the real dictionary; every one of the 67 advisory items fired (' + sum.fired + ')', sum.items === 87 && sum.grid === 851 && sum.random >= 395 && sum.fired === 67);
});

/* ---- the orbits only this file knows to ask about ---- */
const farMa = wrap360(BKK.lon + 180 + P.gmstDeg(EP));
let RENDERED = [];
const SCN = [
  { name: 'GTO 250 x 35,786 km at 7 degrees: a Molniya-like period (632 min), so a Check', form: { hp: 250, ha: 35786, inc: 7 }, fire: ['kind.heo', 'kind.heo.drift'], sev: { 'kind.heo.drift': 'warn' } },
  { name: '300 x 12,000 km at 7 degrees (233 min, outside 600-780): a Note', form: { hp: 300, ha: 12000, inc: 7 }, fire: ['kind.heo', 'kind.heo.drift'], sev: { 'kind.heo.drift': 'info' } },
  { name: 'a 1,000 minute orbit with e 0.5 at 30 degrees: a Note', form: { a: P.aFromPeriodMin(1000), e: 0.5, inc: 30 }, fire: ['kind.heo', 'kind.heo.drift'], sev: { 'kind.heo.drift': 'info' } },
  { name: 'a Molniya at 55 degrees: Check, the fix is the critical inclination', form: { a: 26554.137, e: 0.74, inc: 55, argp: 270 }, fire: ['kind.heo', 'kind.heo.drift'], not: ['kind.molniya'], sev: { 'kind.heo.drift': 'warn' }, buttons: { 'kind.heo.drift': ['Set i to 63.4° (critical inclination)'] } },
  { name: 'a Molniya at the retrograde critical inclination, 116.6: still a Molniya (fold(i) is within 3 degrees of 63.4)', form: { a: 26554.137, e: 0.74, inc: 116.6, argp: 270 }, fire: ['kind.molniya', 'kind.retro'], not: ['kind.heo'] },
  { name: 'SGP4 near 180 degrees, e 1e-4: 8.6 km, a Note', form: { a: 7000, e: 1e-4, inc: 179.99 }, fire: ['sgp4.retro'], sev: { 'sgp4.retro': 'info' } },
  { name: 'SGP4 near 180 degrees, e 5e-4: 43 km, a Check', form: { a: 7000, e: 5e-4, inc: 179.99 }, fire: ['sgp4.retro'], sev: { 'sgp4.retro': 'warn' } },
  { name: 'SGP4 near 180 degrees, e 0.01: 857 km, Fix this', form: { a: 7000, e: 0.01, inc: 179.99 }, fire: ['sgp4.retro'], sev: { 'sgp4.retro': 'error' }, buttons: { 'sgp4.retro': ['Set i to 180° exactly', 'Set e to 0'] } },
  { name: 'SGP4 near 180 degrees, e 1e-5: 0.86 km is under the 1 km line', form: { a: 7000, e: 1e-5, inc: 179.99 }, not: ['sgp4.retro'] },
  { name: 'i exactly 180 or e 0: nothing to say about SGP4', form: { a: 7000, e: 0.01, inc: 180 }, not: ['sgp4.retro'] },
  { name: 'circular 300 km: a mid-case life of 41 days is short-lived, not "within weeks" (the line is 30 days)', form: { hp: 300, ha: 300, inc: 51.6 }, fire: ['life.short'], not: ['life.days'] },
  { name: 'circular 270 km: a mid-case life under 30 days comes down within weeks', form: { hp: 270, ha: 270, inc: 51.6 }, fire: ['life.days'], not: ['life.short'] },
  { name: 'perigee 90 km circular: re-entry, one button at the two-year height', form: { hp: 90, ha: 90, inc: 51.6 }, fire: ['life.reentry'], not: ['life.days', 'rad.saa'], buttons: { 'life.reentry': ['Raise perigee to 450 km'] } },
  { name: 'perigee 100 x apogee 1,000 km: re-entry, the button keeps the apogee (perigee to 500 km)', form: { hp: 100, ha: 1000, inc: 51.6 }, fire: ['life.reentry'], buttons: { 'life.reentry': ['Raise perigee to 500 km'] } },
  { name: 'perigee 200 x apogee 2,000 km: about a year, so short-lived and skimming the air; the perigee button leaves the apogee', form: { hp: 200, ha: 2000, inc: 60 }, fire: ['life.ecc.low', 'life.short'], not: ['life.long', 'life.ecc'], buttons: { 'life.ecc.low': ['Raise perigee to 500 km'] } },
  { name: 'perigee 310 x apogee 4,900 km: long-lived, with no circular button (an eccentric orbit)', form: { hp: 310, ha: 4900, inc: 51.6 }, fire: ['life.long'], not: ['life.ecc', 'life.ecc.low'], buttons: { 'life.long': [] } },
  { name: 'no drag at all (am 0): the drag item and every life item stay silent, cav.am.zero speaks', form: { hp: 500, ha: 500, inc: 51.6, am: 0 }, fire: ['cav.am.zero'], not: ['cav.drag.assumed', 'life.range', 'life.short', 'life.long', 'life.permanent', 'life.days'] },
  { name: 'ISS-like at 420 km with the station\'s own drag: a range, no lifetime fix', form: { hp: 420, ha: 420, inc: 51.64, am: 0.0012 }, fire: ['kind.iss', 'life.range'], not: ['life.long', 'life.short'], buttons: { 'life.range': [] } },
  { name: 'a sun-synchronous orbit one degree off: near, with the SGP4-root button', form: { hp: 700, ha: 700, inc: 97.2 }, fire: ['kind.sso.near'], not: ['kind.sso'], buttons: { 'kind.sso.near': ['Set i to 98.21° (sun-synchronous at this altitude)'] } },
  { name: 'geostationary placed on the far side of the Earth from the observer: below the horizon, and the button moves it over the site', form: { hp: 35786.045, ha: 35786.045, inc: 0, ma: farMa }, fire: ['kind.geo', 'gt.geo.down'], not: ['gt.geo.up'], buttons: { 'gt.geo.down': ['Move it over Bangkok’s longitude (100.5°E)'] } },
  { name: 'a circular 600 km orbit at 63.4 degrees: critical inclination without apsides', form: { hp: 600, ha: 600, inc: 63.4 }, fire: ['kind.critical'], not: ['kind.heo.drift', 'kind.molniya'] },
  { name: 'an apogee over 100,000 km: the Moon-ward caveat and the deep-space one', form: { hp: 100000, ha: 250000, inc: 20 }, fire: ['cav.highorbit', 'cav.deep', 'kind.heo'] },
  { name: 'the tracked spacecraft on the read-only host: no fix is offered and no drafting item speaks', form: { hp: 500, ha: 500, inc: 51.6 }, env: { tracked: true }, host: 'readonly', fire: ['life.tracked', 'kind.leo.circ'], not: ['cav.drag.assumed', 'life.range', 'cav.mean'] }
];

group('A3 more orbits: the Check and Note branches, the buttons, and the keys left undefined', () => {
  const problems = [], seen = [];
  for (const s of SCN) {
    let r;
    try { r = A.advise(elFromForm(s.form), baseEnv(Object.assign({ site: s.site || BKK }, s.env || {})), { strict: true, host: s.host }); } catch (e) { problems.push(s.name + ' threw ' + e.message); continue; }
    const got = ids(r); seen.push(got);
    (s.fire || []).forEach(id => { if (got.indexOf(id) < 0) problems.push(s.name + ': ' + id + ' did not fire (fired ' + got.join(' ') + ')'); });
    (s.not || []).forEach(id => { if (got.indexOf(id) >= 0) problems.push(s.name + ': ' + id + ' fired'); });
    Object.keys(s.sev || {}).forEach(id => { const it = r.items.find(x => x.id === id); if (!it || it.sev !== s.sev[id]) problems.push(s.name + ': ' + id + ' is ' + (it ? it.sev : 'missing') + ', expected ' + s.sev[id]); });
    Object.keys(s.buttons || {}).forEach(id => { const it = r.items.find(x => x.id === id), labs = it ? it.fixes.map(f => f.labelText) : null; if (JSON.stringify(labs) !== JSON.stringify(s.buttons[id])) problems.push(s.name + ': ' + id + ' buttons ' + JSON.stringify(labs) + ', expected ' + JSON.stringify(s.buttons[id])); });
    if (r.dropped.items.length) problems.push(s.name + ': items dropped ' + JSON.stringify(r.dropped.items));
    r.items.forEach(it => { CC.voiceProblems(it.titleText, 'title').concat(CC.voiceProblems(it.bodyText, 'body')).forEach(p => problems.push(s.name + ' ' + it.id + ': ' + p)); });
  }
  chk('A3 ' + SCN.length + ' hand-made orbits: what must fire does, what must not does not, severities and buttons as written, nothing dropped, every text passes the voice rules', problems.length === 0, problems.slice(0, 4).join(' | '));
  const ids2 = SCN.map(s => s.name);
  chk('A3 a Molniya at 55 degrees and a GTO at 7 degrees are a Check (their periods are Molniya-like), a 233-minute and a 1,000-minute orbit are a Note: the design said "a GTO at 7 degrees (Note)", which the period window contradicts', ids2.length === SCN.length);
  /* the keys left undefined mean what they say */
  const am0 = ctx(elOf(RE + 500, 0, 51.6, { am: 0 })), none = ctx(elOf(RE + 500, 0, 51.6, { am: null })), geo = ctx(elOf(P.GEO_A_KM, 0, 0));
  chk('A3 am 0: the life keys are undefined (not Infinity: cav.drag.assumed would print "B* = 0.00e+0" and say the lifetime halves), bstar is 0; am null (no drag information): am, bstar, am_max and every life and fix key undefined',
    am0.life_mid === undefined && am0.life_lo === undefined && am0.bstar === 0 && am0.am === 0 && none.am === undefined && none.bstar === undefined && none.am_max === undefined && none.life_mid === undefined && none.fix_h === undefined && none.fix_hp === undefined && geo.life_mid === undefined);
  chk('A3 the unvalidated catalogue sets of SPEC 2.3 never throw: a negative perigee, e above 0.9, a huge B*, no area over mass; every one gets a dictionary with a name and the kernels it can run', (() => {
    const odd = [elOf(6300, 0.01, 50), elOf(7000, 0.95, 98), elOf(26000, 0.93, 63), elOf(RE - 50, 0, 51.6), elOf(1000, 0.5, 10), elOf(50000, 0.2, 5, { am: 0.5, bstar: 9 }), elOf(7000, 0, 0, { am: null }), elOf(7000, 0, 180), elOf(1e-3, 0, 0), elOf(399000, 0.999, 179.99)];
    return odd.every(el => { try { const c = ctx(el); const r = A.advise(el, baseEnv(), { host: 'readonly' }); return c.__errors !== undefined && typeof c.hp === 'number' && Array.isArray(r.items); } catch (e) { return false; } });
  })());
  chk('A3 context never throws for bad input: no element set, no environment, a missing site, a window with no start, a measured run with junk; it says what was missing in __errors', (() => {
    try {
      const a1 = A.context(null, null), a2 = A.context(elOf(7000, 0, 51.6)), a3 = A.context(elOf(7000, 0, 51.6), { site: null, window: { hours: 24 }, measured: { n: 'x', totalS: NaN } }), a4 = A.context({ a: -5, e: 0.1 }, {}), a5 = A.context(elOf(7000, 1, 51.6));
      return a1.__errors.length > 0 && a2.__errors.some(x => x.kernel === 'env') && a3.site === 'the observer' && a3.n === undefined && a3.epoch_off === undefined && a4.__errors[0].kernel === 'input' && a5.__errors[0].kernel === 'input';
    } catch (e) { return false; }
  })());
  chk('A3 the observer is the one in env: the Bangkok of every scenario never appears in a rendered text for another site', (() => {
    const r = advStrict(elOf(RE + 500, 0, 51.6), { site: SITES[3], measured: { n: 3, totalS: 1800, longestS: 600, bestEl: 70, altMin: 480, altMax: 520, surfSwing: 20, rSwing: 12 } });
    return r.items.length >= 8 && !JSON.stringify(r).includes('Bangkok') && JSON.stringify(r).includes('Hobart');
  })());
});

/* ---- the eleven presets of Appendix A ---- */
const APPX = { iss: [], sso: ['life.long'], dd: ['life.long'], landsat: ['life.long'], thai: ['life.long'], cube: [], knack: ['life.short'], gps: [], geo: [], molniya: ['rad.cross'], tundra: [] };
group('A4 the eleven presets: the Check, Problem and Fix-this ids of Appendix A, with measured: null (epoch 2026-10-01T12:00Z, Bangkok, 24 h window)', () => {
  chk('A4 all eleven presets are valid for the planner with no notes', PRESETS.length === 11 && PRESETS.every(p => p.ok));
  const kinds = { iss: 'ISS-like orbit', sso: 'Sun-synchronous orbit', dd: 'Sun-synchronous orbit', landsat: 'Sun-synchronous orbit', thai: 'Circular low Earth orbit', cube: 'Sun-synchronous orbit', knack: 'ISS-like orbit', gps: 'Navigation-constellation orbit', geo: 'Geostationary orbit', molniya: 'Molniya-type orbit', tundra: 'Tundra-type orbit' };
  for (const p of PRESETS) {
    const r = advStrict(p.el, { measured: null });
    chk('A4 ' + p.key + ': Check / Problem / Fix this = ' + (APPX[p.key].join(' ') || 'none') + ', and nothing else', JSON.stringify(warnUp(r)) === JSON.stringify(APPX[p.key]), 'got ' + (warnUp(r).join(' ') || 'none') + ' of ' + ids(r).join(' '));
    chk('A4 ' + p.key + ': the verdict names it "' + kinds[p.key] + '"; nothing was dropped; no measured key leaks in', r.verdict.head[0].t === kinds[p.key] && r.dropped.items.length === 0 && r.c.n === undefined && r.c.alt_min === undefined && !r.items.some(i => i.id === 'gt.count' || i.id === 'cav.mean'), r.verdict.head.map(h => h.t || h.n).join(''));
  }
  /* the life column, as the design computes it */
  const life = key => { const r = advStrict(PRESETS.find(p => p.key === key).el, {}); return [r.c.life_lo, r.c.life_mid, r.c.life_hi]; };
  const y = 365.25, mo = 30.4375;
  /* [value, half a unit of the last digit the design prints]; Infinity is "more than a century" */
  const LF = { iss: [[1.6 * y, 0.05 * y], [4.7 * y, 0.05 * y], [14 * y, 0.5 * y]], sso: [[41 * y, 0.5 * y], [Infinity], [Infinity]], dd: [[41 * y, 0.5 * y], [Infinity], [Infinity]], landsat: [[40 * y, 1 * y], [Infinity], [Infinity]],
    thai: [[4.1 * y, 0.05 * y], [12 * y, 0.5 * y], [37 * y, 0.5 * y]], cube: [[10 * mo, 0.5 * mo], [2.6 * y, 0.05 * y], [7.7 * y, 0.05 * y]], knack: [[47, 0.5], [4.7 * mo, 0.05 * mo], [1.2 * y, 0.05 * y]] };
  const lbad = [];
  Object.keys(LF).forEach(k => { const g = life(k); LF[k].forEach(([w, t], n) => { if (w === Infinity ? g[n] !== Infinity : Math.abs(g[n] - w) > t) lbad.push(k + ' ' + ['lo', 'mid', 'hi'][n] + ' ' + (g[n] / y).toFixed(2) + ' y vs ' + (w / y).toFixed(2)); }); });
  chk('A4 the life column, to the digit the design prints: iss 1.6 / 4.7 / 14 y, sso 41 y / more than a century, landsat about 40 y, thai 4.1 / 12 / 37 y, cube 10 months / 2.6 / 7.7 y, knack 47 d / 4.7 months / 1.2 y', lbad.length === 0, lbad.join(' | '));
  chk('A4 gps, geo, molniya, tundra: no life figure (life.permanent, life.permanent, life.ecc, life.ecc.high say why)', ['gps', 'geo', 'molniya', 'tundra'].every((k, n) => { const r = advStrict(PRESETS.find(p => p.key === k).el, {}); return r.c.life_mid === undefined && ids(r).indexOf(['life.permanent', 'life.permanent', 'life.ecc', 'life.ecc.high'][n]) >= 0; }));
  chk('A4 the Molniya and Tundra presets keep the apogee where it is (argp_rate under 0.0055 deg/day, so kind.heo.drift is silent) while a Molniya at 55 degrees does not',
    ['molniya', 'tundra'].every(k => !ids(advStrict(PRESETS.find(p => p.key === k).el, {})).includes('kind.heo.drift') && Math.abs(advStrict(PRESETS.find(p => p.key === k).el, {}).c.argp_rate) <= 0.0055) && ids(advStrict(elFromForm({ a: 26554.137, e: 0.74, inc: 55, argp: 270 }), {})).includes('kind.heo.drift'));
  chk('A4 sso and dd are the only presets with a dawn-dusk or a clock item: sun.ltan on 10:30, sun.dawndusk on 06:00; landsat repeats (gt.rgt), cube too', (() => {
    const g = k => ids(advStrict(PRESETS.find(p => p.key === k).el, {}));
    return g('sso').includes('sun.ltan') && !g('sso').includes('sun.dawndusk') && g('dd').includes('sun.dawndusk') && !g('dd').includes('sun.ltan') && g('landsat').includes('gt.rgt') && g('iss').includes('gt.rgt') && !g('sso').includes('gt.rgt');
  })());
});

group('A3 render-all: 300 seeded valid forms and the eleven presets, strict, in both hosts', () => {
  const all = FORMS.map(f => ({ tag: 'form ' + f.form.name, el: f.el, env: f.env })).concat(PRESETS.map(p => ({ tag: 'preset ' + p.key, el: p.el, env: {} })));
  const threw = [], bad = [], dirs = [], work = [], dropped = [], terms = [], setKeys = [], timesMs = [];
  const fired = {}, quiet = {};
  const FK = CC.FORM_KEYS, TK = CC.TERMS;
  let nItems = 0, nFix = 0, longestBody = 0, longestTitle = 0, longestId = '';
  AC.ITEMS.forEach(i => { fired[i.id] = 0; quiet[i.id] = 0; });
  const lintOne = (tag, it) => {
    CC.voiceProblems(it.titleText, 'title').concat(CC.voiceProblems(it.bodyText, 'body')).forEach(p => bad.push(tag + ' ' + it.id + ': ' + p));
    it.fixes.forEach(f => CC.voiceProblems(f.labelText, 'label').forEach(p => bad.push(tag + ' ' + it.id + ' button: ' + p)));
    if (it.basis) CC.voiceProblems(it.basis, 'label').forEach(p => bad.push(tag + ' ' + it.id + ' basis: ' + p));
    if (it.term && TK.indexOf(it.term) < 0) terms.push(tag + ' ' + it.id + ' ' + it.term);
    const w = it.bodyText.trim().split(/\s+/).length; if (w > longestBody) { longestBody = w; longestId = it.id; } longestTitle = Math.max(longestTitle, it.titleText.length);
    it.fixes.forEach(f => Object.keys(f.set).forEach(k => { if (FK.indexOf(k) < 0) setKeys.push(tag + ' ' + it.id + ' ' + k); }));
  };
  const store = [];
  for (const x of all) {
    let r;
    const t0 = cpuMs();
    try { r = A.advise(x.el, baseEnv(x.env), { strict: true }); } catch (e) { threw.push(x.tag + ': ' + e.message); continue; }
    timesMs.push(cpuMs() - t0);
    store.push({ x, r });
    nItems += r.items.length;
    const got = ids(r);
    AC.ITEMS.forEach(i => { if (i.group !== 'input') { if (got.indexOf(i.id) >= 0) fired[i.id]++; else quiet[i.id]++; } });
    r.items.forEach(it => { lintOne(x.tag, it); nFix += it.fixes.length; });
    if (r.dropped.items.length) dropped.push(x.tag + ' ' + JSON.stringify(r.dropped.items));
    const text = JSON.stringify(r.items.map(i => [i.titleText, i.bodyText, i.fixes.map(f => f.labelText)]));
    if (/[{}]|NaN|undefined|Infinity|\bnull\b/.test(text.replace(/\\"/g, ''))) bad.push(x.tag + ' unresolved text: ' + (text.match(/.{20}([{}]|NaN|undefined|Infinity|\bnull\b).{20}/) || [''])[0]);
    r.items.forEach(it => it.fixes.forEach(f => {
      const raise = /^Raise\b/.test(f.labelText), lower = /^Lower\b/.test(f.labelText);
      if ((raise || lower) && typeof f.set.hp === 'number') {
        if (raise && !(f.set.hp > r.c.hp + 5)) dirs.push(x.tag + ' ' + it.id + ': "' + f.labelText + '" from ' + r.c.hp.toFixed(0));
        if (lower && !(f.set.hp < r.c.hp - 5)) dirs.push(x.tag + ' ' + it.id + ': "' + f.labelText + '" from ' + r.c.hp.toFixed(0));
        if (typeof f.set.ha === 'number' && ((raise && !(f.set.ha > r.c.ha + 5)) || (lower && !(f.set.ha < r.c.ha - 5)))) dirs.push(x.tag + ' ' + it.id + ' apogee: "' + f.labelText + '"');
      }
    }));
    const ro = A.advise(x.el, baseEnv(Object.assign({ tracked: true }, x.env)), { strict: true, host: 'readonly' });
    ro.items.forEach(it => { if (it.fixes.length) bad.push(x.tag + ' readonly ' + it.id + ' offers a button'); lintOne(x.tag + ' ro', it); });
    AC.ITEMS.forEach(i => { if (i.group !== 'input') { if (ids(ro).indexOf(i.id) >= 0) fired[i.id]++; } });
  }
  chk('A3 render-all: advise(el, env, {strict: true}) never throws for ' + all.length + ' orbits (300 seeded forms in all three lenses and both node lenses, the eleven presets), and nothing is dropped', threw.length === 0 && dropped.length === 0, (threw.concat(dropped)).slice(0, 3).join(' | '));
  chk('A3 render-all: no unresolved text and every title, body, button and basis passes the voice rules (titles <= 48 characters, bodies <= 70 words, sentences <= 32, banned words, the speaker, contractions, emoji): ' + nItems + ' items, ' + nFix + ' buttons; longest body ' + longestBody + ' words (' + longestId + '), longest title ' + longestTitle, bad.length === 0, bad.slice(0, 3).join(' | '));
  chk('A3 render-all: every term is one of the eleven known t- ids, every fix.set key is a form key, the read-only host never offers a button', terms.length === 0 && setKeys.length === 0, terms.concat(setKeys).slice(0, 3).join(' | '));
  chk('A3 render-all: a button that says Raise or Lower moves hp (and ha) that way by more than 5 km for every orbit', dirs.length === 0, dirs.slice(0, 3).join(' | '));
  const sorted = timesMs.slice().sort((p, q) => p - q), p95 = sorted[Math.floor(sorted.length * 0.95)];
  chk('A3 render-all: a whole advisor pass (dictionary, items, text, lazy fixes) is under 120 ms at p95 over ' + sorted.length + ' orbits (median ' + median(timesMs).toFixed(1) + ', p95 ' + p95.toFixed(1) + ', max ' + sorted[sorted.length - 1].toFixed(1) + ' ms)', p95 < 120);
  /* determinism, and the one constant: the label stub changes no string */
  const det = [], stub = [];
  const savedLabel = AC.ADVISOR_LABEL;
  store.filter((s, k) => k % 6 === 0).forEach(({ x, r }) => {
    if (JSON.stringify(A.advise(x.el, baseEnv(x.env), { strict: true })) !== JSON.stringify(r)) det.push(x.tag);
    try { AC.ADVISOR_LABEL = 'Tutor'; if (JSON.stringify(A.advise(x.el, baseEnv(x.env), { strict: true })) !== JSON.stringify(r)) stub.push(x.tag); } finally { AC.ADVISOR_LABEL = savedLabel; }
  });
  chk('A3 determinism: the same (el, env) gives deep-equal JSON on a second run (' + Math.ceil(store.length / 6) + ' orbits)', det.length === 0, det.slice(0, 3).join(' '));
  chk('A3 ADVISOR_LABEL stubbed to "Tutor" changes no string of any advise() result: only the panel reads it', stub.length === 0 && AC.ADVISOR_LABEL === 'Professor’s notes');
  /* every advisory item fires somewhere and stays quiet somewhere, over the seeded forms, the presets, both hosts and the hand-made orbits */
  const handmade = {};
  CC.SCENARIOS.concat(SCN.map(s => ({ form: s.form, env: s.env, host: s.host, site: s.site }))).forEach(s => {
    try { const r = A.advise(elFromForm(s.form), baseEnv(Object.assign({ site: s.site || BKK }, s.env || {})), { strict: true, host: s.host }); ids(r).forEach(i => { handmade[i] = (handmade[i] || 0) + 1; }); } catch (e) { /* counted by the groups above */ }
  });
  const never = AC.ITEMS.filter(i => i.group !== 'input' && !(fired[i.id] > 0 || handmade[i.id] > 0)).map(i => i.id), always = AC.ITEMS.filter(i => i.group !== 'input' && quiet[i.id] === 0).map(i => i.id);
  chk('A3 every one of the 67 advisory items fires in at least one orbit (seeded forms, presets, the read-only host, the 50 + ' + SCN.length + ' hand-made ones)', never.length === 0, 'never fired: ' + never.join(' '));
  chk('A3 ... and every one stays quiet in at least one (no condition that is always true)', always.length === 0, 'always fired: ' + always.join(' '));
  RENDERED = store;                  // handed to the sync group below
});

group('A3 every input message: raised by the planner from the input that should raise it, rendered from the planner\'s own error, quiet otherwise', () => {
  const base = P.defaultForm(BKK, EP), ok = Object.assign({}, base, { name: 'Mine' });
  const raise = form => { const r = P.fromForm(Object.assign({}, base, form)); return r.errors.concat(r.notes); };
  const T = [['err.missing', { hp: '' }], ['err.notnum', { hp: 'abc' }], ['err.inc.range', { inc: 181 }], ['err.ecc.neg', { shape: 'ae', a: 7000, e: -0.1 }], ['err.ecc.parabola', { shape: 'ae', a: 7000, e: 1 }], ['err.ecc.hyper', { shape: 'ae', a: 7000, e: 1.2 }],
    ['err.perigee.surface', { hp: -10, ha: 100 }], ['err.apo.lt.peri', { hp: 800, ha: 700 }], ['err.a.range', { hp: 1e6, ha: 1e6 }], ['err.am.range', { am: 12 }], ['err.epoch.range', { epoch: '2057-01-01T00:00:00' }], ['err.angle.wrap', { nodeMode: 'raan', raan: 370 }],
    ['err.bstar.range', { hp: 300, ha: 300, am: 5 }], ['err.ltan.range', { nodeMode: 'ltan', ltan: '25' }], ['sgp4.retro', { shape: 'ae', a: 7000, e: 0.01, inc: 179.99 }]];
  const bad = [];
  for (const [code, patch] of T) {
    const errs = raise(patch), hit = errs.find(x => x.code === code);
    if (!hit) { bad.push(code + ' was not raised by ' + JSON.stringify(patch)); continue; }
    let r;
    try { r = AC.renderInput(code, hit); } catch (e) { bad.push(code + ' does not render from the planner\'s own error: ' + e.message); continue; }
    CC.voiceProblems(r.titleText, 'title').concat(CC.voiceProblems(r.bodyText, 'body')).forEach(p => bad.push(code + ': ' + p));
    r.fixes.forEach(f => { const patched = P.patchForm(Object.assign({}, base, patch), f.set), r2 = P.fromForm(patched); if (r2.errors.some(x => x.code === code)) bad.push(code + ' fix "' + f.labelText + '" does not clear it'); });
  }
  chk('A3 ' + T.length + ' input messages: each raised by its own input through Planner.fromForm, rendered from the planner\'s own error object within the voice rules, each button clears it', bad.length === 0, bad.slice(0, 3).join(' | '));
  const quiet = [['hp 800, ha 800', {}], ['i 180, e 0', { inc: 180, hp: 500, ha: 500 }], ['am 10 at 900 km', { am: 10, hp: 900, ha: 900 }], ['am 7 at 700 km', { am: 7, hp: 700, ha: 700 }], ['LTAN 24:00', { nodeMode: 'ltan', ltan: '24:00' }], ['raan 359.9999', { nodeMode: 'raan', raan: 359.9999 }], ['epoch 2056-12-31T23:59:59', { epoch: '2056-12-31T23:59:59' }]];
  chk('A3 ... and a valid form just inside each limit raises none of them', quiet.every(([nm, p]) => { const e = raise(p); return e.length === 0; }), quiet.map(([nm, p]) => nm + ': ' + raise(p).map(x => x.code).join(',')).filter(s => !/: $/.test(s)).join(' | '));
  /* the ones the page raises (not the planner): the same renderer, from the params the page passes, and the rule each follows */
  const pageBad = [];
  const mkT = (a, e, inc) => P.toTLE(P.validate({ a, e, i: inc, raan: 0, argp: 0, M: 0, epoch: EP, am: 0.0043 }).el, 'O0001');
  const t5 = mkT(RE + 5, 0, 0), t500 = mkT(RE + 500, 0, 51.6);
  const v = P.verifyTLE(t5.l1, t5.l2, null, sat), vOk = P.verifyTLE(t500.l1, t500.l2, null, sat);
  if (v.ok || !v.errors.length || v.errors[0].code !== 'err.sgp4') pageBad.push('verifyTLE of a 5 km orbit is not err.sgp4');
  else { try { const r = AC.renderInput('err.sgp4', v.errors[0]); if (!/SGP4 refused it with error \d/.test(r.bodyText)) pageBad.push('err.sgp4 body ' + r.bodyText); } catch (e) { pageBad.push('err.sgp4 ' + e.message); } }
  if (!vOk.ok) pageBad.push('a 500 km orbit fails verifyTLE: ' + JSON.stringify(vOk.errors));
  const names = ['', ' ', '=HYPERLINK("x") ok', 'ISS (ZARYA)', 'Mine'], cat = CAT.map(x => x.name.toLowerCase());
  const rule = n => ({ 'err.name.empty': P.cleanName(n) === '', 'err.name.cleaned': P.cleanName(n) !== '' && P.cleanName(n) !== n, 'err.name.taken': cat.indexOf(P.cleanName(n).toLowerCase()) >= 0 });
  if (!(rule('')['err.name.empty'] && rule('=HYPERLINK("x") ok')['err.name.cleaned'] && rule('ISS (ZARYA)')['err.name.taken'] && !rule('Mine')['err.name.empty'] && !rule('Mine')['err.name.cleaned'] && !rule('Mine')['err.name.taken'])) pageBad.push('the name rules');
  const pr = { 'err.name.empty': {}, 'err.name.taken': { name: 'ISS (ZARYA)', name_free: 'ISS (ZARYA) (mine)' }, 'err.name.cleaned': { cleaned: P.cleanName('=HYPERLINK("x") ok') }, 'err.cap': { cap: P.LIMITS.maxCustom }, 'err.storage': {} };
  Object.keys(pr).forEach(code => { try { const r = AC.renderInput(code, pr[code]); CC.voiceProblems(r.titleText, 'title').concat(CC.voiceProblems(r.bodyText, 'body')).forEach(p => pageBad.push(code + ': ' + p)); } catch (e) { pageBad.push(code + ' ' + e.message); } });
  const store30 = JSON.stringify({ v: 1, next: 1, items: Array.from({ length: 30 }, (_, k) => ({ id: 'c' + (k + 1), name: 'N' + k, made: 0, el: { a: 7000, e: 0, i: 50, raan: 0, argp: 0, M: 0, epoch: EP, am: 0.0043 } })) });
  const san = P.sanitizeStore(store30);
  if (!(san.items.length === P.LIMITS.maxCustom && san.dropped === 18)) pageBad.push('err.cap rule: thirty orbits keep ' + san.items.length);
  chk('A3 the messages the page raises (err.sgp4 from verifyTLE of a 5 km orbit, the three name rules, err.cap at ' + P.LIMITS.maxCustom + ', err.storage) render from their own params within the voice rules, and their rules say yes and no where they should', pageBad.length === 0, pageBad.join(' | '));
  const covered = new Set(T.map(t => t[0]).concat(Object.keys(pr), ['err.sgp4']));
  const inputIds = AC.ITEMS.filter(i => i.group === 'input').map(i => i.id);
  chk('A3 the table covers all ' + inputIds.length + ' input items (and sgp4.retro, an advisory item the planner also raises)', inputIds.every(i => covered.has(i)) && covered.has('sgp4.retro'), inputIds.filter(i => !covered.has(i)).join(' '));
});

group('A3 coverage of "what kind of orbit": the 782-orbit grid of the kind scan, every tilt x every shape', () => {
  const TILTS = [0, 0.1, 0.5, 2, 5, 28.5, 45, 51.6, 53, 63.4, 87, 90, 90.5, 92, 94, 97, 98, 110, 120, 150, 170, 179.99, 180];
  const SHAPES = [[200, 200], [250, 250], [300, 300], [400, 400], [470, 470], [480, 480], [550, 550], [800, 800], [1200, 1200], [1500, 1500], [2500, 2500], [5000, 5000], [8000, 8000], [12000, 12000], [20000, 20000], [26000, 26000], [30000, 30000], [34000, 34000],
    [35000, 35000], [36000, 36000], [38000, 38000], [45000, 45000], [60000, 60000], [100000, 100000], [300, 2000], [500, 8000], [1000, 12000], [500, 20000], [1000, 30000], [500, 50000], [35786, 35786], [35700, 35800], [34000, 38000], [35786 - 300, 35786 + 300]];
  const holes = [], twice = [], threw = []; let n = 0; const tally = {};
  for (const inc of TILTS) for (const [hp, ha] of SHAPES) {
    n++;
    try {
      const r = AC.advise(A.context(elHH(hp, ha, inc, { raan: 0, argp: 0, M: 0 }), baseEnv({ window: null })), { strict: true }), kinds = ids(r).filter(i => i.indexOf('kind.') === 0);
      kinds.forEach(k => { tally[k] = (tally[k] || 0) + 1; });
      if (kinds.length === 0) holes.push(hp + 'x' + ha + ' i ' + inc);
      if (kinds.indexOf('kind.retro') >= 0 && kinds.indexOf('kind.polar') >= 0) twice.push(hp + ' i ' + inc);
    } catch (e) { threw.push(hp + 'x' + ha + ' i ' + inc + ': ' + e.message); }
  }
  chk('A3 grid: ' + n + ' orbits (23 tilts x 34 shapes) each get at least one "what kind of orbit" item (80 had none before the critique pass), none is both polar and retrograde, none throws', n === 782 && holes.length === 0 && twice.length === 0 && threw.length === 0, (holes.concat(twice, threw)).slice(0, 4).join(' | '));
  chk('A3 grid: ' + Object.keys(tally).length + ' different kind.* items answer for the grid, kind.geo and kind.sso among them (the Molniya, Tundra, navigation and eccentric-geosynchronous ones need shapes the grid does not hold)', Object.keys(tally).length >= 15 && tally['kind.geo'] > 0 && tally['kind.sso'] > 0, Object.keys(tally).sort().join(' '));
});

group('A3 the buttons really work: each one applied through Planner.patchForm, then the orbit read again', () => {
  const bad = [], rows = {}, perId = {}; let n = 0, refused = 0;
  const forms = RENDERED.map(({ x, r }) => ({ x, r }));
  const has = (r, id) => ids(r).indexOf(id) >= 0;
  const lifeY = r => r.c.life_mid / 365.25;
  for (const { x, r } of forms) {
    const form0 = P.toForm(x.el, { shape: 'alt', nodeMode: 'raan' });
    r.items.forEach(it => it.fixes.forEach((f, idx) => {
      perId[it.id] = (perId[it.id] || 0) + 1;
      if (perId[it.id] > 36) return;                       // 36 of each kind of button is enough, and the bisections are the cost
      n++;
      const r2 = P.fromForm(P.patchForm(form0, f.set));
      if (!r2.ok) { refused++; bad.push(x.tag + ' ' + it.id + ' "' + f.labelText + '" gives an orbit the planner refuses: ' + r2.errors.map(e => e.code).join(',')); return; }
      let after;
      try { after = A.advise(r2.el, baseEnv(x.env), { strict: true }); } catch (e) { bad.push(x.tag + ' ' + it.id + ' after the fix: ' + e.message); return; }
      const b = it.id, why = m => bad.push(x.tag + ' ' + b + '[' + idx + '] "' + f.labelText + '": ' + m);
      switch (b) {
        case 'life.reentry': case 'life.days': case 'life.short': case 'life.ecc.low': case 'kind.geo.drift': case 'gt.never': case 'gt.barely': case 'cav.circ.angles': case 'cav.frozen': case 'sgp4.retro': case 'cav.epoch.far':
          if (has(after, b)) why('the item is still there'); break;
        case 'life.long':
          if (/about 5 years/.test(f.labelText)) { if (has(after, b)) why('the 5-year height still leaves life.long'); } else if (!(lifeY(after) > 15 && lifeY(after) <= 25.0001)) why('the 25-year height gives ' + lifeY(after).toFixed(1) + ' years in the middle case'); break;
        case 'kind.sso.near': if (!has(after, 'kind.sso') || has(after, 'kind.sso.near')) why('not sun-synchronous afterwards'); break;
        case 'gt.geo.down': if (!has(after, 'gt.geo.up') || has(after, 'gt.geo.down')) why('still below the horizon'); break;
        case 'kind.heo.drift': { /* the promise is the first-order one: the J2/J4 apsidal rate (no Moon, no Sun) falls; the lunisolar terms move the true root by up to half a degree for a deep orbit (see NOTES) */ const j = c0 => Math.abs(P.rates(c0.a, c0.e, c0.inc).argpdot); if (!(j(after.c) < j(r.c) + 1e-9)) why('the J2/J4 perigee rate rises afterwards'); break; }
        case 'sun.ltan': case 'sun.dawndusk': { const want = f.set.ltan; if (!(Math.abs(after.c.ltan - want) < 0.02 || Math.abs(Math.abs(after.c.ltan - want) - 24) < 0.02)) why('LTAN is ' + after.c.ltan.toFixed(3) + ', not ' + want); break; }
        case 'gt.rgt.near': if (!has(after, 'gt.rgt')) why('no exact repeat afterwards'); break;
        default: break;
      }
      rows[b] = (rows[b] || 0) + 1;
    }));
  }
  const kinds = Object.keys(rows);
  chk('A3 ' + n + ' buttons over the 300 seeded forms and the presets, each applied through Planner.patchForm in the form\'s own lens: the planner accepts the result (' + refused + ' refused) and what the button promised happens (' + kinds.length + ' kinds of button: ' + kinds.sort().join(' ') + ')', bad.length === 0 && n > 300, bad.slice(0, 3).join(' | '));
  /* the seeded forms do not reach every kind of button; the hand-made orbits supply the rest */
  const extra = [['life.reentry', { hp: 90, ha: 90, inc: 51.6 }], ['life.ecc.low', { hp: 200, ha: 2000, inc: 60 }], ['life.long', { hp: 700, ha: 700, inc: 98.2 }], ['life.days', { hp: 200, ha: 200, inc: 51.6 }], ['life.short', { hp: 330, ha: 330, inc: 51.6 }],
    ['kind.geo.drift', { hp: 35686, ha: 35686, inc: 0.1 }], ['kind.sso.near', { hp: 700, ha: 700, inc: 97.2 }], ['gt.never', { hp: 500, ha: 500, inc: 28.5 }, { site: SITES[1] }], ['gt.barely', { hp: 400, ha: 400, inc: 0 }], ['gt.geo.down', { hp: 35786.045, ha: 35786.045, inc: 0, ma: farMa }],
    ['cav.circ.angles', { hp: 500, ha: 500, inc: 51.6, argp: 40, ma: 20 }], ['cav.frozen', { a: 7078.137, e: 0.001046, inc: 98.2, argp: 90 }], ['sgp4.retro', { a: 7000, e: 0.01, inc: 179.99 }], ['kind.heo.drift', { a: 26554.137, e: 0.74, inc: 55, argp: 270 }],
    ['sun.ltan', { hp: 700, ha: 700, inc: 98.213, nodeMode: 'ltan', ltan: 9 }], ['sun.dawndusk', { hp: 700, ha: 700, inc: 98.213, nodeMode: 'ltan', ltan: 6 }], ['gt.rgt.near', { hp: 719.5 - 0, ha: 719.5, inc: 98 }]];
  const xb = [];
  for (const [id, form, envx] of extra) {
    const base = Object.assign({ shape: form.a !== undefined ? 'ae' : 'alt', nodeMode: 'raan', epoch: '2026-10-01T12:00:00', am: 0.0043, argp: 0, ma: 0, raan: 0 }, form);
    const el = elFromForm(form), env = Object.assign({ window: { startMs: EP + 7 * 86400000, hours: 24 } }, envx || {});
    const r = A.advise(el, baseEnv(env), { strict: true }), it = r.items.find(i => i.id === id);
    if (!it) { if (id !== 'gt.rgt.near') xb.push(id + ' did not fire for ' + JSON.stringify(form)); continue; }
    it.fixes.forEach((f, idx) => {
      const r2 = P.fromForm(P.patchForm(base, f.set)); if (!r2.ok) { xb.push(id + ' "' + f.labelText + '" refused: ' + r2.errors.map(e => e.code)); return; }
      const after = A.advise(r2.el, baseEnv(env), { strict: true });
      if (id === 'life.long' && /about 5 years/.test(f.labelText) && has(after, 'life.long')) xb.push('life.long 5-year still there');
      else if (id === 'sun.ltan' && Math.abs(after.c.ltan - f.set.ltan) > 0.02 && Math.abs(Math.abs(after.c.ltan - f.set.ltan) - 24) > 0.02) xb.push('sun.ltan ' + after.c.ltan);
      else if (id === 'sun.dawndusk' && Math.abs(after.c.ltan - f.set.ltan) > 0.02) xb.push('sun.dawndusk ' + after.c.ltan);
      else if (['life.reentry', 'life.days', 'life.short', 'life.ecc.low', 'kind.geo.drift', 'gt.never', 'gt.barely', 'cav.circ.angles', 'cav.frozen', 'sgp4.retro'].indexOf(id) >= 0 && has(after, id)) xb.push(id + ' "' + f.labelText + '" leaves the item');
      else if (id === 'gt.geo.down' && !has(after, 'gt.geo.up')) xb.push('gt.geo.down not moved over the site');
      else if (id === 'kind.sso.near' && !has(after, 'kind.sso')) xb.push('kind.sso.near not sun-synchronous afterwards');
      else if (id === 'kind.heo.drift' && !(Math.abs(P.rates(after.c.a, after.c.e, after.c.inc).argpdot) < Math.abs(P.rates(r.c.a, r.c.e, r.c.inc).argpdot))) xb.push('kind.heo.drift: the J2/J4 perigee rate rises');
    });
  }
  chk('A3 the same for the hand-made orbits that make each of the other buttons: reentry, days, short, long (25 and 5 years), skimming perigee, near-geostationary, near sun-synchronous, out of reach, barely, below the horizon, circle angles, frozen, SGP4 near 180, the critical inclination, the three LTAN buttons', xb.length === 0, xb.join(' | '));
});

group('A5 sync: the dictionary is exactly the contract between advisor.js and advisor-copy.js', () => {
  const KEYS = CC.KEYS, MESSAGE = 'field raw wrapped code why hint name_free cleaned'.split(' ');
  /* every key any when, severity function, button condition, helper, title, body, label or payload reads */
  const read = new Set();
  const tokens = t => { const re = new RegExp(AC.TOKEN.source, 'g'); let m; const o = []; while ((m = re.exec(t)) !== null) o.push(m[1]); return o; };
  const fnKeys = fn => (typeof fn === 'function' ? (fn.toString().match(/\bc\.[A-Za-z_][A-Za-z_0-9]*/g) || []) : []).map(x => x.slice(2));
  AC.ITEMS.forEach(it => {
    [it.title, it.body].forEach(t => tokens(t).forEach(k => read.add(k)));
    (it.fix || []).forEach(f => { tokens(f.label).forEach(k => read.add(k)); Object.keys(f.set).forEach(k => { const m = /^\{(.+)\}$/.exec(String(f.set[k])); if (m) read.add(m[1]); }); fnKeys(f.when).forEach(k => read.add(k)); });
    fnKeys(it.when).forEach(k => read.add(k)); fnKeys(it.sev).forEach(k => read.add(k));
  });
  Object.keys(AC.helpers).forEach(k => fnKeys(AC.helpers[k]).forEach(x => read.add(x)));
  ['hp', 'ha', 'e', 'h_mean', 'period'].forEach(k => read.add(k));          // the verdict line
  const unknown = Array.from(read).filter(k => !KEYS[k]);
  chk('A5 the contract list is complete: all ' + read.size + ' keys the catalogue reads are in advisor-copy-checks\'s list of ' + Object.keys(KEYS).length, unknown.length === 0, unknown.join(' '));
  /* the contexts: the seeded forms, the presets, the hand-made orbits, the real catalogue sets */
  const ctxs = RENDERED.map(({ x, r }) => ({ tag: x.tag, c: r.c, env: x.env, el: x.el }));
  const extraEls = [elOf(7077.735 + 5, 0, 98.2113), elOf(K.repeatSolve(29, 2, 0, 98, { sso: false }).a + 5, 0, 98), realEl(LANDSAT), realEl(ISS), realEl(real('KNACKSAT-2')), realEl(real('THAICOM 4')), elHH(150, 450, 51.6), elHH(100, 130, 51.6), elOf(RE + 90, 0, 51.6)];
  extraEls.forEach((el, k) => ctxs.push({ tag: 'extra ' + k, c: A.context(el, baseEnv({ window: { startMs: EP + 3 * 86400000, hours: 24 }, measured: { n: 4, totalS: 1500, longestS: 500, bestEl: 60, altMin: 400, altMax: 420, surfSwing: 20, rSwing: 10 } })), env: { window: true, measured: true }, el }));
  const stray = [], kinds = [], nan = [], defined = {};
  let evaluated = 0;
  ctxs.forEach(({ tag, c }, idx) => {
    Object.keys(c).forEach(k => {
      if (k === '__errors') return;
      if (!KEYS[k]) { stray.push(tag + ' has the key ' + k); return; }
      const lazyGetter = !!Object.getOwnPropertyDescriptor(c, k).get;
      if (lazyGetter && idx % 5 !== 0 && !/^(K|D|rgt_.*|near_.*)$/.test(k)) return;      // lazy bisections: every fifth context, the cheap lazies always
      const v = c[k]; evaluated++;
      if (v === undefined) return;
      defined[k] = (defined[k] || 0) + 1;
      const kd = KEYS[k];
      if (typeof v === 'number' && !isFinite(v) && !(v === Infinity && /^(life_(lo|mid|hi)|fix_life|argp_q_days)$/.test(k))) nan.push(tag + ' ' + k + ' = ' + v);
      if (!(kd === 'n' ? typeof v === 'number' : kd === 't' ? typeof v === 'string' && v !== '' : kd === 'b' ? typeof v === 'boolean' : (v === null || typeof v === 'number'))) kinds.push(tag + ' ' + k + ' is a ' + typeof v + ', the contract says ' + kd);
    });
  });
  chk('A5 no stray key: every key of ' + ctxs.length + ' dictionaries is one the contract lists (a misspelt key would be invisible to every sentence)', stray.length === 0, stray.slice(0, 3).join(' | '));
  chk('A5 no NaN and no Infinity (except a lifetime past the cap) in ' + evaluated + ' evaluated keys; every value is the kind the contract says (n number, t text, b boolean, nn number or null)', nan.length === 0 && kinds.length === 0, nan.concat(kinds).slice(0, 3).join(' | '));
  const never = Array.from(read).filter(k => MESSAGE.indexOf(k) < 0 && !defined[k]);
  chk('A5 every key the catalogue reads, apart from the eight that only an input message carries, is defined in at least one of the ' + ctxs.length + ' dictionaries (so none is misnamed in advisor.js)', never.length === 0, 'never defined: ' + never.join(' '));
  /* the keys that must be there, always */
  const ALWAYS = 'a e inc raan argp ma hp ha rp h_mean period period_nodal revs v vp va fold_inc off180 node argp_rate sso_rate sso_amax_alt ltan ltdn ltan_day ltan_night ltan_drift ltan_drift_abs ltan_drift_year sidereal drift drift_abs dperiod_abs geo_a geo_alt geo_lon el_geo vis_lo vis_hi ma_site geo_ecl_max geo_season_days eight_lat ew_amp gnss_slide Q shift_deg shift_km lambda reach offtrack el_best inc_need site_lat site_lon site_lat_abs site_lat_round mask uncert entry cd cap a_max foot_pct foot_pct_500 ha_moon_pct hi_dwell_pct apo_lat u lon_sum retro_err e_f deep_alt argp_q_days inc_crit rgt_days_max name site ltan_dir drift_dir plonger retro_lead epoch_utc geo_vis tracked'.split(' ');
  const gaps = [];
  ctxs.forEach(({ tag, c }) => { ALWAYS.forEach(k => { if (c[k] === undefined) gaps.push(tag + ' lacks ' + k); }); if (c.sso_inc === undefined) gaps.push(tag + ' lacks sso_inc'); });
  chk('A5 ' + ALWAYS.length + ' keys exist in every dictionary whatever the orbit (and sso_inc: a number or null, never undefined)', gaps.length === 0, gaps.slice(0, 3).join(' | '));
  /* the keys that exist only in a situation, exactly in it */
  const sit = [];
  ctxs.forEach(({ tag, c, env, el }) => {
    const sun = c.e < 0.05 && c.a > RE;
    ['beta_min', 'beta_max', 'beta_min_abs', 'beta_crit', 'free_days', 'ecl_max_min', 'ecl_max_pct', 'ecl_txt', 'cycles'].forEach(k => { if ((c[k] !== undefined) !== sun) sit.push(tag + ' ' + k + (sun ? ' missing' : ' present') + ' at e ' + c.e.toFixed(3)); });
    const hasWin = true;                                    // every dictionary above was built through baseEnv, which supplies a window
    ['epoch_off', 'epoch_off_abs', 'epoch_dir', 'hours', 'start', 'window_start', 'window_ms'].forEach(k => { if ((c[k] !== undefined) !== hasWin) sit.push(tag + ' ' + k + (hasWin ? ' missing' : ' present')); });
    const hasM = !!(env && env.measured);
    ['n', 'passes', 'total_min', 'longest_min', 'best_el', 'alt_min', 'alt_max', 'swing', 'surf_swing', 'r_swing'].forEach(k => { if ((c[k] !== undefined) !== hasM) sit.push(tag + ' ' + k + (hasM ? ' missing' : ' present')); });
    const lf = A.life(el, { tracks: false }), hasLife = lf.model !== 'none';
    ['life_lo', 'life_mid', 'life_hi'].forEach(k => { if ((c[k] !== undefined) !== hasLife) sit.push(tag + ' ' + k + (hasLife ? ' missing' : ' present') + ' (' + lf.model + '/' + lf.why + ')'); });
    if (hasLife && (c.life_mid !== lf.mid || c.life_lo !== lf.lo || c.life_hi !== lf.hi)) sit.push(tag + ' life keys differ from Advisor.life');
    if ((c.am !== undefined) !== (typeof el.am === 'number')) sit.push(tag + ' am');
    if ((c.bstar !== undefined) !== (typeof el.am === 'number' && isFinite(el.bstar))) sit.push(tag + ' bstar');
  });
  chk('A5 the situational keys are there exactly when their situation is: the sun keys below e 0.05, the window keys with a window, the measured keys with a trial run, the life keys when the lifetime model answers (and equal to Advisor.life), am and bstar when the area over mass is known', sit.length === 0, sit.slice(0, 3).join(' | '));
  chk('A5 with env.window and env.measured null the window keys and the measured keys are undefined (the items that read them cannot fire)', (() => {
    const c = A.context(elOf(RE + 500, 0, 51.6), { nowMs: EP, site: BKK, window: null, measured: null, sat });
    return ['epoch_off', 'epoch_off_abs', 'epoch_dir', 'hours', 'start', 'window_start', 'window_ms', 'n', 'passes', 'total_min', 'longest_min', 'best_el', 'alt_min', 'alt_max', 'swing', 'surf_swing', 'r_swing'].every(k => c[k] === undefined) && c.tracked === false;
  })());
  chk('A5 the lazy keys are properties that cost nothing until read (a getter), enumerable, and settable (the UI may override one)', (() => {
    const c = ctx(elOf(RE + 600, 0, 51.6)), d = k => Object.getOwnPropertyDescriptor(c, k);
    const lazy = ['fix_h', 'fix_life', 'fix_h25', 'fix_h5', 'fix_hp', 'K', 'D', 'rgt_days', 'rgt_off', 'rgt_gap', 'near_K', 'near_D', 'near_h', 'near_dh'];
    const allGet = lazy.every(k => d(k) && typeof d(k).get === 'function' && d(k).enumerable);
    c.fix_h = 123; return allGet && c.fix_h === 123 && typeof Object.getOwnPropertyDescriptor(c, 'fix_h').get === 'undefined';
  })());
});

group('A2 cost: the dictionary of a circular orbit under 60 ms, an eccentric one (lifeEcc, eclipseYear) under 150 ms, in node', () => {
  const time = (fn, n) => { const t = []; for (let k = 0; k < n; k++) { let best = Infinity; for (let r = 0; r < 2; r++) { const s = cpuMs(); fn(k); best = Math.min(best, cpuMs() - s); } t.push(best); } return t; };
  const circ = [[300, 51.6], [400, 51.6], [500, 97.4], [550, 53], [700, 98.2], [800, 86], [1000, 99.5], [1500, 63.4], [420, 51.64], [650, 28.5], [900, 120], [350, 10]];
  const ecc = [[300, 2800, 51.6], [400, 1400, 63.4], [500, 1500, 51.6], [300, 5000, 28.5], [200, 2000, 60], [600, 3000, 98], [800, 1500, 86], [400, 700, 51.6]];
  time(k => ctx(elOf(RE + 500, 0, 51.6)), 5); time(k => ctx(elHH(400, 1400, 51.6)), 3);           // warm the JIT
  const tc = time(k => ctx(elOf(RE + circ[k % circ.length][0], 0, circ[k % circ.length][1], { raan: k * 17 })), 36), te = time(k => ctx(elHH(ecc[k % ecc.length][0], ecc[k % ecc.length][1], ecc[k % ecc.length][2], { raan: k * 17, am: 0.0043 })), 24);
  const ey = time(k => ctx(elOf(RE + 600, 0.01 + 0.0005 * k, 97.8, { am: 0.0043 })), 12);
  chk('A2 cost: a circular dictionary has a median of ' + median(tc).toFixed(2) + ' ms (60 ms budget; slowest ' + Math.max.apply(null, tc).toFixed(1) + ')', median(tc) <= 60 && Math.max.apply(null, tc) <= 250);
  chk('A2 cost: a dictionary that marches an eccentric lifetime has a median of ' + median(te).toFixed(1) + ' ms (150 ms budget; slowest ' + Math.max.apply(null, te).toFixed(1) + ')', median(te) <= 150 && Math.max.apply(null, te) <= 400);
  chk('A2 cost: with the sampled eclipse year too (0.005 <= e < 0.05) the median is ' + median(ey).toFixed(1) + ' ms', median(ey) <= 150);
  const worst = (() => { let w = 0; for (const hp of [150, 300, 500, 700, 900]) for (const ha of [hp + 60, 1500, 5000]) for (const am of [0.0005, 0.0043, 0.2]) { if (ha <= hp + 30) continue; const t = time(() => A.life(elHH(hp, ha, 51.6, { am }), { tracks: false }), 1)[0]; w = Math.max(w, t); } return w; })();
  chk('A2 cost: the slowest lifetime march over a 45-orbit grid (including orbits that never decay inside the 40,000-day cap) is ' + worst.toFixed(0) + ' ms, under 300 (a guard against something pathological; the budget is the median above)', worst < 300);
  { const orig = P.dragAvg; let n = 0; P.dragAvg = function () { n++; return orig.apply(this, arguments); };
    try { const el = elHH(800, 1500, 51.6, { am: 0.0012 }); K.lifeEcc(el.a, el.e, 2.2 * 0.0012, 1, 120, 40000, false); } finally { P.dragAvg = orig; }
    chk('A2 cost: an eccentric march that never decays inside the cap evaluates the drag integral ' + n + ' times (about 600; the fixed five-day step took 16,000, which is 187 ms)', n > 100 && n <= 1500); }
  const fx = time(() => K.fixHeight(0.0043, 730.5), 5);
  chk('A2 cost: one fix-height bisection takes a median of ' + median(fx).toFixed(1) + ' ms (design: about 40)', median(fx) < 100);
});

group('A0 purity: the advisor reads no clock, no page, no storage, no network, and uses no syntax beyond ES2017', () => {
  /* The module build scans the verbatim TypeScript source it was moved into, not the Node bundle (which also
     carries Lifetime and the Planner). An ADVISOR_JS mutant is still scanned as given. */
  const NEW_BUILD = H.targetName() !== 'legacy' && !process.env.ADVISOR_JS;
  const src = fs.readFileSync(NEW_BUILD ? H.earthSource('advisor') : ADVISOR_JS, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const wrapperLine = "})(typeof window !== 'undefined' ? window : globalThis);";
  /* its three sibling modules are imports now; anything else imported is still a violation */
  const siblings = /^import \{[^}]*\} from '\.\/(?:lifetime|planner|advisor-copy)';$/gm;
  const body = (NEW_BUILD ? code.replace(siblings, '') : code).replace(wrapperLine, '');
  const forbidden = [];
  [[new RegExp('\\?' + '\\.[A-Za-z_$\\[(]'), 'optional chaining'], [new RegExp('\\?' + '\\?'), 'nullish coalescing'], [new RegExp('inner' + 'HTML'), 'inner' + 'HTML'], [/\bdocument\b/, 'document'], [/localStorage|sessionStorage|indexedDB/, 'storage'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator/, 'network'], [new RegExp('Date\\.' + 'now|performance\\.now|new Date\\(\\s*\\)'), 'the clock'], [new RegExp('Math\\.' + 'random'), 'randomness'], [/\brequire\s*\(|\bprocess\s*\.|\bimport\s*[({]/, 'a module'],
    [/\bconsole\s*\./, 'console'], [/\bsetTimeout|setInterval|requestAnimationFrame|requestIdleCallback/, 'a timer'], [/(^|[^.\w$'"])window\b(?!\s*:)/, 'window outside the wrapper'], [/\?\.|\?\?|\*\*=|\basync\b|\bawait\b|\.flatMap|\.flat\(|Object\.fromEntries|\.matchAll|\.trimStart|\.trimEnd|\bBigInt\b/, 'beyond ES2017']].forEach(p => { if (p[0].test(body)) forbidden.push(p[1]); });
  chk('A0 earth/advisor.js (comments stripped): no optional chaining or nullish coalescing, no DOM, window, storage, network, clock (Date.now, a Date with no argument, performance.now), randomness, timer or module', forbidden.length === 0, forbidden.join(', '));
  if (NEW_BUILD) console.log('  SKIP  A0 it is an IIFE over (window or globalThis), strict - an ES module is already strict and scoped');
  chk('A0 ' + (NEW_BUILD ? '' : 'it is an IIFE over (window or globalThis), strict, like lifetime.js, and ') + '"Professor" appears nowhere outside comments', (NEW_BUILD || (/^\(function\(global\)\{\s*\n'use strict';/m.test(src) && src.replace(/\s+$/, '').endsWith(wrapperLine))) && !/Professor/.test(body));
  /* at run time: count the reads of the clock while the advisor works */
  const RealDate = Date; let clock = 0;
  globalThis.Date = new Proxy(RealDate, { construct(t, args, nt) { if (args.length === 0) clock++; return Reflect.construct(t, args, nt === undefined ? t : nt); }, get(t, k) { if (k === 'now') return () => { clock++; return t.now(); }; return t[k]; } });
  const realRandom = Math.random; let rnd = 0; Math.random = () => { rnd++; return realRandom(); };
  let out1, out2;
  try {
    for (const f of FORMS.slice(0, 40)) { out1 = A.advise(f.el, baseEnv(f.env), { strict: true }); }
    A.life(elHH(300, 2800, 51.6)); K.eclipseYear(elHH(500, 700, 98, { argp: 90 }), {}); K.fixHeight(0.0043, 730.5); A.context(elOf(P.GEO_A_KM, 0, 0), baseEnv());
    out2 = A.advise(FORMS[0].el, baseEnv(FORMS[0].env), { strict: true });
  } finally { globalThis.Date = RealDate; Math.random = realRandom; }
  chk('A0 at run time: forty advise() passes, a lifetime march, a sampled year, a fix bisection and a GEO dictionary read the clock ' + clock + ' times and draw ' + rnd + ' random numbers', clock === 0 && rnd === 0);
  chk('A0 nothing is cached between calls that could make an answer depend on history: the first form advised again after forty others is identical', JSON.stringify(out2) === JSON.stringify(A.advise(FORMS[0].el, baseEnv(FORMS[0].env), { strict: true })));
  /* the module touches only the globals it is documented to */
  const g0 = Object.keys(globalThis).sort().join();
  A.context(elOf(7000, 0, 51.6), baseEnv());
  chk('A0 running the advisor adds nothing to the global object, and it changes neither the planner nor the element set it was handed', Object.keys(globalThis).sort().join() === g0 && (() => { const el = elOf(7000, 0.01, 51.6), s = JSON.stringify(el); A.advise(el, baseEnv()); return JSON.stringify(el) === s; })());
});

group('A4 the read-only host: the eight spacecraft of SPEC 4.7, tracked, from their real element sets', () => {
  /* the page's trial run is mocked: the best pass of KNACKSAT-2 and THEOS stays under 60 degrees (gt.overhead), the others climb higher */
  const lists = {
    'KNACKSAT-2': 'kind.iss life.tracked rad.saa sun.ecl.season gt.overhead gt.drift cav.circ.angles',
    'ISS (ZARYA)': 'kind.iss life.tracked rad.saa sun.ecl.season gt.rgt cav.circ.angles',
    'SENTINEL-2A': 'kind.sso life.tracked rad.saa sun.ltan sun.ecl gt.rgt gt.sso.clock cav.circ.angles',
    'LANDSAT 9': 'kind.sso life.tracked rad.saa sun.ltan sun.ecl gt.rgt gt.sso.clock cav.circ.angles',
    'NOAA 20': 'kind.sso life.tracked rad.saa sun.ltan sun.ecl gt.rgt gt.sso.clock cav.circ.angles',
    'THAICOM 4': 'kind.geo life.tracked life.permanent rad.geo sun.geo gt.geo.up cav.circ.angles cav.eq.angles',
    'GOES 18': 'kind.geo life.tracked life.permanent rad.geo sun.geo gt.geo.down cav.circ.angles cav.eq.angles',
    'THEOS': 'kind.sso.near life.tracked rad.saa sun.ecl gt.overhead gt.drift cav.circ.angles' };
  const bad = [];
  for (const nm of Object.keys(lists)) {
    const e0 = CAT.find(x => x.name.indexOf(nm) === 0);
    if (!e0) { bad.push(nm + ' is not in the catalogue'); continue; }
    const el = realEl(e0), low = nm === 'KNACKSAT-2' || nm === 'THEOS';
    const m = { n: 3, totalS: 1800, longestS: 600, bestEl: low ? 40 : 75, altMin: 400, altMax: 420, surfSwing: 20, rSwing: 10 };
    let r;
    try { r = A.advise(el, baseEnv({ window: { startMs: el.epoch, hours: 24 }, measured: m, tracked: true, host: 'readonly' }), { strict: true }); } catch (e) { bad.push(nm + ' threw ' + e.message); continue; }
    const want = lists[nm].split(' '), got = ids(r), extra = got.filter(i => want.indexOf(i) < 0), lacking = want.filter(i => got.indexOf(i) < 0);
    if (lacking.length || extra.some(i => i !== 'cav.deep') || (extra.length && !/GEO|geo/.test(lists[nm]))) bad.push(nm + ': lacks ' + lacking.join(',') + ' extra ' + extra.join(',') + ' (got ' + got.join(' ') + ')');
    if (r.items.some(i => i.fixes.length)) bad.push(nm + ' offers a button');
    if (r.items.some(i => (AC.ITEMS.find(x => x.id === i.id).flags || {}).draftOnly)) bad.push(nm + ' says a drafting item');
    if (r.c.life_mid !== undefined || r.c.fix_h !== undefined) bad.push(nm + ' has an assumed-drag lifetime beside its history-fitted one');
    if (r.dropped.items.length) bad.push(nm + ' dropped ' + JSON.stringify(r.dropped.items));
  }
  chk('A4 the eight spacecraft (KNACKSAT-2, ISS, SENTINEL-2A, LANDSAT 9, NOAA 20, THAICOM 4, GOES 18, THEOS) give the id lists of SPEC 4.7, with cav.deep the only extra (the two geostationary ones), no button, no drafting item, no assumed-drag lifetime', bad.length === 0, bad.join(' | '));
  /* every catalogue set, through the read-only host, never throws (decayed objects, e above 0.9, B* huge) */
  let nThrow = 0, nDone = 0, firstErr = '';
  for (const x of CAT) {
    try { const el = realEl(x); A.advise(el, baseEnv({ tracked: true, window: { startMs: el.epoch, hours: 24 }, host: 'readonly' }), { host: 'readonly' }); nDone++; } catch (e) { nThrow++; if (!firstErr) firstErr = x.name + ': ' + e.message; }
  }
  chk('A4 all ' + CAT.length + ' sets of the catalogue go through the read-only host without an exception (the negative perigees, the two sets with e above 0.9, the huge B*, every set above 1,000 km)', nThrow === 0 && nDone === CAT.length, firstErr);
});

group('A1 two more dictionary figures: the track shift in kilometres and the navigation-orbit slide', () => {
  const c = ctx(elOf(RE + 500, 0, 97.426));
  near('A1 shift_km / shift_deg is the length of a degree on the equator, 111.32 km (2 pi RE / 360 = 111.3195)', c.shift_km / c.shift_deg, 2 * Math.PI * RE / 360, 0.005);
  near('A1 shift_deg = 360 / Q = 23.68 degrees west a revolution at 500 km, 97.4 degrees (SGP4: -23.6849 node to node)', c.shift_deg, 23.685, 0.005);
  const slide = min => ctx(elOf(P.aFromPeriodMin(min), 0, 55)).gnss_slide;
  near('A1 gnss_slide at half a sidereal day plus 2 minutes is 1.003 degrees a day (4 min of the 1,436 minute day)', slide(P.SIDEREAL_MIN / 2 + 2), 360 * 4 / P.SIDEREAL_MIN, 0.0005);
  chk('A1 gnss_slide is zero at exactly half a sidereal day, symmetric about it, and 7.5 degrees at 15 minutes (the old tolerance)', slide(P.SIDEREAL_MIN / 2) < 1e-6 && Math.abs(slide(P.SIDEREAL_MIN / 2 + 2) - slide(P.SIDEREAL_MIN / 2 - 2)) < 1e-6 && Math.abs(slide(P.SIDEREAL_MIN / 2 + 15) - 7.52) < 0.01);
});

console.log('\n' + total + ' checks, ' + fails + ' failed');
console.log(fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS');
process.exit(fails ? 1 : 0);
