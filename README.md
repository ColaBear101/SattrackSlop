# Ground Track Console

Read a Two-Line Element set, report the Keplerian elements, propagate and plot a day of ground
track, and total the time a spacecraft is visible from Bangkok above a 5° elevation mask.

That was the assignment. The program outgrew it: the same engine now runs a Moon-centred console
and an Earth–Moon libration-point view, because the central body turned out to be the only thing
that was ever really Earth-specific.

| | |
|---|---|
| **Ground track console** | https://sattrackslop.vercel.app |
| **Lunar track console** *(testing)* | https://sattrackslop.vercel.app/moon-track.html |
| **Earth–Moon system** *(testing)* | https://sattrackslop.vercel.app/moon.html |

No build step and no server. Open `index.html` in a browser. It needs network access on first
load for two CDN assets — `satellite.js` (SGP4) from cdnjs and the webfonts from Google Fonts —
and nothing else; the satellite catalogue, the coastlines and the lunar ephemerides are all
embedded.

## What's here

Three pages over one shared core. The layout says which is which:

```
index.html          Earth ground track, elements, Bangkok visibility, decay forecast
moon-track.html     Moon-centred: lunar orbiters and landing sites
moon.html           Earth–Moon system and the five libration points

core/               the body-agnostic half
  body.js             what is a property of the CENTRAL BODY — rotation,
                      sub-satellite point, look angles, radii, mu
  propagator.js       what is a property of HOW A THING MOVES — SGP4 for Earth
                      TLEs, Kepler and daily-anchored for everything else

earth/
  orbit3d.js          the WebGL globe
  orbitviz.js         orbital-element vectors, stars, constellations, planets
  lifetime.js         orbital decay and re-entry forecasting

moon/
  lunar.js            ELP-2000 lunar ephemeris + CR3BP libration points
  moonviz.js          the Earth–Moon 3D scene
  moondata.js         baked lunar orbiter ephemerides, landing sites, features

verification/       an independent second implementation, and the regression gate
```

The dependency graph is one-way: pages depend on `core/`, `core/` depends on nothing. No file in
`earth/` is loaded by the Moon pages, and no file in `moon/` is loaded by the Earth page.

### Status

The Earth console is the finished piece: it answers the assignment and is held to a
bit-identical regression gate on every change.

**Both Moon pages are marked *testing* in their own mastheads**, and the badge names the actual
reasons rather than hedging. They are not covered by that gate; the lunar ephemerides are baked
at build time and frozen, because Horizons sends no CORS header and a browser cannot re-fetch
them; positions are good to about a kilometre near a daily anchor and tens of kilometres between
them; and two of the five spacecraft have no published ephemeris at all. Each page computes and
shows its own staleness — how long ago the data was baked, and which craft runs out of coverage
first — so the warning cannot quietly go out of date.

## The assignment

Select a satellite from CelesTrak's Earth Resources group and build a web program that reports its
orbital elements, plots a day of ground track, and totals its visibility from Bangkok above a 5°
mask. Parts (a), (b) and (c) below are that answer.

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

Every figure quoted in this README is computed from *that* element set, so the numbers stay
checkable. The live page fetches a newer one on load (see **Staying current** below), so what it
shows will differ — and should.

The picker at the top right searches **2,158 spacecraft** by name or NORAD ID — type `knack`,
`landsat`, `iss`, or `43722`. Everything on the page recomputes on selection.

## (a) Orbital elements at epoch

| Element | Symbol | Value | Where it comes from |
|---|---|---|---|
| Semi-major axis | a | **6741.908 km** | recovered by SGP4 from the mean motion |
| Eccentricity | e | **0.0007959** | line 2 cols 27–33 (leading decimal implied) |
| Inclination | i | **51.6258°** | line 2 cols 9–16 |
| RAAN | Ω | **213.5681°** | line 2 cols 18–25 |
| Argument of perigee | ω | **152.6345°** | line 2 cols 35–42 |
| Mean anomaly at epoch | M | **207.5073°** | line 2 cols 44–51 |

Five of the six are stored literally in the TLE. The semi-major axis is not, and getting it right
takes more than one line of algebra.

The obvious route is Kepler's third law applied to the TLE's mean motion:

```
n = 15.68476422 rev/day × 2π / 86400 = 1.140651e-3 rad/s
a = (μ / n²)^(1/3),  μ = 398600.4418 km³/s²   →   6741.396 km
```

**That answer is wrong.** The mean motion in a TLE is the *Kozai* mean motion: it already carries a
J2 correction, so feeding it to an unperturbed two-body law double-counts the oblateness. SGP4
un-Kozai's it during initialisation and recovers the Brouwer semi-major axis, which is the real one:

```
a = 6741.908 km            (SGP4 recovered value, on WGS-72 where the theory is defined)
error in the naive form:     −512 m
```

The error depends on inclination through a (3cos²i − 1) term, so it nearly vanishes at 54.7° — which
is why KNACKSAT-2 at 51.63° is a best case — and is worst for equatorial and polar orbits. Across the
2158-satellite catalogue the median error is **2.95 km**, the worst **6.38 km**, and LANDSAT 9 below
is off by 2.9 km.

Derived: nodal period 91.75 min, measured node-to-node rather than as 86400/n, which runs 3.7 s
long. Altitude 358.0–383.8 km over one revolution, taken from the propagation rather than from
a(1∓e) − Rₑ: the mean-element form ignores the J2 short-period radial term, understating the real
swing here by about 15 km, and on a highly eccentric object it returns a perigee altitude *below the
surface*. Note also the drag term `ndot = .00056149` — three orders of magnitude larger than a
Landsat's. At 360 km the atmosphere is still biting, and this element set goes stale fast.

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

Elevation is scanned every 4 s and each crossing of the 5° mask is then bracketed and bisected to
1 ms, so the total is not quantised by the scan. The scan has to be finer than the shortest pass
worth reporting: bisection only refines a crossing it has already bracketed, so at a 10 s step a
6-second pass is not merely imprecise, it is invisible.

