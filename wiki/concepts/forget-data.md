---
type: concept
title: "Forget what this page stored"
tags: [data, earth-console]
sources: [readme-moon-data-and-radio, sattrackslop-readme]
created: 2026-11-24
updated: 2026-11-24
---

# Forget what this page stored

**Forget what this page stored** is the Earth console's button for removing everything the page keeps in the reader's browser. It sits under the footer's credits (README.md#L1137). The README describes it in the *Data and privacy* section and the footer section (README.md#L86, L1137-L1174), outside the range summarised by [[readme-moon-data-and-radio]], which only touches stored items such as the observer site, the uplink box and the element-set cache. Those line references are cited directly here.

## What the page stores

Everything the page keeps is in `localStorage` — nothing in session storage, cookies or a service worker — except the 3D models a reader gives the close-up camera, which are files kept in IndexedDB in the database `gt-models` (README.md#L1137-L1142). The `localStorage` keys fall under four namespaces (README.md#L1142-L1152):

- the old page's `obs-site` and `obs-recent` (the saved site and last six places; see [[observer-value]]);
- `gt.*`, the page's own preferences and records: theme and tab (`gt.prefs`), globe surface (`gt.surface`), own orbits (`gt.custom`, `gt.custom.bak`), AR lens, aim and radar settings, the pass-list filter, the watchlist (`gt.watch`), the decay comparison set, catalogue colouring, close-up model attitude, and the model list (`gt.models`);
- the element-set cache `tle:<n>` (see [[live-element-refresh]]);
- the decay-history cache `hist:<n>` (see [[orbital-decay-forecast]]).

Cached copies are used for three or twelve hours and kept until fetched again or forgotten, so the caches double as a list of the objects looked at (README.md#L1149-L1152). The *Data and privacy* summary states that nothing the page keeps leaves the browser, and that a reader's model is never uploaded (README.md#L86).

Some state is deliberately not stored: the uplink frequency typed into the tuning line is held in memory for one spacecraft and forgotten on reload (README.md#L3646-L3647).

## How the button works

- **First press reads, writes nothing, and counts.** It states what the second press will remove, e.g. a saved site, recent places, display choices, own orbits and cached element sets, and warns that own orbits cannot be brought back (README.md#L1153-L1156).
- **The button re-labels** to *Forget and reload*; Escape, losing focus, or a press elsewhere stands it down. Escape is listened for wherever focus is, since Safari and Firefox on macOS do not focus a clicked button (README.md#L1156-L1158).
- **The second press must be its own press.** One within 0.6 s of the first, or a held Enter's repeats, is ignored, so the first press's text is always shown before anything is removed (README.md#L1158-L1161).
- **The second press removes every key in the four namespaces and no other key on the origin**, deletes the model database, and reopens the page without the `site` and `tab` query parameters so nothing held in memory survives (README.md#L1161-L1165).
- With nothing stored it says so and arms nothing; where the browser refuses site data it says there is nothing to forget (README.md#L1165-L1167).

## Limits

The README names two (README.md#L1167-L1170): a live visit stores the element set fetched for the spacecraft on screen again as soon as the reloaded page fetches it (not under `?tle=embedded`, which fetches nothing; see [[assignment-snapshot-tle-embedded]]); and another open tab keeps what it holds in memory and stores it again when something changes there.

## Checks

`tests/lib/forget.test.ts` scans the source for every key passed to `getItem`, `setItem` and `removeItem`, and fails on a key `src/lib/forget.ts` does not cover or on a listed key the code no longer uses (README.md#L1171-L1173). `verify-visitor.js` (group 10) shows that a double-click and a held Enter only arm the button, and forgets a store holding one key of every kind plus one belonging to someone else (README.md#L1173-L1174). The `models` and `catcolour` suites also exercise Forget (README.md#L4003-L4006).

## Related

- [[reader-uploaded-models]] — the IndexedDB-stored models.
- [[data-provenance]]
- [[verification-harness]]
