#!/bin/bash
# Visual QA screenshot helper for Sandpaper gpui-desktop
# Usage: ./scripts/visual-qa.sh [label]
# Finds the sandpaper window, screenshots it, prints the output path.

set -euo pipefail

LABEL="${1:-screenshot}"
OUT_DIR="/tmp/sandpaper-qa"
mkdir -p "$OUT_DIR"
TIMESTAMP=$(date +%H%M%S)
OUT_PATH="$OUT_DIR/${LABEL}-${TIMESTAMP}.png"

# Get window ID via Swift/CoreGraphics
WINDOW_ID=$(swift -e '
import CoreGraphics
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
if let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
    for w in list {
        let name = w["kCGWindowOwnerName"] as? String ?? ""
        let width = (w["kCGWindowBounds"] as? [String: Any])?["Width"] as? Int ?? 0
        if name.lowercased().contains("sandpaper") && width > 100 {
            print(w["kCGWindowNumber"] as? Int ?? 0)
            break
        }
    }
}
' 2>/dev/null)

if [ -z "$WINDOW_ID" ] || [ "$WINDOW_ID" = "0" ]; then
    echo "ERROR: sandpaper window not found. Is the app running?" >&2
    exit 1
fi

screencapture -l"$WINDOW_ID" -x "$OUT_PATH" 2>/dev/null

if [ -f "$OUT_PATH" ]; then
    echo "$OUT_PATH"
else
    echo "ERROR: screencapture failed for window $WINDOW_ID" >&2
    exit 1
fi
