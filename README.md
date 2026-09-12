# Ground Track Console — LANDSAT 9

A single-file web program that reads a CelesTrak Two-Line Element set, reports the Keplerian
elements, propagates and plots one day of ground track, and totals the time the spacecraft is
visible from Bangkok above a 5° elevation mask.

Open `index.html` in any browser. No build step, no server. It needs network access on first
load for two CDN assets: `satellite.js` (SGP4) from cdnjs and the webfonts from Google Fonts.

## Satellite

**LANDSAT 9** — NORAD 49260, COSPAR 2021-088A — from the CelesTrak **Earth Resources** group.
All 167 satellites in that group are embedded; the selector at the top right switches between
them and everything on the page recomputes.

```
LANDSAT 9
1 49260U 21088A   26255.20123478  .00000209  00000+0  56390-4 0  9994
2 49260  98.2207 324.2909 0001484 100.3913 259.7453 14.57109712263670
```

Epoch: **2026-09-12 04:49:46.684 UTC** (day 255.20123478 of 2026).

## (a) Orbital elements at epoch

| Element | Symbol | Value | Where it comes from |
|---|---|---|---|
| Semi-major axis | a | **7080.659 km** | derived from mean motion, line 2 cols 53–63 |
| Eccentricity | e | **0.0001484** | line 2 cols 27–33 (leading decimal implied) |
| Inclination | i | **98.2207°** | line 2 cols 9–16 |
| RAAN | Ω | **324.2909°** | line 2 cols 18–25 |
| Argument of perigee | ω | **100.3913°** | line 2 cols 35–42 |
| Mean anomaly at epoch | M | **259.7453°** | line 2 cols 44–51 |

Five of the six are stored literally in the TLE. The semi-major axis is not — it is computed
from the mean motion n = 14.57109712 rev/day:

```
n = 14.57109712 rev/day × 2π / 86400 = 1.059726e-3 rad/s
a = (μ / n²)^(1/3),  μ = 398600.4418 km³/s²   →   a = 7080.659 km
```

Derived: period 98.83 min, altitude 701.5–703.6 km, near-circular, sun-synchronous
(i > 90° is retrograde; ~98.2° at this altitude holds a fixed local solar time).

## (b) Ground track

24 hours from the epoch, SGP4-propagated, sampled every 10 s (8641 points), drawn on an
equirectangular projection with Natural Earth 110 m coastlines. TEME → ECEF by Greenwich mean
sidereal time → geodetic sub-satellite point on WGS-84. The track breaks at the antimeridian.
Segments where Bangkok has the spacecraft above 5° are overdrawn thicker and in a second colour.
A time scrubber moves the spacecraft along the track and re-renders the day/night terminator.

## (c) Visibility from Bangkok (13.75°N, 100.52°E, 5° mask)

**Total cumulative time in view: 2264.5 s = 37.74 minutes** — 2.62 % of the day, over **4 passes**.

| # | AOS (UTC) | LOS (UTC) | Duration | Max elevation | Az at max | Min range |
|---|---|---|---|---|---|---|
| 1 | 14:42:06 | 14:52:42 | 10m 36s | 31.50° | 076° ENE | 1205 km |
| 2 | 16:20:54 | 16:29:04 | 8m 10s | 13.85° | 261° W | 1911 km |
| 3 | 02:56:04 | 03:06:34 | 10m 30s | 29.39° | 100° E | 1261 km |
| 4 | 04:34:30 | 04:42:58 | 8m 28s | 15.17° | 286° WNW | 1833 km |

Passes 1–2 fall on 12 Sep 2026, passes 3–4 on 13 Sep 2026 (the window runs from the epoch, not
from midnight). Elevation is sampled every 10 s; each crossing of the 5° mask is then bracketed
and bisected to 1 ms, so the total is not quantised by the sample step. Geometry only — no
refraction, terrain or link budget.

## Verification

An independent second implementation (own WGS-84 ECEF→ENU elevation, own TLE column parsing,
own Kepler-third-law semi-major axis) was cross-checked against this one:

- All six elements plus period and apsis altitudes agree to better than 1e-12 relative.
- Topocentric elevation agrees with `satellite.js` look angles to 2.6e-10 degrees over 200
  samples across the day — pure floating-point noise, no systematic bias.
- A deliberately dumb brute-force check — 86 400 one-second samples, counting those above 5° —
  gives **2265 s in 4 runs** against this program's **2264.5 s in 4 passes**. The 0.5 s gap is
  exactly the quantisation of a 1 s counter against millisecond-precise AOS/LOS.

## Data provenance

CelesTrak's servers were unreachable from this machine at build time (both :80 and :443 time
out — likely their anti-abuse firewall). The element sets were taken from a GitHub Actions
mirror of the same `GROUP=resource&FORMAT=tle` endpoint, refreshed 2026-09-12T14:15Z, and the
LANDSAT 8/9 lines were cross-checked character-for-character against an unrelated second TLE
API. The data is current and authentic, but it did not come from celestrak.org directly. To
refresh it later, replace the contents of the `<script id="tledata">` block in `index.html`
with a fresh download of:

```
https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=tle
```

Element sets degrade a few km per day away from epoch, so re-download before quoting pass times
for a date far from 12 Sep 2026.
