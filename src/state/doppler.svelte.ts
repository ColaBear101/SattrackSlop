import { txFor } from '../lib/analysis/doppler';
import { loadTransmitters, type Downlink, type TransmitterTable } from '../lib/data/transmitters';

/* The downlink the Doppler is computed for. The table of published downlinks is its own chunk, fetched the first
 * time it is wanted; the frequency is the reader's to change, and the page must never throw away one that was typed.
 *
 * From `dopHz` / `dopSat` / `dopReset` in legacy/index.html (main@4eadd7a), lines 9983-10000. */

class DopplerState {
  /** The frequency in use, Hz, or null for none (a spacecraft with no published downlink and nothing typed). */
  hz = $state<number | null>(null);
  table = $state.raw<TransmitterTable | null>(null);
  /** the spacecraft the default was last chosen for: a repaint must not undo a frequency the reader typed */
  private sat: string | null = null;
  private loading: Promise<void> | null = null;

  /** Fetch the table, once. Safe to call every time a spacecraft is loaded. */
  ensure(): Promise<void> {
    this.loading ??= loadTransmitters().then(t => { this.table = t; }).catch(() => { this.loading = null; });
    return this.loading;
  }

  list(entry: { satnum: string; custom?: boolean; dlHz?: number } | null | undefined): Downlink[] {
    return txFor(entry, this.table);
  }

  /** Re-pick the default when the spacecraft changes, but never on a mere repaint - that would throw away a
   *  frequency the user had typed. Waits for the table: choosing "none" before it arrives would be a choice. */
  reset(entry: { satnum: string; custom?: boolean; dlHz?: number } | null | undefined): void {
    if (!entry || !this.table || this.sat === entry.satnum) return;
    this.sat = entry.satnum;
    const l = this.list(entry);
    this.hz = l.length ? l[0]!.hz : null;
  }

  /** The reader tuned it: a downlink from the list, or MHz typed in (null or not a number clears it). */
  setHz(hz: number | null): void { this.hz = hz; }
}

export const doppler = new DopplerState();
