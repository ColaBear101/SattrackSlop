/*
 * The orbit planner's maths, checked against satellite.js (an independent SGP4).
 *
 * earth/planner.js turns typed mean elements into a Two-Line Element set and checks
 * what was typed. Every claim in it is only worth something if a second
 * implementation agrees, so nothing here compares the planner with itself:
 *
 *  - SGP4 (satellite.js 6.0.1, verification/satellite.min.js) reads the lines the
 *    planner writes and must hand back the orbit that was typed: semi-major axis,
 *    eccentricity, angles, epoch, B*, secular rates, node crossings, decay.
 *  - The checksum is re-implemented here with a regex and run over every one of the
 *    4,316 lines of verification/catalog.txt.
 *  - Real element sets (ISS, Landsat 8, Sentinel-2A, TerraSAR-X, KNACKSAT-2) come
 *    from the same catalogue and must give the numbers their missions publish.
 *  - Page-side constants (Lifetime.rho, Lifetime.integrate) come from earth/lifetime.js,
 *    the very atmosphere the Decay section uses.
 *
 * Why each group exists is a defect that would otherwise have shipped, or a number
 * that was measured: the golden TLE text pins the rounding order (V4b), the quantum-
 * aware round trip pins the Kozai inversion (V5), the 120 km clamp pins the matched
 * B* (V14b), the mirror sweep pins the i = 180 singularity (V18), and so on. Each
 * has a mutation (SPEC 7.7) that makes one named check here fail.
 *
 *   node verification/verify-planner.js
 *   PLANNER_JS=/abs/path/to/planner.js node verification/verify-planner.js   (a mutant)
 *
 * The env override exists so a deliberately broken copy can be run against this suite
 * without touching earth/planner.js: a check that cannot fail is not a check.
 *
 * No page and no browser: node and satellite.js only. Ends ALL CHECKS PASS.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

require(path.join(__dirname, '..', 'earth', 'lifetime.js'));
const PLANNER_JS = process.env.PLANNER_JS ? path.resolve(process.env.PLANNER_JS) : path.join(__dirname, '..', 'earth', 'planner.js');
require(PLANNER_JS);
const sat = require('./satellite.min.js');
const P = globalThis.Planner, L = globalThis.Lifetime;

let fails = 0, total = 0;
const chk = (name, ok, detail) => {
  total++;
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};
const near = (name, got, want, tol, note) =>
  chk(name, Math.abs(got - want) <= tol, 'got ' + got + ' want ' + want + ' +-' + tol + (note ? ' ' + note : ''));
/* a group of checks that throws is one failed check, named for the group, not a crash */
const group = (id, fn) => {
  console.log('\n' + id);
  try { fn(); } catch (e) { chk(id + ': ran to the end', false, 'threw ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
};
function rng(seed) {                                    // mulberry32: deterministic, good enough for sweeps
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const RE = 6378.137, RE72 = 6378.135, MU72 = 398600.8, MU_SI = 3.986004418e14;
const D2R = Math.PI / 180, R2D = 180 / Math.PI, PERDAY = 1440 * R2D;   // rad/min -> deg/day
const EP = Date.UTC(2026, 9, 1, 12);
const wrap360 = x => ((x % 360) + 360) % 360;
const angDiff = (x, y) => Math.abs(((x - y) % 360 + 540) % 360 - 180);
const tolA = (a, n) => 1.2 * (2 / 3) * a * 5e-9 / n + 1e-6;     // SPEC 3.3: the quantum of the written n
const elOf = (a, e, i, o) => Object.assign({ a, e, i, raan: 30, argp: 0, M: 0, epoch: EP, am: null, bstar: 0 }, o || {});
const mkSat = (el, sn) => { const t = P.toTLE(el, sn || '99901'); return { t, s: sat.twoline2satrec(t.l1, t.l2) }; };
const lonDeg = (pv, ms) => { const g = sat.eciToGeodetic(pv.position, sat.gstime(new Date(ms))); let x = g.longitude * R2D; while (x > 180) x -= 360; while (x < -180) x += 360; return x; };
const osc = pv => {                                     // osculating a from r and v, SGP4's own mu
  const r = Math.hypot(pv.position.x, pv.position.y, pv.position.z), v2 = pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2;
  return 1 / (2 / r - v2 / MU72);
};
const osculatingRaan = pv => {                          // from the angular momentum vector
  const r = pv.position, v = pv.velocity;
  const hx = r.y * v.z - r.z * v.y, hy = r.z * v.x - r.x * v.z;
  return wrap360(Math.atan2(hx, -hy) * R2D);
};
const slope = (ts, ys) => {                             // least squares, y unwrapped when it is an angle
  const n = ts.length, mt = ts.reduce((x, y) => x + y) / n, my = ys.reduce((x, y) => x + y) / n;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (ts[k] - mt) * (ys[k] - my); sxx += (ts[k] - mt) ** 2; }
  return sxy / sxx;
};
const unwrap = ys => { const u = [ys[0]]; for (let k = 1; k < ys.length; k++) { let d = ys[k] - ys[k - 1]; while (d > 180) d -= 360; while (d < -180) d += 360; u.push(u[k - 1] + d); } return u; };

/* the catalogue: name, line 1, line 2 */
const catLines = fs.readFileSync(path.join(__dirname, 'catalog.txt'), 'utf8').split(/\r?\n/).filter(x => x.length);
const CAT = [];
for (let k = 0; k + 2 < catLines.length; k += 3) CAT.push({ name: catLines[k].trim(), l1: catLines[k + 1], l2: catLines[k + 2] });
const real = name => { const e = CAT.find(x => x.name === name); if (!e) throw new Error('catalogue has no ' + name); return e; };
const parseTle = e => {                                 // independent of the planner: columns of the real lines
  const yy = +e.l1.slice(18, 20), doy = +e.l1.slice(20, 32);
  return { epochMs: Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (doy - 1) * 86400000,
    inc: +e.l2.slice(8, 16), raan: +e.l2.slice(17, 25), ecc: +('0.' + e.l2.slice(26, 33).trim()), n: +e.l2.slice(52, 63) };
};
const ISS = real('ISS (ZARYA)'), LANDSAT = real('LANDSAT 8'), S2A = real('SENTINEL-2A'), TSX = real('TERRA SAR X'), KNACK = real('KNACKSAT-2');

/* ======================================================================================= */
group('V0 constants: the planner must be on satellite.js\'s WGS-72 set, bit for bit', () => {
  for (const [k, v] of [['earthRadius', P.C72.Re], ['mu', P.C72.mu], ['j2', P.C72.J2], ['j3', P.C72.J3], ['j4', P.C72.J4], ['xke', P.C72.xke], ['xpdotp', P.C72.xpdotp]])
    chk('V0 C72 ' + k + ' == satellite.constants.' + k, sat.constants[k] === v, sat.constants[k] + ' vs ' + v);
  chk('V0 C72 is frozen', Object.isFrozen(P.C72) && Object.isFrozen(P.LIMITS));
  const R = rng(1); let worst = 0;
  for (let k = 0; k < 1000; k++) {
    const ms = Date.UTC(2000, 0, 1) + R() * (Date.UTC(2056, 11, 31) - Date.UTC(2000, 0, 1));
    worst = Math.max(worst, Math.abs(P.gmstDeg(ms) * D2R - sat.gstime(new Date(ms))));
  }
  chk('V0 gmstDeg == satellite.gstime on 1,000 random dates (1e-9 rad)', worst <= 1e-9, 'worst ' + worst + ' rad');
  const WE = (876600 * 3600 + 8640184.812866) / 36525 / 240;
  near('V0 WE_DEG_DAY == gstime\'s own rate (876600*3600+8640184.812866)/36525/240', P.WE_DEG_DAY, WE, 1e-9, '(BODY.omega gives 360.985605026, 4.2e-5 off)');
  let dg = 0;                                             // the same thing measured through the library: GMST gains WE-360 per day
  for (const ms of [EP, Date.UTC(2010, 3, 5, 7), Date.UTC(2040, 11, 1)]) {
    const d = wrap360((sat.gstime(new Date(ms + 864e5)) - sat.gstime(new Date(ms))) * R2D);
    dg = Math.max(dg, Math.abs(d - (P.WE_DEG_DAY - 360)));
  }
  chk('V0 gstime gains WE_DEG_DAY - 360 degrees a day (library, three dates, 1e-6)', dg <= 1e-6, 'worst ' + dg);
  near('V0 MEAN_SUN_RATE deg/day', P.MEAN_SUN_RATE, 0.985647360, 1e-9);
  near('V0 RE is the WGS-84 altitude datum', P.RE, 6378.137, 0);
  chk('V0 LIMITS values', P.LIMITS.maxCustom === 12 && P.LIMITS.nameMax === 24 && P.LIMITS.storeMaxChars === 65536 && P.LIMITS.aMax === 400000 &&
    P.LIMITS.amMax === 10 && P.LIMITS.bstarMax === 0.1 && P.LIMITS.epochMin === Date.UTC(2000, 0, 1) && P.LIMITS.epochMax === Date.UTC(2056, 11, 31, 23, 59, 59) && P.SCHEMA === 1);
});

group('V1 checksum: the two ISS lines, an independent implementation, and every catalogue line', () => {
  chk('V1 ISS line 1 checksum 7', P.checksum(ISS.l1.slice(0, 68)) === 7);
  chk('V1 ISS line 2 checksum 8', P.checksum(ISS.l2.slice(0, 68)) === 8);
  const indep = l => (l.slice(0, 68).replace(/[^0-9-]/g, '').split('').reduce((s, c) => s + (c === '-' ? 1 : +c), 0)) % 10;
  const lines = []; for (const e of CAT) lines.push(e.l1, e.l2);
  let bad = 0, disagree = 0, notOk = 0, wrongLen = 0;
  for (const l of lines) {
    if (l.length !== 69) wrongLen++;
    if (indep(l) !== +l[68]) bad++;
    if (P.checksum(l.slice(0, 68)) !== indep(l)) disagree++;
    if (!P.checksumOk(l)) notOk++;
  }
  chk('V1 catalogue has 2,158 spacecraft = 4,316 element lines, all 69 characters', CAT.length === 2158 && lines.length === 4316 && wrongLen === 0, CAT.length + ' sets, ' + wrongLen + ' off length');
  chk('V1 every catalogue line validates by the independent regex implementation', bad === 0, bad + ' mismatches');
  chk('V1 Planner.checksum agrees with it on all 4,316 lines', disagree === 0, disagree + ' disagreements');
  chk('V1 Planner.checksumOk accepts all 4,316 lines', notOk === 0, notOk + ' rejected');
  chk('V1 a "+" counts nothing (checksumOk on a line that has one)', P.checksumOk(S2A.l1), 'SENTINEL-2A line 1 carries "00000+0"');
  const flipped = ISS.l1.slice(0, 68) + '8';
  chk('V1 checksumOk rejects a wrong check digit, a short line, a non-string', !P.checksumOk(flipped) && !P.checksumOk(ISS.l1.slice(0, 68)) && !P.checksumOk(null) && !P.checksumOk(undefined) && !P.checksumOk(12));
  chk('V1 a minus sign counts 1', P.checksum('-'.padEnd(68, ' ')) === 1 && P.checksum('--'.padEnd(68, ' ')) === 2 && P.checksum('+'.padEnd(68, ' ')) === 0);
});

group('V2 B* field: vectors, the carry, and a round trip through an independent parser', () => {
  for (const [x, txt] of [[0, ' 00000+0'], [1e-4, ' 10000-3'], [1.027e-4, ' 10270-3'], [-1.1606e-4, '-11606-3'], [3.736e-4, ' 37360-3'], [0.5, ' 50000+0'],
    [0.99999, ' 99999+0'], [1e-10, ' 10000-9'], [4.9e-11, ' 00000+0'], [9.99995e-5, ' 10000-3'], [0.0123456, ' 12346-1'],
    [0.999996, ' 10000+1'], [9.99996e-4, ' 10000-2'], [-0.5, '-50000+0'], [2, ' 20000+1'], [123456, ' 12346+6']])
    chk('V2 expField(' + x + ') = "' + txt + '"', P.expField(x).txt === txt, 'got "' + P.expField(x).txt + '"');
  const throws = (f, name) => { try { f(); return false; } catch (e) { return e instanceof RangeError && (!name || e.name === name); } };
  chk('V2 expField(1e9) throws RangeError (one exponent digit)', throws(() => P.expField(1e9)));
  chk('V2 expField(9.999996e8) throws: the mantissa carry pushes the exponent to 10', throws(() => P.expField(9.999996e8)));
  chk('V2 expField(-1e9), NaN, Infinity, a string all throw RangeError', throws(() => P.expField(-1e9)) && throws(() => P.expField(NaN)) && throws(() => P.expField(Infinity)) && throws(() => P.expField('1')));
  chk('V2 every field is 8 characters and the mantissa is five digits (carry never makes it six)', (() => {
    const R = rng(2); for (let k = 0; k < 5000; k++) {
      const x = (R() < 0.5 ? -1 : 1) * Math.pow(10, -10 + R() * 18.99); const t = P.expField(x).txt;
      if (t.length !== 8 || !/^[ -]\d{5}[+-]\d$/.test(t)) return false; } return true; })());
  const parse = t => (t[0] === '-' ? -1 : 1) * Number('0.' + t.slice(1, 6)) * Math.pow(10, Number(t[6] + t[7]));
  let worst = 0, worstV = 0; const R = rng(3);
  for (let k = 0; k < 5000; k++) {
    const x = Math.pow(10, -9.5 + R() * 18.4) * (R() < 0.5 ? -1 : 1), f = P.expField(x);
    worst = Math.max(worst, Math.abs(parse(f.txt) - x) / Math.abs(x)); worstV = Math.max(worstV, Math.abs(f.value - parse(f.txt)) / Math.abs(parse(f.txt)));
  }
  chk('V2 independent parse of the text is within one unit of the fifth digit of x (5.5e-5)', worst <= 5.5e-5, 'worst relative ' + worst);
  chk('V2 .value is exactly what the text holds (1e-12)', worstV <= 1e-12, 'worst ' + worstV);
});

group('V3 epoch field: vectors, the year-end carry, the range, an independent parse', () => {
  for (const [ms, txt] of [[Date.UTC(2026, 9, 1, 12), '26274.50000000'], [Date.UTC(2026, 0, 1), '26001.00000000'], [Date.UTC(2024, 11, 31, 23, 59, 59, 999), '24366.99999999'],
    [Date.UTC(2026, 11, 31, 23, 59, 59, 999) + 0.9, '27001.00000000'], [Date.UTC(2056, 11, 31, 23, 59, 59, 999), '56366.99999999'], [Date.UTC(1957, 0, 1), '57001.00000000'],
    [Date.UTC(2000, 1, 29, 6), '00060.25000000'], [Date.UTC(2023, 11, 31, 12), '23365.50000000']]) {
    const f = P.epochFields(ms);
    chk('V3 epoch ' + new Date(ms).toISOString() + (ms % 1 ? ' (+0.9 ms)' : '') + ' -> ' + txt, f.yy + f.doyTxt === txt, 'got ' + f.yy + f.doyTxt);
  }
  for (const ms of [Date.UTC(2057, 0, 1), Date.UTC(1956, 11, 31), NaN, Infinity, 1e300])
    chk('V3 epochFields(' + ms + ') throws RangeError', (() => { try { P.epochFields(ms); return false; } catch (e) { return e instanceof RangeError; } })());
  chk('V3 the year rolls over: 2026-12-31T23:59:59.9996 is year 2027 in the result', P.epochFields(Date.UTC(2026, 11, 31, 23, 59, 59, 999) + 0.9).year === 2027);
  let worst = 0, badTxt = 0; const R = rng(4);
  for (let k = 0; k < 3000; k++) {
    const ms = Date.UTC(1957, 0, 1) + R() * (Date.UTC(2056, 11, 31, 23) - Date.UTC(1957, 0, 1)), f = P.epochFields(ms);
    if (!/^\d{2}\d{3}\.\d{8}$/.test(f.yy + f.doyTxt)) badTxt++;
    const yy = +f.yy, y = yy < 57 ? 2000 + yy : 1900 + yy, back = Date.UTC(y, 0, 1) + (+f.doyTxt - 1) * 86400000;
    worst = Math.max(worst, Math.abs(back - ms), Math.abs(f.epochMsExact - ms));
  }
  chk('V3 text is yyDDD.DDDDDDDD and parses back to within half the 0.864 ms quantum (0.44 ms)', badTxt === 0 && worst <= 0.44, 'worst ' + worst + ' ms, ' + badTxt + ' malformed');
  let wExact = 0;
  { const R5 = rng(41); for (let k = 0; k < 3000; k++) { const ms = Date.UTC(1957, 0, 1) + R5() * 99 * 365.25 * 864e5, f = P.epochFields(ms), yy = +f.yy, y = yy < 57 ? 2000 + yy : 1900 + yy; wExact = Math.max(wExact, Math.abs(f.epochMsExact - (Date.UTC(y, 0, 1) + (+f.doyTxt - 1) * 86400000))); } }
  chk('V3 epochMsExact is the instant the WRITTEN text decodes to (1e-3 ms), not the typed epoch: that is what SGP4 will be asked for', wExact <= 1e-3 && P.epochFields(EP + 0.3).epochMsExact === EP, 'worst ' + wExact + ' ms');
});

group('V4 the golden TLE text, the rounding order (V4b), and what satellite.js reads back', () => {
  const el = { a: 6878.137, e: 0.0011, i: 97.426, raan: 123.4, argp: 90, M: 270, epoch: EP, am: null, bstar: 3.736e-4 };
  const t = P.toTLE(el, '99901');
  chk('V4 line 1', t.l1 === '1 99901U          26274.50000000  .00000000  00000-0  37360-3 0    10', t.l1);
  chk('V4 line 2', t.l2 === '2 99901  97.4260 123.4000 0011000  90.0000 270.0000 15.20929136    06', t.l2);
  const k = P.kozaiFromBrouwer(6878.137, 0.0011, 97.426);
  near('V4 Kozai n, unrounded (rev/day)', k.nRevDay, 15.2092913607, 2e-9);
  chk('V4 the inversion converged in 6 passes', k.iters === 6, 'iters ' + k.iters);
  const s = sat.twoline2satrec(t.l1, t.l2);
  near('V4 satrec.a * 6378.135 == the typed 6878.137', s.a * RE72, 6878.137, 1e-5);
  near('V4 satrec.bstar', s.bstar, 3.736e-4, 1e-12);
  near('V4 satrec.ecco', s.ecco, 0.0011, 1e-12);
  chk('V4 satrec.error === 0', s.error === 0);
  chk('V4 toTLE returns {l1,l2,epochMsExact,nRevDay,eccValue,bstarValue}', t.nRevDay === 15.20929136 && t.eccValue === 0.0011 && Math.abs(t.bstarValue - 3.736e-4) < 1e-12 && Math.abs(t.epochMsExact - EP) < 0.5);
  /* V4b: e 0.0049999 and i 30.00004. i rounds to 30.0000 BEFORE the inversion, so n is 15.23267823; inverting the
     unrounded i gives 15.23267821 and a different checksum: a difference in the text itself */
  const b = P.toTLE({ a: 6878.137, e: 0.0049999, i: 30.00004, raan: 123.4, argp: 90, M: 270, epoch: EP, am: null, bstar: 3.736e-4 }, '99901');
  chk('V4b line 1', b.l1 === '1 99901U          26274.50000000  .00000000  00000-0  37360-3 0    10');
  chk('V4b line 2 (n 15.23267823, checksum 0): rounding e and i FIRST', b.l2 === '2 99901  30.0000 123.4000 0049999  90.0000 270.0000 15.23267823    00', b.l2);
  near('V4b unrounded Kozai n with the rounded i', P.kozaiFromBrouwer(6878.137, 0.0049999, 30).nRevDay, 15.2326782254, 2e-9);
  near('V4b unrounded i would have given 15.2326782061 (what a wrong order writes as ...21)', P.kozaiFromBrouwer(6878.137, 0.0049999, 30.00004).nRevDay, 15.2326782061, 2e-9);
  const sb = sat.twoline2satrec(b.l1, b.l2);
  near('V4b satrec.a * 6378.135', sb.a * RE72, 6878.137, 1e-5);
  near('V4b satrec.ecco', sb.ecco, 0.0049999, 1e-12);
  chk('V4 the same element set gives the same two lines twice', (() => { const u = P.toTLE(el, '99901'); return u.l1 === t.l1 && u.l2 === t.l2; })());
  const o = P.toTLE(el, 'O0001');
  chk('V4 the placeholder number O0001 gives valid lines (checksums, columns 3-7)', P.checksumOk(o.l1) && P.checksumOk(o.l2) && o.l1.slice(2, 7) === 'O0001' && o.l2.slice(2, 7) === 'O0001');
  chk('V4 fixed fields: class U, blank designator, ndot, nddot, ephemeris 0, set 1, revolution 0',
    t.l1.slice(7, 8) === 'U' && t.l1.slice(9, 17) === '        ' && t.l1.slice(33, 43) === ' .00000000' && t.l1.slice(44, 52) === ' 00000-0' && t.l1[62] === '0' && t.l1.slice(64, 68) === '   1' && t.l2.slice(63, 68) === '    0');
  const bad = (f) => { try { f(); return 'no throw'; } catch (e) { return e instanceof RangeError ? 'RangeError' : e.name; } };
  for (const [what, f] of [['satnum of 4 characters', () => P.toTLE(el, '9990')], ['lower-case satnum', () => P.toTLE(el, '9990a')], ['numeric satnum', () => P.toTLE(el, 99901)],
    ['punctuated satnum', () => P.toTLE(el, '99.01')], ['6-character satnum', () => P.toTLE(el, '999011')], ['n >= 100 rev/day (a 1,900 km)', () => P.toTLE(elOf(1900, 0, 0), '99901')],
    ['e that rounds to 1', () => P.toTLE(elOf(7000, 0.99999999, 10), '99901')], ['epoch in 2057', () => P.toTLE(elOf(7000, 0, 10, { epoch: Date.UTC(2057, 0, 1) }), '99901')],
    ['|B*| of 1e9', () => P.toTLE(elOf(7000, 0, 10, { bstar: 1e9 }), '99901')], ['no B*', () => P.toTLE({ a: 7000, e: 0, i: 10, raan: 0, argp: 0, M: 0, epoch: EP }, '99901')],
    ['inclination 181', () => P.toTLE(elOf(7000, 0, 181), '99901')], ['negative eccentricity', () => P.toTLE(elOf(7000, -0.1, 10), '99901')], ['null element set', () => P.toTLE(null, '99901')]])
    chk('V4 toTLE refuses ' + what + ' with RangeError', bad(f) === 'RangeError', bad(f));
  const w = P.toTLE(elOf(7000, 0.001, 10, { raan: 360, argp: -10, M: 359.99996 }), '99901');
  chk('V4 angles are wrapped and "360.0000" is written "0.0000"', w.l2.slice(17, 25) === '  0.0000' && w.l2.slice(34, 42) === '350.0000' && w.l2.slice(43, 51) === '  0.0000', w.l2);
});

group('V5 Kozai <-> Brouwer: vectors, the grid, the corners, a 20,000-set sweep, convergence', () => {
  for (const [a, e, i, nk] of [[6878.137, 0, 0, 15.24068377], [6878.137, 0, 51.6, 15.22104543], [6878.137, 0, 97.8, 15.20934588], [42164.182, 0, 0, 1.00277518], [26562, 0.74, 63.4349, 2.00532641], [7078.137, 0.0011, 98.2, 14.56987756]])
    near('V5 kozaiFromBrouwer(' + a + ',' + e + ',' + i + ') rev/day', P.kozaiFromBrouwer(a, e, i).nRevDay, nk, 2e-8);
  const eq = (a, e, i) => Math.cbrt(MU72 / (P.kozaiFromBrouwer(a, e, i).nRevDay * 2 * Math.PI / 86400) ** 2) - a;
  near('V5 (mu/n^2)^(1/3) minus Brouwer a at i = 0 (km)', eq(6878.137, 0, 0), -6.414, 0.002);
  near('V5 ... at i = 51.6', eq(6878.137, 0, 51.6), -0.504, 0.002);
  near('V5 ... at i = 97.8', eq(6878.137, 0, 97.8), 3.022, 0.002);
  near('V5 ... GEO', eq(42164.182, 0, 0), -1.045, 0.002);
  near('V5 ... Molniya', eq(26562, 0.74, 63.4349), 1.090, 0.002);
  let worst = 0, over = 0, cases = 0;
  for (const a of [6578.137, 6878.137, 8378.137, 26562, 42164.182]) for (const e of [0, 0.001, 0.1, 0.74]) for (const i of [0, 28.5, 63.4349, 97.4, 116.5651, 180]) {
    if (a * (1 - e) < RE + 100) continue;
    const { t, s } = mkSat(elOf(a, e, i)); const r = Math.abs(s.a * RE72 - a); cases++;
    worst = Math.max(worst, r / tolA(a, t.nRevDay)); if (r > tolA(a, t.nRevDay)) over++;
  }
  chk('V5 grid (a x e x i, ' + cases + ' sets): |satrec.a*Re - a| within the quantum-aware tol_a', over === 0, 'worst ' + worst.toFixed(3) + ' of the bound');
  for (const [a, e, i] of [[400000, 0, 51.6], [393200, 0.5, 0]]) {
    const el = elOf(a, e, i), { t, s } = mkSat(el), v = P.verifyTLE(t.l1, t.l2, el, sat);
    chk('V5 corner (a ' + a + ', e ' + e + ', i ' + i + '): within tol_a', Math.abs(s.a * RE72 - a) <= tolA(a, t.nRevDay), 'residual ' + Math.abs(s.a * RE72 - a).toExponential(2) + ' km, tol_a ' + tolA(a, t.nRevDay).toExponential(2));
    chk('V5 corner (a ' + a + ', e ' + e + ', i ' + i + '): verifyTLE.ok with a whole period probed and no refused sample', v.ok && v.probe.n === 400 && v.probe.refused === 0, JSON.stringify(v.errors.concat(v.warnings).map(x => x.code)) + ' refused ' + v.probe.refused);
  }
  const R = rng(5); let n = 0, bad = 0, w = 0;
  while (n < 20000) {
    const a = 6700 + 1300 * R(), e = 0.02 * R(), i = 180 * R();
    if (a * (1 - e) < RE) continue;
    const { t, s } = mkSat(elOf(a, e, i)); const r = Math.abs(s.a * RE72 - a), tol = tolA(a, t.nRevDay);
    w = Math.max(w, r / tol); if (r > tol) bad++; n++;
  }
  chk('V5 20,000 seeded LEO sets all within tol_a (inverting before e and i are rounded puts 7,010 of them outside it, worst 3.52 of the bound: measured with that mutant)', bad === 0, bad + ' over, worst ' + w.toFixed(3) + ' of the bound');
  /* valid orbits only (perigee above the ground): below it e near 1 makes the correction huge and slow, and nothing there can be added */
  const R2 = rng(6); let maxIt = 0, ncv = 0;
  while (ncv < 60000) {
    const a = RE + Math.exp(Math.log(100) + R2() * (Math.log(1.2e6) - Math.log(100))), e = 0.995 * R2();
    if (a * (1 - e) < RE) continue;
    maxIt = Math.max(maxIt, P.kozaiFromBrouwer(a, e, 180 * R2()).iters); ncv++;
  }
  const extreme = P.kozaiFromBrouwer(1.2e6, 0.995, 0).iters;
  chk('V5 convergence in at most 7 passes (60,000 valid orbits: e to 0.995, i 0-180, a to 1.2e6)', maxIt <= 7 && extreme <= 7, 'max ' + maxIt + ', extreme ' + extreme);
  chk('V5 kozaiFromBrouwer is NaN (no throw) for garbage', Number.isNaN(P.kozaiFromBrouwer(-5, 0, 0).nRevDay) && Number.isNaN(P.kozaiFromBrouwer(NaN, 0, 0).nRevDay) && Number.isNaN(P.kozaiFromBrouwer('x', 0, 0).nRevDay));
  near('V5 brouwerFromKozai inverts kozaiFromBrouwer (1e-9 km)', P.brouwerFromKozai(P.kozaiFromBrouwer(7500, 0.02, 63).nRevDay, 0.02, 63), 7500, 1e-9);
});

group('V6, V7 real ISS, period and apsis conversions, the deep-space threshold', () => {
  const p = parseTle(ISS), a = P.brouwerFromKozai(p.n, p.ecc, p.inc), s = sat.twoline2satrec(ISS.l1, ISS.l2);
  near('V6 ISS brouwerFromKozai == satrec.a * 6378.135 (km)', a, s.a * RE72, 5e-5);
  near('V6 ISS Brouwer a is the 6798.041 km the page prints', a, 6798.041, 1e-3);
  near('V7 P(6878.137) in seconds (5e-4 s catches mu 398600.4418, which moves it 2.55 ms)', P.periodMin(6878.137) * 60, 5676.975478, 5e-4);
  near('V7 P(6878.137) in minutes', P.periodMin(6878.137), 94.616258, 1e-6);
  near('V7 a(P = 100 min) (1e-3 km catches mu 398600.4418, which moves it 2.1 m)', P.aFromPeriodMin(100), 7136.637593, 1e-3);
  const f = P.fromForm({ shape: 'alt', nodeMode: 'raan', hp: 250, ha: 35786, inc: 28.5, raan: 0, argp: 0, ma: 0, epoch: '2026-10-01T12:00:00', am: 0.0043 });
  near('V7 hp 250 / ha 35786 -> a', f.derived.a, 24396.137, 1e-6);
  near('V7 ... e', f.derived.e, 0.728312, 1e-6);
  near('V7 deep-space threshold a for P = 225 min', P.DEEP_A_KM, 12254.116046, 1e-3, '(3.7 m off with mu 398600.4418)');
  near('V7 geostationary a', P.GEO_A_KM, 42164.182254, 1e-3);
  near('V7 SIDEREAL_MIN agrees with the sidereal day', P.SIDEREAL_MIN * 60, P.SIDEREAL_DAY_S, 0.01);
  near('V7 aFromPeriodMin(periodMin(a)) == a', P.aFromPeriodMin(P.periodMin(9000.123)), 9000.123, 1e-9);
  const ap = P.apsides(24396.137, 0.728312);
  chk('V7 apsides: rp, ra radii and mean altitudes about 6378.137', Math.abs(ap.hp - 250) < 0.01 && Math.abs(ap.ha - 35786) < 0.1 && Math.abs(ap.rp - (ap.hp + RE)) < 1e-9 && Math.abs(ap.ra - (ap.ha + RE)) < 1e-9);
  /* SGP4 itself switches branch at a Kepler period of 225 min of the Brouwer a: 12254.0 is near-earth, 12254.3 deep */
  const m0 = mkSat(elOf(12254.0, 0, 30)).s.method, m1 = mkSat(elOf(12254.3, 0, 30)).s.method;
  chk('V7 satrec.method flips from near-earth to deep space between a = 12254.0 and 12254.3 km', m0 === 'n' && m1 === 'd', m0 + ' / ' + m1);
  chk('V7 isDeep agrees with SGP4\'s branch on both sides, and on DEEP_A_KM itself', !P.isDeep(12254.0) && P.isDeep(12254.3) && P.isDeep(P.DEEP_A_KM) && !P.isDeep(P.DEEP_A_KM - 1e-6));
});

group('V8 SGP4 secular rates', () => {
  const R = P.rates(6878.137, 0, 97.426);
  near('V8 nodedot deg/day', R.nodedot, 0.985650, 2e-6);
  near('V8 argpdot deg/day', R.argpdot, -3.497181, 2e-6);
  near('V8 mdot deg/day', R.mdot, 5475.342700, 2e-5);
  near('V8 nodal period (min)', R.nodalPeriodS / 60, 94.7395, 5e-5);
  chk('V8 flags: near-earth is not deep, source is sgp4init', R.deep === false && R.source === 'sgp4init');
  near('V8 ISS-like nodedot (a 6798.137, e 5e-4, i 51.64)', P.rates(6798.137, 0.0005, 51.64).nodedot, -4.94924, 2e-5);
  /* the rates equal what SGP4 itself applies, from the SAME a, e, i the satrec holds (the quantum of the
     written n is a separate matter, V5): 340 random near-earth orbits */
  const Rn = rng(8); let n = 0, wn = 0, wa = 0, wm = 0;
  while (n < 340) {
    const a = 6600 + Rn() * 5600, e = Rn() * 0.3, i = Rn() * 180;
    if (a * (1 - e) < RE + 100) continue;
    let s; try { s = mkSat(elOf(a, e, i, { raan: Rn() * 360, argp: Rn() * 360, M: Rn() * 360 })).s; } catch (x) { continue; }
    if (s.method !== 'n') continue;
    const r = P.rates(s.a * RE72, s.ecco, s.inclo * R2D);
    wn = Math.max(wn, Math.abs(s.nodedot * PERDAY - r.nodedot)); wa = Math.max(wa, Math.abs(s.argpdot * PERDAY - r.argpdot)); wm = Math.max(wm, Math.abs(s.mdot * PERDAY - r.mdot) / r.mdot);
    n++;
  }
  chk('V8 nodedot == satrec.nodedot to 1e-9 deg/day over 340 orbits', wn <= 1e-9, 'worst ' + wn);
  chk('V8 argpdot == satrec.argpdot to 1e-9 deg/day over 340 orbits', wa <= 1e-9, 'worst ' + wa);
  chk('V8 mdot == satrec.mdot to 1e-12 relative over 340 orbits', wm <= 1e-12, 'worst ' + wm);
  /* first-order J2 is what this replaces: 0.024-0.028 deg off the sun-synchronous inclination */
  const k1 = 1.5 * 0.001082616 * (RE72 / 6878.137) ** 2 * Math.sqrt(MU72 / 6878.137 ** 3) * 86400 * R2D;
  chk('V8 first-order J2 differs from SGP4\'s rate at 500 km SSO by more than the 1e-4 deg/day the checks use', Math.abs(-k1 * Math.cos(97.426 * D2R) - R.nodedot) > 1e-3, 'difference ' + Math.abs(-k1 * Math.cos(97.426 * D2R) - R.nodedot).toFixed(5));
  /* deep space: the Moon and Sun terms come from a satrec; measured against the osculating node slope over 10 days */
  const mol = elOf(26554.137, 0.74, 63.4, { raan: 30, argp: 270 }), ms = mkSat(mol).s;
  const r0 = P.rates(mol.a, 0.74, 63.4), r1 = P.rates(mol.a, 0.74, 63.4, ms);
  chk('V8 Molniya without a satrec: deep:true, source sgp4init (the caller labels it about +-5 %)', r0.deep === true && r0.source === 'sgp4init');
  chk('V8 Molniya with a satrec: deep:true, source satrec, node rate = J2/J4 + satrec.dnodt exactly', r1.deep === true && r1.source === 'satrec' && Math.abs(r1.nodedot - (r0.nodedot + ms.dnodt * PERDAY)) < 1e-12);
  const Tn = 360 / (r1.mdot + r1.argpdot) * 86400000, ts = [], om = [];
  const { s: ss } = mkSat(mol);
  for (let k = 0; k * Tn <= 10 * 86400000; k++) { const pv = sat.propagate(ss, new Date(EP + k * Tn)); if (!pv || !pv.position) break; ts.push(k * Tn / 86400000); om.push(osculatingRaan(pv)); }
  const meas = slope(ts, unwrap(om));
  chk('V8 Molniya: osculating node slope over 10 d (constant phase) = ' + meas.toFixed(5) + ' vs the satrec rate within 1 % and the J2/J4-only rate more than 3 % off', Math.abs(r1.nodedot - meas) / Math.abs(meas) < 0.01 && Math.abs(r0.nodedot - meas) / Math.abs(meas) > 0.03, 'with satrec ' + r1.nodedot.toFixed(5) + ', J2/J4 ' + r0.nodedot.toFixed(5));
  chk('V8 a satrec handed to a near-earth orbit is ignored', P.rates(6878.137, 0, 97.426, ms).source === 'sgp4init' && P.rates(6878.137, 0, 97.426, ms).nodedot === R.nodedot);
});

group('V9 sun-synchronous inclination: SGP4\'s own root, checked against SGP4\'s own node rate', () => {
  const nodeBySgp4 = (a, e, i) => mkSat(elOf(a, e, i)).s.nodedot * PERDAY;
  for (const [h, i] of [[300, 96.6953], [400, 97.0538], [500, 97.4260], [600, 97.8123], [700, 98.2130], [800, 98.6285], [1000, 99.5054], [1200, 100.4462], [2000, 104.9182], [5000, 138.5430]]) {
    const got = P.ssoInclination(RE + h, 0);
    near('V9 i_SSO at ' + h + ' km', got, i, 2e-4);
    near('V9 SGP4\'s node rate at the root (' + h + ' km) is the Sun\'s 0.985647', nodeBySgp4(RE + h, 0, got), 0.985647, 1e-4);
  }
  near('V9 i_SSO at 7078.137 km, e = 0.05', P.ssoInclination(7078.137, 0.05), 98.1718, 2e-4);
  chk('V9 none above 5985 km altitude, one at 5975 km', P.ssoInclination(RE + 5985, 0) === null && P.ssoInclination(RE + 5975, 0) !== null);
  const am = P.ssoAmaxKm(0);
  near('V9 largest sun-synchronous altitude at e = 0 (km)', am - RE, 5981.7, 0.05);
  chk('V9 ssoAmaxKm is the edge: a root just below it, none just above', P.ssoInclination(am - 0.01, 0) !== null && P.ssoInclination(am + 0.01, 0) === null);
  chk('V9 ssoInclination refuses garbage without throwing', P.ssoInclination(NaN, 0) === null && P.ssoInclination(-1, 0) === null && P.ssoInclination(7000, 1.2) === null && P.ssoInclination(7000, 'x') === null);
  /* real element sets: the published i is within a few thousandths of the sun-synchronous root for its own a, e */
  for (const [nm, e, want] of [['SENTINEL-2A', S2A, 98.5699], ['LANDSAT 8', LANDSAT, 98.2115], ['TERRA SAR X', TSX, 97.4464]]) {
    const p = parseTle(e), a = P.brouwerFromKozai(p.n, p.ecc, p.inc);
    near('V9 real ' + nm + ': i_SSO(a, e) from its own element set', P.ssoInclination(a, p.ecc), want, 5e-4);
  }
  /* above 12,254 km the Moon and Sun terms come from a satrec: with env.sat the root moves */
  const deepJ = P.ssoInclination(12300, 0), deepS = P.ssoInclination(12300, 0, { sat, epoch: EP });
  chk('V9 above the deep-space threshold env.sat changes the answer (lunisolar terms)', deepJ !== null && deepS !== null && Math.abs(deepJ - deepS) > 1e-4, deepJ + ' vs ' + deepS);
  if (deepS !== null) {
    const s = mkSat(elOf(12300, 0, deepS)).s;
    near('V9 deep root with env.sat: SGP4 node rate incl. dnodt is the Sun\'s', (s.nodedot + s.dnodt) * PERDAY, 0.985647, 2e-3);
  }
});

group('V10 local time of the node, and the mean Sun', () => {
  const EP0 = Date.UTC(2026, 9, 1);
  near('V10 mean-sun RA at 2026-10-01 00Z (deg)', P.meanSunRaDeg(EP0), 189.74256, 2e-5);
  near('V10 LTAN of RAAN 123.4 (h)', P.ltanFromRaan(123.4, EP0), 7.57716, 2e-5);
  near('V10 RAAN of LTAN 10:30 (deg)', P.raanFromLtan(10.5, EP0), 167.2426, 2e-4);
  const R = rng(10); let w1 = 0, range = true;
  for (let k = 0; k < 2000; k++) {
    const ms = Date.UTC(2000, 0, 1) + R() * 56 * 365.25 * 864e5, raan = R() * 360, h = P.ltanFromRaan(raan, ms);
    if (!(h >= 0 && h < 24)) range = false;
    w1 = Math.max(w1, angDiff(P.raanFromLtan(h, ms), raan));
  }
  chk('V10 RAAN -> LTAN -> RAAN closes to 1e-9 deg on 2,000 dates and LTAN is in [0,24)', w1 <= 1e-9 && range, 'worst ' + w1);
  chk('V10 meanSunRaDeg moves 0.98564736629 deg a day', Math.abs(wrap360(P.meanSunRaDeg(EP0 + 864e5) - P.meanSunRaDeg(EP0)) - 0.98564736629) < 1e-9);
  /* real orbits: the LTAN of the real element sets */
  for (const [nm, e, want] of [['LANDSAT 8', LANDSAT, 22.204], ['SENTINEL-2A', S2A, 22.505], ['TERRA SAR X', TSX, 18.031]]) {
    const p = parseTle(e);
    near('V10 real ' + nm + ' LTAN (h) from its RAAN and epoch', P.ltanFromRaan(p.raan, p.epochMs), want, 2e-3);
  }
  chk('V10 raanFromLtan accepts 0 and 24 as the same time of day', angDiff(P.raanFromLtan(0, EP0), P.raanFromLtan(24, EP0)) < 1e-9);
});

group('V13 repeat ground track: the altitude that makes Q = K/D, and SGP4 closing the track', () => {
  const solve = (k, d, e, inc) => { let a = RE + 700, i = inc; for (let it = 0; it < 40; it++) { if (inc === null) i = P.ssoInclination(a, e); const an = P.aForRevsPerDay(k / d, e, i); if (Math.abs(an - a) < 1e-10) { a = an; break; } a = an; } return { a, i }; };
  for (const [nm, k, d, e, inc, a0, i0] of [['Landsat 233/16', 233, 16, 0.0001, null, 7077.735, 98.2113], ['Sentinel-2 143/10', 143, 10, 0.0001, null, 7164.271, 98.5700], ['Sentinel-1 175/12', 175, 12, 0.0001, null, 7070.979, 98.1838],
    ['Envisat 501/35', 501, 35, 0.0012, null, 7159.494, 98.5499], ['TOPEX 127/10', 127, 10, 0.0008, 66.04, 7714.438, 66.04]]) {
    const r = solve(k, d, e, inc);
    near('V13 ' + nm + ' a (km)', r.a, a0, 0.02); near('V13 ' + nm + ' i (deg)', r.i, i0, 0.002);
  }
  near('V13 TOPEX cycle in solar days', 10 * 360 / (P.WE_DEG_DAY - P.rates(7714.438, 0.0008, 66.04).nodedot), 9.9157, 2e-4);
  for (const [nm, e, k, d] of [['LANDSAT 8', LANDSAT, 233, 16], ['SENTINEL-2A', S2A, 143, 10], ['TERRA SAR X', TSX, 167, 11]]) {
    const p = parseTle(e), a = P.brouwerFromKozai(p.n, p.ecc, p.inc);
    near('V13 real ' + nm + ': revolutions per nodal day = ' + k + '/' + d, P.revsPerNodalDay(a, p.ecc, p.inc), k / d, 1e-4);
  }
  near('V13 Q at 500 km SSO', P.revsPerNodalDay(RE + 500, 0, 97.426), 15.19957, 2e-5);
  chk('V13 aForRevsPerDay is null when Q is not bracketed', P.aForRevsPerDay(1000, 0, 51.6) === null && P.aForRevsPerDay(0.01, 0, 51.6) === null);
  /* SGP4 closes the track: after K revolutions the sub-satellite point at the start of the revolution is back where it was.
     The time comes from SGP4's own rates (satrec), so only the planner's WE_DEG_DAY and Q decide whether it closes. */
  /* circular, as the preset is: at e 1e-4 the argument of perigee has moved 56 degrees in 16 days and the
     argp-dependent short-period terms (a*e*J2 = 0.15 km) show 1.3e-3 deg that has nothing to do with the repeat */
  const r = solve(233, 16, 0, null), { s } = mkSat(elOf(r.a, 0, r.i, { raan: 100, argp: 0, M: 0 }));
  const trep = 233 * 2 * Math.PI / (s.mdot + s.argpdot);     // minutes
  const t0 = EP, t1 = EP + trep * 60000, p0 = sat.propagate(s, new Date(t0)), p1 = sat.propagate(s, new Date(t1));
  const drift = angDiff(lonDeg(p1, t1), lonDeg(p0, t0));
  chk('V13 SGP4 node longitude after 233 revolutions returns to within 2e-4 deg (WE = BODY.omega drifts 7.50e-4: measured with that mutant)', drift <= 2e-4, 'drift ' + drift.toExponential(2) + ' deg over ' + (trep / 1440).toFixed(3) + ' days');
});

group('V14 matched B*: against SGP4\'s own decay rate and the page\'s atmosphere', () => {
  const am0 = 0.0165 / 2.2;
  near('V14 B*(Cd A/m = 0.0165) at 500 km, circular i 51.6', P.bstarFromAm(am0, RE + 500, 0, 51.6), 3.710e-4, 5e-8, '(AS\'s closed form 3.7364e-4 is 0.7 % high and is not the definition)');
  near('V14 ... at 400 km', P.bstarFromAm(am0, RE + 400, 0, 51.6), 6.708e-4, 5e-8);
  for (const [h, u] of [[360, 0.0506], [420, 0.0368], [500, 0.0225], [700, 0.0055]])
    near('V14 B* per unit Cd*A/m at ' + h + ' km (the textbook constant has no height in it)', P.bstarFromAm(1 / 2.2, RE + h, 0, 51.6), u, 6e-5);
  /* the physical rate IS the page's: dragAvg for a circular orbit equals Lifetime's closed form */
  for (const h of [300, 500, 700]) {
    const ph = -P.dragAvg(RE + h, 0, 0.0165, 1).dadt_kmday, li = L.rho(h) * 1000 * 0.0165 * Math.sqrt(L.MU * (RE + h)) * 86400;
    chk('V14 dragAvg (circular, ' + h + ' km) equals the Lifetime model rate to 1e-9', Math.abs(ph / li - 1) < 1e-9, ph + ' vs ' + li);
  }
  /* SGP4's osculating da/dt over the physical rate: sampled once per nodal period (constant phase) over two days */
  const ratio = (h) => {
    const a = RE + h, bs = P.bstarFromAm(am0, a, 0, 51.6), { s } = mkSat(elOf(a, 0, 51.6, { raan: 30, bstar: bs }));
    const r = P.rates(a, 0, 51.6), Tn = 360 / (r.mdot + r.argpdot) * 86400000, ts = [], as = [];
    for (let k = 0; k * Tn <= 2 * 86400000; k++) { const pv = sat.propagate(s, new Date(EP + k * Tn)); if (!pv || !pv.position) break; ts.push(k * Tn / 86400000); as.push(osc(pv)); }
    return -slope(ts, as) / -P.dragAvg(a, 0, 0.0165, 1).dadt_kmday;
  };
  for (const [h, tol] of [[990, 0.015], [800, 0.015], [600, 0.015], [500, 0.015], [400, 0.015], [300, 0.07], [250, 0.25], [200, 0.25]]) {
    const q = ratio(h);
    chk('V14 SGP4 da/dt over the physical rate at ' + h + ' km within ' + Math.round(tol * 1000) / 10 + ' %', Math.abs(q - 1) <= tol, 'ratio ' + q.toFixed(4));
  }
  /* amFromBstar is its inverse; amMax follows from the limit */
  for (const [h, e, i, am] of [[500, 0, 51.6, 0.0043], [350, 0.01, 97, 0.05], [800, 0.1, 30, 1.3]]) {
    const a = RE + h, ee = e, rp = a * (1 - ee);
    const bs = P.bstarFromAm(am, a, ee, i);
    near('V14 amFromBstar(bstarFromAm(' + am + ')) round trip at ' + h + ' km (relative 1e-12)', P.amFromBstar(bs, a, ee, i) / am, 1, 1e-12, 'rp ' + (rp - RE).toFixed(0) + ' km');
  }
  chk('V14 amFromBstar is null above 1,000 km (B* carries no drag information) and for non-finite B*', P.amFromBstar(1e-4, RE + 1200, 0, 51.6) === null && P.amFromBstar(NaN, RE + 500, 0, 51.6) === null);
  chk('V14 amFromBstar has a floor of 0 for a negative B*', P.amFromBstar(-1e-4, RE + 500, 0, 51.6) === 0);
  chk('V14 bstarFromAm is 0 for am = 0 and for an orbit wholly above 1,000 km', P.bstarFromAm(0, RE + 500, 0, 51.6) === 0 && P.bstarFromAm(0.0043, RE + 1500, 0, 51.6) === 0);
  for (const [h, want] of [[120, 0.61], [200, 0.74], [400, 1.1], [500, 2.0], [600, 4.1], [700, 8.2]])
    near('V14 amMax at ' + h + ' km (B* limit 0.1) is ' + want + ' to the two digits the spec prints', P.amMax(RE + h, 0, 51.6), want, 0.5 * Math.pow(10, Math.floor(Math.log10(want)) - 1) + 0.002, '= ' + P.amMax(RE + h, 0, 51.6).toFixed(3));
  chk('V14 amMax is Infinity when the unit B* is 0', P.amMax(RE + 1500, 0, 51.6) === Infinity);
  /* B* is not monotone in perigee: SGP4's own parameter switches at 156 km (printed values of SPEC 3.4) */
  for (const [h, want] of [[121, 6.70e-4], [130, 4.26e-4], [150, 4.18e-4], [156, 5.47e-4], [200, 5.84e-4], [300, 5.62e-4], [400, 3.85e-4], [600, 1.04e-4], [999, 2.11e-5]])
    chk('V14 B*(am 0.0043) at ' + h + ' km = ' + want.toExponential(2) + ' within 1.5 %', Math.abs(P.bstarFromAm(0.0043, RE + h, 0, 51.6) / want - 1) <= 0.015, 'got ' + P.bstarFromAm(0.0043, RE + h, 0, 51.6).toExponential(3));
  chk('V14 B* is exactly 0 once the perigee is at or above 1,000 km (the circular a = Re + 1000 sits on the line: 0, not 2.1e-5)', P.bstarFromAm(0.0043, RE + 1000, 0, 51.6) === 0 && P.bstarFromAm(0.0043, RE + 1001, 0, 51.6) === 0 && P.bstarFromAm(0.0043, RE + 999.9, 0, 51.6) > 0);
  chk('V14 B* at 150 km is below B* at 130 km and above it at 200 km (not monotone, and not asserted to be)', P.bstarFromAm(0.0043, RE + 150, 0, 51.6) < P.bstarFromAm(0.0043, RE + 130, 0, 51.6) && P.bstarFromAm(0.0043, RE + 200, 0, 51.6) > P.bstarFromAm(0.0043, RE + 150, 0, 51.6));
  chk('V14 sgp4Cc2 positive and finite for a sound orbit', (() => { const c = P.sgp4Cc2(RE + 500, 0.01, 51.6); return c.cc2 > 0 && isFinite(c.cc2) && Math.abs(c.ao - (RE + 500) / RE72) < 1e-12; })());
});

group('V14b the 120 km clamp (D25): below it B* is the 120 km value, bit for bit, and Add is never blocked by drag', () => {
  const b120 = P.bstarFromAm(0.0043, RE + 120, 0, 51.6);
  near('V14b circular i 51.6 am 0.0043 at 120 km', b120, 7.066e-4, 2e-7);
  let bitEqual = true, finite = true;
  for (let h = 0; h <= 130; h++) {
    const b = P.bstarFromAm(0.0043, RE + h, 0, 51.6);
    if (h <= 120 && b !== b120) bitEqual = false;
    if (!(isFinite(b) && b > 0)) finite = false;
  }
  chk('V14b hp 0..120 gives B* equal to the 120 km value bit for bit (no unclamped 70.6 at 0 km, 0.23 at 50 km)', bitEqual);
  chk('V14b B* is finite and positive for every hp in 0..130', finite);
  chk('V14b the clamp holds for an eccentric orbit too: apogee kept, perigee lifted (hp 0 and hp 100 at ha 1000 km)', (() => {
    const f = (hp, ha) => { const a = (2 * RE + hp + ha) / 2, e = (ha - hp) / (2 * RE + hp + ha); return P.bstarFromAm(0.0043, a, e, 28.5); };
    return f(0, 1000) === f(100, 1000) && f(100, 1000) === f(120, 1000) && f(121, 1000) !== f(120, 1000);
  })());
  let blocked = 0, cases = 0;
  const base = { shape: 'alt', nodeMode: 'raan', raan: 10, argp: 0, ma: 0, epoch: '2026-10-01T12:00:00' };
  for (const hp of [12, 20, 50, 100, 119]) for (const inc of [0, 51.6, 98]) for (const am of [0.0043, 1, 10]) {
    const r = P.fromForm(Object.assign({}, base, { hp, ha: hp, inc, am })); cases++;
    if (!r.ok || r.errors.length) blocked++;
  }
  chk('V14b fromForm is ok with no error for hp {12,20,50,100,119} x i {0,51.6,98} x am {0.0043,1,10} (' + cases + ' forms)', blocked === 0, blocked + ' blocked');
  let wrong = 0, raised = 0, n = 0;
  for (const hp of [100, 119, 119.9, 120, 130, 150, 200, 300, 500, 700, 900]) for (const am of [0.001, 0.0043, 0.1, 0.5, 1, 2, 5, 10]) {
    const r = P.fromForm(Object.assign({}, base, { hp, ha: hp, inc: 51.6, am })), got = r.errors.some(x => x.code === 'err.bstar.range');
    const a = RE + hp, want = hp >= 120 && Math.abs(P.bstarFromAm(am, a, 0, 51.6)) > 0.1;
    n++; if (got) raised++; if (got !== want) wrong++;
  }
  chk('V14b err.bstar.range is raised exactly when hp >= 120 and |B*| > 0.1 (' + n + ' cases, ' + raised + ' raised)', wrong === 0 && raised > 5, wrong + ' wrong');
  let bad2 = 0;
  for (const hp of [120, 150, 200, 300, 400, 600]) {
    const r = P.fromForm(Object.assign({}, base, { hp, ha: hp, inc: 51.6, am: 10 })), x = r.errors.find(y => y.code === 'err.bstar.range');
    if (!x) { bad2++; continue; }
    const sig2 = Number(x.am_max.toPrecision(2));
    if (sig2 !== x.am_max || x.am_max < 0.001 || x.am_max > P.amMax(RE + hp, 0, 51.6) || x.bstar_max !== 0.1 || Math.abs(x.h_mean - hp) > 1e-6 || x.am !== 10 || x.field !== 'am') bad2++;
    else {                                              // the number the student is told to type must itself pass
      const again = P.fromForm(Object.assign({}, base, { hp, ha: hp, inc: 51.6, am: x.am_max }));
      if (!again.ok) bad2++;
    }
  }
  chk('V14b err.bstar.range params: am_max has 2 significant digits, is never below 0.001, never above the true limit, and typing it clears the error', bad2 === 0, bad2 + ' bad');
  chk('V14b the limit is not monotone but its smallest value is 0.61 m2/kg at 120 km', P.amMax(RE + 120, 0, 51.6) < 0.62 && P.amMax(RE + 120, 0, 51.6) > 0.60);
});

/* a local, independent integrator: the orbit-averaged decay of an (a, e) orbit, RK2 on the averaged rates */
function lifeEccRef(aKm, e, B, mult, floorKm, maxDays) {
  let a = aKm, ee = e, t = 0, n = 0;
  const pg = () => a * (1 - ee) - RE;
  while (pg() > floorKm && t < maxDays) {
    const r1 = P.dragAvg(a, ee, B, mult);
    const rate = Math.max(Math.abs(r1.dadt_kmday) * (1 - ee) + a * Math.abs(r1.dedt_day), 1e-12);
    let dt = Math.min(0.5 / rate, 5, (pg() - floorKm) / rate + 1e-6);
    if (!(dt > 1e-7)) dt = 1e-7;
    const r2 = P.dragAvg(a + r1.dadt_kmday * dt / 2, Math.max(0, ee + r1.dedt_day * dt / 2), B, mult);
    a += r2.dadt_kmday * dt; ee = Math.max(0, ee + r2.dedt_day * dt); t += dt;
    if (++n > 4e6) return null;
  }
  return t >= maxDays ? null : t;
}
/* whole-orbit midpoint rule, any number of nodes: the reference the half-orbit rule is held against */
function refDrag(aKm, e, B, N) {
  const aM = aKm * 1000; let da = 0;
  for (let k = 0; k < N; k++) {
    const E = 2 * Math.PI * (k + 0.5) / N, cE = Math.cos(E), r = aM * (1 - e * cE), h = r / 1000 - RE;
    const rho = h > 1000 ? 0 : L.rho(Math.max(h, 0)), v2 = MU_SI * (2 / r - 1 / aM), v = Math.sqrt(v2);
    da += -2 * aM * aM * v * (0.5 * rho * B * v2) / MU_SI * (1 - e * cE) / N;
  }
  return da / 1000 * 86400;
}

group('V15 the atmosphere the planner and the Decay section share', () => {
  for (const [h, B, d] of [[500, 0.0165, 1129.73], [400, 0.0165, 187.55], [300, 0.0165, 23.49], [600, 0.005, 19014.04]])
    near('V15 Lifetime.integrate(Re+' + h + ', 1000*' + B + ', 120) days', L.integrate(RE + h, 1000 * B, 120).days, d, 0.02);
  chk('V15 without the factor 1000 integrate gives null (beyond 40,000 d)', L.integrate(RE + 500, 0.0165, 120).days === null);
  const t1 = L.integrate(RE + 500, 1000 * 0.0165, 120).days, t3 = L.integrate(RE + 500, 3000 * 0.0165, 120).days;
  near('V15 T(3B) = T(B)/3 (relative 1e-6)', t3 * 3 / t1, 1, 1e-6);
  for (const [h, am] of [[500, 0.0165 / 2.2], [200, 0.05]]) {
    const B = 2.2 * am, ec = lifeEccRef(RE + h, 1e-9, B, 1, 120, 40000), ci = L.integrate(RE + h, 1000 * B, 120).days;
    near('V15 lifeEcc(e = 1e-9) == integrate at ' + h + ' km, am ' + am.toFixed(4) + ' (relative 2e-4)', ec / ci, 1, 2e-4, '(' + ec.toFixed(2) + ' vs ' + ci.toFixed(2) + ' d)');
  }
  /* dragAvg against a 32,768-node whole-orbit reference */
  let w500 = 0, w950 = 0, wApog = 0, cases = 0;
  for (const hp of [120, 200, 300, 500, 800, 950]) for (const ha of [hp + 1, hp + 50, 1000, 2000, 5000, 20000, 35786, 100000, 400000]) {
    if (ha <= hp) continue;
    const a = (2 * RE + hp + ha) / 2, e = (ha - hp) / (2 * RE + hp + ha), ref = refDrag(a, e, 0.0095, 32768);
    if (Math.abs(ref) < 1e-30) continue;
    const err = Math.abs(P.dragAvg(a, e, 0.0095, 1).dadt_kmday / ref - 1); cases++;
    if (hp <= 500) w500 = Math.max(w500, err); else if (hp <= 950 && ha <= 400000) { if (hp === 950) w950 = Math.max(w950, err); else wApog = Math.max(wApog, err); }
  }
  chk('V15 dragAvg vs a 32,768-node reference, hp 120-500 km, ha to 400,000 km (' + cases + ' cases total): <= 5e-4', w500 <= 5e-4, 'worst ' + w500.toExponential(2));
  chk('V15 ... at hp 950 km: <= 2e-3', w950 <= 2e-3, 'worst ' + w950.toExponential(2));
  chk('V15 ... at hp 800 km: <= 2e-3', wApog <= 2e-3, 'worst ' + wApog.toExponential(2));
  let md = 0;
  for (const [hp, ha] of [[300, 400], [500, 900], [120, 1000], [400, 400], [800, 1000]]) {
    const a = (2 * RE + hp + ha) / 2, e = (ha - hp) / (2 * RE + hp + ha), old = refDrag(a, e, 0.0095, 96);
    md = Math.max(md, Math.abs(P.dragAvg(a, e, 0.0095, 1).dadt_kmday / old - 1));
  }
  chk('V15 with the apogee at or below 1,000 km the 48 half-orbit nodes equal the old 96-node whole-orbit rule to 1e-12', md <= 1e-12, 'worst ' + md.toExponential(2));
  chk('V15 dragAvg: a perigee at or above 1,000 km gives exactly zero; mult scales linearly', (() => {
    const z = P.dragAvg(RE + 1100, 0.01, 0.01, 1), r1 = P.dragAvg(7000, 0.01, 0.01, 1), r3 = P.dragAvg(7000, 0.01, 0.01, 3);
    return z.dadt_kmday === 0 && z.dedt_day === 0 && Math.abs(r3.dadt_kmday / r1.dadt_kmday - 3) < 1e-12 && r1.dadt_kmday < 0;
  })());
  chk('V15 dragAvg: e = 0 gives no de/dt (the cosine integrates to zero), and a drag-free orbit stays put', Math.abs(P.dragAvg(7000, 0, 0.01, 1).dedt_day) < 1e-15 * Math.abs(P.dragAvg(7000, 0, 0.01, 1).dadt_kmday) + 1e-30 && P.dragAvg(7000, 0.01, 0, 1).dadt_kmday === 0);
  chk('V15 the four drag functions throw the stated Error when Lifetime is absent, and only then', (() => {
    const keep = globalThis.Lifetime; let ok = true;
    try {
      delete globalThis.Lifetime;
      for (const f of [() => P.dragAvg(7000, 0, 0.01, 1), () => P.bstarFromAm(0.0043, 7000, 0, 51.6), () => P.amFromBstar(1e-4, 7000, 0, 51.6), () => P.amMax(7000, 0, 51.6)]) {
        try { f(); ok = false; } catch (e) { if (!(e instanceof Error) || e.message !== 'Planner: atmosphere (Lifetime.rho) not loaded') ok = false; }
      }
      ok = ok && P.toTLE(elOf(7000, 0, 51.6), '99901').l1.length === 69 && P.ssoInclination(RE + 500, 0) > 97 && P.parseNumber('1').ok;   // nothing else needs it
    } finally { globalThis.Lifetime = keep; }
    return ok;
  })());
});

/* SGP4 forward on a synthesised TLE: the first day on which the lowest height of a revolution is under 120 km */
function sgp4Day(el, cap, stepDays) {
  const { s } = mkSat(el), per = P.periodMin(el.a) * 60000, n = el.e > 0.01 ? 48 : 24;
  const lowest = ms => { let m = 1e9; for (let k = 0; k < n; k++) { const pv = sat.propagate(s, new Date(ms + k / n * per)); if (!pv || !pv.position) return -1; m = Math.min(m, Math.hypot(pv.position.x, pv.position.y, pv.position.z) - RE); } return m; };
  for (let d = stepDays; d <= cap; d += stepDays) if (lowest(el.epoch + d * 864e5) < 120) return d;
  return Infinity;
}
const meanR = (s, ms, per) => { let t = 0; for (let k = 0; k < 48; k++) { const pv = sat.propagate(s, new Date(ms + k / 48 * per)); t += Math.hypot(pv.position.x, pv.position.y, pv.position.z); } return t / 48; };

group('V-life the Professor against the globe: SGP4 forward on the synthesised TLE, matched B* and the textbook B*', () => {
  const am = 0.010, B = 1000 * 2.2 * am;
  const T = (h, k) => { const r = L.integrate(RE + h, B * k, 120, false); return r.days === null ? Infinity : r.days; };
  for (const h of [300, 400, 500, 600, 650, 700]) {
    const a = RE + h, lo = T(h, 3), hi = T(h, 1 / 3), mid = T(h, 1);
    const el = elOf(a, 0, 51.6, { am, bstar: P.bstarFromAm(am, a, 0, 51.6) });
    const day = sgp4Day(el, 40000, 1);
    const inside = day >= lo && (hi === Infinity ? true : day <= hi);
    chk('V-life ' + h + ' km am 0.010: the globe\'s SGP4 reaches 120 km on day ' + (day === Infinity ? '>40,000' : day) + ', inside [' + lo.toFixed(0) + ', ' + (hi === Infinity ? 'open' : hi.toFixed(0)) + '] (mid ' + (mid === Infinity ? 'open' : mid.toFixed(0)) + ')', inside);
    if (h === 650 || h === 700) {                       // the textbook B* must be caught: this is the check's teeth
      const tb = 0.5 * 2.2 * am * 0.15696615, dayT = sgp4Day(elOf(a, 0, 51.6, { am, bstar: tb }), 40000, 1);
      chk('V-life ' + h + ' km with the textbook B* = 0.5*Cd*am*0.15696615 the globe falls on day ' + dayT + ', OUTSIDE the range (low bound ' + lo.toFixed(0) + ')', dayT < lo);
    }
  }
  /* the first 30 days: height lost agrees with the physical march at 400/500 km, under a kilometre at 600/700 */
  for (const h of [400, 500, 600, 700]) {
    const a = RE + h, { s } = mkSat(elOf(a, 0, 51.6, { am, bstar: P.bstarFromAm(am, a, 0, 51.6) })), per = P.periodMin(a) * 60000;
    const lostSgp4 = meanR(s, EP, per) - meanR(s, EP + 30 * 864e5, per);
    const lostPhys = a - L.marchT(a, B, 0, 120, 30, false).a;
    if (h <= 500) chk('V-life ' + h + ' km: height lost in 30 days, SGP4 ' + lostSgp4.toFixed(3) + ' km vs physical ' + lostPhys.toFixed(3) + ' km, within 25 %', Math.abs(lostSgp4 / lostPhys - 1) <= 0.25);
    else chk('V-life ' + h + ' km: height lost in 30 days under 1 km, SGP4 ' + lostSgp4.toFixed(3) + ' physical ' + lostPhys.toFixed(3), Math.abs(lostSgp4) < 1 && lostPhys < 1);
  }
  /* eccentric orbits: SGP4's day over the orbit-averaged model's mid-case must lie in [0.25, 3] (am 0.02, i 51.6, argp 0) */
  const rows = [[300, 450, 1.53], [400, 800, 1.26], [400, 1400, 0.75], [500, 1500, 0.91], [300, 2800, 0.38], [300, 5000, 0.28]];
  const table = [];
  for (const [hp, ha, meas] of rows) {
    const a = (2 * RE + hp + ha) / 2, e = (ha - hp) / (2 * RE + hp + ha), amE = 0.02;
    const mid = lifeEccRef(a, e, 2.2 * amE, 1, 120, 40000);
    const el = elOf(a, e, 51.6, { argp: 0, am: amE, bstar: P.bstarFromAm(amE, a, e, 51.6) });
    const day = sgp4Day(el, 40000, 1), q = day / mid;
    table.push(hp + ' x ' + ha + ' km: SGP4 day ' + day + ' over mid ' + mid.toFixed(0) + ' = ' + q.toFixed(2) + ' (spec ' + meas + ')');
    chk('V-life eccentric ' + hp + ' x ' + ha + ' km: SGP4 day / mid-case = ' + q.toFixed(2) + ' in [0.25, 3]', q >= 0.25 && q <= 3);
    chk('V-life eccentric ' + hp + ' x ' + ha + ' km: ratio within 15 % of the measured ' + meas, Math.abs(q / meas - 1) <= 0.15, '(the README table)');
  }
  console.log('        ' + table.join('\n        '));
});

group('parse: numbers, local times, epochs (never throws, never the browser zone)', () => {
  const pn = (t, ok, v, code) => {
    const r = P.parseNumber(t);
    chk('parseNumber(' + JSON.stringify(t) + ') -> ' + (ok ? v : code), ok ? (r.ok && Math.abs(r.value - v) < 1e-12) : (!r.ok && r.code === code), JSON.stringify(r));
  };
  pn('97,4', true, 97.4); pn('97.', true, 97); pn('.5', true, 0.5); pn('1e3', true, 1000); pn(' 12 ', true, 12); pn('-3.5e-2', true, -0.035); pn('+7', true, 7);
  pn('abc', false, 0, 'err.notnum'); pn('', false, 0, 'err.missing'); pn('   ', false, 0, 'err.missing'); pn('0x10', false, 0, 'err.notnum'); pn('Infinity', false, 0, 'err.notnum');
  pn('1,234.5', false, 0, 'err.notnum'); pn('35,786', false, 0, 'err.notnum'); pn('6,878', false, 0, 'err.notnum'); pn('-6,878', false, 0, 'err.notnum'); pn('97,400', false, 0, 'err.notnum');
  pn('0,125', true, 0.125); pn('97,40', true, 97.4); pn('1234,567', true, 1234.567); pn('1,5', true, 1.5);
  pn('1,2,3', false, 0, 'err.notnum'); pn('1e999', false, 0, 'err.notnum'); pn('--1', false, 0, 'err.notnum'); pn('1 2', false, 0, 'err.notnum'); pn('.', false, 0, 'err.notnum');
  pn(42, true, 42); pn(NaN, false, 0, 'err.notnum'); pn(Infinity, false, 0, 'err.notnum'); pn(null, false, 0, 'err.missing'); pn(undefined, false, 0, 'err.missing'); pn({}, false, 0, 'err.notnum');
  chk('parseNumber: a 70,000-digit string is refused at once, not backtracked', (() => { const t0 = Date.now(); const r = P.parseNumber('9'.repeat(70000) + 'x'); return !r.ok && Date.now() - t0 < 200; })());
  chk('parseNumber never throws (null prototype, throwing toString, symbol, array)', (() => {
    const evil = { toString() { throw new Error('boom'); } };
    try { return !P.parseNumber(Object.create(null)).ok && !P.parseNumber(evil).ok && !P.parseNumber(Symbol('s')).ok && !P.parseNumber([1, 2]).ok; } catch (e) { return false; }
  })());
  const lt = (t, v, code) => { const r = P.parseLtan(t); chk('parseLtan(' + JSON.stringify(t) + ') -> ' + (code || v), code ? (!r.ok && r.code === code) : (r.ok && Math.abs(r.value - v) < 1e-12), JSON.stringify(r)); };
  lt('10:30', 10.5); lt('10.5', 10.5); lt('10,5', 10.5); lt('24:00', 0); lt('0:00', 0); lt('6', 6); lt('24', 0); lt(10.5, 10.5); lt('9:05', 9 + 5 / 60);
  lt('25', 0, 'err.ltan.range'); lt('-1', 0, 'err.ltan.range'); lt('24:01', 0, 'err.ltan.range'); lt('10:60', 0, 'err.ltan.range'); lt('abc', 0, 'err.ltan.range'); lt('25:00', 0, 'err.ltan.range'); lt('', 0, 'err.missing'); lt(30, 0, 'err.ltan.range');
  chk('parseLtan: "10:30" == "10.5" == "10,5"', P.parseLtan('10:30').value === P.parseLtan('10.5').value && P.parseLtan('10.5').value === P.parseLtan('10,5').value);
  const pe = (t, v, code) => { const r = P.parseEpoch(t); chk('parseEpoch(' + JSON.stringify(t) + ') -> ' + (code || new Date(v).toISOString()), code ? (!r.ok && r.code === code) : (r.ok && r.value === v), JSON.stringify(r)); };
  pe('2026-10-01T12:00:00', Date.UTC(2026, 9, 1, 12)); pe('2026-10-01T12:00', Date.UTC(2026, 9, 1, 12)); pe('2024-02-29T12:00', Date.UTC(2024, 1, 29, 12));
  pe('2000-01-01T00:00:00', Date.UTC(2000, 0, 1)); pe('2056-12-31T23:59:59', Date.UTC(2056, 11, 31, 23, 59, 59));
  for (const t of ['2026-02-30T12:00:00', '2026-04-31T00:00', '2026-10-01T24:00', '2026-10-01T12:00:60', '2025-02-29T12:00', '2026-13-45T25:61:61', '2057-01-01T00:00:00', '1999-12-31T23:59:59', '2026-1-01T12:00', 'tomorrow', '2026-10-01 12:00', '0099-01-01T00:00'])
    pe(t, 0, 'err.epoch.range');
  pe('', 0, 'err.missing'); pe(Date.UTC(2026, 9, 1, 12), Date.UTC(2026, 9, 1, 12)); pe(Date.UTC(2057, 0, 1), 0, 'err.epoch.range');
  chk('formatEpoch is toISOString().slice(0,19), and parseEpoch inverts it', P.formatEpoch(EP) === '2026-10-01T12:00:00' && P.parseEpoch(P.formatEpoch(EP)).value === EP && P.formatEpoch(NaN) === '');
  /* the zone: a child process with TZ set, which also proves the zone really was applied */
  const code = 'require(process.env.LIFETIME_JS);require(process.env.PLANNER_JS);const P=globalThis.Planner;process.stdout.write(JSON.stringify({off:new Date(Date.UTC(2026,9,1,12)).getTimezoneOffset(),ms:P.parseEpoch("2026-10-01T12:00:00").value,txt:P.formatEpoch(Date.UTC(2026,9,1,12)),w:P.fromForm({shape:"alt",nodeMode:"ltan",hp:700,ha:700,inc:98.2,ltan:"10:30",argp:0,ma:0,epoch:"2026-10-01T12:00:00",am:0.0043}).el.raan}));';
  const inZone = tz => JSON.parse(cp.execFileSync(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ: tz, PLANNER_JS, LIFETIME_JS: path.join(__dirname, '..', 'earth', 'lifetime.js') }), encoding: 'utf8' }));
  const ny = inZone('America/New_York'), bk = inZone('Asia/Bangkok');
  chk('parseEpoch under TZ=America/New_York and Asia/Bangkok: the zones really differ (' + ny.off + ' vs ' + bk.off + ' min) and the epoch is the same instant, as is the node derived from it',
    ny.off !== bk.off && ny.ms === EP && bk.ms === EP && ny.txt === '2026-10-01T12:00:00' && bk.txt === ny.txt && ny.w === bk.w, JSON.stringify([ny, bk]));
  chk('parseLtan, parseEpoch, parseNumber never throw on hostile input', (() => {
    const bad = [undefined, null, NaN, {}, [], [[]], Symbol('x'), () => 1, '\u0000', 'x'.repeat(70000), '9'.repeat(70000), Object.create(null), { toString() { throw 1; } }, 1e308, -1e308];
    try { for (const b of bad) { P.parseNumber(b); P.parseLtan(b); P.parseEpoch(b); P.formatEpoch(b); } return true; } catch (e) { return false; }
  })());
});

