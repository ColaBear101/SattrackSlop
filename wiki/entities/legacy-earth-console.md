---
type: entity
kind: page
title: "Legacy Earth console (the pre-rewrite page)"
aliases: ["the old page", "legacy", "pre-rewrite Earth console"]
tags: [earth-console, verification, architecture]
sources: [changes-from-legacy, claude-md-project-instructions]
created: 2026-11-24
updated: 2026-11-24
---

# Legacy Earth console (the pre-rewrite page)

The **legacy Earth console** is the static satellite ground-track page that SattrackSlop's current Svelte/TypeScript console replaced. It is the project's oracle: every computed number of the rebuilt page must equal the old page's bit for bit, and every other intentional difference is listed in the ledger (CHANGES-FROM-LEGACY.md#L1-L4). The project's documents usually call it "the old page".

## Where it lives

- It is kept in git at the tag `legacy-earth-console` and checked out next to the working tree with `git worktree add legacy legacy-earth-console`; a suite drives it when run with `GT_TARGET=legacy` (CLAUDE.md#L21). The ledger also points to the tag as the home of the old file (CHANGES-FROM-LEGACY.md#L99).
- The checked-out copy is the `legacy/` folder; the mutation suite for the reader's own orbits edits the text of `legacy/index.html` directly (CHANGES-FROM-LEGACY.md#L41).

## Role as the reference

- The frozen references of the [[regression-gate]] — `baseline.json`, `golden.json` and the `ab3d/` scene references — are written from the old page only (`GT_TARGET=legacy`, `--write`) and never regenerated from the new code (CLAUDE.md#L7). The ledger says the same of the baseline (CHANGES-FROM-LEGACY.md#L29), the prose capture (CHANGES-FROM-LEGACY.md#L39) and the scene capture (CHANGES-FROM-LEGACY.md#L40).
- Several browser suites run against either build: `verify-custom` makes 204 checks on the old page (CHANGES-FROM-LEGACY.md#L41), `verify-planner-ui` 665 (CHANGES-FROM-LEGACY.md#L42), and 120 `verify-ar` checks run on both pages (CHANGES-FROM-LEGACY.md#L44). Suites for features the old page never had (the visitor path, Snap, the realistic globe and others) run on the rebuilt page only; `verify-visitor` exits with status 2 if pointed at the legacy target (CHANGES-FROM-LEGACY.md#L43).
- See [[verification-harness]] for how one suite file drives both builds.

## What the ledger says the old page did

These are characteristics recorded in the ledger as the baseline the rebuild departs from; the wiki has not inspected the old code.

- **Delivery.** It could be opened from `file://` and loaded scripts from cdnjs (CHANGES-FROM-LEGACY.md#L15, CHANGES-FROM-LEGACY.md#L28). Its script was one file of about 270 KB gzipped (CHANGES-FROM-LEGACY.md#L89); in the row on the orbit planner the ledger notes that it loaded five scripts before the first paint, and that the planner was about 150 KB of its script (CHANGES-FROM-LEGACY.md#L83). It fetched the city-lights mosaic from NASA GIBS on every start (CHANGES-FROM-LEGACY.md#L98).
- **Known defects.** A zero-padded NORAD id hid the downlinks of 20 low-numbered satellites (CHANGES-FROM-LEGACY.md#L12); its network timer stopped at the headers, so a stalled body could hang an element-set check (CHANGES-FROM-LEGACY.md#L19); the downlink controls could keep showing the previous spacecraft's options (CHANGES-FROM-LEGACY.md#L74).
- **Models.** It carried four Sun models; the rebuild keeps the globe's own series for its light rather than unify them, to stay pixel-identical (CHANGES-FROM-LEGACY.md#L13).
- **Interface.** Controls spread over seven overlays (CHANGES-FROM-LEGACY.md#L56); 15 type sizes with about 57 rules at 11 px (CHANGES-FROM-LEGACY.md#L60); the theme followed the system with no override (CHANGES-FROM-LEGACY.md#L59); the globe was on top and the map in the report (CHANGES-FROM-LEGACY.md#L75); it raised an "Outside the brief" notice while [[knacksat-2]] was on screen, since removed on the owner's instruction (CHANGES-FROM-LEGACY.md#L97).
- **Globe defaults.** It opened with a 6 h trail and the catalogue, footprint and observer pin switched on; the rebuilt page opens plain, and the [[test-facade]] restores the old switches for parity suites (CHANGES-FROM-LEGACY.md#L129, CLAUDE.md#L17). It drew the catalogue in one colour, which remains the rebuilt default (CHANGES-FROM-LEGACY.md#L125).
- **Absent features.** It had no AR radar and no Snap (CHANGES-FROM-LEGACY.md#L100, CHANGES-FROM-LEGACY.md#L46), and no lazy chunks, so the visitor-path suite has nothing to compare against (CHANGES-FROM-LEGACY.md#L43).
- **A suite fault it carried.** The old `verify-ar` failed two checks on days when the window's highest pass peaked near the zenith; the ledger classes this as pre-existing, not caused by the rewrite, and fixed it in the suite (CHANGES-FROM-LEGACY.md#L35).

## Related

- [[change-ledger]] — how departures from this page are recorded
- [[changes-from-legacy]] — the ledger itself
- [[verbatim-ports]] — old code carried over with its arithmetic order intact
