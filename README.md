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
  globetex.js         NASA imagery for the globe's surface, fetched at runtime
  places.js           finding the observer: place search, this device, timezones
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
mask. Parts (a), (b) and (c) below work it for KNACKSAT-2, which is **not** in that group — see
**Satellite**. LANDSAT 9, which is, is worked under **For comparison**.

## Satellite

**KNACKSAT-2** — NORAD 67683, international designator 1998-067XZ — a Thai CubeSat. That
designator is the giveaway: `1998-067` is the ISS, so KNACKSAT-2 was deployed from the station
and shares its 51.63° orbit at roughly 360 km, not a sun-synchronous one.

**KNACKSAT-2 is outside the brief.** It is not in CelesTrak's Earth Resources group:
`verification/resource.txt`, a copy of that group's 167 element sets, has no entry for it, and it
came into this catalogue from SatNOGS rather than from a CelesTrak group (see **Data
provenance**). The figures in (a) to (c) are correct for KNACKSAT-2, but they are not an answer
from the group the brief names. LANDSAT 9 (NORAD 49260) is in the group, and is the in-brief
answer, worked under **For comparison** below. KNACKSAT-2 stays the page's default; while it is on
screen the answer block says it is outside the brief, with a button that loads LANDSAT 9.

```
KNACKSAT-2
1 67683U 98067XZ  26255.31192122  .00056149  00000-0  48789-3 0  9995
2 67683  51.6258 213.5681 0007959 152.6345 207.5073 15.68476422 33916
```

Epoch: **2026-09-12 07:29:09.993 UTC** (day 255.31192122 of 2026).

Every figure quoted in this README is computed from *that* element set, with the window opening
at its epoch, so the numbers stay checkable. The live page does neither: it fetches a newer set on
load (see **Staying current** below) and opens the window at the reader's clock, so what it shows
will differ — and should. The line under the headline total says which window and which set it
used, so two readers an hour apart can see why their numbers disagree.

