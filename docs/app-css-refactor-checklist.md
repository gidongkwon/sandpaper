# app.css Refactor Checklist

## Goal

Refactor [app.css](/A:/dev/sandpaper/apps/desktop/src/app/app.css) to make it:

- easier to maintain
- easier to theme
- easier for new contributors to navigate
- safer to extend without adding selector collisions

This document is written so that a junior developer or another AI agent can execute the work with minimal additional context.

## Current Problem Summary

The current [app.css](/A:/dev/sandpaper/apps/desktop/src/app/app.css) contains all of the following in one file:

- design tokens
- theme overrides
- resets
- shared primitive styles
- app layout styles
- feature styles for editor, capture, review, settings, search, sidebar, etc.
- feature-specific overrides on shared primitives

This creates several problems:

- It is hard to find where a style actually comes from.
- Theme-related changes are mixed with feature styling.
- Shared primitives can be accidentally modified by feature selectors.
- The file is too large to refactor safely in one pass.

## Refactor Principles

Follow these rules during the refactor.

- Do not rewrite visuals unless necessary for the refactor.
- Prefer moving code before changing behavior.
- Keep class names stable unless there is a strong reason to rename them.
- Avoid mixing feature styles into primitive files.
- Avoid feature-specific selectors inside shared primitive files.
- Prefer semantic tokens over hardcoded color values.
- Use component alias tokens only when semantic tokens are not enough.
- Keep imports explicit and predictable.
- Make the CSS structure match the code structure.
- Use CSS layers to define ownership and cascade order explicitly.

## Non-Goals

These are not part of this refactor unless explicitly requested.

- Rebuilding the design system from scratch
- Replacing CSS with CSS-in-JS
- Moving everything to CSS modules
- Renaming all classes
- Large visual redesigns

## CSS Layer Strategy

Use CSS layers during this refactor.

Recommended layer order:

```css
@layer reset, tokens, theme, primitives, layout, features, utilities;
```

Meaning of each layer:

- `reset`
  global resets and browser normalization
- `tokens`
  global token definitions only
- `theme`
  theme-specific token overrides only
- `primitives`
  shared UI primitives
- `layout`
  app shell and layout structure
- `features`
  feature-specific styling
- `utilities`
  last-resort helpers only if absolutely necessary

Rules for layers:

- `theme` should override tokens, not component structure.
- `primitives` should not depend on `features`.
- `features` may style feature-owned wrappers around primitives.
- Avoid using `utilities` unless there is a strong documented reason.
- Do not use layers as an excuse to keep poor selector ownership.

Good use of layers:

- a `review.css` file in `@layer features`
- a `button.css` file in `@layer primitives`
- a `dark.css` file that only changes semantic tokens in `@layer theme`

Bad use of layers:

- adding feature-specific overrides inside `@layer primitives`
- putting component layout styles in `@layer theme`
- using `@layer features` to globally override all `.ui-button`

## Target File Structure

Create the following structure under [apps/desktop/src/app/styles](/A:/dev/sandpaper/apps/desktop/src/app/styles).

```text
apps/desktop/src/app/styles/
  index.css
  tokens.css
  base.css
  themes/
    light.css
    dark.css
  primitives/
    button.css
    icon-button.css
    text-field.css
    textarea-field.css
    select-field.css
    slider-field.css
    segmented-tabs.css
    dialog.css
    popover.css
    listbox.css
    combobox.css
    inline-editor.css
  layout/
    app-shell.css
    topbar.css
    sidebar.css
    workspace.css
    focus-panel.css
  features/
    editor.css
    capture.css
    review.css
    settings.css
    search.css
    discovery.css
    notifications.css
```

Notes:

- `index.css` is the only stylesheet imported by [app.tsx](/A:/dev/sandpaper/apps/desktop/src/app/app.tsx).
- `app.css` should eventually disappear after all styles are moved.
- The exact filenames can be adjusted slightly if needed, but the three levels must remain:
  - tokens/base
  - primitives
  - layout/features
- Each file should declare its owning layer explicitly.

## Naming Rules

### Tokens

Use these token families consistently:

- `--bg-*`
- `--fg-*`
- `--border-*`
- `--accent-*`
- `--danger-*`
- `--warning-*`
- `--success-*`
- `--space-*`
- `--radius-*`
- `--shadow-*`
- `--duration-*`
- `--ease-*`

### Component Alias Tokens

Use these only when a component needs a stable semantic layer above generic tokens.

