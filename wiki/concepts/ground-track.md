---
type: concept
title: "Ground track"
tags: [orbital-mechanics, earth-console]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# Ground track

The ground track is the path of the sub-satellite point across the Earth's surface over a window of time. Plotting one day of it is part (b) of the coursework assignment the console began as (README.md#L15, L111-L112, L336-L338), and the console draws it on both the 3D globe and the flat map (README.md#L21).

## How the assignment track is made

For the README's worked example, [[knacksat-2]] (README.md#L503-L507):

- 24 hours from the element set's epoch, propagated with [[sgp4-propagation]] and sampled every 10 s — 8641 points;
- drawn on an equirectangular projection with Natural Earth 110 m coastlines;
- positions converted TEME → ECEF by Greenwich mean sidereal time, then to a geodetic sub-satellite point on WGS-84;
- the line breaks at the antimeridian;
- segments where Bangkok sees the spacecraft above 5° are overdrawn thicker and in a second colour (see [[pass-prediction]]);
- a time scrubber moves the spacecraft along the track and redraws the day/night terminator.

## On the flat map, layer by layer

Since ledger row L86 the map draws what the Layers panel's switches say, the same switches as the globe's (one state for both views): the trail (Off draws no track; 30 m, 1 orbit and 6 h draw that much behind the spacecraft and 8 minutes ahead, faded toward the tail as on the globe, the passes in orange; 24 h is the whole window as before, with 6 h propagated before the window so a trail has a tail at the window's start), the observer's pin and circle, the footprint, and the catalogue's dots in the chosen colouring (see [[catalogue-colouring]]), the one under the pointer named beside it. Because the page opens plain (row L80), the map now opens with no track. Its own Layers panel and Full screen sit under the map; full screen takes the map, its controls and its key, with the timeline bar along the foot and a clock over the map (README.md#L808-L816; CHANGES-FROM-LEGACY.md#L135). The map is the `map-chunk` lazy chunk (see [[lazy-chunks-and-entry-budget]]).

## Latitude band

At 51.63° inclination the track is a band between ±51.8° geodetic latitude: the orbit plane bounds *geocentric* latitude at the inclination, and geodetic latitude runs about 0.2° higher at those latitudes (README.md#L509-L510). Bangkok, at 13.75°N, sits well inside the band (README.md#L511-L512).

## The inclination card

The page reads the track's latitude reach off the drawn samples and explains each way it differs from the element set's i (README.md#L514-L516):

- **Geodetic vs. geocentric latitude** — 0.18° for KNACKSAT-2.
- **Actual plane vs. mean i** — 0.02° here; at LEO this is SGP4's periodic terms, which a mean element averages out (README.md#L516-L517).

In deep space the README describes a further effect: the i in the element set is the mean inclination at epoch, and SGP4 drifts the mean inclination itself under lunisolar pull, so weeks later a different mean is in force (README.md#L517-L520). Worked figures (README.md#L520-L527):

- GOES 18, 24 h window from 2026-09-27 00:00 UTC: plane peaks at 0.008° against the set's 0.035°; SGP4's own mean is 0.007° there, periodic terms adding 0.001°.
- ASTRA 2G, same window: mean risen to 0.029°, plane held at 0.002° by periodic terms; at its own epoch the plane sits at 0.001° against a mean 0.024°.
- MMS 1 over a week from the same date: 0.9° of periodic terms on 0.1° of drift.

So the card computes the mean in force where the track peaks from SGP4's own rate and credits periodic terms only with the remainder (README.md#L525-L526).

The card reads the track only when the window holds a whole revolution. MMS 1's period is 85 h, so a 24 h window holds about a quarter of one, and the arc reached ±11.5° in the case that exposed this; for such a window the card instead gives the plane's osculating tilt at window start (about ±74°, a geocentric figure) and says how far the arc got in geodetic latitude (README.md#L527-L531).

## Related

- [[globe-scene]] — the 3D view the track is drawn in.
- [[pass-prediction]]
- [[sgp4-propagation]]
- [[readme-overview-and-assignment]]
