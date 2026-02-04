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

## Architecture
- App entrypoint: `src/app/mod.rs`
- App state + commands: `src/app/store.rs` (`AppStore`)
- UI root + components: `src/ui/`
- Plugin services: `src/services/`

See `ARCHITECTURE.md` for a longer overview.
