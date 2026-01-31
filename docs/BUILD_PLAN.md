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

## Decision Records (finalized)
- **Block schema**: `blocks(id, uid, page_id, parent_id, sort_key, text, props)` with `props` JSON for indent + metadata; `pages(uid, title)`; `edges(from_block_id, to_block_uid, kind)`; `tags` + `block_tags`; `assets(hash, path, mime_type, size, original_name)`; `kv` for settings.
- **Ordering**: `sort_key` is zero-padded string (`000001`) and reindexed on save; moves reindex the page (v1).
- **Indexing**: FTS5 default tokenizer; `bm25` ranking; explicit indexes on `review_queue(status, due_at)`, `sync_ops(page_id, created_at)`, `blocks(page_id, sort_key)`, and tag joins.
- **Shadow Markdown**: `# Title ^page-id` and `- Block text ^block-id`; plugin metadata stored as HTML comments `<!--sp:{"plugin":"id","data":{...}}-->` appended to the block line; fenced code blocks live inside block text.
- **Interoperability**: export Markdown now, import/export compatibility later with schema versioning.
- **Attachments**: `/assets/<hash>` content-addressed files + DB mapping; GC only after explicit cleanup tool.
- **Packaging**: Tauri bundler for macOS (universal dmg) + Windows (MSI); Android deferred.

## High-level Architecture

### Core Data Model (canonical)
- SQLite WAL
- Tables: `pages`, `blocks`, `edges`, `tags`, `assets`, `kv` (settings), `plugin_perms`, `review_queue`, `sync_ops`, `sync_inbox`
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
- Per-page op log for sync only (custom CRDT)
- All ops encrypted client-side (passphrase-derived key)
- Node sync server stores encrypted ops + metadata
- Auto-merge at block level

## Deferred or Ongoing
- **Mobile constraints** (Phase 4 deferred): Android storage path, background sync limits, offline behavior.
- **Operational plan**: release channels + crash reporting (defer until first beta).

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
- 2026-01-31: FTS search on 100k blocks (in-memory, Rust/rusqlite): 28ms search, 7925ms inserts, 0.063ms avg updates (1k updates).
- 2026-01-31: Phase 1 smoke metrics (dev, browser seed=100000): DCL 1069ms, load 1077ms, JS heap ~122MB, FTS search 28ms.
  - Reproduce: `pnpm dev:desktop` then open `http://localhost:1420/?seed=100000&perf=1` and run `cd apps/desktop/src-tauri && cargo run --bin fts-bench`.

Perf Baseline
- 2026-01-31: Editor input p50 6.2ms, p95 7.8ms (240 samples, perf HUD). Scroll ~61fps.
- 2026-01-31: Search p95 28ms on 100k blocks (FTS, in-memory).

Phase 0 evidence (2026-01-31)
- Editor perf HUD (production build, headless Chromium via Playwright): p50 6.2ms, p95 7.8ms on 240 input events (max samples 160).
- Scroll perf HUD: 61 fps while scrolling the editor pane (90 rAF-driven scroll steps).

Success metrics (Phase 0)
- Editor: p95 input-to-paint < 16ms for 1k edits; scroll stays > 55fps with 50k blocks.
- Search: < 200ms on 100k blocks for common queries.
- DB writes: batch insert 100k blocks in < 10s; incremental updates < 10ms per edit.

Exit criteria
- [x] Editor prototype smooth at 50k+ blocks
- [x] FTS update path works on all edits
- [x] Shadow files match DB deterministically
- [x] CRDT ops prove viable for page-level merge
- [x] Phase 0 success metrics met and documented

---

### Phase 1 — MVP Local App
**Outcome:** usable local app with core editing, search, and plugin loader.

Checklist
 - [x] App shell: Tauri v2 desktop app
