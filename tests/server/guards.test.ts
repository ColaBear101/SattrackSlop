import { describe, expect, it } from 'vitest';
import { Elysia } from 'elysia';
import { createApi } from '../../server/app.js';
import {
  CELESTRAK_GP, CELESTRAK_HISTORY, MIRROR, TEST_ENV, fakeClock, hang, html, makeApp, scripted, text
} from './helpers/harness.js';
import { EMPTY_PLOT, celestrakText, falling, makeTle, mirrorJson, plotPage } from './helpers/tle.js';

const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);

/* The shapes upstream URLs are allowed to have: a fixed host and path, one to five digits in the one place a number goes. */
const ALLOWED_URL = [
  /^https:\/\/celestrak\.org\/NORAD\/elements\/gp\.php\?CATNR=\d{1,5}&FORMAT=TLE$/,
  /^https:\/\/tle\.ivanstanojevic\.me\/api\/tle\/\d{1,5}$/,
  /^https:\/\/celestrak\.org\/NORAD\/elements\/graph-orbit-data\.php\?CATNR=\d{1,5}$/
];
const urlShapeOk = (u: string) => ALLOWED_URL.some(re => re.test(u));

describe('bad numbers are refused before any upstream is asked', () => {
  /* [what, the id as it travels in the path, the status expected when it is not the usual 400] */
  const HOSTILE: Array<[string, string, number?]> = [
    ['letters', 'abc'], ['six digits', '123456'], ['seven digits', '1234567'], ['a letter among digits', '12a45'],
    ['a sign', '-1'], ['a plus', '%2B1'], ['an exponent', '1e3'], ['hex', '0x10'], ['a decimal', '1.5'],
    ['a path', '1%2F2'], ['a traversal', '..%2F..%2Fetc%2Fpasswd'],
    ['encoded dots (the URL parser folds them into /api/ itself, which is a 404)', '%2e%2e', 404],
    ['a query', '25544%3Fx%3D1'], ['a fragment', '25544%23a'], ['an ampersand', '25544%26FORMAT%3Djson'],
    ['userinfo', '25544%40evil.example'], ['a null byte', '25544%00'], ['CRLF', '25544%0d%0aHost:%20evil.example'],
    ['a trailing newline', '25544%0a'], ['a leading space', '%2025544'], ['a trailing space', '25544%20'],
    ['full-width digits', '%EF%BC%92%EF%BC%95%EF%BC%95%EF%BC%94%EF%BC%94'], ['Arabic-Indic digits', '%D9%A2%D9%A5%D9%A5%D9%A4%D9%A4'],
    ['a percent sign alone', '%'], ['a broken escape', '%E0%A4%A'], ['the word null', 'null'], ['a semicolon', '25544;']
  ];

  for (const route of ['tle', 'history']) {
    it(`/api/${route}: ${HOSTILE.length} hostile ids are all a 400 with the API marker and not one upstream call`, async () => {
      const { get, calls } = makeApp(scripted({
        gp: id => text(celestrakText('X', makeTle(id, T0 - 3600_000))), mirror: () => text('x'), history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359)))
      }), {}, fakeClock(T0));
      for (const [what, id, status = 400] of HOSTILE) {
        const r = await get(`/api/${route}/${id}`);
        expect(r.status, what).toBe(status);
        expect(r.body, what).toEqual(status === 400 ? { error: 'bad_norad' } : { error: 'not_found' });
        expect(r.headers.get('x-gt-api'), what).toBe('1');
        expect(r.headers.get('cache-control'), what).toBe('no-store');
      }
      expect(calls, 'no upstream request was made for any of them').toHaveLength(0);
      // the control: a good id through the same app does reach upstream, so a count of 0 above means something
      expect((await get(`/api/${route}/25544`)).status).toBe(200);
      expect(calls.length).toBeGreaterThan(0);
    });
  }

  it('an empty number (/api/tle/ and /api/tle) is the same mistake, a 400 and not a 404', async () => {
    const { get, calls } = makeApp(scripted({}), {}, fakeClock(T0));
    for (const p of ['/api/tle/', '/api/tle', '/api/history/', '/api/history']) {
      const r = await get(p);
      expect(r.status, p).toBe(400);
      expect(r.body, p).toEqual({ error: 'bad_norad' });
    }
    expect(calls).toHaveLength(0);
  });

  it('a path that is not a number plus nothing else is a 404, not a lookup: an extra segment does not reach upstream', async () => {
    const { get, calls } = makeApp(scripted({}), {}, fakeClock(T0));
    for (const p of ['/api/tle/25544/extra', '/api/history/25544/x/y']) {
      const r = await get(p);
      expect([400, 404], p).toContain(r.status);
      expect(r.headers.get('x-gt-api'), p).toBe('1');
    }
    expect(calls).toHaveLength(0);
  });

  it('accepts one to five digits, including zero-padded ones, and nothing else (the boundary both ways)', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(scripted({ gp: id => text(celestrakText('X', makeTle(id, clock.now() - 3600_000))) }), {}, clock);
    for (const ok of ['0', '1', '25544', '99999', '00001', '01804', '00000']) expect((await get('/api/tle/' + ok)).status, ok).toBe(200);
    for (const bad of ['100000', '000001', '']) expect((await get('/api/tle/' + bad)).status, JSON.stringify(bad)).toBe(400);
  });
});

