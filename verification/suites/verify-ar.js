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
 * its own, after the iPhone's (partRadar). It can also be opened with no camera at all, as a radar of its own, aimed by the camera or by the phone's head
 * (partRadarView), and its four tools (Snap, Aim, Radar, Align) have a layout of their own. Part C loads the page the way
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
 *   node verification/suites/verify-ar.js        (needs playwright)
 *   GT_TARGET=new GT_AR_AT=2026-10-05T00:00Z node verification/suites/verify-ar.js
 *   GT_AR_ONLY=radar node verification/suites/verify-ar.js       (just the radar's part of the rebuilt page's view, after Part A)
 *   GT_AR_ONLY=radarview node verification/suites/verify-ar.js   (just the radar view, the aim switch and the tools' layout, after Part A)
 *   GT_AR_FN=rvTools,rvAim node verification/suites/verify-ar.js  (just those functions, for working on them)
 */
const H = require('../lib/harness');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = H.playwright();

const ROOT = path.join(__dirname, '..', '..');
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
   The coefficients embedded in wmm.js must be verification/fixtures/WMM.COF to the
   character, and every row of NOAA's WMM2025_TestValues.txt must come out,
   its columns read from its own "# Field n:" lines rather than assumed. D and
   I are printed to 0.01 deg and held to 0.006. The nT columns are printed to
   1e-6 nT: Y and Z agree to a few 1e-6 nT, but NOAA's X - and H and F through
   it - differs from an exact evaluation by up to 7e-4 nT, two parts in 10^8 of
   the north component alone, which is the generator's and not the model's, so
   they are held to 0.001 nT. */
function wmmChecks(){
  const root = ROOT, W = WMM;

  const cof = fs.readFileSync(path.join(root, 'verification', 'fixtures', 'WMM.COF'), 'utf8').replace(/\r\n/g, '\n');
  chk('the coefficients embedded in wmm.js are verification/fixtures/WMM.COF, character for character',
      W.coefficientText === cof, W.coefficientText.length + ' and ' + cof.length + ' characters');
  const rows = W.coefficients(), order = [];
  for (let n = 1; n <= 12; n++) for (let m = 0; m <= n; m++) order.push(n + ',' + m);
  chk('...and parse to the 90 rows of degree and order 12, in n, m order',
      rows.length === 90 && rows.every((r, i) => r.n + ',' + r.m === order[i]),
      rows.length + ' rows, ' + W.model + ', epoch ' + W.epoch.toFixed(1) + ', valid to ' + W.validTo.toFixed(1));

  /* The test file's columns, by the names and units it gives them. */
  const lines = fs.readFileSync(path.join(root, 'verification', 'fixtures', 'WMM2025_TestValues.txt'), 'utf8').split(/\r?\n/);
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

/* A phone held sideways, on a 667x375 screen in sim time (the clock off the present, so that Go live shows). The readout's column was 203 px, and Go live, Radar
   and Align, three buttons in it, wrapped onto two rows and grew it some 46 px up over the top bar, so the landscape rule closed the buttons up to fit one row.
   The four tools (Snap, Aim, Radar, Align) have since gone up into the top bar there, between the title and Close (a screen 640 px wide or more, held
   sideways), and the column keeps Go live and the readout: the two checks that asserted the three buttons in one row of the column are rewritten for that
   (rvTools has the rest of the sizes, live and in sim time, and the radar view). A phone of 844x390 with Go live and Try again as well is not held to one
   row of the column: it wraps, by design. */
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
    return { live: rc(id('ar-live')), snap: rc(id('ar-snap')), aim: rc(id('ar-aimbtn')), radar: rc(id('ar-radarbtn')), align: rc(id('ar-alignbtn')), close: rc(id('ar-close')),
      here: rc(id('ar-here')), col: rc(document.querySelector('.ar-read')), dl: rc(document.querySelector('.ar-dl')),
      liveShown: !id('ar-live').hidden && id('ar-live').getBoundingClientRect().width > 0, sim: id('arview').hasAttribute('data-sim'),
      topFoot: Math.max(...[...document.querySelector('.ar-top').children].map(c => c.getBoundingClientRect().bottom)), W: ARView.probe.W, H: ARView.probe.H };
  });
  const row = [R.snap, R.aim, R.radar, R.align];
  chk('precondition: held sideways on a 667x375 screen in sim time, the readout is a column and Go live is shown, with the four tools',
      R.W === 667 && R.H === 375 && R.sim && R.liveShown && R.col.w < R.W*0.5 && row.every(b => b.w > 0),
      'screen ' + R.W + 'x' + R.H + ', sim ' + R.sim + ', Go live ' + (R.liveShown ? 'shown' : 'hidden') + ', column ' + n2(R.col.w) + ' px wide');
  /* Rewritten: this was "Go live, Radar and Align are one row of the column" (the same top within 1 px, in that order, inside the column, each 40 px high or more).
     The tools are now one row in the top bar, in that order, right of the title block's lowest edge (Use my location) and left of Close, none in the column,
     and Go live is alone in the column's foot. */
  chk('held sideways on 667x375 in sim time, the four tools - Snap, Aim, Radar, Align - are one row up in the top bar, in that order, between the title block and Close and out of the column, each 40 px high or more, and Go live is in the column',
      row.slice(1).every(b => near(b.y, row[0].y, 1)) && row[0].x < row[1].x && row[1].x < row[2].x && row[2].x < row[3].x
      && row.every(b => b.h >= 39.99 && b.x >= R.here.x + R.here.w && b.x >= R.col.x + R.col.w && b.x + b.w <= R.close.x && b.y >= 0 && b.y + b.h <= R.H)
      && R.live.x >= R.col.x - 0.5 && R.live.x + R.live.w <= R.col.x + R.col.w + 0.5 && R.live.y > row[0].y,
      row.map((b, i) => ['Snap', 'Aim', 'Radar', 'Align'][i] + ' ' + n2(b.x) + ',' + n2(b.y) + ' ' + n2(b.w) + 'x' + n2(b.h)).join('; ') + '; Go live ' + n2(R.live.x) + ',' + n2(R.live.y) + '; Use my location ends ' + n2(R.here.x + R.here.w) + ', Close starts ' + n2(R.close.x) + '; column ' + n2(R.col.x) + '..' + n2(R.col.x + R.col.w));
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

/* ======================================================================================================================
 * The radar view, the aim switch and the layout of the tools (the rebuilt page only)
 *
 * The same full-screen controller opens in a second mode from a "Radar" button beside AR, with no camera: only the motion sensors are asked for,
 * the picture and the sky drawn over it are not there, and the radar is the page, sized to the room between the top bar and the readout. A second
 * button, "Aim: camera" / "Aim: head", chooses what the radar's crosshair follows: the camera out of the back, or the phone's head out of its top
 * edge. And the four tools (Snap, Aim, Radar, Align) share a row, in the readout's column held upright, or up in the top bar held sideways on a
 * screen 640 px wide or more. (Snap's own checks are in verify-ar-snap.js.)
 *
 * What is asserted is worked out here and not read from the page's source: the plot's transform with its unit (R = side/2 - 15u, u =
 * clamp(side/156, 1, 2.2)), the words a person is steered by (turn right 30° · up 12°), and above all the head's direction, which is derived
 * from the W3C angles themselves: the device's +y axis in East-North-Up for the rotation Rz(alpha) Rx(beta) Ry(gamma) is
 * [-sin(alpha) cos(beta), cos(alpha) cos(beta), sin(beta)], the camera's is minus the device's z. The compass heading of a phone laid flat is
 * 360 - alpha (alpha grows counter-clockwise), not alpha: its head, held flat at alpha 90, points west.
 * ==================================================================================================================== */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap180 = a => ((((a + 180) % 360) + 360) % 360) - 180;
const plotU = side => clamp(side/156, 1, 2.2);
/* Where a direction falls on a plot of this side, in CSS px from the canvas's top left (the unit u scales the inset: R = side/2 - 15u). */
const plotAtU = (side, az, el) => {
  const u = plotU(side), R = side/2 - 15*u, e = clamp(el, 0, 90), r = R*(90 - e)/90;
  return { x: side/2 + r*Math.sin(az*RAD), y: side/2 - r*Math.cos(az*RAD) };
};
const COMPASS16 = az => ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round((((az % 360) + 360) % 360)/22.5) % 16];
const enuOf = (az, el) => [Math.cos(el*RAD)*Math.sin(az*RAD), Math.cos(el*RAD)*Math.cos(az*RAD), Math.sin(el*RAD)];
/* The angle between two directions, in degrees. */
const apart = (a, b) => { const x = enuOf(a.az, a.el), y = enuOf(b.az, b.el); return Math.acos(clamp(x[0]*y[0] + x[1]*y[1] + x[2]*y[2], -1, 1))*DEG; };
const azElOf = v => ({ az: (Math.atan2(v[0], v[1])*DEG + 360) % 360, el: Math.asin(clamp(v[2], -1, 1))*DEG });
/* The head (the device's +y) and the camera (minus the device's z), in East-North-Up, from the W3C angles alone. */
const headOf = (alpha, beta) => { const A = alpha*RAD, B = beta*RAD; return azElOf([-Math.sin(A)*Math.cos(B), Math.cos(A)*Math.cos(B), Math.sin(B)]); };
const cameraOf = (alpha, beta, gamma) => {
  const A = alpha*RAD, B = beta*RAD, G = gamma*RAD;
  return azElOf([-(Math.cos(A)*Math.sin(G) + Math.sin(A)*Math.sin(B)*Math.cos(G)), -(Math.sin(A)*Math.sin(G) - Math.cos(A)*Math.sin(B)*Math.cos(G)), -Math.cos(B)*Math.cos(G)]);
};
/* The words the readout steers by, worked out here: right or left by the azimuth difference ("turn round" past 170°), up or down by the elevation difference, each
   from 2° and rounded to a degree. (Past 70° up or down the page names a bearing instead, which is not asked of this.) */
const steerWords = (aim, at) => {
  const dAz = wrap180(at.az - aim.az), dEl = at.el - aim.el, parts = [];
  if(Math.abs(dAz) > 170) parts.push('turn round');
  else if(Math.abs(dAz) >= 2) parts.push('turn ' + (dAz > 0 ? 'right' : 'left') + ' ' + Math.round(Math.abs(dAz)) + '°');
  if(Math.abs(dEl) >= 2) parts.push((dEl > 0 ? 'up ' : 'down ') + Math.round(Math.abs(dEl)) + '°');
  return parts.join(' · ');
};
/* The phone fed a pose that points the camera at (az, el), upright (th 0) or sideways; the same, from the W3C angles themselves. */
const feedAim = (page, az, el, th) => page.evaluate(([az, el, th]) => { const q = ARView.probe;
  __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(az, el, th, q.decl || 0))); }, [az, el, th || 0]);
const feedAngles = (page, a, b, g) => page.evaluate(([a, b, g]) => { const q = ARView.probe;
  __feed({ type: 'deviceorientationabsolute', a: (((a + (q.decl || 0)) % 360) + 360) % 360, b, g }); }, [a, b, g]);
/* Resolves once the view has stopped (its lag under 0.005°) with what it aims along (the camera's or the head's, probe.aimView) within `tol` degrees of `want`. */
const aimSettled = (page, want, tol, ms) => until(page, ([w, tol]) => {
  const q = ARView.probe, a = q.aimView; if(!a || q.lag === null || q.lag >= 0.005) return false;
  const R = Math.PI/180, u = (az, el) => [Math.cos(el*R)*Math.sin(az*R), Math.cos(el*R)*Math.cos(az*R), Math.sin(el*R)], x = u(a.az, a.el), y = u(w.az, w.el);
  const off = Math.acos(Math.max(-1, Math.min(1, x[0]*y[0] + x[1]*y[1] + x[2]*y[2])))/R;
  return off <= tol ? { off } : false;
}, [want, tol], ms || 10000);
/* Every pixel of the sky canvas that is not transparent: the canvas is copied into one of this check's own (the census does not mind a canvas being
   drawn onto another, and does not see the copy's pixels), so reading it is not a read of #ar-sky. */