Geometry only — no refraction, terrain or link budget, and no daylight/eclipse condition (this is
radio visibility, not naked-eye). Refraction is the largest unmodelled term: at 5° it is about
9.9 arcminutes, which adds roughly **8.4 s (+0.93 %)** to the total and moves each horizon crossing
by about 2 s. Worth knowing when reading a figure quoted to 0.1 s.

## For comparison — LANDSAT 9 (the Earth Resources answer)

Selectable in the picker. NORAD 49260, epoch 2026-09-12 04:49:46.684 UTC, sun-synchronous at
98.2207°:

- a = 7077.743 km, e = 0.0001484, i = 98.2207°, Ω = 324.2909°, ω = 100.3913°, M = 259.7453°
- **37.74 minutes over 4 passes**, best elevation 31.50° at 14:47 UTC

## How the Earth numbers are checked

An independent second implementation (own WGS-84 ECEF→ENU elevation, own TLE column parsing,
own Kepler-third-law semi-major axis) was cross-checked against this one:

- The five elements read straight from the TLE agree to better than 1e-12 relative. The
  semi-major axis, the period and the apsis altitudes are now taken from SGP4 rather than from
  mean-element algebra, for the reasons in section (a), so they deliberately differ from the
  harness's naive values.
- Topocentric elevation agrees with `satellite.js` look angles to 2.6e-10 degrees over 200
  samples across the day, and with a from-scratch WGS-84 topocentric implementation to 1.1e-9
  degrees over 24 h — floating-point noise, no systematic bias.
- The visibility total is stable to 10 milliarcseconds across scan steps of 10 s, 5 s, 1 s and
  0.25 s, and the culmination solver matches a 200 000-point brute force to 0 ms.
- A deliberately dumb brute-force check — 86 400 one-second samples, counting those above 5°:
  - KNACKSAT-2: **899 s in 2 runs** vs this program's **899.7 s in 2 passes**
  - LANDSAT 9: **2265 s in 4 runs** vs this program's **2264.5 s in 4 passes**

  Both gaps are the expected quantisation of a 1 s counter against millisecond-precise AOS/LOS.

Run it yourself: `node verification/report.js` and `node verification/verify.js`.

## The view from the spacecraft

The camera control has four positions — Free, Satellite, Bangkok, POV — but only two kinds of
camera. The first three are the *same* camera: a point at a fixed distance from the Earth's centre,
looking at the Earth's centre, differing only in how the bearing is chosen. "Satellite" therefore
shows the Earth from the spacecraft's **direction**, which is not the same thing as showing it from
the spacecraft. At 4.2 Earth radii out, the spacecraft is a dot in the middle of the frame.

**POV** sits on the spacecraft. Nadir by default — straight down, which in scene units is simply
toward the origin — with the along-track direction as screen-up, so the spacecraft flies toward the
top of the frame, the orientation nadir imagery is published in. Dragging turns the head instead of
leaving the mode, and the wheel changes the **lens** rather than the range, because there is no
range to change from on board: 8° is a long telephoto on the limb, 90° takes in the whole horizon.

From KNACKSAT-2 at 369.8 km the horizon sits **70.94° off nadir**, so pitching up past about 71°
takes the Earth out of frame entirely and leaves the star field. The catalogue cloud is still drawn,
which means the other 2,157 objects are visible from orbit as points above the limb — that falls out
of the existing scene rather than being built.

Four things were not obvious until the view existed:

- **The orientation is rebuilt from the same basis every frame**, not accumulated onto the previous
  one. Accumulating lets a long drag walk the roll off true, and the error never comes back.
- **The spacecraft marker is exactly where the camera is.** Drawing it fills the frame with the
  inside of a sprite, so it is hidden in this mode — as is the halo, which cannot face a camera
  standing on it.
- **The marker scale factor read the wrong variable.** Sprite sizes were derived from the free
  camera's distance from the origin, which is meaningless once the camera is somewhere else
  entirely: the site pin and the 2,158-point cloud would have rendered at whatever size the free
  camera happened to be the last time it was used. It comes from the camera's actual distance now.
- **The atmosphere is a back-faced additive shell at 1.022 Earth radii.** That is 140 km altitude,
  so a POV camera on a decaying object is *inside* it, where a rim glow becomes a full-frame wash.
  It is dropped below 1.03.

`cam0` — the free camera's bearing and distance — is never written while POV is on, so leaving the
mode restores the previous camera exactly rather than stranding it wherever the spacecraft was.

`verification/verify-pov.js` measures the camera rather than the picture, because a camera at 0.9999
of the right place still renders a plausible one: position against the propagated state vector
(exact, 0.00 km), view direction against nadir and screen-up against the along-track direction (both
to 1e-9), then the real wheel and drag handlers for the rest. One trap it documents by working
around it — the page owns the clock and pushes it into the scene every frame, so setting the scene's
time is silently overwritten on the next animation frame, and at 7.7 km/s that single frame of drift
reads exactly like a camera-placement bug.

## Architecture: the central body is a parameter

The console was written for the Earth, and the Earth had leaked into every layer: `RE` and `MU`
at module scope in three files, every position through `satellite.gstime` → `eciToGeodetic`, and
SGP4 as the propagator. None of that was wrong; all of it was an assumption rather than a
parameter. Extending to the Moon meant turning the assumption back into a choice.

### The seam, and why it goes exactly there

Two objects, each with one job.

**`core/body.js`** — what is a property of the *central body*: where the prime meridian is now, how to
get from inertial to body-fixed, the sub-satellite point, look angles from a surface site, plus
the constants that used to be globals.

**`core/propagator.js`** — what is a property of *how an object moves*, behind a single interface:

```
track.at(ms) -> {r, v} | null      body-centred inertial, km and km/s
```

That split is forced by a hard fact rather than chosen for tidiness. **SGP4 is defined only for
Earth satellites described by TLEs, and there is no lunar analogue.** Celestrak's own catalogue
record for LRO settles it:

```
LRO,2009-031A,35315,PAY,+,US,2009-06-18,AFETR,,,,,,,NEA,MO,ORB
```

