import { describe, expect, it } from 'vitest';
import { CELESTRAK_BASE, ConfigError, MIRROR_BASE, REPO_URL, loadConfig } from '../../server/config.js';

describe('loadConfig', () => {
  it('has the defaults the brief names', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 3001, host: '127.0.0.1', serveStatic: false, nodeEnv: '', production: false,
      tleTtlMs: 10_800_000, historyTtlMs: 43_200_000, tleTimeoutMs: 8000, historyTimeoutMs: 70_000,
      rateTlePerMin: 60, rateHistoryPerMin: 10, trustProxy: false, corsOrigins: [],
      celestrakBase: CELESTRAK_BASE, mirrorBase: MIRROR_BASE, tleCacheMax: 512, historyCacheMax: 48,
      tleMaxBytes: 64 * 1024, historyMaxBytes: 2 * 1024 * 1024, contact: REPO_URL, version: '0.0.0'
    });
    expect(c.userAgent).toBe('sattrackslop-api/0.0.0 (+' + REPO_URL + ')');
  });

  it('reads every variable', () => {
    const c = loadConfig({
      PORT: '8080', HOST: '0.0.0.0', SERVE_STATIC: '1', NODE_ENV: 'production', GT_CONTACT: 'ops@example.org', GT_VERSION: '2.3.4',
      TLE_TTL_S: '60', HISTORY_TTL_S: '120', TLE_TIMEOUT_MS: '500', HISTORY_TIMEOUT_MS: '900',
      RATE_TLE_PER_MIN: '5', RATE_HISTORY_PER_MIN: '2', TRUST_PROXY: 'true', CORS_ORIGINS: 'https://a.example, https://b.example/'
    });
    expect(c).toMatchObject({
      port: 8080, host: '0.0.0.0', serveStatic: true, production: true, contact: 'ops@example.org', version: '2.3.4',
      tleTtlMs: 60_000, historyTtlMs: 120_000, tleTimeoutMs: 500, historyTimeoutMs: 900,
      rateTlePerMin: 5, rateHistoryPerMin: 2, trustProxy: true, corsOrigins: ['https://a.example', 'https://b.example']
    });
    expect(c.userAgent).toBe('sattrackslop-api/2.3.4 (+ops@example.org)');
  });

  it('treats an empty variable as unset', () => {
    expect(loadConfig({ PORT: '', TLE_TTL_S: '  ', CORS_ORIGINS: '', GT_CONTACT: '' }).tleTtlMs).toBe(10_800_000);
  });

  it('refuses a bad value and names every bad variable at once, not a silent default', () => {
    const run = () => loadConfig({ PORT: 'abc', TLE_TTL_S: '-5', TLE_TIMEOUT_MS: '0', RATE_TLE_PER_MIN: '1.5', TRUST_PROXY: 'maybe',
      CORS_ORIGINS: 'not a url', PORT_UNRELATED: 'x' });
    expect(run).toThrow(ConfigError);
    try { run(); } catch (e) {
      const p = (e as ConfigError).problems.join('\n');
      for (const k of ['PORT', 'TLE_TTL_S', 'TLE_TIMEOUT_MS', 'RATE_TLE_PER_MIN', 'TRUST_PROXY', 'CORS_ORIGINS']) expect(p).toContain(k);
      expect((e as ConfigError).problems).toHaveLength(6);
    }
  });

  it('accepts 0 for the rate limits (off) and the TTLs, and a port of 0 (any free port)', () => {
    const c = loadConfig({ RATE_TLE_PER_MIN: '0', RATE_HISTORY_PER_MIN: '0', TLE_TTL_S: '0', PORT: '0' });
    expect([c.rateTlePerMin, c.rateHistoryPerMin, c.tleTtlMs, c.port]).toEqual([0, 0, 0, 0]);
  });

  describe('upstream overrides are for development only', () => {
    const env = { UPSTREAM_CELESTRAK: 'http://127.0.0.1:9999/some/path', UPSTREAM_MIRROR: 'http://localhost:8888' };

    it('are honoured when NODE_ENV is not "production" (unset, development, test), reduced to an origin', () => {
      for (const nodeEnv of [undefined, 'development', 'test']) {
        const c = loadConfig({ ...env, NODE_ENV: nodeEnv });
        expect(c.celestrakBase, String(nodeEnv)).toBe('http://127.0.0.1:9999');
        expect(c.mirrorBase, String(nodeEnv)).toBe('http://localhost:8888');
      }
    });

    it('are ignored in production, whatever the environment says - the hosts are constants there', () => {
      const c = loadConfig({ ...env, NODE_ENV: 'production' });
      expect(c.celestrakBase).toBe(CELESTRAK_BASE);
      expect(c.mirrorBase).toBe(MIRROR_BASE);
    });

    it('are ignored in production even when they are garbage (nothing to be wrong about)', () => {
      expect(loadConfig({ UPSTREAM_CELESTRAK: 'file:///etc/passwd', NODE_ENV: 'production' }).celestrakBase).toBe(CELESTRAK_BASE);
    });

    it('must be http(s) URLs outside production', () => {
      expect(() => loadConfig({ UPSTREAM_CELESTRAK: 'file:///etc/passwd' })).toThrow(/UPSTREAM_CELESTRAK/);
      expect(() => loadConfig({ UPSTREAM_MIRROR: 'nonsense' })).toThrow(/UPSTREAM_MIRROR/);
    });
  });

  it('keeps what goes into the User-Agent header to printable ASCII: no CR/LF to start another header', () => {
    const c = loadConfig({ GT_CONTACT: 'me@example.org\r\nx-evil: 1', GT_VERSION: '1.0.0\r\nx: y' });
    expect(c.userAgent).not.toMatch(/[\r\n]/);
    expect(c.contact).toBe('me@example.orgx-evil: 1');
    expect(c.version).toBe('1.0.0xy');
  });

  it('allows "*" or a list for CORS_ORIGINS, and refuses a path or a bare word', () => {
    expect(loadConfig({ CORS_ORIGINS: '*' }).corsOrigins).toEqual(['*']);
    expect(() => loadConfig({ CORS_ORIGINS: 'https://a.example/path' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ CORS_ORIGINS: 'example.com' })).toThrow(/CORS_ORIGINS/);
  });

  it('is frozen: nothing downstream can move a limit', () => {
    const c = loadConfig({});
    expect(Object.isFrozen(c)).toBe(true);
  });
});
