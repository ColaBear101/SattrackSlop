/* skyar.js — the maths of the AR view: a phone's orientation as a camera.
 *
 * The AR view draws the sky over the rear camera's picture, where the phone
 * points. Everything it needs to know about geometry is here, as pure
 * functions of their arguments, so that node can check every one of them
 * without a browser. The DOM half is earth/arview.js.
 *
 * The frame. The W3C DeviceOrientation spec gives three angles, alpha, beta and
 * gamma, as an intrinsic Z-X'-Y'' rotation: R = Rz(alpha)·Rx(beta)·Ry(gamma)
 * takes device axes into an Earth frame of East, North and Up. The device axes
 * are those of the device in its NATURAL orientation - x to the right edge, y to
 * the top edge, z out of the screen - and turning the screen to landscape does
 * not change them. The rear camera looks along -z.
 *
 * Two things follow that are easy to get wrong:
 *
 * - The heading is never read off alpha. Held upright, beta is 90 and alpha and
 *   gamma swing together through 180 degrees for the smallest wobble; only the
 *   rotation matrix means anything there, and it means the same thing on both
 *   sides of the swing. frame(a, b, g) and frame(a+180, 180-b, g+180) are one
 *   pose, which the check proves.
 * - The screen's rotation changes which way is "up" in the picture, not which
 *   way the camera looks. It is a turn of the image about the view axis.
 *
 * Every direction here is an East-North-Up unit vector [E, N, U]; azimuth is
 * from north through east, the page's convention, and elevation is above the
 * horizon. Angles at the API are degrees.
 *
 * Nothing here touches the DOM.
 */
(function(global){
'use strict';

const RAD = Math.PI/180, DEG = 180/Math.PI;

const wrap360 = a => ((a % 360) + 360) % 360;
const wrap180 = a => { const w = wrap360(a); return w >= 180 ? w - 360 : w; };
const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const scale = (a, k) => [a[0]*k, a[1]*k, a[2]*k];
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
function norm(a){
  const m = Math.hypot(a[0], a[1], a[2]);
  return m > 0 ? [a[0]/m, a[1]/m, a[2]/m] : [0, 0, 0];
}
/* The angle between two unit vectors, in degrees. acos loses everything near
   0, which is exactly where a smoother and a turn rate live, so it is taken
   from the cross product's length and the dot product together. */
const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b))*DEG;

const enu = (az, el) => { const A = az*RAD, E = el*RAD;
  return [Math.cos(E)*Math.sin(A), Math.cos(E)*Math.cos(A), Math.sin(E)]; };
const azEl = v => ({ az: wrap360(Math.atan2(v[0], v[1])*DEG),
                     el: Math.asin(clamp(-1, 1, v[2]))*DEG });

/* ---- the device frame ----------------------------------------------------
 * The columns of R = Rz(a)·Rx(b)·Ry(g): the device's own axes, in ENU. Written
 * out rather than multiplied so each entry can be read against the spec's
 * Appendix A getRotationMatrix, which it matches term for term. */
function frame(alpha, beta, gamma){
  const a = alpha*RAD, b = beta*RAD, g = gamma*RAD;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b),
        cG = Math.cos(g), sG = Math.sin(g);
  return {
    x: [cA*cG - sA*sB*sG, sA*cG + cA*sB*sG, -cB*sG],     // right edge
    y: [-sA*cB,           cA*cB,            sB    ],     // top edge
    z: [cA*sG + sA*sB*cG, sA*sG - cA*sB*cG, cB*cG ]      // out of the screen
  };
}

/* The camera, from the frame and the screen's counter-clockwise rotation theta.
   The view axis is the rear camera's, -z, whatever the screen does; right and
   up are the picture's, which is the device frame turned by -theta about z.
   right x up = -fwd, and right = fwd x up. */
function camera(B, theta){
  const t = (theta || 0)*RAD, c = Math.cos(t), s = Math.sin(t);
  return {
    fwd:   scale(B.z, -1),
    right: [c*B.x[0] - s*B.y[0], c*B.x[1] - s*B.y[1], c*B.x[2] - s*B.y[2]],
    up:    [s*B.x[0] + c*B.y[0], s*B.x[1] + c*B.y[1], s*B.x[2] + c*B.y[2]]
  };
}
function pose(alpha, beta, gamma, theta){
  const cam = camera(frame(alpha, beta, gamma), theta);
  return Object.assign(cam, azEl(cam.fwd));
}

