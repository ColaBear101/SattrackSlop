---
type: source
title: "SattrackSlop README (Ground Track Console)"
authors: ["SattrackSlop project"]
url: "https://sattrackslop.vercel.app"
raw: "README.md#L1-L4106"
snapshot: "4ce1719 + uncommitted working-tree edits (2026-11-24)"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [earth-console, meta]
entities: [knacksat-2, celestrak, earth-moon-page, lunar-track-console, legacy-earth-console]
concepts: [regression-gate, sgp4-propagation, data-provenance, forget-data]
---

# SattrackSlop README (Ground Track Console)

The project's `README.md` is its long account: a short public front page (lines 1–107) followed by a folded "full technical README" of about 3,600 lines (README.md#L102-L107). At 4,106 lines and ~55,000 words it is too large for one source page, so it is ingested as five section pages, listed below. This page is the parent: it summarises the front matter and maps line ranges to section pages.

## Front matter (README.md#L1-L107)

- **What it is.** "Ground Track Console": pick a satellite, see where it is and where it goes, and when it is above your horizon (README.md#L5). It started as a coursework assignment — read a Two-Line Element set, report the orbital elements, plot a day of ground track, and total the time above 5° elevation from Bangkok — and grew into a small console (README.md#L15). See [[readme-overview-and-assignment]].
- **How it works.** The page runs SGP4 (via satellite.js) on a satellite's element set every few seconds over the chosen window, computes elevation and azimuth from the observer, finds the stretches above the 5° mask and totals them; the globe is three.js, the page Svelte 5 + TypeScript built with Vite (README.md#L64-L66). See [[sgp4-propagation]], [[pass-prediction]].
- **Trusting the numbers.** It is a rebuild of an original single-file page ([[legacy-earth-console]]) and the numbers did not change: `npm run gate` compares 67,488 computed values (38 spacecraft, from Bangkok, over 24 and 72 hours) with the original exactly and must print `BIT-IDENTICAL`; 33 further stages surround it (README.md#L68-L70). See [[regression-gate]], [[verification-harness]].
- **Data and privacy.** Fonts, maths library and Earth imagery ship with the page; external requests go to the cache API or [[celestrak]] (fallback tle.ivanstanojevic.me), Open-Meteo for place names, and NASA GIBS for clouds and close-up imagery. Everything kept stays in the browser and "Forget what this page stored" removes it (README.md#L72-L88). See [[data-provenance]], [[forget-data]].
- **Where things are.** `src/` console, `server/`+`shared/` optional cache API, `data/` catalogue and tables, `public/` the two Moon pages, `verification/`+`tests/` the checks, plus the ledger and `CLAUDE.md` (README.md#L90-L100). See [[changes-from-legacy]], [[claude-md-project-instructions]].
- **Moon pages.** Linked from the header as "testing": the lunar track console and the Earth–Moon system page (README.md#L7-L9). See [[lunar-track-console]], [[earth-moon-page]].

## Section source pages

| Lines | Section page | Covers |
|---|---|---|
| 1–694 | [[readme-overview-and-assignment]] | Intro, the assignment, orbital elements, ground track, Bangkok visibility, how Earth numbers are checked |
| 695–1190 | [[readme-globe-and-views]] | The 3D globe, catalogue colouring, realistic globe, close-up, attitude, uploaded models, navigation |
| 1191–1869 | [[readme-ar-and-architecture]] | AR sky view, declination, radar, snap; central-body seam; the gate |
| 1870–2678 | [[readme-decay-and-planner]] | Decay histories and forecast, comparison, the planner, the Professor |
| 2679–4106 | [[readme-moon-data-and-radio]] | Moon pages, data provenance, forget, observer, radio visibility, shadow, Doppler, staying current, running it |

## Where this fits

The README is the main narrative source. The ledger [[changes-from-legacy]] records each intentional difference from the old page, and [[claude-md-project-instructions]] records the working rules. The wiki pattern itself is described in [[llm-wiki-idea-file]].
