import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
  ANCHOR0, AXES, IDENTITY, MAX_SPIN, axisAngle, axisVector, conjQuat, frameQuat, lvlh, mulQuat, offsetsOf, ownAttitude, pointingOf,
  pose, quatFromEulerYXZ, quatFromMatrix, reanchor, respin, rotate, sameAttitude, spinAngle, spinAxisOf, spinFrom, spinPhase, spinRate, unit,
  type Attitude, type AxisSpin, type Axis, type PoseAt, type Quat, type Spin, type SpinAnchor, type V3
} from '../../src/lib/models/attitude';
import { ATTITUDE_KEY, ATTITUDE_MAX, ownId, readAttitude, readAttitudes, writeAttitudes } from '../../src/lib/models/attitude-record';
import { BUILT_IN } from '../../src/lib/models/registry';
import { flightLine, period, POINTING_NAMES, rateText } from '../../src/lib/text/closeup-card';
import { FACES, SIGNS } from '../../src/lib/text/attitude';

/* How a model flies in the close-up (CHANGES-FROM-LEGACY.md, L77): a model flying its own attitude is drawn exactly as before; a spin's
   rate or axis changed at an instant leaves the model where it was at that instant; each pointing puts the face where it says, by the
   turns it says, smoothly over an orbit; the offsets turn the way their words say; every quaternion is three's to the bit; and the
   record of the reader's settings is read as untrusted text. */

const D = Math.PI / 180;
const three = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w];
/** the same numbers to the bit, the sign of a zero included */
const bitSame = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const near = (a: readonly number[], b: readonly number[], eps: number) => a.every((x, i) => Math.abs(x - b[i]!) <= eps);
/** the angle of the turn between two orientations, radians (q and -q are one orientation); by atan2, which keeps its precision near 0 */
const between = (a: Quat, b: Quat) => { const r = mulQuat(conjQuat(a), b); return 2 * Math.atan2(Math.hypot(r[0], r[1], r[2]), Math.abs(r[3])); };
const AT: PoseAt = { sun: unit([0.3, 0.8, 0.52]), frame: IDENTITY, held: null };
const T1 = 1_790_000_123_456;
const KNACK = BUILT_IN.find(b => b.id === 'knacksat2')!;
/** a spin about one axis, as the registry writes it, and the same as the three rates the attitude keeps */
const A = (axis: Axis, degPerSec: number): AxisSpin => ({ axis, degPerSec });
const S = (axis: Axis, degPerSec: number): Spin | null => spinFrom(A(axis, degPerSec));

describe('a model flying its own attitude', () => {
  it('is KNACKSAT-2 turning +Z at 2 degrees a second from the clock\'s epoch, and the others in the bare frame', () => {
    expect(KNACK.spin).toEqual({ axis: '+Z', degPerSec: 2 });
    expect(ownAttitude(KNACK.spin ?? null)).toEqual({ pointing: 'track', face: '+Z', ypr: [0, 0, 0], spin: { rate: [0, 0, 2] } });
    for (const b of BUILT_IN.filter(m => m.id !== 'knacksat2')) expect(b.spin).toBeUndefined();
    expect(ownAttitude()).toEqual({ pointing: 'track', face: '+Z', ypr: [0, 0, 0], spin: null });
  });
  it('gets exactly the quaternion the close-up has always drawn: setFromAxisAngle(+Z, spinAngle), or the identity', () => {
    const own = ownAttitude(KNACK.spin ?? null);
    for (const ms of [0, 1, 45_000, 180_000, 1_790_000_000_000, T1, T1 + 0.25, 1.8e12, -5_000]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), spinAngle(2, ms));
      expect(bitSame(pose(own, AT, ms), three(q)), String(ms)).toBe(true);
      expect(bitSame(pose(own, { ...AT, sun: [0, 0, -1] }, ms, ANCHOR0), three(q))).toBe(true);   // the Sun has nothing to do with it
    }
    for (const b of BUILT_IN.filter(m => !m.spin)) expect(bitSame(pose(ownAttitude(b.spin ?? null), AT, T1), [0, 0, 0, 1])).toBe(true);
    expect(bitSame(pose(ownAttitude(), AT, T1), [0, 0, 0, 1])).toBe(true);
  });
  it('counts the phase from the epoch as spinAngle does, to the bit, at any rate the panel offers', () => {
    for (const d of [2, -2, 0.1, 37.5, MAX_SPIN, -MAX_SPIN, 0.3]) for (const ms of [0, 999, 45_000, T1, 1.8e12, 1_790_000_000_000.5]) {
      expect(Object.is(spinPhase(d, ms), (ms / 1000 * d) % 360), d + ' at ' + ms).toBe(true);
      expect(Object.is(spinPhase(d, ms) * Math.PI / 180, spinAngle(d, ms))).toBe(true);
    }
  });
});