const skyInk = page => page.evaluate(() => {
  const s = document.getElementById('ar-sky'), c = document.createElement('canvas'); c.width = s.width; c.height = s.height;
  const g = c.getContext('2d'); g.drawImage(s, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
  for(let i = 3; i < d.length; i += 4) if(d[i]) n++;
  return { n, w: c.width, h: c.height };
});
/* The rectangles of some elements by id, and whether each is laid out (a box at all) and on the screen. */
const rectsOf = (page, ids) => page.evaluate(ids => {
  const o = { W: ARView.probe.W, H: ARView.probe.H };
  for(const id of ids){
    const e = document.getElementById(id) || document.querySelector(id);
    if(!e){ o[id] = null; continue; }
    const b = e.getBoundingClientRect(), cs = getComputedStyle(e);
    const hit = b.width ? document.elementFromPoint(b.left + b.width/2, b.top + b.height/2) : null;
    o[id] = { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom, shown: b.width > 0 && b.height > 0 && cs.display !== 'none', disp: cs.display,
              reach: !!hit && (hit === e || e.contains(hit)), text: e.textContent.trim() };
  }
  return o;
}, ids);

/* ---- the button: offered like AR, and only where AR is ---------------------------------------------------------------- */
/* A touch laptop's primary pointer is fine, whatever else it has: Chromium gives a context with touch (pointer: coarse), so the question the page
   asks is answered here the way a laptop would answer it. */
const FINE_POINTER = () => {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => /^\s*\(pointer:\s*coarse\)\s*$/.test(q)
    ? { matches: false, media: q, onchange: null, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){ return false; } } : mm(q);
};
async function rvOffer(browser, port){
  console.log('\nPart B — the radar button\n');
  const { ctx, page, errs } = await phone(browser, port);
  const geo = () => page.evaluate(() => {
    const id = i => document.getElementById(i), rc = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const b = id('radarbtn'), a = id('arbtn'), q = rc(b), p = rc(a), home = rc(document.querySelector('.stage [role=tablist]')), below = document.querySelector('.below'), l = rc(below);
    const hit = (e, r) => { const h = document.elementFromPoint(r.x + r.w/2, r.y + r.h/2); return !!h && (h === e || e.contains(h)); };
    return { shown: !b.hidden && getComputedStyle(b).display !== 'none' && q.w > 0, q, p, l, home,
      inside: q.x >= home.x - 0.5 && q.r <= home.r + 0.5 && q.y >= home.y - 0.5 && q.b <= home.b + 0.5,
      reach: hit(b, q), reachAr: hit(a, p), reachLink: hit(below, l), over: __over(b), overAr: __over(a), overLink: __over(below), sw: document.documentElement.scrollWidth,
      label: b.textContent.trim(), aria: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'), controls: b.getAttribute('aria-controls') };
  });
  for(const [w, h] of [[320, 568], [360, 740], [390, 844], [768, 1024]]){
    await page.setViewportSize({ width: w, height: h });
    await frames2(page);
    const g = await geo();
    chk('the Radar button on a ' + w + ' px touch screen: offered, in the row of the stage\'s tabs, beside AR and clear of it, of the Report link and of the tabs, each of the two at least 44 px, and a tap at its centre reaches it',
        g.shown && g.inside && g.reach && !g.over.length && g.q.w >= 43.99 && g.q.h >= 43.99 && g.p.w >= 43.99 && g.p.h >= 43.99
        && Math.abs(g.q.y - g.p.y) <= 1 && g.q.r <= g.p.x - 4 + 0.01 && g.reachAr && !g.overAr.length,
        'Radar ' + n2(g.q.w) + 'x' + n2(g.q.h) + ' at ' + n2(g.q.x) + ',' + n2(g.q.y) + ', AR ' + n2(g.p.w) + 'x' + n2(g.p.h) + ' at ' + n2(g.p.x) + (g.over.length ? '; Radar is crossed by ' + g.over.join(', ') : '')
        + (g.overAr.length ? '; AR is crossed by ' + g.overAr.join(', ') : '') + (g.reach ? '' : '; a tap at its centre misses it'));
    chk('...and the Report link and the tabs beside it are not crossed by anything, at ' + w + ' px (the link gives up room for the new button: 60 px; nothing scrolls sideways)',
        !g.overLink.length && g.reachLink && g.sw <= w, 'link ' + n2(g.l.x) + '..' + n2(g.l.r) + ', Radar from ' + n2(g.q.x) + (g.overLink.length ? '; the link is crossed by ' + g.overLink.join(', ') : '') + ', page ' + g.sw + ' px wide');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const lab = await geo();
  chk('...named for what it is: the text "Radar", an accessible name that begins with it, a dialog popup for the view',
      lab.label === 'Radar' && /^Radar/.test(lab.aria) && lab.popup === 'dialog' && lab.controls === 'arview', JSON.stringify({ label: lab.label, aria: lab.aria, popup: lab.popup, controls: lab.controls }));
  await H.showMap(page);
  const onMap = await geo();
  await H.showGlobe(page);
  chk('...and it is still there, and in reach, with the map showing', onMap.shown && onMap.reach && onMap.inside);
  const nErr = errs.length;
  console.log('\n  page errors (radar button): ' + (nErr ? errs.join(' | ') : 'none'));
  await ctx.close();

  /* Not on a desktop (a fine pointer), and not on a touch laptop either: a control context with touch shows it, so what hides it in the others is the
     pointer, and the wait for it is the control's own, doubled. */
  const visit = async (opts, mock) => {
    const c = await startClock(await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Bangkok' }, opts)));
    if(mock) await c.addInitScript(mock);
    const p = await c.newPage(), e = [];
    p.on('pageerror', x => e.push(x.message));
    for(const u of BLOCK) await p.route(u, r => r.abort());
    await p.goto('http://127.0.0.1:' + port + '/index.html');
    await p.waitForFunction(() => window.__gt && window.__gt.D, null, { timeout: 60000 });
    return { c, p, e };
  };
  const state = p => p.evaluate(() => { const b = document.getElementById('radarbtn'), a = document.getElementById('arbtn');
    const on = x => !!x && !x.hidden && getComputedStyle(x).display !== 'none' && x.getBoundingClientRect().width > 0;
    return { radar: on(b), ar: on(a), exists: !!b, coarse: matchMedia('(pointer: coarse)').matches, any: matchMedia('(any-pointer: coarse)').matches }; });
  const t0 = Date.now();
  const ctl = await visit({ hasTouch: true });
  const shown = await until(ctl.p, () => { const b = document.getElementById('radarbtn'); return !!b && !b.hidden && b.getBoundingClientRect().width > 0 ? { ok: true } : false; }, null, 20000);
  const ctlMs = Date.now() - t0, ctlSt = await state(ctl.p);
  await ctl.c.close();
  const wait = Math.max(3000, 2*ctlMs);
  const dsk = await visit({}), dskSt = await (async () => { await dsk.p.waitForTimeout(wait); return state(dsk.p); })(); await dsk.c.close();
  const lap = await visit({ hasTouch: true }, FINE_POINTER), lapSt = await (async () => { await lap.p.waitForTimeout(wait); return state(lap.p); })(); await lap.c.close();
  chk('precondition: a context with a touch screen is offered the Radar button and AR (so that what hides them below is the pointer)',
      !!shown && ctlSt.radar && ctlSt.ar && ctlSt.coarse, 'after ' + ctlMs + ' ms: Radar ' + ctlSt.radar + ', AR ' + ctlSt.ar + ', (pointer: coarse) ' + ctlSt.coarse);
  chk('the Radar button is not offered on a desktop (a fine pointer), where AR is not either: the node is in the page, hidden',
      dskSt.exists && !dskSt.radar && !dskSt.ar && !dskSt.coarse, 'Radar ' + dskSt.radar + ', AR ' + dskSt.ar + ', (pointer: coarse) ' + dskSt.coarse + ', after ' + wait + ' ms');
  chk('...nor on a touch laptop, whose primary pointer is fine though it has a touch screen (any-pointer: coarse): hidden with AR, after ' + wait + ' ms',
      lapSt.exists && lapSt.any && !lapSt.coarse && !lapSt.radar && !lapSt.ar, 'Radar ' + lapSt.radar + ', AR ' + lapSt.ar + ', (any-pointer: coarse) ' + lapSt.any + ', (pointer: coarse) ' + lapSt.coarse);
  return nErr + ctl.e.length + dsk.e.length + lap.e.length;
}

/* ---- a phone's tap on Radar never asks for the camera ---------------------------------------------------------------- */
async function rvCamera(browser, port){
  console.log('\nPart B — the radar view never asks for the camera\n');
  /* The browser's own fake camera is behind getUserMedia (camera 'real'): had the view asked, it would have been answered, and a stream would be in the log. */
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { window.__seen = { camera: new Set(), msg: new Set() };
    setInterval(() => { try { const q = ARView.probe; __seen.camera.add(q.camera); __seen.msg.add(q.message); } catch(e){} }, 25); });
  const cleanUp = () => page.evaluate(() => { __feed(null); ARView.close(); Object.assign(__ar, { motion: 'granted', camera: 'real', noCam: false, noOri: false, insecure: false }); __ar.calls.length = 0; __ar.streams.length = 0; });
  await feedAim(page, 90, 30);
  await page.tap('#radarbtn');
  const asked = await page.evaluate(() => ({ calls: __ar.calls.slice(), open: !document.getElementById('arview').hidden, mode: document.getElementById('arview').dataset.mode }));
  await radarReady(page);
  await onAim(page, 90, 30);
  await page.waitForTimeout(1500);
  const v = await page.evaluate(() => { const vid = document.getElementById('ar-video'), q = ARView.probe;
    return { calls: __ar.calls.map(c => c.what), streams: __ar.streams.length, src: vid.srcObject, disp: getComputedStyle(vid).display, camera: [...__seen.camera], msgs: [...__seen.msg].filter(m => /camera/i.test(m)),
      probeCamera: q.camera, mode: q.mode, state: q.state }; });
  chk('one tap on Radar asks for the motion sensors, alone, and the click is the current event: window.__ar.calls is exactly one entry, "motion" (requestPermission(true)), with no "camera" after it',
      asked.open && asked.mode === 'radar' && asked.calls.length === 1 && asked.calls[0].what === 'motion' && asked.calls[0].evt === 'click' && asked.calls[0].arg === true && v.calls.length === 1,
      'right after the tap: ' + asked.calls.map(c => c.what + '(' + c.evt + (c.what === 'motion' ? ', ' + c.arg : '') + ')').join(' then ') + '; a second and a half on: ' + v.calls.join(' then '));
  chk('...no stream was ever given out, the video has no source and is not displayed, probe.camera stayed "off" through the whole opening, and no line of the status mentioned a camera',
      v.streams === 0 && v.src === null && v.disp === 'none' && v.camera.every(c => c === 'off') && v.msgs.length === 0 && v.state === 'running',
      v.streams + ' streams, srcObject ' + v.src + ', display ' + v.disp + ', camera states seen: ' + v.camera.join(', ') + (v.msgs.length ? '; status said: ' + v.msgs.join(' | ') : ''));
  const ink = await skyInk(page);
  await cleanUp();
  /* The control: the same page, the same pose, opened as AR asks for both and draws the sky. */
  await feedAim(page, 90, 30);
  await page.tap('#arbtn');
  await until(page, () => ARView.probe.state === 'running', null, 20000);
  await onAim(page, 90, 30);
  const arCalls = await page.evaluate(() => __ar.calls.map(c => c.what + ':' + c.evt));
  const arInk = await skyInk(page);
  chk('...and the sky canvas has nothing drawn on it in the radar view (every pixel transparent), where the AR view\'s has the sky (the control: the AR tap asks for the camera second)',
      ink.w > 0 && ink.n === 0 && arInk.n > 1000 && arCalls.join() === 'motion:click,camera:click', 'radar view ' + ink.n + ' of ' + ink.w*ink.h + ' px drawn, AR view ' + arInk.n + '; AR tap: ' + arCalls.join(' then '));
  await cleanUp();

  /* The iPhone's order: requestPermission is there (it is, in this mock, whatever the browser), and the request is made synchronously in the click: the log has
     it before the click returns. */
  const sync = await page.evaluate(() => { __ar.calls.length = 0; document.getElementById('radarbtn').click();
    const now = __ar.calls.map(c => c.what + ':' + c.evt + ':' + c.arg); return { now, open: !document.getElementById('arview').hidden }; });
  await page.waitForTimeout(500);
  const later = await page.evaluate(() => __ar.calls.map(c => c.what));
  chk('on an iPhone (requestPermission present) the tap makes the motion request synchronously, inside the click: it is in the log before the click returns, and the camera never follows',
      sync.open && sync.now.length === 1 && sync.now[0] === 'motion:click:true' && later.length === 1, 'when click() returned: ' + sync.now.join(' then ') + '; half a second on: ' + later.join(' then '));
  await cleanUp();
  const nothing = await page.evaluate(() => { __ar.motion = 'absent'; document.getElementById('radarbtn').click(); return __ar.calls.map(c => c.what); });
  await feedAim(page, 90, 30);
  await until(page, () => ARView.probe.state === 'running', null, 10000);
  const none = await page.evaluate(() => ({ calls: __ar.calls.map(c => c.what), streams: __ar.streams.length, state: ARView.probe.state }));
  chk('...and in a browser with nothing to ask (Firefox, Samsung Internet) it asks for nothing at all: no motion request, no camera, and the view runs',
      nothing.length === 0 && none.calls.length === 0 && none.streams === 0 && none.state === 'running', 'calls ' + (none.calls.join(' then ') || 'none') + ', ' + none.state);
  await cleanUp();

  /* Try again: while the motion prompt is declined, and after it is allowed, the camera is still never asked for. */
  const tries = [];
  for(const mode of ['denied', 'reject']){
    await page.evaluate(m => { __ar.motion = m; __ar.calls.length = 0; }, mode);
    await page.tap('#radarbtn');
    await until(page, () => ARView.probe.state === 'failed', null, 10000);
    const f = await page.evaluate(() => ({ state: ARView.probe.state, reason: ARView.probe.reason, retry: document.getElementById('ar-retry').textContent, shown: !document.getElementById('ar-retry').hidden, calls: __ar.calls.map(c => c.what + ':' + c.evt) }));
    await page.evaluate(() => { __ar.calls.length = 0; });
    await page.tap('#ar-retry');                                           // still refused
    await page.waitForTimeout(400);
    const again = await page.evaluate(() => ({ state: ARView.probe.state, calls: __ar.calls.map(c => c.what + ':' + c.evt) }));
    await page.evaluate(() => { __ar.motion = 'granted'; __ar.calls.length = 0; });
    await page.tap('#ar-retry');                                           // allowed
    await feedAim(page, 90, 30);
    await until(page, () => ARView.probe.state === 'running', null, 10000);
    const ok = await page.evaluate(() => ({ state: ARView.probe.state, calls: __ar.calls.map(c => c.what + ':' + c.evt), streams: __ar.streams.length, camera: ARView.probe.camera }));
    tries.push({ mode, f, again, ok });
    await cleanUp();
  }
  chk('Try again after a declined motion prompt (denied, or a lost gesture) asks for the motion sensors again inside its own tap, refused once more and then allowed, and never for the camera: the view then runs with no stream and the camera "off"',
      tries.every(t => t.f.state === 'failed' && t.f.shown && t.f.calls.join() === 'motion:click' && t.again.calls.join() === 'motion:click' && t.again.state === 'failed'
        && ok1(t.ok)) && tries[0].f.retry === 'Try again' && tries[1].f.retry === 'Allow motion sensors',
      tries.map(t => t.mode + ': "' + t.f.retry + '" ' + t.f.calls.join(' ') + ', again ' + t.again.calls.join(' ') + ', allowed ' + t.ok.calls.join(' ') + ' → ' + t.ok.state + ', ' + t.ok.streams + ' streams, camera ' + t.ok.camera).join('; '));
  /* the census, as at the end of the radar part's: nothing here drew, read or captured the camera's picture */
  const pics = await page.evaluate(() => __ar.pictures.slice());
  chk('...and nothing in the radar view\'s opening, using, failing or retrying drew, read or captured a picture: the census is empty', pics.length === 0, pics.length ? [...new Set(pics)].join(', ') : 'nothing in the census');
  console.log('\n  page errors (radar view, no camera): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}
const ok1 = o => o.state === 'running' && o.calls.join() === 'motion:click' && o.streams === 0 && o.camera === 'off';

/* ---- the radar is the page ------------------------------------------------------------------------------------------- */
/* The room the radar has, worked out here from where the bars, the readout and the Align panel are: nothing between the bars' foot and the readout's top upright,
   and beside the readout (and the Align panel, when it is open) held sideways. The page keeps a few px of margin all round, so the plot's side is held to the
   room less 28 px, which is the margin twice and a little, where a radar half as big, or one that did not fill the room, is more than that short. */
const roomOf = (L, align) => {
  const barsFoot = Math.max(L.top.y + L.top.h, L.status ? L.status.y + L.status.h : 0), beside = L.read.w < L.W*0.75;
  const left = beside ? L.read.x + L.read.w : 0, right = align && align.w && align.x > L.read.x + L.read.w - 1 ? align.x : L.W;
  const top = barsFoot, bottom = beside ? L.H : L.read.y;
  return { left, right, top, bottom, beside, barsFoot, side: Math.min(right - left, bottom - top, 420) };
};
const alignRect = page => page.evaluate(() => { const a = document.getElementById('ar-align'), b = a.getBoundingClientRect();
  return a.hidden || !b.width ? null : { x: b.left, y: b.top, w: b.width, h: b.height }; });
/* A radar view that is open, and drawn, with the phone aimed along (az, el) (th: the screen's turn). */
const rvOpenAt = async (page, az, el, th) => {
  await feedAim(page, az, el, th);
  await page.tap('#radarbtn');
  await radarReady(page);
  return onAim(page, az, el, th);
};
const rvClose = async page => { await page.evaluate(() => ARView.close()); await page.waitForTimeout(100); };
const rvSetScreen = async (page, w, h, orient) => { await page.setViewportSize({ width: w, height: h }); await page.evaluate(o => { __ar.orient = o; }, orient || 0); };

async function rvLayout(browser, port){
  console.log('\nPart B — the radar is the page\n');
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  const best = await atBestPass(page);
  chk('precondition: the window has a pass to draw on the radar', !!best, best ? best.name + ', pass ' + best.k + ' at ' + best.maxEl.toFixed(1) + '°' : 'none');
  if(!best){ await ctx.close(); return errs.length; }
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await downTo(page, best.k, 35);
  const keys0 = await page.evaluate(() => Object.keys(localStorage));

  /* 390x844: what the view says it is, and where the radar is. */
  await rvOpenAt(page, 300, 50);
  const id0 = await page.evaluate(() => { const root = document.getElementById('arview'), cs = e => getComputedStyle(e);
    return { title: document.getElementById('ar-title').textContent, mode: root.dataset.mode, dt: document.getElementById('ar-view').previousElementSibling.textContent,
      radarBtn: cs(document.getElementById('ar-radarbtn')).display, lens: cs(document.querySelector('.ar-lens')).display, fov0: cs(document.getElementById('ar-fov0')).display,
      video: cs(document.getElementById('ar-video')).display, north: document.getElementById('ar-north').getBoundingClientRect().width,
      decl: document.getElementById('ar-decl').getBoundingClientRect().width, kind: document.getElementById('ar-kind').textContent, site: document.getElementById('ar-site').textContent }; });
  const L = await radarLayout(page), d = L.draw, side = L.box.w, u = plotU(side), room = roomOf(L, null);
  chk('the radar view says what it is: "Radar over Bangkok", data-mode "radar", the first row of the readout is "Aim" (not "View"), and the lens and the inset\'s Radar switch are not displayed',
      id0.title === 'Radar over Bangkok' && id0.kind === 'Radar' && id0.mode === 'radar' && id0.dt === 'Aim' && id0.radarBtn === 'none' && id0.lens === 'none' && id0.fov0 === 'none' && id0.video === 'none',
      JSON.stringify(id0));
  chk('390x844: the radar is the page: a square between the bars and the readout, centred across the screen, as large as the room allows (280 to 420 px), clear of everything, and its backing store is the screen\'s pixel ratio',
      !L.hidden && L.display !== 'none' && near(L.box.w, L.box.h, 0.01) && side >= 280 && side <= 420.01 && near(L.box.x + side/2, L.W/2, 1) && L.box.y >= room.barsFoot + 7.5 && L.box.y + L.box.h <= L.read.y - 7.5
      && side >= room.side - 28 && !!d && near(d.size, L.box.w, 0.01) && L.bw === Math.round(side*L.dpr) && L.bh === L.bw && radarClear(L) && !L.over.length && L.pe === 'none' && L.hit !== 'ar-radar',
      'box ' + [L.box.x, L.box.y, L.box.w, L.box.h].map(n2).join(' ') + ' on ' + L.W + 'x' + L.H + ' (room ' + n2(room.side) + '; bars end ' + n2(room.barsFoot) + ', readout starts ' + n2(L.read.y) + '), canvas ' + L.bw + 'x' + L.bh + '; ' + (radarWhy(L) || 'nothing under it'));
  chk('...drawn at its own unit: u = clamp(side/156, 1, 2.2) = ' + n2(u) + ', so the horizon ring is at R = side/2 - 15u = ' + n2(side/2 - 15*u) + ' px, centred in the canvas',
      !!d && near(d.R, side/2 - 15*u, 0.01) && near(d.cx, side/2, 0.01) && near(d.cy, side/2, 0.01), d ? 'R ' + n2(d.R) + ', centre ' + n2(d.cx) + ',' + n2(d.cy) : 'nothing drawn');

  /* The disc, from the pixels, at the unit's scale: the ring at R, the glass 8u inside it, clear canvas 5u outside. */
  const R = side/2 - 15*u, cc = side/2;
  const spots = [20, 110, 200, 290].map(a => { const p = (r) => ({ x: cc + r*Math.sin(a*RAD), y: cc - r*Math.cos(a*RAD) }); return { ring: p(R), glass: p(R - 8*u), out: p(R + 5*u) }; });
  const dpx = await radarPx(page, [].concat(...spots.map(s => [s.ring, s.glass, s.out])));
  const ringOk = spots.filter((s, i) => dpx[3*i] && dpx[3*i][0] >= 190 && dpx[3*i][1] >= 190 && dpx[3*i][2] >= 190 && dpx[3*i][3] >= 150).length;
  const glassOk = spots.filter((s, i) => dpx[3*i + 1] && dpx[3*i + 1][3] >= 140 && dpx[3*i + 1][3] <= 175).length;
  const outOk = spots.filter((s, i) => dpx[3*i + 2] && dpx[3*i + 2][3] <= 10).length;
  chk('...the disc is where the plot says at that unit: the horizon ring at R, dark glass 8u inside it, clear canvas 5u outside it (four bearings off the axes)',
      ringOk === 4 && glassOk >= 3 && outOk === 4, 'ring ' + ringOk + '/4, glass ' + glassOk + '/4, outside ' + outOk + '/4');

  /* The blue crosshair, at the transform of where the camera points, drawn at the unit's scale: blue at an arm's middle, not on the far side of the plot, the arm
     (4.5u to 12u from the middle) blue at 11u and not at 14u. */
  const qa = await probe(page), da = qa.radar.draw, wa = da && da.aim ? plotAtU(da.size, qa.view.az, qa.view.el) : null;
  if(wa){
    const a = (qa.view.az + 180)*RAD, opp = { x: da.size/2 + 0.6*da.R*Math.sin(a), y: da.size/2 - 0.6*da.R*Math.cos(a) };
    const px = await radarPx(page, [{ x: wa.x + 8.25*u, y: wa.y }, opp, { x: wa.x + 11*u, y: wa.y }, { x: wa.x + 14*u, y: wa.y }]), blue = await radarBlue(page, da.size);
    chk('the blue crosshair is at the plot\'s transform of where the camera points (300°, 50° up), 0.3 px, blue at its arm, not on the far side, its arm 11u long and no longer, as many blue pixels as a cross that size has',
        !da.aim.clamped && dist2(da.aim, wa) <= 0.3 && dist2(da.aim, plotAtU(da.size, 300, 50)) <= 0.5 && rgbNear(px[0], RADAR_BLUE, 12) && !blueish(px[1]) && rgbNear(px[2], RADAR_BLUE, 12) && !blueish(px[3])
        && blue.n >= 60*u*u/2 && blue.n > 0 && dist2(blue, wa) <= 0.4,
        'drawn ' + n2(da.aim.x) + ',' + n2(da.aim.y) + ' vs ' + n2(wa.x) + ',' + n2(wa.y) + '; arm pixel ' + JSON.stringify(px[0]) + ', at 11u ' + JSON.stringify(px[2]) + ', at 14u ' + JSON.stringify(px[3]) + ', far side ' + JSON.stringify(px[1]) + '; ' + blue.n + ' blue pixels centred ' + n2(dist2(blue, wa)) + ' px off');
  } else chk('the blue crosshair is at the plot\'s transform of where the camera points (300°, 50° up), 0.3 px, blue at its arm, not on the far side, its arm 11u long and no longer, as many blue pixels as a cross that size has', false, 'no crosshair drawn');

  /* The spacecraft's dot, at the transform of the track's azimuth and elevation, solid, and 5.5u across. */
  const st = await satNow(page), ds = qa.radar.draw && qa.radar.draw.craft;
  if(ds){
    const ring = (c, r) => [0, 45, 90, 135, 180, 225, 270, 315].map(k => ({ x: c.x + r*Math.sin(k*RAD), y: c.y - r*Math.cos(k*RAD) }));
    const px = await radarPx(page, [ds].concat(ring(ds, 3.5*u), ring(ds, 8*u)));
    chk('the spacecraft\'s dot is at the plot\'s transform of its own azimuth and elevation (0.05 px) in the pass colour, a solid dot 5.5u across: the pass colour at its middle and all round 3.5u from it, and not the pass colour at 8u from it in most directions (the pass\'s own line crosses it)',
        dist2(ds, plotAtU(qa.radar.draw.size, st.az, st.el)) <= 0.05 && rgbNear(px[0], RADAR_PASS, 12) && px.slice(1, 9).every(p => rgbNear(p, RADAR_PASS, 12)) && px.slice(9).filter(p => rgbNear(p, RADAR_PASS, 12)).length <= 4,
        n2(dist2(ds, plotAtU(qa.radar.draw.size, st.az, st.el))) + ' px off the track\'s; centre ' + JSON.stringify(px[0]) + ', inside ' + px.slice(1, 9).filter(p => rgbNear(p, RADAR_PASS, 12)).length + '/8, outside ' + px.slice(9).filter(p => rgbNear(p, RADAR_PASS, 12)).length + '/8');
  } else chk('the spacecraft\'s dot is at the plot\'s transform of its own azimuth and elevation in the pass colour, a solid dot 5.5u across', false, 'no dot drawn');

  /* The pass's highest point is a ring 3.5u across, with the spacecraft well away from it. */
  const PS = await page.evaluate(k => { const p = __gt.D.passes[k]; return { maxAz: p.maxAz, maxEl: p.maxEl }; }, best.k);
  let hollow = null;
  for(const el of [12, 7, 3]){
    await downTo(page, best.k, el);
    await onAim(page, (PS.maxAz + 180) % 360, 20);
    const q = await probe(page), dd = q.radar.draw;
    if(!(dd && dd.pass && dd.craft)){ hollow = { el, bad: 'pass ' + !!(dd && dd.pass) + ', spacecraft ' + !!(dd && dd.craft) }; continue; }
    const top = plotAtU(dd.size, PS.maxAz, PS.maxEl), away = dist2(dd.craft, top), uu = plotU(dd.size);
    if(away < 12*uu || (dd.aim && (dist2(dd.aim, top) < 14*uu || dist2(dd.aim, dd.craft) < 14*uu))){ hollow = { el, bad: 'the spacecraft is ' + n2(away) + ' px from the top (' + n2(away/uu) + 'u)' }; continue; }
    const at = (c, r, k) => ({ x: c.x + r*Math.sin(k*RAD), y: c.y - r*Math.cos(k*RAD) }), bearings = [...Array(16).keys()].map(i => i*22.5);
    const px = await radarPx(page, bearings.map(k => at(top, 3.5*uu, k)).concat(bearings.map(k => at(top, 1.5*uu, k))));
    hollow = { el, away: away/uu, onRing: px.slice(0, 16).filter(p => rgbNear(p, RADAR_PASS, 12)).length, inside: px.slice(16).filter(p => rgbNear(p, RADAR_PASS, 12)).length };
    break;
  }
  chk('the pass\'s highest point is a ring 3.5u across and hollow (the spacecraft, well away from it, is the one solid dot): the pass colour round the ring (at least 14 of 16 bearings) and not 1.5u from its middle (at most 6 of 16: the pass\'s own line runs through it)',
      !!hollow && !hollow.bad && hollow.onRing >= 14 && hollow.inside <= 6,
      !hollow ? 'no case' : hollow.bad ? hollow.el + '° up: ' + hollow.bad : 'spacecraft ' + hollow.el + '° up, ' + n2(hollow.away) + 'u from the top: ring ' + hollow.onRing + '/16, inside ' + hollow.inside + '/16');
  await downTo(page, best.k, 35);

  /* The words of the control, again: the radar view is the same page. A short phone has North and Declination gone, and the AR view is as it was. */
  const aimed = await page.evaluate(() => document.getElementById('ar-north').getBoundingClientRect().width > 0 && document.getElementById('ar-decl').getBoundingClientRect().width > 0);
  chk('at 390x844 the readout still has its North and Declination rows (the short screens below lose them)', aimed);
  await rvClose(page);

  /* Portrait, smaller and larger. */
  const portrait = [];
  for(const [w, h] of [[375, 667], [320, 568], [360, 740], [768, 1024]]){
    await rvSetScreen(page, w, h, 0);
    await rvOpenAt(page, 300, 50);
    const P = await radarLayout(page), rows = await page.evaluate(() => ['ar-north', 'ar-decl'].map(i => document.getElementById(i).getBoundingClientRect().width > 0));
    const align0 = await alignRect(page);
    await page.click('#ar-alignbtn'); await frames2(page); await frames2(page);
    const PA = await radarLayout(page), alA = await alignRect(page);
    await page.click('#ar-alignbtn');
    portrait.push({ w, h, P, rows, room: roomOf(P, null), PA, roomA: roomOf(PA, alA) });
    await rvClose(page);
  }
  const okPortrait = (p, r) => p.probeBox ? !p.hidden && radarInView(p) && radarClear(p) && p.box.y >= r.barsFoot + 7.5 && p.box.y + p.box.h <= p.read.y - 7.5 && p.box.w >= 96 && near(p.box.w, p.box.h, 0.01) && near(p.box.x + p.box.w/2, p.W/2, 1) && p.box.w <= 420.01 && p.box.w >= r.side - 28
    : p.hidden && p.draw === null && r.side < 96 + 28;
  const sayP = (p, r) => p.probeBox ? 'radar ' + n2(p.box.w) + ' px at ' + n2(p.box.y) + '..' + n2(p.box.y + p.box.h) + ' between ' + n2(r.barsFoot) + ' and ' + n2(p.read.y) + (radarWhy(p) ? ' (' + radarWhy(p) + ')' : '') : 'not shown (room ' + n2(r.side) + ')';
  chk('portrait 375x667 and 320x568 (under 700 px tall): the readout drops North and Declination, so that the plot has the room: not displayed there, and the radar is shown, 96 px or more, centred, clear of the bars, the readout and every control',
      portrait.slice(0, 2).every(p => p.rows.every(r => r === false) && p.P.probeBox && okPortrait(p.P, p.room)),
      portrait.slice(0, 2).map(p => p.w + 'x' + p.h + ': North ' + (p.rows[0] ? 'shown' : 'gone') + ', Declination ' + (p.rows[1] ? 'shown' : 'gone') + ', ' + sayP(p.P, p.room)).join(' | '));
  chk('...with Align open too (the readout taller): still shown or, with no room, left out, never over a bar, the readout or a control; 360x740 (tall enough to keep the two rows) and 768x1024 (a tablet: the plot stops at 420 px) likewise',
      portrait.every(p => okPortrait(p.PA, p.roomA)) && portrait.slice(2).every(p => p.P.probeBox && okPortrait(p.P, p.room) && p.rows.every(r => r)) && portrait[3].P.box.w === 420,
      portrait.map(p => p.w + 'x' + p.h + ': ' + sayP(p.P, p.room) + '; Align open: ' + sayP(p.PA, p.roomA)).join(' | '));

  /* Held sideways: beside the readout's column, and beside the Align panel when it is open. */
  const sideways = [];
  for(const [w, h, th] of [[844, 390, 90], [667, 375, 270], [932, 430, 90]]){
    for(const live of [false, true]){
      if(live && w !== 667) continue;
      await rvSetScreen(page, w, h, th === 270 ? -90 : 90);
      await rvOpenAt(page, 300, 50, th);
      if(live){ await page.click('#ar-live'); await until(page, () => document.getElementById('ar-live').hidden && /^live · /.test(document.getElementById('ar-clock').textContent), null, 8000); await frames2(page); await frames2(page); }
      const P = await radarLayout(page), tools = await rectsOf(page, ['ar-snap', 'ar-aimbtn', 'ar-alignbtn', 'ar-close']);
      await page.click('#ar-alignbtn'); await frames2(page); await frames2(page);
      const PA = await radarLayout(page), alA = await alignRect(page);
      await page.click('#ar-alignbtn');
      sideways.push({ w, h, th, live, P, room: roomOf(P, null), tools, PA, alA, roomA: roomOf(PA, alA) });
      if(live) await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
      await rvClose(page);
    }
  }
  const okSide = (p, r, tools) => p.probeBox ? !p.hidden && radarInView(p) && radarClear(p) && p.box.x >= p.read.x + p.read.w + 11.5 && p.box.y >= r.barsFoot + 7.5 && p.box.w >= 96 && near(p.box.w, p.box.h, 0.01)
      && p.box.w <= 420.01 && p.box.w >= r.side - 28 && !['ar-snap', 'ar-aimbtn', 'ar-alignbtn', 'ar-close'].some(k => tools[k] && tools[k].shown && boxesMeet(p.box, tools[k]))
    : p.hidden && p.draw === null && r.side < 96 + 28;
  const saySd = (p, r) => p.probeBox ? 'radar ' + n2(p.box.w) + ' px at ' + n2(p.box.x) + ',' + n2(p.box.y) + ' (readout column ends ' + n2(p.read.x + p.read.w) + ')' + (radarWhy(p) ? ' (' + radarWhy(p) + ')' : '') : 'not shown (room ' + n2(r.side) + ')';
  chk('held sideways (844x390, 667x375 live and in sim time, 932x430): the radar is right of the readout\'s column, under the top bar, and clear of Close, the tools and the column, as large as the room beside the column allows',
      sideways.every(s => s.P.probeBox && okSide(s.P, s.room, s.tools)),
      sideways.map(s => s.w + 'x' + s.h + (s.live ? ' live' : ' sim') + ': ' + saySd(s.P, s.room)).join(' | '));
  chk('...and with the Align panel open (it takes the lower right) the radar fits between the column and the panel, or is left out where there is not 96 px of room, and is never under either',
      sideways.every(s => okSide(s.PA, s.roomA, s.tools) && (!s.PA.probeBox || !s.alA || s.PA.box.x + s.PA.box.w <= s.alA.x - 11.5)),
      sideways.map(s => s.w + 'x' + s.h + (s.live ? ' live' : ' sim') + ': ' + saySd(s.PA, s.roomA) + (s.alA ? '; panel from ' + n2(s.alA.x) : '')).join(' | '));

  const keys1 = await page.evaluate(() => Object.keys(localStorage)), wrote = keys1.filter(k => !keys0.includes(k));
  chk('the radar view left nothing in the browser by being opened, used for these layouts and closed: no gt.arradar, no gt.araim, no gt.arlens', wrote.length === 0, 'written: ' + (wrote.join(', ') || 'nothing'));
  console.log('\n  page errors (radar view, layout): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* ---- the radar view's states: before a reading, failed, no compass, closing, gestures ---------------------------------- */
/* A drag across the screen and then a pinch, as pointer events on the sky canvas (a finger's, with the ids a touch screen gives): which is what the AR view
   turns the sky and fits the lens by, and the radar view must leave alone. They are dispatched on the canvas itself, since the radar view hides it. */
const skyGesture = page => page.evaluate(() => {
  const sky = document.getElementById('ar-sky'), ev = (t, id, x, y) => sky.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: id === 1, pointerType: 'touch' }));
  ev('pointerdown', 1, 100, 420); for(let i = 1; i <= 10; i++) ev('pointermove', 1, 100 + i*10, 420); ev('pointerup', 1, 200, 420);
  ev('pointerdown', 2, 135, 420); ev('pointerdown', 3, 255, 420);
  for(let i = 1; i <= 6; i++){ ev('pointermove', 2, 135 - i*10, 420); ev('pointermove', 3, 255 + i*10, 420); }
  ev('pointerup', 2, 75, 420); ev('pointerup', 3, 315, 420);
});
async function rvStates(browser, port){
  console.log('\nPart B — the radar view: its states\n');
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { __ar.camera = 'canvas'; window.__msgs = new Set(); setInterval(() => { try { __msgs.add(ARView.probe.message); } catch(e){} }, 40); });
  const best = await atBestPass(page);
  chk('precondition: the window has a pass to draw on the radar', !!best, best ? best.name + ', pass ' + best.k + ' at ' + best.maxEl.toFixed(1) + '°' : 'none');
  if(!best){ await ctx.close(); return errs.length; }
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await downTo(page, best.k, 35);
  const reset = () => page.evaluate(() => { __feed(null); ARView.close(); Object.assign(__ar, { motion: 'granted', camera: 'canvas', noCam: false, noOri: false, insecure: false, orient: 0 });
    __ar.calls.length = 0; __ar.streams.length = 0; });

  /* Before the first reading: nothing to point with, but the radar is there with the pass and the spacecraft, and no crosshair; the reading comes and so does the crosshair. */
  await page.evaluate(() => { __feed(null); __msgs.clear(); });
  await page.tap('#radarbtn');
  const early = await until(page, () => { const q = ARView.probe; return (q.state === 'asking' || q.state === 'waiting') && q.radar.box && q.radar.draw ? { st: q.state } : false; }, null, 2500);
  const E0 = await radarLayout(page), q0 = await probe(page), d0 = E0.draw;
  const pass0 = await page.evaluate(() => { const p = __gt.D.passes.find(p => p.t1ms >= ARView.probe.ms); return { az: p.maxAz, el: p.maxEl }; });
  const px0 = d0 ? await radarPx(page, [plotAtU(d0.size, pass0.az, pass0.el)]) : [null], blue0 = d0 ? await radarBlue(page, d0.size) : { n: -1 };
  const row0 = await page.evaluate(() => document.getElementById('ar-view').textContent);
  chk('before the first reading from the sensors the radar is already shown, with the pass (its highest point in the pass colour) and the spacecraft\'s dot and no crosshair, nothing in the probe\'s view, and the Aim row says "—"',
      !!early && !E0.hidden && !!E0.probeBox && !!d0 && d0.aim === null && d0.pass === true && d0.craft !== null && rgbNear(px0[0], RADAR_PASS, 12) && blue0.n === 0 && q0.view === null && row0 === '—',
      (early ? early.st : 'never drawn') + ': hidden ' + E0.hidden + ', crosshair ' + JSON.stringify(d0 && d0.aim) + ', pass ' + (d0 && d0.pass) + ', dot ' + JSON.stringify(d0 && d0.craft) + ', ' + blue0.n + ' blue pixels, Aim row "' + row0 + '"');
  await feedAim(page, 120, 20);
  await radarReady(page);
  await onAim(page, 120, 20);
  const E1 = await radarLayout(page), q1 = await probe(page), want1 = q1.view ? plotAtU(E1.draw.size, q1.view.az, q1.view.el) : null;
  chk('...and with the reading in the crosshair comes, at the plot\'s transform of where the camera points, and the radar keeps its size and its column', !!want1 && !!E1.draw.aim && dist2(E1.draw.aim, want1) <= 0.3 && near(E1.box.w, E0.box.w, 0.01) && near(E1.box.x, E0.box.x, 0.01),
      want1 && E1.draw.aim ? n2(dist2(E1.draw.aim, want1)) + ' px off; radar ' + n2(E0.box.w) + ' then ' + n2(E1.box.w) + ' px wide (the readout grows with its first row, so it may sit a little higher)' : 'no crosshair');
  /* The hint (drag to line the sky up, pinch to fit the lens) is for a sky drawn over a picture, and is never said here. */
  await page.waitForTimeout(2500);
  const said = await page.evaluate(() => [...__msgs]);
  chk('the gesture hint ("Drag sideways to line the sky up, pinch to fit the lens") is never said in the radar view: not in the status line at any moment from the tap to 2.5 s after the first reading',
      said.every(m => !/Drag sideways/.test(m)), 'the status said: ' + (said.map(m => '"' + m.slice(0, 40) + '"').join(' | ') || 'nothing'));

  /* A drag and a pinch do nothing: the hand turn (trim) and the lens stay where they were. */
  const g0 = await probe(page);
  await page.mouse.move(100, 420); await page.mouse.down();
  for(let i = 1; i <= 10; i++) await page.mouse.move(100 + i*10, 420);
  await page.mouse.up();
  await skyGesture(page);
  await frames2(page); await settle(page);
  const g1 = await probe(page);
  chk('a drag and a pinch across the screen in the radar view leave the hand turn and the lens as they were: probe.trim and probe.fov unchanged, the view where it was, nothing kept in gt.arlens',
      g1.trim === g0.trim && g1.fov === g0.fov && near(g1.view.az, g0.view.az, 0.001) && near(g1.view.el, g0.view.el, 0.001) && (await page.evaluate(() => localStorage.getItem('gt.arlens'))) === null,
      'trim ' + g0.trim + ' → ' + g1.trim + ', lens ' + g0.fov + ' → ' + g1.fov);

  /* Failed: no radar, no camera asked for, and the sentences are the radar's, not the AR view's. */
  const refuse = async (cfg, nullEvent, wait) => {
    await reset();
    await page.evaluate(c => { Object.assign(__ar, c); }, cfg);
    if(nullEvent) await page.evaluate(() => __feed({ type: 'deviceorientation', a: null, b: null, g: null }));
    const t0 = Date.now();
    await page.tap('#radarbtn');
    await until(page, () => ARView.probe.state === 'failed', null, wait || 8000);
    const r = await page.evaluate(() => { const q = ARView.probe; return { state: q.state, reason: q.reason, message: q.message, calls: __ar.calls.map(c => c.what), box: q.radar.box, draw: q.radar.draw,
      hidden: document.getElementById('ar-radar').hidden, retry: !document.getElementById('ar-retry').hidden, retryText: document.getElementById('ar-retry').textContent, mode: q.mode, streams: __ar.streams.length,
      snap: document.getElementById('ar-snap').disabled }; });
    r.ms = Date.now() - t0;
    return r;
  };
  const F = {};
  F.denied = await refuse({ motion: 'denied' });
  F.insecure = await refuse({ insecure: true });
  F.noOri = await refuse({ noOri: true });
  F.noSensor = await refuse({}, true, 12000);
  F.noReading = await refuse({}, false, 12000);
  F.thrown = await refuse({ motion: 'throw' });
  const sayF = k => k + ': ' + F[k].state + '/' + F[k].reason + ' "' + F[k].message.slice(0, 60) + '…"';
  chk('a failed radar view - motion declined, an insecure page, a browser with no motion sensors, a device with none, no reading, a request that throws - has no radar (the canvas hidden, no box, nothing drawn), asks for no camera, and offers no Snap',
      Object.values(F).every(f => f.state === 'failed' && f.mode === 'radar' && f.hidden && f.box === null && f.draw === null && !f.calls.includes('camera') && f.streams === 0 && f.snap),
      Object.keys(F).map(k => k + ' ' + F[k].state + (F[k].hidden ? ', no radar' : ', RADAR SHOWN') + (F[k].calls.includes('camera') ? ', CAMERA ASKED' : '')).join('; '));
  chk('...motion declined says how to undo it and offers Try again; an insecure page says "The radar needs a secure page" and gives https; a device with no sensor says "the radar needs a phone or a tablet"',
      /^Motion and orientation access was declined/.test(F.denied.message) && F.denied.retry && F.denied.retryText === 'Try again'
      && /^The radar needs a secure page, and this one was opened over http:\/\/ — browsers give the motion sensors only to https pages and local files\. Open https:\/\/sattrackslop\.vercel\.app on this phone\.$/.test(F.insecure.message) && F.insecure.calls.length === 0
      && F.noOri.message === 'This browser gives pages no motion sensors, so the view cannot follow the phone.' && F.noOri.calls.length === 0
      && F.noSensor.reason === 'no-sensor' && F.noSensor.message === 'This device reports no motion sensor, so the radar cannot follow it — the radar needs a phone or a tablet.' && F.noSensor.ms >= 3000
      && (F.noReading.reason === 'no-reading' ? /^No reading from the motion sensors in 3 s\./.test(F.noReading.message)       // Chromium itself sends one all-null reading when a listener is added (the head of this file), so a page may see either
                                              : F.noReading.reason === 'no-sensor' && /the radar needs a phone or a tablet\.$/.test(F.noReading.message)),
      ['denied', 'insecure', 'noOri', 'noSensor', 'noReading'].map(sayF).join(' | '));
  chk('...and no sentence of a failed radar view sends the reader to the AR view, the AR button or the camera, which are not what they opened (a request that throws says "tap AR again" in the AR view)',
      Object.values(F).every(f => !/\bAR\b|camera/i.test(f.message)), Object.keys(F).filter(k => /\bAR\b|camera/i.test(F[k].message)).map(k => k + ': "' + F[k].message + '"').join(' | ') || 'none do');
  /* The AR view keeps its own words, in the same two failures. */
  const AF = {};
  for(const [k, cfg, nullEvent] of [['insecure', { insecure: true }, false], ['noSensor', {}, true]]){
    await reset();
    await page.evaluate(c => { Object.assign(__ar, c); }, cfg);
    if(nullEvent) await page.evaluate(() => __feed({ type: 'deviceorientation', a: null, b: null, g: null }));
    await page.tap('#arbtn');
    await until(page, () => ARView.probe.state === 'failed', null, 12000);
    AF[k] = await page.evaluate(() => ARView.probe.message);
  }
  chk('...while the AR view says "The AR view needs a secure page" and "the AR view needs a phone or a tablet" for the same two failures',
      /^The AR view needs a secure page, and this one was opened over http:\/\/ — /.test(AF.insecure) && /so the view cannot follow it — the AR view needs a phone or a tablet\.$/.test(AF.noSensor), JSON.stringify(AF).slice(0, 200));
  await reset();

  /* No compass (a relative reading only): the sentence says to open Align, the crosshair is there, and Align turns it. */
  await page.evaluate(() => { const a = __aimAt(120, 20, 0, 0); __feed({ type: 'deviceorientation', a: a.a, b: a.b, g: a.g }); __msgs.clear(); });
  await page.tap('#radarbtn');
  await until(page, () => ARView.probe.source === 'rel' && /Open Align/.test(ARView.probe.message), null, 8000);
  await radarReady(page); await settle(page); await frames2(page);
  const rel = await probe(page), RL = await radarLayout(page);
  const relRow = await page.evaluate(() => ({ north: document.getElementById('ar-north').textContent, decl: document.getElementById('ar-decl').textContent }));
  const wantR = rel.view && RL.draw && RL.draw.aim ? plotAtU(RL.draw.size, rel.view.az, rel.view.el) : null;
  chk('with no compass the radar view says "Open Align and turn it by hand until the crosshair is on something whose bearing you know" - not the AR view\'s "Drag sideways" - and the crosshair is drawn all the same',
      rel.source === 'rel' && /^No compass reading — the radar turns with the phone but is not tied to north\. Open Align and turn it by hand/.test(rel.message) && !/Drag sideways/.test(rel.message)
      && !!wantR && dist2(RL.draw.aim, wantR) <= 0.3 && /^a guess/.test(relRow.north) && /not applied/.test(relRow.decl),
      '"' + rel.message.slice(0, 120) + '", crosshair ' + (wantR ? n2(dist2(RL.draw.aim, wantR)) + ' px off' : 'none') + ', North: ' + relRow.north);
  /* Align: the panel opens, the lens row is not in it, the trim buttons turn the crosshair a degree a press, and Reset heading brings it back. */
  await page.click('#ar-alignbtn'); await frames2(page);
  const al = await page.evaluate(() => ({ open: !document.getElementById('ar-align').hidden, lens: getComputedStyle(document.querySelector('.ar-lens')).display, fov0: getComputedStyle(document.getElementById('ar-fov0')).display,
    lensW: document.querySelector('.ar-lens').getBoundingClientRect().width, fov0W: document.getElementById('ar-fov0').getBoundingClientRect().width, expanded: document.getElementById('ar-alignbtn').getAttribute('aria-expanded') }));
  const turn = async id => { await page.click(id); await settle(page); await frames2(page); await frames2(page); return { q: await probe(page), L: await radarLayout(page) }; };
  const t0 = { q: await probe(page), L: await radarLayout(page) };
  const tR = await turn('#ar-right'), tL = await turn('#ar-left'), tL2 = await turn('#ar-left'), tZ = await turn('#ar-trim0');
  const moved = (a, b) => Math.abs(wrap180(b.q.view.az - a.q.view.az));
  const onPlot = t => t.L.draw && t.L.draw.aim && dist2(t.L.draw.aim, plotAtU(t.L.draw.size, t.q.view.az, t.q.view.el)) <= 0.3;
  chk('Align works in the radar view: the panel opens, it has no lens row (no "Lens" slider, no "Reset lens"), "1° ▸" turns by -1° of hand turn and the view by a degree, "◂ 1°" twice back through zero to +1°, and Reset heading brings it home; the crosshair follows every press',
      al.open && al.expanded === 'true' && al.lens === 'none' && al.fov0 === 'none' && al.lensW === 0 && al.fov0W === 0 && t0.q.trim === 0 && tR.q.trim === -1 && tL.q.trim === 0 && tL2.q.trim === 1 && tZ.q.trim === 0
      && near(moved(t0, tR), 1, 0.05) && near(moved(tR, tL2), 2, 0.05) && near(moved(tL2, tZ), 1, 0.05) && [t0, tR, tL, tL2, tZ].every(onPlot),
      'trim ' + [t0, tR, tL, tL2, tZ].map(t => t.q.trim).join(' → ') + ', view moved ' + n2(moved(t0, tR)) + '° then ' + n2(moved(tR, tL2)) + '° then ' + n2(moved(tL2, tZ)) + '°; lens row ' + al.lens + '/' + al.lensW + ' px, Reset lens ' + al.fov0 + '; the crosshair on the transform of the view at every step: ' + [t0, tR, tL, tL2, tZ].every(onPlot));
  await page.click('#ar-alignbtn');
  /* ...and the AR view, in the same no-compass case, keeps its own sentence. */
  await page.evaluate(() => { ARView.close(); });
  await page.tap('#arbtn');
  await until(page, () => ARView.probe.source === 'rel' && /not tied to north/.test(ARView.probe.message), null, 8000);
  const relAr = await probe(page);
  chk('...while the AR view, with no compass, says "Drag sideways to put the drawn Sun on the real one" and not "Open Align"', /Drag sideways to put the drawn Sun on the real one\.$/.test(relAr.message) && !/Open Align/.test(relAr.message), '"' + relAr.message.slice(-70) + '"');
  await reset();

  /* Closing: the focus goes back to the button that opened the view, by every way of closing, and the history entry the view pushed goes with it. */
  const homes = [], focus = [];
  for(const how of ['Close', 'Escape', 'Back']){
    for(const kind of ['radar', 'ar', 'radar']){
      await page.evaluate(() => { __ar.streams.length = 0; window.__census0 = __ar.census(); });
      const entry0 = await page.evaluate(() => navigation.currentEntry.index);
      await feedAim(page, 120, 20);
      await page.tap(kind === 'radar' ? '#radarbtn' : '#arbtn');
      await until(page, () => ARView.probe.state === 'running', null, 15000);
      const open = await page.evaluate(() => ({ mode: ARView.probe.mode, hist: !!(history.state && history.state.ar), focus: document.activeElement && document.activeElement.id,
        inert: [...document.body.children].filter(e => e.id !== 'arview' && e.tagName !== 'SCRIPT').every(e => e.inert), census: JSON.stringify(__ar.census()), census0: JSON.stringify(__census0) }));
      if(how === 'Close') await page.click('#ar-close');
      else if(how === 'Escape') await page.keyboard.press('Escape');
      else await page.evaluate(() => history.back());
      await page.waitForTimeout(300);
      await until(page, () => ARView.state === 'closed' && !(history.state && history.state.ar), null, 5000);
      const past = (await until(page, e => navigation.currentEntry.index === e ? { here: true } : false, entry0, 5000)) ? 0 : (await page.evaluate(e => navigation.currentEntry.index - e, entry0));
      const c = await page.evaluate(() => ({ state: ARView.state, hidden: document.getElementById('arview').hidden, focus: document.activeElement && document.activeElement.id, inert: [...document.body.children].some(e => e.inert),
        arOpen: document.documentElement.classList.contains('ar-open'), census: JSON.stringify(__ar.census()), census0: JSON.stringify(__census0), ended: __ar.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')), suspended: Orbit3D.suspended }));
      focus.push({ how, kind, open, c, past });
      homes.push({ how, kind, past });
    }
  }
  chk('closing the radar view by Close, by Escape and by Back returns the focus to the Radar button (#radarbtn), and the AR view to the AR button (#arbtn), opened in between: the mode of one never leaks into the other',
      focus.every(f => f.c.focus === (f.kind === 'radar' ? 'radarbtn' : 'arbtn') && f.open.mode === f.kind && f.open.focus === 'ar-close'),
      focus.map(f => f.kind + '/' + f.how + ' → ' + f.c.focus).join(', '));
  chk('...and the view leaves nothing behind either way: the page live again and its listeners removed (the census of what the view adds to the window and document is what it was), no history entry of its own after Close, Escape or Back, and any stream stopped',
      focus.every(f => f.c.state === 'closed' && f.c.hidden && !f.c.inert && !f.c.arOpen && f.c.census === f.c.census0 && f.c.ended && !f.c.suspended && f.open.hist && f.open.inert) && homes.every(h => h.past === 0),
      homes.map(h => h.kind + '/' + h.how + ' ' + (h.past ? '+' + h.past + ' entries' : 'back where it began')).join(', '));

  const keys = await page.evaluate(() => Object.keys(localStorage));
  chk('...and the radar view\'s states, failures and closings left nothing in the browser (no gt.arradar, gt.araim or gt.arlens) and nothing drew, read or captured the camera\'s picture (the census is empty)',
      !keys.some(k => /^gt\./.test(k)) && (await page.evaluate(() => __ar.pictures.length)) === 0, 'in storage: ' + (keys.join(', ') || 'nothing') + '; census ' + (await page.evaluate(() => __ar.pictures.length)) + ' entries');

  /* The control for the gestures and the hint: the same page, the same pose, opened as AR: the drag turns the sky, the pinch fits the lens, and the hint is said. */
  await page.evaluate(() => { __msgs.clear(); });
  await feedAim(page, 120, 20);
  await page.tap('#arbtn');
  await until(page, () => ARView.probe.state === 'running', null, 15000);
  await onAim(page, 120, 20);
  const a0 = await probe(page);
  await skyGesture(page);
  await frames2(page);
  const a1 = await probe(page), hintAr = await page.evaluate(() => [...__msgs]);
  chk('...and the control: in the AR view the same drag turns the sky (the hand turn moves by more than a degree), the same pinch fits the lens (it moves), and the hint is said',
      Math.abs(a1.trim - a0.trim) > 1 && a1.fov !== a0.fov && hintAr.some(m => /^Drag sideways to line the sky up/.test(m)),
      'trim ' + a0.trim + ' → ' + n2(a1.trim) + ', lens ' + a0.fov + ' → ' + n2(a1.fov) + ', hint ' + (hintAr.some(m => /^Drag sideways/.test(m)) ? 'said' : 'not said'));
  await reset();
  console.log('\n  page errors (radar view, states): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* ---- the words: where the phone points, and where to turn ------------------------------------------------------------- */
/* The Aim row as it must read for a phone pointing along (az, el), worked out here: the bearing and its point of the compass, how far up or down, and what is followed. */
const aimRow = (az, el, what) => (Math.abs(el) > 85 ? '— · straight ' + (el > 0 ? 'up' : 'down') : Math.round(az) % 360 + '° ' + COMPASS16(az) + ' · ' + Math.round(Math.abs(el)) + '° ' + (el >= 0 ? 'up' : 'down')) + ' · ' + what;
const textNow = (page, id, want, ms) => until(page, ([id, want]) => document.getElementById(id).textContent === want, [id, want], ms || 4000);
async function rvWords(browser, port){
  console.log('\nPart B — the radar view: the words\n');
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  const best = await atBestPass(page);
  chk('precondition: the window has a pass to steer by', !!best, best ? best.name + ', pass ' + best.k + ' at ' + best.maxEl.toFixed(1) + '°' : 'none');
  if(!best){ await ctx.close(); return errs.length; }
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await downTo(page, best.k, 35);
  await rvOpenAt(page, 249.3, 20.2);

  /* The Aim row. */
  const poses = [[249.3, 20.2], [10, -10.4], [359.7, 40], [180.4, 55], [300, 88], [300, -88]];
  const rows = [];
  for(const [az, el] of poses){
    await onAim(page, az, el);
    const want = aimRow(az, el, 'camera');
    await textNow(page, 'ar-view', want);
    rows.push({ az, el, want, got: await page.evaluate(() => document.getElementById('ar-view').textContent) });
  }
  chk('the first row, labelled "Aim", reads "<bearing>° <point> · <n>° up · camera" for the pose fed: "249° WSW · 20° up · camera", down, a bearing that rounds up to 360 as 0°, and "— · straight up" / "straight down" past 85°',
      rows.every(r => r.got === r.want) && rows[0].got === '249° WSW · 20° up · camera', rows.map(r => '(' + r.az + ', ' + r.el + ') "' + r.got + '"' + (r.got === r.want ? '' : ' WANTED "' + r.want + '"')).join(' | '));

  /* The Target row ends with the steering words, about where the phone is aimed. The literal ones are worked out by hand here; steerWords above is
     the same arithmetic as a function, held to them. */
  const st = await satNow(page);
  const cases = [{ da: -30, de: -12, lit: 'turn right 30° · up 12°' }, { da: 40, de: 0, lit: 'turn left 40°' }, { da: 0, de: 15, lit: 'down 15°' }, { da: 0, de: -20, lit: 'up 20°' },
    { da: 175, de: 8, lit: 'turn round · down 8°' }, { da: 2.6, de: 0, lit: 'turn left 3°' }, { da: 0, de: 0, lit: 'on target' }, { da: 1.2, de: 0.5, lit: 'on target' }];
  const out = [];
  for(const c of cases){
    const aim = { az: st.az + c.da, el: st.el + c.de };
    await onAim(page, aim.az, aim.el);
    await until(page, w => { const t = document.getElementById('ar-target').textContent; return t.endsWith(' · ' + w); }, c.lit, 4000);
    const t = await page.evaluate(() => document.getElementById('ar-target').textContent);
    out.push({ c, t, hand: c.lit === 'on target' ? 'on target' : steerWords(aim, st) });
  }
  chk('the Target row ends with where to turn, about where the phone is aimed: "turn right 30° · up 12°", "turn left 40°", "down 15°", "up 20°", "turn round · down 8°", "turn left 3°" at 2.6° off, and "on target" at 0° and at 1.2° off (within 2°)',
      out.every(o => o.t.endsWith(' · ' + o.c.lit) && o.hand === o.c.lit && (o.c.lit !== 'on target' || !/turn |\bup \d|down \d/.test(o.t.slice(o.t.indexOf('km') + 2)))),
      out.map(o => '(' + o.c.da + ', ' + o.c.de + ') ...' + o.t.slice(-34) + (o.t.endsWith(' · ' + o.c.lit) ? '' : ' WANTED "' + o.c.lit + '"') + (o.hand === o.c.lit ? '' : ' (steerWords says "' + o.hand + '")')).join(' | '));
  chk('...and the Target row is the spacecraft\'s own facts first (name, how high, bearing, range) and then the words: it starts with the name and "35"-ish degrees up and its steering follows a " · "',
      /^KNACKSAT-2 · \d+\.\d° up · \d+° [NESW]+ · [\d,]+ km( · under the \d+° mask)?( · .+)?$/.test(out[0].t), out[0].t);

  /* Below the horizon with a pass coming, the words point at where it rises. */
  const pre = await page.evaluate(() => {
    const D = __gt.D, P = D.passes, q = ARView.probe;
    let k = P.findIndex(p => p.t0ms > q.ms + 10*60000);
    if(k < 0) k = P.findIndex(p => p.t1ms < q.ms - 10*60000 && p.t0ms - 5*60000 >= D.start.getTime());
    if(k < 0) return null;
    const t = P[k].t0ms - 5*60000, idx = Math.round((t - D.start.getTime())/1000/D.step);
    const r = document.getElementById('time'); r.value = idx; r.dispatchEvent(new Event('input', { bubbles: true }));
    return { k, aos: { az: P[k].arc[0].az, el: P[k].arc[0].el }, t0: P[k].t0ms };
  });
  if(pre){
    await frames2(page);
    const sB = await satNow(page);
    const below = [];
    for(const [da, de] of [[25, 10], [-60, 20], [0, 0]]){
      const aim = { az: pre.aos.az + da, el: pre.aos.el + de };
      await onAim(page, aim.az, aim.el);
      const want = steerWords(aim, pre.aos);
      await until(page, w => { const t = document.getElementById('ar-target').textContent; return w ? t.endsWith(' · ' + w) : !/ · (turn |up \d|down \d|on target)/.test(t); }, want, 4000);
      below.push({ da, de, want, t: await page.evaluate(() => document.getElementById('ar-target').textContent) });
    }
    chk('with the spacecraft below the horizon and a pass coming, the words point at where it rises (the pass\'s first point, ' + n2(pre.aos.az) + '°): turn left 25° and down 10° from 25° to the right of it and 10° up; and aimed at the rise point itself there is nothing to say - not "on target", which is for the spacecraft',
        sB.el < 0 && below.every(b => (b.want ? b.t.endsWith(' · ' + b.want) : !/ · (turn |up \d|down \d|on target)/.test(b.t))) && below[0].want === 'turn left 25° · down 10°' && below[1].want === 'turn right 60° · down 20°' && below[2].want === '' && /below the horizon/.test(below[0].t),
        'spacecraft ' + n2(sB.el) + '° (below the horizon); ' + below.map(b => '(' + b.da + ', ' + b.de + ') "' + (b.want || '') + '" in ...' + b.t.slice(-40)).join(' | '));
  } else chk('with the spacecraft below the horizon and a pass coming, the words point at where it rises', false, 'the window has no other pass to look before');

  /* The AR view is as it was: the View row (lens and all), no steering words of the radar's in the Target row. */
  await downTo(page, best.k, 35);
  await rvClose(page);
  await feedAim(page, st.az, st.el);
  await page.tap('#arbtn');
  await until(page, () => ARView.probe.state === 'running', null, 15000);
  await onAim(page, st.az, st.el);
  await frames2(page);
  await until(page, () => /^[^ ]+ · .*lens /.test(document.getElementById('ar-view').textContent), null, 3000);
  const ar = await page.evaluate(() => ({ dt: document.getElementById('ar-view').previousElementSibling.textContent, view: document.getElementById('ar-view').textContent, target: document.getElementById('ar-target').textContent,
    title: document.getElementById('ar-title').textContent, mode: document.getElementById('arview').dataset.mode, radarBtn: getComputedStyle(document.getElementById('ar-radarbtn')).display,
    lens: getComputedStyle(document.querySelector('.ar-lens')).display }));
  chk('the AR view is as it was: "Sky over Bangkok", the first row "View" with the lens in it and not "camera", no "on target" in the Target row when aimed at the spacecraft, the lens row and the inset\'s Radar switch there',
      ar.mode === 'ar' && ar.title === 'Sky over Bangkok' && ar.dt === 'View' && / · lens 68°, assumed$/.test(ar.view) && !/camera|head/.test(ar.view) && !/on target/.test(ar.target) && ar.radarBtn !== 'none' && ar.lens !== 'none',
      JSON.stringify(ar));
  await rvClose(page);
  console.log('\n  page errors (radar view, words): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* ---- the aim: the camera, or the phone's head -------------------------------------------------------------------------- */
const setAimMode = async (page, want) => {
  const t = await page.evaluate(() => document.getElementById('ar-aimbtn').textContent.trim());
  if(t !== 'Aim: ' + want) await page.tap('#ar-aimbtn');
  await until(page, w => document.getElementById('ar-aimbtn').textContent.trim() === 'Aim: ' + w && ARView.probe.aimSource === w, want, 3000);
};
/* The direction as the View row says it in the AR view, worked out here. */
const dirWords = (az, el) => Math.abs(el) > 85 ? '— · straight ' + (el > 0 ? 'up' : 'down') : Math.round(az) % 360 + '° ' + COMPASS16(az) + ' · ' + Math.round(Math.abs(el)) + '° ' + (el >= 0 ? 'up' : 'down');
/* The poses of the maths, as W3C angles (alpha, beta, gamma): upright with the camera on the horizon, laid flat, tipped back and forward, rolled, upside down. */
const AIM_POSES = [
  { name: 'upright, the camera on the horizon (alpha 260, beta 90)', a: 260, b: 90, g: 0 },
  { name: 'laid flat, face up (alpha 40, beta 0)', a: 40, b: 0, g: 0 },
  { name: 'laid flat, turned to alpha 130', a: 130, b: 0, g: 0 },
  { name: 'tipped back 30° (the camera 30° up, beta 120)', a: 20, b: 120, g: 0 },
  { name: 'tipped back 60° (the camera 60° up, beta 150)', a: 20, b: 150, g: 0 },
  { name: 'tipped forward 45° (beta 45)', a: 300, b: 45, g: 0 },
  { name: 'rolled (alpha 200, beta 70, gamma 25)', a: 200, b: 70, g: 25 },
  { name: 'rolled the other way up (alpha 100, beta 110, gamma -30)', a: 100, b: 110, g: -30 }
];
/* Each pose fed and settled, and what the probe, the crosshair and the Aim row say about it, as the pose's W3C angles say it should be. */
async function aimPoses(page, which, poses, fed) {
  const out = [];
  for(const p of poses){
    const head = headOf(p.a - (p.trim || 0), p.b), cam = cameraOf(p.a - (p.trim || 0), p.b, p.g), want = which === 'head' ? head : cam;
    await feedAngles(page, p.a, p.b, p.g);
    const got = await aimSettled(page, want, 0.01, 12000);
    await frames2(page);
    const q = await probe(page), d = q.radar.draw;
    const rowWant = aimRow(want.az, want.el, which);
    await textNow(page, 'ar-view', rowWant, 3000);
    const row = await page.evaluate(() => document.getElementById('ar-view').textContent);
    const plot = d && d.aim ? plotAtU(d.size, want.az, want.el) : null;
    out.push({ p, which, head, cam, want, settled: !!got, aimErr: q.aimView ? apart(q.aimView, want) : Infinity, camErr: q.view ? apart(q.view, cam) : Infinity, source: q.aimSource,
      crossErr: plot ? dist2(d.aim, plot) : null, crossed: !!(d && d.aim), clamped: !!(d && d.aim && d.aim.clamped), d, row, rowWant });
  }
  return out;
}
const sayPose = o => o.p.name.replace(/ \(.*$/, '') + ': ' + (o.settled ? '' : 'NOT SETTLED, ') + 'aim ' + n2(o.aimErr) + '°' + (o.aimErr > 0.01 ? ' OFF' : '') + ', camera ' + n2(o.camErr) + '°, crosshair ' + (o.want.el < -85 ? (o.crossed ? 'DRAWN' : 'none') : o.crossed ? n2(o.crossErr) + ' px off' : 'MISSING') + ', row "' + o.row + '"' + (o.row === o.rowWant ? '' : ' WANTED "' + o.rowWant + '"');
const poseOk = o => o.settled && o.source === o.which && o.aimErr <= 0.01 && o.camErr <= 0.02 && (o.want.el < -85 ? !o.crossed : o.crossed && o.crossErr <= 0.3) && o.row === o.rowWant;
async function rvAim(browser, port){
  console.log('\nPart B — the aim switch: the camera, or the phone\'s head\n');
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  const best = await atBestPass(page);
  chk('precondition: the window has a pass to aim at', !!best, best ? best.name + ', pass ' + best.k + ' at ' + best.maxEl.toFixed(1) + '°' : 'none');
  if(!best){ await ctx.close(); return errs.length; }
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await downTo(page, best.k, 35);
  const btn = () => page.evaluate(() => { const b = document.getElementById('ar-aimbtn'), r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), aria: b.getAttribute('aria-label'), stored: localStorage.getItem('gt.araim'), keys: Object.keys(localStorage), h: r.height, w: r.width, row: document.getElementById('ar-view').textContent }; });

  /* The button and what it remembers: nothing until it is pressed. */
  const keys0 = await page.evaluate(() => Object.keys(localStorage));
  await rvOpenAt(page, 120, 20);
  const b0 = await btn();
  await rvClose(page);
  await rvOpenAt(page, 120, 20);
  const b0b = await btn();
  await rvClose(page);
  const keysShut = await page.evaluate(() => Object.keys(localStorage));
  chk('the Aim button reads "Aim: camera" with an accessible name that begins with it and says what it does, is a 40 px target at least, and opening and closing the radar view writes nothing to storage (no gt.araim)',
      b0.text === 'Aim: camera' && b0.aria.startsWith('Aim: camera') && b0.aria.length > 60 && b0.h >= 39.99 && b0.w > 0 && b0.stored === null && b0b.stored === null && keysShut.join() === keys0.join(),
      JSON.stringify({ text: b0.text, aria: b0.aria.slice(0, 50) + '…', h: b0.h, stored: b0.stored }) + '; keys after two openings: ' + (keysShut.filter(k => !keys0.includes(k)).join(', ') || 'none new'));
  await rvOpenAt(page, 120, 20);
  await page.tap('#ar-aimbtn');
  await until(page, () => ARView.probe.aimSource === 'head', null, 3000);
  const b1 = await btn();
  await rvClose(page);
  await rvOpenAt(page, 120, 20);
  const b2 = await btn();
  await rvClose(page);
  chk('pressed, it reads "Aim: head" (its accessible name changes with it and begins with it), the readout says "head", gt.araim holds "head" - written only then - and the choice survives closing and opening the view again',
      b1.text === 'Aim: head' && b1.aria.startsWith('Aim: head') && b1.aria !== b0.aria && b1.stored === 'head' && /· head$/.test(b1.row) && b2.text === 'Aim: head' && b2.stored === 'head' && /· head$/.test(b2.row),
      JSON.stringify({ pressed: b1.text, stored: b1.stored, aria: b1.aria.slice(0, 40) + '…', row: b1.row, reopened: b2.text, stored2: b2.stored }));
  /* ...in the AR view too (it is the same button), where it goes back to the camera. */
  await feedAim(page, 120, 20);
  await page.tap('#arbtn');
  await until(page, () => ARView.probe.state === 'running', null, 15000);
  const b3 = await btn();
  await page.tap('#ar-aimbtn');
  await until(page, () => ARView.probe.aimSource === 'camera', null, 3000);
  const b4 = await btn();
  await rvClose(page);
  await rvOpenAt(page, 120, 20);
  const b5 = await btn();
  await rvClose(page);
  chk('...and in the AR view it is the same switch: it opens on "Aim: head", pressed it goes back to "Aim: camera" (gt.araim then holds "camera"), and that survives too',
      b3.text === 'Aim: head' && b4.text === 'Aim: camera' && b4.aria.startsWith('Aim: camera') && b4.stored === 'camera' && b5.text === 'Aim: camera' && !/ · (camera|head)$/.test(b4.row), JSON.stringify({ ar: b3.text, then: b4.text, stored: b4.stored, radarViewAfter: b5.text }));
  await page.evaluate(() => localStorage.removeItem('gt.araim'));
  const pre = [];
  for(const [v, want] of [['head', 'Aim: head'], ['camera', 'Aim: camera'], ['foo', 'Aim: camera'], ['', 'Aim: camera']]){
    await page.evaluate(v => localStorage.setItem('gt.araim', v), v);
    await rvOpenAt(page, 120, 20);
    pre.push({ v, want, got: (await btn()).text });
    await rvClose(page);
  }
  chk('a reader whose storage holds gt.araim = "head" starts on "Aim: head"; "camera", or anything else, on "Aim: camera"', pre.every(p => p.got === p.want), pre.map(p => '"' + p.v + '" → ' + p.got).join(', '));
  await page.evaluate(() => localStorage.removeItem('gt.araim'));

  /* The maths. */
  await rvOpenAt(page, 120, 20);
  await setAimMode(page, 'head');
  const headRes = await aimPoses(page, 'head', AIM_POSES);
  chk('Aim: head - for eight poses fed as W3C angles (upright, laid flat, tipped back 30° and 60°, forward 45°, rolled, upside down) the crosshair follows the phone\'s head, the device\'s +y worked out here from the angles: probe.aimView within 0.01°, the camera\'s own view (probe.view) still the camera\'s within 0.02°, the crosshair at the plot\'s transform of the head within 0.3 px (none past -85°), and the Aim row says it with "head"',
      headRes.every(poseOk), headRes.map(sayPose).join(' | '));
  const [up, flat, flat2, back30, back60] = headRes;
  chk('...held upright, the camera on the horizon, the head points at the zenith and the crosshair is in the middle of the plot (within 1 px), the Aim row "— · straight up · head"; laid flat, face up, it points along the horizon like a compass needle, at 360° - alpha (alpha grows counter-clockwise: 40 gives 320°, 130 gives 230°), on the rim',
      up.want.el > 89.99 && !!up.d && !!up.d.aim && dist2(up.d.aim, { x: up.d.cx, y: up.d.cy }) <= 1 && up.row === '— · straight up · head'
      && near(flat.want.el, 0, 1e-9) && near(flat.want.az, 320, 1e-9) && near(flat2.want.az, 230, 1e-9) && near(flat.aimErr, 0, 0.01) && !!flat.d.aim && near(dist2(flat.d.aim, { x: flat.d.cx, y: flat.d.cy }), flat.d.R, 0.3)
      && flat2.d.aim && near(dist2(flat2.d.aim, { x: flat2.d.cx, y: flat2.d.cy }), flat2.d.R, 0.3) && near(wrap180(flat.d.aim && Math.atan2(flat.d.aim.x - flat.d.cx, -(flat.d.aim.y - flat.d.cy))*DEG - 320), 0, 0.2),
      'upright: ' + (up.d && up.d.aim ? n2(dist2(up.d.aim, { x: up.d.cx, y: up.d.cy })) + ' px from the middle' : 'no crosshair') + ', "' + up.row + '"; flat: head ' + n2(flat.want.az) + '°/' + n2(flat.want.el) + '°, ' + (flat.d.aim ? n2(dist2(flat.d.aim, { x: flat.d.cx, y: flat.d.cy })) + ' px from the middle of a plot of R ' + n2(flat.d.R) : 'no crosshair'));
  chk('...tipped back 30° and 60° the head is 60° and 30° up, on the side the phone leans from (alpha 0 leans to 180°, south; alpha 20 turns that to 160°), the crosshair at that radius of the plot',
      near(back30.want.el, 60, 1e-6) && near(back60.want.el, 30, 1e-6) && near(back30.want.az, 160, 1e-6) && near(back30.aimErr, 0, 0.01) && near(back60.aimErr, 0, 0.01)
      && back30.crossed && near(dist2(back30.d.aim, { x: back30.d.cx, y: back30.d.cy }), back30.d.R*30/90, 0.3) && near(dist2(back60.d.aim, { x: back60.d.cx, y: back60.d.cy }), back60.d.R*60/90, 0.3),
      'back 30: head ' + n2(back30.want.az) + '°/' + n2(back30.want.el) + '° at ' + (back30.crossed ? n2(dist2(back30.d.aim, { x: back30.d.cx, y: back30.d.cy })) : '-') + ' px of ' + n2(back30.d.R*30/90) + '; back 60: ' + n2(back60.want.el) + '° at ' + (back60.crossed ? n2(dist2(back60.d.aim, { x: back60.d.cx, y: back60.d.cy })) : '-') + ' px of ' + n2(back60.d.R*60/90));
  /* Where to turn follows the head. Upright (aim past 70° up) the page names a bearing instead of "turn". */
  const st = await satNow(page);
  const faceWant = 'face ' + COMPASS16(st.az) + ' (' + Math.round(st.az) % 360 + '°) · ' + Math.round(Math.abs(st.el)) + '° ' + (st.el >= 0 ? 'above' : 'below') + ' the horizon';
  await feedAngles(page, 260, 90, 0);
  await aimSettled(page, headOf(260, 90), 0.01);
  await until(page, w => document.getElementById('ar-target').textContent.endsWith(' · ' + w), faceWant, 4000);
  const tUp = await page.evaluate(() => document.getElementById('ar-target').textContent);
  // laid flat with the head along the spacecraft's bearing: the head is on the horizon, and the spacecraft is 35° up from it
  const flatAlpha = (360 - st.az) % 360;
  await feedAngles(page, flatAlpha, 0, 0);
  await aimSettled(page, headOf(flatAlpha, 0), 0.01);
  const flatWant = steerWords({ az: headOf(flatAlpha, 0).az, el: headOf(flatAlpha, 0).el }, st);
  await until(page, w => document.getElementById('ar-target').textContent.endsWith(' · ' + w), flatWant, 4000);
  const tFlat = await page.evaluate(() => document.getElementById('ar-target').textContent);
  await setAimMode(page, 'camera');
  await aimSettled(page, cameraOf(flatAlpha, 0, 0), 0.01);
  await until(page, () => /face /.test(document.getElementById('ar-target').textContent), null, 4000);
  const tCam = await page.evaluate(() => document.getElementById('ar-target').textContent);
  await setAimMode(page, 'head');
  chk('the words about where to turn follow the head: held upright (the head at the zenith) the Target row names a bearing - "' + faceWant + '" - and laid flat with its head along the spacecraft\'s bearing it says "' + flatWant + '" (the spacecraft ' + Math.round(st.el) + '° above the horizon the head is on), where the camera, facing the ground there, names a bearing',
      tUp.endsWith(' · ' + faceWant) && tFlat.endsWith(' · ' + flatWant) && /^up \d+°$/.test(flatWant) && /· face /.test(tCam), 'upright "...' + tUp.slice(-52) + '", flat head "...' + tFlat.slice(-24) + '", flat camera "...' + tCam.slice(-52) + '"');

  /* The camera again, and the head and the camera are not the same thing. */
  await setAimMode(page, 'camera');
  const camRes = await aimPoses(page, 'camera', AIM_POSES);
  chk('Aim: camera - the same eight poses: the crosshair is the camera\'s (minus the device\'s z, worked out here), probe.aimView is the view, the crosshair at the plot\'s transform of it (none past -85°: a phone laid flat looks at the ground), and the Aim row says "camera"',
      camRes.every(poseOk) && camRes.every(o => near(o.aimErr, o.camErr, 0.01)), camRes.map(sayPose).join(' | '));
  chk('...and the two differ as they should: upright the camera is on the horizon and the head at the zenith; laid flat the camera is looking at the ground (no crosshair) and the head along the horizon (on the rim); tipped back 30° the camera is 30° up and the head 60° up',
      near(camRes[0].want.el, 0, 1e-6) && near(headRes[0].want.el, 90, 1e-6) && near(camRes[1].want.el, -90, 1e-6) && !camRes[1].crossed && headRes[1].crossed && near(camRes[3].want.el, 30, 1e-6) && near(headRes[3].want.el, 60, 1e-6),
      'upright camera ' + n2(camRes[0].want.el) + '° / head ' + n2(headRes[0].want.el) + '°; flat camera ' + n2(camRes[1].want.el) + '° (crosshair ' + (camRes[1].crossed ? 'drawn' : 'none') + ') / head ' + n2(headRes[1].want.el) + '°; tipped back 30: camera ' + n2(camRes[3].want.el) + '° / head ' + n2(headRes[3].want.el) + '°');
  await rvClose(page);

  /* The same head, whatever way the screen is turned: the head is the phone's top edge, not the screen's. Four rotations of one pose, in both modes. */
  const P0 = { a: 200, b: 70, g: 10 }, turns = [[390, 844, 0, 0], [844, 390, 90, 90], [390, 844, 180, 180], [844, 390, -90, 270]];
  const rot = { head: [], camera: [] };
  for(const which of ['head', 'camera']){
    for(const [w, h, orient, th] of turns){
      await rvSetScreen(page, w, h, orient);
      await feedAngles(page, P0.a, P0.b, P0.g);
      await page.tap('#radarbtn');
      await radarReady(page);
      await setAimMode(page, which);
      const [o] = await aimPoses(page, which, [P0]);
      o.theta = (await probe(page)).theta; o.th = th;
      rot[which].push(o);
      await rvClose(page);
    }
  }
  const spread = (a, f) => Math.max(...a.map(f)) - Math.min(...a.map(f));
  /* the plot is a different size upright and sideways, so where the crosshair is is read as a fraction of its radius from the middle */
  const nx = o => (o.d.aim.x - o.d.cx)/o.d.R, ny = o => (o.d.aim.y - o.d.cy)/o.d.R;
  chk('the head does not depend on the screen: one pose (alpha 200, beta 70, gamma 10) with the screen turned 0°, 90°, 180° and 270° (the page set upright or sideways with the matching window.orientation) gives the same head each time, ' + n2(headOf(200, 70).az) + '°/' + n2(headOf(200, 70).el) + '°, within 0.01°, and the same crosshair (as a fraction of the plot radius: the plot is a different size upright and sideways)',
      rot.head.every(o => poseOk(o) && o.theta === o.th) && spread(rot.head, nx) <= 0.003 && spread(rot.head, ny) <= 0.003 && rot.head.length === 4,
      rot.head.map(o => 'θ ' + o.theta + ': ' + n2(o.aimErr) + '° off, crosshair ' + (o.d && o.d.aim ? n2(nx(o)) + ',' + n2(ny(o)) + ' of the radius' : 'none')).join(' | '));
  chk('...and the camera\'s crosshair does not change when only the screen turns: the same camera view, ' + n2(cameraOf(200, 70, 10).az) + '°/' + n2(cameraOf(200, 70, 10).el) + '°, at every screen rotation, and the same place on the plot',
      rot.camera.every(o => poseOk(o) && o.theta === o.th) && spread(rot.camera, nx) <= 0.003 && spread(rot.camera, ny) <= 0.003 && rot.camera.length === 4,
      rot.camera.map(o => 'θ ' + o.theta + ': view ' + n2(o.camErr) + '° off, crosshair ' + (o.d && o.d.aim ? n2(nx(o)) + ',' + n2(ny(o)) + ' of the radius' : 'none')).join(' | '));
  await rvSetScreen(page, 390, 844, 0);

  /* The ends of the plot, for the head. */
  await rvOpenAt(page, 120, 20);
  await setAimMode(page, 'head');
  const ends = {};
  for(const [k, a, b, g] of [['down', 0, -90, 0], ['rim', 0, -80, 0], ['nearUp', 70, 86, 0]]){
    const [o] = await aimPoses(page, 'head', [{ name: k, a, b, g }]);
    ends[k] = Object.assign(o, { blue: await radarBlueish(page), cam: (await probe(page)).view });
  }
  chk('the head below -85° (the phone upside down, its top edge at the ground) draws no crosshair, in the probe or in a pixel, and the Aim row says "— · straight down · head"; at -80° it is on the rim, clamped and still blue; at +86° it is 4° from the middle of the plot (R x 4/90), not on it',
      ends.down.aimErr <= 0.01 && ends.down.want.el < -85 && !ends.down.crossed && ends.down.blue === 0 && ends.down.row === '— · straight down · head'
      && ends.rim.crossed && ends.rim.clamped && near(dist2(ends.rim.d.aim, { x: ends.rim.d.cx, y: ends.rim.d.cy }), ends.rim.d.R, 0.3) && ends.rim.blue >= 30 && near(ends.rim.want.el, -80, 1e-6)
      && ends.nearUp.crossed && near(dist2(ends.nearUp.d.aim, { x: ends.nearUp.d.cx, y: ends.nearUp.d.cy }), ends.nearUp.d.R*4/90, 0.3) && ends.nearUp.crossErr <= 0.3,
      'upside down: ' + (ends.down.crossed ? 'crosshair drawn' : 'none') + ', ' + ends.down.blue + ' blue pixels, "' + ends.down.row + '"; -80°: ' + (ends.rim.crossed ? 'on the plot' + (ends.rim.clamped ? ' (clamped)' : '') : 'none') + ', ' + ends.rim.blue + ' blue pixels; +86°: ' + (ends.nearUp.crossed ? n2(dist2(ends.nearUp.d.aim, { x: ends.nearUp.d.cx, y: ends.nearUp.d.cy })) + ' px from the middle (want ' + n2(ends.nearUp.d.R*4/90) + ')' : 'none'));
  /* The hand turn is in the head too: Align's "1° ▸" is a degree of the whole pose. */
  await feedAngles(page, 40, 0, 0);
  await aimSettled(page, headOf(40, 0), 0.01);
  await page.click('#ar-alignbtn');
  await page.click('#ar-right');
  await settle(page); await frames2(page);
  const trim = (await probe(page)).trim;
  const [tr] = await aimPoses(page, 'head', [{ name: 'flat, turned by hand', a: 40, b: 0, g: 0, trim }]);
  chk('...and the hand turn is in the head: with Align\'s "1° ▸" pressed (the pose turned a degree) the head is the flat phone\'s at alpha 40 - (-1): ' + n2(headOf(41, 0).az) + '°, the crosshair at its transform',
      trim === -1 && poseOk(tr) && near(wrap180(tr.want.az - headOf(40, 0).az), -1, 0.001), 'trim ' + trim + ', ' + sayPose(tr));
  await page.click('#ar-alignbtn');
  await rvClose(page);

  /* In the AR view with the head chosen: the picture and the sky drawn over it are the camera's still. */
  await setStoredAim(page, 'camera');
  const ang = await page.evaluate(([az, el]) => __aimAt(az, el, 0, 0), [st.az, st.el]);
  await feedAngles(page, ang.a, ang.b, ang.g);
  await page.tap('#arbtn');
  await until(page, () => ARView.probe.state === 'running', null, 15000);
  await aimSettled(page, { az: st.az, el: st.el }, 0.02);
  await frames2(page); await frames2(page);
  const snapA = async () => { const q = await probe(page), ink = await skyInk(page); return { q, ink, row: await page.evaluate(() => document.getElementById('ar-view').textContent), marker: JSON.stringify(q.marker), drawn: JSON.stringify(q.drawn), aim: q.radar.draw && q.radar.draw.aim }; };
  await until(page, () => /lens 68°, assumed$/.test(document.getElementById('ar-view').textContent), null, 4000);
  const A0 = await snapA();
  const hAng = headOf(ang.a, ang.b), dirTxt = dirWords(hAng.az, hAng.el);
  await page.tap('#ar-aimbtn');
  await aimSettled(page, hAng, 0.02);
  await until(page, w => document.getElementById('ar-view').textContent.endsWith(w), ' · head ' + dirTxt, 4000);
  await frames2(page); await frames2(page);
  const A1 = await snapA();
  chk('in the AR view with the head chosen the picture and the sky over it stay the camera\'s: the spacecraft\'s marker, everything drawn and the number of pixels on the sky canvas are the same before and after, and so is the camera\'s view',
      A0.q.marker && sameMarker(A0.q.marker, A1.q.marker) && A0.drawn === A1.drawn && A0.ink.n === A1.ink.n && A0.ink.n > 1000 && apart(A0.q.view, A1.q.view) <= 0.02 && A1.q.aimSource === 'head' && A0.q.aimSource === 'camera',
      'marker ' + (sameMarker(A0.q.marker, A1.q.marker) ? 'unchanged' : A0.marker + ' → ' + A1.marker) + ', sky pixels ' + A0.ink.n + ' → ' + A1.ink.n + ', view moved ' + n2(apart(A0.q.view, A1.q.view)) + '°');
  chk('...the View row gets " · head " and where the head points - "' + A0.row + ' · head ' + dirTxt + '" - and the radar\'s crosshair moved to it',
      A1.row === A0.row + ' · head ' + dirTxt && !!A0.aim && !!A1.aim && dist2(A0.aim, A1.aim) > 5 && dist2(A1.aim, plotAtU(A1.q.radar.draw.size, hAng.az, hAng.el)) <= 0.3,
      '"' + A1.row + '"; the crosshair moved ' + (A0.aim && A1.aim ? n2(dist2(A0.aim, A1.aim)) : '?') + ' px');
  await rvClose(page);
  await setStoredAim(page, 'camera');
  const pics = await page.evaluate(() => __ar.pictures.slice());
  chk('...and nothing in the aim checks drew, read or captured the camera\'s picture: the census is empty', pics.length === 0, pics.length ? [...new Set(pics)].join(', ') : 'nothing in the census');
  /* A reader who chose the head and comes back to the page later (a reload, which is what a fresh visit is to the page): still the head. */
  await page.evaluate(() => localStorage.setItem('gt.araim', 'head'));
  await page.reload();
  await page.waitForFunction(() => window.__gt && window.__gt.D && window.ARView && window.Orbit3D && Orbit3D.ok(), null, { timeout: 60000 });
  await H.showGlobe(page);
  await rvOpenAt(page, 120, 20);
  const bR = await btn();
  await rvClose(page);
  chk('...and a visitor whose browser holds gt.araim = "head" from an earlier visit starts the radar view on "Aim: head", after a reload of the page: "' + bR.text + '", "' + bR.row + '"',
      bR.text === 'Aim: head' && bR.stored === 'head' && / · head$/.test(bR.row), JSON.stringify({ text: bR.text, row: bR.row }));
  await page.evaluate(() => localStorage.removeItem('gt.araim'));
  console.log('\n  page errors (aim): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}
/* The spacecraft's marker, as the sky drew it: where (to a thousandth of a pixel, the smoothing's last digits aside), whether it is on the screen, and its azimuth and elevation. */
const sameMarker = (a, b) => !!a && !!b && a.on === b.on && Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && Math.abs(a.az - b.az) < 0.001 && Math.abs(a.el - b.el) < 0.001;
const setStoredAim = (page, v) => page.evaluate(v => localStorage.setItem('gt.araim', v), v);

/* ---- an iPhone: the radar view before the bearing is taken, and after ------------------------------------------------- */
async function rvIOS(browser, port){
  console.log('\nPart B — the radar view on an iPhone\n');
  const { ctx, page, errs } = await phone(browser, port);
  const best = await atBestPass(page);
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  const C = 137;                       // the arbitrary zero of the iPhone's alpha, in degrees
  await page.tap('#radarbtn');
  await page.evaluate(c => { const a = __aimAt(0, 10, 0, 0); __feed({ type: 'deviceorientation', a: (a.a + c) % 360, b: a.b, g: a.g, h: 0, acc: 10 }); }, C);
  await until(page, () => { const q = ARView.probe; return q.state === 'finding' && q.radar.box && q.radar.draw ? { ok: true } : false; }, null, 20000);
  await frames2(page);
  const f0 = await probe(page), L0 = await radarLayout(page), d0 = L0.draw, st0 = await satNow(page);
  const rows0 = await page.evaluate(() => ({ view: document.getElementById('ar-view').textContent, target: document.getElementById('ar-target').textContent }));
  const blue0 = d0 ? await radarBlue(page, d0.size) : { n: -1 };
  const px0 = d0 && d0.craft ? await radarPx(page, [d0.craft]) : [null];
  chk('an iPhone that has not found north, in the radar view: the radar is shown with the pass and the spacecraft\'s dot and no crosshair (its azimuth means nothing yet), the Aim row says "— (finding north) · 10° up · camera", and the Target row steers nowhere',
      f0.state === 'finding' && f0.mode === 'radar' && f0.source === 'ios' && !L0.hidden && !!L0.probeBox && !!d0 && d0.aim === null && d0.pass === true && !!d0.craft && dist2(d0.craft, plotAtU(d0.size, st0.az, st0.el)) <= 0.05
      && rgbNear(px0[0], RADAR_PASS, 12) && blue0.n === 0 && rows0.view === '— (finding north) · 10° up · camera' && !/ · (turn |up \d|down \d|on target)/.test(rows0.target),
      f0.state + ', crosshair ' + JSON.stringify(d0 && d0.aim) + ', ' + blue0.n + ' blue pixels, Aim "' + rows0.view + '", Target "...' + rows0.target.slice(-30) + '"');
  // tipped towards flat: it takes a bearing
  await page.evaluate(c => __feed({ type: 'deviceorientation', a: (330 + c) % 360, b: 30, g: 0, h: 30, acc: 10 }), C);
  await until(page, () => ARView.probe.settled && ARView.state === 'running', null, 20000);
  // then held up at the spacecraft, with a heading that is plainly wrong (it is not trusted upright)
  await page.evaluate(c => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms), a = __aimAt(st.az, st.el, 0, q.decl || 0);
    __feed({ type: 'deviceorientation', a: (a.a + c) % 360, b: a.b, g: a.g, h: 200, acc: 10 }); }, C);
  await settle(page);
  await until(page, () => document.getElementById('ar-target').textContent.endsWith(' · on target'), null, 5000);
  await frames2(page);
  const f1 = await probe(page), L1 = await radarLayout(page), d1 = L1.draw, st1 = await satNow(page);
  const rows1 = await page.evaluate(() => ({ view: document.getElementById('ar-view').textContent, target: document.getElementById('ar-target').textContent }));
  const blue1 = d1 ? await radarBlue(page, d1.size) : { n: -1 };
  chk('...with the bearing taken the crosshair comes, at the plot\'s transform of where the camera points, and held up at the spacecraft it is on the dot (0.5 px) and the Target row says "on target"',
      f1.state === 'running' && !!d1 && !!d1.aim && !!f1.view && dist2(d1.aim, plotAtU(d1.size, f1.view.az, f1.view.el)) <= 0.3 && dist2(d1.aim, d1.craft) <= 0.5 && blue1.n >= 60 && rows1.target.endsWith(' · on target')
      && rows1.view === aimRow(f1.view.az, f1.view.el, 'camera') && apart(f1.view, st1) <= 0.1,
      f1.state + ', crosshair ' + (d1 && d1.aim && f1.view ? n2(dist2(d1.aim, plotAtU(d1.size, f1.view.az, f1.view.el))) + ' px off the transform of the view, ' + n2(dist2(d1.aim, d1.craft)) + ' px from the dot' : 'none') + ', Aim "' + rows1.view + '", Target "...' + rows1.target.slice(-24) + '"');
  // the head, on an iPhone: the same pose, the head's direction from the same angles (the offset the compass gave is in them already)
  await page.tap('#ar-aimbtn');
  await until(page, () => ARView.probe.aimSource === 'head', null, 3000);
  await settle(page); await frames2(page);
  const f2 = await probe(page), L2 = await radarLayout(page);
  chk('...and on an iPhone the head works as elsewhere: Aim: head, the crosshair at the transform of the head the view reports (and moved from the camera\'s), the Aim row saying "head"',
      f2.aimSource === 'head' && !!f2.aimView && !!L2.draw.aim && dist2(L2.draw.aim, plotAtU(L2.draw.size, f2.aimView.az, f2.aimView.el)) <= 0.3 && apart(f2.aimView, f2.view) > 10
      && (await page.evaluate(() => document.getElementById('ar-view').textContent)).endsWith(' · head'),
      'head ' + (f2.aimView ? n2(f2.aimView.az) + '°/' + n2(f2.aimView.el) + '°' : 'none') + ' against the camera ' + n2(f2.view.az) + '°/' + n2(f2.view.el) + '°');
  await page.tap('#ar-aimbtn');
  await until(page, () => ARView.probe.aimSource === 'camera', null, 3000);
  // coming back to the page: the iPhone may have re-zeroed, so the bearing is lost and the crosshair goes again, and the words with it
  await page.evaluate(() => { __ar.vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { __ar.vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await until(page, () => /^Finding north again/.test(ARView.probe.message), null, 2500);
  await frames2(page);
  await until(page, () => /finding north/.test(document.getElementById('ar-view').textContent), null, 3000);
  const f3 = await probe(page), d3 = f3.radar.draw, rows3 = await page.evaluate(() => ({ view: document.getElementById('ar-view').textContent, target: document.getElementById('ar-target').textContent }));
  chk('...and coming back to the page, the bearing lost, the crosshair goes again while the pass and the spacecraft stay, the status says it is finding north again, and the Target row has no steering words',
      /^Finding north again/.test(f3.message) && !!d3 && d3.aim === null && d3.pass === true && d3.craft !== null && /finding north/.test(rows3.view) && !/ · (turn |up \d|down \d|on target)/.test(rows3.target),
      '"' + f3.message.slice(0, 30) + '…", crosshair ' + JSON.stringify(d3 && d3.aim) + ', Aim "' + rows3.view + '", Target "...' + rows3.target.slice(-24) + '"');
  const key = await page.evaluate(() => [localStorage.getItem('gt.arradar'), localStorage.getItem('gt.araim')]);
  chk('...and the iPhone\'s radar view wrote nothing it was not asked to: gt.araim holds "camera" only because the switch was pressed back, and there is no gt.arradar', key[0] === null && key[1] === 'camera', JSON.stringify(key));
  await page.evaluate(() => { __feed(null); ARView.close(); });
  console.log('\n  page errors (radar view, iPhone): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* ---- the four tools, held sideways: in the top bar where there is room, in the column where there is not ---------------- */
const TOOL_IDS = ['ar-snap', 'ar-aimbtn', 'ar-radarbtn', 'ar-alignbtn'], TOOL_NAMES = { 'ar-snap': 'Snap', 'ar-aimbtn': 'Aim', 'ar-radarbtn': 'Radar', 'ar-alignbtn': 'Align' };
const toolsLayout = page => page.evaluate(() => {
  const rc = e => { if(!e) return null; const b = e.getBoundingClientRect(), cs = getComputedStyle(e), hit = b.width ? document.elementFromPoint(b.left + b.width/2, b.top + b.height/2) : null;
    return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom, shown: b.width > 0 && b.height > 0 && cs.display !== 'none', reach: !!hit && (hit === e || e.contains(hit)) }; };
  const id = i => document.getElementById(i), q = ARView.probe, o = { W: q.W, H: q.H, sim: id('arview').hasAttribute('data-sim'), mode: id('arview').dataset.mode };
  for(const i of ['ar-snap', 'ar-aimbtn', 'ar-radarbtn', 'ar-alignbtn', 'ar-close', 'ar-live', 'ar-here', 'ar-retry']) o[i] = rc(id(i));
  o.read = rc(document.querySelector('.ar-read')); o.top = rc(document.querySelector('.ar-top')); o.block = rc(document.querySelector('.ar-top > div')); o.title = rc(id('ar-title')); o.sub = rc(document.querySelector('.ar-sub'));
  o.status = id('ar-status').textContent ? rc(id('ar-status')) : null;
  o.topFoot = Math.max(...[...document.querySelector('.ar-top').children].map(c => c.getBoundingClientRect().bottom));
  o.rows = [...document.querySelectorAll('.ar-dl dt, .ar-dl dd')].map(rc).filter(r => r.shown);
  o.site = id('ar-site').textContent;
  return o;
});
async function rvTools(browser, port){
  console.log('\nPart B — the four tools held sideways\n');
  const { ctx, page, errs } = await phone(browser, port);
  await page.evaluate(() => { __ar.camera = 'canvas'; });
  const best = await atBestPass(page);
  chk('precondition: the window has a pass to aim at', !!best, best ? best.name + ', pass ' + best.k + ' at ' + best.maxEl.toFixed(1) + '°' : 'none');
  if(!best){ await ctx.close(); return errs.length; }
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  await downTo(page, best.k, 35);
  const open = async (kind, w, h, live) => {
    const th = w > h ? 90 : 0;
    await rvSetScreen(page, w, h, th);
    await feedAim(page, 120, 20, th);
    await page.tap(kind === 'radar' ? '#radarbtn' : '#arbtn');
    await until(page, () => ARView.probe.state === 'running', null, 15000);
    await onAim(page, 120, 20, th);
    if(live){      // Go live, unless the clock is live already (the last case left it so)
      if(await page.evaluate(() => !document.getElementById('ar-live').hidden)) await page.click('#ar-live');
      await until(page, () => document.getElementById('ar-live').hidden && /^live · /.test(document.getElementById('ar-clock').textContent), null, 8000);
    }
    await frames2(page); await frames2(page);
    return toolsLayout(page);
  };
  const T = {};
  for(const [kind, w, h] of [['ar', 667, 375], ['ar', 844, 390], ['ar', 932, 430], ['ar', 640, 360], ['radar', 667, 375], ['radar', 844, 390], ['ar', 568, 320], ['radar', 568, 320]]){
    T[kind + w] = await open(kind, w, h, false);
    await rvClose(page);
  }
  T.ar667live = await open('ar', 667, 375, true);
  await rvClose(page);
  T.radar667live = await open('radar', 667, 375, true);
  await rvClose(page);
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });

  const say = (T, ids) => ids.map(i => TOOL_NAMES[i] + ' ' + (T[i] && T[i].shown ? n2(T[i].x) + ',' + n2(T[i].y) + ' ' + n2(T[i].w) + 'x' + n2(T[i].h) : 'not shown')).join('; ');
  /* In the top bar: one row, in order, on the screen, right of the title block's lowest right edge (Use my location) and left of Close, out of the column, none
     under the status line, each 40 px high or more. */
  const inBar = (T, ids) => {
    const r = ids.map(i => T[i]);
    if(!r.every(b => b && b.shown)) return false;
    return r.slice(1).every(b => near(b.y, r[0].y, 1)) && r.every((b, i) => (i === 0 || r[i - 1].x < b.x) && b.h >= 39.99 && b.x >= T['ar-here'].r && b.x >= T.block.r && b.x >= T.read.r && b.r <= T['ar-close'].x
      && b.x >= 0 && b.r <= T.W && b.y >= 0 && b.b <= T.H && b.y >= T.top.y && b.b <= T.top.b && b.reach && !(T.status && boxesMeet(b, T.status)));
  };
  const ARIDS = TOOL_IDS, RIDS = ['ar-snap', 'ar-aimbtn', 'ar-alignbtn'];
  const aw = [['ar667', 'AR view 667x375 in sim time'], ['ar844', 'AR view 844x390'], ['ar932', 'AR view 932x430'], ['ar640', 'AR view 640x360 (640 px wide: the least that has the room)'], ['ar667live', 'AR view 667x375 live']];
  chk('held sideways on a screen 640 px wide or more, the four tools - Snap, Aim, Radar, Align - are one row (the same top within 1 px) up in the top bar, in that order, on the screen, right of the title block (with its Use my location button) and left of Close, out of the readout\'s column, each 40 px high or more and reachable: 667x375 in sim time and live, 844x390, 932x430, 640x360',
      aw.every(([k]) => inBar(T[k], ARIDS)), aw.map(([k, n]) => n + ': ' + say(T[k], ARIDS)).join(' | '));
  chk('...and Go live is in the column in sim time and gone live: the tools left it room, it is inside the readout\'s column, below the tools\' row, and nowhere in the top bar',
      aw.filter(([k]) => !/live/.test(k)).every(([k]) => T[k].sim && T[k]['ar-live'].shown && T[k]['ar-live'].x >= T[k].read.x - 0.5 && T[k]['ar-live'].r <= T[k].read.r + 0.5 && T[k]['ar-live'].y > T[k]['ar-snap'].b - 1 && T[k]['ar-live'].reach)
      && !T.ar667live.sim && !T.ar667live['ar-live'].shown,
      aw.map(([k, n]) => n + ': Go live ' + (T[k]['ar-live'].shown ? n2(T[k]['ar-live'].x) + ',' + n2(T[k]['ar-live'].y) : 'not shown') + (T[k].sim ? ' (sim)' : ' (live)') + ', column ' + n2(T[k].read.x) + '..' + n2(T[k].read.r)).join(' | '));
  /* What the old check asked for, again, for the new layout (667x375 in sim time has the column's box begin within 24 px of the lowest thing in the top bar, with its first
     line no more than 10 px above that: a second row of buttons in the column had put it 44 px higher), and then what it was for: no line of the readout lies under a
     control of the top bar. */
  const under = (T, ids) => T.rows.filter(r => [T['ar-here'], T['ar-close']].concat(ids.map(i => T[i])).some(b => b && b.shown && boxesMeet(r, b))).length;
  const firstY = T => T.rows.length ? Math.min(...T.rows.map(r => r.y)) : T.read.y;
  const sayCol = (T, ids) => 'column ' + n2(T.read.y) + ', first line ' + n2(firstY(T)) + ', the top bar ends ' + n2(T.topFoot) + ', ' + under(T, ids) + ' lines of the readout under a control';
  chk('...the column has not grown up over the top bar: its box begins within 24 px of the lowest thing in the bar and its first line is no more than 10 px above that (a second row of buttons in the column would put it 44 px higher)',
      aw.every(([k]) => T[k].read.y >= T[k].topFoot - 24 && firstY(T[k]) >= T[k].topFoot - 10), aw.map(([k, n]) => n + ': ' + sayCol(T[k], ARIDS)).join(' | '));
  chk('...and no line of the readout lies under Use my location, Close or a tool: the column is clear of the top bar in each of them',
      aw.every(([k]) => under(T[k], ARIDS) === 0), aw.map(([k, n]) => n + ': ' + under(T[k], ARIDS) + ' lines under a control').join(' | '));
  const rw = [['radar667', 'radar view 667x375 in sim time'], ['radar844', 'radar view 844x390'], ['radar667live', 'radar view 667x375 live']];
  chk('in the radar view held sideways the three tools - Snap, Aim, Align - are one row up in the top bar, with no Radar switch (it is the view), on the same terms',
      rw.every(([k]) => inBar(T[k], RIDS) && !T[k]['ar-radarbtn'].shown), rw.map(([k, n]) => n + ': ' + say(T[k], RIDS)).join(' | '));
  chk('...and there too the column has not grown up over the top bar (24 px and 10 px as above)',
      rw.every(([k]) => T[k].read.y >= T[k].topFoot - 24 && firstY(T[k]) >= T[k].topFoot - 10), rw.map(([k, n]) => n + ': ' + sayCol(T[k], RIDS)).join(' | '));
  chk('...and no line of the readout lies under Use my location, Close or a tool',
      rw.every(([k]) => under(T[k], RIDS) === 0), rw.map(([k, n]) => n + ': ' + under(T[k], RIDS) + ' lines under a control').join(' | '));
  /* Narrower than 640 px they stay in the column: on the screen, in the column, and reachable. What they overlap there is reported, not asserted. */
  const narrow = [['ar568', ARIDS, 'AR view'], ['radar568', RIDS, 'radar view']];
  const touch = (T, ids) => { const o = []; const b = ids.map(i => [TOOL_NAMES[i], T[i]]).concat([['Go live', T['ar-live']], ['Close', T['ar-close']], ['Use my location', T['ar-here']]]);
    for(let i = 0; i < b.length; i++) for(let j = i + 1; j < b.length; j++) if(b[i][1] && b[j][1] && b[i][1].shown && b[j][1].shown && boxesMeet(b[i][1], b[j][1])) o.push(b[i][0] + '/' + b[j][0]);
    return o; };
  chk('narrower than 640 px (568x320, held sideways) the tools stay in the column: every one is on the screen, inside the column, and a tap at its centre reaches it',
      narrow.every(([k, ids]) => ids.every(i => T[k][i].shown && T[k][i].x >= 0 && T[k][i].r <= T[k].W + 0.01 && T[k][i].y >= 0 && T[k][i].b <= T[k].H + 0.01 && T[k][i].x >= T[k].read.x - 0.5 && T[k][i].r <= T[k].read.r + 0.5 && T[k][i].reach)),
      narrow.map(([k, ids, n]) => n + ': ' + say(T[k], ids) + '; column ' + n2(T[k].read.x) + '..' + n2(T[k].read.r) + ' x ' + n2(T[k].read.y) + '..' + n2(T[k].read.b) + ' of a ' + T[k].W + 'x' + T[k].H + ' screen').join(' | '));
  for(const [k, ids, n] of narrow){
    const rowsAbove = T[k].rows.filter(r => r.y < 0).length, ov = touch(T[k], ids);
    console.log('        568x320 ' + n + ' (reported, not asserted): ' + (ov.length ? 'boxes that meet: ' + ov.join(', ') : 'no two controls meet') + '; the readout column starts at y ' + n2(T[k].read.y) + (T[k].read.y < 0 ? ', ' + rowsAbove + ' of its ' + T[k].rows.length + ' text boxes above the top of the screen' : '') + '; the title block ends at y ' + n2(T[k].block.b));
  }

  /* A long site name does not push the title under the tools: held sideways at 667x375 and 640x360 the title block keeps off them and wraps. */
  await rvSetScreen(page, 390, 844, 0);
  await H.setSite(page, { name: 'Wat Phra That Doi Suthep', lat: 13.75, lon: 100.52, alt: 0, tz: 7 });
  await H.closeSiteForm(page);
  await page.waitForFunction(() => __gt.OBS.name === 'Wat Phra That Doi Suthep' && __gt.D && __gt.D.passes.length, null, { timeout: 20000 }).catch(() => null);
  const best2 = await atBestPass(page);
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  const LN = {};
  for(const [kind, w, h] of [['ar', 667, 375], ['ar', 640, 360], ['radar', 667, 375]]){
    LN[kind + w] = await open(kind, w, h, false);
    await rvClose(page);
  }
  const clearOf = (T, ids) => ids.every(i => ['block', 'title', 'sub', 'ar-here'].every(k => !boxesMeet(T[i], T[k])) && T.block.r <= T[i].x && T.title.r <= T[i].x);
  chk('a 24-character site name ("Wat Phra That Doi Suthep") held sideways at 667x375 and 640x360 does not push the title under the tools: the title block, the title, the position line and Use my location all end left of the first tool, in the AR view and in the radar view',
      LN.ar667.site === 'Wat Phra That Doi Suthep' && clearOf(LN.ar667, ARIDS) && clearOf(LN.ar640, ARIDS) && clearOf(LN.radar667, RIDS) && inBar(LN.ar667, ARIDS) && inBar(LN.ar640, ARIDS) && inBar(LN.radar667, RIDS),
      Object.keys(LN).map(k => k + ': title block ' + n2(LN[k].block.x) + '..' + n2(LN[k].block.r) + ' x ' + n2(LN[k].block.y) + '..' + n2(LN[k].block.b) + ', title ' + n2(LN[k].title.h) + ' px tall, first tool at ' + n2(LN[k]['ar-snap'].x)).join(' | '));

  /* A status line that is on the screen (a camera that was declined, no compass) is not under the tools. */
  await H.setSite(page, { name: 'Bangkok', lat: 13.75, lon: 100.52, alt: 0, tz: 7 });
  await H.closeSiteForm(page);
  await page.waitForFunction(() => __gt.OBS.name === 'Bangkok' && __gt.D && __gt.D.passes.length, null, { timeout: 20000 }).catch(() => null);
  await atBestPass(page);
  await page.evaluate(() => { const b = document.getElementById('tpplay'); if(b.getAttribute('aria-label') === 'Pause') b.click(); });
  const ST = {};
  for(const [kind, w, h] of [['ar', 667, 375], ['ar', 844, 390], ['radar', 667, 375]]){
    await rvSetScreen(page, w, h, 90);
    if(kind === 'ar') await page.evaluate(() => { __ar.camera = 'NotAllowedError'; });
    else await page.evaluate(() => { const a = __aimAt(120, 20, 90, 0); __feed({ type: 'deviceorientation', a: a.a, b: a.b, g: a.g }); });
    if(kind === 'ar') await feedAim(page, 120, 20, 90);
    await page.tap(kind === 'radar' ? '#radarbtn' : '#arbtn');
    await until(page, k => { const q = ARView.probe; return q.state === 'running' && (k === 'ar' ? /^Camera access was declined/.test(q.message) : /Open Align/.test(q.message)); }, kind, 15000);
    await frames2(page); await frames2(page);
    ST[kind + w] = await toolsLayout(page);
    await rvClose(page);
    await page.evaluate(() => { __feed(null); __ar.camera = 'canvas'; });
  }
  chk('...and a status line a few lines long (the camera declined; no compass in the radar view) is on the screen, below the tools: no tool is under it, at 667x375 and 844x390',
      Object.keys(ST).every(k => ST[k].status && ST[k].status.shown && ST[k].status.h >= 40 && inBar(ST[k], k.startsWith('radar') ? RIDS : ARIDS) && (k.startsWith('radar') ? RIDS : ARIDS).every(i => ST[k][i].b <= ST[k].status.y + 0.5)),
      Object.keys(ST).map(k => k + ': status ' + (ST[k].status ? n2(ST[k].status.y) + '..' + n2(ST[k].status.b) : 'none') + ', tools end ' + n2(Math.max(...(k.startsWith('radar') ? RIDS : ARIDS).map(i => ST[k][i].b)))).join(' | '));
  console.log('\n  page errors (the tools): ' + (errs.length ? errs.join(' | ') : 'none'));
  const nErr = errs.length;
  await ctx.close();
  return nErr;
}

/* The part: the radar view and its button, the aim switch, and the tools' layout. Each function opens its own phone context, so that one's storage, clock and
   viewport are not another's, and returns the number of page errors it saw. */
async function partRadarView(browser, port){
  console.log('\nPart B — the radar view, the aim switch and the tools\n');
  let n = 0;
  n += await rvOffer(browser, port);
  n += await rvCamera(browser, port);
  n += await rvLayout(browser, port);
  n += await rvStates(browser, port);
  n += await rvWords(browser, port);
  n += await rvAim(browser, port);
  n += await rvIOS(browser, port);
  n += await rvTools(browser, port);
  return n;
}
/* what GT_AR_FN can name */
const RV_FNS = { radarSideways, rvOffer, rvCamera, rvLayout, rvStates, rvWords, rvAim, rvIOS, rvTools, partRadar, partRadarView };

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
    /* GT_AR_ONLY=radar runs the radar's part alone, in about half the time of the whole suite: for working on it; GT_AR_ONLY=radarview the part
       for the radar view, the aim switch and the layout of the tools (partRadarView), alone. A full run is the one that counts.
       GT_AR_FN=<name>[,<name>] runs just those functions of the radar parts (radarSideways, rvOffer, ...), for working on one of them. */
    const only = process.env.GT_AR_ONLY, fnOnly = process.env.GT_AR_FN;
    if(only && ((only !== 'radar' && only !== 'radarview') || !NEW)) throw new Error('GT_AR_ONLY can only be "radar" or "radarview", and only for the rebuilt page (GT_TARGET=new), not "' + only + '"');
    if(fnOnly){
      if(!NEW) throw new Error('GT_AR_FN needs the rebuilt page (GT_TARGET=new)');
      for(const name of fnOnly.split(',')){
        if(!RV_FNS[name]) throw new Error('GT_AR_FN: no such function "' + name + '"; there are ' + Object.keys(RV_FNS).join(', '));
        errs += await RV_FNS[name](browser, port);
      }
    } else {
    if(!only){
      errs += await partB(browser, port);
      errs += await partIOS(browser, port);
    }
    if(NEW && (!only || only === 'radar')) errs += await partRadar(browser, port);
    if(NEW && (!only || only === 'radarview')) errs += await partRadarView(browser, port);
    if(!only){
      errs += await partLondon(browser, port);
      errs += await partNoGL(port);
      errs += await partC(browser);
    }
    }
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\npage errors: ' + (errs ? errs : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  process.exit(fails || errs ? 1 : 0);
})();
