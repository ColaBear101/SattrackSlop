import { describe, expect, expectTypeOf, it } from 'vitest';
import { treaty } from '@elysia/eden';
import type { Static } from '@sinclair/typebox';
import { createApi, type Api } from '../../server/app.js';
import { TriedSchema } from '../../server/lib/errors.js';
import { HealthSchema } from '../../server/routes/health.js';
import { HistoryNoneSchema, HistoryOkSchema, HistoryRowSchema } from '../../server/routes/history.js';
import { TleGoneSchema, TleOkSchema } from '../../server/routes/tle.js';
import type {
  Health, HistoryNone, HistoryOk, HistoryRow, TleGone, TleOk, Tried
} from '../../shared/api-types.js';
import { TEST_ENV, asFetch, fakeClock, html, scripted, text } from './helpers/harness.js';
import { celestrakText, falling, makeTle, plotPage } from './helpers/tle.js';

/* Two things are pinned here, and both are checked by `tsc -p tsconfig.server.json` (expectTypeOf does nothing at run
   time): that the Eden client's types follow the routes, so a change to a schema is a compile error in the client; and
   that the plain types in shared/api-types.ts - what the client checks replies against - are the routes' schemas,
   so the two cannot drift apart. */

const T0 = Date.UTC(2026, 8, 13);
const app = () => {
  const clock = fakeClock(T0);
  return createApi(TEST_ENV, {
    fetch: asFetch(scripted({
      gp: id => id === '99999' ? text('No GP data found', 404) : text(celestrakText('X', makeTle(id, T0 - 3600_000))),
      history: () => html(plotPage(falling(T0, 0.0008, 2, 420, 359)))
    })),
    now: clock.now
  });
};

describe('the Eden client is typed from the routes', () => {
  it('treaty<Api>(app) makes a typed call, in process, with no port', async () => {
    const client = treaty<Api>(app());
    const res = await client.api.tle({ norad: '25544' }).get();
    expectTypeOf(res.status).toBeNumber();
    expect(res.status).toBe(200);
    expect(res.error).toBeNull();
    const data = res.data;
    expectTypeOf(data).toExtend<TleOk | TleGone | null>();
    if (data && data.status === 'ok') {
      expectTypeOf(data.l1).toBeString();
      expectTypeOf(data.l2).toBeString();
      expectTypeOf(data.at).toBeNumber();
      expectTypeOf(data.epoch).toBeNumber();
      expectTypeOf(data.src).toBeString();
      expect(data.norad).toBe('25544');
      expect(data.l1.substring(2, 7)).toBe('25544');
    } else {
      throw new Error('expected an element set');
    }
  });

  it('narrows the 200 on `status`: ok has lines, gone has none', async () => {
    const client = treaty<Api>(app());
    const gone = await client.api.tle({ norad: 99999 }).get();           // Eden accepts a string or a number for a path parameter
    expect(gone.data).toMatchObject({ status: 'gone', norad: '99999', src: 'CelesTrak' });
    if (gone.data && gone.data.status === 'gone') {
      expectTypeOf(gone.data).toEqualTypeOf<{ status: 'gone'; norad: string; src: string; at: number }>();
      // @ts-expect-error a withdrawal carries no element set
      void gone.data.l1;
    }
  });

  it('types the errors by status: 400 and 429 are bare codes, 502 carries what was tried, 504 only the code', async () => {
    const client = treaty<Api>(app());
    const bad = await client.api.tle({ norad: 'abc' }).get();
    expect(bad.status).toBe(400);
    expect(bad.data).toBeNull();
    const err = bad.error;
    if (!err) throw new Error('expected an error');
    if (err.status === 400) {
      expectTypeOf(err.value).toEqualTypeOf<{ error: 'bad_norad' }>();
      expect(err.value).toEqual({ error: 'bad_norad' });
    } else if (err.status === 502) {
      expectTypeOf(err.value.tried).toEqualTypeOf<Array<{ src: string; outcome: Tried['outcome']; status?: number | undefined }>>();
    } else if (err.status === 504) {
      expectTypeOf(err.value).toEqualTypeOf<{ error: 'upstream_timeout' }>();
    } else if (err.status === 429) {
      expectTypeOf(err.value).toEqualTypeOf<{ error: 'rate_limited' }>();
    }
  });

  it('types the history: the run of element sets with a nullable eccentricity, or a "none" with its reason', async () => {
    const client = treaty<Api>(app());
    const res = await client.api.history({ norad: '25544' }).get();
    expect(res.status).toBe(200);
    const d = res.data;
    if (!d) throw new Error('expected a history');
    if (d.status === 'ok') {
      expectTypeOf(d.P).toEqualTypeOf<Array<{ t: number; sma: number; ecc: number | null }>>();
      expectTypeOf(d.rows).toBeNumber();
      expect(d.P).toHaveLength(221);
    } else {
      expectTypeOf(d.why).toEqualTypeOf<'empty' | 'outside'>();
    }
  });

  it('types health, and the three routes are all there is', async () => {
    const client = treaty<Api>(app());
    const res = await client.api.health.get();
    expectTypeOf(res.data).toEqualTypeOf<{ ok: true; version: string; now: number } | null>();
    expect(res.data).toEqual({ ok: true, version: '9.9.9-test', now: T0 });
    expectTypeOf(client.api).toHaveProperty('tle');
    expectTypeOf(client.api).toHaveProperty('history');
    expectTypeOf(client.api).toHaveProperty('health');
    // the catch-all is deliberately not part of what the client sees
    expectTypeOf(client.api).not.toHaveProperty('*');
  });

  it('a path parameter that is not there is a compile error', () => {
    const client = treaty<Api>(app());
    // @ts-expect-error tle needs its norad
    void client.api.tle.get;
    // @ts-expect-error there is no such route
    void client.api.nonsense;
    expect(typeof client.api.tle).toBe('function');
  });
});

describe('shared/api-types.ts is the routes\' schemas', () => {
  it('has the same types as the TypeBox schemas the routes validate with', () => {
    expectTypeOf<Static<typeof TleOkSchema>>().toEqualTypeOf<TleOk>();
    expectTypeOf<Static<typeof TleGoneSchema>>().toEqualTypeOf<TleGone>();
    expectTypeOf<Static<typeof HistoryRowSchema>>().toEqualTypeOf<HistoryRow>();
    expectTypeOf<Static<typeof HistoryOkSchema>>().toEqualTypeOf<HistoryOk>();
    expectTypeOf<Static<typeof HistoryNoneSchema>>().toEqualTypeOf<HistoryNone>();
    expectTypeOf<Static<typeof TriedSchema>>().toEqualTypeOf<Tried>();
    expectTypeOf<Static<typeof HealthSchema>>().toEqualTypeOf<Health>();
    expect(TleOkSchema.properties.status.const).toBe('ok');
  });
});
