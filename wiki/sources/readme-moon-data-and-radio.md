---
type: source
title: "README — Moon pages, data provenance, observer, optics, radio, freshness and running it"
authors: ["SattrackSlop project"]
raw: "README.md#L2679-L4107"
snapshot: "4ce1719 + uncommitted working-tree edits (2026-11-24)"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [moon, data, radio, orbital-mechanics, earth-console, verification]
entities: [earth-moon-page, lunar-track-console, knacksat-2, celestrak, verification-harness, legacy-earth-console]
concepts: [libration-points, data-provenance, forget-data, observer-value, eclipse-shadow-cone, sunlit-visibility, doppler-and-transmitters, satellite-aliases, live-element-refresh, decayed-objects, assignment-snapshot-tle-embedded, regression-gate]
---

# README — Moon pages, data provenance, observer, optics, radio, freshness and running it

The final stretch of the project `README.md` (L2679 to the end of the file, L4107), a child of [[sattrackslop-readme]]. It covers the two Moon pages kept from the old project, where every embedded dataset comes from, the two export formats, the editable observer, the difference between radio and naked-eye visibility, Doppler and transmitter frequencies, the live element-set refresh and its handling of re-entered objects, and finally how to build, serve and test the project. The [[forget-data]] page also draws on README.md#L72-L88 and #L1137-L1174, outside this range, because the button it describes is only cross-referenced here.

## The Earth–Moon system page (L2679–L2806)