describe('a spin changed while the model is on screen', () => {
  const wrap = (x: number) => ((x % 360) + 540) % 360 - 180;
  it('keeps the phase at the instant of a new rate the same way exactly, and turns at the new rate from there', () => {
    for (const [d1, d2] of [[2, 5], [-2, -0.1], [37.5, 90], [0.1, 37.5], [90, 89.9]] as const) {
      const k = respin(S('+Z', d1), S('+Z', d2), ANCHOR0, T1);
      expect(spinPhase(Math.abs(d2), T1, k)).toBe(spinPhase(Math.abs(d1), T1, ANCHOR0));
      for (const dt of [1, 7_250, 3_600_000]) {
        expect(Math.abs(wrap(spinPhase(Math.abs(d2), T1 + dt, k) - spinPhase(Math.abs(d2), T1, k) - Math.abs(d2) * dt / 1000))).toBeLessThan(1e-6);
      }
    }
  });
  it('leaves the model where it was when a rate is reversed or another axis joins in, and turns it about the new direction', () => {
    const a1 = ownAttitude(A('+Z', 2));
    for (const r of [[0, 0, -5], [3, 0, 2], [0, 4, 0], [-1, 2, -3], [90, -90, 90]] as V3[]) {
      const a2: Attitude = { ...a1, spin: { rate: r } }, k = respin(a1.spin, a2.spin, ANCHOR0, T1);
      expect(between(pose(a2, AT, T1, k), pose(a1, AT, T1))).toBeLessThan(1e-9);
      const v = Math.hypot(r[0], r[1], r[2]), rel = mulQuat(conjQuat(pose(a2, AT, T1, k)), pose(a2, AT, T1 + 1500, k));
      expect(between(rel, axisAngle(unit(r), v * 1.5 * D)), String(r)).toBeLessThan(1e-9);
    }
  });
  it('keeps the whole turn when the axis changes, and then turns about the model\'s own new axis', () => {
    const a1 = ownAttitude(A('+Z', 2)), a2: Attitude = { ...a1, spin: S('+X', 10) };
    const k = respin(a1.spin, a2.spin, ANCHOR0, T1);
    expect(near(pose(a2, AT, T1, k), pose(a1, AT, T1), 1e-12)).toBe(true);
    const rel = mulQuat(conjQuat(pose(a2, AT, T1, k)), pose(a2, AT, T1 + 9000, k));
    expect(between(rel, axisAngle([1, 0, 0], 90 * D))).toBeLessThan(1e-9);
  });
  it('stops where it is when the spin is taken off, and starts from there when one is put on', () => {
    const a1 = ownAttitude(A('+Z', 2)), still: Attitude = { ...a1, spin: null };
    const k = respin(a1.spin, null, ANCHOR0, T1);
    expect(near(pose(still, AT, T1, k), pose(a1, AT, T1), 1e-12)).toBe(true);
    expect(bitSame(pose(still, AT, T1 + 600_000, k), pose(still, AT, T1, k))).toBe(true);
    const on: Attitude = { ...a1, spin: S('+Y', -30) }, k2 = respin(null, on.spin, k, T1 + 600_000);
    expect(near(pose(on, AT, T1 + 600_000, k2), pose(still, AT, T1 + 600_000, k), 1e-12)).toBe(true);
    const rel = mulQuat(conjQuat(pose(on, AT, T1 + 600_000, k2)), pose(on, AT, T1 + 603_000, k2));
    expect(between(rel, axisAngle([0, 1, 0], -90 * D))).toBeLessThan(1e-9);
  });
  it('never moves the model at the instant of a change, however many there are', () => {
    let a = ownAttitude(A('+Z', 2)), k: SpinAnchor = ANCHOR0, t = T1;
    const spins: (Spin | null)[] = [S('+Z', 45), S('+Y', 45), null, S('+X', -7.5), { rate: [10, -20, 30] }, { rate: [10, -20, 31] },
      S('+X', 90), S('+Z', 0.1), S('-Z', 3), null, { rate: [0.5, 0.5, 0] }, null, S('+Y', 1)];
    for (const s of spins) {
      t += 12_345.5;
      const next: Attitude = { ...a, spin: s }, k2 = respin(a.spin, next.spin, k, t);
      expect(between(pose(next, AT, t, k2), pose(a, AT, t, k))).toBeLessThan(1e-9);
      a = next; k = k2;
    }
  });
  it('leaves the anchor alone when nothing about the spin changes', () => {
    const k: SpinAnchor = { t0: T1, phase0: 12, base: axisAngle([0, 1, 0], 0.3) };
    expect(respin(S('+Z', 2), S('+Z', 2), k, T1 + 5)).toBe(k);
    expect(respin(null, null, k, T1 + 5)).toBe(k);
    expect(respin(S('-Z', 2), S('+Z', -2), k, T1 + 5)).toBe(k);
    expect(respin(S('+Z', 0), null, k, T1 + 5)).toBe(k);
  });
});

