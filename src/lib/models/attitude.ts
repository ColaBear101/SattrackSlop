/* Which way a spacecraft model points, and how a model's own axes are turned into the page's (CHANGES-FROM-LEGACY.md, L72).
 *
 * New in the rebuild. The close-up camera draws a model of the spacecraft where it is, turned the way a station flies: along the
 * track, with its top away from the Earth. That is the local-vertical, local-horizontal frame (LVLH), and it is the frame the POV
 * camera already builds every frame (scene/orbit3d.ts, aimPov): up is the radius vector, forward is the velocity with its radial
 * part taken out, with the same two fallbacks when the velocity says nothing. It is written again here as plain arithmetic so
 * that the close-up and the tests share one definition, and the test holds it to aimPov's.
 *
 * Every model the page ships is exported in one frame, the canonical frame: +Z forward (along the track), +Y up (away from the
 * Earth), +X = up x forward, which is right-handed. glTF's own convention is +Y up with the front facing +Z, so a model drawn the
 * glTF way needs nothing done to it. A model a reader adds says which of its own axes is forward and which is up, and modelFrame
 * turns it into the canonical frame.
 *
 * Vectors are plain triples in the scene's axes (ECI x, z, -y; see the header of scene/orbit3d.ts). Pure. */

export type V3 = readonly [number, number, number];
export type Axis = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
export const AXES: readonly Axis[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** The canonical model frame's three axes, in the scene's axes. */
export interface Frame { left: V3; up: V3; forward: V3 }

/** The LVLH frame of a spacecraft at `r` (any length) moving with `v` (any length, or null). Forward is the local-horizontal part of
 *  the velocity; when there is none (a velocity along the radius, or none at all) it falls back as aimPov does: the scene's +Y with
 *  its radial part taken out, and failing that the scene's +X. */
export function lvlh(r: V3, v: V3 | null): Frame {
  const up = unit(r);
  let ahead: V3 = v && dot(v, v) > 1e-12 ? v : [0, 1, 0];
  ahead = sub(ahead, scale(up, dot(ahead, up)));
  if (dot(ahead, ahead) < 1e-12) {
    ahead = sub([0, 1, 0], scale(up, up[1]));
    if (dot(ahead, ahead) < 1e-12) ahead = sub([1, 0, 0], scale(up, up[0]));
  }
  const forward = unit(ahead);
  return { left: unit(cross(up, forward)), up, forward };
}

/** The frame as a column-major 3x3 (the columns are left, up, forward): three's Matrix4.makeBasis(left, up, forward) is the same
 *  rotation, which takes the canonical model frame to the scene. */
export const frameMatrix = (f: Frame): number[] => [...f.left, ...f.up, ...f.forward];

/** The unit vector along one of a model's own axes. */
export function axisVector(a: Axis): V3 {
  const k = a[0] === '-' ? -1 : 1, i = 'XYZ'.indexOf(a[1]!);
  return [i === 0 ? k : 0, i === 1 ? k : 0, i === 2 ? k : 0];
}

/** The rotation that takes a model whose own forward axis is `forward` and whose own up axis is `up` into the canonical frame, as a
 *  column-major 3x3 (column j is where the model's own axis j goes). Null when the two are the same axis or opposite ones: a model
 *  cannot be told which way is up by the axis it was just told is forward. The result is always a proper rotation (no mirror),
 *  because the third axis is made from the other two. */
export function modelFrame(forward: Axis, up: Axis): number[] | null {
  const f = axisVector(forward), u = axisVector(up);
  if (dot(f, u) !== 0) return null;
  const x = cross(u, f);                       // the canonical +X in the model's own axes
  /* The rows of the rotation are the canonical axes written in the model's: (x; u; f). Column-major, column j is (x_j, u_j, f_j). */
  return [x[0], u[0], f[0], x[1], u[1], f[1], x[2], u[2], f[2]];
}

/** A slow turn for a spacecraft that is not pointed, in radians, at simulated time `ms`: from the clock, not from the wall, so a
 *  scrub turns it with everything else and two frames of the same instant agree. */
export const spinAngle = (degPerSec: number, ms: number): number => ((ms / 1000 * degPerSec) % 360) * Math.PI / 180;

/* ---- how a model flies (CHANGES-FROM-LEGACY.md, L77) ------------------------------------------------------------------------ *
 * New in the rebuild, and only when the reader asks (the close-up's "How it flies" panel): where the model points, which of its
 * faces it points, three turns from there, and a spin about one of its own axes. It is one turn of the model's pivot in the craft's
 * frame (scene/closeup-pass.ts), the frame above (+Z along the track, +Y away from the Earth, +X the orbit normal):
 *
 *   pose = pointing · offsets · base · spin
 *
 * - pointing: 'track' brings the chosen face onto the track by the least turn from how the model flies (a side or the back leading
 *   keeps the top away from the Earth; the top or the bottom leading keeps the left side on the orbit normal), so the front leading is
 *   no turn at all. 'sun' brings the face onto the Sun as it would be brought onto the sky overhead, with the orbit normal for the
 *   second axis: the Sun goes once round it an orbit, so the model turns smoothly and the Earth's track never enters into it (a
 *   track-held second axis would flip twice an orbit when the Sun is near the orbit's plane). Only with the Sun on the normal itself,
 *   a beta angle of 90 degrees, does the track stand in. 'stars' holds the model where it was among the stars when it was chosen.
 * - offsets: yaw, pitch and roll, in degrees, in that order about the pointed model's own axes (three's Euler order 'YXZ', which aimPov
 *   turns the POV camera in), signed as a pilot reads them: yaw + turns the front to the right, pitch + raises it, roll + lowers the
 *   right side.
 * - spin: a rate about each of the model's own three axes, degrees a second, + anticlockwise seen from the axis's tip, timed by the
 *   page's clock and not the wall's. Rates held steady about the model's own axes are one turn about their sum as a vector, at its
 *   length: the model turns about the direction (x, y, z) at sqrt(x² + y² + z²) degrees a second, so a rate about one axis alone is
 *   the spin about that axis it always was. Its phase is (ms - t0) / 1000 * rate + phase0, and `base` is the turn the model had made
 *   when the spin last changed direction or stopped (the anchor, SpinAnchor). A change of the rates, or a spin stopped or started,
 *   re-anchors it at
 *   the instant last drawn (respin), so the model is where it was at that instant and turns on from there, and the pose is still a pure
 *   function of the settings, the anchor and the instant: a scrub turns it as it turns everything else. A new pointing, or a new face
 *   pointed, lets the turn made so far go and starts the spin again from that instant (reanchor), so that the face is where it was sent
 *   and not wherever an earlier spin left it; the offsets turn the model by themselves and leave the anchor as it is. With the anchor at
 *   the clock's epoch (ANCHOR0) the phase is spinAngle's to the bit, so a model flying its own attitude is drawn exactly as before.
 *
 * Quaternions are [x, y, z, w], as three keeps them, and each operation below repeats three's arithmetic (Quaternion's setFromAxisAngle,
 * setFromRotationMatrix, setFromEuler with the order 'YXZ', multiplyQuaternions), so a pose is the same number whichever side works it
 * out (tests/lib/attitude.test.ts holds them to three's). */

export type Quat = readonly [number, number, number, number];
export type Pointing = 'track' | 'sun' | 'stars';
export const POINTINGS: readonly Pointing[] = ['track', 'sun', 'stars'];

/** Rates about the model's own +X, +Y and +Z, degrees a second, right-handed: a positive rate is anticlockwise seen from the axis's tip. */
export interface Spin { rate: V3 }
/** A spin about one axis as the page's registry writes it (lib/models/registry.ts), and as gt.attitude kept it before the three rates. */
export interface AxisSpin { axis: Axis; degPerSec: number }

export interface Attitude {
  pointing: Pointing;
  /** the face pointed: along the track ('track'), at the Sun ('sun'); kept but unused while 'stars' */
  face: Axis;
  /** yaw, pitch and roll from the pointing, degrees, -180 to 180 */
  ypr: V3;
  spin: Spin | null;
}

/** The fastest rate the card offers about each axis, either way, degrees a second. */
export const MAX_SPIN = 90;

/** A spin about one axis as three rates: about a minus axis it is the plus axis's rate reversed. Null for a rate of 0. */
export function spinFrom(s: AxisSpin | null): Spin | null {
  if (!s || !s.degPerSec) return null;
  const v = axisVector(s.axis);
  return { rate: [v[0] * s.degPerSec || 0, v[1] * s.degPerSec || 0, v[2] * s.degPerSec || 0] };   // no -0 in a rate of none
}
/** The spin's rate vector, or null when it is no spin (none, or all three rates 0). */
export const spinRate = (s: Spin | null): V3 | null => (s && (s.rate[0] || s.rate[1] || s.rate[2]) ? s.rate : null);
/** How fast it turns, degrees a second, about the direction of its rates. */
export const spinSpeed = (s: Spin | null): number => { const r = spinRate(s); return r ? Math.hypot(r[0], r[1], r[2]) : 0; };

/** How a model flies of its own: along the track, its front leading, unturned; a page's model with its spin (lib/models/registry.ts),
 *  a reader's model with none. */
export const ownAttitude = (spin: AxisSpin | null = null): Attitude =>
  ({ pointing: 'track', face: '+Z', ypr: [0, 0, 0], spin: spinFrom(spin) });

const sameSpin = (a: Spin | null, b: Spin | null): boolean => {
  const x = spinRate(a), y = spinRate(b);
  return x === null || y === null ? x === y : x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
};
export const sameAttitude = (a: Attitude, b: Attitude): boolean =>
  a.pointing === b.pointing && a.face === b.face && a.ypr[0] === b.ypr[0] && a.ypr[1] === b.ypr[1] && a.ypr[2] === b.ypr[2] && sameSpin(a.spin, b.spin);

/* ---- quaternions, as three works them ---- */

export const IDENTITY: Quat = [0, 0, 0, 1];
const isIdentity = (q: Quat): boolean => q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1;

/** Quaternion.setFromAxisAngle (the axis a unit vector). */
export function axisAngle(v: V3, angle: number): Quat {
  const half = angle / 2, s = Math.sin(half);
  return [v[0] * s, v[1] * s, v[2] * s, Math.cos(half)];
}

/** Quaternion.multiplyQuaternions(a, b): b first, then a. */
export function mulQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

/** Quaternion.invert, for a unit quaternion (its conjugate). */
export const conjQuat = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** Quaternion.setFromRotationMatrix, from a column-major 3x3 rotation. */
export function quatFromMatrix(m: readonly number[]): Quat {
  const m11 = m[0]!, m12 = m[3]!, m13 = m[6]!, m21 = m[1]!, m22 = m[4]!, m23 = m[7]!, m31 = m[2]!, m32 = m[5]!, m33 = m[8]!;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

/** Quaternion.setFromEuler(new Euler(x, y, z, 'YXZ')), radians: about Y, then X, then Z. */
export function quatFromEulerYXZ(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3
  ];
}

/** The craft's frame as a quaternion in the scene's axes: what closeup-pass.ts makes of makeBasis(left, up, forward). */
export const frameQuat = (f: Frame): Quat => quatFromMatrix(frameMatrix(f));

/** Apply a turn to a vector (Vector3.applyQuaternion). */
export function rotate(q: Quat, v: V3): V3 {
  const [qx, qy, qz, qw] = q, [x, y, z] = v;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

/* ---- pointing ---- */

/** The rotation (column-major 3x3) that takes the model's own axis `f` exactly onto `t1`, and its axis `s` (at right angles to f) as
 *  near `t2` as it can go (TRIAD). Null when t2 is along t1 and says nothing. With whole axes for all four it is whole numbers, exactly. */
function triad(f: V3, s: V3, t1: V3, t2: V3): number[] | null {
  const n1 = unit(t1), c = cross(n1, t2), l = Math.hypot(c[0], c[1], c[2]);
  if (!(l > 1e-6)) return null;
  const n2 = scale(c, 1 / l), n3 = cross(n1, n2);
  const m1 = f, m2 = unit(cross(f, s)), m3 = cross(m1, m2);
  const r: number[] = [];
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) r.push(n1[row]! * m1[col]! + n2[row]! * m2[col]! + n3[row]! * m3[col]!);
  return r;
}

const NORMAL: V3 = [1, 0, 0], UP: V3 = [0, 1, 0], TRACK: V3 = [0, 0, 1];
/* the axis kept as the second one, by the face pointed: along the track the top stays up unless it is the top or the bottom that leads;
   toward the Sun the left side goes to the orbit normal, or for a side to the Sun the bottom (the left side) or the top (the right side),
   which is the least turn from how the model flies when the Sun is overhead */
const TRACK_SECOND: Record<Axis, [Axis, V3]> = {
  '+Z': ['+Y', UP], '-Z': ['+Y', UP], '+X': ['+Y', UP], '-X': ['+Y', UP], '+Y': ['+X', NORMAL], '-Y': ['+X', NORMAL]
};
const SUN_SECOND: Record<Axis, Axis> = { '+Z': '+X', '-Z': '+X', '+Y': '+X', '-Y': '+X', '+X': '-Y', '-X': '+Y' };

/** Where the reader's pointing puts the model, before its offsets and its spin. */
export interface PoseAt {
  /** the Sun, a unit vector in the craft's frame (null: none, and 'sun' falls back to the track) */
  sun: V3 | null;
  /** the craft's frame now, as a quaternion in the scene's axes (frameQuat) */
  frame: Quat;
  /** 'stars': the model's turn in the scene's axes when it was chosen (the frame then, times the pointing then); null holds it as now */
  held: Quat | null;
}

function trackPointing(face: Axis): Quat {
  const [second, toward] = TRACK_SECOND[face];
  return quatFromMatrix(triad(axisVector(face), axisVector(second), TRACK, toward)!);
}

/** The pointing alone, as a turn in the craft's frame. */
export function pointingOf(a: Attitude, at: PoseAt): Quat {
  if (a.pointing === 'stars') return at.held ? mulQuat(conjQuat(at.frame), at.held) : IDENTITY;
  if (a.pointing === 'sun' && at.sun && dot(at.sun, at.sun) > 1e-12) {
    const sun = unit(at.sun), f = axisVector(a.face), s = axisVector(SUN_SECOND[a.face]);
    const m = triad(f, s, sun, NORMAL) ?? triad(f, s, sun, TRACK);
    if (m) return quatFromMatrix(m);
  }
  return trackPointing(a.face);
}

/** The offsets alone: yaw + turns the front right, pitch + raises it, roll + lowers the right side (degrees). */
export function offsetsOf(ypr: V3): Quat {
  if (ypr[0] === 0 && ypr[1] === 0 && ypr[2] === 0) return IDENTITY;
  const r = Math.PI / 180;
  return quatFromEulerYXZ(-ypr[1] * r, -ypr[0] * r, ypr[2] * r);
}

/* ---- spin ---- */

/** Where a spin's phase is counted from: `phase0` degrees at simulated time `t0`, on top of the turn `base`. */
export interface SpinAnchor { readonly t0: number; readonly phase0: number; readonly base: Quat }
/** The clock's epoch: the phase spinAngle has always given. */
export const ANCHOR0: SpinAnchor = Object.freeze({ t0: 0, phase0: 0, base: IDENTITY });

/** A spin's phase in degrees, -360 to 360, at simulated time `ms`. With ANCHOR0 it is spinAngle's before the radians, to the bit. */
export function spinPhase(degPerSec: number, ms: number, k: SpinAnchor = ANCHOR0): number {
  const turned = (ms - k.t0) / 1000 * degPerSec;
  return (k.phase0 === 0 ? turned : turned + k.phase0) % 360;
}

/** The direction a spin turns about, a unit vector in the model's own axes: a rate about one axis alone is that axis exactly (so a spin
 *  about one axis is the turn it always was, to the bit, whatever its rate), and rates about two or three are their direction. */
export const spinAxisOf = (r: V3): V3 =>
  (r[0] ? 1 : 0) + (r[1] ? 1 : 0) + (r[2] ? 1 : 0) === 1 ? [Math.sign(r[0]) || 0, Math.sign(r[1]) || 0, Math.sign(r[2]) || 0] : unit(r);
const spinQuat = (r: V3, ms: number, k: SpinAnchor): Quat =>
  axisAngle(spinAxisOf(r), spinPhase(Math.hypot(r[0], r[1], r[2]), ms, k) * Math.PI / 180);

/** The anchor after the spin changes from `from` to `to` at `ms`, the instant last drawn, so that the model is where it was then:
 *  new rates in the same direction carry the phase on; a new direction, or none, keeps the turn made so far in `base` and starts
 *  from 0. */
export function respin(from: Spin | null, to: Spin | null, k: SpinAnchor, ms: number): SpinAnchor {
  const f = spinRate(from), t = spinRate(to);
  if (!f && !t) return k;
  if (f && t) {
    const a = spinAxisOf(f), b = spinAxisOf(t);
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) {
      const vf = Math.hypot(f[0], f[1], f[2]), vt = Math.hypot(t[0], t[1], t[2]);
      return vf === vt ? k : { t0: ms, phase0: spinPhase(vf, ms, k), base: k.base };
    }
  }
  return { t0: ms, phase0: 0, base: f ? mulQuat(k.base, spinQuat(f, ms, k)) : k.base };
}

