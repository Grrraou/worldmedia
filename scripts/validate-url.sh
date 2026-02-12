#!/usr/bin/env bash
# Reads one NDJSON line from stdin (channel object with "url").
# Exits 0 and prints the line if the URL responds (HTTP 2xx/3xx); else exits 1.
# Used by import.sh when VALIDATE_URLS=1 or --validate to filter out dead streams.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
line=""
if IFS= read -r line; then
  url=""
  if command -v jq >/dev/null 2>&1; then
    url=$(echo "$line" | jq -r '.url // empty')
  else
    url=$(echo "$line" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  fi
  if [[ -z "$url" || "$url" == "null" ]]; then
    exit 1
  fi
  # HEAD often not allowed for streams; GET with short timeout and discard body.
  # -f: fail on 4xx/5xx, -L: follow redirects, -sS: quiet but show errors
  # User-Agent: some servers block default curl
  if curl -sS -o /dev/null -f -L --max-time 10 --connect-timeout 4 \
    -A "WorldMedia-Import/1.0" \
    "$url" 2>/dev/null; then
    printf '%s\n' "$line"
    exit 0
  fi
fi
exit 1
