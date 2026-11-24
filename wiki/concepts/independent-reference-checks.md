---
type: concept
title: "Independent reference checks"
tags: [verification, orbital-mechanics]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# Independent reference checks

The independent reference checks are the project's cross-check of the Earth console's orbit maths against a second, separately written implementation. Where the [[regression-gate]] proves the rebuilt page computes exactly what the old page did, these checks ask whether those numbers are right in the first place. The README introduces them as "an independent second implementation of the orbit maths" among the stages of `npm run test:all` (README.md#L70) and details them in "How the Earth numbers are checked" (README.md#L653-L693).

## The second implementation

It has its own WGS-84 ECEF→ENU elevation, its own TLE column parsing, its own Kepler-third-law semi-major axis and its own Kozai-to-Brouwer conversion (README.md#L655-L657). Its files sit in `verification/reference/` (`core.js`, `propagate.js`) beside the pinned `satellite.min.js` the old page loaded (README.md#L295-L296). It is part of the [[verification-harness]].

## What is compared, and the results

| Check | Result | Line |
|---|---|---|
| Five elements read straight from the TLE | agree to better than 1e-12 relative | README.md#L659 |
| Semi-major axis, period, apsis altitudes | deliberately differ: the page takes them from SGP4, the harness from naive mean-element algebra | README.md#L659-L662 |
| SGP4's un-Kozai step, re-derived from Spacetrack Report #3 on WGS-72, against what `src/lib/core/propagator.ts` hands the page | agree to 2.7e-16 relative over all 167 sets in `verification/fixtures/resource.txt` | README.md#L663-L667 |
| Topocentric elevation vs. satellite.js look angles | 2.6e-10° over 200 samples | README.md#L669-L670 |
| Topocentric elevation vs. a from-scratch WGS-84 implementation | 1.1e-9° over 24 h — floating-point noise, no bias | README.md#L670-L671 |
| Visibility total across scan steps 10 s, 5 s, 1 s, 0.25 s | stable (see note below on the unit) | README.md#L672 |
| Culmination solver vs. 200 000-point brute force | 0 ms | README.md#L673 |
| 86 400 one-second samples counting those above 5°, KNACKSAT-2 | 899 s in 2 runs vs. the page's 899.7 s in 2 passes; the gap is 1 s quantisation | README.md#L674-L677 |

The README notes that until the un-Kozai check existed, nothing independent looked at the semi-major axis shown on the card, because the naive-against-naive comparison passed whatever SGP4 did (README.md#L667-L668). See [[brouwer-vs-kozai-mean-motion]].

The harness reaches the page's code through the library bundle that `npm run build:shims` makes (README.md#L665-L666).

## Same SGP4 bytes on both sides

The cross-check would be weaker if the two sides ran different SGP4 builds, so both are pinned (README.md#L678-L690):

- The harness propagates with `verification/reference/satellite.min.js`, the satellite.js 6.0.1 file the old page loaded from cdnjs under an integrity hash.
- The rebuilt page bundles satellite.js 6.0.1 from npm; the harness requires `package.json` and `package-lock.json` to name exactly that version and the sha512 of its tarball recorded in `verification/suites/verify.js` (check 5a). three.js r128 is pinned the same way.
- `tests/lib/satellite-parity.test.ts` proves the npm build and the reference file give the same bits on every catalogue element set and a spread of instants.
- The Moon pages, which still load three.js r128 from cdnjs, are held to the hash of the bytes npm ships (check 5b).

The README's reasoning: the gate would notice a build that moved the numbers; the pin also refuses one that leaves them alone but does something else (README.md#L687-L689).

## Other reference checks in the same range

- **Sun times.** The day headers' sunrise, sunset and dark times agree with the NOAA Solar Calculator's equations to within 11 s at Bangkok and Svalbard; `tests/lib/sun-times.test.ts` holds a table of NOAA's values and `verify-timeline.js` checks a week against `verification/reference/noaa-sun.js` (README.md#L580-L583).
- **Core equivalence.** `tests/lib/core-equivalence.test.ts` holds the TypeScript core and the classic-script core in `public/core/` bit-for-bit equal (README.md#L171-L174).

## Running it

`npm run build:shims` once, then `GT_TARGET=new node verification/suites/verify.js` (README.md#L692-L693). Checks drive a real browser, so `npx playwright install chromium` is needed once (README.md#L70).

## Caveat in the source

The README says the visibility total is "stable to 10 milliarcseconds" across scan steps (README.md#L672). A time total is not measured in arcseconds; the unit appears to be a slip, and the README does not state the intended figure.

## Related

- [[regression-gate]]
- [[verification-harness]]
- [[sgp4-propagation]], [[pass-prediction]]
- [[readme-overview-and-assignment]]
