---
type: concept
title: "Naked-eye visibility and the magnitude estimate"
tags: [radio, orbital-mechanics, earth-console]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Naked-eye visibility and the magnitude estimate

**Naked-eye visibility** in the Earth console is a verdict on whether a pass could be seen by eye, as distinct from **radio visibility**, which is geometry alone. Every pass figure in the README is radio visibility: above a 5° mask, day or night (README.md#L3294). The page once stated the difference in a disclaimer; it now computes it (README.md#L3295).

## Three conditions

Seeing a pass needs the spacecraft lit, the observer in darkness, and the object bright enough (README.md#L3297-L3299). The first two pull against each other, which is why satellites are watched after dusk and before dawn (README.md#L3299-L3300). Example: [[knacksat-2]]'s two highest passes in the regression baseline's 72-hour window are both radio-only — the 68.1° pass at 18:12Z on 14 September with the spacecraft in eclipse, and the 50.1° pass at 07:20Z on 15 September with the Sun 55.8° up (README.md#L3300-L3303). Eclipse state comes from [[eclipse-shadow-cone]].

## Lit is not bright

The first version said "yes" whenever part of a pass was lit against a dark sky, which is mostly right at LEO and wrong further out: brightness falls by 5·log₁₀(range) magnitudes, so CLUSTER II-FM8 at 124,000 km, INTELSAT 36 at 37,000 km and MERIDIAN 10 at 12,000 km were wrongly called visible (README.md#L3307-L3311).

The verdict now rests on an estimated magnitude (README.md#L3313-L3320):

```
m = m_std + 5·log10(range / 1000 km) − 2.5·log10 F(φ)
F(φ) = (π − φ)·cos φ + sin φ
```

Here m_std is the standard magnitude — brightness at 1,000 km with half the face lit — and F is a diffusely reflecting sphere's phase function normalised to 1 at 90°, worth 1.24 magnitudes brighter face-on and zero backlit (README.md#L3313-L3320). φ is the phase angle at the spacecraft between observer and Sun; range and phase are taken in the body-fixed frame (README.md#L3323-L3324). **Yes** requires full sunlight, the Sun below −6° at the site, and magnitude +6 or brighter (README.md#L3324-L3325).

## The standard magnitude is the weak term

A TLE carries no size, so an object gets an assumed 5.0 unless a figure is published (README.md#L3327-L3329). Heavens-Above's "intrinsic brightness" uses the same convention and supplies the ISS (−1.8), HST (2.2) and the Chinese station (0.0) (README.md#L3329-L3331). The README notes the phase laws differ: Heavens-Above's maximum-brightness figures imply a 1.7–2.0 magnitude gain from half to full lit, against 1.24 here, so near full phase this estimate is about half a magnitude fainter (README.md#L3332-L3335).

Docked modules and vehicles keep their own NORAD numbers but share the station's element set. Looked up by number they got 5.0, so ISS (NAUKA) read "too faint" at 6.2 on a pass where ISS (ZARYA) read "yes" at −0.5 (README.md#L3337-L3343). The figure now goes by element set: an entry with the same epoch and six elements as a station's, each within one unit in its last printed digit, takes the station's magnitude (README.md#L3343-L3346). The comparison also runs on the embedded snapshot so a [[live-element-refresh]] of a docked vehicle does not break the match; the cost is that an undocked vehicle keeps the station's figure (README.md#L3348-L3354).

The assumption is printed beside every estimate, e.g. "std mag 5.0 assumed" or "std mag −1.8, Heavens-Above · docked to ISS (ZARYA)" (README.md#L3356-L3358). KNACKSAT-2 is a CubeSat several magnitudes fainter than 5.0, so its "yes" passes are optimistic and the label is the only thing that says so (README.md#L3358-L3360).

## Results

For the week from 2026-09-15, as `verify-optical.js` computes it (README.md#L3363-L3371):

| | Standard magnitude | Brightest estimate, lit against dark sky | Verdicts |
|---|---|---|---|
| INTELSAT 36 | 5.0 assumed | 11.6 at 37,082 km | too faint on its one pass |
| MERIDIAN 10 | 5.0 assumed | 8.6 at 7,567 km | too faint on all 7 |
| CLUSTER II-FM8 | 5.0 assumed | 7.0 at 3,399 km | too faint on the 9 lit ones |
| NOAA 15 | 5.0 assumed | 4.0 at 895 km | yes on 3, too faint on 6 |
| HST | 2.2 published | 1.0 at 888 km | yes on 10 of 53 |

The GEO verdict does not depend on the assumption: INTELSAT 36 would need a standard magnitude of −0.6 to reach +6 (README.md#L3373-L3374).

## Four verdicts

**yes**, **penumbra only**, **too faint** and **radio only** — the same words on screen, in the CSV's `naked_eye` column and in the calendar description (README.md#L3378-L3382). A penumbral sample never counts towards yes, since penumbral dimming is not modelled (README.md#L3378-L3380). The estimate appears as a Brightness row, an `est_magnitude` CSV column, and a calendar summary ending "— naked eye (est. mag 3.1)" on yes passes only (README.md#L3382-L3383). +6 is the dark-sky limit; from a city or in civil twilight the practical limit is two or three magnitudes brighter, so "yes" is a best case (README.md#L3385-L3387). The row below is labelled **At mid-pass**, replacing "Sun at site", which had read "spacecraft eclipsed" under a "yes" (README.md#L3389-L3391).

## Related

- [[eclipse-shadow-cone]] — the shadow model and the rail's *Sunlit or eclipsed now* block.
- [[pass-prediction]] — the radio-visibility passes the verdict is attached to.
- [[observer-value]] — the site whose Sun elevation is tested.
- [[ar-sky-view]] — looking for the spacecraft in the sky.
- [[readme-moon-data-and-radio]]
