---
type: source
title: "LLM Wiki (idea file)"
authors: ["Andrej Karpathy (gist, April 2026)"]
raw: "raw/llm-wiki-idea-file.md"
ingested: 2026-11-24
created: 2026-11-24
updated: 2026-11-24
tags: [meta]
entities: []
concepts: []
---

# LLM Wiki (idea file)

The idea file this wiki is built from. It describes a pattern for personal knowledge bases in which an LLM agent **incrementally builds and maintains a persistent, interlinked markdown wiki** between the user and their raw sources, instead of re-retrieving raw chunks on every question as RAG does (raw/llm-wiki-idea-file.md#L9-L13). The installed `llm-wiki` skill implements the same pattern; this copy is kept so the wiki's founding intent travels with the project.

## Key claims

- **Compounding artifact.** Knowledge is compiled once and kept current; cross-references, flagged contradictions and the synthesis already exist when a question arrives (#L11-L13).
- **Division of labour.** The human curates sources, directs analysis and asks questions; the LLM does summarising, cross-referencing, filing and bookkeeping (#L15, #L66-L68).
- **Three layers.** Immutable raw sources; the LLM-owned wiki; a schema document that makes the LLM a disciplined maintainer and is co-evolved with the user (#L27-L33).
- **Three operations.** *Ingest* (read a source, discuss, write a summary, update index and touched pages, log it — one source may touch 10–15 pages), *query* (answer from the wiki with citations and file good answers back as pages), *lint* (contradictions, stale claims, orphans, missing pages and cross-references, gaps) (#L37-L41).
- **Index and log.** `index.md` is a content catalog read first on every query, adequate to roughly 100 sources / hundreds of pages; `log.md` is append-only with a greppable `## [date] op | title` prefix (#L45-L49).
- **Optional tooling.** A local search engine (e.g. qmd) once the index stops being enough; Obsidian as the reading IDE; git for history (#L53-L62).
- **Intentionally abstract.** Directory layout, schema conventions and tooling are to be decided per domain (#L75).

## How this wiki applies it

Specifics for SattrackSlop live in `wiki/SCHEMA.md`. The main adaptation is that the project's own documents (`README.md`, `CHANGES-FROM-LEGACY.md`, `CLAUDE.md`) are the raw layer, read in place and cited by line, rather than copied into `raw/`; and because the project's rule is that computed numbers must not move, the wiki quotes figures rather than recomputing them.

## Where this fits

Parent narrative source for the project: [[sattrackslop-readme]].