describe('a model pointed anew', () => {
  /* a model that has been turning about its side, with turns left over from spins about other axes before it */
  const spun: Attitude = { pointing: 'track', face: '+Z', ypr: [0, 0, 0], spin: S('+X', 9) };
  const k: SpinAnchor = { t0: T1 - 50_000, phase0: 17, base: axisAngle(unit([1, 2, 3]), 0.7) };
  it('lets the turns made so far go, so the face is exactly where it was sent, and spins on from there', () => {
    const cases: [Attitude, V3][] = [
      [{ ...spun, pointing: 'sun', face: '+Y', spin: null }, AT.sun!],
      [{ ...spun, face: '-X' }, [0, 0, 1]],
      [{ ...spun, pointing: 'sun', face: '-Z' }, AT.sun!],
      [{ ...spun, pointing: 'sun', face: '+X', ypr: [0, 0, 0], spin: S('+Z', -3) }, AT.sun!]
    ];
    for (const [to, target] of cases) {
      const k2 = reanchor(spun, to, k, T1);
      expect(k2).toEqual({ t0: T1, phase0: 0, base: IDENTITY });
      expect(near(rotate(pose(to, AT, T1, k2), axisVector(to.face)), target, 1e-12), to.pointing + ' ' + to.face).toBe(true);
    }
    /* the face toward the Sun, turning about the axis through it: it stays on the Sun as the model turns, at the rate set */
    const to: Attitude = { ...spun, pointing: 'sun', face: '+X' }, k2 = reanchor(spun, to, k, T1);
    for (const dt of [1_000, 10_000, 33_333]) expect(near(rotate(pose(to, AT, T1 + dt, k2), [1, 0, 0]), AT.sun!, 1e-12)).toBe(true);
    const rel = mulQuat(conjQuat(pose(to, AT, T1, k2)), pose(to, AT, T1 + 10_000, k2));
    expect(between(rel, axisAngle([1, 0, 0], 90 * D))).toBeLessThan(1e-9);
  });
  it('leaves the model where it was for anything else: a rate, an axis, no spin, the offsets, and the stars', () => {
    for (const to of [{ ...spun, spin: S('+X', -3) }, { ...spun, spin: S('+Y', 9) }, { ...spun, spin: null },
      { ...spun, ypr: [10, -4, 0] }] as Attitude[]) {
      expect(reanchor(spun, to, k, T1)).toEqual(respin(spun.spin, to.spin, k, T1));
    }
    expect(reanchor(spun, { ...spun, ypr: [10, -4, 0] }, k, T1)).toBe(k);
    /* to the stars: held where the frame and the pointing had it, the pose at the instant chosen is the pose before, to the last bit or two */
    const stars: Attitude = { ...spun, pointing: 'stars' };
    expect(reanchor(spun, stars, k, T1)).toBe(k);
    const at: PoseAt = { ...AT, frame: frameQuat(lvlh([1.06, 0.2, -0.3], [-0.1, 7.6, 0.4])) };
    const held = mulQuat(at.frame, pointingOf(spun, at));
    expect(between(pose(stars, { ...at, held }, T1, k), pose(spun, at, T1, k))).toBeLessThan(1e-12);
    /* a face changed while it is held among the stars points nothing anew (the face is not used there) */
    expect(reanchor(stars, { ...stars, face: '-Y' }, k, T1)).toBe(k);
    /* from the stars back to the track is pointed anew */
    expect(reanchor(stars, spun, k, T1)).toEqual({ t0: T1, phase0: 0, base: IDENTITY });
  });
});

