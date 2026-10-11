import { describe, expect, it, vi } from 'vitest';
import { composeSnap, coverRect, deliverSnap, snapName } from '../../src/lib/ar/snap';
import { aimVector } from '../../src/lib/ar/radar';

describe('snapName', () => {
  it('says what, where and when, in sortable digits, and is a safe file name', () => {
    expect(snapName('sky', 'Bangkok', Date.UTC(2026, 8, 13, 8, 0, 35), 'jpg')).toBe('sattrack-sky-bangkok-20260913T080035Z.jpg');
    expect(snapName('radar', 'São Paulo / Brasil', Date.UTC(2026, 0, 2, 3, 4, 5), 'png')).toBe('sattrack-radar-sao-paulo-brasil-20260102T030405Z.png');
  });
  it('falls back to "site" when the name has nothing a file name can hold, and keeps it short', () => {
    expect(snapName('sky', '曼谷', 0, 'png')).toBe('sattrack-sky-site-19700101T000000Z.png');
    expect(snapName('sky', 'a'.repeat(80), 0, 'png').split('-')[2]!.length).toBeLessThanOrEqual(24);
  });
});

describe('snapName at the 24-character cut', () => {
  it('does not end the site part on a hyphen the cut left behind', () => {
    expect(snapName('sky', 'abcdefghijklmnopqrstuvw xyz', 0, 'png')).toBe('sattrack-sky-abcdefghijklmnopqrstuvw-19700101T000000Z.png');
  });
});

describe('coverRect', () => {
  it('lays a picture over a screen as object-fit: cover does: the larger ratio, centred', () => {
    expect(coverRect(1280, 960, 390, 844)).toEqual({ x: (390 - 1280 * 844 / 960) / 2, y: 0, w: 1280 * 844 / 960, h: 844 });
    const r = coverRect(960, 1280, 844, 390);          // a tall picture on a wide screen: fills the width, crops top and bottom
    expect(r.w).toBe(844); expect(r.x).toBe(0); expect(r.y).toBeLessThan(0); expect(r.h).toBeGreaterThan(390);
  });
});

/* A recording 2D context and a document that makes canvases of it: what composeSnap draws, in order. */
function fakeDoc() {
  const calls: string[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => { calls.push(k + (k === 'drawImage' ? ':' + String((a[0] as { tag?: string }).tag) : k === 'fillText' ? ':' + String(a[0]) : '')); }),
    set: (t, k: string, v) => { t[k] = v; return true; }
  });
  const made: { width: number; height: number; type?: string }[] = [];
  const doc = {
    createElement: (tag: string) => {
      if (tag === 'a') return { click: vi.fn(), remove: vi.fn(), href: '', download: '', rel: '', hidden: false };
      const cv = {
        width: 0, height: 0, getContext: () => g,
        toBlob: (cb: (b: Blob | null) => void, type: string) => { made.push({ width: cv.width, height: cv.height, type }); cb(new Blob(['x'], { type })); }
      };
      return cv;
    }
  };
  return { doc: doc as unknown as Parameters<typeof composeSnap>[0], calls, made };
}

