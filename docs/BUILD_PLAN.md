# Local-first Notes App — Build Plan

Date: 2026-01-30

## Goal
Build a Tauri v2 + Solid local-first notes app with Logseq-style outliner + Notion-like blocks, plugin-first architecture, performant at 100k+ notes, with optional self-hosted sync and E2E encryption.

## Locked Decisions
- Hybrid storage: **SQLite canonical** + **per-page shadow Markdown** (read-only, batched).
- **Stable block IDs** inline in Markdown.
- **Content-addressed attachments** (dedupe + integrity).
- **Solid** frontend.
- **Plugin-driven from day one**; sandboxed JS runtime with default-deny permissions.
- App modes: **Quick Capture / Editor / Review**.
- Sync: **SQLite-first**, CRDT **only for sync**, **Node** server.
- Shadow files are **read-only**; no external edits import (for v1).

## Decision Records (must finalize before Phase 1)
- **Block schema**: fields (id, page_id, parent_id, sort_key, text, props JSON), block-level metadata, and inline formatting storage.
- **Indexing strategy**: FTS tokenization, stemming/stop-words, and indexing for tags/props.
- **Shadow Markdown spec**: ID syntax, attribute syntax, code/diagram blocks, and plugin data serialization.
- **Block operations**: canonical order key (fractional index vs integer sequence), move semantics, and undo/redo storage.
- **Interoperability strategy**: import/export formats, forward-compat versioning, and schema upgrade policy.
- **Attachments**: file placement and metadata (mime, size, hash), and GC policy for unused assets.

## High-level Architecture

### Core Data Model (canonical)
- SQLite WAL
- Tables: `pages`, `blocks`, `edges`, `tags`, `assets`, `kv` (settings), `plugin_perms`
- FTS5 index on page title + block content
- Shadow Markdown writer: per-page `.md` file, batch flush on idle

### Editor
- Structured editor (ProseMirror-like document model)
- Outline: split/merge/indent/outdent/reorder
- Block references, backlinks
- Multi-pane editor (2–3 panes)

### Plugins
- JS sandbox runtime in **separate process**
- RPC bridge to app APIs
- Permission model: explicit prompts (FS/network/UI/system/clipboard)
- Plugins stored in vault `/plugins/<name>/`
- APIs: commands + events + UI panels + data transforms + data fetch

### Sync
- Per-page CRDT ops for sync only
- All ops encrypted client-side (passphrase-derived key)
- Node sync server stores encrypted ops + metadata
- Auto-merge at block level

## Missing-to-Implement (address before heavy build-out)
- **Success metrics**: targets for startup time, editor latency, search, memory, sync merge rates.
- **Plugin API surface**: commands, events, UI extensions, data access, permissions, versioning.
- **Security posture**: threat model, plugin sandbox boundaries, key management, update safety.
- **Mobile constraints**: Android storage path, background sync limits, offline behavior.
- **Operational plan**: CI, release channels, crash reporting, migration tests.

---

## Repository Structure (proposed)
```
./
  apps/
    desktop/                  # Tauri v2 app (Solid)
    mobile-android/           # Tauri mobile (read/quick-capture)
    sync-server/              # Node server
  packages/
    core-db/                  # SQLite schema + data layer
    core-model/               # Block model + serialization
    editor-core/              # Editor model + commands
    plugin-runtime/           # Sandbox + RPC protocol
    crypto/                   # E2E encryption helpers
    sync-protocol/            # CRDT ops + serialization
  docs/
    BUILD_PLAN.md
```

If you prefer a single-app repo, we can collapse into `src/` plus `server/`.

---

## Milestones & Checklists

### Phase 0 — Design & Spikes (2-4 weeks)
**Outcome:** validate performance and pick exact libraries.

Checklist
- [x] Editor prototype: minimal outline editor in Solid
- [x] Editor prototype: virtualized rendering for 10k-100k blocks
- [x] Editor prototype: latency profiling (<16ms) and scroll performance
- [x] DB & FTS spike: SQLite schema + FTS5
- [x] DB & FTS spike: search latency at 100k notes
- [x] DB & FTS spike: incremental updates on every block write
- [x] Shadow Markdown: deterministic page -> Markdown serialization
- [x] Shadow Markdown: inline block ID format (`^block-id`)
- [x] Shadow Markdown: batch writer (idle or N seconds)
- [x] Sync POC: block-level ops (add/move/edit/delete)
- [x] Sync POC: per-page op persistence in SQLite
- [x] Sync POC: encrypt ops client-side (passphrase-derived key)

Implementation details
- Editor: keep virtualization logic in `apps/desktop/src/editor/virtual-list.ts` and wire it via a `VirtualList` adapter in the main editor view.
- Profiling: add a small profiling helper (`apps/desktop/src/editor/perf.ts`) that records input-to-paint timing via `performance.mark` and `requestAnimationFrame`.
- DB/FTS spike: implement a throwaway `packages/core-db-spike` (or `apps/desktop/src/db-spike`) using SQLite WAL + FTS5.
- Shadow Markdown: implement a serializer module with stable ordering, then a file writer stub (no real I/O yet).
- Sync POC: define a minimal op format (`add`, `edit`, `move`, `delete`) and a local op log table.

