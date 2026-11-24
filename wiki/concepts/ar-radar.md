---
type: concept
title: "AR radar and radar view"
tags: [ar, earth-console, verification]
sources: [readme-ar-and-architecture]
created: 2026-11-24
updated: 2026-11-24
---

# AR radar and radar view

The **radar** is a small polar plot of the whole sky drawn in a corner of the [[ar-sky-view]]: north up, zenith at the centre, horizon at the rim, the spacecraft's dot, the current or next pass, and a blue crosshair at where the phone points (README.md#L1351-L1354). It exists because the camera picture shows only a few tens of degrees of sky (34.6° × 68.0° on a phone held upright) and the edge pointer says which way to turn but not how the rest of the sky lies (README.md#L1349-L1351). A reader who turned the wrong way sees the dot on the far side of the disc and turns until the crosshair is on it (README.md#L1354-L1356). The **radar view** is the same full-screen view opened without the camera, with the radar as the whole page (README.md#L1460-L1469).

## Geometry and content

It is the plot the console draws for the selected pass (`src/components/rail/draw-sky.ts`), with the same geometry, r = R (90 − el) / 90, east to the right, made smaller, so a pass reads as it does in the rail's Passes tab (README.md#L1356-L1359).

Drawn: a dark-glass disc readable over daylit or black sky; rings at 30° and 60°; spokes every 45°; the mask as a pink dashed ring; the horizon as the rim; N, E, S, W (README.md#L1361-L1363). The pass is drawn in gold (`#E8BC5A`), the flown stretch faint, AOS and LOS on the mask ring, the highest point a small ring (README.md#L1363-L1366). The spacecraft is a dot in the pass colour once above the mask, cyan between mask and horizon, and nothing below the horizon; it is the only solid dot on the plot (README.md#L1366-L1368). An end cut off by the analysis window rather than the horizon is starred, AOS* or LOS* (README.md#L1368-L1370). Pass and spacecraft follow the view's clock, so on a rehearsed pass radar and picture show the same moment (README.md#L1372-L1373). See [[pass-prediction]].

## The crosshair

The crosshair is a ring with four arms in a dark casing, drawn last (README.md#L1374-L1375). It is not recomputed: it is the pose the picture was just drawn for, after the declination ([[magnetic-declination-wmm]]), the hand turn and the smoothing, so the two cannot disagree — and it is no more accurate than the picture; a 10° compass error is 11 px at the rim of a 156 px radar against 110 px in the picture (README.md#L1375-L1379). Below the horizon it stays on the rim at 60% strength with a broken ring; within 5° of straight down it is not drawn at all, since the azimuth there swings with hand tremor (README.md#L1380-L1383). On an iPhone still finding north there is no crosshair, but disc, pass and spacecraft are drawn (README.md#L1404-L1408).

Its blue, `#3D8BFF`, was chosen as a colour the view used for nothing else, distinguishable from the gold and cyan dot when they overlap (README.md#L1441-L1446).

## Size and placement

Two fifths of the screen's short side, between 112 px and 200 px: 156 px on a 390 px phone, 200 px on a tablet (README.md#L1385-L1386). Held upright it sits at the right with its foot 8 px above the readout; it rises at once when the readout grows but does not drop for small shrinks (so it does not bob under the eye), following only a fall of more than 40 px (README.md#L1387-L1393). It is not drawn before the first reading, in the failed state, or when there is no room against the title bar or status line (README.md#L1397-L1403). It takes no touch (`pointer-events: none`); the edge pointer and labels are moved off its box (README.md#L1410-L1418).

The **Radar** tool hides and shows it; hiding writes `gt.arradar` = `0` to `localStorage`, showing writes `1`, and no write happens until the reader presses (README.md#L1418-L1422).

## Redraw economy

The radar has its own canvas, at the picture's pixel ratio capped at 2 (README.md#L1448-L1450). The static disc is painted once on its own layer and redrawn only on size, ratio, mask or colour change; the pass is a layer redrawn when it changes; a frame identical to the last to a tenth of a degree (at most 0.11 px at the rim of a 156 px radar) is skipped (README.md#L1450-L1456).

## The radar view

A **Radar** button left of AR in the tab row, offered on the same terms, opens the view in a second mode (README.md#L1461-L1464). Only motion sensors are requested; no camera stream is ever opened, and the title reads *Radar over Bangkok* (README.md#L1464-L1467). The plot fills the room between top bar and readout, up to 420 px (366 px on a 390 × 844 phone), drawn in a unit `u` = side/156 clamped to 1–2.2 (README.md#L1469-L1476). The lens, the hand-turn drag and pinch are gone; the first readout row is *Aim*, and the Target row ends with steering words including "on target" within 2° (README.md#L1480-L1488). Align's buttons turn the crosshair a degree (README.md#L1488-L1490). Its failure sentences are its own and never send the reader to the camera (README.md#L1494-L1500).

**One controller, two modes.** Everything that makes the radar right — which orientation stream to trust, iPhone compass fusion, declination, hand turn, smoothing, clock and observer, Back handling, the inert page, the paused globe, wake lock — lives in the controller; a second controller would carry a second copy of each, and a difference between copies would go unseen until a real phone (README.md#L1502-L1507). So the radar view is `open({ mode: 'radar' })`: a `data-mode` attribute the style sheet reads, plus some two dozen lines of `arview.ts` marked `CHANGED (radar view)` (README.md#L1507-L1510). The single permission is still requested synchronously in the click, before anything is awaited (README.md#L1514-L1519).

## Aim: camera or head

The **Aim** switch makes the crosshair follow either the rear camera or the phone's top edge, the "head" — useful for a phone held like a compass or laid flat (README.md#L1530-L1535). In the radar view the first row and steering words follow it too; in the AR view the picture stays the camera's and the View row adds the head's direction (README.md#L1535-L1537). The head is the device's +y axis, independent of screen rotation; laid flat face up it points at 360° − α (README.md#L1539-L1542). The check takes one pose through all four screen rotations and wants the same head to 0.01° (README.md#L1545-L1546). The choice is kept in `gt.araim`, written only on the press (README.md#L1552-L1554).

The head has its own smoother. The pose smoother's time constant follows the speed of the held vector (0.12 s below 20°/s, 0.03 s from 90°/s up), but a flat phone spun about the vertical barely moves the camera axis, so in a model the head derived from the camera's smoothed pose trailed by about 20° at 180°/s; a second smoother keyed to the head's own speed trails by about 4° (README.md#L1557-L1568). The README notes this figure is the model's, not a check's (README.md#L1568-L1570).

## What is checked

Of the AR suite's 278 checks, 67 cover the radar and 91 the radar view, run on the rebuilt page only (README.md#L1698-L1702). `GT_AR_ONLY=radar` and `GT_AR_ONLY=radarview` run those parts with the maths alone (README.md#L1702-L1703). The plot's side, transform and colours are written out in the checks, not read from code, and compared against the radar canvas's pixels (README.md#L1703-L1706). Seven radar rules were each removed from a scratch build and caught (README.md#L1712-L1716); for the radar view, the head's direction is derived independently from the W3C angles as [−sin α cos β, cos α cos β, sin β] and compared over eight poses (README.md#L1718-L1725), and fifteen injected faults were each caught (README.md#L1732-L1738). The suite also confirms the radar view never asks for the camera and writes nothing to storage (README.md#L1725-L1728).

## Related

- [[ar-sky-view]], [[ar-snap]] (Snap includes the radar in its picture), [[magnetic-declination-wmm]].
- [[verification-harness]] — how the suites run.