describe('the pointings', () => {
  const att = (pointing: Attitude['pointing'], face: Axis): Attitude => ({ pointing, face, ypr: [0, 0, 0], spin: null });
  it('along the track: the front leading is no turn at all, and any face leads by the least turn, the top kept up where it can be', () => {
    expect(near(pointingOf(att('track', '+Z'), AT), IDENTITY, 0)).toBe(true);                // exactly (a zero may carry a sign)
    for (const f of AXES) {
      const q = pointingOf(att('track', f), AT);
      expect(near(rotate(q, axisVector(f)), [0, 0, 1], 1e-15), f).toBe(true);
      expect(Math.hypot(...q)).toBeCloseTo(1, 15);
      if (f[1] === 'Y') expect(near(rotate(q, [1, 0, 0]), [1, 0, 0], 1e-15), f + ' keeps the left side on the orbit normal').toBe(true);
      else expect(near(rotate(q, [0, 1, 0]), [0, 1, 0], 1e-15), f + ' keeps the top away from the Earth').toBe(true);
    }
    expect(near(rotate(pointingOf(att('track', '+X'), AT), [0, 0, 1]), [-1, 0, 0], 1e-15)).toBe(true);   // the left leading: the front to the right
    expect(near(rotate(pointingOf(att('track', '+Y'), AT), [0, 0, 1]), [0, -1, 0], 1e-15)).toBe(true);   // the top leading: the front to the Earth
  });
  const SECOND: Record<Axis, V3> = { '+Z': [1, 0, 0], '-Z': [1, 0, 0], '+Y': [1, 0, 0], '-Y': [1, 0, 0], '+X': [0, -1, 0], '-X': [0, 1, 0] };
  const suns: V3[] = [unit([0.3, 0.8, 0.52]), [0, 1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], unit([-0.5, -0.5, 0.7]), unit([0.9, 0.1, -0.2])];
  it('toward the Sun: the face on the Sun, and the axis kept second as near the orbit normal as it can go', () => {
    for (const sun of suns) for (const f of AXES) {
      const q = pointingOf(att('sun', f), { ...AT, sun });
      expect(near(rotate(q, axisVector(f)), sun, 1e-12), f + ' ' + sun).toBe(true);
      const n = unit([1 - sun[0] * sun[0], -sun[0] * sun[1], -sun[0] * sun[2]]);
      expect(near(rotate(q, SECOND[f]), n, 1e-12), f + ' ' + sun).toBe(true);
      expect(Math.hypot(...q)).toBeCloseTo(1, 14);
    }
  });
  it('toward the Sun overhead: the least turn from how the model flies (the top to it is none; a side to it is a roll)', () => {
    const over = { ...AT, sun: [0, 1, 0] as V3 };
    expect(near(pointingOf(att('sun', '+Y'), over), IDENTITY, 1e-15)).toBe(true);
    for (const f of ['+X', '-X'] as const) expect(near(rotate(pointingOf(att('sun', f), over), [0, 0, 1]), [0, 0, 1], 1e-15), f).toBe(true);
    for (const f of ['+Z', '-Z', '-Y'] as const) expect(near(rotate(pointingOf(att('sun', f), over), [1, 0, 0]), [1, 0, 0], 1e-15), f).toBe(true);
  });
  it('toward a Sun on the orbit normal (beta 90 degrees), still the face on the Sun, the track standing in for the normal', () => {
    for (const sun of [[1, 0, 0], [-1, 0, 0]] as V3[]) for (const f of AXES) {
      const q = pointingOf(att('sun', f), { ...AT, sun });
      expect(q.every(Number.isFinite)).toBe(true);
      expect(near(rotate(q, axisVector(f)), sun, 1e-12), f).toBe(true);
    }
    expect(bitSame(pointingOf(att('sun', '-Z'), { ...AT, sun: null }), pointingOf(att('track', '-Z'), AT))).toBe(true);   // no Sun: the track
  });
  it('toward the Sun turns smoothly round an orbit, at any beta angle', () => {
    for (const beta of [0, 10, 45, 80, 89.9]) for (const f of AXES) {
      let prev: Quat | null = null, worst = 0;
      for (let u = 0; u <= 360; u += 0.5) {
        const sun: V3 = [Math.sin(beta * D), Math.cos(beta * D) * Math.cos(u * D), -Math.cos(beta * D) * Math.sin(u * D)];
        const q = pointingOf(att('sun', f), { ...AT, sun });
        if (prev) worst = Math.max(worst, between(prev, q));
        prev = q;
      }
      /* the Sun moves half a degree a step; the model turns with it, never by a flip (at beta 89.9 the turn about the Sun's line is
         fast, as it must be, and still a fraction of a turn a step) */
      expect(worst, beta + ' ' + f).toBeLessThan(beta > 89 ? 90 * D : 2 * D);
    }
  });
  it('fixed among the stars: chosen, nothing moves; then the model keeps its turn among the stars while the frame turns under it', () => {
    const f1 = lvlh([1.06, 0.2, -0.3], [-0.1, 7.6, 0.4]), f2 = lvlh([-0.2, 1.05, 0.31], [-7.5, -0.3, 0.6]);   // about a quarter of an orbit on
    const F1 = frameQuat(f1), F2 = frameQuat(f2);
    const before = pointingOf(att('sun', '+Y'), { sun: AT.sun, frame: F1, held: null });
    const held = mulQuat(F1, before), stars = att('stars', '+Y');
    expect(near(pointingOf(stars, { sun: AT.sun, frame: F1, held }), before, 1e-12)).toBe(true);
    expect(near(mulQuat(F2, pointingOf(stars, { sun: AT.sun, frame: F2, held })), held, 1e-12)).toBe(true);
    expect(bitSame(pointingOf(stars, { ...AT, held: null }), IDENTITY)).toBe(true);
  });
  it('takes the craft\'s frame as the close-up does (makeBasis, then setFromRotationMatrix), to the bit', () => {
    for (const [r, v] of [[[1.06, 0.2, -0.3], [-0.1, 7.6, 0.4]], [[0.1, -1.1, 0.05], [7.5, 0.3, -1.2]], [[0, 0, 1.2], null]] as [V3, V3 | null][]) {
      const f = lvlh(r, v);
      const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(...f.left), new Vector3(...f.up), new Vector3(...f.forward)));
      expect(bitSame(frameQuat(f), three(q))).toBe(true);
    }
  });
});

