/* The facts about one pass, as rows: what the old page wrote under the sky plot when a pass was chosen.
 *
 * Moved from `selectPass()` in legacy/index.html (main@4eadd7a), lines 10085-10130, with its comments and every word
 * of its text; `renderAccess()` (lines 9842-9927) for the pass list's labels. The page's closure (the analysis, the
 * clock offsets) is arguments, and the HTML it built is data (rich.ts). The naked-eye and Doppler rows are built in
 * lib/analysis/doppler.ts and appended by the caller, as they were. */
import { ABBR, compass, hms, md, mmss, whenLocal, whenZ, ymd } from './fmt';
import { abbr, type Inline, type Row } from './rich';
import { tzAt, tzLabelAt } from '../places';
import type { Pass, Site } from '../types';

/** What the site's clock says at an instant: its offset, and the label that goes with that offset. */
export interface SiteClock { offsetAt(ms: number): number; labelAt(ms: number): string }

/** The clock of a site: its offset at an instant (summer time follows the instant), and the name that goes with it. */
export const siteClock = (site: Pick<Site, 'tz' | 'zone'>): SiteClock =>
  ({ offsetAt: ms => tzAt(site, ms), labelAt: ms => tzLabelAt(site, ms) });

export const localOf = (d: Date, c: SiteClock): string => whenLocal(d, c.offsetAt(d.getTime()), c.labelAt(d.getTime()));

/** The pass's own account of how the window cut it, or null when it did not. */
export function clipText(p: Pass): Inline | null {
  return p.clipA && p.clipL ? ['up the whole window; true ', abbr(ABBR.AOS), ' and ', abbr(ABBR.LOS), ' lie outside it']
    : p.clipA ? ['already up when the window opens; true ', abbr(ABBR.AOS), ' is earlier']
    : p.clipL ? ['still up when the window closes; true ', abbr(ABBR.LOS), ' is later'] : null;
}

/** A pass already up when the window opens, or still up when it closes, has a window edge where its AOS or LOS would
 *  be. The mark goes everywhere the time does, with a legend and in words for a screen reader. */
export const clipSay = (p: Pass): string => p.clipA && p.clipL ? 'above the mask for the whole window'
  : p.clipA ? 'already above the mask when the window opens'
  : p.clipL ? 'still above the mask when the window closes' : '';

/** On a clipped pass the highest point inside the window can sit on its edge, which is where the window stopped
 *  looking, not where the spacecraft peaked - so it is not called a culmination there. */
export const atEdge = (p: Pass): boolean =>
  (p.clipA && p.maxAt.getTime() - p.t0ms < 1000) || (p.clipL && p.t1ms - p.maxAt.getTime() < 1000);

export function passFacts(p: Pass, index: number, count: number, c: SiteClock, extra: Row[]): Row[] {
  const clip = clipText(p);
  const rows: Row[] = [
    ['Pass', (index + 1) + ' of ' + count],
    [abbr(ABBR.AOS), whenZ(p.aos) + (p.clipA ? ' *' : '') + ' · ' + localOf(p.aos, c)],
    [atEdge(p) ? 'Highest in window' : 'Culmination',
      whenZ(p.maxAt) + ' at ' + p.maxEl.toFixed(1) + '° ' + compass(p.maxAz)],
    [abbr(ABBR.LOS), whenZ(p.los) + (p.clipL ? ' *' : '') + ' · ' + localOf(p.los, c)],
    ['Duration', mmss(p.dur) + '  ·  min range ' + p.minRng.toFixed(0) + ' km']
  ];
  if (clip) rows.push(['* Window edge', clip]);
  return rows.concat(extra);
}

/** The line under the sky plot in the report. */
export function skyCaption(p: Pass, index: number, count: number): Inline {
  return ['Pass ' + (index + 1) + ' of ' + count + ' · max ' + p.maxEl.toFixed(1) + '° ' + compass(p.maxAz),
    { br: true }, abbr(ABBR.AOS), ' ' + ymd(p.aos) + ' ' + hms(p.aos) + 'Z' + (p.clipA ? ' *' : '')];
}

/** The pass list's row text, as the page built it: the UTC time with its mark, the local time and duration under it. */
export function passRowText(p: Pass, c: SiteClock): { utc: string; sub: string; peak: string; label: string } {
  const say = clipSay(p);
  return {
    utc: whenZ(p.aos) + (p.clipA ? ' *' : ''),
    sub: localOf(p.aos, c) + ' · ' + mmss(p.dur) + (p.clipL ? ' *' : ''),
    peak: p.maxEl.toFixed(0) + '°',
    label: 'acquisition ' + ymd(p.aos) + ' ' + hms(p.aos) + ' UTC, ' + mmss(p.dur) +
      ', maximum elevation ' + p.maxEl.toFixed(1) + ' degrees' + (say ? ', ' + say : '')
  };
}

/** One row of the report's access table: the date is the AOS's; a LOS past UTC midnight carries its own. */
export function passTableRow(p: Pass): string[] {
  return [
    ymd(p.aos),
    hms(p.aos) + (p.clipA ? ' *' : ''),
    (ymd(p.los) !== ymd(p.aos) ? md(p.los) + ' ' : '') + hms(p.los) + (p.clipL ? ' *' : ''),
    mmss(p.dur),
    p.maxEl.toFixed(1) + '°',
    p.maxAz.toFixed(0) + '° ' + compass(p.maxAz),
    p.minRng.toFixed(0) + ' km',
    compass(p.aosAz) + '→' + compass(p.losAz)
  ];
}
