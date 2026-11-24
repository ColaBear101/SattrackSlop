/* The "How it flies" panel's chunk (CHANGES-FROM-LEGACY.md, L77), fetched the first time its button on the close-up's card is pressed:
 * the panel and its words (lib/text/attitude.ts). The arithmetic (lib/models/attitude.ts), the reader's settings (state/attitude.svelte.ts)
 * and the card's line are the close-up's own, which the card needs at once to fly a model as it was set on an earlier visit and to say so.
 * Named for what it does rather than `attitude`, which lib/models/attitude.ts's chunk already is. */
export { default as FlightPanel } from './FlightPanel.svelte';
