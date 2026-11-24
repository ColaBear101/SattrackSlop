---
type: concept
title: "Pass prediction"
tags: [orbital-mechanics, earth-console, verification]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# Pass prediction

Pass prediction is how the console finds the intervals in which a spacecraft is above the observer's 5° elevation mask, times their start (AOS) and end (LOS), and totals them. It is part (c) of the original assignment — total the time in view from Bangkok above 5° (README.md#L15, L336-L338) — and the headline number on the page: minutes above 5° in the next 24 hours (README.md#L19).

## Method

The page computes elevation and azimuth from the spacecraft's [[sgp4-propagation]] position and the observer's, finds the stretches above the mask and totals them (README.md#L66).

- Elevation is scanned every 4 s; each crossing of 5° is bracketed and bisected to 1 ms, so the total is not quantised by the scan (README.md#L545-L546).
- The scan step must be finer than the shortest pass worth reporting: bisection refines only a crossing already bracketed, so at a 10 s step a 6-second pass would be invisible, not merely imprecise (README.md#L546-L548).
- It is geometry only — no refraction, terrain or link budget, and no daylight or eclipse condition; the README calls this radio visibility, not naked-eye (README.md#L648-L649). Refraction is the largest unmodelled term: about 9.9 arcminutes at 5°, adding roughly 8.4 s (+0.93 %) to KNACKSAT-2's total and moving each horizon crossing by about 2 s (README.md#L649-L651).

## The assignment result

From Bangkok (13.75°N, 100.52°E, 5° mask), for [[knacksat-2]]'s assignment set with the window opening at epoch: **899.7 s = 14.99 min**, 1.04 % of the day, over 2 passes (README.md#L533-L535).

| # | Date | AOS (UTC) | LOS (UTC) | Duration | Max elevation | Min range |
|---|---|---|---|---|---|---|
| 1 | 2026-09-12 | 09:02:12 | 09:09:47 | 7m 36s | 45.1° | 505 km |
| 2 | 2026-09-12 | 18:48:18 | 18:55:42 | 7m 24s | 40.0° | 538 km |

(README.md#L537-L540.) The README explains the pattern by the low orbit: a 14.5° access footprint means the spacecraft must pass close overhead to be seen at all, but then it is only about 500 km away (README.md#L542-L543).

## Edges of the window

- Passes are dated in UTC; a local time falling on another calendar day carries that day. An older "+Nd" tag counted 24 h periods from the window start and was misleading (README.md#L550-L553).
- A pass already up at window open, or still up at window close, is marked `*`: its AOS or LOS is the window edge and its duration counts only the part inside. A geostationary spacecraft is the whole-window case (README.md#L553-L557).
- After the window's last pass the countdown searches 48 h beyond the window for the real next pass. It once counted down to the window's first pass as if the track repeated, which in the case that found it was 66.6 min late and promised 74.2° for a 19.7° pass (README.md#L557-L560).

## How the list is presented

- **Grouped by local day.** Rows are grouped by the observer's calendar day of AOS under a sticky header naming the offset, including both offsets on a day the clock changes (README.md#L562-L569). Under it are that day's Sun times — dark (Sun 6° or more below), sunrise and sunset (0.833° below) — computed by bisecting the page's own almanac Sun to a second, and agreeing with the NOAA Solar Calculator's equations to within 11 s at Bangkok and Svalbard (README.md#L569-L583). See [[sunlit-visibility]].
- **Flown passes.** With the clock inside the window, passes already flown are grey and the current pass's number is ringed; if the clock is not at real time within 5 s of the wall clock, or is paused, the line under the list says the clock is on sim time (README.md#L586-L592).
- **Filter.** Three optional tests — minimum peak (10°, 20°, 30°, 45°), naked-eye only, and AOS hours of the site's day — filter the list and nothing else: the total, count, countdown, report table and exports still count every pass (README.md#L597-L609).
- **Sky plot.** The selected pass is drawn as a north-up polar plot with its arc and peak; while the clock is inside the pass it shows the spacecraft's current position, propagated to the clock's instant rather than read from stored samples, and fades the flown stretch over the arc's 91 samples (README.md#L620-L629).

## How it is checked

The total is stable across scan steps of 10, 5, 1 and 0.25 s; the culmination solver matches a 200 000-point brute force to 0 ms; and a 1 s brute-force count gives 899 s in 2 runs against 899.7 s in 2 passes, the gap being quantisation (README.md#L672-L677). Topocentric elevation agrees with satellite.js look angles to 2.6e-10° and with a from-scratch WGS-84 implementation to 1.1e-9° (README.md#L669-L671). See [[independent-reference-checks]]. The pass list, filter and sky plot are also checked in a browser by `verify-timeline.js` (README.md#L582, L616-L618, L638-L646).

## Related

- [[ground-track]] — the visible segments are overdrawn on it.
- [[assignment-snapshot-tle-embedded]] — how to reproduce 899.7 s on the live page.
- [[doppler-and-transmitters]], [[observer-value]]
- [[readme-overview-and-assignment]]