`PERIOD`, `INCLINATION`, `APOGEE` and `PERIGEE` are all blank; `DATA_STATUS_CODE = NEA` is *No
Elements Available*; `ORBIT_CENTER = MO` is the Moon. Asking for its elements returns `No GP data
found`. Celestrak's documentation explains why: the SGP4 assumptions "are completely invalid when
applied to other celestial bodies". The theory hard-wires Earth's μ, Earth's J2/J3/J4 and an
Earth-fixed frame, and a TLE has no field in which to say what it orbits.

So the propagation half of this program was never going to port, and the interface had to sit
above it.

Three things fell out of the work:

- The four propagation adapters (`sampleMs`, `sample`, `elevationAt`, `stateAt`) were the same
  three lines written out four times, each calling `satellite.js` directly and each closing over
  the observer. They are one place now.
- Two latent Earth gates would have silently broken the second body: `orbitviz` rejected any orbit
  with `a < RE*0.9` — a 1829 km lunar orbit fails that by a factor of three, and the whole element
  panel would have vanished with no error — and carried a *second* hard-coded μ.
- `earth/orbit3d.js` needed less work than expected. Its scene unit was already one Earth **radius**
  rather than one kilometre, so every geometry literal in it (sphere 1, atmosphere 1.022, track
  1.004, footprint 1.006) is body-relative already and survives the swap untouched.

### The gate

A refactor's honest self-assessment is a diff, not an opinion — and the errors this code has
actually had were invisible ones. The Kozai semi-major-axis error was 512 m. The culmination bug
hit 15 satellites out of 309. Neither would survive contact with a screenshot, and both would pass
a "looks the same to me".

`verification/snapshot.js` drives the **real page in a browser** rather than a re-implementation,
and reads full-precision values through a `window.__gt` test surface instead of scraping rounded
text. 38 satellites spanning LEO, sun-synchronous, GEO, HEO and a decaying object, at two window
spans: all six elements and every derived quantity, every AOS/LOS to the millisecond, culmination,
azimuths, range, visibility totals, and 100 fixed sample probes each.

**67,488 values, bit-identical**, across `index.html`, `earth/orbit3d.js` and `earth/orbitviz.js`.

Two reproducibility rules, both learned by getting them wrong first: the window start is a fixed
instant and never `Date.now()`; and the network is blocked during a run, because `refreshTLE()`
would otherwise rewrite the element set mid-snapshot and the "baseline" would depend on what
CelesTrak served that minute.

A gate that has never failed is not a gate, so it was checked against a deliberate fault:
perturbing Earth's radius by **10 cm** produced 77 differences, down to 1.5e-9 relative in derived
quantities like the access half-angle. The only diffs during the actual refactor were the observer
gaining `name` and `tz` fields — which retired a duplicate `ICT` constant — and the baseline was
re-taken only after confirming no numeric value had moved.

```
node verification/snapshot.js     # write verification/baseline.json
node verification/regress.js      # assert bit-identical
```

## Orbital decay and remaining life

KNACKSAT-2 is falling. The drag term in its TLE is three orders of magnitude larger than a
Landsat's, and CelesTrak's record shows the mean altitude going **418.6 km → 362.9 km between
5 Feb and 13 Sep 2026** — 55.7 km in 220 days, and accelerating. The page estimates when it runs
out of altitude.

### Where the history comes from

`celestrak.org/NORAD/elements/graph-orbit-data.php?CATNR=<id>` returns an HTML page with the whole
run of mean elements embedded in one `plotData` string — date, RAAN, inclination, argument of
perigee, SMA, eccentricity, for every element set CelesTrak has held. For KNACKSAT-2 that is 534
rows. The "SMA" column is the mean **altitude** a − Rₑ, not the semi-major axis. It sends
`Access-Control-Allow-Origin: *`, so the browser can read it without a backend.

It is also **slow — about 35 seconds per object**, measured, because the archive is rebuilt on each
request. So the fetch does not fire when you pick a spacecraft: clicking through the catalogue
would queue a dozen half-minute requests against someone else's server. There is a button, one
shared request per object, and a 12-hour cache.

### Why not just extrapolate the line

A straight line through the observed drop always over-estimates the remaining life, because decay
accelerates: the object falls into denser air, so it falls faster. For a near-circular orbit

```
da/dt = -rho(h) * B * sqrt(mu*a),    B = Cd*A/m
```

The **shape** of rho(h) comes from the standard piecewise-exponential atmosphere (US Standard 1976
+ CIRA-72, Vallado Table 8-4); the **amplitude** and the unknown ballistic coefficient are
calibrated from the object's own history. Only the ratio rho(h)/rho(h_now) is taken from the model,
and that ratio is far better known than absolute density — which matters, because density at 400 km
swings by an order of magnitude over a solar cycle.

That has a consequence worth stating plainly: **the absolute density scale cancels out.** Multiply
rho by *k* and the calibration divides B by *k*, leaving the forecast identical. An "uncertainty
band" built by scaling density up and down is therefore exactly zero wide. The first version of
this printed such a band — 85 to 341 days — before that was checked. It was meaningless.

Three implementation details that each changed the answer:

- **Integrate in altitude, not time.** The last 40 km are covered at hundreds of km/day, so a fixed
  time step overshoots the surface and the integration blows up mid-plunge. Marching down in
  altitude is unconditionally stable and lands exactly on the threshold. It also needs a floor
  guard: once the remaining gap falls below the ULP of the radius (~1e-12 km in LEO), subtracting
  the step is absorbed by floating point and the loop spins forever.
- **Calibrate exactly, not by a mean-altitude rate.** Time is inversely proportional to B, so one
  integration at B = 1 and a divide reproduces the observed drop with its curvature intact. Pinning
  a straight-line rate to the window's mean altitude is fine while the curve is flat and wrong once
  it steepens — which is exactly when the forecast matters. This cut the 30-day-out mean error from
  **108 days to 3**.
- **Fit the solar trend.** A second parameter, a log-linear density trend standing in for the solar
  cycle, read off the object's own record. KNACKSAT-2's fit says the atmosphere is thinning at
  0.24 %/day — cycle 25 is past maximum — which is why its observed decay rate has risen only
  ×1.21 over 220 days where a fixed atmosphere predicts ×2.15.

