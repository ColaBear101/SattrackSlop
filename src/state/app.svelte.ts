import catalogueUrl from '../../data/catalogue.txt?url';
import worldUrl from '../../data/world.json?url';
import { parseCatalog, type CatalogueEntry } from '../lib/catalogue/parse';
import { isCustom } from '../lib/planner/custom';
import { loadSavedSite, loadRecents, normalizeSite, remember, saveSite, SITE_KEY, type SavedSite } from '../lib/observer';
import { DEVICE_SITE, offsetAt, zoneKnown } from '../lib/places';
import { iso, spanLabel } from '../lib/text/fmt';
import type { Analysis, Pass, Sample, Site } from '../lib/types';
import { clock } from './clock.svelte';
import { doppler } from './doppler.svelte';
import { getEngine, getObs, HOME, setCatalogueSource, setObserver } from './engine';
import { life } from './life.svelte';
import { live } from './live.svelte';
import { prefs } from './prefs.svelte';
import { readUrl, writeUrl, SPANS } from './url';
import { wall } from './wall.svelte';

/* The assignment snapshot, `?tle=embedded`: the embedded element sets, each window opening at its own set's
   epoch, which is how the README's figures were computed. The live page opens the window at the reader's
   clock instead. A URL rather than a switch, so the pinned view can itself be linked to. */
export const PINNED = /(?:^|[?&])tle=embedded(?:&|$)/.test(location.search);

/* The spacecraft tried first, in order, as the old page did: the default is a moving target too (KNACKSAT-2
   will re-enter one day), so a failing default falls through to the next. */
const WANT = [/^KNACKSAT[- ]?2\b/i, /^KNACKSAT\b/i, /^LANDSAT 8\b/i];

/** How far past the window the countdown looks for the next pass, in hours. */
export const NEXT_H = 48;

/** What a site is made from: a saved record, a place from the search, or what was typed. A place with no zone says null. */
export type SiteInput = Partial<Omit<SavedSite, 'zone'>> & { zone?: string | null };

export interface WorldData { type: 'FeatureCollection'; features: { geometry: { type: string; coordinates: unknown } }[] }

interface LoadOptions {
  /** the caller has its own account of a failure (a newer element set on trial) and wants only the answer */
  trial?: boolean;
  /** open the window here (ms); undefined keeps the one on screen, null means "now" (or the epoch, pinned) */
  start?: number | null;
  hours?: number;
  /** leave the clock where it is instead of moving it to the window's start */
  keepClock?: boolean;
}

class AppState {
  /* Large immutable values are raw: a deep reactive proxy over 2,158 records or an 8,641-point track would
     cost far more than it gives. */
  catalogue = $state.raw<CatalogueEntry[]>([]);
  world = $state.raw<WorldData | null>(null);
  /** The spacecraft on screen, as analysed: the embedded record with a live set's lines if one was taken. */
  entry = $state.raw<CatalogueEntry | null>(null);
  analysis = $state.raw<Analysis | null>(null);
  site = $state.raw<Site>(getObs());
  recents = $state.raw<SavedSite[]>([]);
  /** Window start in ms; null until the first analysis has fixed it. */
  startMs = $state<number | null>(null);
  hours = $state(24);
  selPass = $state(0);
  /** What the last load that did not go through said (cleared by the next one that does): the old #loadnote. */
  note = $state('');
  /** A fatal problem: the catalogue could not be read at all. */
  error = $state<string | null>(null);
  loading = $state(true);
  /** Counts the analyses committed. An orbit the reader designed is edited IN PLACE (the entry object keeps its identity, so everything
   *  that holds it - the window, the clock, a typed Doppler frequency - survives), and a reactive read of a field of an object that
   *  did not change identity does not notice; a view that prints one reads this too. */
  rev = $state(0);

  /** The entry on screen, read so that an in-place edit of it (an orbit the reader designed) is noticed. */
  get current(): CatalogueEntry | null { void this.rev; return this.entry; }