/* ---- forms and validation ---- */
const BASE = { shape: 'alt', nodeMode: 'raan', name: 'x', hp: 700, ha: 700, inc: 98.2, raan: 10, argp: 0, ma: 0, epoch: '2026-10-01T12:00:00', am: 0.0043 };
const fm = patch => Object.assign({}, BASE, patch);
const keys = r => r.errors.map(x => x.field + ':' + x.code);

group('form: lenses, patchForm, derived read-outs', () => {
  let w = 0;
  const lensOk = (hp, ha, name) => {
    const el0 = P.fromForm(fm({ hp, ha })).el;
    for (const shape of ['alt', 'ae', 'per']) {
      const f = P.toForm(el0, { shape }), r = P.fromForm(f);
      if (!r.ok) { chk('form ' + name + ' lens ' + shape + ' is ok', false, JSON.stringify(r.errors)); continue; }
      w = Math.max(w, Math.abs(r.el.a - el0.a), Math.abs(r.derived.hp - hp), Math.abs(r.derived.ha - ha));
      chk('form ' + name + ' in the ' + shape + ' lens comes back: a within 1e-6 km, e within 1e-12', Math.abs(r.el.a - el0.a) <= 1e-6 && Math.abs(r.el.e - el0.e) <= 1e-12 && Math.abs(r.derived.hp - hp) <= 1e-6 && Math.abs(r.derived.ha - ha) <= 1e-6, 'a ' + r.el.a);
    }
  };
  lensOk(700, 700, 'Altitudes 700/700'); lensOk(300, 1500, 'eccentric 300 x 1,500');
  const c = P.fromForm(fm({ hp: 700, ha: 700 }));
  near('form Altitudes 700/700 -> a 7078.137', c.el.a, 7078.137, 1e-9); near('form ... e 0', c.el.e, 0, 0); near('form ... period 98.77 min', c.derived.periodMin, 98.77, 0.005);
  near('form derived revs per day', c.derived.revsPerDay, 1440 / c.derived.periodMin, 1e-12);
  near('form derived circular speed km/s (sqrt(mu72/a))', c.derived.vCircKms, Math.sqrt(MU72 / 7078.137), 1e-12);
  near('form derived Kozai n equals kozaiFromBrouwer on the rounded e, i', c.derived.kozaiN, P.kozaiFromBrouwer(7078.137, 0, 98.2).nRevDay, 1e-9);
  near('form derived node rate (deg/day) is SGP4\'s', c.derived.nodeRate, P.rates(7078.137, 0, 98.2).nodedot, 1e-12);
  chk('form derived has a B* (matched), u = argp + M, raan, ltan', c.derived.bstar > 0 && c.derived.bstar === c.el.bstar && c.derived.u === 0 && c.derived.raan === 10 && Math.abs(c.derived.ltan - P.ltanFromRaan(10, EP)) < 1e-12);
  chk('form fromForm returns a NEW el of exactly the nine keys, with bstar derived from am', JSON.stringify(Object.keys(c.el).sort()) === JSON.stringify(['M', 'a', 'am', 'argp', 'bstar', 'e', 'epoch', 'i', 'raan']) && c.el.am === 0.0043 && c.el.bstar === P.bstarFromAm(0.0043, c.el.a, c.el.e, 98.2));
  chk('form an "ae" form and a "per" form give the same orbit (Kepler period of the Brouwer a, mu 398600.8)', (() => {
    const x = P.fromForm(fm({ shape: 'ae', a: 7078.137, e: 0 })), y = P.fromForm(fm({ shape: 'per', period: P.periodMin(7078.137), e: 0 }));
    return x.ok && y.ok && Math.abs(x.el.a - y.el.a) < 1e-9;
  })());
  /* patchForm: every fix payload key of the catalogue, in every shape and node lens; the result's fromForm equals an independently built el */
  const base = P.fromForm(fm({ inc: 97.4, hp: 500, ha: 800, argp: 30, ma: 40, raan: 120 })).el;
  const ep2 = Date.UTC(2027, 2, 15, 6, 30, 0);
  const cases = [
    ['{hp:450, ha:450}', { hp: 450, ha: 450 }, el => { const a = RE + 450; return { a, e: 0 }; }],
    ['{hp:430}', { hp: 430 }, () => { const rp = RE + 430, ra = RE + 800; return { a: (rp + ra) / 2, e: (ra - rp) / (ra + rp) }; }],
    ['{hp:900} (apogee follows)', { hp: 900 }, () => { const a = RE + 900; return { a, e: 0 }; }],
    ['{ha:400} (perigee follows)', { ha: 400 }, () => { const a = RE + 400; return { a, e: 0 }; }],
    ['{period:1436.0682}', { period: 1436.0682 }, () => ({ a: P.aFromPeriodMin(1436.0682), e: (800 - 500) / (2 * RE + 1300) })],
    ['{a:7000}', { a: 7000 }, () => ({ a: 7000, e: (800 - 500) / (2 * RE + 1300) })],
    ['{e:0.01}', { e: 0.01 }, () => ({ a: (2 * RE + 1300) / 2, e: 0.01 })],
    ['{inc:97.5}', { inc: 97.5 }, () => ({ i: 97.5 })], ['{argp:0, ma:45}', { argp: 0, ma: 45 }, () => ({ argp: 0, M: 45 })], ['{ma:123.4}', { ma: 123.4 }, () => ({ M: 123.4 })],
    ['{am:0.0012}', { am: 0.0012 }, () => ({ am: 0.0012 })]
  ];
  for (const shape of ['alt', 'ae', 'per']) for (const nodeMode of ['raan', 'ltan']) {
    const f0 = P.toForm(base, { shape, nodeMode }); Object.freeze(f0);
    let bad = [];
    for (const [label, patch, expect] of cases) {
      const before = JSON.stringify(f0), out = P.patchForm(f0, patch), r = P.fromForm(out), want = expect();
      if (JSON.stringify(f0) !== before || out === f0) bad.push(label + ': input mutated or returned');
      if (!r.ok) { bad.push(label + ': fromForm ' + JSON.stringify(keys(r))); continue; }
      const exp = Object.assign({ a: base.a, e: base.e, i: base.i, argp: base.argp, M: base.M, am: base.am }, want);
      for (const k of ['a', 'i', 'argp', 'M', 'am']) if (Math.abs(r.el[k] - exp[k]) > 1e-6) bad.push(label + ': ' + k + ' ' + r.el[k] + ' vs ' + exp[k]);
      if (Math.abs(r.el.e - exp.e) > 1e-9) bad.push(label + ': e ' + r.el.e + ' vs ' + exp.e);
      if (angDiff(r.el.raan, base.raan) > 1e-9) bad.push(label + ': raan moved');
    }
    chk('form patchForm (' + shape + ' / ' + nodeMode + '): ' + cases.length + ' fix payloads; fromForm equals the independently built el; the input is untouched', bad.length === 0, bad.join('; '));
  }
  /* node payloads and the epoch */
  for (const shape of ['alt', 'ae', 'per']) for (const nodeMode of ['raan', 'ltan']) {
    const f0 = P.toForm(base, { shape, nodeMode });
    const rl = P.fromForm(P.patchForm(f0, { ltan: 10.5 })), rr = P.fromForm(P.patchForm(f0, { raan: 33.3 }));
    chk('form patchForm ltan 10.5 in ' + shape + '/' + nodeMode + ': node is LTAN 10:30 at the epoch', rl.ok && Math.abs(rl.derived.ltan - 10.5) < 1e-9 && angDiff(rl.el.raan, P.raanFromLtan(10.5, base.epoch)) < 1e-9);
    chk('form patchForm raan 33.3 in ' + shape + '/' + nodeMode + ': node is RAAN 33.3', rr.ok && angDiff(rr.el.raan, 33.3) < 1e-9);
    const pe = P.patchForm(f0, { epoch: ep2 }), re = P.fromForm(pe);
    const keptLtan = nodeMode === 'ltan' ? Math.abs(re.derived.ltan - P.ltanFromRaan(base.raan, base.epoch)) < 1e-9 : angDiff(re.el.raan, base.raan) < 1e-9;
    chk('form patchForm epoch (ms) in ' + shape + '/' + nodeMode + ': epoch written as text and the authoritative node (' + (nodeMode === 'ltan' ? 'LTAN' : 'RAAN') + ') is kept against the new epoch',
      re.ok && re.el.epoch === ep2 && pe.epoch === '2027-03-15T06:30:00' && keptLtan, JSON.stringify(re.errors));
    const both = P.fromForm(P.patchForm(f0, { epoch: ep2, ltan: 6 }));
    chk('form patchForm {epoch, ltan} in ' + shape + '/' + nodeMode + ': the node is LTAN 06:00 at the NEW epoch', both.ok && angDiff(both.el.raan, P.raanFromLtan(6, ep2)) < 1e-9);
  }
  chk('form patchForm: the Swap fix {hp:ha, ha:hp} un-inverts an orbit typed upside down (hp 800, ha 500 -> 500, 800) in every lens', ['alt', 'ae', 'per'].every(shape => {
    const inv = fm({ hp: 800, ha: 500 }), fixed = P.patchForm(inv, { hp: 500, ha: 800 }), r = P.fromForm(shape === 'alt' ? fixed : P.toForm(P.fromForm(fixed).el, { shape }));
    return !P.fromForm(inv).ok && r.ok && Math.abs(r.derived.hp - 500) < 1e-6 && Math.abs(r.derived.ha - 800) < 1e-6;
  }));
  chk('form patchForm name writes through; unknown keys and __proto__ do nothing', (() => {
    const hostile = JSON.parse('{"__proto__":{"hp":5},"name":"y","zz":1}'), out = P.patchForm(P.toForm(base), hostile);
    return out.name === 'y' && out.zz === undefined && ({}).hp === undefined && Object.getPrototypeOf(out) === Object.prototype;
  })());
  chk('form patchForm on an empty or broken form starts from the 700 km default and does not throw', (() => {
    const a = P.patchForm({}, { inc: 98 }), b = P.patchForm(null, { hp: 300 }), c2 = P.patchForm({ hp: 'abc', ha: '' }, { hp: 200 });
    return a.inc === 98 && b.hp === 300 && b.ha === 700 && c2.hp === 200 && c2.ha === 700;
  })());
  chk('form patchForm: {hp:200} on a circular orbit below the ground gives hp = ha = 200', (() => { const o = P.patchForm(fm({ hp: -50, ha: -50 }), { hp: 200 }); return o.hp === 200 && o.ha === 200; })());
  chk('form patchForm leaves untouched fields as typed (a text value survives a patch to another field)', P.patchForm(fm({ inc: '97,4' }), { ma: 5 }).inc === '97,4');
  chk('form toForm: LTAN for a sun-synchronous orbit, RAAN otherwise; shape alt; numbers throughout', (() => {
    const s = P.fromForm(P.presets(null, EP)[1].form).el, i = P.fromForm(P.presets(null, EP)[0].form).el, fs = P.toForm(s), fi = P.toForm(i, { name: 'Z' });
    return fs.nodeMode === 'ltan' && fi.nodeMode === 'raan' && fs.shape === 'alt' && fi.name === 'Z' && ['hp', 'ha', 'a', 'e', 'period', 'inc', 'raan', 'ltan', 'argp', 'ma', 'am'].every(k => typeof fs[k] === 'number') && typeof fs.epoch === 'string';
  })());
  chk('form toForm: a retrograde orbit that is not sun-synchronous (i 120, 7000 km) and a prograde one with the Sun\'s node rate keep the RAAN lens', P.toForm(elOf(7000, 0, 120, { am: 0.0043 })).nodeMode === 'raan' && P.toForm(elOf(7000, 0, 51.6, { am: 0.0043 })).nodeMode === 'raan');
  chk('form toForm of an el with no am (explicit B*) works: am worked back from B* or the typical craft', (() => {
    const f = P.toForm(elOf(RE + 500, 0, 51.6, { bstar: 3.7e-4 })), g = P.toForm(elOf(RE + 1500, 0, 51.6, { bstar: 3.7e-4 }));
    return f.am > 0.003 && f.am < 0.01 && g.am === 0.0043;
  })());
  chk('form craftForAm: a craft\'s am within 1e-6 selects it, anything else is custom', P.craftForAm(0.0043) === 'typical' && P.craftForAm(0.0043 + 5e-7) === 'typical' && P.craftForAm(0.0044) === 'custom' && P.craftForAm(0.0012) === 'large');
  chk('form kindWord: SSO, GEO, HEO, none', (() => {
    const pr = P.presets(null, EP), el = k => P.fromForm(pr.find(p => p.key === k).form).el;
    return P.kindWord(el('sso')) === 'SSO' && P.kindWord(el('landsat')) === 'SSO' && P.kindWord(el('geo')) === 'GEO' && P.kindWord(el('molniya')) === 'HEO' && P.kindWord(el('tundra')) === 'HEO' && P.kindWord(el('iss')) === '' && P.kindWord(el('gps')) === '' && P.kindWord(null) === '';
  })());
  chk('form kindWord GEO needs a tilt under 1 degree and an eccentricity under 0.01: i 5 at the geosynchronous a is not GEO, i 0.9 and i 179.5 are', (() => { const g = i => P.kindWord(elOf(P.GEO_A_KM, 0, i)); return g(5) === '' && g(0.9) === 'GEO' && g(179.5) === 'GEO' && P.kindWord(elOf(P.GEO_A_KM, 0.02, 0)) === '' && P.kindWord(elOf(P.GEO_A_KM * 1.01, 0, 0)) === ''; })());
  chk('form CRAFTS: six, typical is first with am 0.0043, custom has no am; FIELD_LABEL has the thirteen labels', P.CRAFTS.length === 6 && P.CRAFTS[0].key === 'typical' && P.CRAFTS[0].am === 0.0043 && P.CRAFTS[5].key === 'custom' && P.CRAFTS[5].am === null && Object.keys(P.FIELD_LABEL).length === 13 && P.FIELD_LABEL.hp === 'Mean perigee altitude');
  /* the figures the 'typical' sentence quotes are MEASURED here, from the catalogue and the planner's own
     elementsFromTLE (am worked back from B*), so the sentence cannot drift: an earlier one claimed "1,311
     satellites, median 0.0095, flat with height" and was none of the three (the median over every low-orbit cut
     is 0.0091, and it rises with the perigee) */
  (() => {
    const rows = [];
    for (const x of CAT) { let q; try { q = P.elementsFromTLE(x.l1, x.l2, sat); } catch (err) { continue; } if (q && q.a > 0 && q.am > 0) rows.push({ hp: q.a * (1 - q.e) - 6378.137, e: q.e, c: 2.2 * q.am }); }
    const med = a => { const t = a.slice().sort((p, q) => p - q); return t[Math.floor(t.length / 2)]; };
    const band = (lo, hi) => med(rows.filter(r => r.e < 0.02 && r.hp >= lo && r.hp < hi).map(r => r.c));
    const m3 = band(300, 500), m5 = band(500, 700), m7 = band(700, 1000), all = med(rows.filter(r => r.hp >= 120 && r.hp <= 1000 && r.e < 0.02).map(r => r.c));
    const why = P.CRAFTS[0].why, round = (x, d) => +x.toFixed(d);
    chk('form CRAFTS typical: the sentence quotes the measured medians (0.0078 / 0.0095 / 0.015 by perigee band), the default is the 500-700 km one, and it does not say flat or 1,311',
      round(m3, 4) === 0.0078 && round(m5, 4) === 0.0095 && round(m7, 3) === 0.015 && round(P.CRAFTS[0].am * 2.2, 4) === round(m5, 4) &&
      why.indexOf('0.0095') >= 0 && why.indexOf('0.0078') >= 0 && why.indexOf('0.015') >= 0 && /500 to 700 km/.test(why) && !/flat|1,311/.test(why),
      'medians Cd*A/m ' + m3.toFixed(4) + ' / ' + m5.toFixed(4) + ' / ' + m7.toFixed(4) + '; every low-orbit cut ' + all.toFixed(4) + '; default 2.2 * ' + P.CRAFTS[0].am + ' = ' + (2.2 * P.CRAFTS[0].am).toFixed(4));
  })();
});

