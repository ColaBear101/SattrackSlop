---
type: concept
title: "Central-body seam (body vs. propagator)"
tags: [architecture, orbital-mechanics, moon]
sources: [readme-ar-and-architecture]
created: 2026-11-24
updated: 2026-11-24
---

# Central-body seam (body vs. propagator)

The **central-body seam** is the architectural split that makes the central body a parameter of the code rather than an assumption. The console was written for the Earth, and the Earth had "leaked into every layer": `RE` and `MU` at module scope in three files, every position routed through `satellite.gstime` → `eciToGeodetic`, and [[sgp4-propagation]] as the only propagator (README.md#L1768-L1770). The README stresses that none of this was wrong, only an assumption rather than a parameter; extending to the Moon meant turning it back into a choice (README.md#L1770-L1771).

## The two objects

The seam separates two objects with one job each (README.md#L1775):

- **Body** (`core/body.js`) — what is a property of the *central body*: where the prime meridian is now, the inertial-to-body-fixed transform, the sub-satellite point, look angles from a surface site, and the constants that used to be globals (README.md#L1782-L1784).
- **Propagator** (`core/propagator.js`) — what is a property of *how an object moves*, behind one interface: `track.at(ms) -> {r, v} | null`, body-centred inertial, in km and km/s (README.md#L1786-L1790).

## Where the files live

The Earth console runs the Earth halves as `src/lib/core/body.ts` and `src/lib/core/propagator.ts`, moved as they were (README.md#L1775-L1777). The classic scripts `public/core/body.js` and `public/core/propagator.js`, which also hold the Moon's halves, remain for `moon-track.html` (see [[lunar-track-console]]) (README.md#L1777-L1778). `tests/lib/core-equivalence.test.ts` holds the two copies of the Earth half to the same bits — on the constants, the frame maths and the track of every element set in the catalogue (README.md#L1778-L1780). This pairing of a typed copy with a held-identical original is the pattern described in [[verbatim-ports]].

## Why the seam sits exactly there

The README calls the split "forced by a hard fact rather than chosen for tidiness": SGP4 is defined only for Earth satellites described by TLEs, and there is no lunar analogue (README.md#L1792-L1793). The evidence it gives is [[celestrak]]'s own catalogue record for LRO (README.md#L1793-L1798): its period, inclination, apogee and perigee fields are blank; its `DATA_STATUS_CODE` is `NEA` (*No Elements Available*); its `ORBIT_CENTER` is `MO`, the Moon; and a request for its elements returns `No GP data found` (README.md#L1800-L1802). The README quotes CelesTrak's documentation that the SGP4 assumptions are completely invalid for other celestial bodies, and notes that the theory hard-wires Earth's μ, Earth's J2/J3/J4 and an Earth-fixed frame, while a [[tle-two-line-element-set]] has no field to say what it orbits (README.md#L1802-L1804).

Hence the propagation half "was never going to port", and the interface had to sit above it (README.md#L1806-L1807).

## By-products of the refactor

Three things fell out of the work (README.md#L1809-L1820):

1. **Four adapters became one.** `sampleMs`, `sample`, `elevationAt` and `stateAt` were the same three lines written four times, each calling `satellite.js` directly and closing over the observer; they now live in one place, `src/lib/analysis/engine.ts` (README.md#L1811-L1813).
2. **Two latent Earth gates.** `orbitviz` rejected any orbit with `a < RE*0.9`; a 1829 km lunar orbit fails that by a factor of three, and the whole element panel would have vanished without an error. It also carried a second hard-coded μ (README.md#L1814-L1816).
3. **The 3D scene needed little work.** `earth/orbit3d.js` (now `src/scene/orbit3d.ts`) already used one Earth *radius* as its scene unit rather than one kilometre, so its geometry literals — sphere 1, atmosphere 1.022, track 1.004, footprint 1.006 — were body-relative already and survived the swap untouched (README.md#L1817-L1820). See [[globe-scene]].

## How it was guarded

The refactor was checked by the [[regression-gate]]: 67,488 values compared bit-identical across `index.html`, `earth/orbit3d.js` and `earth/orbitviz.js` when the central body became a parameter (README.md#L1838-L1840). The only differences during the refactor were the observer gaining `name` and `tz` fields, which retired a duplicate `ICT` constant (README.md#L1860-L1862).

## Related

- [[sgp4-propagation]], [[tle-two-line-element-set]] — the Earth-only half.
- [[earth-moon-page]], [[lunar-track-console]] — the Moon pages that use the other halves.
- [[layer-dependency-rule]] — `src/lib/core` is part of the pure library layer.
