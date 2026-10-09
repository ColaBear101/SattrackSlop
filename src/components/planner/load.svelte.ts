/* The orbit planner is a chunk of its own: the form, the Professor's panel, their stylesheet and the controller that drives
   them (plannerui.ts) are fetched only once something asks for it - the pill in the header, the browser being idle after
   boot, or the test surface. Nothing here imports any of that; `parts` is the one place the chunk is named. */

class PlannerLoad {
  /** Has anything asked for the planner? Once true it stays true: the markup is never torn down again, because the
   *  controller holds on to the nodes it finds by id. */
  wanted = $state(false);
  /** An arrow, so it can be handed on as a callback (onclick={planner.request}) without losing what it belongs to. */
  request = (): void => { this.wanted = true; };
}

export const planner = new PlannerLoad();

/* Resolves when the panel (in the console's planner cell) and the body-level pieces (#pl-live and the sprite) are all in the
   document, which is when the controller can look for its ids. Rejects if the chunk could not be fetched (offline, say). */
let settle!: { resolve: () => void; reject: (e: unknown) => void };
export const ready = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
ready.catch(() => { /* whoever awaits it sees the failure; this keeps an unwatched one from reaching the console twice */ });

const waiting = new Set<'panel' | 'root'>(['panel', 'root']);
export function mounted(part: 'panel' | 'root'): void {
  waiting.delete(part);
  if (!waiting.size) settle.resolve();
}

let loading: Promise<typeof import('./parts')> | null = null;
/** The planner's components, fetched once. A failed fetch is forgotten so that a later look tries again. */
export function parts(): Promise<typeof import('./parts')> {
  loading ??= import('./parts').catch(e => { loading = null; settle.reject(e); throw e; });
  return loading;
}