group('form: each code of the validation table is raised by exactly its condition and no other', () => {
  const T = [
    ['base form is clean', {}, []],
    ['e = -0.1 (ae)', { shape: 'ae', a: 7000, e: -0.1 }, ['e:err.ecc.neg']],
    ['e = 1 (ae)', { shape: 'ae', a: 7000, e: 1 }, ['e:err.ecc.parabola']],
    ['e = 1.5 (ae)', { shape: 'ae', a: 7000, e: 1.5 }, ['e:err.ecc.hyper']],
    ['e = 0.5 with a 20000 is fine', { shape: 'ae', a: 20000, e: 0.5 }, []],
    ['inc = 181', { inc: 181 }, ['inc:err.inc.range']],
    ['inc = -0.5', { inc: -0.5 }, ['inc:err.inc.range']],
    ['inc = 180, e 0', { inc: 180 }, []],
    ['apogee below perigee (alt)', { hp: 800, ha: 700 }, ['ha:err.apo.lt.peri']],
    ['perigee below the ground (alt)', { hp: -1, ha: 100 }, ['hp:err.perigee.surface']],
    ['both below the ground (alt)', { hp: -10, ha: -10 }, ['hp:err.perigee.surface']],
    ['a(1-e) under Re (ae)', { shape: 'ae', a: 6000, e: 0 }, ['a:err.perigee.surface']],
    ['period 0 (per)', { shape: 'per', period: 0, e: 0 }, ['period:err.perigee.surface']],
    ['period -5 (per)', { shape: 'per', period: -5, e: 0 }, ['period:err.perigee.surface']],
    ['period -100 is not read as 100 (per)', { shape: 'per', period: -100, e: 0 }, ['period:err.perigee.surface']],
    ['a past the Moon (ae)', { shape: 'ae', a: 400001, e: 0 }, ['a:err.a.range']],
    ['a past the Moon (alt)', { hp: 1e6, ha: 1e6 }, ['ha:err.a.range']],
    ['a past the Moon (per)', { shape: 'per', period: 1e9, e: 0 }, ['period:err.a.range']],
    ['a at the Moon limit is fine', { shape: 'ae', a: 400000, e: 0 }, []],
    ['epoch 2056-12-31T23:59:59 is fine', { epoch: '2056-12-31T23:59:59' }, []],
    ['epoch 2057', { epoch: '2057-01-01T00:00:00' }, ['epoch:err.epoch.range']],
    ['epoch 1999', { epoch: '1999-12-31T23:59:59' }, ['epoch:err.epoch.range']],
    ['epoch Feb 30', { epoch: '2026-02-30T12:00:00' }, ['epoch:err.epoch.range']],
    ['am = -1', { am: -1 }, ['am:err.am.range']],
    ['am = 10.0001', { hp: 1100, ha: 1100, am: 10.0001 }, ['am:err.am.range']],
    ['am = 10 above the air is fine', { hp: 1100, ha: 1100, am: 10 }, []],
    ['am = 5 at 300 km (B* far above 0.1)', { hp: 300, ha: 300, inc: 51.6, am: 5 }, ['am:err.bstar.range']],
    ['am = 0.5 at 300 km is fine (limit 0.9)', { hp: 300, ha: 300, inc: 51.6, am: 0.5 }, []],
    ['am = 10 at 50 km is NOT a drag error (held at 120 km)', { hp: 50, ha: 50, inc: 51.6, am: 10 }, []],
    ['retro: i 179.99 e 0.01 a 7000', { shape: 'ae', a: 7000, e: 0.01, inc: 179.99 }, ['inc:sgp4.retro']],
    ['retro: i 180 is fine', { shape: 'ae', a: 7000, e: 0.01, inc: 180 }, []],
    ['retro: i 179.99996 (written 180.0000) is fine', { shape: 'ae', a: 7000, e: 0.01, inc: 179.99996 }, []],
    ['retro: e 0 at 179.99 is fine', { shape: 'ae', a: 7000, e: 0, inc: 179.99 }, []],
    ['retro: e 1e-4 at i 179.9999 blocks (no silent floor)', { shape: 'ae', a: 7000, e: 1e-4, inc: 179.9999 }, ['inc:sgp4.retro']],
    ['retro: i 179.9 e 0.0005 is under 100 km, fine', { shape: 'ae', a: 7000, e: 0.0005, inc: 179.9 }, []],
    ['hp empty', { hp: '' }, ['hp:err.missing']],
    ['hp "abc"', { hp: 'abc' }, ['hp:err.notnum']],
    ['hp "35,786" (thousands comma)', { hp: '35,786', ha: 35786 }, ['hp:err.notnum']],
    ['LTAN 25', { nodeMode: 'ltan', ltan: '25' }, ['ltan:err.ltan.range']],
    ['LTAN "10:30" is fine', { nodeMode: 'ltan', ltan: '10:30' }, []],
    ['LTAN empty', { nodeMode: 'ltan', ltan: '' }, ['ltan:err.missing']],
    ['epoch text empty', { epoch: '' }, ['epoch:err.missing']],
    ['validation errors come in DOM order: inc, am', { am: -1, inc: 181 }, ['inc:err.inc.range', 'am:err.am.range']],
    ['an unreadable epoch is a parse error and stops the rest', { am: -1, epoch: '2026-02-30T12:00:00', inc: 181 }, ['epoch:err.epoch.range']],
    ['alt errors in DOM order: ha, inc', { inc: 181, hp: 800, ha: 700 }, ['ha:err.apo.lt.peri', 'inc:err.inc.range']],
    ['ae errors in DOM order: a before e', { shape: 'ae', a: 500000, e: -0.1, inc: 10 }, ['a:err.a.range', 'e:err.ecc.neg']],
    ['a negative e with a low a is only the eccentricity (no perigee claim from a meaningless e)', { shape: 'ae', a: 5000, e: -0.1 }, ['e:err.ecc.neg']],
    ['parse errors come first and alone, in DOM order', { ma: 'x', hp: '', inc: 'y' }, ['hp:err.missing', 'inc:err.notnum', 'ma:err.notnum']]
  ];
  for (const [label, patch, want] of T) {
    const r = P.fromForm(fm(patch));
    chk('form ' + label + ' -> ' + (want.length ? want.join(', ') : 'ok'), JSON.stringify(keys(r)) === JSON.stringify(want) && r.ok === (want.length === 0) && (r.el === null) === (want.length > 0), JSON.stringify(keys(r)));
  }
  const every = ['err.ecc.neg', 'err.ecc.parabola', 'err.ecc.hyper', 'err.inc.range', 'err.apo.lt.peri', 'err.perigee.surface', 'err.a.range', 'err.epoch.range', 'err.am.range', 'err.bstar.range', 'sgp4.retro', 'err.ltan.range', 'err.missing', 'err.notnum'];
  chk('form the table raises all ' + every.length + ' codes of SPEC 3.6', every.every(c => T.some(([, p, w]) => w.some(x => x.split(':')[1] === c))));
  /* parameters the copy needs, field keys and fallback text */
  const pr = (patch, code) => P.fromForm(fm(patch)).errors.find(x => x.code === code);
  const a = pr({ shape: 'ae', a: 7000, e: -0.1 }, 'err.ecc.neg'), b = pr({ hp: -1, ha: 100 }, 'err.perigee.surface'), c = pr({ hp: 1e6, ha: 1e6 }, 'err.a.range'), d = pr({ epoch: '2057-01-01T00:00:00' }, 'err.epoch.range');
  const e2 = pr({ shape: 'ae', a: 7000, e: 0.01, inc: 179.99 }, 'sgp4.retro'), f = pr({ hp: 800, ha: 700 }, 'err.apo.lt.peri'), g = pr({ hp: '' }, 'err.missing'), h = pr({ hp: 'abc' }, 'err.notnum'), k = pr({ nodeMode: 'ltan', ltan: '25' }, 'err.ltan.range');
  chk('form params: ecc.neg {e}; perigee.surface {rp, fix_hp:200}; a.range {a, a_max}; epoch.range {epoch_utc}', a.e === -0.1 && b.fix_hp === 200 && Math.abs(b.rp - (RE - 1)) < 1e-6 && c.a_max === 400000 && c.a > 400000 && d.epoch_utc === '2057-01-01 00:00:00Z', JSON.stringify([a, b, c, d]));
  chk('form params: retro {off180, retro_err, e, inc}; apo.lt.peri {ha, hp}; missing/notnum {label, raw}; ltan.range {raw}', Math.abs(e2.off180 - 0.01) < 1e-9 && e2.retro_err > 100 && e2.e === 0.01 && e2.inc === 179.99 && f.ha === 700 && f.hp === 800 && g.label === 'Mean perigee altitude' && g.raw === '' && h.raw === 'abc' && h.label === 'Mean perigee altitude' && k.raw === '25');
  chk('form every error has field, code and a plain-English msg; field is a form key', ['err.ecc.neg', 'err.perigee.surface', 'err.a.range', 'err.epoch.range', 'sgp4.retro', 'err.apo.lt.peri', 'err.missing', 'err.notnum'].every(code => { const x = [a, b, c, d, e2, f, g, h].find(y => y.code === code); return x && typeof x.field === 'string' && x.field !== '' && typeof x.msg === 'string' && x.msg.length > 5; }));
  /* notes: wrapped angles, never blocking */
  const n1 = P.fromForm(fm({ raan: 370 })), n2 = P.fromForm(fm({ ma: -10, argp: 720 }));
  chk('form raan = 370 -> 10 with note err.angle.wrap {raw:370, wrapped:10} and the orbit is ok', n1.ok && n1.el.raan === 10 && n1.notes.length === 1 && n1.notes[0].code === 'err.angle.wrap' && n1.notes[0].raw === 370 && n1.notes[0].wrapped === 10 && n1.notes[0].field === 'raan');
  chk('form ma = -10 -> 350 and argp = 720 -> 0, two notes in DOM order (argp, ma)', n2.ok && n2.el.M === 350 && n2.el.argp === 0 && n2.notes.map(x => x.field + ':' + x.wrapped).join() === 'argp:0,ma:350');
  chk('form inc = 181 is an error, not a note', (() => { const r = P.fromForm(fm({ inc: 181 })); return !r.ok && r.notes.length === 0; })());
  chk('form a clean form has no notes (Appendix A: every preset is ok with no notes, checked below)', P.fromForm(fm({})).notes.length === 0);
  const ve = P.fromForm(fm({ inc: 181 }));
  chk('form when only validation errors follow, derived is still returned (the read-outs stay alive); a parse error gives derived null', ve.derived !== null && Math.abs(ve.derived.a - 7078.137) < 1e-9 && P.fromForm(fm({ hp: 'x' })).derived === null && P.fromForm(fm({ hp: 800, ha: 700 })).derived === null);
  chk('form LTAN lens: raan is derived from the typed local time at the typed epoch', (() => {
    const r = P.fromForm(fm({ nodeMode: 'ltan', ltan: '10:30', inc: 98.2 })); return r.ok && angDiff(r.el.raan, P.raanFromLtan(10.5, EP)) < 1e-9 && Math.abs(r.derived.ltan - 10.5) < 1e-12;
  })());
  chk('form the Altitudes lens never shows an eccentricity complaint on a field that does not exist', (() => { const r = P.fromForm(fm({ hp: -8000, ha: 500 })); return !r.ok && r.errors.every(x => x.field !== 'e'); })());
  /* validate on el-like input */
  const el = { a: 7078.137, e: 0.001, i: 98.2, raan: 10, argp: 20, M: 30, epoch: EP, am: 0.0043 };
  const v = P.validate(el);
  chk('validate: ok, a NEW object of exactly the nine keys, bstar derived, input untouched', v.ok && v.el !== el && Object.keys(v.el).length === 9 && v.el.bstar > 0 && v.errors.length === 0 && v.warnings.length === 0 && el.bstar === undefined);
  const pv = P.validate(Object.assign(JSON.parse('{"__proto__":{"a":1},"zz":5}'), el));
  chk('validate: unknown keys and __proto__ are not copied', pv.ok && pv.el.zz === undefined && Object.getPrototypeOf(pv.el) === Object.prototype && ({}).zz === undefined);
  chk('validate: an inherited property is not a field (Object.create(el) is missing everything)', !P.validate(Object.create(el)).ok);
  const bs = P.validate(Object.assign({}, el, { am: null, bstar: 3e-4 }));
  chk('validate: bstar accepted only when am is null; am wins when both are given', bs.ok && bs.el.am === null && bs.el.bstar === 3e-4 && P.validate(Object.assign({}, el, { bstar: 0.5 })).ok && P.validate(Object.assign({}, el, { bstar: 0.5 })).el.bstar !== 0.5);
  chk('validate: explicit B* above 0.1 at 500 km is err.bstar.range on field bstar', (() => { const r = P.validate(Object.assign({}, el, { a: RE + 500, e: 0, am: null, bstar: 0.5 })); return !r.ok && r.errors[0].code === 'err.bstar.range' && r.errors[0].field === 'bstar'; })());
  chk('validate: strings, NaN, Infinity and null are errors (err.notnum / err.missing), never coerced', (() => {
    const r = P.validate({ a: '7000', e: NaN, i: Infinity, raan: null, argp: {}, M: [], epoch: 'x', am: '0.1' });
    const c = r.errors.map(x => x.field + ':' + x.code).join();
    return !r.ok && c === 'a:err.notnum,e:err.notnum,i:err.notnum,raan:err.missing,argp:err.notnum,M:err.notnum,epoch:err.notnum,am:err.notnum';
  })());
  chk('validate: a missing am and bstar is err.missing on am; integer-rounded epoch', (() => { const r = P.validate({ a: 7000, e: 0, i: 50, raan: 0, argp: 0, M: 0, epoch: EP + 0.4 }); const q = P.validate(Object.assign({}, el, { epoch: EP + 0.4 })); return !r.ok && r.errors[0].field === 'am' && r.errors[0].code === 'err.missing' && q.el.epoch === EP; })());
  chk('validate: wraps angles and says so (warnings), el keys', (() => { const r = P.validate(Object.assign({}, el, { raan: -90, M: 400 })); return r.ok && r.el.raan === 270 && r.el.M === 40 && r.warnings.map(x => x.field).join() === 'raan,M'; })());
  chk('validate returns null el and errors for the Moon-sized, underground and hyperbolic cases at once', (() => { const r = P.validate(Object.assign({}, el, { a: 500000, e: 0.99 })); return !r.ok && r.el === null && r.errors.some(x => x.code === 'err.a.range'); })());
  chk('storable drops bstar when am is set, keeps it when am is null', (() => { const s1 = P.storable(v.el), s2 = P.storable(bs.el); return !('bstar' in s1) && s1.am === 0.0043 && s2.bstar === 3e-4 && s2.am === null && Object.keys(s1).length === 8; })());
  chk('storable -> JSON -> validate gives the same el (am path), and the same two lines', (() => {
    const back = P.validate(JSON.parse(JSON.stringify(P.storable(v.el)))), t1 = P.toTLE(v.el, 'O0001'), t2 = P.toTLE(back.el, 'O0001'); return back.ok && t1.l1 === t2.l1 && t1.l2 === t2.l2;
  })());
});

