# Sandpaper App — Detailed Improvement Checklist (Junior-Friendly)

This checklist is ordered so you can implement it top‑to‑bottom. Each item includes concrete steps and acceptance criteria. Check items off as you finish them.

---

## Phase 0 — Setup, Safety, and Baseline

- [x] **Confirm local dev workflow works**
  - [x] Run `pnpm install`
  - [x] Run `pnpm dev:desktop` and open the app
  - [x] Run `pnpm test`, `pnpm lint`, `pnpm typecheck`
  - [x] Note current test count and any known failures
  - **Baseline note:** 78 tests total (desktop 41, core-model 16, editor-core 5, crypto 4, sync-protocol 7, sync-server 5). No failures. Dev server needed port 1420 cleared before starting.
  - **Done when:** app runs locally and tests/lint/typecheck pass

- [x] **Add a basic bug report template (internal)**
  - [x] Create `docs/BUG_REPORT.md` with: steps, expected, actual, logs, screenshots
  - [x] Link it from `README.md` (if there is a “Contributing” section) — no section yet
  - **Done when:** there’s a simple bug template that teammates can follow

- [x] **Add a performance baseline note**
  - [x] Record current baseline from `docs/BUILD_PLAN.md`
  - [x] Add a short “Perf Baseline” section to `docs/BUILD_PLAN.md` (if missing)
  - **Done when:** perf baseline is written in docs

---

## Phase 1 — Editor UX Foundations

- [x] **Focus behavior polish**
  - [x] Ensure clicking a block display focuses the textarea at the end
  - [x] Preserve caret position when toggling display → edit
  - [x] Keyboard: `Esc` exits edit mode (blur) but keeps selection
  - **Done when:** edit mode feels predictable and caret doesn’t jump
  - **Suggested tests:** add UI test for focus switch + caret location

- [x] **Inline slash command menu (basic)**
  - [x] When user types `/`, show a small menu near caret
  - [x] Start with 3 commands: “Link to page”, “Insert date”, “Convert to task”
  - [x] Selecting a command should insert text and close menu
  - **Done when:** slash menu works in the editor and does not break typing
  - **Suggested tests:** open menu, select each command, verify block text

- [x] **Block action toolbar improvements**
  - [x] Move hover actions to a consistent row (no jumping)
  - [x] Add tooltip text for each action
  - [x] Add a “Duplicate block” action
  - **Done when:** toolbar is stable and new action works

- [x] **Quick Capture → Editor handoff**
  - [x] After capture, focus the created block
  - [x] Highlight the captured block briefly (1–2s) for visibility
  - **Done when:** capture feels obvious and points to the new block

---

## Phase 2 — Linking & Navigation

- [x] **Wikilink autocomplete**
  - [x] On `[[`, show page title suggestions
  - [x] Allow creating a new page from the list
  - [x] Support alias (`[[Page|Alias]]`) in the UI
  - **Done when:** selecting a suggestion inserts the correct link
  - **Suggested tests:** type `[[`, pick suggestion, assert link text

- [x] **Backlink improvements**
  - [x] Group backlinks by source page (use headings)
  - [x] Show a snippet of the linking block
  - [x] Add “open in new pane” option (if multi-pane exists)
  - **Done when:** backlinks panel shows context and page source

- [x] **Rename page updates backlinks**
  - [x] When renaming a page, rewrite matching `[[Old]]` links
  - [x] Update alias links if `[[Old|Alias]]`
  - [x] Leave unrelated text untouched
  - **Done when:** renaming a page updates all wikilinks
  - **Suggested tests:** rename page and verify text update

- [x] **Link preview (hover)**
  - [x] Hover a wikilink shows a small preview with top 2 blocks
  - [x] Preview has “Open” action
  - **Done when:** hover preview appears and is usable

---

## Phase 3 — Search & Discovery

- [x] **Search highlighting**
  - [x] Highlight matching terms in results
  - [x] Keep result text readable (do not break layout)
  - **Done when:** matches are visually obvious

- [x] **Search history / saved searches**
  - [x] Save last 5 search terms per vault
  - [x] Allow clicking a past search to re-run
  - **Done when:** quick history works and persists

