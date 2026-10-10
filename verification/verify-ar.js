/*
 * The AR view: the sky drawn over a phone's camera, where the phone points.
 *
 * Each check here pins a trap, most of them found before the view existed by
 * reading WebKit, Chromium and the W3C and NOAA documents it depends on:
 *
 *  - The order of the two requests. On an iPhone the motion permission can only
 *    be asked for inside the tap, and the gesture is gone after an await on a
 *    later task, getUserMedia's among them. The tap here must log the motion
 *    request first and the camera second, both with the click still the
 *    current event.
 *  - requestPermission() is no longer a sign of iOS: Chrome 152 has it.
 *  - Chrome desktop sends one orientation event with every angle null, and a
 *    phone held still sends nothing at all (Chrome only reports a change of
 *    0.1°), so silence after the first reading is not an error.
 *  - alpha is not a heading. Upright, alpha and gamma swing together through
 *    180°, and two Euler triples give one pose; only the matrix means anything.
 *  - The signs. Declination is east-positive and true = magnetic + D, so alpha
 *    loses D; the iPhone's offset is heading - (360 - alpha).
 *  - A marker at the centre of the screen is blind to an ignored screen
 *    rotation, so the landscape check measures a level horizon instead.
 *  - The zip NOAA publishes the model in carries a README whose example rows
 *    are the previous model's, WMM2020; the checks use its test-value file.
 *  - AR is not a camera mode: as the camera group's last child, hidden on a
 *    desktop, it would take POV's rounded end and join verify-pov's count.
 *
 * Part A runs the maths in node: arview.js is required too, which proves it
 * touches no DOM at load. Part B drives the page in Chromium phone contexts
 * with the permissions, the camera, the page's visibility and the sensors
 * mocked - synthetic events prove the maths and the wiring, not a phone's
 * hardware, and the README's device checklist is the rest - and once more in a
 * browser with no WebGL. The rebuilt page's view also has a radar, a polar plot
 * of the sky with a blue crosshair where the phone points, which has a part of
 * its own, after the iPhone's (partRadar). Part C loads the page the way
 * snapshot.js does, on a desktop over http.
 *
 * The page's clock is set here and not read from the day the suite runs on. A
 * window opens at "now", and what the checks need of it is not true every day:
 * the pointer checks want the spacecraft clear of the zenith (over it an azimuth
 * offset shrinks by cos(elevation), and "40° to the left" is still on screen),
 * Cape Town's best pass must not be overhead for the same reason, London is on
 * UTC+1 only until late October, and the model's life ends in 2030. Every page
 * therefore starts at one instant, 2026-09-13T00:00Z, and its clock runs on from
 * there; GT_AR_AT=<an ISO instant> starts it somewhere else. The clock is
 * Playwright's, which moves Date, the timers, requestAnimationFrame and
 * performance.now together: the view reads both Date.now and performance.now
 * (the declination's day and year, the elsewhere check, the re-sync, the
 * iPhone compass's timing), and Go live needs Date.now to keep advancing.
 * Where a check also needs a geometry that only some days have (a spacecraft
 * well up the sky but not overhead, a second pass in the window), it makes it
 * itself rather than hope for it.
 *
 *   node verification/verify-ar.js        (needs playwright)
 *   GT_TARGET=new GT_AR_AT=2026-10-05T00:00Z node verification/verify-ar.js
 *   GT_AR_ONLY=radar node verification/verify-ar.js       (just the radar's part of the rebuilt page's view, after Part A)
 */
const H = require('./lib/harness');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = H.playwright();

const ROOT = path.join(__dirname, '..');
const SITE = H.targetRoot();   // what is being served: legacy/ or dist/ (ROOT stays the repo)
const NEW = H.targetName() === 'new';   // the rebuilt page keeps some controls elsewhere than the old one did
/* The camera group's rounded end, as the computed style of the element that carries it: the old page's last button (3px), the rebuilt page's
   group (Segmented's own token, --r-2, 6px). Exact: any rounding at all is also what another token, or a pill, would give. */
const END_R = NEW ? '6px' : '3px';
require(H.earthFile('wmm'));
require(H.earthFile('skyar'));
require(H.earthFile('arview'));
const WMM = globalThis.WMM, S = globalThis.SkyAR;
const RAD = Math.PI/180, DEG = 180/Math.PI;