group('V18 the i = 180 singularity: SGP4 against its own mirror image', () => {
  const mk = (a, e, i, raan, argp) => mkSat(elOf(a, e, i, { raan, argp, M: 0 })).s;
  const maxErr = (a, e, i, argp) => {
    const sr = mk(a, e, i, 40, argp), sp = mk(a, e, 180 - i, 320, argp); let w = 0;
    for (let t = 0; t <= 24 * 60; t += 3) {
      const d = new Date(EP + t * 60000), r = sat.propagate(sr, d), p = sat.propagate(sp, d);
      if (!r || !p || !r.position || !p.position) return NaN;
      w = Math.max(w, Math.hypot(r.position.x - p.position.x, r.position.y + p.position.y, r.position.z - p.position.z));
    }
    return w;
  };
  let worst = 0, low = 9, bad = 0, n = 0;
  for (const a of [6700, 7000, 9000, 11500]) for (const argp of [0, 90]) for (const e of [1e-5, 1e-4, 1e-2]) for (const i of [179.99, 179.9]) {
    const m = maxErr(a, e, i, argp), f = P.retroErrorKm(a, e, i); n++;
    if (!(m <= 1.15 * f)) bad++;
    worst = Math.max(worst, m / f);
    if (argp === 0 && !(m >= 0.95 * f)) bad++;
    if (argp === 0) low = Math.min(low, m / f);
  }
  chk('V18 ' + n + '-case sweep: measured <= 1.15 x formula everywhere and >= 0.95 x at argp 0 (worst ' + worst.toFixed(3) + ', lowest ' + low.toFixed(3) + ')', bad === 0 && n === 48, bad + ' violations');
  for (const a of [6700, 7000, 9000, 11500]) near('V18 retroErrorKm at e 0.01, i 179.99, a = ' + a + ' is flat in a (857.1 km)', P.retroErrorKm(a, 0.01, 179.99), 857.1, 0.5);
  for (const a of [6700, 7000, 9000, 11500]) near('V18 measured mirror error at a = ' + a + ' (24 h, argp 0) is 863.8-865.0 km', maxErr(a, 0.01, 179.99, 0), { 6700: 863.8, 7000: 863.9, 9000: 864.6, 11500: 865.0 }[a], 1.5);
  chk('V18 no silent floor: e 1e-4 at i 179.9999 is 857 km formula, 855.4 km measured', Math.abs(P.retroErrorKm(7000, 1e-4, 179.9999) - 857.0) < 1.5 && Math.abs(maxErr(7000, 1e-4, 179.9999, 0) - 855.4) < 3);
  chk('V18 e 5e-5 and 1e-5 at i 179.9999 scale linearly (428.5, 85.7 km formula; 427.9, 85.6 measured)', Math.abs(P.retroErrorKm(7000, 5e-5, 179.9999) - 428.5) < 1 && Math.abs(P.retroErrorKm(7000, 1e-5, 179.9999) - 85.7) < 0.5 && Math.abs(maxErr(7000, 5e-5, 179.9999, 0) - 427.9) < 2 && Math.abs(maxErr(7000, 1e-5, 179.9999, 0) - 85.6) < 1);
  chk('V18 i = 180.0000 and 179.99996 (written 180.0000) are 0 km by the formula and by SGP4; e = 0 is 0 km', P.retroErrorKm(7000, 0.01, 180) === 0 && P.retroErrorKm(7000, 0.01, 179.99996) === 0 && P.retroErrorKm(7000, 0, 179.99) === 0 && maxErr(7000, 0.01, 180, 0) < 0.05 && maxErr(7000, 0.01, 179.99996, 0) < 0.05);
  chk('V18 the formula reads the i the TLE will HOLD: 179.99994 is written 179.9999 and is 857 km, same as 179.9999 (an unrounded i would sit inside the 1.5e-12 guard and say 0)', P.retroErrorKm(7000, 1e-4, 179.99994) === P.retroErrorKm(7000, 1e-4, 179.9999) && P.retroErrorKm(7000, 1e-4, 179.99994) > 850 && P.toTLE(elOf(7000, 1e-4, 179.99994), '99901').l2.slice(8, 16) === '179.9999' && P.retroErrorKm(7000, 1.00004e-4, 179.99994) === P.retroErrorKm(7000, 1e-4, 179.9999));
  chk('V18 i below 150 is not in the formula\'s range (0 km); the cap is 2a', P.retroErrorKm(7000, 0.01, 149.9) === 0 && P.retroErrorKm(7000, 0.5, 179.9999) <= 2 * 7000 + 1e-9 && P.retroErrorKm(NaN, 0.1, 179.99) === 0);
  chk('V18 the first draft\'s 1.87e-3*a*e/delta is rejected: 1,232 km at a 11500 against 865 measured (over 1.15 x)', (() => {
    const first = (a, e, i) => { const d = (180 - i) * D2R; return d > 0 ? 1.87e-3 * a * e / d : 0; };
    return first(11500, 0.01, 179.99) > 1.15 * 865;
  })());
  chk('V18 validate: i 179.99 e 0.01 a 7000 blocks with retro_err 850-865; i 180, 179.99996, e 0 do not', (() => {
    const r = P.validate(elOf(7000, 0.01, 179.99, { am: 0.0043, bstar: undefined }));
    const blocked = r.errors.find(x => x.code === 'sgp4.retro');
    const ok = e => P.validate(Object.assign(elOf(7000, 0.01, 179.99, { am: 0.0043 }), e)).ok;
    return blocked && blocked.retro_err > 850 && blocked.retro_err < 865 && ok({ i: 180 }) && ok({ i: 179.99996 }) && ok({ e: 0 });
  })());
  chk('V18 the blocking error carries retro_lead: "about" for a near-Earth orbit (a 7000), "on the order of" from the 225-minute line (a 26554, a 12254.2); validate and fromForm agree', (() => {
    const lead = (a, form) => {
      const v = P.validate(elOf(a, 0.01, 179.99, { am: 0.0043 })).errors.find(x => x.code === 'sgp4.retro');
      const f = P.fromForm(Object.assign({ shape: 'ae', a, e: 0.01, inc: 179.99, raan: 0, argp: 0, ma: 0, epoch: '2026-10-01T12:00:00', am: 0.0043 }, form)).errors.find(x => x.code === 'sgp4.retro');
      return v && f && v.retro_lead === f.retro_lead ? v.retro_lead : 'disagree';
    };
    return lead(7000) === 'about' && lead(P.DEEP_A_KM - 0.01) === 'about' && lead(P.DEEP_A_KM) === 'on the order of' && lead(26554) === 'on the order of' && !P.isDeep(7000) && P.isDeep(26554);
  })());
});

