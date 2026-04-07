# Desktop RAG / Vector Search Implementation Checklist

## Purpose

This document explains how to add full built-in RAG and vector search to `sandpaper/desktop`.

This is not a plugin plan and not an external sidecar service plan. The goal is:

- indexing Sandpaper vault content inside the desktop app
- supporting lexical search, vector search, and hybrid retrieval
- supporting answer generation with citations
- keeping the implementation safe, incremental, and testable

This plan is written so another AI agent or a junior developer can implement it without guessing intent.

## What Success Looks Like

After this work is done, the desktop app should behave like this:

1. The app maintains a vault-scoped search index in the background.
2. Regular text search still works.
3. Semantic search works across notes even when exact words do not match.
4. Hybrid search combines lexical and vector retrieval.
5. Search results point to the exact page and block that matched.
6. The user can ask a question and receive an answer grounded in retrieved note content.
7. The answer includes citations that jump back to source blocks.
8. Reindexing is incremental after page changes.
9. The feature is safe across restart, vault switching, and partial failures.

## Decisions Already Made

Do not reopen these decisions during implementation.

- The feature is built into `apps/desktop`, not shipped as a plugin.
- The main app database is not replaced.
- RAG indexing uses a separate vault-scoped sidecar SQLite database.
- The source of truth for indexing is Sandpaper page and block data, not shadow markdown files.
- Shadow markdown can still be used for debugging and validation.
- Retrieval supports three modes:
  - lexical
  - vector
  - hybrid
- Hybrid retrieval uses:
  - FTS for lexical retrieval
  - vector similarity for semantic retrieval
  - reciprocal rank fusion for merge
  - optional reranking on the fused shortlist
- Returned search hits must always preserve:
  - `page_uid`
  - `block_uid`
  - snippet text
  - score metadata
- The initial implementation must support retrieval first and answer generation second.
- Answer generation must be provider-agnostic.
- Indexing must be incremental by page and must avoid full re-embedding when content did not change.

## Non-Goals For The First Iteration

Do not do these in v1 unless required to unblock core retrieval.

- Do not add sync-server-side RAG.
- Do not add mobile RAG.
- Do not add plugin-facing RAG APIs in v1.
- Do not redesign the entire search UI before the retrieval layer exists.
- Do not add graph search, agent planning, or multi-hop workflow orchestration in v1.
- Do not index arbitrary files outside note content unless the app already imports them as note content.
- Do not add cross-vault global retrieval in v1.
- Do not add automatic background OCR, PDF parsing, or attachment extraction in v1.

## Read These Files First

Read these files before changing anything:

