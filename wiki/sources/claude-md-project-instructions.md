---
type: source
title: "CLAUDE.md: the project's agent instructions"
authors: ["SattrackSlop project"]
raw: "CLAUDE.md"
snapshot: "4ce1719 + uncommitted working-tree edits (2026-11-24)"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [meta, architecture, verification]
entities: [legacy-earth-console, verification-harness]
concepts: [regression-gate, layer-dependency-rule, lazy-chunks-and-entry-budget, test-facade, verbatim-ports, change-ledger, project-working-rules]
---

# CLAUDE.md: the project's agent instructions

`CLAUDE.md` is the short (30-line) instruction file read by coding agents working on SattrackSlop. It compresses the project into one rule, a map of the code, the commands, and a list of working rules "learned the hard way" (CLAUDE.md#L23). It points to the README as the long account and to `CHANGES-FROM-LEGACY.md` as the ledger of intentional differences from the old page (CLAUDE.md#L3; see [[changes-from-legacy]]).

## What the project is (L1–L3)

An Earth satellite ground-track console built with Svelte 5, TypeScript and Vite 8, plus two Moon pages written as plain scripts and served from `public/` (CLAUDE.md#L3). Everything is computed in the browser; the Elysia server in `server/` only caches element sets and decay histories, and the page works without it (CLAUDE.md#L3). The ledger's row ranges are given as L1–L61, L66–L68 and L71–L85 plus the numbered rows, with L62–L65 and L69–L70 on other branches (CLAUDE.md#L3).

## The one rule (L5–L7)

The computed numbers must not move. `npm run gate` builds the production bundle, compares 67,488 values against `verification/gate/baseline.json` with `===`, and must print `BIT-IDENTICAL`; tolerances and regenerating the frozen references from the new code are forbidden, because those references are written only from the old page (CLAUDE.md#L7). "If the gate moves, the code is wrong" (CLAUDE.md#L7). See [[regression-gate]] and [[legacy-earth-console]].

## Layout (L9–L17)

- `src/lib`: pure TypeScript with no DOM or globals, runnable in the browser, Node and Vitest, divided into `core`, `analysis`, `catalogue`, `planner`, `text`, `net`, `ar`, `export` (CLAUDE.md#L11). Planner code is verbatim ports behind factories with `CHANGED` markers, and `core/moon` is a bit-for-bit copy of the Moon pages' ephemeris (CLAUDE.md#L11). See [[verbatim-ports]].
- `src/state` rune stores, then `src/components` and `src/scene`; the dependency direction `lib <- state <- components` is enforced by `npm run check:deps` (CLAUDE.md#L12). See [[layer-dependency-rule]].
- `server/` + `shared/`: the Elysia cache API, with a client fallback to direct fetches (CLAUDE.md#L13).
- `data/`: catalogue, world map, transmitters, aliases, satcat and WMM, some baked by scripts under `verification/tools/` (CLAUDE.md#L14).
- `verification/`: CommonJS test apparatus with `run.js`, `gate/`, `suites/`, `reference/`, `fixtures/`, `tools/`, `lib/` (CLAUDE.md#L15). See [[verification-harness]].
- One long bullet lists every lazy chunk with what triggers it, the rule that a lazy chunk must import nothing from the entry, and the entry and first-screen budgets (CLAUDE.md#L16). See [[lazy-chunks-and-entry-budget]].
- The test facade (`window.__gt`, `Orbit3D`, …) is a lazy chunk installed only under `window.__GT_TEST__` and must not be in the entry chunk (CLAUDE.md#L17). See [[test-facade]].

## Commands (L19–L21)

Development, build and preview scripts; `test:fast` and `test:all`; single suites by name; `GT_TARGET=new|legacy` to choose which page a suite drives (the old page is the git tag `legacy-earth-console`, checked out with `git worktree add`); and `GT_DIST` to choose the build folder (CLAUDE.md#L21).

## Working rules (L23–L29)

Five rules: do not run other browsers during a full run because several suites are timing-sensitive; record new page facts in `src/lib/text`, differences in the ledger, and changed suite expectations in the same commit; edit verbatim ports only at `CHANGED` lines; do not push, deploy, merge or install system software unasked, and stage specific paths; write files containing backslashes with editor tools, not shell heredocs (CLAUDE.md#L25-L29). See [[project-working-rules]] and [[change-ledger]].

## Where this fits

- [[project-working-rules]] — the rules and commands, gathered
- [[regression-gate]] — the one rule's mechanism
- [[layer-dependency-rule]] — the `lib <- state <- components` direction
- [[lazy-chunks-and-entry-budget]] — the chunk list and budgets
- [[test-facade]] — `window.__gt` and the test-only boot path
- [[verbatim-ports]] — ported files edited only at marked lines
- [[change-ledger]] and [[changes-from-legacy]] — the ledger it points to
- [[legacy-earth-console]], [[verification-harness]]
- [[sattrackslop-readme]] — the long account it defers to
