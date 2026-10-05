# Changes from the pre-rewrite Earth console

The rewrite keeps every computed number identical (`npm run gate` must print BIT-IDENTICAL) and otherwise changes
only what is listed here. If something differs from the old page and is not on this list, it is a bug.

Status: **applied** = in the code now, **planned** = decided in the plan, not yet made.

## Behaviour and data

| | Change | Why | Status |
|---|---|---|---|
| 1 | Transmitter lookup uses the NORAD id as a number. The old page passed the zero-padded id (`"01804"`) to a table keyed `1804`, so the 20 satellites with NORAD < 10000 that have a downlink never showed one. | Verified bug; the data was always there. | planned (with the Doppler work, M4) |
| 2 | One Sun model. The old code carried four; the 3D light omitted the `-4e-7·n` obliquity-rate term (about 0.004°). | The scene light moves by a hair; tests bound it. | planned (M6) |
| 3 | The 2012 city-lights mosaic is baked into the shipped imagery like the Blue Marble, so the default globe never waits on NASA GIBS. Only the dated "yesterday's clouds" layer is still fetched. | The default surface blocked on a 3-8 s request. | planned (M6) |
| 4 | `file://` opening is dropped for the Earth console (ES modules and workers need an origin). The Moon pages still open from disk. | Consequence of a bundled app. | applied |
| 5 | The page makes no request to Google Fonts, cdnjs or any CDN. satellite.js 6.0.1 and three r128 are bundled from npm at exact versions. | Speed, privacy, no third-party blocking. | applied |
| 6 | `?tle=embedded` is unchanged and still fully offline. | Reproduces the README figures (KNACKSAT-2: 899.7 s over 2 passes). | applied |

## Verification

| | Change | Why |
|---|---|---|
| A | The suites open the page over http through `verification/lib/harness.js` instead of `file://`, and answer the two cdnjs scripts from local copies whose sha512 matches the page's pins. | A bundled app cannot load from disk; a clean run no longer depends on cdnjs. |
| B | `regress.js` / `snapshot.js` run in-process. `baseline.json` can only be rewritten with `GT_TARGET=legacy` and `--write-baseline`. | The old `.replace()` on snapshot's source silently overwrote the baseline if its `OUT` line was reformatted. |
| C | `gate:lib` runs the bundled library in a blank **Chromium** page, not in Node. | The baseline was made in Chromium; the same bundle in Node 23.5 differs in 364 values by up to 1e-14 (V8 `Math` differences). In Chromium it is BIT-IDENTICAL. |
| D | `verify-planner` V15 ("the four drag functions throw when Lifetime is absent") is skipped, out loud, for the module build. | "Lifetime absent" is a state of the classic globals only; an import cannot be absent. The caller's failed dynamic import is covered by the browser suites. |
| E | `verify-advisor` / `advisor-copy-checks`: the "is an IIFE over (window or globalThis)" and "attaches to window" checks are skipped, out loud, for the module build; the purity scan and "Professor appears once" now scan the verbatim TypeScript source. The bare-context load is replaced by "it imports nothing". | An ES module is already strict and scoped; the substantive invariants (no DOM, clock, storage; one definition of the label; the words stand alone) are kept. |
| F | `verify.js` CHECK 5 is split: 5a pins the Earth console by exact version + lockfile tarball hash (and `tests/lib/satellite-parity.test.ts` proves the npm ES build equals the vendored UMD bit for bit); 5b keeps the Moon pages' three.js SRI, checked against npm's file. | The new build has no CDN tag to pin. |
| G | `npm test` is replaced by `verification/run.js`: fail fast only on the numbers, then run every other stage and print one table. | The `&&` chain hid every stage after the first failure. |
| H | Known and unchanged: `verify-ar` fails two date-dependent checks on days when the highest pass is near the zenith. Fixed in M8 with a fixed clock and a pass of 20-60 degrees. | Pre-existing; not caused by the rewrite. |
