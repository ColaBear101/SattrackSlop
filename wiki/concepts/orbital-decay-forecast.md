---
type: concept
title: "Orbital decay forecast"
tags: [decay, orbital-mechanics, earth-console, verification]
sources: [readme-decay-and-planner]
created: 2026-11-24
updated: 2026-11-24
---

# Orbital decay forecast

The **orbital decay forecast** is the Earth console's estimate of when a spacecraft runs out of altitude and re-enters, called at 120 km mean altitude (README.md#L1950). For a catalogue spacecraft it is a drag model calibrated against the object's own history of mean element sets from [[celestrak]]; for an orbit designed in the [[orbit-planner]], which has no history, it is an assumed range from three uncalibrated runs and is never stated as a date (README.md#L2455-L2464). The worked example throughout is [[knacksat-2]].

## Input: the element-set history

The history comes from CelesTrak's `graph-orbit-data.php` page, whose embedded `plotData` string holds date, RAAN, inclination, argument of perigee, "SMA" and eccentricity for every element set CelesTrak has held; the "SMA" column is the mean altitude a − Rₑ, not the semi-major axis (README.md#L1879-L1882). The page keeps date, mean altitude and eccentricity, plus inclination and RAAN for the [[decay-comparison]] (README.md#L1882-L1884). Rows outside 80–400,000 km mean altitude are discarded as garbage (README.md#L1897-L1898).

The fetch is button-triggered rather than automatic because CelesTrak rebuilds the archive per request and response times ranged from 2 s to more than 90 s in the project's measurements; the page gives up at 75 s and caches a history for 12 hours (README.md#L1905-L1911, README.md#L1893-L1895). It tries its own cache API, `/api/history/<id>`, before CelesTrak directly (README.md#L1887-L1889).

## The model (catalogue spacecraft)

The README states the near-circular drag equation as

```
da/dt = -rho(h) * B * sqrt(mu*a),    B = Cd*A/m
```

(README.md#L1916-L1920). The **shape** of the density profile rho(h) comes from a piecewise-exponential atmosphere (US Standard 1976 + CIRA-72, Vallado Table 8-4); the **amplitude** and the ballistic coefficient B are calibrated from the object's history, so only the ratio rho(h)/rho(h_now) is taken from the table (README.md#L1922-L1926).

**The density scale cancels.** Multiplying rho by k divides the calibrated B by k and leaves the forecast unchanged, so an "uncertainty band" built by scaling density is exactly zero wide; an early version printed such a band (85 to 341 days) and the README calls it meaningless (README.md#L1928-L1931).

The README lists three implementation details that each changed the answer (README.md#L1933-L1948):

- **Integrate in altitude, not time** — a fixed time step overshoots during the final plunge; an altitude march is stable and lands on the threshold, with a floor guard against a floating-point infinite loop near the radius's ULP.
- **Calibrate exactly** — since time is inversely proportional to B, one integration at B = 1 and a divide reproduces the observed drop including its curvature; this cut the 30-day-out mean error from 108 days to 3 (README.md#L1940-L1944).
- **Fit the solar trend** — a second parameter, a log-linear density trend read from the object's own record. For KNACKSAT-2 it is −0.24 %/day, which the README links to solar cycle 25 being past maximum (README.md#L1945-L1948).

The page names two models, *fixed atmosphere* and *fitted trend*, with the fitted trend as the headline. The band between them on the chart is labelled as model disagreement, not as an uncertainty band (README.md#L1977-L1981).

The 120 km re-entry threshold barely matters: moving it to 100 or 150 km shifts a 170-day answer by 0.16 days (README.md#L1950-L1951).

## Accuracy: the backtest

The forecast was validated on objects that actually re-entered, with decay dates from the CelesTrak SATCAT, by truncating each history at a fixed lead time (README.md#L1955-L1957):

| Lead time | n | Median error | Half-IQR |
|---|---|---|---|
| 30 d | 21 | +12 d | 6 d |
| 60 d | 22 | +12 d | 8 d |
| 90 d | 23 | +5 d | 13 d |
| 120 d | 21 | −20 d | 11 d |
| 180 d | 20 | −63 d | 12 d |
| 270 d | 17 | −144 d | 5 d |
| 365 d | 17 | +56 d | 166 d |

(README.md#L1959-L1967). The README's reading: usable to about four months, months early beyond that, and not a forecast past a year (README.md#L1969-L1970). Where the bias has a direction (the 180- and 270-day rows) the page also states the month the median moves the date to, using the nearest row (README.md#L1971-L1975).

**Validation limitation.** All 24 objects re-entered between 28 Aug and 12 Sep 2026, so their errors are correlated by shared solar weather; the tight 270-day half-IQR is called an artefact, and the bias partly reflects one phase of one solar cycle (README.md#L1983-L1987). Running on full histories reproduces real decay dates to ±1 day, but the README excludes this from the table as it only confirms the endgame integration (README.md#L1989-L1992).

## Refusals

The estimator declines to give a date when (README.md#L1996-L2037):

- **Boosted** — sustained rises in the record (e.g. PROGRESS-MS 33, which climbed 271 → 420 km before a deorbit burn).
- **No measurable decay** — station-kept or too high for drag.
- **Too little history** — under about 25 element sets or 45 days.
- **Eccentric** — median eccentricity above 0.02 over the last 45 days. The model applies drag at mean altitude, but an eccentric orbit loses energy at perigee. The page instead reports perigee: under 120 km it says re-entering; above 1,000 km that drag is not what moves the orbit; in between that a circular-orbit date would answer the wrong question. It further distinguishes low-apogee orbits (below 5,000 km; drag brings apogee down first while perigee holds) from high-apogee ones, where lunar and solar perturbations move perigee — a split the README says is not sharp near the 63.4° critical inclination (README.md#L2002-L2030). Near-circular objects, KNACKSAT-2 included (e 0.0008), take the same path as before, "to the bit" (README.md#L2012-L2013).
- **A date already past** — CelesTrak stops publishing element sets once an object is down, so a record ending before its own forecast date reads **Probably re-entered**, with no accuracy claim (README.md#L2032-L2037).

## Planned orbits: an assumed band

For a planned orbit there is no history and the Decay section makes no request. It runs the page's own atmosphere three times using the [[drag-area-over-mass]] as typed: drag ×1, ×3 and ×⅓ (README.md#L2455-L2458). The README contrasts this explicitly with the calibrated case: there a density-scaled band is zero wide; here B is a guess, "so the band is the point" (README.md#L2460-L2462). The factor of 3 is an assumed range covering air density and the craft guess together; the README notes a solar cycle alone swings density at 400 km by about ten (README.md#L2458-L2460).

The output is a duration and a range after the epoch, never a calendar date (README.md#L2464-L2468). For the typical satellite (area over mass 0.0043, circular, 51.6°) (README.md#L2471-L2477):

| Height | Drag ×3 | Middle | Drag ×⅓ |
|---|---|---|---|
| 300 km | 14 days | 41 days | 4.0 months |
| 400 km | 3.6 months | 10.7 months | 2.7 years |
| 500 km | 1.8 years | 5.4 years | 16.2 years |
| 600 km | 9.2 years | 27.5 years | 82.5 years |
| 700 km | 40.7 years | more than a century | more than a century |

The circular model (`Lifetime.integrate`, e under 0.002) hands over to an orbit-averaged perigee march for 0.002 ≤ e ≤ 0.3 with apogee up to 5,000 km and perigee 120–1,000 km; the two agree within 1 % at the boundary (README.md#L2479-L2482). Outside that domain the section gives no estimate and says why: period ≥ 225 minutes, perigee above 1,000 km, apogee past 5,000 km or e above 0.3, perigee under 120 km (*Re-entering*), or zero area over mass (*No drag*) (README.md#L2482-L2486).

The globe's SGP4 propagation and this model agree on the decay rate at the epoch but then diverge; see [[drag-area-over-mass]] for the comparison tables. The README lists among its limits that the lifetime is "an assumed band, not a forecast", with no solar-cycle model (README.md#L2631-L2637).

## Related

- [[decay-comparison]] — several spacecraft's forecasts on one chart.
- [[knacksat-2]] — the worked example.
- [[sgp4-propagation]] — the independent B*-based check and the globe's own decay.
- [[decayed-objects]] — how the console handles objects that are already down.
- [[readme-decay-and-planner]] — source summary.