Re-entry is called at 120 km. The exact threshold barely matters: 100 km and 150 km move a 170-day
answer by 0.16 days, because by then the object has hours left.

### How well it works

Validated against objects that **actually re-entered**, with decay dates from the CelesTrak SATCAT.
The history is truncated at a fixed lead time, the predictor is run on what remains, and the answer
is compared with what really happened:

| Lead time | n | Median error | Half-IQR |
|---|---|---|---|
| 30 d | 21 | +12 d | 6 d |
| 60 d | 22 | +12 d | 8 d |
| 90 d | 23 | +5 d | 13 d |
| 120 d | 21 | −20 d | 11 d |
| 180 d | 20 | **−63 d** | 12 d |
| 270 d | 17 | **−144 d** | 5 d |
| 365 d | 17 | +56 d | 166 d |

Usable to about four months. Beyond that it runs **months early**, and past a year it is not a
forecast at all. The page says which of those regimes it is in rather than printing one number and
leaving the reader to assume it means the same thing at every range.

**The validation set's own limitation, since it bounds everything above:** all 24 objects re-entered
between 28 Aug and 12 Sep 2026, so they met the same solar weather on the way down. Their errors are
correlated, the tight half-IQR at 270 days is an artefact of that rather than evidence of precision,
and the measured bias partly reflects one phase of one solar cycle. A fair test needs decays spread
over years; at 35 seconds a request, that was not built here.

One thing the table deliberately does not show, because it would flatter the method: running the
predictor on each object's **full** history reproduces its real decay date to ±1 day. That is not a
forecast — those histories run to within a day of re-entry, when the object is already near 150 km
and falling fast. It confirms the endgame integration, nothing more.

### What it refuses to answer

A drag model applied to a spacecraft under thrust produces fiction, so the estimator checks first:

- **Boosted** — sustained rises in the record. PROGRESS-MS 33 climbed 271 → 420 km before its
  deorbit burn and is declined outright: its re-entry was a decision, not a deadline.
- **No measurable decay** — station-kept, or simply too high for drag to bite.
- **Too little history** — under ~25 element sets or 45 days, TLE scatter swamps the trend.

### KNACKSAT-2

| | |
|---|---|
| Mean altitude | 362.9 km |
| Decay rate | −0.289 km/day |
| Fitted density trend | −0.24 %/day (halving every 289 days) |
| Fit residual | 2.7 km rms over 220 days |
| Fixed-atmosphere estimate | 2027-02-11 |
| **With the solar trend** | **2027-04-16** |

Roughly seven months. An independent check: propagating the TLE forward with SGP4's own B* drag
term until it reaches 120 km gives **2027-06-09** — a different method, from a different input,
landing within a day of the trend model's figure when both were run on the same element set. And
since the backtest says this range runs about two months early, the true date is more likely after
April than before it.

## The Earth–Moon system page

`moon.html` — a geocentric view of the Moon's orbit with the five Earth–Moon libration points
marked and moving with it. Linked from the console's rail. `moon/lunar.js` holds the physics,
`moon/moonviz.js` the three.js scene.

### The Moon's position

Truncated ELP-2000/82B: the standard 60-term longitude and radius tables plus the 60-term
latitude table, with nutation in longitude and true obliquity for the apparent place. Not a
circle and not a fixed ellipse — the evection term alone swings the Moon ±1.27° and the
variation another ±0.66°, so anything simpler is wrong by degrees.

Checked against JPL Horizons over **731 daily samples spanning 2026–2028**:

| | median | p90 | worst |
|---|---|---|---|
| Angular separation | 1.9″ | 4.6″ | 9.5″ |
| Geocentric distance | 27.0 km | — | 44.9 km |

The lunar disc is 1865″ across, so the worst case is about 1/200 of a diameter. Calls cost
8.5 µs, which matters because the scene asks for a position every frame.

### The libration points

Solved, not approximated. L1, L2 and L3 are roots of a quintic in the circular restricted
three-body problem, found by bracketed bisection to machine precision — residual gradient
~10⁻¹⁶. L4 and L5 are the exact equilateral vertices, placed in the Moon's *instantaneous*
orbit plane from its position and velocity rather than a fixed ecliptic, since the nodes
regress over 18.6 years.

Cross-checked against an independently written solver: agreement to **0.000 km** on all five
points, L4/L5 exactly R from both bodies, barycentre at 4 671 km.

At mean separation:

| Point | From Earth | From Moon |
|---|---|---|
| L1 | 326 376 km | 58 024 km |
| L2 | 448 921 km | 64 521 km |
| L3 | 381 675 km | 766 075 km |
| L4 / L5 | 384 400 km | 384 400 km |

Two things the numbers settle:

- The familiar `R(μ/3)^⅓` Hill-radius shortcut puts L1 and L2 at 61 279 km from the Moon. The
  true roots are 58 024 and 64 521 km — **wrong by about 3 250 km in opposite directions**. A
  decent mnemonic, a poor answer, so it is not used.
- The points sit at fixed *fractions* of the instantaneous separation, which runs 356 400 –
  406 700 km. So they breathe: **L1 moves 42 600 km in and out every month**, L2 about 58 600.
  "Fixed point" is the wrong mental model before you even reach the instability.

### μ comes from GM, not from kilogrammes

Nobody measures the mass of the Earth. Spacecraft tracking measures the *product* GM, and DE440
carries GM_earth and GM_moon to about one part in 10¹¹. Converting to kilogrammes means dividing
by G — the worst-known constant in physics at ~2.2×10⁻⁵ relative — so a mass in kg throws away
six orders of magnitude before you start. The CR3BP only ever wants the ratio, so the division
is pure loss.

Not merely tidy: μ from kg came out **0.0253 % high**, which moved L2 by 5.7 km and the
barycentre by 1.2 km — visible at the resolution this page quotes.

### Three defects found while verifying the scene

