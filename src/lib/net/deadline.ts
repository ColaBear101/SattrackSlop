/* Give an async call a deadline that holds even when the call ignores its AbortSignal: the signal is aborted and
 * the deadline is also raced. Never throws; says only whether there is a value. */

export type Timed<T> = { ok: true; value: T } | { ok: false; timedOut: boolean };

export async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<Timed<T>> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const LATE = Symbol('late');
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(LATE); }, ms); });
  const work = (async () => run(ctl.signal))();       // a synchronous throw becomes a rejection too
  work.catch(() => {});                       // if the deadline wins, what the call does afterwards is nobody's business
  try {
    return { ok: true, value: await Promise.race([work, late]) };
  } catch (e) {
    return { ok: false, timedOut: e === LATE };
  } finally {
    clearTimeout(timer);
  }
}