/** The anchor after the reader's attitude changes from `from` to `to` at `ms`, the instant last drawn. A new pointing along the track
 *  or toward the Sun, or a new face pointed there, puts the model where it says: the turn made so far is let go and the spin starts
 *  again from that instant, from none, so the face is exactly where it was sent. Anything else leaves the model where it was (respin),
 *  and so does 'stars', which holds the model as it is. */
export function reanchor(from: Attitude, to: Attitude, k: SpinAnchor, ms: number): SpinAnchor {
  if (to.pointing !== 'stars' && (to.pointing !== from.pointing || to.face !== from.face)) return { t0: ms, phase0: 0, base: IDENTITY };
  return respin(from.spin, to.spin, k, ms);
}

/** The model's whole turn in the craft's frame at simulated time `ms`: pointing · offsets · base · spin. A turn that is none is not
 *  multiplied in, so a model flying its own attitude from ANCHOR0 gets exactly setFromAxisAngle's quaternion (or the identity). */
export function pose(a: Attitude, at: PoseAt, ms: number, k: SpinAnchor = ANCHOR0): Quat {
  const s = spinRate(a.spin);
  let q: Quat = s ? spinQuat(s, ms, k) : IDENTITY;
  if (!isIdentity(k.base)) q = mulQuat(k.base, q);
  const o = offsetsOf(a.ypr);
  if (!isIdentity(o)) q = mulQuat(o, q);
  const p = pointingOf(a, at);
  if (!isIdentity(p)) q = mulQuat(p, q);
  return q;
}