- [x] Mode switcher: Quick Capture / Editor / Review
- [x] Vault management: create/select vault
- [x] Vault management: multi-vault, no cross-vault links
- [x] Vault management: config stored in local app data
- [x] SQLite core: schema + migrations
- [x] SQLite core: CRUD for pages/blocks/tags/edges
- [x] SQLite core: FTS5 updates on write
- [x] Editor core: outline ops (split/merge/indent/outdent/move)
- [x] Editor core: block refs + backlinks
- [x] Editor core: multi-pane editor (2-3 panes)
- [x] Search: left panel (FTS + filters)
- [x] Navigation: open results in editor panes
- [x] Navigation: page list + page switching
- [x] Navigation: create/rename pages + persist active page per vault
- [x] Shadow Markdown: batched writer (idle or timer)
- [x] Shadow Markdown: read-only generated `.md` per page
- [x] Attachments: content-addressed storage in `/assets/<hash>`
- [x] Attachments: DB mapping for friendly names
- [x] Plugin loader v1: plugin discovery in `/plugins/<name>/`
- [x] Plugin loader v1: manifest parse + enable/disable
- [x] Plugin loader v1: RPC bridge to sandbox runtime

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
- [x] Local editor usable for daily notes
- [x] Search + backlinks functional
- [x] Plugins can load and register commands
- [x] Phase 1 success metrics met

---

## App Improvements Progress
- 2026-01-31: Phase 5 — Autosave status accuracy completed (save state reflects DB write + error state).
- 2026-01-31: Phase 5 — Shadow writer retries + queue indicator completed.
- 2026-01-31: Phase 5 — Crash-safe migration backups completed (rotate last 3).
- 2026-01-31: Optional stretch — Offline export + import (zip with assets) completed.
- 2026-01-31: Optional stretch — Daily note auto-create completed.
- 2026-01-31: Phase 6 — Permission audit tab completed (missing/unused highlights).
- 2026-01-31: Phase 6 — Plugin error banner + reload action completed.
- 2026-01-31: Phase 7 — Sync activity log completed (push/pull history + copy log).
- 2026-01-31: Phase 7 — Sync conflict UI completed (diff view + resolution controls).
- 2026-01-31: Phase 8 — Large note perf checks added (100k virtual list test + p50/p95 noted).
- 2026-01-31: Phase 8 — Virtual list supports variable heights with stable scroll anchoring.
- 2026-01-31: Phase 9 — Keyboard navigation completed (section jump tabs + command palette).
- 2026-01-31: Phase 9 — Color contrast audit completed (AA-safe text tokens).

### Phase 2 — Plugin System + Core Plugins
**Outcome:** extensible platform, core plugins installed.

Checklist
- [x] Sandbox runtime: separate JS process
- [x] Permissions: strict prompts (default-deny)
- [x] Permissions: store granted permissions
- [x] Plugin API: commands + events
- [x] Plugin API: data access (read/write blocks/pages)
- [x] Plugin API: UI panels + toolbar actions
- [x] Plugin API: renderer extensions (code/diagrams)
- [x] Core plugin: code block renderer
- [x] Core plugin: diagram renderer
- [x] Core plugin: markdown export

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
- [x] Plugins can modify data and UI safely
- [x] Permissions audited and enforced
- [x] Phase 2 success metrics met

---

### Phase 3 — Sync + E2E
**Outcome:** self-hosted sync with automatic merge.

Checklist
- [x] CRDT ops: per-page op log
- [x] CRDT ops: conflict resolution policies
- [x] E2E: passphrase-derived vault key
- [x] E2E: encrypt ops + metadata
- [x] Node sync server: store encrypted ops
- [x] Node sync server: multi-client fan-out
- [x] Node sync server: device onboarding via passphrase
- [x] Background sync: queue + retries
- [x] Background sync: offline-first
- [x] Sync: apply inbound ops to local DB

Implementation details
- Per-page op logs stored locally; server only relays encrypted ops.
- Conflict resolution: delete creates a tombstone that blocks later edits/moves; add can resurrect a deleted block (clock-ordered).
- Vault key derived from passphrase with PBKDF2-SHA256 (AES-GCM key material stored with salt + iterations).
- Sync ops are sealed with AES-256-GCM; op/device metadata stored inside encrypted envelope.
- Sync server in `apps/sync-server` with simple REST endpoints: `/v1/vaults`, `/v1/devices`, `/v1/ops/push`, `/v1/ops/pull`.

