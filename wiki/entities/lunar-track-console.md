---
type: entity
kind: page
title: "Lunar track console"
tags: [moon, orbital-mechanics, data]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Lunar track console

The **lunar track console** (`public/moon-track.html`) is the ground-track console pointed at the Moon: same layout, transport and palette, with a different central body (README.md#L2810-L2812). "Same" refers to the *old* Earth page ([[legacy-earth-console]]); the Earth console has since been rebuilt and this page has not (README.md#L2812-L2813). It is a plain script page under `public/` that opens from disk (README.md#L3872-L3880). Its stated job is to say how well each of its five objects is actually known (README.md#L2815).

## Grades of knowledge

| Grade | Objects | Meaning (README.md#L2817-L2821) |
|---|---|---|
| tracked | LRO, Chandrayaan-2, Danuri | 740 daily osculating element sets baked from JPL Horizons, fit to agency tracking up to a stated date and predicted after it |
| published | Queqiao-2 | rebuilt from published mission parameters; size, shape and inclination right, phase unknowable |
| schematic | Queqiao-1 | a halo orbit is not a conic; listed, not propagated |

The grading exists because JPL Horizons carries no Chinese lunar spacecraft and CNSA publishes no machine-readable ephemeris (README.md#L2823-L2826). Omitting them would wrongly imply only three spacecraft are at the Moon; showing them as tracked would be worse, so they appear with the grade on every row (README.md#L2828-L2830). Queqiao-2 flies a frozen elliptical orbit of about 200 × 16,000 km, 24-hour period, retrograde at ~118° to the lunar equator; only Queqiao-1 holds a halo about EML2 (README.md#L2762-L2769).

## No lunar TLEs

SGP4 exists only for Earth satellites. CelesTrak's catalogue record for LRO has blank period and orbit fields, `DATA_STATUS_CODE = NEA` (no elements available) and `ORBIT_CENTER = MO`, and a request for its elements returns "No GP data found" (README.md#L2834-L2844). See [[sgp4-propagation]] and [[tle-two-line-element-set]] for the Earth case.

## Daily anchors

The lunar gravity field is dominated by mascons, so Keplerian elements drift: LRO's argument of periapsis moves about 3.1°/day and its period grows about 1.7 s every four hours, putting a single element set on the wrong side of the Moon within weeks (README.md#L2848-L2852). Adding J2 does not help; a fresh daily anchor does (README.md#L2854-L2855). Against Horizons, 289 samples over 14–20 September 2026 (`npm run moon:chain`) show error growing from about 1.3–1.6 km in the first two hours to 20.2–35.1 km at 10–12 hours, depending on craft, against 32–57 km for one set held for days (README.md#L2855-L2870). Each craft carries its own error fit, which the chain check holds within 20 % (or 1 km) of measurement (README.md#L2870-L2873). The panel shows the anchor epoch, hours since it, and the implied error rather than an exact-looking position (README.md#L2874-L2875).

**A 113 km bug.** Horizons gives osculating elements in TDB only, and the bake treated those dates as UTC, so every anchor sat 69.184 s late (37 leap seconds plus 32.184 s), during which LRO covers 3.5° of orbit (README.md#L2877-L2881). The checks missed it because they compared TT with TDB (README.md#L2881-L2883). The bake now converts, using TAI − UTC = 37 s through June 2027 per IERS Bulletin C 72 and warning past that, and writes `public/moon/moondata.js` directly; the chain check fails above 3 km near an anchor (README.md#L2883-L2886).

## Fit, then prediction

All agreement is with Horizons, whose trajectories are fits to tracking up to a date and predictions after it (README.md#L2890-L2892). As baked on 25 September 2026: LRO 487 of 487 anchors past its join, Chandrayaan-2 26 of 40, Danuri 191 of 213 (README.md#L2895-L2899). Measured afterwards, predictions had drifted 104 km for Chandrayaan-2 and 21 km for Danuri (README.md#L2901-L2904), so such anchors are graded *tracked · predicted* and the ± is labelled "error vs Horizons" (README.md#L2905-L2906).

## Rotation and libration

The Moon's orientation is a polynomial plus a 13-term libration series on the pole and prime meridian; omitting it moves the sub-spacecraft point 44 km, while with it agreement with Horizons is 0.17 km (max 0.45 km) over 289 epochs (README.md#L2910-L2913). Traps found by measurement: NAIF `NUT_PREC` rates are per Julian century (misread, the pole is 1.9° out); Horizons `VECTORS` defaults to the ecliptic, requiring `REF_PLANE='FRAME'`; `VECTORS`/`ELEMENTS` epochs are TDB while `OBSERVER` epochs are UT; and date parameters must be unquoted while `STEP_SIZE` must be quoted, a wrong quote being silently ignored (README.md#L2915-L2933).

## Globe and interaction

A 3D globe (`public/moon/moon3d.js`) is **body-fixed**, unlike the Earth globe's inertial frame, so the near/far-side boundary stays fixed on screen (README.md#L2937-L2945; compare [[globe-scene]]). The surface is the LRO Wide Angle Camera mosaic from NASA Moon Trek WMTS tiles, chosen because it sends `Access-Control-Allow-Origin: *`; tiles are painted to a second canvas so a tainted image cannot break the scene (README.md#L2947-L2960). three.js comes from cdnjs with a sha512 integrity hash; a refusal falls back to the flat map (README.md#L2952-L2954). All objects are drawn and clickable, a layers panel is built from the scene's layer list, and *Follow* tracks the selected sub-point (README.md#L2966-L2971). Clicks follow the hover label, not a fresh raycast, because LRO and Chandrayaan-2 overlap; hit spheres are about 26 px against a 9 px marker; labels are de-cluttered by priority; and the drag guard measures displacement from pointerdown (README.md#L2975-L2995).

## Readouts and frames

Readouts include sub-point, altitude and rate, speeds, live osculating elements, energy, angular momentum, Earth range and light time, solar elevation and shadow state (README.md#L2999-L3003). Elements are given in the lunar equator of date; baked sets are ICRF, and the two poles are 22–25° apart, so a polar lunar orbit looks retrograde in ICRF (LRO 104.4° vs 83.9°) (README.md#L3005-L3010). Queqiao-2's published elements were once fed to the ICRF propagator and drawn at 40° to the lunar equator; they are now stored lunar-equatorial and rotated out (README.md#L3010-L3013). Each landing site shows whether the Earth is ever above its horizon; from far-side sites (Chang'e-4, Chang'e-6) it never is (README.md#L3015-L3018).

Site coordinates and the rotation model share the mean Earth/polar axis (ME) frame, valid to about 150 m; the principal-axis frame differs by about 875 m and is not used (README.md#L3022-L3029). (Open question: the next sentence says an earlier version of the section "called the 860 m an accepted error". The 860 m is probably the earlier version's figure, but the README does not reconcile it with 875 m.) Lunar ground tracks are nearly great circles, since the surface turns at about 4.6 m/s under a ~1.56 km/s ground speed; LRO's equator crossings shift west 1.07° per revolution (README.md#L3031-L3035).

## Checks

`npm run moon`, `moon:chain` and `moon:bake` are kept out of `test:all` because they fetch from JPL Horizons; responses are cached in a temporary directory, and `moon:chain` reads tables `npm run moon` fetches (README.md#L4082-L4104). See [[verification-harness]].

## Related

- [[earth-moon-page]] — the companion Moon page.
- [[central-body-seam]] — why the console can take another central body.
- [[readme-moon-data-and-radio]]
