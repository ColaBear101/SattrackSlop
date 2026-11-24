---
type: concept
title: "Change ledger"
tags: [meta, verification]
sources: [changes-from-legacy, claude-md-project-instructions]
created: 2026-11-24
updated: 2026-11-24
---

# Change ledger

The **change ledger** is SattrackSlop's practice of listing, in `CHANGES-FROM-LEGACY.md`, every intentional way the rebuilt Earth console differs from the [[legacy-earth-console]], with the reason for each. It inverts the usual burden of proof: the rewrite keeps every computed number identical and otherwise changes only what is listed, so a difference that is not on the list is by definition a bug (CHANGES-FROM-LEGACY.md#L3-L4). The ledger's content is summarised on [[changes-from-legacy]]; this page describes how it functions.

## The contract

The ledger pairs with the [[regression-gate]]. The gate guarantees that the numbers do not move at all (CLAUDE.md#L7); the ledger accounts for everything else that does move — layout, wording, network behaviour, new features. Together they make "the same as the old page, except as listed" a checkable claim rather than an aspiration.

## Row format

Each entry is one row of a Markdown table with a **Change** column (what differs, often with the element ids, files and sizes involved), a **Why** column (the reason), and, in two of the three tables, a **Status** column (CHANGES-FROM-LEGACY.md#L10, CHANGES-FROM-LEGACY.md#L26, CHANGES-FROM-LEGACY.md#L54). Rows are identified in three series:

| Series | Table | Example |
|---|---|---|
| `1`–`11` | Behaviour and data | row 1, the zero-padded NORAD id bug (CHANGES-FROM-LEGACY.md#L12) |
| `A`–`K`, `M`–`X` | Verification | row M, prose parity (CHANGES-FROM-LEGACY.md#L39) |
| `L1`–`L86` (with gaps) | Look and interface | row L80, the globe opens plain (CHANGES-FROM-LEGACY.md#L129) |

Other project documents refer to rows by these ids. The project instructions name the ledger's ranges as "rows L1-L61, L66-L68 and L71-L86 … and the numbered rows", with L62–L65 and L69–L70 on other branches (CLAUDE.md#L3). Code and the instructions also cite rows directly, e.g. the Moon ephemeris copy is "L75" and the realistic globe "L71" (CLAUDE.md#L11, CLAUDE.md#L16), and ported files carry `CHANGED (Lnn)` markers naming the row that justifies the edit (CHANGES-FROM-LEGACY.md#L120-L128; see [[verbatim-ports]]).

## Status vocabulary

The preamble defines **applied** (in the code now) and **planned** (decided, not yet made) (CHANGES-FROM-LEGACY.md#L6). In practice statuses carry more:

- **declined**, with the milestone and reason — row 2 kept two Sun formulas so the scene stays pixel-identical (CHANGES-FROM-LEGACY.md#L13);
- **superseded**, pointing at the replacing row — row 11 by L43 (CHANGES-FROM-LEGACY.md#L22);
- **applied (accepted)** where a lead or owner accepted a trade-off (CHANGES-FROM-LEGACY.md#L82, CHANGES-FROM-LEGACY.md#L96);
- **applied (new in the rebuild, not a regression; the README's "…")**, marking a new feature rather than a deviation and pointing to the README section that documents it (CHANGES-FROM-LEGACY.md#L100-L126);
- qualifiers naming what is still missing, e.g. a permalink time parameter "not built" (CHANGES-FROM-LEGACY.md#L62).

## Same-commit discipline

The project's working rules require that a difference from the old page goes into the ledger **in the same commit** as the code, that a new fact the page states goes into `src/lib/text`, and that a suite which asserted the old behaviour is changed in that commit with the reason (CLAUDE.md#L26). See [[project-working-rules]].

The verification rows show what that looks like for tests. Rows O and P list each expectation that "reads differently here" — for instance, visibility asked of the layout via `getClientRects` instead of an element's own `display`, because the rebuilt page hides wrappers — and state that none loosens a claim (CHANGES-FROM-LEGACY.md#L41, CHANGES-FROM-LEGACY.md#L42). Checks that cannot apply to the module build are "skipped, out loud" with their reason (CHANGES-FROM-LEGACY.md#L31-L32).

## Machine-readable companions

The ledger is prose; a few files enforce parts of it mechanically:

- `verification/gate/golden-diffs.json` lists the intended differences in the page's words, each with its reason; any other difference fails the prose-parity stage (CHANGES-FROM-LEGACY.md#L39). Row L42's status notes that `golden-diffs.json` lists the removed "Outside the brief" notice (CHANGES-FROM-LEGACY.md#L97).
- Behaviour maps (`behaviours.json`, `behaviours-custom.json`) tie old behaviours and mutants to the checks that now guard them (CHANGES-FROM-LEGACY.md#L41-L42). See [[verification-harness]].

## What rows tend to record

Beyond the change itself, rows routinely record the change's cost in entry-chunk bytes and whether the first-screen ceiling held ([[lazy-chunks-and-entry-budget]]), whether anything the golden or ab3d captures read was touched, which tests were added, and whether the owner requested or approved the change (CHANGES-FROM-LEGACY.md#L110-L121, CHANGES-FROM-LEGACY.md#L14). This makes the ledger also the project's design history.

## Caveats

- Long rows accumulate edits over time and can contain statements later rows overtake; row Q still says the 90 KB entry budget is not asserted (CHANGES-FROM-LEGACY.md#L43), which later rows and CLAUDE.md contradict (CHANGES-FROM-LEGACY.md#L121, CLAUDE.md#L16).
- Row ids are not file line numbers; see the citation note on [[changes-from-legacy]].

## Related

- [[regression-gate]] — the half of the contract that covers numbers
- [[changes-from-legacy]] — the ledger's contents
- [[legacy-earth-console]] — what the ledger is measured against
- [[claude-md-project-instructions]]
