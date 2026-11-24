---
type: source
title: "CHANGES-FROM-LEGACY.md: the ledger of differences from the pre-rewrite Earth console"
authors: ["SattrackSlop project"]
raw: "CHANGES-FROM-LEGACY.md#L1-L134"
snapshot: "4ce1719 + uncommitted working-tree edits (2026-11-24)"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [verification, architecture, earth-console, meta]
entities: [legacy-earth-console, verification-harness, knacksat-2, celestrak, orbit-planner]
concepts: [change-ledger, verbatim-ports, lazy-chunks-and-entry-budget, test-facade, regression-gate, layer-dependency-rule, assignment-snapshot-tle-embedded, live-element-refresh, ar-radar, ar-snap, realistic-globe, close-up-camera, reader-uploaded-models, spacecraft-attitude, catalogue-colouring, decay-comparison, forget-data, doppler-and-transmitters, sunlit-visibility, satellite-aliases, decayed-objects, page-navigation-and-accessibility]
---

# CHANGES-FROM-LEGACY.md: the ledger of differences from the pre-rewrite Earth console

`CHANGES-FROM-LEGACY.md` is the project's ledger of every intentional difference between the rebuilt Earth console (Svelte 5 + TypeScript + Vite) and the old static page it replaced, the [[legacy-earth-console]]. Its premise is stated in its first lines: the rewrite keeps every computed number identical (`npm run gate` must print BIT-IDENTICAL) and otherwise changes only what is listed; anything that differs from the old page and is not on the list is a bug (CHANGES-FROM-LEGACY.md#L3-L4). The file is about 39,000 words in only 134 lines, because each row is a single Markdown table line, some of them more than 16,000 characters long (row L66, CHANGES-FROM-LEGACY.md#L117). How the ledger works as a process is described on [[change-ledger]].

## A note on citations

Two numbering schemes collide in this file. **Row ids** (`1`–`11`, `A`–`X`, `L1`–`L85`) are the ledger's own names for its entries; **file line numbers** are what this wiki's citations use. They are not the same: row L18 sits on file line 73, so it is cited `(CHANGES-FROM-LEGACY.md#L73)`. Where the difference matters, pages in this wiki write both, e.g. "row L18 (CHANGES-FROM-LEGACY.md#L73)". For the look-and-interface table, row L*n* is on file line 55 + *n* for L1–L61; from L66 on the offset changes (L66 is line 117, L71 is line 120, L85 is line 134).

## Structure

| File lines | Section | Row ids | Columns |
|---|---|---|---|
| L1–L6 | Title and preamble: the one rule and the status words | — | — |
| L8–L22 | **Behaviour and data** | numbered rows 1–11 | Change, Why, Status |
| L24–L50 | **Verification** | lettered rows A–K, M–X (there is no row L in this table) | Change, Why (status only occasionally, in the Change or Why text) |
| L52–L134 | **Look and interface** | L1–L61, L66–L68, L71–L85 | Change, Why, Status |

