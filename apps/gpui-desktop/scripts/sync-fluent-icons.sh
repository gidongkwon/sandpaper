#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST_PATH="$APP_DIR/icon-manifest.json"
OUTPUT_DIR="$APP_DIR/assets/icons/fluent"
META_PATH="$OUTPUT_DIR/.source.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required" >&2
  exit 1
fi

PACKAGE="$(jq -r '.package' "$MANIFEST_PATH")"
VERSION="$(jq -r '.version' "$MANIFEST_PATH")"

if [ -z "$PACKAGE" ] || [ "$PACKAGE" = "null" ]; then
  echo "ERROR: icon manifest is missing 'package'" >&2
  exit 1
fi

if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "ERROR: icon manifest is missing 'version'" >&2
  exit 1
fi

PACKAGE_ENCODED="$(jq -rn --arg p "$PACKAGE" '$p|@uri')"
UNPKG_BASE_URL="https://unpkg.com/${PACKAGE_ENCODED}@${VERSION}"
UNPKG_META_URL="${UNPKG_BASE_URL}/icons/?meta"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TMP_META="$TMP_DIR/icons-meta.json"
TMP_PATHS="$TMP_DIR/icons-paths.txt"
curl --retry 5 --retry-delay 1 --retry-all-errors -fsSL "$UNPKG_META_URL" -o "$TMP_META"

if ! jq -e '.files and (.files | type == "array")' "$TMP_META" >/dev/null; then
  echo "ERROR: malformed metadata from $UNPKG_META_URL" >&2
  exit 1
fi

jq -r '.files[].path' "$TMP_META" >"$TMP_PATHS"

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR"/*.svg

SELECTED_JSON="$TMP_DIR/selected.jsonl"
while IFS= read -r icon; do
  target="$(printf '%s' "$icon" | jq -r '.target')"
  selected=""
  selected_path=""
  while IFS= read -r candidate; do
    candidate_path="/icons/$candidate"
    if grep -Fxq "$candidate_path" "$TMP_PATHS"; then
      selected="$candidate"
      selected_path="$candidate_path"
      break
    fi
  done < <(printf '%s' "$icon" | jq -r '.candidates[]')

  if [ -z "$selected" ]; then
    icon_id="$(printf '%s' "$icon" | jq -r '.id')"
    echo "ERROR: no candidate found for icon '$icon_id'" >&2
    exit 1
  fi

  download_url="${UNPKG_BASE_URL}${selected_path}"
  curl --retry 5 --retry-delay 1 --retry-all-errors -fsSL "$download_url" -o "$OUTPUT_DIR/$target"

  printf '%s\n' \
    "{\"target\":\"$target\",\"source\":\"$selected\",\"url\":\"$download_url\"}" \
    >>"$SELECTED_JSON"
done < <(jq -c '.icons[]' "$MANIFEST_PATH")

jq -n \
  --arg package "$PACKAGE" \
  --arg version "$VERSION" \
  --arg source "unpkg" \
  --arg sourceUrl "$UNPKG_BASE_URL" \
  --arg fetchedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --slurpfile selected "$SELECTED_JSON" \
  '{
    package: $package,
    version: $version,
    source: $source,
    sourceUrl: $sourceUrl,
    fetchedAt: $fetchedAt,
    icons: $selected
  }' >"$META_PATH"

echo "Synced Fluent icons to $OUTPUT_DIR"
