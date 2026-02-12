#!/usr/bin/env bash
# Parser for Free-TV/IPTV (https://github.com/Free-TV/IPTV)
# ONLY creates JSON at: data/channels/<country_code>/<sourcename>.json (country_code = ISO 3166-1 alpha-2).
# Use CHANNELS_DIR env to override base dir (default: repo data/channels). Never write outside data/channels/<code>/.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHANNELS_DIR="${CHANNELS_DIR:-$REPO_ROOT/data/channels}"
PARSER_NAME="free-tv-iptv"
MAP_FILE="${SCRIPT_DIR}/../country-iso-map.txt"
BASE_URL="https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists"
API_URL="https://api.github.com/repos/Free-TV/IPTV/contents/playlists"

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

if [[ ! -f "$MAP_FILE" ]]; then
  echo "country-iso-map.txt not found at $MAP_FILE" >&2
  exit 1
fi

get_iso() {
  local key="$1"
  awk -v k="$key" '$1 != "" && $1 !~ /^#/ && $1 == k { print $2; exit }' "$MAP_FILE"
}

# Fetch list of playlist files
list_json=$(curl -sSL "$API_URL")
if ! echo "$list_json" | grep -q '"name"'; then
  echo "Failed to fetch playlist list from GitHub API" >&2
  exit 1
fi

# Get .m3u8 filenames (playlist_<country>.m3u8)
playlists=()
if command -v jq >/dev/null 2>&1; then
  names=$(echo "$list_json" | jq -r '.[].name')
else
  names=$(echo "$list_json" | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+\.m3u8"' | sed 's/.*"\([^"]*\)"$/\1/')
fi
while IFS= read -r name; do
  [[ "$name" =~ ^playlist_.+\.m3u8$ ]] || continue
  stem="${name#playlist_}"
  stem="${stem%.m3u8}"
  iso=$(get_iso "$stem")
  # Use XX for unknown countries so import stores them under "unknown"
  [[ -z "$iso" ]] && iso="XX"
  playlists+=("$stem|$iso")
done <<< "$names"

for entry in "${playlists[@]}"; do
  stem="${entry%%|*}"
  iso="${entry##*|}"
  url="${BASE_URL}/playlist_${stem}.m3u8"
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
    # Next non-empty, non-directive line after EXTINF is the stream URL
    if [[ -n "$prev_extinf" && -n "$line" && "$line" != \#* ]]; then
      # prev_extinf has the EXTINF line, line is the stream URL
      tvg_name=$(echo "$prev_extinf" | sed -n 's/.*tvg-name="\([^"]*\)".*/\1/p')
      tvg_logo=$(echo "$prev_extinf" | sed -n 's/.*tvg-logo="\([^"]*\)".*/\1/p')
      display_name=$(echo "$prev_extinf" | sed 's/.*,//')
      display_name="${display_name%%$'\r'}"
      # Trim and default name
      name="${tvg_name:-$display_name}"
      name="${name# }"
      name="${name% }"
      [[ -z "$name" ]] && name="Channel"
      url_trimmed="${line# }"
      url_trimmed="${url_trimmed% }"
      [[ -z "$url_trimmed" ]] && { prev_extinf=""; continue; }
      source_url="https://github.com/Free-TV/IPTV"
      source_name="Free-TV IPTV"
      if command -v jq >/dev/null 2>&1; then
        new_obj=$(jq -cn \
          --arg iso "$iso" \
          --arg name "$name" \
          --arg desc "" \
          --arg logo "$tvg_logo" \
          --arg typ "tv" \
          --arg url "$url_trimmed" \
          --arg source "$source_url" \
          --arg source_name "$source_name" \
          '{iso:$iso, name:$name, description:$desc, logo:$logo, type:$typ, url:$url, source:$source, source_name:$source_name}')
      else
        name_escaped=$(echo "$name" | sed 's/\\/\\\\/g; s/"/\\"/g')
        logo_escaped=$(echo "$tvg_logo" | sed 's/\\/\\\\/g; s/"/\\"/g')
        url_escaped=$(echo "$url_trimmed" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_escaped=$(echo "$source_url" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_name_escaped=$(echo "$source_name" | sed 's/\\/\\\\/g; s/"/\\"/g')
        new_obj=$(printf '{"iso":"%s","name":"%s","description":"","logo":"%s","type":"tv","url":"%s","source":"%s","source_name":"%s"}' \
          "$iso" "$name_escaped" "$logo_escaped" "$url_escaped" "$source_escaped" "$source_name_escaped")
      fi
      append_channel "$iso" "$new_obj"
      prev_extinf=""
      continue
    fi
  done <<< "$content"
done