describe('the three offsets', () => {
  it('turn the way the panel says: yaw + the front to the right, pitch + the front up, roll + the right side down', () => {
    expect(near(rotate(offsetsOf([90, 0, 0]), [0, 0, 1]), [-1, 0, 0], 1e-15)).toBe(true);
    expect(near(rotate(offsetsOf([0, 90, 0]), [0, 0, 1]), [0, 1, 0], 1e-15)).toBe(true);
    expect(near(rotate(offsetsOf([0, 0, 90]), [0, 1, 0]), [-1, 0, 0], 1e-15)).toBe(true);
    expect(near(rotate(offsetsOf([0, 0, 90]), [-1, 0, 0]), [0, -1, 0], 1e-15)).toBe(true);
    expect(SIGNS).toMatch(/yaw \+ turns the front to the right, pitch \+ raises it, roll \+ lowers the right side/);
  });
  it('turn yaw first, then pitch about the side as yawed, then roll about the front as pitched (three\'s Euler order YXZ, to the bit)', () => {
    expect(near(rotate(offsetsOf([90, 90, 0]), [0, 0, 1]), [0, 1, 0], 1e-15)).toBe(true);
    expect(near(rotate(offsetsOf([90, 90, 0]), [0, 1, 0]), [1, 0, 0], 1e-15)).toBe(true);
    for (const ypr of [[30, -20, 10], [-170, 45, 179], [0, 0, 5], [180, -180, 0.5]] as V3[]) {
      const e = new Euler(-ypr[1] * D, -ypr[0] * D, ypr[2] * D, 'YXZ');
      expect(bitSame(offsetsOf(ypr), three(new Quaternion().setFromEuler(e)))).toBe(true);
    }
    expect(bitSame(offsetsOf([0, 0, 0]), IDENTITY)).toBe(true);
  });
  it('are turned from the pointing, and the spin about the model\'s own axis after them: pose = pointing · offsets · base · spin', () => {
    const a: Attitude = { pointing: 'sun', face: '-X', ypr: [30, -20, 10], spin: S('+X', 7) };
    const k: SpinAnchor = { t0: T1, phase0: 33, base: axisAngle(unit([1, 2, 3]), 0.7) };
    const s = axisAngle([1, 0, 0], spinPhase(7, T1 + 4321, k) * Math.PI / 180);
    const want = mulQuat(pointingOf(a, AT), mulQuat(offsetsOf(a.ypr), mulQuat(k.base, s)));
    expect(bitSame(pose(a, AT, T1 + 4321, k), want)).toBe(true);
    /* a spin about the face that leads leaves the face where it is */
    const lead: Attitude = { pointing: 'track', face: '+X', ypr: [0, 0, 0], spin: S('+X', 40) };
    for (const ms of [T1, T1 + 1234, T1 + 5678]) expect(near(rotate(pose(lead, AT, ms), [1, 0, 0]), [0, 0, 1], 1e-12)).toBe(true);
  });
});

