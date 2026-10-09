import { lifeSpan } from './life';
import { markup } from './markup';
import type { LifeChartState, LifeFields, LifeView } from './life-offer';

/* The Decay section's words for a PLANNED orbit: the sibling of life.ts for an orbit the reader designed. It has no record of
   past element sets and must not ask for one; what it has is the area over mass the reader typed, and the forecast the page's
   own atmosphere model makes from it (Advisor.life), three runs, drawn with no dates.

   Moved VERBATIM from lifeCustom() in legacy/index.html (main@4eadd7a), lines 11689-11762, with its comments and every word.
   lifeHours, lifeSpan and lifeAxis (11700-11705) were moved with life-words.ts; lifeSpan is read from there through life.ts,
   and what that brings (Lifetime) the advisor's chunk carries anyway, since advisor.ts imports it. What the page's closure
   supplied is the arguments: `entry.el` is `el`, and `entry.__life.life` or the answer of Advisor.life(el) is `L`.
   Advisor.life is NOT called here: the caller passes its answer in, so this module does not pull the advisor and its 87
   sentences in with it, and the entry with no elements (which needs none of that) loads nothing more. lifeSet() and the
   assignments to #lifealt, #liferate and #lifehist wrote the page; here they are the three values returned: `view`
   (#lifebig, #lifesub, #lifenote, #lifespan), `fields` (the three figures beside the chart) and `chart` (lifeState, which
   components/report/draw-life.ts reads). The notes are strings of the old page's inline markup (<b>, entities, literal ’
   and ²), read into data by text/markup.ts.


   WHAT state/life.svelte.ts DOES FOR A CUSTOM ENTRY: life.offerCustom(entry)

   offer(entry) calls it FIRST, before the cache probe and before anything keyed on the number:
   `if ((entry as {custom?: boolean}).custom) return this.offerCustom(entry)`. The test is the FLAG, never the shape of
   satnum: the test hook entry (addCustomTLE) is custom and carries a real catalogue number.

     1. this.req++; this.target = entry; this.clear(). The counter drops a history answer still on its way for the
        spacecraft that was on screen; start() already refuses a custom, and runLife's old second layer
        (`entry.custom || my !== lifeReq`) is that guard plus the counter.
     2. Nothing is requested, ever: no createHistorySource, no historyCtx, no cached(), no tle: or hist: storage key, and
        no "Estimate remaining life" button (no view returned here has an `action`).
     3. No elements (`!entry.el`, which is the test hook): publish lifeCustomPaint(null, null) and stop. The panel reads
        'Not forecast' and 'This entry carries no elements to forecast from.', the three figures '—', no chart. Do not
        load the advisor for it.
     4. Otherwise the forecast. key = lifeCustomKey(el): the four numbers the forecast depends on (not epoch, raan, argp
        or M). `L = entry.__life && entry.__life.key === key ? entry.__life.life : Advisor.life(el, undefined)`, with no
        options (the tracks are what the chart draws; the ported advisor.ts is @ts-nocheck, so the signature TypeScript
        reads from it wants the second argument written out); on a miss, `entry.__life = { key, life: L }`.
        The memo lives on the entry object: runtime only (saveCustoms writes id, name, made and storable(el), nothing
        else), never keyed by satnum, and updateCustom takes it over with the other fields it replaces (its KEYS list has
        '__life') and sets it null for an orbit that stays on screen. It is there for cost: circular is about 3 ms, an
        eccentric orbit up to about 130 ms, and Advisor.life answers 'none' at once for a deep or high orbit (unguarded,
        a geostationary one took 30.7 s); a window move or a re-show of the same orbit must not pay again.
     5. The call and lifeCustomPaint sit inside ONE try/catch. On a throw: console.error(err), publish
        lifeCustomFailed(), cache nothing, rethrow nothing. offer() runs inside load(), and a throw here would abort the
        rest of the analysis of an orbit that has already loaded. A failed import() of the advisor chunk takes the same
        path.
     6. The advisor is a lazy chunk. Await it (and chartReady, as paint() does, so the words and the chart arrive
        together), then `if (my !== this.req) return` before publishing: the reader may have moved on while it was on
        its way. A memo hit needs only this module.
     7. Publish: `const { view, fields, chart } = lifeCustomPaint(L, el); this.view = view; this.fields = fields;
        this.chart = chart`. `fields` always carries all three figures, and `chart` is null for every answer that is not a
        forecast, so draw-life.ts draws its dash. The 'none' answers still put 'none — planned orbit' in the History
        figure, as the old page did; only the two failures (steps 3 and 5) leave it '—'. */

/** A point of one of the three runs: days after the epoch, and the height (the perigee's, for an eccentric orbit). */
export interface LifePoint { t: number; h: number }

/** What Advisor.life(el) returns (lib/planner/advisor.ts), as far as the Decay section reads it. Days, never dates; Infinity
 *  is allowed for mid, lo and hi. */
export interface AdvisorLife {
  model: 'none' | 'circular' | 'eccentric';
  why?: string | null;                 // for 'none': 'no-drag' | 'reentry' | 'deep' | 'high-perigee' | 'ecc-high' | 'high-apogee'
  mid?: number; lo?: number; hi?: number;
  h0?: number; rate0?: number;
  track?: LifePoint[]; fastTrack?: LifePoint[]; slowTrack?: LifePoint[];
}

