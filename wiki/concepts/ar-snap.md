---
type: concept
title: "AR Snap"
tags: [ar, data, verification]
sources: [readme-ar-and-architecture]
created: 2026-11-24
updated: 2026-11-24
---

# AR Snap

**Snap** is the first of the four tools in the [[ar-sky-view]] and the radar view ([[ar-radar]]): one press takes a single picture of what the screen shows, without the buttons, and hands it to the reader (README.md#L1575-L1577). It is dimmed until the first orientation reading, after a failure, and while a picture is being made (including while the share sheet is open), so a double tap makes one file (README.md#L1577-L1579).

## Contents

- **With a live camera**: a JPEG at quality 0.92, the screen's size at the view's pixel ratio (the device's, up to 2 — 780 × 1688 on a 390 × 844 screen at ratio 2 or 3), with the camera picture laid as `object-fit: cover` lays it (cropped, not letterboxed), the sky over it and the radar at its box (README.md#L1581-L1585).
- **Without a camera picture** (radar view, or camera declined or busy): a PNG of the sky where drawn and the radar on the dark ground `#05090C` (README.md#L1585-L1586).

A three-line caption strip runs along the foot: the spacecraft and where it was (e.g. "KNACKSAT-2 · 122° ESE · 30.7° up · 670 km" — see [[knacksat-2]]); the observer's name, coordinates and the view's instant in UTC, marked sim time or live; and where the phone is aimed, by which aim (README.md#L1586-L1591). With no compass the aim line ends "· no compass", since the on-screen status warning is not in the picture and the bearing would otherwise read as fact (README.md#L1591-L1592). Over-wide lines shrink to 72% before being squeezed; held sideways, the strip moves to the top when the radar reaches into the foot (README.md#L1593-L1595).

**JPEG or PNG.** A camera picture is a photograph, suited to JPEG; the sky, radar and text are thin lines on a flat ground, which JPEG rings around and PNG keeps exactly (the suite's PNGs are about 130 KB at 780 × 1688). The type follows what the picture contains (README.md#L1604-L1608).

## File name

`sattrack-sky-<site>-<yyyymmddThhmmssZ>.jpg`, or `sattrack-radar-<site>-….png` for the radar view (README.md#L1597-L1598). The timestamp is the browser's clock at the moment of making, while the caption's is the view's (which on a rehearsed pass is the pass's) (README.md#L1598-L1599). The site name is reduced to ASCII lower case with single hyphens, at most 24 characters, *site* if nothing remains, so observer input cannot form a path: `../../Etc/Passwd` becomes `etc-passwd` (README.md#L1599-L1602).

## Hand-over

Where `navigator.share` exists and `canShare` accepts the file, the picture goes to the share sheet and the reader's choice there is invisible to the page; closing the sheet is a cancel, not an error (README.md#L1610-L1613). Otherwise, or when the share throws anything but a cancel, it becomes a download via a temporary link created inside the view (the rest of the page being inert), clicked and removed at once, with its object URL revoked after 30 s (README.md#L1613-L1617). The status line reports "Picture shared.", "Picture saved as <the name> — …" or "The picture could not be made (why)." (README.md#L1617-L1619). A picture in progress when the view closes is dropped silently (README.md#L1620-L1621). Focus returns to the button only under stated conditions (README.md#L1621-L1623).

## Privacy statement

The view previously said the camera picture is never drawn into a canvas, read back or captured; Snap made that untrue, and the README states the replacement (README.md#L1625-L1626):

- The picture is drawn once per press, by one `drawImage` of the video into a canvas `snap.ts` creates for the purpose, never added to the page and released after encoding (README.md#L1627-L1629).
- The view's own sky and radar canvases never hold it; until Snap is pressed nothing draws, reads back or captures it (README.md#L1629-L1630).
- The press makes no network request (no fetch, XHR, beacon or socket) and stores nothing (no `localStorage`, session storage or database); the file exists only as the handed-over blob and, for a download, its URL, released after 30 s (README.md#L1631-L1634).
- The caption does carry the observer's name, coordinates and UTC instant into the kept file; after *Use my location* those are the phone's own coordinates to a hundredth of a degree (README.md#L1635-L1637). See [[observer-value]].

The "What it costs" section restates that the view never draws the picture into the sky's or radar's canvas, and that Snap draws it once into its own canvas (README.md#L1666-L1668).

## What is checked

These claims are held by `verification/suites/verify-ar-snap.js` and `tests/lib/snap.test.ts` (17 tests, covering file name, cover rectangle, draw order, strip placement, the 72%, the three hand-over paths and the aim vector) (README.md#L1639-L1642).

`npm run ar-snap` has 79 checks, takes about a minute, runs alone, and is the `ar-snap` stage of `run.js` in the quick set, for the rebuilt page only (README.md#L1740-L1742). Its parts press Snap with a live camera (A), with the camera declined and on an iPhone before north is found (B), in the radar view (C), and for names, live time, quick taps and closing mid-picture (D); part E presses nothing and expects a failed view's button dimmed (README.md#L1742-L1745). Each file is decoded in a separate blank page, and the expected values are written out, not read from `snap.ts`: name, type and magic bytes (FF D8 FF or 89 50 4E 47), pixel size, colour at 197 points, the crosshair, the pass's gold, the strip's three lines, and the words caught at `fillText` (README.md#L1746-L1751).

**The census** wraps the usual ways of using a picture — drawing the video, reading the sky canvas back, ImageBitmap, ImageCapture, MediaRecorder, a WebGL texture, OffscreenCanvas, VideoFrame, per-frame callbacks, a track's frames — and requires one press to be exactly one `drawImage` of the video, and a session without a press to leave the census empty with no download or object URL (README.md#L1751-L1758). It also requires no request, no stored image and no database (README.md#L1758-L1759). Nineteen injected faults were each caught (README.md#L1759-L1763). The README is explicit that the census is a list a browser can add to, not a proof, and cannot show what a phone does with the file (README.md#L1763-L1764); the share sheet in the suite is a stand-in and its camera is one colour (README.md#L1693-L1695).

## Related

- [[ar-sky-view]], [[ar-radar]]
- [[forget-data]] — the project's broader stance on what the page keeps (not discussed in this range).
- [[verification-harness]]
