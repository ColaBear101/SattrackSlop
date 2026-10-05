/* The two small structures the services are made of: a least-recently-used map, and a one-flight-per-key
 * gate. No timers, no clock: the services pass the time in, so a test controls it.
 */

/** A Map that forgets the least recently used key once it holds more than `max`. */
export class Lru<V> {
  readonly #max: number;
  readonly #map = new Map<string, V>();
  constructor(max: number) {
    if (!(max >= 1)) throw new RangeError('Lru needs room for at least one entry');
    this.#max = Math.floor(max);
  }
  get size(): number { return this.#map.size; }
  /** The value, marked as the most recently used. */
  get(key: string): V | undefined {
    const v = this.#map.get(key);
    if (v !== undefined) { this.#map.delete(key); this.#map.set(key, v); }
    return v;
  }
  set(key: string, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next();
      if (oldest.done) break;
      this.#map.delete(oldest.value);
    }
  }
  clear(): void { this.#map.clear(); }
}

/** A record is fresh while less than `ttlMs` has passed since `at`, the instant its upstream request was made
 *  (not the instant the answer came back, and not the instant it was served). */
export function isFresh(at: number, ttlMs: number, now: number): boolean {
  return now - at < ttlMs;
}

/** Concurrent callers for one key share one run of `work`: the first starts it, the rest wait for it. */
export class Flights<V> {
  readonly #running = new Map<string, Promise<V>>();
  /** `shared` is false for the caller that started the work and true for every caller that joined it. */
  run(key: string, work: () => Promise<V>): { promise: Promise<V>; shared: boolean } {
    const joined = this.#running.get(key);
    if (joined) return { promise: joined, shared: true };
    const promise = work().finally(() => { this.#running.delete(key); });
    this.#running.set(key, promise);
    return { promise, shared: false };
  }
  get active(): number { return this.#running.size; }
}