- **The default camera sat in the orbit plane.** Elevation was measured from the *equator*, but
  the Moon's orbit is inclined 18.3°–28.6° to the equator depending on where the nodes have
  regressed to, so the camera could land within a degree of the orbit plane. The orbit collapsed
  to a sliver and L4/L5 appeared collinear with L1/L2/L3 — the one thing the view exists to
  disprove. Raised to 58°, which clears the plane by 37°–83° at every azimuth.
- **A label widened the document.** `place()` allows anchors up to 6 % outside the frustum, and
  nothing clipped them, so the "to Sun" tag pushed `scrollWidth` to 443 px at a 390 px viewport.
  Labels are now clamped and the viewport clips.
- **The barycentre tag landed on the Earth's**, rendering as "Earthcentre" — inevitable at true
  scale, since the two are 4 671 km apart. It gets its own line.

### Facts that needed correcting

Written from sources rather than memory, and three claims did not survive:

- **Queqiao-2 is not an EML2 spacecraft.** It flies a frozen lunar orbit, ~300 km periselene,
  inclination ~118°. Only **Queqiao-1** holds a halo about EML2, which it has done since 2018 —
  the only long-duration operational libration-point spacecraft in the Earth–Moon system.
  CAPSTONE flew an NRHO *about* EML2, which is an orbit around the point rather than the point,
  and its mission ended in June 2026.
- **The "23 days" instability timescale is the Sun–Earth figure**, repeated almost everywhere as
  if it were universal. Running the CR3BP linearisation
  (`λ⁴ + (2−c)λ² + (1+c−2c²) = 0`, time unit 1/n = 4.348 d) gives:

  | | L1 | L2 | L3 |
  |---|---|---|---|
  | Earth–Moon e-folding | **1.48 d** | **2.01 d** | 24.4 d |
  | Sun–Earth e-folding | 23.0 d | 23.4 d | — |

  Twelve times faster. It is why ARTEMIS station-kept roughly weekly, for only ~15 m/s total.

- **L4/L5 are stable only in the idealised problem.** The Routh criterion (μ < 0.0385) is
  satisfied comfortably at μ = 0.0122, and most summaries stop there. But the Sun pulls on the
  Moon **2.20× harder than the Earth does**, and that perturbation destroys the strict
  equilibrium: what survives near L4/L5 are a few periodic *substitute* orbits, with test
  particles wandering chaotically and many escaping. The page says "in theory" and explains why.
  The Kordylewski dust clouds reported there since 1961 remain unconfirmed.

### Two checkable claims the page makes

Both computed rather than repeated:

- **The Moon's orbit is not a visibly squashed ellipse.** At e = 0.0549 the semi-minor axis is
  0.99849 of the semi-major — 0.15 % off round, 580 km on 384 400, which no eye will catch. What
  is visible is that the Earth sits **21 104 km** from the ellipse's centre, 3.3 Earth radii. The
  shape reads as a circle; the off-centre focus is the part that shows.
- **The Moon's path around the Sun is always concave toward the Sun.** Integrating the
  heliocentric path over a year, the minimum of (path acceleration · Sun direction) is **+0.889**
  — positive everywhere, so it never loops backwards. The reason is the 2.20 : 1 pull ratio above.

### Verified

Zero page errors in light and dark after exercising every control; no horizontal scroll at 390,
414, 768 and 1400 px; time controls advance the readouts; the scene renders with all nine labels
placed. The scale toggle defaults to **true scale** and always states which mode is showing —
enlarging the bodies makes them visible but misrepresents a geometry where the Moon is 60 Earth
radii away.

## The lunar track console

`moon-track.html` — the same console pointed at the Moon. Same layout, same transport, same
palette; different central body, which is the point of the split above.

Five objects, and the page's job is to say **how well each one is actually known**:

| Grade | Objects | What it means |
|---|---|---|
| **tracked** | LRO, Chandrayaan-2, Danuri | 740 daily osculating element sets baked from JPL Horizons, which ingests the operating agencies' own navigation solutions |
| **published** | Queqiao-2 | no ephemeris exists publicly; the orbit is rebuilt from published mission parameters. Size, shape and inclination are right — the **phase** is not knowable |
| **schematic** | Queqiao-1 | a halo orbit is not a conic and cannot be drawn from orbital elements at all. Listed, not propagated |

That distinction exists because of a real gap. **JPL Horizons carries no Chinese lunar
spacecraft**: a name search for `Queqiao` returns "No matches found", and `Chang*` matches only
three spent boosters. CNSA publishes no machine-readable ephemeris. That is why trackers fed from
Horizons show an empty Moon where those spacecraft are.

Leaving them off would assert that three spacecraft are at the Moon, which is false. Showing them
as though tracked would be worse than either. So they are on the map with the grade stated on
every row.

### There are no lunar TLEs

The Earth console runs on SGP4, which exists only for Earth satellites described by two-line
elements. Celestrak's own catalogue record for LRO settles it:

```
LRO,2009-031A,35315,PAY,+,US,2009-06-18,AFETR,,,,,,,NEA,MO,ORB
```

`PERIOD`, `INCLINATION`, `APOGEE` and `PERIGEE` are blank; `DATA_STATUS_CODE = NEA` is *No
Elements Available*; `ORBIT_CENTER = MO` is the Moon. Requesting its elements returns `No GP data
found`. Celestrak's documentation explains why: the SGP4 assumptions "are completely invalid when
applied to other celestial bodies."

### Why daily anchors, not one element set

The Moon's gravity field is dominated by mascons rather than a smooth J2 term, so the quantities a
Keplerian propagator holds constant do not stay constant. Measured from Horizons, LRO's argument
of periapsis moves about **3.1°/day** and its period grows about **1.7 s every four hours**.
Period error integrates into along-track error, so one element set puts the spacecraft on the
wrong side of the Moon within weeks.

Adding J2 does not rescue it — J2 captures nodal regression and misses the mascon-driven evolution
of ω and e, which is the part that hurts. A fresh anchor does. Checked against Horizons' own
sub-observer point, 289 samples over six days:

| Hours from anchor | Median error |
|---|---|
| 0 – 2 | 1.0 km |
| 2 – 4 | 4.0 km |
| 4 – 6 | 7.5 km |
| 6 – 8 | 11.0 km |
| 8 – 10 | 14.2 km |
| 10 – 12 | 17.9 km |

