---
type: concept
title: "Regression gate (bit-identical)"
tags: [verification, architecture]
sources: [readme-ar-and-architecture, claude-md-project-instructions]
created: 2026-11-24
updated: 2026-11-24
---

# Regression gate (bit-identical)

The **regression gate** is the check that the computed numbers of the Earth console have not moved: `npm run gate` builds the production bundle, measures it in a real browser, compares the result with `verification/gate/baseline.json` using `===`, and prints `BIT-IDENTICAL` (README.md#L1840-L1841). The project's instructions call this **the one rule**: the computed numbers must not move, and if the gate moves, the code is wrong (CLAUDE.md#L5-L7).

## Why a diff, not an opinion

The README frames a refactor's honest self-assessment as a diff rather than an opinion, because the errors the code has actually had were invisible (README.md#L1824-L1825). Two examples: the Kozai semi-major-axis error was 512 m (see [[brouwer-vs-kozai-mean-motion]]), and the culmination bug hit 15 satellites out of 309 (README.md#L1825-L1826). Neither would show in a screenshot and both would pass a "looks the same to me" (README.md#L1826-L1827).

## What it measures

`verification/gate/snapshot.js` drives the **real page in a browser**, not a re-implementation — since the rebuild, the production bundle from `npm run build`, served over http (README.md#L1829-L1830). It reads full-precision values through the `window.__gt` test surface rather than scraping rounded text; the surface is `src/testing/surface.ts`, a lazy chunk fetched only when `window.__GT_TEST__` is set before load, so no visitor's bundle contains it (README.md#L1831-L1833; see [[test-facade]]).

The sample is 38 satellites spanning LEO, sun-synchronous, GEO, HEO and a decaying object, at two window spans. For each: all six elements and every derived quantity, every AOS/LOS to the millisecond, culmination, azimuths, range, visibility totals, and 100 fixed sample probes (README.md#L1833-L1836). See [[pass-prediction]].

The total is **67,488 values, bit-identical** — across `index.html`, `earth/orbit3d.js` and `earth/orbitviz.js` when the central body became a parameter ([[central-body-seam]]), and again, against the same baseline, across the rebuilt console (README.md#L1838-L1840). CLAUDE.md gives the same count (CLAUDE.md#L7).

## Library variant, and why Chromium

`npm run gate:lib` takes the same measurements of the library bundle alone in a blank Chromium page, with no app and no server, in seconds (README.md#L1842-L1843). It uses Chromium rather than Node because the baseline was made in Chromium: the same bundle in Node 23.5 differs in 364 values by up to 1e-14, V8's `Math` functions differing in the last bits, whereas in Chromium it is bit-identical (README.md#L1843-L1845).

## Reproducibility rules

Two rules, each "learned by getting them wrong first" (README.md#L1847):

- The window start is a fixed instant, never `Date.now()` (README.md#L1847-L1848).
- The network is blocked during a run, because the live element-set refresh (`refreshTLE()` on the old page) would otherwise rewrite the element set mid-snapshot, making the baseline depend on what [[celestrak]] served that minute (README.md#L1848-L1850). See [[live-element-refresh]].

## Who may write the baseline

The baseline is the old page's answer and is written only from the old page: `snapshot.js --write-baseline` refuses unless `GT_TARGET=legacy` is set (README.md#L1852-L1853). The old page is the git tag `legacy-earth-console` — `main` at `4eadd7a`, the last commit before the rebuild — checked out with `git worktree add legacy legacy-earth-console` (README.md#L1853-L1855; see [[legacy-earth-console]]). `regress.js` measures and compares in memory, so a failing run cannot overwrite the baseline it is judged against (README.md#L1855-L1856).

CLAUDE.md extends the prohibition: never use `--tol`, and never regenerate `baseline.json`, `verification/gate/golden.json` or the `verification/gate/ab3d/` references from the new code; they are written from the old page only (CLAUDE.md#L7).

## Proving the gate can fail

"A gate that has never failed is not a gate", so it was tested against a deliberate fault: perturbing Earth's radius by 10 cm produced 77 differences, down to 1.5e-9 relative in derived quantities such as the access half-angle (README.md#L1858-L1860). The only differences during the actual central-body refactor were the observer gaining `name` and `tz` fields (retiring a duplicate `ICT` constant), and the baseline was re-taken only after confirming no numeric value had moved (README.md#L1860-L1862).

This re-take can look at odds with CLAUDE.md's ban on regenerating the baseline. The README places it during the central-body refactor, whose files (`index.html`, `earth/orbit3d.js`, `earth/orbitviz.js`) are the old page's (README.md#L1838-L1840), so it reads as a baseline still taken from the old page; this is an inference, as the README does not date the re-take. The current rule is that the baseline is only ever written with `GT_TARGET=legacy` (README.md#L1852-L1853, README.md#L1867).

## Commands

```
npm run gate        # build the production bundle, measure it, assert bit-identical
npm run gate:lib    # the same measurements of the library bundle alone, in a blank Chromium page
GT_TARGET=legacy node verification/gate/snapshot.js --write-baseline    # only ever from the old page
```

(README.md#L1864-L1868)

## Related

- [[verification-harness]] — `run.js` and the other suites.
- [[change-ledger]] — intentional differences from the old page live there, not in the gate.
- [[project-working-rules]] — the other rules in CLAUDE.md.
- [[independent-reference-checks]] — checks against references other than the old page.