group('tle: 5,000 seeded random element sets, every line checked, round trips within the quanta, and the negatives', () => {
  const RL1 = /^1 [0-9A-Z]{5}U .{8} \d{5}\.\d{8} [ +-]\.\d{8} [ +-]\d{5}[+-]\d [ +-]\d{5}[+-]\d 0 [ \d]{4}\d$/;
  const RL2 = /^2 [0-9A-Z]{5} [ \d]{3}\.\d{4} [ \d]{3}\.\d{4} \d{7} [ \d]{3}\.\d{4} [ \d]{3}\.\d{4} [ \d]{2}\.\d{8}[ \d]{5}\d$/;
  const R = rng(11); let made = 0, skipped = 0;
  const w = { len: 0, cs: 0, re: 0, ver: 0, i: 0, raan: 0, argp: 0, M: 0, e: 0, n: 0, ep: 0, a: 0, b: 0 }, worst = { i: 0, e: 0, n: 0, ep: 0, a: 0 };
  const worstCase = { ver: '' };
  const gen = () => {
    const band = R(); let a;
    if (band < 0.5) a = 6600 + R() * 1400; else if (band < 0.75) a = 8000 + R() * 22000; else a = Math.exp(Math.log(30000) + R() * (Math.log(400000) - Math.log(30000)));
    const e = [0, R() * 0.01, R() * 0.1, R() * 0.5, R() * 0.95][Math.floor(R() * 5)];
    const i = [R() * 180, R() * 180, 0, 90, 180 * R(), 51.6][Math.floor(R() * 6)];
    return { a, e, i, raan: R() * 720 - 180, argp: R() * 720 - 180, M: R() * 720 - 180, epoch: Math.round(P.LIMITS.epochMin + R() * (P.LIMITS.epochMax - P.LIMITS.epochMin)) };
  };
  while (made < 5000) {
    const g = gen();
    if (g.a * (1 - g.e) - RE < 30) { skipped++; continue; }
    const hp = g.a * (1 - g.e) - RE;
    let am = Math.pow(R(), 3) * 10;
    if (hp >= 120) { const cap = P.amMax(g.a, g.e, g.i); if (isFinite(cap)) am = Math.min(am, 0.98 * cap); }
    const v = P.validate(Object.assign(g, { am }));
    if (!v.ok) { skipped++; continue; }
    const el = v.el, t = P.toTLE(el, 'O' + String(made % 9999 + 1).padStart(4, '0'));
    made++;
    if (t.l1.length !== 69 || t.l2.length !== 69) w.len++;
    if (!P.checksumOk(t.l1) || !P.checksumOk(t.l2)) w.cs++;
    if (!RL1.test(t.l1) || !RL2.test(t.l2)) w.re++;
    const vr = P.verifyTLE(t.l1, t.l2, el, sat);
    if (!vr.ok) { w.ver++; if (!worstCase.ver) worstCase.ver = JSON.stringify(el) + ' ' + JSON.stringify(vr.errors.map(x => x.msg)); }
    const s = sat.twoline2satrec(t.l1, t.l2), n = +t.l2.slice(52, 63);
    const dI = Math.abs(s.inclo * R2D - el.i), dR = angDiff(s.nodeo * R2D, el.raan), dW = angDiff(s.argpo * R2D, el.argp), dM = angDiff(s.mo * R2D, el.M);
    if (dI > 5e-5 || dR > 5e-5 || dW > 5e-5 || dM > 5e-5) w.i++;
    worst.i = Math.max(worst.i, dI, dR, dW, dM);
    const dE = Math.abs(s.ecco - el.e); if (dE > 5e-8) w.e++; worst.e = Math.max(worst.e, dE);
    const dN = Math.abs(n - P.kozaiFromBrouwer(el.a, Math.round(el.e * 1e7) / 1e7, Math.round(el.i * 1e4) / 1e4).nRevDay); if (dN > 5.0e-9 + 1e-12) w.n++; worst.n = Math.max(worst.n, dN);
    const sy = s.epochyr < 57 ? 2000 + s.epochyr : 1900 + s.epochyr, dT = Math.abs(Date.UTC(sy, 0, 1) + (s.epochdays - 1) * 864e5 - el.epoch); if (dT > 1.4) w.ep++; worst.ep = Math.max(worst.ep, dT);
    const dA = Math.abs(s.a * RE72 - el.a), tl = tolA(el.a, n); if (dA > tl) w.a++; worst.a = Math.max(worst.a, dA / tl);
    if (Math.abs(s.bstar - t.bstarValue) > 1e-12 + 1e-5 * Math.abs(t.bstarValue)) w.b++;
  }
  chk('tle ' + made + ' valid sets generated (' + skipped + ' rejected by validate or too low)', made === 5000);
  chk('tle every line is 69 characters', w.len === 0, w.len + ' bad');
  chk('tle every line has a valid checksum', w.cs === 0, w.cs + ' bad');
  chk('tle every line passes the two layout regexes', w.re === 0, w.re + ' bad');
  chk('tle verifyTLE.ok for every set', w.ver === 0, w.ver + ' failed' + (worstCase.ver ? ' e.g. ' + worstCase.ver : ''));
  chk('tle i, RAAN, argp, M read back within 5e-5 deg (worst ' + worst.i.toExponential(2) + ')', w.i === 0, w.i + ' over');
  chk('tle e reads back within 5e-8 (worst ' + worst.e.toExponential(2) + ')', w.e === 0, w.e + ' over');
  chk('tle the written n is the inversion rounded to 5e-9 rev/day (worst ' + worst.n.toExponential(2) + ')', w.n === 0, w.n + ' over');
  chk('tle epoch reads back within 1.4 ms (worst ' + worst.ep.toFixed(3) + ' ms)', w.ep === 0, w.ep + ' over');
  chk('tle a reads back within tol_a (worst ' + worst.a.toFixed(3) + ' of the bound)', w.a === 0, w.a + ' over');
  chk('tle B* reads back within 1e-5 relative', w.b === 0, w.b + ' over');
  /* negatives: satellite.js alone validates nothing */
  const good = P.toTLE(elOf(7000, 0.001, 51.6), '99901'), gs = sat.twoline2satrec('x'.repeat(69), 'y'.repeat(69));
  chk('tle satellite.js alone reports error 0 for garbage lines (so verifyTLE is the only guard)', gs.error === 0 && Number.isNaN(gs.a));
  const neg = (what, l1, l2, el) => { const r = P.verifyTLE(l1, l2, el === undefined ? elOf(7000, 0.001, 51.6) : el, sat); chk('tle negative: ' + what + ' -> ok:false with err.sgp4', !r.ok && r.errors.length > 0 && r.errors.every(x => x.code === 'err.sgp4' && typeof x.sgp4 === 'number' && typeof x.why === 'string' && typeof x.hint === 'string'), JSON.stringify(r.errors.map(x => x.msg))); };
  neg('garbage lines', 'x'.repeat(69), 'y'.repeat(69));
  neg('a 60-character line 1', good.l1.slice(0, 60), good.l2);
  neg('a 68-character line 2', good.l1, good.l2.slice(0, 68));
  neg('a bad checksum', good.l1.slice(0, 68) + String((+good.l1[68] + 1) % 10), good.l2);
  neg('a lower-case satnum', good.l1.slice(0, 2) + '9990a' + good.l1.slice(7, 68) + P.checksum(good.l1.slice(0, 2) + '9990a' + good.l1.slice(7, 68)), good.l2);
  const bad1 = good.l1.slice(0, 2) + '99.01' + good.l1.slice(7, 68);
  neg('a punctuated satnum', bad1 + P.checksum(bad1), good.l2);
  const hot = '2 99901  51.6000  30.0000 9999999   0.0000   0.0000 15.00000000    0'; const hotFull = hot + P.checksum(hot);
  neg('e written as 0.9999999 with the perigee underground', good.l1, hotFull, null);
  neg('non-strings', null, undefined, null);
  neg('an empty pair', '', '');
  neg('a TLE with non-ASCII in the designator', good.l1.slice(0, 9) + 'é'.repeat(8) + good.l1.slice(17), good.l2);
  chk('tle negative: lines that parse but are not the orbit typed (a 1 km different a, a different B*, a 5 s different epoch) -> ok:false', (() => {
    const el = elOf(7000, 0.001, 51.6, { bstar: 3e-4 }), t = P.toTLE(el, '99901');
    const ok0 = P.verifyTLE(t.l1, t.l2, el, sat).ok;
    const a1 = P.verifyTLE(t.l1, t.l2, Object.assign({}, el, { a: 7001 }), sat), b1 = P.verifyTLE(t.l1, t.l2, Object.assign({}, el, { bstar: 4e-4 }), sat), e1 = P.verifyTLE(t.l1, t.l2, Object.assign({}, el, { epoch: EP + 5000 }), sat);
    const i1 = P.verifyTLE(t.l1, t.l2, Object.assign({}, el, { i: 52 }), sat), r1 = P.verifyTLE(t.l1, t.l2, Object.assign({}, el, { raan: 31 }), sat);
    return ok0 && !a1.ok && !b1.ok && !e1.ok && !i1.ok && !r1.ok;
  })());
  chk('tle verifyTLE with no el checks the lines alone; with no sat it fails closed, never throws', P.verifyTLE(good.l1, good.l2, null, sat).ok && !P.verifyTLE(good.l1, good.l2, null, null).ok && !P.verifyTLE(good.l1, good.l2, null, {}).ok);
  /* what verifyTLE does with every kind of refusal a propagator can give: null (satellite.js 6.0.1), {position:false} (older
     versions), NaN, a point inside the Earth, a point past a million kilometres. A stub with those answers, on good lines. */
  const stub = pv => ({ twoline2satrec: sat.twoline2satrec, propagate: () => pv });
  for (const [label, pv] of [['null', null], ['position:false, velocity:false (older satellite.js)', { position: false, velocity: false }], ['NaN components', { position: { x: NaN, y: 0, z: 7000 }, velocity: { x: 0, y: 7, z: 0 } }],
    ['a position inside the Earth (r = 100 km)', { position: { x: 100, y: 0, z: 0 }, velocity: { x: 0, y: 7, z: 0 } }], ['a position past 1e6 km', { position: { x: 2e6, y: 0, z: 0 }, velocity: { x: 0, y: 7, z: 0 } }],
    ['a missing velocity', { position: { x: 7000, y: 0, z: 0 } }], ['an infinite velocity', { position: { x: 7000, y: 0, z: 0 }, velocity: { x: Infinity, y: 0, z: 0 } }]]) {
    const r = P.verifyTLE(good.l1, good.l2, null, stub(pv));
    chk('tle verifyTLE treats a propagator answer of ' + label + ' as a refusal: err.sgp4, ok:false', !r.ok && r.errors.length === 1 && r.errors[0].code === 'err.sgp4');
  }
  chk('tle verifyTLE with a propagator that always answers a sound position: ok, 400 probes, none refused', (() => { const r = P.verifyTLE(good.l1, good.l2, null, stub({ position: { x: 7000, y: 0, z: 0 }, velocity: { x: 0, y: 7.5, z: 0 } })); return r.ok && r.probe.n === 400 && r.probe.refused === 0; })());
  chk('tle verifyTLE: a propagator that throws is a refusal, not a crash', (() => { const r = P.verifyTLE(good.l1, good.l2, null, { twoline2satrec: sat.twoline2satrec, propagate() { throw new Error('boom'); } }); return !r.ok && r.errors[0].code === 'err.sgp4'; })());
  chk('tle verifyTLE: the probe samples 400 points of one period, with none refused for a sound orbit', (() => { const r = P.verifyTLE(good.l1, good.l2, elOf(7000, 0.001, 51.6), sat); return r.ok && r.probe.n === 400 && r.probe.refused === 0 && r.warnings.length === 0; })());
  chk('tle verifyTLE: a circular orbit 5 km high at i 0 is a hard err.sgp4 (the epoch sample is refused), 119 km is fine', (() => {
    const lo = elOf(RE + 5, 0, 0, { am: 0.0043, bstar: P.bstarFromAm(0.0043, RE + 5, 0, 0) }), t = P.toTLE(lo, '99901'), r = P.verifyTLE(t.l1, t.l2, lo, sat);
    const m = elOf(RE + 119, 0, 51.6, { am: 0.0043, bstar: P.bstarFromAm(0.0043, RE + 119, 0, 51.6) }), t2 = P.toTLE(m, '99901'), r2 = P.verifyTLE(t2.l1, t2.l2, m, sat);
    return !r.ok && r.errors[0].code === 'err.sgp4' && r2.ok;
  })());
  chk('tle verifyTLE: an orbit whose perigee is 100 km under the ground, started at apogee, is ok with one probe.partial warning (part of each revolution refused)', (() => {
    const a = (2 * RE - 100 + 20000) / 2, e = (20000 + 100) / (2 * RE + 19900), el = elOf(a, e, 51.6, { M: 180 });
    const t = P.toTLE(el, '99901'), r = P.verifyTLE(t.l1, t.l2, el, sat);
    return r.ok && r.probe.refused > 0 && r.warnings.length === 1 && r.warnings[0].code === 'probe.partial' && r.warnings[0].refused === r.probe.refused;
  })());
  chk('tle SGP4_ERRORS: the six reasons with the page\'s wording and a hint each', P.SGP4_ERRORS[1].why === 'mean eccentricity or semi-major axis out of range' && P.SGP4_ERRORS[6].why === 'decayed' && P.SGP4_ERRORS[0].hint === 'Try a higher perigee.' && [0, 1, 2, 3, 4, 6].every(c => P.SGP4_ERRORS[c] && P.SGP4_ERRORS[c].hint.length > 5));
});

