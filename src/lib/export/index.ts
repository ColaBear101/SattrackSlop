import type { Analysis, Engine, Optics, PassOptical, Site } from '../types';
import { compass, iso } from '../text/fmt';
import { latStr, lonStr } from '../observer';
import { makeExports } from './passes';
import { passSaved } from '../text/pass-ics-said';

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
  /** an instant as the calendar writes it: UTC, no punctuation, whole seconds (20260912T081234Z) */
  icsStamp(d: Date): string;
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

/** One pass alone, as a calendar of its own (CHANGES-FROM-LEGACY.md, L57): the calendar writer above, handed an analysis that holds that one
 *  pass and nothing else changed (a shallow copy: `c.D` itself is not touched), so the event is the very one the whole window's calendar has
 *  for it, its UID included, and a calendar that imports both files holds it once. The file is named for the spacecraft and the pass's AOS in
 *  UTC, so that two passes saved one after the other are two files. Null for an index the analysis has no pass at. */
export function exportPassICS(c: ExportCtx, i: number): ExportFile | null {
  const p = c.D.passes[i];
  if (!p) return null;
  const x = buildExports({ ...c, D: { ...c.D, passes: [p] } });
  const f = x.exportICS();
  const name = 'sattrack-' + (x.exportStem() || c.D.E.satnum) + '-pass-' + x.icsStamp(p.aos) + '.ics';
  return { ...f, name, hint: passSaved(i + 1, name) };
}
