---
type: concept
title: "Elements-to-TLE conversion"
tags: [planner, orbital-mechanics, verification]
sources: [readme-decay-and-planner]
created: 2026-11-24
updated: 2026-11-24
---

# Elements-to-TLE conversion

**Elements-to-TLE conversion** is how the [[orbit-planner]] turns typed orbital elements into the two 69-character lines of a [[tle-two-line-element-set]], so that a designed orbit runs down the console's existing path ([[sgp4-propagation]], passes, exports) unchanged rather than as a second kind of object (README.md#L2206-L2208). As a differential test, KNACKSAT-2's own two lines sent down the custom path give bit-identical elements, passes and ground track (all 8,641 samples, 987,552 bytes of JSON compared) (README.md#L2208-L2209).

## Example output

The *Earth observation, sun-synchronous, 700 km* preset (LTAN 10:30, epoch 2026-10-01 12:00 UTC) writes (README.md#L2210-L2215):

```
1 O0001U          26274.50000000  .00000000  00000-0  53966-4 0    14
2 O0001  98.2130 167.7354 0000000   0.0000   0.0000 14.56987942    04
```

Fields the form does not supply are blanks and zeros, and the revolution number is printed as `n/a (planned)` (README.md#L2217-L2218). The catalogue number is a placeholder (`O0001`); see [[orbit-planner]].

## Mean, not osculating

The typed elements are SGP4 **mean** elements, so a real spacecraft's elements typed back in reproduce the orbit SGP4 draws for it; the *spacecraft on screen* starting point does this, working its B* back to an area over mass (README.md#L2218-L2221). An osculating element differs (6 km in `a` for KNACKSAT-2); no conversion is offered, so an osculating value typed as mean is wrong by that much (README.md#L2221-L2222). Altitudes in the form are mean altitudes, a(1∓e) − 6378.137 km, and can differ from the element card's by kilometres to tens of kilometres (README.md#L2193-L2196).

## The four traps

The README lists four traps, "each measured, each with a check that fails when it is stepped in" (README.md#L2222-L2223).

### 1. Kozai against Brouwer

The mean motion written into the TLE is a Kozai mean motion; SGP4 converts it to the Brouwer `a` the card prints (see [[brouwer-vs-kozai-mean-motion]]). Going from a typed `a` to the `n` to write needs the inverse, which has no closed form, so the planner iterates: five passes for the preset, at most seven over 60,000 valid orbits (README.md#L2225-L2228). Kepler's third law is not the inverse: for the preset it lands 2.9 km above the typed 7,078.137 km, and at 6,878.137 km it is 6.41 km low at i = 0 and 3.02 km high at i = 97.8 (README.md#L2228-L2230).

**Verified residual.** SGP4 hands back the typed `a` to the rounding of `n` (eight decimals, half-unit 5·10⁻⁹ rev/day): 1.5 mm for a low orbit, 0.14 m at geostationary, 37 m at 393,200 km. That bound plus 20 % is every round-trip check's tolerance; the worst measured was 0.83 of it over 5,000 random orbits, and the preset is 0.4 mm off (README.md#L2230-L2235).

### 2. Rounding order

A TLE holds e to 10⁻⁷ and i to 10⁻⁴°. These are rounded **first**, the inversion runs on the rounded values, and only then is `n` rounded. Rounding after the inversion sends 7,010 of 20,000 random low-Earth orbits outside the bound (worst 3.5 times) and changes one golden pair of lines in its own text (README.md#L2237-L2241).

### 3. Which radius, which rotation

WGS-72's 6378.135 km un-normalises `a`; WGS-84's 6378.137 km is the datum of every altitude. Each constant taken from SGP4 is compared bit for bit with `satellite.constants`. A repeating ground track needs `gstime`'s 360.98564736629 °/day rather than `BODY.omega`'s 360.985605, which would move the node after 233 revolutions from 7·10⁻⁵° to 7.5·10⁻⁴° (README.md#L2242-L2246).

### 4. SGP4 accepts anything

`satellite.js` validates nothing: garbage lines read back as error 0 and bad checksums are accepted. `Planner.verifyTLE` is the only guard: length, checksums, layout, every element read back through SGP4 within the quantum of what was typed, then SGP4 asked for the epoch and 400 samples over one period; the orbit is refused if the epoch or all 400 samples are refused (part of a revolution underground is only a warning). An orbit is kept only if both the page's own gate and `verifyTLE` pass (README.md#L2247-L2252). An orbit SGP4 cannot fly is refused with SGP4's own reason (README.md#L2200).

## Checks

In `verify-planner.js`: the TLE writer's checksum matches an independent regex checksum on all 4,316 catalogue lines; golden lines match to the character; 5,000 random valid orbits are accepted and read back by SGP4 within stated tolerances; `brouwerFromKozai` equals `satrec.a` on all 2,158 catalogue sets (worst 1.5·10⁻¹¹ km) (README.md#L2520-L2525). Forty-nine faults injected into the planner (no inversion, wrong rounding order, `BODY.omega`, a different `mu`, and others) each failed a check (README.md#L2536-L2539).

`satellite.js` is pinned at 6.0.1, and the behaviours above were measured on that version; a version bump must re-run `verify-planner.js` (README.md#L2674-L2676).

## Related

- [[drag-area-over-mass]] — how the B* field is chosen.
- [[orbit-planner]] — the feature this belongs to.
- [[readme-decay-and-planner]] — source summary.
