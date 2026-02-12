#!/usr/bin/env bash
# Parser for insecam.org (http://www.insecam.org)
# Webcam streams by country (from JSON API) and by tag/place (from JSON API).
# ONLY creates: data/channels/<country_code>/insecam.json (from countries)
#               data/cat_channels/<tagname>/insecam.json (from tags/places)
#               Merges tag names into data/cat_channels/categories.json
# Requires: curl, jq
# Note: Site requires User-Agent header to avoid 403.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHANNELS_DIR="${CHANNELS_DIR:-$REPO_ROOT/data/channels}"
CAT_CHANNELS_DIR="${CAT_CHANNELS_DIR:-$REPO_ROOT/data/cat_channels}"
PARSER_NAME="insecam"
BASE_URL="http://www.insecam.org/en"
SOURCE_URL="http://www.insecam.org"
SOURCE_NAME="Insecam"
CURL_UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

map_country_code() {
  local code="$1"
  echo "$code" | tr '[:lower:]' '[:upper:]'
}

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

# Parse a listing page and extract webcam entries (stream URL + name)
# HTML structure: img tags with src="http://..." and title="Live camera..."
# Stream URLs can be: mjpg/video.mjpg, faststream.jpg, camera?..., etc.
# Output: one line per webcam: "URL|NAME"
parse_listing_page() {
  local url="$1"
  local page=$(curl -sSL -H "User-Agent: $CURL_UA" "$url" 2>/dev/null || echo "")
  if [[ -z "$page" ]]; then
    return
  fi
  # Extract img src URLs (handle multi-line img tags)
  # Pattern: src="http://..." - can span lines
  echo "$page" | grep -oE 'src="http://[^"]+"' | sed 's/src="//; s/"$//' | while read -r stream_url; do
    [[ -z "$stream_url" ]] && continue
    # Skip non-stream URLs (like static images, ads, etc.)
    # Only include URLs that look like webcam streams
    if ! echo "$stream_url" | grep -qE '\.(mjpg|jpg|jpeg|mpeg|mp4|flv|faststream|camera|video)' && \
       ! echo "$stream_url" | grep -qE '(mjpg|faststream|camera|video|stream)'; then
      continue
    fi
    # Decode HTML entities (like &amp; -> &)
    stream_url=$(echo "$stream_url" | sed 's/&amp;/\&/g')
    # Find the title attribute near this URL
    # Look for title="Live camera..." in the same img tag or nearby
    name=$(echo "$page" | grep -A 2 "$stream_url" | grep -oE 'title="Live camera[^"]+"' | head -1 | sed 's/title="//; s/"$//')
    # Fallback: look for <a> tag title that contains this URL
    if [[ -z "$name" ]]; then
      name=$(echo "$page" | grep -B 5 "$stream_url" | grep -oE 'title="Live camera[^"]+"' | head -1 | sed 's/title="//; s/"$//')
    fi
    # Another fallback: extract from img id or nearby text
    if [[ -z "$name" ]]; then
      # Try to get from the <a> tag that wraps the img
      name=$(echo "$page" | grep -B 10 "$stream_url" | grep -oE 'title="[^"]+in [^"]+"' | head -1 | sed 's/title="//; s/"$//')
    fi
    [[ -z "$name" ]] && name="Webcam"
    echo "${stream_url}|${name}"
  done
}