/* The inverse, for the checks: the W3C angles of a device frame, in the spec's
   ranges - alpha [0, 360), beta [-180, 180), gamma [-90, 90). The raw solve
   takes beta from the top edge's height and so lands in [-90, 90]; where that
   puts gamma outside its range, the other member of the double cover is the
   spec's answer. At beta = +-90 only alpha+gamma (or alpha-gamma) is defined,
   and gamma is taken as 0. */
function eulerFromBasis(B){
  const x = B.x, y = B.y, z = B.z;
  let beta = Math.asin(clamp(-1, 1, y[2]))*DEG, alpha, gamma;
  if(Math.hypot(y[0], y[1]) < 1e-9){
    gamma = 0;
    alpha = Math.atan2(x[1], x[0])*DEG;             // the spin left about the vertical
  } else {
    alpha = Math.atan2(-y[0], y[1])*DEG;
    gamma = Math.atan2(-x[2], z[2])*DEG;
  }
  if(gamma >= 90 || gamma < -90){
    alpha += 180;
    beta = 180 - beta;
    gamma += gamma >= 90 ? -180 : 180;
  }
  beta = wrap180(beta);
  return { alpha: wrap360(alpha), beta, gamma };
}

/* ---- which way round the screen is ---------------------------------------
 * window.orientation first: iOS 16.4 reported screen.orientation.angle in the
 * opposite sense to every other engine, and window.orientation, deprecated as
 * it is, has been the value engines agree on. Positive is counter-clockwise. */
function screenAngle(winOrientation, soAngle){
  if(typeof winOrientation === 'number' && isFinite(winOrientation)) return wrap360(winOrientation);
  if(typeof soAngle === 'number' && isFinite(soAngle)) return wrap360(soAngle);
  return 0;
}
/* The screen angle gravity implies: whichever device edge points most nearly up.
   Used only when the reported angle contradicts the window's own shape, which
   iOS 26 home-screen apps have been reported to do. Undecided near flat. */
function gravityAngle(B){
  const xU = B.x[2], yU = B.y[2];
  if(Math.max(Math.abs(xU), Math.abs(yU)) < 0.5) return null;
  if(Math.abs(xU) > Math.abs(yU)) return xU > 0 ? 90 : 270;
  return yU > 0 ? 0 : 180;
}

/* ---- the lens -------------------------------------------------------------
 * No web API reports a camera's field of view, so it is assumed and can be set
 * by hand. L is the angle across the SENSOR'S long side. Shown with
 * object-fit: cover, the stream is scaled by the larger of the two ratios and
 * its long side spans L, so in CSS pixels the focal length is
 *   F = max(W/vw, H/vh) · (max(vw, vh)/2) / tan(L/2).
 * With no picture the screen's long side is taken to span L. */
function focal(W, H, vw, vh, L){
  const t = Math.tan(L*RAD/2);
  if(vw > 0 && vh > 0) return Math.max(W/vw, H/vh)*(Math.max(vw, vh)/2)/t;
  return (Math.max(W, H)/2)/t;
}
/* What that lens shows of a W x H screen, in degrees. */
const viewOf = (F, W, H) => ({ h: 2*Math.atan(W/2/F)*DEG, v: 2*Math.atan(H/2/F)*DEG });
/* The 35 mm-equivalent focal length whose 4:3 long side (34.61 mm of the
   43.27 mm diagonal) spans L. */
const lensMm = L => 17.31/Math.tan(L*RAD/2);

/* ---- projection -------------------------------------------------------------
 * A pinhole camera. A direction more than about 81 degrees off the axis
 * (zc < 0.15) is not in any lens up to 80 degrees even on the diagonal, and is
 * not projected at all: projecting it would put a point behind the phone at the
 * far side of the screen. */
const FRONT = 0.15;
function project(cam, v, F, cx, cy){
  const zc = dot(v, cam.fwd), xc = dot(v, cam.right), yc = dot(v, cam.up);
  const front = zc >= FRONT;
  return { x: front ? cx + F*xc/zc : NaN, y: front ? cy - F*yc/zc : NaN, zc, xc, yc, front };
}
function unproject(cam, x, y, F, cx, cy){
  return norm(add(cam.fwd, add(scale(cam.right, (x - cx)/F), scale(cam.up, -(y - cy)/F))));
}
/* Where a ray from (ox, oy) along (dx, dy) leaves a rectangle it starts in:
   the off-screen pointer's place on the edge. */
