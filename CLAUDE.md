# SattrackSlop

An Earth satellite ground-track console (Svelte 5 + TypeScript + Vite 8) and two Moon pages (plain scripts, served from `public/`). Everything is computed in the browser; the Elysia server in `server/` is only a cache for element sets and decay histories, and the page works without it. `README.md` is the project's long account; `CHANGES-FROM-LEGACY.md` is the ledger of every intentional difference from the old static page (rows L1-L45 and the numbered rows).

## The one rule

**The computed numbers must not move.** `npm run gate` builds the production bundle and compares 67,488 values against `verification/baseline.json` with `===`; it must print `BIT-IDENTICAL`. Never use `--tol`, never regenerate `baseline.json`, `verification/golden.json` or the `verification/ab3d/` references from the new code: they are written from the old page only (`GT_TARGET=legacy`, `--write`). If the gate moves, the code is wrong.

## Layout

- `src/lib` pure TypeScript, no DOM or globals (runs in the browser, Node and Vitest): `core` (body, SGP4 propagator), `analysis` (compute, passes, optics, Doppler), `catalogue`, `planner` (verbatim ports behind factories, `// @ts-nocheck` with `CHANGED` markers), `text` (every sentence the page says, as data), `net`, `ar`, `export`.
- `src/state` rune stores (`app`, `clock`, `custom`, `live`, `life`, `prefs`, `report`), then `src/components` and `src/scene` (three r128, imperative). Dependency direction is `lib <- state <- components`; `npm run check:deps` enforces it.
- `server/` + `shared/` Elysia cache API (`serve.ts`); the client falls back to direct fetches when it is absent.
- `data/` catalogue, world, transmitters, WMM; `public/` the Moon pages, verbatim.
- Lazy chunks: planner, AR, report, Eden client, scene, sky data, transmitters, export. The entry the page cannot start without is ~83 KB gzipped (budget 90, held by `verify-visitor.js`).
- The test facade (`window.__gt`, `Orbit3D`, ...) is a lazy chunk installed only when `window.__GT_TEST__` is set; the entry chunk must not contain it.

## Commands

`npm run dev` (Vite + API), `npm run build`, `npm run preview`. `npm run test:fast` (types, layers, unit, fast browser stages), `npm run test:all` (every stage, one table). Single suites: `npm run gate`, `visitor`, `custom`, `planner-ui`, `ar`, `ab3d`, `golden`, `layout`, `axe`, `perf` (see README, "Running it"). `GT_TARGET=new|legacy` picks which page a suite drives (default `new`; the old page is in git at the tag `legacy-earth-console` and is checked out for a suite with `git worktree add legacy legacy-earth-console`); `GT_DIST=<folder>` picks the build folder.

## Working rules learned the hard way

- Never run other browsers while a full run is going: pov, ab3d, planner-ui and the AR suite are timing-sensitive. A failure that passes alone is a load flake only after you have run it alone.
- A new fact the page states goes into `src/lib/text`, a difference from the old page goes into the ledger the same commit, and a suite that asserted the old behaviour is changed in that commit with the reason.
- Verbatim ports (`plannerui.ts`, `arview.ts`, `globetex.ts`, `orbit3d.ts`, ...) keep the old arithmetic order and comments; edit them only at marked `CHANGED` lines.
- Do not push, deploy, merge, or install system software without being asked. Stage specific paths, never `git add -A`.
- Scripts and files with backslashes written through a shell heredoc lose them: write such files with the editor tools.