describe('composeSnap', () => {
  const src = (o = {}) => ({ width: 780, height: 1688, scale: 2, video: null, overlay: null, radar: null, caption: ['one', 'two'], ...o });
  const tag = (t: string) => ({ tag: t } as unknown as CanvasImageSource);

  it('draws the camera first, then the sky, then the radar, then the caption, and encodes a JPEG when there was a camera', async () => {
    const { doc, calls, made } = fakeDoc();
    const b = await composeSnap(doc, src({ video: { el: tag('video'), vw: 1280, vh: 960 }, overlay: tag('sky'), radar: { cv: tag('radar'), x: 222, y: 354, w: 156, h: 156 } }));
    const draws = calls.filter(c => c.startsWith('drawImage') || c.startsWith('fillText'));
    expect(draws).toEqual(['drawImage:video', 'drawImage:sky', 'drawImage:radar', 'fillText:one', 'fillText:two']);
    expect(made[0]).toMatchObject({ width: 780, height: 1688, type: 'image/jpeg' });
    expect(b.type).toBe('image/jpeg');
  });

  it('is a PNG, and draws no camera, where there is none', async () => {
    const { doc, calls, made } = fakeDoc();
    await composeSnap(doc, src({ radar: { cv: tag('radar'), x: 12, y: 181, w: 366, h: 366 } }));
    expect(calls.some(c => c === 'drawImage:video')).toBe(false);
    expect(made[0]!.type).toBe('image/png');
  });

  it('puts the radar where it was on the screen, in device pixels', async () => {
    const seen: number[][] = [];
    const doc = {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage: (...a: number[]) => seen.push(a.slice(1)), fillRect() {}, fillText() {} }),
        toBlob: (cb: (b: Blob) => void) => cb(new Blob(['x']))
      })
    };
    await composeSnap(doc as unknown as Parameters<typeof composeSnap>[0], src({ caption: [], radar: { cv: tag('radar'), x: 222, y: 354, w: 156, h: 156 } }));
    expect(seen).toEqual([[444, 708, 312, 312]]);
  });

  /* a context that records where the strip is filled and what size each line is set in */
  function strip(measure: (t: string) => number) {
    const rects: number[][] = [], fonts: string[] = [];
    const g = { font: '', fillStyle: '', textAlign: '', textBaseline: '', fillRect: (...a: number[]) => rects.push(a), drawImage() {}, fillText() { fonts.push(g.font); }, measureText: (t: string) => ({ width: measure(t) }) };
    const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => g, toBlob: (cb: (b: Blob) => void) => cb(new Blob(['x'])) }) };
    return { doc: doc as unknown as Parameters<typeof composeSnap>[0], rects, fonts };
  }

  it('puts the strip along the foot, and along the top when the radar reaches down into the foot (held sideways)', async () => {
    const upright = strip(() => 10), sideways = strip(() => 10);
    await composeSnap(upright.doc, src({ radar: { cv: tag('radar'), x: 222, y: 354, w: 156, h: 156 } }));           // 390x844: the radar ends 334 px above the foot
    await composeSnap(sideways.doc, src({ width: 1688, height: 780, radar: { cv: tag('radar'), x: 676, y: 222, w: 156, h: 156 } }));   // 844x390: it ends 12 px above it
    const band = 2 * (3 * 0 + 2 * 17 + 20);                                                                      // two caption lines at 2x: 2 * 17 + 20 css px, doubled
    expect(upright.rects.at(-1)![1]).toBe(1688 - band); expect(sideways.rects.at(-1)![1]).toBe(0);
  });

  it('sets a line too wide for the picture in a smaller type, down to 72%, and a line that fits at the full size', async () => {
    const { doc, fonts } = strip(t => (t === 'one' ? 100 : 2000));                                                  // 'two' is far too wide for the 740 px room
    await composeSnap(doc, src());
    expect(fonts[0]).toMatch(/^500 26px /);                       // 13 px at 2x
    expect(fonts[1]).toMatch(/^500 18\.72px /);                   // clamped at 72% of 26
  });

  it('rejects, and does not hang, when the browser cannot encode or gives no canvas', async () => {
    const bad = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
    await expect(composeSnap(bad as unknown as Parameters<typeof composeSnap>[0], src())).rejects.toThrow(/no canvas/);
    const noBlob = {
      createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }), toBlob: (cb: (b: null) => void) => cb(null) })
    };
    await expect(composeSnap(noBlob as unknown as Parameters<typeof composeSnap>[0], src())).rejects.toThrow(/encoded/);
  });
});

describe('deliverSnap', () => {
  const blob = () => new Blob(['x'], { type: 'image/png' });
  const host = () => { const kids: unknown[] = []; return { kids, appendChild: (n: unknown) => kids.push(n) }; };

  it('shares where the browser takes files, and saves nothing', async () => {
    const share = vi.fn().mockResolvedValue(undefined), canShare = vi.fn().mockReturnValue(true), { doc } = fakeDoc(), h = host();
    expect(await deliverSnap({ share, canShare }, doc, h, blob(), 'p.png')).toBe('shared');
    expect(share).toHaveBeenCalledOnce(); expect(h.kids).toHaveLength(0);
  });

  it('calls a closed share sheet a cancel, not an error, and does not save behind the reader', async () => {
    const e = Object.assign(new Error('x'), { name: 'AbortError' });
    const { doc } = fakeDoc(), h = host();
    expect(await deliverSnap({ share: vi.fn().mockRejectedValue(e), canShare: () => true }, doc, h, blob(), 'p.png')).toBe('cancelled');
    expect(h.kids).toHaveLength(0);
  });

  it('saves it when sharing is refused or cannot take a file, by a link inside the view that it clicks and removes', async () => {
    const refused = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    for (const nav of [undefined, {}, { share: vi.fn(), canShare: () => false }, { share: vi.fn().mockRejectedValue(refused), canShare: () => true }]) {
      const { doc } = fakeDoc(), h = host();
      expect(await deliverSnap(nav as Parameters<typeof deliverSnap>[0], doc, h, blob(), 'p.png')).toBe('saved');
      const a = h.kids[0] as { click: { mock: { calls: unknown[] } }; download: string; href: string };
      expect(a.download).toBe('p.png'); expect(a.href).toMatch(/^blob:/); expect(a.click.mock.calls).toHaveLength(1);
    }
  });
});

describe('aimVector', () => {
  const cam = { fwd: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1] };       // upright, facing north
  it("is the camera's axis for the camera", () => { expect(aimVector(cam, 0, 'camera')).toBe(cam.fwd); });
  it("is the picture's up for the head with the screen upright: held upright, the head points at the zenith", () => {
    const h = aimVector(cam, 0, 'head');
    expect(h[0]).toBeCloseTo(0, 12); expect(h[1]).toBeCloseTo(0, 12); expect(h[2]).toBeCloseTo(1, 12);
  });
  it("turns the screen back: with the screen on its side the head is the picture's side edge", () => {
    const h = aimVector(cam, 90, 'head');          // theta 90: the picture's right is the device's -y, so the head is -right
    expect(h[0]).toBeCloseTo(-1, 12); expect(h[1]).toBeCloseTo(0, 12); expect(h[2]).toBeCloseTo(0, 12);
    expect(aimVector(cam, 270, 'head')[0]).toBeCloseTo(1, 12);
  });
  it('is a unit vector for any screen turn', () => {
    for (const t of [0, 33, 90, 180, 270, 311]) expect(Math.hypot(...aimVector(cam, t, 'head'))).toBeCloseTo(1, 12);
  });
});
