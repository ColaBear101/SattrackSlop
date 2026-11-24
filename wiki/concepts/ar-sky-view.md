---
type: concept
title: "AR sky view"
tags: [ar, earth-console]
sources: [readme-ar-and-architecture]
created: 2026-11-24
updated: 2026-11-24
---

# AR sky view

The **AR sky view** is a full-screen mode of the Earth console, offered on phones and tablets, that shows the rear camera's picture with the sky drawn over it in the direction the phone points, so that a reader outdoors can find a pass without turning a bearing such as "68° NE" into a direction in the sky (README.md#L1193-L1197). It is not a camera position of the [[globe-scene]]; its **AR** button sits at the right of the stage's tab row, so it is available on the Map tab too (README.md#L1198-L1199). A sibling mode without the camera, the radar view, is described in [[ar-radar]].

## Where it is offered

The button appears only where the primary pointer is a finger, `(pointer: coarse)`, so the desktop console is unchanged (README.md#L1196-L1198). The view needs no WebGL and stays offered when the globe falls back to the flat map (README.md#L1220-L1221).

## What is drawn

Back to front: the ground below the horizon, lightly shaded; elevation rings every 15° and meridians every 30°; the horizon with a tick every 10°; the 5° mask, dashed; the compass points; the Sun; the current or next pass, with a mark every minute (or enough minutes to keep it to fifteen marks), its direction of travel and highest point; the spacecraft (README.md#L1202-L1206). When the target is off screen an arrow on the edge carries steering words such as "turn right 30° · up 12°", "turn round", or near the zenith "face SW (226°) · 34° above the horizon"; while the spacecraft is below the horizon with a pass coming, the arrow points at where it will rise, e.g. for [[knacksat-2]] (README.md#L1206-L1210).

Colours keep the globe's meanings (cyan the spacecraft, orange in view from the site, pink the mask) and are the same in both themes over a camera picture (README.md#L1210-L1211). The title names whose sky it is ("Sky over Bangkok"), and a readout gives view direction, the source of north, the declination applied, the clock, target and pass (README.md#L1212-L1213). Held sideways the readout is a left column a third of the width; an earlier half-width layout covered the spacecraft (README.md#L1214-L1217). Four tools, **Snap**, **Aim**, **Radar** and **Align**, sit in the readout's row (README.md#L1218-L1220; see [[ar-snap]] and [[ar-radar]]).

## Asking for permissions

One tap asks for motion sensors and the camera, and the order matters: on an iPhone `DeviceOrientationEvent.requestPermission()` is answered only while the tap is the current user gesture, and WebKit does not carry that across an `await` on `getUserMedia`, so motion is requested first and the camera second in the same task, before awaiting either (README.md#L1225-L1231). Starting the camera inside the tap also lets WebKit re-ask for a previously declined camera (README.md#L1231-L1232).

The presence of `requestPermission` does not imply iOS: the README states Chrome 152 has it too, while Firefox and Samsung Internet have none and deliver events freely; the page does no browser sniffing (README.md#L1234-L1236). Only a secure page receives events (https or localhost); a copy served over plain http from a laptop to a phone says so and gives the https address (README.md#L1238-L1242). Each refusal has its own sentence; a refused camera is not fatal — the sky is drawn on black with the reason (declined, no rear camera, in use, front camera only) (README.md#L1242-L1245). A camera answering after the view has closed is stopped at once (README.md#L1246).

## Which way the camera points

The W3C angles are treated as an intrinsic Z-X'-Y'' rotation, R = Rz(α)·Rx(β)·Ry(γ), from device axes to East-North-Up, with the rear camera along the device's −z (README.md#L1250-L1251). The camera direction is always taken from the matrix, never from α, because held upright two different triples describe one pose; the check shows (α, β, γ) and (α+180, 180−β, γ+180) agree to 1.6e-15 over 2000 poses (README.md#L1251-L1254).

Turning the phone sideways turns the picture, not the view. The screen rotation comes from `window.orientation` where available, because iOS 16.4 reported `screen.orientation.angle` in the opposite sense; where the reported angle contradicts the window's shape, the edge gravity says is up is used (README.md#L1256-L1260). The check measures the horizon held sideways both ways: level within 0.01 px across 20°, east to the right (README.md#L1260-L1262).

## Which way is north

Every platform gives magnetic north and none corrects it (README.md#L1266); the correction is described in [[magnetic-declination-wmm]]. Android Chrome, Samsung Internet and Firefox 110+ use `deviceorientationabsolute`; Safari and every iPhone browser use `webkitCompassHeading` beside an α with an arbitrary zero; with no compass α is relative to wherever it started (README.md#L1268-L1272).

On the iPhone, α comes from Core Motion's gyro-only frame and drifts, while north arrives separately as the compass heading of the top edge; they are tied by an offset, heading − (360 − α) (README.md#L1274-L1277). Because Apple does not document which axis the heading follows once the phone is upright or tipped back, the offset is sampled only within 60° of flat or at 60°–85° of tilt (where the readings agree to 2°) and held while the phone points up (README.md#L1277-L1282). An iPhone raised straight to the sky therefore starts on "Finding north", drawing only horizon, mask and rings (README.md#L1282-L1284). Samples are averaged on the circle, refused above 20°/s of turning or when the compass is uncalibrated or worse than ±25°, and a reading that disagrees by more than 20° is accepted after holding for 1.5 s (README.md#L1285-L1287). Returning to the page restarts the fusion (README.md#L1289-L1290).

With no compass the view says it is not tied to north, and the reader drags the drawn Sun onto the real one; a later compass reading takes over (README.md#L1292-L1294). A still phone is silent (Chrome sends events only on a 0.1° change and, from Chrome 153, suspends them when hidden), so only the first reading has a timeout (README.md#L1296-L1300).

## The lens

No web API reports a camera's field of view. The view assumes 68° (phone main cameras being 24–28 mm equivalent, 71.6° to 63.4°); on a 390×844 screen with a 1080×1440 stream that gives a 625.6 px focal length, a 34.6° × 68.0° view and 10.9 px per degree at the centre, so a 10° compass error is 110 px (README.md#L1334-L1338). A pinch or the slider under *Align* sets the lens, which is kept; the readout says "assumed" until then (README.md#L1338-L1339).

Compass error is the larger term (README.md#L1341-L1343), so a sideways drag turns the drawn sky by hand, divided by the cosine of elevation, reported on the *North* line and forgotten on every open (README.md#L1343-L1345).

## The clock and the observer

There is one clock. Opened live at 1×, the view stays on the present, resetting whenever the clock drifts more than a second from it (README.md#L1646-L1648). Opened on a scrubbed or sped-up clock, it draws that instant, labels it as sim time, and offers *Go live*; a pass can be rehearsed on the real sky that way (README.md#L1649-L1652). The observer defaults to Bangkok; when the phone's time zone differs from the observer's by an hour or more the view warns, and *Use my location* moves the observer through the console's own path (README.md#L1654-L1658). See [[observer-value]].

## What it costs

While the view is open the WebGL globe draws nothing and its labels are not laid out, and the screen is kept awake (README.md#L1662-L1665). Closing by *Close*, Escape, Back or leaving the page stops the camera and removes every listener (README.md#L1665-L1666). The view keeps up to three `localStorage` choices, each written only when the reader makes it: `gt.arlens`, `gt.arradar` and `gt.araim` (README.md#L1668-L1671).

## What is checked

`GT_TARGET=new npm run ar` checks the maths in Node (frame, 2000 random poses, projection, the Sun against a separate derivation, iPhone compass fusion, ticks, WMM against NOAA), then drives the production build in Chromium phone contexts with permissions, camera, visibility and sensors mocked (README.md#L1676-L1684). Three deliberate faults were each caught: a flipped declination sign (10 checks fail), camera asked before motion, and ignored screen rotation (sideways horizons 220 px out of level) (README.md#L1685-L1688). The events are synthetic, so it proves maths and wiring, not a phone's sensors; a manual checklist covers six real browser/device combinations (README.md#L1688-L1696).

The suite has 278 checks and takes about five minutes; 120 also run on the old page (which has no radar) and 158 only on the rebuilt page (README.md#L1698-L1702). See [[ar-radar]] for the radar parts and [[verification-harness]] for how suites are run.

## Related

- [[ar-radar]], [[ar-snap]], [[magnetic-declination-wmm]]
- [[pass-prediction]] — the passes the view draws.
- [[lazy-chunks-and-entry-budget]] — the view's code is brought in as a chunk before its button is shown (README.md#L1462-L1463).