`public/moon.html` is a geocentric view of the Moon's orbit with the five Earth–Moon libration points moving with it (README.md#L2681-L2682). The Moon's position is a truncated ELP-2000/82B series, checked against JPL Horizons over 731 daily samples with a worst angular error of 9.5″ (README.md#L2690-L2700). L1–L3 are solved as roots of the circular restricted three-body quintic and L4/L5 placed in the instantaneous orbit plane; μ is taken from GM rather than masses (README.md#L2707-L2743). The section also records three scene defects found during verification, three factual corrections (Queqiao-2's orbit, the Earth–Moon instability timescale, L4/L5 stability), and two computed claims about the orbit's shape (README.md#L2745-L2798). See [[earth-moon-page]] and [[libration-points]].

## The lunar track console (L2808–L3035)

`public/moon-track.html` is the old Earth console's layout pointed at the Moon, not rebuilt with the Earth console (README.md#L2810-L2813). It grades five spacecraft as *tracked*, *published* or *schematic* (README.md#L2817-L2821), explains why there are no lunar TLEs (README.md#L2832-L2844), and replaces a single element set with daily osculating anchors baked from Horizons, with measured error growth per craft (README.md#L2846-L2875). It documents a 69.184 s TDB/UTC bake bug, the fit-versus-prediction boundary in each Horizons record, the 13-term libration series in the Moon's rotation model, a 3D body-fixed globe, engineering readouts in the lunar-equator frame, and the ME/PA frame question (README.md#L2877-L3035). See [[lunar-track-console]].

## Data provenance (L3037–L3107)

The embedded catalogue is 2,158 satellites in 319 KB, from SatNOGS DB (1,437) and CelesTrak groups (721), validated and de-duplicated, with epochs 2026-07-14 → 2026-09-14 (README.md#L3039-L3061). It also names the sources of the satellite-type table, the WMM2025 magnetic model, the NASA imagery for the realistic surface, and states that planner orbits are never added to the catalogue (README.md#L3067-L3107). See [[data-provenance]].

## Taking the answer away (L3109–L3192)

Two export formats are built in the browser and handed over as a Blob: a full-precision **CSV** of the pass table and an **iCalendar** file with one `VEVENT` per pass and a 10-minute alarm (README.md#L3111-L3120). A single selected pass can be written to its own calendar file, sharing the full file's `UID` scheme, and on a coarse-pointer device is offered to the share sheet before falling back to a download (README.md#L3122-L3145). Passes clipped by the window edge are flagged in both formats (`aos_clipped`, `los_clipped`, `X-GT-CLIPPED`) (README.md#L3147-L3153). Eight provenance columns close every CSV row so an export can be reproduced (README.md#L3155-L3168) — see [[data-provenance]]. Re-parsing the files found two bugs invisible on screen: a doubled `Z` in timestamps and line folding by characters instead of 75 octets (README.md#L3174-L3183); `verify-export.js` now parses both formats back, including a site name containing a comma and quotes (README.md#L3185-L3192).

## The observer is a value now (L3194–L3290)

The observing site, formerly fixed at Bangkok, is editable, persisted and has four entry routes: place search, Maidenhead grid square, device location and raw coordinates (README.md#L3196-L3261). The timezone is resolved per instant, and the regression baseline still pins Bangkok (README.md#L3211-L3213, L3265-L3276). See [[observer-value]].

## Radio visibility is not naked-eye visibility (L3292–L3487)

All pass figures in the README are radio visibility above a 5° mask (README.md#L3294). Naked-eye visibility adds lighting conditions and a magnitude estimate, with four verdicts (README.md#L3297-L3391); see [[sunlit-visibility]]. Earth's shadow is modelled as a cone with umbra and penumbra (README.md#L3393-L3409); see [[eclipse-shadow-cone]]. A NaN at the sub-solar point was found and clamped (README.md#L3411-L3421), one duplicated solar-position copy is kept on purpose (README.md#L3423-L3431), and a rail block reports sunlight state, range rate, speed and sub-satellite grid square at the clock's instant (README.md#L3433-L3487).

## Doppler, and where the frequency comes from (L3489–L3661)

Range rate is taken in the body-fixed frame with the transport term included, and checked against a numerical derivative whose noise floor is explained by Julian-date quantisation (README.md#L3491-L3524). Frequencies come from SatNOGS DB's transmitter table under CC BY-SA 4.0 (README.md#L3526-L3567); the same database supplies the picker's alternative names (README.md#L3569-L3610). A live "tune" line gives receive and transmit frequencies to the hertz (README.md#L3612-L3661). See [[doppler-and-transmitters]] and [[satellite-aliases]].

## Staying current (L3663–L3743)

On load, on each change of spacecraft and every three hours, the page fetches the current element set for the one object on screen, from an optional cache API, then CelesTrak, then a mirror, then the embedded snapshot (README.md#L3669-L3676). See [[live-element-refresh]].

## When the object is no longer there (L3745–L3868)

SGP4 either refuses a re-entered object (error 6, or error 1 for STARLINK-2342) or propagates it to impossible altitudes; the page now handles both, marks *decayed now* rows in the picker, and has three special refresh answers (README.md#L3747-L3842). The section ends with a long list of what `verify-catalogue.js` types into the picker (README.md#L3846-L3868). See [[decayed-objects]].

## Running it (L3870–L4104)

The Moon pages open from disk; the Earth console is a Svelte 5 + TypeScript app bundled by Vite 8 and must be served (README.md#L3872-L3880). A fresh clone needs `npm ci` and `npx playwright install chromium`, on Node `^20.19.0 || >=22.12.0`, with every dependency pinned exactly (README.md#L3886-L3894). `npm run dev`, `build`, `preview` and `serve` start the dev server, production build, preview and cache API (README.md#L3896-L3906). `?tle=embedded` gives the assignment snapshot from which the README's figures are computed (README.md#L3908-L3910; see [[assignment-snapshot-tle-embedded]]). `test:fast` and `test:all` run the checks through `verification/run.js`, which stops early only when the numbers move (README.md#L3912-L3931). The section lists every suite and what it checks (README.md#L3944-L4029), how to run a suite against the old page at the `legacy-earth-console` tag (README.md#L4037-L4050; see [[legacy-earth-console]]), the offline network profile the suites use (README.md#L4052-L4061), and that the lunar checks are kept out of `test:all` because they depend on JPL Horizons (README.md#L4082-L4090). No CI runs on the repository (README.md#L4092-L4099). The harness itself is described in [[verification-harness]]; the bit-identical comparison in [[regression-gate]].

## Where this fits

- [[earth-moon-page]] — the geocentric Earth–Moon view.
- [[lunar-track-console]] — the lunar ground-track console.
- [[libration-points]] — L1–L5 as the Moon page computes them.
- [[data-provenance]] — where the catalogue and other embedded data come from, and the CSV's provenance columns.
- [[forget-data]] — what the page stores and the button that removes it.
- [[observer-value]] — the editable observing site.
- [[sunlit-visibility]] — naked-eye verdicts and the magnitude estimate.
- [[eclipse-shadow-cone]] — the umbra/penumbra shadow model.
- [[doppler-and-transmitters]] — range rate, Doppler and the transmitter table.
- [[satellite-aliases]] — the picker's other names from SatNOGS DB.
- [[live-element-refresh]] — keeping the element set current.
- [[decayed-objects]] — handling objects that have re-entered.
- [[verification-harness]], [[regression-gate]], [[assignment-snapshot-tle-embedded]] — how the figures are checked.
- [[knacksat-2]], [[celestrak]], [[sgp4-propagation]], [[tle-two-line-element-set]], [[pass-prediction]] — the Earth-side objects and methods these sections build on.