describe('the quaternion arithmetic is three\'s', () => {
  const rnd = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
  const rq = (): Quat => { const q = new Quaternion(rnd(), rnd(), rnd(), rnd()).normalize(); return three(q); };
  it('axis-angle, product, matrix, Euler and turning a vector, to the bit', () => {
    for (let i = 0; i < 200; i++) {
      const v = unit([rnd(), rnd(), rnd()]), ang = rnd() * 20;
      expect(bitSame(axisAngle(v, ang), three(new Quaternion().setFromAxisAngle(new Vector3(...v), ang)))).toBe(true);
      const a = rq(), b = rq();
      expect(bitSame(mulQuat(a, b), three(new Quaternion().multiplyQuaternions(new Quaternion(...a), new Quaternion(...b))))).toBe(true);
      const m = new Matrix4().makeRotationFromQuaternion(new Quaternion(...a)), e = m.elements;
      expect(bitSame(quatFromMatrix([e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!]), three(new Quaternion().setFromRotationMatrix(m)))).toBe(true);
      const x = rnd() * 7, y = rnd() * 7, z = rnd() * 7;
      expect(bitSame(quatFromEulerYXZ(x, y, z), three(new Quaternion().setFromEuler(new Euler(x, y, z, 'YXZ'))))).toBe(true);
      const w = [rnd(), rnd(), rnd()] as V3, t = new Vector3(...w).applyQuaternion(new Quaternion(...a));
      expect(bitSame(rotate(a, w), [t.x, t.y, t.z])).toBe(true);
      expect(bitSame(conjQuat(a), three(new Quaternion(...a).invert()))).toBe(true);
    }
  });
  it('reaches every branch of setFromRotationMatrix (half turns about each axis)', () => {
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]) {
      const m = new Matrix4().makeRotationAxis(new Vector3(...v), Math.PI), e = m.elements;
      expect(bitSame(quatFromMatrix([e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!]), three(new Quaternion().setFromRotationMatrix(m)))).toBe(true);
    }
  });
});

