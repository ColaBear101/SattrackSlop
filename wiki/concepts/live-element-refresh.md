---
type: concept
title: "Live element-set refresh"
tags: [data, earth-console, architecture]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Live element-set refresh

The **live element-set refresh** is how the Earth console keeps the element set of the spacecraft on screen current instead of relying on the embedded catalogue. A TLE is a snapshot and the catalogue a snapshot of snapshots; at 360 km with `ndot = .00056` the [[knacksat-2]] set is described as worth about a day, so quoting a week-old set's pass times is "quoting fiction" (README.md#L3665-L3667). See [[tle-two-line-element-set]].

## When and where it fetches

On load, on every change of spacecraft, and every three hours the page stays open, it fetches the set for that one object only — a few hundred bytes (README.md#L3669-L3671). Sources in order (README.md#L3673-L3676):

1. the page's own cache API, `/api/tle/<id>`, if one answers as itself;
2. [[celestrak]] `gp.php?CATNR=<id>&FORMAT=tle`, authoritative, ~170 bytes;
3. the mirror `tle.ivanstanojevic.me/api/tle/<id>`, JSON;
4. the embedded snapshot.

Both live sources send `Access-Control-Allow-Origin: *`, which is what makes this possible for a static page; CelesTrak emits the header only when the request carries an `Origin`, so a bare `curl` misleadingly shows none (README.md#L3678-L3681). Nothing is fetched under `?tle=embedded` or for a designed orbit (README.md#L3711-L3712); see [[assignment-snapshot-tle-embedded]] and [[orbit-planner]].

## The optional cache API

`server/` is a small Elysia app (`GET /api/health`, `/api/tle/:norad`, `/api/history/:norad`, with shared types in `shared/`) that asks CelesTrak then the mirror and judges answers with the same functions the page uses (`shared/tle.ts`) (README.md#L3683-L3687). It keeps answers so N visitors cost CelesTrak one request, and computes nothing (README.md#L3687-L3688). A set is served for three hours from when it was fetched, not when asked; concurrent requests share one upstream call; a set older than the one held, or with an epoch more than three days ahead of the server clock, is refused; "No GP data found" is kept as an answer, failures are never kept, and a stale set is not served because a source is down (README.md#L3688-L3693). Decay histories use a twelve-hour life (README.md#L3694); see [[orbital-decay-forecast]].

`npm run dev` starts it beside Vite; `npm run serve` starts it alone on 127.0.0.1:3001, optionally serving `dist/` with `SERVE_STATIC=1`; outside production it serves OpenAPI docs at `/api/docs`. The deploy in `vercel.json` is the frontend alone (README.md#L3696-L3700).

**The page does not take the API's word for it.** Only a reply with header `x-gt-api: 1` and a body matching the schema counts (`src/lib/net/api.ts`); a 404, app shell, captive portal, rate limit, timeout or failed connection is "no API here" (README.md#L3702-L3705). Such a failure opens a circuit breaker for ten minutes, except when the API itself reports its sources down (502 or 504) (README.md#L3705-L3710). `VITE_API=off` skips the probe; `VITE_API_BASE` points elsewhere (README.md#L3710-L3711).

## Five rules

(README.md#L3714-L3737)

- **Only forward.** A mirror can serve a set older than the embedded one; epochs are compared and older sets refused.
- **Validate before believing.** A source without the object can answer 200 with an HTML page; line lengths and the NORAD ID are checked first.
- **Say which set is on screen**: "Updated live from CelesTrak", "Confirmed current against…", or "No live source reachable — showing the embedded snapshot."
- **The clock stays put.** A swap re-runs the analysis without moving the window; results are cached per NORAD ID in `localStorage` for three hours (key `tle:<n>`; see [[forget-data]]).
- **Keep checking.** Once a check per object per session, it now re-arms on the three-hour cache beat, riding the existing 30 s timer (one request per 360 ticks), and also fires on returning to a throttled background tab; the provenance line says when it last checked, e.g. "checked 2.4 h ago".

## Special answers

Three refresh outcomes are not a fresher set (README.md#L3825-L3842): a newer set SGP4 cannot propagate is refused and the working set kept; CelesTrak's 404 "No GP data found" is read as a withdrawal (likely re-entry), not an outage, and the mirror is not asked; and the provenance result is kept per NORAD number so the line describes the spacecraft actually displayed. See [[decayed-objects]].

## The embedded baseline

The embedded catalogue remains the offline fallback and the source of the first answer, and the other 2,157 objects in the 3D cloud are drawn from it as context (README.md#L3739-L3741). Refreshing it means rebuilding `data/catalogue.txt` and its meta file together with `verification/fixtures/catalog.txt`, which a unit test holds equal (README.md#L3741-L3743). See [[data-provenance]].

## Checks

`npm run refresh` exercises the refresh against mocked sources; `run.js` also runs it as `refresh-api` with a mock cache API (README.md#L3961-L3962). Phases 6–8 of `verify-refresh.js` cover the three special answers (README.md#L3848). The suites' offline profile answers anything under `/api/` with 503 so the client falls back to mocked paths (README.md#L4052-L4056). See [[verification-harness]].

## Related

- [[sgp4-propagation]]
- [[readme-moon-data-and-radio]]
