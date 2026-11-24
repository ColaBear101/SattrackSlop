---
type: concept
title: "The observer as a value"
tags: [earth-console, data, architecture]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# The observer as a value

**The observer as a value** names the change by which the Earth console's observing site, once a Bangkok constant, became an editable, persisted value with a UTC offset (README.md#L3196-L3198). The seam already existed — `lookAngles(site, rFixed)` took the site as an argument and the propagation adapters passed it — only the value was frozen (README.md#L3196-L3198). Every pass figure, look angle and local time depends on it; see [[pass-prediction]].

## Why it is safe

Two design points (README.md#L3200-L3213):

- **`OBS` is never held, only read.** The old page handed the 3D scene the observer object once and mutated it in place; replacing it would have left the globe pinned to the old site while every number moved. In the rebuild, moving the observer builds a new site object and a new engine around it (`setObserver`, `src/state/engine.ts`), and the globe receives a getter so it asks for the current site each time; the pin is rebuilt and the site camera re-aimed (README.md#L3202-L3209). A check reads the pin's geometry back out of the scene and compares it with the new coordinates (README.md#L3209-L3210). See [[globe-scene]].
- **Bangkok stays the default.** `verification/gate/baseline.json` records `obs = Bangkok`, and the snapshot runs in a fresh browser context with empty `localStorage` so a stored site cannot leak in; Reset restores the assignment's own total to the bit (README.md#L3211-L3213). See [[regression-gate]].

## Four ways in

(README.md#L3215-L3263)

- **Place-name search** — one request to Open-Meteo's geocoder (no key, CORS open), returning position, ground elevation and an IANA timezone; results show coordinates because names repeat (README.md#L3217-L3220).
- **Maidenhead grid square** — typed into the same box and decoded locally by `src/lib/maidenhead.ts`, written from the IARU definition; 4, 6 or 8 characters are accepted and the square's centre becomes the site, at sea level, with a solar-time offset (README.md#L3221-L3230). The note gives the worst-case distance from the centre: 5.1 km for a six-character square at Bangkok's latitude, 122 km for a four-character one (README.md#L3226-L3228). Partial or ten-character locators are sent nowhere; a four-character square that looks like a British postcode district offers an explicit place search instead (README.md#L3230-L3235). The current site's own six-character square is shown under the coordinates (Bangkok is OK03gs) (README.md#L3235-L3239). Text shaped like a locator waits for the decoding chunk rather than going to the geocoder, and is held back if that chunk cannot be fetched (README.md#L3246-L3251).
- **Use my location** — the browser's coordinates and accuracy, with the device's zone (README.md#L3257-L3258).
- **Coordinates** — folded behind a disclosure; the only path that works with no network (README.md#L3259-L3261).

The last few sites return as chips (README.md#L3263).

## Time zone per instant

The timezone follows the site and is not one number: a site with a zone is asked its offset at the instant displayed, so a 7-day window can straddle a summer-time change correctly; each pass time uses the offset in force at that pass, and its label now says so (README.md#L3265-L3269). For bare coordinates the offset field follows the typed longitude (nearest hour of solar time) until edited; it used to keep the previous site's offset, leaving London in UTC+7 (README.md#L3269-L3274). The note says whether the offset is a zone, a solar-time estimate, or as entered, and warns that solar time misleads in places such as Kashgar, India and Nepal (README.md#L3274-L3276). The window-start field also uses the observer's time, where it once used the browser's (README.md#L3278-L3281).

## Regime note and checks

A note under the form says whether the page is at the assignment's site, where the README's figures reproduce under the [[assignment-snapshot-tle-embedded]], or moved, where they no longer describe the screen (README.md#L3283-L3285). Moving to Svalbard (78.23°N) yields 0 passes, the correct answer because [[knacksat-2]]'s 51.6° orbit never reaches that latitude (README.md#L3289-L3290). `npm run site` checks moving the observer and that Bangkok remains the default (README.md#L3969). The saved site and recent places are stored as `obs-site` and `obs-recent`; see [[forget-data]].

## Related

- [[sunlit-visibility]] — depends on the Sun's elevation at the site.
- [[doppler-and-transmitters]] — range rate is measured from the site.
- [[readme-moon-data-and-radio]]
