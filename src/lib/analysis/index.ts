import { makeEngine as makeRaw } from './engine';
import type { Engine, EngineEnv } from '../types';

/** The analysis engine for one body, observer and elevation mask. The numerical core behind it is moved
 *  unchanged from the old page; this is its typed doorway. */
export function makeEngine(env: EngineEnv): Engine {
  return makeRaw(env) as unknown as Engine;
}

/* ---- the orbital-elements section as data ---------------------------------------------------------------------- */
import { makeElementsReport } from './elements-report';
import { iso, spanLabel } from '../text/fmt';
import { abbr, type Row } from '../text/rich';
import type { Analysis } from '../types';

/** One of the six cards: [symbol, name, value, unit, note, where on the TLE it comes from]. */
export type ElementCard = [sym: string, label: string, val: string, unit: string, note: string, src: string];
/** The osculating rows: [name, value] and, for the phases that carry a name of their own, the name in words. */
export type OscRow = [name: string, value: string, words?: string];
export interface ElementsReport {
  cells: ElementCard[];
  oscRows: OscRow[];
  oscNote: string;
  derived: Row[];
  dnote: string;
  /** the rail's four figures that frame the visibility answer */
  mini: [string, string][];
}

/** The elements section for an analysis: the words and the figures of the old renderElements(), moved verbatim. */
export function makeElementsReporter(eng: Pick<Engine, 'SGP4_MU' | 'DEG' | 'RAD'>): (D: Analysis) => ElementsReport {
  const { elementsReport } = makeElementsReport({ SGP4_MU: eng.SGP4_MU, DEG: eng.DEG, RAD: eng.RAD, iso, spanLabel, abbr });
  return elementsReport as (D: Analysis) => ElementsReport;
}
