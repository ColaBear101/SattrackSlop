---
type: concept
title: "Decay comparison panel"
tags: [decay, earth-console, data, verification]
sources: [readme-decay-and-planner]
created: 2026-11-24
updated: 2026-11-24
---

# Decay comparison panel

The **decay comparison** is a panel under the Orbital decay chart, opened by **Compare with other spacecraft**, that plots the selected spacecraft and others the reader adds on one time axis: each one's mean-altitude history and its [[orbital-decay-forecast]] down to 120 km (README.md#L2041-L2044). The main decay chart and panel stay as they are. Its design is dominated by one constraint: histories come from [[celestrak]]'s slow per-object archive, so requests are fetched only on demand and rate-limited (README.md#L2094-L2101).

## Building the list

- The opening button is a disclosure: reachable by Tab, toggled by Space or Enter, announcing its state; closing the panel keeps the list (README.md#L2043-L2045).
- **Add spacecraft** opens the picker's own catalogue search (words in any order or a NORAD number; not the alternative names). Enter or a click adds the highlighted row and leaves the search open; duplicates are refused with a message (README.md#L2047-L2051).
- **Add watched (10)** adds every watched spacecraft not yet listed. The list holds up to 50 (README.md#L2050-L2052).

## The chart

- Up to seven spacecraft are drawn in colour besides the selected one, which is drawn in the page's cyan as a heavier line on top; the rest are thin grey context lines. An eighth colour is refused with an instruction to turn one off first. Colours are stable: a freed colour goes to the next one turned on, so drawn lines never change colour (README.md#L2054-L2058).
- Nothing above 2,000 km mean altitude is drawn, since drag does not matter there and such a line would flatten the rest; nor histories too short to fit. The row says which (README.md#L2058-L2060).
- Auto framing fits the coloured lines: at least a year of past, or as much past as future, running to the latest re-entry drawn (README.md#L2060-L2062). With four or fewer coloured lines, each is labelled at its last element set unless labels would collide (README.md#L2063-L2064).
- **Range** offers Auto, last 30 or 90 days, last year, or All. **Show** selects mean altitude, mean perigee or apogee altitude, decay rate (the section's 45-day measure), eccentricity, period, mean motion, inclination, or **RAAN offset** from the selected spacecraft (interpolated between its nearest element sets when they are at most ten days apart, wrapped to ±180°). Only mean altitude, period and mean motion carry the dashed forecast (README.md#L2068-L2076).
- Histories cached before the page kept inclination and RAAN lack them; the row says so and nothing is refetched until the 12-hour cache expires (README.md#L2076-L2079).
- Interaction: a pointer readout (date and each coloured value, highest first); drag or double-click to zoom on desktop; tap to pin, slide to move on a phone; a keyboard slider with plus and minus for zoom. Range and Show are per tab; zoom is not kept (README.md#L2064-L2086).

## The table

The list under the chart is the same data as a table, selected spacecraft first: re-entry date or verdict (the decay section's own words), mean altitude, decay rate and fetch status (*Queued*, *Fetching… 12 s*, *Not received* with *Try again*). Eight rows show; the rest fold (README.md#L2088-L2092).

## Request discipline

- Histories are fetched only on request: adding a spacecraft, turning a colour on, or **Fetch 7 more** / **Fetch the rest**. No press starts more than seven requests, including the selected spacecraft's own if not yet estimated; a double-click counts as one press (README.md#L2094-L2101).
- Requests go one at a time and, with the cache API answering, at least seven seconds apart (it allows ten a minute); anything cached in the last twelve hours draws at once (README.md#L2100-L2102).
- The comparison and the main decay panel share one history source, so the panel's *Estimate* for a spacecraft already being fetched waits for the same request (README.md#L2102-L2105). A request cannot be cancelled; a removed spacecraft's history still fills the cache (README.md#L2105-L2107).
- Before its first request of a run, expired cached histories are removed from browser storage so they do not crowd out the space shared with saved orbits and other settings (README.md#L2108-L2111).

## Persistence and loading

The list, which entries are coloured, and whether the panel is open are kept in `localStorage` under `gt.decaycmp`, written only on change; reading it back fetches nothing, and another tab follows list changes (README.md#L2116-L2118). The panel is its own lazy chunk (24.0 KB gzipped), loaded on first press or when the section comes into view with the panel left open; a failed chunk download asks for a reload (README.md#L2118-L2122). See [[lazy-chunks-and-entry-budget]].

With a planned orbit from the [[orbit-planner]] selected, the panel is put away, because a planned orbit has no history and its forecast has no dates (README.md#L2113-L2114).

## Checks

`npm run decay-compare` drives the panel in a browser with CelesTrak faked per spacecraft, counting requests and concurrency: nothing fetched on a fresh visit, reload or planned orbit; one request per add; never two at once; at most seven per press; plus colours, readout, keyboard focus, failure, phone gestures, range/quantity/zoom, and the RAAN offset (about a minute) (README.md#L2124-L2131). `npm run layout` and `npm run axe` also cover the panel in several states (README.md#L2132-L2134).

## Related

- [[orbital-decay-forecast]] — the per-object model each line uses.
- [[celestrak]] — the history source.
- [[readme-decay-and-planner]] — source summary.
