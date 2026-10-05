/* The two sentences that qualify the answer before it is read, and the headline's sub-line.
 *
 * Moved from legacy/index.html (main@4eadd7a): `paintReentry()` (lines 10822-10832), the markup of #briefnote (line
 * 1393) and `renderAccess()` (lines 9842-9860), with their comments and every word of their text. As everywhere in
 * this layer, the HTML they built is data (rich.ts). */
import { iso, pad, spanLabel, ymd } from './fmt';
import { b, link, type Inline } from './rich';
import type { Analysis } from '../types';
import { tzAt, tzLabelAt } from '../places';
import type { Site } from '../types';

/* In the answer block, above the number it undermines. "12 min in view" is the first thing read on the page, and for
   an object below the entry interface it is the one figure that should not be believed. */
export function reentryNote(D: Analysis, reentryKm: number): Inline | null {
  const R = D.reentry;
  if (!R) return null;
  return [b('Re-entry.'), ' Propagated from the start of this window, SGP4 takes ' + D.entry.name + ' down to ' + R.minAlt.toFixed(1) + ' km' +
    (R.groundAt !== null ? ', and below the surface at ' + iso(new Date(R.groundAt)) + ' (error 6)' : '') +
    ' — under the ' + reentryKm + ' km ', link('#t-reentry', 'entry interface'),
    '. It has re-entered or is about to' +
    (D.passes.length ? ', so the passes listed will not happen and are not exported.' : '.')];
}

/* The brief asks for a spacecraft from CelesTrak's Earth Resources group, and the default is not in it: KNACKSAT-2
   came into this catalogue from SatNOGS, and verification/resource.txt, a copy of that group, has no entry for it. It
   stays the default, so while it is the one on screen the answer block says so, rather than presenting its figures as
   the assignment's answer without qualification. */
export const OUT_OF_BRIEF = /^KNACKSAT[- ]?2\b/i;
export const outOfBrief = (name: string, custom: boolean): boolean => !custom && OUT_OF_BRIEF.test(name);   // a custom orbit may be NAMED like the default
export const briefNote: Inline = [b('Outside the brief.'), ' KNACKSAT-2, the default, is not in CelesTrak’s ',
  link('#t-brief', 'Earth Resources group'), ', which the assignment asks for.'];

/** "15 min 00 s in view over 24 h from 2026-09-12 14:29 UTC+7 — 1.04% of the window. Element set epoch 2026-09-12 07:29Z."
 *  Which window, and which element set. "In view over 24 h" read the same for every window, so two readers loading the
 *  page an hour apart quoted different totals with nothing beside them to say why, and neither matched the README,
 *  whose figures open at the epoch of the embedded set. */
export function totalSub(D: Analysis, site: Pick<Site, 'tz' | 'zone'>, pinned: boolean): string {
  const total = D.totalS;
  const T = Math.round(total);                          // same carry trap as mmss()
  const h = Math.floor(T / 3600), m = Math.floor(T % 3600 / 60), s = T % 60;
  const ws = D.start.getTime();
  const wl = new Date(ws + tzAt(site, ws) * 3600000);
  const hm = (d: Date) => pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  return (h ? h + ' h ' + m + ' min' : m + ' min ' + pad(s) + ' s') + ' in view over ' + spanLabel(D.hours) +
    ' from ' + ymd(wl) + ' ' + hm(wl) + ' ' + tzLabelAt(site, ws) +
    ' — ' + (total / (D.hours * 36)).toFixed(2) + '% of the window. Element set epoch ' +
    ymd(D.E.epoch) + ' ' + hm(D.E.epoch) + 'Z' + (pinned ? ', embedded (assignment snapshot).' : '.');
}

