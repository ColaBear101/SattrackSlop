# Wiki Schema

This file is the configuration for this wiki. It documents the conventions, page types, tag taxonomy, and any workflow customizations. The LLM reads this first when entering the wiki, and its conventions override the defaults documented in the `llm-wiki` skill.

This file is **co-evolved with the user**. When the LLM notices a recurring pattern in your edits or feedback that isn't here, it will propose adding it. When something here stops fitting, prune it.

## Wiki location

- Wiki root: `wiki/`
- Raw sources: `raw/` (external material) **and the project's own files in place** — see "Project files as raw sources" below.
- Asset/image storage: `raw/assets/`
- Pattern this wiki follows: `raw/llm-wiki-idea-file.md` (the LLM Wiki idea file; summarised in [[llm-wiki-idea-file]]).

## What this wiki is for

A compiled knowledge base about **SattrackSlop** — the Earth satellite ground-track console (Svelte 5 + TypeScript + Vite) and its two Moon pages. It answers "how does X work, why is it that way, and how is it checked" without re-reading the 55,000-word `README.md` or the 39,000-word `CHANGES-FROM-LEGACY.md` each session.

## Project files as raw sources

The project's own documents are the raw layer, read in place rather than copied into `raw/` (copies would go stale and duplicate ~0.5 MB):

- `README.md` — the long technical account (split into section source pages, parent [[sattrackslop-readme]]).
- `CHANGES-FROM-LEGACY.md` — the ledger of intentional differences from the old page.
- `CLAUDE.md` — the agent instructions and working rules.
- Source code under `src/`, `server/`, `verification/` — cite only when a page needs it.

Because these files change, every source page records `raw:` as `<path>#L<start>-L<end>` plus `snapshot:` (the git `HEAD` short hash and whether the working tree had uncommitted edits). Cite claims in page bodies as `(README.md#L425)` line references so they can be re-checked. **The project files win over the wiki**: when they disagree, the wiki page is stale — fix it and note it in the log. External material (articles, papers, standards) still goes into `raw/` verbatim.

## Page types

This wiki uses these page types, each with a dedicated subdirectory:

- `source` (in `wiki/sources/`) — one summary page per ingested source.
- `entity` (in `wiki/entities/`) — pages about specific things: people, papers, products, places, organizations.
- `concept` (in `wiki/concepts/`) — pages about ideas, methods, frameworks, abstractions.
- `synthesis` (in `wiki/synthesis/`) — cross-cutting analyses, comparisons, query answers filed back.

Add additional types here as the wiki evolves.

## Tag taxonomy

Keep this list small; propose additions in the log before using a new tag.

- `orbital-mechanics` — element sets, propagation, frames, passes, geometry.
- `earth-console` — the main Earth ground-track page and its features.
- `moon` — the Earth–Moon system page and the lunar track console.
- `globe` — the 3D scene, its surfaces, cameras and models.
- `ar` — the sky-through-the-phone view, radar and snap.
- `decay` — orbital decay histories, forecasts and comparison.
- `planner` — the user's own orbits and the Professor.
- `radio` — Doppler, transmitters, radio vs. naked-eye visibility.
- `data` — catalogue, element sources, provenance, caching, privacy.
- `verification` — the gate, suites, references, what is and is not checked.
- `architecture` — code layout, layering, lazy chunks, budgets, ports.
- `meta` — pages about the wiki or the project's process itself.
- `open-question` — pages or sections that flag unresolved questions.
- `contested` — pages where sources contradict.

## Page sizing

- Soft cap: 400 lines / ~2,000 words. Consider splitting beyond this.
- Hard cap: 800 lines. Must split.

## Frontmatter requirements

Every page must have:
- `type`
- `title`
- `tags`
- `created`
- `updated`

Plus type-specific:
- `source` pages: `authors`, `url` (if applicable), `raw`, `ingested`
- Non-source pages: `sources` listing the source-summary pages drawn from

## Optional graph metadata

Pages may declare typed graph metadata under a top-level `graph:` key. This is the source of truth for the compiled knowledge graph under `wiki/graph/`. Markdown remains canonical; the graph is a regenerable index. Pages without `graph:` still appear as nodes (derived from `type`/`kind`) and still contribute `mentions` edges from body `[[wikilinks]]`.

```yaml
graph:
  node_id: person:praney-behl       # optional; default <node_type>:<slug>
  node_type: person                  # optional; default mapped from type/kind via ontology
  canonical: true                    # mark as canonical when multiple slugs alias the same entity
  aliases: [Praney, praney@example.com]
  relationships:
    - predicate: founded
      object: company:seedblocks
      source: praney-founder-context-dump   # source-page slug
      evidence: "Solo technical founder and sole director..."
      confidence: high               # high | medium | low
      status: current                # current | historical | proposed | disputed | superseded
      # optional:
      # valid_from: 2025-01-15
      # valid_to: 2026-03-01
      # notes: "..."
      # raw_ref: "raw/founder-dump.md#L42"
      # contradicts: edge-id-or-source-slug
      # supersedes: edge-id-or-source-slug
```

