/* A circuit breaker for "is there an API at all". Until a host is chosen, the production deploy answers /api/*
 * with a plain-text 404; asking it again on every selection would put a failed request in front of every
 * element-set check for nothing. After a failure the API is left alone for ten minutes, then probed once more
 * (a failed probe trips it again). The clock comes in as an argument.
 */
export const BREAKER_MS = 10 * 60 * 1000;

export interface Breaker {
  /** true while the API should not be asked */
  isOpen(): boolean;
  /** the API did not answer as itself: leave it alone for a while */
  trip(): void;
  /** forget the failure (a test, or a settings change) */
  reset(): void;
}

export function createBreaker(now: () => number, ms: number = BREAKER_MS): Breaker {
  let until = 0;
  return {
    isOpen: () => now() < until,
    trip: () => { until = now() + ms; },
    reset: () => { until = 0; }
  };
}
