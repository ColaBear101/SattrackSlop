# Wiki Log

Append-only chronological record of operations on the wiki. Each entry begins with `## [YYYY-MM-DD] <op> | <description>` so it's parseable with `grep "^## \[" log.md | tail -N`.

Operations:
- `ingest` — a source was processed into the wiki.
- `query` — a question was answered against the wiki (typically only logged when the answer was filed back as synthesis).
- `lint` — a health check was run.
- `schema` — the schema was modified.
- `shard` — an index was sharded.

---

## [2026-11-24] schema | Wiki initialised with the llm-wiki skill; schema tailored to SattrackSlop
- Replaced an earlier unstructured draft (6 pages, 2026-11-22: no frontmatter, broken anchor links, an incorrect Kozai explanation). It is retired, not migrated.
- SCHEMA.md: project files are the raw layer, read in place and cited by line; 14-tag taxonomy; "no physics from memory", "numbers quoted not recomputed", re-ingest on change.
- raw/llm-wiki-idea-file.md added as the founding pattern document.
- CLAUDE.md gained a `## Project wiki` stanza pointing future sessions at index.md and SCHEMA.md.

## [2026-11-24] ingest | SattrackSlop README.md (L1-L4106), CHANGES-FROM-LEGACY.md, CLAUDE.md, LLM Wiki idea file
- snapshot: 4ce1719 + uncommitted working-tree edits.
- Sources (9): sattrackslop-readme (parent), readme-overview-and-assignment, readme-globe-and-views, readme-ar-and-architecture, readme-decay-and-planner, readme-moon-data-and-radio, changes-from-legacy, claude-md-project-instructions, llm-wiki-idea-file.
- Entities (8) and concepts (39) created; see index.md.
- Open flags (listed in index.md): KNACKSAT-2 "within a day" date mismatch; ledger row Q vs the 92 KB entry budget; --write-baseline vs --write; "10 milliarcseconds" for a time total; PA–ME 875 m vs 860 m; "about 3,600 lines" label.
- Suggested next pages: pass-exports (CSV/iCalendar), spacecraft-picker-and-watchlist, cache-api-server, verify-visitor, mutation-testing, osculating-vs-mean-elements, maidenhead-grid-locator, saved-orbits-store.