function edgePoint(ox, oy, dx, dy, r){
  let t = Infinity;
  if(dx > 0) t = Math.min(t, (r.right - ox)/dx);
  if(dx < 0) t = Math.min(t, (r.left - ox)/dx);
  if(dy > 0) t = Math.min(t, (r.bottom - oy)/dy);
  if(dy < 0) t = Math.min(t, (r.top - oy)/dy);
  if(!isFinite(t)) return { x: ox, y: oy };
  return { x: ox + dx*t, y: oy + dy*t };
}
/* The part of the screen that looks below the horizon, as a polygon. The
   horizon is a great circle, so on a pinhole screen it is a straight line, and
   the ground is the half-plane where the unprojected direction points down:
   fwd.U + a·right.U - b·up.U < 0, with a = (x-cx)/F and b = (y-cy)/F. The
   screen rectangle is clipped to it. */
function groundPolygon(cam, F, cx, cy, W, H){
  const f = (x, y) => cam.fwd[2] + (x - cx)/F*cam.right[2] - (y - cy)/F*cam.up[2];
  const rect = [[0, 0], [W, 0], [W, H], [0, H]], out = [];
  for(let i = 0; i < 4; i++){
    const p = rect[i], q = rect[(i + 1) % 4], fp = f(p[0], p[1]), fq = f(q[0], q[1]);
    if(fp < 0) out.push(p);
    if((fp < 0) !== (fq < 0)){
      const t = fp/(fp - fq);
      out.push([p[0] + (q[0] - p[0])*t, p[1] + (q[1] - p[1])*t]);
    }
  }
  return out;
}

/* ---- smoothing -------------------------------------------------------------
 * The pose is blended as two vectors, the view axis and the picture's up,
 * rather than as Euler angles (which wrap) or quaternions (which have two signs
 * for one pose). The target is rebuilt from the sensor every frame and never
 * accumulated. The time constant falls as the phone turns faster, so a still
 * phone is steady and a sweeping one does not lag: 0.12 s below 20 deg/s, down
 * to 0.03 s at 90 deg/s and above. A jump of more than 60 degrees is taken at
 * once rather than swept through. */
function smoother(){
  let fwd = null, up = null, right = null, prev = null, lag = 0;
  const S = {
    snap(t){
      fwd = norm(t.fwd); up = norm(sub(t.up, scale(fwd, dot(t.up, fwd)))); right = cross(fwd, up);
      prev = fwd; lag = 0;
    },
    step(t, dt){
      if(!fwd){ S.snap(t); return S; }
      const tf = norm(t.fwd);
      if(dot(fwd, tf) < 0.5){ S.snap(t); return S; }
      if(!(dt > 0)){ return S; }
      const w = prev ? angle(prev, tf)/dt : 0;
      prev = tf;
      const tau = w < 20 ? 0.12 : w >= 90 ? 0.03 : 0.12 - (w - 20)/70*0.09;
      const k = 1 - Math.exp(-Math.min(dt, 0.5)/tau);
      fwd = norm(add(fwd, scale(sub(tf, fwd), k)));
      let u = add(up, scale(sub(t.up, up), k));
      up = norm(sub(u, scale(fwd, dot(u, fwd))));
      right = cross(fwd, up);
      lag = angle(fwd, tf);
      return S;
    },
    reset(){ fwd = up = right = prev = null; lag = 0; },
    get fwd(){ return fwd; }, get up(){ return up; }, get right(){ return right; },
    get lag(){ return lag; },
    get ready(){ return !!fwd; }
  };
  return S;
}

/* ---- where to turn -----------------------------------------------------------
 * The off-screen pointer's words. Looking nearly straight up or down, "turn
 * right" means nothing, so the target is given as a bearing instead. The
 * thresholds are on the unrounded angles; the text is rounded. compass is the
 * page's 16-point function, passed in so the page keeps its only copy. */