# ---- Countries ----
echo "Parsing countries..." >&2
countries_json=$(curl -sSL -H "User-Agent: $CURL_UA" "${BASE_URL}/jsoncountries/" 2>/dev/null || echo "")
if [[ -n "$countries_json" ]] && echo "$countries_json" | jq -e '.status == "success"' >/dev/null 2>&1; then
  country_codes=$(echo "$countries_json" | jq -r '.countries | keys[]' 2>/dev/null)
  for code in $country_codes; do
    [[ "$code" == "-" ]] && continue
    iso=$(map_country_code "$code")
    country_url="${BASE_URL}/bycountry/${code}/"
    echo "  Processing country: $iso ($code)" >&2
    webcams=$(parse_listing_page "$country_url")
    count=0
    while IFS='|' read -r stream_url name; do
      [[ -z "$stream_url" ]] && continue
      if command -v jq >/dev/null 2>&1; then
        new_obj=$(jq -cn \
          --arg iso "$iso" \
          --arg name "$name" \
          --arg desc "" \
          --arg logo "" \
          --arg typ "webcam" \
          --arg url "$stream_url" \
          --arg source "$SOURCE_URL" \
          --arg source_name "$SOURCE_NAME" \
          '{iso:$iso, name:$name, description:$desc, logo:$logo, type:$typ, url:$url, source:$source, source_name:$source_name}')
      else
        name_escaped=$(echo "$name" | sed 's/\\/\\\\/g; s/"/\\"/g')
        url_escaped=$(echo "$stream_url" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_escaped=$(echo "$SOURCE_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_name_escaped=$(echo "$SOURCE_NAME" | sed 's/\\/\\\\/g; s/"/\\"/g')
        new_obj=$(printf '{"iso":"%s","name":"%s","description":"","logo":"","type":"webcam","url":"%s","source":"%s","source_name":"%s"}' \
          "$iso" "$name_escaped" "$url_escaped" "$source_escaped" "$source_name_escaped")
      fi
      append_country_channel "$iso" "$new_obj"
      count=$((count + 1))
    done <<< "$webcams"
    echo "    $iso: $count webcams" >&2
  done
fi

# ---- Tags/Places/Categories ----
echo "Parsing tags/places..." >&2
tags_json=$(curl -sSL -H "User-Agent: $CURL_UA" "${BASE_URL}/jsontags/" 2>/dev/null || echo "")
if [[ -n "$tags_json" ]] && echo "$tags_json" | jq -e '.status == "success"' >/dev/null 2>&1; then
  tag_names=$(echo "$tags_json" | jq -r '.tags | keys[]' 2>/dev/null)
  tag_categories=()
  for tag in $tag_names; do
    [[ -z "$tag" ]] && continue
    # URL format: /en/bytag/TagName/
    tag_url="${BASE_URL}/bytag/${tag}/"
    echo "  Processing tag: $tag" >&2
    webcams=$(parse_listing_page "$tag_url")
    count=0
    while IFS='|' read -r stream_url name; do
      [[ -z "$stream_url" ]] && continue
      if command -v jq >/dev/null 2>&1; then
        new_obj=$(jq -cn \
          --arg iso "XX" \
          --arg name "$name" \
          --arg desc "" \
          --arg logo "" \
          --arg typ "webcam" \
          --arg url "$stream_url" \
          --arg source "$SOURCE_URL" \
          --arg source_name "$SOURCE_NAME" \
          '{iso:$iso, name:$name, description:$desc, logo:$logo, type:$typ, url:$url, source:$source, source_name:$source_name}')
      else
        name_escaped=$(echo "$name" | sed 's/\\/\\\\/g; s/"/\\"/g')
        url_escaped=$(echo "$stream_url" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_escaped=$(echo "$SOURCE_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_name_escaped=$(echo "$SOURCE_NAME" | sed 's/\\/\\\\/g; s/"/\\"/g')
        new_obj=$(printf '{"iso":"XX","name":"%s","description":"","logo":"","type":"webcam","url":"%s","source":"%s","source_name":"%s"}' \
          "$name_escaped" "$url_escaped" "$source_escaped" "$source_name_escaped")
      fi
      append_category_channel "$tag" "$new_obj"
      count=$((count + 1))
    done <<< "$webcams"
    if [[ "$count" -gt 0 ]]; then
      tag_categories+=("$tag")
      echo "    $tag: $count webcams" >&2
    fi
  done

  # Merge tag names into categories.json
  if [[ ${#tag_categories[@]} -gt 0 ]]; then
    mkdir -p "$CAT_CHANNELS_DIR"
    new_json=$(printf '%s\n' "${tag_categories[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')
    existing="[]"
    [[ -f "$CAT_CHANNELS_DIR/categories.json" ]] && existing=$(cat "$CAT_CHANNELS_DIR/categories.json")
    echo "$existing" | jq -c --argjson new "$new_json" '(if type == "array" then . else [] end) + $new | unique | sort' > "$CAT_CHANNELS_DIR/categories.json"
    echo "Updated $CAT_CHANNELS_DIR/categories.json" >&2
  fi
fi
