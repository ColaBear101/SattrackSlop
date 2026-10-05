/* What the countdown says: how long until the next pass, or until the one in progress sets, and when.
 *
 * Moved from `paintCountdown()` in legacy/index.html (main@4eadd7a), lines 9771-9820, with its comments and every
 * word of its text. The page's closure (the analysis, the transport's clock, the search past the window) is
 * arguments, and what it wrote into the DOM is returned. */
import { ABBR, hhmmss, iso, spanLabel, whenZ } from './fmt';
import { localOf, type SiteClock } from './passfacts';
import { abbr, type Inline } from './rich';
import type { Analysis, Pass } from '../types';

export interface Countdown {
  /** the small caption over the figure */
  label: string;
  /** the figure: 01:58:49, or "—" or "none" */
  value: string;
  /** a pass is in progress (the figure is lit) */
  live: boolean;
  /** the line under it */
  when: Inline;
}

export const NEXT_HOURS = 48;

export function countdown(
  D: Analysis, simMs: number, nowMs: number, mask: number, c: SiteClock, afterWindow: () => Pass | null
): Countdown {
  const P = D.passes;
  const t0 = D.start.getTime(), t1 = D.end.getTime();
  if (!(simMs >= t0 - 1 && simMs <= t1 + 1)) {
    return {
      label: 'Outside the window', value: '—', live: false,
      when: 'The clock is outside the ' + spanLabel(D.hours) + ' window from ' + iso(D.start) +
            '. Press Now or Epoch to move the window.'
    };
  }
  /* The countdown runs on the transport clock. Scrubbed, sped up or a day back, that is not now - so it says so
     rather than counting down to a pass that has already happened as though it were the next one. */
  const sim = Math.abs(simMs - nowMs) > 5000 ? ' · sim time' : '';
  const now = P.find(p => simMs >= p.t0ms && simMs <= p.t1ms);
  if (now && now.clipL) {
    /* Still above the mask when the window closes: the LOS on the table is the window edge, and "sets in" would be a
       claim about a time nobody looked at. A GEO spacecraft is the whole-window case - it never sets at all. */
    return {
      label: 'In view now — still up at window end' + sim, value: '≥ ' + hhmmss(now.t1ms - simMs), live: true,
      when: 'Above ' + mask + '° ' + (now.clipA ? 'for the whole window, ' : '') + 'until at least ' +
            whenZ(now.los) + ' · max ' + now.maxEl.toFixed(1) + '° in window'
    };
  }
  if (now) {
    /* Up when the window opened, with the highest point in it on that edge: the spacecraft peaked before anyone
       looked, so that is not called a culmination - the same test the sky facts make. */
    const edge = now.clipA && now.maxAt.getTime() - now.t0ms < 1000;
    return {
      label: 'In view now — sets in' + sim, value: hhmmss(now.t1ms - simMs), live: true,
      when: [abbr(ABBR.LOS), ' ' + whenZ(now.los) + ' · ' + (edge ? 'highest in window ' : 'culminates ') + now.maxEl.toFixed(1) + '°']
    };
  }
  const nxt = P.find(p => p.t0ms > simMs) || afterWindow();
  if (!nxt) {
    return {
      label: 'Next pass', value: 'none', live: false,
      when: 'Nothing clears the ' + mask + '° mask ' + (P.length ? 'in the rest of this window' : 'in this window') +
            ' or the ' + NEXT_HOURS + ' h after it.'
    };
  }
  return {
    label: 'Next pass in' + sim, value: hhmmss(nxt.t0ms - simMs), live: false,
    when: [abbr(ABBR.AOS), ' ' + whenZ(nxt.aos) + ' · ' + localOf(nxt.aos, c) + ' · max ' +
      (nxt.clipL ? '≥ ' : '') + nxt.maxEl.toFixed(1) + '°' + (nxt.t0ms > t1 ? ' · after this window' : '')]
  };
}