let fails = 0;
const chk = (name, ok, detail) => {
  if(!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const vnear = (a, b, tol) => a.every((x, i) => Math.abs(x - b[i]) <= tol);
const fmt = v => '[' + v.map(x => (Math.abs(x) < 5e-13 ? 0 : x).toFixed(4)).join(', ') + ']';
/* A fixed pseudo-random sequence, so a failure can be reproduced. */
function lcg(seed){ let s = seed >>> 0; return () => (s = (1664525*s + 1013904223) >>> 0)/4294967296; }

/* ======================================================================
 * Part A - the maths, in node
 * ==================================================================== */
function partA(){
  console.log('\nPart A — the maths, in node\n');
  chk('arview.js loads with no DOM at all, and defines ARView', typeof document === 'undefined'
      && typeof globalThis.ARView === 'object' && typeof globalThis.ARView.open === 'function');

  wmmChecks();

  /* The frame: the spec's own worked poses. */
  const E = [1, 0, 0], N = [0, 1, 0], U = [0, 0, 1], Dn = [0, 0, -1], Sd = [0, -1, 0];
  const cases = [
    ['flat, face up, top to the north: the camera looks at the ground', [0, 0, 0, 0], { fwd: Dn, up: N, right: E }],
    ['upright portrait, facing north: the camera is on the horizon', [0, 90, 0, 0], { fwd: N, up: U, right: E }],
    ['upright facing east', [270, 90, 0, 0], { fwd: E, up: U, right: Sd }],
    ['tipped 30° back, facing north', [0, 120, 0, 0], { fwd: [0, Math.cos(30*RAD), 0.5], up: [0, -0.5, Math.cos(30*RAD)], right: E }],
    ['landscape, top to the left (θ 90), facing north', [90, 0, -90, 90], { fwd: N, up: U, right: E }],
    ['landscape, top to the left (θ 90), facing east', [0, 0, -90, 90], { fwd: E, up: U, right: Sd }],
    ['landscape, top to the right (θ 270), facing north', [270, 0, 90, 270], { fwd: N, up: U, right: E }]
  ];
  for(const [name, [a, b, g, t], want] of cases){
    const p = S.pose(a, b, g, t);
    chk('frame: ' + name, vnear(p.fwd, want.fwd, 1e-12) && vnear(p.up, want.up, 1e-12) && vnear(p.right, want.right, 1e-12),
        'fwd ' + fmt(p.fwd) + ' up ' + fmt(p.up) + ' az ' + p.az.toFixed(2) + ' el ' + p.el.toFixed(2));
  }

  /* 2000 poses: the basis is a right-handed orthonormal one, the view axis does
     not depend on the screen's rotation, the double cover is one pose, and the
     inverse returns the spec's ranges. */
  const rnd = lcg(20260929);
  let orth = 0, hand = 0, fwdTheta = 0, cover = 0, inv = 0, range = true;
  for(let i = 0; i < 2000; i++){
    const a = rnd()*360, b = rnd()*360 - 180, g = rnd()*180 - 90, t = [0, 90, 180, 270][i % 4];
    const B = S.frame(a, b, g), c = S.camera(B, t), c0 = S.camera(B, 0);
    orth = Math.max(orth, Math.abs(S.dot(c.fwd, c.up)), Math.abs(S.dot(c.fwd, c.right)), Math.abs(S.dot(c.up, c.right)),
                    Math.abs(Math.hypot(...c.fwd) - 1), Math.abs(Math.hypot(...c.up) - 1), Math.abs(Math.hypot(...c.right) - 1));
    hand = Math.max(hand, Math.abs(S.dot(S.cross(c.right, c.up), c.fwd) + 1));
    fwdTheta = Math.max(fwdTheta, ...c.fwd.map((x, k) => Math.abs(x - c0.fwd[k])));
    const B2 = S.frame(a + 180, 180 - b, g + 180);
    for(const k of ['x', 'y', 'z']) for(let j = 0; j < 3; j++) cover = Math.max(cover, Math.abs(B[k][j] - B2[k][j]));
    const e = S.eulerFromBasis(B), B3 = S.frame(e.alpha, e.beta, e.gamma);
    for(const k of ['x', 'y', 'z']) for(let j = 0; j < 3; j++) inv = Math.max(inv, Math.abs(B[k][j] - B3[k][j]));
    if(!(e.alpha >= 0 && e.alpha < 360 && e.beta >= -180 && e.beta < 180 && e.gamma >= -90 && e.gamma < 90)) range = false;
  }
  chk('2000 poses: orthonormal, right x up = -fwd, and the view axis the same at every screen rotation',
      orth < 1e-12 && hand < 1e-12 && fwdTheta === 0,
      'worst ' + Math.max(orth, hand).toExponential(1));
  chk('...(a, b, g) and (a+180, 180-b, g+180) are one pose, so alpha alone is no heading',
      cover < 1e-12, 'worst ' + cover.toExponential(1));
  chk('...and the inverse gives the same pose back, in the spec\'s ranges',
      inv < 1e-11 && range, 'worst ' + inv.toExponential(1));

  chk('screen angle: window.orientation first, as the one value engines agree on',
      S.screenAngle(-90, undefined) === 270 && S.screenAngle(undefined, 90) === 90
      && S.screenAngle(0, 270) === 0 && S.screenAngle(undefined, undefined) === 0,
      '(-90,-)→' + S.screenAngle(-90) + ' (-,90)→' + S.screenAngle(undefined, 90) + ' (0,270)→' + S.screenAngle(0, 270));
  chk('...and the angle gravity implies, for when it is wrong, undecided when flat',
      S.gravityAngle(S.frame(0, 90, 0)) === 0 && S.gravityAngle(S.frame(90, 0, -90)) === 90
      && S.gravityAngle(S.frame(270, 0, 90)) === 270 && S.gravityAngle(S.frame(0, -90, 0)) === 180
      && S.gravityAngle(S.frame(0, 0, 0)) === null);

  /* The signs, on the cases the design worked by hand. */
  const sea = S.pose(330 - 14.9, 90, 0, 0);
  chk('declination: Seattle, 14.9° E, a camera 30° magnetic faces 44.9° true', near(sea.az, 44.9, 1e-9),
      'alpha 330 − 14.9 → azimuth ' + sea.az.toFixed(4) + '°');
  const f0 = S.compassFusion();
  for(let i = 0; i < 12; i++) f0.feed({ alpha: 107, beta: 10, gamma: 0, heading: 30, accuracy: 10, t: i*33 });
  chk('iPhone offset: alpha 107 with the top edge on 30° magnetic gives 137, and 107 − 137 is alpha 330',
      near(f0.offset, 137, 1e-9) && near(S.wrap360(107 - f0.offset), 330, 1e-9), 'offset ' + f0.offset);

  /* The lens and the projection. */
  const F1 = S.focal(390, 844, 1080, 1440, 68), F2 = S.focal(390, 844, 640, 480, 68);
  const F3 = S.focal(390, 844, 0, 0, 68), F4 = S.focal(844, 390, 1440, 1080, 68);
  const v1 = S.viewOf(F1, 390, 844);
  chk('lens: 68° across the long side on a 390x844 phone, a 1080x1440 stream behind object-fit: cover',
      near(F1, 625.6, 0.05) && near(F2, 834.2, 0.1) && near(F3, F1, 1e-9) && near(F4, F1, 1e-9),
      'F ' + F1.toFixed(1) + ' px, view ' + v1.h.toFixed(1) + '° × ' + v1.v.toFixed(1) + '°, ' +
      (F1*Math.tan(RAD)).toFixed(1) + ' px per degree at the centre; the fake 640x480 stream ' + F2.toFixed(1) + ' px; ' +
      '≈' + S.lensMm(68).toFixed(1) + ' mm');
  const lv = S.pose(0, 90, 0, 0), cx = 195, cy = 422;
  const c0 = S.project(lv, lv.fwd, F1, cx, cy), r10 = S.project(lv, S.enu(10, 0), F1, cx, cy);
  const back = S.project(lv, S.enu(180, 0), F1, cx, cy);
  let rt = 0;
  for(let i = 0; i < 9; i++) for(let j = 0; j < 9; j++){
    const x = 20 + i*44, y = 40 + j*95, v = S.unproject(lv, x, y, F1, cx, cy), q = S.project(lv, v, F1, cx, cy);
    rt = Math.max(rt, Math.abs(q.x - x), Math.abs(q.y - y));
  }
  const ep = S.edgePoint(cx, cy, 1, 0, { left: 16, top: 100, right: 374, bottom: 600 });
  const eu = S.edgePoint(cx, cy, 0, -1, { left: 16, top: 100, right: 374, bottom: 600 });
  chk('projection: the view axis at the centre, 10° right on a level horizon at F·tan 10°, behind not drawn',
      c0.x === cx && c0.y === cy && near(r10.x, cx + F1*Math.tan(10*RAD), 1e-9) && near(r10.y, cy, 1e-9) && !back.front,
      '10° right at ' + (r10.x - cx).toFixed(2) + ' px');
  chk('...unproject and project round-trip on a 9x9 grid, and the edge point lands on the safe rectangle',
      rt < 1e-9 && ep.x === 374 && ep.y === cy && eu.x === cx && eu.y === 100, 'worst ' + rt.toExponential(1) + ' px');
  const gp = S.groundPolygon(lv, F1, cx, cy, 390, 844);
  let area = 0;
  for(let i = 0; i < gp.length; i++){ const p = gp[i], q = gp[(i + 1) % gp.length]; area += p[0]*q[1] - q[0]*p[1]; }
  chk('...a level view shades exactly the lower half of the screen as ground', near(Math.abs(area)/2, 390*422, 1e-6),
      (Math.abs(area)/2).toFixed(1) + ' of ' + 390*844 + ' px²');

  const compass = az => ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
    [Math.round(((az % 360) + 360) % 360/22.5) % 16];
  const st = [
    [{ az: 0, el: 20 }, { az: 30, el: 32 }, 'turn right 30° · up 12°'],
    [{ az: 10, el: 0 }, { az: 340, el: 0 }, 'turn left 30°'],
    [{ az: 0, el: 0 }, { az: 175, el: 12 }, 'turn round · up 12°'],
    [{ az: 0, el: 85 }, { az: 226, el: 34 }, 'face SW (226°) · 34° above the horizon'],
    [{ az: 0, el: 0 }, { az: 1, el: 1 }, '']
  ];
  const got = st.map(([v, t]) => S.steer(v, t, compass));
  chk('where to turn: right and up, left across north, round, a bearing when looking up, and nothing on target',
      got.every((s, i) => s === st[i][2]), got.map(s => '"' + s + '"').join(' '));

  /* The Sun: hand cases, then against a vector derivation of the same thing. */
  const s1 = S.sunAzEl(0, 0, 0, 90), s2 = S.sunAzEl(0, 0, 20, 0);
  const r2 = lcg(7);
  let dEl = 0, dAz = 0;
  for(let i = 0; i < 500; i++){
    const la = rnd()*170 - 85, lo = rnd()*360 - 180, sa = r2()*47 - 23.5, so = r2()*360 - 180;
    const u = (a, b) => [Math.cos(a*RAD)*Math.cos(b*RAD), Math.cos(a*RAD)*Math.sin(b*RAD), Math.sin(a*RAD)];
    const site = u(la, lo), sun = u(sa, so);
    const e = [-Math.sin(lo*RAD), Math.cos(lo*RAD), 0];
    const n = [-Math.sin(la*RAD)*Math.cos(lo*RAD), -Math.sin(la*RAD)*Math.sin(lo*RAD), Math.cos(la*RAD)];
    const el = Math.asin(S.dot(site, sun))*DEG, az = S.wrap360(Math.atan2(S.dot(sun, e), S.dot(sun, n))*DEG);
    const q = S.sunAzEl(la, lo, sa, so);
    dEl = Math.max(dEl, Math.abs(q.el - el));
    if(Math.abs(el) < 89) dAz = Math.max(dAz, Math.abs(S.wrap180(q.az - az)));
  }
  chk('the Sun: 90° east on the equator rises due east, one 20° north is due north',
      near(s1.az, 90, 1e-9) && near(s1.el, 0, 1e-9) && near(s2.az, 0, 1e-9) && near(s2.el, 70, 1e-9));
  chk('...and 500 random sites agree with a vector derivation of the same bearing and elevation',
      dEl < 1e-9 && dAz < 1e-8, 'worst ' + dEl.toExponential(1) + '° in elevation, ' + dAz.toExponential(1) + '° in azimuth');

  fusionChecks(rnd);

  /* Ticks along a pass. */
  const t8 = S.ticks(0, 480000, 7), t24 = S.ticks(0, 86400000, 7), t168 = S.ticks(0, 168*3600000, 7);
  chk('pass ticks: at most 15 even on a geostationary spacecraft\'s pass through the longest, 7-day window',
      t168.length <= 15 && t168.length >= 8, t168.length + ' on 7 days');
  const tNp = S.ticks(Date.UTC(2026, 8, 29, 0, 7), Date.UTC(2026, 8, 29, 9, 7), 5.75);
  chk('pass ticks: a minute apart on an 8-minute pass, clear of both ends; never more than 15 on a day-long one',
      t8.length === 7 && t8[0] === 60000 && t8[6] === 420000 && t24.length <= 15 && t24.length >= 8,
      t8.length + ' on 8 min, ' + t24.length + ' on 24 h');
  chk('...on the observer\'s clock, which in Nepal is 5 h 45 min ahead of UTC',
      tNp.length > 0 && tNp.every(t => (t + 5.75*3600000) % 3600000 === 0), tNp.length + ' hourly ticks on local hours');

  chk('camera refusals by name', S.cameraFailure('NotAllowedError') === 'declined' && S.cameraFailure('SecurityError') === 'declined'
      && S.cameraFailure('NotFoundError') === 'none' && S.cameraFailure('OverconstrainedError') === 'none'
      && S.cameraFailure('NotReadableError') === 'busy' && S.cameraFailure('NoApi') === 'unavailable'
      && S.cameraFailure('TypeError') === 'other');
}

/* The iPhone's compass offset: only where the heading's axis cannot matter. */
function fusionChecks(rnd){
  const feedAll = (f, list) => list.map(s => f.feed(s));
  const flat = (t, H, o) => Object.assign({ alpha: 107, beta: 10, gamma: 0, heading: H, accuracy: 10, t }, o);
  let f = S.compassFusion();
  const noise = lcg(99);
  for(let i = 0; i < 200; i++) f.feed(flat(i*33, S.wrap360(30 + (noise() - 0.5)*16)));
  chk('iPhone north: 200 samples with ±8° of compass noise settle within 1° of the offset',
      near(S.wrap180(f.offset - 137), 0, 1), 'offset ' + f.offset.toFixed(2) + '° from ' + f.n + ' samples');
  f = S.compassFusion();
  for(let i = 0; i < 40; i++) f.feed({ alpha: 0, beta: 10, gamma: 0, heading: i % 2 ? 0.5 : 359.5, accuracy: 10, t: i*33 });
  chk('...averaged on the circle: readings either side of north average to north, not south',
      near(S.wrap180(f.offset), 0, 0.05), 'offset ' + f.offset.toFixed(3) + '°');

  /* The bands. Flat within 60°, or 60-85° of tilt where the top edge's and the
     camera's readings of the heading agree; everywhere else the estimate is
     held. The camera's azimuth is -(alpha) + 360 when gamma is 0. */
  const tilt = (beta, gamma, alpha) => {
    const g = S.compassFusion(), out = [];
    // a heading consistent with the top edge's azimuth in the magnetic frame, with offset 137
    const B = S.frame(alpha - 137, beta, gamma), top = S.azEl(B.y).az;
    for(let i = 0; i < 4; i++) out.push(g.feed({ alpha, beta, gamma, heading: top, accuracy: 10, t: i*33 }));
    return out[3];
  };
  const a75 = tilt(75, 0, 200), a75g = tilt(75, 20, 200), a100 = tilt(100, 0, 200), a45 = tilt(30, 45, 200);
  chk('...a sample tipped 75° with no roll is taken; with 20° of roll, or past upright, it is not',
      a75.accepted && !a75g.accepted && a75g.why === 'upright' && !a100.accepted && a100.why === 'upright',
      '75°: ' + (a75.why || 'taken') + ', 75° rolled 20°: ' + a75g.why + ', 100°: ' + a100.why);
  chk('...and a flat sample is taken whatever way round the phone is held on the table', a45.accepted,
      'rolled 45°: ' + (a45.why || 'taken'));
  /* The review's cases. "Within 60° of flat" is the screen's true tilt: a box
     of 60° on each angle let in beta 59, gamma 59, 75° from flat, where the
     top edge and the camera point 63° apart. And the tilted band runs to 85°:
     a guard on cos(beta) had cut it off at 78.5°. */
  const corner = tilt(59, 59, 200), b80 = tilt(80, 0, 200);
  chk('...the corner at beta 59°, gamma 59° is 75° from flat and is not taken as flat; beta 80° with no roll is taken',
      !corner.accepted && corner.why === 'upright' && b80.accepted, 'corner: ' + corner.why + ', 80°: ' + (b80.why || 'taken'));
  f = S.compassFusion();
  let tt2 = 0;
  for(let i = 0; i < 150; i++, tt2 += 33) f.feed(flat(tt2, 30));
  const settled = f.offset;
  for(let i = 0; i < 900; i++, tt2 += 33) f.feed({ alpha: 107, beta: 100, gamma: 0, heading: 200, accuracy: 10, t: tt2 });
  const lowered = f.feed(flat(tt2, 30)); tt2 += 33;          // refused: the phone is still turning down
  const first = f.feed(flat(tt2, 34)); tt2 += 33;            // the first one taken, and 4° out
  const after1 = f.offset;
  if(!(lowered.why === 'turning' && first.accepted)) console.log('        (sequence not as intended: ' + lowered.why + ', ' + first.why + ')');
  chk('...after half a minute held upright, one noisy flat sample does not take over the settled bearing',
      near(settled, 137, 1e-6) && Math.abs(S.wrap180(after1 - settled)) < 0.1, 'moved ' + S.wrap180(after1 - settled).toFixed(3) + '° by a 4° reading');
  f = S.compassFusion();
  tt2 = 0;
  for(let i = 0; i < 40; i++, tt2 += 33) f.feed(flat(tt2, 30));
  f.feed(flat(tt2, 60)); tt2 += 33;                                   // one spike
  for(let i = 0; i < 50; i++, tt2 += 33) f.feed(flat(tt2, 60, { accuracy: 40 }));   // 1.65 s of refused samples
  f.feed(flat(tt2, 60)); tt2 += 33;                                   // and another spike
  chk('...and two lone spikes 1.6 s apart, with refused samples between, are not 1.5 s of disagreement',
      near(f.offset, 137, 1e-6), 'offset ' + f.offset.toFixed(2) + '°');
  f = S.compassFusion();
  const u1 = feedAll(f, [0, 1, 2, 3].map(i => flat(i*33, 30, { accuracy: -1 })));
  const u2 = feedAll(S.compassFusion(), [0, 1, 2, 3].map(i => flat(i*33, 30, { accuracy: 40 })));
  chk('...an uncalibrated compass (accuracy −1) and a poor one (±40°) are refused, and the page is told since when',
      !u1[3].accepted && u1[3].why === 'uncalibrated' && f.uncalSince === 0 && !u2[3].accepted && u2[3].why === 'poor');
  f = S.compassFusion();
  const spin = [0, 1, 2, 3].map(i => f.feed({ alpha: 107 + i*40*0.033, beta: 10, gamma: 0, heading: 30, accuracy: 10, t: i*33 }));
  chk('...and so is a sample taken while the phone turns at 40°/s, when the compass lags the gyro',
      !spin[3].accepted && spin[3].why === 'turning');
  f = S.compassFusion();
  for(let i = 0; i < 40; i++) f.feed(flat(i*33, 30));
  let t = 40*33;
  for(; t < 40*33 + 1000; t += 33) f.feed(flat(t, 60));
  const held = f.offset;
  for(; t < 40*33 + 2100; t += 33) f.feed(flat(t, 60));
  chk('...a reading 30° off is ignored for a second, and believed once it has lasted 1.5 s',
      near(held, 137, 1e-6) && near(S.wrap180(f.offset - 167), 0, 1), 'after 1 s ' + held.toFixed(2) + '°, after 2.1 s ' + f.offset.toFixed(2) + '°');
  f = S.compassFusion();
  let lag = 0;
  for(let i = 0, tt = 0; i < 1800; i++, tt += 33){
    const drift = 0.5*tt/1000;                         // the gyro's zero walking at 0.5°/s
    f.feed({ alpha: 107 + drift, beta: 10, gamma: 0, heading: 30, accuracy: 10, t: tt });
    if(tt > 30000) lag = Math.max(lag, Math.abs(S.wrap180(f.offset - (137 + drift))));
  }
  chk('...a gyro zero drifting at 0.5°/s is followed within 3°', lag < 3, 'lag ' + lag.toFixed(2) + '°');
  f.reset();
  chk('...and reset() forgets it', f.offset === null && f.n === 0);
}

/* ---- the World Magnetic Model -------------------------------------------- */
/* The compass correction is only as good as the field it is taken from, so the
   model is checked against NOAA's own files before anything is drawn with it.
   The coefficients embedded in wmm.js must be verification/WMM.COF to the
   character, and every row of NOAA's WMM2025_TestValues.txt must come out,
   its columns read from its own "# Field n:" lines rather than assumed. D and
   I are printed to 0.01 deg and held to 0.006. The nT columns are printed to
   1e-6 nT: Y and Z agree to a few 1e-6 nT, but NOAA's X - and H and F through
   it - differs from an exact evaluation by up to 7e-4 nT, two parts in 10^8 of
   the north component alone, which is the generator's and not the model's, so
   they are held to 0.001 nT. */
function wmmChecks(){
  const root = ROOT, W = WMM;

  const cof = fs.readFileSync(path.join(root, 'verification', 'WMM.COF'), 'utf8').replace(/\r\n/g, '\n');
  chk('the coefficients embedded in wmm.js are verification/WMM.COF, character for character',
      W.coefficientText === cof, W.coefficientText.length + ' and ' + cof.length + ' characters');
  const rows = W.coefficients(), order = [];
  for (let n = 1; n <= 12; n++) for (let m = 0; m <= n; m++) order.push(n + ',' + m);
  chk('...and parse to the 90 rows of degree and order 12, in n, m order',
      rows.length === 90 && rows.every((r, i) => r.n + ',' + r.m === order[i]),
      rows.length + ' rows, ' + W.model + ', epoch ' + W.epoch.toFixed(1) + ', valid to ' + W.validTo.toFixed(1));

  /* The test file's columns, by the names and units it gives them. */
  const lines = fs.readFileSync(path.join(root, 'verification', 'WMM2025_TestValues.txt'), 'utf8').split(/\r?\n/);
  const named = {};
  lines.forEach(s => { const m = /^#\s*Field\s+(\d+)\s*:\s*(.+?)\s*$/.exec(s); if (m) named[m[2]] = +m[1] - 1; });
  const WANT = {
    year: /^decimal year$/i, h: /^(altitude|height)[^(]*\(km\)$/i,
    lat: /^geodetic latitude \(deg\)$/i, lon: /^geodetic longitude \(deg\)$/i,
    D: /^declination \(deg\)$/i, I: /^inclination \(deg\)$/i,
    H: /^H \(nT\)$/, X: /^X \(nT\)$/, Y: /^Y \(nT\)$/, Z: /^Z \(nT\)$/, F: /^F \(nT\)$/
  };
  const col = {}, missing = [];
  for (const k in WANT) {
    const hit = Object.keys(named).filter(name => WANT[k].test(name));
    if (hit.length === 1) col[k] = named[hit[0]]; else missing.push(k);
  }
  const data = lines.filter(s => s.trim() && !/^\s*#/.test(s)).map(s => s.trim().split(/\s+/));
  const width = Object.keys(named).length;
  chk('the test file\'s columns are identified from its own header lines',
      !missing.length && data.length === 100 && data.every(r => r.length === width),
      missing.length ? 'CANNOT IDENTIFY ' + missing.join(', ') + ' among ' + JSON.stringify(named)
                     : data.length + ' rows of ' + width + ' columns');
  if (missing.length) return;

  const TOL = {D: 0.006, I: 0.006, nT: 0.001};
  const worst = {D: {d: 0}, I: {d: 0}, nT: {d: 0}};
  let off = 0;
  for (const r of data) {
    const v = k => +r[col[k]];
    const f = W.field(v('lat'), v('lon'), v('h'), v('year'));
    const at = v('year').toFixed(1) + ', ' + v('h') + ' km, ' + v('lat') + ', ' + v('lon');
    let bad = false;
    for (const k of ['D', 'I', 'X', 'Y', 'Z', 'H', 'F']) {
      const d = Math.abs(f[k] - v(k)), w = k === 'D' || k === 'I' ? k : 'nT';
      if (d > worst[w].d) worst[w] = {d, at: at + (w === 'nT' ? ', ' + k : '')};
      if (d > TOL[w]) bad = true;
    }
    if (bad) off++;
  }
  chk('every row of NOAA\'s WMM2025_TestValues.txt: D and I within 0.006 deg, X Y Z H F within 0.001 nT',
      off === 0, off + ' of ' + data.length + ' rows off');
  console.log('        worst |dD| ' + worst.D.d.toFixed(6) + ' deg (' + worst.D.at + '), |dI| '
    + worst.I.d.toFixed(6) + ' deg (' + worst.I.at + '), nT ' + worst.nT.d.toExponential(1) + ' (' + worst.nT.at + ')');

  /* year, height km, lat, lon, D */
  const table = [[2025.0, 0, 80, 0, 1.28], [2025.0, 0, 0, 120, -0.16], [2025.0, 0, -80, 240, 68.78],
                 [2025.0, 100, 80, 0, 0.85], [2025.0, 100, 0, 120, -0.15], [2025.0, 100, -80, 240, 68.21],
                 [2027.5, 0, 80, 0, 2.59], [2027.5, 0, 0, 120, -0.24], [2027.5, 0, -80, 240, 68.49],
                 [2027.5, 100, 80, 0, 2.16], [2027.5, 100, 0, 120, -0.23], [2027.5, 100, -80, 240, 67.93]];
  const got = table.map(([y, h, la, lo, ref]) => ({ref, D: Math.round(W.declination(la, lo, h, y) * 100) / 100}));
  chk('the twelve declinations of NOAA\'s WMM2025_TEST_VALUES.txt, to the 0.01 deg given',
      got.every(g => Math.abs(g.D - g.ref) <= 0.005 + 1e-9),
      got.map(g => g.D.toFixed(2) + (Math.abs(g.D - g.ref) <= 0.005 + 1e-9 ? '' : ' (not ' + g.ref + ')')).join(', '));

  const T = 2026.74;
  console.log('        declination at ' + T + ', sea level: ' + [['Bangkok', 13.75, 100.52],
    ['New York', 40.7128, -74.0060], ['Seattle', 47.6062, -122.3321], ['Cape Town', -33.9249, 18.4241],
    ['London', 51.5074, -0.1278]].map(([n, la, lo]) => {
      const D = W.declination(la, lo, 0, T);
      return n + ' ' + (D >= 0 ? '+' : '') + D.toFixed(2);
    }).join(', '));
  const bkk = W.field(13.75, 100.52, 0, T);
  chk('Bangkok\'s horizontal field is strong enough to steer by: zone ok',
      bkk.zone === 'ok', 'H ' + bkk.H.toFixed(0) + ' nT, zone ' + bkk.zone);
  const now = W.field(13.75, 100.52, 0, T).expired, end = W.field(13.75, 100.52, 0, 2030.0).expired;
  chk('the model has not expired at ' + T + ' and has at 2030.0',
      now === false && end === true, 'expired ' + now + ' at ' + T + ', ' + end + ' at 2030.0');
  let low = {H: Infinity};
  for (let la = 80; la <= 90; la += 0.5) for (let lo = -180; lo < 180; lo += 0.5) {
    const f = W.field(la, lo, 0, T);
    if (f.H < low.H) low = {H: f.H, la, lo, zone: f.zone};
  }
  chk('the weakest horizontal field on a 0.5 deg grid north of 80 N is a blackout',
      low.zone === 'blackout', 'H ' + low.H.toFixed(0) + ' nT at ' + low.la + ' N, ' + low.lo + ' E, zone ' + low.zone);
}

/* ======================================================================
 * Part B - the page, in Chromium phone contexts
 * ==================================================================== */
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.jpg':'image/jpeg', '.png':'image/png', '.css':'text/css' };
function serve(){
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(SITE, rel);
      if(!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
        res.writeHead(404); return res.end('no');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
/* The instant every page starts at (the head of this file says why): the numeric baseline's own. Inside the model's life, or the
   declination checks would be about an expired model. */
const AT = process.env.GT_AR_AT ? Date.parse(process.env.GT_AR_AT) : Date.UTC(2026, 8, 13, 0, 0, 0);
if(!isFinite(AT) || AT < Date.UTC(2025, 0, 1) || AT >= Date.UTC(2030, 0, 1))
  throw new Error("GT_AR_AT must be an ISO instant inside the World Magnetic Model's life, 2025 to 2029: " + process.env.GT_AR_AT);
/* A clock that starts at AT and runs from there (or at `at`, for a page that has to open in the middle of a pass: radarEnds). Installed on the
   context, so it is in place before the page's own scripts and the mocks. */
const startClock = async (ctx, at) => { await ctx.clock.install({ time: at === undefined ? AT : at }); return ctx; };
/* A zone's offset from UTC at an instant, in hours, worked out here with Intl and not by the page. */
const zoneHours = (zone, ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms)).map(x => [x.type, +x.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms/1000)*1000)/3600000;
};
const BLOCK = [/celestrak\.org/, /ivanstanojevic/, /gibs\.earthdata/, /open-meteo/];

/* Everything the phone would supply, switchable from window.__ar so one page
   can run many cases. It is installed before the page's own scripts. */
function MOCKS(){
  const A = window.__ar = { motion: 'granted', camera: 'real', calls: [], streams: [], noCam: false, noOri: false,
    insecure: false, vis: 'visible', orient: 0, delayMs: 0, camW: 1440, camH: 1080, wake: { req: 0, rel: 0 },
    listeners: {} };
  const DOE = window.DeviceOrientationEvent;
  const rp = function(arg){
    A.calls.push({ what: 'motion', evt: window.event ? window.event.type : null, arg });
    if(A.motion === 'throw') throw new TypeError('requestPermission is not supported here');
    if(A.motion === 'reject')
      return Promise.reject(new DOMException('Requesting device orientation access requires a user gesture to prompt', 'NotAllowedError'));
    return Promise.resolve(A.motion);
  };
  Object.defineProperty(DOE, 'requestPermission', { configurable: true, get: () => A.motion === 'absent' ? undefined : rp });
  const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md);
  md.getUserMedia = function(c){
    A.calls.push({ what: 'camera', evt: window.event ? window.event.type : null });
    const mode = A.camera;
    let p;
    if(mode === 'real') p = gum(c);
    else if(mode === 'canvas'){
      const cv = document.createElement('canvas'); cv.width = A.camW; cv.height = A.camH;
      const g = cv.getContext('2d'), paint = () => { g.fillStyle = '#1b2a33'; g.fillRect(0, 0, cv.width, cv.height); };
      paint(); setInterval(paint, 100);
      p = Promise.resolve(cv.captureStream(10));
    } else if(mode === 'user'){
      p = gum(c).then(s => { const t = s.getVideoTracks()[0], gs = t.getSettings.bind(t);
        t.getSettings = () => Object.assign(gs(), { facingMode: 'user' }); return s; });
    } else p = Promise.reject(new DOMException('mocked', mode));
    p = p.then(s => { A.streams.push(s); return s; });
    if(A.delayMs){ const d = A.delayMs, inner = p; p = new Promise(r => setTimeout(r, d)).then(() => inner); }
    return p;
  };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => A.noCam ? undefined : md });
  Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, get: () => A.noOri ? undefined : DOE });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => !A.insecure });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => A.vis });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => A.vis === 'hidden' });
  Object.defineProperty(window, 'orientation', { configurable: true, get: () => A.orient });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
    request: () => { A.wake.req++; return Promise.resolve({ release(){ A.wake.rel++; return Promise.resolve(); } }); } } });
  /* A census of the listeners the view adds and removes on window and document. */
  const WATCH = ['deviceorientation', 'deviceorientationabsolute', 'visibilitychange', 'popstate', 'pagehide'];
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const key = (t, type) => (t === window ? 'window ' : 'document ') + type;
  EventTarget.prototype.addEventListener = function(type, fn, o){
    if(WATCH.includes(type) && (this === window || this === document)){
      const k = key(this, type); (A.listeners[k] = A.listeners[k] || new Set()).add(fn);
    }
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function(type, fn, o){
    if(WATCH.includes(type) && (this === window || this === document)){
      const k = key(this, type); if(A.listeners[k]) A.listeners[k].delete(fn);
    }
    return rem.call(this, type, fn, o);
  };
  A.census = () => Object.fromEntries(Object.entries(A.listeners).filter(([k, s]) => s.size).map(([k, s]) => [k, s.size]));
  /* The phone's pose that points the rear camera at (az, el) with the picture
     level, as the W3C angles - worked out here from scratch, not with SkyAR.
     D is added to alpha because the sensor's alpha is magnetic. */
  const R = Math.PI/180;
  window.__aimAt = (az, el, theta, D) => {
    const f = [Math.cos(el*R)*Math.sin(az*R), Math.cos(el*R)*Math.cos(az*R), Math.sin(el*R)];
    let u = [-f[2]*f[0], -f[2]*f[1], 1 - f[2]*f[2]];
    const m = Math.hypot(u[0], u[1], u[2]); u = u.map(x => x/m);
    const r = [f[1]*u[2] - f[2]*u[1], f[2]*u[0] - f[0]*u[2], f[0]*u[1] - f[1]*u[0]];
    const c = Math.cos((theta || 0)*R), s = Math.sin((theta || 0)*R);
    const x = r.map((ri, i) => c*ri + s*u[i]), y = r.map((ri, i) => -s*ri + c*u[i]), z = f.map(v => -v);
    let beta = Math.asin(Math.max(-1, Math.min(1, y[2])))/R, alpha = Math.atan2(-y[0], y[1])/R, gamma = Math.atan2(-x[2], z[2])/R;
    /* Exactly upright (aimed at the horizon, picture level) is gimbal lock:
       the top edge points at the zenith and says nothing of the azimuth, which
       is then all in the right edge, as alpha with gamma taken as 0. */
    if(Math.hypot(y[0], y[1]) < 1e-9){ gamma = 0; alpha = Math.atan2(x[1], x[0])/R; beta = y[2] > 0 ? 90 : -90; }
    if(gamma >= 90 || gamma < -90){ alpha += 180; beta = 180 - beta; gamma += gamma >= 90 ? -180 : 180; }
    if(beta >= 180) beta -= 360;
    return { a: (((alpha + (D || 0)) % 360) + 360) % 360, b: beta, g: gamma };
  };
  /* What the view must never do with the camera's picture: draw it, read it back, capture or record it. Noted when it is the video that is handed
     over, or the view's own canvas that is read, since that canvas has nothing on it but the sky. */
  A.pictures = [];
  const C2D = CanvasRenderingContext2D.prototype, CV = HTMLCanvasElement.prototype;
  const draw = C2D.drawImage, pixels = C2D.getImageData, dataURL = CV.toDataURL, blob = CV.toBlob, bitmap = window.createImageBitmap;
  C2D.drawImage = function(src){ if(src instanceof HTMLVideoElement) A.pictures.push('drawImage(video)'); return draw.apply(this, arguments); };
  C2D.getImageData = function(){ if(this.canvas.id === 'ar-sky') A.pictures.push('getImageData(ar-sky)'); return pixels.apply(this, arguments); };
  CV.toDataURL = function(){ if(this.id === 'ar-sky') A.pictures.push('toDataURL(ar-sky)'); return dataURL.apply(this, arguments); };
  CV.toBlob = function(){ if(this.id === 'ar-sky') A.pictures.push('toBlob(ar-sky)'); return blob.apply(this, arguments); };
  window.createImageBitmap = function(src){
    if(src instanceof HTMLVideoElement || (src && src.id === 'ar-sky')) A.pictures.push('createImageBitmap');
    return bitmap.apply(this, arguments);
  };
  if(window.ImageCapture){ const IC = window.ImageCapture; window.ImageCapture = class extends IC { constructor(t){ A.pictures.push('ImageCapture'); super(t); } }; }
  if(window.MediaRecorder){ const MR = window.MediaRecorder; window.MediaRecorder = class extends MR { constructor(s, o){ A.pictures.push('MediaRecorder'); super(s, o); } }; }
  /* The other usual ways, each only where this browser has it: the video as a WebGL texture, drawn or read through an OffscreenCanvas, made a
     VideoFrame, a callback for every frame it decodes, its track's frames as a stream. The view needs none of them (it lays the sky over the
     video and leaves the picture to the compositor), so any use of them here is a use of the picture. */
  for(const GL of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if(GL) for(const k of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D']){
    const f = GL.prototype[k];
    if(f) GL.prototype[k] = function(){ for(const a of arguments) if(a instanceof HTMLVideoElement){ A.pictures.push(k + '(video)'); break; } return f.apply(this, arguments); };
  }
  if(window.OffscreenCanvasRenderingContext2D){
    const O2D = OffscreenCanvasRenderingContext2D.prototype, offDraw = O2D.drawImage, offPixels = O2D.getImageData;
    O2D.drawImage = function(src){ if(src instanceof HTMLVideoElement) A.pictures.push('drawImage(video) on an OffscreenCanvas'); return offDraw.apply(this, arguments); };
    O2D.getImageData = function(){ A.pictures.push('getImageData on an OffscreenCanvas'); return offPixels.apply(this, arguments); };
  }
  if(window.OffscreenCanvas){
    const OC = OffscreenCanvas.prototype, offBlob = OC.convertToBlob, offBitmap = OC.transferToImageBitmap;
    OC.convertToBlob = function(){ A.pictures.push('convertToBlob on an OffscreenCanvas'); return offBlob.apply(this, arguments); };
    OC.transferToImageBitmap = function(){ A.pictures.push('transferToImageBitmap on an OffscreenCanvas'); return offBitmap.apply(this, arguments); };
  }
  const handOver = CV.transferControlToOffscreen;
  if(handOver) CV.transferControlToOffscreen = function(){ if(this.id === 'ar-sky') A.pictures.push('transferControlToOffscreen(ar-sky)'); return handOver.apply(this, arguments); };
  if(window.VideoFrame){ const VF = window.VideoFrame;
    window.VideoFrame = class extends VF { constructor(src, o){ if(src instanceof HTMLVideoElement || (src && src.id === 'ar-sky')) A.pictures.push('VideoFrame'); super(src, o); } }; }
  const frameCb = HTMLVideoElement.prototype.requestVideoFrameCallback;
  if(frameCb) HTMLVideoElement.prototype.requestVideoFrameCallback = function(){ A.pictures.push('requestVideoFrameCallback'); return frameCb.apply(this, arguments); };
  if(window.MediaStreamTrackProcessor){ const MP = window.MediaStreamTrackProcessor;
    window.MediaStreamTrackProcessor = class extends MP { constructor(o){ A.pictures.push('MediaStreamTrackProcessor'); super(o); } }; }
  /* The visible controls whose boxes cross an element's (its own children and parents do not count). */
  window.__over = el => {
    const r = el.getBoundingClientRect();
    return [...document.querySelectorAll('button, a[href], input, select, textarea, [role=tab], [role=button]')]
      .filter(e => e !== el && !el.contains(e) && !e.contains(el)).filter(e => {
        const q = e.getBoundingClientRect();
        return q.width && q.height && getComputedStyle(e).visibility !== 'hidden'
          && q.left < r.right - 0.5 && q.right > r.left + 0.5 && q.top < r.bottom - 0.5 && q.bottom > r.top + 0.5;
      }).map(e => e.id || String(e.className).split(' ')[0] || e.tagName);
  };
  /* A touch of the globe, to wake the scene. The rebuilt page lets a scene with nothing moving go quiet after two seconds, and a scene that is
     quiet looks just as it does with the view over it, so "it is not drawing" says something about a cover only of a scene that was woken a
     moment before. A pointer over the globe is one of the things that wakes it (the old page's scene never idles, and ignores this). It bubbles,
     since the page listens for it above the canvas. The wake lasts 2.5 s. */
  window.__wake = () => { const g = document.getElementById('globe'); if(g) g.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); };
  window.__feed = spec => {
    clearInterval(A.feedIv);
    if(!spec) return;
    const fire = () => {
      const e = new DOE(spec.type || 'deviceorientationabsolute',
        { alpha: spec.a, beta: spec.b, gamma: spec.g, absolute: spec.type !== 'deviceorientation' });
      if('h' in spec){
        Object.defineProperty(e, 'webkitCompassHeading', { value: typeof spec.h === 'function' ? spec.h() : spec.h });
        Object.defineProperty(e, 'webkitCompassAccuracy', { value: spec.acc });
      }
      window.dispatchEvent(e);
    };
    fire();
    A.feedIv = setInterval(fire, 33);
  };
}

async function phone(browser, port, extra, at){
  const ctx = await startClock(await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, permissions: ['camera'], timezoneId: 'Asia/Bangkok' }, extra || {})), at);
  await ctx.addInitScript(MOCKS);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for(const u of BLOCK) await page.route(u, r => r.abort());
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.__gt && window.__gt.D && window.ARView && window.Orbit3D && Orbit3D.ok(),
                             null, { timeout: 60000 });
  await H.showGlobe(page);                       // the rebuilt page keeps the globe on a tab beside the map; the old page shows it
  return { ctx, page, errs };
}
/* Pause the clock at the culmination of the window's highest pass: the
   spacecraft is then well up and holds still. */
const atBestPass = page => page.evaluate(() => {
  const P = __gt.D.passes;
  if(!P.length) return null;
  let k = 0; P.forEach((p, i) => { if(p.maxEl > P[k].maxEl) k = i; });
  document.querySelector('.passrow[data-i="' + k + '"]').click();
  return { k, maxEl: P[k].maxEl, name: __gt.D.entry.name };
});
const probe = page => page.evaluate(() => { const q = ARView.probe; delete q.stream; return q; });
/* Two frames first: a waitForFunction polled straight after an event is fed can
   read the pose from before the view loop has seen it, already settled. */
const frames2 = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = async page => { await frames2(page);
  return page.waitForFunction(() => { const q = ARView.probe; return q.view && q.lag !== null && q.lag < 0.005; },
                              null, { timeout: 10000 }).catch(() => null); };
async function tapAR(page){ await page.tap('#arbtn'); }
async function closeAR(page){ await page.evaluate(() => ARView.close()); await page.waitForTimeout(100); }
/* Waits on the state a check asserts rather than on a fixed time: a busy
   machine gives the page a frame or a timer late, and a check read after a
   fixed pause then reads the state before it has come about. Polled on a
   timer, not on frames, since frames are what a busy page is short of. It
   resolves with what the condition returned, or null once the time is up -
   the check then reads the state as it is and fails on it. */
const until = (page, fn, arg, ms) => page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: ms || 15000, polling: 50 })
  .then(h => h.jsonValue()).catch(() => null);
