# Sandpaper GPUI Editor Improvements Plan

This plan is written for a junior developer. Each section is a checklist with clear goals, steps, and acceptance criteria. Tackle sections in order.

---

## 0) Orientation & Guardrails

- [ ] Read `apps/gpui-desktop/src/sandpaper_app/render.rs` to understand UI layout and IDs.
- [ ] Read `apps/gpui-desktop/src/sandpaper_app/editor.rs` for editing logic and selection flow.
- [ ] Identify where actions are wired (`actions!` in `apps/gpui-desktop/src/sandpaper_app.rs`).
- [ ] Run `cargo check` from `apps/gpui-desktop` to ensure a clean baseline.

**Acceptance**
- You can locate render functions, action handlers, and selection logic without guessing.

---

## 1) Editor Feel & Selection Reliability

### 1.1 Active block highlight + hover state
- [ ] Add a clear active block style in `render_blocks_list`.
- [ ] Add a subtle hover background for non‑active blocks.
- [ ] Ensure active state is visible even with multiline blocks.

**Acceptance**
- Active block is obvious.
- Hover doesn’t override active styling.

### 1.2 Multi‑block selection (Shift)
- [ ] Verify `PaneSelection` logic: anchor, range, drag behavior.
- [ ] Ensure Shift+click extends selection and doesn’t clear it.
- [ ] Ensure selection is cleared on click without modifiers.

**Acceptance**
- Shift+click selects a range.
- Click without Shift clears selection and sets single active block.

### 1.3 Keep caret visible (auto‑scroll)
- [ ] When active block changes, scroll list to keep it visible.
- [ ] When typing, avoid jumping (only scroll if caret moves out of view).

**Acceptance**
- Arrow navigation never leaves caret off‑screen.

---

## 2) Navigation & Focus

### 2.1 Page switcher behavior
- [ ] Update command palette to prioritize recently opened pages.
- [ ] Add fuzzy search ranking for titles and block snippets.

**Acceptance**
- Recent pages appear first; query filters and ranks results.

### 2.2 Remember last cursor position per page
- [ ] Store `active_ix` and caret offset per page UID.
- [ ] Restore on page switch or reopen.

**Acceptance**
- Switching pages returns you to your last edit location.

---

## 3) Backlinks & References UX

### 3.1 Backlinks panel clarity
- [ ] Include page title + block snippet with consistent spacing.
- [ ] Add “Open in split” action for each backlink.

**Acceptance**
- Backlinks list is readable and actionable.

### 3.2 Unlinked references flow
- [ ] Show match count per reference.
- [ ] Confirm “Link” updates text and keeps selection stable.

**Acceptance**
- Clicking “Link” inserts `[[Title]]` and does not jump focus unpredictably.

---

## 4) Split Pane Improvements

### 4.1 Pane focus + controls
- [ ] Visually indicate which pane is active.
- [ ] Add explicit controls: “Duplicate to split”, “Swap panes”, “Close split”.

**Acceptance**
- You always know which pane you’re editing.

### 4.2 Optional sync scroll
- [ ] Add a toggle to keep panes aligned during scrolling.
- [ ] Default to off to avoid surprise motion.

**Acceptance**
- Sync scroll can be toggled and stays consistent during navigation.

---

## 5) Capture & Review Quality

### 5.1 Capture flow polish
- [ ] Add multi‑line capture input.
- [ ] Add Cmd+Enter submission and a clear confirmation state.

**Acceptance**
- Capture feels fast; no accidental submits.

### 5.2 Review queue usefulness
- [ ] Display due time and page title.
- [ ] Add “Snooze 1 day” and “Snooze 1 week”.
- [ ] Jump to block on “Open”.

**Acceptance**
- Review queue can be completed without confusion.

---

## 6) Visual & Layout Polish

### 6.1 Empty states
- [ ] Add helpful empty messages to editor, backlinks, review, capture.

### 6.2 Density + spacing
- [ ] Standardize padding for list rows and buttons.
- [ ] Keep header compact (reduce vertical space).

**Acceptance**
- UI feels balanced with no dead space or cramped areas.

---

## 7) Quality & Regression Checks

- [ ] `cargo check` passes.
- [ ] Run through manual test checklist:
  - [ ] Create page, type blocks, indent/outdent
  - [ ] Shift+click selection
  - [ ] Split pane, swap, close
  - [ ] Backlinks open/close and open in split
  - [ ] Capture submit
  - [ ] Review: open, done, snooze

**Acceptance**
- No visible regressions vs current behavior.

---

## Suggested Implementation Order

- [ ] 1.1 Active highlight + hover
- [ ] 1.2 Selection correctness
- [ ] 1.3 Auto‑scroll
- [ ] 2.2 Cursor restore
- [ ] 3.1 Backlinks UX
- [ ] 4.1 Split controls
- [ ] 5.1 Capture polish
- [ ] 5.2 Review polish

