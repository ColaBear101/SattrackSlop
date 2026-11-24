import { describe, expect, it } from 'vitest';
import { earthInView, exposure, sunInView, type ExposureView, type V3 } from '../../src/lib/models/exposure';

/* The realistic sky's exposure (CHANGES-FROM-LEGACY.md, L83): the stars all there with nothing bright in view, down to the brightest few
   with the Sun in it, and down as far as the sunlit Earth fills the view. */
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const HALF = Math.atan(Math.tan(21 * Math.PI / 180) * Math.hypot(1, 1.6));      // the globe's 42-degree lens on a 1.6:1 view
const view = (o: Partial<ExposureView>): ExposureView => ({ cam: [0, 0, 4.2], forward: [0, 0, -1], sun: [1, 0, 0], sunlight: 1, halfDiag: HALF, ...o });

describe('the realistic sky\'s exposure', () => {
  it("in sunlight, looking out at the sky away from the Earth and the Sun, is a half; in the Earth's shadow, 1", () => {
    expect(exposure(view({ forward: [0, 0, 1], sun: [0, 0, -1] }))).toBe(0.5);
    expect(exposure(view({ forward: [0, 0, 1], sun: [0, 0, -1], sunlight: 0 }))).toBe(1);
  });
  it('in the close-up, a sunlit model in the middle of the view takes them down to a sixth; in shadow it takes nothing', () => {
    expect(exposure(view({ forward: [0, 0, 1], sun: [0, 0, -1], subject: 1 }))).toBeCloseTo(1 / 6, 12);
    expect(exposure(view({ forward: [0, 0, 1], sun: [0, 0, -1], subject: 1, sunlight: 0 }))).toBe(1);
  });
  it('takes the stars down to the brightest few with the Sun in the view and the camera in sunlight', () => {
    const e = exposure(view({ forward: [0, 0, 1], sun: [0, 0, 1] }));
    expect(e).toBeLessThan(0.04);
    expect(sunInView(view({ forward: [0, 0, 1], sun: [0, 0, 1] }))).toBe(1);
  });
  it('leaves them all with the Sun in the view but the camera in the Earth\'s shadow', () => {
    expect(exposure(view({ cam: [0, 0, 1.1], forward: [0, 0, 1], sun: [0, 0, -1], sunlight: 0 }))).toBe(1);
  });
  it('fades the Sun\'s share over some 35 degrees beyond the view\'s corners', () => {
    const at = (deg: number) => sunInView(view({ forward: [0, 0, 1], sun: unit([Math.sin(deg * Math.PI / 180), 0, Math.cos(deg * Math.PI / 180)]) }));
    expect(at(HALF * 180 / Math.PI - 1)).toBe(1);
    expect(at(HALF * 180 / Math.PI + 17)).toBeGreaterThan(0.2);
    expect(at(HALF * 180 / Math.PI + 17)).toBeLessThan(0.8);
    expect(at(HALF * 180 / Math.PI + 36)).toBe(0);
  });
  it('takes them down as far as the sunlit Earth fills the view: close up over the day side about 1/15, over the night side none', () => {
    const day = view({ cam: [0, 0, 1.06], forward: [0, 0, -1], sun: [0, 0, 1] }), night = { ...day, sun: [0, 0, -1] as V3, sunlight: 0 };
    expect(earthInView(day)).toBe(1);
    expect(exposure(day)).toBeCloseTo(1 / 16, 9);
    expect(earthInView(night)).toBe(0);
    expect(exposure(night)).toBe(1);
  });
  it("from low orbit over the night side near the day's edge, the cap the camera sees is dark: all the stars", () => {
    /* 400 km up, the point below 110 degrees from the point under the Sun: the cap seen runs from about 90 to 130 degrees */
    const a = 110 * Math.PI / 180, near = view({ cam: [0, 0, 1.06], forward: [0, 0, -1], sun: [Math.sin(a), 0, Math.cos(a)], sunlight: 0 });
    expect(earthInView(near)).toBeLessThan(0.05);
    expect(exposure(near)).toBeGreaterThan(0.6);
    /* and over the day's edge itself, half of it lit */
    expect(earthInView({ ...near, sun: [1, 0, 0] })).toBeCloseTo(0.5, 9);
  });
  it('from the opening view, the lit Earth a seventh of the frame: a quarter of the starlight; turned away from it in shadow, all', () => {
    const lit = view({ sun: [0, 0, 1] });
    expect(exposure(lit)).toBeGreaterThan(0.2);
    expect(exposure(lit)).toBeLessThan(0.3);
    expect(exposure({ ...lit, forward: [0, 0, 1], sun: [0, 0, -1], sunlight: 0 })).toBe(1);
  });
});
