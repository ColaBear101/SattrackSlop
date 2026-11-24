---
type: concept
title: "Data provenance"
tags: [data, earth-console]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Data provenance

**Data provenance** in SattrackSlop is the record of where each embedded dataset came from, when it was fetched, under what licence, and how an exported answer can be traced back to its inputs. The README's *Data provenance* section names the source of the catalogue, the satellite-type table, the magnetic model and the imagery (README.md#L3037-L3107); the CSV export carries per-row provenance columns (README.md#L3155-L3168).

## The embedded catalogue

`data/catalogue.txt` is a file of the page's own, fetched when the page opens, with `data/catalogue.meta.json` recording when and from what it was built; it holds 2,158 satellites in 319 KB (README.md#L3039-L3041). Its two sources:

1. **SatNOGS DB** (`db.satnogs.org/api/tle/?format=json`, anonymous): 1,437 satellites, including [[knacksat-2]], whose own `tle_source` SatNOGS records as Space-Track.org. These sets are under CC BY-SA 4.0 and credited in the footer (README.md#L3043-L3047).
2. **[[celestrak]] groups** (geo, resource, weather, science, military, stations): 721 satellites, fetched via a GitHub Actions mirror because celestrak.org was timing out from the build machine at the time (README.md#L3048-L3051). Starlink and OneWeb groups were left out to avoid swamping the picker, but seven of their spacecraft arrived through the SatNOGS list; removing them is deferred to the next rebuild because it would change the count the [[regression-gate]] compares (README.md#L3051-L3057).

Every block was validated before embedding: 69-character lines, matching NORAD IDs across lines 1 and 2, correct mod-10 checksums, and no epoch older than 60 days. 202 duplicates were resolved by keeping the most recent epoch and 211 stale objects dropped; epochs span 2026-07-14 → 2026-09-14 (README.md#L3059-L3061). See [[tle-two-line-element-set]].

Space-Track.org requires an account, so it is not queried at build time; SatNOGS is used as its practical republisher (README.md#L3063-L3065).

## Other embedded data

- **Object type and purpose** (`data/satcat.json`) is made by `verification/tools/fetch-satcat.js` from CelesTrak's SATCAT and 34 element-set lists as of 2026-11-20: one letter of type and one of purpose per object, 4,479 bytes, plus the sum of the catalogue numbers of the catalogue it was made for, so a table built for a different catalogue is not read (README.md#L3067-L3077). It feeds [[catalogue-colouring]].
- **The magnetic model** is WMM2025 (NOAA NCEI and BGS; epoch 2025.0, degree and order 12, valid to 2030.0, public domain), stored verbatim as `data/WMM.COF` and checked against NOAA's own test values (README.md#L3079-L3087). See [[magnetic-declination-wmm]].
- **Realistic-surface maps** are NASA's: Blue Marble Next Generation, Blue Marble clouds, Black Marble 2016, GEBCO_08 topography, Deep Star Maps 2020 and the CGI Moon Kit colour map, each named under the surface's choice (README.md#L3089-L3100). See [[realistic-globe]].
- **Transmitters and alternative names** come from SatNOGS DB; see [[doppler-and-transmitters]] and [[satellite-aliases]].

## What is not in the catalogue

An orbit designed in the [[orbit-planner]] is built in the page and never added to the 2,158: the catalogue count, the gate and the 3D cloud do not see it, nothing is requested for it, and its synthetic element set is numbered `O0001` upward so it cannot be mistaken for a real object (README.md#L3102-L3107).

## Licence

SatNOGS DB data is CC BY-SA 4.0. The transmitter table, the 1,437 SatNOGS element sets and the alias table are treated as adaptations under the same licence; the footer credits *SatNOGS DB (element sets, transmitters, alternative names), CC BY-SA 4.0* (README.md#L3538-L3548). The share-alike reaches that data, not the project's code, which is unlicensed for reuse (README.md#L3547-L3548).

## Provenance in exports

The CSV export once carried only a date in its filename, so two exports an hour apart could not be reproduced or cited (README.md#L3155-L3157). Eight columns now close every row, repeated on each so they survive sorting and filtering (README.md#L3158-L3161):

`tle_epoch_utc`, `tle_line1`, `tle_line2`, `tle_source`, `window_start_utc`, `window_span_h`, `mask_deg`, `site_alt_km`.

`tle_source` reads `embedded` for the built-in snapshot, plus the source that last confirmed it or the source and time of a newer fetched set; when the last check found no current set at CelesTrak, or a newer set SGP4 cannot propagate, that is appended (README.md#L3161-L3165). `verify-export.js` moves the observer away, re-applies the site from the file's columns, re-propagates the file's two lines over its window and must get the same AOS, LOS and peak elevation (README.md#L3166-L3168).

On screen, the provenance line under the element set states which set is showing and when it was checked; see [[live-element-refresh]].

## Related

- [[assignment-snapshot-tle-embedded]] — the snapshot mode the README's figures are computed in.
- [[forget-data]] — what the page itself stores in the browser.
- [[readme-moon-data-and-radio]]