- `--editor-*`
- `--capture-*`
- `--review-*`
- `--settings-*`

Example:

- good: `--review-card-bg`
- good: `--editor-guide-line`
- bad: `--yellow-card-bg`

### Class Rules

- Shared primitive classes stay under `.ui-*`
- Layout classes stay under app shell names like `.topbar-*`, `.sidebar-*`, `.workspace-*`
- Feature classes stay under `.editor-*`, `.capture-*`, `.review-*`, `.settings-*`

## Forbidden Patterns

Do not introduce more of these during the refactor.

- Shared primitive selectors with feature-specific suffixes in primitive files
  - example: `.ui-button.review-reference-card`
- Feature files styling unrelated primitives globally
  - example: `.ui-button { ... }` inside `review.css`
- Hardcoded colors when a token already exists
- Duplicated token values across light and dark themes
- Using selector depth to fix ownership problems
  - example: `.review-pane .editor-pane .ui-button`

## Recommended Migration Strategy

Do not split everything in one PR. Work in phases.

### Phase 1

Move tokens and theme definitions first.

### Phase 2

Move shared primitive styles.

### Phase 3

Move layout styles.

### Phase 4

Move feature styles.

### Phase 5

Remove dead CSS and delete [app.css](/A:/dev/sandpaper/apps/desktop/src/app/app.css).

## Detailed Checklist

### 1. Prepare The New Style Entry Point

- [ ] Create [apps/desktop/src/app/styles](/A:/dev/sandpaper/apps/desktop/src/app/styles).
- [ ] Add [index.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/index.css).
- [ ] Declare the global layer order once in `index.css`.
- [ ] Update [app.tsx](/A:/dev/sandpaper/apps/desktop/src/app/app.tsx) to import `styles/index.css` instead of `app.css`.
- [ ] Keep [app.css](/A:/dev/sandpaper/apps/desktop/src/app/app.css) temporarily imported inside `index.css` if needed for incremental migration.
- [ ] Confirm that the app still renders with no visual breakage after only changing the import path.

### 2. Extract Global Tokens

- [ ] Move all global spacing, radius, shadow, duration, easing tokens into [tokens.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/tokens.css).
- [ ] Move all semantic foreground/background/border tokens into `tokens.css`.
- [ ] Keep raw palette values out of feature files.
- [ ] Introduce missing semantic tokens if the current file relies on hardcoded values in many places.
- [ ] Make sure tokens are defined before any file that consumes them.
- [ ] Wrap token definitions in `@layer tokens`.

### 3. Split Light And Dark Theme Overrides

- [ ] Create [themes/light.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/themes/light.css).
- [ ] Create [themes/dark.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/themes/dark.css).
- [ ] Move `:root[data-theme="light"]` and `:root[data-theme="dark"]` overrides out of `app.css`.
- [ ] Make sure both files only contain token overrides, not feature selectors.
- [ ] Eliminate direct component styling inside theme files.
- [ ] Verify that Light, Dark, and System still work.
- [ ] Wrap theme overrides in `@layer theme`.

### 4. Extract Base Styles

- [ ] Create [base.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/base.css).
- [ ] Move reset rules:
  - `*`
  - `html`
  - `body`
  - `#root`
  - focus reset rules
  - global typography baselines
- [ ] Keep `base.css` free of feature-specific classes.
- [ ] Wrap base/reset rules in `@layer reset`.

### 5. Inventory Shared Primitive Ownership

Before moving primitive CSS, identify all components in [apps/desktop/src/shared/ui](/A:/dev/sandpaper/apps/desktop/src/shared/ui).

- [ ] List every current shared primitive used in the desktop app.
- [ ] Map each primitive to its CSS ownership file.
- [ ] Note feature-specific overrides that currently target shared primitives.
- [ ] Decide whether each override should become:
  - a primitive variant
  - a feature wrapper class
  - a component alias token

### 6. Extract Shared Primitive Styles

#### Buttons

- [ ] Move shared button styles into [primitives/button.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/button.css).
- [ ] Move icon button styles into [primitives/icon-button.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/icon-button.css).
- [ ] Keep `cva` variants in TypeScript aligned with CSS variant classes.
- [ ] Remove feature selectors from button primitive files.
- [ ] Wrap button primitive styles in `@layer primitives`.

#### Form Controls

