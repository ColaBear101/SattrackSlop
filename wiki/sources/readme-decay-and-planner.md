---
type: source
title: "README: Orbital decay and the orbit planner"
authors: ["SattrackSlop project"]
raw: "README.md#L1870-L2678"
snapshot: "4ce1719 + uncommitted working-tree edits (2026-11-24)"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [decay, planner, earth-console, orbital-mechanics, verification]
entities: [orbit-planner, the-professor, knacksat-2, celestrak]
concepts: [orbital-decay-forecast, decay-comparison, elements-to-tle-conversion, drag-area-over-mass, tle-two-line-element-set, sgp4-propagation, brouwer-vs-kozai-mean-motion, assignment-snapshot-tle-embedded, regression-gate]
---

# README: Orbital decay and the orbit planner

Two adjacent sections of the project `README.md` (part of [[sattrackslop-readme]]). The first, *Orbital decay and remaining life*, explains how the Earth console forecasts when a catalogue spacecraft runs out of altitude, how well that forecast does against real re-entries, what it refuses to answer, and the multi-spacecraft comparison panel. The second, *Your own orbits: the planner and the Professor*, describes the [[orbit-planner]], which turns typed orbital elements into a two-line element set the rest of the console runs on, and [[the-professor]], a panel of worked advice about an orbit; it closes with an inventory of what is and is not checked.

## Orbital decay and remaining life (L1870–L2153)

- **Motivation.** [[knacksat-2]] is losing altitude: [[celestrak]]'s record shows mean altitude falling from 418.6 km to 362.9 km between 5 Feb and 13 Sep 2026, 55.7 km in 220 days and accelerating (README.md#L1872-L1875).
- **Where the history comes from.** CelesTrak's `graph-orbit-data.php` page embeds every mean element set it has held in a `plotData` string (534 rows for KNACKSAT-2); its "SMA" column is actually mean altitude (README.md#L1879-L1882). The page asks its own cache API (`/api/history/<id>`) first and CelesTrak directly otherwise, parsed by one shared function, `shared/plot.ts` (README.md#L1887-L1890). Rows are accepted between 80 km and 400,000 km mean altitude; an earlier 60,000 km ceiling wrongly discarded high eccentric orbits such as XMM-NEWTON (README.md#L1897-L1900). Failures are reported as one of six causes, four of which offer a retry (README.md#L1900-L1903). Fetches are slow and unpredictable (2 s to over 90 s observed), so they run only on a button press, with a 75 s give-up and a 12-hour cache (README.md#L1905-L1911).
- **Why not extrapolate the line.** A drag model with an atmosphere shape from a standard table and amplitude calibrated from the object's own history; the absolute density scale cancels, and three implementation choices each changed the answer (README.md#L1913-L1951). See [[orbital-decay-forecast]].
- **How well it works.** A backtest on 24 objects that actually re-entered, by lead time; usable to about four months, months early beyond that (README.md#L1953-L1992).
- **What it refuses to answer.** Boosted objects, no measurable decay, too little history, eccentric orbits (with a perigee-based explanation), and dates already past ("Probably re-entered") (README.md#L1994-L2037).
- **Comparing with other spacecraft.** A lazily loaded panel charting several spacecraft's altitude histories and forecasts on one axis, with strict request limits (README.md#L2039-L2134). See [[decay-comparison]].
- **KNACKSAT-2.** A worked result table: mean altitude 362.9 km, decay rate −0.289 km/day, fitted density trend −0.24 %/day, fixed-atmosphere estimate 2027-02-11, trend estimate 2027-04-16 (README.md#L2138-L2145). An SGP4 B*-based propagation to 120 km gives 2027-06-09 as an independent check, and the backtest's 63-day median bias moves the page's stated month to June 2027 (README.md#L2147-L2152). Detail belongs on [[knacksat-2]].

## Your own orbits: the planner and the Professor (L2154–L2678)

- **Overview.** A typed orbit is treated like a catalogue spacecraft by the globe, ground track, passes, visibility verdict, Doppler card, exports and Decay section; it is exactly what SGP4 makes of the elements, with no thrust, station-keeping or radiation pressure (README.md#L2156-L2165).
- **Opening it.** Six lazy chunks, loaded when idle after the first answer; entry points in the header, picker and answer rail; responsive drawer/panel/dialog layout; form fields and mean-altitude semantics; the console changes only on explicit buttons (README.md#L2167-L2202). See [[orbit-planner]].
- **How the elements become a TLE.** The planner writes ordinary 69-character lines and four measured traps (Kozai vs Brouwer inversion, rounding order, radius and rotation constants, SGP4's lack of validation) (README.md#L2204-L2252). See [[elements-to-tle-conversion]].
- **The placeholder number.** Designed orbits are numbered `O0001` onward in Alpha-5 style, which no real object can carry; identity is a `custom` flag, never the number (README.md#L2254-L2270).
- **Drag: area over mass, not B\*.** The user gives area over mass with Cd fixed at 2.2; B* is matched to the page's atmosphere at the epoch height, with tables comparing SGP4 and the lifetime model (README.md#L2272-L2336). See [[drag-area-over-mass]].
- **The Professor.** A numbers layer (`advisor.ts`) and a words layer (`advisor-copy.ts`) with 87 records, a five-level severity scale, a ladder of certainty, one-click fixes and a single renameable label; it also annotates catalogue spacecraft (README.md#L2338-L2410). See [[the-professor]].
- **Saved orbits.** Stored in `localStorage` under `gt.custom` as typed elements only, at most 12, validated as hostile on read, last-writer-wins across tabs (README.md#L2412-L2451).
- **Decay for a planned orbit.** No history, so the page's atmosphere is run three times (drag ×3, ×1, ×⅓); the result is a duration and a range, never a date (README.md#L2453-L2486). See [[orbital-decay-forecast]].
- **Exports and `?tle=embedded`.** CSV and calendar exports mark designed orbits without adding columns; the [[assignment-snapshot-tle-embedded]] turns the planner off by design (README.md#L2488-L2504).
- **What is checked, and what is not.** Node suites `verify-planner.js` (665 checks) and `verify-advisor.js` (392 checks), page suites `verify-custom.js` (208 checks in 24 groups), `verify-planner-ui.js` and `verify-visitor.js`, mutation testing, Vitest unit tests, and a list of explicit limits; the [[regression-gate]] still reads `BIT-IDENTICAL` on all 67,488 values with the planner loaded (README.md#L2506-L2677).

## Where this fits

- [[orbital-decay-forecast]] — the calibrated forecast for catalogue objects and the assumed band for planned orbits.
- [[decay-comparison]] — the compare-with-other-spacecraft panel.
- [[orbit-planner]] — the planner as a feature: opening, form, saved orbits, placeholder numbers, exports, checks.
- [[the-professor]] — the advice panel.
- [[elements-to-tle-conversion]] — how typed elements become a valid TLE.
- [[drag-area-over-mass]] — area-over-mass input and the matched B*.
- [[knacksat-2]], [[celestrak]] — the worked example and the history source.
- [[tle-two-line-element-set]], [[sgp4-propagation]], [[brouwer-vs-kozai-mean-motion]] — the underlying element and propagation concepts.
- [[assignment-snapshot-tle-embedded]], [[regression-gate]] — the snapshot mode that disables the planner, and the gate it leaves untouched.
