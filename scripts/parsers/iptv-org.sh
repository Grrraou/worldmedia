#!/usr/bin/env bash
# Parser for iptv-org/iptv (https://github.com/iptv-org/iptv)
# Streams are in streams/ as XX.m3u (ISO 3166-1 alpha-2). Only main country playlists
# (e.g. be.m3u, fr.m3u) are used; provider-specific ones (e.g. be_samsung.m3u) are skipped.
# ONLY creates JSON at: data/channels/<country_code>/<sourcename>.json (country_code = ISO 3166-1 alpha-2).
# Use CHANNELS_DIR env to override base dir (default: repo data/channels). Never write outside data/channels/<code>/.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHANNELS_DIR="${CHANNELS_DIR:-$REPO_ROOT/data/channels}"
PARSER_NAME="iptv-org"
BASE_URL="https://raw.githubusercontent.com/iptv-org/iptv/master/streams"
API_URL="https://api.github.com/repos/iptv-org/iptv/contents/streams"
SOURCE_URL="https://github.com/iptv-org/iptv"
SOURCE_NAME="IPTV-org"

append_channel() {
  local iso="$1" new_obj="$2"
  local source_file="$CHANNELS_DIR/$iso/$PARSER_NAME.json"
  mkdir -p "$CHANNELS_DIR/$iso"
  if [[ -f "$source_file" ]]; then
    jq -c --argjson new "$new_obj" '.channels += [$new] | .channels |= unique_by(.url)' "$source_file" > "$source_file.tmp" && mv "$source_file.tmp" "$source_file"
  else
    jq -n -c --argjson new "$new_obj" '{channels: [$new]}' > "$source_file"
  fi
}

# Fetch list of stream files
list_json=$(curl -sSL "$API_URL")
if ! echo "$list_json" | grep -q '"name"'; then
  echo "Failed to fetch streams list from GitHub API" >&2
  exit 1
fi

# Only XX.m3u (exactly two-letter country code), skip e.g. at_plutotv.m3u, au_samsung.m3u
playlists=()
if command -v jq >/dev/null 2>&1; then
  names=$(echo "$list_json" | jq -r '.[].name')
else
  names=$(echo "$list_json" | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+\.m3u"' | sed 's/.*"\([^"]*\)"$/\1/')
fi
while IFS= read -r name; do
  [[ "$name" =~ ^[a-z]{2}\.m3u$ ]] || continue
  iso="${name%.m3u}"
  playlists+=("$iso")
done <<< "$names"

for iso in "${playlists[@]}"; do
  url="${BASE_URL}/${iso}.m3u"
  content=$(curl -sSL "$url" || true)
  if [[ -z "$content" ]]; then
    echo "Failed to download $url" >&2
    continue
  fi

  # Parse M3U: #EXTINF line then URL line (possibly with blank lines in between).
  prev_extinf=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'\r'}"
    if [[ "$line" == "#EXTINF:"* ]]; then
      prev_extinf="$line"
      continue
    fi
    if [[ -n "$prev_extinf" && -n "$line" && "$line" != \#* ]]; then
      tvg_name=$(echo "$prev_extinf" | sed -n 's/.*tvg-name="\([^"]*\)".*/\1/p')
      tvg_logo=$(echo "$prev_extinf" | sed -n 's/.*tvg-logo="\([^"]*\)".*/\1/p')
      display_name=$(echo "$prev_extinf" | sed 's/.*,//')
      display_name="${display_name%%$'\r'}"
      name="${tvg_name:-$display_name}"
      name="${name# }"
      name="${name% }"
      [[ -z "$name" ]] && name="Channel"
      url_trimmed="${line# }"
      url_trimmed="${url_trimmed% }"
      [[ -z "$url_trimmed" ]] && { prev_extinf=""; continue; }
      iso_upper=$(echo "$iso" | tr 'a-z' 'A-Z')
      if command -v jq >/dev/null 2>&1; then
        new_obj=$(jq -cn \
          --arg iso "$iso_upper" \
          --arg name "$name" \
          --arg desc "" \
          --arg logo "$tvg_logo" \
          --arg typ "tv" \
          --arg url "$url_trimmed" \
          --arg source "$SOURCE_URL" \
          --arg source_name "$SOURCE_NAME" \
          '{iso:$iso, name:$name, description:$desc, logo:$logo, type:$typ, url:$url, source:$source, source_name:$source_name}')
      else
        name_escaped=$(echo "$name" | sed 's/\\/\\\\/g; s/"/\\"/g')
        logo_escaped=$(echo "$tvg_logo" | sed 's/\\/\\\\/g; s/"/\\"/g')
        url_escaped=$(echo "$url_trimmed" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_escaped=$(echo "$SOURCE_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_name_escaped=$(echo "$SOURCE_NAME" | sed 's/\\/\\\\/g; s/"/\\"/g')
        new_obj=$(printf '{"iso":"%s","name":"%s","description":"","logo":"%s","type":"tv","url":"%s","source":"%s","source_name":"%s"}' \
          "$iso_upper" "$name_escaped" "$logo_escaped" "$url_escaped" "$source_escaped" "$source_name_escaped")
      fi
      append_channel "$iso_upper" "$new_obj"
      prev_extinf=""
      continue
    fi
  done <<< "$content"
done