describe('an attitude compared, and a spin as three rates', () => {
  it('is the same attitude whichever way it was written, and rates of 0 are no spin', () => {
    expect(spinFrom(A('-Y', 3))).toEqual({ rate: [0, -3, 0] });
    expect(spinFrom(A('+Z', -2))).toEqual(spinFrom(A('-Z', 2)));
    for (const x of [spinFrom(A('+Z', -2))!.rate, spinFrom(A('-X', 7))!.rate]) for (const c of x) expect(Object.is(c, -0)).toBe(false);
    expect(spinFrom(A('+X', 0))).toBeNull();
    expect(ownAttitude(A('-Z', 2)).spin).toEqual({ rate: [0, 0, -2] });
    expect(sameAttitude(ownAttitude(A('+Z', 0)), ownAttitude())).toBe(true);
    expect(sameAttitude(ownAttitude(), { ...ownAttitude(), spin: { rate: [0, 0, 0] } })).toBe(true);
    expect(spinRate({ rate: [0, 0, 0] })).toBeNull();
    const own = ownAttitude(A('+Z', 2));
    expect(sameAttitude(own, { ...own, ypr: [0, 0, 1] })).toBe(false);
    expect(sameAttitude(own, { ...own, face: '-Z' })).toBe(false);
    expect(sameAttitude(own, { ...own, pointing: 'sun' })).toBe(false);
    expect(sameAttitude(own, { ...own, spin: S('+Z', 2.1) })).toBe(false);
    expect(sameAttitude(own, { ...own, spin: S('+Y', 2) })).toBe(false);
    expect(sameAttitude(own, { ...own, spin: { rate: [0.1, 0, 2] } })).toBe(false);
    /* about one axis alone the direction is that axis exactly, whatever the rate; about more, their direction */
    for (const d of [7, -7.25, 0.3, 89.9]) expect(spinAxisOf([0, d, 0])).toEqual([0, Math.sign(d), 0]);
    expect(near(spinAxisOf([3, 0, 4]), [0.6, 0, 0.8], 1e-15)).toBe(true);
    /* the same turn: R(-a, x) is R(a, -x) */
    for (const x of [0.3, -2.9, 5]) expect(near(axisAngle([0, 0, -1], x), axisAngle([0, 0, 1], -x), 0)).toBe(true);
  });
});

describe('the record of the reader\'s settings', () => {
  const SUN: Attitude = { pointing: 'sun', face: '+Y', ypr: [10, -5, 180], spin: S('+X', -12.5) };
  const MINE = ownId('25544', '2026-11-19T10:00:00.000Z');
  it('is the page\'s key, by model, and reads back what it wrote', () => {
    expect(ATTITUDE_KEY).toBe('gt.attitude');
    expect(MINE).toBe('own:25544@2026-11-19T10:00:00.000Z');
    expect(writeAttitudes({ iss: SUN })).toBe('{"v":1,"items":{"iss":{"pointing":"sun","face":"+Y","ypr":[10,-5,180],"spin":{"rate":[-12.5,0,0]}}}}');
    /* kept before the three rates: one axis and one rate */
    expect(readAttitude({ pointing: 'sun', face: '+Y', ypr: [10, -5, 180], spin: { axis: '-X', degPerSec: 12.5 } })).toEqual(SUN);
    expect(readAttitude({ pointing: 'track', spin: { rate: [1e9, 'x', -0.5] } })!.spin).toEqual({ rate: [90, 0, -0.5] });
    expect(readAttitude({ pointing: 'track', spin: { rate: [0, null, 0] } })!.spin).toBeNull();
    expect(readAttitudes(writeAttitudes({ iss: SUN, [MINE]: SUN, knacksat2: ownAttitude() }))).toEqual({ iss: SUN, [MINE]: SUN, knacksat2: ownAttitude() });
  });
  it('is nothing when it is not a record of this version', () => {
    for (const raw of [null, '', 'not json', '[]', '"x"', '7', '{"v":2,"items":{"iss":{"pointing":"sun"}}}', '{"v":1}', '{"v":1,"items":[]}', '{"v":1,"items":7}']) {
      expect(readAttitudes(raw), String(raw)).toEqual({});
    }
    for (const x of [null, undefined, [], 'track', 7, {}, { pointing: 'tumble' }, { pointing: ['track'] }]) expect(readAttitude(x)).toBeNull();
  });
  it('keeps only valid entries of known models, brought into range, from hostile text', () => {
    const raw = '{"v":1,"items":{'
      + '"iss":{"pointing":"track","face":"sideways","ypr":[null,"30",1e9],"spin":{"axis":"-Z","degPerSec":1e9}},'
      + '"knacksat2":{"pointing":"tumble","face":"+Y"},'
      + '"css":{"pointing":"stars","ypr":"no","spin":{"axis":"+W","degPerSec":5}},'
      + '"__proto__":{"pointing":"sun"},"constructor":{"pointing":"sun"},"own:O0001@x":{"pointing":"sun"},"own:25544@<b>":{"pointing":"sun"},'
      + '"gt.prefs":{"pointing":"sun"},"":{"pointing":"sun"},"tiangong9":{"pointing":"sun"},'
      + '"own:custom:c3@2026-11-19T10:00:00.000Z":{"pointing":"sun","face":"-X","ypr":[-540,540,181],"spin":{"axis":"+Y","degPerSec":-0.25}},'
      + '"own:67683@2026-11-19T10:00:00.000Z":{"pointing":"sun","spin":{"axis":"+Y","degPerSec":0}}'
      + '}}';
    const got = readAttitudes(raw);
    expect(Object.keys(got).sort()).toEqual(['css', 'iss', 'own:67683@2026-11-19T10:00:00.000Z', 'own:custom:c3@2026-11-19T10:00:00.000Z']);
    expect(got.iss).toEqual({ pointing: 'track', face: '+Z', ypr: [0, 0, -80], spin: { rate: [0, 0, -90] } });
    expect(got.css).toEqual({ pointing: 'stars', face: '+Z', ypr: [0, 0, 0], spin: null });
    expect(got['own:custom:c3@2026-11-19T10:00:00.000Z']).toEqual({ pointing: 'sun', face: '-X', ypr: [-180, 180, -179], spin: { rate: [0, -0.25, 0] } });
    expect(got['own:67683@2026-11-19T10:00:00.000Z']!.spin).toBeNull();
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
  });
  it('reads at most ATTITUDE_MAX entries', () => {
    const items: Record<string, Attitude> = {};
    for (let i = 0; i < ATTITUDE_MAX + 8; i++) items[ownId(String(10000 + i), '2026-11-19T10:00:00.000Z')] = SUN;
    expect(Object.keys(readAttitudes(writeAttitudes(items)))).toHaveLength(ATTITUDE_MAX);
  });
});

