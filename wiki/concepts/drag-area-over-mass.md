---
type: concept
title: "Drag as area over mass"
tags: [planner, decay, orbital-mechanics]
sources: [readme-decay-and-planner]
created: 2026-11-24
updated: 2026-11-24
---

# Drag as area over mass

The [[orbit-planner]] asks for drag as **area over mass** (A/m, in m²/kg) rather than as SGP4's B*, on the reasoning that a student knows an area and a mass but not a B*; the drag coefficient Cd is fixed at 2.2, shown but never typed (README.md#L2274-L2275). The planner then derives the B* to write into the [[tle-two-line-element-set]] by matching SGP4's decay rate to the page's own atmosphere. The same A/m drives the planned-orbit lifetime band in [[orbital-decay-forecast]].

## Presets

The *What it is* field fills A/m (README.md#L2275-L2278):

| Preset | A/m (m²/kg) |
|---|---|
| Typical satellite (default) | 0.0043 (Cd·A/m 0.0095) |
| Small satellite | 0.010 |
| 3U CubeSat | 0.009 |
| Dense and compact | 0.002 |
| Large satellite or station | 0.0012 (the ISS's fitted B*, worked back) |
| Custom | typed |

The default comes from the embedded catalogue: its B* values, worked back through the planner's conversion, give a median Cd·A/m of 0.0095 for near-circular satellites with perigee 500–700 km. The README notes this is a middle, not a constant (0.0078 at 300–500 km, 0.0150 at 700–1,000 km), and that all these are fitted, not measured, figures (README.md#L2278-L2282).

## Choosing B*

B* is chosen so that SGP4's decay rate at the epoch height equals the rate from the page's atmosphere table (the one the Decay section uses), orbit-averaged when e > 0 (README.md#L2284-L2286). The README stresses that **no height-independent constant** does this: B* per unit Cd·A/m is 0.0506 at 360 km, 0.0368 at 420, 0.0225 at 500 and 0.0055 at 700. The textbook constant B* = ½·Cd·(A/m)·0.15696615 (0.0785 per unit) is 1.6 times too much at 360 km, 2.1 at 420, 3.5 at 500 and 14 at 700 (README.md#L2286-L2289).

Against SGP4 itself (circular, 51.6°), the matched decay rate is within 0.2 % from 500 to 990 km, 0.4 % at 400 and 4.7 % at 300, with ratios of 1.21 at 250 km and 1.17 at 200 km, where SGP4 treats low perigees differently (README.md#L2289-L2292). B* is not monotone in perigee (4.18·10⁻⁴ at 150 km, 5.84·10⁻⁴ at 200 km) because SGP4 switches a height parameter at 156 km (README.md#L2292-L2293).

**Limits.** Below a 120 km perigee B* is held at its 120 km value; that orbit is flagged as a *Below the re-entry line* Problem but Add stays enabled. Above 120 km a B* over 0.1 is refused (*Too much drag for SGP4 at this height*), and the error offers the largest A/m that passes: 0.61 m²/kg at 120 km, 0.74 at 200, 1.1 at 400, 2.0 at 500, 4.1 at 600, 8.2 at 700 (README.md#L2293-L2297).

## SGP4 against the physical model

The Professor and the Decay section use one lifetime model (the page's atmosphere); the globe uses SGP4 with the matched B*. They agree on the rate at the epoch and then diverge (README.md#L2299-L2301). Circular orbits, A/m 0.010, 51.6°, days to 120 km (README.md#L2301-L2311):

| Height | Model ×3 / ×1 / ×⅓ | SGP4 reaches 120 km | SGP4 ÷ model ×1 |
|---|---|---|---|
| 300 km | 6 / 18 / 53 | day 28 | 1.59 |
| 400 km | 47 / 141 / 422 | day 269 | 1.91 |
| 500 km | 282 / 847 / 2,542 | day 1,907 | 2.25 |
| 600 km | 1,440 / 4,321 / 12,964 | day 11,365 | 2.63 |
| 650 km | 3,089 / 9,268 / 27,805 | day 25,010 | 2.70 |
| 700 km | 6,385 / 19,156 / past the cap | after day 40,000 | above 2.08 |

SGP4 comes down 1.6 to 2.7 times later than the model's middle case but inside its range, though close to the top at 600 and 650 km (0.88 and 0.90 of the ×⅓ figure) (README.md#L2313-L2315). The README notes this end-to-end comparison would catch the textbook B* but not a B* twice too big; the epoch-rate comparison is the sharp test (README.md#L2315-L2318).

For **eccentric** orbits (A/m 0.020, 51.6°, argument of perigee 0) the ratio is not one-sided: it ranges from 2.76 at 700 × 750 km to 0.27 at 300 × 5,000 km, the latter outside the band (README.md#L2320-L2333). `verify-planner.js` asserts the last six rows of that table lie between 0.25 and 3; the first row is in no suite (README.md#L2334-L2335). For such orbits the Decay section calls the comparison a rough cross-check only (README.md#L2335-L2336).

## Related

- [[elements-to-tle-conversion]] — the rest of how the TLE is written.
- [[orbital-decay-forecast]] — the three-run lifetime band using this A/m.
- [[sgp4-propagation]] — the propagator whose B* is being matched.
- [[readme-decay-and-planner]] — source summary.
