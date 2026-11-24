---
type: concept
title: "Assignment snapshot (?tle=embedded)"
tags: [earth-console, data, verification]
sources: [readme-overview-and-assignment]
created: 2026-11-24
updated: 2026-11-24
---

# Assignment snapshot (`?tle=embedded`)

The *assignment snapshot* is a mode of the Earth console, opened with the URL parameter `?tle=embedded`, that uses only the element sets shipped with the page, opens each spacecraft's window at its own set's epoch, and makes no element-set requests at all (README.md#L47). It exists so that the README's figures, which are all computed from fixed sets at their epochs, can be reproduced on the live page (README.md#L363-L371).

## Why it is needed

Every figure the README quotes is computed from [[knacksat-2]]'s embedded set with the window opening at its epoch, "so the numbers stay checkable" (README.md#L363-L364). The live page does neither: it fetches a newer set on load ([[live-element-refresh]]) and opens the window at the reader's clock, so its numbers differ — and the README says they should. The line under the headline total states which window and which set were used, so two readers an hour apart can see why their numbers disagree (README.md#L364-L367).

## What the mode does

- Keeps the embedded element sets and asks no source for a newer one (README.md#L370-L371) — not [[celestrak]], not its mirror, and not the page's own cache API (README.md#L146-L147, L78).
- Opens each spacecraft's window at its own epoch (README.md#L371).
- Switches the orbit planner off (README.md#L47). A later section adds that none of the planner's five chunks is fetched, nothing is restored or written, the saved store is neither listed nor modified, the picker's count reads 2,158 spacecraft, and the *Plan* pill stays but is marked `aria-disabled` with a link back to the live element sets (README.md#L2500-L2504) — see [[orbit-planner]].
- It is linked from the answer rail's *Source* tab, under the element set's two lines (README.md#L369-L370).

## Reproducing the README

The observer must also be Bangkok. A moved site is remembered, so *Reset to Bangkok* in the observer panel is needed first if the site was changed (README.md#L372-L373; see [[observer-value]]). KNACKSAT-2 then reads 899.7 s over 2 passes, with the page's line reading "15 min 00 s in view over 24 h from 2026-09-12 14:29 UTC+7 … Element set epoch 2026-09-12 07:29Z, embedded" (README.md#L373-L375). That matches the README's part (c) total (README.md#L535); see [[pass-prediction]].

## Live page vs. snapshot at a glance

| | Live page (default) | `?tle=embedded` |
|---|---|---|
| Element set | fetched on load, refreshed every 3 h (README.md#L78, L145) | the set shipped with the page (README.md#L370) |
| Window start | the reader's clock (README.md#L365-L366) | each set's own epoch (README.md#L371) |
| Network requests for element sets | cache API, else CelesTrak, else mirror (README.md#L141-L146) | none, the page's own API included (README.md#L146-L147) |
| Orbit planner | available | switched off (README.md#L47) |

## How it is checked

`verification/suites/verify-refresh.js` checks the snapshot, with a newer element set on offer that must not be asked for (README.md#L376).

## Related

- [[tle-two-line-element-set]]
- [[data-provenance]]
- [[readme-overview-and-assignment]]
