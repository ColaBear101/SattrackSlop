---
type: entity
kind: organization
title: "CelesTrak"
tags: [data]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# CelesTrak

CelesTrak (celestrak.org) is the external service the Earth console asks for current element sets and for element-set histories, when the project's own optional cache API is absent (README.md#L62, L78-L79). It is also where the original assignment starts: the brief asks for a satellite from CelesTrak's Earth Resources group (README.md#L336).

## What the console asks it for

| Request | Endpoint named in the README | When | Line |
|---|---|---|---|
| Current element set for the spacecraft on screen | `gp.php`, with `tle.ivanstanojevic.me` as fallback | when a spacecraft is put on screen and every three hours while it stays; an answer reused for three hours, a failure retried after five minutes | README.md#L78, L143-L147 |
| An object's element-set history | `graph-orbit-data.php` | only when a remaining-life estimate is asked for | README.md#L79, L150-L153 |

In both cases the page asks its own cache API first (`/api/tle/<n>`, `/api/history/<n>`) if one answers as itself, and goes to CelesTrak only otherwise; without the API the page asks CelesTrak itself, "as it always did" (README.md#L62, L141-L153). The README's lib layout notes the element-set code asks CelesTrak and its mirror "as the old page asked them" (README.md#L201-L203). See [[live-element-refresh]].

It is never asked for an orbit the user designed, and never under `?tle=embedded` (README.md#L78, L146-L147) — see [[assignment-snapshot-tle-embedded]].

## Privacy

The README notes that CelesTrak and the other external services see the user's IP address and what is asked for (README.md#L74).

## CelesTrak data inside the project

- `data/` holds "what CelesTrak says each of its objects is" (README.md#L96); the *By type* and *By purpose* catalogue colourings fetch that CelesTrak table (`satcat`) as a chunk of the page (README.md#L831-L833) — see [[catalogue-colouring]] and [[data-provenance]].
- `verification/fixtures/resource.txt` is a copy of the Earth Resources group's 167 element sets, used by the [[independent-reference-checks]] (README.md#L348, L666).
- Not every catalogue object comes from a CelesTrak group: [[knacksat-2]] came from SatNOGS, which is why it is outside the assignment's brief (README.md#L347-L350).

## Related

- [[tle-two-line-element-set]]
- [[orbital-decay-forecast]] — the consumer of the history endpoint.
- [[readme-overview-and-assignment]]
