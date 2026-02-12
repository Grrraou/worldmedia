#!/usr/bin/env bash
# Parser for Windy Webcams API (https://api.windy.com/webcams)
# Uses API v3. Requires WINDY_API_KEY in .env (or environment).
# Creates: data/channels/<country_code>/windy.json (by country)
#          data/cat_channels/<category_id>/windy.json (by category)
#          Merges category names into data/cat_channels/categories.json
# Requires: curl, jq
# Docs: https://api.windy.com/webcams/version-transfer#list-of-countries-v2

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHANNELS_DIR="${CHANNELS_DIR:-$REPO_ROOT/data/channels}"
CAT_CHANNELS_DIR="${CAT_CHANNELS_DIR:-$REPO_ROOT/data/cat_channels}"
PARSER_NAME="windy"
API_BASE="https://api.windy.com/webcams/api/v3"
SOURCE_URL="https://www.windy.com"
SOURCE_NAME="Windy"

# Load .env from repo root so WINDY_API_KEY is set
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.env"
  set +a
fi

if [[ -z "${WINDY_API_KEY:-}" ]]; then
  echo "windy: WINDY_API_KEY not set (add to .env or environment). Skipping." >&2
  exit 0
fi

API_HEADER="X-WINDY-API-KEY: $WINDY_API_KEY"
INCLUDE="categories,images,location,player,urls"
LIMIT=50

# Fetch JSON from API (optional query string as second arg)
api_get() {
  local path="$1"
  local query="${2:-}"
  local url="${API_BASE}/${path}"
  [[ -n "$query" ]] && url="${url}?${query}"
  curl -sSL -H "$API_HEADER" "$url" 2>/dev/null || echo ""
}

# Append one channel JSON object to country file
append_country_channel() {
  local iso="$1" new_obj="$2"
  local source_file="$CHANNELS_DIR/$iso/$PARSER_NAME.json"
  mkdir -p "$CHANNELS_DIR/$iso"
  if [[ -f "$source_file" ]]; then
    jq -c --argjson new "$new_obj" '.channels += [$new] | .channels |= unique_by(.url)' "$source_file" > "$source_file.tmp" && mv "$source_file.tmp" "$source_file"
  else
    jq -n -c --argjson new "$new_obj" '{channels: [$new]}' > "$source_file"
  fi
}

# Append one channel to category file
append_category_channel() {
  local cat="$1" new_obj="$2"
  local source_file="$CAT_CHANNELS_DIR/$cat/$PARSER_NAME.json"
  mkdir -p "$CAT_CHANNELS_DIR/$cat"
  if [[ -f "$source_file" ]]; then
    jq -c --argjson new "$new_obj" '.channels += [$new] | .channels |= unique_by(.url)' "$source_file" > "$source_file.tmp" && mv "$source_file.tmp" "$source_file"
  else
    jq -n -c --argjson new "$new_obj" '{channels: [$new]}' > "$source_file"
  fi
}

# Build channel object from Windy webcam v3 schema
# Uses player.live or player.day as embed URL (iframe); location.country_code for iso
webcam_to_channel() {
  local w="$1"
  local iso
  iso=$(echo "$w" | jq -r '.location.country_code // "XX"')
  local name
  name=$(echo "$w" | jq -r '.title // "Webcam"')
  local desc
  desc=$(echo "$w" | jq -r '[.location.city, .location.region] | map(select(.)) | join(", ")')
  local logo
  logo=$(echo "$w" | jq -r '.images.current.icon // ""')
  # Prefer live embed, then day embed (both are iframe URLs)
  local url
  url=$(echo "$w" | jq -r 'if .player.live then .player.live else .player.day // "" end')
  if [[ -z "$url" || "$url" == "null" ]]; then
    url=$(echo "$w" | jq -r '.player.day // ""')
  fi
  if [[ -z "$url" || "$url" == "null" ]]; then
    return 1
  fi
  jq -cn \
    --arg iso "$iso" \
    --arg name "$name" \
    --arg desc "$desc" \
    --arg logo "$logo" \
    --arg url "$url" \
    --arg source "$SOURCE_URL" \
    --arg source_name "$SOURCE_NAME" \
    '{iso:$iso, name:$name, description:$desc, logo:$logo, type:"webcam", url:$url, source:$source, source_name:$source_name}'
}

# ---- Countries ----
echo "Windy: fetching countries..." >&2
countries_json=$(api_get "countries" "lang=en")
if [[ -z "$countries_json" ]] || ! echo "$countries_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "Windy: failed to fetch countries or invalid response" >&2
  exit 1
fi

country_codes=$(echo "$countries_json" | jq -r '.[].code')
total_countries=0
for code in $country_codes; do
  [[ -z "$code" ]] && continue
  iso=$(echo "$code" | tr '[:lower:]' '[:upper:]')
  offset=0
  count=0
  while true; do
    query="countries=${code}&limit=${LIMIT}&offset=${offset}&include=${INCLUDE}&lang=en"
    list_json=$(api_get "webcams" "$query")
    if [[ -z "$list_json" ]] || ! echo "$list_json" | jq -e '.webcams' >/dev/null 2>&1; then
      break
    fi
    total=$(echo "$list_json" | jq -r '.total // 0')
    webcams=$(echo "$list_json" | jq -c '.webcams[]')
    if [[ -z "$webcams" ]]; then
      break
    fi
    while IFS= read -r w; do
      [[ -z "$w" ]] && continue
      channel=$(webcam_to_channel "$w") || continue
      append_country_channel "$iso" "$channel"
      count=$((count + 1))
      # Also append to each category file for this webcam
      cats=$(echo "$w" | jq -r '.categories[]?.id // empty')
      for cat_id in $cats; do
        [[ -z "$cat_id" ]] && continue
        append_category_channel "$cat_id" "$channel"
      done
    done <<< "$webcams"
    offset=$((offset + LIMIT))
    [[ $offset -ge "$total" ]] && break
  done
  if [[ "$count" -gt 0 ]]; then
    echo "  $iso: $count webcams" >&2
    total_countries=$((total_countries + 1))
  fi
done

# ---- Categories index (from API) ----
echo "Windy: fetching categories..." >&2
categories_json=$(api_get "categories" "lang=en")
if [[ -n "$categories_json" ]] && echo "$categories_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
  mkdir -p "$CAT_CHANNELS_DIR"
  # Merge Windy category ids into categories.json (list of category names/ids for UI)
  # Windy uses ids like "beach", "city"
  new_json=$(echo "$categories_json" | jq -r '.[].id' | jq -R -s -c 'split("\n") | map(select(length > 0))')
  existing="[]"
  [[ -f "$CAT_CHANNELS_DIR/categories.json" ]] && existing=$(cat "$CAT_CHANNELS_DIR/categories.json")
  echo "$existing" | jq -c --argjson new "$new_json" '(if type == "array" then . else [] end) + $new | unique | sort' > "$CAT_CHANNELS_DIR/categories.json"
  echo "  Updated $CAT_CHANNELS_DIR/categories.json" >&2
fi

echo "Windy: done." >&2
