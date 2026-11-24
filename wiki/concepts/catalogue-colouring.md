---
type: concept
title: "Catalogue colouring"
tags: [globe, earth-console, data]
sources: [readme-globe-and-views]
created: 2026-11-24
updated: 2026-11-24
---

# Catalogue colouring

Catalogue colouring is the choice, under *Layers → Catalogue* on the [[globe-scene]], of how the dots of the other catalogued objects are coloured. There are four choices (ledger row L76 of the [[change-ledger]]): *One colour*, the default and the old page's look, and three classifications — *By orbit*, *By type* and *By purpose* (README.md#L810-L811). The figures below are for the page's catalogue of 2,158 objects (README.md#L820).

## One colour (default)

Every dot in the track's cyan, dimmed, exactly as the [[legacy-earth-console]] drew it (README.md#L811-L812). Choosing it puts every dot back to the old page's value; `verify-catcolour` holds that "to the bit", and the ab3d gate, which never chooses a colouring, sees none of the feature (README.md#L838-L840; see [[regression-gate]]).

## The three classifications

When a class colouring is chosen, each dot takes its class's colour, the key's "Rest of the catalogue" row becomes one row per class in the colour its dots rest in, and the hover name is followed by the class, "so no dot is known by its colour alone" (README.md#L812-L814).

### By orbit

Read from each object's own elements; the **first rule that fits** wins (README.md#L816-L820):

| Class | Rule as stated | Count |
|---|---|---|
| HEO | eccentricity 0.25 or more | 17 |
| GEO | period within 1.5 % of a sidereal day and inclination under 15° | 547 |
| IGSO | as GEO but inclined more | 23 |
| LEO | apogee under 2,000 km | 367 |
| SSO | a low orbit whose plane J2 turns with the mean Sun (0.9856° a day, ±0.1°) | 1,183 |
| MEO | higher, with a shorter period than GEO's | 18 |
| beyond GEO | a longer period than GEO's | 3 |

Counts: README.md#L820-L821. The counts sum to the 2,158. The README phrases LEO and SSO as one rule ("LEO, an apogee under 2,000 km, or SSO, a low orbit whose plane…"), so SSO is a subset of the low orbits split out (README.md#L818-L819).

### By type

SATCAT's object type: 2,132 payloads, 6 rocket bodies, 6 pieces of debris and one unknown; the 13 objects SatNOGS numbers itself, which SATCAT has no record of, are counted as unknown too (README.md#L822-L823).

### By purpose

What [[celestrak]]'s element-set lists say: communications, navigation, Earth observation and weather, science, crewed stations, military, amateur and education (README.md#L824-L826). CelesTrak files objects by list rather than by purpose, so an object on several lists takes the first in a fixed order, which the note under the choice gives (README.md#L826-L827). Half the catalogue, 1,091 objects, is on no list — mostly working, and launched since 2020 — and is shown as "other or unknown" in a dark grey the classes stand out against (README.md#L827-L829).

## Implementation and data

- Choosing a colouring fetches a lazy chunk of its own, `catcolour` (`src/components/stage/catcolour.ts` with `src/lib/catalogue/classify.ts`); By type and By purpose also fetch CelesTrak's table, `satcat` (README.md#L831-L833; see [[lazy-chunks-and-entry-budget]], [[data-provenance]]).
- Each class keeps the old dims (README.md#L833).
- Colours are chosen so the resting dots are well apart in OKLab to normal sight and under simulated protanopia and deuteranopia; `tests/lib/classify.test.ts` holds the figures (README.md#L833-L835).
- The old cyan is kept for the classes most dots fall in (SSO, payloads, Earth observation), so a colouring changes as few dots as it can (README.md#L835-L837).
- The selected spacecraft's dot stays orange (README.md#L837).
- The choice is remembered in `gt.catcolour`, written only when a colouring is chosen and removed again by One colour (README.md#L837-L838). It is one of the keys [[forget-data]] clears (README.md#L1147-L1148).

## On the flat map

The map draws the same dots in the same colouring since ledger row L86, each in its class's key swatch (`CatTint.css`, the `seenAs` colour), asking the colours' chunk itself so the colours are there with no globe; the map's key gains the classes' rows while the dots are drawn (CHANGES-FROM-LEGACY.md#L135).

## Related

- [[globe-scene]] — the key and the catalogue layer.
- [[tle-two-line-element-set]] — the elements the By orbit rules read.
