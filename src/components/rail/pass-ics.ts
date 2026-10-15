import { getEngine } from '../../state/engine';
import { exportCtx } from '../../state/export-ctx';
import { exportPassICS } from '../../lib/export';
import { deliverFile } from '../../lib/share';
import { NO_PASS, passReentry, passShared } from '../../lib/text/pass-ics-said';
import type { Analysis } from '../../lib/types';

/* The one-pass calendar button's work (CHANGES-FROM-LEGACY.md, L57), a chunk of its own with the export writers, fetched on the first press.
   It writes the pass the reader had selected when they pressed, of the analysis that was on screen then, and hands the file over: on a phone or
   a tablet (a coarse pointer, the AR view's own test) to the share sheet where the browser takes a calendar file there, so that a calendar
   app can be picked from it; anywhere else, and where the sheet does not take it, as a download. Nothing is sent anywhere. What it says once
   it has is the answer; a share sheet the reader closed says nothing. */
export async function passToCalendar(D: Analysis, i: number): Promise<string> {
  if (D.reentry) return passReentry(D.entry.name, getEngine().REENTRY_KM);
  const f = exportPassICS(exportCtx(D, D.entry), i);
  if (!f) return NO_PASS;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const r = await deliverFile(coarse ? navigator : undefined, document, document.body, new Blob([f.text], { type: f.mime }), f.name);
  return r === 'cancelled' ? '' : r === 'shared' ? passShared(i + 1) : f.hint;
}
