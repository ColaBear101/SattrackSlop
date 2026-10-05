import { markup } from './markup';
import type { Inline } from './rich';

/* The Decay section's views that need no forecast: the offer to fetch the history, the wait, and the empty panel. They are
   here, apart from the sentences that read a history (life.ts, with the drag model behind it), because every spacecraft
   that is loaded shows one of them, while the rest is only wanted when a forecast exists or is asked for - and is a chunk
   of its own. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface LifeView { big: string; sub: string; note: Inline; span: string; action?: 'estimate' | 'retry' }
export interface LifeFields { span?: string; alt?: string; rate?: string; hist?: string }
/** What the chart is drawn from: the history (P), the prediction (r), and for a planned orbit the two flags. */
export interface LifeChartState { P: { t: number; sma: number }[]; r: Any; custom?: boolean; eccentric?: boolean }

/* The history endpoint's answer time is not one number: the ISS and KNACKSAT-2 took 25 s and more than 90 s on 25 Sep 2026,
   and 24 s and 2 s two days later. So this does NOT fire on its own when a spacecraft is selected - clicking through the
   picker could queue a dozen minute-long requests against someone else's server. Unless the answer is already in the cache
   the page asks first and says what it is about to do, and gives the range rather than a typical time, since there is no
   typical time to give. (From lifeOffer() in legacy/index.html, lines 11665-11687.) */
export const offerView = (): LifeView => ({
  big: 'Not estimated yet', sub: '', span: '', action: 'estimate',
  note: markup('Estimating decay needs this object&rsquo;s run of past element sets. CelesTrak rebuilds that ' +
    'from its archive on request, and has taken anywhere from <b>a few seconds to over a ' +
    'minute</b> to answer, so it is fetched only when you ask. It is then cached for 12 hours.')
});

/** The wait, once asked (from runLife()'s say(), lines 11795-11803). */
export const fetchingView = (seconds: number): LifeView => ({
  big: 'Fetching…', sub: seconds + ' s', span: '',
  note: markup('Reading this object&rsquo;s element-set history from CelesTrak, which rebuilds it on each ' +
    'request. That has taken anywhere from a few seconds to over a minute; the page waits up ' +
    'to 75 seconds.')
});

export const LIFE_NOTHING: LifeView = { big: '—', sub: '', note: '', span: '' };