/* The camera's picture sets the lens, so a check that reads the lens needs it
   live; a loaded machine has taken more than 10 s to start the fake one. */
const camLive = page => until(page, () => ARView.probe.camera === 'live', null, 30000);
const aimSat = (page, theta, withD) => page.evaluate(([th, wd]) => {
  const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
  const a = __aimAt(st.az, st.el, th, wd ? (q.decl || 0) : 0);
  __feed(Object.assign({ type: 'deviceorientationabsolute' }, a));
  return st;
}, [theta || 0, withD !== false]);
/* The clock moved along pass k to where the spacecraft is nearest `el` degrees up (to the culmination, when it never gets so high), by the
   page's own slider. Over the zenith an azimuth offset shrinks by cos(elevation) and "40° to the left" is still on screen, so what a check asks
   of the pointer, or of the declination's sign, is asked on the way up the sky, where it can be told: on any day, whatever the highest pass
   of the window happens to be. Resolves once the view, if it is open, has had two frames to see the new time. */
const downTo = async (page, k, el) => {
  const at = await page.evaluate(([k, want]) => {
    const D = __gt.D, p = D.passes[k];
    let best = null;
    for(let t = p.t0ms; t <= p.t1ms; t += 5000){
      const d = Math.abs(__gt.stateAt(D.track, t).el - Math.min(want, p.maxEl));
      if(!best || d < best.d) best = { t, d };
    }
    const r = document.getElementById('time'); r.value = Math.round((best.t - D.start.getTime())/1000/D.step);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return { ms: best.t, el: __gt.stateAt(D.track, best.t).el };
  }, [k, el]);
  await frames2(page);
  return at;
};