Against **32–56 km** for a single element set held for days. The panel shows the anchor epoch,
the hours since it, and the error that implies, rather than printing a position as if it were
exact.

### The rotation, and why libration is not optional

Earth's GMST is a smooth polynomial. The Moon's orientation is a polynomial **plus a 13-term
libration series**, applied to the pole's right ascension and declination *and* to the prime
meridian. Leave it out and the sub-spacecraft point is wrong by **44 km**. With it, **0.15 km**
against Horizons over 289 epochs — a factor of 300.

Three traps, each found by measurement rather than by reading:

- **The NAIF `NUT_PREC` rates are per Julian *century*** while every other term in the model is
  per day. The check that settles it: E₁ is the lunar node, and −1935.5364525 / 36525 =
  −0.052992 °/day, exactly the 18.6-year nodal regression. Read as a daily rate it advances the
  arguments 36,525× too fast and puts the pole 1.9° out. What identified it was the error's
  *shape* — latitude depends only on the pole, longitude on W, so a latitude-only error pointed
  straight at the pole.
- **Horizons' `VECTORS` defaults to the ecliptic plane** while the IAU rotation wants ICRF
  equatorial. `REF_PLANE='FRAME'` is required; without it everything tilts by the obliquity.
- **`VECTORS` epochs are TDB, `OBSERVER` epochs are UT** — 69 s apart, and LRO covers 3.5° of
  orbit in 69 s, enough to swamp the error being measured.

A fourth, about the API rather than the physics: **date parameters must not be quoted while
`STEP_SIZE` must be**, and a wrongly-quoted parameter is *silently ignored* rather than rejected.
The first validation run returned a year of defaults instead of the range asked for, and looked
entirely plausible.

### The globe

A 3D view, in `moon/moon3d.js`, with the flat map kept as a toggle.

It differs from `earth/orbit3d.js` in one deliberate way: the Earth globe draws the
**inertial** frame and spins the planet under a fixed orbit, while this one is **body-fixed** —
the Moon holds still and the orbit sweeps around it. That is the right choice for a tidally
locked body. The near side permanently faces the Earth, so holding it still is how anyone
actually pictures the Moon, and it keeps the near/far boundary — the thing that decides whether
a lander can call home — fixed on screen instead of rotating away. The cost is that the orbit
plane visibly turns over a month, which is true and worth seeing.

The surface is the real **LRO Wide Angle Camera global mosaic**, pulled from NASA Moon Trek's
WMTS tiles. Level 1 is a 4×2 grid of 256 px tiles — 1024×512 for about 400 KB — and it is the
one imagery source that sends `Access-Control-Allow-Origin: *`, which is the only reason a page
with no backend can use it at all.

Tiles are painted to a **second** canvas rather than the live one. Drawing a cross-origin image
taints a canvas, and a tainted canvas throws at texture-upload time rather than at draw time —
which would take out the whole scene rather than just the imagery. Painting elsewhere and testing
readability first means a blocked tile costs nothing: the procedurally painted fallback, where
the maria are drawn from the feature list, simply stays.

### Working it like the Earth console

Same affordances, because it is the same instrument:

- **Every object is drawn at once**, not just the selected one — there has to be something to
  click. Hovering names it; clicking switches to it.
- A **layers panel** built from the scene's own layer list, so adding a layer to
  `moon/moon3d.js` puts a checkbox on the page without touching the page.
- **Follow** swings the camera to hold the selected spacecraft's sub-point beneath it, the lunar
  equivalent of the Earth console's satellite camera.

Two details that are not obvious until they bite:

**The click follows the hover label, not a fresh raycast.** Those look equivalent and are not.
LRO and Chandrayaan-2 both fly ~100 km polar orbits, so their hit spheres overlap on screen and
the two picks can resolve to different objects one frame apart — observed exactly that, with the
label reading Chandrayaan-2 while the click selected LRO. Using the hovered index makes the rule
simple and true: you get what the label says.

**The click target is a separate, invisible sphere**, larger than the marker. At normal zoom the
visible dot is about nine pixels across — findable by eye, a coin-toss to hit with a mouse, and
hopeless on a phone. The hit sphere is about twenty-six. Keeping them apart lets the marker stay
small without punishing anyone. It has to stay `visible: true`, incidentally: three.js raycasts
invisible objects quite happily, so hiding it would leave a ghost target behind — a bug already
paid for once on the Earth console's catalogue cloud.

And the drag guard measures **displacement from pointerdown**, not the sum of the moves. Summing
every delta lets ordinary hand jitter exceed any sane threshold and silently kills the click —
also already paid for once.

### Engineering readouts

Sub-point, altitude and altitude rate, inertial and ground speed, the radial/transverse velocity
split, live osculating elements recovered from the state vector rather than read off the stored
anchor, period, apsis altitudes, specific orbital energy, specific angular momentum, Earth range
and one-way light time, Earth elevation from the spacecraft, the sub-Earth point, solar elevation
and shadow state.

And for every landing site, **whether the Earth is above its horizon at all**. From a far-side
site the Earth never rises — the elevation is permanently negative, not merely low. Chang'e-4 and
Chang'e-6 both landed there and neither could have returned a single bit directly, which is the
entire reason Queqiao exists. The table computes it rather than asserting it.

### Frames, and an accepted error

Landing-site coordinates are published in the **mean Earth / polar axis** frame; the IAU series
implemented here is closer to the **principal axis** frame. The two differ by about 0.03°, roughly
**860 m** on the surface — below the anchoring error everywhere except within an hour or two of an
anchor epoch. It is accepted rather than corrected, and stated rather than buried.

One more difference from Earth worth knowing: the Moon's surface rotates beneath an orbiter at
only about **4.6 m/s** against roughly **1.56 km/s** of orbital ground speed — 0.3 %, where a LEO
satellite sees about 6 %. So lunar ground tracks are nearly great circles, LRO's equator crossings
shift west by only **1.07°** (~32 km) per revolution, and global coverage takes a month rather
than a day.

## Data provenance

