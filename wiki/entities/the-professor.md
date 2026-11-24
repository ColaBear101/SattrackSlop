---
type: entity
kind: tool
title: "The Professor"
tags: [planner, earth-console, verification]
sources: [readme-decay-and-planner]
created: 2026-11-24
updated: 2026-11-24
---

# The Professor

**The Professor** (on-screen label *Professor's notes*) is an advice panel in the [[orbit-planner]]'s drawer. It says what kind of orbit the typed elements describe, whether it will survive, what the Sun does to it, what it does over the observer and what to watch out for, using figures worked out from the elements, with one-click fixes that change the form and nothing else (README.md#L2160-L2163). It also annotates catalogue spacecraft on the globe.

## Architecture: numbers and words

Two layers share one contract (README.md#L2340-L2350):

- **`src/lib/planner/advisor.ts`** computes a flat dictionary of figures (144 keys, e.g. `h_mean`, `period`, `sso_inc`, `life_mid`). Its rates are SGP4's own secular terms rather than first-order J2, which the README says would put the sun-synchronous inclination 0.024° low (97.4019° vs SGP4's 97.4260° at 500 km) and slide local time by about 4.65 minutes a year. Its Sun is the page's own, so eclipse and beta angle match the globe's shading.
- **`src/lib/planner/advisor-copy.ts`** holds 87 records, each a condition on the dictionary, a title, a body, a basis line and optional buttons. Sixty-seven are advice in five groups — *What kind of orbit is this?* (21), *Will it survive?* (15), *Sun and eclipse* (7), *Ground track and* the observer site (12), *Caveats* (12) — and twenty are input messages. Templates contain no logic, and an item whose figure has no value is dropped rather than printed with `NaN`.

## Severity scale

Each item carries one of five words with a distinct glyph and coloured border, so the scale reads in greyscale and aloud: **Good**, **Note**, **Check**, **Problem**, **Fix this** (a Problem on an input, which blocks Add) (README.md#L2352-L2355). The heading counts only Checks, Problems and Fix-thises; eight of the 67 advice items are Goods, so the panel says what is right as well as what is wrong (README.md#L2355-L2357).

## Ladder of certainty

The wording follows a convention (README.md#L2359-L2362):

- *Is* — computed here from these numbers.
- *About* / *roughly* — a closed form, rounded.
- *Usually* / *often* — convention.
- *Between X and Y* — a range; the only way a lifetime is ever written.
- *This page does not model* — a stated limit.
- A bold figure is always a number worked out from the elements or the page's own run.

The ladder itself is not machine-checked (README.md#L2362-L2364). What is checked on every rendered item is the voice: title at most 48 characters, body at most 70 words, no sentence past 32 words, fifteen banned words (such as "obviously", "just", "guarantee"), no contractions, no "I" or "we", no `NaN`, and bold figures must be numbers. The observer is always the `{site}` placeholder, never a literal Bangkok (README.md#L2364-L2368).

## Fixes

Twenty-six buttons sit on twenty-two items. A button writes only the form, says what it did, moves focus to the first changed field and offers one-level **Undo** (README.md#L2370-L2372). *Raise* and *Lower* buttons must move the orbit by more than 5 km, and 348 buttons are applied through the planner to confirm they are accepted and do what they promise (README.md#L2372-L2374). Heights round the safe way to 10 km, so a 25-year fix never exceeds 25 years: at the typical satellite the mid-case 2-, 5- and 25-year heights are 443.2, 495.5 and 594.0 km, offered as 450, 490 and 590 (README.md#L2374-L2377). Where no honest height exists the button is absent (README.md#L2378-L2380).

## The label

The panel's name is one constant, `AdvisorCopy.ADVISOR_LABEL` (`'Professor's notes'`), read by the heading, the region's accessible name, the spoken summary and *Basis* tooltips; no advice text names the speaker. Checks stub it to `Tutor` and confirm no advice string changes (README.md#L2382-L2389). The footer describes the notes as closed-form estimates for learning, sizing and comparing, and points real missions to a tool such as GMAT (README.md#L2389-L2390).

## On catalogue spacecraft

Under *Orbital elements at epoch*, a section *Professor's notes on <name>* applies the same five groups and code to whatever catalogue spacecraft is on the globe, from its own two lines without validating them first (README.md#L2392-L2398). It has no buttons and no input notes, and defers lifetime to the fitted [[orbital-decay-forecast]] (*Lifetime: see Orbital decay*), since an assumed drag figure beside that forecast would contradict it (README.md#L2398-L2401). It is built in an idle moment (median 0.6 ms, slowest of 2,158 sets 6 ms) and hidden for designed orbits, under [[assignment-snapshot-tle-embedded]], and if the planner's chunks fail (README.md#L2401-L2406). A fixed test window checks eight spacecraft, including [[knacksat-2]] and the ISS, for exactly the expected notes (README.md#L2406-L2410).

## Verification

`verify-advisor.js` (392 checks, about 80 s) holds the Professor to SGP4 and real element sets (README.md#L2541-L2545). Among its checks (README.md#L2547-L2569):

- The Sun against an independent one within 0.0083° over 500 dates, and bit-equal to the old page's `sunEci` (which requires the old page checked out as `legacy/`).
- Local time of node against SGP4's node crossing (0.000 minutes); daytime passes over Bangkok and Hobart within 0.1 h.
- Five published repeating orbits (Landsat, Sentinel-2, Sentinel-1, Envisat, TOPEX/Jason) to 0.02 km and 0.002°.
- Eclipse closed form against SGP4 and a cone test across 35 cases.
- Each of the 67 advice items fires in at least one orbit and stays quiet in at least one.
- 58 injected faults, 57 killed; the survivor is described as an equivalent mutant.

## Stated limits

Among the planner-and-Professor limits: eclipse is umbra only with a cylindrical shadow, numeric only for 0.005 ≤ e < 0.05, and the sun items are silent from e = 0.05; radiation bands and the South Atlantic Anomaly are textbook figures; the critical inclination offered for Molniya-like orbits is the J2/J4 value, so for the Molniya preset at 116.6° the Check fires and its button changes nothing; and the Professor does not compute look-alikes, debris or launch sites (README.md#L2638-L2655).

## Related

- [[orbit-planner]] — the host feature.
- [[eclipse-shadow-cone]], [[sunlit-visibility]] — related shadow and visibility concepts elsewhere in the wiki.
- [[readme-decay-and-planner]] — source summary.
