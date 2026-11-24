---
type: concept
title: "SGP4 propagation"
tags: [orbital-mechanics, architecture, verification]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# SGP4 propagation

SGP4 is the orbit model the console uses to turn a [[tle-two-line-element-set]] into positions over time. The README calls it "the one the published element sets are made for" (README.md#L66): the page runs it to place the spacecraft every few seconds over the chosen window, and every Earth figure — ground track, passes, period, altitudes, semi-major axis — comes out of it.

## Implementation in the project

- The SGP4 code is the npm package satellite.js at exactly version 6.0.1, bundled into the Earth page rather than loaded from a CDN, with the lockfile pinning its tarball by hash (README.md#L66, L137-L139).
- `src/lib/core/propagator.ts` is described as "what is a property of HOW A THING MOVES — SGP4 for Earth TLEs" (README.md#L194). Its classic-script twin `public/core/propagator.js` also holds Kepler and daily-anchored propagation for the Moon pages (README.md#L266). The split between body and propagator is the [[central-body-seam]].
- The independent checks require the npm build and the `satellite.min.js` the old page loaded to produce the same bits on every catalogue element set (README.md#L678-L687) — see [[independent-reference-checks]].

## Mean elements and constants

- SGP4's theory runs on Brouwer's mean elements; the TLE mean motion is a Kozai mean motion, and SGP4 converts it during initialisation (README.md#L448-L452). See [[brouwer-vs-kozai-mean-motion]].
- The README places SGP4's semi-major axis "on WGS-72 where the theory is defined" (README.md#L455), and names SGP4's μ as 398 600.8 km³/s² (README.md#L465).
- All six elements are SGP4 mean elements, not osculating ones (README.md#L437-L439).

## Frames

For the ground track, SGP4 output is in TEME; it is rotated to ECEF by Greenwich mean sidereal time and converted to a geodetic sub-satellite point on WGS-84 (README.md#L504-L505). See [[ground-track]].

## Periodic and secular effects the README calls out

- **Orbit radius.** SGP4's periodic terms move the orbit radius 19.5 km for KNACKSAT-2: 8.3 km of the excess over the mean-element swing is J3's long-period eccentricity term, and under 1 km is J2's short-period term (README.md#L475-L477).
- **Lunisolar terms.** The README says SGP4 applies lunisolar terms "only past 225 min" (it does not name the quantity; the context is the orbital period). It gives this, together with J2's symmetry about the equator, as the reason LEO node-to-node periods stay usable even at 0.23° inclination, unlike near-equatorial GEO objects (README.md#L485-L491).
- **Mean inclination drift.** In deep space SGP4 moves the mean inclination itself at a steady rate under the Moon's and Sun's pull, so the element set's i is only the mean at epoch; for GOES 18, 14.9 days after epoch SGP4's own mean inclination is 0.007° against the set's 0.035° (README.md#L517-L523).

## Figures measured from the propagation, not from algebra

Because SGP4 moves the orbit in ways mean-element algebra misses, the page measures from the propagated samples:

- nodal period node-to-node, 91.75 min for KNACKSAT-2; 86400/n runs 3.7 s long (README.md#L472-L473);
- altitudes, 358.0–383.8 km, rather than a(1∓e) − Rₑ, which gives only a 10.7 km swing and can put a highly eccentric object's perigee below the surface (README.md#L473-L479);
- for deep-space orbits below 1°, or where no two nodes are found, a labelled "Kepler period" 2π√(a³/μ) from SGP4's a instead — 1436.13 min for GOES 18 (README.md#L491-L493).

## Decay

A spacecraft SGP4 has down at the clock's instant is marked *decayed now* in the picker but still listed (README.md#L405-L408; see [[decayed-objects]]). The planner's exports refuse an orbit SGP4 takes under 120 km inside the window (README.md#L2499-L2500).

## Related

- [[pass-prediction]] — elevation from SGP4 positions.
- [[orbital-decay-forecast]]
- [[readme-overview-and-assignment]]