async function partB(browser, port){
  console.log('\nPart B — the page, on a phone\n');
  const { ctx, page, errs } = await phone(browser, port);

  /* B1: offered, and not a camera mode. The old page put the button in the camera row, beside the group; the rebuilt page puts it in the
     row of the stage's tabs, top right of the stage, which is also there on the map and where there is no WebGL. */
  const offer = await page.evaluate(isNew => {
    const b = document.getElementById('arbtn'), r = b.getBoundingClientRect();
    const home = document.querySelector(isNew ? '.stage [role=tablist]' : '.camseg').getBoundingClientRect(), seg = document.querySelector('.camseg .seg');
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    const cams = [...document.querySelectorAll('.camseg .cam')], pov = cams[cams.length - 1];
    return { coarse: matchMedia('(pointer: coarse)').matches, shown: !b.hidden && getComputedStyle(b).display !== 'none',
             inside: r.left >= home.left - 0.5 && r.right <= home.right + 0.5 && r.top >= home.top - 0.5 && r.bottom <= home.bottom + 0.5,
             reach: !!hit && (hit === b || b.contains(hit)), over: __over(b),
             cams: cams.map(c => c.dataset.mode + '=' + c.getAttribute('aria-pressed')),
             povLast: pov.dataset.mode, povEnd: !pov.nextElementSibling, apart: !seg.contains(b),
             // the group's rounded end: the old page's last button carries it, the rebuilt page's group does
             endR: getComputedStyle(isNew ? seg : pov).borderTopRightRadius };
  }, NEW);
  chk('precondition: a touch-screen context matches (pointer: coarse)', offer.coarse);
  chk('the AR button is offered on a touch screen, inside ' + (NEW ? "the row of the stage's tabs" : 'the camera row') + ', clear of every other control, and a tap at its centre reaches it',
      offer.shown && offer.inside && offer.reach && !offer.over.length, offer.over.length ? 'under or over: ' + offer.over.join(', ') : '');
  chk("...beside the camera group rather than in it: still four camera modes, one pressed, POV the last of them and the group's end rounded",
      offer.cams.length === 4 && offer.cams.filter(s => /=true$/.test(s)).length === 1 && offer.povLast === 'pov' && offer.povEnd && offer.apart
      && offer.endR === END_R, offer.cams.join(' ') + ", the group's end radius " + offer.endR + ' (want ' + END_R + ')');
  /* The rebuilt page has the map on a tab beside the globe, and the button is in the row of the tabs, so it must be there with either showing
     (the old page shows both, and there is nothing to switch). */
  await H.showMap(page);
  const onMap = await page.evaluate(() => { const b = document.getElementById('arbtn'), r = b.getBoundingClientRect(),
    h = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return { shown: !b.hidden && r.width > 0, reach: !!h && (h === b || b.contains(h)) }; });
  await H.showGlobe(page);
  chk('...and it is still there, and in reach, with the map showing', onMap.shown && onMap.reach);

  /* B2: the narrowest phones, with a long site name. The old camera row had AR in it, 44 px more, and a long name pushed it off the globe; the
     rebuilt camera row spans the globe and the button is up in the tab row, so what is asked is that nothing is pushed off the screen, onto the
     trail row or under the button, and that nothing scrolls sideways. The name is written into the label's own text node, which the page
     keeps a reference to. The width is the one the screen was set to, not innerWidth: a phone's browser shrinks a page that is too wide to
     fit it, and innerWidth then grows to match, so a page 26 px too wide still has scrollWidth <= innerWidth. */
  await page.setViewportSize({ width: 360, height: 740 });
  const narrow = await page.evaluate(w => {
    const t0 = document.getElementById('lbl-camsite').firstChild, was = t0.nodeValue;
    t0.nodeValue = 'Wat Phra That Doi Suthep';                       // 24 characters
    const c = document.querySelector('.camseg').getBoundingClientRect(), t = document.querySelector('.trailseg').getBoundingClientRect();
    const b = document.getElementById('arbtn'), r = b.getBoundingClientRect();
    const out = { left: c.left, right: c.right, overlap: !(c.right <= t.left || c.left >= t.right || c.bottom <= t.top || c.top >= t.bottom),
                  arbOn: r.left >= 0 && r.right <= w && r.top >= 0 && r.bottom <= innerHeight, over: __over(b),
                  sw: document.documentElement.scrollWidth, w };
    t0.nodeValue = was;
    return out;
  }, 360);
  await page.setViewportSize({ width: 390, height: 844 });
  chk('...at 360 px with a 24-character site name the row stays on the globe, clear of the trail row and of the AR button, and nothing scrolls sideways',
      narrow.left >= 0 && narrow.right <= narrow.w && !narrow.overlap && narrow.arbOn && !narrow.over.length && narrow.sw <= narrow.w,
      'camera row ' + narrow.left.toFixed(1) + ' to ' + narrow.right.toFixed(1) + ' px, page ' + narrow.sw + ' px wide' + (narrow.over.length ? ', button crossed by ' + narrow.over.join(', ') : ''));

  /* B3: the tap, and what it asks for in what order. */
  const best = await atBestPass(page);
  chk('precondition: the window has a pass to aim at', !!best, best ? best.name + ', pass ' + best.k + ' at ' + best.maxEl.toFixed(1) + '°' : 'none');
  await page.evaluate(() => { window.__D0 = __gt.D; window.__pressed0 = [...document.querySelectorAll('.camseg .cam')].map(c => c.getAttribute('aria-pressed')).join(); window.__census0 = __ar.census(); });
  await tapAR(page);
  /* The phone is sending readings from the moment the view opens, as a real one does, and not once the camera is live (below): a slow camera -
     on a loaded machine more than the view's 3 s from the camera's answer to its first picture - had the view give up with "no reading" and stop
     the camera, and everything after it read a view that was not there (the pointer's projection came back null and the run died). The reading
     is the exact one, with the declination, so the view's first pose is the spacecraft's and nothing has to converge on it afterwards. */
  await aimSat(page, 0, true);
  const asked = await page.evaluate(() => { __wake();            // woken first, so that "not drawing" is the view's doing and not the scene's own quiet
    return { calls: __ar.calls.slice(), open: !document.getElementById('arview').hidden,
    arOpen: document.documentElement.classList.contains('ar-open'),
    inert: [...document.body.children].filter(e => e.id !== 'arview' && e.tagName !== 'SCRIPT').every(e => e.inert),
    focus: document.activeElement && document.activeElement.id, suspended: Orbit3D.suspended, state: ARView.state,
    msg: ARView.probe.message }; });
  chk('one tap asks for motion first and the camera second, both while the click is the current event',
      asked.calls.length === 2 && asked.calls[0].what === 'motion' && asked.calls[0].evt === 'click' && asked.calls[0].arg === true
      && asked.calls[1].what === 'camera' && asked.calls[1].evt === 'click',
      asked.calls.map(c => c.what + '(' + c.evt + (c.what === 'motion' ? ', ' + c.arg : '') + ')').join(' then '));
  chk('...the view opens over an inert page, focus on Close, with the globe no longer drawing',
      asked.open && asked.arOpen && asked.inert && asked.focus === 'ar-close' && asked.suspended,
      asked.state + ': "' + asked.msg + '"');
  const live = await page.evaluate(() => ({ disp: getComputedStyle(document.getElementById('ar-status')).display,
    desc: document.getElementById('arview').getAttribute('aria-describedby') }));
  chk('...its status line is a live region that stays in the page, and the dialog is described by it',
      live.disp !== 'none' && live.desc === 'ar-status', 'display ' + live.disp);
  await camLive(page);

  /* B4: aimed at the spacecraft. */
  const st = await aimSat(page, 0, true);
  await settle(page);
  const q = await probe(page);
  const aimed = await page.evaluate(() => {
    const q = ARView.probe, v = document.getElementById('ar-video'), R = Math.PI/180;
    const F = Math.max(q.W/v.videoWidth, q.H/v.videoHeight)*(Math.max(v.videoWidth, v.videoHeight)/2)/Math.tan(q.fov*R/2);
    // the page's own gnomonic projection, against one worked here
    const st = __gt.stateAt(__gt.D.track, q.ms), worst = [];
    const enu = (a, e) => [Math.cos(e*R)*Math.sin(a*R), Math.cos(e*R)*Math.cos(a*R), Math.sin(e*R)];
    const f = enu(st.az, st.el);
    let u = [-f[2]*f[0], -f[2]*f[1], 1 - f[2]*f[2]]; const m = Math.hypot(...u); u = u.map(x => x/m);
    const r = [f[1]*u[2] - f[2]*u[1], f[2]*u[0] - f[0]*u[2], f[0]*u[1] - f[1]*u[0]];
    const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    for(const [da, de] of [[5, 0], [-8, 3], [0, 12], [10, -6], [-3, -10]]){
      const s = enu(st.az + da, st.el + de), zc = dot(s, f);
      const x = q.cx + F*dot(s, r)/zc, y = q.cy - F*dot(s, u)/zc, p = ARView.project(st.az + da, st.el + de);
      worst.push(Math.hypot(p.x - x, p.y - y));
    }
    const ss = __gt.subsolar(new Date(q.ms)), sunEl = __gt.sunElevation(__gt.OBS, new Date(q.ms));
    const P = __gt.D.passes.find(p => p.t1ms >= q.ms);
    return { F, videoW: v.videoWidth, videoH: v.videoHeight, worst: Math.max(...worst), sunEl, ss,
             passT0: P ? P.t0ms : null, ticks: P ? SkyAR.ticks(P.t0ms, P.t1ms, __gt.tzAt(P.t0ms)).length : null };
  });
  chk('aimed at the spacecraft, its marker lands at the centre of the screen',
      q.marker && Math.hypot(q.marker.x - q.cx, q.marker.y - q.cy) < 1.5
      && near(S.wrap180(q.view.az - st.az), 0, 0.02) && near(q.view.el, st.el, 0.02),
      q.marker ? 'off by ' + Math.hypot(q.marker.x - q.cx, q.marker.y - q.cy).toExponential(1) + ' px, source ' + q.source + ', ' + q.state : 'no marker');
  chk('...with the lens worked out from the stream behind object-fit: cover, and projected as a pinhole camera',
      near(q.F, aimed.F, 1e-6) && aimed.worst < 0.5,
      'F ' + q.F.toFixed(1) + ' px for a ' + aimed.videoW + 'x' + aimed.videoH + ' stream; five directions within ' + aimed.worst.toExponential(1) + ' px');
  const sunVec = S.sunAzEl(13.75, 100.52, aimed.ss.lat, aimed.ss.lon);
  chk('...the Sun where the page\'s own sub-solar point puts it, at the elevation the page prints',
      q.sun && near(q.sun.az, sunVec.az, 1e-9) && near(q.sun.el, aimed.sunEl, 1e-9),
      q.sun ? 'az ' + q.sun.az.toFixed(2) + '°, el ' + q.sun.el.toFixed(2) + '° (page ' + aimed.sunEl.toFixed(2) + '°)' : 'no sun');
  chk('...and the pass drawn is the one the rail is on, with its ticks',
      q.pass && q.pass.t0ms === aimed.passT0 && q.pass.ticks === aimed.ticks && q.drawn.pass && q.drawn.craft,
      q.pass ? q.pass.ticks + ' ticks, as SkyAR.ticks gives ' + aimed.ticks : 'no pass');

  /* B5: what the readout says. */
  const read = await page.evaluate(() => { const o = {}; for(const k of ['view', 'north', 'decl', 'clock', 'target', 'pass', 'site', 'pos'])
    o[k] = document.getElementById('ar-' + k).textContent; o.title = document.getElementById('ar-title').textContent;
    o.live = !document.getElementById('ar-live').hidden; return o; });
  const dTxt = Math.abs(q.decl).toFixed(1) + '° ' + (q.decl < 0 ? 'W' : 'E');
  chk('the readout: whose sky, where north comes from, the declination applied, and that the clock is not now',
      read.title === 'Sky over Bangkok' && read.pos === '13.75° N 100.52° E' && /^the compass, magnetic · accuracy not reported/.test(read.north)
      && read.decl === dTxt + ', applied' && /^sim time/.test(read.clock) && read.live && read.target.startsWith(best.name + ' · '),
      JSON.stringify(read));

  /* B6: the pointer, when the spacecraft is out of frame. */
  const off = async (da, de) => {
    await page.evaluate(([da, de]) => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
      __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(st.az + da, st.el + de, 0, q.decl || 0))); }, [da, de]);
    await settle(page);
    /* The readout is written four times a second and the pointer is drawn every frame, so a read straight after the view has settled can be of the
       readout from before it did. It is read once it ends with what is drawn; if it never does, within the wait, it is read as it is and the check
       fails on it. */
    await until(page, () => { const p = ARView.probe.pointer; return !p || document.getElementById('ar-target').textContent.endsWith(p.text); }, null, 3000);
    return page.evaluate(() => ({ q: (() => { const q = ARView.probe; delete q.stream; return q; })(),
      target: document.getElementById('ar-target').textContent }));
  };
  const up = await downTo(page, best.k, 35);               // not the zenith: see downTo
  const o1 = await off(-40, 0), o2 = await off(-30, -12);
  chk('out of frame to the right: an arrow on the right edge and "turn right 40°"',
      o1.q.pointer && o1.q.pointer.text === 'turn right 40°' && o1.q.pointer.x > o1.q.cx && !o1.q.marker.on,
      (o1.q.pointer ? '"' + o1.q.pointer.text + '" at x ' + o1.q.pointer.x.toFixed(0) : 'no pointer') + ', spacecraft ' + up.el.toFixed(0) + '° up');
  chk('...and above and to the right: "turn right 30° · up 12°", in the readout as well',
      o2.q.pointer && o2.q.pointer.text === 'turn right 30° · up 12°' && o2.q.pointer.x > o2.q.cx && o2.q.pointer.y < o2.q.cy
      && o2.target.endsWith('turn right 30° · up 12°'), o2.q.pointer ? '"' + o2.q.pointer.text + '"' : 'no pointer');
  /* Five minutes before another pass: the spacecraft is down, so the pointer aims at where it will rise. The next one if the window has it,
     else one that came before; a window with no other pass cannot show this, and that is said and fails rather than passes unseen. */
  const pre = await page.evaluate(() => {
    const D = __gt.D, P = D.passes, q = ARView.probe;
    let k = P.findIndex(p => p.t0ms > q.ms + 10*60000);
    if(k < 0) k = P.findIndex(p => p.t1ms < q.ms - 10*60000 && p.t0ms - 5*60000 >= D.start.getTime());
    if(k < 0) return null;
    const t = P[k].t0ms - 5*60000, idx = Math.round((t - D.start.getTime())/1000/D.step);
    const r = document.getElementById('time'); r.value = idx; r.dispatchEvent(new Event('input', { bubbles: true }));
    return { k, t0: P[k].t0ms };
  });
  if(pre){
    await page.waitForTimeout(300);
    await page.evaluate(() => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
      __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(S0 = (st.az + 180) % 360, 20, 0, q.decl || 0))); });
    await settle(page);
    const pq = await probe(page);
    chk('before a pass, the pointer aims at where the spacecraft will rise, and says when',
        pq.aim === 'aos' && pq.pointer && / rises here at \d\d:\d\d, in \d\d:\d\d:\d\d$/.test(pq.pointer.title),
        pq.pointer ? '"' + pq.pointer.title + (pq.pointer.text ? ' · ' + pq.pointer.text : '') + '"' : 'aim ' + pq.aim);
  } else chk('before a pass, the pointer aims at where the spacecraft will rise (the window has another pass to aim at)', false, 'no second pass in this window');

  /* B7: Go live, and staying live. */
  await page.click('#ar-live');
  /* The clock line is the readout's, written four times a second; the rest is
     read at the moment it says live, not after a pause in which a starved
     transport lets the clock slip behind again. */
  await page.evaluate(() => { window.__liveNow = () => ({ clock: document.getElementById('ar-clock').textContent,
    play: document.getElementById('tpplay').getAttribute('aria-label'), rate: document.getElementById('tpratev').textContent,
    d: Math.abs(ARView.probe.ms - Date.now()), follow: ARView.probe.follow, live: !document.getElementById('ar-live').hidden }); });
  const lv = await until(page, () => { const s = __liveNow(); return /^live · /.test(s.clock) && !s.live ? s : false; }, null, 5000)
          || await page.evaluate(() => __liveNow());
  chk('Go live: real time, playing, the clock on the present, and the button gone',
      /^live · /.test(lv.clock) && lv.play === 'Pause' && lv.rate === '1.0×' && lv.d < 1000 && lv.follow && !lv.live,
      lv.clock + ' | off by ' + lv.d.toFixed(0) + ' ms');
  await page.evaluate(() => { document.getElementById('tpplay').click(); });
  await page.waitForTimeout(1500);
  const stalled = await page.evaluate(() => { document.getElementById('tpplay').click(); return Math.abs(ARView.probe.ms - Date.now()); });
  /* The view resyncs once the clock is more than a second out, which the
     stall has made it; how close it then stays depends on how often a busy
     browser gives the page a frame and a timer, since the transport caps a
     frame at 0.25 s, so what is asked is that it comes back inside the resync's
     own second, and within 3 s. Between two resyncs a starved page can fall
     most of a second behind again, and a second read after the wait could land
     there: the offset is the one seen when the condition held. */
  const back = await until(page, () => { const d = Math.abs(ARView.probe.ms - Date.now()); return d < 1000 ? { d } : false; }, null, 3000);
  const re = back ? back.d : await page.evaluate(() => Math.abs(ARView.probe.ms - Date.now()));
  const reS = await page.evaluate(() => ({ play: document.getElementById('tpplay').getAttribute('aria-label'),
    rate: document.getElementById('tpratev').textContent, follow: ARView.probe.follow }));
  chk('...and after a 1.5 s stall of the page\'s clock, back within the second it is allowed', stalled >= 1000 && re < 1000,
      'stalled ' + stalled.toFixed(0) + ' ms behind, then off by ' + re.toFixed(0) + ' ms ' + JSON.stringify(reS));

  /* B8: the globe stops drawing while covered. */
  /* Counted in the page's frames, not in milliseconds: a busy page can go
     600 ms without one, which proved nothing while open and failed the resume
     once closed. Open, 20 frames must pass with nothing drawn; closed, both
     must come back, and within 20 frames. */
  const draws = await page.evaluate(async () => {
    const r = Orbit3D.renderer, render = r.render.bind(r), set = OrbitViz.setTime;
    let n = 0, m = 0; r.render = (...a) => { n++; return render(...a); }; OrbitViz.setTime = d => { m++; return set(d); };
    const frames = (k, stop) => new Promise(res => { let f = 0; const t0 = performance.now();
      const step = () => { f++; if(f >= k || (stop && stop()) || performance.now() - t0 > 20000) res(f); else requestAnimationFrame(step); };
      requestAnimationFrame(step); });
    const fOpen = await frames(20);
    const open = [n, m]; ARView.close();
    n = m = 0;
    const fAfter = await frames(20, () => n > 0 && m > 0);
    const after = [n, m]; r.render = render; OrbitViz.setTime = set;
    return { open, after, fOpen, fAfter };
  });
  chk('under the view the globe draws nothing and its labels are not laid out; closed, both resume',
      draws.fOpen >= 20 && draws.open[0] === 0 && draws.open[1] === 0 && draws.after[0] > 0 && draws.after[1] > 0,
      'open ' + draws.open.join('/') + ' render/setTime calls in ' + draws.fOpen + ' frames, after ' + draws.after.join('/') +
      ' in the first ' + draws.fAfter);
  /* The same with the clock stopped. The rebuilt page lets a scene with nothing moving go quiet after two seconds, and the view going away
     has to bring it back whatever the clock is doing, or the globe is left as the view found it. Open longer than that quiet, so the page's
     own policy would have the scene off by then, and the view's closing is what has to turn it on. What this reads is therefore the same off
     whether the view has covered the globe or not, until the scene is woken: so it is woken once, right after the tap, and must stay off (the
     cover), and then left alone for longer than a wake lasts (2.5 s), so that closing is the only thing there is to bring it back. */
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await tapAR(page);
  const woken = await page.evaluate(() => { __wake(); return Orbit3D.suspended; });
  await page.waitForTimeout(3000);
  /* The rebuilt page has keys for the clock (Space plays, the arrows step it, [ and ] change its rate), which the old page did not: with the
     view over everything, on a tablet with a keyboard, none of them may reach it. Focus is taken off Close first, since a key a focused button
     has a meaning for is left to it anyway. */
  const k0 = await page.evaluate(() => { document.activeElement && document.activeElement.blur();
    return { ms: ARView.probe.ms, play: document.getElementById('tpplay').getAttribute('aria-label'), rate: document.getElementById('tpratev').textContent }; });
  for(const key of ['Space', 'ArrowRight', 'ArrowLeft', 'BracketRight']) await page.keyboard.press(key);
  await frames2(page);
  const k1 = await page.evaluate(() => ({ ms: ARView.probe.ms, play: document.getElementById('tpplay').getAttribute('aria-label'), rate: document.getElementById('tpratev').textContent }));
  chk('...and while it is open the page\'s keys do nothing to the clock: Space, the arrows and ] leave it stopped, where it was, at the rate it had',
      k1.play === k0.play && k1.rate === k0.rate && k1.ms === k0.ms, 'before ' + k0.play + ' ' + k0.rate + ', after ' + k1.play + ' ' + k1.rate + ', moved ' + (k1.ms - k0.ms) + ' ms');
  const still = await page.evaluate(async () => {
    const r = Orbit3D.renderer, render = r.render.bind(r);
    let n = 0; r.render = (...a) => { n++; return render(...a); };
    const held = Orbit3D.suspended, paused = document.getElementById('tpplay').getAttribute('aria-label') === 'Play';
    ARView.close();
    let f = 0;
    await new Promise(res => { const t0 = performance.now(), step = () => { f++; if(n > 0 || f >= 20 || performance.now() - t0 > 20000) res(); else requestAnimationFrame(step); }; requestAnimationFrame(step); });
    const out = { held, paused, n, f, suspended: Orbit3D.suspended };
    r.render = render;
    return out;
  });
  chk('...and with the clock stopped, closing it still brings the globe back: it draws again at once',
      still.paused && woken && still.held && still.n > 0 && !still.suspended,
      'clock ' + (still.paused ? 'stopped' : 'running') + ', scene ' + (woken ? 'off' : 'on') + ' under the view when woken, ' + (still.held ? 'off' : 'on') + ' after the quiet, ' + still.n + ' render calls in the first ' + still.f + ' frames after');
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Play') b.click(); });

  /* B9: a device with no compass, and the hand turn. */
  await page.evaluate(() => { __ar.calls.length = 0; __feed(null); });
  await tapAR(page);
  /* Aimed along the horizon, where turning about the vertical moves the sky
     straight across the screen; higher up the drag's 1/cos(el) is capped. */
  const relAz = await page.evaluate(() => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
    __feed(Object.assign({ type: 'deviceorientation' }, __aimAt(st.az, 0, 0, 0))); return st.az; });
  await page.waitForFunction(() => ARView.probe.source === 'rel', null, { timeout: 5000 }).catch(() => null);
  await settle(page);
  // the readout writes the status four times a second
  await until(page, () => /not tied to north/.test(ARView.probe.message), null, 5000);
  const r0 = await probe(page);
  const x0 = (await page.evaluate(az => ARView.project(az, 0), relAz)).x;
  const box = await page.locator('#ar-sky').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 420); await page.mouse.down();
  for(let i = 1; i <= 10; i++) await page.mouse.move(box.x + 100 + i*10, box.y + 420);
  await page.mouse.up();
  await settle(page);
  const r1 = await probe(page);
  const x1 = (await page.evaluate(az => ARView.project(az, 0), relAz)).x;
  const relTxt = await page.evaluate(() => ({ decl: document.getElementById('ar-decl').textContent, north: document.getElementById('ar-north').textContent }));
  const wantTrim = -(100/r0.F)*DEG/Math.max(Math.cos(r0.view.el*RAD), 0.3);
  chk('no compass: the view turns with the phone, says it is not tied to north, and applies no declination',
      r0.source === 'rel' && /not tied to north/.test(r0.message) && /not applied/.test(relTxt.decl), r0.message.slice(0, 60) + '…');
  chk('...a 100 px drag turns the sky 100 px, and the north line says by how much',
      near(r1.trim, wantTrim, 0.05) && near(x1 - x0, 100, 3) && /turned [+−]\d+\.\d° by hand/.test(relTxt.north),
      'trim ' + r1.trim.toFixed(2) + '°, a point on the horizon moved ' + (x1 - x0).toFixed(1) + ' px');
  await page.evaluate(() => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
    __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(st.az, st.el, 0, q.decl || 0))); });
  await page.waitForFunction(() => ARView.probe.source === 'abs', null, { timeout: 3000 }).catch(() => null);
  await frames2(page);
  const r2 = await probe(page);
  chk('...and when a compass comes in it takes over and the hand turn is cleared',
      r2.source === 'abs' && r2.trim === 0 && /compass came in/.test(r2.message), r2.source + ', trim ' + r2.trim);

  /* B10: the Align panel and the lens. */
  await page.click('#ar-alignbtn');
  await page.click('#ar-right');
  const t1 = (await probe(page)).trim;
  await page.evaluate(() => { const i = document.getElementById('ar-fov'); i.value = '60'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await frames2(page);                                   // the lens is applied in the next frame
  const l1 = await page.evaluate(() => { const q = ARView.probe, v = document.getElementById('ar-video');
    return { fov: q.fov, F: q.F, want: SkyAR.focal(q.W, q.H, v.videoWidth, v.videoHeight, 60), stored: localStorage.getItem('gt.arlens') }; });
  await closeAR(page); await tapAR(page); await page.waitForTimeout(200);
  const l2 = (await probe(page)).fov;
  await page.click('#ar-alignbtn'); await page.click('#ar-fov0');
  const l3 = (await probe(page)).fov;
  chk('Align: "1° ▸" turns the sky a degree right; the lens slider sets the lens, and it is kept for next time',
      t1 === -1 && l1.fov === 60 && near(l1.F, l1.want, 1e-6) && l1.stored === '60' && l2 === 60 && l3 === 68,
      'trim ' + t1 + ', lens 60° gives F ' + l1.F.toFixed(1) + ' px, reopened at ' + l2 + '°, reset to ' + l3 + '°');
  await closeAR(page);

  /* B11: held sideways. */
  for(const th of [90, 270]){
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(t => { __ar.orient = t === 270 ? -90 : 90; __ar.camera = 'canvas'; __ar.camW = 1440; __ar.camH = 1080; }, th);
    const aimLand = t => page.evaluate(t => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
      __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(st.az, 0, t, q.decl || 0))); return st; }, t);
    /* Fed before the tap, for this way of holding it, and not left from the last one. The reading left running from before (the other way up's)
       is a half turn out from this one, and the view, which settles its picture's roll by a smoothing that has nothing to turn a half turn by,
       showed east on the left for a third of a second after the right reading came, and "east to the right" failed now and then (one run in
       three, measured). A phone sends the reading for the way it is held, from the moment the view opens (see B3), so it is the first one the
       view gets, and the one it is checked against. */
    const sLand = await aimLand(th);
    await tapAR(page);
    await camLive(page);
    await settle(page);
    const lq = await probe(page);
    const lev = await page.evaluate(az => [ARView.project(az - 10, 0), ARView.project(az + 10, 0)], sLand.az);
    const want = S.focal(390, 844, 1080, 1440, 68);
    /* Held sideways the readout is a column, and the first version of it was
       half the screen wide: it covered the middle, where the spacecraft is
       when the phone is on it. The middle, and 40 px round it, must be clear. */
    const cov = await page.evaluate(() => { const q = ARView.probe, r = document.querySelector('.ar-read').getBoundingClientRect();
      return { right: r.right, top: r.top, cx: q.cx, cy: q.cy, clear: r.right <= q.cx - 40 || r.top >= q.cy + 40 }; });
    chk('...and the readout, a column down the side, leaves the middle of the sky clear', cov.clear,
        'readout ends ' + (cov.cx - cov.right).toFixed(0) + ' px left of the centre');
    /* Align, opened in that column, used to make it taller than the screen: its
       own button, and Use my location, went off the top. */
    await page.click('#ar-alignbtn');
    await frames2(page);
    const al = await page.evaluate(() => {
      const hit = id => { const b = document.getElementById(id), r = b.getBoundingClientRect();
        const h = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
        return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && !!h && (h === b || b.contains(h)); };
      return { read: document.querySelector('.ar-read').getBoundingClientRect().top,
               ok: ['ar-alignbtn', 'ar-here', 'ar-close', 'ar-left', 'ar-right', 'ar-fov', 'ar-fov0'].filter(id => !hit(id)) };
    });
    chk('...with Align open, every control is on the screen and in reach', al.read >= 0 && !al.ok.length,
        'readout top ' + al.read.toFixed(0) + ' px' + (al.ok.length ? '; out of reach: ' + al.ok.join(', ') : ''));
    await page.click('#ar-alignbtn');
    chk('held sideways (θ ' + th + '), the view is centred, the horizon level and east to the right',
        lq.theta === th && near(S.wrap180(lq.view.az - sLand.az), 0, 0.02) && near(lq.view.el, 0, 0.02)
        && Math.abs(lev[0].y - lev[1].y) < 0.5 && lev[1].x > lev[0].x && near(lq.F, want, 0.5),
        'θ ' + lq.theta + ', view ' + lq.view.az.toFixed(2) + '/' + lq.view.el.toFixed(2) + ' for ' + sLand.az.toFixed(2) + '/0, horizon Δy ' +
        Math.abs(lev[0].y - lev[1].y).toExponential(1) + ' px, F ' + lq.F.toFixed(1) + ' px (portrait ' + want.toFixed(1) + ')');
    await closeAR(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { __ar.orient = 0; __ar.camera = 'real'; });

  /* B12: every way of closing leaves nothing behind. */
  const homes = [];
  for(const how of ['Close', 'Escape', 'Back']){
    await page.evaluate(() => { __ar.streams.length = 0; });
    const entry0 = await page.evaluate(() => navigation.currentEntry.index);
    await tapAR(page);
    await camLive(page);
    await aimSat(page, 0, true);
    await page.waitForTimeout(200);
    if(how === 'Close') await page.click('#ar-close');
    else if(how === 'Escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => history.back());
    await page.waitForTimeout(300);
    // Back closes the view from popstate, and the history entry goes with Close and Escape a task later
    await until(page, () => ARView.state === 'closed' && !(history.state && history.state.ar), null, 5000);
    // the page is on the history entry it opened from (history.length would not say: the entry the view pushed stays ahead of it after a Back)
    homes.push({ how, past: ((await until(page, e => navigation.currentEntry.index === e ? { here: true } : false, entry0, 5000))
      ? 0 : (await page.evaluate(e => navigation.currentEntry.index - e, entry0))) });
    const c = await page.evaluate(() => ({ state: ARView.state, hidden: document.getElementById('arview').hidden,
      ended: __ar.streams.length > 0 && __ar.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')),
      src: document.getElementById('ar-video').srcObject, census: JSON.stringify(__ar.census()), census0: JSON.stringify(__census0),
      inert: [...document.body.children].some(e => e.inert), arOpen: document.documentElement.classList.contains('ar-open'),
      focus: document.activeElement && document.activeElement.id, suspended: Orbit3D.suspended,
      pressed: [...document.querySelectorAll('.camseg .cam')].map(c => c.getAttribute('aria-pressed')).join() === __pressed0,
      sameD: __gt.D === __D0 || true, arState: history.state && history.state.ar, frames: ARView.probe.frames }));
    await page.waitForTimeout(200);
    const frames2 = await page.evaluate(() => ARView.probe.frames);
    chk('closed with ' + how + ': camera stopped, listeners removed, page live again, globe drawing, focus back on AR',
        c.state === 'closed' && c.hidden && c.ended && c.src === null && c.census === c.census0 && !c.inert && !c.arOpen
        && c.focus === 'arbtn' && !c.suspended && c.pressed && !c.arState && frames2 === c.frames,
        'listeners ' + c.census);
  }
  chk('...and the view leaves no history entry of its own behind: after Close, Escape and Back the page is on the entry it opened from',
      homes.length === 3 && homes.every(h => h.past === 0), homes.map(h => h.how + ' ' + (h.past ? '+' + h.past + ' entries' : 'back where it began')).join(', '));
  await page.evaluate(() => __feed(null));

  /* B13: a camera that answers after Close. */
  await page.evaluate(() => { __ar.streams.length = 0; __ar.delayMs = 800; });
  await tapAR(page);
  await page.waitForTimeout(100);
  await page.click('#ar-close');
  await page.waitForTimeout(1200);
  // the fake camera itself can take longer than the 800 ms delay on a busy machine
  await until(page, () => __ar.streams.length > 0 && __ar.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')), null, 15000);
  const late =await page.evaluate(() => ({ n: __ar.streams.length, ended: __ar.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }));
  await page.evaluate(() => { __ar.delayMs = 0; });
  chk('a camera that answers after Close is stopped at once, so the light never stays on', late.n === 1 && late.ended,
      late.n + ' late stream, ended ' + late.ended);

  /* B14: every refusal, in words. */
  /* wait: a fixed time, or the state the check asserts, waited for; the time
     from before the tap to when it came is kept as r.ms. */
  const refuse = async (cfg, events, wait) => {
    await page.evaluate(c => { __ar.calls.length = 0; __ar.streams.length = 0; Object.assign(__ar, c); }, cfg);
    const t0 = Date.now();
    await tapAR(page);
    if(events) await page.evaluate(e => {
      const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms), a = __aimAt(st.az, st.el, 0, q.decl || 0);
      __feed(e === 'tilt' ? { type: 'deviceorientation', a: null, b: 20, g: 5 } : Object.assign({ type: 'deviceorientationabsolute' }, a));
    }, events);
    if(typeof wait === 'function') await until(page, wait, null, 15000);
    else await page.waitForTimeout(wait || 500);
    const ms = Date.now() - t0;
    const r = await page.evaluate(() => ({ q: (() => { const q = ARView.probe; delete q.stream; return q; })(),
      cls: document.getElementById('ar-status').className, calls: __ar.calls.map(c => c.what + ':' + c.evt),
      retry: !document.getElementById('ar-retry').hidden, retryText: document.getElementById('ar-retry').textContent,
      ended: __ar.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }));
    r.ms = ms;
    return r;
  };
  const reset = () => page.evaluate(() => { __feed(null); ARView.close();
    Object.assign(__ar, { motion: 'granted', camera: 'real', noCam: false, noOri: false, insecure: false, delayMs: 0 }); });

  let r = await refuse({ insecure: true });
  chk('refused: a page that is not secure asks for nothing and says to open the https page',
      r.q.state === 'failed' && r.calls.length === 0 && /opened over http:\/\/ — /.test(r.q.message) && r.cls === 'ar-status', r.q.message.slice(0, 70) + '…');
  await reset();
  r = await refuse({ noOri: true });
  chk('...a browser with no motion sensors for pages says so, and asks for nothing',
      r.q.state === 'failed' && r.calls.length === 0 && r.q.message === 'This browser gives pages no motion sensors, so the view cannot follow the phone.');
  await reset();
  r = await refuse({ motion: 'denied' });
  chk('...motion declined: says how to undo it on an iPhone and elsewhere, stops the camera, and offers Try again',
      r.q.state === 'failed' && /^Motion and orientation access was declined/.test(r.q.message) && /closed and reopened/.test(r.q.message)
      && r.retry && r.retryText === 'Try again' && r.ended, r.calls.join(' '));
  /* Try again while motion is still refused, then once it is allowed. The
     camera that answered the refused attempt was stopped, and a stale camera
     state then kept the allowed attempt from asking for it at all: the view ran
     on black with nothing said. */
  await page.tap('#ar-retry');
  await page.waitForTimeout(600);
  await page.evaluate(() => { __ar.motion = 'granted'; __ar.calls.length = 0; });
  await page.tap('#ar-retry');
  await camLive(page);
  const rc = await page.evaluate(() => ({ calls: __ar.calls.map(c => c.what + ':' + c.evt), cam: ARView.probe.camera, state: ARView.state }));
  chk('...Try again, refused once more and then allowed, asks for the camera again and gets it',
      rc.calls.includes('motion:click') && rc.calls.includes('camera:click') && rc.cam === 'live',
      rc.calls.join(' ') + ' → camera ' + rc.cam + ', ' + rc.state);
  await reset();
  r = await refuse({ motion: 'reject' });
  await page.evaluate(() => { __ar.motion = 'granted'; __ar.calls.length = 0; });
  await page.tap('#ar-retry');
  await page.waitForTimeout(300);
  const again = await page.evaluate(() => __ar.calls.map(c => c.what + ':' + c.evt));
  chk('...a lost gesture: "Allow motion sensors", and tapping it asks again inside that tap',
      r.q.reason === 'motion-tap' && r.retryText === 'Allow motion sensors' && again[0] === 'motion:click',
      r.q.message.slice(0, 60) + '… then ' + again.join(' '));
  await reset();
  r = await refuse({ motion: 'throw' });
  chk('...a request that throws is named', r.q.state === 'failed' && /\(TypeError\)/.test(r.q.message), r.q.message);
  await reset();
  r = await refuse({ motion: 'absent' }, 'aim', () => ARView.state === 'running');
  chk('...a browser with nothing to ask (Firefox, Samsung Internet) asks only for the camera, and the view runs',
      r.calls[0] === 'camera:click' && r.calls.length === 1 && r.q.state === 'running', r.calls.join(' ') + ', ' + r.q.state);
  await reset();
  r = await refuse({ camera: 'NotAllowedError' }, 'aim', () => { const q = ARView.probe;
    return q.state === 'running' && /^Camera access was declined/.test(q.message) && q.marker && q.marker.on && !document.getElementById('ar-retry').hidden; });
  await page.evaluate(() => { __ar.camera = 'real'; __ar.calls.length = 0; });
  await page.tap('#ar-retry');
  await camLive(page);
  const camAgain = await page.evaluate(() => ({ calls: __ar.calls.map(c => c.what + ':' + c.evt), cam: ARView.probe.camera }));
  chk('camera declined: the sky is drawn on black, the spacecraft still marked, and Try again asks inside its own tap',
      r.q.state === 'running' && /^Camera access was declined — the sky is drawn on black instead/.test(r.q.message) && r.q.marker && r.q.marker.on
      && r.retry && camAgain.calls[0] === 'camera:click' && camAgain.cam === 'live', camAgain.calls.join(' ') + ' → ' + camAgain.cam);
  await reset();
  r = await refuse({ camera: 'NotFoundError' }, 'aim', () => /^No camera on the back/.test(ARView.probe.message));
  chk('...no rear camera: said, and nothing to try again', r.q.message === 'No camera on the back of this device — the sky is drawn on black instead.' && !r.retry);
  await reset();
  r = await refuse({ camera: 'NotReadableError' }, 'aim', () => /^The camera is in use/.test(ARView.probe.message) && !document.getElementById('ar-retry').hidden);
  chk('...a camera in use elsewhere: said, with Try again', /^The camera is in use by another app/.test(r.q.message) && r.retry);
  await reset();
  r = await refuse({ camera: 'user' }, 'aim', () => ARView.probe.camera === 'front' && /^The only camera offered faces you/.test(ARView.probe.message)
    && __ar.streams.length > 0 && __ar.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  chk('...only a front camera: stopped at once, since the sky drawn is the one behind the phone',
      /^The only camera offered faces you/.test(r.q.message) && r.ended && r.q.camera === 'front', r.q.camera);
  await reset();
  r = await refuse({ noCam: true }, 'aim', () => /^This browser gives pages no camera/.test(ARView.probe.message));
  chk('...no camera for pages at all', r.q.message === 'This browser gives pages no camera — the sky is drawn on black instead.');
  await reset();
  /* The 3 s run from when both prompts are answered, which on a busy machine
     the camera can take a second over, so the failure is waited for - and must
     not have come before 3 s had passed since the tap. */
  r = await refuse({}, null, () => ARView.state === 'failed');
  chk('no reading in 3 s after the prompts: said, with the camera stopped',
      r.q.state === 'failed' && (r.q.reason === 'no-sensor' || r.q.reason === 'no-reading') && r.ended && r.ms >= 3000,
      r.q.reason + ' after ' + r.ms + ' ms: "' + r.q.message.slice(0, 50) + '…"');
  await reset();
  r = await refuse({}, 'tilt', () => ARView.state === 'failed');
  chk('...a device that reports its tilt but not which way it faces', r.q.reason === 'tilt' && r.ms >= 3000
      && r.q.message === 'This device reports its tilt but not which way it faces, so the view cannot follow it round.');
  await reset();

  /* B15: inside the view, the page's own rules. */
  await tapAR(page);
  await aimSat(page, 0, true);
  await page.waitForTimeout(300);
  await page.click('#ar-alignbtn');
  const rules = await page.evaluate(screenW => {
    const small = [], root = document.getElementById('arview');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for(let n = w.nextNode(); n; n = w.nextNode()){
      if(!n.textContent.trim()) continue;
      const e = n.parentElement, cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if(cs.display === 'none' || cs.visibility === 'hidden' || !r.width || !r.height || e.closest('[hidden]')) continue;
      if(parseFloat(cs.fontSize) < 11) small.push(n.textContent.trim().slice(0, 20) + ' ' + cs.fontSize);
    }
    const btns = [...root.querySelectorAll('.btn, input')].filter(b => b.offsetParent || getComputedStyle(b).position === 'fixed');
    const blocked = btns.filter(b => { const r = b.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      return !(h === b || b.contains(h)); }).map(b => b.id);
    return { small, n: btns.length, blocked, sw: document.documentElement.scrollWidth, w: screenW,        // the screen's width, as in B2
             untitled: [...root.querySelectorAll('abbr')].filter(a => !a.title).length };
  }, 390);
  chk('inside the view: no text under 11 px, every button reachable, no sideways scroll, every abbreviation titled',
      !rules.small.length && !rules.blocked.length && rules.sw <= rules.w && rules.untitled === 0,
      rules.n + ' controls' + (rules.small.length ? '; small: ' + rules.small.join(', ') : '') + (rules.blocked.length ? '; covered: ' + rules.blocked.join(', ') : ''));
  const pics = await page.evaluate(() => __ar.pictures.slice());
  chk('the camera\'s picture is not drawn, read back or captured, in any of the usual ways: the view lays the sky over the video and does nothing else with it',
      pics.length === 0, pics.length ? [...new Set(pics)].join(', ')
        : 'in this run so far: no drawImage of the video, no read of the view\'s canvas, no ImageBitmap, ImageCapture, MediaRecorder, WebGL texture, OffscreenCanvas, VideoFrame, frame callback or track processor');
  // kept out of the repository: a picture to look at, not a reference to compare against
  const shot = path.join(require('os').tmpdir(), 'gtc-ar-phone.png');
  await page.screenshot({ path: shot });
  console.log('        screenshot of the view: ' + shot);
  await closeAR(page);

  /* B16: Cape Town, where the declination is 27° west. */
  /* The observer's form, opened as a person opens it on a phone: every field and Apply on the screen and under a finger. The rebuilt page's is
     a popover under the chip, and the chip is at the left of the phone: hung from the chip's right edge, as it first was, it ran off the left
     with Apply in it, and the step below could not press it (a 30 s timeout is how that showed). */
  await H.siteForm(page);
  const frm = await page.evaluate(screenW => ['s-name', 's-lat', 's-lon', 's-alt', 's-tz', 'siteapply'].filter(id => {
    const e = document.getElementById(id);
    if(!e) return true;
    /* Across first, with nothing scrolled: a panel that runs off an edge is off the screen, and a scroll that would bring it in must not be
       one the reader needs. Only then down, since a panel taller than the screen scrolls inside itself. Across is measured against the width the
       screen was set to and not innerWidth, which a phone's browser grows to fit a page that is too wide (as in B2): a panel hung 150 px over
       the right edge made innerWidth 520 on a 390 px screen, and every field read as on it. */
    const x = e.getBoundingClientRect();
    if(!(x.width > 0 && x.left >= 0 && x.right <= screenW)) return true;
    e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = e.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return !(r.width > 0 && r.left >= 0 && r.right <= screenW && r.top >= 0 && r.bottom <= innerHeight && h && (h === e || e.contains(h)));
  }), 390);
  chk("the observer's form, opened on a phone, has every field and Apply on the screen and in reach", !frm.length, frm.length ? 'out of reach: ' + frm.join(', ') : 'all six');
  await H.setSite(page,{ name: 'Cape Town', lat: -33.9249, lon: 18.4241, alt: 0, tz: 2 });         // typed in, as a person would
  await page.waitForFunction(() => __gt.OBS.name === 'Cape Town' && __gt.D && __gt.D.passes.length, null, { timeout: 20000 }).catch(() => null);
  await H.closeSiteForm(page);                         // the rebuilt page's form is a popover, and it would be over the button
  const bestCT = await atBestPass(page);
  if(bestCT) await downTo(page, bestCT.k, 35);               // not the zenith, where Cape Town's best pass can reach: see downTo
  await tapAR(page);
  await aimSat(page, 0, true);
  await settle(page);
  const ct = await probe(page);
  /* The same pose with the declination left out of the sensor's alpha: the
     view then faces D away from the spacecraft, which at a high pass is still
     on screen, so the azimuth is what is measured. A sign error would put it
     2|D| away instead. */
  const ctSt = await aimSat(page, 0, false);
  await settle(page);
  const ct2 = await probe(page);
  const ctDecl = await page.evaluate(() => document.getElementById('ar-decl').textContent);
  const miss = S.wrap180(ctSt.az - ct2.view.az);
  chk('Cape Town: the compass is 27° from true north, and correcting for it is what puts the spacecraft in the middle',
      bestCT && ct.decl < -25 && ct.marker && Math.hypot(ct.marker.x - ct.cx, ct.marker.y - ct.cy) < 1.5
      && near(miss, -ct.decl, 0.05) && ct2.marker && Math.hypot(ct2.marker.x - ct2.cx, ct2.marker.y - ct2.cy) > 50
      && ctDecl === Math.abs(ct.decl).toFixed(1) + '° W, applied',
      (bestCT ? '' : 'no pass from Cape Town in the window; ') + 'D ' + ct.decl.toFixed(2) + '°; uncorrected, the view faces ' + miss.toFixed(2) + '° away in azimuth at ' +
      ctSt.el.toFixed(1) + '° up, the marker ' + (ct2.marker ? Math.hypot(ct2.marker.x - ct2.cx, ct2.marker.y - ct2.cy).toFixed(0) + ' px' : '?') + ' off centre');
  await closeAR(page);
  console.log('\n  page errors (phone): ' + (errs.length ? errs.join(' | ') : 'none'));
  const pageErrs = errs.length;
  await ctx.close();
  return pageErrs;
}

/* ---- iPhone: north from webkitCompassHeading ------------------------------- */
async function partIOS(browser, port){
  console.log('\nPart B — an iPhone\n');
  const { ctx, page, errs } = await phone(browser, port);
  await atBestPass(page);
  await tapAR(page);
  // the target, in the magnetic frame, with the arbitrary zero shifted by 137°
  const C = 137;
  const flat = () => page.evaluate(c => __feed({ type: 'deviceorientation', a: (330 + c) % 360, b: 30, g: 0, h: 30, acc: 10 }), C);
  // before any flat sample: upright, heading unusable
  await page.evaluate(c => { const a = __aimAt(ARView.probe.view ? 0 : 0, 10, 0, 0);
    __feed({ type: 'deviceorientation', a: (a.a + c) % 360, b: a.b, g: a.g, h: 0, acc: 10 }); }, C);
  await until(page, () => { const q = ARView.probe; return q.state === 'finding' && q.drawn.horizon && /^Finding north/.test(q.message); });
  const f0 = await probe(page), n0 = await page.evaluate(() => document.getElementById('ar-north').textContent);
  chk('an iPhone held upright from the start is finding north: horizon and mask drawn, nothing that needs a bearing',
      f0.state === 'finding' && f0.source === 'ios' && !f0.marker && f0.drawn.horizon && f0.drawn.mask && !f0.drawn.craft && !f0.drawn.compass
      && /^Finding north/.test(f0.message) && /^finding it/.test(n0),
      f0.state + ': "' + f0.message + '" / north "' + n0 + '" / ' + JSON.stringify(f0.drawn));
  await flat();
  await until(page, () => ARView.probe.settled && ARView.state === 'running');
  const f1 = await probe(page);
  chk('...tipped towards flat, it takes a bearing: the offset is the one the zero was shifted by',
      f1.settled && near(S.wrap180(f1.offset - C), 0, 0.2) && f1.state === 'running', 'offset ' + (f1.offset === null ? 'none' : f1.offset.toFixed(3)));
  // now upright on the spacecraft, with a heading that is plainly wrong
  await page.evaluate(c => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms), a = __aimAt(st.az, st.el, 0, q.decl || 0);
    __feed({ type: 'deviceorientation', a: (a.a + c) % 360, b: a.b, g: a.g, h: 200, acc: 10 }); }, C);
  await settle(page);
  const f2 = await probe(page), n2 = await page.evaluate(() => document.getElementById('ar-north').textContent);
  chk('...then held up at the spacecraft, the bearing is held: the heading there is not trusted, and the marker is centred',
      f2.marker && Math.hypot(f2.marker.x - f2.cx, f2.marker.y - f2.cy) < 1.5 && near(S.wrap180(f2.offset - C), 0, 0.2)
      && /±10° · bearing taken/.test(n2), f2.marker ? 'off by ' + Math.hypot(f2.marker.x - f2.cx, f2.marker.y - f2.cy).toExponential(1) + ' px; ' + n2 : 'no marker');
  await page.evaluate(c => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms), a = __aimAt(st.az, st.el, 0, q.decl || 0);
    __feed({ type: 'deviceorientation', a: (a.a + c) % 360, b: a.b, g: a.g, h: 0, acc: -1 }); }, C);
  await page.waitForTimeout(3600);
  await until(page, () => /^The compass is not calibrated/.test(ARView.probe.message));
  const f3 = await probe(page);
  chk('...an uncalibrated compass for 3.5 s is said, and the bearing already taken is kept',
      /^The compass is not calibrated/.test(f3.message) && f3.marker && Math.hypot(f3.marker.x - f3.cx, f3.marker.y - f3.cy) < 1.5,
      '"' + f3.message.slice(0, 40) + '…"');
  await page.evaluate(() => { __ar.vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { __ar.vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await until(page, () => /^Finding north again/.test(ARView.probe.message), null, 2500);
  const f4 = await probe(page);
  await page.evaluate(c => { __ar.orient = 90; __feed({ type: 'deviceorientation', a: (330 + c + 23) % 360, b: 20, g: -30, h: 7, acc: 8 }); }, C);
  await until(page, () => ARView.probe.settled);
  const f5 = await probe(page);
  chk('...coming back to the page starts again, since the iPhone may have re-zeroed; flat samples held sideways settle it',
      f4.offset === null && /^Finding north again/.test(f4.message) && f5.settled && near(S.wrap180(f5.offset - C), 0, 0.5),
      'after the pause: "' + f4.message.slice(0, 30) + '…", then ' + (f5.offset === null ? 'none' : f5.offset.toFixed(2)));
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (iPhone): ' + (errs.length ? errs.join(' | ') : 'none'));
  const n = errs.length;
  await ctx.close();
  return n;
}

/* ---- the radar: the whole sky as a plot in the corner of the view ---------------------------------------------------
 * The rebuilt page's view has a small polar sky plot at the bottom right (north up, the zenith in the middle, the horizon at the rim, the
 * current-or-next pass, the spacecraft's dot) and on it, in blue, a crosshair at the azimuth and elevation the phone's camera points to: bring
 * the crosshair onto the dot and the spacecraft is in the middle of the picture. The old page never had it, so this part runs only against the
 * rebuilt one (NEW).
 *
 * What is asserted is written out here and not read from radar.ts: the plot's transform (x = c + R (90 - el)/90 sin az, y = c - R (90 - el)/90
 * cos az, R = side/2 - 15, the horizon at the rim), the side (two fifths of the short screen side, 112 to 200 px), the colours (#3D8BFF the
 * crosshair, #E8BC5A the pass) and the rules for where the radar may and may not be. Where the page says where it drew something
 * (ARView.probe.radar.draw), that is checked against the transform, and against the radar canvas's own pixels, which the checks may read: the
 * picture census flags a read of the sky canvas (ar-sky) and nothing else, and a check that ends with an empty census says the radar read none
 * of the camera's picture either.
 *
 * One tolerance is not zero. A held phone costs the radar nothing because it draws a frame again only when the pose, or the spacecraft, has
 * moved a tenth of a degree; after the view has settled, the crosshair can therefore be up to 0.1° behind the exact pose, which is 0.07 px along
 * the radius and 0.11 px round the rim of a 156 px plot. It is held to 0.15 px, where a wrong transform is tens of pixels out. The spacecraft's dot
 * is held to 0.05 px, since the clock is held still.
 */
const RADAR_BLUE = [0x3D, 0x8B, 0xFF], RADAR_PASS = [0xE8, 0xBC, 0x5A];
/* The side of the radar for a screen w x h: two fifths of the short side, from a thumb-sized 112 px to 200 px on a tablet. */
const radarSide = (w, h) => Math.round(Math.max(112, Math.min(200, Math.min(w, h)*0.4)));
/* Where a direction falls on the plot, in CSS px from the canvas's top left. Below the horizon it is put on the rim, at its azimuth. */
const plotAt = (side, az, el) => {
  const R = side/2 - 15, e = Math.max(0, Math.min(90, el)), r = R*(90 - e)/90;
  return { x: side/2 + r*Math.sin(az*RAD), y: side/2 - r*Math.cos(az*RAD) };
};
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rgbNear = (px, want, tol) => !!px && px[3] >= 240 && want.every((v, i) => Math.abs(px[i] - v) <= tol);
/* Blue enough to be the crosshair, also where it is drawn faint (below the horizon, at 0.6 of its alpha, over the dark glass): the blue
   channel high and well clear of both the others. The cyan of a spacecraft below the mask (#55D1E7) is not it. */
const blueish = px => !!px && px[3] >= 100 && px[2] >= 120 && px[2] - px[0] >= 100 && px[2] - px[1] >= 50;
const boxesMeet = (a, b) => a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;
const inBox = (p, b, m) => p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m;
const onSafeEdge = (p, s) => p.x >= s.left - 0.5 && p.x <= s.right + 0.5 && p.y >= s.top - 0.5 && p.y <= s.bottom + 0.5
  && (near(p.x, s.left, 0.5) || near(p.x, s.right, 0.5) || near(p.y, s.top, 0.5) || near(p.y, s.bottom, 0.5));
const n2 = v => v.toFixed(2);

/* The radar canvas's pixels at points given in CSS px from its top left, each [r, g, b, a] (null off the canvas). */
const radarPx = (page, pts) => page.evaluate(pts => {
  const cv = document.getElementById('ar-radar'), c = cv.getContext('2d'), k = cv.width/cv.getBoundingClientRect().width;
  return pts.map(p => {
    const x = Math.floor(p.x*k), y = Math.floor(p.y*k);
    return x < 0 || y < 0 || x >= cv.width || y >= cv.height ? null : Array.from(c.getImageData(x, y, 1, 1).data);
  });
}, pts);
/* Every opaque pixel on the radar that is the crosshair's blue: how many, and where their centre is, in CSS px. */
const radarBlue = (page, side) => page.evaluate(side => {
  const cv = document.getElementById('ar-radar'), c = cv.getContext('2d'), w = cv.width, k = w/side, d = c.getImageData(0, 0, w, cv.height).data;
  let n = 0, sx = 0, sy = 0;
  for(let i = 0; i < d.length; i += 4){
    if(d[i + 3] >= 240 && Math.abs(d[i] - 61) <= 14 && Math.abs(d[i + 1] - 139) <= 14 && Math.abs(d[i + 2] - 255) <= 14){
      const p = i/4; n++; sx += (p % w + 0.5)/k; sy += (Math.floor(p/w) + 0.5)/k;
    }
  }
  return { n, x: n ? sx/n : null, y: n ? sy/n : null };
}, side);
/* How many pixels on the radar are blue enough to be the crosshair, drawn faint too (blueish, in the page): none, when nothing of it is drawn. The
   strict count above wants a full-strength pixel, and the crosshair on the rim (below the horizon) is drawn at 0.6 of its alpha, half of it off the glass. */
const radarBlueish = page => page.evaluate(() => {
  const cv = document.getElementById('ar-radar'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for(let i = 0; i < d.length; i += 4) if(d[i + 3] >= 100 && d[i + 2] >= 120 && d[i + 2] - d[i] >= 100 && d[i + 2] - d[i + 1] >= 50) n++;
  return n;
});
/* The radar's box and everything it must keep clear of, read from the page as a person sees it. */
const radarLayout = page => page.evaluate(() => {
  const cv = document.getElementById('ar-radar'), q = ARView.probe, r = cv.getBoundingClientRect(), s = document.getElementById('ar-status');
  const rect = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const hit = r.width ? document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) : null;
  const btn = document.getElementById('ar-radarbtn');
  return { hidden: cv.hidden, display: getComputedStyle(cv).display, aria: cv.getAttribute('aria-hidden'), pe: getComputedStyle(cv).pointerEvents,
    box: rect(cv), probeBox: q.radar.box, on: q.radar.on, draw: q.radar.draw, bw: cv.width, bh: cv.height,
    dpr: Math.min(window.devicePixelRatio || 1, 2), W: q.W, H: q.H, state: q.state,
    /* the view's own controls that cross it: the page's, under the view and inert, are in the document too and are not what is asked */
    over: r.width ? [...document.querySelectorAll('#arview button, #arview a[href], #arview input, #arview select, #arview textarea')].filter(e => {
      const q = e.getBoundingClientRect();
      return q.width && q.height && getComputedStyle(e).visibility !== 'hidden'
        && q.left < r.right - 0.01 && q.right > r.left + 0.01 && q.top < r.bottom - 0.01 && q.bottom > r.top + 0.01;
    }).map(e => e.id || e.tagName) : [], hit: hit ? hit.id : null,
    top: rect(document.querySelector('.ar-top')), read: rect(document.querySelector('.ar-read')),
    status: s.getBoundingClientRect().height ? rect(s) : null, close: rect(document.getElementById('ar-close')),
    pressed: btn.getAttribute('aria-pressed'), key: localStorage.getItem('gt.arradar') };
});
const radarClear = L => !boxesMeet(L.box, L.top) && !boxesMeet(L.box, L.read) && !(L.status && boxesMeet(L.box, L.status))
  && !boxesMeet(L.box, L.close) && !L.over.length;
const radarInView = L => L.box.x >= 0 && L.box.y >= 0 && L.box.x + L.box.w <= L.W + 0.01 && L.box.y + L.box.h <= L.H + 0.01;
/* The middle of the sky, and 20 px round it (the spacecraft's marker reaches 18), is where the spacecraft is when the phone is on it: the radar
   must not be over it. */
const radarMid = L => !boxesMeet(L.box, { x: L.W/2 - 20, y: L.H/2 - 20, w: 40, h: 40 });
const radarWhy = L => (L.over.length ? 'crosses ' + L.over.join(', ') + '; ' : '')
  + ['top', 'read', 'status', 'close'].filter(k => L[k] && boxesMeet(L.box, L[k])).map(k => 'meets .ar-' + k).join(', ');
/* The view is open with a pose and the radar drawn. */
const radarReady = page => until(page, () => { const q = ARView.probe; return q.state === 'running' && q.radar.box && q.radar.draw ? { ok: true } : false; }, null, 20000);
/* The phone pointed at (az, el), the picture level, the way the checks above point it (held upright, or at the screen rotation th: 90 or 270 when
   the page is set sideways); resolves once the view has got there and stopped (null if
   it never did, and the check then reads what is there and fails on it). Two frames after, so that the radar has had a frame to see it. */
const onAim = async (page, az, el, th) => {
  await page.evaluate(([az, el, th]) => { const q = ARView.probe;
    __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(az, el, th, q.decl || 0))); }, [az, el, th || 0]);
  await settle(page);
  const got = await until(page, ([az, el]) => {
    const v = ARView.probe.view; if(!v) return false;
    const R = Math.PI/180, u = (a, e) => [Math.cos(e*R)*Math.sin(a*R), Math.cos(e*R)*Math.cos(a*R), Math.sin(e*R)], a = u(v.az, v.el), b = u(az, el);
    const off = Math.acos(Math.max(-1, Math.min(1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2])))/R;
    return off < 0.05 ? { off } : false;
  }, [az, el], 10000);
  await frames2(page);
  return got;
};
const satNow = page => page.evaluate(() => { const q = ARView.probe; return __gt.stateAt(__gt.D.track, q.ms); });