function steer(view, target, compass){
  if(Math.abs(view.el) > 70){
    if(angle(enu(view.az, view.el), enu(target.az, target.el)) < 2) return '';
    return 'face ' + compass(target.az) + ' (' + Math.round(wrap360(target.az)) % 360 + '°) · ' +
           Math.round(Math.abs(target.el)) + '° ' + (target.el >= 0 ? 'above' : 'below') + ' the horizon';
  }
  const dAz = wrap180(target.az - view.az), dEl = target.el - view.el, parts = [];
  if(Math.abs(dAz) > 170) parts.push('turn round');
  else if(Math.abs(dAz) >= 2) parts.push('turn ' + (dAz > 0 ? 'right' : 'left') + ' ' + Math.round(Math.abs(dAz)) + '°');
  if(Math.abs(dEl) >= 2) parts.push((dEl > 0 ? 'up ' : 'down ') + Math.round(Math.abs(dEl)) + '°');
  return parts.join(' · ');
}

/* ---- the Sun ---------------------------------------------------------------
 * From the site and the sub-solar point. The elevation is the page's
 * sunElevation expression, token for token, so the Sun drawn here agrees with
 * every solar elevation the page prints; the azimuth is the great-circle
 * bearing from the site to the sub-solar point. */
function sunAzEl(siteLat, siteLon, subLat, subLon){
  const p = siteLat*RAD, d = subLat*RAD, H = (siteLon - subLon)*RAD;
  const c = Math.sin(p)*Math.sin(d) + Math.cos(p)*Math.cos(d)*Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, c)))*DEG;
  const az = wrap360(Math.atan2(-Math.cos(d)*Math.sin(H),
                                Math.cos(p)*Math.sin(d) - Math.sin(p)*Math.cos(d)*Math.cos(H))*DEG);
  return { az, el };
}

/* ---- north on an iPhone -------------------------------------------------------
 * iOS gives no absolute orientation event. Its alpha has an arbitrary zero -
 * Core Motion's xArbitraryZVertical frame, set when updates start and drifting
 * slowly, since yaw there is the gyro's alone - and north arrives separately,
 * as webkitCompassHeading: MAGNETIC, clockwise, the heading of the device's
 * portrait top edge (WebKit never changes Core Location's headingOrientation, so
 * turning the screen does not change it). webkitCompassAccuracy is in degrees,
 * and negative means the heading is not to be used.
 *
 * The two are tied by an offset. With the top edge's azimuth in alpha's frame
 * being 360 - alpha whenever cos(beta) > 0, whatever gamma is,
 *     offset = heading - (360 - alpha),   alpha_magnetic = alpha - offset.
 *
 * Apple does not document which axis the heading follows once the phone is
 * upright or tipped back at the sky - the top edge, or the rear camera, which
 * is the pose AR is used in. So a sample is taken only where that cannot
 * matter: with the screen within 60 degrees of flat, where the formula is
 * exact, or tilted further, up to 85 degrees, only where the top-edge and
 * camera readings of the same heading agree to within 2 degrees. The tilt is
 * the screen's true one, cos(tilt) = cos(beta)·cos(gamma): a box of 60 degrees
 * on each angle would let in corners 75 degrees from flat, where the two
 * readings are 63 degrees apart. Everywhere else the estimate is held. That is
 * sound whichever axis iOS uses; the cost is that a reader who never lowers
 * the phone never gets a bearing.
 *
 * Accepted samples are averaged on the circle (sines and cosines), as a running
 * mean for the first twenty and then with a 5 s time constant counted in the
 * time the samples themselves cover, which follows the gyro's drift - not in
 * the time since the last one taken, which after half a minute held upright
 * would hand the next sample the whole estimate. A reading that disagrees by
 * more than 20 degrees for 1.5 s of samples in a row is believed and the
 * average restarts from it; any sample refused in between starts that count
 * again. */
