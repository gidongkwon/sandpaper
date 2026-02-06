#!/bin/bash
# Visual QA navigation helper for Sandpaper gpui-desktop
# Sends keystrokes to the app via key codes (more reliable than keystroke).
# Usage: ./scripts/visual-qa-nav.sh <action>
#
# Actions:
#   toggle-sidebar   Cmd-B
#   open-palette     Cmd-K
#   cycle-panel      Cmd-Shift-P
#   split-pane       Cmd-\
#   open-review      Cmd-Shift-R
#   close-overlays   Escape
#   new-page         Cmd-N

set -euo pipefail

ACTION="${1:-}"

if [ -z "$ACTION" ]; then
    echo "Usage: $0 <action>" >&2
    echo "Actions: toggle-sidebar, open-palette, cycle-panel, split-pane, open-review, close-overlays, new-page" >&2
    exit 1
fi

# Bring sandpaper to the front and send key code.
# Key codes: B=11, K=40, P=35, \=42, R=15, N=45, Escape=53
osascript -e '
tell application "System Events"
    tell process "sandpaper-gpui-desktop"
        set frontmost to true
    end tell
    delay 0.3
end tell
' 2>/dev/null

case "$ACTION" in
    toggle-sidebar)
        osascript -e 'tell application "System Events" to key code 11 using {command down}' ;;
    open-palette)
        osascript -e 'tell application "System Events" to key code 40 using {command down}' ;;
    cycle-panel)
        osascript -e 'tell application "System Events" to key code 35 using {command down, shift down}' ;;
    split-pane)
        osascript -e 'tell application "System Events" to key code 42 using {command down}' ;;
    open-review)
        osascript -e 'tell application "System Events" to key code 15 using {command down, shift down}' ;;
    close-overlays)
        osascript -e 'tell application "System Events" to key code 53' ;;
    new-page)
        osascript -e 'tell application "System Events" to key code 45 using {command down}' ;;
    *)
        echo "Unknown action: $ACTION" >&2
        echo "Actions: toggle-sidebar, open-palette, cycle-panel, split-pane, open-review, close-overlays, new-page" >&2
        exit 1 ;;
esac

sleep 0.3
