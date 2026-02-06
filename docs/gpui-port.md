# GPUI Port Plan (Feature Parity)

This repo currently ships a **Tauri v2 + Solid** desktop app in `apps/desktop`.

Goal: deliver a **GPUI native desktop app** in `apps/gpui-desktop` with full feature parity, then retire the webview UI.

## Strategy
- Keep `apps/desktop` as the “golden reference” until parity.
- Share Rust backend logic via `crates/sandpaper-core` (SQLite, vaults, plugins runtime, assets).
- Extract remaining “app services” (sync/crypto/shadow writer/etc.) out of Tauri into reusable Rust crates as needed.

## Feature parity checklist

### Foundations
- [x] Extract Rust core crate (`crates/sandpaper-core`)
- [ ] Decide how GPUI is vendored (git dep vs submodule vs vendored source)
- [ ] GPUI build + run instructions verified on macOS
- [ ] CI/build scripts updated for the new app (later)

### App shell
- [x] Native window + basic layout (Topbar / Workspace / Overlays)
- [x] Theme + typography baseline (dark mode parity)
- [x] Global keyboard handling + command routing

### Vaults
- [x] List/create/select vault
- [x] Persist active vault + per-vault active page
- [ ] Vault key setup/status (E2E/sync key)

### Navigation + sidebar
- [x] Page list + create/rename
- [x] Search (FTS results)
- [ ] Search filters
- [x] Unlinked references panel

### Editor mode
- [x] Virtualized outliner rendering (50k+ blocks)
- [x] Core block editing (insert/edit/delete)
- [x] Outline ops (split/merge/indent/outdent/move)
- [x] Multi-pane editor (2–3 panes)
- [x] Selection (mouse drag, shift-click, shortcuts)
- [x] Folding + breadcrumbs
- [x] Backlinks panel
- [x] Backlinks toggle
- [x] Diagram/linking/markdown rendering parity where applicable

### Quick capture mode
- [x] Capture pane + save flow

### Review mode
- [x] Review queue summary
- [ ] Review workflow + scheduling

### Overlays
- [x] Command palette
- [x] Notifications panel
- [x] Settings modal
- [x] Confirm dialog (create/rename page)
- [x] Permission prompts (plugins)

### Plugins
- [x] Plugin discovery + enable/disable
- [x] Permission model + grant flow
- [ ] Plugin panel embedding
- [x] Plugin block renderer integration
- [x] Plugin toolbar actions + settings schema UI (toolbar execution placeholder)

### Sync
- [ ] Sync config UI
- [ ] Background push/pull loop
- [ ] Conflict presentation + resolution
- [ ] Sync status in topbar

### Import/Export + attachments
- [ ] Markdown export UI + progress
- [ ] Attachments picker + content-addressed storage

### Perf + diagnostics
- [ ] Perf HUD parity (input-to-paint, scroll FPS)
- [ ] Plugin error reporting UI
- [x] Local agent debug API (inspect tree, curated actions, snapshot metadata)

## Milestones (suggested)
1. **Shell + vault + page list** (native navigation works)
2. **Editor MVP** (single-pane edit, save/load, search)
3. **Editor parity** (virtualization, selection, multi-pane, backlinks)
4. **Overlays + settings + notifications**
5. **Plugins parity**
6. **Sync parity**
7. **Retire Solid/Tauri UI**
