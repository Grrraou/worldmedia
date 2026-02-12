#!/usr/bin/env bash
# Parser for famelack/famelack-channels (https://github.com/famelack/famelack-channels)
# Raw JSON by country (channels/raw/countries/xx.json) and by category (channels/raw/categories/name.json).
# ONLY creates: data/channels/<country_code>/famelack-channels.json (from countries)
#               data/cat_channels/<categoryname>/famelack-channels.json (from categories)
#               data/cat_channels/categories.json (list of category names for the site)
# Each Famelack entry has iptv_urls[] and youtube_urls[]; we emit one channel per entry (prefer IPTV, else YouTube), type tv|youtube.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHANNELS_DIR="${CHANNELS_DIR:-$REPO_ROOT/data/channels}"
CAT_CHANNELS_DIR="${CAT_CHANNELS_DIR:-$REPO_ROOT/data/cat_channels}"
PARSER_NAME="famelack-channels"
BASE_URL="https://raw.githubusercontent.com/famelack/famelack-channels/main/channels/raw"
API_COUNTRIES="https://api.github.com/repos/famelack/famelack-channels/contents/channels/raw/countries"
API_CATEGORIES="https://api.github.com/repos/famelack/famelack-channels/contents/channels/raw/categories"
SOURCE_URL="https://github.com/famelack/famelack-channels"
SOURCE_NAME="Famelack"

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

# Convert Famelack array to our channel format (one JSON object per line). Prefer first iptv_url, else first youtube_url.
# Args: $1 = default iso (for country files, the file's country code)
famelack_convert() {
  local default_iso="${1:-XX}"
  jq -c --arg iso "$default_iso" '
    .[] |
    (.iptv_urls[0] // .youtube_urls[0] // "") as $url |
    select($url != "") |
    (if (.iptv_urls[0] != null) then "tv" else "youtube" end) as $typ |
    ((.country // "xx") | ascii_upcase) as $ch_iso |
    (if $iso == "XX" then (if ($ch_iso | length) == 2 then $ch_iso else "XX" end) else $iso end) as $final_iso |
    {
      iso: $final_iso,
      name: (.name // "Channel"),
      description: "",
      logo: "",
      type: $typ,
      url: $url,
      source: "https://github.com/famelack/famelack-channels",
      source_name: "Famelack"
    }
  ' 2>/dev/null
}

# ---- Countries ----
list_countries=$(curl -sSL "$API_COUNTRIES")
country_files=$(echo "$list_countries" | jq -r '.[] | select(.type=="file" and (.name | test("^[a-z]{2}\\.json$"))) | .name' 2>/dev/null)
for name in $country_files; do
  iso="${name%.json}"
  iso_upper=$(echo "$iso" | tr 'a-z' 'A-Z')
  content=$(curl -sSL "$BASE_URL/countries/$name")
  if ! echo "$content" | jq -e 'type == "array"' >/dev/null 2>&1; then
    continue
  fi
  count=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    append_country_channel "$iso_upper" "$line"
    count=$((count + 1))
  done < <(echo "$content" | famelack_convert "$iso_upper")
  echo "  $iso_upper: $count channels" >&2
done

# ---- Categories ----
list_categories=$(curl -sSL "$API_CATEGORIES")
category_names=()
category_files=$(echo "$list_categories" | jq -r '.[] | select(.type=="file" and (.name | test("\\.json$"))) | .name' 2>/dev/null)
for name in $category_files; do
  [[ "$name" =~ ^[a-zA-Z0-9_-]+\.json$ ]] || continue
  cat="${name%.json}"
  [[ "$cat" == "all-channels" ]] && continue
  content=$(curl -sSL "$BASE_URL/categories/$name")
  if ! echo "$content" | jq -e 'type == "array"' >/dev/null 2>&1; then
    continue
  fi
  category_names+=("$cat")
  count=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    append_category_channel "$cat" "$line"
    count=$((count + 1))
  done < <(echo "$content" | famelack_convert "XX")
  echo "  category $cat: $count channels" >&2
done

# Merge our category names into data/cat_channels/categories.json (with any existing from other parsers)
mkdir -p "$CAT_CHANNELS_DIR"
new_json=$(printf '%s\n' "${category_names[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')
existing="[]"
[[ -f "$CAT_CHANNELS_DIR/categories.json" ]] && existing=$(cat "$CAT_CHANNELS_DIR/categories.json")
echo "$existing" | jq -c --argjson new "$new_json" '(if type == "array" then . else [] end) + $new | unique | sort' > "$CAT_CHANNELS_DIR/categories.json"
echo "Wrote $CAT_CHANNELS_DIR/categories.json" >&2
