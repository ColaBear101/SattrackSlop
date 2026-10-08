import { makeEngine as makeRaw } from './engine';
import type { Engine, EngineEnv } from '../types';

/** The analysis engine for one body, observer and elevation mask. The numerical core behind it is moved
 *  unchanged from the old page; this is its typed doorway. */
export function makeEngine(env: EngineEnv): Engine {
  return makeRaw(env) as unknown as Engine;
}
