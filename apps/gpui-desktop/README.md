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
