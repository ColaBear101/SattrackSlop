import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { celestrakText, makeTle } from './helpers/tle.js';

/* serve.ts is the one file of the lane that no createApi() test reaches: it reads the environment, puts the app behind
   the Node adapter, and decides what is dev-only. This starts it for real (node --import tsx, no Bun) on a free port,
   against a stand-in for CelesTrak on another, so nothing here touches the internet. */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>(r => s.close(() => r()));
  return port;
}

function start(env: Record<string, string>): { child: ChildProcess; log: () => string } {
  const child = spawn(process.execPath, ['--import', 'tsx', 'serve.ts'], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let out = '';
  child.stdout!.on('data', d => { out += d; });
  child.stderr!.on('data', d => { out += d; });
  children.push(child);
  return { child, log: () => out };
}

async function waitUp(port: number): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('serve.ts did not come up on ' + port);
}

const stop = (c: ChildProcess) => new Promise<void>(res => { if (c.exitCode !== null) return res(); c.once('exit', () => res()); c.kill(); });
afterAll(async () => { await Promise.all(children.map(stop)); });

describe('serve.ts', () => {
  it('serves the API on PORT from the environment, with the version of package.json, on the Node adapter', async () => {
    const t = makeTle(25544, Date.now() - 3600_000);
    const hits: string[] = [];
    const upstream = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url?.startsWith('/NORAD/elements/gp.php')) { res.setHeader('content-type', 'text/plain'); res.end(celestrakText('ISS', t)); }
      else { res.statusCode = 404; res.end('no'); }
    });
    const upPort = await freePort();
    await new Promise<void>(r => upstream.listen(upPort, '127.0.0.1', r));
    try {
      const port = await freePort();
      const { log } = start({ PORT: String(port), UPSTREAM_CELESTRAK: `http://127.0.0.1:${upPort}`, UPSTREAM_MIRROR: `http://127.0.0.1:${upPort}`, RATE_TLE_PER_MIN: '0' });
      await waitUp(port);
      expect(log()).toContain(`listening on http://127.0.0.1:${port}`);
      const base = `http://127.0.0.1:${port}`;

      const health = await fetch(base + '/api/health');
      expect(health.headers.get('x-gt-api')).toBe('1');
      expect(await health.json()).toMatchObject({ ok: true, version: PKG.version });

      const first = await fetch(base + '/api/tle/25544');
      expect(first.status).toBe(200);
      expect(first.headers.get('x-gt-cache')).toBe('miss');
      expect(await first.json()).toMatchObject({ status: 'ok', norad: '25544', l1: t.l1, src: 'CelesTrak' });
      const second = await fetch(base + '/api/tle/25544');
      expect(second.headers.get('x-gt-cache')).toBe('hit');
      expect(hits).toEqual(['/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE']);   // one request for both

      const bad = await fetch(base + '/api/tle/abc');
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ error: 'bad_norad' });
      const unknown = await fetch(base + '/api/nothing');
      expect([unknown.status, unknown.headers.get('x-gt-api')]).toEqual([404, '1']);
      const outside = await fetch(base + '/nothing-here.html');
      expect([outside.status, outside.headers.get('x-gt-api')]).toEqual([404, null]);    // not our API: no marker

      // outside production the OpenAPI document is there, registered by serve.ts
      const spec = await (await fetch(base + '/api/docs/json')).json() as { paths: Record<string, unknown> };
      expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/health', '/api/tle/{norad}', '/api/history/{norad}']));
    } finally {
      await new Promise<void>(r => upstream.close(() => r()));
    }
  }, 60_000);

  it('in production serves no docs, honours no upstream override, and serves dist/ when asked', async () => {
    const port = await freePort();
    const hasDist = fs.existsSync(path.join(ROOT, 'dist', 'index.html'));
    const { log } = start({
      PORT: String(port), NODE_ENV: 'production', SERVE_STATIC: hasDist ? '1' : '0',
      UPSTREAM_CELESTRAK: 'http://127.0.0.1:1'                    // would break every lookup if it were honoured; never asked here
    });
    await waitUp(port);
    const base = `http://127.0.0.1:${port}`;
    expect(log()).toContain('production');
    expect(log()).not.toContain('http://127.0.0.1:1');             // not announced, because not honoured
    expect(log()).not.toContain('docs at');
    const docs = await fetch(base + '/api/docs');
    expect([docs.status, docs.headers.get('x-gt-api')]).toEqual([404, '1']);            // an unknown path under /api: our JSON 404
    expect((await fetch(base + '/api/docs/json')).status).toBe(404);
    expect((await fetch(base + '/api/health')).status).toBe(200);
    if (hasDist) {
      const page = await fetch(base + '/');
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<html');
      expect(page.headers.get('x-gt-api')).toBeNull();
      expect(page.headers.get('cache-control')).toBe('no-cache');                      // revalidated on every load
      const moon = await fetch(base + '/moon.html');
      expect(moon.status).toBe(200);
    }
  }, 60_000);

  it('refuses to start on a bad environment, naming the variable, instead of falling back to a default nobody chose', async () => {
    const { child, log } = start({ PORT: 'not-a-port', TLE_TTL_S: '-1' });
    const code = await new Promise<number | null>(res => child.once('exit', res));
    expect(code).toBe(1);
    expect(log()).toMatch(/invalid configuration/);
    expect(log()).toContain('PORT');
    expect(log()).toContain('TLE_TTL_S');
  }, 60_000);
});
