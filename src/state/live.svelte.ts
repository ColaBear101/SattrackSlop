import { SvelteMap } from 'svelte/reactivity';
import type { CatalogueEntry } from '../lib/catalogue/parse';
import { isNewerSet } from '../../shared/tle';
import { fetchLiveTle } from '../lib/net/tle-source';
import type { Prov } from '../lib/text/provenance';
import { tleCtx } from './net';

/* Keeping the element set current.
 *
 * Moved from legacy/index.html (main@4eadd7a), lines 11409-11603 (refreshTLE and its constants), with the comments
 * that explain why each rule is there. The embedded catalogue is a snapshot, and a TLE is only good for a few days
 * either side of its epoch - at 360 km with KNACKSAT-2's drag term, less. So the page fetches the CURRENT element
 * set for whichever spacecraft is on screen, rather than re-downloading all 2158: a couple of hundred bytes, for
 * the one object actually being analysed.
 *
 * What changed is where state lives. The old page rewrote the catalogue entry's l1 and l2 in place and hung the
 * record of the last check and the time of the next one on the entry (`__prov`, `__next`). Entries are immutable
 * values here: a set taken live is `sets[satnum]` (and the entry that gets analysed is the embedded record with
 * those two lines swapped in, `effective()`), the record of the last check is `prov[satnum]`, and the next check
 * is due at `next[satnum]`. All three are keyed by NORAD number, which is unique across the catalogue.
 *
 * The first source is now the page's own data-cache API where there is one (src/lib/net/tle-source.ts), and the
 * direct fetches, as the page always made them, where there is not. Both ends of that are in fetchLiveTle; this
 * file is the policy around it: when to ask, what to believe, and when to ask again.
 */

export const TLE_TTL = 3 * 3600 * 1000;     // don't ask a source twice inside three hours
export const TLE_RETRY = 5 * 60 * 1000;     // after a failure, wait this long before retry

export interface LiveSet { l1: string; l2: string; src: string; at: number }

/** What the refresh needs of the page, handed over once it exists (so this file imports nothing from it). */
export interface LiveHost {
  /** the spacecraft now on screen (the effective entry, live set included), or null */
  onScreen(): CatalogueEntry | null;
  /** Put `entry` on screen for the window and span already shown, as a trial: no note, no picker restore, and the
   *  clock where it is. `code` is SGP4's error number when it could not. */
  adopt(entry: CatalogueEntry): { ok: true } | { ok: false; code: number | null };
  sgp4Why(code: number | null | undefined): string;
  pinned: boolean;
}

class Live {
  /** element sets taken from the network, by NORAD number */
  readonly sets = new SvelteMap<string, LiveSet>();
  /** what the last check of each object said (a record is a property of the OBJECT, not of the last fetch) */
  readonly prov = new SvelteMap<string, Prov>();
  private readonly next = new Map<string, number>();
  private host: LiveHost | null = null;

  attach(host: LiveHost): void { this.host = host; }

  /** The entry as it is to be analysed: the embedded record, with the live set's lines if one was taken. */
  effective(e: CatalogueEntry): CatalogueEntry {
    const s = this.sets.get(e.satnum);
    return s ? { ...e, l1: s.l1, l2: s.l2 } : e;
  }

  provOf(satnum: string | undefined): Prov | null { return satnum ? this.prov.get(satnum) ?? null : null; }
  nextOf(satnum: string): number | undefined { return this.next.get(satnum); }
  /** Make a check due now (a test, or a "check again" button). */
  makeDue(satnum: string): void { this.next.set(satnum, 0); }

  /** Check the entry on screen for a newer element set, if one is due. Fire and forget: every outcome is recorded on
   *  the entry it belongs to, so coming back to it shows its own result; only the painting waits. */
  async check(entry: CatalogueEntry): Promise<void> {
    const host = this.host;
    if (!host) return;
    const key = entry.satnum;
    const custom = !!(entry as { custom?: boolean }).custom;
    /* No request of any kind for a planned orbit, pinned or not: CelesTrak would be asked for a number that belongs
       to nobody, and were it ever a real one the reply would be adopted as "newer" and the reader's orbit silently
       replaced by another object's. First, before the pinned branch, so no record is written for it either. */
    if (custom) return;
    /* Pinned to the embedded set on purpose; said so, rather than "checking". */
    if (host.pinned) { this.prov.set(key, { pinned: true }); return; }
    const due = this.next.get(key);
    if (due && Date.now() < due) return;
    this.next.set(key, Date.now() + TLE_RETRY);       // also guards re-entry
    const got = await fetchLiveTle(entry.satnum, tleCtx({ pinned: host.pinned, isCustom: false }));
    /* The user may have moved on mid-flight. */
    const here = host.onScreen()?.satnum === key;

    if (!got) { this.prov.set(key, { src: null }); return; }

    /* Withdrawn by the authoritative source. Said as such, and the set on screen is left alone - there is nothing
       newer to take. */
    if ('gone' in got) {
      this.prov.set(key, { gone: got.src, at: got.at });
      this.next.set(key, got.at + TLE_TTL);
      return;
    }

    /* Re-arm rather than retire. This used to set the due time to Infinity, which meant one check per object per
       SESSION - fine for a visit, wrong for a console left running, where the set on screen would quietly age past
       the point where its pass times are worth quoting. The next attempt is due exactly when the fetch's own cached
       copy goes stale, so the re-check reaches the network instead of being answered from the cache it is trying
       to refresh. */
    const shown = host.onScreen()?.satnum === key ? host.onScreen()! : this.effective(entry);
    if (got.l1 === shown.l1 && got.l2 === shown.l2) {
      this.prov.set(key, { src: got.src, at: got.at });        // snapshot was already current
      this.next.set(key, got.at + TLE_TTL);
      return;
    }
    /* Only ever move forward. A mirror can legitimately serve an element set older than the one embedded here, and
       replacing a newer TLE with an older one in the name of freshness would be exactly backwards. */
    if (!isNewerSet(got, shown)) {
      /* A mirror serving an older set will still be serving it in five minutes, so back off to the normal interval
         rather than hammering the retry. */
      this.prov.set(key, { src: null, older: got.src });
      this.next.set(key, got.at + TLE_TTL);
      return;
    }
    /* Newer, but for an object no longer on screen. Taking it now would mean swapping in a set nobody has
       propagated, so leave it in the fetch's cache and make the check due: the next visit takes it from there at
       once. */
    if (!here) { this.next.set(key, 0); return; }

    const held = this.sets.get(key);
    this.sets.set(key, { l1: got.l1, l2: got.l2, src: got.src, at: got.at });
    this.next.set(key, got.at + TLE_TTL);
    this.prov.set(key, { src: got.src, at: got.at, updated: true });

    /* The window and span have not changed, so the clock stays where the user put it; only the element set
       underneath it is new. */
    const r = host.adopt(this.effective(entry));
    if (r.ok) return;

    /* Newer, and SGP4 cannot propagate it anywhere in this window - in practice, a later set that has the object
       decayed. Adopting it used to throw out of load() with the entry already rewritten, which left the old analysis
       on screen over the new element set and made every later span change throw too. Keep the set that works, and
       pass on what the newer one says. */
    if (held) this.sets.set(key, held); else this.sets.delete(key);
    this.prov.set(key, { dead: got.src, at: got.at, code: r.code, why: host.sgp4Why(r.code) });
  }
}

export const live = new Live();
