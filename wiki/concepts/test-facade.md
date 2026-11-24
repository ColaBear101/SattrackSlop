---
type: concept
title: "Test facade (window.__gt and the test surface)"
tags: [verification, architecture]
sources: [claude-md-project-instructions, changes-from-legacy]
created: 2026-11-24
updated: 2026-11-24
---

# Test facade (`window.__gt` and the test surface)

The **test facade** is the set of window-level handles — `window.__gt`, `Orbit3D` and others — through which SattrackSlop's browser suites read and steer the rebuilt page's internals. It is a lazy chunk installed only when `window.__GT_TEST__` is set, and the entry chunk must not contain it (CLAUDE.md#L17). The ledger calls it the "test surface" and names its source as `src/testing/surface.ts` (CHANGES-FROM-LEGACY.md#L129).

## Why it exists

The suites need to reach state the page does not show. The old page kept some of it on its entry (`__prov`, `__next`); the rebuilt page's entry is immutable, so that state is now reached as `__gt.live` (`prov`, `setProv`, `next`, `makeDue`) (CHANGES-FROM-LEGACY.md#L37). Keeping the facade out of the entry and out of a visitor's page is part of the [[lazy-chunks-and-entry-budget]] discipline.

## What the flag changes

Setting `window.__GT_TEST__` does more than install the facade:

- **Eager boot.** With the flag the page brings the orbit planner and the AR view up eagerly before it publishes `__gt` (CHANGES-FROM-LEGACY.md#L43). `__gt` appears only once the planner is up (CHANGES-FROM-LEGACY.md#L41), and the test surface waits for the written report, as the planner does (CHANGES-FROM-LEGACY.md#L89).
- **Old page's globe defaults.** Since L80 the page opens plain (trail off; catalogue, footprint and observer pin off). The parity suites compare with the old page, so the test surface sets the old page's 6 h trail and switches through the Layers panel's own state before `__gt` reports ready; a suite can keep the page's own defaults with `window.__GT_DEFAULTS__` (CHANGES-FROM-LEGACY.md#L129, CLAUDE.md#L17).

## The blind spot it creates, and its guard

Because every other browser suite runs on this test-surface boot path, none of them sees how a real visitor's planner arrives. The ledger gives the evidence: deleting `scheduleSession()` from `main.ts` left the `custom` and `planner-ui` suites green (CHANGES-FROM-LEGACY.md#L43). `verify-visitor.js` therefore opens the page without the flag and checks, among much else, that no test surface and nothing of the facade appears on `window` (CHANGES-FROM-LEGACY.md#L43). The planner suites say in their headers that the visitor path is not theirs to check (CHANGES-FROM-LEGACY.md#L41-L42).

## Members mentioned in the ledger

| Handle | Purpose | Source |
|---|---|---|
| `__gt.live` (`prov`, `setProv`, `next`, `makeDue`) | provenance and refresh scheduling formerly on the old page's entry | CHANGES-FROM-LEGACY.md#L37 |
| `__gt.OBS` | the observer; a value replaced when it moves, so suites re-read it after a move | CHANGES-FROM-LEGACY.md#L37 |
| `__gt.eng` | the engine, a getter added so `verify-doppler` can count `stateAt` calls while paused | CHANGES-FROM-LEGACY.md#L107 |
| `optics`, `seek(ms)` | the live optics object; set the clock to an exact millisecond and stop | CHANGES-FROM-LEGACY.md#L108 |
| `Orbit3D` (e.g. `Orbit3D.scene`) | the ported 3D scene | CLAUDE.md#L17, CHANGES-FROM-LEGACY.md#L126 |
| `host.current()` | the planner's host, asked instead of `__gt` whether the first analysis existed at `init` | CHANGES-FROM-LEGACY.md#L41 |

Related window flags used by the suites: `window.__GT_FAULT__ = { toTLE: true }` makes the planner's TLE writer throw (CHANGES-FROM-LEGACY.md#L41-L42).

## Related

- [[verification-harness]] — sets the flag and drives the facade
- [[lazy-chunks-and-entry-budget]] — why the facade is a chunk
- [[regression-gate]] — the parity checks that depend on the old defaults
- [[legacy-earth-console]] — whose globals the facade replaces
- [[orbit-planner]] — brought up eagerly under the flag
