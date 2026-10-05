import catalogueUrl from '../../data/catalogue.txt?url';
import worldUrl from '../../data/world.json?url';
import { parseCatalog, type CatalogueEntry } from '../lib/catalogue/parse';
import { loadSite, loadRecents, normalizeSite, remember, saveSite, type SavedSite } from '../lib/observer';
import type { Analysis, Sample, Site } from '../lib/types';
import { clock } from './clock.svelte';
import { getEngine, getObs, HOME, setObserver } from './engine';
import { prefs } from './prefs.svelte';
import { readUrl, writeUrl, SPANS } from './url';

/* The assignment snapshot, `?tle=embedded`: the embedded element sets, each window opening at its own set's
   epoch, which is how the README's figures were computed. The live page opens the window at the reader's
   clock instead. A URL rather than a switch, so the pinned view can itself be linked to. */
export const PINNED = /(?:^|[?&])tle=embedded(?:&|$)/.test(location.search);

/* The spacecraft tried first, in order, as the old page did: the default is a moving target too (KNACKSAT-2
   will re-enter one day), so a failing default falls through to the next. */
const WANT = [/^KNACKSAT-2$/, /^KNACKSAT$/, /^LANDSAT 8/];

export interface WorldData { type: 'FeatureCollection'; features: { geometry: { type: string; coordinates: unknown } }[] }

class AppState {
  /* Large immutable values are raw: a deep reactive proxy over 2,158 records or an 8,641-point track would
     cost far more than it gives. */
  catalogue = $state.raw<CatalogueEntry[]>([]);
  world = $state.raw<WorldData | null>(null);
  entry = $state.raw<CatalogueEntry | null>(null);
  analysis = $state.raw<Analysis | null>(null);
  site = $state.raw<Site>(getObs());
  recents = $state.raw<SavedSite[]>([]);
  /** Window start in ms; null means "now" (or the set's epoch under ?tle=embedded). */
  startMs = $state<number | null>(null);
  hours = $state(24);
  selPass = $state(0);
  error = $state<string | null>(null);
  loading = $state(true);

  /** Resolves with the catalogue once it is parsed (the test surface waits on this). */
  ready: Promise<CatalogueEntry[]>;

  constructor() {
    const url = readUrl();
    if (url.span) this.hours = url.span;
    if (url.tab) prefs.setTab(url.tab);
    const saved = loadSite(localStorage);
    const wanted = url.site ? normalizeSite({ ...url.site, name: 'Linked site' }) : saved;
    if (wanted) this.site = setObserver(wanted);
    this.recents = loadRecents(localStorage);

    fetch(worldUrl).then(r => r.json()).then(w => { this.world = w; }).catch(() => { /* the map falls back to a blank ocean */ });

    this.ready = fetch(catalogueUrl)
      .then(r => { if (!r.ok) throw new Error('catalogue: HTTP ' + r.status); return r.text(); })
      .then(text => {
        this.catalogue = parseCatalog(text);
        this.loading = false;
        this.selectDefault(url.sat);
        clock.start();
        return this.catalogue;
      })
      .catch(e => { this.loading = false; this.error = String(e && e.message || e); throw e; });
  }

  private selectDefault(satnum?: string): void {
    const linked = satnum ? this.catalogue.findIndex(c => c.satnum === satnum) : -1;
    const order = [linked].concat(WANT.map(re => this.catalogue.findIndex(c => re.test(c.name))), this.catalogue.map((_, i) => i));
    for (const i of order) {
      if (i < 0) continue;
      if (this.select(this.catalogue[i]!)) return;
    }
  }

  /** The instant the analysis window opens: the reader's choice, else the set's epoch (pinned) or now. */
  private windowStart(entry: CatalogueEntry): number {
    if (this.startMs !== null) return this.startMs;
    return PINNED ? getEngine().elements(entry.l1, entry.l2).epoch.getTime() : Date.now();
  }

  /** Analyse one spacecraft. Transactional: a failure leaves the previous analysis on screen. */
  select(entry: CatalogueEntry, keepClock = false): boolean {
    try {
      const start = this.windowStart(entry);
      const analysis = getEngine().compute(entry, start, this.hours);
      this.entry = entry;
      this.analysis = analysis;
      this.selPass = 0;
      this.error = null;
      if (!keepClock) clock.seek(start);
      this.syncUrl();
      return true;
    } catch (e) {
      this.error = entry.name + ': ' + (e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** Re-run the current spacecraft (a new window, span or site). */
  reanalyze(keepClock = true): boolean {
    return this.entry ? this.select(this.entry, keepClock) : false;
  }

  setSpan(hours: number): void { this.hours = hours; this.reanalyze(true); }

  /** Open the window at an instant (Now, Epoch, a typed time, a step of a day). The clock goes with it. */
  setWindowStart(ms: number | null): void {
    this.startMs = ms;
    if (this.entry) {
      const s = ms ?? this.windowStart(this.entry);
      this.select(this.entry, true);
      clock.seek(s);
    }
  }

  /** The clock ran past the window: carry the instant across by opening a new window at it. */
  rollWindow(ms: number): void {
    this.startMs = ms;
    this.reanalyze(true);
  }

  applySite(raw: Partial<SavedSite>, where = ''): boolean {
    const site = normalizeSite(raw);
    if (!site) return false;
    this.site = setObserver(site);
    saveSite(localStorage, this.site, where);
    this.recents = remember(localStorage, this.site, where);
    this.reanalyze(true);
    return true;
  }

  resetSite(): void {
    this.site = setObserver({ ...HOME });
    try { localStorage.removeItem('obs-site'); } catch { /* nothing to remove */ }
    this.reanalyze(true);
  }

  /** Live look at the spacecraft from the observer, at any instant: the SGP4 behind the readouts. */
  sampleAt(ms: number): Sample | null {
    const a = this.analysis;
    return a ? getEngine().sampleMs(a.track, ms) : null;
  }

  private syncUrl(): void {
    const atHome = Math.abs(this.site.lat - HOME.lat) < 1e-9 && Math.abs(this.site.lon - HOME.lon) < 1e-9;
    writeUrl({
      sat: this.entry?.satnum, span: this.hours,
      site: { lat: this.site.lat, lon: this.site.lon }, tab: prefs.tab === 'map' ? undefined : prefs.tab
    }, { span: 24, atHome });
  }
}

export { SPANS };
export const app = new AppState();