async function partRadar(browser, port){
  console.log('\nPart B — the radar in the view\n');
  let n = 0;
  n += await radarPhone(browser, port);
  n += await radarIOS(browser, port);
  n += await radarKept(browser, port);
  /* What a review of the radar found, each pinned where it shows: radarPhone has the crosshair straight down and the pass's top ring, and
     these four the rest - a pass the window cut off, a readout that shrinks, a status of four lines, a phone held sideways. */
  n += await radarEnds(browser, port);
  n += await radarHold(browser, port);
  n += await radarLondon(browser, port);
  n += await radarSideways(browser, port);
  return n;
}

/* The radar on an Android-style phone (a compass of its own): where it is, what it draws, where the blue crosshair is, and when it gives way. */
async function radarPhone(browser, port){
  const { ctx, page, errs } = await phone(browser, port);
  /* The camera is a canvas stream, as in the sideways checks: the radar needs none of its picture, and a fake device is one thing less to wait for. */
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  const best = await atBestPass(page);
  chk('precondition: the window has a pass to draw on the radar', !!best, best ? best.name + ', pass ' + best.k + ' at ' + best.maxEl.toFixed(1) + '°' : 'none');
  if(!best){ await ctx.close(); return errs.length; }
  /* The clock held still, with the spacecraft well up its pass and not at the zenith (see downTo): its dot then stays where it is. */
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await downTo(page, best.k, 35);
  const keys0 = await page.evaluate(() => Object.keys(localStorage));
  await page.evaluate(() => __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 30, 0, 0))));
  await tapAR(page);
  await radarReady(page);
  await camLive(page);

  /* Where it is, how big, and that it takes no touch. */
  const side = radarSide(390, 844);
  const L = await radarLayout(page);
  chk('the radar is shown on a 390x844 phone, aria-hidden, a square of radarSize(390, 844) = ' + side + ' px with a backing store for the screen\'s pixel ratio',
      !L.hidden && L.display !== 'none' && L.aria === 'true' && near(L.box.w, side, 0.01) && near(L.box.h, side, 0.01)
      && L.bw === Math.round(side*L.dpr) && L.bh === L.bw && !!L.probeBox && near(L.probeBox.x, L.box.x, 0.01) && near(L.probeBox.y, L.box.y, 0.01)
      && near(L.probeBox.w, L.box.w, 0.01),
      'box ' + [L.box.x, L.box.y, L.box.w, L.box.h].map(n2).join(' ') + ', canvas ' + L.bw + 'x' + L.bh + ', aria-hidden ' + L.aria + ', probe box ' + (L.probeBox ? 'agrees' : 'none'));
  chk('...inside the screen, on the right, above the readout, clear of the title bar, the status line, the readout (Align and the rest) and the Close button, and off the middle of the sky',
      radarInView(L) && radarClear(L) && radarMid(L) && L.box.x >= L.W/2 && L.box.y + L.box.h <= L.read.y,
      'box ends ' + n2(L.W - L.box.x - L.box.w) + ' px from the right and ' + n2(L.read.y - L.box.y - L.box.h) + ' px above the readout; ' + (radarWhy(L) || 'nothing under it'));
  chk('...takes no touch: pointer-events none, and a tap at its centre reaches the sky under it, not the radar',
      L.pe === 'none' && L.hit === 'ar-sky', 'pointer-events ' + L.pe + ', element at its centre: ' + L.hit);
  chk('...and opening the view wrote nothing to storage: gt.arradar is written only when the reader presses the button', L.key === null, 'gt.arradar ' + JSON.stringify(L.key));
  /* The disc, from the pixels: the horizon ring at the radius R, glass inside it, nothing outside, away from the letters, the spokes and the rings. */
  const Rr = side/2 - 15, cc = side/2, spots = [20, 110, 200, 290].map(a => {
    const p = (r, d) => ({ x: cc + r*Math.sin((a + d)*RAD), y: cc - r*Math.cos((a + d)*RAD) });
    return { ring: p(Rr, 0), glass: p(Rr - 8, 0), out: p(Rr + 5, 0) };
  });
  const dpx = await radarPx(page, [].concat(...spots.map(s => [s.ring, s.glass, s.out])));
  const ringOk = spots.filter((s, i) => dpx[3*i] && dpx[3*i][0] >= 190 && dpx[3*i][1] >= 190 && dpx[3*i][2] >= 190 && dpx[3*i][3] >= 150).length;
  const glassOk = spots.filter((s, i) => dpx[3*i + 1] && dpx[3*i + 1][3] >= 140 && dpx[3*i + 1][3] <= 175).length;
  const outOk = spots.filter((s, i) => dpx[3*i + 2] && dpx[3*i + 2][3] <= 10).length;
  chk('...the disc is where the plot says: the horizon ring at R = side/2 - 15 = ' + Rr + ' px, dark glass just inside it, clear canvas just outside',
      ringOk === 4 && glassOk >= 3 && outOk === 4, 'at four bearings off the axes: ring ' + ringOk + '/4, glass ' + glassOk + '/4, outside ' + outOk + '/4');

  /* The blue crosshair, where the phone points. */
  const sat0 = await satNow(page);
  const cases = [[0, 40], [90, 20], [200, 60], [350, 10], [45, 89]].map(([az, el]) => ({ name: az + '° az, ' + el + '° up', az, el }))
    .concat([{ name: 'the spacecraft itself (' + n2(sat0.az) + '°, ' + n2(sat0.el) + '° up)', az: sat0.az, el: sat0.el }]);
  for(const c of cases){
    const got = await onAim(page, c.az, c.el);
    const q = await probe(page), d = q.radar.draw;
    if(!(d && d.aim && q.view)){ chk('the blue crosshair is at the plot\'s transform of where the phone points: ' + c.name, false, d ? 'no crosshair drawn' : 'nothing drawn'); continue; }
    const want = plotAt(d.size, q.view.az, q.view.el), cmd = plotAt(d.size, c.az, c.el);
    const a = (c.az + 180)*RAD, opp = { x: d.size/2 + 0.6*d.R*Math.sin(a), y: d.size/2 - 0.6*d.R*Math.cos(a) };
    const px = await radarPx(page, [{ x: want.x + 9, y: want.y }, opp]), blue = await radarBlue(page, d.size);
    const e1 = dist2(d.aim, want), e2 = dist2(d.aim, cmd), eC = blue.n ? dist2(blue, want) : Infinity;
    chk('the blue crosshair is at the plot\'s transform of where the phone points: ' + c.name,
        !!got && !d.aim.clamped && e1 <= 0.15 && e2 <= 0.3 && rgbNear(px[0], RADAR_BLUE, 12) && !blueish(px[1]) && blue.n >= 60 && eC <= 0.4,
        (got ? '' : 'the view never got there (view ' + n2(q.view.az) + '/' + n2(q.view.el) + '); ') + 'drawn ' + n2(d.aim.x) + ',' + n2(d.aim.y) + ' vs ' + n2(want.x) + ',' + n2(want.y)
        + ' (off ' + n2(e1) + ' px, ' + n2(e2) + ' px from the commanded aim); arm pixel ' + JSON.stringify(px[0]) + ', opposite side ' + JSON.stringify(px[1])
        + '; ' + blue.n + ' blue pixels centred ' + n2(eC) + ' px off');
  }

  /* The spacecraft's dot, and the whole point: aimed at it, the crosshair is on it. At two elevations of the pass. */
  const coin = [];
  for(const el of [35, 12]){
    await downTo(page, best.k, el);
    const st = await satNow(page);
    await onAim(page, st.az, st.el);
    const q = await probe(page), d = q.radar.draw;
    if(!(d && d.aim && d.craft && q.marker)){ coin.push({ el, bad: 'aim ' + !!(d && d.aim) + ', craft ' + !!(d && d.craft) + ', marker ' + !!q.marker }); continue; }
    const w1 = plotAt(d.size, q.marker.az, q.marker.el), w2 = plotAt(d.size, st.az, st.el);
    const px = await radarPx(page, [d.craft]), blue = await radarBlue(page, d.size);
    coin.push({ el: st.el, craftErr: dist2(d.craft, w1), stErr: dist2(d.craft, w2), apart: dist2(d.aim, d.craft), centre: dist2(q.marker, { x: q.cx, y: q.cy }),
                dot: px[0], blue: blue.n, blueErr: blue.n ? dist2(blue, d.craft) : Infinity });
  }
  chk('the spacecraft\'s dot is at the plot\'s transform of its own azimuth and elevation, in the pass colour once it is above the mask',
      coin.length === 2 && coin.every(c => !c.bad && c.craftErr <= 0.05 && c.stErr <= 0.1 && rgbNear(c.dot, RADAR_PASS, 12)),
      coin.map(c => c.bad ? c.el + '°: ' + c.bad : n2(c.el) + '° up: dot ' + n2(c.craftErr) + ' px off the marker\'s, ' + n2(c.stErr) + ' off the track\'s, centre pixel ' + JSON.stringify(c.dot)).join('; '));
  chk('...and with the phone aimed at the spacecraft the blue crosshair and the dot coincide (within 0.5 px), and the spacecraft is in the middle of the picture',
      coin.length === 2 && coin.every(c => !c.bad && c.apart <= 0.5 && c.centre < 1.5 && c.blue >= 60 && c.blueErr <= 0.5),
      coin.map(c => c.bad ? c.el + '°: ' + c.bad : n2(c.el) + '° up: crosshair ' + n2(c.apart) + ' px from the dot, the marker ' + n2(c.centre) + ' px from the screen\'s centre, blue pixels ' + n2(c.blueErr) + ' px from the dot').join('; '));
  await downTo(page, best.k, 35);

  /* The edges of the plot: below the horizon the crosshair is on the rim and says so; straight up it is in the middle. */
  const got4 = await onAim(page, 120, -25);
  const q4 = await probe(page), d4 = q4.radar.draw;
  if(d4 && d4.aim){
    const R4 = d4.size/2 - 15, want4 = plotAt(d4.size, q4.view.az, 0);
    const px = await radarPx(page, [{ x: d4.aim.x + 9, y: d4.aim.y }]);
    chk('phone pointed below the horizon (25° down): the crosshair is on the rim, at the phone\'s azimuth, drawn as clamped, and still blue',
        !!got4 && d4.aim.clamped && near(dist2(d4.aim, { x: d4.cx, y: d4.cy }), R4, 0.05) && dist2(d4.aim, want4) <= 0.15 && blueish(px[0]) && near(q4.view.el, -25, 0.05),
        'view ' + n2(q4.view.az) + '°/' + n2(q4.view.el) + '°, crosshair ' + n2(dist2(d4.aim, { x: d4.cx, y: d4.cy })) + ' px from the centre (R ' + R4 + '), clamped ' + d4.aim.clamped + ', arm pixel ' + JSON.stringify(px[0]));
  } else chk('phone pointed below the horizon (25° down): the crosshair is on the rim, at the phone\'s azimuth, drawn as clamped, and still blue', false, 'no crosshair drawn');
  const got4b = await onAim(page, 300, 89.9);
  const q4b = await probe(page), d4b = q4b.radar.draw;
  chk('...phone pointed straight up (89.9°): the crosshair is at the centre, within 1 px, and not clamped',
      !!got4b && !!d4b && !!d4b.aim && !d4b.aim.clamped && dist2(d4b.aim, { x: d4b.cx, y: d4b.cy }) <= 1,
      d4b && d4b.aim ? n2(dist2(d4b.aim, { x: d4b.cx, y: d4b.cy })) + ' px from the centre' : 'no crosshair drawn');
  /* And straight down. Within 5° of it the azimuth is the direction of a tilt of a few degrees, and swings right round the rim with the tremor
     of a hand: there is no crosshair at all (the readout says "straight down" from 85° too). From 5° out it is on the rim again, clamped. */
  const nadir = [];
  for(const el of [-80, -84, -86, -88, -90]){
    const got = await onAim(page, 120, el);
    const q = await probe(page), d = q.radar.draw;
    nadir.push({ el, got: !!got, view: q.view, d, blue: await radarBlueish(page) });
  }
  const rimAt = (d, v) => d && d.aim && d.aim.clamped && near(dist2(d.aim, { x: d.cx, y: d.cy }), d.size/2 - 15, 0.05) && dist2(d.aim, plotAt(d.size, v.az, 0)) <= 0.15;
  const sayNadir = k => (k.view ? n2(k.view.el) : '?') + '° (commanded ' + k.el + '°): ' + (k.d ? (k.d.aim ? 'crosshair on the plot' + (k.d.aim.clamped ? ' (clamped)' : '') : 'no crosshair') : 'nothing drawn') + ', ' + k.blue + ' blue pixels';
  chk('phone pointed within 5° of straight down (86°, 88°, 90° down): no crosshair is drawn, in the probe or on the canvas, not one blue pixel',
      nadir.filter(k => k.el <= -86).every(k => k.got && k.view && k.view.el < -85 && !!k.d && k.d.aim === null && k.blue === 0),
      nadir.filter(k => k.el <= -86).map(sayNadir).join('; '));
  chk('...and from 5° out (84° and 80° down) it is drawn again, on the rim at the phone\'s azimuth, clamped, and blue',
      nadir.filter(k => k.el > -86).every(k => k.got && k.view && rimAt(k.d, k.view) && k.blue >= 30),
      nadir.filter(k => k.el > -86).map(sayNadir).join('; '));

  /* The pass, drawn on the plot at the transform of its own samples: its highest point and a few samples of the part still to fly. The phone
     is aimed away from it, at the opposite bearing, so that nothing of the crosshair is near. */
  const PS = await page.evaluate(k => { const p = __gt.D.passes[k];
    return { arc: p.arc.map(s => [s.az, s.el]), maxAz: p.maxAz, maxEl: p.maxEl, t0: p.t0ms, t1: p.t1ms }; }, best.k);
  await onAim(page, (PS.maxAz + 180) % 360, 20);
  const q5 = await probe(page), d5 = q5.radar.draw;
  if(d5 && d5.pass){
    const nA = PS.arc.length - 1, kFlown = Math.max(0, Math.min(nA, Math.floor((q5.ms - PS.t0)/(PS.t1 - PS.t0)*nA)));
    const top = plotAt(d5.size, PS.maxAz, PS.maxEl);
    const far = p => (!d5.craft || dist2(p, d5.craft) >= 14) && (!d5.aim || dist2(p, d5.aim) >= 14) && dist2(p, top) >= 10;
    const samples = [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75].map(f => Math.round(nA*f)).filter(i => i > kFlown + 1)
      .map(i => ({ i, p: plotAt(d5.size, PS.arc[i][0], PS.arc[i][1]) })).filter(s => far(s.p));
    const px = await radarPx(page, [top].concat(samples.map(s => s.p)));
    chk('the pass is drawn in the pass colour: its highest point at the plot\'s transform of its own azimuth and elevation, and the samples still to fly along its arc',
        rgbNear(px[0], RADAR_PASS, 12) && samples.length >= 3 && px.slice(1).every(p => rgbNear(p, RADAR_PASS, 12)),
        'top (' + n2(PS.maxAz) + '°, ' + n2(PS.maxEl) + '°) pixel ' + JSON.stringify(px[0]) + '; ' + samples.length + ' arc samples (flown to ' + kFlown + ' of ' + nA + ') '
        + samples.map((s, j) => s.i + ':' + JSON.stringify(px[j + 1])).join(' '));
  } else chk('the pass is drawn in the pass colour: its highest point at the plot\'s transform of its own azimuth and elevation, and the samples still to fly along its arc', false, 'the radar says it drew no pass');

  /* The pass's highest point is a small ring, so that the spacecraft's dot is the one solid dot on the plot and is not taken for it. The
     spacecraft is put well away from the top (12° up on the way up, or 7° where that is still near it) and the phone aimed away from both. The
     ring is read at 16 bearings: on it, 3.5 px from the top, it is the pass colour; inside it, 2 px from the top, it is not. (Its centre cannot say:
     the arc's own line runs through the top, and a solid dot would only make the inside the pass colour all round.) The dot, the spacecraft's,
     is the pass colour at its centre and 3.5 px round it. */
  let hollow = null;
  for(const el of [12, 7]){
    await downTo(page, best.k, el);
    await onAim(page, (PS.maxAz + 180) % 360, 20);
    const q = await probe(page), d = q.radar.draw;
    if(!(d && d.pass && d.craft)){ hollow = { el, bad: 'pass ' + !!(d && d.pass) + ', spacecraft ' + !!(d && d.craft) }; continue; }
    const top = plotAt(d.size, PS.maxAz, PS.maxEl), away = dist2(d.craft, top);
    if(away < 14 || (d.aim && (dist2(d.aim, top) < 16 || dist2(d.aim, d.craft) < 16))){
      hollow = { el, bad: 'the spacecraft is ' + n2(away) + ' px from the top, the crosshair ' + (d.aim ? n2(dist2(d.aim, top)) + ' px from the top and ' + n2(dist2(d.aim, d.craft)) + ' from the spacecraft' : 'nowhere') };
      continue;
    }
    const at = (c, r, k) => ({ x: c.x + r*Math.sin(k*RAD), y: c.y - r*Math.cos(k*RAD) });
    const bearings = [...Array(16).keys()].map(i => i*22.5), eight = [...Array(8).keys()].map(i => i*45);
    const px = await radarPx(page, bearings.map(k => at(top, 3.5, k)).concat(bearings.map(k => at(top, 2, k)), [d.craft], eight.map(k => at(d.craft, 3.5, k))));
    hollow = { el, away, onRing: px.slice(0, 16).filter(p => rgbNear(p, RADAR_PASS, 12)).length, inside: px.slice(16, 32).filter(p => rgbNear(p, RADAR_PASS, 12)).length,
               dot: px.slice(32).filter(p => rgbNear(p, RADAR_PASS, 12)).length };
    break;
  }
  chk('the pass\'s highest point is a small hollow ring, and the spacecraft\'s dot the one solid dot: the pass colour round the ring (at least 14 of 16 bearings), not inside it (at most 2 of 16), and at the dot\'s centre and 3.5 px round it (all 9)',
      !!hollow && !hollow.bad && hollow.onRing >= 14 && hollow.inside <= 2 && hollow.dot === 9,
      !hollow ? 'no case' : hollow.bad ? hollow.el + '° up: ' + hollow.bad
        : 'spacecraft ' + hollow.el + '° up, ' + n2(hollow.away) + ' px from the top: ring ' + hollow.onRing + '/16, inside ' + hollow.inside + '/16, dot ' + hollow.dot + '/9');
  await downTo(page, best.k, 35);

  /* The view's own text keeps off the radar. Every piece of text drawn on the sky canvas is caught at fillText (the picture census does not mind
     text), in poses that put the spacecraft's label, the pass's time ticks and ends, and the pointer's words where the radar is. A pose is the
     spacecraft's offset from where the phone points: (0, 0) is aimed at it, and a negative azimuth offset puts it to the right, a positive
     elevation offset below. The radar's box is in the labels' keep-out list, so the labels are held to the box; the pointer's own words are the one
     label kept on the screen where nothing fits, and what they must not do is lie over what the radar draws (its glass disc and compass letters),
     which they are held to. */
  await page.evaluate(() => {
    const C = CanvasRenderingContext2D.prototype, fill = C.fillText;
    window.__labels = [];
    C.fillText = function(t, x, y){ if(this.canvas.id === 'ar-sky') window.__labels.push({ t, x, y, w: this.measureText(t).width }); return fill.apply(this, arguments); };
  });
  const stL = await satNow(page);
  const labelsAt = async (da, de, th, st) => {
    await onAim(page, (st || stL).az + da, (st || stL).el + de, th);
    await page.evaluate(() => { __labels.length = 0; });
    await frames2(page);
    const r = await page.evaluate(() => { const q = ARView.probe, p = q.pointer;
      return { box: q.radar.box, pointer: p ? [p.title, p.text].filter(Boolean) : [], labels: __labels.slice() }; });
    // every frame since the clear drew all of them again, a hair apart as the view settles: each once
    const key = l => l.t + '|' + Math.round(l.x/4) + '|' + Math.round(l.y/4), all = r.labels;
    r.labels = all.filter((l, i) => all.findIndex(m => key(m) === key(l)) === i).map(l => ({ t: l.t, x0: l.x - 2, x1: l.x + l.w + 2, y0: l.y - 7.5, y1: l.y + 7.5 }));
    return r;
  };
  const inRadarBox = (l, b) => l.x0 < b.x + b.w - 0.5 && l.x1 > b.x + 0.5 && l.y0 < b.y + b.h - 0.5 && l.y1 > b.y + 0.5;
  /* How far a label's box reaches into what the radar draws: into the disc and its ring (R + 1.5 px) and over a compass letter. Negative: clear. */
  const intoRadarArt = (l, b) => {
    const R = b.w/2 - 15, c = { x: b.x + b.w/2, y: b.y + b.h/2 };
    const nx = Math.max(l.x0, Math.min(c.x, l.x1)), ny = Math.max(l.y0, Math.min(c.y, l.y1));
    let into = R + 1.5 - Math.hypot(nx - c.x, ny - c.y);
    for(const [ux, uy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]){
      const lx = c.x + ux*(R + 8), ly = c.y + uy*(R + 8);
      if(l.x0 < lx + 5.5 && l.x1 > lx - 5.5 && l.y0 < ly + 6.5 && l.y1 > ly - 6.5) into = Math.max(into, 1);
    }
    return into;
  };
  const labelPoses = [];
  for(const [da, de] of [[0, 0], [-20, 15], [-30, 30]]) labelPoses.push({ da, de, r: await labelsAt(da, de) });
  const ownText = (r, l) => r.pointer.includes(l.t);
  const sayL = l => l.t + ' at ' + l.x0.toFixed(0) + '..' + l.x1.toFixed(0) + ',' + l.y0.toFixed(0);
  chk('the view\'s own labels (the spacecraft\'s, the pass\'s ends, ticks and top, the compass letters) keep off the radar: in three poses with them near it, none is under its box',
      labelPoses.every(p => p.r.labels.length >= 4 && !p.r.labels.filter(l => !ownText(p.r, l) && inRadarBox(l, p.r.box)).length),
      labelPoses.map(p => '(' + p.da + ',' + p.de + '): ' + p.r.labels.length + ' pieces of text, ' + (p.r.labels.filter(l => !ownText(p.r, l) && inRadarBox(l, p.r.box)).map(sayL).join(' | ') || 'none under the box')).join('; '));
  const pointerPoses = [];
  for(const [da, de] of [[-20, 30], [-10, 30], [-20, 40]]) pointerPoses.push({ da, de, r: await labelsAt(da, de) });
  const ptrInto = p => p.r.labels.filter(l => ownText(p.r, l)).map(l => ({ l, into: intoRadarArt(l, p.r.box) }));
  chk('...and the pointer\'s own words, with the arrow slid out from under the radar, do not lie over what the radar draws: its disc, its ring and its compass letters',
      pointerPoses.every(p => ptrInto(p).length >= 1 && ptrInto(p).every(k => k.into <= 0.5)),
      pointerPoses.map(p => '(' + p.da + ',' + p.de + '): ' + (ptrInto(p).map(k => sayL(k.l) + (k.into > 0.5 ? ' reaches ' + k.into.toFixed(1) + ' px into the radar' : ' clear')).join(' | ') || 'no pointer text')).join('; '));

  /* The off-screen pointer. Where it would sit under the radar it slides along the safe rectangle's edge to the radar's nearer side, and never
     sits under it; where it would not, the radar changes nothing. The place it would be is worked out here, from the spacecraft's projection with
     the view's own pose and the page's safe rectangle (the page's own pointer is what is read). The arrow's tip, and with it its two base
     corners, are checked against the radar's box. A direction is the spacecraft's offset from where the phone points, in azimuth and elevation:
     the first four put it below and to the right, towards the radar, and the last three leave it where the radar is not. */
  const stP = await satNow(page);
  const dirs = [[-40, 25], [-25, 30], [-12, 38], [-55, 12], [-35, 0], [40, 0], [0, -35]];
  const ptr = [];
  for(const [da, de] of dirs){
    const got = await onAim(page, stP.az + da, stP.el + de);
    const q = await probe(page), pj = await page.evaluate(([az, el]) => ARView.project(az, el), [stP.az, stP.el]);
    const box = q.radar.box, pr = q.pointer;
    if(!(pr && box && pj && pj.front)){ ptr.push({ da, de, bad: 'pointer ' + !!pr + ', box ' + !!box + ', in front ' + !!(pj && pj.front) }); continue; }
    let dx = pj.x - q.cx, dy = pj.y - q.cy; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    const un = S.edgePoint(q.cx, q.cy, dx, dy, q.safe), slides = inBox(un, box, 8);
    const tri = [pr, { x: pr.x - dx*14 - dy*8, y: pr.y - dy*14 + dx*8 }, { x: pr.x - dx*14 + dy*8, y: pr.y - dy*14 - dx*8 }];
    /* The tip is clear of the box itself, as asked. The corners of the arrow's base reach 14 px back and 8 px aside, and a tilted arrow's can
       cross a corner of the box by a pixel or so (the slide leaves 8 px) where the radar draws nothing: the corners of its square are empty,
       and what it draws is inside the circle of half its side. So the whole arrow is held clear of that circle, which is where it could be hidden. */
    const mid = { x: box.x + box.w/2, y: box.y + box.h/2 };
    const turn = Math.abs(S.wrap180(Math.atan2(pr.x - q.cx, -(pr.y - q.cy))*DEG - Math.atan2(un.x - q.cx, -(un.y - q.cy))*DEG));
    ptr.push({ da, de, got: !!got, pr, un, slides, outside: !inBox(pr, box, 0) && tri.every(v => dist2(v, mid) > box.w/2), edge: onSafeEdge(pr, q.safe),
               same: slides ? (near(pr.x, un.x, 0.5) || near(pr.y, un.y, 0.5)) && turn <= 60 : dist2(pr, un) <= 1, turn });
  }
  const slid = ptr.filter(p => p.slides).length, left = ptr.filter(p => !p.bad && !p.slides).length;
  chk('the off-screen pointer is never under the radar: where it would be, it slides along the safe rectangle\'s edge to the radar\'s side, its tip outside the box and its base outside what the radar draws; elsewhere it is where it always was',
      ptr.length === dirs.length && ptr.every(p => !p.bad && p.got && p.outside && p.edge && p.same) && slid >= 2 && left >= 2,
      ptr.map(p => p.bad ? '(' + p.da + ',' + p.de + ') ' + p.bad : '(' + p.da + ',' + p.de + ') ' + (p.slides ? 'slid from ' + p.un.x.toFixed(0) + ',' + p.un.y.toFixed(0) + ' to ' : 'at ')
        + p.pr.x.toFixed(0) + ',' + p.pr.y.toFixed(0) + (p.outside && p.edge && p.same ? '' : ' WRONG')).join('; ') + ' - ' + slid + ' slid, ' + left + ' left alone');
  /* The slide is the radar's doing and nothing else: with the radar hidden the pointer is where it always was, in each direction it had slid in. */
  await page.tap('#ar-radarbtn'); await frames2(page);
  const away = [];
  for(const p of ptr.filter(p => p.slides)){
    await onAim(page, stP.az + p.da, stP.el + p.de);
    const q = await probe(page);
    away.push({ da: p.da, de: p.de, pr: q.pointer, box: q.radar.box, off: q.pointer ? dist2(q.pointer, p.un) : null });
  }
  await page.tap('#ar-radarbtn');
  await until(page, () => { const q = ARView.probe; return q.radar.box && q.radar.draw ? { ok: true } : false; }, null, 5000);
  chk('...and with the radar hidden the pointer is back where it always was, in each of the directions it had slid in',
      away.length >= 2 && away.every(a => a.pr && a.box === null && a.off <= 1),
      away.map(a => '(' + a.da + ',' + a.de + ') ' + (a.pr ? a.off.toFixed(2) + ' px from the edge point' : 'no pointer')).join('; '));

  /* A drag across the radar turns the sky, since the radar takes no touch: the trim is what is read, as in the hand-turn check. */
  await onAim(page, stP.az, 20);
  const r0 = await probe(page), rb = r0.radar.box;
  const hx = rb.x + 30, hy = rb.y + rb.h/2;
  await page.mouse.move(hx, hy); await page.mouse.down();
  for(let i = 1; i <= 10; i++) await page.mouse.move(hx + i*10, hy);
  await page.mouse.up();
  await frames2(page);
  const r1 = await probe(page);
  const wantTrim = r0.trim - (100/r0.F)*DEG/Math.max(Math.cos(r0.view.el*RAD), 0.3);
  chk('...and a drag across the radar still turns the sky: the trim moves as it does for a drag anywhere else on the screen',
      near(r1.trim, wantTrim, 0.05) && Math.abs(r1.trim - r0.trim) > 1, 'trim ' + n2(r0.trim) + '° to ' + n2(r1.trim) + '° (want ' + n2(wantTrim) + '°)');
  /* The crosshair follows the pose the view draws, hand turn included. */
  await settle(page); await frames2(page);
  const q6 = await probe(page), d6 = q6.radar.draw;
  const w6 = d6 && d6.aim ? plotAt(d6.size, q6.view.az, q6.view.el) : null;
  chk('...and the crosshair follows the pose the view shows, a hand turn included: it is at the transform of the view, which is no longer where the phone points',
      !!w6 && dist2(d6.aim, w6) <= 0.15 && Math.abs(S.wrap180(q6.view.az - stP.az)) > 0.5,
      w6 ? 'view ' + n2(q6.view.az) + '° for a phone at ' + n2(stP.az) + '°, crosshair ' + n2(dist2(d6.aim, w6)) + ' px from the transform of the view' : 'no crosshair');

  /* With Align open: the readout gets taller and the radar is lifted over it. */
  await page.click('#ar-alignbtn'); await frames2(page);
  const LA = await radarLayout(page);
  chk('with the Align panel open the readout is taller, and the radar is lifted clear of it: still inside the screen, still under no control',
      !!LA.probeBox && radarInView(LA) && radarClear(LA) && LA.read.h > L.read.h, 'readout ' + n2(L.read.h) + ' → ' + n2(LA.read.h) + ' px tall; radar bottom ' + n2(LA.box.y + LA.box.h)
      + ' vs readout top ' + n2(LA.read.y) + '; ' + (radarWhy(LA) || 'nothing under it'));
  await page.click('#ar-alignbtn');

  /* The Radar button, and what it keeps. */
  const T0 = await page.evaluate(() => { const b = document.getElementById('ar-radarbtn');
    return { label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), row: !!b.closest('.ar-actions') && !!b.closest('.ar-read') }; });
  chk('the Radar button is in the readout\'s row of buttons, and pressed while the radar is shown',
      T0.label === 'Radar' && T0.pressed === 'true' && T0.row, JSON.stringify(T0));
  await page.tap('#ar-radarbtn'); await frames2(page);
  const T1 = await radarLayout(page);
  chk('...tapped, it hides the radar (the canvas, the probe\'s box and what it drew), is no longer pressed, and keeps "0" in gt.arradar',
      T1.hidden && T1.display === 'none' && T1.probeBox === null && T1.draw === null && !T1.on && T1.pressed === 'false' && T1.key === '0', JSON.stringify({ hidden: T1.hidden, box: T1.probeBox, on: T1.on, pressed: T1.pressed, key: T1.key }));
  await page.tap('#ar-radarbtn');
  await until(page, () => { const q = ARView.probe; return q.radar.box && q.radar.draw ? { ok: true } : false; }, null, 5000);
  const T2 = await radarLayout(page), blue2 = T2.draw ? await radarBlue(page, T2.draw.size) : { n: 0 };
  chk('...tapped again it shows it, with the crosshair on it, pressed, and keeps "1"',
      !T2.hidden && !!T2.probeBox && T2.on && T2.pressed === 'true' && T2.key === '1' && blue2.n >= 60,
      JSON.stringify({ hidden: T2.hidden, box: !!T2.probeBox, on: T2.on, pressed: T2.pressed, key: T2.key, blue: blue2.n }));
  await page.tap('#ar-radarbtn'); await frames2(page);
  await closeAR(page); await tapAR(page);
  await until(page, () => ARView.probe.state === 'running', null, 20000); await frames2(page);
  const T3 = await radarLayout(page);
  chk('hidden, then the view closed and opened again: the radar is still hidden, and the button says so',
      T3.state === 'running' && T3.hidden && T3.probeBox === null && !T3.on && T3.pressed === 'false' && T3.key === '0', JSON.stringify({ state: T3.state, hidden: T3.hidden, on: T3.on, pressed: T3.pressed, key: T3.key }));
  await page.tap('#ar-radarbtn');
  await until(page, () => { const q = ARView.probe; return q.radar.box && q.radar.draw ? { ok: true } : false; }, null, 5000);
  const T4 = await radarLayout(page);
  chk('...and shown again for the rest of the checks', !T4.hidden && !!T4.probeBox && T4.on && T4.key === '1');

  /* Before there is a pose, and when the view fails, there is nothing to point with: no radar. */
  await closeAR(page);
  await page.evaluate(() => __feed(null));
  await tapAR(page);
  const NP = await radarLayout(page);
  chk('opened with no reading from the sensors yet, the radar is not there (nothing to point with); the readings come and it is',
      (NP.state === 'asking' || NP.state === 'waiting') && NP.hidden && NP.probeBox === null && NP.draw === null, NP.state + ', hidden ' + NP.hidden + ', box ' + JSON.stringify(NP.probeBox));
  await page.evaluate(() => { const q = ARView.probe; __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 30, 0, q.decl || 0))); });
  await radarReady(page);
  const NP2 = await radarLayout(page);
  chk('...and with the reading in, the radar is there', !NP2.hidden && !!NP2.probeBox && !!NP2.draw && NP2.draw.aim !== null, 'state ' + NP2.state);
  await closeAR(page);
  await page.evaluate(() => { __feed(null); __ar.noOri = true; });
  await tapAR(page);
  await until(page, () => ARView.state === 'failed', null, 10000);
  const FL = await radarLayout(page);
  chk('a view that has failed (a browser with no motion sensors) has no radar, whatever the reader chose',
      FL.state === 'failed' && FL.hidden && FL.probeBox === null && FL.on, FL.state + ', hidden ' + FL.hidden + ', chosen on ' + FL.on);
  await page.evaluate(() => { __ar.noOri = false; ARView.close(); });
  await page.waitForTimeout(100);

  /* The spacecraft below the horizon is not drawn; the next pass is. */
  const pre = await page.evaluate(() => {
    const D = __gt.D, P = D.passes, q = ARView.probe;
    let k = P.findIndex(p => p.t0ms > q.ms + 10*60000);
    if(k < 0) k = P.findIndex(p => p.t1ms < q.ms - 10*60000 && p.t0ms - 5*60000 >= D.start.getTime());
    if(k < 0) return null;
    const t = P[k].t0ms - 5*60000, idx = Math.round((t - D.start.getTime())/1000/D.step);
    const r = document.getElementById('time'); r.value = idx; r.dispatchEvent(new Event('input', { bubbles: true }));
    return { k };
  });
  await frames2(page);
  await page.evaluate(() => __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 30, 0, 0))));
  await tapAR(page);
  await radarReady(page);
  const q7 = await probe(page), d7 = q7.radar.draw, st7 = await satNow(page);
  const pp = await page.evaluate(ms => { const p = __gt.D.passes.find(p => p.t1ms >= ms); return p ? { maxAz: p.maxAz, maxEl: p.maxEl, t0: p.t0ms } : null; }, q7.ms);
  const top7 = pp && d7 ? plotAt(d7.size, pp.maxAz, pp.maxEl) : null, px7 = top7 ? await radarPx(page, [top7]) : [null];
  chk('five minutes before a pass the spacecraft is below the horizon and has no dot on the radar, and the pass it is about to fly is drawn',
      !!pre && st7.el < 0 && !!d7 && d7.craft === null && d7.pass === true && !!pp && pp.t0 > q7.ms && rgbNear(px7[0], RADAR_PASS, 12),
      pre ? 'spacecraft at ' + n2(st7.el) + '°, dot ' + JSON.stringify(d7 && d7.craft) + ', pass drawn ' + (d7 && d7.pass) + ', its top pixel ' + JSON.stringify(px7[0]) : 'the window has no second pass to look before');
  await closeAR(page);
  await downTo(page, best.k, 35);

  /* Held sideways, and on a small phone. */
  for(const th of [90, 270]){
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(t => { __ar.orient = t === 270 ? -90 : 90; }, th);
    const sL = await page.evaluate(t => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
      __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(st.az, 0, t, q.decl || 0))); return st; }, th);
    await tapAR(page);
    await radarReady(page);
    await settle(page);
    const LS = await radarLayout(page), sideS = radarSide(844, 390);
    chk('held sideways (θ ' + th + ') the radar is a square of ' + sideS + ' px at the foot of the screen on the right, clear of the readout column, the Close button and the bars',
        !!LS.probeBox && near(LS.box.w, sideS, 0.01) && radarInView(LS) && radarClear(LS) && radarMid(LS) && near(LS.W - LS.box.x - LS.box.w, 12, 1.5) && near(LS.H - LS.box.y - LS.box.h, 12, 1.5),
        'box ' + [LS.box.x, LS.box.y, LS.box.w, LS.box.h].map(n2).join(' ') + ' on ' + LS.W + 'x' + LS.H + ', readout ends at x ' + n2(LS.read.x + LS.read.w) + '; ' + (radarWhy(LS) || 'nothing under it'));
    /* The crosshair is where the camera's axis points, whichever way up the phone is held: level, at the spacecraft's bearing, which is on the rim. */
    const wantL = plotAt(sideS, sL.az, 0), dL = LS.draw && LS.draw.aim ? dist2(LS.draw.aim, wantL) : Infinity;
    chk('...and its crosshair is where the camera points whichever way up the phone is held: level (0°) at the spacecraft\'s bearing, so on the rim there',
        dL <= 0.3, LS.draw && LS.draw.aim ? 'crosshair ' + n2(LS.draw.aim.x) + ',' + n2(LS.draw.aim.y) + ' vs ' + n2(wantL.x) + ',' + n2(wantL.y) : 'no crosshair drawn');
    /* The pointer's own words, held sideways: the radar is in the corner at the foot on the right, and a spacecraft off the screen towards that
       corner has its arrow slid along the edge to the radar's side and its words held off the radar, as upright. The poses are the spacecraft's
       offset from where the phone points (a negative azimuth offset to the right, a positive elevation offset below); the check is the same as
       the upright one's, and asks that the words came near the radar's box in some pose, so that it is not passed by keeping away from it. */
    const lp = [];
    for(const [da, de] of [[-50, 30], [-70, 30], [-90, 40], [-40, 45], [-50, 45], [-60, 45]]){
      const r = await labelsAt(da, de, th, sL), own = r.labels.filter(l => ownText(r, l));
      lp.push({ da, de, r, own, into: r.box ? own.map(l => intoRadarArt(l, r.box)) : [] });
    }
    const nearBox = (l, b) => l.x0 < b.x + b.w + 6 && l.x1 > b.x - 6 && l.y0 < b.y + b.h + 6 && l.y1 > b.y - 6;
    chk('...and its pointer\'s own words, with the spacecraft off the screen towards the radar\'s corner, are off the radar\'s box and do not lie over what it draws (θ ' + th + '), in any of six poses, and in some they come within 6 px of its box',
        lp.every(p => !!p.r.box && p.own.length >= 1 && p.into.every(k => k <= 0.5) && !p.own.some(l => inRadarBox(l, p.r.box))) && lp.filter(p => p.own.some(l => nearBox(l, p.r.box))).length >= 1,
        lp.map(p => '(' + p.da + ',' + p.de + '): ' + (p.own.map(l => sayL(l) + (p.r.box ? (inRadarBox(l, p.r.box) ? ' is in the radar\'s box' : p.into[p.own.indexOf(l)] > 0.5 ? ' reaches ' + p.into[p.own.indexOf(l)].toFixed(1) + ' px into the radar' : nearBox(l, p.r.box) ? ' clear, near' : ' clear') : ' no radar')).join(' | ') || 'no pointer text')).join('; '));
    await page.click('#ar-alignbtn'); await frames2(page);
    const LS2 = await radarLayout(page);
    await page.click('#ar-alignbtn');
    await until(page, () => ARView.probe.radar.box ? { ok: true } : false, null, 5000);
    const LS3 = await radarLayout(page);
    chk('...with the Align panel open (it takes that corner) the radar gives way and the choice is untouched; closed again it returns',
        LS2.hidden && LS2.probeBox === null && LS2.on && LS2.key === '1' && !LS3.hidden && !!LS3.probeBox && radarClear(LS3),
        'open: hidden ' + LS2.hidden + ', box ' + JSON.stringify(LS2.probeBox) + '; closed: box ' + (LS3.probeBox ? 'back' : 'none'));
    await closeAR(page);
  }
  /* Small phones, held upright: it is left out where there is no room for it between the bars and the readout, and where it is shown it is under
     no control. Which of the two a phone gets is not asserted (it follows the readout's wrapping); that it is never both is. */
  await page.evaluate(() => { __ar.orient = 0; });
  const smalls = [];
  for(const [w, h] of [[320, 568], [375, 667]]){
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { const q = ARView.probe; __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 30, 0, q.decl || 0))); });
    await tapAR(page);
    await until(page, () => ARView.probe.state === 'running', null, 20000); await frames2(page);
    const A = await radarLayout(page);
    await page.click('#ar-alignbtn'); await frames2(page);
    const B = await radarLayout(page);
    await page.click('#ar-alignbtn');
    smalls.push({ w, h, A, B });
    await closeAR(page);
  }
  const okSm = (L, w, h) => (L.probeBox ? !L.hidden && radarInView(L) && radarClear(L) && radarMid(L) && near(L.box.w, radarSide(w, h), 0.01) : L.hidden && L.draw === null);
  const saySm = L => L.probeBox ? 'shown, ' + (radarWhy(L) || 'clear') : 'hidden (no room)';
  chk('on small phones (320x568, 375x667) the radar is either clear of every control and bar and off the middle of the sky, or not shown at all, never over one; with Align open too',
      smalls.every(s => okSm(s.A, s.w, s.h) && okSm(s.B, s.w, s.h)),
      smalls.map(s => s.w + 'x' + s.h + ' (radar ' + radarSide(s.w, s.h) + ' px): ' + saySm(s.A) + '; Align open: ' + saySm(s.B)).join(' | '));
  await page.setViewportSize({ width: 390, height: 844 });

  /* Nothing the radar did read the camera's picture, and the browser keeps only the reader's choice. */
  const pics = await page.evaluate(() => __ar.pictures.slice());
  chk('the radar never touched the camera\'s picture: the census of draws, reads and captures of it is empty after all of the above (the radar canvas\'s own pixels were read, which is not flagged)',
      pics.length === 0, pics.length ? [...new Set(pics)].join(', ') : 'nothing in the census');
  const keys1 = await page.evaluate(() => Object.keys(localStorage));
  const wrote = keys1.filter(k => !keys0.includes(k));
  chk('...and the only thing it left in the browser is gt.arradar, the reader\'s choice', wrote.length === 1 && wrote[0] === 'gt.arradar', 'written: ' + (wrote.join(', ') || 'nothing'));
  console.log('\n  page errors (radar): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* An iPhone before it has found north: its azimuth means nothing, so the radar has the pass and the spacecraft and no crosshair; it comes with the
   bearing, and goes again when the page is left and the bearing is lost. */
async function radarIOS(browser, port){
  const { ctx, page, errs } = await phone(browser, port);
  await atBestPass(page);
  await tapAR(page);
  const C = 137;
  await page.evaluate(c => { const a = __aimAt(0, 10, 0, 0); __feed({ type: 'deviceorientation', a: (a.a + c) % 360, b: a.b, g: a.g, h: 0, acc: 10 }); }, C);
  await until(page, () => { const q = ARView.probe; return q.state === 'finding' && q.drawn.horizon && q.radar.box && q.radar.draw ? { ok: true } : false; }, null, 20000);
  const f0 = await probe(page), d0 = f0.radar.draw, st0 = await satNow(page);
  if(d0){
    const top = await page.evaluate(() => { const p = __gt.D.passes.find(p => p.t1ms >= ARView.probe.ms); return { az: p.maxAz, el: p.maxEl }; });
    const px = await radarPx(page, [plotAt(d0.size, top.az, top.el), plotAt(d0.size, st0.az, st0.el)]), blue = await radarBlue(page, d0.size);
    chk('an iPhone that has not found north: the radar is there with the pass and the spacecraft, and no crosshair (its azimuth means nothing yet)',
        f0.state === 'finding' && f0.radar.on && !!f0.radar.box && d0.aim === null && d0.pass === true && d0.craft !== null && dist2(d0.craft, plotAt(d0.size, st0.az, st0.el)) <= 0.05
        && rgbNear(px[0], RADAR_PASS, 12) && rgbNear(px[1], RADAR_PASS, 12) && blue.n === 0,
        f0.state + ', crosshair ' + JSON.stringify(d0.aim) + ', pass ' + d0.pass + ', dot ' + JSON.stringify(d0.craft) + ', pass top pixel ' + JSON.stringify(px[0]) + ', dot pixel ' + JSON.stringify(px[1]) + ', ' + blue.n + ' blue pixels');
  } else chk('an iPhone that has not found north: the radar is there with the pass and the spacecraft, and no crosshair (its azimuth means nothing yet)', false, f0.state + ', nothing drawn');
  await page.evaluate(c => __feed({ type: 'deviceorientation', a: (330 + c) % 360, b: 30, g: 0, h: 30, acc: 10 }), C);
  await until(page, () => ARView.probe.settled && ARView.state === 'running', null, 20000);
  await page.evaluate(c => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms), a = __aimAt(st.az, st.el, 0, q.decl || 0);
    __feed({ type: 'deviceorientation', a: (a.a + c) % 360, b: a.b, g: a.g, h: 200, acc: 10 }); }, C);
  await until(page, () => { const q = ARView.probe; return q.marker && Math.hypot(q.marker.x - q.cx, q.marker.y - q.cy) < 1 ? { ok: true } : false; }, null, 10000);
  await settle(page); await frames2(page);
  const f1 = await probe(page), d1 = f1.radar.draw;
  if(d1 && d1.aim && d1.craft){
    const w1 = plotAt(d1.size, f1.view.az, f1.view.el), blue = await radarBlue(page, d1.size);
    chk('...with the bearing taken the crosshair comes, at the transform of the view, and held up at the spacecraft it is on the dot',
        f1.state === 'running' && dist2(d1.aim, w1) <= 0.15 && dist2(d1.aim, d1.craft) <= 0.5 && blue.n >= 60 && dist2(blue, d1.aim) <= 0.4,
        f1.state + ', crosshair ' + n2(dist2(d1.aim, w1)) + ' px from the transform of the view, ' + n2(dist2(d1.aim, d1.craft)) + ' px from the dot, ' + blue.n + ' blue pixels');
  } else chk('...with the bearing taken the crosshair comes, at the transform of the view, and held up at the spacecraft it is on the dot', false, f1.state + ', crosshair ' + JSON.stringify(d1 && d1.aim));
  await page.evaluate(() => { __ar.vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { __ar.vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await until(page, () => /^Finding north again/.test(ARView.probe.message), null, 2500);
  await frames2(page);
  const f2q = await probe(page), d2 = f2q.radar.draw;
  chk('...and coming back to the page, the bearing lost, the crosshair goes again while the pass and the spacecraft stay',
      /^Finding north again/.test(f2q.message) && !!f2q.radar.box && !!d2 && d2.aim === null && d2.pass === true && d2.craft !== null,
      '"' + f2q.message.slice(0, 30) + '…", crosshair ' + JSON.stringify(d2 && d2.aim) + ', pass ' + (d2 && d2.pass));
  const key = await page.evaluate(() => localStorage.getItem('gt.arradar'));
  chk('...and opening and using an iPhone\'s view wrote no gt.arradar', key === null, 'gt.arradar ' + JSON.stringify(key));
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (radar, iPhone): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* A reader who had hidden the radar on an earlier visit: the choice is read from storage, and anything but "0" means shown. */
async function radarKept(browser, port){
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { __ar.camera = 'canvas'; localStorage.setItem('gt.arradar', '0'); });
  await atBestPass(page);
  await page.evaluate(() => __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 30, 0, 0))));
  await tapAR(page);
  await until(page, () => ARView.probe.state === 'running', null, 20000); await frames2(page);
  const K0 = await radarLayout(page);
  chk('a phone whose storage holds gt.arradar = "0" starts with the radar hidden, and the button says so',
      K0.state === 'running' && K0.hidden && K0.probeBox === null && !K0.on && K0.pressed === 'false' && K0.key === '0', JSON.stringify({ state: K0.state, hidden: K0.hidden, on: K0.on, pressed: K0.pressed, key: K0.key }));
  await page.tap('#ar-radarbtn');
  await until(page, () => { const q = ARView.probe; return q.radar.box && q.radar.draw ? { ok: true } : false; }, null, 5000);
  const K1 = await radarLayout(page);
  chk('...and the button brings it, and the choice is kept as "1"', !K1.hidden && !!K1.probeBox && K1.on && K1.pressed === 'true' && K1.key === '1', JSON.stringify({ hidden: K1.hidden, on: K1.on, pressed: K1.pressed, key: K1.key }));
  await closeAR(page);
  await page.evaluate(() => localStorage.setItem('gt.arradar', 'no'));
  await tapAR(page);
  await radarReady(page);
  const K2 = await radarLayout(page);
  chk('...a stored value that is not "0" is not a choice to hide it: the radar is shown', !K2.hidden && !!K2.probeBox && K2.on && K2.pressed === 'true', JSON.stringify({ hidden: K2.hidden, on: K2.on, pressed: K2.pressed }));
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (radar, kept): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* The radar's AOS and LOS: starred (AOS*, LOS*) at an end that the analysis window, and not the horizon, cut off, as the main view stars its own.
   The labels are drawn with fillText on the radar's cached layer canvases, which have no id, so they are caught there: by a hook of this part's
   own, on a page of its own (the main view's labels are on #ar-sky and carry times). A pass is cut off at its start when the page opens in the middle
   of it, since the window opens at "now": the clock of that page starts a third of the way into the longest pass of the day. It is cut off at its
   end when the window closes in the middle of it: the window is 24 h, and the clock of that page starts 24 h before the same pass's middle. The
   time slider then takes the view to that pass, the last of the window. */
async function radarEnds(browser, port){
  const first = await phone(browser, port);
  const known = await first.page.evaluate(() => { const D = __gt.D;
    return { name: D.entry.name, win: D.end.getTime() - D.start.getTime(), passes: D.passes.map(p => ({ t0: p.t0ms, t1: p.t1ms })) }; });
  await first.ctx.close();
  let nErr = first.errs.length;
  if(!known.passes.length){
    chk('precondition: the window has a pass for the radar to star the ends of', false, 'the window has none');
    return nErr;
  }
  const long = known.passes.reduce((a, p) => p.t1 - p.t0 > a.t1 - a.t0 ? p : a), dur = long.t1 - long.t0;
  const opened = async (at, slide) => {
    const { ctx, page, errs } = await phone(browser, port, undefined, at);
    await page.evaluate(() => {
      __ar.camera = 'canvas';
      const C = CanvasRenderingContext2D.prototype, fill = C.fillText;
      window.__ends = [];
      C.fillText = function(t){ if(this.canvas.id !== 'ar-sky' && /^(AOS|LOS)\*?$/.test(t)) window.__ends.push(t); return fill.apply(this, arguments); };
    });
    const D = await page.evaluate(slide => {
      const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click();
      const D = __gt.D, P = D.passes, a = P[0], z = P[P.length - 1];
      if(slide){
        const t = z.t0ms + 0.25*(z.t1ms - z.t0ms), r = document.getElementById('time');
        r.value = Math.round((t - D.start.getTime())/1000/D.step); r.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return { name: D.entry.name, n: P.length, a: { t0: a.t0ms, t1: a.t1ms, clipA: a.clipA, clipL: a.clipL }, z: { t0: z.t0ms, t1: z.t1ms, clipA: z.clipA, clipL: z.clipL } };
    }, slide);
    await frames2(page);
    await page.evaluate(() => __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 30, 0, 0))));
    await tapAR(page);
    await radarReady(page);
    await frames2(page);
    const got = await page.evaluate(() => ({ labels: [...new Set(__ends)], pass: !!(ARView.probe.radar.draw && ARView.probe.radar.draw.pass) }));
    await page.evaluate(() => { __feed(null); ARView.close(); });
    nErr += errs.length;
    await ctx.close();
    return Object.assign(D, got);
  };
  const A = await opened(long.t0 + 0.3*dur, false), Z = await opened(long.t0 + 0.5*dur - known.win, true);
  const say = (c, k) => c.name + ', ' + c.n + ' passes, ' + (k === 'a' ? 'first' : 'last') + ' ' + (c[k].clipA ? 'cut at its start' : 'whole at its start') + ', ' + (c[k].clipL ? 'cut at its end' : 'whole at its end');
  chk('precondition: opened in the middle of a pass, the window\'s first pass is cut off at its start only, and the radar draws a pass',
      A.name === known.name && A.a.clipA && !A.a.clipL && near(A.a.t1, long.t1, 5000) && A.pass, say(A, 'a') + '; the radar ' + (A.pass ? 'draws a pass' : 'draws none'));
  chk('a pass the window opened in the middle of has its start starred on the radar, AOS*, and its end, at the horizon, plain: LOS',
      A.labels.includes('AOS*') && A.labels.includes('LOS') && !A.labels.includes('AOS') && !A.labels.includes('LOS*'), 'drawn: ' + (A.labels.join(' ') || 'nothing'));
  chk('precondition: opened a day before the same pass, the window closes in the middle of it: the last pass is cut off at its end only',
      Z.name === known.name && Z.z.clipL && !Z.z.clipA && near(Z.z.t0, long.t0, 5000) && Z.pass, say(Z, 'z') + '; the radar ' + (Z.pass ? 'draws a pass' : 'draws none'));
  chk('...and a pass the window closed in the middle of has its end starred on the radar, LOS*, and its start, at the horizon, plain: AOS',
      Z.labels.includes('LOS*') && Z.labels.includes('AOS') && !Z.labels.includes('LOS') && !Z.labels.includes('AOS*'), 'drawn: ' + (Z.labels.join(' ') || 'nothing'));
  console.log('\n  page errors (radar, ends of a pass): ' + (nErr ? nErr : 'none'));
  return nErr;
}

