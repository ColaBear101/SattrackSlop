---
type: source
title: "README: The sky through the phone, and Architecture: the central body is a parameter"
authors: ["SattrackSlop project"]
raw: "README.md#L1191-L1869"
snapshot: "4ce1719 + uncommitted working-tree edits (2026-11-24)"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [ar, architecture, verification, earth-console]
entities: [knacksat-2, celestrak, legacy-earth-console, verification-harness]
concepts: [ar-sky-view, magnetic-declination-wmm, ar-radar, ar-snap, central-body-seam, regression-gate]
---

# README: The sky through the phone, and Architecture: the central body is a parameter

This range of the project README (part of [[sattrackslop-readme]]) covers two unrelated topics. The first and longer part documents the **AR view**: a full-screen mode, offered on touch devices, that draws the sky over the rear camera's picture so a reader can find a pass without translating a compass bearing, together with its camera-less **radar view**, its aim switch and its **Snap** picture tool (README.md#L1191-L1764). The second part explains how the code was refactored so that the central body (Earth or Moon) is a parameter rather than an assumption, and describes the **gate**, the bit-identical regression check that guarded that refactor and every change since (README.md#L1766-L1869).

## The sky through the phone (L1191–L1221)

An **AR** button appears at the right of the stage's tab row only where the primary pointer is coarse (a finger), so the desktop console is unchanged; a sibling **Radar** button opens the same view without a camera (README.md#L1196-L1200). The overlay draws, back to front, the shaded ground, elevation rings and meridians, the horizon, the 5° mask, compass points, the Sun, the current or next pass with minute marks, the spacecraft, and an off-screen pointer with steering words (README.md#L1202-L1210). It keeps the globe's colour meanings and needs no WebGL (README.md#L1210-L1221). See [[ar-sky-view]].

## Asking (L1223–L1246)

Motion-sensor and camera permissions are requested from one tap, motion first, because on iPhone `DeviceOrientationEvent.requestPermission()` only works while the tap is still the current user gesture (README.md#L1225-L1232). The page does not sniff the browser; only a secure page (https or localhost) receives the events; every refusal has its own sentence, and a refused camera still leaves the sky drawn on black (README.md#L1234-L1246). See [[ar-sky-view]].

## Which way the camera points (L1248–L1262)

The W3C orientation angles are treated as a Z-X'-Y'' rotation to East-North-Up and the camera direction is read from the matrix, never from α alone (README.md#L1250-L1254). Screen rotation turns the picture, not the view, with special handling for iOS reporting quirks (README.md#L1256-L1262). See [[ar-sky-view]].

## Which way is north (L1264–L1300)

Every platform reports magnetic north uncorrected (README.md#L1266). The iPhone needs a fused offset between a gyro-only α and a separately reported compass heading, sampled only in tilt ranges where it is trustworthy (README.md#L1274-L1290). Without a compass the reader turns the sky by hand (README.md#L1292-L1294). Only the first reading has a timeout (README.md#L1296-L1300). See [[ar-sky-view]].

## Declination (L1302–L1330)

Magnetic headings are corrected to true using the World Magnetic Model 2025, reproduced in `src/lib/ar/wmm.ts` against NOAA's test values, with example declinations for five cities and a check in Cape Town that measures the error left by omitting it (README.md#L1304-L1330). See [[magnetic-declination-wmm]].

## The lens (L1332–L1345)

No web API reports a camera's field of view; the view assumes 68° and lets a pinch or slider set it (README.md#L1334-L1339). Compass error is the larger term, so a sideways drag turns the drawn sky by hand, forgotten on every open (README.md#L1341-L1345). See [[ar-sky-view]].

## The radar (L1347–L1456)

A small polar plot of the whole sky, with the spacecraft's dot, the pass, and a blue crosshair for where the phone points; its sizing, placement, hiding, colours and redraw economy are specified in detail (README.md#L1349-L1456). See [[ar-radar]].

## The radar view (L1458–L1526)

The same view opened in a second mode with no camera, where the radar is the whole page; it is a mode of one controller rather than a second controller (README.md#L1460-L1526). See [[ar-radar]].

## Aim: the camera or the head (L1528–L1571)

A switch makes the radar's crosshair follow either the rear camera or the phone's top edge ("head"), with a separate smoother for the head (README.md#L1530-L1571). See [[ar-radar]].

## Snap (L1573–L1642)

One press produces a single JPEG (with a camera picture) or PNG (without), with a three-line caption, handed to the share sheet or downloaded; the page's privacy statement about the camera picture was rewritten to match (README.md#L1575-L1642). See [[ar-snap]].

## The clock and the observer (L1644–L1658)

The view stays on the live clock when opened live, or shows a rehearsed instant with a *Go live* button; the observer defaults to Bangkok and the view warns when the phone's time zone differs from the observer's by an hour or more (README.md#L1646-L1658). See [[ar-sky-view]] and [[observer-value]].

## What it costs (L1660–L1672)

While the view is open the WebGL globe draws nothing, the screen is kept awake, and closing removes every listener; up to three choices are kept in `localStorage` (README.md#L1662-L1672). See [[ar-sky-view]].

## What is checked, and what is not (L1674–L1764)

`GT_TARGET=new npm run ar` checks the maths in Node and then drives the production build in mocked phone contexts; 278 checks, with fault-injection runs; what only a real phone can show is left to a checklist (README.md#L1676-L1738). `npm run ar-snap` has 79 checks and a census of the ways a picture can be used (README.md#L1740-L1764). See [[ar-sky-view]], [[ar-radar]], [[ar-snap]] and [[verification-harness]].

## Architecture: the central body is a parameter (L1766–L1821)

Earth constants and Earth-only propagation had leaked into every layer; extending to the Moon meant splitting a **body** object from a **propagator** behind a `track.at(ms)` interface, forced by the fact that SGP4 has no lunar analogue (README.md#L1768-L1807). The section lists three by-products, including two latent Earth-only gates (README.md#L1809-L1820). See [[central-body-seam]].

## The gate (L1822–L1869)

`npm run gate` drives the real production page in a browser, reads full-precision values through the test surface, and compares 67,488 values with `===` against a baseline written only from the old page (README.md#L1824-L1862). See [[regression-gate]].

## Where this fits

- [[ar-sky-view]] — the AR view itself: permissions, orientation maths, north, lens, clock, cost, checks.
- [[magnetic-declination-wmm]] — the magnetic-to-true correction from WMM2025.
- [[ar-radar]] — the radar inset, the radar view mode, and the Aim switch.
- [[ar-snap]] — the Snap picture tool and its privacy census.
- [[central-body-seam]] — the body/propagator split that let the Moon in.
- [[regression-gate]] — the bit-identical gate against the old page.
- Related: [[knacksat-2]], [[celestrak]], [[sgp4-propagation]], [[pass-prediction]], [[legacy-earth-console]], [[verification-harness]], [[test-facade]], [[lunar-track-console]].
