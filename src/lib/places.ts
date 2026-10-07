/* Finding out where the observer is.
 *
 * Moved from legacy/earth/places.js (main@4eadd7a): the logic, the order of the checks and the comments are the
 * original's; the types, the module form and `tzAt` / `tzLabelAt` (the old page's, from legacy/index.html
 * lines 8468-8486, which read the zone through this module) are new. Nothing here touches the DOM, and nothing
 * here is required: every path it offers is a convenience over typing the numbers in, and typing the numbers
 * in still works with no network at all.
 *
 * The observer used to be five numbers you had to already know, and the two fields most likely to be got wrong
 * were the two nobody can answer from memory: the altitude of the ground they are standing on, and their offset
 * from UTC. A place name gets all of it - position, ground elevation, and a real IANA zone - from one request.
 *
 * Open-Meteo's geocoder is used because it needs no key, answers with Access-Control-Allow-Origin, and returns
 * elevation and timezone alongside the coordinates.
 */
import { tzLabel } from './observer';
import type { Site } from './types';

export const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
export const credit = 'Place search by Open-Meteo';

/* The offset from UTC, in hours, at a given instant.
 *
 * Not a constant, because it is not one. A zone that keeps summer time has two answers and the right one
 * depends on the day of the pass, which for a 7-day window can be either side of a transition.
 *
 * Done by formatting the instant IN the zone and reading the wall-clock back as though it were UTC: the
 * difference is the offset. That is the portable way - the timeZoneName:'longOffset' option would say it
 * directly but is younger than some browsers still in use. */
const offCache = new Map<string, number | null>();
export function offsetAt(zone: string | null | undefined, ms: number): number | null {
  if (!zone) return null;
  /* Offsets change at most twice a year; an hour of granularity is far finer than needed and keeps a 7-day
     window of passes to a couple of hundred entries. */
  const key = zone + '|' + Math.floor(ms / 3600000);
  if (offCache.has(key)) return offCache.get(key)!;
  let off: number | null = null;
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p: Record<string, string> = {};
    f.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
    const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!);
    /* to the minute: offsets are whole minutes, and the seconds field has already thrown away the
       sub-second part of ms */
    off = Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000) / 60;
    if (!isFinite(off) || Math.abs(off) > 16) off = null;
  } catch { off = null; }
  offCache.set(key, off);
  return off;
}

/* Does this browser know the zone well enough to be believed? An engine with a stub Intl returns UTC for
   everything, and silently showing UTC as if it were local time is worse than admitting there is no zone. */
export function zoneKnown(zone: string | null | undefined): boolean {
  if (!zone) return false;
  const jan = offsetAt(zone, Date.UTC(2020, 0, 15)), jul = offsetAt(zone, Date.UTC(2020, 6, 15));
  if (jan === null || jul === null) return false;
  return !(zone !== 'UTC' && zone !== 'Etc/UTC' && jan === 0 && jul === 0 && /\//.test(zone)
    && !/^(Africa\/Abidjan|Africa\/Accra|Atlantic\/Reykjavik|Europe\/London|Europe\/Dublin|Europe\/Lisbon)/.test(zone));
}

/** One place, flattened to exactly what the observer needs. `where` is the region and country, for telling two
 *  places of one name apart. */
export interface Place {
  name: string; where: string; lat: number; lon: number; altKm: number; zone: string | null;
  population?: number; id?: number; accuracyM?: number;
}

interface GeocodeResult {
  name?: string; admin1?: string; country?: string; latitude: number | string; longitude: number | string;
  elevation?: number; timezone?: string; population?: number; id?: number;
}

/** One search result, flattened. */
export function toSite(r: GeocodeResult): Place {
  /* Tokyo is in Tokyo, and printing that under the word Tokyo tells the reader nothing while costing them a
     line. The region is only worth naming when it is not the place itself. */
  const region = (r.admin1 && r.admin1 !== r.name) ? r.admin1 : null;
  const where = [region, r.country].filter(Boolean).join(', ');
  return {
    name: String(r.name || '').slice(0, 24),
    where,
    lat: +r.latitude,
    lon: +r.longitude,
    /* Open-Meteo gives ground elevation in metres; the observer is in km, and a person standing on it is about
       another two metres up, which is below the resolution of anything here and is left out. */
    altKm: isFinite(r.elevation as number) ? Math.round(+r.elevation!) / 1000 : 0,
    zone: r.timezone || null,
    population: r.population || 0,
    id: r.id
  };
}