describe('SSRF: the only variable in an upstream URL is one canonical number', () => {
  it('every upstream URL, across every path through the code, has the exact shape of a fixed host + path + digits', async () => {
    const clock = fakeClock(T0);
    const t = makeTle(25544, T0 - 3600_000);
    const seen: string[] = [];
    const handlers = [
      scripted({ gp: () => text(celestrakText('X', t)) }),
      scripted({ gp: () => text('No GP data found', 404) }),
      scripted({ gp: () => text('x', 500), mirror: () => text(mirrorJson('X', t, 25544)) }),
      scripted({ gp: () => text('x', 500), mirror: () => text('x', 500) }),
      scripted({ history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359))) })
    ];
    for (const h of handlers) {
      const { get, calls } = makeApp(h, {}, clock);
      for (const p of ['/api/tle/25544', '/api/tle/01804', '/api/tle/00007', '/api/history/25544', '/api/history/00042', '/api/tle/0'])
        await get(p);
      seen.push(...calls.map(c => c.url));
    }
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.filter(u => !urlShapeOk(u))).toEqual([]);
    expect(new Set(seen.map(u => new URL(u).host))).toEqual(new Set(['celestrak.org', 'tle.ivanstanojevic.me']));
  });

  it('the control: a builder that pastes the raw id into the URL fails the same shape check', () => {
    const naive = (raw: string) => CELESTRAK_GP + '?CATNR=' + raw + '&FORMAT=TLE';
    expect(urlShapeOk(naive('25544'))).toBe(true);
    for (const hostile of ['25544&FORMAT=json', '1/../../x', '25544#', '25544%0d%0a', '123456', '']) {
      expect(urlShapeOk(naive(hostile)), hostile).toBe(false);
    }
    expect(urlShapeOk(MIRROR + '../../admin')).toBe(false);
    expect(urlShapeOk(CELESTRAK_HISTORY + '?CATNR=1&x=2')).toBe(false);
  });

  it('the hosts are constants: a request cannot name one, and in production the environment cannot either', async () => {
    const clock = fakeClock(T0);
    const t = makeTle(25544, T0 - 3600_000);
    const prod = makeApp(scripted({ gp: () => text(celestrakText('X', t)) }),
      { NODE_ENV: 'production', UPSTREAM_CELESTRAK: 'http://127.0.0.1:1', UPSTREAM_MIRROR: 'http://127.0.0.1:2' }, clock);
    await prod.get('/api/tle/25544');
    await prod.get('/api/history/25544');
    expect(prod.calls.map(c => new URL(c.url).host)).toEqual(['celestrak.org', 'celestrak.org']);
    const dev = makeApp(scripted({ gp: () => text(celestrakText('X', t)) }),
      { NODE_ENV: 'development', UPSTREAM_CELESTRAK: 'http://127.0.0.1:9999' }, clock);
    await dev.get('/api/tle/25544');
    expect(dev.calls[0]!.url).toBe('http://127.0.0.1:9999/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE');
  });

  it('nothing in the request but the number reaches upstream: not a header, not a query string, not a cookie', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({ gp: id => text(celestrakText('X', makeTle(id, T0 - 3600_000))) }), {}, clock);
    await get('/api/tle/25544?CATNR=1&host=evil.example', {
      headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', cookie: 'a=b', authorization: 'Bearer secret', referer: 'https://evil.example/' }
    });
    const init = calls[0]!.init!;
    expect(Object.keys(init.headers as object).sort()).toEqual(['accept', 'user-agent']);
    expect(calls[0]!.url).toBe(CELESTRAK_GP + '?CATNR=25544&FORMAT=TLE');
  });
});

