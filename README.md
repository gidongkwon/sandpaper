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
pnpm install
pnpm tauri:dev
```

GPUI prototype:
```sh
cd apps/gpui-desktop
cargo run
```
