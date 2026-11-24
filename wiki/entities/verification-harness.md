---
type: entity
kind: tool
title: "Verification harness (verification/)"
aliases: ["verification/", "run.js", "harness.js"]
tags: [verification, architecture]
sources: [claude-md-project-instructions, changes-from-legacy]
created: 2026-11-24
updated: 2026-11-24
---

# Verification harness (`verification/`)

The **verification harness** is SattrackSlop's test apparatus outside the Vitest unit tests: a CommonJS folder, `verification/`, holding a stage runner, the frozen-reference gates, the browser suites, independent reference implementations, fixtures and tools (CLAUDE.md#L15). Its central guarantee, the bit-identical comparison of computed values against the old page, is described on [[regression-gate]]; this page covers the apparatus around it.

## Layout

As listed in the project instructions (CLAUDE.md#L15):

| Folder | Holds |
|---|---|
| `run.js` | Runs every stage |
| `gate/` | regress, snapshot, golden, ab3d and their frozen references |
| `suites/` | `verify-*.js`, axe, perf, screens |
| `reference/` | Independent `core.js`/`propagate.js` and `noaa-sun.js`, a pinned `satellite.min.js` |
| `fixtures/` | `catalog.txt`, WMM, behaviour and mutant lists |
| `tools/` | Data fetchers and mutation runners |
| `lib/` | The harness proper |

Outputs (`.build/`, `.logs/`, `screens/`, `.ab3d-out/`, `perf-last.json`, `last-run.json`) stay at the `verification/` root (CLAUDE.md#L15). Some baked data files are produced by its tools, e.g. the aliases by `fetch-aliases.js` and the satcat table by `fetch-satcat.js` (CLAUDE.md#L14).

## The runner

`verification/run.js` replaced `npm test`: it fails fast only on the numbers, then runs every other stage and prints one table, because the old `&&` chain hid every stage after the first failure (CHANGES-FROM-LEGACY.md#L34). `npm run test:fast` covers types, layers, unit tests and fast browser stages; `npm run test:all` runs every stage; single suites have their own scripts (CLAUDE.md#L21). Stages added over time include `refresh-api` (the refresh suite with the API up) (CHANGES-FROM-LEGACY.md#L38) and `visitor`, `ar-snap`, `realism`, `closeup`, `models` and `catcolour` (CHANGES-FROM-LEGACY.md#L43, CHANGES-FROM-LEGACY.md#L46-L50).

## Driving either page

- **Target selection.** `GT_TARGET=new|legacy` picks which page a suite drives (default `new`), and `GT_DIST=<folder>` picks the build folder (CLAUDE.md#L21). The old page is the [[legacy-earth-console]].
- **Serving.** Suites open the page over http through `verification/lib/harness.js` rather than `file://`, and answer the old page's two cdnjs scripts from local copies whose sha512 matches the page's pins (CHANGES-FROM-LEGACY.md#L28).
- **Helpers.** Harness helpers (`pick`, `pickExact`, `clickWindow`, `siteForm`, `setSite`, and for the picker `openPicker`, `typeInPicker`, `closePicker` and others) open a popover if it is shut and use it, and do nothing extra on the old page, so one suite file runs against both builds (CHANGES-FROM-LEGACY.md#L37, CHANGES-FROM-LEGACY.md#L41).
- **Test surface.** The harness sets `window.__GT_TEST__`, which makes the rebuilt page install the [[test-facade]] and bring the planner and AR view up eagerly; only `verify-visitor` runs without it (CHANGES-FROM-LEGACY.md#L41, CHANGES-FROM-LEGACY.md#L43).
- **Network stand-ins.** On the rebuilt page `verify-custom` answers the page's cache API as itself with "the sources are down" (502 with `x-gt-api: 1`), because a bare 503 would trip the page's ten-minute circuit breaker (CHANGES-FROM-LEGACY.md#L41).
- **Fault injection.** A planner that cannot load is simulated by refusing its chunk; one that throws by `window.__GT_FAULT__ = { toTLE: true }` (CHANGES-FROM-LEGACY.md#L41, CHANGES-FROM-LEGACY.md#L42).

## Keeping the checks honest

- **Mutation testing.** `verification/tools/mutate-new.js` (`npm run mutate`) applies each mutant in `fixtures/mutants-new.json` to a scratch copy of `src/`, builds it and runs the relevant suite groups; its first full run of 85 mutants (3 equivalent) caught 81 and exposed one unguarded behaviour, which then gained a check (CHANGES-FROM-LEGACY.md#L41). Newer suites report faults seeded into scratch builds, e.g. nineteen for `verify-ar-snap` (CHANGES-FROM-LEGACY.md#L46).
- **Behaviour maps.** `fixtures/behaviours-custom.json` and `fixtures/behaviours.json` map old mutants and behaviours to the checks or unit tests that guard them, kept honest by `check-behaviours-custom.js` and `check-behaviours.js` (CHANGES-FROM-LEGACY.md#L41, CHANGES-FROM-LEGACY.md#L42).
- **Skips are loud.** Checks that cannot apply to the module build are skipped "out loud" with the reason in the ledger (CHANGES-FROM-LEGACY.md#L31-L32).
- **Fixed clocks.** `verify-ar` sets every page to 2026-09-13T00:00Z on Playwright's clock (overridable with `GT_AR_AT`) so its geometry checks do not depend on the day they are run (CHANGES-FROM-LEGACY.md#L35).

## Operating constraints

Several stages are timing-sensitive (pov, ab3d, planner-ui, the AR suite and ar-snap), so no other browser should run during a full run, and a failure that passes alone counts as a load flake only after it has actually been run alone (CLAUDE.md#L25). Run times support this: `verify-ar-snap` took 53 s alone and 120 s in one run of the whole set (CHANGES-FROM-LEGACY.md#L46).

## Related

- [[regression-gate]] — the bit-identical numbers, prose and scene gates
- [[test-facade]] — the window-level test surface
- [[change-ledger]] — where changed suite expectations are recorded
- [[project-working-rules]]
- [[independent-reference-checks]] — the independent reference implementations