function compassFusion(){
  let S = 0, C = 0, est = null, n = 0, acc = null, at = null;
  let prevB = null, prevT = null, disagree = null, uncalSince = null, badSince = null;
  const no = why => { disagree = null; return { accepted: false, why }; };
  const F = {
    feed(s){
      const t = s.t, B = frame(s.alpha, s.beta, s.gamma), fwd = scale(B.z, -1);
      const gap = prevT === null ? Infinity : t - prevT;
      /* How fast the whole phone turns, not just its camera axis: lying flat,
         the camera points at the floor and hardly moves while the phone spins
         round it, which is exactly when the compass lags. The larger of the
         turns of two axes at right angles is within a factor of about 1.4 of
         the true rotation angle, which is plenty for a 20 deg/s gate. */
      const rate = (prevB && gap > 0)
        ? Math.max(angle(prevB.y, B.y), angle(prevB.z, B.z))/(gap/1000) : Infinity;
      prevB = B; prevT = t;
      if(gap > 2000 && n) n = 0;                    // a long silence: the next samples decide
      const H = s.heading, a = s.accuracy;
      if(typeof H !== 'number' || !isFinite(H)) return no('no-heading');
      if(!(typeof a === 'number' && a >= 0)){
        if(uncalSince === null) uncalSince = t;
        return no('uncalibrated');
      }
      uncalSince = null;
      if(a > 25){ if(badSince === null) badSince = t; return no('poor'); }
      badSince = null;
      if(!(gap <= 1000)) return no('gap');
      if(rate > 20) return no('turning');
      const cb = Math.cos(s.beta*RAD), flat = cb*Math.cos(s.gamma*RAD) >= 0.5;   // within 60° of flat
      const oTop = cb > 0 ? wrap180(H - (360 - s.alpha)) : null;
      let o = null;
      if(flat) o = oTop;
      else if(oTop !== null && Math.abs(s.beta) < 85){
        const oCam = wrap180(H - azEl(fwd).az);
        if(Math.abs(wrap180(oTop - oCam)) < 2) o = oTop;
      }
      if(o === null) return no('upright');
      if(n >= 20 && Math.abs(wrap180(o - est)) > 20){
        if(disagree === null) disagree = t;
        if(t - disagree < 1500) return { accepted: false, why: 'outlier' };
        n = 0;
      }
      disagree = null;
      const k = n < 20 ? 1/(n + 1) : 1 - Math.exp(-gap/5000);
      S += k*(Math.sin(o*RAD) - S);
      C += k*(Math.cos(o*RAD) - C);
      est = wrap180(Math.atan2(S, C)*DEG);
      n++; acc = a; at = t;
      return { accepted: true, why: null };
    },
    reset(){ S = C = 0; est = acc = at = null; n = 0;
             prevB = prevT = disagree = uncalSince = badSince = null; },
    reseed(){ n = 0; },
    get offset(){ return est; }, get n(){ return n; }, get accuracy(){ return acc; },
    get at(){ return at; }, get uncalSince(){ return uncalSince; }, get badAccSince(){ return badSince; }
  };
  return F;
}

/* ---- time ticks along a pass ----------------------------------------------------
 * The first step that puts at most fifteen ticks on the pass: a minute for a
 * LEO pass, up to twelve hours for a geostationary spacecraft that is up for
 * the whole of the console's longest window, 7 days. Ticks fall on the
 * observer's clock (tzHours may be fractional, as in Nepal), and none sits
 * within a quarter step of either end, where the AOS and LOS labels are. */
const TICK_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];
function ticks(t0ms, t1ms, tzHours){
  const span = (t1ms - t0ms)/1000;
  if(!(span > 0)) return [];
  let step = 86400;
  for(const s of TICK_STEPS) if(span/s <= 15){ step = s; break; }
  const ms = step*1000, off = (tzHours || 0)*3600000, out = [];
  for(let t = Math.ceil((t0ms + off)/ms)*ms - off; t < t1ms; t += ms)
    if(t > t0ms + ms/4 && t < t1ms - ms/4) out.push(t);
  return out;
}

/* ---- the camera's refusals, by name ---------------------------------------------- */
function cameraFailure(name){
  switch(name){
    case 'NotAllowedError': case 'SecurityError': return 'declined';
    case 'NotFoundError': case 'OverconstrainedError': return 'none';
    case 'NotReadableError': case 'AbortError': return 'busy';
    case 'NoApi': return 'unavailable';
    default: return 'other';
  }
}

global.SkyAR = {
  RAD, DEG, FRONT,
  wrap360, wrap180, clamp, dot, cross, norm, angle, enu, azEl,
  frame, camera, pose, eulerFromBasis, screenAngle, gravityAngle,
  focal, viewOf, lensMm, project, unproject, edgePoint, groundPolygon,
  smoother, steer, sunAzEl, compassFusion, ticks, cameraFailure
};

})(typeof window !== 'undefined' ? window : globalThis);