- [ ] Move shared text field styles into [primitives/text-field.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/text-field.css).
- [ ] Move textarea styles into [primitives/textarea-field.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/textarea-field.css).
- [ ] Move select styles into [primitives/select-field.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/select-field.css).
- [ ] Move slider styles into [primitives/slider-field.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/slider-field.css).
- [ ] Move segmented tab styles into [primitives/segmented-tabs.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/segmented-tabs.css).
- [ ] Wrap form primitive styles in `@layer primitives`.

#### Overlay Primitives

- [ ] Move dialog shell styles into [primitives/dialog.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/dialog.css).
- [ ] Move popover/floating panel styles into [primitives/popover.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/popover.css).
- [ ] Move listbox/search result list styles into [primitives/listbox.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/listbox.css).
- [ ] Move combobox styles into [primitives/combobox.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/combobox.css).
- [ ] Wrap overlay and selection primitives in `@layer primitives`.

#### Inline Editor

- [ ] Move inline editor styles into [primitives/inline-editor.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/primitives/inline-editor.css).
- [ ] Keep markdown display state styling with the inline editor primitive, not in feature files.
- [ ] Wrap inline editor styles in `@layer primitives`.

### 7. Resolve Primitive/Feature Crossovers

- [ ] Search for selectors combining primitive and feature classes.
- [ ] For each case, choose one of these solutions:
  - add a proper primitive variant
  - wrap the primitive in a feature-owned container class
  - introduce a component alias token
- [ ] Remove direct cross-layer selectors where possible.

Examples to actively look for:

- [ ] `.ui-button.review-reference-card`
- [ ] `.searchable-combobox__input--review`
- [ ] any `.ui-*` selector inside editor/capture/review sections that is not a variant

### 8. Extract Layout Styles

#### App Shell

- [ ] Create [layout/app-shell.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/layout/app-shell.css).
- [ ] Move root app shell, full-height layout, app background, and global pane container rules here.
- [ ] Wrap app shell styles in `@layer layout`.

#### Topbar

- [ ] Create [layout/topbar.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/layout/topbar.css).
- [ ] Move only topbar structure and controls here.
- [ ] Keep mode-switch visuals that are primitive-like under segmented tabs if shared.
- [ ] Wrap topbar styles in `@layer layout`.

#### Sidebar And Workspace

- [ ] Create [layout/sidebar.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/layout/sidebar.css).
- [ ] Create [layout/workspace.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/layout/workspace.css).
- [ ] Move split layout, workspace height, sidebar shell, and focus panel ownership here.
- [ ] Wrap layout styles in `@layer layout`.

### 9. Extract Feature Styles

#### Editor

- [ ] Create [features/editor.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/features/editor.css).
- [ ] Move block layout, guide lines, drag handles, inline controls, code preview, outline menu, and page header styles here.
- [ ] Introduce editor-specific alias tokens if repeated values remain.
- [ ] Keep primitive overrides out unless they are true feature wrappers.
- [ ] Wrap editor styles in `@layer features`.

#### Capture

- [ ] Create [features/capture.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/features/capture.css).
- [ ] Move capture thread structure, bubble rows, composer, thread lines, and reply affordances here.
- [ ] Keep `InlineEditor` generic styling outside this file.
- [ ] Wrap capture styles in `@layer features`.

#### Review

- [ ] Create [features/review.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/features/review.css).
- [ ] Move review split layout details, deck animation, reference cards, archive list, and session bar styles here.
- [ ] Introduce alias tokens for review card and divider if needed.
- [ ] Wrap review styles in `@layer features`.

#### Settings

- [ ] Create [features/settings.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/features/settings.css).
- [ ] Move settings-only navigation, grouping, card wrappers, and modal content layout here.
- [ ] Wrap settings styles in `@layer features`.

#### Search And Discovery

- [ ] Create [features/search.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/features/search.css).
- [ ] Create [features/discovery.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/features/discovery.css).
- [ ] Move search pane, backlinks, unlinked references, and discovery-specific layout styles here.
- [ ] Wrap search/discovery styles in `@layer features`.

#### Notifications

- [ ] Create [features/notifications.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/features/notifications.css).
- [ ] Move notification panel and badge styles here.
- [ ] Wrap notification styles in `@layer features`.

### 10. Build The Import Graph

In [index.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/index.css), use an explicit order.

- [ ] Declare `@layer reset, tokens, theme, primitives, layout, features, utilities;`
- [ ] Import `tokens.css`
- [ ] Import theme files
- [ ] Import `base.css`
- [ ] Import primitive files
- [ ] Import layout files
- [ ] Import feature files