  /** Resolves with the catalogue once it is parsed (the test surface waits on this). */
  ready: Promise<CatalogueEntry[]>;
  /** Why the last load failed, when it did: SGP4's error number is `sgp4`. Not reactive: read right after load(). */
  lastFailure: (Error & { sgp4?: number }) | null = null;

  /** What runs last in every load that went through, on the analysis it made: the planner's own panel follows the spacecraft with it. A
   *  throw from it is reported and never fails the load. */
  afterLoad: ((D: Analysis) => void) | null = null;
  /** Where a window should open for a deep-space orbit of the reader's own that is far from it (the planner's rule), or null. Set when the
   *  planner's maths is here. */
  deepStart: ((entry: CatalogueEntry, winStart: number | null) => number | null) | null = null;
  /** The catalogue index of the last catalogue entry that loaded: where removing an orbit of the reader's goes back to. */
  lastCat = -1;

  private byKey = new Map<string, CatalogueEntry>();
  private byIndex = new Map<string, number>();
  private afterWindow = new WeakMap<Analysis, Pass | null>();

  constructor() {
    const url = readUrl();
    if (url.span) this.hours = url.span;
    if (url.tab) prefs.setTab(url.tab);
    const wanted = this.siteFrom(url.site ? { ...url.site, name: 'Linked site' } : loadSavedSite(localStorage) ?? {});
    if (wanted) this.site = setObserver(wanted);
    this.recents = loadRecents(localStorage);

    live.attach({
      onScreen: () => this.entry,
      adopt: entry => this.load(entry, { trial: true, keepClock: true })
        ? { ok: true } : { ok: false, code: this.lastFailure?.sgp4 ?? null },
      sgp4Why: code => getEngine().sgp4Why(code),
      pinned: PINNED
    });

    fetch(worldUrl).then(r => r.json()).then(w => { this.world = w; }).catch(() => { /* the map falls back to a blank ocean */ });

    this.ready = fetch(catalogueUrl)
      .then(r => { if (!r.ok) throw new Error('catalogue: HTTP ' + r.status); return r.text(); })
      .then(text => {
        this.catalogue = parseCatalog(text);
        this.catalogue.forEach((c, i) => { this.byKey.set(c.satnum, c); this.byIndex.set(c.satnum, i); });
        setCatalogueSource({ embedded: this.catalogue, current: n => { const e = this.byKey.get(n); return e ? live.effective(e) : undefined; } });
        this.loading = false;
        this.boot(url.sat);
        clock.start();
        this.startTimers();
        return this.catalogue;
      })
      .catch(e => { this.loading = false; this.error = String(e && e.message || e); throw e; });
  }

  /** The first analysis. The default is a moving target too: KNACKSAT-2 will re-enter one day, and a page that
   *  failed on its own default would open blank. Try the rest of the preference list, then the catalogue in order,
   *  and say what was skipped. */
  private boot(satnum?: string): void {
    const linked = satnum ? this.catalogue.findIndex(c => c.satnum === satnum) : -1;
    const wants = WANT.map(re => this.catalogue.findIndex(c => re.test(c.name)));
    const first = linked >= 0 ? linked : wants.find(i => i >= 0) ?? 0;
    if (this.load(this.catalogue[first]!)) { void doppler.ensure(); return; }
    const said = this.note;
    const tried = new Set([first]);
    for (const i of wants.concat(this.catalogue.map((_, i) => i))) {
      if (i < 0 || tried.has(i)) continue;
      tried.add(i);
      if (this.load(this.catalogue[i]!)) { this.note = said + ' Showing ' + this.catalogue[i]!.name + ' instead.'; break; }
    }
    void doppler.ensure();
  }

