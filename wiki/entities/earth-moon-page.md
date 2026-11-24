---
type: entity
kind: page
title: "Earth–Moon system page"
tags: [moon, orbital-mechanics]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Earth–Moon system page

The **Earth–Moon system page** (`public/moon.html`) is a geocentric three.js view of the Moon's orbit with the five Earth–Moon libration points marked and moving with it (README.md#L2681-L2682). It is linked from the Earth console's report sub-navigation and footer. Its physics live in `public/moon/lunar.js` and its scene in `public/moon/moonviz.js` (README.md#L2683-L2684). Like the [[lunar-track-console]], it is a plain file under `public/` that the Vite build copies to `dist/` unprocessed (README.md#L2684-L2686), and it opens from disk without a build (README.md#L3872-L3880).

## The Moon's position

The position is a truncated ELP-2000/82B lunar theory: 60-term longitude and radius tables and a 60-term latitude table, with nutation in longitude and true obliquity for the apparent place (README.md#L2690-L2691). The README argues that simpler models fail by degrees, since the evection term alone moves the Moon ±1.27° and the variation ±0.66° (README.md#L2692-L2693).

Checked against JPL Horizons over 731 daily samples in 2026–2028 (README.md#L2695-L2700):

| | median | p90 | worst |
|---|---|---|---|
| Angular separation | 1.9″ | 4.6″ | 9.5″ |
| Geocentric distance | 27.0 km | — | 44.9 km |

The worst case is stated as about 1/200 of the 1865″ lunar disc, and a call costs 8.5 µs, which matters because the scene requests a position every frame (README.md#L2702-L2703).

## Libration points

The page solves L1–L3 numerically and places L4/L5 geometrically; the method, distances, the GM-based mass ratio and the stability corrections are on [[libration-points]].

## Defects found while verifying the scene

Three are recorded (README.md#L2745-L2756):

- **Camera in the orbit plane.** Elevation was measured from the equator, but the orbit is inclined 18.3°–28.6° to it, so the default camera could sit within a degree of the orbit plane and make L4/L5 look collinear with L1–L3. The default was raised to 58°, clearing the plane by 37°–83° at every azimuth.
- **A label widened the document.** Labels anchored up to 6 % outside the frustum pushed `scrollWidth` to 443 px at a 390 px viewport; labels are now clamped and the viewport clips.
- **Barycentre and Earth labels collided**, reading "Earthcentre", because the two are 4,671 km apart at true scale; the barycentre label now has its own line.

## Facts corrected and claims computed

The page's text was written from sources, and three claims were corrected (README.md#L2758-L2786): Queqiao-2 flies a frozen elliptical, retrograde lunar orbit rather than an EML2 orbit; the "23 days" libration-point instability figure belongs to the Sun–Earth system; and L4/L5 are stable only in the idealised problem. Details are on [[libration-points]] and [[lunar-track-console]].

Two claims the page makes are computed rather than repeated (README.md#L2788-L2798):

- The Moon's orbit does not look like a squashed ellipse: at e = 0.0549 the semi-minor axis is 0.99849 of the semi-major, 580 km short on 384,400 km. What is visible is that the Earth sits 21,104 km (3.3 Earth radii) from the ellipse's centre.
- The Moon's path around the Sun is always concave toward the Sun: the minimum of path acceleration · Sun direction over a year is +0.889, attributed to the Sun pulling on the Moon 2.20× harder than the Earth does.

## Verified behaviour and scale

The README reports zero page errors in light and dark themes after exercising every control, no horizontal scroll at 390, 414, 768 and 1400 px, working time controls, and all nine labels placed (README.md#L2802-L2804). The scale toggle defaults to true scale and always says which mode is showing, because enlarged bodies misrepresent a geometry in which the Moon is 60 Earth radii away (README.md#L2804-L2806).

The page still loads three.js r128 from cdnjs pinned by a subresource-integrity hash, so a missing CDN file would break it; this is one reason the README suggests a scheduled check run (README.md#L4094-L4099). Its lunar checks are kept out of `test:all` (README.md#L4082-L4090); see [[verification-harness]].

## Related

- [[lunar-track-console]] — the other Moon page.
- [[libration-points]]
- [[central-body-seam]] — the split that lets the console be pointed at another body.
- [[readme-moon-data-and-radio]]