group('names: cleanName', () => {
  const U = String.fromCharCode;
  const cases = [
    ['the injection vector (formula, CRLF, forged line, bidi override)', '  =HYPERLINK("x")\r\nBEGIN:VEVENT  ' + U(0x202e) + ' abc', 'HYPERLINK("x") BEGIN:VEV'],
    ['leading + stripped', '+Sat', 'Sat'], ['leading - stripped', '-Sat', 'Sat'], ['leading @ stripped', '@Sat', 'Sat'], ['leading | stripped', '|Sat', 'Sat'], ["leading ' stripped", "'Sat", 'Sat'], ['leading " stripped', '"Sat', 'Sat'], ['leading = stripped', '=Sat', 'Sat'],
    ['leading characters stripped repeatedly', '+-=@|\'" x', 'x'], ['inner characters kept', 'A-B=C', 'A-B=C'],
    ['AT&T T-16 unchanged', 'AT&T T-16', 'AT&T T-16'], ['<>& kept (every sink escapes)', 'a<b>&c', 'a<b>&c'], ['whitespace collapsed and trimmed', '  a \t\n b  ', 'a b'],
    ['ZWSP and RLO only -> empty', U(0x200b) + U(0x202e), ''], ['dashes only -> empty', '---', ''], ['punctuation only -> empty', '((((', ''], ['empty string -> empty', '', ''],
    ['control characters become spaces', 'a' + U(1) + 'b' + U(0x7f) + 'c' + U(0x85) + 'd', 'a b c d'], ['soft hyphen and BOM become spaces', 'a' + U(0xad) + 'b' + U(0xfeff) + 'c', 'a b c'],
    ['bidi isolates (2066-2069) removed', 'a' + U(0x2066) + 'b' + U(0x2069) + 'c', 'a b c'], ['line separators', 'a' + U(0x2028) + 'b' + U(0x2029) + 'c', 'a b c'],
    ['NFC: e + combining acute is one code point', 'Cafe' + U(0x301), 'Caf' + U(0xe9)], ['Thai is kept (a letter in any script)', U(0xe14, 0xe32, 0xe27, 0xe40, 0xe17, 0xe35, 0xe22, 0xe21) + ' 1', U(0xe14, 0xe32, 0xe27, 0xe40, 0xe17, 0xe35, 0xe22, 0xe21) + ' 1'],
    ['a digit alone is enough', '7', '7'], ['24 characters kept', 'abcdefghijklmnopqrstuvwx', 'abcdefghijklmnopqrstuvwx'], ['25 characters cut at 24', 'abcdefghijklmnopqrstuvwxy', 'abcdefghijklmnopqrstuvwx']
  ];
  for (const [label, input, want] of cases) { const got = P.cleanName(input); chk('cleanName ' + label, got === want, JSON.stringify(got) + (got === want ? '' : ' want ' + JSON.stringify(want))); }
  const sp = String.fromCodePoint(0x1F6F0);
  const FORBIDDEN = new RegExp('[' + [[0, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0x202a, 0x202e], [0x200b, 0x200f], [0xfeff, 0xfeff]].map(r => String.fromCharCode(r[0]) + '-' + String.fromCharCode(r[1])).join('') + ']');
  const a = P.cleanName('a'.repeat(23) + sp + 'b'), b = P.cleanName('a'.repeat(24) + sp), c = P.cleanName('a'.repeat(22) + sp + sp + sp);
  chk('cleanName cuts at 24 CODE POINTS without splitting a surrogate pair', Array.from(a).length === 24 && a.endsWith(sp) && Array.from(b).length === 24 && !/[\ud800-\udbff]$/.test(b) && Array.from(c).length === 24 && !/[\ud800-\udbff](?![\udc00-\udfff])/.test(c) && !/(^|[^\ud800-\udbff])[\udc00-\udfff]/.test(c), JSON.stringify([a, b, c].map(x => Array.from(x).length)));
  chk('cleanName of a non-string is empty (number, null, undefined, object, array, boolean)', [5, null, undefined, {}, ['a'], true, Symbol('s')].every(x => P.cleanName(x) === ''));
  chk('cleanName of 70,000 characters is cut to 24 and does not hang', (() => { const t0 = Date.now(); const r = P.cleanName('a b '.repeat(17500)); return Array.from(r).length <= 24 && r.length > 0 && Date.now() - t0 < 500; })());
  chk('cleanName never leaves a leading formula character, a control character or a line separator, over 3,000 random strings', (() => {
    const R2 = rng(12), pool = ['=', '+', '-', '@', '|', "'", '"', ' ', 'a', 'Z', '7', '\r', '\n', '\t', U(0x202e), U(0x200b), U(0x2028), U(0xfeff), U(0x85), '&', '<', U(0xe14), sp];
    for (let k = 0; k < 3000; k++) {
      let s = ''; const len = Math.floor(R2() * 40); for (let j = 0; j < len; j++) s += pool[Math.floor(R2() * pool.length)];
      const o = P.cleanName(s);
      if (/^[=+\-@|'"\s]/.test(o) || FORBIDDEN.test(o) || Array.from(o).length > 24 || /\s$/.test(o)) return false;
    }
    return true;
  })());
});

group('store: sanitizeStore, the ten poisoned stores and the counter', () => {
  const good = (id, extra) => Object.assign({ id, name: 'Polar 600', made: 1790799451434, el: { a: 6978.135, e: 0.001, i: 97.8, raan: 120.5, argp: 90, M: 0, epoch: 1790856000000, am: 0.0043 } }, extra || {});
  const store = (items, next) => JSON.stringify({ v: 1, next: next === undefined ? items.length + 1 : next, items });
  const protoSnapshot = () => Object.getOwnPropertyNames(Object.prototype).sort().join();
  const before = protoSnapshot();
  const clean = (r, label) => chk('store ' + label + ': Object.prototype untouched and ({}).custom, ({}).polluted, ({}).__xss undefined', protoSnapshot() === before && ({}).custom === undefined && ({}).polluted === undefined && ({}).__xss === undefined && typeof globalThis.__xss === 'undefined');
  const r0 = P.sanitizeStore(store([good('c1'), good('c2', { name: 'Second' })], 3));
  chk('store a healthy store: two items, id, name, made, el with a derived bstar; next 3; dropped 0; why null', r0.items.length === 2 && r0.items[0].id === 'c1' && r0.items[1].name === 'Second' && r0.items[0].made === 1790799451434 && r0.items[0].el.bstar > 0 && Object.keys(r0.items[0]).sort().join() === 'el,id,made,name' && r0.next === 3 && r0.dropped === 0 && r0.why === null);
  chk('store the items the sanitiser returns are NEW objects (not the parsed input) of nine el keys', Object.keys(r0.items[0].el).length === 9);
  chk('store empty, null, undefined and non-string -> {items:[], next:1, dropped:0, why:null}', [P.sanitizeStore(''), P.sanitizeStore(null), P.sanitizeStore(undefined), P.sanitizeStore(12), P.sanitizeStore({})].every(r => r.items.length === 0 && r.next === 1 && r.dropped === 0 && r.why === null));
  const p1 = P.sanitizeStore('this is not json {{{');                                    // 1
  chk('store poison 1, not JSON -> why "unreadable"', p1.why === 'unreadable' && p1.items.length === 0); clean(p1, 'poison 1');
  const p2 = P.sanitizeStore(JSON.stringify({ v: 2, next: 3, items: [good('c1')] }));    // 2
  chk('store poison 2, another version -> why "version", nothing returned', p2.why === 'version' && p2.items.length === 0); clean(p2, 'poison 2');
  const p3 = P.sanitizeStore('[1,2,3]'), p3b = P.sanitizeStore('null'), p3c = P.sanitizeStore('"x"'), p3d = P.sanitizeStore(JSON.stringify({ v: 1, items: 'no' }));  // 3
  chk('store poison 3, an array / null / a string / items not an array -> why "version"', [p3, p3b, p3c, p3d].every(r => r.why === 'version' && r.items.length === 0)); clean(p3, 'poison 3');
  const big = 'x'.repeat(70000), p4 = P.sanitizeStore(big);                              // 4
  chk('store poison 4, 70,000 characters -> why "too-large"', p4.why === 'too-large' && p4.items.length === 0); clean(p4, 'poison 4');
  chk('store too-large is decided BEFORE any parse (65,537 invalid characters are "too-large", 65,536 are "unreadable")', P.sanitizeStore('{'.repeat(65537)).why === 'too-large' && P.sanitizeStore('{'.repeat(65536)).why === 'unreadable');
  const p5 = P.sanitizeStore(JSON.stringify({ v: 1, next: 2, items: [{ id: 'c1', name: 'N', made: 1, el: { a: 'NaN', e: '0.001', i: null, raan: 'x', argp: {}, M: [], epoch: 'now', am: '0.1' } },
    { id: 'c2', name: 'Num', made: 'soon', el: { a: 1e999, e: 0, i: 50, raan: 0, argp: 0, M: 0, epoch: 1790856000000, am: 0.0043 } }] }));   // 5
  chk('store poison 5, NaN and strings where numbers go -> both dropped, nothing trusted', p5.items.length === 0 && p5.dropped === 2 && p5.why === null); clean(p5, 'poison 5');
  const p6 = P.sanitizeStore(store([good('c1', { el: { a: 6978, e: 1.5, i: 97.8, raan: 0, argp: 0, M: 0, epoch: 1790856000000, am: 0.0043 } }), good('c2', { el: { a: 6500, e: 0.1, i: 50, raan: 0, argp: 0, M: 0, epoch: 1790856000000, am: 0.0043 } }), good('c3', { el: { a: 7000, e: 0, i: 50, raan: 0, argp: 0, M: 0, epoch: 1790856000000, am: 99 } })]));   // 6
  chk('store poison 6, e = 1.5, a perigee under the ground, am 99 -> all dropped', p6.items.length === 0 && p6.dropped === 3); clean(p6, 'poison 6');
  const p7 = P.sanitizeStore(store([good('c1', { l1: 'FORGED LINE ONE', l2: 'FORGED LINE TWO', custom: false, satnum: '25544', cid: 'c9', stdMag: -99 })]));   // 7
  chk('store poison 7, stored l1/l2/custom:false/satnum:25544 -> the item survives and NONE of them comes back', p7.items.length === 1 && Object.keys(p7.items[0]).sort().join() === 'el,id,made,name' && p7.items[0].l1 === undefined && p7.items[0].custom === undefined && p7.items[0].satnum === undefined); clean(p7, 'poison 7');
  const raw8 = '{"v":1,"next":9,"__proto__":{"polluted":true,"v":1},"items":[{"id":"__proto__","name":"A","el":{"a":7000,"e":0,"i":50,"raan":0,"argp":0,"M":0,"epoch":1790856000000,"am":0.0043}},' +
    '{"id":"c1","name":"B","__proto__":{"polluted":true},"el":{"__proto__":{"polluted":true,"a":9},"a":7000,"e":0,"i":50,"raan":0,"argp":0,"M":0,"epoch":1790856000000,"am":0.0043}},' +
    '{"id":"c0","name":"C","el":{"a":7000,"e":0,"i":50,"raan":0,"argp":0,"M":0,"epoch":1790856000000,"am":0.0043}},{"id":"c01","name":"D","el":{}},{"id":"C1","name":"E","el":{}},{"id":"c10000","name":"F","el":{}},{"id":"constructor","name":"G","el":{}},{"id":1,"name":"H","el":{}}]}';
  const p8 = P.sanitizeStore(raw8);                                                      // 8
  chk('store poison 8, a __proto__ key and non-cN ids -> only c1 survives, its el has no prototype key, nothing polluted', p8.items.length === 1 && p8.items[0].id === 'c1' && p8.dropped === 7 && p8.items[0].el.a === 7000 && p8.items[0].el.polluted === undefined && Object.getPrototypeOf(p8.items[0].el) === Object.prototype); clean(p8, 'poison 8');
  const p9 = P.sanitizeStore(store(Array.from({ length: 30 }, (_, k) => good('c' + (k + 1), { name: 'Orbit ' + (k + 1) })), 31));   // 9
  chk('store poison 9, thirty orbits -> 12 kept (the first twelve), 18 dropped, next 31', p9.items.length === 12 && p9.dropped === 18 && p9.items[11].id === 'c12' && p9.next === 31); clean(p9, 'poison 9');
  const markup = '<img src=x onerror="window.__xss=1">';
  const p10 = P.sanitizeStore(store([good('c1', { name: '=HYPERLINK("http://evil","x")\r\nBEGIN:VEVENT\r\nSUMMARY:forged ' + markup })]));   // 10
  chk('store poison 10, a name of formula + forged calendar line + markup -> cleaned: no leading =, no CR/LF, 24 code points; window.__xss never set', p10.items.length === 1 && !/^[=+\-@]/.test(p10.items[0].name) && !/[\r\n]/.test(p10.items[0].name) && Array.from(p10.items[0].name).length <= 24 && p10.items[0].name === 'HYPERLINK("http://evil",', p10.items[0].name); clean(p10, 'poison 10');
  chk('store duplicate ids: the second is dropped; a name that cleans to nothing is dropped', (() => { const r = P.sanitizeStore(store([good('c1'), good('c1', { name: 'Dup' }), good('c2', { name: '---' }), good('c3', { name: 'Fine' })])); return r.items.map(x => x.id).join() === 'c1,c3' && r.dropped === 2; })());
  chk('store next is raised past the largest id: stored 1 with c5 -> 6; stored 3 with c10 -> 11; stored 20 with c2 -> 20', P.sanitizeStore(store([good('c5')], 1)).next === 6 && P.sanitizeStore(store([good('c10')], 3)).next === 11 && P.sanitizeStore(store([good('c2')], 20)).next === 20);
  chk('store next is capped at 10000 (c9999 stored -> 10000, never 9999, so no duplicate cid or O9999)', P.sanitizeStore(store([good('c9999')], 5)).next === 10000 && P.sanitizeStore(store([good('c9999')], 99999)).next === 10000 && P.sanitizeStore(store([], 99999)).next === 10000);
  chk('store next survives an empty list (the counter is stored even then); junk next values fall back to 1', P.sanitizeStore(store([], 7)).next === 7 && P.sanitizeStore(JSON.stringify({ v: 1, next: 'x', items: [] })).next === 1 && P.sanitizeStore(JSON.stringify({ v: 1, next: -4, items: [] })).next === 1 && P.sanitizeStore(JSON.stringify({ v: 1, next: 2.9, items: [] })).next === 2);
  chk('store made: finite kept, anything else 0', P.sanitizeStore(store([good('c1', { made: 5 }), good('c2', { made: 'x' }), good('c3', { made: null })])).items.map(x => x.made).join() === '5,0,0');
  chk('store: an el stored without bstar restores to the same two lines as the one with it (am path)', (() => {
    const it = P.sanitizeStore(store([good('c1')])).items[0], viaForm = P.fromForm(P.toForm(it.el)).el;
    return P.toTLE(it.el, 'O0001').l2 === P.toTLE(viaForm, 'O0001').l2 && P.toTLE(it.el, 'O0001').l1 === P.toTLE(P.validate(P.storable(it.el)).el, 'O0001').l1;
  })());
  chk('store round trip: JSON.stringify(storable) of validated sets reads back identically', (() => {
    const els = P.presets(null, EP).map(p => P.fromForm(p.form).el), raw = JSON.stringify({ v: 1, next: 12, items: els.slice(0, 11).map((el, k) => ({ id: 'c' + (k + 1), name: 'P' + k, made: k, el: P.storable(el) })) }), r = P.sanitizeStore(raw);
    return r.items.length === 11 && r.items.every((x, k) => JSON.stringify(x.el) === JSON.stringify(els[k]));
  })());
});

group('presets: Appendix A', () => {
  const site = { name: 'Bangkok', lat: 13.75, lon: 100.52, altKm: 0 }, pr = P.presets(site, EP);
  chk('presets eleven entries in the order of PRESETS_KEYS, each {key, group, label, why, craft, form}', pr.length === 11 && pr.map(p => p.key).join() === P.PRESETS_KEYS.join() && pr.every(p => p.group && p.label && p.why && p.craft && p.form));
  chk('presets groups: seven Low Earth orbit, four Medium and high', pr.filter(p => p.group === 'Low Earth orbit').length === 7 && pr.filter(p => p.group === 'Medium and high').length === 4);
  const get = k => pr.find(p => p.key === k), el = k => P.fromForm(get(k).form).el;
  chk('presets all eleven validate: fromForm is ok with no notes and no errors', pr.every(p => { const r = P.fromForm(p.form); return r.ok && r.notes.length === 0 && r.errors.length === 0 && r.el; }), pr.filter(p => !P.fromForm(p.form).ok).map(p => p.key).join());
  near('presets sso inclination', el('sso').i, 98.2130, 2e-4); near('presets dd inclination', el('dd').i, 98.2130, 2e-4); near('presets cube inclination', el('cube').i, 97.4260, 2e-4);
  near('presets landsat a (233/16, sun-synchronous, re-solved)', el('landsat').a, 7077.735, 0.02); near('presets landsat i', el('landsat').i, 98.2113, 0.002);
  near('presets landsat 699.60 km', el('landsat').a - RE, 699.60, 0.02);
  chk('presets LTAN presets leave ltan authoritative (nodeMode ltan): sso 10:30, dd 06:00, landsat 10:00, cube 10:30; the rest are RAAN 0', get('sso').form.nodeMode === 'ltan' && get('sso').form.ltan === 10.5 && get('dd').form.ltan === 6 && get('landsat').form.ltan === 10 && get('cube').form.ltan === 10.5 && ['iss', 'thai', 'knack', 'gps', 'geo', 'molniya', 'tundra'].every(k => get(k).form.nodeMode === 'raan' && get(k).form.raan === 0));
  chk('presets the LTAN presets: raan derived from the local time at the epoch', ['sso', 'dd', 'landsat', 'cube'].every(k => angDiff(el(k).raan, P.raanFromLtan(get(k).form.ltan, EP)) < 1e-9));
  chk('presets circular ones put the phase in M: argp 0 and e 0 (so cav.circ.angles stays quiet)', ['iss', 'sso', 'dd', 'landsat', 'thai', 'cube', 'knack', 'gps', 'geo'].every(k => el(k).argp === 0 && el(k).e === 0));
  chk('presets heights: iss 420, sso/dd 700, thai 550, cube 500, knack 360, gps 20182 km', [['iss', 420], ['sso', 700], ['dd', 700], ['thai', 550], ['cube', 500], ['knack', 360], ['gps', 20182]].every(([k, h]) => Math.abs(get(k).form.hp - h) < 1e-9 && Math.abs(get(k).form.ha - h) < 1e-9));
  chk('presets tilts: iss 51.64, knack 51.63, gps 55, geo 0, molniya and tundra 63.4', el('iss').i === 51.64 && el('knack').i === 51.63 && el('gps').i === 55 && el('geo').i === 0 && el('molniya').i === 63.4 && el('tundra').i === 63.4);
  near('presets molniya a', el('molniya').a, 26554.137, 1e-9); near('presets molniya e', el('molniya').e, 0.74, 1e-12); chk('presets molniya argp 270, mean perigee 526 km, apogee 39,826 km', el('molniya').argp === 270 && Math.abs(get('molniya').form.hp - 526) < 0.5 && Math.abs(get('molniya').form.ha - 39826) < 0.5);
  near('presets tundra a (the geosynchronous a)', el('tundra').a, 42164.182, 1e-3); near('presets tundra e', el('tundra').e, 0.27, 1e-12); chk('presets tundra argp 270, apogee 47,170.4 km', el('tundra').argp === 270 && Math.abs(get('tundra').form.ha - 47170.4) < 0.05);
  near('presets geo is one sidereal day (Kepler period, min)', P.periodMin(el('geo').a), P.SIDEREAL_MIN, 1e-4);
  chk('presets drag: crafts per Appendix A (iss large 0.0012, cube cubesat 0.009, knack custom 0.0045, the rest typical 0.0043)', get('iss').craft === 'large' && el('iss').am === 0.0012 && get('cube').craft === 'cubesat' && el('cube').am === 0.009 && get('knack').craft === 'custom' && el('knack').am === 0.0045 && ['sso', 'dd', 'landsat', 'thai', 'gps', 'geo', 'molniya', 'tundra'].every(k => get(k).craft === 'typical' && el(k).am === 0.0043));
  chk('presets epoch is the caller\'s epochMs; the form is in numbers with the epoch as text', pr.every(p => p.form.epoch === '2026-10-01T12:00:00' && P.parseEpoch(p.form.epoch).value === EP && typeof p.form.hp === 'number' && p.form.shape === 'alt'));
  /* geo: SGP4 propagated to the epoch has a sub-satellite longitude equal to the site's */
  const g = el('geo'), { s } = mkSat(g), pv = sat.propagate(s, new Date(EP));
  near('presets geo: SGP4 sub-satellite longitude at the epoch equals the observer\'s 100.52 E', lonDeg(pv, EP), 100.52, 0.1);
  const g2 = P.presets({ name: 'Lima', lat: -12, lon: -77 }, Date.UTC(2030, 5, 1)).find(p => p.key === 'geo'), e2 = P.fromForm(g2.form).el, pv2 = sat.propagate(mkSat(e2).s, new Date(e2.epoch));
  near('presets geo follows the site and the epoch: Lima 77 W in 2030', lonDeg(pv2, e2.epoch), -77, 0.1);
  near('presets geo: M is mod360(site.lon + gmst - raan - argp)', get('geo').form.ma, wrap360(100.52 + P.gmstDeg(EP)), 1e-9);
  const t1 = P.presets({ name: 'Chiang Mai', lat: 18.8, lon: 98.97 }, EP).find(p => p.key === 'thai'), t2 = P.presets({ name: 'Hobart', lat: -42.9, lon: 147.3 }, EP).find(p => p.key === 'thai');
  chk('presets thai follows round(abs(site.lat)): Bangkok 14, Chiang Mai 19, Hobart 43; the label says "over <site>" once the site has moved', get('thai').form.inc === 14 && t1.form.inc === 19 && t2.form.inc === 43 && /Thailand/.test(get('thai').label) && /over Chiang Mai/.test(t1.label) && !/Thailand/.test(t1.label));
  chk('presets with no site or epoch fall back to Bangkok and a fixed epoch (no clock)', (() => { const x = P.presets(); return x.length === 11 && x[4].form.inc === 14 && x[0].form.epoch === '2026-10-01T12:00:00'; })());
  chk('presets are pure: the same arguments give identical JSON; the lists are fresh each call', JSON.stringify(P.presets(site, EP)) === JSON.stringify(P.presets(site, EP)) && P.presets(site, EP) !== P.presets(site, EP));
  chk('presets wording is Appendix A verbatim (labels and the why of three)', get('iss').label === 'ISS-like, 420 km' && get('sso').label === 'Earth observation, sun-synchronous, 700 km' && get('landsat').why === 'Landsat’s kind of orbit: 233 revolutions in exactly 16 days, so the same scene comes round again.'.replace('’', String.fromCharCode(0x2019)) && get('molniya').label === 'Molniya' && get('tundra').label === 'Tundra');
  chk('presets every verified through SGP4: toTLE then verifyTLE is ok for all eleven', pr.every(p => { const e = P.fromForm(p.form).el, t = P.toTLE(e, 'O0001'); return P.verifyTLE(t.l1, t.l2, e, sat).ok; }));
  const df = P.defaultForm(site, EP);
  chk('presets defaultForm is the sso preset\'s form, named My orbit', df.name === 'My orbit' && df.hp === get('sso').form.hp && df.inc === get('sso').form.inc && df.nodeMode === 'ltan' && P.fromForm(df).ok);
});

group('rates: deep space is flagged, near-earth is not', () => {
  const lo = P.rates(12254.0, 0, 30), hi = P.rates(12254.3, 0, 30), hi0 = P.rates(P.DEEP_A_KM, 0, 30);
  chk('rates flip deep:true between a = 12254.0 and 12254.3 km, without a satrec, with source sgp4init', lo.deep === false && hi.deep === true && hi0.deep === true && hi.source === 'sgp4init');
  chk('rates deep orbits keep their closed-form numbers (finite) and the caller-visible flag', [P.rates(26562, 0.74, 63.4), P.rates(42164.182, 0, 0), P.rates(400000, 0, 98)].every(r => r.deep && isFinite(r.nodedot) && isFinite(r.mdot) && isFinite(r.nodalPeriodS)));
  chk('rates ssoInclination above the threshold without a satrec still returns the J2/J4 root, and rates() says deep', (() => { const i = P.ssoInclination(12300, 0); return i !== null && P.rates(12300, 0, i).deep && Math.abs(P.rates(12300, 0, i).nodedot - P.MEAN_SUN_RATE) < 1e-6; })());
  chk('rates GEO: nodal period within 1 min of the sidereal day, drift = mdot + argpdot + nodedot - WE is small', (() => { const r = P.rates(P.GEO_A_KM, 0, 0); return Math.abs(r.nodalPeriodS / 60 - P.SIDEREAL_MIN) < 1 && Math.abs(r.mdot + r.argpdot + r.nodedot - P.WE_DEG_DAY) < 0.1; })());
});

group('indep: real element sets and the B* back-derivations', () => {
  for (const [nm, e] of [['ISS (ZARYA)', ISS], ['LANDSAT 8', LANDSAT], ['SENTINEL-2A', S2A], ['TERRA SAR X', TSX], ['KNACKSAT-2', KNACK]]) {
    const el = P.elementsFromTLE(e.l1, e.l2, sat), s = sat.twoline2satrec(e.l1, e.l2), p = parseTle(e);
    chk('indep elementsFromTLE(' + nm + '): a is satrec.a * 6378.135, e, i, RAAN and epoch from the lines', el.a === s.a * RE72 && Math.abs(el.e - p.ecc) < 1e-9 && Math.abs(el.i - p.inc) < 1e-4 && angDiff(el.raan, p.raan) < 1e-4 && Math.abs(el.epoch - p.epochMs) < 1);
    chk('indep elementsFromTLE(' + nm + '): argp and M from the lines, bstar from the satrec, am a finite number >= 0', angDiff(el.argp, +e.l2.slice(34, 42)) < 1e-4 && angDiff(el.M, +e.l2.slice(43, 51)) < 1e-4 && el.bstar === s.bstar && isFinite(el.am) && el.am >= 0);
  }
  near('indep ISS: B* worked back to area over mass (m2/kg)', P.elementsFromTLE(ISS.l1, ISS.l2, sat).am, 0.0012, 5e-5, '(the "large" craft)');
  near('indep KNACKSAT-2: B* worked back to area over mass (m2/kg)', P.elementsFromTLE(KNACK.l1, KNACK.l2, sat).am, 0.0045, 2e-4, '(the knack preset)');
  chk('indep a high-perigee set has am null (B* carries no drag information) and an unvalidated catalogue set does not throw', (() => {
    const geo = CAT.find(x => { const q = parseTle(x); return q.n < 1.1 && q.n > 0.99; }), el = P.elementsFromTLE(geo.l1, geo.l2, sat);
    let all = true;
    for (const x of CAT) { try { P.elementsFromTLE(x.l1, x.l2, sat); } catch (err) { all = false; } }
    return el.am === null && all;
  })());
  /* the whole catalogue: every real set that SGP4 reads, read back through brouwerFromKozai, equals satrec.a */
  let worst = 0, n = 0;
  for (const x of CAT) {
    const s = sat.twoline2satrec(x.l1, x.l2), p = parseTle(x); if (!(s.a > 0) || s.error !== 0) continue;
    worst = Math.max(worst, Math.abs(P.brouwerFromKozai(p.n, p.ecc, p.inc) - s.a * RE72)); n++;
  }
  chk('indep brouwerFromKozai == satrec.a * 6378.135 over all ' + n + ' readable catalogue sets (1e-4 km: the written n carries 8 decimals)', worst <= 1e-4, 'worst ' + worst.toExponential(2) + ' km');
  chk('indep the catalogue round trip: kozaiFromBrouwer(brouwerFromKozai(n)) == n for every readable set (1e-8 rev/day)', (() => {
    let w = 0; for (const x of CAT) { const p = parseTle(x), a = P.brouwerFromKozai(p.n, p.ecc, p.inc); if (!(a > 0) || !(p.ecc < 1)) continue; w = Math.max(w, Math.abs(P.kozaiFromBrouwer(a, p.ecc, p.inc).nRevDay - p.n)); } return w <= 1e-8;
  })(), '');
});

group('hostile input: nothing throws, nothing is polluted, nothing is huge', () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort().join() + '|' + Object.getOwnPropertyNames(Array.prototype).length;
  const inputs = [undefined, null, NaN, 0, -0, 1, 'x', '', {}, [], [[]], true, Symbol('s'), () => 1, 1e308, -1e308, Infinity, -Infinity, 1e-320, 'NaN', '1e999', '0x10', '9'.repeat(70000), 'a'.repeat(70000),
    JSON.parse('{"__proto__":{"hp":5,"ha":5,"polluted":true}}'), Object.create(null), { toString() { throw new Error('x'); } }, new Date(NaN), /re/];
  let threw = '';
  const T = (label, f) => { try { f(); } catch (e) { if (!threw) threw = label + ': ' + (e && e.message); } };
  const fields = ['hp', 'ha', 'a', 'e', 'period', 'inc', 'raan', 'ltan', 'argp', 'ma', 'epoch', 'am', 'name', 'shape', 'nodeMode'];
  let formsRun = 0, bigErr = 0;
  for (const shape of ['alt', 'ae', 'per', '__proto__', undefined]) for (const nodeMode of ['raan', 'ltan', 'constructor']) for (const bad of inputs) {
    for (const fld of fields) {
      const f = Object.assign({}, BASE, { shape, nodeMode, ltan: '10:30', a: 7000, e: 0.01, period: 100 });
      f[fld] = bad;
      T('fromForm ' + fld, () => { const r = P.fromForm(f); formsRun++; JSON.stringify(r); if (JSON.stringify(r).length > 20000) bigErr++; });
      T('patchForm ' + fld, () => { P.patchForm(f, { [fld]: bad }); P.patchForm(Object.assign({}, f), JSON.parse('{"__proto__":{"hp":1}}')); });
    }
  }
  T('fromForm of non-objects', () => { for (const b of inputs) { P.fromForm(b); P.patchForm(b, b); P.validate(b); P.sanitizeStore(b); P.cleanName(b); P.kindWord(b); P.storable(Object.assign({}, BASE)); P.checksumOk(b); } });
  chk('hostile fromForm and patchForm: ' + formsRun + ' hostile forms, no exception' + (threw ? ' (first: ' + threw + ')' : ''), threw === '' && formsRun > 5000);
  chk('hostile fromForm: no error object grows with the input (70,000-character strings are clipped)', bigErr === 0);
  threw = '';
  T('validate', () => { for (const bad of inputs) for (const k of ['a', 'e', 'i', 'raan', 'argp', 'M', 'epoch', 'am', 'bstar']) { const o = { a: 7000, e: 0.01, i: 50, raan: 1, argp: 2, M: 3, epoch: EP, am: 0.0043 }; o[k] = bad; P.validate(o); } });
  T('validate extremes', () => {
    for (const a of [1e-300, 1, 6378, 1e6, 1e300, Number.MAX_VALUE]) for (const e of [0, 0.999999999, 1 - 1e-16, 1e-300]) for (const i of [0, 180, 90, 1e-9]) for (const am of [0, 1e-300, 10, 1e300]) P.validate({ a, e, i, raan: 1e300, argp: -1e300, M: 1e308, epoch: EP, am });
  });
  chk('hostile validate: strings, NaN, huge, tiny and extreme combinations never throw', threw === '', threw);
  threw = '';
  T('sanitizeStore', () => {
    const items = ['{"v":1,"items":[null,1,"x",[],{"id":"c1"},{"id":"c1","name":{},"el":[]},{"id":"c2","name":"n","el":null}]}', '{"v":1,"items":{"length":3}}', '{"v":1,"items":[' + '{"id":"c1"},'.repeat(5000) + '{}]}',
      '{"v":1,"next":{"valueOf":1},"items":[]}', '{"v":"1","items":[]}', '{"__proto__":{"v":1,"items":[]}}', '{"v":1,"items":[{"id":"c3","name":"x","el":{"a":7000,"e":0,"i":50,"raan":0,"argp":0,"M":0,"epoch":1790856000000,"am":1e999}}]}', '\u0000', '{', '[', 'null', '1e999'];
    for (const s of items) { const r = P.sanitizeStore(s); JSON.stringify(r); if (!(r.next >= 1 && r.next <= 10000 && Array.isArray(r.items) && r.items.length <= 12)) throw new Error('bad result for ' + s.slice(0, 40)); }
    for (const b of inputs) P.sanitizeStore(b);
  });
  chk('hostile sanitizeStore: nulls, arrays, 5,000 junk items, a __proto__ top level, 1e999, NUL: never throws, next in 1..10000, at most 12 items', threw === '', threw);
  threw = '';
  T('toTLE/verifyTLE/expField/epochFields', () => {
    for (const bad of inputs) { try { P.toTLE(bad, '99901'); } catch (e) { if (!(e instanceof RangeError)) throw e; } try { P.toTLE(elOf(7000, 0, 10), bad); } catch (e) { if (!(e instanceof RangeError)) throw e; } try { P.expField(bad); } catch (e) { if (!(e instanceof RangeError)) throw e; } try { P.epochFields(bad); } catch (e) { if (!(e instanceof RangeError)) throw e; } P.verifyTLE(bad, bad, bad, sat); P.verifyTLE(bad, bad, null, bad); }
  });
  chk('hostile toTLE, expField, epochFields throw only RangeError; verifyTLE never throws', threw === '', threw);
  threw = '';
  const coercible = x => { try { Number(x); return true; } catch (e) { return false; } };
  T('geometry', () => { for (const bad of inputs.filter(coercible)) { P.rates(bad, bad, bad); P.ssoInclination(bad, bad); P.retroErrorKm(bad, bad, bad); P.revsPerNodalDay(7000, 0, 51.6); P.apsides(bad, bad); P.gmstDeg(bad); P.meanSunRaDeg(bad); P.ltanFromRaan(bad, bad); P.kozaiFromBrouwer(bad, bad, bad); P.presets(bad, bad); P.defaultForm(bad, bad); } });
  chk('hostile numeric kernels (rates, ssoInclination, retroErrorKm, presets...) do not throw on junk', threw === '', threw);
  const after = Object.getOwnPropertyNames(Object.prototype).sort().join() + '|' + Object.getOwnPropertyNames(Array.prototype).length;
  chk('hostile: Object.prototype and Array.prototype are untouched, and ({}).hp, ({}).polluted, ({}).custom are undefined', before === after && ({}).hp === undefined && ({}).polluted === undefined && ({}).custom === undefined && ({}).zz === undefined);
  chk('hostile: a form whose __proto__ carries hp/ha is treated as empty (inherited values are not fields)', (() => { const r = P.fromForm(inputs[24]); return !r.ok && r.errors.some(x => x.code === 'err.missing'); })());
  chk('hostile: determinism, the same form gives the same JSON twice', JSON.stringify(P.fromForm(BASE)) === JSON.stringify(P.fromForm(BASE)));
  chk('hostile: the module reads no clock (Date.now is never called by the planner)', (() => {
    const real = Date.now; let calls = 0; Date.now = () => { calls++; return real(); };
    try { P.fromForm(BASE); P.presets(null, EP); P.toTLE(P.fromForm(BASE).el, 'O0001'); P.sanitizeStore('{"v":1,"items":[]}'); P.verifyTLE('x', 'y', null, sat); } finally { Date.now = real; }
    return calls === 0;
  })());
});

console.log('\n' + total + ' checks, ' + fails + ' failed');
console.log(fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS');
process.exit(fails ? 1 : 0);