/** Rejects on a dead network so the caller can say so rather than showing an empty list, which reads as
 *  "no such place". */
export function search(q: string, count = 6, signal?: AbortSignal, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<Place[]> {
  q = String(q || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  const url = GEOCODE + '?name=' + encodeURIComponent(q) + '&count=' + (count || 6) + '&language=en&format=json';
  return fetchFn(url, { signal }).then(r => {
    if (!r.ok) throw new Error('search unavailable (' + r.status + ')');
    return r.json();
  }).then((j: { results?: GeocodeResult[] }) => (j.results || []).map(toSite));
}

/** Where this device thinks it is. The browser gives coordinates and an accuracy, never a name or a zone - so
 *  the name is the coordinates and the zone is the one the browser itself is set to, which for the device you
 *  are holding is the right answer and needs no request. */
/** What the observer is called when the device itself said where it is. */
export const DEVICE_SITE = 'My location';

export function here(): Promise<Place> {
  return new Promise((res, rej) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return rej(new Error('this browser has no location service'));
    navigator.geolocation.getCurrentPosition(p => {
      const c = p.coords;
      let zone: string | null = null;
      try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* no Intl */ }
      res({
        name: DEVICE_SITE,
        where: c.accuracy ? '±' + Math.round(c.accuracy) + ' m' : '',
        lat: c.latitude, lon: c.longitude,
        altKm: isFinite(c.altitude as number) && c.altitude !== null ? c.altitude / 1000 : 0,
        zone: zoneKnown(zone) ? zone : null,
        accuracyM: c.accuracy
      });
    }, e => {
      /* The refusal is the common case and deserves its own words: the browser reports it identically to a
         genuine failure. */
      rej(new Error(e && e.code === 1 ? 'location permission was declined' : 'this device could not report a location'));
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
}

/* ---- the site's own offset, at an instant ---------------------------------------------------------------
   The offset at a given instant, rather than one number for all time. A site picked by name carries a real
   IANA zone, and a zone that keeps summer time has two answers - which one applies depends on the day of the
   pass, and a 7-day window can straddle the change. A site typed in as coordinates has no discoverable zone, so
   it keeps the editable number it was given, which is site.tz. `tz` is that number; tzAt is the truth. Where
   they differ, tzAt wins. */
export function tzAt(site: Pick<Site, 'tz' | 'zone'>, ms: number): number {
  if (site.zone) {
    const o = offsetAt(site.zone, ms);
    if (o !== null) return o;
  }
  return site.tz;
}

/** UTC+7, UTC−3.5: the label goes with the instant it labels. Every pass time used to be converted at its own
 *  offset and then captioned with the offset at the clock, so across a summer-time change a 7-day window
 *  printed 03:14:51Z as "03:14:51 UTC+1" - the right time under the wrong name. */
export const tzLabelAt = (site: Pick<Site, 'tz' | 'zone'>, ms: number): string => tzLabel(tzAt(site, ms));

/* ---- the window start, typed and shown in the observer's time -------------------------------------------------
   Moved from toSiteInput / fromSiteInput in legacy/index.html (main@4eadd7a), lines 11309-11321. The window start is
   typed and shown in the observer's time, with its offset printed beside the field. It used to be the browser's own
   zone, said nowhere but in the aria-label, while every other local time on the page is the observer's: with the
   browser in London the field read 08:00 for a window opening at 07:00Z - 14:00 in Bangkok - and typing 14:00 opened it
   at 13:00Z, which is 14:00 nowhere the page shows. A datetime-local value carries no zone of its own, so both
   directions are done here. */
export function toSiteInput(site: Pick<Site, 'tz' | 'zone'>, ms: number): string {
  return new Date(ms + tzAt(site, ms) * 3600000).toISOString().slice(0, 16);
}
export function fromSiteInput(site: Pick<Site, 'tz' | 'zone'>, v: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  if (!m) return NaN;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  /* The offset belongs to the instant being solved for. Taken first at the wall time read as UTC, then again at that
     first answer, which settles it on whichever side of a summer-time change the instant falls. */
  const t = wall - tzAt(site, wall) * 3600000;
  return wall - tzAt(site, t) * 3600000;
}
