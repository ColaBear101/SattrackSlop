---
type: concept
title: "Spacecraft attitude in the close-up (How it flies)"
tags: [globe, earth-console]
sources: [readme-globe-and-views]
created: 2026-11-24
updated: 2026-11-24
---

# Spacecraft attitude in the close-up

Spacecraft attitude, in this project, is how the 3D model in the [[close-up-camera]] is oriented and spun. By default each model flies in the local-vertical, local-horizontal frame — along its track, top away from the Earth (README.md#L940-L941) — with a model-specific spin. The *How it flies…* panel on the close-up's card (ledger row L77 of the [[change-ledger]]) lets a reader change this for one model only, in this browser (README.md#L988-L989). It is a display setting; this section of the README describes no attitude data taken from the real spacecraft.

## Where it points

Three pointing modes (README.md#L991-L995):

- **Along the track** — with a chosen face leading.
- **Toward the Sun** — holds the chosen face on the Sun and turns the model smoothly round an orbit.
- **Fixed among the stars** — holds the model as it was among the stars when chosen, "the way a spacecraft left to itself stays while the Earth turns past it". After a reload or switching model, the hold restarts from when the model is next put up; the hold itself is not stored.

## Offsets: yaw, pitch and roll

Applied from the chosen pointing. Signs (README.md#L996-L997):

- yaw + turns the front to the right;
- pitch + raises the front;
- roll + lowers the right side.

## Spin rates

Spin lives on the card itself under **Spin rates**, a section that shows and hides and stays as left while the page is open (README.md#L999-L1000). There is a slider and a number for each of the model's own three axes — X side to side, Y top to bottom, Z front to back — up to 90 degrees a second either way, positive anticlockwise seen from the axis's tip (README.md#L1000-L1002).

Rates about more than one axis turn the model about their combined direction at their combined length: 3 about X and 4 about Y is 5 degrees a second about (0.6, 0.8, 0), "as rates held steady about a body's own axes do"; the card says how long a turn takes and which way (README.md#L1002-L1004).

Buttons (README.md#L1004-L1008):

- *Its own spin* restores the model's default — KNACKSAT-2's 2 degrees a second about Z, none for the others (see [[knacksat-2]]).
- *Stop* holds it still.
- *Reset orientation* puts the model straight at that instant (along track, front leading, no yaw/pitch/roll), releasing accumulated turns but keeping the spin rates, so it turns on from straight.

## Timing and continuity

The spin keeps time with the page's clock: still while the clock is paused, fast when the clock runs fast (README.md#L1012-L1013). A new rate leaves the model where it is at that instant and turns it on from there; a new pointing or face moves it at once (README.md#L1013-L1014).

Until anything is changed, the close-up draws what it always drew: KNACKSAT-2 turning slowly about its long axis, the stations along their track, and reader models as the reader turned them (README.md#L1014-L1016; see [[reader-uploaded-models]]). The card says when a model flies as the reader set it rather than as the page does, and *Reset to its own* restores it exactly (README.md#L1016-L1017).

## Storage

A setting is kept per model in `gt.attitude`, written only once something changes (README.md#L1017-L1018). A reader's own model takes its setting with it when removed or replaced (README.md#L1018-L1019). A private window, or the snapshot under `?tle=embedded`, keeps the setting for the visit only and says so (README.md#L1019-L1020; see [[assignment-snapshot-tle-embedded]]). `gt.attitude` is among the display choices [[forget-data]] clears (README.md#L1147-L1148).

## Related

- [[close-up-camera]] — the view this panel controls.
- [[globe-scene]] — the POV camera, whose along-track/zenith basis is the same frame.