To reproduce the README on the page, open it with `?tle=embedded` — the **assignment snapshot**
link under *Element set*. That keeps the embedded element sets, asks no source for a newer one,
and opens each spacecraft's window at its own epoch. KNACKSAT-2 then reads 899.7 s over 2 passes
("15 min 00 s in view over 24 h from 2026-09-12 14:29 UTC+7 … Element set epoch 2026-09-12 07:29Z,
embedded"), and LANDSAT 9, one click away, 37.74 minutes over 4, as below.
`verification/verify-refresh.js` checks both, with a newer set on offer that must not be asked for.

The picker at the top right searches **2,158 spacecraft** by name or NORAD ID — type `knack`,
`landsat`, `iss`, or `43722`. Everything on the page recomputes on selection.

## (a) Orbital elements at epoch

| Element | Symbol | Value | Where it comes from |
|---|---|---|---|
| Semi-major axis | a | **6741.908 km** | SGP4's Brouwer value, recovered from the Kozai mean motion |
| Eccentricity | e | **0.0007959** | line 2 cols 27–33 (leading decimal implied) |
| Inclination | i | **51.6258°** | line 2 cols 9–16 |
| RAAN | Ω | **213.5681°** | line 2 cols 18–25 |
| Argument of perigee | ω | **152.6345°** | line 2 cols 35–42 |
| Mean anomaly at epoch | M | **207.5073°** | line 2 cols 44–51 |

Five of the six are stored literally in the TLE. The semi-major axis is not, and getting it right
takes more than one line of algebra. All six are SGP4 *mean* elements — the theory's averaged orbit,
with its periodic terms taken out — and not the osculating elements of the instantaneous two-body
orbit — a distinction that turns out to matter more than the one below.

The obvious route is Kepler's third law applied to the TLE's mean motion:

```
n = 15.68476422 rev/day × 2π / 86400 = 1.140651e-3 rad/s
a = (μ / n²)^(1/3),  μ = 398600.4418 km³/s²   →   6741.396 km
```

**That is not the value SGP4 works with.** The mean motion in a TLE is a *Kozai* mean motion, and
SGP4's theory runs on Brouwer's mean elements. The two are different mean-element conventions, and
their mean motions differ by a term of order J2. SGP4 converts
the Kozai value to Brouwer's during initialisation and recovers the Brouwer semi-major axis from it,
and that is the value the page shows:

```
a = 6741.908 km            (SGP4's Brouwer mean value, on WGS-72 where the theory is defined)
naive form, against it:      −512 m
```

The difference depends on inclination through a (3cos²i − 1) term, so it nearly vanishes at 54.7° —
which is why KNACKSAT-2 at 51.63° is a best case — and is largest for equatorial and polar orbits.
Across the 2158-satellite catalogue the median difference is **2.95 km**, the largest **6.38 km**, and
LANDSAT 9 below is off by 2.9 km.

Neither number is the semi-major axis of the ellipse the spacecraft is on at the epoch. Convert
SGP4's own position and velocity there to two-body elements (on its μ = 398 600.8 km³/s²) and the
osculating orbit has a = 6747.93 km, e = 0.0012452 and ω = 83.03°, against the mean 6741.908 km,
0.0007959 and 152.63°; its a moves 12.1 km over one revolution. The page lists these under the mean
elements. At an eccentricity this small ω and M are each poorly defined, and only their sum, the
argument of latitude, means much: the epoch sits 0.14° past the ascending node in the mean elements
and 0.00° in the osculating ones. So the 512 m is a real correction — the naive form is a formula
SGP4 does not use — but it is small beside the 6 km between the mean and osculating a.

Derived: nodal period 91.75 min, measured node-to-node rather than as 86400/n, which runs 3.7 s
long. Altitude 358.0–383.8 km over one revolution, taken from the propagation rather than from
a(1∓e) − Rₑ. The mean-element form gives a swing of 2ae = 10.7 km and misses two things of the same
size. The orbit radius itself varies 19.5 km, because SGP4's periodic terms move it: 8.3 km of the
excess is J3's long-period eccentricity term and under 1 km is J2's short-period one. And altitude
is height above the WGS-84 ellipsoid, whose surface under the track is 13.2 km lower at ±51.8° than
at the equator. The two combine, by phase, into the swing above. On a highly eccentric object the
mean-element form also returns a perigee altitude *below the surface*.

These figures are for a window starting at the epoch. The page measures the period and the apsis
altitudes over the first revolution of whatever window is set — by default one starting now — so
its figures move a little with the window, and it says so under them.

For a near-equatorial object in deep space the node-to-node period is not a usable number. At
i = 0.03° the latitude being timed never exceeds a few hundredths of a degree, and the Moon and Sun
move it by as much. With the window at the regression baseline's start, 2026-09-13 00:00 UTC, GEO
objects in the catalogue below 0.3° measured anywhere from 1307 to 1543 min against a sidereal day
of 1436.07 (GOES 18: 1461.4); started at each object's own epoch, the low end is 724 min (ASTRA 2G),
about half a revolution. LEO orbits are unaffected even at 0.23°, because J2 is symmetric about
the equator; SGP4 applies lunisolar terms only past 225 min. For deep-space orbits below 1°, and
wherever no two nodes are found, the page shows the Keplerian 2π√(a³/μ) from SGP4's a instead and
labels it "Kepler period" — 1436.13 min for GOES 18. The apsis altitudes there are still sampled
over one node-to-node interval, because the regression baseline is built on it, so the page gives
that interval's length and the fraction of a revolution it covers instead of calling it one
revolution, and does not set a radius swing from half an orbit against 2ae.

Note also the drag term `ndot = .00056149` — three orders of magnitude larger than a Landsat's. At
360 km the atmosphere is still biting, and this element set goes stale fast.

## (b) Ground track

24 hours from the epoch, SGP4-propagated, sampled every 10 s (8641 points), drawn on an
equirectangular projection with Natural Earth 110 m coastlines. TEME → ECEF by Greenwich mean
sidereal time → geodetic sub-satellite point on WGS-84. The track breaks at the antimeridian.
Segments where Bangkok has the spacecraft above 5° are overdrawn thicker and in a second colour.
A time scrubber moves the spacecraft along the track and re-renders the day/night terminator.

At 51.63° inclination the track is a band between ±51.8° geodetic latitude — the orbit plane bounds
geocentric latitude at the inclination, and geodetic latitude runs about 0.2° higher up there.
Bangkok at 13.75°N sits well inside it, unlike the near-polar Landsat track that crosses the tropics
almost vertically.

The inclination card reads that reach off the drawn track and gives each reason it differs from i,
both measured on the same samples: geodetic against geocentric latitude, 0.18° here, and the actual
plane against the mean i, 0.02° here. At LEO the second is SGP4's periodic terms, which a mean
element averages out. In deep space there is more to it. The i in the element set is the mean
inclination *at the epoch*, and SGP4 moves the mean inclination itself at a steady rate under the
Moon's and Sun's pull, so a fortnight later the mean in force is a different number — and near the
equator that drift can be most of the inclination. In a 24 h window from 2026-09-27 00:00 UTC,
GOES 18's plane peaks at 0.008° against the element set's 0.035°. At that instant, 14.9 days after
the epoch, SGP4's own mean inclination is 0.007°, and the periodic terms put the plane 0.001°
above it. ASTRA 2G in the same window goes the other way: its mean has risen to 0.029°, and the
periodic terms hold the plane at 0.002°. At its epoch there is no drift yet, and its plane sits at
0.001° against a mean 0.024°. So the card works out the mean in force where the track peaks from
SGP4's own rate, and credits the periodic terms only with the rest: for MMS 1 over a week from the
same date, 0.9° of periodic terms on 0.1° of drift. The card reads the track only when the window
holds a whole revolution. MMS 1's period is 85 h, so a 24 h window holds about a quarter of one,
and the arc in it reached ±11.5° in the case that found this. For such a window the card gives the
plane's osculating tilt at the window start, about ±74° — a geocentric figure, as the plane's bound
is — and says how far the arc got, in geodetic latitude like the map.

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

The page dates each pass in UTC, as the table above does, and a local time that falls on another
calendar day carries that day. It used to tag times with "+Nd" counted in whole 24 h periods from
the window start, which begins at whatever the clock said — so a pass at 03:07Z the next morning
had no tag, and "+1d" could mean two calendar days on. A pass already above the mask when the
window opens, or still above it when the window closes, is marked `*`: its AOS or LOS there is the
window edge, not a horizon crossing, and its duration counts only the part inside the window. A
geostationary spacecraft is the whole-window case, and the countdown says it is still up at the
window end rather than that it sets. After the window's last pass the countdown searches the 48 h
beyond the window for the real next pass. It used to count down to the window's first pass as if
the ground track repeated every window, which in the case that found it was 66.6 minutes late and
promised 74.2° for a 19.7° pass.

Geometry only — no refraction, terrain or link budget, and no daylight/eclipse condition (this is
radio visibility, not naked-eye). Refraction is the largest unmodelled term: at 5° it is about
9.9 arcminutes, which adds roughly **8.4 s (+0.93 %)** to the total and moves each horizon crossing
by about 2 s. Worth knowing when reading a figure quoted to 0.1 s.

## For comparison — LANDSAT 9 (the Earth Resources answer)

Selectable in the picker, or from the answer block's "Show LANDSAT 9" while KNACKSAT-2 is on
screen; the assignment snapshot opens it at its own epoch and reproduces these figures. NORAD
49260, epoch 2026-09-12 04:49:46.684 UTC, sun-synchronous at 98.2207°:

- a = 7077.743 km, e = 0.0001484, i = 98.2207°, Ω = 324.2909°, ω = 100.3913°, M = 259.7453°
- **37.74 minutes over 4 passes**, best elevation 31.50° at 14:47 UTC

## How the Earth numbers are checked

An independent second implementation (own WGS-84 ECEF→ENU elevation, own TLE column parsing,
own Kepler-third-law semi-major axis, own Kozai-to-Brouwer conversion) was cross-checked against
this one:

- The five elements read straight from the TLE agree to better than 1e-12 relative. The
  semi-major axis, the period and the apsis altitudes are now taken from SGP4 rather than from
  mean-element algebra, for the reasons in section (a), so they deliberately differ from the
  harness's naive values.
- The semi-major axis the page does show is checked on its own. The harness re-derives SGP4's
  un-Kozai step from Spacetrack Report #3 on WGS-72 and compares it with the value
  `core/propagator.js` hands the page: they agree to 2.7e-16 relative across all 167 element sets
  in `verification/resource.txt`. Until that check existed, nothing independent looked at the
  number on the card — the naive-against-naive comparison above passed whatever SGP4 did.
- Topocentric elevation agrees with `satellite.js` look angles to 2.6e-10 degrees over 200
  samples across the day, and with a from-scratch WGS-84 topocentric implementation to 1.1e-9
  degrees over 24 h — floating-point noise, no systematic bias.
- The visibility total is stable to 10 milliarcseconds across scan steps of 10 s, 5 s, 1 s and
  0.25 s, and the culmination solver matches a 200 000-point brute force to 0 ms.
- A deliberately dumb brute-force check — 86 400 one-second samples, counting those above 5°:
  - KNACKSAT-2: **899 s in 2 runs** vs this program's **899.7 s in 2 passes**
  - LANDSAT 9: **2265 s in 4 runs** vs this program's **2264.5 s in 4 passes**

  Both gaps are the expected quantisation of a 1 s counter against millisecond-precise AOS/LOS.

Run it yourself: `node verification/report.js` and `node verification/verify.js`. The report
prints the LANDSAT 9 answer as the page computes it — SGP4's a, the node-to-node period and the
propagated altitudes over the first revolution from the epoch — with the naive mean-element values
on a line of their own, labelled as what the page does not show. It used to print only those.

## The view from the spacecraft

The camera control has four positions — Free, Satellite, Bangkok, POV — but only two kinds of
camera. The first three are the *same* camera: a point at a fixed distance from the Earth's centre,
looking at the Earth's centre, differing only in how the bearing is chosen. "Satellite" therefore
shows the Earth from the spacecraft's **direction**, which is not the same thing as showing it from
the spacecraft. At 4.2 Earth radii out, the spacecraft is a dot in the middle of the frame.

**POV** sits on the spacecraft, facing **along-track** by default: forward along the horizontal part
of the velocity, with the zenith as screen-up, so the horizon runs level across the frame. Nadir is
pitch −90°, one drag down. It used to open on nadir, the orientation nadir imagery is published in,
and that was given up for a mechanical reason: with the view axis on the local vertical, a sideways
drag — which yaws about that vertical — could only roll the picture, and the camera felt stuck.
Facing forward separates the two, so yaw turns the head and pitch tilts it. Dragging turns the head
instead of leaving the mode, and the wheel changes the **lens** rather than the range, because there
is no range to change from on board: 8° is a long telephoto on the limb, 90° takes in the whole
horizon.

From KNACKSAT-2 at 369.8 km the horizon sits **70.94° off nadir** — 19.06° below the local
horizontal — so the forward view opens with its centre above the limb: the Earth is a thin band along
the bottom of the 42° frame with the atmosphere's glow over it, and two degrees of pitch up take the
planet itself out of the picture. There is no ground at the centre of that view to measure, so the
GSD readout gives the figure straight down instead and says where that is: **at nadir, below frame**.
The second half is dropped when nadir is in the picture, which from GEO it can be with the boresight
already off the disc — the whole Earth is 17° across from there. The catalogue cloud is still drawn,
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
(exact, 0.00 km), view direction against the along-track direction and screen-up against the zenith
(both to 1e-6), a full downward drag landing within the one-degree clamp of nadir, then the real
wheel and drag handlers for the rest. One trap it documents by working around it — the page owns
the clock and pushes it into the scene every frame, so setting the scene's time is silently
overwritten on the next animation frame, and at 7.7 km/s that single frame of drift reads exactly
like a camera-placement bug.

### Reading the globe

The globe uses the flat map's colours for the flat map's meanings: cyan the spacecraft and its track,
pink the site and its access circle, pale the footprint, and orange **in view from the site** — the
line of sight, and the marker while a pass is up. The orbit ring used to be orange too. In the
Satellite camera it runs edge-on straight through the marker, and read as the stretch of orbit
Bangkok can see; it is a neutral blue-grey now, as reference geometry rather than data. A key sits
in the bottom-left corner, which it gives up to the POV minimap, and on a phone it is dropped for the
same lack of room. While the orbital-elements layer is on, the key also names its symbols. The layer
draws Ω, i, ω, θ, h, e and v as bare letters and gives the full sentence only under the pointer,
which a newcomer has no reason to go looking for; the key lists each one in its label's colour.

The spacecraft's name and the catalogue's hover name are HTML over the canvas, so they have no depth:
the marker behind the planet was hidden by the depth test while its name went on being drawn over
the near face — in the Bangkok camera, where the spacecraft is behind the disc for most of every
orbit, a bold KNACKSAT-2 over the Indian Ocean with the spacecraft over South America. A label is now
hidden whenever the unit sphere lies between the camera and its point, and the same test gates hover
and click on the catalogue, which three.js otherwise raycasts straight through the Earth. Only while
the Earth is drawn: hiding it is how you look at what it was in front of.

The photographic map is sized for the view in front of the reader, not for the GPU. The ladder used
to stop only at `MAX_TEXTURE_SIZE`, which most phones put at 8192 or more, so a phone at the opening
zoom fetched the 6.6 MB map for a globe 560 device pixels across. The most magnified point of an
orbiting camera's view is the middle of the disc, where a unit of surface spans f/(d−1) pixels, so
a map W = 2πf/(d−1) texels wide puts one texel under each of them; the page takes the smallest rung
within a quarter of that. At the opening 4.2 Earth radii it is 2.56 times the drawing buffer's height
— the 0.6 MB rung for a phone or a 1440×900 window, the 2 MB one on a 2× display. Zoom in and the
sharper rung is fetched once the view has held still for 400 ms, alone, without the coarse insurance
copy the first load starts with; POV always wants the best the GPU holds, since its lens is on the
ground. Save-Data, or a connection the browser rates 3G or slower, keeps the coarse rung throughout,
and the note under the picker says so. `npm run globe` checks each of those against a rung it works
out itself from the canvas and the camera.

### Finding your way round the page

The console fills the first screen, and at 1440×900 nothing on it said that the analysis the
assignment asks for — the elements, the ground-track map, the pass table — was underneath. The one
pointer was a link at the foot of the rail, which scrolls on its own, about 1000 px out of view,
and the two Moon pages were linked beside it. The header now has a line of links to each section
below and to both Moon pages. It costs the globe 6 px at that size.

Below 900 px the console stacks, and on a 390×844 phone three things were wrong with it:

- **The layers panel** hung open over half the globe, the clock and the trail row, and nothing
  closed it. It now folds behind a Layers button, closed to begin with, which reports its state in
  `aria-expanded` and closes on Escape. Opened, it stops short of the trail and camera rows and
  scrolls within the height that leaves. Above 900 px it is the open panel it always was.
- **The transport bar** was sticky at the foot of the screen, where it wraps to four rows, 193 px,
  so the camera and trail buttons along the globe's lower edge were under it: a tap on Free landed
  on the transport. The window bar had no place in the stacking order, so it sat between the header
  and the globe and pushed the globe down into it. It now follows the transport, as on a desktop.
  The header and the transport stay sticky only where they fit round the globe, from 641 to 900 px
  wide on a screen taller than 700 px. Everywhere narrower or shorter they are ordinary bars, one
  either side of the globe. Held sideways, the phone's sticky header used to cover the Layers button
  and the clock whenever the camera row was in view.
- **The captions** over the button rows were all hidden below 900 px. That left three rows of
  "6 h" and "24 h", for trail length, window step and window length, with nothing to say which was
  which. They stay now, and on a phone the camera and trail captions sit above their rows.

No text on the page is smaller than 11 px, including the labels drawn into the sky plot and the
decay chart. It used to go down to 9 px, the layers panel's heading. Twenty labels were 9.5 px, and
the local time of every pass in the rail was 10 px, though it is the figure a reader most wants.
The degree sign on the element cards now sits on its number rather than a space away.

The page's vocabulary is spelled out in a **Terms** section at the foot of the page: AOS and LOS,
Z, NORAD and COSPAR IDs, TEME, B* in 1/ER, standard magnitude, penumbra, POV, FOV and GSD, the
entry interface, and the brief's Earth Resources group. The abbreviations in the header, over the
globe, in the rail and in the pass table carry their expansion as a tooltip, and the notes that lean
on a term, the outside-the-brief note and the re-entry warning, link to its entry. `npm run layout` checks all of this at four sizes. It tests
whether a button is covered with `elementFromPoint` at its centre, with the globe's lower edge
scrolled to the foot of the screen, rather than by reading z-indices.

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

Rows are read between 80 km and 400,000 km of mean altitude, bounds meant to throw out garbage
rather than orbits. The ceiling was 60,000 km, which threw out every row of every high eccentric
orbit — XMM-NEWTON's mean altitude is 60,550 km, the Cluster II spacecraft's about 65,600 — and the
page then said CelesTrak had returned no history or could not be reached. It now says which of six
things happened: no answer inside 75 seconds, a request that failed outright, an HTTP error, an
answer with no history in it, a history with no rows, or rows that all fell outside those bounds.
The first four offer a retry; the last two are answers, and do not.

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
leaving the reader to assume it means the same thing at every range. Where the bias has a
direction — the 180-day and 270-day rows — it also gives the month the median moves the date to,
and says the median is the nearest row's: a 135-day forecast is moved by the 180-day figure. The
headline stays the model's own figure, and a month is as fine as the median will bear, for the
reason below.

The two models are named on the page, fixed atmosphere and fitted trend, with the headline the
second. It used to say both "bracket" the date and label the band between them on the chart
"estimator spread", which reads as an uncertainty band. It is how far the two models disagree, and
the chart now says so: at 180 days the backtest put the truth about two months past the headline,
outside that band whenever the atmosphere is thinning.

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
- **Eccentric** — a median eccentricity above 0.02 over the last 45 days. The model applies drag at
  the mean altitude, where a near-circular orbit spends its time; an eccentric one loses its energy
  at perigee, a·e lower, which at e = 0.02 is about 135 km down in low orbit, where the air is ten
  to twenty times denser. Eccentricity was read with every row and never used: ION SCV-016 (e 0.057,
  perigee 303 km, mean altitude 711 km) got a date, and SLS DEB (e 0.15) and OV3-3 (e 0.10), whose
  mean altitude sits above the 1,000 km top of the density table, were "no measurable decay" — SLS
  DEB with 25 km of mean altitude gone in its last 45 days. The page now gives the perigee instead,
  from the latest element sets: under 120 km it says the object is re-entering, above 1,000 km that
  drag is not what is moving the orbit, and between the two that a circular-orbit date would answer
  the wrong question. The eccentricity it quotes for that refusal is the 45-day median it was made
  on, not the latest set's, which for an orbit rounding out can already be under 0.02. KNACKSAT-2,
  at e 0.0008, and every near-circular object take the same path as before, to the bit.

  How an eccentric orbit comes down depends on its apogee, and the page says which case it is in.
  With a low one, drag shapes it: it comes down apogee first, perigee holding nearly still until it
  is close to circular, and forecasting that means integrating on perigee height, which is not done
  here. ION SCV-016, OV3-3 and SLS DEB, apogees 1,100 to 2,800 km, each kept perigee within 3 km
  over their last 180 days while apogee fell by 30 to 250 km. With a high one it does not hold. The
  Moon and the Sun pull harder on a larger orbit while the J2 precession that averages their pull
  away slows, so the swing they give perigee grows roughly as the sixth power of the semi-major axis:
  CLUSTER II-FM8's perigee fell 1,340 km in its last 180 days, to below the surface, and a dead
  high orbit usually comes down when they lower perigee into the air. The first version said
  "apogee first" for every eccentric orbit with a perigee between 120 and 1,000 km, including
  ARKTIKA-M 1 on a Molniya orbit (perigee 789 km, apogee 39,572 km); it now says it only below a
  5,000 km apogee, where the swing is a few km, and above that says the Moon and the Sun move
  perigee as well, which a drag model does not see. The same split applies above 1,000 km, where
  every such orbit was told the Moon and the Sun were moving its perigee. The line between the two
  cases is not sharp — near the critical inclination of 63.4°, where perigee stands still, their
  pull accumulates even on a smaller orbit — and 5,000 km sits on the low side of it.

And one answer it will not give: a date already past. The forecast runs from the last element set
in CelesTrak's record, and CelesTrak publishes none for an object once it is down, so a record that
ends before its own forecast date is most likely the record of one that has come down. ICEYE-X34's
panel read "2026-09-14 — 0 days from the last element set" eleven days after that date, over the
within-three-weeks backtest line. It now reads **Probably re-entered**, with the forecast date and
how long ago it was, and no accuracy claim: the backtest measured dates still to come.

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
April than before it: moved by the 63-day median, into June 2027, which is the month the page now
gives under the date.

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

## Taking the answer away

Two formats, because they answer different questions. The **CSV** is the whole pass table at full
precision — AOS and LOS as RFC 3339, duration, elevations, azimuths, range, range rate, Doppler,
and the naked-eye verdict with the magnitude estimate behind it — for anything that wants to
compute with it. The **calendar** is for turning up: one `VEVENT` per pass with a 10-minute alarm,
titled with the spacecraft and its peak elevation, so a phone says "KNACKSAT-2 — 68° NE" rather
than nothing at all.

Both are built in the page and handed over as a Blob, which works from `file://` where this page
mostly lives.

A pass cut by the window edge is flagged in both, because its AOS or LOS is where the analysis
stopped and the files otherwise present it as a horizon crossing. The CSV's `aos_clipped` and
`los_clipped` are `true` or `false`, appended after every column that was already there, so each
one a reader finds by name — or by position — stays where it was; `est_magnitude` went on after
them for the same reason. The calendar event carries `X-GT-CLIPPED`, says in its summary and
description which end is the window's, and its alarm no longer announces an AOS that is really the
window opening.

The CSV also says what it was computed from, which it did not. The element set is replaced as soon
as a newer one is published and the window opens at the reader's clock, so two exports an hour apart
differ, and neither could be reproduced or cited: the filename carried the date and nothing else.
Eight columns now close every row — `tle_epoch_utc`, `tle_line1`, `tle_line2`, `tle_source`,
`window_start_utc`, `window_span_h`, `mask_deg` and `site_alt_km` — with the same values on each,
since a header block would break CSV readers and a value on every row survives sorting and
filtering. `tle_source` is `embedded`, for the snapshot built into the page, with the source that
last confirmed it current if one has, or the source a newer set was fetched from and when. When the
last check found no current set at CelesTrak, or a newer one SGP4 cannot propagate — in practice an
object that has come down — that is appended with its time, as the page says it under the element
set. The site is already in `site`, `site_lat_deg` and `site_lon_deg`.
`verification/verify-export.js` moves the observer away, applies the site from those columns and
`site_alt_km`, hands the two lines and the window from the file back to the propagator, and gets
the same passes: AOS, LOS and peak elevation.

`spacecraft` is the spacecraft's illumination at mid-pass — `sun`, `penumbra` or `umbra` — the value
the calendar description prints as "spacecraft sun". It keeps its short name because columns are
found by name.

Parsing them back, rather than looking at them, found two bugs that look identical to correct
output on screen:

- **`iso()` formats for a reader** — a space instead of a `T`, and a `Z` already on the end.
  Appending another gave `...33ZZ`, which `Date.parse` answers with `NaN`. Every timestamp in both
  files was unparseable.
- **RFC 5545 folds at 75 *octets*, not characters.** The summary carries an em dash: one JavaScript
  character, three UTF-8 bytes. Folding on `.length` let a 74-character line out of the door at 76
  octets — and Google Calendar and Outlook reject an over-long line outright rather than wrapping
  it. The fold iterates by code point now, which also keeps surrogate pairs whole.

`verification/verify-export.js` drives the real buttons, intercepts the download, and re-parses the
result: a strict quoted-field CSV parser checking the column count on every row, and an unfolder
checking every line's octet length, the event count, the UTC stamps and the ordering.

Nothing in the catalogue contains a comma, so CSV quoting was never reached by accident. The site
name is typed by a user though, and `Bangkok, "KMUTNB" site` is the obvious thing to type — so the
check sets exactly that and confirms the field round-trips with doubled quotes rather than shifting
every column after it.

## The observer is a value now

Bangkok was a constant. `lookAngles(site, rFixed)` had always taken the site as an argument, the
propagation adapters had always passed it, and `orbit3d` had always read `GT.OBS` — so the seam
existed; only the value was frozen. It is editable now, with a UTC offset, and it persists.

Two things make that safe rather than merely possible:

- **`OBS` is mutated in place, never replaced.** `earth/orbit3d.js` is handed the object once at
  init and reads it every frame. Assigning a new object would leave the globe pinned to the old
  site while every number on the page moved — the worst kind of failure, because it looks fine.
  The check reads the pin's own geometry back out of the scene and compares it against the new
  coordinates.
- **Bangkok stays the default.** `verification/baseline.json` records `obs = Bangkok` in its meta,
  and `snapshot.js` runs in a fresh browser context with empty `localStorage`, so a stored site
  cannot leak into it. Reset restores the assignment's own total to the bit.

Three ways in, because the observer used to be five numbers you had to already know:

- **Search a place name.** One request to Open-Meteo's geocoder — no key, CORS open — returns the
  position, the *ground elevation*, and a real IANA timezone. Results carry their coordinates
  because two places share a name more often than not; searching "Chiang Mai" offers the city, the
  airport, and a village of the same name in Chiang Rai.
- **Use my location.** The browser's own coordinates and accuracy, with the zone the device is set
  to — which for the device in your hand is the right answer and needs no request.
- **Coordinates.** Folded away behind a disclosure, and unchanged: an arbitrary point on the Earth
  still has to be reachable, and it is the only path that works with no network at all.

The last few sites come back as chips, so returning to one is a click.

The timezone follows the site, and it is **not one number**. A site with a zone is asked for its
offset *at the instant being displayed*, so summer time is right on both sides of a transition —
a 7-day window of passes can straddle one. Each pass time is converted at the offset in force at
that pass, and the label beside it now says the same: it used to follow the clock, so after the
change London printed 03:14:51Z as "03:14:51 UTC+1". A site typed in as bare coordinates has no discoverable
zone, so the offset field follows the longitude being typed — the nearest hour of solar time —
until someone types in the field itself, and an offset typed there is taken as typed. It used to
keep the previous site's offset, and Apply passed that on: London entered by hand came out in
UTC+7, Bangkok's, under a note calling it solar time, and every local time was seven hours out.
The note now says which of the three is on screen — a zone, a solar-time estimate, or an offset as
entered. The estimate is worth replacing: China keeps one zone across sixty degrees of longitude,
so Kashgar came out three hours adrift, and India and Nepal are on half and quarter hours.

The window-start field is in the observer's time too, with its offset printed beside it. It was
in the browser's own zone, said only in its aria-label, while every other local time on the page
is the observer's: with the browser in London and the site in Bangkok it read 08:00 for a window
opening at 07:00Z, and typing 14:00 opened the window at 13:00Z — 14:00 nowhere the page shows.

A note under the form also says which regime the page is in: the assignment's site, where the
README's figures need the assignment snapshot to reproduce, or moved, in which case they no
longer describe what is on screen. The flat map's marker, the readout's elevation and azimuth and
the visibility section's hint follow the site as well; they were static, and said Bangkok wherever
the site had gone.

Moving to Svalbard (78.23°N) returns **0 passes**, which is the right answer and a useful check:
KNACKSAT-2's 51.6° orbit never reaches that latitude, so a site there cannot see it at all.

## Radio visibility is not naked-eye visibility

Every pass figure in this README is **radio** visibility: geometry above a 5° mask, day or night.
The page used to say so in a disclaimer. It computes the difference now.

Seeing a pass needs two more conditions that pull against each other — the spacecraft lit while the
observer is not — and a third that the first version left out: it has to be bright enough. The
first two are why satellites are watched in the hour after dusk and before dawn, and why most radio
passes are not watchable at all. Both of KNACKSAT-2's passes on the reference day are radio-only,
for opposite reasons: the 18:12Z pass has the sun 67° below Bangkok's horizon but the spacecraft
**in eclipse**; the 07:20Z pass has it sunlit and the sun **55.8° up**.

### Lit is not the same as bright

The first version stopped at geometry, and said "naked eye: yes" whenever part of a pass was lit
against a dark sky. At LEO that is most of the answer. Further out it is none of it: an object
fades by 5·log₁₀(range) magnitudes, ten between 1,000 km and 100,000 km, and the page was calling
CLUSTER II-FM8 at 124,000 km, INTELSAT 36 at 37,000 km and MERIDIAN 10 at 12,000 km visible to the
eye — and writing "— visible" into their calendar events.

The verdict now rests on an estimated magnitude, in the usual convention. A **standard magnitude**
is an object's brightness at 1,000 km with half its face lit (the Sun 90° away, as seen from it).
The estimate scales that by range and by the phase function of a diffusely reflecting sphere,
normalised to 1 at 90°:

```
m = m_std + 5·log10(range / 1000 km) − 2.5·log10 F(φ)
F(φ) = (π − φ)·cos φ + sin φ        π face-on to the Sun (1.24 mag brighter), 0 backlit
```

φ is the phase angle, at the spacecraft between the observer and the Sun. Range and phase are taken
in the body-fixed frame, where the site is a constant vector and the Sun rotates like anything
else. **Yes** means fully sunlit, the Sun below −6° at the site, and magnitude +6 or brighter.

**The standard magnitude is the weak term.** A TLE carries no size and the catalogue carries
nothing else, so an object gets **5.0** — an intact satellite a few metres across — unless its
figure is published. Heavens-Above quotes an "intrinsic brightness" in exactly this convention, and
the page uses it for the ISS (**−1.8**), HST (**2.2**) and the Chinese station (**0.0**). Before
those went in, 5.0 called the ISS too faint on a low pass at 1,800 km, where it is around
magnitude 0. Only the convention is shared, not the phase law: Heavens-Above's own "maximum
brightness" figures (−5.6, −1.1 and −4.1, at perigee and fully lit) imply, taking the range as the
perigee height, a gain of 1.7 to 2.0 magnitudes from half lit to fully lit, where the diffuse sphere
gives 1.24. Near full phase the estimate here is the fainter of the two, by about half a magnitude.

A station is more than one catalogue entry. Each module and each visiting vehicle keeps its own
NORAD number, and while attached is published on the station's own element set: in this catalogue
ISS (NAUKA), POISK, CREW DRAGON 12, CYGNUS NG-24 and PROGRESS-MS 34 are on the ISS's, and CSS
(WENTIAN), CSS (MENGTIAN), SHENZHOU-23 and TIANZHOU-10 on Tianhe's. Looked up by number, all but the
other two CSS modules got 5.0 — and ISS (NAUKA), which is what typing "ISS" and pressing Enter
loads, read **too faint** at magnitude 6.2 on the 2026-09-29 12:30Z pass that ISS (ZARYA) called
**yes** at −0.5. The figure now goes by element set. An entry with the same epoch and the same six
elements as a station's, each to within one unit in its last printed digit, is that station: the
copies are close but not byte-identical (POISK and the three vehicles carry the ISS eccentricity as
0004952 against ZARYA's 0004953), and the revolution count is each object's own.

The comparison is made on the sets as they stand and again on the embedded snapshot, where every
set was fetched together. The second is what survives a live refresh, which replaces the set of the
spacecraft on screen and no other: a docked Dragon refreshed to this week's set no longer matches
the station's snapshot copy, because the two are of different days, not because it has left. The
cost is the opposite case. A vehicle that has undocked since the snapshot keeps the station's
figure, since telling a departure from a refresh would need a current copy of the station's set as
well, and the page fetches only the spacecraft on screen.

The assumption can be wrong by several magnitudes either way, which is why it is printed beside
every estimate — "std mag 5.0 assumed", "std mag −1.8, Heavens-Above", or for a docked entry
"std mag −1.8, Heavens-Above · docked to ISS (ZARYA)". KNACKSAT-2 is itself a CubeSat, several
magnitudes fainter than 5.0 and a binocular object at best, so its "yes" passes are optimistic, and
the label is the only thing on screen that says so.

What the estimate does get right is the dependence on range and phase, and that is what separates
the cases above. Over the week from 2026-09-15, as `verification/verify-optical.js` computes it:

| | Standard magnitude | Brightest estimate, lit against a dark sky | Verdicts |
|---|---|---|---|
| INTELSAT 36 | 5.0 assumed | **11.6** at 37,082 km | too faint on its one (window-long) pass |
| MERIDIAN 10 | 5.0 assumed | **8.6** at 7,567 km | too faint on all 7 |
| CLUSTER II-FM8 | 5.0 assumed | **7.0** at 3,399 km | too faint on the 9 lit ones |
| NOAA 15 | 5.0 assumed | **4.0** at 895 km | yes on 3, too faint on 6 |
| HST | 2.2 published | **1.0** at 888 km | yes on 10 of 53 |

The GEO verdict does not hang on the assumption: to reach +6 from 37,000 km INTELSAT 36 would need a
standard magnitude of −0.6, brighter than the Chinese station. MERIDIAN 10 and CLUSTER II-FM8 are
closer calls — they would need 2.4 and 4.0. NOAA 15 is the case a range term exists for: the same
spacecraft, yes on some passes and too faint on others.

Penumbra is reported on its own. A satellite in it is dimmed by an amount this does not model, so a
penumbral sample never counts towards yes, and its undimmed estimate is only a ceiling. That makes
four verdicts — **yes**, **penumbra only** (bright enough only while partly shadowed), **too faint**
and **radio only** — the same words on screen, in the CSV's `naked_eye` column and in the calendar
description. The estimate travels with them: a Brightness row on screen, an `est_magnitude` column,
and a calendar summary that ends "— naked eye (est. mag 3.1)" on yes passes and on no others.

+6 is the eye's limit under a genuinely dark sky. From a city, or in the civil twilight that the −6°
cut admits, the practical limit is two or three magnitudes brighter — so yes is the best case, and
the number is printed for a reader to hold against their own sky.

The row below the estimate gives the Sun's elevation and the spacecraft's illumination at mid-pass,
and is labelled **At mid-pass** to say so. It was "Sun at site", and read "spacecraft eclipsed"
directly under a yes whenever the lit stretch of the pass fell before or after its middle.

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

### When the object is no longer there

The catalogue is a snapshot, and some of what it holds has since come down. SGP4 meets such an
object in one of two ways, and the page used to handle neither.

- **SGP4 refuses it.** Once the drag terms put the orbit inside the Earth, SGP4 returns error 6
  ("decayed") for every instant and there is nothing to analyse. By late September 2026 that is
  fourteen catalogue entries — COSMOS 2558, ODIN and DUCHIFAT 1 among them, all three recorded as
  re-entered in the CelesTrak SATCAT — plus STARLINK-2342, whose elements SGP4 rejects outright
  (error 1). Picking one threw after the picker had already moved: the masthead, passes and globe
  stayed on the previous spacecraft under a picker naming the new one, and every later change of
  span or window threw again. The new analysis is now computed before anything on screen is
  touched. If it cannot be, the picker, window and span go back to what is still on screen, and a
  note under the picker gives SGP4's reason — "ODIN not loaded: SGP4 cannot propagate it anywhere
  in this window (error 6: decayed)". A window SGP4 cannot fill is refused the same way, playback
  that runs into one stops at its edge, and a default spacecraft that has itself come down falls
  back to the next in the preference list rather than opening a blank page. To make the reason
  available at all, the propagator keeps SGP4's error code (`track.lastError`) where it used to
  flatten it to `null`; the success path, and the `r` and `v` it hands through, are untouched.
- **SGP4 propagates it anyway.** Short of that point it goes on producing positions at 40 km,
  then at 20, and the page quoted passes, naked-eye verdicts and Doppler for them — ICEYE-X34,
  re-entered 14 September, showed a mean altitude of 42.7 km. The analysis now records how low the
  propagation goes, over the window's own samples and the densely-sampled first revolution from
  its start, and whether SGP4 raised error 6 on the way. Below the ~120 km entry interface, or at
  any error 6, the answer block says so above the minutes-in-view figure, and neither export will
  write the passes: once they are a spreadsheet row or a phone alarm, the warning is no longer
  beside them. The revolution matters on its own account. CLUSTER II-FM8 has a 53 h period, so a
  24 h window can hold nothing but apogee arcs from an object whose perigee is underground.

The live refresh has three answers of its own that are not a fresher set:

- **A newer set SGP4 cannot propagate is refused.** A source can serve a later set for an object
  that has since come down — the TLE API does for ICEYE-X34. Adopting it threw out of the reload
  with the entry already rewritten. The page now tries it, keeps the set that works if it fails,
  and says what the newer one showed.
- **CelesTrak's "No GP data found" is a withdrawal, not an outage.** CelesTrak answers for an
  object it no longer carries with a 404 and that text, and for something in this catalogue that
  nearly always means re-entry. It was treated as a failure and the mirror asked next, which,
  still serving the last set it had seen, turned CLUSTER II-FM8 (re-entered 1 September) into
  "Confirmed current". The page now says "CelesTrak has no current elements for this object — it
  may have re-entered", and does not ask the mirror.
- **The provenance line belongs to the spacecraft on screen.** It was one page-wide value that a
  change of spacecraft never reset, so it described whichever object had been checked last:
  GOES 18's embedded set read "Updated live from CelesTrak" because KNACKSAT-2's had been, and
  KNACKSAT-2's live set, revisited, read "No live source reachable" because GOES 18's check had
  failed. Each catalogue entry now carries its own result, and the line is read from the entry
  actually displayed.

These objects stay in the embedded catalogue for now. Dropping them belongs to the next rebuild;
doing it by hand would change the catalogue count the regression gate compares.
`verification/verify-catalogue.js` drives both SGP4 cases through the picker, the window and span
buttons, the transport and the export buttons, in a fixed window — which objects are decayed
depends on when you ask — and phases 6 to 8 of `verify-refresh.js` cover the three refresh answers.
The default's fallback is not in the suite: exercising it needs a doctored catalogue.

## Running it

**The pages need nothing.** No build, no server, no install — open them:

```
index.html   moon-track.html   moon.html
```

`index.html?tle=embedded` is the assignment snapshot: the embedded element sets, each window at
its set's epoch, which is how the README's figures are computed.

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
npm run report       # the LANDSAT 9 answer, printed as the page computes it
npm run evec         # element-vector geometry, across e = 0.00015 to 0.91
npm run refresh      # the live TLE refresh, against mocked sources, and the snapshot that pins it
npm run pov          # the POV camera, measured against the propagated state
npm run doppler      # range rate, against a numerical derivative of the range
npm run optical      # shadow cone geometry, brightness, and naked-eye passes
npm run site         # moving the observer, and that Bangkok stays the default
npm run export       # CSV and calendar, parsed back rather than eyeballed
npm run catalogue    # objects that have come down: refused, or flagged and kept out of exports
npm run timeline     # the window rolling forward past its end, and the next pass beyond it
npm run elements     # the element labels: no overlap, nothing clipped, hover expands one;
                     # nothing named or picked through the Earth
npm run lifetime     # the decay forecast's refusals, and what it says when it has no history
npm run layout       # phone, tablet and desktop: nothing over the globe's buttons, the layers
                     # toggle, captions, the header's links, an 11 px floor, the Terms section
npm run snapshot     # (re)write verification/baseline.json
npm run gate         # compare the live code against it — must print BIT-IDENTICAL
```

Every one of those blocks NASA's imagery service before loading the page, so the globe falls back
to its drawn coastlines. Two reasons: the timings some of them measure are wall-clock, and a
megabyte of JPEG fetched ten times a run is rude to a service that is free.

The lunar checks, and the globe imagery check, are kept **out** of `npm test`, because they fetch
from JPL Horizons and NASA GIBS and a clean run should not depend on someone else's uptime:

```
npm run moon         # rotation vs Horizons sub-observer point
npm run moon:chain   # baked elements -> sub-point, end to end
npm run moon:bake    # re-bake moon/moondata.js from Horizons
npm run globe        # the globe's NASA imagery: orientation, terminator, city lights, map size
```

`.github/workflows/verify.yml` runs the offline suite on every push, and again weekly — the
scheduled run is the useful one, since the embedded catalogue ages on its own and the pages pin
CDN versions of `satellite.js` and `three.js` that could be pulled.

Playwright is used for the browser-driven checks. The lunar scripts cache their Horizons responses
next to themselves, so a re-run is free.
