---
type: concept
title: "Close-up camera"
tags: [globe, earth-console]
sources: [readme-globe-and-views]
created: 2026-11-24
updated: 2026-11-24
---

# Close-up camera

The close-up is the fourth of the [[globe-scene]]'s camera positions (ledger row L72 of the [[change-ledger]]), placed before POV in the camera row. It puts the camera a few metres from the selected spacecraft and draws that spacecraft's 3D model "the way it flies": along its track with its top away from the Earth, i.e. in the local-vertical, local-horizontal frame (README.md#L939-L941). Technically it is POV's on-board camera with its aim made into an orbit round the craft (README.md#L702).

## Controls and rendering

- Drag orbits round the model; scroll or pinch changes distance; *Reset view* starts again (README.md#L941-L942).
- The globe behind is drawn from where the spacecraft is (POV's camera); the model is a separate render pass of its own, in metres (README.md#L942-L943).
- Lighting: the real Sun — red, then gone as the spacecraft enters the Earth's shadow, which the card announces — plus the Earth's light from below and soft shadows (README.md#L943-L945). The sunlight model is shared with the [[realistic-globe]] (`src/lib/models/sunlight.ts`) (README.md#L870-L872).
- *Realistic Earth* on the card switches on the realistic surface, "one tick away" (README.md#L945-L946).
- The card names the model's source with the credit that source asks for (README.md#L946).
- *Hide* folds the card to its title bar (spacecraft name and *Show*); both states persist while the page is open (README.md#L1008-L1010).

How the model is oriented and spun is configurable per model; see [[spacecraft-attitude]]. A reader may substitute their own model; see [[reader-uploaded-models]].

## The bundled models

| Spacecraft (NORAD numbers) | Model | Size |
|---|---|---|
| [[knacksat-2]] (67683) | built for this page from the team's photographs and specifications | 6,486 triangles, 0.6 MB |
| ISS (25544, 49044, 36086) | NASA/JSC IGOAL, NASA 3D Resources, simplified (NASA does not endorse the page) | 75,000 triangles, 6.8 MB |
| Tiangong (48274, 53239, 54216) | "tianGong" by w29572227, CC BY 4.0, "once its file is baked" (`scripts/models/tiangong.py`) | not given |

Source: README.md#L948-L952. Each model is a separate file fetched only for its close-up, made by headless Blender scripts in `scripts/models/` that each write a preview image (README.md#L954-L955). The Tiangong row has no size and is qualified "once its file is baked", which suggests the model file may not yet be shipped; the README does not say so directly.

## The KNACKSAT-2 model

The model is a 3U CubeSat described in detail (README.md#L950):

- large solar cells in a column on each side (six on three sides, four on the marked side), all oriented as the close-up photographs show — black under cover glass with faint fingers, a thin light edge, two cut forward corners; silver tabs, a zigzag wire and a matte gold interconnect bar at each cell's after end; silver screws in gold rims in the cut corners;
- on the marked side, a camera (lens down a round opening), two windows, the name and the marks of the team and partners, all white as on the satellite;
- at each end a flat black plate between black rails with silver screws, under NBSPACE's deployable antenna module.

**Antennas.** The antenna elements are flat tape-measure strips 6 mm wide, coiled inside the module, deploying through slots in its edge near a corner under strips of gold Kapton where they were tied down for launch; nothing of the antennas is on the end plate, which sits 1.5 mm inside the rail ends (README.md#L974-L981). At the forward end (the end the marked plate's camera is nearer) the VHF dipole runs up and down and the UHF dipole left and right, seen from ahead with the side away from the Earth up; at the after end the LoRa dipole runs left and right (README.md#L982-L984). Radio context: [[doppler-and-transmitters]].

The model turns slowly about its long axis, "as it does" (README.md#L950); the default rate is 2 degrees a second about Z (README.md#L1005; see [[spacecraft-attitude]]).

### The marked plate, from a photograph

The marked plate wears an image of the real one, `scripts/models/knacksat2-plate.png`, produced by `scripts/models/plate-from-photo.py` from the owner's photograph of the flight model, which is not in the repository (README.md#L955-L957). The script maps the plate's four corners in the photograph to a rectangle, sets levels, paints out what the model draws itself (the camera's gold cover, off in flight; screw pads; tab edges), redraws NBSPACE's mark from its own artwork where the photo is soft (`--logo`, using `logo-nb-white.webp` from nbspace.co.th, also not in the repository), and with `--white` makes every mark white (README.md#L957-L963). Because the flight model was photographed slightly from one side, the plate's top and bottom edges slope 4° and 5° in the photo and the corners follow those slopes, or the print would come out rotated (README.md#L963-L965). The full Blender command lines are given in the README (README.md#L968-L971).

Both outputs are reproducible — the image to the pixel and the model to the byte; the lens's faces, which Blender's sphere returns in an order of its own, are sorted (README.md#L973-L974).

## Related

- [[globe-scene]] — the other camera positions, especially POV.
- [[spacecraft-attitude]], [[reader-uploaded-models]].
- [[knacksat-2]] — the assignment's spacecraft.
