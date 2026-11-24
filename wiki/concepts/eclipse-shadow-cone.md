---
type: concept
title: "Earth's shadow as a cone"
tags: [orbital-mechanics, earth-console]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Earth's shadow as a cone

The Earth console models **Earth's shadow as a cone**: a tapering umbra wrapped in a widening penumbra, because the Sun is an extended disc rather than a point (README.md#L3395-L3397). The model decides whether a spacecraft is sunlit, in penumbra or in umbra, which feeds the naked-eye verdicts on [[sunlit-visibility]] and the rail's *Sunlight* figure.

## Why not a cylinder

The README gives the Sun's radius as 696,000 km at 1.496×10⁸ km, subtending about half a degree, so the shadow tapers (README.md#L3395-L3396). A cylindrical shadow, the usual shortcut, errs in the direction that matters: it reports full shadow where there is only partial shading (README.md#L3397-L3398).

## Measured geometry

Walking down the anti-sun axis, the umbra closes at 1.3916×10⁶ km, matching `Re·d/(Rs−Re)` to within 0.000 %; a cylinder never closes (README.md#L3400-L3401). At 40,000 km behind the Earth the umbra radius is 6,194.8 km and the penumbra 6,564.9 km, bracketing Earth's own 6,378.1 km (README.md#L3401-L3402).

## Umbra and penumbra kept apart

The two are reported separately rather than collapsed. At LEO the penumbra crossing lasts seconds — 0.25 % of [[knacksat-2]]'s orbit — but a satellite in it is dimmed rather than dark (README.md#L3404-L3406). Because penumbral dimming is not modelled, a penumbral sample never counts towards a naked-eye "yes", producing the separate *penumbra only* verdict (README.md#L3378-L3381).

## Two extremes from one code path

The same code must produce both ends of the range: a 51.6° LEO orbit is sunlit 60.5 % of the day and a sun-synchronous METOP-B 71.4 % (README.md#L3408-L3409).

## The sub-solar NaN

Solar elevation is computed as `asin` of the cosine of the zenith angle. With the site exactly at the sub-solar point the expression rounds to 1.0000000000000002 and `asin` returns NaN; the sub-solar point crosses Bangkok's latitude twice a year, so this is not hypothetical (README.md#L3413-L3416). The value is clamped and the test that caught it — the Sun exactly overhead at its own sub-point — is kept (README.md#L3416-L3417). The residual 8.54×10⁻⁷ degrees is attributed to `asin`'s diverging derivative at ±1, not to the code (README.md#L3419-L3421).

## A deliberate duplicate

`src/scene/orbit3d.ts` keeps its own solar-position copy for the globe's directional light, omitting the obliquity's slow drift (about 0.004°), because it is a standalone renderer held to the old page's pixels; the library's copy is `sunEci` in `src/lib/core/sun.ts`, with `subsolar` defined from it (README.md#L3425-L3431). Merging them was declined and recorded as row 2 of the [[change-ledger]] (README.md#L3429-L3431). See [[globe-scene]] and [[verbatim-ports]].

## Sunlit or eclipsed now

The pass facts give the illumination at mid-pass; the rail's "now" block (`#nowstate`, `src/components/rail/NowState.svelte`) gives it at the clock's instant as *Sunlit*, *Penumbra* or *Eclipsed*, explaining a spacecraft that fades mid-pass (README.md#L3435-L3442). The block also shows range rate, inertial speed and the sub-satellite grid square, all read from one engine propagation using existing functions, including the optical code's `sunlitState` (README.md#L3443-L3458). While the clock plays at real time the shadow is tested at most once a second, justified because a LEO spacecraft takes 8 s or more to cross the penumbra; a paused instant is always tested itself (README.md#L3458-L3466). The block is a lazy chunk of 1.1 KB gzipped plus 0.2 KB of stylesheet, sharing `maidenhead.ts` with the observer form (README.md#L3468-L3473); see [[lazy-chunks-and-entry-budget]].

## Checks

`npm run optical` (`verify-optical.js`) covers the shadow-cone geometry and places the clock in the longest umbra, the longest sunlit stretch and a penumbra crossing, requiring the rail block to name the state `opticalAt` gives there; it counts shadow tests through the live optics object (`__gt.optics`): none while paused, at most one a second while playing (README.md#L3475-L3487, L3967-L3968). See [[test-facade]].

## Related

- [[sunlit-visibility]]
- [[readme-moon-data-and-radio]]
