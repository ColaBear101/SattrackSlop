import { createHistorySource } from '../lib/net/history-source';
import type { CatalogueEntry } from '../lib/catalogue/parse';
import { isCustom, type CustomEntry } from '../lib/planner/custom';
import { fetchingView, offerView, LIFE_NOTHING, type LifeChartState, type LifeFields, type LifeView } from '../lib/text/life-offer';
import { historyCtx } from './net';
import { loadPlannerMods, plannerMods } from './planner-mods';

/* Orbital decay and the remaining-life estimate. The estimate itself is lib/planner/lifetime.ts; this keeps the panel's
 * state: what it says, the three figures beside the chart, and what the chart is drawn from.
 *
 * From lifeOffer(), runLife() and lifeClear() in legacy/index.html (main@4eadd7a), lines 11610-11822, with the same rule:
 * the history endpoint's answer time is not one number (a few seconds to over a minute), so fetching it does NOT fire on its
 * own when a spacecraft is selected - clicking through the picker could queue a dozen minute-long requests against someone
 * else's server. If the answer is already in the cache it appears at once; otherwise the page asks first. Every request is
 * numbered, so an answer for a spacecraft that is no longer on screen is dropped.
 *
 * The drag model and the sentences that read a history (lib/text/life.ts) are a chunk of their own: nothing here needs them
 * until a forecast is to be painted, and the offer and the wait are in lib/text/life-offer.ts. */

const DASH: LifeFields = { alt: '—', rate: '—', hist: '—' };
const engine = () => import('../lib/text/life');
const customWords = () => import('../lib/text/life-custom');

class LifeState {
  view = $state.raw<LifeView>(LIFE_NOTHING);
  fields = $state.raw<LifeFields>(DASH);
  chart = $state.raw<LifeChartState | null>(null);

  /** Set by the Decay section: loads the chart's code. A forecast is published only after it has, so the chart and its key
   *  arrive with the words and not a moment after them. */
  chartReady: (() => Promise<unknown>) | null = null;

  private req = 0;
  private target: CatalogueEntry | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  private clear(): void {
    clearInterval(this.timer);
    this.fields = DASH;
    this.chart = null;
  }

  /** A spacecraft has been loaded: show its cached forecast, or offer to fetch the history. */
  offer(entry: CatalogueEntry): void {
    this.req++;
    this.target = entry;
    this.clear();
    /* An orbit the reader designed first, before anything keyed on its number: no cache to probe, no button, no request. The flag, never
       the number - the test hook's orbit carries a real catalogue number. */
    if (isCustom(entry)) { this.view = LIFE_NOTHING; void this.offerCustom(entry, this.req); return; }
    const hit = createHistorySource(historyCtx(false)).cached(entry.satnum);
    if (hit) { this.view = LIFE_NOTHING; void this.paint(hit, this.req); return; }
    this.view = offerView();
  }

  /** A planned orbit: nothing to ask anyone. The forecast is the page's own atmosphere model run forward from the area-to-mass ratio the
   *  reader typed (the advisor's chunk), kept on the entry so a window move or a second look does not pay for it again. Everything that
   *  can go wrong is the panel's own answer, never a throw out of the load that called this. */
  private async offerCustom(entry: CustomEntry, my: number): Promise<void> {
    let paint;
    try {
      const [W] = await Promise.all([customWords(), this.chartReady?.().catch(() => undefined)]);
      const el = entry.el;
      if (!el) paint = W.lifeCustomPaint(null, null);              // the test hook's entry: no elements, and nothing more to load
      else {
        const key = W.lifeCustomKey(el);
        let L;
        if (entry.__life && entry.__life.key === key) L = entry.__life.life;
        else {
          const mods = plannerMods() ?? await loadPlannerMods();
          L = mods.Advisor.life(el);
          entry.__life = { key, life: L };
        }
        paint = W.lifeCustomPaint(L, el);
      }
    } catch (err) {
      console.error(err);
      paint = null;
    }
    if (my !== this.req) return;                                    // the reader moved on while it was on its way
    if (!paint) {
      try { paint = (await customWords()).lifeCustomFailed(); } catch { return; }
      if (my !== this.req) return;
    }
    this.view = paint.view;
    this.fields = { ...DASH, ...paint.fields };
    this.chart = paint.chart;
  }

  /** The request counter: a history answer is dropped when this has moved on since it was asked for. */
  get seq(): number { return this.req; }

  /** The reader asked ("Estimate remaining life", "Try again"). */
  async start(): Promise<void> {
    if (this.target) await this.run(this.target, this.req);
  }

  /** Fetch the history of `entry` and paint its forecast, if request number `my` is still the current one. The button that calls start() is
   *  never made for a planned orbit, so this is the second layer: a direct call for one asks nobody and leaves the panel as it was. */
  async run(entry: CatalogueEntry, my: number): Promise<void> {
    if (isCustom(entry) || my !== this.req) return;
    const t0 = Date.now();
    const say = () => { this.view = fetchingView(Math.round((Date.now() - t0) / 1000)); };
    say();
    this.timer = setInterval(say, 1000);
    const words = engine();                                             // fetched while the request is out
    let got = null;
    try { got = await createHistorySource(historyCtx(false)).history(entry.satnum); } catch { got = null; }
    clearInterval(this.timer);
    if (my !== this.req) return;                                        // user moved on
    const L = await words;
    const P = got && got.P;
    if (!P) { this.view = L.lifeWhyNot(entry, got); return; }
    await this.paint(P, my);
  }

  private async paint(P: LifeChartState['P'], my: number): Promise<void> {
    const [L] = await Promise.all([engine(), this.chartReady?.().catch(() => undefined)]);
    if (my !== this.req) return;
    const r = L.Lifetime.predict(P);
    const { view, fields } = L.lifePaint(r, P, Date.now());
    this.chart = { P, r };
    this.fields = { ...DASH, ...fields };
    this.view = view;
  }
}

export const life = new LifeState();
