---
type: concept
title: "Doppler, range rate and the transmitter table"
tags: [radio, orbital-mechanics, data]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Doppler, range rate and the transmitter table

The Earth console computes the **range rate** of the spacecraft relative to the observer and from it the **Doppler shift** of the spacecraft's radio downlink (and of an uplink a station types in). The frequencies themselves come from a baked copy of SatNOGS DB's **transmitter table**, "the one thing that cannot be derived" (README.md#L3526). Range rate is described as what the pass table was missing (README.md#L3491).

## Range rate in the body-fixed frame

Range rate is taken in the body-fixed frame, the one frame where the ground station is at rest: the site is a constant vector, so the closing speed is a projection onto the line of sight (README.md#L3491-L3493).

The trap is that the spacecraft's body-fixed velocity is not the propagated velocity with its axes turned: the frame's rotation adds a transport term −ω × r, worth 0.452 km/s at Bangkok, or 0.65 kHz at 435 MHz (README.md#L3495-L3498). `omega` and `siteFixed` live on the body object, keeping this a property of the central body rather than an Earth assumption (README.md#L3499-L3500); see [[central-body-seam]].

## Checked against a numerical derivative

The range rate is compared with a numerical derivative of the range, which shares only the propagator. Worst disagreement is 3.1 cm/s over 401 samples; dropping the transport term breaks it by 0.439 km/s, 14,000× larger (README.md#L3502-L3504). See [[independent-reference-checks]].

**The floor.** A first threshold failed at 2.2e-4 km/s; a higher-order stencil and smaller steps made it worse, which identified quantisation rather than truncation (README.md#L3508-L3511). `satellite.js` carries time as a Julian date (~2.46×10⁶), where a double's ulp is 4.02×10⁻⁵ s, quantising position at 0.308 m at 7.66 km/s, so a differenced range carries ε/(2h) of noise (README.md#L3513-L3515). Predicted versus observed noise (README.md#L3517-L3521):

| h | predicted ε/(2h) | observed |
|---|---|---|
| 0.5 s | 3.08e-4 km/s | 3.2e-4 |
| 1 s | 1.54e-4 | 1.1e-4 |
| 8 s | 1.93e-5 | 1.6e-5 |

The step is chosen where this noise balances the stencil's truncation, and the script says so (README.md#L3523-L3524).

## The transmitter table

`data/transmitters.json` (formerly `earth/transmitters.js`) is baked from SatNOGS DB's transmitter endpoint in one 3.9 MB request rather than 2,158 per-object requests; it is a lazy chunk requested after the first answer is computed (README.md#L3528-L3533). Kept: active transmitters with a published downlink, deduplicated on frequency and mode, at most four per object, and only for catalogue objects (README.md#L3535-L3536).

| | (README.md#L3550-L3555) |
|---|---|
| Transmitters | 2,037 on 1,213 objects |
| Coverage | 56.2 % of the catalogue |
| Dropped | 183 not active, 2 with no downlink, 194 duplicate or over cap |
| Bands | 685 S-band, 398 UHF 420–450, 76 VHF 144–148, 878 other |

The other 43.8 % have no published downlink, normal for government and commercial objects; the panel says so rather than offering a plausible default, and the frequency box stays editable (README.md#L3557-L3559). [[knacksat-2]] has 145.825 MHz FSK 9k6 and 400.630 MHz telemetry; over its 68.1° pass at 18:12Z on 14 September these swing 6.77 kHz and 18.59 kHz (README.md#L3561-L3563). `node verification/tools/fetch-transmitters.js` re-bakes the table (README.md#L3565-L3567).

**Licence.** SatNOGS DB (a Libre Space Foundation project) publishes under CC BY-SA 4.0, and the cut-down table is an adaptation under the same licence; the footer credits it (README.md#L3538-L3548). See [[data-provenance]].

## Tuning while it is up

A live line under the downlink box (`#doplive`) gives the frequency a ground receiver hears at one instant, to the hertz, and its offset from the published figure — e.g. *Receive 145.827 627 MHz +2.627 kHz*; an **Uplink** box adds the frequency to transmit on — e.g. *Transmit 145.897 372 MHz −2.628 kHz* (README.md#L3614-L3619).

Both use only the range rate (`src/lib/analysis/tune.ts`) (README.md#L3621-L3622). Downlink is f(1 − ṙ/c), the engine's existing first-order law, so the line agrees with the Doppler rows at AOS, culmination and LOS; uplink is f / (1 − ṙ/c), which brings the signal to exactly f on board (README.md#L3622-L3625). The usual first-order uplink form f(1 + ṙ/c) falls short by f(ṙ/c)² — a quarter hertz at 435 MHz, 1.5 Hz at 2.4 GHz at 7.5 km/s (README.md#L3626-L3628). The hertz digit is exact arithmetic, not an exact orbit: near culmination the shift at 435 MHz moves over 100 Hz a second (README.md#L3628-L3631).

The line says **Tune now** only when the page clock runs at real time within 5 s of the wall clock; otherwise it says *Tune at sim time …* beside a **Go live** button, and adds *below the 5° mask* when appropriate (README.md#L3633-L3642). The uplink is held in memory per spacecraft, never stored or sent (README.md#L3646-L3647); see [[forget-data]].

## Checks

`npm run doppler` (`verify-doppler.js`) scrubs 30 % into a pass and recomputes the line's figures from the test surface's range rate, including a 145.900 MHz uplink that must return to 145.900 MHz on board; it counts engine `stateAt` calls to prove a paused line does no work, and checks Go live, focus and the per-spacecraft uplink (README.md#L3650-L3659). The old page has no such line, so on `GT_TARGET=legacy` only range-rate checks run (README.md#L3659-L3661). See [[test-facade]] and [[verification-harness]].

## Related

- [[satellite-aliases]] — other names from the same database.
- [[pass-prediction]]
- [[readme-moon-data-and-radio]]