  /** The age of an element set and the line saying when it was last checked both change while the page sits there:
   *  re-read them every 30 seconds and when the tab comes back to the front, which is also when the next check is
   *  due (the check's own guard makes all but one call in 360 a comparison rather than a request). Background tabs
   *  have their timers throttled hard, so a console parked behind another window comes back hours stale with its
   *  next scheduled check still minutes away: check on the way back in. */
  private startTimers(): void {
    const tick = () => { wall.touch(); if (this.entry) void live.check(this.entry); };
    setInterval(tick, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  }

  /** The embedded record of a spacecraft, by NORAD number. */
  embedded(satnum: string): CatalogueEntry | undefined { return this.byKey.get(satnum); }
  /** Are the two lines of this entry the embedded ones (read off the lines, not off a flag)? */
  isEmbedded(e: { satnum: string; l1: string; l2: string }): boolean {
    if (isCustom(e)) return false;                // the flag, never the number: the test hook gives one a real catalogue number
    const o = this.byKey.get(e.satnum);
    return !!o && o.l1 === e.l1 && o.l2 === e.l2;
  }
  /** The catalogue index of an entry, or -1 (a spacecraft is its number: the entry on screen may carry a live set's lines). */
  catIndex(e: { satnum: string } | null | undefined): number {
    return e && !isCustom(e) ? this.byIndex.get(e.satnum) ?? -1 : -1;
  }

  /* ---- loading an analysis ---------------------------------------------------------------------------------- */

  /* load() says whether it loaded. compute() throws when SGP4 cannot propagate an object anywhere in the window - by
     late September 2026, fourteen catalogue entries that SGP4 has decayed and one whose elements it rejects
     outright. The new analysis is computed before anything is touched. If it cannot be, everything stays as the
     analysis still on screen was computed (nothing is committed until it works), and the page says why. */
  load(entry: CatalogueEntry, o: LoadOptions = {}): boolean {
    const D = this.analysis, eng = getEngine();
    /* The same spacecraft is the same number - the entry on screen may carry a live set's lines - except for an orbit of the reader's
       own, which is the same object: its number is a placeholder, and the test hook gives one a real catalogue number. */
    const same = !!D && (isCustom(entry) || isCustom(D.entry) ? D.entry === entry : D.entry.satnum === entry.satnum);
    let start = o.start !== undefined ? o.start : this.startMs;
    const hours = o.hours ?? this.hours;
    /* In the assignment snapshot a window opens at the element set's epoch, on a change of spacecraft too: the
       README times each one from its own. Reloading the same spacecraft - a site or span change, the window rolling
       on - keeps the window that is on screen. */
    if (PINNED && !same) start = eng.elements(entry.l1, entry.l2).epoch.getTime();
    /* A deep-space orbit of the reader's own, picked from far from the window, opens at its epoch (D39): it is passed as the start, so
       nothing is moved until the analysis has worked. */
    if (isCustom(entry) && !same && o.start === undefined && this.deepStart) { const s = this.deepStart(entry, start); if (s !== null) start = s; }
    if (start === null) start = Date.now();
    let nd: Analysis;
    try { nd = eng.compute(entry, start, hours); }
    catch (err) {
      const e = err as Error & { sgp4?: number };
      this.lastFailure = e;
      const why = (e && typeof e === 'object' && 'sgp4' in e) ? eng.sgp4Why(e.sgp4) : String(e && e.message || e);
      const tried = 'from ' + iso(new Date(start)) + ' for ' + spanLabel(hours);
      if (!o.trial) {
        this.note = !D ? entry.name + ' cannot be propagated ' + tried + ' (' + why + ').'
          : !same
            ? entry.name + ' not loaded: SGP4 cannot propagate it anywhere in this window (' + why + '). Still showing ' + D.entry.name + '.'
            : 'Window not changed: SGP4 cannot propagate ' + entry.name + ' anywhere ' + tried + ' (' + why + ').';
      }
      return false;
    }
    this.lastFailure = null;
    this.startMs = start;
    this.hours = hours;
    this.entry = entry;
    this.analysis = nd;
    this.rev++;
    this.selPass = 0;
    if (!isCustom(entry)) this.lastCat = this.catIndex(entry);
    if (!o.trial) this.note = '';
    if (!o.keepClock) clock.seek(nd.start.getTime());
    clock.setBounds({ t0: nd.start.getTime(), t1: nd.end.getTime(), onLeave: ms => this.rollWindow(ms) });
    this.syncUrl();
    life.offer(entry);                            // the cached forecast, or the offer to fetch the history
    if (!o.trial) void live.check(entry);        // fire and forget; reloads if a newer set exists
    if (this.afterLoad) { try { this.afterLoad(nd); } catch (err) { console.error(err); } }   // last, and its own failure is not the load's
    return true;
  }

  /** Leave the entry on screen for a catalogue one, as removing an orbit of the reader's own does: the last catalogue spacecraft shown,
   *  then the default, the rest of the preference list, then the catalogue in order; the first that loads wins. False when none does. */
  loadFallback(): boolean {
    const wants = WANT.map(re => this.catalogue.findIndex(c => re.test(c.name)));
    const first = wants.find(i => i >= 0) ?? 0;
    const order = [this.lastCat, first].concat(wants, this.catalogue.map((_, i) => i));
    for (const i of order) {
      const e = i < 0 ? undefined : this.catalogue[i];
      if (e && this.select(e)) return true;
    }
    return false;
  }

  /** The reader picked a spacecraft. */
  select(entry: CatalogueEntry): boolean { return this.load(live.effective(entry)); }

  /** Re-run the current spacecraft (a new site), keeping the clock where it is. */
  reanalyze(): boolean { return this.entry ? this.load(this.entry, { keepClock: true }) : false; }

  setSpan(hours: number): void { if (this.entry) this.load(this.entry, { hours }); }

  /** Open the window at an instant (Now, Epoch, a typed time, a step of a day). The clock goes to its start. */
  setWindowStart(ms: number): boolean { return !!this.entry && this.load(this.entry, { start: ms }); }

  /* Slide the analysis window to contain `at`, keeping the clock where it is. load() recomputes everything, so the
     instant is captured first and put back afterwards.

     Recomputing is not cheap - passes are re-scanned and bisected - but it happens at most once per window
     crossing, which even at the 3600x cap is once every 24 seconds of real time. Guarded against a rate so high
     that a single frame skips whole windows, which would otherwise mean an unbounded loop. */
  rollWindow(at: number): void {
    const D = this.analysis;
    if (!D || !this.entry) return;
    const t0 = D.start.getTime(), span = D.end.getTime() - t0;
    if (!(span > 0)) return;
    const keep = clock.playing;
    let start = t0;
    for (let i = 0; i < 64 && (at > start + span || at < start); i++) start += at > start ? span : -span;
    if (!this.load(this.entry, { start, keepClock: true })) {
      /* Played on into time SGP4 cannot propagate - an object decaying under the running clock. Nothing was
         changed; stop at the window's edge rather than retrying the same failure on every animation frame. */
      clock.seek(Math.min(t0 + span, Math.max(t0, at)));
      clock.setPlaying(false);
      return;
    }
    clock.seek(at);
    clock.setPlaying(keep);
  }

  /* The first pass after the window. Past the window's last pass the countdown used to take the window's FIRST pass
     and add the window length, as though the ground track repeated every window - left over from when the clock
     looped the day. It does not repeat (15.7 revolutions a day), so it counted down, an hour out, to a 74° pass that
     was really a 20° one. Searched on demand rather than in compute(): it is needed only once the clock is past the
     last pass, it costs a scan as long again as a day's, and keeping it off the analysis keeps it out of what the
     regression gate compares. Remembered per analysis, so any new analysis drops it. */
  passAfterWindow(): Pass | null {
    const D = this.analysis;
    if (!D) return null;
    if (!this.afterWindow.has(D)) {
      const eng = getEngine(), t1 = D.end.getTime();
      const P = eng.findPasses(D.track, t1, t1 + NEXT_H * 3600000, eng.passStepFor(NEXT_H));
      this.afterWindow.set(D, P.find(p => !p.clipA) || null);
    }
    return this.afterWindow.get(D)!;
  }

  inWindow(ms: number): boolean {
    const D = this.analysis;
    return !!D && ms >= D.start.getTime() - 1 && ms <= D.end.getTime() + 1;
  }

  /** Choose a pass; `scrub` jumps the clock to its culmination and stops it there. */
  selectPass(i: number, scrub = false): void {
    const D = this.analysis;
    if (!D || !D.passes.length) return;
    this.selPass = Math.max(0, Math.min(i, D.passes.length - 1));
    if (scrub) clock.seek(D.passes[this.selPass]!.maxAt.getTime(), true);
  }

  /* ---- the observer ---------------------------------------------------------------------------------------- */

  /** A site from what was typed, picked or saved: validated, its zone kept only if this browser can resolve it, and an
   *  offset from the zone where there is one (at this instant; tzAt follows the instant from then on). */
  private siteFrom(raw: SiteInput): Site | null {
    const zone = raw.zone && zoneKnown(raw.zone) ? raw.zone : undefined;
    const z = zone ? offsetAt(zone, Date.now()) : null;
    return normalizeSite({ ...raw, zone }, z);
  }

  /** Move the observer. A place picked by name carries its own zone; a bare coordinate does not, and only a zone this
   *  browser can actually resolve is kept - an engine with a stub Intl answers UTC for everything, and showing UTC as
   *  though it were local time is worse than admitting there is no zone at all. `persist` writes the site (the
   *  old applySite's flag), `remember` adds it to the recent places. */
  applySite(raw: SiteInput, o: { where?: string; persist?: boolean; remember?: boolean; reanalyze?: boolean } = {}): boolean {
    const persist = o.persist ?? true;
    const site = this.siteFrom(raw);
    if (!site) return false;
    this.site = setObserver(site);
    if (persist) saveSite(localStorage, this.site, o.where ?? raw.where ?? '');
    if (o.remember) this.recents = remember(localStorage, this.site, o.where ?? raw.where ?? '');
    if (o.reanalyze ?? true) this.reanalyze();          // the whole analysis is site-dependent
    return true;
  }

  resetSite(): void {
    this.site = setObserver({ ...HOME });
    try { localStorage.removeItem(SITE_KEY); } catch { /* nothing to remove */ }
    this.reanalyze();
  }

  /* ---- reading the analysis at an instant ----------------------------------------------------------------- */

  /** The sample at a sample index (the scrubber's unit). */
  idxAt(ms: number): number {
    const D = this.analysis;
    if (!D) return 0;
    return Math.max(0, Math.min(D.pts.length - 1, Math.round((ms - D.start.getTime()) / 1000 / D.step)));
  }

  /** Where the spacecraft is, and its look from the observer, at any instant: inside the window the stored sample is
   *  read; outside it the real instant is propagated, so every panel reports the same moment. */
  sampleAt(ms: number): Sample | null {
    const D = this.analysis;
    if (!D) return null;
    const inside = this.inWindow(ms);
    return (inside ? D.pts[this.idxAt(ms)] : getEngine().sampleMs(D.track, ms)) ?? D.pts[this.idxAt(ms)] ?? null;
  }

  private syncUrl(): void {
    const atHome = Math.abs(this.site.lat - HOME.lat) < 1e-9 && Math.abs(this.site.lon - HOME.lon) < 1e-9;
    writeUrl({
      sat: this.entry && !isCustom(this.entry) ? this.entry.satnum : undefined,   // an orbit of the reader's own is nobody's number: not a link
      span: this.hours,
      /* where this device said it was is saved in this browser like any site, and is never written into the address bar: history, bookmarks
         and share sheets would carry it */
      site: this.site.name === DEVICE_SITE ? undefined : { lat: this.site.lat, lon: this.site.lon }, tab: prefs.tab === 'globe' ? undefined : prefs.tab
    }, { span: 24, atHome });
  }
}

export { SPANS };
export const app = new AppState();
