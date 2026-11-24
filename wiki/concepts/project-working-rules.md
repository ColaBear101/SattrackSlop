---
type: concept
title: "Project working rules"
tags: [meta, verification]
sources: [claude-md-project-instructions, changes-from-legacy]
created: 2026-11-24
updated: 2026-11-24
---

# Project working rules

SattrackSlop's **working rules** are the operating instructions given to anyone, human or agent, changing the code. They are stated in `CLAUDE.md` as one overriding rule and a short list "learned the hard way" (CLAUDE.md#L5-L7, CLAUDE.md#L23-L29). This page gathers them with the ledger evidence that shows why each exists.

## The one rule: the numbers must not move

`npm run gate` builds the production bundle and compares 67,488 values against the frozen baseline with `===`; it must print `BIT-IDENTICAL`. Tolerances (`--tol`) are never used, and the frozen references are never regenerated from the new code — they are written from the old page only. "If the gate moves, the code is wrong" (CLAUDE.md#L7). See [[regression-gate]] and [[legacy-earth-console]].

## The rules learned the hard way

1. **Don't load the machine during a full run.** No other browsers while a full run is going: pov, ab3d, planner-ui, the AR suite and ar-snap are timing-sensitive. A failure that passes alone may be called a load flake only after it has actually been run alone (CLAUDE.md#L25). The ledger's figures illustrate the sensitivity: `verify-ar-snap` ran in 53 s alone and 120 s within a run of the whole set (CHANGES-FROM-LEGACY.md#L46), and `verify-ar` once failed a pointer check under load with the drawn text right (CHANGES-FROM-LEGACY.md#L44).
2. **Same-commit bookkeeping.** A new fact the page states goes into `src/lib/text`; a difference from the old page goes into the ledger in the same commit; a suite that asserted the old behaviour is changed in that commit, with the reason (CLAUDE.md#L26). See [[change-ledger]].
3. **Edit verbatim ports only at `CHANGED` lines,** keeping the old arithmetic order and comments (CLAUDE.md#L27). See [[verbatim-ports]].
4. **No unrequested outward actions.** Do not push, deploy, merge or install system software without being asked; stage specific paths, never `git add -A` (CLAUDE.md#L28).
5. **Backslashes and heredocs.** Scripts and files with backslashes lose them when written through a shell heredoc; write such files with editor tools (CLAUDE.md#L29).

## Structural rules stated in the layout

The instructions' layout section also contains rules phrased as facts:

- `src/lib` is pure (no DOM or globals) and the import direction is `lib <- state <- components`, checked by `npm run check:deps` (CLAUDE.md#L11-L12). See [[layer-dependency-rule]].
- A lazy chunk must import nothing from the entry, and anything added to the entry, the scene, the lifetime chunk or the Decay panel's chunks must be paid for within the budget and first-screen ceiling (CLAUDE.md#L16). See [[lazy-chunks-and-entry-budget]].
- The test facade must not be in the entry chunk (CLAUDE.md#L17). See [[test-facade]].
- `data/satcat.json` is to be re-baked together with the catalogue (CLAUDE.md#L14).

## Commands referenced by the rules

From CLAUDE.md#L21: `npm run dev` (Vite plus the API), `build`, `preview`; `test:fast` (types, layers, unit, fast browser stages) and `test:all` (every stage, one table); single suites such as `gate`, `visitor`, `custom`, `planner-ui`, `ar`, `ar-snap`, `ab3d`, `golden`, `layout`, `axe`, `perf`, `realism`, `closeup`, `models`, `catcolour`. `GT_TARGET=new|legacy` picks the page a suite drives and `GT_DIST` the build folder. See [[verification-harness]].

## Owner approval in practice

The rules forbid outward actions without being asked; the ledger shows the corresponding practice for data and scope. External downloads baked into the page are recorded with the owner's approval and date — the city-lights mosaic on 2026-10-08 (CHANGES-FROM-LEGACY.md#L14, CHANGES-FROM-LEGACY.md#L98) and CelesTrak's satcat on 2026-11-20 (CHANGES-FROM-LEGACY.md#L125) — and departures such as removing the "Outside the brief" notice or raising the entry budget to 92 KB are recorded as the owner's instruction or decision (CHANGES-FROM-LEGACY.md#L97, CHANGES-FROM-LEGACY.md#L121).

## Related

- [[claude-md-project-instructions]] — the source of these rules
- [[changes-from-legacy]] — the ledger the second rule feeds
- [[regression-gate]]