Test design
- Unit: op merge tests (concurrent edit/move/delete).
- Crypto: encrypt/decrypt with golden test vectors and tamper detection.
- Integration: two local clients + one server syncing the same page.
- Integration: background sync queues ops while offline and retries with backoff.

Success metrics (Phase 3)
- Sync: < 2s end-to-end propagation on LAN for small edits.
- Merge: 0 data loss in concurrent edit/move/delete test suite.

Exit criteria
- [x] Two clients sync without conflicts
- [x] Server never sees plaintext
- [x] Phase 3 success metrics met

---

### Phase 3.5 — Interoperability (MVP)
**Outcome:** import/export compatibility for shadow Markdown.

Checklist
- [x] Markdown import parser (shadow format)
- [x] Import dedupes missing/duplicate block IDs
- [x] Import UI (paste-based) with status feedback
- [x] Import updates Inbox blocks and shadow writer
- [x] Tests for parser + import UI

Implementation details
- Import parses `# Title ^page-id` header and creates/overwrites that page; missing header falls back to appending in the active page.
- Import warnings are surfaced in UI (ignored lines, missing IDs).

Test design
- Unit: parser handles headers, missing IDs, plugin metadata, and ignored lines.
- UI: browser-mode import renders new blocks and status message.

Success metrics (Phase 3.5)
- Import 5k blocks in < 1s on mid-tier hardware.
- Warnings displayed when input is malformed.

Exit criteria
- [x] Paste-based import works end-to-end
- [x] Phase 3.5 success metrics met

---

### Phase 4 — Review Mode + Android
**Outcome:** read/quick-capture on mobile.

Checklist
- [x] Review mode: daily notes + review queue
- [x] Review mode: templates/hooks for spaced review
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

## Security & Privacy
- Threat model: local adversary, malicious plugin, compromised sync server.
- Key management: passphrase → PBKDF2-SHA256 → AES-256-GCM key; store salt + iterations; no key rotation in v1 (reset + resync); key fingerprint binds devices to vault.
- Plugin isolation: Node sidecar with RPC; default-deny permissions; explicit grants for FS/network/UI/system/clipboard; plugin data stays under vault.
- Update safety: signed app releases planned; plugin signature verification deferred.

## Sync Protocol Details
- Ops format: custom op-log CRDT; payloads are encrypted envelopes.
- Ordering: lamport clock + opId tie-breaker.
- Merge rules: delete creates tombstone; edit/move ignored after delete; add can resurrect if later by clock.
- Onboarding: client derives key, sends key fingerprint; server binds vault + device; no plaintext ever leaves client.
- Server API: cursor-based pagination; no auth beyond vault/device IDs in v1.

## Plugin API Surface
- Manifest: `id`, `name`, `version`, `description`, `permissions`, `entry`, `apiVersion`.
- Commands: register command id/title/description; execute through RPC bridge.
- Events: editor lifecycle + data-change; optional sync events later.
- UI extensions: panels, toolbar actions, renderers for code/diagram.
- Data access: read/write pages + blocks, search; transactional writes in host.
- Permissions: manifest-declared + explicit user grants (default-deny).

## Storage & Migration Policy
- Schema versioning in SQLite with forward-only migrations.
- Shadow Markdown versioning and upgrade strategy.
- Migration tests run in CI (apply N -> N+1; rollback not required).

## Testing & CI
- CI pipeline: `pnpm lint`, `pnpm typecheck`, `pnpm test`, plus `cargo test` for Tauri.
- Perf regression checks: editor p95 input-to-paint + FTS bench; keep under Phase 0 targets.
- Golden files: shadow markdown and export formats.
- Fuzz tests: op merge and serialization round-trips (later).

---

## Open TODOs (deferred)
- Phase 4 Android packaging + background sync (explicitly deferred).
- Release channels and crash reporting (post-beta).
- Import workflows for other formats (Obsidian/Logseq) and plugin signature verification.

---

## Suggested Next Step
- Phase 4 (deferred) or file-based import + multi-page navigation.
