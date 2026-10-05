import type { Analysis, Engine, Optics, PassOptical, Site } from '../types';
import { compass, iso } from '../text/fmt';
import { latStr, lonStr } from '../observer';
import { makeExports } from './passes';

/* The typed doorway to the export writers (passes.ts, moved verbatim from the old page). */

export interface PassRow {
  n: number; sat: string; norad: string; custom: boolean; site: string; lat: number; lon: number;
  aos: Date; los: Date; dur: number; maxEl: number; maxAt: Date; maxAz: number; aosAz: number; losAz: number; minRng: number;
  rrA: number | null; rrL: number | null; dopA: number | null; dopL: number | null; freqMHz: number | null;
  eye: string; mag: number | null; magPen: boolean; std: PassOptical['std'] | null; sunEl: number | null; lit: string;
  clipA: boolean; clipL: boolean;
}

/** A file to hand to the browser, and the hint that goes under the buttons once it has. */
export interface ExportFile { text: string; name: string; mime: string; hint: string }

export interface ExportCtx {
  D: Analysis;
  OBS: Site;
  MASK: number;
  /** the downlink the reader has tuned the Doppler to, in Hz, or null */
  dopHz: number | null;
  eng: Pick<Engine, 'rangeRateMs' | 'dopplerHz'>;
  optics: Pick<Optics, 'passOptical' | 'NAKED_EYE_MAG'>;
  /** where the element set came from, as the CSV states it (source.ts) */
  sourceText: string;
  /** the calendar's DTSTAMP clock; a test holds it still */
  stampAt?: Date;
}

export interface Exports {
  passRows(): PassRow[];
  exportCSV(): ExportFile;
  exportICS(): ExportFile;
  slug(t: string): string;
  exportStem(): string;
}

/** Build the writers for one analysis. Cheap: nothing is computed until a writer is called. */
export function buildExports(c: ExportCtx): Exports {
  return makeExports({
    D: c.D, OBS: c.OBS, MASK: c.MASK, dopHz: c.dopHz,
    rangeRateMs: c.eng.rangeRateMs, dopplerHz: c.eng.dopplerHz,
    passOptical: c.optics.passOptical, NAKED_EYE_MAG: c.optics.NAKED_EYE_MAG,
    sourceText: c.sourceText, stampAt: c.stampAt ?? new Date()
  }, { iso, compass, latStr, lonStr }) as unknown as Exports;
}
