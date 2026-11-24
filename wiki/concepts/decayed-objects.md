---
type: concept
title: "Decayed objects"
tags: [data, decay, orbital-mechanics, earth-console]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Decayed objects

**Decayed objects** are catalogue entries that have re-entered since the embedded snapshot was taken. The catalogue is a snapshot, and SGP4 meets such an object in one of two ways — refusing it or propagating it anyway — neither of which the page originally handled (README.md#L3747-L3748). The README's *When the object is no longer there* section describes how the Earth console now handles both, a third failure mode from SGP4's own arithmetic, and a *decayed now* mark in the picker. See [[sgp4-propagation]].

## SGP4 refuses it

Once drag puts the orbit inside the Earth, SGP4 returns error 6 ("decayed") for every instant (README.md#L3750-L3751). By late September 2026 that was fourteen entries, including COSMOS 2558, ODIN and DUCHIFAT 1, plus STARLINK-2342, which SGP4 refuses with error 1 from 11 August, two days after its epoch (README.md#L3751-L3755).

Picking one used to throw after the picker had moved, leaving the rest of the page on the previous spacecraft (README.md#L3755-L3757). Now the new analysis is computed before anything changes; if it fails, picker, window and span revert and a note gives SGP4's reason, e.g. "ODIN not loaded: SGP4 cannot propagate it anywhere in this window (error 6: decayed)" (README.md#L3757-L3760). Windows SGP4 cannot fill are refused the same way, playback stops at the edge, and a decayed default spacecraft falls back to the next in the preference list (README.md#L3760-L3762). The propagator now keeps SGP4's error code in `track.lastError`, leaving the success path untouched (README.md#L3762-L3765).

## SGP4 propagates it anyway

Short of error 6, SGP4 keeps producing positions at 40 km and 20 km, and the page quoted passes, naked-eye verdicts and Doppler for them; ICEYE-X34, re-entered 14 September, showed a mean altitude of 42.7 km (README.md#L3766-L3768). The analysis now records the lowest propagated altitude over the window's samples and a densely sampled first revolution, and whether error 6 occurred (README.md#L3768-L3770). Below the ~120 km entry interface, or at any error 6, the answer block says so and neither export writes the passes (README.md#L3770-L3772). The first revolution matters because CLUSTER II-FM8's 53 h period lets a 24 h window hold only apogee arcs of an object whose perigee is underground (README.md#L3773-L3774).

## SGP4's own arithmetic

In SGP4's near-earth theory (periods under 225 minutes), only the drag terms change the mean orbit's size and shape, and with positive B* they shrink it after epoch; run far enough, eccentricity falls through SGP4's floor (error 1 or 4) or the semi-major-axis polynomial passes zero and the orbit grows to thousands of kilometres (README.md#L3792-L3797). So, for a near-earth set read without complaint, with positive B*, after its epoch, an error 1–4 or a position more than 1 % over the set's own apogee radius is called a decay; short-period terms put sets in this catalogue at most 0.16 % over apogee before drag runs out (README.md#L3797-L3800). STARLINK-2342 is the first kind; DUCHIFAT 1 the second, placed at 2,690 km on 28 October and 19,464 km on 1 November (README.md#L3800-L3803). Before epoch, with B* ≤ 0, or in deep space, an error 1–4 is not called a decay (README.md#L3803-L3805). See [[orbital-decay-forecast]] for the separate forecast feature.

## The *decayed now* mark

A picker row whose set SGP4 has down at the clock's instant when the list opens reads *decayed now*, with an explanatory line under the list (README.md#L3776-L3781). It is one SGP4 sample per entry at that instant, through `src/lib/catalogue/decayed.ts`, on the set a pick would analyse (README.md#L3781-L3784). The instant is the page clock's, so moving the window moves the marks (README.md#L3784-L3786). The mark removes nothing: all 2,158 stay pickable (README.md#L3786-L3789). At 2026-09-14 00:00 UTC it marks fourteen entries; at 00:00 UTC on 16 October, twenty-four (README.md#L3789-L3790).

The mark is not the analysis's test, which samples the whole window, so an unmarked row can still be refused; on 1 November `compute()` loads DUCHIFAT 1 with no re-entry note at a mean height of 22,562 km, which the mark contradicts (README.md#L3807-L3813). The 2,158 propagations take a few tens of milliseconds, run as a lazy chunk in idle time on first opening the list, and are recomputed when a live set changes or the clock moves more than an hour; nothing is marked under `?tle=embedded` (README.md#L3813-L3820). See [[lazy-chunks-and-entry-budget]] and [[assignment-snapshot-tle-embedded]].

## Refresh answers and the catalogue

The [[live-element-refresh]] refuses a newer set SGP4 cannot propagate (the TLE mirror serves one for ICEYE-X34), and treats CelesTrak's "No GP data found" as a withdrawal; the mirror had turned CLUSTER II-FM8, re-entered 1 September, into "Confirmed current" (README.md#L3825-L3836). Decayed objects stay in the embedded catalogue until the next rebuild, because removing them by hand would change the count the [[regression-gate]] compares (README.md#L3844-L3845).

## Checks

`verify-catalogue.js` drives both SGP4 cases through the picker, window and span buttons, transport and exports in a fixed window, and checks every *decayed now* row against a pinned satellite.js run apart from the page; `axe.js` and `verify-layout.js` inspect the marked rows (README.md#L3820-L3823, L3846-L3848). The default-spacecraft fallback is not tested, since it would need a doctored catalogue (README.md#L3868). See [[verification-harness]].

## Related

- [[data-provenance]]
- [[decay-comparison]]
- [[readme-moon-data-and-radio]]