Test design
- Unit: `virtual-list.test.ts` for range math (already in place); add tests for edge cases at high counts.
- Perf smoke: a script that runs 10k block edits and logs p95 input-to-paint; treat regressions as failures.
- DB/FTS: tests that assert FTS results update on insert/update/delete for 100k synthetic rows.
- Shadow Markdown: snapshot tests for a page with nested blocks + refs; ensure deterministic output.
- Sync POC: unit tests for op application order + idempotency; encrypt/decrypt round-trip.

Benchmarks (latest)
- 2026-01-30: FTS search on 100k blocks (in-memory, Rust/rusqlite): ~29ms search, ~5.5s inserts.
  - Reproduce: `cd apps/desktop/src-tauri && cargo run --bin fts-bench`

Success metrics (Phase 0)
- Editor: p95 input-to-paint < 16ms for 1k edits; scroll stays > 55fps with 50k blocks.
- Search: < 200ms on 100k blocks for common queries.
- DB writes: batch insert 100k blocks in < 10s; incremental updates < 10ms per edit.

Exit criteria
- [ ] Editor prototype smooth at 50k+ blocks
- [ ] FTS update path works on all edits
- [ ] Shadow files match DB deterministically
- [ ] CRDT ops prove viable for page-level merge
 - [ ] Phase 0 success metrics met and documented

---

### Phase 1 — MVP Local App
**Outcome:** usable local app with core editing, search, and plugin loader.

Checklist
- [ ] App shell: Tauri v2 desktop app
- [x] Mode switcher: Quick Capture / Editor / Review
- [ ] Vault management: create/select vault
- [ ] Vault management: multi-vault, no cross-vault links
- [x] Vault management: config stored in local app data
- [x] SQLite core: schema + migrations
- [x] SQLite core: CRUD for pages/blocks/tags/edges
- [x] SQLite core: FTS5 updates on write
- [x] Editor core: outline ops (split/merge/indent/outdent/move)
- [ ] Editor core: block refs + backlinks
- [x] Editor core: multi-pane editor (2-3 panes)
- [ ] Search: left panel (FTS + filters)
- [x] Navigation: open results in editor panes
- [ ] Shadow Markdown: batched writer (idle or timer)
- [ ] Shadow Markdown: read-only generated `.md` per page
- [x] Attachments: content-addressed storage in `/assets/<hash>`
- [x] Attachments: DB mapping for friendly names
- [ ] Plugin loader v1: plugin discovery in `/plugins/<name>/`
- [ ] Plugin loader v1: manifest parse + enable/disable
- [ ] Plugin loader v1: RPC bridge to sandbox runtime

Implementation details
- Move DB + model code into `packages/core-db` and `packages/core-model` with a clean API.
- Editor ops live in `packages/editor-core` (pure functions), UI wires them in `apps/desktop`.
- Shadow writer runs on idle in a background worker (or queued task) and writes per-page `.md`.
- Attachments stored as `/assets/<hash>` with a DB mapping table.

Test design
- Unit: editor command tests (split/merge/indent/outdent/move) in `packages/editor-core`.
- Integration: UI tests for keyboard flows (Enter/Tab/Backspace) using Solid Testing Library.
- DB: migration tests (apply N -> N+1) and CRUD invariants.
- Shadow files: golden-file tests for serialization + writer batching.
- Plugin loader: manifest validation and permission gating tests.

Success metrics (Phase 1)
- App startup < 1.5s on mid-tier hardware.
- Editor steady-state memory < 500MB at 100k blocks.
- Search < 200ms p95 for typical queries.

Exit criteria
- [ ] Local editor usable for daily notes
- [ ] Search + backlinks functional
- [ ] Plugins can load and register commands
 - [ ] Phase 1 success metrics met

---

### Phase 2 — Plugin System + Core Plugins
**Outcome:** extensible platform, core plugins installed.

Checklist
- [ ] Sandbox runtime: separate JS process
- [ ] Permissions: strict prompts (default-deny)
- [ ] Permissions: store granted permissions
- [ ] Plugin API: commands + events
- [ ] Plugin API: data access (read/write blocks/pages)
- [ ] Plugin API: UI panels + toolbar actions
- [ ] Plugin API: renderer extensions (code/diagrams)
- [ ] Core plugin: code block renderer
- [ ] Core plugin: diagram renderer
- [ ] Core plugin: markdown export

Implementation details
- Sandbox runs as a sidecar process with JSON-RPC style messages.
- Plugin API surface is versioned (`apiVersion`) and capability-scoped.
- Core plugins ship in-repo and are treated like third-party plugins.

Test design
- Unit: permission evaluation matrix (default-deny, explicit allow).
- Contract: RPC request/response schema tests; version compatibility checks.
- Plugin E2E: load a sample plugin that registers a command + panel and assert it renders.

