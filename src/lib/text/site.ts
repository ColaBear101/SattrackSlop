/* What the observer form says about the site and its offset.
 *
 * Moved from the `sitenote` branch of `paintSite()` in legacy/index.html (main@4eadd7a), lines 10449-10489, with its
 * comments and every word of its text. The page's closure (OBS, HOME, PINNED, the clock's zone label) is arguments;
 * what it assembled out of DOM nodes is data (rich.ts). */
import { link, type Inline } from './rich';
import type { Site } from '../types';

export interface SiteNoteIn {
  site: Pick<Site, 'lat' | 'lon' | 'altKm' | 'tz' | 'zone'>;
  home: Pick<Site, 'lat' | 'lon' | 'altKm' | 'tz' | 'name'>;
  pinned: boolean;
  /** the zone's label at the instant on the clock: UTC+7 */
  tzLabel: string;
}

export function siteNote({ site, home, pinned, tzLabel }: SiteNoteIn): Inline {
  const atHome = (site.lat === home.lat && site.lon === home.lon && site.altKm === home.altKm);
  /* Which of the two offsets is on screen, and why. A reader comparing a pass time against their own watch needs to
     know whether the page knows about summer time here or is rounding longitude - and it is only "solar time" when it
     is: the sentence used to say so for any bare coordinate, including one entered while the field still held the
     last site's offset. */
  const zone = site.zone
    ? site.zone + ', so the offset follows summer time where it is kept.'
    : (atHome && site.tz === home.tz) ? tzLabel + ', which ' + home.name + ' keeps all year.'
    : site.tz === (Math.round(site.lon / 15) || 0)
      ? 'No timezone for a bare coordinate, so ' + tzLabel + ' is an estimate: the nearest hour'
        + ' of solar time. Correct it under Enter coordinates.'
      : 'No timezone for a bare coordinate — ' + tzLabel + ' is the offset as entered, and does'
        + ' not follow summer time.';
  /* "Every figure in the README is computed here" was true only with the network off and the window moved to the
     epoch: the page takes a newer element set as soon as one exists and opens the window at the reader's clock. The
     snapshot link is the way to the README's own inputs. */
  const lead: Inline = !atHome ? 'Moved from ' + home.name + ' — the README’s figures no longer describe this page. '
    : pinned ? 'The assignment site, in the assignment snapshot: the embedded element set'
      + ' and a window opening at its epoch, which is what the README’s figures use. '
    : ['The assignment site. The README’s figures use it with the element set embedded in this'
      + ' page and a window opening at that set’s epoch — the ', link('?tle=embedded', 'assignment snapshot'),
      ' reproduces them. The live set and your own window give different numbers. '];
  return [lead, zone];
}
