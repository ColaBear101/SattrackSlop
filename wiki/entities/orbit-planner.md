---
type: entity
kind: tool
title: "Orbit planner"
tags: [planner, earth-console, verification]
sources: [readme-decay-and-planner]
created: 2026-11-24
updated: 2026-11-24
---

# Orbit planner

The **orbit planner** is the Earth console's feature for designing an orbit nobody flies: the reader types orbital elements and the console treats the result like a catalogue spacecraft — globe and ground track, observer passes, naked-eye verdict (on an assumed standard magnitude), Doppler card (which asks for a frequency), both exports and the Decay section (README.md#L2156-L2160). It shares a drawer with [[the-professor]]. It is meant for learning, sizing and comparing orbits; the orbit is exactly what SGP4 makes of the elements, with no thrust, station-keeping or radiation pressure (README.md#L2162-L2165).

## Opening it

The planner is not on the first screen. Its maths, the Professor, the Professor's words, the drag integrator, the form's controller and the form's markup are six lazy chunks; five are fetched when the browser is idle after the first answer, or immediately when the pill is pressed, and the sixth (the drag integrator) is shared with the Decay section (README.md#L2169-L2173). If a chunk cannot be fetched, the pill disappears and the console is unchanged (README.md#L2173-L2177). The old page loaded the planner's five scripts before first paint (README.md#L2177-L2178). See [[lazy-chunks-and-entry-budget]].

Entry points: *Plan an orbit* in the header (*+ Plan* at 1,080 px and below); the picker's *+ Plan a custom orbit…* row; Enter on a search matching nothing (the search becomes the name); and, for a designed orbit, the header's *Custom orbit · edit* chip and *Edit in planner* in the answer rail's *Source* tab (README.md#L2180-L2185). Layout depends on room: a drawer replacing the rail from 901 px wide and 561 px tall, a panel under the globe at 900 px and narrower, or a full-screen dialog when wide but 560 px tall or less (README.md#L2185-L2188).

## The form

The form takes a name, a starting point (the spacecraft on screen, a saved orbit, or one of eleven presets from ISS-like to Molniya and Tundra), the orbit as altitudes, as *a* and *e*, or as a period, plus inclination, node (RAAN or local time of the ascending node), argument of perigee, mean anomaly, an epoch in UTC, and what the craft is (README.md#L2190-L2193). Altitudes are **mean** altitudes, so they can differ from the element card's by kilometres to tens of kilometres (README.md#L2193-L2196). A name already used by a catalogue spacecraft or saved orbit is refused (README.md#L2196).

Typing is never blocked or rewritten, and a starting point fills only the form. The console changes only on *Add to console*, *Update on globe* or *Save as new*; an orbit SGP4 cannot fly is refused with SGP4's own reason (README.md#L2198-L2200). Notes update 160 ms after the last keystroke, and at 500 ms the page's own pass finder runs the draft so the Professor's pass figures match the rail's (README.md#L2200-L2202).

How the elements become a TLE is covered in [[elements-to-tle-conversion]]; the drag input in [[drag-area-over-mass]].

## The placeholder number

A designed orbit gets a catalogue number `O0001`, `O0002` and on, using NORAD's Alpha-5 scheme, which skips the letters I and O, so no real object can carry a number starting with O (README.md#L2256-L2259). Numeric placeholders were rejected because the catalogue already uses thirteen numbers from 98247 to 99416 (README.md#L2259-L2260). Identity is the flag `custom`, never the number: a custom entry carrying 25544 finds no downlink and is not treated as docked to the ISS (README.md#L2262-L2264). Adding an orbit makes zero requests to any host, and `fetchLiveTle` independently refuses anything that is not one to five digits (README.md#L2264-L2267). The counter only grows, stops at `O9999`, and survives an empty list (README.md#L2267-L2269, README.md#L2444-L2446).

## Saved orbits

Orbits are kept in `localStorage` under `gt.custom` as the typed elements only — no lines, number, flag or B* — so the TLE is rebuilt and revalidated on every read (README.md#L2414-L2422). At most 12 orbits and 24 code points of name; the thirteenth Add is refused with nothing evicted (README.md#L2422-L2423). If storage is blocked or full, the orbit works for the visit and the form says it will not be remembered (README.md#L2428-L2429).

`Planner.sanitizeStore` treats stored data as hostile: oversized records are dropped unread, non-JSON or wrong-version records are moved to `gt.custom.bak`, only named fields are read (so a `__proto__` key dies), and names are cleaned of control and bidirectional characters and leading spreadsheet-formula characters (README.md#L2431-L2442). Tabs are last-writer-wins; tombstones were considered and rejected as too much machinery for twelve orbits (README.md#L2446-L2449). The store is per browser and per origin (README.md#L2449-L2451).

## Decay, exports and the snapshot

- **Decay.** No history and no request; the page's atmosphere is run three times and reported as a duration with a range, never a date. See [[orbital-decay-forecast]] (README.md#L2455-L2468).
- **Exports.** No column is added (columns are only ever appended, pinned by `verify-export.js`). The `satellite` column ends ` (custom orbit)`, `norad` is the placeholder, `tle_source` states that nothing was fetched, and the calendar `SUMMARY` starts `[custom orbit] ` (README.md#L2490-L2498).
- **Snapshot.** Under `?tle=embedded` ([[assignment-snapshot-tle-embedded]]) the planner is off by design: none of its five own chunks is fetched, nothing is restored or written, and the *Plan* pill stays but is `aria-disabled` with an explanation (README.md#L2500-L2504).
- **Comparison.** With a planned orbit selected the [[decay-comparison]] panel is put away (README.md#L2113-L2114).

## Verification

The README names several layers (README.md#L2508-L2627):

- `verify-planner.js` — 665 node checks against `satellite.js`, an independent checksum and real element sets; 49 injected faults all caught (README.md#L2511-L2539).
- `verify-custom.js` — 208 in-page checks in 24 groups: zero requests, poisoned stores, blocked storage, the thirteenth Add, the counter, two tabs, chunk failures (README.md#L2571-L2578).
- `verify-planner-ui.js` — drives the form, notes, fixes and saved list across twelve viewports and both colour schemes; `behaviours.json` traces seventy behaviours to their checks (README.md#L2580-L2586).
- `verify-visitor.js` — loads the page without the test flag to confirm the lazy-loading order (README.md#L2590-L2599).
- Mutation testing: 79 guards removed from the old page, and 86 mutants of `src/` via `npm run mutate`, whose first run exposed an unchecked twelve-orbit cap in the cross-tab merge (README.md#L2601-L2616).
- The [[regression-gate]] still reads `BIT-IDENTICAL` on all 67,488 values with the planner loaded (README.md#L2586-L2588).

## Stated limits

No osculating input, maneuvers, thrust, station-keeping, radiation pressure or solar-cycle model; only the orbit on screen is drawn on the globe; no share link, import/export of saved orbits, constellations or sync (README.md#L2651-L2655). `O0001` is not a NORAD number; the epoch runs 2000–2056 (README.md#L2656-L2658). Deep-space orbits far from their epoch are slow to compute, so Add moves the window to the epoch when it is more than 10 days away (README.md#L2659-L2667). Screen readers, Firefox, Safari and real phones were not tried (README.md#L2670-L2673). The README directs mission analysis to tools such as GMAT or STK (README.md#L2677).

## Related

- [[the-professor]], [[elements-to-tle-conversion]], [[drag-area-over-mass]], [[orbital-decay-forecast]].
- [[readme-decay-and-planner]] — source summary.
