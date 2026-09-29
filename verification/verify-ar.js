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
 * browser with no WebGL. Part C loads the page the way snapshot.js does, on a
 * desktop over file://.
 *
 *   node verification/verify-ar.js        (needs playwright)
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'earth', 'wmm.js'));
require(path.join(ROOT, 'earth', 'skyar.js'));
require(path.join(ROOT, 'earth', 'arview.js'));
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
      const file = path.join(ROOT, rel);
      if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
        res.writeHead(404); return res.end('no');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
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

async function phone(browser, port, extra){
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, permissions: ['camera'], timezoneId: 'Asia/Bangkok' }, extra || {}));
  await ctx.addInitScript(MOCKS);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for(const u of BLOCK) await page.route(u, r => r.abort());
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.__gt && window.__gt.D && window.ARView && window.Orbit3D && Orbit3D.ok(),
                             null, { timeout: 60000 });
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
const aimSat = (page, theta, withD) => page.evaluate(([th, wd]) => {
  const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
  const a = __aimAt(st.az, st.el, th, wd ? (q.decl || 0) : 0);
  __feed(Object.assign({ type: 'deviceorientationabsolute' }, a));
  return st;
}, [theta || 0, withD !== false]);

async function partB(browser, port){
  console.log('\nPart B — the page, on a phone\n');
  const { ctx, page, errs } = await phone(browser, port);

  /* B1: offered, beside the camera group, not in it. */
  const offer = await page.evaluate(() => {
    const b = document.getElementById('arbtn'), r = b.getBoundingClientRect(), seg = document.querySelector('.camseg').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return { coarse: matchMedia('(pointer: coarse)').matches, shown: !b.hidden && getComputedStyle(b).display !== 'none',
             inside: r.left >= seg.left - 0.5 && r.right <= seg.right + 0.5 && r.top >= seg.top - 0.5 && r.bottom <= seg.bottom + 0.5,
             reach: !!hit && (hit === b || b.contains(hit)),
             cams: [...document.querySelectorAll('.camseg .cam')].map(c => c.dataset.mode + '=' + c.getAttribute('aria-pressed')),
             povLast: document.querySelector('.seg .btn:last-child').dataset.mode,
             povR: getComputedStyle(document.querySelector('.camseg .seg .btn:last-child')).borderTopRightRadius };
  });
  chk('precondition: a touch-screen context matches (pointer: coarse)', offer.coarse);
  chk('the AR button is offered on a touch screen, inside the camera row, and a tap at its centre reaches it',
      offer.shown && offer.inside && offer.reach);
  chk('...beside the camera group rather than in it: still four camera modes, one pressed, POV\'s end rounded',
      offer.cams.length === 4 && offer.cams.filter(s => /=true$/.test(s)).length === 1 && offer.povLast === 'pov'
      && offer.povR === '3px', offer.cams.join(' ') + ', POV radius ' + offer.povR);

  /* B2: the narrowest phones, with a long site name. */
  await page.setViewportSize({ width: 360, height: 740 });
  const narrow = await page.evaluate(() => {
    const n = document.getElementById('lbl-camsite'), was = n.textContent;
    n.textContent = 'Wat Phra That Doi Suthep';                       // 24 characters
    const c = document.querySelector('.camseg').getBoundingClientRect(), t = document.querySelector('.trailseg').getBoundingClientRect();
    const out = { left: c.left, overlap: !(c.right <= t.left || c.left >= t.right || c.bottom <= t.top || c.top >= t.bottom),
                  sw: document.documentElement.scrollWidth, w: innerWidth };
    n.textContent = was;
    return out;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  chk('...at 360 px with a 24-character site name the row stays on the globe, clear of the trail row',
      narrow.left >= 0 && !narrow.overlap && narrow.sw <= narrow.w, 'left edge ' + narrow.left.toFixed(1) + ' px, page ' + narrow.sw + ' px wide');

  /* B3: the tap, and what it asks for in what order. */
  const best = await atBestPass(page);
  chk('precondition: the window has a pass to aim at', !!best, best ? best.name + ', pass ' + best.k + ' at ' + best.maxEl.toFixed(1) + '°' : 'none');
  await page.evaluate(() => { window.__D0 = __gt.D; window.__pressed0 = [...document.querySelectorAll('.camseg .cam')].map(c => c.getAttribute('aria-pressed')).join(); window.__census0 = __ar.census(); });
  await tapAR(page);
  const asked = await page.evaluate(() => ({ calls: __ar.calls.slice(), open: !document.getElementById('arview').hidden,
    arOpen: document.documentElement.classList.contains('ar-open'),
    inert: [...document.body.children].filter(e => e.id !== 'arview' && e.tagName !== 'SCRIPT').every(e => e.inert),
    focus: document.activeElement && document.activeElement.id, suspended: Orbit3D.suspended, state: ARView.state,
    msg: ARView.probe.message }));
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
  await page.waitForFunction(() => ARView.probe.camera === 'live', null, { timeout: 10000 }).catch(() => null);

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
    return page.evaluate(() => ({ q: (() => { const q = ARView.probe; delete q.stream; return q; })(),
      target: document.getElementById('ar-target').textContent }));
  };
  const o1 = await off(-40, 0), o2 = await off(-30, -12);
  chk('out of frame to the right: an arrow on the right edge and "turn right 40°"',
      o1.q.pointer && o1.q.pointer.text === 'turn right 40°' && o1.q.pointer.x > o1.q.cx && !o1.q.marker.on,
      o1.q.pointer ? '"' + o1.q.pointer.text + '" at x ' + o1.q.pointer.x.toFixed(0) : 'no pointer');
  chk('...and above and to the right: "turn right 30° · up 12°", in the readout as well',
      o2.q.pointer && o2.q.pointer.text === 'turn right 30° · up 12°' && o2.q.pointer.x > o2.q.cx && o2.q.pointer.y < o2.q.cy
      && o2.target.endsWith('turn right 30° · up 12°'), o2.q.pointer ? '"' + o2.q.pointer.text + '"' : 'no pointer');
  // five minutes before a later pass: the spacecraft is down, so the pointer aims at where it will rise
  const pre = await page.evaluate(() => {
    const P = __gt.D.passes, q = ARView.probe, k = P.findIndex(p => p.t0ms > q.ms + 10*60000);
    if(k < 0) return null;
    const t = P[k].t0ms - 5*60000, idx = Math.round((t - __gt.D.start.getTime())/1000/__gt.D.step);
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
  } else chk('before a pass, the pointer aims at where the spacecraft will rise (no later pass in this window)', true, 'skipped: no second pass');

  /* B7: Go live, and staying live. */
  await page.click('#ar-live');
  await page.waitForTimeout(400);
  const lv = await page.evaluate(() => ({ clock: document.getElementById('ar-clock').textContent,
    play: document.getElementById('tpplay').getAttribute('aria-label'), rate: document.getElementById('tpratev').textContent,
    d: Math.abs(ARView.probe.ms - Date.now()), follow: ARView.probe.follow, live: !document.getElementById('ar-live').hidden }));
  chk('Go live: real time, playing, the clock on the present, and the button gone',
      /^live · /.test(lv.clock) && lv.play === 'Pause' && lv.rate === '1.0×' && lv.d < 1000 && lv.follow && !lv.live,
      lv.clock + ' | off by ' + lv.d.toFixed(0) + ' ms');
  await page.evaluate(() => { document.getElementById('tpplay').click(); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.getElementById('tpplay').click(); });
  /* The view resyncs once the clock is more than a second out, which the
     stall has made it; how close it then stays depends on how often a busy
     browser gives the page a frame and a timer, since the transport caps a
     frame at 0.25 s, so what is asked is that it comes back inside the resync's
     own second, and within 3 s. */
  await page.waitForFunction(() => Math.abs(ARView.probe.ms - Date.now()) < 1000, null, { timeout: 3000 }).catch(() => null);
  const re = await page.evaluate(() => Math.abs(ARView.probe.ms - Date.now()));
  const reS = await page.evaluate(() => ({ play: document.getElementById('tpplay').getAttribute('aria-label'),
    rate: document.getElementById('tpratev').textContent, follow: ARView.probe.follow }));
  chk('...and after a 1.5 s stall of the page\'s clock, back within the second it is allowed', re < 1000,
      'off by ' + re.toFixed(0) + ' ms ' + JSON.stringify(reS));

  /* B8: the globe stops drawing while covered. */
  const draws = await page.evaluate(async () => {
    const r = Orbit3D.renderer, render = r.render.bind(r), set = OrbitViz.setTime;
    let n = 0, m = 0; r.render = (...a) => { n++; return render(...a); }; OrbitViz.setTime = d => { m++; return set(d); };
    await new Promise(res => setTimeout(res, 600));
    const open = [n, m]; ARView.close();
    n = m = 0; await new Promise(res => setTimeout(res, 600));
    const after = [n, m]; r.render = render; OrbitViz.setTime = set;
    return { open, after };
  });
  chk('under the view the globe draws nothing and its labels are not laid out; closed, both resume',
      draws.open[0] === 0 && draws.open[1] === 0 && draws.after[0] > 0 && draws.after[1] > 0,
      'open ' + draws.open.join('/') + ', after ' + draws.after.join('/') + ' render/setTime calls in 600 ms');

  /* B9: a device with no compass, and the hand turn. */
  await page.evaluate(() => { __ar.calls.length = 0; __feed(null); });
  await tapAR(page);
  /* Aimed along the horizon, where turning about the vertical moves the sky
     straight across the screen; higher up the drag's 1/cos(el) is capped. */
  const relAz = await page.evaluate(() => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
    __feed(Object.assign({ type: 'deviceorientation' }, __aimAt(st.az, 0, 0, 0))); return st.az; });
  await page.waitForFunction(() => ARView.probe.source === 'rel', null, { timeout: 5000 }).catch(() => null);
  await settle(page);
  await page.waitForTimeout(300);                       // the readout writes the status four times a second
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
    await tapAR(page);
    await page.waitForFunction(() => ARView.probe.camera === 'live', null, { timeout: 10000 }).catch(() => null);
    const sLand = await page.evaluate(t => { const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms);
      __feed(Object.assign({ type: 'deviceorientationabsolute' }, __aimAt(st.az, 0, t, q.decl || 0))); return st; }, th);
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
  for(const how of ['Close', 'Escape', 'Back']){
    await page.evaluate(() => { __ar.streams.length = 0; });
    await tapAR(page);
    await page.waitForFunction(() => ARView.probe.camera === 'live', null, { timeout: 10000 }).catch(() => null);
    await aimSat(page, 0, true);
    await page.waitForTimeout(200);
    if(how === 'Close') await page.click('#ar-close');
    else if(how === 'Escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => history.back());
    await page.waitForTimeout(300);
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
  await page.evaluate(() => __feed(null));

  /* B13: a camera that answers after Close. */
  await page.evaluate(() => { __ar.streams.length = 0; __ar.delayMs = 800; });
  await tapAR(page);
  await page.waitForTimeout(100);
  await page.click('#ar-close');
  await page.waitForTimeout(1200);
  const late = await page.evaluate(() => ({ n: __ar.streams.length, ended: __ar.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }));
  await page.evaluate(() => { __ar.delayMs = 0; });
  chk('a camera that answers after Close is stopped at once, so the light never stays on', late.n === 1 && late.ended,
      late.n + ' late stream, ended ' + late.ended);

  /* B14: every refusal, in words. */
  const refuse = async (cfg, events, wait) => {
    await page.evaluate(c => { __ar.calls.length = 0; __ar.streams.length = 0; Object.assign(__ar, c); }, cfg);
    await tapAR(page);
    if(events) await page.evaluate(e => {
      const q = ARView.probe, st = __gt.stateAt(__gt.D.track, q.ms), a = __aimAt(st.az, st.el, 0, q.decl || 0);
      __feed(e === 'tilt' ? { type: 'deviceorientation', a: null, b: 20, g: 5 } : Object.assign({ type: 'deviceorientationabsolute' }, a));
    }, events);
    await page.waitForTimeout(wait || 500);
    const r = await page.evaluate(() => ({ q: (() => { const q = ARView.probe; delete q.stream; return q; })(),
      cls: document.getElementById('ar-status').className, calls: __ar.calls.map(c => c.what + ':' + c.evt),
      retry: !document.getElementById('ar-retry').hidden, retryText: document.getElementById('ar-retry').textContent,
      ended: __ar.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }));
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
  await page.waitForFunction(() => ARView.probe.camera === 'live', null, { timeout: 8000 }).catch(() => null);
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
  r = await refuse({ motion: 'absent' }, 'aim', 700);
  chk('...a browser with nothing to ask (Firefox, Samsung Internet) asks only for the camera, and the view runs',
      r.calls[0] === 'camera:click' && r.calls.length === 1 && r.q.state === 'running', r.calls.join(' ') + ', ' + r.q.state);
  await reset();
  r = await refuse({ camera: 'NotAllowedError' }, 'aim', 700);
  await page.evaluate(() => { __ar.camera = 'real'; __ar.calls.length = 0; });
  await page.tap('#ar-retry');
  await page.waitForFunction(() => ARView.probe.camera === 'live', null, { timeout: 8000 }).catch(() => null);
  const camAgain = await page.evaluate(() => ({ calls: __ar.calls.map(c => c.what + ':' + c.evt), cam: ARView.probe.camera }));
  chk('camera declined: the sky is drawn on black, the spacecraft still marked, and Try again asks inside its own tap',
      r.q.state === 'running' && /^Camera access was declined — the sky is drawn on black instead/.test(r.q.message) && r.q.marker && r.q.marker.on
      && r.retry && camAgain.calls[0] === 'camera:click' && camAgain.cam === 'live', camAgain.calls.join(' ') + ' → ' + camAgain.cam);
  await reset();
  r = await refuse({ camera: 'NotFoundError' }, 'aim');
  chk('...no rear camera: said, and nothing to try again', r.q.message === 'No camera on the back of this device — the sky is drawn on black instead.' && !r.retry);
  await reset();
  r = await refuse({ camera: 'NotReadableError' }, 'aim');
  chk('...a camera in use elsewhere: said, with Try again', /^The camera is in use by another app/.test(r.q.message) && r.retry);
  await reset();
  r = await refuse({ camera: 'user' }, 'aim', 900);
  chk('...only a front camera: stopped at once, since the sky drawn is the one behind the phone',
      /^The only camera offered faces you/.test(r.q.message) && r.ended && r.q.camera === 'front', r.q.camera);
  await reset();
  r = await refuse({ noCam: true }, 'aim');
  chk('...no camera for pages at all', r.q.message === 'This browser gives pages no camera — the sky is drawn on black instead.');
  await reset();
  r = await refuse({}, null, 3600);
  chk('no reading in 3 s after the prompts: said, with the camera stopped',
      r.q.state === 'failed' && (r.q.reason === 'no-sensor' || r.q.reason === 'no-reading') && r.ended,
      r.q.reason + ': "' + r.q.message.slice(0, 50) + '…"');
  await reset();
  r = await refuse({}, 'tilt', 3600);
  chk('...a device that reports its tilt but not which way it faces', r.q.reason === 'tilt'
      && r.q.message === 'This device reports its tilt but not which way it faces, so the view cannot follow it round.');
  await reset();

  /* B15: inside the view, the page's own rules. */
  await tapAR(page);
  await aimSat(page, 0, true);
  await page.waitForTimeout(300);
  await page.click('#ar-alignbtn');
  const rules = await page.evaluate(() => {
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
    return { small, n: btns.length, blocked, sw: document.documentElement.scrollWidth, w: innerWidth,
             untitled: [...root.querySelectorAll('abbr')].filter(a => !a.title).length };
  });
  chk('inside the view: no text under 11 px, every button reachable, no sideways scroll, every abbreviation titled',
      !rules.small.length && !rules.blocked.length && rules.sw <= rules.w && rules.untitled === 0,
      rules.n + ' controls' + (rules.small.length ? '; small: ' + rules.small.join(', ') : '') + (rules.blocked.length ? '; covered: ' + rules.blocked.join(', ') : ''));
  // kept out of the repository: a picture to look at, not a reference to compare against
  const shot = path.join(require('os').tmpdir(), 'gtc-ar-phone.png');
  await page.screenshot({ path: shot });
  console.log('        screenshot of the view: ' + shot);
  await closeAR(page);

  /* B16: Cape Town, where the declination is 27° west. */
  await page.evaluate(() => {
    document.getElementById('siteopen').click();
    document.getElementById('s-manual').open = true;
    const set = (id, v) => { document.getElementById(id).value = v; };
    set('s-name', 'Cape Town'); set('s-lat', -33.9249); set('s-lon', 18.4241); set('s-alt', 0); set('s-tz', 2);
    document.getElementById('siteapply').click();
  });
  await page.waitForFunction(() => __gt.OBS.name === 'Cape Town' && __gt.D && __gt.D.passes.length, null, { timeout: 20000 }).catch(() => null);
  await atBestPass(page);
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
      ct.decl < -25 && ct.marker && Math.hypot(ct.marker.x - ct.cx, ct.marker.y - ct.cy) < 1.5
      && near(miss, -ct.decl, 0.05) && ct2.marker && Math.hypot(ct2.marker.x - ct2.cx, ct2.marker.y - ct2.cy) > 50
      && ctDecl === Math.abs(ct.decl).toFixed(1) + '° W, applied',
      'D ' + ct.decl.toFixed(2) + '°; uncorrected, the view faces ' + miss.toFixed(2) + '° away in azimuth at ' +
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
  await page.waitForTimeout(800);
  const f0 = await probe(page), n0 = await page.evaluate(() => document.getElementById('ar-north').textContent);
  chk('an iPhone held upright from the start is finding north: horizon and mask drawn, nothing that needs a bearing',
      f0.state === 'finding' && f0.source === 'ios' && !f0.marker && f0.drawn.horizon && f0.drawn.mask && !f0.drawn.craft && !f0.drawn.compass
      && /^Finding north/.test(f0.message) && /^finding it/.test(n0),
      f0.state + ': "' + f0.message + '" / north "' + n0 + '" / ' + JSON.stringify(f0.drawn));
  await flat();
  await page.waitForTimeout(1500);
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
  const f3 = await probe(page);
  chk('...an uncalibrated compass for 3.5 s is said, and the bearing already taken is kept',
      /^The compass is not calibrated/.test(f3.message) && f3.marker && Math.hypot(f3.marker.x - f3.cx, f3.marker.y - f3.cy) < 1.5,
      '"' + f3.message.slice(0, 40) + '…"');
  await page.evaluate(() => { __ar.vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { __ar.vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  const f4 = await probe(page);
  await page.evaluate(c => { __ar.orient = 90; __feed({ type: 'deviceorientation', a: (330 + c + 23) % 360, b: 20, g: -30, h: 7, acc: 8 }); }, C);
  await page.waitForTimeout(1500);
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

/* ---- a phone in London, with the observer still in Bangkok ----------------- */
async function partLondon(browser, port){
  console.log('\nPart B — a phone that is not where the observer is\n');
  const { ctx, page, errs } = await phone(browser, port, { timezoneId: 'Europe/London',
    permissions: ['camera', 'geolocation'], geolocation: { latitude: 51.5074, longitude: -0.1278, accuracy: 25 } });
  await tapAR(page);
  await page.waitForTimeout(300);
  const a = await probe(page);
  /* The warning follows the observer, not the request that moved it: a Use my
     location answer that lands after the view has been closed and opened again
     moves the observer all the same, and the warning must go with it. Moved
     here by the page's own applySite, with the view open. */
  await page.evaluate(() => { window.__obs0 = Object.assign({}, __gt.OBS);
    __gt.applySite({ lat: 51.5, lon: -0.12, altKm: 0, name: 'London', tz: 1 }, false); });
  await page.waitForTimeout(400);
  const moved = await probe(page);
  await page.evaluate(() => __gt.applySite(__obs0, false));
  await page.waitForTimeout(400);
  const back = await probe(page);
  chk('...the warning follows the observer however it moves: gone for London, back for Bangkok',
      !/^The sky is drawn from/.test(moved.message) && /^The sky is drawn from Bangkok/.test(back.message),
      '"' + moved.message.slice(0, 40) + '…" then "' + back.message.slice(0, 40) + '…"');
  await page.tap('#ar-here');
  await page.waitForFunction(() => __gt.OBS.name === 'My location', null, { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(600);
  const b = await page.evaluate(() => ({ msg: ARView.probe.message, lat: __gt.OBS.lat, decl: document.getElementById('ar-decl').textContent,
    title: document.getElementById('ar-title').textContent, D: ARView.probe.decl }));
  chk('the sky is Bangkok\'s while the phone keeps London time: said, with the way out',
      /^The sky is drawn from Bangkok, and this phone keeps UTC\+1 — /.test(a.message), '"' + a.message.slice(0, 60) + '…"');
  chk('...Use my location moves the observer to the phone and works out London\'s declination',
      near(b.lat, 51.5074, 1e-6) && /accurate to about 25 m\.$/.test(b.msg) && b.title === 'Sky over My location'
      && b.D > 0.5 && b.decl === b.D.toFixed(1) + '° E, applied', b.decl + ' | "' + b.msg + '"');
  await page.evaluate(() => ARView.close());
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, permissions: ['camera'], timezoneId: 'Asia/Bangkok' });
  await ctx.addInitScript(MOCKS);
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for(const u of BLOCK) await page.route(u, r => r.abort());
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.__gt && window.__gt.D && window.ARView, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const g = await page.evaluate(() => {
    const b = document.getElementById('arbtn'), r = b.getBoundingClientRect();
    const h = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return { gl: !!(window.Orbit3D && Orbit3D.ok()), fallback: !document.getElementById('o3fallback').hidden,
             w: r.width, reach: !!h && (h === b || b.contains(h)),
             seg: getComputedStyle(document.querySelector('.camseg .seg')).display };
  });
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
  console.log('\nPart C — a desktop, over file://\n');
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for(const u of BLOCK) await page.route(u, r => r.abort());
  await page.goto('file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/'));
  await page.waitForFunction(() => window.__gt && window.__gt.D, null, { timeout: 60000 });
  const d = await page.evaluate(() => ({ shown: getComputedStyle(document.getElementById('arbtn')).display !== 'none',
    g: [typeof WMM, typeof SkyAR, typeof ARView].join(' '),
    pressed: [...document.querySelectorAll('.camseg .cam')].filter(c => c.getAttribute('aria-pressed') === 'true').length,
    povR: getComputedStyle(document.querySelector('.camseg .seg .btn:last-child')).borderTopRightRadius }));
  chk('no AR button without a touch screen; the camera row is as it was', !d.shown && d.pressed === 1 && d.povR === '3px',
      'one pressed, POV radius ' + d.povR);
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
    errs += await partB(browser, port);
    errs += await partIOS(browser, port);
    errs += await partLondon(browser, port);
    errs += await partNoGL(port);
    errs += await partC(browser);
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\npage errors: ' + (errs ? errs : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  process.exit(fails || errs ? 1 : 0);
})();
