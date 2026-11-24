---
type: entity
kind: spacecraft
title: "KNACKSAT-2"
tags: [earth-console, orbital-mechanics]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# KNACKSAT-2

KNACKSAT-2 is a Thai CubeSat, NORAD 67683, international designator 1998-067XZ (README.md#L343). It is the Earth console's default spacecraft and the worked example for the whole of the README's assignment section: every figure in parts (a)–(c) is computed for it (README.md#L337-L339, L351).

## Orbit

The README reads its origin from the designator: `1998-067` is the ISS, so KNACKSAT-2 was deployed from the station and shares its orbit — 51.63° inclination at roughly 360 km, not sun-synchronous (README.md#L343-L345).

The assignment element set, epoch 2026-09-12 07:29:09.993 UTC (README.md#L355-L361):

```
KNACKSAT-2
1 67683U 98067XZ  26255.31192122  .00056149  00000-0  48789-3 0  9995
2 67683  51.6258 213.5681 0007959 152.6345 207.5073 15.68476422 33916
```

Key figures from that set, window opening at epoch:

| Quantity | Value | Line |
|---|---|---|
| Semi-major axis (SGP4 Brouwer mean) | 6741.908 km | README.md#L429 |
| Naive Kepler-third-law a | 6741.396 km (−512 m) | README.md#L445, L456 |
| Eccentricity, inclination, RAAN, ω, M | 0.0007959, 51.6258°, 213.5681°, 152.6345°, 207.5073° | README.md#L430-L434 |
| Osculating a, e, ω at epoch | 6747.93 km, 0.0012452, 83.03° | README.md#L465 |
| Nodal period | 91.75 min | README.md#L472 |
| Altitude over one revolution | 358.0–383.8 km | README.md#L473 |
| Ground-track latitude band | ±51.8° geodetic | README.md#L509 |
| Visible from Bangkok above 5° | 899.7 s over 2 passes (peaks 45.1° and 40.0°) | README.md#L535-L540 |

The README calls its 51.63° inclination a best case for the Kozai/Brouwer difference, which nearly vanishes at 54.7° (README.md#L459-L460) — see [[brouwer-vs-kozai-mean-motion]]. Its drag term `ndot = .00056149` is three orders of magnitude larger than a sun-synchronous imager's, so its element sets go stale fast (README.md#L498-L499) — see [[tle-two-line-element-set]].

## Outside the brief

The assignment asks for a satellite from [[celestrak]]'s Earth Resources group, and KNACKSAT-2 is not in it: `verification/fixtures/resource.txt`, a copy of that group's 167 element sets, has no entry for it, and it entered the project's catalogue from SatNOGS rather than a CelesTrak group (README.md#L347-L350; see [[data-provenance]]). The README says the figures are correct for KNACKSAT-2 but are not an answer from the named group (README.md#L350-L351). The old page said so above the answer, in a note headed "Outside the brief"; the rebuilt page no longer does, leaving it to the README and to the glossary entry "Earth Resources group, the brief" (README.md#L351-L353).

## On the page

- Default spacecraft (README.md#L351); found in the picker by `knack` or `knacksat 2` (README.md#L379, L383).
- One of two spacecraft with a built-in 3D model in the close-up camera, the other being the ISS (README.md#L22) — see [[close-up-camera]].
- Its passes and total can be reproduced exactly with [[assignment-snapshot-tle-embedded]] and the observer reset to Bangkok (README.md#L369-L375).
- The 1 s brute-force check counts 899 s in 2 runs against the page's 899.7 s (README.md#L674-L675) — see [[independent-reference-checks]].
- The README has a later section on KNACKSAT-2 under orbital decay (README.md#L2136), outside this page's source range; see [[orbital-decay-forecast]].

## Remaining life

From the decay section (README.md#L2136-L2152): mean altitude 362.9 km, decay rate −0.289 km/day, fitted density trend −0.24 %/day, fixed-atmosphere estimate 2027-02-11, and **2027-04-16 with the solar trend**. Because the backtest says such estimates run about two months early, the page moves the date by the 63-day median and gives June 2027 under it. See [[orbital-decay-forecast]] and [[readme-decay-and-planner]].

**Open question (`open-question`):** the README cites an independent SGP4 B* run reaching 120 km on **2027-06-09** as "landing within a day of the trend model's figure when both were run on the same element set" (README.md#L2147-L2149). The trend figure in the table directly above is 2027-04-16, about 54 days earlier, and 2027-04-16 + 63 days is 2027-06-18, not within a day either. The sentence may refer to a trend run on a different element set that the README does not show. Unresolved.

## Related

- [[pass-prediction]], [[ground-track]], [[sgp4-propagation]]
- [[readme-overview-and-assignment]]
