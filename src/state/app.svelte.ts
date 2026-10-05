import catalogueUrl from '../../data/catalogue.txt?url';
import { parseCatalog, type CatalogueEntry } from '../lib/catalogue/parse';
import type { Analysis } from '../lib/types';
import { engine } from './engine';

/* The assignment snapshot, `?tle=embedded`: the embedded element sets, each window opening at its own
   set's epoch, which is how the README's figures were computed. The live page opens the window at the
   reader's clock instead. A URL rather than a switch, so the pinned view can itself be linked to. */
export const PINNED = /(?:^|[?&])tle=embedded(?:&|$)/.test(location.search);

/* The spacecraft tried first, in order, as the old page did: the default is a moving target too
   (KNACKSAT-2 will re-enter one day), so a failing default falls through to the next. */
const WANT = [/^KNACKSAT-2$/, /^KNACKSAT$/, /^LANDSAT 8/];

const HOURS = 24;

class AppState {
  /* Large immutable values are raw: a deep reactive proxy over 2,158 records or an 8,641-point track
     would cost far more than it gives. */
  catalogue = $state.raw<CatalogueEntry[]>([]);
  entry = $state.raw<CatalogueEntry | null>(null);
  analysis = $state.raw<Analysis | null>(null);
  error = $state<string | null>(null);
  loading = $state(true);

  /** Resolves with the catalogue once it is parsed (the test surface waits on this). */
  ready: Promise<CatalogueEntry[]>;

  constructor() {
    this.ready = fetch(catalogueUrl)
      .then(r => { if (!r.ok) throw new Error('catalogue: HTTP ' + r.status); return r.text(); })
      .then(text => {
        this.catalogue = parseCatalog(text);
        this.loading = false;
        this.selectDefault();
        return this.catalogue;
      })
      .catch(e => { this.loading = false; this.error = String(e && e.message || e); throw e; });
  }

  private selectDefault() {
    const order = WANT.map(re => this.catalogue.findIndex(c => re.test(c.name))).concat(this.catalogue.map((_, i) => i));
    for (const i of order) {
      if (i < 0) continue;
      if (this.select(this.catalogue[i]!)) return;
    }
  }

  /** Analyse one spacecraft. Transactional: a failure leaves the previous analysis on screen. */
  select(entry: CatalogueEntry): boolean {
    try {
      const E = engine.elements(entry.l1, entry.l2);
      const start = PINNED ? E.epoch.getTime() : Date.now();
      const analysis = engine.compute(entry, start, HOURS);
      this.entry = entry;
      this.analysis = analysis;
      this.error = null;
      return true;
    } catch (e) {
      this.error = entry.name + ': ' + (e instanceof Error ? e.message : String(e));
      return false;
    }
  }
}

export const app = new AppState();