The embedded catalogue is **2,158 satellites, 319 KB**, built from:

1. **SatNOGS DB** — `https://db.satnogs.org/api/tle/?format=json`, which serves anonymously
   (no API key). 1,437 satellites kept. KNACKSAT-2 comes from here; SatNOGS records its own
   `tle_source` for that object as **Space-Track.org**.
2. **CelesTrak** groups (geo, resource, weather, science, military, stations) — 721 satellites,
   via a GitHub Actions mirror, because celestrak.org was timing out from the build machine on
   both :80 and :443 at the time (it answers now — the block appears to have been transient or
   rate-limit related). Starlink and OneWeb were deliberately excluded: thousands of
   near-identical objects would swamp the picker.

Every block was validated before embedding: 69-character lines, matching NORAD IDs across lines 1
and 2, correct mod-10 checksums, and no epoch older than 60 days. 202 duplicates were resolved by
keeping the most recent epoch; 211 stale objects were dropped. Epochs span 2026-07-14 → 2026-09-14.

**Space-Track.org direct access needs an account** (username and password, no anonymous API), so
it is not queried at build time. SatNOGS is the practical substitute and republishes Space-Track
data for exactly this reason.

## Radio visibility is not naked-eye visibility

Every pass figure in this README is **radio** visibility: geometry above a 5° mask, day or night.
The page used to say so in a disclaimer. It computes the difference now.

Seeing a pass needs two more conditions that pull against each other — the spacecraft lit while the
observer is not. That is why satellites are watched in the hour after dusk and before dawn, and why
most radio passes are not watchable at all. Both of KNACKSAT-2's passes on the reference day are
radio-only, for opposite reasons: the 18:12Z pass has the sun 67° below Bangkok's horizon but the
spacecraft **in eclipse**; the 07:20Z pass has it sunlit and the sun **55.8° up**.

### The shadow is a cone

The Sun is not a point. At 696,000 km radius and 1.496×10⁸ km away it subtends about half a degree,
so Earth's shadow tapers and is wrapped in a penumbra that widens with distance. A cylinder is the
usual shortcut, and it is wrong in the direction that matters: it reports full shadow where there is
only partial shading.

Measured rather than asserted — walking down the anti-sun axis, the umbra closes at **1.3916×10⁶ km**,
matching `Re·d/(Rs−Re)` to within 0.000 %. A cylinder never closes at all. At 40,000 km behind the
Earth the umbra radius is 6194.8 km and the penumbra 6564.9 km, bracketing Earth's own 6378.1 km.

Umbra and penumbra are reported separately rather than collapsed. At LEO the penumbra crossing lasts
seconds — **0.25 %** of KNACKSAT-2's orbit — but it is a real state, and a satellite in it is dimmed
rather than dark.

The same code has to produce both extremes, which is the check worth having: a 51.6° LEO orbit is
sunlit **60.5 %** of the day, a sun-synchronous METOP-B **71.4 %**.

### One bug this found, which was not hypothetical

Solar elevation comes from `asin` of the cosine of the zenith angle. With the site *at* the
sub-solar point that expression is sin² + cos², which rounds to 1.0000000000000002 and takes `asin`
straight to **NaN**. Not a corner case: the sub-solar point crosses Bangkok's latitude twice a year.
It is clamped, and the check that caught it — the Sun must be exactly overhead at its own sub-point
— is kept.

What survives is 8.54×10⁻⁷ degrees, and that is the formulation, not the code: `asin` has a diverging
derivative at ±1, which is precisely where that test sits, so a double's 2×10⁻¹⁶ becomes √(4×10⁻¹⁶)
≈ 1.1×10⁻⁶ degrees. Three milliarcseconds, at the one point on Earth where it is worst.

### One duplication deliberately kept

`earth/orbit3d.js` carries its own copy of the solar position for the directional light. It is a
standalone renderer that has to work without the page, and the two are used for different things.
The page's own copy is now stated once, as `sunEci`, with `subsolar` expressed in terms of it.

## Doppler, and where the frequency comes from

Range rate is what the pass table was missing. It is taken in the **body-fixed frame**, because
that is the one frame where the ground station is at rest: the site is a constant vector there, so
the closing speed is a projection onto the line of sight and nothing more.

The trap is that the spacecraft's velocity in that frame is *not* the propagated velocity with its
axes turned. Turning the axes leaves the frame's own rotation unaccounted for, and the transport
term −ω × r is what actually carries the observer — **0.452 km/s at Bangkok**, which is 0.65 kHz
at 435 MHz. Small beside a spacecraft's 7.7 km/s, and far too large to drop from a figure quoted in
kHz. `omega` and `siteFixed` live on the body, so this stays a property of the central body rather
than another Earth assumption.

Checked against a numerical derivative of the range, which shares only the propagator — no frames,
no ω, no transport term. Worst disagreement **3.1 cm/s** over 401 samples; dropping the transport
term breaks it by **0.439 km/s**, 14,000× larger, so the check demonstrably has teeth.

### The floor that check runs into

The agreement cannot be improved by shrinking the step, and finding out why was the useful part.
The first threshold failed at 2.2e-4 km/s, which looked like a formula error. It was not: moving to
a 4th-order stencil made the agreement *worse*, and shrinking `h` made it worse still — 6e-4 km/s at
h = 0.0625 s, flipping sign as it went. That is quantisation, not truncation.

`satellite.js` carries time as a **Julian date**, about 2.46×10⁶ for these epochs, where a double's
ulp is **4.02×10⁻⁵ s**. At 7.66 km/s that quantises the propagated position at **0.308 m**, so a
differenced range carries ε/(2h) of noise however exact the propagation is:

| h | predicted ε/(2h) | observed |
|---|---|---|
| 0.5 s | 3.08e-4 km/s | 3.2e-4 |
| 1 s | 1.54e-4 | 1.1e-4 |
| 8 s | 1.93e-5 | 1.6e-5 |

`h` is chosen where that noise and the stencil's truncation balance, and the script says so rather
than leaving a tolerance that looks arbitrary.

### The frequency is the one thing that cannot be derived

