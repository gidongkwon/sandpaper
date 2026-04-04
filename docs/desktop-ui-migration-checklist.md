# Desktop UI Migration Checklist

Last updated: 2026-04-04

Scope:
- `apps/desktop`
- Goal: replace remaining manual interactive UI in app code with shared primitives and Kobalte-backed semantics where appropriate
- Status baseline: most dialogs, popovers, comboboxes, listboxes, buttons, switches, checkboxes, text inputs, and segmented controls are already migrated

Conventions for this checklist:
- `[ ]` remaining work
- `[x]` already migrated or intentionally resolved
- `Defer` means likely intentional/manual because of platform or native browser constraints

## Remaining Shared Primitive Work

### Editor pane: raw buttons still in `apps/desktop/src/widgets/editor/editor-pane.tsx`

- [ ] Replace inline wikilink token button at `editor-pane.tsx:2477`
  - Current behavior: rendered `[[Page]]` token is a raw `<button class="wikilink">`
  - Decision needed: keep as raw semantic inline control, or wrap with shared `Button`/new inline-link primitive

- [x] Replace code preview "Edit" button at `editor-pane.tsx:2635`
  - Candidate primitive: shared `Button`
  - Likely variant: small surface action

- [x] Replace code preview "Copy code" button at `editor-pane.tsx:2650`
  - Candidate primitive: shared `Button`
  - Likely variant: small surface or ghost action

- [x] Replace column layout "Add column" button at `editor-pane.tsx:3039`
  - Candidate primitive: shared `Button`

- [x] Replace database preview page button at `editor-pane.tsx:3132`
  - Current behavior: raw button inside table cell opens page
  - Candidate primitive: shared `Button` or new `InlineActionButton`

- [ ] Replace block drag handle at `editor-pane.tsx:3423`
  - Candidate primitive: shared `IconButton`
  - Needs drag behavior preserved exactly

- [ ] Replace block collapse toggle at `editor-pane.tsx:3452`
  - Candidate primitive: shared `IconButton`
  - Must preserve `aria-expanded`

- [ ] Replace to-do checkbox button at `editor-pane.tsx:3489`
  - Best target is probably a shared checkbox-like primitive or dedicated task-toggle primitive
  - Current button semantics may be acceptable, but this is still custom/manual

### Editor pane: raw input still in `apps/desktop/src/widgets/editor/editor-pane.tsx`

- [ ] Review raw input at `editor-pane.tsx:4013`
  - This is the remaining non-primitive editor-local input from the scan
  - Confirm whether it should become shared `TextField` or remain raw for performance/editor reasons

## Remaining Dialog/Input Primitive Work

### Page dialog input

- [x] Replace raw page dialog text input in `apps/desktop/src/pages/main-page/ui/main-page-overlays.tsx:24`
  - Current element: `<input class="modal__input" type="text">`
  - Candidate primitive: shared `TextField`
  - This is the last obvious plain text modal input outside existing primitives

### Slider / range input

- [x] Replace text size range input in `apps/desktop/src/widgets/settings/settings-general-tab.tsx:52`
  - Current element: raw `<input type="range">`
  - Candidate primitive: shared `Slider` primitive
  - This likely needs a new primitive rather than a wrapper around `TextField`

## Remaining Native File Input Review

These are still raw `<input type="file">`. They may remain native, but they should be explicitly decided rather than left implicit.

- [x] Defer: keep native markdown file picker input in `apps/desktop/src/widgets/settings/settings-import-tab.tsx:156`
  - Current usage: hidden file input triggered by shared button
  - Decision: keep native hidden input because browser file selection must remain native

- [x] Defer: keep native offline archive picker input in `apps/desktop/src/widgets/settings/settings-import-tab.tsx:264`
  - Current usage: hidden zip picker
  - Decision: keep native hidden input because archive selection must remain native

- [x] Defer: keep native vault folder picker input in `apps/desktop/src/widgets/settings/settings-vault-tab.tsx:121`
  - Current usage: directory picker via browser-only fallback
  - Decision: keep native hidden input because directory selection relies on browser-native directory picking

- [x] Defer: keep native plugin folder picker input in `apps/desktop/src/widgets/settings/settings-plugins-tab.tsx:194`
  - Current usage: directory picker
  - Decision: keep native hidden input because directory selection relies on browser-native directory picking

## Remaining Platform-Specific Controls Review

- [x] Defer: keep Windows window controls in `apps/desktop/src/widgets/topbar/topbar.tsx:164`
  - Buttons: `Minimize`, `Maximize`, `Close`
  - Decision: keep raw because they are platform chrome controls
  - If migrated anyway, use a dedicated shared `WindowControlButton` primitive rather than generic `IconButton`

## Shared Primitive Gaps To Consider Adding

- [x] Add a shared `Slider` primitive
  - Needed for settings range input

- [ ] Add a dedicated inline link/action primitive if wikilink token buttons should stop using raw `<button>`
  - Could cover inline page links in rendered markdown

- [ ] Add a dedicated task-toggle primitive if to-do checkbox should stop using raw `<button>`
  - Could unify editor task toggles with better semantics than a generic icon button

- [ ] Add a dedicated window-control primitive if Windows chrome buttons should move into shared UI
  - Only worth doing if more than one top-level window/control surface is expected

## Audit / Cleanup Work After Primitive Migration

- [ ] Re-scan `apps/desktop/src` for remaining raw `<button>` after the editor pane batch is done
  - Expected remaining candidates should only be shared primitive implementations and intentional platform/native controls

- [ ] Re-scan `apps/desktop/src` for remaining raw `<input>` after the page dialog and slider decision is done
  - Expected remaining candidates should mostly be shared primitive implementations and native file inputs

- [ ] Re-scan for ad-hoc interactive CSS classes that only exist to style raw controls
  - Candidates already reduced, but editor-pane block-local controls will still leave residue

- [x] Document explicit exceptions in this file once decided
  - Native file inputs
  - Window controls
  - Any editor hot-path controls intentionally left raw

## Suggested Execution Order

- [x] 1. Migrate remaining editor-pane top-level controls
  - Code preview actions
  - Column/database actions

- [ ] 2. Migrate editor block-local controls
  - Drag handle
  - Collapse toggle
  - To-do toggle

- [x] 3. Migrate page dialog text input to shared `TextField`

- [x] 4. Decide and document native file input exceptions

- [x] 5. Add shared `Slider` and migrate settings range input

- [x] 6. Decide and document whether window controls stay raw

- [ ] 7. Final audit sweep for remaining raw controls