Required fields on every relationship: `predicate`, `object`, `source`, `evidence`, `confidence`, `status`. Predicates and the subject/object types they accept are declared in `wiki/graph/ontology.yaml`. Typed semantic edges must be supported by an explicit source — never emit one inferred from training data alone.

## Index structure

(Update this section when sharding.)

Currently flat: a single `wiki/index.md` listing all pages.

When the wiki passes ~150 pages or `index.md` exceeds 300 lines, shard into `wiki/indexes/<type>.md` and update this section.

## Retrieval

- Search is section-level hybrid by default: `uv run --script skills/llm-wiki/scripts/wiki_search.py "query" --json`.
- Semantic backend: local FastEmbed + sqlite-vec (`BAAI/bge-small-en-v1.5`, 384 dimensions). No wiki or query text leaves the machine.
- First semantic use downloads model artifacts to `~/.cache/llm-wiki/fastembed/`; set `FASTEMBED_CACHE_PATH` to override the model cache.
- `wiki/.wiki-cache/` holds regenerable retrieval artifacts: `search-index.json` (parse cache) and `embeddings.sqlite` (section metadata + sqlite-vec vectors). Safe to delete; never edit by hand; gitignored.
- The vector index is content-hashed: only new or changed sections are re-embedded, deleted sections are removed, and model/schema changes rebuild it automatically.
- Dependency-free lexical path: `python skills/llm-wiki/scripts/wiki_search.py "query" --no-embed` (direct Python bypasses PEP 723 dependency resolution). A missing or failed local backend also falls back to lexical search without failing the command.

## Graph layer

The wiki has an optional compiled graph layer under `wiki/graph/`:

- `wiki/graph/ontology.yaml` — declares node types and predicates. **Tracked.** Edit this when you introduce new predicates or domain types.
- `wiki/graph/nodes.jsonl`, `wiki/graph/edges.jsonl` — generated. Track in git only if you want graph diffs in PRs.
- `wiki/graph/graph.sqlite` — generated. Gitignored by default.
- `wiki/graph/graph.graphml` — generated. Track only if you want to diff it.

Generation is reproducible from markdown via `scripts/wiki_graph_extract.py`. The graph can be deleted at any time and rebuilt without losing knowledge — markdown is canonical.

## Workflow customizations

- **No physics from memory.** Pages state what the project's sources say. Background facts not in a source (e.g. general orbital mechanics) must be marked "(background, not from a project source)" or left out. The first wiki draft (2026-11-22, retired) was replaced partly because it asserted an incorrect explanation of Kozai mean motion.
- **Re-ingest on change.** When `README.md`, `CHANGES-FROM-LEGACY.md` or `CLAUDE.md` gains a section or ledger row, update the matching source page and touched concept pages, bump `updated`, and log it as `ingest`.
- **Numbers are quoted, not recomputed.** Figures (pass durations, element values, budgets, row numbers like L71) are copied from the source with a line citation, since the project's one rule is that computed numbers must not move.
- **Never edit project files from a wiki operation** except the `## Project wiki` stanza in `CLAUDE.md`.

## User preferences

(Empty initially. As the user expresses style preferences — "always include a 'Why this matters' section on concept pages", "never use bullet lists in summaries", "prefer comparative tables for synthesis pages" — capture them here so they persist across sessions.)

## Lint cadence

- Structural lint: after every 5 ingests.
- Semantic lint: weekly or after every 20 ingests.
- Gap-finding: monthly.
- Graph lint + extract: after every ingest that adds typed `graph.relationships`.

Adjust based on the wiki's growth rate.

## Skill evolution

Optional: capture verified task experience with `/wiki:learn` and propose tested procedural improvements with `/wiki:evolve`. Existing pages and workflows do not change. Raw experience JSON lives under the configured raw root's `experiences/` directory and is immutable. Consolidate observations into ordinary source/concept pages with evidence, applicability, model/tool versions and counterexamples. Optional pattern fields are `kind: experience-pattern` and `status: hypothesis|supported|superseded`.

`wiki/.evolution/` holds durable experiment snapshots, evidence, diffs and measured outcomes; it is not a cache. Wiki search, lint, stats and graph extraction exclude it. Keep searchable summaries in normal synthesis pages linked to the source/pattern pages and index. Private records must not be published with shared skills.

Candidate edits remain isolated until reviewed, selected on validation tasks, independently measured on untouched final-test tasks, and explicitly applied within the user's authorization. Failed edits leave the active skill unchanged while their records persist. Do not repeat a rejected proposal without new evidence or changed conditions. Keep factual wiki access during normal work; do not inject experiment history into task execution. Correct unsupported lessons without deleting their raw evidence. Follow the installed skill's `references/evolution-workflow.md` for the runner contract, cost limits and recovery.