The status vocabulary is **applied** (in the code now) and **planned** (decided, not yet made) (CHANGES-FROM-LEGACY.md#L6). In this snapshot no row is marked planned; besides "applied" the ledger uses "declined" (row 2, CHANGES-FROM-LEGACY.md#L13) and "superseded" (row 11, CHANGES-FROM-LEGACY.md#L22), and many later rows qualify "applied" with "(new in the rebuild, not a regression; the README's …)" plus a pointer to the README section that documents the feature (CHANGES-FROM-LEGACY.md#L100-L126).

Rows **L62–L65 and L69–L70 are absent** from this file. The project instructions say those rows live on other branches (CLAUDE.md#L3); the ledger itself does not say so.

Milestone tags M6–M9 appear in several statuses and explanations (for example "applied (M6)" in row K, CHANGES-FROM-LEGACY.md#L38; "Fixed (M8)" in row H, CHANGES-FROM-LEGACY.md#L35; "declined at M9" in row 2, CHANGES-FROM-LEGACY.md#L13). The milestones themselves are not defined in the ledger.

## Behaviour and data (rows 1–11, CHANGES-FROM-LEGACY.md#L8-L22)

Eleven rows covering computation inputs, networking and data:

- **Row 1** fixes a verified bug: transmitter lookup now uses the NORAD id as a number; the old page passed a zero-padded id to a table keyed without padding, so 20 satellites with NORAD numbers below 10000 never showed their downlink (CHANGES-FROM-LEGACY.md#L12). See [[doppler-and-transmitters]].
- **Row 2** proposed one Sun model in place of the old code's four (the 3D light omitted an obliquity-rate term, about 0.004°); it was **declined at M9** so the globe's light stays pixel-identical to the old page under the scene-parity check (CHANGES-FROM-LEGACY.md#L13).
- **Rows 3 and 11**: the 2012 city-lights mosaic is shipped with the page instead of fetched from NASA GIBS on every start; row 11 recorded the interim state and is superseded by L43 (CHANGES-FROM-LEGACY.md#L14, CHANGES-FROM-LEGACY.md#L22).
- **Rows 4–5**: `file://` opening is dropped for the Earth console (the Moon pages still open from disk); no request goes to Google Fonts, cdnjs or any CDN, with satellite.js 6.0.1 and three r128 bundled from npm at exact versions (CHANGES-FROM-LEGACY.md#L15-L16).
- **Row 6**: `?tle=embedded` is unchanged and fully offline, reproducing the README figure for [[knacksat-2]] of 899.7 s over 2 passes (CHANGES-FROM-LEGACY.md#L17). See [[assignment-snapshot-tle-embedded]].
- **Rows 7–10**: the page asks its own data-cache API first and [[celestrak]] directly only when no API answers as itself; deadlines cover the response body; the API refuses implausible or backward element sets and never serves stale records; a structured 504 from the API stops a second 70 s wait (CHANGES-FROM-LEGACY.md#L18-L21). See [[live-element-refresh]].

## Verification (rows A–X, CHANGES-FROM-LEGACY.md#L24-L50)

These rows record how the old test suites were ported to the rebuilt page and which new suites were added. They are the main ledger material for [[verification-harness]], [[regression-gate]] and [[test-facade]].

- **A–G, porting mechanics** (CHANGES-FROM-LEGACY.md#L28-L34): suites open the page over http through `verification/lib/harness.js`; `regress.js`/`snapshot.js` run in-process and the baseline can be rewritten only from the legacy target; `gate:lib` runs in Chromium because the same bundle in Node 23.5 differs in 364 values by up to 1e-14; a few module-irrelevant checks are skipped "out loud"; `npm test` is replaced by `verification/run.js`.
- **H** (CHANGES-FROM-LEGACY.md#L35): a pre-existing, date-dependent `verify-ar` failure fixed at M8 by giving the suite its own clock (2026-09-13T00:00Z, the numeric baseline's instant).
- **I–K** (CHANGES-FROM-LEGACY.md#L36-L38): new picture and axe tools; harness helpers that let one suite file drive both builds; scene-dependent checks restored at M6.
- **M, prose parity** (CHANGES-FROM-LEGACY.md#L39): `golden.js` captures the report's words from the old page for 38 spacecraft × {24 h, 72 h} × 3 observers into a 2.2 MB `golden.json`; intended differences go in `golden-diffs.json` with reasons.
- **N, scene parity** (CHANGES-FROM-LEGACY.md#L40): `ab3d.js` captures the old 3D scene in 16 states and compares the rebuilt one exactly (scene-graph floats to 1e-6, then pixels tile by tile).
- **O–R, suites run on both builds** (CHANGES-FROM-LEGACY.md#L41-L44): `verify-custom` (204 checks on the old page, 209 on the new, plus a mutation runner), `verify-planner-ui` (665 and 682), the new `verify-visitor` (166 checks, rebuilt page only) and `verify-ar` (120 on both, 278 on the rebuilt page). Each row lists, with reasons, every expectation that reads differently on the rebuilt page.
- **S** (CHANGES-FROM-LEGACY.md#L45): two layout regressions found at 360 px and fixed.
- **T–X, new suites for new features** (CHANGES-FROM-LEGACY.md#L46-L50): `verify-ar-snap` (79 checks), `verify-realism`, `verify-closeup`, `verify-models`, `verify-catcolour` (which holds all 6,474 colour values to the old page's with `===` by default).

## Look and interface (rows L1–L85, CHANGES-FROM-LEGACY.md#L52-L134)

The largest table. The row leads were read for this page; the bodies of the longest rows were sampled rather than read in full. Grouped by theme (rows are not in theme order in the file):

| Theme | Rows | File lines |
|---|---|---|
| Console shell: Stage + Answer rail + transport, breakpoints, Window popover, theme toggle, type scale, keys, wall-clock ages, event handling | L1–L13 | L56–L68 |
| Written report: section order, no second map, wording, Terms search, downlink leftovers; report as a lazy chunk | L14–L17, L19, L34 | L69–L72, L74, L89 |
| Decay section as a lazy chunk | L18 | L73 |
| Globe and scene: globe as first tab, camera and trail rows, idle drawing, catalogue update cadence, sky as its own chunk | L20–L24 | L75–L79 |
| Spacecraft picker: notes as sentences, pill placement, Plan row, keyboard behaviour | L25, L29, L33, L40 | L80, L84, L88, L95 |
| Orbit planner: drawer layout, rail hidden while open, planner as lazy chunks, custom orbits never in `?sat=` | L26–L28, L32 | L81–L83, L87 |
| AR view, radar, radar view, aim switch, Snap | L30, L45–L48 | L85, L100–L103 |
| Address bar, history and observer persistence | L31, L37 | L86, L92 |
| Parity-walk differences: finding the report and Moon pages, epoch warning, load failures, identity line, small kept differences, "Outside the brief" notice removed | L35–L36, L38–L39, L41–L42 | L90–L91, L93–L94, L96–L97 |
| City lights shipped; layout-suite fixes | L43, L44 | L98, L99 |
| Footer credit and the Forget button | L49–L50 | L104–L105 |
| Observer grid square, live Doppler line, sunlit-now block, live sky-plot dot, pass list by day, pass filter, one-pass calendar | L51–L57 | L106–L112 |
| Picker search tiers, "decayed now", watchlist, other names | L58–L61 | L113–L116 |
| Decay comparison | L66–L68 | L117–L119 |
| Realistic globe: surface, sharp close-up map, sky, star exposure, Thailand clouds | L71, L74, L75, L83, L84 | L120, L123, L124, L132, L133 |
| Close-up camera, reader's own models, how the model flies | L72, L73, L77 | L121, L122, L126 |
| Catalogue colouring | L76 | L125 |
| Globe size and defaults: full screen, pin switch, plain opening, countdown first, answer-panel order, transport in full screen | L78–L82, L85 | L127–L131, L134 |

Rows L45–L61 and L66–L77 are marked as new features rather than regressions and point to the README section that documents each (CHANGES-FROM-LEGACY.md#L100-L126); L78–L85 are marked "new in the rebuild" without a README pointer (CHANGES-FROM-LEGACY.md#L127-L134).

## Recurring patterns across rows

- **Budget accounting.** Many rows state how many gzipped bytes they added to the entry chunk and whether the first screen's JavaScript stayed under its ceiling, which makes the ledger the history of the [[lazy-chunks-and-entry-budget]] (e.g. CHANGES-FROM-LEGACY.md#L110-L119, CHANGES-FROM-LEGACY.md#L121).
- **Parity guards.** Rows that change anything the golden capture or the ab3d scene reads say so, and new page elements are placed where those captures do not look (e.g. "no element in it has a class or id the golden capture reads", CHANGES-FROM-LEGACY.md#L107).
- **Marked edits to ported code.** Rows name the `CHANGED (Lnn)` markers placed in ported files such as `orbit3d.ts`, `globetex.ts` and `arview.ts` (CHANGES-FROM-LEGACY.md#L100, CHANGES-FROM-LEGACY.md#L120-L128). See [[verbatim-ports]].
- **Owner decisions.** Several rows record that a change, download or budget increase was made at the owner's request or with the owner's approval (CHANGES-FROM-LEGACY.md#L14, CHANGES-FROM-LEGACY.md#L97, CHANGES-FROM-LEGACY.md#L121, CHANGES-FROM-LEGACY.md#L129).
- **Test-surface adjustments.** Rows note when the test-only surface had to gain a getter or set the old page's defaults so parity suites still compare like with like (CHANGES-FROM-LEGACY.md#L107-L108, CHANGES-FROM-LEGACY.md#L129). See [[test-facade]].

## Internal tensions noted while reading

- Row Q states that the 90 KB entry budget "is **not** asserted, it is not met yet" (CHANGES-FROM-LEGACY.md#L43), while later rows say the 90 KB budget "binds" (CHANGES-FROM-LEGACY.md#L110), row L72 raised it to 92 KB (CHANGES-FROM-LEGACY.md#L121), and CLAUDE.md says `verify-visitor.js` holds the entry to 92 KB (CLAUDE.md#L16). Row Q's sentence appears stale.
- Row I says the legacy page's axe count "has not been measured yet" (CHANGES-FROM-LEGACY.md#L36); whether that is still true is not stated elsewhere in the ledger.
- Row B names the baseline-rewrite flag `--write-baseline` (CHANGES-FROM-LEGACY.md#L29); CLAUDE.md says `--write` (CLAUDE.md#L7).

## Where this fits

- Process and conventions: [[change-ledger]], [[project-working-rules]], [[claude-md-project-instructions]]
- The old page and the test apparatus: [[legacy-earth-console]], [[verification-harness]], [[regression-gate]], [[test-facade]]
- Architecture: [[verbatim-ports]], [[lazy-chunks-and-entry-budget]], [[layer-dependency-rule]]
- Features whose differences the ledger records: [[assignment-snapshot-tle-embedded]], [[live-element-refresh]], [[doppler-and-transmitters]], [[ar-radar]], [[ar-snap]], [[realistic-globe]], [[close-up-camera]], [[reader-uploaded-models]], [[spacecraft-attitude]], [[catalogue-colouring]], [[decay-comparison]], [[forget-data]], [[sunlit-visibility]], [[satellite-aliases]], [[decayed-objects]], [[page-navigation-and-accessibility]]
- Entities: [[knacksat-2]], [[celestrak]], [[orbit-planner]]
- Parent account of the project: [[sattrackslop-readme]]
