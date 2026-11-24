---
type: concept
title: "TLE (Two-Line Element set)"
tags: [orbital-mechanics, data]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# TLE (Two-Line Element set)

A Two-Line Element set (TLE) is the text format in which the console receives a spacecraft's orbit: a name line plus two fixed-column lines of mean orbital elements, an epoch and drag terms. It is the input to everything on the Earth page — the assignment begins "read a Two-Line Element set" (README.md#L15, L111) — and it is made for one propagation model, [[sgp4-propagation]] (README.md#L66).

## The assignment's element set

The README works every figure from one set for [[knacksat-2]] (README.md#L355-L361):

```
KNACKSAT-2
1 67683U 98067XZ  26255.31192122  .00056149  00000-0  48789-3 0  9995
2 67683  51.6258 213.5681 0007959 152.6345 207.5073 15.68476422 33916
```

The epoch field reads day 255.31192122 of 2026, which the README gives as 2026-09-12 07:29:09.993 UTC (README.md#L361).

## What is stored where

The element table in section (a) names the line-2 columns the page reads (README.md#L427-L434):

| Element | Line 2 columns | KNACKSAT-2 value |
|---|---|---|
| Inclination i | 9–16 | 51.6258° |
| RAAN Ω | 18–25 | 213.5681° |
| Eccentricity e | 27–33, leading decimal implied | 0.0007959 |
| Argument of perigee ω | 35–42 | 152.6345° |
| Mean anomaly M | 44–51 | 207.5073° |

Five of the six classical elements are stored literally; the semi-major axis is not (README.md#L436-L437). It has to be derived from the mean motion (15.68476422 rev/day here, README.md#L444), and the README warns that this mean motion is a *Kozai* mean motion, so applying Kepler's third law directly gives a value SGP4 does not use — see [[brouwer-vs-kozai-mean-motion]].

## Mean, not osculating

All six elements a TLE yields are SGP4 *mean* elements — the theory's averaged orbit with periodic terms removed — and not the osculating elements of the instantaneous two-body orbit (README.md#L437-L439). For KNACKSAT-2 the osculating ω at epoch is 83.03° against the mean 152.63°, and the osculating a is 6747.93 km against the mean 6741.908 km (README.md#L464-L466). At small eccentricity ω and M are individually poorly defined; only their sum, the argument of latitude, means much (README.md#L467-L469).

## Drag term and staleness

Line 1 carries the first derivative of mean motion; for KNACKSAT-2 it is `ndot = .00056149`, which the README calls three orders of magnitude larger than a sun-synchronous imager's: at 360 km the atmosphere is still biting and the set goes stale fast (README.md#L498-L499). The live page therefore fetches a newer set on load and refreshes it while the spacecraft is on screen — every three hours, reusing an answer for three hours and retrying a failure after five minutes (README.md#L78, L141-L147). See [[live-element-refresh]] and [[celestrak]].

## Where TLEs come from in the project

- `data/catalogue.txt` holds the 2,158 element sets that ship with the page (README.md#L276); under `?tle=embedded` these are used as-is and no newer set is asked for (README.md#L369-L371) — see [[assignment-snapshot-tle-embedded]].
- Live sets come from the optional cache API (`/api/tle/<n>`) or CelesTrak's `gp.php`, with `tle.ivanstanojevic.me` as fallback (README.md#L141-L146).
- The planner turns typed mean elements into a TLE of the user's own, with a matched B* (README.md#L210-L211) — see [[elements-to-tle-conversion]].
- `verification/fixtures/resource.txt` is a copy of CelesTrak's Earth Resources group, 167 element sets, used by the checks (README.md#L348, L666).

## How parsing is checked

The independent second implementation does its own TLE column parsing; the five elements read straight from the TLE agree with the page's to better than 1e-12 relative (README.md#L655-L659). See [[independent-reference-checks]].

## Related

- [[sgp4-propagation]]
- [[brouwer-vs-kozai-mean-motion]]
- [[data-provenance]]
- [[readme-overview-and-assignment]]
