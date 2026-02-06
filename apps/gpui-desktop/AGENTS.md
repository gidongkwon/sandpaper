# AGENTS.md — gpui-desktop

## Visual QA Workflow

After making UI changes to the gpui-desktop app, use this workflow to visually inspect the result and catch issues that only show up on screen.

### Scripts

Both live in `apps/gpui-desktop/scripts/`:

- **`visual-qa.sh [label]`** — Screenshots the running sandpaper window. Outputs the PNG path to stdout.
- **`visual-qa-nav.sh <action>`** — Sends a keystroke to the app to change UI state. Actions: `toggle-sidebar`, `open-palette`, `cycle-panel`, `split-pane`, `open-review`, `close-overlays`, `new-page`.

### Step-by-step

```bash
# 1. Build and launch (from apps/gpui-desktop)
cargo build && cargo run &
sleep 4

# 2. Screenshot the default state
./scripts/visual-qa.sh default
# prints: /tmp/sandpaper-qa/default-HHMMSS.png

# 3. Read the PNG with the Read tool to see it

# 4. Navigate to another state and screenshot again
./scripts/visual-qa-nav.sh toggle-sidebar && sleep 0.5
./scripts/visual-qa.sh sidebar-collapsed

# 5. Repeat for each state you want to inspect
```

### When to use it

- After any UI change (layout, colors, spacing, fonts, icons) to verify it looks correct.
- After a theme change to check both light and dark modes.
- When fixing a visual bug — screenshot before and after.
- During a design pass to systematically check every surface.

### What to check in each screenshot

Evaluate against the Minimal Nordic design principles:

- Cool muted palette — no saturated colors leaking through.
- Generous whitespace — nothing feels cramped.
- Near-invisible borders — they guide the eye, not shout.
- Font weights — MEDIUM for headings, not SEMIBOLD.
- Alignment and spacing consistency across components.
- Context panels — all should use the shared header with tab pills at 360px width.

### Recommended QA checklist

| State | Nav command | What to look for |
|---|---|---|
| Default view | (launch) | Topbar, sidebar, editor, status bar proportions |
| Sidebar collapsed | `toggle-sidebar` | Collapsed rail icons, editor fills space |
| Command palette | `open-palette` | Modal overlay, input field, row styling |
| Context panel cycling | `cycle-panel` (repeat) | Tab pills highlight, panel content changes |
| Split pane | `split-pane` | Divider, dual editor headers |
| Empty page | `new-page` | Empty state card styling |
| Dark mode | Toggle in settings | All of the above in dark theme |

### Pitfalls and how to avoid them

**1. Window ID goes stale after app restart**

`visual-qa.sh` finds the window ID dynamically each time it runs, so this is handled. But if you kill and relaunch the app, wait at least 3-4 seconds before running the screenshot script — the window needs time to appear on screen.

```bash
pkill -f sandpaper-gpui-desktop
cargo run &
sleep 4          # wait for window to render
./scripts/visual-qa.sh default   # now it works
```

**2. `keystroke` doesn't work — use `key code`**

The nav script uses `key code` (numeric keycodes) instead of `keystroke` (character strings). This is intentional. GPUI apps don't reliably receive `keystroke` events from osascript, but `key code` works. If you add a new shortcut to the nav script, look up the macOS key code (not the ASCII character). Reference:

```
B=11, K=40, P=35, \=42, R=15, N=45, Escape=53
```

**3. Accessibility permissions required**

The nav script uses System Events to send keystrokes. The terminal app (Ghostty, Terminal.app, iTerm, etc.) must have accessibility permission granted in System Settings > Privacy & Security > Accessibility. Without it, the `set frontmost` call works but keystrokes are silently dropped — no error, just nothing happens.

**4. `screencapture` fails with "could not create image from window"**

This happens when the window ID is stale (app was restarted) or the window is fully off-screen. Fix: re-run the script (it fetches a fresh window ID) or move the app window to be visible.

**5. Add `sleep` between nav and screenshot**

The app needs a frame or two to re-render after receiving a keystroke. Always add `sleep 0.3` to `sleep 0.5` between a nav command and a screenshot command. The nav script already sleeps 0.3s at the end, but fast UI transitions (like opening the command palette) may need an extra delay.

```bash
# Good
./scripts/visual-qa-nav.sh open-palette && sleep 0.5
./scripts/visual-qa.sh palette

# Bad — may capture mid-transition
./scripts/visual-qa-nav.sh open-palette
./scripts/visual-qa.sh palette
```

**6. Split pane requires editor focus**

The `split-pane` action (Cmd-\\) is bound to the `SandpaperEditor` context. If the editor doesn't have focus (e.g., sidebar or context panel was last interacted with), the keystroke won't trigger. Click into the editor area first, or send a different keystroke that doesn't require context focus.

**7. Screenshots are 2x resolution on Retina displays**

A 1200x760 window produces a 2400x1520 PNG on a Retina Mac. This is normal — the Read tool handles it fine. Don't be alarmed by large file sizes (~150-200KB per screenshot).

**8. Don't leave the app running between builds**

Always kill the old process before relaunching after a rebuild, or you'll screenshot the old version:

```bash
pkill -f sandpaper-gpui-desktop
cargo build && cargo run &
sleep 4
```

## Agent Debug API Workflow

Use this when an AI agent needs structured state + actions beyond screenshot-only checks.

### Start with API enabled

```bash
cd apps/gpui-desktop
SANDPAPER_AGENT_DEBUG=1 cargo run
```

Startup prints the local address and bearer token.

Optional:

- `SANDPAPER_AGENT_DEBUG_ADDR=127.0.0.1:4967`
- `SANDPAPER_AGENT_DEBUG_TOKEN=<fixed-token>`

### Core API calls

```bash
TOKEN="<token from startup log>"

# 1) Health
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:4967/health | jq .

# 2) Inspect tree/state
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:4967/v1/tree | jq .

# 3) Act on a curated element id
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"element_id":"open-command-palette-action","action":"click"}' \
  http://127.0.0.1:4967/v1/act | jq .

# 4) Snapshot (tree + screenshot metadata)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:4967/v1/snapshot | jq .
```

### Notes

- API is local-only and disabled by default.
- Auth is always required (`Authorization: Bearer <token>`).
- Actions are intentionally curated by `element_id + action`; unsupported pairs return structured errors.

## Fluent Icon Workflow

Use `apps/gpui-desktop/icon-manifest.json` to manage pinned Fluent icon version + mappings.

Sync icons into embedded assets with:

```bash
cd apps/gpui-desktop
./scripts/sync-fluent-icons.sh
```

The script writes SVGs to `assets/icons/fluent/` and metadata to `assets/icons/fluent/.source.json`.