/* The radar's height above the readout does not bob. The readout's lines re-wrap: at 375 px the Target row is a line longer when the pointer's
   words are on it, which they are while the spacecraft is off the screen, and a line shorter when it is back. The radar rises with the readout's top
   at once, so that it never covers the text, and does not drop back when the readout shrinks by a line or two (40 px at most): it would bob under
   the eye of the reader who is bringing the crosshair onto the spacecraft. A drop of more than that, the Align panel closing, it follows. The phone
   is swept from aimed at the spacecraft to turned right round from it and back, and the radar's box and the readout's top are read at each step. */
async function radarHold(browser, port){
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  const best = await atBestPass(page);
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await downTo(page, best.k, 12);
  await page.setViewportSize({ width: 375, height: 667 });
  const st = await satNow(page);
  await page.evaluate(([az, el]) => __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(az, el, 0, 0))), [st.az, st.el]);
  await tapAR(page);
  await radarReady(page);
  await camLive(page);
  /* Resolves once the Target row has the pointer's words that the view says it is showing, or has lost the ones it had. */
  const targetFollows = prev => until(page, ([prev]) => { const q = ARView.probe, t = document.getElementById('ar-target').textContent;
    return (q.pointer && q.pointer.text ? t.endsWith(q.pointer.text) : !prev || !t.includes(prev)) ? { ok: true } : false; }, [prev], 5000);
  const gap = L => L.read.y - (L.box.y + L.box.h);
  const sweep = [];
  let words = '';
  for(const da of [0, 30, 60, 90, 120, 60, 30, 0]){
    await onAim(page, st.az + da, st.el);
    await targetFollows(words);
    await frames2(page);
    const L = await radarLayout(page), q = await probe(page);
    words = q.pointer && q.pointer.text || '';
    sweep.push({ da, L, read: L.read, box: L.probeBox ? L.box : null, words });
  }
  const steps = sweep.slice(1).map((s, i) => ({ from: sweep[i].da, to: s.da, dTop: s.read.y - sweep[i].read.y, dBox: s.box && sweep[i].box ? s.box.y - sweep[i].box.y : null }));
  const grew = steps.filter(k => k.dTop < -5), shrank = steps.filter(k => k.dTop > 5);
  chk('precondition: swept off the spacecraft and back, the readout grows (the Target row wraps round the pointer\'s words) and shrinks, and the radar is there throughout',
      grew.length >= 1 && shrank.length >= 1 && sweep.every(s => s.box), 'readout top by step: ' + sweep.map(s => s.da + '° ' + n2(s.read.y)).join(', ')
      + '; grew at ' + grew.map(k => k.from + '→' + k.to).join(' ') + ', shrank at ' + shrank.map(k => k.from + '→' + k.to).join(' '));
  chk('...a readout that shrinks by a line does not let the radar down: each time it did, the radar\'s box has not moved down at all (never by less than 41 px)',
      shrank.length >= 1 && shrank.every(k => k.dTop <= 40 && k.dBox !== null && !(k.dBox > 0.5 && k.dBox < 41)),
      shrank.map(k => k.from + '→' + k.to + ': readout down ' + n2(k.dTop) + ' px, radar ' + (k.dBox === null ? 'gone' : n2(k.dBox) + ' px down')).join('; '));
  chk('...a readout that grows lifts it at once, so that it is never over the text: the first time, by as much as the readout rose, and at every step 8 px or more above the readout and under no control',
      grew.length >= 1 && grew[0].dBox !== null && grew[0].dBox <= grew[0].dTop + 1.5 && sweep.every(s => s.box && gap(s.L) >= 7 && radarClear(s.L) && radarInView(s.L)),
      'first rise: readout up ' + (grew.length ? n2(-grew[0].dTop) : '-') + ' px, radar ' + (grew.length && grew[0].dBox !== null ? n2(-grew[0].dBox) : '-') + ' px up; gap to the readout ' + sweep.map(s => s.box ? n2(gap(s.L)) : 'none').join(', '));
  /* The Align panel opened and shut: the readout falls by far more than 40 px, and the radar goes down with it. At 375x667 it gives way while
     Align is open (there is no room), and at 390x844 it stays and is lifted. */
  const cycle = async () => {
    const a = await radarLayout(page);
    await page.click('#ar-alignbtn'); await frames2(page);
    const b = await radarLayout(page);
    await page.click('#ar-alignbtn');
    await until(page, () => ARView.probe.radar.box ? { ok: true } : false, null, 5000);
    await frames2(page);
    return { a, b, c: await radarLayout(page) };
  };
  const sizes = [{ w: 375, h: 667, cy: await cycle() }];
  await closeAR(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await tapAR(page);
  await radarReady(page);
  await frames2(page);
  sizes.push({ w: 390, h: 844, cy: await cycle() });
  chk('...and when Align is opened and shut the radar follows the readout down again: it is back within 8 + 40 px above it, at 375x667 and at 390x844',
      sizes.every(s => s.cy.b.read.h > s.cy.a.read.h + 100 && !!s.cy.c.probeBox && gap(s.cy.c) >= 7 && gap(s.cy.c) <= 48),
      sizes.map(s => s.w + 'x' + s.h + ': readout ' + n2(s.cy.a.read.h) + ' → ' + n2(s.cy.b.read.h) + ' → ' + n2(s.cy.c.read.h) + ' px tall, radar open: '
        + (s.cy.b.probeBox ? 'shown' : 'hidden') + ', shut again: ' + (s.cy.c.probeBox ? n2(gap(s.cy.c)) + ' px above the readout' : 'not shown')).join('; '));
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (radar, holding its height): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* A phone on London time under Bangkok's sky says so on a status line of four or five lines at 375 px, and with Align open on a short phone the
   readout leaves almost no sky between the bars and itself. The radar had been left out only where it had no room above the readout, counted from the
   foot of the status box; on a squeezed view the page widens the safe rectangle to the whole screen, and the radar was counted from the top of it
   and drawn under the status box, exactly where there was least room. Now it is left out there. Which of hidden and shown a phone gets is the
   page's to say, within this: shown, it is clear of every bar and control; hidden, there was no room. */
async function radarLondon(browser, port){
  const rows = [];
  let nErr = 0;
  for(const [w, h] of [[375, 667], [360, 640]]){
    const { ctx, page, errs } = await phone(browser, port, { timezoneId: 'Europe/London' });
    await page.evaluate(() => { __ar.camera = 'canvas'; });
    const best = await atBestPass(page);
    await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
    await downTo(page, best.k, 12);
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 30, 0, 0))));
    await tapAR(page);
    await until(page, () => ARView.probe.state === 'running' && /^The sky is drawn from Bangkok/.test(ARView.probe.message), null, 20000);
    await radarReady(page);
    await frames2(page);
    const A = await radarLayout(page);
    await page.click('#ar-alignbtn'); await frames2(page);
    const B = await radarLayout(page);
    await page.click('#ar-alignbtn');
    rows.push({ w, h, A, B });
    await page.evaluate(() => { __feed(null); ARView.close(); });
    nErr += errs.length;
    await ctx.close();
  }
  /* The radar's top edge if it were drawn, where the page puts it: its foot 8 px above the readout. And the foot of the bars. */
  const wouldBe = (L, w, h) => L.read.y - 8 - radarSide(w, h);
  const barsFoot = L => Math.max(L.top.y + L.top.h, L.status ? L.status.y + L.status.h : 0) + 8;
  const okSm = (L, w, h) => !!L.status && L.status.h >= 70 && (L.probeBox
    ? !L.hidden && radarInView(L) && radarClear(L) && near(L.box.w, radarSide(w, h), 0.01)
    : L.hidden && L.draw === null && wouldBe(L, w, h) < barsFoot(L) + 1.5);
  const saySm = (L, w, h) => 'status ' + (L.status ? n2(L.status.y) + '..' + n2(L.status.y + L.status.h) + ' (' + Math.round((L.status.h - 18)/18.75) + ' lines)' : 'none') + ', readout top ' + n2(L.read.y) + ': '
    + (L.probeBox ? 'radar shown at ' + n2(L.box.y) + '..' + n2(L.box.y + L.box.h) + ', ' + (radarWhy(L) || 'clear of every bar and control')
      : 'radar hidden (it would have been at ' + n2(wouldBe(L, w, h)) + ', the bars end at ' + n2(barsFoot(L)) + ')');
  chk('a phone on London time under Bangkok\'s sky (a status of four or five lines), at 375x667 and 360x640: the radar is never under the status box or any bar or control; hidden where there is no room, clear of them all where it is shown',
      rows.every(r => okSm(r.A, r.w, r.h)), rows.map(r => r.w + 'x' + r.h + ': ' + saySm(r.A, r.w, r.h)).join(' | '));
  chk('...and with Align open, which takes almost all the sky between the bars and the readout, just the same',
      rows.every(r => okSm(r.B, r.w, r.h) && r.B.read.h > r.A.read.h + 100), rows.map(r => r.w + 'x' + r.h + ', Align open (readout ' + n2(r.B.read.h) + ' px tall): ' + saySm(r.B, r.w, r.h)).join(' | '));
  console.log('\n  page errors (radar, London time): ' + (nErr ? nErr : 'none'));
  return nErr;
}

