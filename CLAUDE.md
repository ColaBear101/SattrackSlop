# SattrackSlop

An Earth satellite ground-track console (Svelte 5 + TypeScript + Vite 8) and two Moon pages (plain scripts, served from `public/`). Everything is computed in the browser; the Elysia server in `server/` is only a cache for element sets and decay histories, and the page works without it. `README.md` is the project's long account; `CHANGES-FROM-LEGACY.md` is the ledger of every intentional difference from the old static page (rows L1-L61 and the numbered rows).

## The one rule

**The computed numbers must not move.** `npm run gate` builds the production bundle and compares 67,488 values against `verification/gate/baseline.json` with `===`; it must print `BIT-IDENTICAL`. Never use `--tol`, never regenerate `baseline.json`, `verification/gate/golden.json` or the `verification/gate/ab3d/` references from the new code: they are written from the old page only (`GT_TARGET=legacy`, `--write`). If the gate moves, the code is wrong.

## Layout

- `src/lib` pure TypeScript, no DOM or globals (runs in the browser, Node and Vitest): `core` (body, SGP4 propagator), `analysis` (compute, passes, optics, Doppler), `catalogue`, `planner` (verbatim ports behind factories, `// @ts-nocheck` with `CHANGED` markers), `text` (every sentence the page says, as data), `net`, `ar`, `export`.
- `src/state` rune stores (`app`, `clock`, `custom`, `live`, `life`, `prefs`, `report`), then `src/components` and `src/scene` (three r128, imperative). Dependency direction is `lib <- state <- components`; `npm run check:deps` enforces it.
- `server/` + `shared/` Elysia cache API (`serve.ts`); the client falls back to direct fetches when it is absent.
- `data/` catalogue, world, transmitters, aliases (the picker's other names, baked by `verification/tools/fetch-aliases.js`), WMM; `public/` the Moon pages, verbatim.
- `verification/` (CommonJS): `run.js` runs every stage; `gate/` (regress, snapshot, golden, ab3d and their frozen references), `suites/` (verify-*.js, axe, perf, screens), `reference/` (independent core.js/propagate.js and noaa-sun.js, pinned satellite.min.js), `fixtures/` (catalog.txt, WMM, behaviour and mutant lists), `tools/` (fetchers, mutation runners), `lib/` (harness). Outputs (`.build/`, `.logs/`, `screens/`, `.ab3d-out/`, `perf-last.json`, `last-run.json`) stay at the `verification/` root.
- Lazy chunks: planner, AR, report, Eden client, scene, sky data, transmitters, export, grid square, the rail's state now (`NowState`, sharing the `maidenhead` chunk with the grid square), the sky plot's live layer (`sky-live`, asked for the first time the clock is inside the pass it shows), the pass list's Sun times and their words (`suntimes`, asked for once there are passes), the pass list's filter (`PassFilterBar`, asked for once there are passes, and its panel `PassFilter`, at the first press), the one-pass calendar's press (`pass-ics`, at the first press, with the export chunk; it shares the `share` chunk with the AR view), the picker's "decayed now" marks (`decayed.svelte`, the first time the list opens; never under `?tle=embedded`), the watchlist star's press (`watch-press`, at the first press), the picker's other names (`alias`, and its table `aliases`, the first time something is typed; not on opening, which verify-visitor's total counts). The entry the page cannot start without is ~89.5 KB gzipped; `verify-visitor.js` holds it to the 90 KB budget, which binds (its own ceiling, 5 % over the 87.6 KB it was last measured at, is above that).
- The test facade (`window.__gt`, `Orbit3D`, ...) is a lazy chunk installed only when `window.__GT_TEST__` is set; the entry chunk must not contain it.

## Commands

`npm run dev` (Vite + API), `npm run build`, `npm run preview`. `npm run test:fast` (types, layers, unit, fast browser stages), `npm run test:all` (every stage, one table). Single suites: `npm run gate`, `visitor`, `custom`, `planner-ui`, `ar`, `ar-snap`, `ab3d`, `golden`, `layout`, `axe`, `perf` (see README, "Running it"). `GT_TARGET=new|legacy` picks which page a suite drives (default `new`; the old page is in git at the tag `legacy-earth-console` and is checked out for a suite with `git worktree add legacy legacy-earth-console`); `GT_DIST=<folder>` picks the build folder.

## Working rules learned the hard way

- Never run other browsers while a full run is going: pov, ab3d, planner-ui, the AR suite and ar-snap are timing-sensitive. A failure that passes alone is a load flake only after you have run it alone.
- A new fact the page states goes into `src/lib/text`, a difference from the old page goes into the ledger the same commit, and a suite that asserted the old behaviour is changed in that commit with the reason.
- Verbatim ports (`plannerui.ts`, `arview.ts`, `globetex.ts`, `orbit3d.ts`, ...) keep the old arithmetic order and comments; edit them only at marked `CHANGED` lines.
- Do not push, deploy, merge, or install system software without being asked. Stage specific paths, never `git add -A`.
- Scripts and files with backslashes written through a shell heredoc lose them: write such files with the editor tools.
