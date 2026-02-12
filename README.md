# WorldMedia

A world map where you can pick a country to explore TV and radio from that country. This repo starts with a **static flat map** and selectable countries.

## Map data

- **Source:** [Natural Earth](https://www.naturalearthdata.com/) 1:110m countries
- **Format:** GeoJSON  
- **URL:** `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson`

The map uses an **equirectangular projection** (lat/lng → x/y) so the SVG is a simple 2:1 flat map. Country polygons are drawn from the GeoJSON and each country is clickable.

## Run locally

Because the app fetches the GeoJSON from a URL, open it through a local server (not `file://`) to avoid CORS issues.

### Docker

Port is read from `.env` (default `8080`). Copy the example and adjust if needed:

```bash
cp .env.example .env
# Edit .env to set PORT=8080 (or another port)
make build
make start
# Open http://localhost:8080
```

**Live editing:** use `make dev` instead of `make start` to mount the project directory into the container. Edit `index.html`, `styles.css`, or `app.js` on your machine and refresh the browser—no rebuild needed.

### Without Docker

```bash
# Python
python3 -m http.server 8080

# Node (npx)
npx serve .

# Then open http://localhost:8080
```

## Import (channel data)

Channel lists are produced by parsers in `scripts/parsers/`:

- **[Free-TV/IPTV](https://github.com/Free-TV/IPTV)** — `free-tv-iptv`
- **[iptv-org/iptv](https://github.com/iptv-org/iptv)** — `iptv-org` (country playlists from `streams/XX.m3u`)

Data is stored **per source**: `data/channels/<ISO>/<source>.json` (e.g. `FR/free-tv-iptv.json`, `FR/iptv-org.json`). Each parser writes only its own files (and merges/increments within that source). The app still reads `data/channels/<ISO>.json`, which is rebuilt by merging all sources for that country. Re-running one parser does not touch other sources.

```bash
make import                    # run all parsers (each writes its source files)
make import SCRIPT_NAME=iptv-org       # run one parser only (others unchanged)
make import-clean              # remove all channel data, then run import (fresh)
make import-clean-source       # remove only SCRIPT_NAME's files, then re-run that parser
./scripts/import.sh --clean-source iptv-org   # rebuild iptv-org without touching free-tv-iptv
```

To **keep only channels whose stream URL responds** (HTTP 2xx/3xx), use URL validation (slower; requires `curl`):

```bash
make import-validate            # validate every URL, drop dead links
./scripts/import.sh --validate [script_name]   # or VALIDATE_URLS=1
```

With [GNU parallel](https://www.gnu.org/software/parallel/) installed, validation runs in parallel (faster).

## Next steps

- Optionally switch to a globe (e.g. CSS 3D or WebGL) later
