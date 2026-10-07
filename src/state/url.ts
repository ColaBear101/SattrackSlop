import type { StageTab } from './prefs.svelte';

/* The address bar as part of the state: a link carries the spacecraft, the window and the site, so what one
   reader saw is what the next reader opens. `?tle=embedded` (the assignment snapshot) is left exactly as it is.
   Everything here is optional and validated; a hand-edited URL can only ever select among valid states. */

export interface UrlState {
  sat?: string;                          // a NORAD id, as in a TLE
  span?: number;                         // window length in hours
  site?: { lat: number; lon: number };
  tab?: StageTab;
}

export const SPANS = [6, 12, 24, 72, 168] as const;

export function readUrl(search = location.search): UrlState {
  const p = new URLSearchParams(search);
  const out: UrlState = {};
  const sat = p.get('sat');
  if (sat && /^\d{1,5}$/.test(sat)) out.sat = String(Number(sat)).padStart(5, '0');
  const span = Number(p.get('span'));
  if ((SPANS as readonly number[]).includes(span)) out.span = span;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(p.get('site') || '');
  if (m) {
    const lat = Number(m[1]), lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.site = { lat, lon };
  }
  const tab = p.get('tab');
  if (tab === 'globe' || tab === 'map') out.tab = tab;
  return out;
}

/** Update the address bar without adding history entries. Defaults are omitted so the plain URL stays plain. */
export function writeUrl(s: UrlState, defaults: { span: number; atHome: boolean }): void {
  const p = new URLSearchParams(location.search);
  const set = (k: string, v: string | null) => (v === null ? p.delete(k) : p.set(k, v));
  set('sat', s.sat ?? null);
  set('span', s.span !== undefined && s.span !== defaults.span ? String(s.span) : null);
  set('site', s.site && !defaults.atHome ? s.site.lat.toFixed(4) + ',' + s.site.lon.toFixed(4) : null);
  set('tab', s.tab ?? null);
  const q = p.toString();
  const url = location.pathname + (q ? '?' + q : '') + location.hash;
  if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url);   // the state is kept: the AR view's own entry lives in it
}
