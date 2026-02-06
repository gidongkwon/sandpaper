# Sandpaper (GPUI desktop)

Native desktop shell for Sandpaper using [GPUI](https://gpui.rs).

## Run
```sh
cd apps/gpui-desktop
cargo run
```

Notes:
- `gpui` is pulled as a git dependency (you'll need network access on the first build).
- Once dependencies are cached locally, you can run offline: `cargo run --offline`
- If `cargo` isn't on your PATH in this repo environment, use `/Users/chewing/.cargo/bin/cargo`.

## Fluent Icons

This app uses custom Fluent 2 SVG icons embedded from `assets/icons/fluent`.

To refresh pinned icons from `@fluentui/svg-icons`:

```sh
./scripts/sync-fluent-icons.sh
```

Source/version and icon mapping are defined in `icon-manifest.json`.

## AI Agent Debug API

The desktop app can expose a local debug API for agent-driven accessibility/debug workflows.

Enable it explicitly:

```sh
SANDPAPER_AGENT_DEBUG=1 cargo run
```

Optional env vars:

- `SANDPAPER_AGENT_DEBUG_ADDR` (default: `127.0.0.1:4967`)
- `SANDPAPER_AGENT_DEBUG_TOKEN` (if omitted, a random token is generated and printed at startup)

When enabled, startup logs include:

```text
sandpaper agent debug enabled on http://127.0.0.1:4967 with bearer token: <token>
```

Endpoints (all require `Authorization: Bearer <token>`):

- `GET /health`
- `GET /v1/tree`
- `GET /v1/snapshot`
- `POST /v1/act` with JSON body:
  - `{"element_id":"open-command-palette-action","action":"click"}`
  - `{"element_id":"sidebar-search-input","action":"set_text","args":{"text":"inbox"}}`

Example:

```sh
TOKEN="<token from startup>"
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:4967/v1/tree | jq .
```

## Architecture
- App entrypoint: `src/app/mod.rs`
- App state + commands: `src/app/store.rs` (`AppStore`)
- UI root + components: `src/ui/`
- Plugin services: `src/services/`

See `ARCHITECTURE.md` for a longer overview.
