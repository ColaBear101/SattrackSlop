import type { Tune } from '../../lib/analysis/tune';

/* The transponder calculator's chunk (CHANGES-FROM-LEGACY.md, L63): asked for by DopplerLive.svelte the first time "Uplink and transponders"
   is opened, never at boot, with the panel, its store, its words and its arithmetic. DopplerLive renders the panel inside the disclosure
   from then on, as a component held in its state, so the panel goes with the disclosure and nothing here mounts or unmounts it: Svelte's
   unmount() would be a function of the runtime the entry shares (index-client) asked for by this chunk alone, and a new export there
   renames that chunk's exports in every chunk that imports them, which cost the entry and the report's chunk some 300 bytes gzipped more
   than the function itself. The panel takes the disclosure's state when it is rendered, so one opened and shut again before the chunk
   came stays idle. */

/** The live line's instant, as DopplerLive.svelte works it out on clock.tick: now (the wall clock) or the clock's, and the figures there,
 *  whose range rate the panel uses, so that it asks the engine for nothing of its own. */
export interface LiveLine { live: boolean; ms: number; r: Tune | null }

export { default as Panel } from './TransponderPanel.svelte';
