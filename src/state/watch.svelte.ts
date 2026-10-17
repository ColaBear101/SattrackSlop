import { readWatch } from '../lib/catalogue/watch';
import { localStore } from './storage';

/* The reader's watchlist (CHANGES-FROM-LEGACY.md, L60): the catalogue numbers starred on the identity line, which the picker lists
   first. The record is lib/catalogue/watch.ts's, under a key of its own (not gt.prefs, which index.html reads before the first
   paint). It is read when the page starts, so that the star says at once whether the spacecraft on screen is watched; it is
   written only by a press of the star (state/watch-press.ts, a chunk of its own asked for at the first press), so a visit that
   never presses it stores nothing, and the last one taken off leaves nothing stored. Where the browser refuses storage the list
   holds for the visit.

   Another tab of the page that changes the list (or forgets what the page stored) is heard through the storage event, which the
   browser sends to every other tab of the origin, and the list is read again: the star and the picker follow it. The tab that
   wrote is not sent one, and needs none. Nothing is fetched for a watched spacecraft. */
export const WATCH_KEY = 'gt.watch';

const stored = (): string[] => {
  try { return readWatch(localStore().getItem(WATCH_KEY)); } catch { return []; }   // storage refused, or not a list: nothing stored
};

/** `list`: the starred catalogue numbers, in the order they were starred. Only watch-press.ts gives it a new one. */
export const watch = $state({ list: stored() as readonly string[] });

/* another tab wrote the list, removed it, or cleared the origin's storage (a null key) */
try { window.addEventListener('storage', e => { if (e.key === null || e.key === WATCH_KEY) watch.list = stored(); }); } catch { /* no window to hear from */ }