- `apps/desktop/src/pages/main-page/model/use-search.tsx`
- `apps/desktop/src/pages/main-page/model/search-utils.ts`
- `apps/desktop/src/widgets/search/search-pane.tsx`
- `apps/desktop/src/widgets/sidebar/sidebar-content.tsx`
- `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`
- `apps/desktop/src/entities/search/model/search-types.ts`
- `apps/desktop/src/entities/page/model/page-types.ts`
- `apps/desktop/src/entities/block/model/block-types.ts`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/bin/fts-bench.rs`
- `packages/core-model/src/block-model.ts`
- `packages/core-model/src/markdown-parser.ts`
- `packages/core-model/src/markdown-serializer.ts`

Also read these files because they are relevant to persistence and block structure:

- `apps/desktop/src/features/autosave/model/use-autosave.ts`
- `apps/desktop/src/features/vault/model/use-vault-loaders.ts`
- `packages/core-model/src/shadow-writer.ts`

## Current State Summary

The current desktop app already has a search surface, but it is plain text search only.

Current important facts:

- Frontend search state lives in `apps/desktop/src/pages/main-page/model/use-search.tsx`.
- Tauri search currently calls `search_blocks`.
- Rust search currently delegates to `db.search_block_summaries(&query, 50)`.
- Search results are currently too small as a type:
  - `id`
  - `text`
- The app already writes shadow markdown into `vault/pages/*.md`.
- The app already has a stable page and block model that is better than markdown for indexing.

Implication:

- Retrieval, ranking, and answer generation need a new backend layer.
- Search result types and UI state must be expanded.
- The search feature must stop assuming every result is a plain block text hit.

## High-Level Architecture

Implement the feature with these building blocks:

- A new Rust-side RAG module under `apps/desktop/src-tauri/src/`.
- A vault-scoped sidecar database, for example:
  - `vault/.sandpaper/rag-index.sqlite`
- A provider abstraction layer for:
  - embeddings
  - optional reranking
  - answer generation
- A deterministic chunking pipeline based on page and block structure.
- A page-dirty incremental indexing pipeline.
- New Tauri commands for:
  - status
  - rebuild
  - incremental indexing
  - lexical search
  - vector search
  - hybrid search
  - answer generation
- Expanded frontend types and UI state for:
  - retrieval mode
  - rich result payloads
  - citations
  - indexing status

## Core Design Decisions

### Sidecar Index Database

Do not add vector columns or retrieval tables directly into the main app database in the first iteration.

Use a separate database because:

- it reduces migration risk
- it keeps the primary note store simpler
- it makes rebuild and corruption recovery easier
- it allows experimental schema changes without destabilizing the main app DB

### Source Of Truth

Use page and block data from the app database as the source of truth for indexing.

Do not index from shadow markdown as the primary source because:

- block boundaries are already explicit in app data
- page and block identifiers are already available
- block type and indent are already normalized
- citation jumps depend on stable block identity

Shadow markdown is useful only for:

- validating exports
- comparing generated chunks during debugging
- future import/export parity tests

### Retrieval Shape

Use block-aware chunks, not file-level chunks.

Each chunk should preserve enough context to answer questions well while still mapping back to a specific source block. Recommended composition:

- page title
- block breadcrumb
- block text
- nearby structural context when needed

### Search Strategy

Implement retrieval in stages:

1. lexical retrieval with SQLite FTS5
2. vector retrieval with `sqlite-vec`
3. reciprocal rank fusion
4. optional reranking on the shortlist
5. answer synthesis with citations

## Recommended Schema

Create or migrate a sidecar schema with the following tables.

### `index_meta`

Purpose:

- store schema and provider metadata

Recommended fields:

- `schema_version`
- `vault_id`
- `embedding_provider`
- `embedding_model`
- `rerank_provider`
- `rerank_model`
- `chat_provider`
- `chat_model`
- `last_full_rebuild_at`
- `last_incremental_run_at`

### `indexed_pages`

Purpose:

- page-level dirty tracking

Recommended fields:

- `page_uid` primary key
- `title`
- `page_hash`
- `block_count`
- `last_saved_at`
- `last_indexed_at`
- `index_state`

### `indexed_blocks`

Purpose:

- stable mapping between app blocks and indexed content

Recommended fields:

- `block_uid` primary key
- `page_uid`
- `indent`
- `block_type`
- `text`
- `breadcrumb`
- `block_hash`
- `updated_at`

### `chunks`

Purpose:

- canonical chunk records

Recommended fields:

- `chunk_id` primary key
- `page_uid`
- `block_uid`
- `ordinal`
- `source_kind`
- `content`
- `token_count`
- `chunk_hash`
- `created_at`
- `updated_at`

### `chunks_fts`

Purpose:

- lexical retrieval

Implementation:

- FTS5 virtual table

Recommended columns:

- `chunk_id UNINDEXED`
- `title`
- `breadcrumb`
- `content`

### `chunk_vectors`

Purpose:

- vector retrieval

Implementation:

- `sqlite-vec` virtual table keyed by `chunk_id`

Recommended columns:

- `chunk_id`
- `embedding`

### `chunk_edges`

Purpose:

- context expansion around a hit

Recommended fields:

- `chunk_id`
- `prev_chunk_id`
- `next_chunk_id`

### `query_cache`

Purpose:

- avoid recomputing query embeddings too often

Recommended fields:

- `query_hash`
- `normalized_query`
- `embedding`
- `cached_at`

### `retrieval_log`

Purpose:

- debugging and ranking analysis

Recommended fields:

- `query`
- `mode`
- `chunk_id`
- `score`
- `rank`
- `created_at`

## Recommended Chunking Rules

Chunking quality will determine retrieval quality. Implement this before UI work.

Rules:

- chunk by block structure, not by raw character window only
- target approximately `700-900` tokens per chunk
- keep approximately `10-15%` overlap
- prefer breaking on:
  - page boundaries
  - heading boundaries
  - large list subtree boundaries
  - callout/toggle subtree boundaries
- do not split small logical units if avoidable
- preserve the mapping from chunk back to the originating `block_uid`

For each chunk, build a retrieval text like:

- page title
- breadcrumb
- main block text
- relevant child text when needed

Special handling:

- code blocks: do not split in the middle of a small code block
- tables: do not split row syntax arbitrarily if the table is short
- math blocks: keep the expression intact
- empty or structural-only blocks: skip unless needed for breadcrumb context

## Recommended Search Result Shape

Current search result types are too small. Replace or extend them with richer types.

Recommended `SearchHit` shape:

- `page_uid`
- `block_uid`
- `chunk_id`
- `title`
- `breadcrumb`
- `snippet`
- `score`
- `lex_score`
- `vector_score`
- `rerank_score`
- `rank`
- `source`
- `matched_terms`

Recommended `AnswerCitation` shape:

- `page_uid`
- `block_uid`
- `chunk_id`
- `title`
- `breadcrumb`
- `snippet`
- `rank`

Recommended `AnswerResult` shape:

- `answer`
- `citations`
- `used_chunks`
- `latency_ms`
- `provider`
- `model`

## New Modules To Add

Recommended Rust module structure under `apps/desktop/src-tauri/src/`:

- `rag/mod.rs`
- `rag/schema.rs`
- `rag/types.rs`
- `rag/hash.rs`
- `rag/chunker.rs`
- `rag/repository.rs`
- `rag/provider.rs`
- `rag/providers/`
- `rag/indexer.rs`
- `rag/retrieval.rs`
- `rag/rerank.rs`
- `rag/answer.rs`
- `rag/status.rs`

Recommended frontend additions under `apps/desktop/src/`:

- `entities/search/model/search-types.ts`
- `features/search/model/` if extraction becomes necessary
- `widgets/search/` updates
- optional new answer UI component under `widgets/search/`

## Implementation Strategy

Use TDD and implement in phases. Do not jump ahead.

### Phase 1: Add Rust RAG Types And Hash Utilities

Goal:

- define explicit retrieval and indexing types before touching command wiring

Checklist:

- [ ] Create `apps/desktop/src-tauri/src/rag/types.rs`.
- [ ] Add serializable types for:
  - `SearchMode`
  - `SearchHit`
  - `AnswerCitation`
  - `AnswerResult`
  - `IndexStatus`
  - `ChunkRecord`
  - `IndexedPageRecord`
- [ ] Create `apps/desktop/src-tauri/src/rag/hash.rs`.
- [ ] Add stable hash helpers for:
  - page hash
  - block hash
  - chunk hash
- [ ] Keep hashing deterministic and synchronous.
- [ ] Add unit tests for:
  - same input -> same hash
  - changed block text -> different hash
  - changed indent -> different hash
  - changed title -> different hash

Acceptance criteria:

- [ ] Types are explicit.
- [ ] Hashes are deterministic.
- [ ] Tests cover dirty-detection primitives.

### Phase 2: Add Sidecar Schema And Migration Layer

Goal:

- create the RAG index database safely and idempotently

Checklist:

- [ ] Create `apps/desktop/src-tauri/src/rag/schema.rs`.
- [ ] Add `open_or_create_rag_db(vault_path)` helper.
- [ ] Store the sidecar DB under a vault-local hidden app directory.
- [ ] Create migration helpers for:
  - schema bootstrap
  - schema version checks
  - future upgrades
- [ ] Create tables:
  - `index_meta`
  - `indexed_pages`
  - `indexed_blocks`
  - `chunks`
  - `chunk_edges`
  - `query_cache`
  - `retrieval_log`
- [ ] Create `chunks_fts` virtual table.
- [ ] Create `chunk_vectors` virtual table using `sqlite-vec`.
- [ ] Add schema tests:
  - fresh DB bootstrap
  - reopen existing DB
  - version mismatch behavior

Acceptance criteria:

- [ ] Sidecar DB can be created without touching the main app DB schema.
- [ ] Reopening is stable.
- [ ] Schema tests pass.

### Phase 3: Build Chunker And Block-Aware Normalization

Goal:

- produce high-quality chunks before implementing retrieval

Checklist:

- [ ] Create `apps/desktop/src-tauri/src/rag/chunker.rs`.
- [ ] Add an input normalization layer from page plus blocks to chunk candidates.
- [ ] Build breadcrumbs from page structure and indent hierarchy.
- [ ] Skip trivial empty blocks when safe.
- [ ] Keep source mapping to `page_uid` and `block_uid`.
- [ ] Implement chunk size targeting.
- [ ] Implement overlap handling.
- [ ] Add tests for:
  - heading subtree handling
  - list subtree handling
  - callout/toggle grouping
  - code block preservation
  - table preservation
  - stable chunk ordering

Acceptance criteria:

- [ ] Chunks preserve enough structure for good retrieval.
- [ ] Chunks map back to stable source IDs.

### Phase 4: Add Provider Abstractions

Goal:

- isolate embeddings, reranking, and answer generation from retrieval logic

Checklist:

- [ ] Create `apps/desktop/src-tauri/src/rag/provider.rs`.
- [ ] Add traits or equivalent abstractions for:
  - embedding provider
  - rerank provider
  - chat provider
- [ ] Add configuration types for provider selection.
- [ ] Add a fallback `disabled` or `stub` provider for tests.
- [ ] Keep provider code out of Tauri command handlers.
- [ ] Add tests for:
  - invalid provider config
  - stub provider output shape
  - provider error propagation

Acceptance criteria:

- [ ] Retrieval code does not depend directly on one vendor.
- [ ] Tests can run without real network calls.

### Phase 5: Add Repository Layer For Index Reads And Writes

Goal:

- centralize all sidecar index I/O

Checklist:

- [ ] Create `apps/desktop/src-tauri/src/rag/repository.rs`.
- [ ] Add repository methods for:
  - upsert page record
  - upsert block records
  - replace page chunks
  - delete stale page chunks
  - query FTS
  - query vectors
  - read index status
  - cache query embeddings
  - write retrieval logs
- [ ] Make all writes page-scoped and transactional.
- [ ] Add tests for:
  - insert page and chunks
  - update changed page
  - delete removed chunks
  - FTS result retrieval
  - vector row replacement

Acceptance criteria:

- [ ] The repository is the only place that touches sidecar tables directly.
- [ ] Page-scoped updates are atomic.

### Phase 6: Add Incremental Indexer

Goal:

- reindex only what changed after save

Checklist:

- [ ] Create `apps/desktop/src-tauri/src/rag/indexer.rs`.
- [ ] Add a full rebuild path.
- [ ] Add a page-dirty incremental path.
- [ ] Compare current page hash against indexed page hash.
- [ ] Skip embedding work when the page did not change.
- [ ] Rebuild only the changed page chunks when the page changed.
- [ ] Delete chunks for removed blocks.
- [ ] Update `indexed_pages.last_indexed_at`.
- [ ] Add tests for:
  - unchanged page -> no work
  - one changed block -> changed page reindexed
  - removed block -> stale chunks deleted
  - renamed title -> page reindexed

Acceptance criteria:

- [ ] Incremental indexing is correct.
- [ ] Full rebuild and incremental paths share core logic where possible.

### Phase 7: Add Retrieval, Fusion, And Optional Rerank

Goal:

- make retrieval useful before answer generation

Checklist:

- [ ] Create `apps/desktop/src-tauri/src/rag/retrieval.rs`.
- [ ] Create `apps/desktop/src-tauri/src/rag/rerank.rs`.
- [ ] Implement lexical retrieval with FTS5.
- [ ] Implement vector retrieval with provider query embedding.
- [ ] Implement reciprocal rank fusion.
- [ ] Add title and breadcrumb bonuses where justified.
- [ ] Add optional reranking over the fused shortlist.
- [ ] Keep reranking optional for local-only setups.
- [ ] Add tests for:
  - lexical-only result quality
  - vector-only result quality
  - fusion preserving both classes of hits
  - deduplication of repeated chunk hits
  - ranking bonus behavior

Acceptance criteria:

- [ ] Hybrid results are better than either retrieval mode alone on test fixtures.
- [ ] Scores are explainable enough for debugging.

### Phase 8: Add Answer Assembly And Citation Formatting

Goal:

- answer from retrieved notes only after retrieval is stable

Checklist:

- [ ] Create `apps/desktop/src-tauri/src/rag/answer.rs`.
- [ ] Implement context selection from top-ranked chunks.
- [ ] Add chunk budget trimming.
- [ ] Add adjacent-chunk expansion for incomplete passages.
- [ ] Build prompt assembly with explicit citation slots.
- [ ] Require the model to ground claims in retrieved content.
- [ ] Return citations with stable page and block IDs.
- [ ] Add tests for:
  - no-result fallback
  - citation formatting
  - duplicate chunk suppression
  - prompt budget trimming

Acceptance criteria:

- [ ] Answers are grounded and cite exact source blocks.
- [ ] Failure cases are explicit.

### Phase 9: Wire RAG Into Tauri Commands

Goal:

- expose the new backend safely to the existing desktop frontend

Checklist:

- [ ] Update `apps/desktop/src-tauri/src/lib.rs`.
- [ ] Register a new `rag` module.
- [ ] Add commands:
  - `rag_get_status`
  - `rag_rebuild_index`
  - `rag_index_dirty_pages`
  - `rag_search_lex`
  - `rag_search_vector`
  - `rag_search_hybrid`
  - `rag_answer_query`
  - `rag_cancel_job`
  - `rag_set_provider_config`
  - `rag_debug_chunk`
- [ ] Keep command handlers thin.
- [ ] Run heavy indexing and retrieval work off the UI thread.
- [ ] Add command-level tests where practical.

Acceptance criteria:

- [ ] Frontend can consume RAG without knowing storage internals.
- [ ] Commands expose rich result payloads.

### Phase 10: Expand Frontend Search Types And State

Goal:

- stop assuming search results are plain text block matches

Checklist:

- [ ] Update `apps/desktop/src/entities/search/model/search-types.ts`.
- [ ] Add frontend types for:
  - `SearchMode`
  - `SearchHit`
  - `SearchAnswerCitation`
  - `SearchAnswerResult`
  - `SearchStatus`
- [ ] Update `apps/desktop/src/pages/main-page/model/use-search.tsx`.
- [ ] Support mode switching:
  - lexical
  - vector
  - hybrid
  - answer
- [ ] Separate raw query from active retrieval mode.
- [ ] Store richer result state.
- [ ] Preserve current focus and jump behavior.
- [ ] Add tests for:
  - mode switching
  - result mapping
  - block jump from hit

Acceptance criteria:

- [ ] Search state supports richer results without breaking current sidebar flow.

### Phase 11: Update Search UI

Goal:

- surface the new retrieval capability without redesigning the whole app

Checklist:

- [ ] Update `apps/desktop/src/widgets/search/search-pane.tsx`.
- [ ] Add a retrieval mode control.
- [ ] Render richer hit metadata:
  - title
  - snippet
  - breadcrumb when available
  - source label such as `lex`, `vector`, `hybrid`
- [ ] Add an answer section for answer mode.
- [ ] Make citations clickable.
- [ ] Keep recent searches behavior.
- [ ] Keep accessibility:
  - keyboard navigation
  - listbox semantics
  - focus retention
- [ ] Add UI tests for:
  - mode selector
  - rich result rendering
  - citation click jump

Acceptance criteria:

- [ ] A user can switch retrieval modes without leaving the sidebar.
- [ ] A user can jump from hits and citations back to source blocks.

### Phase 12: Add Index Status, Settings, And Operational Safety

Goal:

- make the feature debuggable and maintainable

Checklist:

- [ ] Add status surface in settings or another low-impact UI location.
- [ ] Show:
  - index exists
  - indexed pages
  - indexed chunks
  - last full rebuild
  - dirty page count
  - provider configuration state
- [ ] Add manual rebuild action.
- [ ] Add provider settings UI only if needed to unblock answer generation.
- [ ] Add safe error states for:
  - missing provider config
  - embedding failure
  - index open failure
  - partial incremental failure
- [ ] Add tests for:
  - empty state
  - rebuild action wiring
  - provider misconfiguration state

Acceptance criteria:

- [ ] Operators can tell whether the index is healthy.
- [ ] Failures are visible and recoverable.

### Phase 13: Hook Incremental Indexing Into Save And Vault Load Lifecycles

Goal:

- keep the index current without forcing full rebuilds all the time

Checklist:

- [ ] Identify the save and load lifecycle in:
  - `apps/desktop/src/features/autosave/model/use-autosave.ts`
  - `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`
  - `apps/desktop/src/features/vault/model/use-vault-loaders.ts`
- [ ] After a successful page save, enqueue dirty-page indexing.
- [ ] On vault load, trigger:
  - index status read
  - optional background catch-up indexing
- [ ] Avoid blocking note editing on indexing completion.
- [ ] Debounce repeated save-triggered indexing work.
- [ ] Add tests for:
  - save triggers indexing
  - rapid repeated saves do not spam full work
  - vault switch resets status safely

Acceptance criteria:

- [ ] Search index freshness tracks normal editing behavior.
- [ ] Indexing does not regress editor responsiveness.

### Phase 14: Add App-Level Tests And Final Validation

Goal:

- prove the end-to-end flow before considering the feature done

Checklist:

- [ ] Add Rust-side unit tests for:
  - schema
  - chunker
  - repository
  - retrieval
  - answer assembly
- [ ] Add desktop frontend tests for:
  - rich search results
  - retrieval mode switching
  - citation jump behavior
  - answer rendering
- [ ] Add app-level tests covering:
  - index status load
  - hybrid search request path
  - answer request path
  - result jump to block
- [ ] Run:
  - `vp run -r check`
  - `vp run -r test`

Acceptance criteria:

- [ ] Retrieval and answer flow are both covered by tests.
- [ ] Validation commands pass.

## File-Level Implementation Plan

Follow this order. Do not reorder unless there is a clear blocker.

### 1. `apps/desktop/src-tauri/src/rag/types.rs`

Responsibility:

- shared Rust-side retrieval and answer payloads

Checklist:

- [ ] define serializable DTOs used by repository, retrieval, and Tauri commands
- [ ] keep payloads frontend-friendly

### 2. `apps/desktop/src-tauri/src/rag/hash.rs`

Responsibility:

- stable hashing for page, block, and chunk dirty detection

Checklist:

- [ ] implement deterministic hash helpers
- [ ] add tests before indexer code depends on them

### 3. `apps/desktop/src-tauri/src/rag/schema.rs`

Responsibility:

- sidecar DB creation and migration

Checklist:

- [ ] create bootstrap logic
- [ ] create schema version handling
- [ ] create FTS and vector tables

### 4. `apps/desktop/src-tauri/src/rag/chunker.rs`

Responsibility:

- block-aware normalization and chunk generation

Checklist:

- [ ] build breadcrumbs
- [ ] build chunk text
- [ ] preserve block source mapping

### 5. `apps/desktop/src-tauri/src/rag/provider.rs`

Responsibility:

- provider traits and config loading

Checklist:

- [ ] abstract embeddings
- [ ] abstract reranking
- [ ] abstract answer generation

### 6. `apps/desktop/src-tauri/src/rag/repository.rs`

Responsibility:

- all sidecar DB reads and writes

Checklist:

- [ ] page-scoped writes
- [ ] FTS queries
- [ ] vector queries
- [ ] query cache

### 7. `apps/desktop/src-tauri/src/rag/indexer.rs`

Responsibility:

- full rebuild and incremental page indexing

Checklist:

- [ ] compare page hashes
- [ ] regenerate changed chunks
- [ ] write embeddings only when needed

### 8. `apps/desktop/src-tauri/src/rag/retrieval.rs`

Responsibility:

- lexical, vector, and hybrid retrieval

Checklist:

- [ ] implement FTS query
- [ ] implement vector query
- [ ] fuse and dedupe results

### 9. `apps/desktop/src-tauri/src/rag/rerank.rs`

Responsibility:

- reranking layer

Checklist:

- [ ] keep optional
- [ ] operate on fused shortlist only

### 10. `apps/desktop/src-tauri/src/rag/answer.rs`

Responsibility:

- context assembly, prompting, and answer result formatting

Checklist:

- [ ] preserve citations
- [ ] trim to budget
- [ ] handle no-result cleanly

### 11. `apps/desktop/src-tauri/src/rag/mod.rs`

Responsibility:

- module exports and composition

Checklist:

- [ ] re-export public types and entrypoints

### 12. `apps/desktop/src-tauri/src/lib.rs`

Responsibility:

- Tauri command registration and thin command handlers

Checklist:

- [ ] wire new `rag_*` commands
- [ ] keep heavy work off the UI thread
- [ ] keep command bodies minimal

### 13. `apps/desktop/src/entities/search/model/search-types.ts`

Responsibility:

- frontend search result and answer type expansion

Checklist:

- [ ] replace `id/text`-only assumptions
- [ ] add types for hits, citations, answer results, and status

### 14. `apps/desktop/src/pages/main-page/model/use-search.tsx`

Responsibility:

- frontend search state orchestration

Checklist:

- [ ] add mode state
- [ ] call new Tauri commands
- [ ] store rich results and answers
- [ ] preserve result selection behavior

### 15. `apps/desktop/src/pages/main-page/model/search-utils.ts`

Responsibility:

- frontend filtering and local search helpers

Checklist:

- [ ] keep existing history behavior
- [ ] add mode-aware client filtering only where still useful

### 16. `apps/desktop/src/widgets/search/search-pane.tsx`

Responsibility:

- search UI rendering

Checklist:

- [ ] add retrieval mode control
- [ ] add rich result list
- [ ] add answer section with citations

### 17. `apps/desktop/src/widgets/sidebar/sidebar-content.tsx`

Responsibility:

- pass richer search props through the existing sidebar shell

Checklist:

- [ ] update props only as much as needed
- [ ] avoid unrelated sidebar churn

### 18. `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`

Responsibility:

- app-level search integration and jump handling

Checklist:

- [ ] pass richer search state into sidebar
- [ ] support citation jump to `block_uid`
- [ ] optionally trigger indexing after save and on vault load

### 19. `apps/desktop/src/features/autosave/model/use-autosave.ts`

Responsibility:

- save lifecycle hook for dirty-page indexing

Checklist:

- [ ] enqueue incremental indexing after successful save
- [ ] keep autosave latency stable

### 20. `apps/desktop/src/features/vault/model/use-vault-loaders.ts`

Responsibility:

- vault load lifecycle integration

Checklist:

- [ ] fetch index status on load
- [ ] optionally schedule catch-up indexing

### 21. Tests

Files likely to change:

- `apps/desktop/src/pages/main-page/model/use-search.test.tsx` if added
- `apps/desktop/src/widgets/search/search-pane.test.tsx`
- `apps/desktop/src/app.test.tsx`
- `apps/desktop/src/app-editor-ux.test.tsx` if result jump behavior needs app-level coverage
- Rust tests inside each new `rag/*.rs` module

Checklist:

- [ ] add unit coverage first
- [ ] then Tauri command tests
- [ ] then frontend integration tests

## Recommended Order Of Actual Work

If you are implementing this for the first time, follow this order exactly:

1. Rust types and hashing
2. sidecar schema and migrations
3. chunker
4. repository
5. incremental indexer
6. retrieval and fusion
7. rerank layer
8. answer assembly
9. Tauri command wiring
10. frontend search types
11. frontend search state
12. search UI updates
13. save and vault lifecycle hooks
14. operational status UI
15. final validation

## Common Mistakes To Avoid

- Do not index directly from shadow markdown as the primary source.
- Do not return result payloads that lose `page_uid` or `block_uid`.
- Do not store vectors in the main app DB in the first iteration.
- Do not run full rebuild on every page save.
- Do not make the frontend depend on vendor-specific provider response shapes.
- Do not implement answer generation before retrieval quality is acceptable.
- Do not skip rerank as an interface even if the first shipped provider is disabled.
- Do not hide indexing failures silently.
- Do not add UI complexity before the command payloads are stable.

## Final Verification Checklist

- [ ] Sidecar RAG DB is created per vault.
- [ ] Full rebuild works.
- [ ] Dirty-page incremental indexing works.
- [ ] Lexical search works through the new path.
- [ ] Vector search works through the new path.
- [ ] Hybrid search works through the new path.
- [ ] Search hits jump to the correct block.
- [ ] Answer generation returns citations.
- [ ] Citation clicks jump to the correct block.
- [ ] Provider misconfiguration fails clearly.
- [ ] Vault switch resets index state safely.
- [ ] `vp run -r check` passes.
- [ ] `vp run -r test` passes.

## Definition Of Done

This task is done only when all of the following are true:

- the desktop app owns a built-in vault-scoped RAG index
- retrieval supports lexical, vector, and hybrid search
- indexing is incremental after page changes
- search hits preserve page and block identity
- answer generation is grounded in retrieved note content
- answers include source citations
- the feature is covered by tests
- validation commands pass
