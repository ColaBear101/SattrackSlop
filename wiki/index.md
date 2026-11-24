# Wiki Index

The catalog of all pages in this wiki about **SattrackSlop** (the Ground Track Console and its two Moon pages). Each entry is a wikilink and a one-line summary. Read this first, then open only the pages you need. Conventions: `SCHEMA.md`. History: `log.md`.

Keep summaries to one line. When this file passes ~300 lines or the wiki passes ~150 pages, shard it into `wiki/indexes/<type>.md`.

**Start here:** [[sattrackslop-readme]] (map of the README) · [[claude-md-project-instructions]] (rules for changing code) · [[regression-gate]] (the one rule).

---

## Sources

- [[sattrackslop-readme]] — Parent page for README.md: front matter summary and line-range map to the five section pages.
- [[readme-overview-and-assignment]] — README L1–694: front page, assignment, KNACKSAT-2, parts (a)–(c), how Earth numbers are checked.
- [[readme-globe-and-views]] — README L695–1190: cameras/POV, globe legibility, catalogue colouring, realistic globe, close-up, attitude, models, layout.
- [[readme-ar-and-architecture]] — README L1191–1869: AR sky view, declination, radar, snap; central-body seam; the gate.
- [[readme-decay-and-planner]] — README L1870–2678: decay history, model, backtest, refusals, comparison, planner, Professor, checks.
- [[readme-moon-data-and-radio]] — README L2679–4106: Moon pages, provenance, exports, observer, optics, Doppler, refresh, decayed objects, running it.
- [[changes-from-legacy]] — The ledger: three tables, row ids vs file lines, themed map of rows 1–11, A–X, L1–L85.
- [[claude-md-project-instructions]] — CLAUDE.md: the one rule, layout, commands, working rules, each linked to concept pages.
- [[llm-wiki-idea-file]] — The LLM Wiki pattern this wiki follows, and how it is adapted here.

## Entities

- [[knacksat-2]] — Thai CubeSat (NORAD 67683) from the ISS; the default spacecraft and the assignment's element set.
- [[celestrak]] — External element-set and decay-history source, asked after the cache API; satcat for colouring.
- [[orbit-planner]] — Design-your-own-orbit feature: form, placeholder O-numbers, saved orbits, exports, verification, limits.
- [[the-professor]] — Advice panel on planned orbits: advisor numbers plus words, severity scale, certainty ladder, fixes.
- [[earth-moon-page]] — public/moon.html: ELP-2000/82B Moon vs Horizons, libration points, scene defects, corrected facts.
- [[lunar-track-console]] — public/moon-track.html: lunar spacecraft from daily Horizons anchors, libration rotation, body-fixed globe.
- [[legacy-earth-console]] — The old static page: git tag `legacy-earth-console`, the oracle every check compares with.
- [[verification-harness]] — `verification/` layout, run.js, harness helpers, GT_TARGET/GT_DIST, mutation maps, timing constraints.

## Concepts

### Orbit maths and passes
- [[tle-two-line-element-set]] — TLE format, line-2 column map, mean not osculating, where the project's TLEs come from.
- [[sgp4-propagation]] — satellite.js SGP4 on WGS-72/Brouwer, TEME→ECEF, and figures measured from propagation.
- [[brouwer-vs-kozai-mean-motion]] — Why the shown a (6741.908 km) differs from naive Kepler (6741.396 km), strictly per README.
- [[ground-track]] — 24 h / 10 s track, TEME→ECEF→WGS-84, latitude band, inclination card, deep-space drift.
- [[pass-prediction]] — 4 s scan + 1 ms bisection, 899.7 s over 2 passes, window edges, local-day grouping, sky plot.
- [[central-body-seam]] — Body/propagator split behind track.at(ms), because SGP4 has no lunar analogue.
- [[observer-value]] — Editable observer: getter not held object, Bangkok default, four entry routes, per-instant timezone.

### Visibility, light and radio
- [[sunlit-visibility]] — Radio vs naked-eye visibility: magnitude estimate, standard magnitudes, four verdicts.
- [[eclipse-shadow-cone]] — Umbra/penumbra cone vs cylinder, measured geometry, "sunlit or eclipsed now" block.
- [[doppler-and-transmitters]] — Body-fixed range rate, Julian-date noise floor, SatNOGS transmitter table, live tune line.

