---
type: concept
title: "Lazy chunks and the entry budget"
tags: [architecture, verification]
sources: [claude-md-project-instructions, changes-from-legacy]
created: 2026-11-24
updated: 2026-11-24
---

# Lazy chunks and the entry budget

The rebuilt Earth console ships a small **entry** — the JavaScript the page cannot start without — and fetches almost every feature as a **lazy chunk** when something first needs it. The entry's gzipped size is held to a fixed **budget**, and the first screen's JavaScript to a **ceiling**, both enforced by `verify-visitor.js` (CLAUDE.md#L16). Because these limits bind, the [[change-ledger]] records the byte cost of nearly every later change, which makes it a running history of the budget.

## Why the page is split

The ledger gives the reasons row by row: the old page's single file was about 270 KB gzipped (CHANGES-FROM-LEGACY.md#L89); the orbit planner was about 150 KB of its script and nothing on the first screen needs it (CHANGES-FROM-LEGACY.md#L83); the written report is below the first screen and is most of the page's words (CHANGES-FROM-LEGACY.md#L89); most visits never scroll to the decay section (CHANGES-FROM-LEGACY.md#L73); the star sky is not on the critical path (CHANGES-FROM-LEGACY.md#L79).

## The chunks, as CLAUDE.md lists them

From the project instructions (CLAUDE.md#L16), with the trigger each is fetched on where one is given:

| Chunk | Fetched when |
|---|---|
| planner, AR, report, Eden client, scene, sky data, transmitters, export, grid square | listed without triggers in CLAUDE.md (the ledger gives some: report once the first answer is on screen; Eden client the first time the page asks its API; planner when the browser is idle after the first answer or on the pill, CHANGES-FROM-LEGACY.md#L89, CHANGES-FROM-LEGACY.md#L83) |
| `NowState` (rail's state now; shares `maidenhead` with the grid square) | not stated |
| `sky-live` (sky plot's live layer) | first time the clock is inside the pass it shows |
| `suntimes` (pass list's Sun times and words) | once there are passes |
| `PassFilterBar` / `PassFilter` | the bar once there are passes; its panel at the first press |
| `pass-ics` (one-pass calendar) | first press, with the export chunk; shares the `share` chunk with the AR view |
| `decayed.svelte` (picker's "decayed now" marks) | first time the list opens; never under `?tle=embedded` |
| `watch-press` (watchlist star) | first press |
| `alias` + table `aliases` (picker's other names) | together, the first time something is typed (not on opening) |
| `DecayCompare` (with store, chart, view controls, words, style) | first press of "Compare with other spacecraft", or when the Decay section comes near with the panel left open |
| `direct-history` (decay history's direct fetch) | first history request that has to ask CelesTrak itself |
| `realism` (with `realism-detail.ts`, `realsky.ts`, `lib/core/moon.ts`) | when the "Realistic" surface is chosen; fetches GIBS tiles only close up |
| `closeup` (craft's pass, glTF loader, card, `state/attitude.svelte.ts`) | first press of the Close-up camera |
| `flight` (flight panel) | first press of "How it flies…" |
| `attitude` (shared pose arithmetic) | shared chunk |
| `uploads` (reader's model panel) | first press of "Your model…" |
| `three.module` | its own chunk, "since the scene and those two share it" — which two is ambiguous in CLAUDE.md; row L72 says the scene and "the two new chunks" (CHANGES-FROM-LEGACY.md#L121); `look-glsl` is likewise shared |
| `models.svelte` (reader's models in IndexedDB) | with the close-up, and by Forget |
| `catcolour` (with `lib/catalogue/classify.ts`) | first choice of a colouring under Layers → Catalogue |
| `satcat` (`data/satcat.json`) | by "By type" and "By purpose" only |
| test facade | only when `window.__GT_TEST__` is set; must not be in the entry (CLAUDE.md#L17) |

Two notes from the same paragraph: the report's chunk holds only the comparison's button, its two sentences and the import, and imports nothing of `DecayCompare`; and CelesTrak's page reader lives in the `lifetime` chunk, which the first screen fetches anyway, because as a chunk of its own it cost the first screen more than its ceiling allowed (CLAUDE.md#L16; also CHANGES-FROM-LEGACY.md#L119).

## The import rule

A lazy chunk must import nothing from the entry — not `app`, not `globe-state`, not `ui/Rich.svelte` — or the bundler splits the entry's shared modules into chunks of their own; so, for instance, the close-up is handed the globe and the app in `attach()` (CLAUDE.md#L16). A Svelte feature used only by a lazy component (the instructions cite `{#await}` and `bind:value` on a select) still lands in `index-client`, which counts toward the entry (CLAUDE.md#L16). The ledger shows the rule's consequence: when the lifetime chunk lost its last import from the entry, the bundler's dynamic-import helper moved to a new `rolldown-runtime` chunk, which `index.html` preloads and `verify-visitor` counts in the entry (CHANGES-FROM-LEGACY.md#L119). This rule is separate from, but sits alongside, the [[layer-dependency-rule]].

## Current figures

Per CLAUDE.md (CLAUDE.md#L16):

- The entry is ~90.7 KB gzipped in four files — `index`, `index-client`, `rich` and `rolldown-runtime` — given as 90.66 with L76's choices, leaving 1.3 KB under the budget.
- The budget is **92 KB** (`ENTRY_BUDGET` in `verify-visitor.js`), 90 KB until L72; it binds.
- The first screen's JavaScript has a ceiling 5 % over the **327.9 kB** it was re-measured at with L71–L73.
- Anything added to the entry, the scene, the lifetime chunk or the Decay panel's chunks must be paid for there.

## History from the ledger

Figures as each row states them (units as written; the ledger mixes "KB" and "kB"):

| Row (file line) | Entry | Budget / ceiling stated |
|---|---|---|
| L34 (CHANGES-FROM-LEGACY.md#L89) | 83 KB gzipped | budget 90 |
| L18 (CHANGES-FROM-LEGACY.md#L73) | main chunk 85 KB gzipped | under its 90 KB budget |
| Q (CHANGES-FROM-LEGACY.md#L43) | — | ceilings 5 % above measurement; 90 KB budget "not asserted, not met yet" |
| L55 (CHANGES-FROM-LEGACY.md#L110) | 87.15 → 87.60 kB, then 87.81 kB | had been 163 bytes over the old 5 % ceiling on 83,274 bytes; that ceiling re-based to 92.0 kB, "the 90 KB budget … is the one that binds" |
| L56 (CHANGES-FROM-LEGACY.md#L111) | 87.81 → 88.14 kB | within 90 KB |
| L57 (CHANGES-FROM-LEGACY.md#L112) | 88,144 → 88,547 bytes | within 90 KB |
| L58 (CHANGES-FROM-LEGACY.md#L113) | 88,547 → 88,776 bytes | within 90 KB |
| L59 (CHANGES-FROM-LEGACY.md#L114) | 88,778 → 88,982 bytes | within 90 KB |
| L60 (CHANGES-FROM-LEGACY.md#L115) | 89,356 bytes | within 90 KB |
| L61 (CHANGES-FROM-LEGACY.md#L116) | 89,352 → 89,643 bytes | within 90 KB |
| L66 (CHANGES-FROM-LEGACY.md#L117) | 89,738 bytes | first screen 324.63 kB of 324.8 kB allowed |
| L68 (CHANGES-FROM-LEGACY.md#L119) | 89,582 B in four files (89,735 B in three before) | first screen 324.75 kB, ceiling 324.8 kB; the 90 KB budget "had 265 B left" before the move |
| L72 (CHANGES-FROM-LEGACY.md#L121) | 90.0 kB | budget raised 90 → 92 KB at the owner's decision; first screen re-measured at 327.9 kB |

Small discontinuities between consecutive rows (e.g. 88,776 then 88,778; 89,356 then 89,352) are as written in the ledger.

## Discrepancies

- Row Q's "not asserted, not met yet" (CHANGES-FROM-LEGACY.md#L43) predates the later rows and conflicts with CLAUDE.md's statement that `verify-visitor.js` holds the entry to the budget (CLAUDE.md#L16).
- CLAUDE.md's 90.66 KB figure "with L76's choices" (CLAUDE.md#L16) is not restated in row L76, which says only that the entry holds the radios, the key's branch and the controller (CHANGES-FROM-LEGACY.md#L125).

## Related

- [[test-facade]] — the lazy chunk that must never reach the entry
- [[verification-harness]] — `verify-visitor` and its weight checks
- [[change-ledger]] — where each change's byte cost is recorded
- [[decay-comparison]], [[realistic-globe]], [[close-up-camera]], [[reader-uploaded-models]], [[catalogue-colouring]], [[satellite-aliases]], [[decayed-objects]] — features delivered as lazy chunks
