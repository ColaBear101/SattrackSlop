---
type: concept
title: "Page navigation and accessibility"
tags: [earth-console, architecture, verification]
sources: [readme-globe-and-views]
created: 2026-11-24
updated: 2026-11-24
---

# Page navigation and accessibility

This page covers how the Earth console's page is laid out across screen sizes, how a reader finds the written analysis below the console, and the legibility and keyboard rules the page keeps: responsive breakpoints, the Report link and sticky section links, skip links, the Layers popover, the phone layout, minimum text sizes, the Terms glossary, the footer credits, and the `npm run layout` check. The README frames almost every point as a fix to the [[legacy-earth-console]]; the matching ledger rows of the [[change-ledger]] are L1 to L3, L5, L17, L21, L26 and L35 (README.md#L1187-L1189).

## The problem: the console hid the report

The console fills the first screen (README.md#L1038). On the old page at 1440×900 nothing on that screen said that the analysis the assignment asks for — elements, ground-track map, pass table — was underneath; the one pointer was a link at the foot of the self-scrolling rail, about 1000 px out of view (README.md#L1040-L1044). The old header later gained a line of section links, which cost the globe 8 px at that size and about 50 px between 901 and about 1030 px wide, where the links wrapped (README.md#L1044-L1048).

## Desktop layout (1100 px and wider)

From 1100 px wide the header is one row, 76 px high; the console takes the rest of the screen, with the stage on the left, the answer rail in a 360 px column beside it, and the transport docked under both (README.md#L1038-L1040).

**Finding the report.** The stage's row of tabs carries a **Report ↓** link at its right, and the report opens with a sticky line of section links — Elements, Ground track, Passes, Decay, Method, Terms — with both Moon pages at its right end and again in the footer (README.md#L1050-L1053; see [[earth-moon-page]], [[lunar-track-console]]). Two skip links come before everything else, "Skip to the page" and "Skip to the written analysis", and a link into the report lands 56 px below the top of the screen to clear the sticky line (README.md#L1053-L1055).

## The Layers popover

The old page's layers panel was always open, 327 px tall from 92 px down, so it wanted a 431 px globe; between 901 and about 1030 px wide or in a short window its last switches ran under the transport and were clipped out of reach (README.md#L1057-L1061). Now Layers is a button on the globe, under the camera and trail rows, closed to begin with; the panel is 260 px wide, scrolls within 60 % of the window height (420 px at most), opens upward where it would not fit below and there is more room above, and hangs from its other edge where it would run off the screen (README.md#L1062-L1065). At every size, the desktop included, the button reports its state in `aria-expanded`, and the panel closes on Escape (returning focus to the button) and on a press outside it (README.md#L1079-L1081). The layers themselves are described in [[globe-scene]].

## Narrow screens (under 1100 px)

Below 1100 px the console is one column in reading order — stage, transport, answer (README.md#L1067-L1068). The answer rail is a panel under the stage that folds behind its headline from 720 px; under 720 px it is a sheet along the foot of the screen whose peek is the headline and countdown, for which the page leaves 72 px at its end (README.md#L1068-L1070).

On a 390×844 phone the old page had three problems, each addressed (README.md#L1070-L1109):

- **Layers panel** hung open over half the globe with nothing to close it; fixed as above (README.md#L1073-L1081).
- **Transport bar** was sticky at the foot, wrapped to four rows (193 px) and covered the camera and trail buttons — a tap on Free landed on the transport (README.md#L1082-L1084). In the rebuilt page the header and transport are ordinary bars at every size, header above the console and transport under the globe; the only sticky bars are the report's line of links, the planner's Add bar above 900 px, and from 1100 px the sky plot beside the pass table within its section (README.md#L1091-L1095). The window's controls are a Window button in the transport opening a popover (README.md#L1095-L1096). Under 820 px the transport is three rows (play/rate/Window; scrubber; the two clocks, which wrap onto two lines on a 360 px phone rather than widen the page) (README.md#L1096-L1098).
- **Captions** over the button rows were hidden below 900 px, leaving three unlabelled rows of "6 h"/"24 h" (README.md#L1099-L1101). Now the window's start, steps and length are in the Window popover under "Window opens" and "Span"; camera and trail captions are drawn from 720 px up (with exceptions when the planner's drawer is open between 901 and 1100 px) and left out on screens 520 px tall or less and on phones, where the controls are a strip along the globe's foot (README.md#L1102-L1108). Without a caption the buttons name themselves: Free, Satellite, Bangkok, Close-up, POV; Off, 30 m, 1 orbit, 6 h, 24 h (README.md#L1108-L1109).

## Text size

No text on the page is smaller than 11 px: HTML text comes from a type scale whose floor is 12 px, and labels drawn into the sky plot, map, decay chart and AR readout go down to 11 (README.md#L1111-L1113). The old page went down to 9 px; twenty labels were 9.5 px, and each pass's local time in the rail — "the figure a reader most wants" — was 10 px (README.md#L1113-L1115). The degree sign on the element cards now sits on its number (README.md#L1115-L1116).

## Terms glossary and tooltips

A **Terms** section at the foot of the page spells out the vocabulary: AOS and LOS, Z, NORAD and COSPAR IDs, TEME, B* in 1/ER, standard magnitude, penumbra, POV, FOV and GSD, AR, heading and declination, the entry interface, and the brief's Earth Resources group (README.md#L1118-L1120). It has a search box; a non-matching entry is hidden, not removed, so links to it still land (README.md#L1120-L1122). Abbreviations in the header, over the globe, in the rail, sky plot and pass table carry their expansion as a tooltip, and notes that rely on a term — the re-entry warning, [[the-professor]]'s notes — link to its entry (README.md#L1122-L1124).

## Footer credits and licence

The footer's last line reads *Ground Track Console 1.0.0 · github.com/ColaBear101/SattrackSlop · Data: SatNOGS DB (element sets, transmitters, alternative names), CC BY-SA 4.0*, with links to the repository, SatNOGS DB and the data licence (README.md#L1126-L1128). It names no licence for the code: the author has not licensed it for reuse, so there is no `LICENSE` file and `package.json` says `"license": "UNLICENSED"` (README.md#L1128-L1130). The version is written in at build time from `package.json` (`__APP_VERSION__`, defined in `vite.config.ts`) and never edited by hand; the links are only links, and the page requests nothing from those hosts (README.md#L1131-L1133). Why the data carries its own licence is explained elsewhere in the README (README.md#L1133-L1134; see [[doppler-and-transmitters]], [[satellite-aliases]]).

## Forget what this page stored

Under the credits sits the two-press **Forget what this page stored** button, which clears every key the page keeps in `localStorage` plus the reader-model database in IndexedDB, then reloads (README.md#L1137-L1175). It is covered in full by [[forget-data]]; the keys it clears include `gt.catcolour` ([[catalogue-colouring]]), `gt.attitude` ([[spacecraft-attitude]]) and `gt.models` ([[reader-uploaded-models]]). Its keyboard behaviour is part of this page's accessibility story: Escape stands it down wherever the focus is, because Safari and Firefox on macOS do not focus a clicked button, and a second press within 0.6 s or a held Enter's repeats are ignored (README.md#L1156-L1161).

## How the layout is checked

`npm run layout` checks the production build in light and dark at 1440×900, 1280×720, at 1100 and 1099 px wide, at 1024×650, on a tablet, on a phone upright and sideways, on the two largest phones sideways (915×412, 932×430) and the two smallest (360×640, 320×568) (README.md#L1177-L1180). It covers the states that change what is on screen: the Layers panel, the picker, the observer's form, the window popover, the Map tab, the answer rail's three tabs, the pass filter, the planner, and the decay comparison with and without its search (on a second page whose storage alone is seeded) (README.md#L1180-L1183). Coverage is tested with `elementFromPoint` at each button's or switch's centre — with scrolling panels scrolled to the control and the page at several scroll positions — rather than by reading z-indices (README.md#L1183-L1187). See [[verification-harness]].

## Related

- [[globe-scene]] — the stage these controls sit on.
- [[orbit-planner]], [[decay-comparison]] — panels whose open states the layout check covers.
