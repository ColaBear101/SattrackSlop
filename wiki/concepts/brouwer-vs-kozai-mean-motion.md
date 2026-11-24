---
type: concept
title: "Brouwer vs. Kozai mean motion"
tags: [orbital-mechanics, verification]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# Brouwer vs. Kozai mean motion

The mean motion printed in a [[tle-two-line-element-set]] is, per the README, a *Kozai* mean motion, while the theory inside [[sgp4-propagation]] runs on *Brouwer's* mean elements. The README describes these as two different mean-element conventions whose mean motions differ by a term of order J2 (README.md#L448-L450). This is why the semi-major axis the console prints for an element set is not the value Kepler's third law gives from the TLE's mean motion.

This page states only what the README says. It does not reproduce the conversion formula, which the README does not give; an earlier, retired wiki draft was replaced partly because it explained Kozai mean motion incorrectly (see the wiki's `SCHEMA.md`).

## What the page shows, and the naive value it rejects

For [[knacksat-2]]'s assignment element set (README.md#L441-L457):

| Route | How | Value |
|---|---|---|
| Naive | Kepler's third law on the TLE mean motion: n = 15.68476422 rev/day = 1.140651e-3 rad/s, a = (μ/n²)^(1/3) with μ = 398600.4418 km³/s² | 6741.396 km |
| Shown on the page | SGP4 converts the Kozai mean motion to Brouwer's during initialisation and recovers the Brouwer semi-major axis from it, on WGS-72 "where the theory is defined" | **6741.908 km** |
| Difference | naive against shown | −512 m |

The README's point is that the naive route is "a formula SGP4 does not use" (README.md#L469-L470): the page shows the semi-major axis SGP4 itself works with, and the element table labels its source as "SGP4's Brouwer value, recovered from the Kozai mean motion" (README.md#L429).

## How big the difference is, and where

- The difference depends on inclination through a (3cos²i − 1) term. It nearly vanishes at 54.7° and is largest for equatorial and polar orbits (README.md#L459-L460).
- KNACKSAT-2, at 51.63°, is therefore described as a best case (README.md#L460).
- Across the 2,158-satellite catalogue, the median difference is 2.95 km and the largest 6.38 km (README.md#L461).

## What it is not: mean vs. osculating

The README stresses that neither 6741.908 km nor 6741.396 km is the semi-major axis of the ellipse the spacecraft is actually on at epoch (README.md#L463). All six TLE-derived elements are SGP4 *mean* elements, with periodic terms averaged out, not osculating two-body elements — "a distinction that turns out to matter more" than the Kozai/Brouwer one (README.md#L436-L439).

- Converting SGP4's own position and velocity at epoch to two-body elements, on SGP4's μ = 398 600.8 km³/s², gives an osculating a = 6747.93 km, e = 0.0012452 and ω = 83.03°, against the mean 6741.908 km, 0.0007959 and 152.63° (README.md#L464-L466).
- The osculating a moves 12.1 km over one revolution (README.md#L466).
- The page lists the osculating values under the mean elements (README.md#L466-L467).
- Conclusion as the README puts it: the 512 m is a real correction, but small beside the roughly 6 km between the mean and osculating a (README.md#L469-L470).

## How it is checked

The independent harness re-derives SGP4's un-Kozai step from Spacetrack Report #3 on WGS-72 and compares it with the value `src/lib/core/propagator.ts` hands the page; they agree to 2.7e-16 relative across all 167 element sets in `verification/fixtures/resource.txt` (README.md#L663-L667). The README notes that before this check existed, nothing independent looked at the number on the card, because a naive-against-naive comparison passed whatever SGP4 did (README.md#L667-L668). The harness's own naive Kepler value is kept and deliberately differs from the page's (README.md#L659-L662). See [[independent-reference-checks]].

## Ambiguities in the source

- The naive calculation uses μ = 398600.4418 km³/s² (README.md#L445), while the SGP4 value is "on WGS-72" (README.md#L455) and the osculating conversion names SGP4's μ as 398 600.8 km³/s² (README.md#L465). The README attributes the 512 m gap to "the naive form" as a whole and does not say how much of it comes from the different μ and how much from the Kozai-to-Brouwer step itself.
- The README names the (3cos²i − 1) dependence but gives no formula for the conversion and no derivation of the "order J2" size; for that it points only to Spacetrack Report #3 as the harness's reference (README.md#L664).

## Related

- [[sgp4-propagation]] — where the conversion happens.
- [[tle-two-line-element-set]] — where the Kozai mean motion is stored.
- [[elements-to-tle-conversion]] — the planner's reverse direction, typed mean elements to a TLE.
- [[readme-overview-and-assignment]] — source section (a).