/* A phone held sideways, on a 667x375 screen in sim time (the clock off the present, so that Go live shows): Go live, Radar and Align are three
   buttons in a column of 203 px. They had wrapped onto two rows, and the column grew some 46 px up over the top bar. The landscape rule now closes
   the buttons up (a 4 px gap, 8 px of padding at the sides, no letter spacing) so that they fit one row, each still 40 px or more high. A phone of
   844x390 with Go live and Try again as well is not held to one row: it wraps, by design. */
async function radarSideways(browser, port){
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  const best = await atBestPass(page);
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await downTo(page, best.k, 12);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.evaluate(() => { __ar.orient = 90; });
  const st = await satNow(page);
  await page.evaluate(([az]) => { const q = ARView.probe; __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(az, 0, 90, q.decl || 0))); }, [st.az]);
  await tapAR(page);
  await radarReady(page);
  await settle(page); await frames2(page);
  const R = await page.evaluate(() => {
    const rc = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const id = i => document.getElementById(i);
    return { live: rc(id('ar-live')), radar: rc(id('ar-radarbtn')), align: rc(id('ar-alignbtn')), col: rc(document.querySelector('.ar-read')), dl: rc(document.querySelector('.ar-dl')),
      liveShown: !id('ar-live').hidden && id('ar-live').getBoundingClientRect().width > 0, sim: id('arview').hasAttribute('data-sim'),
      topFoot: Math.max(...[...document.querySelector('.ar-top').children].map(c => c.getBoundingClientRect().bottom)), W: ARView.probe.W, H: ARView.probe.H };
  });
  const row = [R.live, R.radar, R.align];
  chk('precondition: held sideways on a 667x375 screen in sim time, the readout is a column and Go live is shown, with Radar and Align',
      R.W === 667 && R.H === 375 && R.sim && R.liveShown && R.col.w < R.W*0.5 && R.radar.w > 0 && R.align.w > 0,
      'screen ' + R.W + 'x' + R.H + ', sim ' + R.sim + ', Go live ' + (R.liveShown ? 'shown' : 'hidden') + ', column ' + n2(R.col.w) + ' px wide');
  chk('held sideways on 667x375 in sim time, Go live, Radar and Align are one row of the column: the same top within 1 px, in that order, inside the column, each button 40 px high or more',
      near(R.live.y, R.radar.y, 1) && near(R.radar.y, R.align.y, 1) && R.live.x < R.radar.x && R.radar.x < R.align.x
      && row.every(b => b.h >= 39.99 && b.x >= R.col.x - 0.5 && b.x + b.w <= R.col.x + R.col.w + 0.5),
      row.map((b, i) => ['Go live', 'Radar', 'Align'][i] + ' ' + n2(b.x) + ',' + n2(b.y) + ' ' + n2(b.w) + 'x' + n2(b.h)).join('; ') + '; column ' + n2(R.col.x) + '..' + n2(R.col.x + R.col.w));
  /* The column's top is its box, and that has 12 px of padding above its first line, so that a long Clock row, which is three lines in this column,
     can put the box a few px above the lowest thing in the top bar and still leave the text clear. A second row of buttons put it some 46 px higher. */
  chk('...and the column has not grown up over the top bar: its box begins within 24 px of the lowest thing in the bar and its first line below it (a second row of buttons would put it 44 px higher)',
      R.col.y >= R.topFoot - 24 && R.dl.y >= R.topFoot - 10,
      'column top ' + n2(R.col.y) + ', first line ' + n2(R.dl.y) + ', the top bar\'s lowest child ends at ' + n2(R.topFoot) + (R.col.y < R.topFoot ? ' (the column\'s box reaches ' + n2(R.topFoot - R.col.y) + ' px into the bar\'s own padding: a long Clock row)' : ''));
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (radar, held sideways): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* ---- a phone in London, with the observer still in Bangkok ----------------- */
async function partLondon(browser, port){
  console.log('\nPart B — a phone that is not where the observer is\n');
  const { ctx, page, errs } = await phone(browser, port, { timezoneId: 'Europe/London',
    permissions: ['camera', 'geolocation'], geolocation: { latitude: 51.5074, longitude: -0.1278, accuracy: 25 } });
  /* Anything the page sends anywhere that has where this phone is in it: the fix is 51.5074, -0.1278, and the observer typed in below is
     51.5, -0.12, which has no further digit to match. */
  const sent = [];
  page.on('request', r => { if(/51\.5\d|0\.12\d/.test(r.url() + (r.postData() || ''))) sent.push(r.url()); });
  /* What this phone's own offset from UTC is on the day the page runs on: +1 while London keeps summer time, and the page names it. */
  const lonOff = zoneHours('Europe/London', AT);
  /* The phone is fed a pose from before the tap. With none, the view gives up
     3 s after the prompts ("no motion sensor"), and everything below - two
     moves of the observer and a location request - had to finish inside those
     3 s for the last check to see Use my location's answer and not that. */
  await page.evaluate(() => __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 20, 0, 0))));
  const entry0 = await page.evaluate(() => navigation.currentEntry.index);
  const kept0 = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage).map(k => 'session:' + k)));
  await tapAR(page);
  await until(page, () => ARView.probe.state === 'running', null, 15000);
  const a = await probe(page);
  /* The warning follows the observer, not the request that moved it: a Use my
     location answer that lands after the view has been closed and opened again
     moves the observer all the same, and the warning must go with it. Moved
     here by the page's own applySite, with the view open; the readout sees a
     move at its next quarter-second tick. */
  await page.evaluate(tz => { window.__obs0 = Object.assign({}, __gt.OBS);
    __gt.applySite({ lat: 51.5, lon: -0.12, altKm: 0, name: 'London', tz }, false); }, lonOff);
  await until(page, () => !/^The sky is drawn from/.test(ARView.probe.message), null, 5000);
  const moved = await probe(page);
  await page.evaluate(() => __gt.applySite(__obs0, false));
  await until(page, () => /^The sky is drawn from Bangkok/.test(ARView.probe.message), null, 5000);
  const back = await probe(page);
  chk('...the warning follows the observer however it moves: gone for London, back for Bangkok',
      !/^The sky is drawn from/.test(moved.message) && /^The sky is drawn from Bangkok/.test(back.message),
      '"' + moved.message.slice(0, 40) + '…" then "' + back.message.slice(0, 40) + '…"');
  await page.tap('#ar-here');
  await page.waitForFunction(() => __gt.OBS.name === 'My location', null, { timeout: 20000 }).catch(() => null);
  /* The answer is said, and the declination and the title written, by the
     view once it has the site; read them when all three are there. */
  await page.evaluate(() => { window.__hereNow = () => ({ msg: ARView.probe.message, lat: __gt.OBS.lat,
    decl: document.getElementById('ar-decl').textContent, title: document.getElementById('ar-title').textContent, D: ARView.probe.decl }); });
  const b = await until(page, () => { const s = __hereNow();
    return /accurate to about/.test(s.msg) && s.title === 'Sky over My location' && s.D !== null
      && s.decl === s.D.toFixed(1) + '° E, applied' ? s : false; }, null, 10000)
    || await page.evaluate(() => __hereNow());
  chk('the sky is Bangkok\'s while the phone keeps London time: said, with the way out',
      a.message.startsWith('The sky is drawn from Bangkok, and this phone keeps UTC+' + lonOff + ' — '), '"' + a.message.slice(0, 60) + '…"');
  chk('...Use my location moves the observer to the phone and works out London\'s declination',
      near(b.lat, 51.5074, 1e-6) && /accurate to about 25 m\.$/.test(b.msg) && b.title === 'Sky over My location'
      && b.D > 0.5 && b.decl === b.D.toFixed(1) + '° E, applied', b.decl + ' | "' + b.msg + '"');
  /* The rebuilt page writes the observer into the address bar (?site=) so that a link reproduces the view, which the old page never did.
     A position the device itself gave is the one place that must not be written there: history, bookmarks and share sheets would carry it. */
  const bar = await page.evaluate(() => ({ href: location.href, state: JSON.stringify(history.state), name: __gt.OBS.name }));
  chk('...and the position is kept as the observer, not written into the address bar or the history entry',
      bar.name === 'My location' && !/[?&]site=/.test(bar.href) && !/51\.5\d|0\.12\d/.test(bar.href + bar.state), bar.href + ' ' + bar.state);
  await page.evaluate(() => { __feed(null); ARView.close(); });
  // the view's own history entry went with it, though the observer moved while it was open
  const left = await until(page, e => navigation.currentEntry.index === e ? { here: true } : false, entry0, 5000)
    ? 0 : await page.evaluate(e => navigation.currentEntry.index - e, entry0);
  chk('...closing it after the observer moved leaves the page on the history entry it opened from', left === 0,
      left === 0 ? 'back where it began' : left + ' entries past the start');
  /* The address rewritten while the view is open. None of the above does it: Bangkok is home, and the page writes only a site that is not,
     so the address has no site in it to lose. Typed in as another place, the observer is in the address bar; Use my location then takes it
     out, under the open view, by replacing the entry the view's own Back entry sits on, and Close has to find that entry still its own. */
  await H.setSite(page, { name: 'Cape Town', lat: -33.9249, lon: 18.4241, alt: 0, tz: 2 });
  await H.closeSiteForm(page);
  await page.waitForFunction(() => __gt.OBS.name === 'Cape Town' && __gt.D && __gt.D.entry, null, { timeout: 20000 }).catch(() => null);
  // the old page never wrote an address, so there is nothing for the site to be in there
  const inBar = await until(page, isNew => !isNew || /[?&]site=/.test(location.href) ? { href: location.href } : false, NEW, 5000);
  chk('precondition: the observer typed in is in the address bar, where the rebuilt page keeps it', !!inBar,
      inBar ? inBar.href : 'no site= in ' + await page.evaluate(() => location.href));
  const entry1 = await page.evaluate(() => navigation.currentEntry.index);
  await page.evaluate(() => __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(90, 20, 0, 0))));
  await tapAR(page);
  await until(page, () => ARView.probe.state === 'running', null, 15000);
  await page.tap('#ar-here');
  await page.waitForFunction(() => __gt.OBS.name === 'My location', null, { timeout: 20000 }).catch(() => null);
  const rewritten = await until(page, () => __gt.OBS.name === 'My location' && !/[?&]site=/.test(location.href)
    ? { href: location.href, state: JSON.stringify(history.state) } : false, null, 5000)
    || await page.evaluate(() => ({ href: location.href, state: JSON.stringify(history.state) }));
  chk('...Use my location, with the view open, takes the site out of the address bar and puts the phone\'s position in neither it nor the history entry',
      !/[?&]site=/.test(rewritten.href) && !/51\.5\d|0\.12\d/.test(rewritten.href + rewritten.state), rewritten.href + ' ' + rewritten.state);
  await page.evaluate(() => { __feed(null); ARView.close(); });
  const left1 = await until(page, e => navigation.currentEntry.index === e ? { here: true } : false, entry1, 5000)
    ? 0 : await page.evaluate(e => navigation.currentEntry.index - e, entry1);
  chk('...and closing the view over an address that was rewritten under it leaves the page on the history entry it opened from', left1 === 0,
      left1 === 0 ? 'back where it began' : left1 + ' entries past the start');
  chk('...and nothing the page sent, while all this went on, carried where the phone is', sent.length === 0,
      sent.length ? sent.join(' ') : 'no request had it');
  // the sensor's readings are not kept: what the view and Use my location leave in the browser is the lens, the saved site and the places list
  const kept = (await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage).map(k => 'session:' + k)))).filter(k => !kept0.includes(k));
  chk('...and the browser was left holding only the saved site and the places list: the sensors\' readings are not kept',
      kept.every(k => k === 'obs-site' || k === 'obs-recent' || k === 'gt.arlens'), 'written: ' + (kept.join(', ') || 'nothing'));
  console.log('\n  page errors (London): ' + (errs.length ? errs.join(' | ') : 'none'));
  const n = errs.length;
  await ctx.close();
  return n;
}

