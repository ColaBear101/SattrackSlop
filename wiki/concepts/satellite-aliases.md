---
type: concept
title: "Satellite aliases (other names)"
tags: [data, radio, earth-console]
sources: [readme-moon-data-and-radio]
created: 2026-11-24
updated: 2026-11-24
---

# Satellite aliases (other names)

**Satellite aliases** are the alternative names by which the Earth console's spacecraft picker can find an object. The catalogue names each object as its element-set source does, which is often not the name radio amateurs use (README.md#L3571-L3572). `data/aliases.json` supplies those other names, from SatNOGS DB.

## Contents

The file holds other names for 494 of the 2,158 spacecraft, 712 names in all: the SatNOGS name and its alternative names, where a search of the catalogue's own name would not find them (README.md#L3572-L3574). Examples given: AO-7 for OSCAR 7, SO-50 for SAUDISAT 1C, FO-29 for JAS 2, PO-101 for DIWATA 2B, QO-100 for ES'HAIL 2, RS-44 and DOSAAF-85 for BREEZE-KM R/B, call signs such as DP0BEE, and names for launch objects the catalogue still calls OBJECT G or OBJECT AY (README.md#L3574-L3577). The picker matches a search against them after its own rows (README.md#L3577-L3578).

## How it was baked

It was baked on 16 October 2026 (13:16 UTC) from SatNOGS DB's anonymous satellite endpoint, which returned all 2,839 records in one unpaginated request; `verification/tools/fetch-aliases.js` names the repository in its User-Agent and would follow pagination one page at a time (README.md#L3580-L3583).

Filtering rules (README.md#L3583-L3594):

- catalogue objects only, matched by NORAD number;
- names split at commas and semicolons;
- both sides stripped to letters, marks and digits, as the search strips them;
- dropped: the catalogue number itself, a name already inside the catalogue name (ISS for ISS (ZARYA)), a spelling of one already kept, non-names (designators, dates, *Object A*, *Unknown Satellite*: 399), names over 30 characters (32), and names that are another catalogue object's name.

The last rule handles disagreements: SatNOGS gives CBERS-4A to 44879, which the catalogue calls OBJECT A, while the catalogue's CBERS 4A is 44883; and GRUS-1D to 47935, the catalogue's GRUS-1E (README.md#L3591-L3594).

## Size and loading

The file is 14,021 bytes (6.0 KB gzipped), keyed by NORAD number without leading zeros (README.md#L3594-L3596). It is a lazy chunk fetched the first time something is typed into the picker — not at boot, not when the list opens — with its 0.5 KB search code fetched in the same round trip (README.md#L3596-L3598); see [[lazy-chunks-and-entry-budget]]. The page asks SatNOGS nothing at runtime: the names are a file of the page's own (README.md#L3599-L3600).

## Licence

As an adaptation of SatNOGS DB data it is under CC BY-SA 4.0 and credited in the footer alongside the transmitters and element sets (README.md#L3602-L3604); see [[data-provenance]]. Re-baking: `node verification/tools/fetch-aliases.js`, with `--save <file>` to keep the answer and `--from <file>` to re-bake without a request (README.md#L3606-L3610).

## Checks

`verify-catalogue.js` types alias queries into the picker on a page of their own: it checks the table and its code are not fetched at boot or on opening the list, are fetched once each on the first query, and that early Enter presses wait or do nothing correctly (README.md#L3850-L3857). It checks that `rs44` (and `rs-44`, `RS 44`, `RS-44`) lists BREEZE-KM R/B with *matches RS-44* in its option, `ao7` lists OSCAR 7 before FUNCUBE 1, `so50` picks SAUDISAT 1C, and nothing is asked of any SatNOGS host or stored (README.md#L3857-L3862). See [[verification-harness]].

## Related

- [[doppler-and-transmitters]] — the transmitter table from the same database.
- [[page-navigation-and-accessibility]] — the picker's keyboard behaviour.
- [[readme-moon-data-and-radio]]
