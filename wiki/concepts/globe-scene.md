---
type: concept
title: "Globe scene"
tags: [globe, earth-console]
sources: [readme-globe-and-views]
created: 2026-11-24
updated: 2026-11-24
---

# Globe scene

The globe scene is the Earth console's 3D view: the Earth, the selected spacecraft with its orbit, and optional layers (trail, catalogue dots, footprint, observer pin), seen through one of five camera positions. This page covers the cameras (including the on-board POV view), the visual language that lets the globe be read like the flat map, how labels and picking respect the Earth's occlusion, how the photographic map is sized, and the controls that give the globe more room. The opt-in realistic surface is a separate page, [[realistic-globe]]; the spacecraft close-up is [[close-up-camera]].

## Five positions, two cameras

The camera control offers Free, Satellite, Bangkok, Close-up and POV, but there are only two kinds of camera (README.md#L697-L698):

- **Orbiting camera** — Free, Satellite and Bangkok are the same camera: a point at a fixed distance from the Earth's centre, looking at the centre, differing only in how the bearing is chosen (README.md#L698-L699). "Satellite" therefore shows the Earth from the spacecraft's *direction*, not from the spacecraft; at 4.2 Earth radii out the spacecraft is a dot in mid-frame (README.md#L699-L701).
- **On-board camera** — POV sits on the spacecraft. Close-up is POV's camera with its aim turned into an orbit round the craft (README.md#L702; see [[close-up-camera]]).

AR, which a touch screen shows among the stage's tabs, is not a sixth camera: it leaves the globe for the phone's own camera (README.md#L702-L704; see [[ar-sky-view]]).

## POV: the view from the spacecraft

POV faces **along-track** by default — forward along the horizontal part of the velocity, zenith as screen-up — so the horizon runs level (README.md#L706-L707). Nadir is pitch −90°, one drag down (README.md#L708). The view used to open on nadir, the orientation nadir imagery is published in, but with the view axis on the local vertical a sideways drag (a yaw about that vertical) could only roll the picture and the camera "felt stuck"; facing forward separates yaw (turning the head) from pitch (tilting it) (README.md#L708-L711). Dragging turns the head rather than leaving the mode, and the wheel changes the **lens** rather than range: 8° is a long telephoto on the limb, 90° takes in the whole horizon (README.md#L711-L714).

From [[knacksat-2]] at 369.8 km the horizon is **70.94° off nadir**, 19.06° below the local horizontal, so the forward view opens with its centre above the limb: the Earth is a thin band along the bottom of the 42° frame under the atmosphere's glow, and two degrees of pitch up remove the planet from view (README.md#L716-L719). With no ground at the centre to measure, the GSD readout gives the figure straight down and says **"at nadir, below frame"**; the second half is dropped when nadir is in the picture, which from GEO can happen with the boresight already off the disc, since the whole Earth is 17° across from there (README.md#L719-L722). The catalogue cloud is still drawn, so the other 2,157 objects appear as points above the limb without any extra work (README.md#L722-L724).

### Four lessons from building POV

The README lists four things that "were not obvious until the view existed" (README.md#L726-L739):

1. **Orientation is rebuilt from the same basis every frame**, not accumulated; accumulation lets a long drag walk the roll off true for good (README.md#L728-L729).
2. **The spacecraft marker is exactly where the camera is**, so it is hidden in POV (drawing it would fill the frame with the inside of a sprite), as is the halo (README.md#L730-L732).
3. **The marker scale factor read the wrong variable** — sprite sizes came from the free camera's distance from the origin, so the site pin and the 2,158-point cloud would have rendered at a stale size; they now use the actual camera distance (README.md#L733-L736).
4. **The atmosphere is a back-faced additive shell at 1.022 Earth radii** (140 km altitude), so a POV camera on a decaying object would sit inside it and see a full-frame wash; it is dropped below 1.03 (README.md#L737-L739).

`cam0`, the free camera's bearing and distance, is never written while POV is on, so leaving POV restores the previous camera exactly (README.md#L741-L742).

### How POV is checked

`verification/suites/verify-pov.js` measures the camera rather than the picture, because a camera at 0.9999 of the right place still renders a plausible image (README.md#L744-L745). It checks position against the propagated state vector (exact, 0.00 km), view direction against along-track and screen-up against zenith (both to 1e-6), that a full downward drag lands within the one-degree clamp of nadir, and then the real wheel and drag handlers (README.md#L745-L748). It works around one trap: the page owns the clock and pushes it into the scene every frame, so setting the scene's time directly is overwritten on the next frame, and at 7.7 km/s that one frame of drift looks exactly like a camera-placement bug (README.md#L748-L751). See [[verification-harness]].

## Reading the globe: colours and the key

The globe uses the flat map's colours for the flat map's meanings: **cyan** the spacecraft and its track, **pink** the site and its access circle, **pale** the footprint, **orange** "in view from the site" — the line of sight, and the marker while a pass is up (README.md#L755-L757). The orbit ring was orange too, but in the Satellite camera it ran edge-on through the marker and read as the stretch of orbit Bangkok can see; it is now a neutral blue-grey, as reference geometry rather than data (README.md#L757-L760).

A key sits in the bottom-left corner; it gives that corner up to the POV minimap, and is dropped on a phone for lack of room (README.md#L760-L761). With the orbital-elements layer on, the key also names that layer's symbols — Ω, i, ω, θ, h, e and v, drawn on the globe as bare letters with the full sentence only under the pointer — each in its label's colour (README.md#L761-L764). That makes the key eleven rows, 225 px; on a screen under 560 px tall (a phone held sideways) it climbed into the clock, so there the element rows take the key to themselves while they show (README.md#L764-L765). The catalogue's rows in the key change with [[catalogue-colouring]].

## Labels, occlusion and picking

The spacecraft's name and the catalogue's hover name are HTML over the canvas and so have no depth. The marker behind the planet was hidden by the depth test while its name was still drawn over the near face — in the Bangkok camera, a bold KNACKSAT-2 over the Indian Ocean with the spacecraft over South America (README.md#L767-L771). A label is now hidden whenever the unit sphere lies between the camera and its point, and the same test gates hover and click on the catalogue, which three.js would otherwise raycast straight through the Earth (README.md#L771-L773). The test applies only while the Earth is drawn: hiding the Earth is how one looks at what was behind it (README.md#L773).

## Sizing the photographic map

The map texture is sized for the view, not the GPU (README.md#L775). The old ladder stopped only at `MAX_TEXTURE_SIZE` (8192 or more on most phones), so a phone at the opening zoom fetched the 6.6 MB map for a globe 560 device pixels across (README.md#L775-L777). The most magnified point of an orbiting camera's view is the middle of the disc, where a unit of surface spans f/(d−1) pixels; a map W = 2πf/(d−1) texels wide puts one texel under each pixel, and the page takes the smallest rung within a quarter of that (README.md#L778-L780). At the opening 4.2 Earth radii that is 2.56 times the drawing buffer's height — the 0.6 MB rung for a phone or a 1440×900 window, the 2 MB rung on a 2× display (README.md#L780-L781).

Zooming in fetches the sharper rung once the view has held still for 400 ms, alone, without the coarse "insurance" copy the first load starts with; POV always wants the best the GPU holds, since its lens is on the ground (README.md#L782-L784). Save-Data, or a connection the browser rates 3G or slower, keeps the coarse rung throughout, and the Layers panel notes this (README.md#L784-L785). `npm run globe` checks each case against a rung it computes itself from the canvas and camera (README.md#L786).

## More room, and a plain start

- **Full screen**, beside Layers (ledger row L78), shows the globe with its controls, clock, the close-up's card and the timeline bar (ledger row L85), which a chevron folds away; Escape or *Exit full screen* leaves it (README.md#L790-L793). It is offered only where the browser can full-screen part of a page (not iPhone Safari), as an icon alone on a phone, and not under 375 px wide, where the globe is already the screen's width (README.md#L793-L796).
- On a wide screen an arrow at the stage's top right folds the answer panel away so the globe takes the width; nothing is stored (README.md#L796-L798).
- **The globe opens plain** (ledger row L80): Earth, spacecraft and orbit only — no trail, catalogue dots, footprint or observer pin. Each is one press away in Layers, which also holds the trail length (Off, 30 m, 1 orbit, 6 h, 24 h); nothing is stored, so each visit opens plain (README.md#L800-L802).
- **Layers → Observer pin & circle** (ledger row L79) hides the pink pin and the dashed 5° access circle round the chosen place (README.md#L804-L806).

The Layers control itself — a button on the globe opening a scrolling popover — is described under [[page-navigation-and-accessibility]].

## Related

- [[realistic-globe]], [[close-up-camera]], [[catalogue-colouring]] — other parts of the same scene.
- [[ground-track]], [[pass-prediction]] — the flat-map meanings the colours borrow.
- [[legacy-earth-console]] — the old page the scene is compared against; [[regression-gate]] — the ab3d comparison of the 3D scene.