describe('the words', () => {
  it('say how the model flies on the card, and say first when it is the reader\'s setting', () => {
    expect(flightLine(ownAttitude(KNACK.spin ?? null), false)).toBe('Along the track, turning 2° a second.');
    expect(flightLine(ownAttitude(), false)).toBe('Along the track.');
    expect(flightLine({ pointing: 'track', face: '-Z', ypr: [0, 0, 0], spin: null }, true)).toBe('As you set it: along the track, its back leading.');
    expect(flightLine({ pointing: 'sun', face: '+Y', ypr: [30, 0, -12.5], spin: S('+X', -7.25) }, true))
      .toBe('As you set it: its top toward the Sun, yaw 30°, roll -12.5°, turning 7.3° a second.');
    expect(flightLine({ pointing: 'stars', face: '+Y', ypr: [0, 5, 0], spin: null }, true)).toBe('As you set it: fixed among the stars, pitch 5°.');
    expect(Object.values(POINTING_NAMES)).toEqual(['Along the track', 'Toward the Sun', 'Fixed among the stars']);
    for (const f of AXES) expect(FACES[f]).toContain('(' + f + ')');
  });
  it('say how long a turn takes and which way it goes', () => {
    expect(period([0, 0, 2])).toBe('One turn every 3 min, anticlockwise seen from in front.');
    expect(period([-90, 0, 0])).toBe('One turn every 4 s, clockwise seen from its left.');
    expect(period([0, 0.1, 0])).toBe('One turn every 60 min, anticlockwise seen from above.');
    expect(period([0, 0.04, 0])).toBe('One turn every 2.5 h, anticlockwise seen from above.');
    expect(period([3, -4, 0])).toBe('One turn every 72 s, about the direction X 60 %, Y -80 %, Z 0 %.');
    expect(period([0, 0, 0])).toBe('Not turning.');
    expect(period(null)).toBe('Not turning.');
    expect(rateText(2, 'Z')).toBe('2 degrees a second, anticlockwise seen from in front');
    expect(rateText(-0.5, 'Y')).toBe('0.5 degrees a second, clockwise seen from above');
    expect(rateText(0, 'X')).toBe('not turning');
  });
});
