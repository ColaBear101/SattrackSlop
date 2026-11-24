---
type: concept
title: "Verbatim ports"
tags: [architecture, verification]
sources: [claude-md-project-instructions, changes-from-legacy]
created: 2026-11-24
updated: 2026-11-24
---

# Verbatim ports

A **verbatim port** in SattrackSlop is a file of the old page's code carried into the rebuilt console with its arithmetic order and comments unchanged, and edited afterwards only at lines marked `CHANGED` (CLAUDE.md#L27). The convention exists because the project's one rule is that computed numbers must not move: re-typing or "cleaning up" arithmetic can change floating-point results, which the [[regression-gate]] compares with `===` (CLAUDE.md#L7).

## The rule

- Verbatim ports — the instructions name `plannerui.ts`, `arview.ts`, `globetex.ts` and `orbit3d.ts` among others — keep the old arithmetic order and comments, and are edited only at marked `CHANGED` lines (CLAUDE.md#L27).
- The planner library (`src/lib/planner`) is described as verbatim ports behind factories, carrying `// @ts-nocheck` and `CHANGED` markers (CLAUDE.md#L11). The ledger does not mention `@ts-nocheck`.
- `src/lib/core/moon.ts` is a verbatim copy of the Moon pages' ephemeris and IAU orientation, held to them bit for bit (CLAUDE.md#L11).

## How markers name their reason

Markers usually carry the ledger row (see [[change-ledger]]) that justifies them, so an edit can be traced to a documented difference:

| Ported file | Marker(s) in the ledger | Row (file line) |
|---|---|---|
| `arview.ts` | `CHANGED (radar)`, `(radar view)`, `(aim)`, `(snap)` | L45–L48 (CHANGES-FROM-LEGACY.md#L100) |
| `src/lib/catalogue/rank.ts` (old four tiers "moved verbatim") | `CHANGED (search tokens)` | L58 (CHANGES-FROM-LEGACY.md#L113) |
| `readPlot` (CelesTrak page reader) | one line `CHANGED (L68)` | L68 (CHANGES-FROM-LEGACY.md#L119) |
| `orbit3d.ts`, `globetex.ts` | `CHANGED (L71)` | L71 (CHANGES-FROM-LEGACY.md#L120) |
| `orbit3d.ts` | `CHANGED (L72)` | L72 (CHANGES-FROM-LEGACY.md#L121) |
| `globetex.ts` | `CHANGED (L74)` | L74 (CHANGES-FROM-LEGACY.md#L123) |
| `src/lib/core/moon.ts`, `orbitviz.ts` | `CHANGED` / `CHANGED (L75)` | L75 (CHANGES-FROM-LEGACY.md#L124) |
| `orbit3d.ts` | `CHANGED (L76)` | L76 (CHANGES-FROM-LEGACY.md#L125) |
| `orbit3d.ts` | `CHANGED (L79)` | L79 (CHANGES-FROM-LEGACY.md#L128) |

## Ways of not editing a port

Several rows show features built around a port rather than inside it:

- The one-pass calendar export calls the verbatim calendar writer in `passes.ts`, "not edited", by handing it a shallow copy of the analysis containing one pass (CHANGES-FROM-LEGACY.md#L112).
- The realistic sky lives in `src/scene/realsky.ts`, handed what it needs, "so `orbit3d.ts` is untouched" (CHANGES-FROM-LEGACY.md#L124).
- The close-up's model attitude changes nothing outside the close-up's own scene: `orbit3d.ts`, `Orbit3D.scene` and the ab3d gate are untouched (CHANGES-FROM-LEGACY.md#L126).
- The AR radar rows state that `skyar.ts` and every figure the page computes are untouched (CHANGES-FROM-LEGACY.md#L100).
- Row 2 declined to unify the old code's four Sun models: the globe keeps its own series for its light "moved as it was" so the scene stays pixel-identical to the old page (CHANGES-FROM-LEGACY.md#L13).

## The Moon ephemeris copy

`src/lib/core/moon.ts` is the most explicit case. It copies `public/moon/lunar.js` lines 1–36 and 39–436 and `public/core/body.js` lines 30 and 117–161, changed only at lines marked CHANGED (the exports, and a closure that keeps the two files' `RAD` constants apart); the originals stay in place byte for byte, and the copy feeds the realistic sky's Moon (CHANGES-FROM-LEGACY.md#L124). The ledger describes the copied code as ELP-2000/82B after Meeus ch. 47 with the IAU/NAIF pole, prime meridian and 13-term libration (CHANGES-FROM-LEGACY.md#L124); this wiki does not restate the physics.

## Why the checks trust ports

- The scene-parity gate exists partly because "the globe is a verbatim port that has been wrapped, fed differently and paced differently" (CHANGES-FROM-LEGACY.md#L40): a port with unchanged arithmetic can still render differently if its inputs or timing change.
- The advisor's purity scan and "Professor appears once" check now scan the verbatim TypeScript source, keeping the invariants of no DOM, clock or storage (CHANGES-FROM-LEGACY.md#L32).

## Related

- [[regression-gate]] — why arithmetic order matters
- [[change-ledger]] — the rows that `CHANGED` markers cite
- [[layer-dependency-rule]] — where the ported library code sits
- [[legacy-earth-console]] — the code's origin
- [[realistic-globe]], [[close-up-camera]], [[ar-radar]] — features built against ported files
