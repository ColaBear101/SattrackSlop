import type { ExportCtx } from '../lib/export';
import { tleSourceText } from '../lib/export/source';
import type { Analysis, Tle } from '../lib/types';
import { app } from './app.svelte';
import { doppler } from './doppler.svelte';
import { live } from './live.svelte';
import { getEngine, getOptics, MASK } from './engine';

/* What the export writers are handed for an analysis on screen: the observer, the mask, the downlink tuned to, the engine and the optics, and
   where the element set came from, as the CSV states it. The rail's two export buttons and the one-pass calendar button
   (CHANGES-FROM-LEGACY.md, L57) take it from here, so that a file says the same whichever button wrote it. */

function cached(satnum: string) {
  try { return JSON.parse(localStorage.getItem('tle:' + satnum) || 'null'); } catch { return null; }
}

export function exportCtx(D: Analysis, entry: Tle & { custom?: boolean }): ExportCtx {
  return {
    D, OBS: app.site, MASK, dopHz: doppler.hz, eng: getEngine(), optics: getOptics(),
    sourceText: tleSourceText({
      custom: !!entry.custom, prov: live.provOf(entry.satnum), embedded: app.isEmbedded(entry),
      l1: entry.l1, l2: entry.l2, cached: cached(entry.satnum)
    }),
    stampAt: new Date()
  };
}
