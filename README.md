# Ground Track Console — KNACKSAT-2

**Live:** https://sattrackslop.vercel.app

A single-file web program that reads a Two-Line Element set, reports the Keplerian elements,
propagates and plots one day of ground track, and totals the time the spacecraft is visible from
Bangkok above a 5° elevation mask.

Open `index.html` in any browser. No build step, no server. It needs network access on first
load for two CDN assets: `satellite.js` (SGP4) from cdnjs and the webfonts from Google Fonts.

## Satellite

**KNACKSAT-2** — NORAD 67683, international designator 1998-067XZ — a Thai CubeSat. That
designator is the giveaway: `1998-067` is the ISS, so KNACKSAT-2 was deployed from the station
and shares its 51.63° orbit at roughly 360 km, not a sun-synchronous one.

```
KNACKSAT-2
1 67683U 98067XZ  26255.31192122  .00056149  00000-0  48789-3 0  9995
2 67683  51.6258 213.5681 0007959 152.6345 207.5073 15.68476422 33916
```

Epoch: **2026-09-12 07:29:09.993 UTC** (day 255.31192122 of 2026).

The picker at the top right searches **2,158 spacecraft** by name or NORAD ID — type `knack`,
`landsat`, `iss`, or `43722`. Everything on the page recomputes on selection.

## (a) Orbital elements at epoch

| Element | Symbol | Value | Where it comes from |
|---|---|---|---|
| Semi-major axis | a | **6741.396 km** | derived from mean motion, line 2 cols 53–63 |
| Eccentricity | e | **0.0007959** | line 2 cols 27–33 (leading decimal implied) |
| Inclination | i | **51.6258°** | line 2 cols 9–16 |
| RAAN | Ω | **213.5681°** | line 2 cols 18–25 |
| Argument of perigee | ω | **152.6345°** | line 2 cols 35–42 |
| Mean anomaly at epoch | M | **207.5073°** | line 2 cols 44–51 |

Five of the six are stored literally in the TLE. The semi-major axis is not — it is computed
from the mean motion n = 15.68476422 rev/day:

```
n = 15.68476422 rev/day × 2π / 86400 = 1.140651e-3 rad/s
a = (μ / n²)^(1/3),  μ = 398600.4418 km³/s²   →   a = 6741.396 km
```

Derived: period 91.81 min, altitude 357.9–368.6 km, near-circular. Note the drag term
`ndot = .00056149` — three orders of magnitude larger than a Landsat's. At 360 km the atmosphere
is still biting, and this element set goes stale fast.

## (b) Ground track

24 hours from the epoch, SGP4-propagated, sampled every 10 s (8641 points), drawn on an
equirectangular projection with Natural Earth 110 m coastlines. TEME → ECEF by Greenwich mean
sidereal time → geodetic sub-satellite point on WGS-84. The track breaks at the antimeridian.
Segments where Bangkok has the spacecraft above 5° are overdrawn thicker and in a second colour.
A time scrubber moves the spacecraft along the track and re-renders the day/night terminator.

At 51.63° inclination the track is a band between ±51.6° latitude — Bangkok at 13.75°N sits well
inside it, unlike the near-polar Landsat track that crosses the tropics almost vertically.

## (c) Visibility from Bangkok (13.75°N, 100.52°E, 5° mask)

**Total cumulative time in view: 899.7 s = 14.99 minutes** — 1.04 % of the day, over **2 passes**.

| # | Date | AOS (UTC) | LOS (UTC) | Duration | Max elevation | Min range |
|---|---|---|---|---|---|---|
| 1 | 2026-09-12 | 09:02:12 | 09:09:47 | 7m 36s | 45.1° | 505 km |
| 2 | 2026-09-12 | 18:48:18 | 18:55:42 | 7m 24s | 40.0° | 538 km |

Fewer passes than a polar satellite but much better ones: both climb above 40°, where Landsat 9
manages 31.5° at best. The low orbit is the reason for both — a 14.5° access footprint means the
spacecraft must pass close overhead to be seen at all, but when it does, it is only ~500 km away.

Elevation is sampled every 10 s; each crossing of the 5° mask is then bracketed and bisected to
1 ms, so the total is not quantised by the sample step. Geometry only — no refraction, terrain or
link budget, and no daylight/eclipse condition (this is radio visibility, not naked-eye).

## For comparison — LANDSAT 9 (the Earth Resources answer)

Selectable in the picker. NORAD 49260, epoch 2026-09-12 04:49:46.684 UTC, sun-synchronous at
98.2207°:

- a = 7080.659 km, e = 0.0001484, i = 98.2207°, Ω = 324.2909°, ω = 100.3913°, M = 259.7453°
- **37.74 minutes over 4 passes**, best elevation 31.50° at 14:47 UTC

## Verification

An independent second implementation (own WGS-84 ECEF→ENU elevation, own TLE column parsing,
own Kepler-third-law semi-major axis) was cross-checked against this one:

- All six elements plus period and apsis altitudes agree to better than 1e-12 relative.
- Topocentric elevation agrees with `satellite.js` look angles to 2.6e-10 degrees over 200
  samples across the day — pure floating-point noise, no systematic bias.
- A deliberately dumb brute-force check — 86 400 one-second samples, counting those above 5°:
  - KNACKSAT-2: **899 s in 2 runs** vs this program's **899.7 s in 2 passes**
  - LANDSAT 9: **2265 s in 4 runs** vs this program's **2264.5 s in 4 passes**

  Both gaps are the expected quantisation of a 1 s counter against millisecond-precise AOS/LOS.

Run it yourself: `node verification/report.js` and `node verification/verify.js`.

## Data provenance

The embedded catalogue is **2,158 satellites, 319 KB**, built from:

1. **SatNOGS DB** — `https://db.satnogs.org/api/tle/?format=json`, which serves anonymously
   (no API key). 1,437 satellites kept. KNACKSAT-2 comes from here; SatNOGS records its own
   `tle_source` for that object as **Space-Track.org**.
2. **CelesTrak** groups (geo, resource, weather, science, military, stations) — 721 satellites,
   via a GitHub Actions mirror, because celestrak.org is unreachable from the build machine
   (both :80 and :443 time out, likely their anti-abuse firewall). Starlink and OneWeb were
   deliberately excluded: thousands of near-identical objects would swamp the picker.

Every block was validated before embedding: 69-character lines, matching NORAD IDs across lines 1
and 2, correct mod-10 checksums, and no epoch older than 60 days. 202 duplicates were resolved by
keeping the most recent epoch; 211 stale objects were dropped. Epochs span 2026-07-14 → 2026-09-14.

**Space-Track.org direct access needs an account** (username and password, no anonymous API), so
it is not queried at build time. SatNOGS is the practical substitute and republishes Space-Track
data for exactly this reason.

To refresh, rebuild `catalog.txt` and re-inject it into the `<script id="tledata">` block.
Element sets degrade with time, and a 360 km orbit with this drag term degrades quickly — re-fetch
before quoting pass times for any date far from 12 Sep 2026.
