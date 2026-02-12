#!/usr/bin/env bash
# Parser for junguler/m3u-radio-music-playlists (https://github.com/junguler/m3u-radio-music-playlists)
# Root-level .m3u files are categories (genre/decade/language). Radio only; no country split in this source.
# ONLY creates: data/cat_channels/<categoryname>/m3u-radio-music-playlists.json
# Merges this source's category names into data/cat_channels/categories.json (with existing categories).
# Skips aggregate files (---everything-*.m3u, ---sorted.m3u, ---randomized.m3u).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CAT_CHANNELS_DIR="${CAT_CHANNELS_DIR:-$REPO_ROOT/data/cat_channels}"
PARSER_NAME="m3u-radio-music-playlists"
BASE_URL="https://raw.githubusercontent.com/junguler/m3u-radio-music-playlists/main"
API_URL="https://api.github.com/repos/junguler/m3u-radio-music-playlists/contents"
SOURCE_URL="https://github.com/junguler/m3u-radio-music-playlists"
SOURCE_NAME="m3u-radio-music-playlists"

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

# Fetch root contents; only .m3u files, skip ---* aggregates
list_json=$(curl -sSL "$API_URL")
if ! echo "$list_json" | grep -q '"name"'; then
  echo "Failed to fetch repo list from GitHub API" >&2
  exit 1
fi

m3u_files=()
while IFS= read -r name; do
  [[ "$name" =~ \.m3u$ ]] || continue
  [[ "$name" == ---* ]] && continue
  m3u_files+=("$name")
done < <(echo "$list_json" | jq -r '.[] | select(.type=="file" and (.name | test("\\.m3u$"))) | .name')

categories_written=()
for name in "${m3u_files[@]}"; do
  stem="${name%.m3u}"
  url="${BASE_URL}/${name}"
  content=$(curl -sSL "$url" || true)
  if [[ -z "$content" ]]; then
    echo "  skip $name (empty or failed)" >&2
    continue
  fi

  count=0
  prev_extinf=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'\r'}"
    if [[ "$line" == "#EXTINF:"* ]]; then
      prev_extinf="$line"
      continue
    fi
    if [[ -n "$prev_extinf" && -n "$line" && "$line" != \#* ]]; then
      tvg_logo=$(echo "$prev_extinf" | sed -n 's/.*tvg-logo="\([^"]*\)".*/\1/p')
      display_name=$(echo "$prev_extinf" | sed 's/.*,//')
      display_name="${display_name%%$'\r'}"
      ch_name="${display_name# }"
      ch_name="${ch_name% }"
      [[ -z "$ch_name" ]] && ch_name="Radio"
      url_trimmed="${line# }"
      url_trimmed="${url_trimmed% }"
      [[ -z "$url_trimmed" ]] && { prev_extinf=""; continue; }
      if command -v jq >/dev/null 2>&1; then
        new_obj=$(jq -cn \
          --arg iso "XX" \
          --arg name "$ch_name" \
          --arg desc "" \
          --arg logo "$tvg_logo" \
          --arg typ "radio" \
          --arg url "$url_trimmed" \
          --arg source "$SOURCE_URL" \
          --arg source_name "$SOURCE_NAME" \
          '{iso:$iso, name:$name, description:$desc, logo:$logo, type:$typ, url:$url, source:$source, source_name:$source_name}')
      else
        name_escaped=$(echo "$ch_name" | sed 's/\\/\\\\/g; s/"/\\"/g')
        logo_escaped=$(echo "$tvg_logo" | sed 's/\\/\\\\/g; s/"/\\"/g')
        url_escaped=$(echo "$url_trimmed" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_escaped=$(echo "$SOURCE_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
        source_name_escaped=$(echo "$SOURCE_NAME" | sed 's/\\/\\\\/g; s/"/\\"/g')
        new_obj=$(printf '{"iso":"XX","name":"%s","description":"","logo":"%s","type":"radio","url":"%s","source":"%s","source_name":"%s"}' \
          "$name_escaped" "$logo_escaped" "$url_escaped" "$source_escaped" "$source_name_escaped")
      fi
      append_category_channel "$stem" "$new_obj"
      count=$((count + 1))
      prev_extinf=""
    fi
  done <<< "$content"
  categories_written+=("$stem")
  echo "  $stem: $count channels" >&2
done

# Merge our category names into data/cat_channels/categories.json
mkdir -p "$CAT_CHANNELS_DIR"
new_json=$(printf '%s\n' "${categories_written[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')
existing="[]"
[[ -f "$CAT_CHANNELS_DIR/categories.json" ]] && existing=$(cat "$CAT_CHANNELS_DIR/categories.json")
merged=$(echo "$existing" | jq -c --argjson new "$new_json" '(if type == "array" then . else [] end) + $new | unique | sort')
echo "$merged" > "$CAT_CHANNELS_DIR/categories.json"
echo "Updated $CAT_CHANNELS_DIR/categories.json" >&2
