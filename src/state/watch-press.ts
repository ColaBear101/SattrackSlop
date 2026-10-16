import { WATCH_MAX } from '../lib/catalogue/watch';
import { toggleWatch } from '../lib/catalogue/watch-toggle';
import { watchFull } from '../lib/text/watch-full';
import { app } from './app.svelte';
import { localStore } from './storage';
import { WATCH_KEY, watch } from './watch.svelte';

/* A press of the watchlist's star (CHANGES-FROM-LEGACY.md, L60): a chunk of its own, asked for at the first press, so that the entry
   carries only the reading of the list. The one place the list is changed and written: put on or taken off, and the record
   written, or removed with the last one, so that an empty list leaves nothing stored. With the list full nothing is put on, and
   the note under the bar, where a refused load is said, says why; a press that goes through takes that sentence away again and
   leaves any other there. Where the browser refuses storage the list still holds for the visit. */
let said = '';

/** for the spacecraft that was on screen when the star was pressed */
export function press(e: { satnum: string; name: string }): void {
  const next = toggleWatch(watch.list, e.satnum);
  if (!next) { app.note = said = watchFull(WATCH_MAX, e.name); return; }
  if (said && app.note === said) app.note = '';
  if (next === watch.list) return;                // not a catalogue number: nothing to keep
  watch.list = next;
  try {
    if (next.length) localStore().setItem(WATCH_KEY, JSON.stringify(next));
    else localStore().removeItem(WATCH_KEY);
  } catch { /* private window or full storage: the list holds for this visit */ }
}
