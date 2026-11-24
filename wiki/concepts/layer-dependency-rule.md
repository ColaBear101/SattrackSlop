---
type: concept
title: "Layer dependency rule (lib <- state <- components)"
tags: [architecture]
sources: [claude-md-project-instructions, changes-from-legacy]
created: 2026-11-24
updated: 2026-11-24
---

# Layer dependency rule (`lib <- state <- components`)

The **layer dependency rule** fixes the direction in which SattrackSlop's client code may import: pure library code in `src/lib` knows nothing of the stores in `src/state`, and the stores know nothing of the UI in `src/components` (and the imperative 3D code in `src/scene`). The direction is written `lib <- state <- components` and is enforced by `npm run check:deps` (CLAUDE.md#L12).

## The three layers

| Layer | Contents | Constraint |
|---|---|---|
| `src/lib` | `core` (body, SGP4 propagator, `moon`), `analysis` (compute, passes, optics, Doppler), `catalogue`, `planner`, `text`, `net`, `ar`, `export` | pure TypeScript, no DOM or globals; runs in the browser, Node and Vitest (CLAUDE.md#L11) |
| `src/state` | rune stores: `app`, `clock`, `custom`, `live`, `life`, `prefs`, `report` | may use `lib` (CLAUDE.md#L12) |
| `src/components`, `src/scene` | Svelte components; the scene uses three r128 imperatively | may use `state` and `lib` (CLAUDE.md#L12) |

The server side is separate: `server/` and `shared/` hold the Elysia cache API, and the client falls back to direct fetches when it is absent (CLAUDE.md#L13).

## What purity buys

Because `src/lib` has no DOM or globals, the same computation runs in the page, in Node-based tools and in Vitest unit tests (CLAUDE.md#L11). That is what lets the [[regression-gate]] check the bundled library on its own, and lets unit tests pin library behaviour that browser suites would otherwise have to reach through the [[test-facade]]. The ledger shows the pattern in individual features: the realistic sky's exposure is "worked out each frame by `src/lib/models/exposure.ts` (pure)" (CHANGES-FROM-LEGACY.md#L132), and the advisor's substantive invariants are stated as no DOM, no clock and no storage (CHANGES-FROM-LEGACY.md#L32).

One caveat on portability: the gate's library check runs the bundle in a blank Chromium page rather than Node, because the same bundle in Node 23.5 differed in 364 values by up to 1e-14 (CHANGES-FROM-LEGACY.md#L30). Purity makes the code runnable anywhere; it does not make results bit-identical across JavaScript engines.

## Words as data

`src/lib/text` holds "every sentence the page says, as data" (CLAUDE.md#L11), and a working rule requires that a new fact the page states goes there (CLAUDE.md#L26). Keeping the page's words in the pure layer puts them where the prose-parity capture and unit tests can reach them; see [[project-working-rules]].

## A related but distinct rule: lazy chunks and the entry

A second import constraint concerns bundling rather than layering: a lazy chunk must import nothing from the entry (not `app`, not `globe-state`, not `ui/Rich.svelte`), or the bundler splits the entry's shared modules into chunks of their own. Code that needs entry objects receives them as arguments instead — the close-up is handed the globe and the app in `attach()` (CLAUDE.md#L16). See [[lazy-chunks-and-entry-budget]].

## Gaps

- The ledger does not mention `check:deps`, so nothing in the ledger corroborates how the check is implemented or when it was introduced; the instructions list "layers" among the stages of `npm run test:fast` (CLAUDE.md#L21).
- Where `src/scene` sits relative to `src/state` is not spelled out beyond "then `src/components` and `src/scene`" (CLAUDE.md#L12).

## Related

- [[verbatim-ports]] — ported code inside `src/lib/planner` and the scene
- [[central-body-seam]] — another architectural seam in the same code
- [[claude-md-project-instructions]]