describe('the API marker and the shapes of everything that is not a data answer', () => {
  it('GET /api/health: {ok, version, now}, never cached, from the injected clock', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(scripted({}), { GT_VERSION: '4.5.6' }, clock);
    const r = await get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, version: '4.5.6', now: T0 });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-gt-api')).toBe('1');
    clock.advance(1234);
    expect((await get('/api/health')).body.now).toBe(T0 + 1234);
    expect(calls).toHaveLength(0);
  });

  it('answers HEAD for a GET route like the GET, without a body', async () => {
    const clock = fakeClock(T0);
    const { app } = makeApp(scripted({}), {}, clock);
    const res = await app.handle(new Request('http://localhost/api/health', { method: 'HEAD' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-gt-api')).toBe('1');
    expect(await res.text()).toBe('');
  });

  it('is GET only: POST, PUT, PATCH and DELETE on a real path are a 405 with Allow, on an unknown path a 404', async () => {
    const { get, calls } = makeApp(scripted({}), {}, fakeClock(T0));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const p of ['/api/tle/25544', '/api/history/25544', '/api/health']) {
        const r = await get(p, { method, body: method === 'DELETE' ? undefined : '{}' });
        expect(r.status, method + ' ' + p).toBe(405);
        expect(r.body).toEqual({ error: 'method_not_allowed' });
        expect(r.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
        expect(r.headers.get('x-gt-api')).toBe('1');
      }
      expect((await get('/api/nothing', { method })).status, method + ' /api/nothing').toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  it('answers an unknown path under /api as JSON with the marker: this API has no such thing, unlike a host with no API at all', async () => {
    const { get } = makeApp(scripted({}), {}, fakeClock(T0));
    for (const p of ['/api/nothing', '/api/tle/25544/x', '/api/healthz', '/api/']) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(r.body, p).toEqual({ error: 'not_found' });
      expect(r.headers.get('x-gt-api'), p).toBe('1');
      expect(r.headers.get('cache-control'), p).toBe('no-store');
    }
  });

  it('answers an OPTIONS preflight with 204, Allow and the marker (and no CORS headers when none are configured)', async () => {
    const { app } = makeApp(scripted({}), {}, fakeClock(T0));
    const res = await app.handle(new Request('http://localhost/api/tle/25544', { method: 'OPTIONS', headers: { origin: 'https://a.example' } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    expect(res.headers.get('x-gt-api')).toBe('1');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('turns an error of its own into a 500 {internal}: no stack, no message, never cached, still marked', async () => {
    const clock = fakeClock(T0);
    let broken = false;
    const sick = { now: () => { if (broken) throw new Error('secret internal detail at C:\\srv\\app.ts:12'); return clock.now(); }, advance: clock.advance, set: clock.set };
    const { get } = makeApp(scripted({ gp: id => text(celestrakText('X', makeTle(id, T0 - 3600_000))) }), {}, sick);
    broken = true;
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'internal' });
    expect(JSON.stringify(r.body)).not.toMatch(/secret|srv/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-gt-api')).toBe('1');
    broken = false;
    expect((await get('/api/tle/25544')).status).toBe(200);              // and the next request is unharmed
  });

  it('every kind of answer carries x-gt-api: 1, and the two cache headers say what they mean', async () => {
    const clock = fakeClock(T0);
    const t = makeTle(25544, T0 - 3600_000);
    type Case = [string, ReturnType<typeof scripted>, Record<string, string>, string, number, string | null];
    const cases: Case[] = [
      ['ok', scripted({ gp: () => text(celestrakText('X', t)) }), {}, '/api/tle/25544', 200, 'miss'],
      ['gone', scripted({ gp: () => text('No GP data found', 404) }), {}, '/api/tle/25544', 200, 'miss'],
      ['400', scripted({}), {}, '/api/tle/abc', 400, null],
      ['404', scripted({}), {}, '/api/nothing', 404, null],
      ['502', scripted({ gp: () => text('x', 500), mirror: () => text('x', 500) }), {}, '/api/tle/25544', 502, 'miss'],
      ['504', scripted({ gp: (_i, init) => hang(init), mirror: (_i, init) => hang(init) }), { TLE_TIMEOUT_MS: '30' }, '/api/tle/25544', 504, 'miss'],
      ['history ok', scripted({ history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359))) }), {}, '/api/history/25544', 200, 'miss'],
      ['history none', scripted({ history: () => html(EMPTY_PLOT) }), {}, '/api/history/25544', 200, 'miss']
    ];
    for (const [name, handler, env, path, status, cache] of cases) {
      const { get } = makeApp(handler, env, clock);
      const r = await get(path);
      expect(r.status, name).toBe(status);
      expect(r.headers.get('x-gt-api'), name).toBe('1');
      expect(r.headers.get('x-gt-cache'), name).toBe(cache);
    }
  });
});

describe('rate limiting', () => {
  const ok = (clock: ReturnType<typeof fakeClock>) =>
    scripted({ gp: id => text(celestrakText('X', makeTle(id, clock.now() - 3600_000))), history: () => html(plotPage(falling(clock.now(), 0.0008, 2, 420, 359))) });

  it('lets RATE_TLE_PER_MIN requests through and answers the next with 429 {rate_limited}, Retry-After, no-store', async () => {
    const clock = fakeClock(T0);
    const { get, calls } = makeApp(ok(clock), { RATE_TLE_PER_MIN: '3' }, clock);
    for (let i = 0; i < 3; i++) expect((await get('/api/tle/25544')).status, 'request ' + (i + 1)).toBe(200);
    clock.advance(20_000);
    const r = await get('/api/tle/25544');
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate_limited' });
    expect(r.headers.get('retry-after')).toBe('40');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-gt-api')).toBe('1');
    expect(calls).toHaveLength(1);                                       // the refusal asked nobody
  });

  it('starts again when the minute is up', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(ok(clock), { RATE_TLE_PER_MIN: '2' }, clock);
    await get('/api/tle/25544'); await get('/api/tle/25544');
    expect((await get('/api/tle/25544')).status).toBe(429);
    clock.advance(60_000);
    expect((await get('/api/tle/25544')).status).toBe(200);
  });

  it('counts cache hits too: it limits requests to this API, not just trips to CelesTrak', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(ok(clock), { RATE_TLE_PER_MIN: '2' }, clock);
    expect((await get('/api/tle/25544')).headers.get('x-gt-cache')).toBe('miss');
    expect((await get('/api/tle/25544')).headers.get('x-gt-cache')).toBe('hit');
    expect((await get('/api/tle/25544')).status).toBe(429);
  });

  it('does not count a bad number: a 400 is free', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(ok(clock), { RATE_TLE_PER_MIN: '2' }, clock);
    for (let i = 0; i < 10; i++) await get('/api/tle/abc');
    expect((await get('/api/tle/25544')).status).toBe(200);
  });

  it('keeps history on its own, much smaller, budget (10 a minute by default)', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(ok(clock), { RATE_TLE_PER_MIN: '60', RATE_HISTORY_PER_MIN: '10' }, clock);
    for (let i = 0; i < 10; i++) expect((await get('/api/history/25544')).status).toBe(200);
    expect((await get('/api/history/25544')).status).toBe(429);
    expect((await get('/api/tle/25544')).status).toBe(200);              // the TLE budget is untouched
    for (let i = 0; i < 59; i++) await get('/api/tle/25544');
    expect((await get('/api/tle/25544')).status).toBe(429);              // 60 spent
  });

  it('has the documented defaults: 60 a minute for element sets, 10 for histories', async () => {
    const clock = fakeClock(T0);
    const a = makeApp(ok(clock), { RATE_TLE_PER_MIN: '', RATE_HISTORY_PER_MIN: '' }, clock);
    for (let i = 0; i < 60; i++) expect((await a.get('/api/tle/25544')).status).toBe(200);
    expect((await a.get('/api/tle/25544')).status).toBe(429);
    const b = makeApp(ok(clock), { RATE_TLE_PER_MIN: '', RATE_HISTORY_PER_MIN: '' }, clock);
    for (let i = 0; i < 10; i++) expect((await b.get('/api/history/25544')).status).toBe(200);
    expect((await b.get('/api/history/25544')).status).toBe(429);
  });

  it('puts everyone in one bucket unless TRUST_PROXY is set: x-forwarded-for is not believed from the open internet', async () => {
    const clock = fakeClock(T0);
    const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip } });
    const open = makeApp(ok(clock), { RATE_TLE_PER_MIN: '2' }, clock);
    await open.get('/api/tle/25544', from('1.1.1.1')); await open.get('/api/tle/25544', from('2.2.2.2'));
    expect((await open.get('/api/tle/25544', from('3.3.3.3'))).status).toBe(429);       // one shared bucket, however many "clients"
    // the control: behind a proxy we trust, the same three requests are three clients and one each is fine
    const behind = makeApp(ok(clock), { RATE_TLE_PER_MIN: '2', TRUST_PROXY: '1' }, clock);
    await behind.get('/api/tle/25544', from('1.1.1.1')); await behind.get('/api/tle/25544', from('1.1.1.1'));
    expect((await behind.get('/api/tle/25544', from('1.1.1.1'))).status).toBe(429);     // one client over its budget
    expect((await behind.get('/api/tle/25544', from('2.2.2.2'))).status).toBe(200);     // another is not
  });

  it('with TRUST_PROXY, a client cannot buy itself a fresh budget by forging the left of the header', async () => {
    const clock = fakeClock(T0);
    const { get } = makeApp(ok(clock), { RATE_TLE_PER_MIN: '1', TRUST_PROXY: '1' }, clock);
    expect((await get('/api/tle/25544', { headers: { 'x-forwarded-for': 'forged-1, 203.0.113.9' } })).status).toBe(200);
    expect((await get('/api/tle/25544', { headers: { 'x-forwarded-for': 'forged-2, 203.0.113.9' } })).status).toBe(429);
  });
});

