---
type: concept
title: "Earth–Moon libration points"
tags: [moon, orbital-mechanics]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Earth–Moon libration points

The **libration points** L1–L5 are the five equilibrium points of the Earth–Moon system in the circular restricted three-body problem (CR3BP). The [[earth-moon-page]] marks all five and moves them with the Moon; the README stresses that they are *solved, not approximated* (README.md#L2707).

## How the page computes them

- **L1, L2, L3** are roots of a quintic in the CR3BP, found by bracketed bisection to machine precision, with a residual gradient of about 10⁻¹⁶ (README.md#L2707-L2709).
- **L4, L5** are the exact equilateral vertices, placed in the Moon's *instantaneous* orbit plane from its position and velocity rather than a fixed ecliptic, because the nodes regress over 18.6 years (README.md#L2709-L2711).
- An independently written solver agrees to 0.000 km on all five points, with L4/L5 exactly R from both bodies and the barycentre at 4,671 km (README.md#L2713-L2714). See [[independent-reference-checks]] for the project's general practice.

## Distances at mean separation

(README.md#L2716-L2723)

| Point | From Earth | From Moon |
|---|---|---|
| L1 | 326,376 km | 58,024 km |
| L2 | 448,921 km | 64,521 km |
| L3 | 381,675 km | 766,075 km |
| L4 / L5 | 384,400 km | 384,400 km |

## What the numbers settle

- **The Hill-radius shortcut is not used.** `R(μ/3)^⅓` puts L1 and L2 at 61,279 km from the Moon; the true roots are 58,024 and 64,521 km, off by about 3,250 km in opposite directions (README.md#L2727-L2729).
- **The points breathe.** They sit at fixed fractions of the instantaneous Earth–Moon separation, which runs 356,400–406,700 km, so L1 moves 42,600 km in and out each month and L2 about 58,600 km (README.md#L2730-L2732). The README calls "fixed point" the wrong mental model.

## μ from GM, not kilogrammes

The mass ratio μ is taken from the gravitational parameters GM_earth and GM_moon (from DE440, known to about one part in 10¹¹) rather than from masses in kg, because dividing by G, known only to about 2.2×10⁻⁵ relative, throws away precision the CR3BP never needs (README.md#L2736-L2740). Computing μ from kg came out 0.0253 % high, moving L2 by 5.7 km and the barycentre by 1.2 km (README.md#L2742-L2743).

## Instability timescales

The README corrects the commonly repeated "23 days" instability timescale as the Sun–Earth figure (README.md#L2770-L2771). Its CR3BP linearisation, `λ⁴ + (2−c)λ² + (1+c−2c²) = 0` with time unit 1/n = 4.348 d, gives these e-folding times (README.md#L2771-L2777):

| | L1 | L2 | L3 |
|---|---|---|---|
| Earth–Moon | 1.48 d | 2.01 d | 24.4 d |
| Sun–Earth | 23.0 d | 23.4 d | — |

The README summarises this as "twelve times faster" and links it to ARTEMIS station-keeping roughly weekly for about 15 m/s total (README.md#L2779). The ratio is closer to twelve for L2 than for L1; the README does not say which point the figure refers to.

## L4/L5 stability

The Routh criterion (μ < 0.0385) is satisfied at μ = 0.0122, but the Sun pulls on the Moon 2.20× harder than the Earth does, destroying the strict equilibrium; what survives near L4/L5 are a few periodic substitute orbits, with test particles wandering chaotically and many escaping (README.md#L2781-L2785). The page therefore says "in theory". The Kordylewski dust clouds reported there since 1961 are noted as unconfirmed (README.md#L2786).

## Spacecraft at the points

Only Queqiao-1 holds a halo about EML2, since 2018, described as the only long-duration operational libration-point spacecraft in the Earth–Moon system; CAPSTONE flew a near-rectilinear halo orbit about EML2 and ended its mission in June 2026; Queqiao-2 is not an EML2 spacecraft (README.md#L2762-L2769). A halo orbit is not a conic, which is why the [[lunar-track-console]] lists Queqiao-1 as *schematic* (README.md#L2821).

## Related

- [[earth-moon-page]]
- [[lunar-track-console]]
- [[readme-moon-data-and-radio]]