`earth/transmitters.js` is baked from **SatNOGS DB**'s transmitter endpoint — the same anonymous
source that supplies most of the embedded catalogue, so this adds a field to a source already
trusted rather than a new dependency. One request, not 2,158: the whole table is 3.9 MB unpaginated
in about seven seconds, and asking per object would be 2,158 requests for the same bytes.

Kept: **active** transmitters only, with a published downlink, deduplicated on frequency and mode,
at most four per object, and only for objects actually in the catalogue.

| | |
|---|---|
| Transmitters | **2,037** on **1,213** objects |
| Coverage | 56.2 % of the catalogue |
| Dropped | 183 not active, 2 with no downlink, 194 duplicate or over cap |
| Bands | 685 S-band, 398 UHF 420–450, 76 VHF 144–148, 878 other |

The other 43.8 % have **no published downlink**, which is the normal case for the government and
commercial half of the catalogue. The panel says so instead of offering a plausible default to tune
to, and the box stays editable either way — a station knows its own bird better than a database does.

KNACKSAT-2 comes back with 145.825 MHz FSK 9k6 (IARU coordinated, digipeater) and 400.630 MHz for
telemetry. Over the 68.1° pass those give a swing of **6.77 kHz** and **18.59 kHz**; LANDSAT 9's
2282.300 MHz S-band downlink swings **83.87 kHz** across its own.

```
node verification/fetch-transmitters.js   # re-bake earth/transmitters.js
```

## Staying current

A TLE is a snapshot, and the embedded catalogue is a snapshot of snapshots. At 360 km with
`ndot = .00056` the KNACKSAT-2 element set is worth about a day; quoting pass times from a
week-old set is quoting fiction. So the page does not rely on what is baked into it.

**On load, on every change of spacecraft, and every three hours the page stays open, it fetches
the current element set for that one object** — not the whole catalogue. A few hundred bytes, for
the object actually being analysed:

1. `celestrak.org/NORAD/elements/gp.php?CATNR=<id>&FORMAT=tle` — authoritative, ~170 bytes.
2. `tle.ivanstanojevic.me/api/tle/<id>` — fallback, JSON.
3. The embedded snapshot, if neither answers.

Both live sources send `Access-Control-Allow-Origin: *`, which is the only reason a static page
with no backend can do this at all. (CelesTrak emits the header only when the request carries an
`Origin`, so a bare `curl` appears to show no CORS support; a browser sees it.)

Five details that matter more than the fetch itself:

- **It only ever moves forward.** A mirror can legitimately serve an element set *older* than the
  embedded one. Epochs are compared and an older set is refused — replacing a newer TLE with an
  older one in the name of freshness would be exactly backwards.
- **It validates before believing.** A source that is up but has no such object answers **200**
  with an HTML error page. Line lengths and the NORAD ID on line 1 are checked against the
  requested object before anything is swapped in.
- **It says which set is on screen.** "Updated live from CelesTrak", "Confirmed current against…",
  or "No live source reachable — showing the embedded snapshot." Failing silently and letting the
  page imply the numbers are fresh is the one outcome worth engineering against.
- **The clock stays where you put it.** The window and span are unchanged, so a swap re-runs the
  analysis underneath the scrubber without throwing away the time you were looking at. Results are
  cached per NORAD ID in `localStorage` for three hours, so switching back and forth costs nothing.
- **It keeps checking.** This used to be one check per object per *session*, which is right for a
  visit and wrong for a console left running — the set on screen would age quietly past the point
  where its pass times were worth quoting. The check now re-arms on the same three-hour beat as the
  cache, so the retry lands exactly when the cached copy goes stale rather than being answered from
  the copy it is trying to refresh. It rides the 30 s timer the age readout already uses, so all but
  one call in 360 is a comparison rather than a request. Background tabs have their timers throttled
  hard — Chrome drops them to roughly once a minute and may suspend them outright — so returning to
  the tab also triggers a check. And the provenance line now says *when*: "confirmed current against
  CelesTrak · checked 2.4 h ago" reads differently from the same sentence with no time on it, which
  is the point.

The embedded catalogue remains the offline fallback and what paints on first frame, and the
other 2,157 objects in the 3D catalogue cloud are still drawn from it — they are context, not
analysis. To refresh that baseline, rebuild `catalog.txt` and re-inject it into the
`<script id="tledata">` block.

## Running it

**The pages need nothing.** No build, no server, no install — open them:

```
index.html   moon-track.html   moon.html
```

The `package.json` in the root is for the *checks*, not the pages. Several of them drive a real
browser through Playwright, which was previously required with nothing declaring it — so running
the gate on a fresh clone meant setting `NODE_PATH` by hand. Now:

```
npm install          # Playwright, once
npm test             # the offline suite; must end BIT-IDENTICAL
```

`npm test` runs the second implementation, the element-vector geometry, the regression gate and the
live-refresh check, in that order. Individually:

```
npm run verify       # independent second implementation of elements/elevation/visibility
npm run report       # the LANDSAT 9 answer, printed
npm run evec         # element-vector geometry, across e = 0.00015 to 0.91
npm run refresh      # the live TLE refresh, against mocked sources
npm run pov          # the POV camera, measured against the propagated state
npm run doppler      # range rate, against a numerical derivative of the range
npm run optical      # shadow cone geometry and naked-eye passes
npm run snapshot     # (re)write verification/baseline.json
npm run gate         # compare the live code against it — must print BIT-IDENTICAL
```

The lunar checks are kept **out** of `npm test`, because they fetch from JPL Horizons and a clean
run should not depend on someone else's uptime:

```
npm run moon         # rotation vs Horizons sub-observer point
npm run moon:chain   # baked elements -> sub-point, end to end
npm run moon:bake    # re-bake moon/moondata.js from Horizons
```

`.github/workflows/verify.yml` runs the offline suite on every push, and again weekly — the
scheduled run is the useful one, since the embedded catalogue ages on its own and the pages pin
CDN versions of `satellite.js` and `three.js` that could be pulled.

Playwright is used for the browser-driven checks. The lunar scripts cache their Horizons responses
next to themselves, so a re-run is free.