### Decay and the planner
- [[orbital-decay-forecast]] — History-calibrated drag forecast, backtest table and its limits, refusals, planned-orbit band.
- [[decay-comparison]] — Compare-with-other-spacecraft panel: list rules, chart options, request discipline, persistence.
- [[decayed-objects]] — Re-entered objects: SGP4 error 6/1, sub-120 km propagation, "decayed now" picker mark.
- [[elements-to-tle-conversion]] — How typed mean elements become a TLE; four measured traps.
- [[drag-area-over-mass]] — Area-over-mass input with Cd 2.2, presets, height-dependent matched B*, lifetime tables.

### Globe and views
- [[globe-scene]] — Camera positions, on-board POV view, colour key, label occlusion, texture ladder, plain start.
- [[catalogue-colouring]] — One colour / by orbit / by type / by purpose dot colourings, class rules, colour-blind-safe palette.
- [[realistic-globe]] — Opt-in Blue Marble, clouds and scattering with GIBS close-up tiles and full sky.
- [[close-up-camera]] — Metres-away LVLH view of a spacecraft model; bundled models; reproducible KNACKSAT-2 build.
- [[spacecraft-attitude]] — "How it flies": pointing modes, yaw/pitch/roll signs, spin rates, clock tie.
- [[reader-uploaded-models]] — Reader-supplied .glb/.gltf: validation, IndexedDB-only storage, removal and Forget.
- [[page-navigation-and-accessibility]] — Responsive layout, skip links, Layers popover, phone layout, 11 px floor, Terms.

### AR (sky through the phone)
- [[ar-sky-view]] — Camera sky overlay: permissions, orientation maths, iPhone north-finding, lens, costs, AR suite.
- [[magnetic-declination-wmm]] — Magnetic to true heading with WMM2025, NOAA checks, expiry and pole limits.
- [[ar-radar]] — Corner radar plot, the camera-less radar view, the camera/head Aim switch.
- [[ar-snap]] — One-press image with caption; share or download; privacy statement; ar-snap suite.

### Data, privacy and freshness
- [[data-provenance]] — Catalogue sources (SatNOGS + CelesTrak), validation, satcat/WMM/imagery origins, licences.
- [[live-element-refresh]] — Per-object TLE fetch every 3 h: cache API → CelesTrak → mirror → embedded; circuit breaker.
- [[assignment-snapshot-tle-embedded]] — `?tle=embedded`: shipped sets, epoch windows, no requests, planner off.
- [[satellite-aliases]] — data/aliases.json: 712 other names for 494 objects from SatNOGS, filtering, lazy loading.
- [[forget-data]] — "Forget what this page stored": what is stored, two-press flow, limits, tests.

### Moon
- [[libration-points]] — L1–L5 via the CR3BP quintic, μ from GM, Earth–Moon instability timescales, L4/L5 caveats.

### Verification and process
- [[regression-gate]] — `npm run gate`: 67,488 values compared with ===; baseline only from the old page.
- [[independent-reference-checks]] — Second-implementation cross-checks (1e-12, 2.7e-16, brute force) and SGP4 byte pinning.
- [[change-ledger]] — How the ledger works: unlisted difference = bug, row series, status words, same-commit rule.
- [[project-working-rules]] — The one rule plus the hard-learned working rules, with ledger evidence.
- [[test-facade]] — `window.__gt` via `__GT_TEST__`: eager boot, old defaults, what the visitor suite can't see.

### Architecture
- [[layer-dependency-rule]] — lib ← state ← components, `check:deps`, pure `src/lib`, text as data.
- [[lazy-chunks-and-entry-budget]] — Chunk/trigger table, import rule, 92 KB entry budget, 327.9 kB first-screen ceiling.
- [[verbatim-ports]] — Ported files keep arithmetic order; CHANGED (Lnn) markers; moon.ts copy.

## Synthesis

(none yet — file good query answers here)

## Open flags from the first ingest

Possible inconsistencies the writers found in the sources. They are recorded on the pages named here and are unresolved:
- KNACKSAT-2 SGP4 B* date (2027-06-09) vs trend date (2027-04-16), described as "within a day" (README.md#L2145-L2149) → [[knacksat-2]], [[readme-decay-and-planner]].
- Ledger row Q says the 90 KB entry budget is "not asserted"; rows L55/L72 and CLAUDE.md say it binds at 92 KB → [[lazy-chunks-and-entry-budget]].
- Baseline write flag: `--write-baseline` (ledger row B) vs `--write` (CLAUDE.md) → [[regression-gate]].
- "Stable to 10 milliarcseconds" for a time total (README.md#L672) → [[readme-overview-and-assignment]].
- PA–ME frame offset ~875 m vs "the 860 m" (README.md#L3027-L3029) → [[lunar-track-console]].
- README says the technical README is "about 3,600 lines"; it runs ~4,000 (README.md#L107) → [[readme-overview-and-assignment]].
