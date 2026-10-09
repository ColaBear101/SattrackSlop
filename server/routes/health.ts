/* GET /api/health - is it up, which version, what time does it think it is. Never cached. */
import { Elysia, t } from 'elysia';
import type { Ctx } from '../ctx.js';
import { CACHE_CONTROL } from '../lib/errors.js';

export const HealthSchema = t.Object({ ok: t.Literal(true), version: t.String(), now: t.Number() });

export const healthRoutes = (ctx: Ctx) =>
  new Elysia().get('/health', ({ set }) => {
    set.headers['cache-control'] = CACHE_CONTROL.noStore;
    return { ok: true as const, version: ctx.config.version, now: ctx.deps.now() };
  }, { response: { 200: HealthSchema } });