/** The part of a custom entry's element set (`entry.el`) that the forecast reads. */
export interface CustomElements { a: number; e: number; i: number; am: number; epoch: number }

/** What the panel says for a planned orbit. `chart` is null unless there is a forecast to draw. */
export interface LifeCustomPaint { view: LifeView; fields: LifeFields; chart: LifeChartState | null }

const DASH = '—';

/** What a forecast depends on: the cache key of `entry.__life`. */
export const lifeCustomKey = (el: Pick<CustomElements, 'a' | 'e' | 'i' | 'am'>): string => [el.a, el.e, el.i, el.am].join();

/* The answer when Advisor.life() threw. It is here, not in the caller, so that every word of this panel is in one place. */
export function lifeCustomFailed(): LifeCustomPaint {
  return {
    view: { big: 'Not forecast', sub: '', note: markup('The decay could not be worked out for this orbit.'), span: '' },
    fields: { alt: DASH, rate: DASH, hist: DASH },
    chart: null
  };
}

/** What the Decay section says for a planned orbit: `L` is the answer of Advisor.life(el), `el` the entry's elements (null for
 *  an entry that carries none). */
export function lifeCustomPaint(L: AdvisorLife | null | undefined, el: CustomElements | null | undefined): LifeCustomPaint {
  const fields: LifeFields = { alt: DASH, rate: DASH, hist: DASH };
  let lifeState: LifeChartState | null = null;
  const lifeSet = (big: string, sub: string, note: string, spanTxt: string): LifeCustomPaint =>
    ({ view: { big, sub: sub || '', note: markup(note || ''), span: spanTxt || '' }, fields, chart: lifeState });

  if(!el || !L){
    return lifeSet('Not forecast', '', 'This entry carries no elements to forecast from.', '');
  }
  const hp = typeof L.h0 === 'number' && isFinite(L.h0) ? Math.round(L.h0).toLocaleString('en-US') : '—';
  const spanTxt = 'planned orbit — nothing was requested';
  fields.hist = 'none — planned orbit';
  if(L.model === 'none'){
    const sub = 'perigee ' + hp + ' km';
    if(L.why === 'deep')
      return lifeSet('Not forecast', sub, 'A period of 225 minutes or more. What shortens the life of an orbit this high is the Moon and the Sun pulling on its perigee, not drag, and this page models neither, so no estimate is offered.', spanTxt);
    else if(L.why === 'high-perigee')
      return lifeSet('No drag estimate', sub, 'Perigee is <b>' + hp + ' km</b>, above the 1,000 km where the atmosphere this page knows ends, so no estimate is offered. For a compact satellite the air does not decide how long this orbit lasts; for a very light sail or balloon it still might.', spanTxt);
    else if(L.why === 'high-apogee' || L.why === 'ecc-high')
      return lifeSet('Not forecast', sub, 'This orbit reaches beyond 5,000 km or is more eccentric than 0.3: the Moon and the Sun, not drag, decide where its perigee goes, and this page models neither.', spanTxt);
    else if(L.why === 'reentry')
      return lifeSet('Re-entering', sub, 'Perigee is <b>' + hp + ' km</b>, under the 120 km line this page calls re-entry; it does not come round many more times.', spanTxt);
    else
      return lifeSet('No drag', '', 'An area-to-mass ratio of 0 never decays.', spanTxt);
  }
  const eccentric = L.model === 'eccentric', epoch = el.epoch;
  const h0 = L.h0 as number, rate0 = L.rate0 as number, mid = L.mid as number, lo = L.lo as number, hi = L.hi as number;
  const P: (LifeChartState['P'][number] & { ecc: number })[] = [{ t: epoch, sma: h0, ecc: el.e }];     // the chart reads t and sma
  lifeState = { custom: true, eccentric, P,
    r: { hNow: h0, tNow: epoch, rate: rate0, verdict: 'custom', track: L.track, simpleTrack: L.fastTrack, trendTrack: L.slowTrack } };
  fields.alt = h0.toFixed(1) + ' km';
  fields.rate = rate0.toFixed(3) + ' km/day';
  const am = el.am.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + ' m²/kg';
  /* Every piece is a constant or a number the page worked out; nothing the reader typed as text
     reaches this string (the name is not in it). */
  return lifeSet(mid === Infinity ? 'More than a century' : lifeSpan(mid),
    lo === Infinity ? 'more than a century even with drag three times as strong'
      : 'between ' + lifeSpan(lo) + ' and ' + lifeSpan(hi) + ' after the epoch',
    'This is the page’s atmosphere model run forward from the area-to-mass ratio you typed, <b>' + am + '</b>. ' +
    'It has no history to fit, so the range is wide on purpose: the drag as a whole, air density and your guess together, ' +
    'is allowed a factor of 3 either way, and a solar cycle alone swings the air at 400 km by about a factor of ten. ' +
    'The globe’s own propagation starts at this rate and ' +
    (eccentric
      ? 'then follows its own atmosphere, so it can reach the ground sooner or later than this (against SGP4 the ratio has run from about a third to nearly three times): a rough cross-check only.'
      : 'then decays more slowly, because SGP4’s air density falls off more gently with height; scrolled years ahead it can reach the ground up to about three times later than the mid-case.') +
    ' No element-set history was requested, because none exists.' +
    (eccentric ? ' Drag is applied orbit-averaged, so it bites at perigee, <b>' + hp + ' km</b>, and the chart shows perigee height.' : ''),
    'forecast from your drag assumption, not from a history');
}
