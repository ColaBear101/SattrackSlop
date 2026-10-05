import { Lifetime } from '../planner/lifetime';
import { iso, ymd } from './fmt';
import { makeLifeWords } from './life-words';
import { markup } from './markup';
import type { LifeFields, LifeView } from './life-offer';

/* The Decay section's words as data, for a history that has arrived or failed to. The sentences are the old page's
   (life-words.ts, moved verbatim); this reads them into the rich text of rich.ts. With the drag model (`Lifetime`) it is one
   chunk, fetched when a forecast is to be drawn or asked for; the views every spacecraft shows are in life-offer.ts. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const W: Any = makeLifeWords({ Lifetime, iso, ymd });

export { Lifetime };
export { offerView, fetchingView, LIFE_NOTHING, type LifeChartState, type LifeFields, type LifeView } from './life-offer';

export const lifeAxis: (d: number) => string = W.lifeAxis;
export const lifeFmtDays: (d: number) => string = W.lifeFmtDays;
export const lifeSpan: (d: number) => string = W.lifeSpan;
export const lifeAccuracy: (days: number, date: Date) => string = W.lifeAccuracy;

/** What the history said: the verdict, and the three figures beside the chart. */
export function lifePaint(r: Any, P: Any[], now: number): { view: LifeView; fields: LifeFields } {
  const { view, fields } = W.lifePaint(r, P, now) as { view: { big: string; sub: string; note: string; span: string }; fields: LifeFields };
  return { view: { ...view, note: markup(view.note) }, fields };
}

/** Why there is no history to fit, in the words of what actually happened; `retry` is whether trying again is worth it. */
export function lifeWhyNot(entry: { satnum: string }, got: { why: string | null; status?: number; rows?: number } | null): LifeView {
  const [big, why, retry] = W.lifeWhyNot(entry, got) as [string, string, boolean];
  return { big, sub: '', note: markup(why), span: '', action: retry ? 'retry' : undefined };
}
