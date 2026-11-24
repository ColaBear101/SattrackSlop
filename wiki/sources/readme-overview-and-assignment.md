---
type: source
title: "README: overview, the assignment, and parts (a)–(c)"
authors: ["SattrackSlop project"]
raw: "README.md#L1-L694"
snapshot: "4ce1719 + uncommitted working-tree edits (2026-11-24)"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [earth-console, orbital-mechanics, data, verification, architecture]
entities: [knacksat-2, celestrak]
concepts: [tle-two-line-element-set, sgp4-propagation, brouwer-vs-kozai-mean-motion, ground-track, pass-prediction, assignment-snapshot-tle-embedded, independent-reference-checks]
---

# README: overview, the assignment, and parts (a)–(c)

The first 694 lines of `README.md` hold two things: a short public front page for the Ground Track Console (what it does, how to run it, privacy, where the code lives), and the opening of the folded-away technical README, which restates the coursework assignment the project began as and works its three parts — (a) orbital elements, (b) ground track, (c) visibility from Bangkok — for the spacecraft [[knacksat-2]], ending with how those Earth numbers are independently checked. It is one section of the parent source [[sattrackslop-readme]].

## Front page (L1–L107)

- **Pitch.** Pick a satellite, see where it is, where it goes and when it is above your horizon (README.md#L5). The project began as a coursework assignment — read a TLE, report the elements, plot a day of ground track, total the time above 5° elevation from Bangkok — and grew into a small console. Everything is computed in the browser, with no account, no analytics or cookies of its own, and nothing to install (README.md#L15).
- **What you can do** (README.md#L17-L28). Search 2,158 spacecraft by name, NORAD number or another name (README.md#L19); passes grouped by the observer's own day with sunrise/sunset and a filter (README.md#L20); a 3D globe and flat map with a clock up to 3,600× (README.md#L21); a realistic globe and a close-up camera with models of KNACKSAT-2 or the ISS (README.md#L22); a settable observer including Maidenhead grid squares (README.md#L23); CSV and calendar export, and shareable URLs (README.md#L24); the orbit planner and [[the-professor]] (README.md#L25); decay estimates and comparison (README.md#L26); the AR sky view, radar and Snap (README.md#L27); Doppler and naked-eye verdicts (README.md#L28).
- **Try it** (README.md#L38-L49). Deep links such as `/?sat=25544`, `/?sat=25544&span=72&tab=map`, `/?site=35.6762,139.6503`, and `/?tle=embedded` — the [[assignment-snapshot-tle-embedded]] (README.md#L44-L47) — plus keyboard shortcuts (README.md#L49).
- **Run it yourself** (README.md#L51-L62). Node 22.12 or newer (20.19 can build and preview but not run `npm run dev` or the tests) (README.md#L53). `npm ci`, `npm run dev` (port 5173), `npm run build`, `npm run preview` (port 4173) (README.md#L55-L60). The built page is static files; the Elysia cache API in `server/` is optional, and without it the page asks [[celestrak]] directly (README.md#L62).
- **How it works, in a paragraph** (README.md#L64-L66). The page reads a TLE, runs [[sgp4-propagation]] (via satellite.js) every few seconds over the window, computes elevation and azimuth from the observer, finds the stretches above the 5° mask and totals them. three.js draws the globe; the UI is Svelte 5 and TypeScript built with Vite (README.md#L66).
- **Can you trust the numbers?** (README.md#L68-L70). The site is a rebuild of an original single-file page whose numbers did not change: `npm run gate` compares 67,488 computed values (38 spacecraft, Bangkok, 24 h and 72 h) with a baseline from the old page using `===` and must print `BIT-IDENTICAL` (README.md#L70). See [[regression-gate]]. Thirty-three more stages run under `npm run test:all`, including an independent second implementation of the orbit maths ([[independent-reference-checks]]). The old page is kept at the git tag `legacy-earth-console` ([[legacy-earth-console]]).
- **Data and privacy** (README.md#L72-L88). The Earth console loads no third-party assets; the two Moon pages still use cdnjs and Google Fonts (README.md#L74). A table lists who is asked and when: element sets from the cache API or [[celestrak]] (fallback `tle.ivanstanojevic.me`) on display and every 3 hours, never for a designed orbit or under `?tle=embedded`; decay histories; Open-Meteo for place names; NASA GIBS for yesterday's clouds and close-up Blue Marble tiles (README.md#L76-L82). Grid squares are resolved on the page (README.md#L84). What the page keeps stays in the browser, and *Forget what this page stored* removes it (README.md#L86) — see [[forget-data]]. Camera, sensors and location are used only on request; Snap is the only way the camera picture leaves, and only to the user's share sheet or a download (README.md#L88).
- **Where things are** (README.md#L90-L100) — a directory table pointing at `src/`, `server/`, `data/`, `public/`, `verification/`, `CHANGES-FROM-LEGACY.md` ([[change-ledger]]) and `CLAUDE.md` ([[project-working-rules]]).
- The technical README is folded inside a `<details>` block, described as "about 3,600 lines" and written with AI assistance (README.md#L104-L107).

## Technical README opening (L109–L333)

- **Restated scope.** The assignment, and the remark that the engine now also runs a Moon-centred console and an Earth–Moon libration-point view, because the central body was the only Earth-specific thing (README.md#L111-L116) — see [[central-body-seam]].
- **Build and fetches.** The Earth console is a Svelte 5 + TypeScript app built with Vite 8 and cannot be opened from disk; the Moon pages are plain scripts in `public/` and still can (README.md#L124-L133). A bulleted inventory of what each page fetches, on load and only when asked (README.md#L135-L167): satellite.js 6.0.1 and three.js r128 are bundled from npm on the Earth page and pinned by hash; element sets come from the cache API `/api/tle/<n>` or CelesTrak's `gp.php` with the mirror as fallback, reused for three hours with failures retried after five minutes (README.md#L141-L149); histories from `/api/history/<n>` or CelesTrak's `graph-orbit-data.php` (README.md#L150-L153). See [[live-element-refresh]] and [[data-provenance]].
- **What's here** (README.md#L169-L318). Three pages over one shared core in two forms — classic scripts in `public/core/` (lunar page) and the TypeScript port in `src/lib/core/` (Earth console), held bit-for-bit equal by `tests/lib/core-equivalence.test.ts` (README.md#L171-L174). A long annotated directory tree follows (README.md#L177-L312), including `body.ts` (central-body properties), `propagator.ts` (SGP4 for Earth TLEs), the planner files, the AR modules, the scene, `server/`, `data/` (catalogue.txt with its 2,158 element sets, README.md#L276), scripts, tests and `verification/`. The one-way dependency graph is enforced by `npm run check:deps` (README.md#L314-L318) — see [[layer-dependency-rule]].
- **Status** (README.md#L320-L332). The Earth console is the finished piece, held to the bit-identical gate on every change (README.md#L322-L323). Both Moon pages are marked *testing*: not covered by the gate, ephemerides baked at build time because Horizons sends no CORS header, positions agreeing with Horizons to about 1.5 km near a daily anchor and tens of km between, and two of five spacecraft without a published ephemeris; each page shows its own staleness (README.md#L325-L332). See [[earth-moon-page]] and [[lunar-track-console]].

## The assignment and the satellite (L334–L423)

- **The brief.** Select a satellite from CelesTrak's Earth Resources group, report its elements, plot a day of ground track, total its visibility from Bangkok above a 5° mask (README.md#L336-L338).
- **KNACKSAT-2 is outside the brief.** The worked example uses [[knacksat-2]] (NORAD 67683, 1998-067XZ), which is not in that group: `verification/fixtures/resource.txt`, a copy of the group's 167 element sets, has no entry for it, and it entered the catalogue from SatNOGS (README.md#L343-L353). It remains the page's default.
- **The element set and epoch.** The three-line TLE is quoted, with epoch 2026-09-12 07:29:09.993 UTC (README.md#L355-L361). Every README figure is computed from that set with the window opening at its epoch; the live page fetches a newer set and opens at the reader's clock, so its numbers differ by design (README.md#L363-L367) — see [[tle-two-line-element-set]] and [[assignment-snapshot-tle-embedded]].
- **The picker and the watchlist** (README.md#L378-L423). Search ranking (prefix, then contains, then word-by-word matching, then other names from SatNOGS DB — see [[satellite-aliases]]), Unicode handling, the *decayed now* mark ([[decayed-objects]]), and a star-toggled watchlist of up to 50 spacecraft stored under `gt.watch` (README.md#L418-L421).

## (a) Orbital elements at epoch (L425–L499)

A table of the six elements with their TLE column sources (README.md#L427-L434). Five are read literally; the semi-major axis is SGP4's Brouwer value, 6741.908 km, recovered from the TLE's Kozai mean motion, against a naive Kepler-third-law 6741.396 km (README.md#L441-L457) — explained in [[brouwer-vs-kozai-mean-motion]]. All six are SGP4 mean elements, not osculating ones; the osculating orbit at epoch has a = 6747.93 km (README.md#L436-L439, L463-L470). Derived figures — nodal period 91.75 min, altitude 358.0–383.8 km — are measured from the propagation (README.md#L472-L479), with a fallback "Kepler period" for near-equatorial deep-space objects (README.md#L485-L496). The drag term `ndot = .00056149` means the set goes stale fast (README.md#L498-L499).

## (b) Ground track (L501–L531)

24 h from epoch at 10 s steps (8641 points) on an equirectangular map, TEME → ECEF → geodetic on WGS-84, with Bangkok-visible segments overdrawn (README.md#L503-L507). The track spans ±51.8° geodetic latitude (README.md#L509-L512), and the inclination card explains how the track's reach differs from i, including deep-space drift of the mean inclination (README.md#L514-L531). See [[ground-track]].

## (c) Visibility from Bangkok (L533–L651)

899.7 s (14.99 min, 1.04 % of the day) over 2 passes, with a pass table (README.md#L535-L540). Method: 4 s scan, crossings bisected to 1 ms (README.md#L545-L548); window-edge passes marked `*`; countdown searching 48 h beyond the window (README.md#L554-L560); passes grouped by local day with Sun times checked against NOAA (README.md#L562-L584); grey/ringed rows for flown passes (README.md#L586-L595); a display-only filter (README.md#L597-L618); a live sky plot (README.md#L620-L646). Geometry only, no refraction — which at 5° would add about 8.4 s (README.md#L648-L651). See [[pass-prediction]], and for the naked-eye and Sun parts [[sunlit-visibility]].

## How the Earth numbers are checked (L653–L694)

An independent second implementation cross-checks element parsing, SGP4's un-Kozai step, topocentric elevation, the visibility total and a 1 s brute-force count (899 s vs 899.7 s), and both sides are pinned to the same satellite.js 6.0.1 bytes (README.md#L655-L690). Command: `npm run build:shims`, then `GT_TARGET=new node verification/suites/verify.js` (README.md#L692-L693). See [[independent-reference-checks]] and [[verification-harness]].

## Notes on the source

- The `<details>` summary calls the technical README "about 3,600 lines" (README.md#L107), but in this snapshot it runs from L106 to L4106, about 4,000 lines; the label looks stale.
- L672 says the visibility total is stable "to 10 milliarcseconds" across scan steps. A total of time is not measured in arcseconds; the unit looks like a slip (milliseconds is the likely intent, though the README does not say so).
- L648-L649 calls the 5° analysis "radio visibility, not naked-eye", while the page also gives a per-pass naked-eye verdict (README.md#L28, L600-L602). The two are consistent — the total is geometric; the verdict is a separate test — but a reader of L648 alone could miss the verdict.

## Where this fits

- Parent: [[sattrackslop-readme]]
- Entities: [[knacksat-2]], [[celestrak]]
- Concepts: [[tle-two-line-element-set]], [[sgp4-propagation]], [[brouwer-vs-kozai-mean-motion]], [[ground-track]], [[pass-prediction]], [[assignment-snapshot-tle-embedded]], [[independent-reference-checks]]
- Touched, owned elsewhere: [[regression-gate]], [[verification-harness]], [[legacy-earth-console]], [[live-element-refresh]], [[data-provenance]], [[satellite-aliases]], [[decayed-objects]], [[sunlit-visibility]], [[forget-data]], [[central-body-seam]], [[layer-dependency-rule]], [[the-professor]], [[earth-moon-page]], [[lunar-track-console]], [[change-ledger]], [[project-working-rules]]
