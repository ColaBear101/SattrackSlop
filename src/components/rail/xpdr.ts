import { mount, unmount } from 'svelte';
import type { Tune } from '../../lib/analysis/tune';
import TransponderPanel from './TransponderPanel.svelte';

/* The transponder calculator's chunk (CHANGES-FROM-LEGACY.md, L63): asked for by DopplerLive.svelte the first time "Uplink and transponders"
   is opened, never at boot, with the panel, its store, its words and its arithmetic. The panel is mounted into the disclosure rather than
   rendered by DopplerLive as a component, which costs the entry chunk less (an {#if} with a component in it, or an {#await}, carries more of
   Svelte's machinery there). One panel per disclosure: a disclosure that is opened again, or toggled while this chunk was on its way, keeps
   the one it has; the panel itself takes the disclosure's state at that moment, so one opened and shut again before the chunk came stays idle.
   A panel whose disclosure has left the page unmounts itself through the function it is handed. */

/** The live line's instant, as DopplerLive.svelte works it out on clock.tick: now (the wall clock) or the clock's, and the figures there,
 *  whose range rate the panel uses, so that it asks the engine for nothing of its own. */
export interface LiveLine { live: boolean; ms: number; r: Tune | null }

const panels = new WeakMap<HTMLDetailsElement, ReturnType<typeof mount>>();

export function open(details: HTMLDetailsElement, line: () => LiveLine | null): void {
  if (panels.has(details) || !details.isConnected) return;
  const done = (): void => {
    const p = panels.get(details);
    panels.delete(details);
    if (p) void unmount(p);
  };
  panels.set(details, mount(TransponderPanel, { target: details, props: { details, line, done } }));
}