describe('CORS, when an origin is configured', () => {
  const env = { CORS_ORIGINS: 'https://app.example' };
  const clock = fakeClock(T0);
  const script = () => scripted({ gp: id => text(celestrakText('X', makeTle(id, clock.now() - 3600_000))) });

  it('lets the listed origin read the answer and the headers the client depends on', async () => {
    const { get } = makeApp(script(), env, clock);
    const r = await get('/api/tle/25544', { headers: { origin: 'https://app.example' } });
    expect(r.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(r.headers.get('access-control-expose-headers')).toContain('x-gt-api');
    expect(r.headers.get('vary')).toBe('Origin');
  });

  it('gives the error answers the same headers (a 429 nobody can read is no use to the page)', async () => {
    const { get } = makeApp(script(), { ...env, RATE_TLE_PER_MIN: '1' }, clock);
    await get('/api/tle/25544');
    const r = await get('/api/tle/25544', { headers: { origin: 'https://app.example' } });
    expect(r.status).toBe(429);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const bad = await get('/api/tle/abc', { headers: { origin: 'https://app.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBe('https://app.example');
  });

  it('gives another origin nothing to read with', async () => {
    const { get } = makeApp(script(), env, clock);
    const r = await get('/api/tle/25544', { headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    expect(r.headers.get('vary')).toBe('Origin');
  });

  it('answers a preflight from the listed origin, and refuses nobody else a permission', async () => {
    const { app } = makeApp(script(), env, clock);
    const pre = (origin: string) => app.handle(new Request('http://localhost/api/tle/25544', {
      method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-test' }
    }));
    const ok = await pre('https://app.example');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(ok.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
    expect(ok.headers.get('access-control-allow-headers')).toBe('x-test');
    expect((await pre('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('is off by default: no CORS headers at all', async () => {
    const { get } = makeApp(script(), {}, clock);
    const r = await get('/api/tle/25544', { headers: { origin: 'https://app.example' } });
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    expect(r.headers.get('vary')).toBeNull();
  });
});

describe('mounted under another app (serve.ts puts it beside the static files)', () => {
  const mount = () => {
    const clock = fakeClock(T0);
    const api = createApi(TEST_ENV, { fetch: async () => text('x', 500), now: clock.now });
    return new Elysia().get('/page.html', () => 'hello').use(api).get('/*', () => new Response('static 404', { status: 404 }));
  };
  const hit = (app: { handle: (r: Request) => Promise<Response> }, path: string) => app.handle(new Request('http://localhost' + path));

  it('marks only the API\'s own responses: a static file and a static 404 are not "our API"', async () => {
    const app = mount();
    expect((await hit(app, '/api/health')).headers.get('x-gt-api')).toBe('1');
    expect((await hit(app, '/api/nothing')).headers.get('x-gt-api')).toBe('1');
    expect((await hit(app, '/api/tle/abc')).headers.get('x-gt-api')).toBe('1');
    const page = await hit(app, '/page.html');
    expect(await page.text()).toBe('hello');
    expect(page.headers.get('x-gt-api')).toBeNull();
    const nope = await hit(app, '/nope.html');
    expect(nope.status).toBe(404);
    expect(nope.headers.get('x-gt-api')).toBeNull();
  });

  it('keeps its own error handling to itself: the parent\'s routes are not turned into JSON 400s or 404s', async () => {
    const app = mount();
    const nope = await hit(app, '/nope.html');
    expect(await nope.text()).toBe('static 404');
  });

  it('wins an unknown GET under /api over a static wildcard registered after it', async () => {
    const r = await hit(mount(), '/api/whatever');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not_found' });
  });
});

describe('createApi as a fetch handler', () => {
  it('answers api.fetch(request) as it does handle(request): that, and nothing else, is what a serverless host would call', async () => {
    const clock = fakeClock(T0);
    const api = createApi(TEST_ENV, { fetch: async () => text('No GP data found', 404), now: clock.now });
    const viaFetch = await api.fetch(new Request('http://localhost/api/tle/25544'));
    const viaHandle = await api.handle(new Request('http://localhost/api/tle/25544'));
    expect(viaFetch.status).toBe(200);
    expect(viaFetch.headers.get('x-gt-api')).toBe('1');
    expect(await viaFetch.json()).toEqual(await viaHandle.json());
  });
});

describe('createApi with no dependencies given', () => {
  it('uses the global fetch and the real clock, looked up at call time (and tests never get here with the network)', async () => {
    const real = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => { seen.push(String(url)); return text('No GP data found', 404); }) as typeof fetch;
    try {
      const app = createApi({ RATE_TLE_PER_MIN: '0' });
      const res = await app.handle(new Request('http://localhost/api/tle/25544'));
      const body = await res.json() as { status: string; at: number };
      expect(body.status).toBe('gone');
      expect(seen).toEqual([CELESTRAK_GP + '?CATNR=25544&FORMAT=TLE']);
      expect(Math.abs(body.at - Date.now())).toBeLessThan(5000);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('throws at creation for a bad environment, naming the variable', () => {
    expect(() => createApi({ TLE_TTL_S: 'soon' })).toThrow(/TLE_TTL_S/);
  });
});