Recommended order:

```css
@layer reset, tokens, theme, primitives, layout, features, utilities;

@import "./tokens.css";
@import "./themes/light.css";
@import "./themes/dark.css";
@import "./base.css";

@import "./primitives/button.css";
@import "./primitives/icon-button.css";
@import "./primitives/text-field.css";
@import "./primitives/textarea-field.css";
@import "./primitives/select-field.css";
@import "./primitives/slider-field.css";
@import "./primitives/segmented-tabs.css";
@import "./primitives/dialog.css";
@import "./primitives/popover.css";
@import "./primitives/listbox.css";
@import "./primitives/combobox.css";
@import "./primitives/inline-editor.css";

@import "./layout/app-shell.css";
@import "./layout/topbar.css";
@import "./layout/sidebar.css";
@import "./layout/workspace.css";
@import "./layout/focus-panel.css";

@import "./features/editor.css";
@import "./features/capture.css";
@import "./features/review.css";
@import "./features/settings.css";
@import "./features/search.css";
@import "./features/discovery.css";
@import "./features/notifications.css";
```

### 11. Delete Dead CSS Incrementally

- [ ] After each extraction step, remove the moved rules from [app.css](/A:/dev/sandpaper/apps/desktop/src/app/app.css).
- [ ] Never leave duplicated rules in both places after a step is complete.
- [ ] Use `rg` to confirm the original selectors no longer exist in `app.css`.
- [ ] Only delete [app.css](/A:/dev/sandpaper/apps/desktop/src/app/app.css) after all imports point to `styles/index.css` and no needed rules remain.

### 12. Theming Cleanup

- [ ] Replace repeated hardcoded colors with semantic tokens.
- [ ] Replace feature-local hardcoded colors with feature alias tokens where needed.
- [ ] Ensure light/dark differences live in theme files, not in feature files.
- [ ] Confirm that no feature file contains `:root[data-theme="..."]` overrides unless there is a strong documented reason.
- [ ] Confirm that theme styling uses `@layer theme`, not `@layer features`.

### 13. Verification Checklist

After each phase, manually verify:

- [ ] Light theme still looks correct
- [ ] Dark theme still looks correct
- [ ] System theme still switches correctly
- [ ] Reduced motion mode still works
- [ ] Shared dialogs still layer correctly
- [ ] Popovers still layer correctly
- [ ] Review deck animations still work
- [ ] Capture thread lines still align
- [ ] Editor block controls still align
- [ ] Search and command palette still look correct

## Search Queries To Use During Refactor

These commands help locate problem selectors.

```powershell
rg -n "\.ui-" apps/desktop/src/app/app.css
rg -n "data-theme" apps/desktop/src/app/app.css
rg -n "review-|capture-|editor-|settings-" apps/desktop/src/app/app.css
rg -n "searchable-combobox|action-listbox|ui-button" apps/desktop/src/app/app.css
```

## Suggested Commit Strategy

Do not do this as one giant commit. Use small commits.

Recommended commit sequence:

1. `refactor: add app styles entrypoint`
2. `refactor: extract global css tokens`
3. `refactor: extract shared primitive styles`
4. `refactor: extract app layout styles`
5. `refactor: extract editor feature styles`
6. `refactor: extract capture feature styles`
7. `refactor: extract review feature styles`
8. `refactor: remove legacy app css bundle`

## Definition Of Done

This refactor is done only when all of the following are true.

- [ ] [app.css](/A:/dev/sandpaper/apps/desktop/src/app/app.css) is deleted or reduced to a temporary stub that can be deleted immediately after
- [ ] [app.tsx](/A:/dev/sandpaper/apps/desktop/src/app/app.tsx) imports [styles/index.css](/A:/dev/sandpaper/apps/desktop/src/app/styles/index.css)
- [ ] Theme overrides live in theme files
- [ ] Tokens live in token files
- [ ] CSS layer order is declared once and used consistently
- [ ] Shared primitive CSS is separated from feature CSS
- [ ] Layout CSS is separated from feature CSS
- [ ] Feature files no longer define unrelated primitive behavior
- [ ] Light and Dark themes still work
- [ ] The codebase is easier to navigate by ownership alone

## Final Reminder

The refactor should improve structure first. Do not let “small visual cleanup” expand the scope into a redesign. If a style can be moved without changing output, prefer that over rewriting it.
