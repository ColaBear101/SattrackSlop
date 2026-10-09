/* The environment, parsed once into a typed config. server/ has no `process`: serve.ts reads
 * process.env and hands it to createApi(env), and a test hands in a plain object. A bad value is a start-up
 * error naming every bad variable, not a silent fallback to a default that nobody chose.
 *
 *   PORT                    3001           listen port (serve.ts)
 *   HOST                    127.0.0.1      listen address (serve.ts)
 *   SERVE_STATIC            off            "1" serves dist/ from serve.ts as well
 *   NODE_ENV                (unset)        "production" turns the dev-only things off, see UPSTREAM_*
 *   GT_CONTACT              repo URL       goes into the User-Agent so CelesTrak can reach whoever runs this
 *   GT_VERSION              0.0.0          the version /api/health reports (serve.ts reads package.json)
 *   TLE_TTL_S               10800 (3 h)    how long an element set is served from memory, from the instant it was fetched
 *   HISTORY_TTL_S           43200 (12 h)   the same for a decay history
 *   TLE_TIMEOUT_MS          8000           per upstream source
 *   HISTORY_TIMEOUT_MS      70000          the whole history request (CelesTrak can take over a minute)
 *   RATE_TLE_PER_MIN        60             per client, per route; 0 turns the limiter off
 *   RATE_HISTORY_PER_MIN    10
 *   TRUST_PROXY             off            "1": the right-most x-forwarded-for entry is the client; otherwise one shared bucket
 *   CORS_ORIGINS            (none)         comma-separated origins, or "*"; empty sends no CORS headers
 *   UPSTREAM_CELESTRAK      https://celestrak.org            only honoured when NODE_ENV is not "production"
 *   UPSTREAM_MIRROR         https://tle.ivanstanojevic.me    only honoured when NODE_ENV is not "production"
 */

export type Env = Readonly<Record<string, string | undefined>>;

/** The two upstream hosts. Constants: nothing a request says can change them. */
export const CELESTRAK_BASE = 'https://celestrak.org';
export const MIRROR_BASE = 'https://tle.ivanstanojevic.me';
export const REPO_URL = 'https://github.com/ColaBear101/SattrackSlop';

export interface Config {
  port: number;
  host: string;
  serveStatic: boolean;
  nodeEnv: string;
  production: boolean;
  contact: string;
  version: string;
  userAgent: string;
  tleTtlMs: number;
  historyTtlMs: number;
  tleTimeoutMs: number;
  historyTimeoutMs: number;
  rateTlePerMin: number;
  rateHistoryPerMin: number;
  trustProxy: boolean;
  corsOrigins: readonly string[];
  celestrakBase: string;
  mirrorBase: string;
  /** in-memory LRU sizes */
  tleCacheMax: number;
  historyCacheMax: number;
  /** streamed body-size caps, in bytes */
  tleMaxBytes: number;
  historyMaxBytes: number;
}

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: string[]) {
    super('invalid configuration: ' + problems.join('; '));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off', '']);

export function loadConfig(env: Env = {}): Config {
  const problems: string[] = [];
  const raw = (k: string): string | undefined => {
    const v = env[k];
    return v === undefined || v.trim() === '' ? undefined : v.trim();
  };
  const int = (k: string, def: number, min: number, max: number): number => {
    const v = raw(k);
    if (v === undefined) return def;
    const n = Number(v);
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < min || n > max) {
      problems.push(k + ' must be a whole number from ' + min + ' to ' + max + ', not "' + v + '"');
      return def;
    }
    return n;
  };
  const bool = (k: string): boolean => {
    const v = (env[k] ?? '').trim().toLowerCase();
    if (TRUE.has(v)) return true;
    if (FALSE.has(v)) return false;
    problems.push(k + ' must be 1 or 0, not "' + v + '"');
    return false;
  };
  const origin = (k: string, def: string, allowed: boolean): string => {
    const v = raw(k);
    if (v === undefined || !allowed) return def;          // outside development the constant stands, whatever the environment says
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
      return u.origin;
    } catch {
      problems.push(k + ' must be an http(s) URL, not "' + v + '"');
      return def;
    }
  };

  const nodeEnv = raw('NODE_ENV') ?? '';
  const production = nodeEnv === 'production';
  const version = (raw('GT_VERSION') ?? '0.0.0').replace(/[^0-9A-Za-z._+-]/g, '').slice(0, 40) || '0.0.0';
  // a header value: printable ASCII only (no CR/LF to smuggle another header in), and not a novel
  const contact = (raw('GT_CONTACT') ?? REPO_URL).replace(/[^\x20-\x7E]/g, '').slice(0, 200).trim() || REPO_URL;

  const corsOrigins: string[] = [];
  for (const o of (raw('CORS_ORIGINS') ?? '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)) {
    if (o === '*') { corsOrigins.push(o); continue; }
    try {
      if (new URL(o).origin !== o) throw new Error('not an origin');
      corsOrigins.push(o);
    } catch {
      problems.push('CORS_ORIGINS has "' + o + '", which is not an origin such as https://example.com');
    }
  }

  const cfg: Config = {
    port: int('PORT', 3001, 0, 65535),
    host: raw('HOST') ?? '127.0.0.1',
    serveStatic: bool('SERVE_STATIC'),
    nodeEnv,
    production,
    contact,
    version,
    userAgent: 'sattrackslop-api/' + version + ' (+' + contact + ')',
    tleTtlMs: int('TLE_TTL_S', 3 * 3600, 0, 30 * 86400) * 1000,
    historyTtlMs: int('HISTORY_TTL_S', 12 * 3600, 0, 30 * 86400) * 1000,
    tleTimeoutMs: int('TLE_TIMEOUT_MS', 8000, 1, 120_000),
    historyTimeoutMs: int('HISTORY_TIMEOUT_MS', 70_000, 1, 300_000),
    rateTlePerMin: int('RATE_TLE_PER_MIN', 60, 0, 1_000_000),
    rateHistoryPerMin: int('RATE_HISTORY_PER_MIN', 10, 0, 1_000_000),
    trustProxy: bool('TRUST_PROXY'),
    corsOrigins,
    celestrakBase: origin('UPSTREAM_CELESTRAK', CELESTRAK_BASE, !production),
    mirrorBase: origin('UPSTREAM_MIRROR', MIRROR_BASE, !production),
    tleCacheMax: 512,
    historyCacheMax: 48,
    tleMaxBytes: 64 * 1024,
    historyMaxBytes: 2 * 1024 * 1024
  };
  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(cfg);
}
