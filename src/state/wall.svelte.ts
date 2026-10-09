/* The real time of day, for the things that are about NOW and not about the simulated instant: how old an element
 * set is, when it was last checked, whether the clock on screen is the present.
 *
 * The simulation clock (clock.svelte.ts) can be scrubbed, sped up or sit a day back; "epoch 3.2 days old" and
 * "checked 4 min ago" must keep meaning the present while it does. So this is a separate, coarse clock: it is
 * republished every 30 seconds and when the tab comes back to the front, which is how often a line that reads
 * "checked 4 min ago" needs to change. */

class Wall {
  now = $state(Date.now());
  touch(): void { this.now = Date.now(); }
}

export const wall = new Wall();
