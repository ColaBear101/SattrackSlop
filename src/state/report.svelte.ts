import type { ElementsReport } from '../lib/analysis/reporter';
import { app } from './app.svelte';
import { getEngine } from './engine';

/* What the report says about the analysis on screen, computed once and read by every part of the page that shows it (the rail's Orbit tab
 * and the report's Elements section both read `elements`). Derived, so it follows the analysis - and the observer, since a new observer is
 * a new analysis.
 *
 * The report is below the first screen, so it is a chunk of its own (its sections, its sentences, the glossary, and the words of the
 * element cards), fetched when the first answer is on screen: when the browser is idle, when the reader scrolls towards it, at once for a
 * link to a part of it (#sec-life), and before the test surface says the page is ready. Until it is here `elements` is null and the places
 * that read it show nothing, as they did while there was no analysis. */
class Report {
  /** something wants the report: the host (components/report/ReportHost.svelte) fetches and mounts it */
  wanted = $state(false);
  /** the words of the element cards, once their module has arrived */
  private make = $state.raw<typeof import('../lib/analysis/reporter')['makeElementsReporter'] | null>(null);
  private settle!: { resolve: () => void; reject: (e: unknown) => void };
  /** resolves when the sections are mounted in the page; rejects when their chunk cannot be fetched (offline, say) */
  readonly ready = new Promise<void>((resolve, reject) => { this.settle = { resolve, reject }; });

  elements = $derived.by((): ElementsReport | null => {
    const D = app.analysis, make = this.make;
    return D && make ? make(getEngine())(D) : null;
  });

  constructor() { this.ready.catch(() => { /* whoever awaits it sees the failure; this keeps an unwatched one from reaching the console twice */ }); }

  /** Ask for the report. Idempotent. */
  request(): void {
    if (this.wanted) return;
    this.wanted = true;
    void import('../lib/analysis/reporter').then(m => { this.make = m.makeElementsReporter; }, e => this.settle.reject(e));
  }
  /** The host: the sections are mounted (or could not be). */
  mounted(): void { this.settle.resolve(); }
  failed(e: unknown): void { this.settle.reject(e); }
}

export const report = new Report();