- [x] **Unlinked references panel**
  - [x] Scan for plain text matches to page titles
  - [x] Show “Link it” action to convert to `[[Page]]`
  - **Done when:** can quickly convert references to links

---

## Phase 4 — Markdown & Rendering

- [x] **Improve markdown display**
  - [x] Add support for inline links and basic lists in display mode
  - [x] Ensure display mode matches export formatting (no surprises)
  - **Done when:** display looks like expected markdown

- [x] **Code block UX**
  - [x] Add “Copy” button for code preview
  - [x] Add language badge
  - **Done when:** code blocks can be copied easily

- [ ] **Diagram preview enhancements**
  - [ ] Replace placeholder diagram with real plugin rendering
  - [ ] Add fallback error message on render failure
  - **Done when:** diagrams render or show a clear error

---

## Phase 5 — Data Integrity & Reliability

- [ ] **Autosave status accuracy**
  - [ ] Ensure “Saved” only shows after DB write completes
  - [ ] Show “Save failed” message on write errors
  - **Done when:** autosave status is accurate and reliable

- [ ] **Shadow writer robustness**
  - [ ] Add retry on failed writes
  - [ ] Add a small queue indicator in settings
  - **Done when:** shadow writes recover from transient errors

- [ ] **Crash-safe backups**
  - [ ] Before migration, copy the DB to a backup file
  - [ ] Keep last 3 backups per vault
  - **Done when:** backups exist and rotate correctly

---

## Phase 6 — Plugin System Improvements

- [ ] **Permission audit view**
  - [ ] Add a settings tab showing all plugin permissions
  - [ ] Highlight unused permissions and missing grants
  - **Done when:** there is a clear audit list

- [ ] **Plugin error surface**
  - [ ] If a plugin errors, show a banner in settings
  - [ ] Provide “Reload plugin” action
  - **Done when:** plugin failures are visible and recoverable

---

## Phase 7 — Sync UX (Desktop)

- [ ] **Sync activity log**
  - [ ] Show last 10 sync actions (push/pull)
  - [ ] Provide a “Copy log” button
  - **Done when:** sync history is visible

- [ ] **Sync conflict UI**
  - [ ] If conflict detected, show a diff view for blocks
  - [ ] Let users pick left/right or merge
  - **Done when:** conflicts are surfaced and resolvable

---

## Phase 8 — Performance & Scaling

- [ ] **Large note performance checks**
  - [ ] Add a perf test for 100k blocks (existing perf HUD ok)
  - [ ] Record p50/p95 input times in docs
  - **Done when:** perf numbers are recorded and tracked

- [ ] **Virtual list improvements**
  - [ ] Support variable block heights
  - [ ] Ensure scroll position is stable after edits
  - **Done when:** no jumpiness during edits

---

## Phase 9 — Accessibility & UI Polish

- [ ] **Keyboard navigation**
  - [ ] `Tab` to move between UI sections
  - [ ] `Cmd/Ctrl+K` to open command palette
  - [ ] Ensure focus ring is visible everywhere
  - **Done when:** app is fully usable without a mouse

- [ ] **Color contrast audit**
  - [ ] Check text vs background in both themes
  - [ ] Fix any failing contrast (WCAG AA)
  - **Done when:** all core UI text passes contrast

---

## Phase 10 — Packaging & Release

- [ ] **Release checklist**
  - [ ] Confirm `pnpm lint` and `pnpm typecheck` pass
  - [ ] Update `docs/BUILD_PLAN.md` checkboxes
  - [ ] Generate release notes
  - **Done when:** release checklist is complete

---

## Optional Stretch Goals

- [ ] **Offline export + import** (zip with assets)
- [ ] **Mobile read‑only viewer**
- [ ] **Graph view for wikilinks**
- [ ] **Daily note auto‑create**

---

## Testing Guidance (use throughout)

- [ ] Add tests for every UI feature you touch
- [ ] Prefer `apps/desktop/src/*.test.tsx` for UI behavior
- [ ] Add unit tests for pure helpers in `packages/*`
- [ ] Run `pnpm test` after each feature

---

## Notes for Juniors

- Keep changes small and focused. One feature = one commit.
- When in doubt, write a test first.
- Ask for review if you’re unsure about UX or data changes.
