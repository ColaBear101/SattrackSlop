---
type: concept
title: "Magnetic declination (WMM2025)"
tags: [ar]
sources: [readme-ar-and-architecture]
created: 2026-11-24
updated: 2026-11-24
---

# Magnetic declination (WMM2025)

**Magnetic declination** is the correction the [[ar-sky-view]] applies to turn the magnetic heading every phone platform reports into a true azimuth. The README defines it as true azimuth = magnetic azimuth + D, with D positive east of true north (README.md#L1304). Every platform gives magnetic north and none corrects it, so without this step the drawn sky would be rotated away from the real one by D (README.md#L1266).

## Source of D

D comes from the **World Magnetic Model 2025** evaluated at the observer for today, using the wall clock rather than the console's clock, because it corrects the compass in the reader's hand now (README.md#L1304-L1306). The implementation is `src/lib/ar/wmm.ts` (README.md#L1306).

## Validation against NOAA

`wmm.ts` reproduces all 100 rows of NOAA's test file to within 0.005° in declination and inclination (the file itself prints them to 0.01°), and the twelve rows of NOAA's separate table to the 0.01° given there (README.md#L1306-L1308). This comparison is part of the maths phase of the AR suite (README.md#L1676-L1678).

## Example values

At the end of September 2026 (decimal year 2026.74), at sea level, the README gives (README.md#L1309-L1317):

| Site | D |
|---|---|
| Bangkok | 0.66° W |
| London | 1.20° E |
| New York | 12.46° W |
| Seattle | 14.88° E |
| Cape Town | 26.80° W |

In Bangkok, the default observer, the correction is smaller than the spacecraft's marker — which the README notes is exactly why omitting it would be easy to miss when testing from there (README.md#L1319-L1320).

## The Cape Town check

The AR suite moves the observer to Cape Town, aims the phone, and finds that without the correction the view faces 26.8° away from the spacecraft (README.md#L1320-L1321). Because an azimuth offset on screen shrinks by the cosine of the elevation, the suite sets its own clock and advances along the pass until the spacecraft is about 35° up (or to culmination if the pass never gets that high), so the measured displacement does not depend on the day the suite runs (README.md#L1321-L1325). In the last run the marker was then 335 px off centre — off a 34.6°-wide portrait frame altogether (README.md#L1325-L1326). Before the suite fixed its clock, the result depended on the day: one run hit a 77° culmination and measured only 85 px (README.md#L1326-L1328).

A fault-injection run that flipped the declination's sign failed 10 checks (README.md#L1685-L1686).

## Limits

- **Expiry.** The model expires at 2030.0; after that the view still uses it and says so (README.md#L1328).
- **Magnetic poles.** Where the horizontal field is under 2000 nT — NOAA's "blackout zone" — a compass is no guide, and the view says so instead of applying a figure (README.md#L1329-L1330). In the radar view the corresponding sentence tells the reader to use Align and turn the crosshair onto something of known bearing (README.md#L1497-L1498; see [[ar-radar]]).
- **Compass error dominates.** Typical compass error after calibration is 5°–10° outdoors and 20° is common, larger than D in many places; the hand turn in the view handles that separately (README.md#L1341-L1345).

## Where it sits in the pipeline

The declination is applied to the pose before drawing; the radar's crosshair uses the same pose "after the declination, the hand turn and the smoothing", so picture and radar cannot disagree (README.md#L1375-L1376). The readout shows the declination applied (README.md#L1213), though held sideways, or upright on screens up to 700 px tall in the radar view, the Declination row is dropped for room (README.md#L1216-L1217, README.md#L1491-L1492).

## Related

- [[ar-sky-view]] — the view that uses it, and its north-finding.
- [[ar-radar]] — the radar shares the corrected pose.
- [[observer-value]] — D is evaluated at the observer, not the phone.
