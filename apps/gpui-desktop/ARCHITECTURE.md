# GPUI Desktop Architecture (Sandpaper)

This crate is the native GPUI desktop shell for Sandpaper.

## High-level structure

- `src/app/`
  - `mod.rs`: application entrypoint (`app::run`) and window bootstrapping.
  - `store.rs`: `AppStore` entity (app state + commands). This is the single source of truth for
    editor state, plugins state, settings, and modal/dialog state.
  - `prelude.rs`: shared imports for GPUI + Sandpaper core types.
- `src/ui/`
  - `root.rs`: `UiRoot` (top-level render entity). Observes `AppStore` and delegates rendering.
  - `components/`: rendering logic split into focused modules (layout/sidebar/editor/plugins/etc.).
  - `dialogs/`: GPUI dialog/sheet views.
- `src/services/`
  - `plugins.rs`: plugin discovery/load/install helpers used by the store.

## Data flow

- User input triggers GPUI actions / event handlers in the UI.
- UI handlers call into `AppStore` methods (mutating state and scheduling async work via `cx.spawn`).
- UI re-renders by observing `AppStore` (see `UiRoot` and dialog views).

## Notes

- `AppStore` implements `Render` to satisfy some GPUI component bounds, but the app is mounted
  through `UiRoot` (so UI composition stays centralized in `src/ui/`).

