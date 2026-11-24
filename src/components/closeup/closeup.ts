/* The close-up's chunk (CHANGES-FROM-LEGACY.md, L72), fetched the first time the Close-up camera button is pressed and never before:
 * the pass that draws the spacecraft (scene/closeup-pass.ts, with three's glTF loader), the card over the globe that says which
 * model it is and whose, the words, and how the reader flies each model (state/attitude.svelte.ts, L77: the card flies a model as it
 * was set at once, and says so; the panel that sets it is the `flight` chunk). globe-state imports this file only by import(), so the
 * entry carries the button and nothing else of it.
 *
 * The globe's controller and the page's state are handed in rather than imported. A module the entry and a lazy chunk both import
 * is split by the bundler into a chunk of its own, which the first screen then fetches as one more file (the `rich` chunk is one);
 * handed in, they stay in the entry and this chunk imports nothing of it. */
import { mount } from 'svelte';
import type { Globe } from '../../scene';
import CloseupCard from './CloseupCard.svelte';
import { makeCraft } from '../../scene/closeup-pass';

/** What the close-up reads and calls on the globe's controller (components/stage/globe-state.svelte.ts). */
export interface GlobeHost {
  readonly scene: Globe | null;
  readonly mode: string;
  readonly surface: string;
  setSurface(key: string): void;
  wake(): void;
}
/** ...and on the page's state (state/app.svelte.ts): the spacecraft on screen. */
export interface AppHost {
  readonly analysis: { entry: { name: string; satnum: string; custom?: boolean } } | null;
}

let attached = false;

/** Give the scene its craft and put the card over the globe, once. */
export function attach(globe: GlobeHost, app: AppHost): void {
  /* the box the globe is drawn in is the canvas's own (Globe.svelte's .viewport): found from the scene, not asked of the entry */
  const g = globe.scene, host = g?.raw.renderer.domElement.parentElement as HTMLElement | null | undefined;
  if (attached || !g || !host) return;
  attached = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const lean = !!conn && (conn.saveData === true || /2g|3g/.test(conn.effectiveType || ''));
  const craft = makeCraft({ renderer: g.raw.renderer, wake: () => globe.wake(), lean });
  g.orbit3d.setCraft(craft);
  mount(CloseupCard, { target: host, props: { craft, globe, app, host } });
}
