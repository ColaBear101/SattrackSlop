/* What every route is built from. Made once per createApi(). */
import type { Config } from './config.js';
import type { Services } from './lib/services.js';
import type { Deps } from './lib/upstream.js';

export interface Ctx {
  config: Config;
  deps: Deps;
  services: Services;
}
