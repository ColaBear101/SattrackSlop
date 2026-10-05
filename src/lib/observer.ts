import type { Site } from './types';

/* Where the observer is, and how that is remembered. The storage keys and record shapes are the old page's:
   a visitor who saved a site there finds it here. Pure functions over an injected Storage-like object, so
   the rules (what is valid, what is a duplicate, how many are kept) are testable without a browser. */

export const SITE_KEY = 'obs-site';
export const RECENT_KEY = 'obs-recent';
export const RECENT_MAX = 6;

/** The minimal Storage surface used here. */
export interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** A site as the page saved it: the engine's Site plus the place's region label. */
export interface SavedSite extends Site { zone?: string; where?: string }

export function siteValid(o: unknown): o is SavedSite {
  const s = o as Partial<SavedSite> | null | undefined;
  return !!s && Number.isFinite(+(s.lat as number)) && Number.isFinite(+(s.lon as number)) &&
    s.lat !== null && s.lon !== null &&
    Math.abs(+(s.lat as number)) <= 90 && Math.abs(+(s.lon as number)) <= 180;
}

/** The old applySite, as a pure function: validate, clamp the name, default the offset to solar time. */
export function normalizeSite(o: Partial<SavedSite>, zoneOffsetHours: number | null = null): Site | null {
  if (!siteValid(o)) return null;
  const site: Site = {
    lat: +o.lat!, lon: +o.lon!,
    altKm: Number.isFinite(+(o.altKm as number)) && o.altKm !== undefined && o.altKm !== null ? +o.altKm : 0,
    name: String(o.name || '').trim().slice(0, 24) || 'Observer',
    /* An arbitrary lat/lon has no discoverable timezone: the nearest hour of solar time is the honest
       default, and the field stays editable. A zone-derived offset wins when the caller has one. */
    tz: Number.isFinite(+(o.tz as number)) && o.tz !== undefined && o.tz !== null
      ? +o.tz : zoneOffsetHours !== null ? zoneOffsetHours : Math.round(+o.lon! / 15)
  };
  if (o.zone) site.zone = o.zone;
  return site;
}

export function loadSite(store: KeyValue): Site | null {
  try {
    const j = JSON.parse(store.getItem(SITE_KEY) || 'null');
    return siteValid(j) ? normalizeSite(j) : null;
  } catch { return null; }
}

export function saveSite(store: KeyValue, site: Site, where = ''): void {
  try {
    store.setItem(SITE_KEY, JSON.stringify({
      lat: site.lat, lon: site.lon, altKm: site.altKm, name: site.name, tz: site.tz,
      zone: site.zone ?? null, where
    }));
  } catch { /* storage may be unavailable or full; the site still applies for this visit */ }
}

/** Keyed on position to three decimals - about a hundred metres - so picking a town twice does not fill the list. */
export const siteKey = (s: Pick<Site, 'lat' | 'lon'>): string => (+s.lat).toFixed(3) + ',' + (+s.lon).toFixed(3);

export function loadRecents(store: KeyValue): SavedSite[] {
  try {
    const a = JSON.parse(store.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter(siteValid).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export function remember(store: KeyValue, site: Site, where = ''): SavedSite[] {
  const me: SavedSite = { name: site.name, where, lat: site.lat, lon: site.lon, altKm: site.altKm, tz: site.tz, zone: site.zone };
  const list = loadRecents(store).filter(s => siteKey(s) !== siteKey(me));
  list.unshift(me);
  const kept = list.slice(0, RECENT_MAX);
  try { store.setItem(RECENT_KEY, JSON.stringify(kept)); } catch { /* as above */ }
  return kept;
}

/** 13.75° N / 100.52° E, the old latStr / lonStr. */
export const latStr = (v: number): string => Math.abs(v).toFixed(2) + '°' + (Math.abs(v) < 0.005 ? '' : ' ' + (v > 0 ? 'N' : 'S'));
export const lonStr = (v: number): string => Math.abs(v).toFixed(2) + '° ' + (v >= 0 ? 'E' : 'W');

/** UTC+7, UTC−3.5: the label that follows the site. A true minus sign, as the old page printed. */
export const tzLabel = (tz: number): string =>
  'UTC' + (tz < 0 ? '−' : '+') + (Math.abs(tz) % 1 ? Math.abs(tz).toFixed(1) : String(Math.abs(tz)));
