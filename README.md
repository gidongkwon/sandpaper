# Sandpaper

Local-first notes app: Logseq-style outliner + Notion-like blocks, plugin-first, fast at scale.

## Repo layout
- `apps/desktop` — Tauri v2 desktop app (Solid)
- `apps/gpui-desktop` — GPUI native desktop app (Rust)
- `apps/mobile-android` — Android app (read + quick capture)
- `apps/sync-server` — Node sync server (E2E, CRDT ops)
- `packages/*` — Shared packages (core db/model/editor/crypto/sync)
- `docs/BUILD_PLAN.md` — Build plan
- `docs/gpui-port.md` — GPUI port checklist

## Quick start
```sh
# install the Vite+ CLI globally, then open a new terminal
vp install
vp run tauri:dev
```

## Vite+ workflow
- `vp` is a global CLI. Install it once using the official Vite+ instructions, open a new terminal, then use `vp ...` inside the repo.
- Use `vp` as the primary interface for install, lint, check, test, build, and task execution.
- Use built-in commands inside a workspace, such as `vp dev`, `vp build`, `vp lint`, `vp check`, and `vp test`.
- Use `vp run <script>` for custom root scripts. In this repo that includes `vp run tauri:dev`, `vp run tauri:build`, `vp run build:desktop`, and `vp run ready`.
- Use `vp run -r check` and `vp run -r test` for recursive monorepo validation.

GPUI prototype:
```sh
cd apps/gpui-desktop
cargo run
```