Success metrics (Phase 2)
- Plugin load time < 200ms for a small plugin set.
- Permission prompts block unauthorized access 100% of the time in tests.

Exit criteria
- [ ] Plugins can modify data and UI safely
- [ ] Permissions audited and enforced
 - [ ] Phase 2 success metrics met

---

### Phase 3 — Sync + E2E
**Outcome:** self-hosted sync with automatic merge.

Checklist
- [ ] CRDT ops: per-page op log
- [ ] CRDT ops: conflict resolution policies
- [ ] E2E: passphrase-derived vault key
- [ ] E2E: encrypt ops + metadata
- [ ] Node sync server: store encrypted ops
- [ ] Node sync server: multi-client fan-out
- [ ] Node sync server: device onboarding via passphrase
- [ ] Background sync: queue + retries
- [ ] Background sync: offline-first

Implementation details
- Per-page op logs stored locally; server only relays encrypted ops.
- Conflict resolution favors block-level merge; record conflicts for UI if needed.
- Sync server in `apps/sync-server` with simple REST/WebSocket endpoints.

Test design
- Unit: op merge tests (concurrent edit/move/delete).
- Crypto: encrypt/decrypt with golden test vectors and tamper detection.
- Integration: two local clients + one server syncing the same page.

Success metrics (Phase 3)
- Sync: < 2s end-to-end propagation on LAN for small edits.
- Merge: 0 data loss in concurrent edit/move/delete test suite.

Exit criteria
- [ ] Two clients sync without conflicts
- [ ] Server never sees plaintext
 - [ ] Phase 3 success metrics met

---

### Phase 4 — Review Mode + Android
**Outcome:** read/quick-capture on mobile.

Checklist
- [ ] Review mode: daily notes + review queue
- [ ] Review mode: templates/hooks for spaced review
- [ ] Android app: read-only browsing
- [ ] Android app: quick capture to inbox
- [ ] Android app: background sync

Implementation details
- Review queue derived from daily notes + tags.
- Android app uses the same core packages with a minimal UI shell.

Test design
- Unit: review queue rules and recurrence logic.
- Integration: capture -> sync -> desktop render.

Success metrics (Phase 4)
- Mobile app: < 3s cold start; capture < 1s to local write.
- Background sync respects OS limits without data loss.

Exit criteria
- [ ] Mobile capture + read works reliably
 - [ ] Phase 4 success metrics met

---

## Performance Targets
- Search < 200ms on 100k notes (FTS5)
- Editor interaction < 16ms per operation
- Shadow file write not blocking UI
 - Startup < 1.5s on mid-tier hardware
 - Steady-state memory < 500MB at 100k blocks

## Risks & Mitigations
- **Out-of-sync** shadow files → rebuild from DB task
- **CRDT complexity** → page-level ops only, keep scope small
- **Plugin stability** → sandbox process + strict permissions

## Security & Privacy (define before Phase 2)
- Threat model: local adversary, malicious plugin, compromised sync server.
- Key management: passphrase KDF parameters, key rotation, recovery policy.
- Plugin isolation: process boundary + restricted APIs; deny-by-default FS/network.
- Update safety: signed releases; plugin signature verification (future).

## Sync Protocol Details (define before Phase 3)
- Choose ops format (CRDT vs op-log) and ordering guarantees.
- Vector clock / lamport strategy for conflict resolution.
- Merge rules for move/edit/delete on the same block.
- Device onboarding flow and key exchange.
- Server API: auth, pagination, and rate limits.

## Plugin API Surface (define before Phase 2)
- Command registration: name, description, shortcut, args schema.
- Event model: editor lifecycle, data-change, and sync events.
- UI extension points: side panels, toolbar buttons, renderers.
- Data access: read/write blocks, search, and transactional updates.
- Permissions: manifest-defined, explicit prompts, stored grants.

## Storage & Migration Policy
- Schema versioning in SQLite with forward-only migrations.
- Shadow Markdown versioning and upgrade strategy.
- Migration tests run in CI (apply N -> N+1; rollback not required).

## Testing & CI (define before Phase 1)
- CI pipeline: lint + typecheck + tests on every PR.
- Perf regression checks: p95 input-to-paint and search latency.
- Golden files: shadow markdown and export formats.
- Fuzz tests: op merge and serialization round-trips.

---

## Open TODOs (for early decisions)
- Pick JS runtime for plugin sandbox (Node sidecar vs embedded runtime)
- Choose editor model implementation details
- Decide exact CRDT library for sync (Yjs vs Automerge vs custom ops)
- Confirm packaging strategy for Windows/macOS/Android
 - Finalize block schema and sort key strategy
 - Decide shadow Markdown syntax for plugin metadata

---

## Suggested Next Step
If you want, I can scaffold the repo and create initial modules for:
- SQLite schema + migration system
- Editor prototype
- Plugin sandbox runtime
