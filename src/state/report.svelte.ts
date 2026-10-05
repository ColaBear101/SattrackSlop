import { makeElementsReporter, type ElementsReport } from '../lib/analysis';
import { app } from './app.svelte';
import { getEngine } from './engine';

/* What the report says about the analysis on screen, computed once and read by every part of the page that shows it (the
   rail's Orbit tab and the report's Elements section both read `elements`). Derived, so it follows the analysis - and
   the observer, since a new observer is a new analysis. */
class Report {
  elements = $derived.by((): ElementsReport | null => {
    const D = app.analysis;
    return D ? makeElementsReporter(getEngine())(D) : null;
  });
}

export const report = new Report();