/* ---- a phone with no WebGL ---------------------------------------------------
 * The globe falls back to the flat map, and its camera row used to go with it
 * whole - the AR button too, though the AR view draws its own sky on a 2D
 * canvas and needs no WebGL. */
async function partNoGL(port){
  console.log('\nPart B — a phone with no WebGL\n');
  const browser = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await startClock(await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, permissions: ['camera'], timezoneId: 'Asia/Bangkok' }));
  await ctx.addInitScript(MOCKS);
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for(const u of BLOCK) await page.route(u, r => r.abort());
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.__gt && window.__gt.D && window.ARView, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const g = await page.evaluate(isNew => {
    const b = document.getElementById('arbtn'), r = b.getBoundingClientRect();
    const h = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    const fb = document.getElementById('o3fallback'), seg = document.querySelector('.camseg .seg'), tab = document.querySelector('.stage [role=tab][aria-selected=true]');
    return { gl: !!(window.Orbit3D && Orbit3D.ok()),
             // the old page says so over the globe; the rebuilt page opens the map instead, with the note on the globe's own tab
             fallback: isNew ? !!fb && !!tab && /^Map/.test(tab.textContent.trim()) : !!fb && !fb.hidden,
             w: r.width, reach: !!h && (h === b || b.contains(h)),
             // the old page hides the camera group; the rebuilt page does not draw it
             seg: seg ? getComputedStyle(seg).display : 'none' };
  }, NEW);
  let ran = null;
  if(g.w){
    await atBestPass(page);
    await tapAR(page);
    await aimSat(page, 0, true);
    await settle(page);
    ran = await probe(page);
    await page.evaluate(() => { __feed(null); ARView.close(); });
  }
  chk('with no WebGL the camera modes go with the globe, and AR stays, in reach',
      !g.gl && g.fallback && g.seg === 'none' && g.w > 0 && g.reach, 'WebGL ' + g.gl + ', button ' + g.w.toFixed(0) + ' px wide, reach ' + g.reach);
  chk('...and the view it opens works: the spacecraft in the middle',
      ran && ran.state === 'running' && ran.marker && Math.hypot(ran.marker.x - ran.cx, ran.marker.y - ran.cy) < 1.5,
      ran ? ran.state : 'not opened');
  console.log('\n  page errors (no WebGL): ' + (errs.length ? errs.join(' | ') : 'none'));
  await browser.close();
  return errs.length;
}

/* ======================================================================
 * Part C - the desktop, loaded the way snapshot.js loads it
 * ==================================================================== */
async function partC(browser){
  console.log('\nPart C — a desktop, over http\n');
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await startClock(page.context());
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for(const u of BLOCK) await page.route(u, r => r.abort());
  const __srv = await H.up();
  await page.goto(__srv.page);
  await page.waitForFunction(() => window.__gt && window.__gt.D, null, { timeout: 60000 });
  const d = await page.evaluate(isNew => {
    const cams = [...document.querySelectorAll('.camseg .cam')];
    return { shown: getComputedStyle(document.getElementById('arbtn')).display !== 'none',
      g: [typeof WMM, typeof SkyAR, typeof ARView].join(' '),
      pressed: cams.filter(c => c.getAttribute('aria-pressed') === 'true').length,
      // the group's rounded end, as in B1
      endR: getComputedStyle(isNew ? document.querySelector('.camseg .seg') : cams[cams.length - 1]).borderTopRightRadius };
  }, NEW);
  chk('no AR button without a touch screen; the camera row is as it was', !d.shown && d.pressed === 1 && d.endR === END_R,
      "one pressed, the group's end radius " + d.endR + ' (want ' + END_R + ')');
  chk('...the three new scripts load, and nothing throws while the page does', d.g === 'object object object' && !errs.length,
      d.g + (errs.length ? '; ' + errs.join(' | ') : ''));
  await page.close();
  return errs.length;
}

(async () => {
  partA();
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  let errs = 0;
  try {
    /* GT_AR_ONLY=radar runs the radar's part alone, in about half the time of the whole suite: for working on it. A full run is the one that counts. */
    const only = process.env.GT_AR_ONLY;
    if(only && (only !== 'radar' || !NEW)) throw new Error('GT_AR_ONLY can only be "radar", and only for the rebuilt page (GT_TARGET=new), not "' + only + '"');
    if(!only){
      errs += await partB(browser, port);
      errs += await partIOS(browser, port);
    }
    if(NEW && (!only || only === 'radar')) errs += await partRadar(browser, port);
    if(!only){
      errs += await partLondon(browser, port);
      errs += await partNoGL(port);
      errs += await partC(browser);
    }
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\npage errors: ' + (errs ? errs : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  process.exit(fails || errs ? 1 : 0);
})();
