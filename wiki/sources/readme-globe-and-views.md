---
type: source
title: "README: the globe and its views"
authors: ["SattrackSlop project"]
raw: "README.md#L695-L1190"
snapshot: "4ce1719 + uncommitted working-tree edits (2026-11-24)"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [globe, earth-console]
entities: [knacksat-2, celestrak, legacy-earth-console]
concepts: [globe-scene, catalogue-colouring, realistic-globe, close-up-camera, spacecraft-attitude, reader-uploaded-models, page-navigation-and-accessibility]
---

# README: the globe and its views

This range of the project `README.md` (lines 695–1190) describes the Earth console's 3D globe: its five camera positions, the colour and label rules that make it readable, the optional catalogue colourings, the opt-in "realistic" Earth and sky, the close-up of a spacecraft model and how that model flies, models a reader supplies, and finally how the page as a whole is laid out and navigated at every screen size. Much of it is written as a comparison with the old page (the [[legacy-earth-console]]), and many paragraphs point at rows of `CHANGES-FROM-LEGACY.md` (the [[change-ledger]]); those row numbers are written "ledger row L78" here to keep them apart from README line citations. It is a child of [[sattrackslop-readme]].

## The view from the spacecraft (L695–L751)

The camera control has five positions but only two kinds of camera: Free, Satellite and Bangkok are one camera at a fixed distance looking at the Earth's centre, while POV sits on the spacecraft and Close-up is POV's camera turned into an orbit round the craft (README.md#L697-L702). AR is not a sixth camera; it leaves the globe for the phone's own camera (README.md#L702-L704; see [[ar-sky-view]]). POV faces along-track by default with the zenith as screen-up, after an earlier nadir-first default made sideways drags only roll the picture (README.md#L706-L711). The wheel changes the lens, 8° to 90° (README.md#L712-L714). From [[knacksat-2]] at 369.8 km the horizon is 70.94° off nadir, so the GSD readout reports the figure straight down, "at nadir, below frame" (README.md#L716-L721). Four non-obvious implementation points (per-frame orientation rebuild, hidden marker, sprite scale from the real camera distance, atmosphere shell dropped below 1.03 Earth radii) and the `verify-pov.js` suite close the section (README.md#L726-L751). Detail: [[globe-scene]].

## Reading the globe (L753–L786)

The globe reuses the flat map's colours for the same meanings (cyan spacecraft, pink site, pale footprint, orange "in view from the site"); the orbit ring became neutral blue-grey because in the Satellite camera it read as data (README.md#L755-L760). A key in the bottom-left corner names the orbital-elements symbols when that layer is on (README.md#L760-L765). HTML labels are now hidden when the Earth is between camera and point, and the same test gates hover and click on the catalogue (README.md#L767-L773). The photographic map is chosen from a texture ladder by the view's need rather than the GPU's maximum (README.md#L775-L786). Detail: [[globe-scene]].

## More room for the globe (L788–L806)

Full screen (ledger rows L78, L85), a fold-away answer panel on wide screens, a globe that opens "plain" with every extra layer one press away in Layers (ledger row L80), and a switch for the observer pin and its 5° access circle (ledger row L79) (README.md#L790-L806). Detail: [[globe-scene]].

## Colouring the catalogue (L808–L840)

Layers → Catalogue offers One colour (default, the old page's), By orbit, By type and By purpose (ledger row L76), with class counts for the 2,158 objects, colours chosen to stay apart under simulated colour-blindness, and a bit-exact return to the old rendering (README.md#L810-L840). Detail: [[catalogue-colouring]].

## The realistic globe (L842–L935)

An opt-in surface (ledger rows L71, L74, L75) that draws the Earth "the way the owner's Blender renders draw it": Blue Marble Next Generation ground, a cloud shell, single-scattered air, ocean glint, relief, city lights, AgX tone mapping, NASA GIBS tiles close up, a corrected limb, and a full sky with Milky Way, stars, Sun glare and a lit, librating Moon shared with the Moon pages (README.md#L844-L935). Detail: [[realistic-globe]].

## The close-up (L937–L984)

Close-up (ledger row L72) puts the camera a few metres from a 3D model flying in the local-vertical, local-horizontal frame, lit by the real Sun and the Earth's light; three models are listed (KNACKSAT-2, ISS, Tiangong), with a long account of how the KNACKSAT-2 model and its plate image are built reproducibly in Blender (README.md#L939-L984). Detail: [[close-up-camera]].

## How it flies (L986–L1020)

A per-model panel (ledger row L77) sets pointing (along track, toward the Sun, fixed among the stars), yaw/pitch/roll offsets and spin rates about the model's own axes, kept in `gt.attitude` (README.md#L988-L1020). Detail: [[spacecraft-attitude]].

## Your own model (L1022–L1034)

A reader may supply a self-contained .glb/.gltf (ledger row L73) for any spacecraft; it is validated, kept only in this browser's IndexedDB, and never uploaded (README.md#L1024-L1034). Detail: [[reader-uploaded-models]].

## Finding your way round the page (L1036–L1189)

The responsive layout (one-row header from 1100 px, one column below), the Report link and sticky section links, skip links, the Layers popover, the phone layout, the 11 px text floor, the Terms glossary, the footer credits and licence status, the two-press "Forget what this page stored" button, and the `npm run layout` check (README.md#L1038-L1189). Detail: [[page-navigation-and-accessibility]]; the Forget button is covered by [[forget-data]].

## Where this fits

- [[globe-scene]] — cameras, POV, colour key, label occlusion, texture ladder, Layers and full screen.
- [[catalogue-colouring]] — the four catalogue colourings and their class rules.
- [[realistic-globe]] — the opt-in realistic Earth and sky.
- [[close-up-camera]] — the close-up view and its spacecraft models.
- [[spacecraft-attitude]] — "How it flies": pointing, offsets and spin.
- [[reader-uploaded-models]] — models a reader adds.
- [[page-navigation-and-accessibility]] — layout, navigation, text sizes, Terms, credits, layout check.
- Related pages from other sections: [[knacksat-2]], [[celestrak]], [[ar-sky-view]], [[forget-data]], [[data-provenance]], [[earth-moon-page]], [[verbatim-ports]], [[lazy-chunks-and-entry-budget]], [[regression-gate]], [[change-ledger]], [[legacy-earth-console]], [[assignment-snapshot-tle-embedded]].
