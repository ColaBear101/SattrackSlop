import { describe, expect, it, vi } from 'vitest';
import { deliverFile } from '../../src/lib/share';
import { deliverSnap } from '../../src/lib/ar/snap';

/* Handing a file the page made to the reader: the share sheet or a download (CHANGES-FROM-LEGACY.md, L48 and L57). The AR view's Snap and the
   one-pass calendar file both go through it; tests/lib/snap.test.ts has its cases as Snap meets them, these are the calendar file's. */
const doc = () => ({
  createElement: () => ({ click: vi.fn(), remove: vi.fn(), href: '', download: '', rel: '', hidden: false }) as unknown as HTMLElement
});
const host = () => { const kids: unknown[] = []; return { kids, appendChild: (n: unknown) => kids.push(n) }; };
const ics = () => new Blob(['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'], { type: 'text/calendar' });
const NAME = 'sattrack-knacksat-2-pass-20260912T081234Z.ics';

describe('deliverFile', () => {
  it('is what the AR view calls deliverSnap, moved, not copied', () => {
    expect(deliverSnap).toBe(deliverFile);
  });

  it('hands the share sheet one file, under its name and type, with its bytes, and saves nothing', async () => {
    const share = vi.fn().mockResolvedValue(undefined), canShare = vi.fn().mockReturnValue(true), h = host();
    expect(await deliverFile({ share, canShare }, doc(), h, ics(), NAME)).toBe('shared');
    const d = share.mock.calls[0]![0] as { files: File[]; title: string };
    expect(d.files).toHaveLength(1);
    expect(d.files[0]!.name).toBe(NAME); expect(d.files[0]!.type).toBe('text/calendar');
    expect(await d.files[0]!.text()).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    expect(d.title).toBe(NAME);
    expect(canShare.mock.calls[0]![0]).toEqual({ files: d.files });
    expect(h.kids).toHaveLength(0);
  });

  it('downloads it when given no share sheet (the calendar file away from a phone), or one that will not take a calendar file', async () => {
    for (const nav of [undefined, { share: vi.fn(), canShare: () => false }]) {
      const h = host();
      expect(await deliverFile(nav, doc(), h, ics(), NAME)).toBe('saved');
      const a = h.kids[0] as { click: { mock: { calls: unknown[] } }; download: string; href: string; remove: { mock: { calls: unknown[] } } };
      expect(a.download).toBe(NAME); expect(a.href).toMatch(/^blob:/);
      expect(a.click.mock.calls).toHaveLength(1); expect(a.remove.mock.calls).toHaveLength(1);
      if (nav) expect(nav.share).not.toHaveBeenCalled();
    }
  });

  it('calls a closed sheet a cancel, and a sheet that throws on the question a download', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(await deliverFile({ share: vi.fn().mockRejectedValue(abort), canShare: () => true }, doc(), host(), ics(), NAME)).toBe('cancelled');
    const throws = { share: vi.fn(), canShare: () => { throw new TypeError('no'); } }, h = host();
    expect(await deliverFile(throws, doc(), h, ics(), NAME)).toBe('saved');
    expect(h.kids).toHaveLength(1);
  });
});
