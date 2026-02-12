#!/usr/bin/env bash
# Import media channels from multiple sources.
#
# CONVENTION: The ONLY path format is data/channels/<country_code>/<sourcename>.json
# (e.g. data/channels/FR/iptv-org.json). Parsers create only those files. This script
# runs parsers and builds the global data/channels.json for the site (favorites catalog).
# No other JSON files are created (no data/channels/FR.json etc.).
#
# Usage: ./import.sh [options] [script_name]
#   No args: run all parsers.
#   script_name: run only that parser (e.g. free-tv-iptv, iptv-org).
#   --clean: remove all data/channels content before import (fresh run).
#   --clean-source: with script_name, remove only that source's files before running (rebuild one source).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PARSERS_DIR="$SCRIPT_DIR/parsers"
CHANNELS_DIR="$REPO_ROOT/data/channels"
OUT_FILE="$REPO_ROOT/data/channels.json"
TMP_DIR="${TMPDIR:-/tmp}/worldmedia-import-$$"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

CLEAN=0
CLEAN_SOURCE=0
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)        CLEAN=1; shift ;;
    --clean-source) CLEAN_SOURCE=1; shift ;;
    *)              TARGET="$1"; shift; break ;;
  esac
done
[[ -z "$TARGET" ]] && TARGET="${SCRIPT_NAME:-}"

cd "$REPO_ROOT"
mkdir -p data "$CHANNELS_DIR"

echo "WorldMedia channel import"
echo "========================="

if [[ "$CLEAN" == "1" ]]; then
  echo "Cleaning all channel data..."
  find "$CHANNELS_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} \;
  echo "  -> cleaned $CHANNELS_DIR/"
fi

clean_source_files() {
  local name="$1"
  local count=0
  while IFS= read -r -d '' f; do
    rm -f "$f"
    count=$((count + 1))
  done < <(find "$CHANNELS_DIR" -mindepth 2 -maxdepth 2 -path "*/$name.json" -type f -print0 2>/dev/null)
  if [[ "$count" -gt 0 ]]; then
    echo "  -> removed $count files for source: $name"
  fi
}

ran=
export CHANNELS_DIR
for parser in "$PARSERS_DIR"/*.sh; do
  [[ -x "$parser" ]] || continue
  name=$(basename "$parser" .sh)
  if [[ -n "$TARGET" ]]; then
    [[ "$name" == "$TARGET" || "$name.sh" == "$TARGET" ]] || continue
  fi
  ran=1
  echo "Running parser: $name"
  if [[ "$CLEAN_SOURCE" == "1" && -n "$TARGET" ]]; then
    clean_source_files "$name"
  fi
  if "$parser" 2>"$TMP_DIR/$name.err"; then
    echo "  -> done"
  else
    echo "  -> failed (see $TMP_DIR/$name.err)" >&2
    cat "$TMP_DIR/$name.err" >&2
  fi
done

if [[ -n "$TARGET" && -z "${ran:-}" ]]; then
  echo "No parser matching '$TARGET' found in $PARSERS_DIR" >&2
  exit 1
fi

# Build global data/channels.json ONLY from data/channels/<country_code>/<sourcename>.json (for favorites catalog)
if command -v jq >/dev/null 2>&1; then
  find "$CHANNELS_DIR" -mindepth 2 -maxdepth 2 -name '*.json' -type f -exec jq -c '.channels[]?' {} \; 2>/dev/null |
    jq -s -c '{channels: .}' > "$OUT_FILE"
  echo "Wrote $OUT_FILE"
fi
