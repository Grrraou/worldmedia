/**
 * WorldMedia — flat world map with selectable countries
 * GeoJSON: Natural Earth 110m countries (equirectangular projection)
 * Pan & zoom for desktop (drag, wheel) and mobile (drag, pinch).
 */

// Map quality: URLs for each option (10m loaded from Natural Earth when selected)
const GEOJSON_BY_QUALITY = {
  low: "data/countries-110m.geojson",
  medium: "data/countries.geojson",
  high: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson",
};

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 500;
// SVG is rendered at 2× size (2000×1000) for crisper zoom; pan/zoom uses this for centering
const DISPLAY_WIDTH = 2000;
const DISPLAY_HEIGHT = 1000;

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_SENSITIVITY = 0.002;
const PAN_CLICK_THRESHOLD = 5;

/**
 * Equirectangular projection: [lng, lat] -> [x, y]
 * x: 0 = left (lng -180), VIEW_WIDTH = right (lng 180)
 * y: 0 = top (lat 90), VIEW_HEIGHT = bottom (lat -90)
 */
function project(lng, lat) {
  const x = ((lng + 180) / 360) * VIEW_WIDTH;
  const y = ((90 - lat) / 180) * VIEW_HEIGHT;
  return [x, y];
}

/**
 * Convert GeoJSON Polygon or MultiPolygon to SVG path d attribute.
 */
function geometryToPath(geometry) {
  const parts = [];

  function ringToPath(ring) {
    const points = ring.map(([lng, lat]) => project(lng, lat));
    if (points.length < 2) return "";
    const [fx, fy] = points[0];
    let d = `M ${fx} ${fy}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i][0]} ${points[i][1]}`;
    }
    return d + " Z";
  }

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring, i) => {
      parts.push(ringToPath(ring));
    });
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => {
        parts.push(ringToPath(ring));
      });
    });
  }

  return parts.filter(Boolean).join(" ");
}

/** Set by pan/zoom: true after pointer moved (don’t treat as country click) */
let pointerMovedDuringPan = false;

const TOOLTIP_OFFSET = 14;

// Natural Earth sometimes uses -99 for ISO (France, Portugal, Norway). Fallbacks by ISO_A3 and by country name.
const ISO3_TO_ISO2_FALLBACK = { FRA: "FR", PRT: "PT", NOR: "NO", DEU: "DE", GBR: "GB", USA: "US" };
const ISO2_TO_ISO3 = { FR: "FRA", PT: "PRT", NO: "NOR", DE: "DEU", GB: "GBR", US: "USA" };
const NAME_TO_ISO_FALLBACK = {
  France: { iso: "FRA", iso2: "FR" },
  Portugal: { iso: "PRT", iso2: "PT" },
  Norway: { iso: "NOR", iso2: "NO" },
};

function isInvalidIso(v) {
  const s = String(v ?? "").trim();
  return !s || s === "-99" || /^-?\d+$/.test(s);
}

function normalizeIso2(iso2, iso3, name) {
  const s = String(iso2 || "").trim();
  if (s.length === 2 && !isInvalidIso(s)) return s;
  const fromA3 = iso3 && ISO3_TO_ISO2_FALLBACK[String(iso3).toUpperCase()];
  if (fromA3) return fromA3;
  const fromName = name && NAME_TO_ISO_FALLBACK[name];
  return (fromName && fromName.iso2) || "";
}

function normalizeIsoDisplay(iso3, iso2, name) {
  const a3 = String(iso3 || "").trim();
  const a2 = String(iso2 || "").trim();
  if (a3 && !isInvalidIso(a3)) return a3;
  if (a2.length === 2 && !isInvalidIso(a2)) return a2;
  const fromName = name && NAME_TO_ISO_FALLBACK[name];
  if (fromName) return fromName.iso;
  return "";
}

// Flags: Flagcdn.com (ISO 3166-1 alpha-2, lowercase). Sizes: w40, w80, w160.
const FLAG_CDN = "https://flagcdn.com";
function getFlagUrl(iso2, width = 40) {
  if (!iso2 || iso2.length !== 2 || iso2 === "-9") return null;
  const code = String(iso2).toLowerCase();
  if (code === "xx" || /^-?\d+$/.test(code)) return null;
  return `${FLAG_CDN}/w${width}/${code}.png`;
}

function showTooltip(e, pathEl) {
  const tooltip = document.getElementById("map-tooltip");
  if (!tooltip) return;
  const name = pathEl.getAttribute("data-name") || "Unknown";
  const iso = pathEl.getAttribute("data-iso");
  const iso2 = pathEl.getAttribute("data-iso2");
  const flagUrl = getFlagUrl(iso2, 40);
  const flagImg = flagUrl ? `<img class="map-tooltip-flag" src="${escapeHtml(flagUrl)}" alt="" width="40" height="30">` : "";
  tooltip.innerHTML = flagImg + (iso
    ? `<strong class="map-tooltip-name">${escapeHtml(name)}</strong><span class="map-tooltip-iso">${escapeHtml(iso)}</span><span class="map-tooltip-hint">Click to select</span>`
    : `<strong class="map-tooltip-name">${escapeHtml(name)}</strong><span class="map-tooltip-hint">Click to select</span>`);
  tooltip.classList.add("map-tooltip--visible");
  tooltip.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => moveTooltip(e));
}

function moveTooltip(e) {
  const tooltip = document.getElementById("map-tooltip");
  if (!tooltip || !tooltip.classList.contains("map-tooltip--visible")) return;
  const x = e.clientX;
  const y = e.clientY;
  const rect = tooltip.getBoundingClientRect();
  const margin = 8;
  let left = x + TOOLTIP_OFFSET;
  let top = y + TOOLTIP_OFFSET;
  if (left + rect.width + margin > window.innerWidth) left = x - rect.width - TOOLTIP_OFFSET;
  if (top + rect.height + margin > window.innerHeight) top = y - rect.height - TOOLTIP_OFFSET;
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  const tooltip = document.getElementById("map-tooltip");
  if (!tooltip) return;
  tooltip.classList.remove("map-tooltip--visible");
  tooltip.setAttribute("aria-hidden", "true");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** URL state for direct links: ?country=XX&channel=slug */
function getUrlState() {
  const params = new URLSearchParams(window.location.search);
  const country = params.get("country")?.trim().toUpperCase();
  const channel = params.get("channel")?.trim();
  return { country: country && country.length === 2 ? country : null, channel: channel || null };
}

function setUrlState(state) {
  const params = new URLSearchParams();
  if (state.country && state.country.length === 2) params.set("country", state.country.toUpperCase());
  if (state.channel) params.set("channel", state.channel);
  const query = params.toString();
  const hash = window.location.hash || "";
  const url = window.location.pathname + (query ? `?${query}` : "") + hash;
  window.history.replaceState(null, "", url);
}

function channelSlug(ch) {
  const name = (ch.name || "channel").toLowerCase();
  return name.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || "channel";
}

function findChannelBySlug(channels, slug) {
  if (!slug || !Array.isArray(channels)) return null;
  const s = slug.toLowerCase();
  return channels.find((ch) => channelSlug(ch) === s) || null;
}

/** Set by initMap when map is ready; used by favorites to select country and play. */
let currentSelectByIso2 = null;

/** Cached all channels for resolving favorites (iso+slug -> channel). */
let allChannelsCache = null;

async function loadAllChannels() {
  if (allChannelsCache) return allChannelsCache;
  try {
    const res = await fetch("data/channels.json");
    if (!res.ok) return [];
    const data = await res.json();
    allChannelsCache = Array.isArray(data.channels) ? data.channels : [];
    return allChannelsCache;
  } catch {
    return [];
  }
}

function resolveFavoriteChannel(entry) {
  if (!entry || entry.type !== "channel") return null;
  const channels = allChannelsCache || [];
  return findChannelBySlug(
    channels.filter((ch) => (ch.iso || "").toUpperCase() === (entry.iso || "").toUpperCase()),
    entry.slug
  ) || null;
}

// —— Favorites (localStorage) ——
const FAVORITES_STORAGE_KEY = "worldmedia-favorites";

function favId() {
  return "f_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
}

function getFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    const items = Array.isArray(data?.items) ? data.items : [];
    return { items };
  } catch {
    return { items: [] };
  }
}

function setFavorites(data) {
  const payload = { items: Array.isArray(data?.items) ? data.items : [] };
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {}
  dispatchEvent(new CustomEvent("worldmedia-favorites-changed"));
}

/** Flatten to all channel entries (for "is in favorites" check). */
function flattenFavoriteChannels(items) {
  const out = [];
  function walk(arr) {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (it.type === "channel") out.push(it);
      if (it.type === "folder" && Array.isArray(it.children)) walk(it.children);
    }
  }
  walk(items);
  return out;
}

function isChannelInFavorites(iso, slug) {
  const flat = flattenFavoriteChannels(getFavorites().items);
  const normIso = (iso || "").toUpperCase();
  const normSlug = (slug || "").toLowerCase();
  return flat.some((it) => (it.iso || "").toUpperCase() === normIso && (it.slug || "").toLowerCase() === normSlug);
}

function addChannelToFavorites(ch) {
  const iso = (ch.iso || "").toUpperCase();
  const slug = channelSlug(ch);
  if (isChannelInFavorites(iso, slug)) return;
  const data = getFavorites();
  data.items.push({
    id: favId(),
    type: "channel",
    iso,
    slug,
    name: ch.name || "Channel",
  });
  setFavorites(data);
}

function removeFavoriteById(id) {
  function removeFrom(arr) {
    const idx = arr.findIndex((it) => it.id === id);
    if (idx !== -1) {
      arr.splice(idx, 1);
      return true;
    }
    for (const it of arr) {
      if (it.type === "folder" && Array.isArray(it.children) && removeFrom(it.children)) return true;
    }
    return false;
  }
  const data = getFavorites();
  if (removeFrom(data.items)) setFavorites(data);
}

function removeChannelFromFavorites(iso, slug) {
  const flat = flattenFavoriteChannels(getFavorites().items);
  const entry = flat.find(
    (it) => (it.iso || "").toUpperCase() === (iso || "").toUpperCase() && (it.slug || "").toLowerCase() === (slug || "").toLowerCase()
  );
  if (entry) removeFavoriteById(entry.id);
}

function updateFavoritesOrder(items) {
  setFavorites({ items: items || getFavorites().items });
}

function addFolder(name) {
  const data = getFavorites();
  data.items.push({ id: favId(), type: "folder", name: name || "New folder", children: [] });
  setFavorites(data);
}

function moveFavoriteToFolder(itemId, folderId) {
  const data = getFavorites();
  let moved = null;
  function removeFrom(arr) {
    const idx = arr.findIndex((it) => it.id === itemId);
    if (idx !== -1) {
      moved = arr.splice(idx, 1)[0];
      return true;
    }
    for (const it of arr) {
      if (it.type === "folder" && Array.isArray(it.children) && removeFrom(it.children)) return true;
    }
    return false;
  }
  removeFrom(data.items);
  if (!moved) return;
  function addToFolder(arr) {
    for (const it of arr) {
      if (it.id === folderId && it.type === "folder") {
        if (!it.children) it.children = [];
        it.children.push(moved);
        return true;
      }
      if (it.type === "folder" && Array.isArray(it.children) && addToFolder(it.children)) return true;
    }
    return false;
  }
  if (!addToFolder(data.items)) data.items.push(moved);
  setFavorites(data);
}

function moveFavoriteToTopLevel(itemId) {
  const data = getFavorites();
  let moved = null;
  function removeFrom(arr) {
    const idx = arr.findIndex((it) => it.id === itemId);
    if (idx !== -1) {
      moved = arr.splice(idx, 1)[0];
      return true;
    }
    for (const it of arr) {
      if (it.type === "folder" && Array.isArray(it.children) && removeFrom(it.children)) return true;
    }
    return false;
  }
  removeFrom(data.items);
  if (moved) {
    data.items.push(moved);
    setFavorites(data);
  }
}

function getFavoriteFolders() {
  const folders = [];
  function walk(items) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (it.type === "folder") folders.push({ id: it.id, name: it.name || "Folder" });
      if (it.type === "folder" && Array.isArray(it.children)) walk(it.children);
    }
  }
  walk(getFavorites().items);
  return folders;
}

// —— Trash (localStorage): hide channels from lists, no folders ——
const TRASH_STORAGE_KEY = "worldmedia-trash";

function getTrash() {
  try {
    const raw = localStorage.getItem(TRASH_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function setTrash(list) {
  const payload = Array.isArray(list) ? list : [];
  try {
    localStorage.setItem(TRASH_STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {}
  dispatchEvent(new CustomEvent("worldmedia-trash-changed"));
}

function isChannelInTrash(iso, slug) {
  const list = getTrash();
  const normIso = (iso || "").toUpperCase();
  const normSlug = (slug || "").toLowerCase();
  return list.some((e) => (e.iso || "").toUpperCase() === normIso && (e.slug || "").toLowerCase() === normSlug);
}

function addChannelToTrash(ch) {
  const iso = (ch.iso || "").toUpperCase();
  const slug = channelSlug(ch);
  if (isChannelInTrash(iso, slug)) return;
  const list = getTrash();
  list.push({ iso, slug, name: ch.name || "Channel" });
  setTrash(list);
}

function removeChannelFromTrash(iso, slug) {
  const list = getTrash().filter(
    (e) => (e.iso || "").toUpperCase() !== (iso || "").toUpperCase() || (e.slug || "").toLowerCase() !== (slug || "").toLowerCase()
  );
  setTrash(list);
}

function emptyTrash() {
  setTrash([]);
}

function moveFavoriteUpDown(itemId, dir) {
  const data = getFavorites();
  function flatWithPath(items, pathPrefix) {
    const out = [];
    items.forEach((it, i) => {
      const path = [...pathPrefix, i];
      out.push({ item: it, path });
      if (it.type === "folder" && Array.isArray(it.children)) {
        out.push(...flatWithPath(it.children, [...path, "children"]));
      }
    });
    return out;
  }
  const flat = flatWithPath(data.items, ["items"]);
  const idx = flat.findIndex((e) => e.item.id === itemId);
  if (idx < 0) return;
  const targetIdx = dir === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= flat.length) return;
  const a = flat[idx];
  const b = flat[targetIdx];
  const getParent = (path) => {
    const parentPath = path.slice(0, -1);
    return parentPath.reduce((o, k) => o[k], data);
  };
  const aArr = getParent(a.path);
  const bArr = getParent(b.path);
  if (aArr !== bArr) return;
  const i = a.path[a.path.length - 1];
  const j = b.path[b.path.length - 1];
  const tmp = aArr[i];
  aArr[i] = aArr[j];
  aArr[j] = tmp;
  setFavorites(data);
}

/** Current HLS.js instance for the TV player; destroyed when modal closes. */
let playerHls = null;

/** Channel currently shown in the player modal (for favorites star). */
let currentPlayerChannel = null;

function isHlsUrl(url) {
  return /\.m3u8(\?|$)/i.test(url) || url.includes("m3u8");
}

/**
 * Open the player modal for a channel (TV or radio) and start streaming.
 * Uses hls.js for HLS (.m3u8) streams so they work in Chrome/Firefox as well as Safari.
 */
function openPlayerModal(channel) {
  const modal = document.getElementById("player-modal");
  const errorEl = document.getElementById("player-error");
  // Hide any previous error as soon as we open the player
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
  const trashBtnEl = document.getElementById("player-modal-trash");
  if (trashBtnEl) trashBtnEl.hidden = true;

  const titleEl = document.getElementById("player-modal-title");
  const logoEl = document.getElementById("player-modal-logo");
  const tvWrap = document.getElementById("player-tv-wrap");
  const radioWrap = document.getElementById("player-radio-wrap");
  const youtubeWrap = document.getElementById("player-youtube-wrap");
  const youtubeIframe = document.getElementById("player-youtube-iframe");
  const webcamWrap = document.getElementById("player-webcam-wrap");
  const webcamImage = document.getElementById("player-webcam-image");
  const webcamIframe = document.getElementById("player-webcam-iframe");
  const videoEl = document.getElementById("player-video");
  const audioEl = document.getElementById("player-audio");
  if (!modal || !titleEl || !tvWrap || !radioWrap || !videoEl || !audioEl || !errorEl) return;

  const url = channel.url && channel.url.trim();
  const mediaType = String(channel.type || "tv").toLowerCase();
  const isRadio = mediaType === "radio";
  const isYoutube = mediaType === "youtube";
  const isWebcam = mediaType === "webcam";

  // Stop any current playback and clear
  if (playerHls) {
    playerHls.destroy();
    playerHls = null;
  }
  videoEl.pause();
  audioEl.pause();
  videoEl.removeAttribute("src");
  videoEl.load();
  audioEl.removeAttribute("src");
  audioEl.load();

  currentPlayerChannel = channel;
  titleEl.textContent = channel.name || "Channel";

  const typeLabels = { tv: "TV", radio: "Radio", youtube: "YouTube", webcam: "Webcam" };
  const typeLabel = typeLabels[mediaType] || "TV";
  const desc = (channel.description && String(channel.description).trim()) || "";
  const sourceLabel = (channel.source_name && String(channel.source_name).trim()) || (channel.source && String(channel.source).trim()) || "";
  const seoEl = document.getElementById("player-modal-seo");
  if (seoEl) {
    const parts = [`Watch ${channel.name || "Channel"} — ${typeLabel} stream.`];
    if (desc) parts.push(desc);
    if (sourceLabel) parts.push(`Source: ${sourceLabel}.`);
    seoEl.textContent = parts.join(" ");
    seoEl.hidden = false;
  }

  if (channel.logo) {
    logoEl.src = channel.logo;
    logoEl.alt = "";
    logoEl.hidden = false;
  } else {
    logoEl.hidden = true;
  }
  const sourceEl = document.getElementById("player-modal-source");
  if (sourceEl) {
    const src = channel.source && String(channel.source).trim();
    const sourceName = channel.source_name && String(channel.source_name).trim();
    if (src || sourceName) {
      sourceEl.hidden = false;
      let label = sourceName;
      if (!label && src) {
        if (src.startsWith("http")) {
          try {
            label = new URL(src).hostname;
          } catch (_) {
            label = src;
          }
        } else {
          label = src;
        }
      }
      sourceEl.textContent = label || "Source";
      if (src && src.startsWith("http")) {
        sourceEl.href = src;
        sourceEl.target = "_blank";
        sourceEl.rel = "noopener noreferrer";
        sourceEl.title = src;
      } else {
        sourceEl.removeAttribute("href");
        sourceEl.removeAttribute("target");
        sourceEl.removeAttribute("rel");
        sourceEl.removeAttribute("title");
      }
    } else {
      sourceEl.hidden = true;
      sourceEl.removeAttribute("href");
    }
  }

  tvWrap.hidden = (isRadio || isYoutube || isWebcam);
  radioWrap.hidden = !isRadio;
  if (youtubeWrap) youtubeWrap.hidden = !isYoutube;
  if (youtubeIframe) youtubeIframe.src = "";
  if (webcamWrap) webcamWrap.hidden = !isWebcam;
  if (webcamImage) webcamImage.src = "";
  if (webcamIframe) {
    webcamIframe.removeAttribute("src");
    webcamIframe.hidden = true;
  }

  if (!url) {
    errorEl.textContent = "No stream URL for this channel.";
    errorEl.hidden = false;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    return;
  }

  if (isWebcam) {
    const isWindyEmbed = /windy\.com/i.test(url);
    if (isWindyEmbed && webcamIframe) {
      webcamIframe.hidden = false;
      webcamIframe.src = url.startsWith("http") ? url : `https://embed.windy.com/${url}`;
      if (webcamImage) webcamImage.hidden = true;
    } else if (webcamImage) {
      webcamImage.hidden = false;
      webcamImage.src = url;
      webcamImage.onerror = () => {
        errorEl.textContent = "Could not load webcam stream. It may be unavailable or blocked.";
        errorEl.hidden = false;
      };
      if (webcamIframe) webcamIframe.hidden = true;
    }
  } else if (isYoutube && youtubeIframe) {
    youtubeIframe.src = url.startsWith("http") ? url : `https://www.youtube-nocookie.com/embed/${url}`;
  } else if (isRadio) {
    audioEl.src = url;
    audioEl.play().catch(() => {
      errorEl.textContent = "Could not play stream. It may be unavailable or blocked.";
      errorEl.hidden = false;
    });
  } else {
    const showError = (msg) => {
      errorEl.textContent = msg || "Could not play stream.";
      errorEl.hidden = false;
    };
    if (isHlsUrl(url) && typeof Hls !== "undefined" && Hls.isSupported()) {
      playerHls = new Hls({ enableWorker: true });
      playerHls.loadSource(url);
      playerHls.attachMedia(videoEl);
      playerHls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          showError("Stream error. The source may be unavailable or blocked.");
        }
      });
      videoEl.play().catch(() => showError("Playback failed. The stream may be unavailable."));
    } else if (isHlsUrl(url) && videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      videoEl.src = url;
      videoEl.play().catch(() => showError("Playback failed. The stream may be unavailable."));
    } else {
      videoEl.src = url;
      videoEl.play().catch(() => showError("Could not play stream. It may be unavailable or in an unsupported format."));
    }
  }

  const iso = (channel.iso || "").toUpperCase();
  const slug = channelSlug(channel);
  const favBtn = document.getElementById("player-modal-fav");
  if (favBtn) {
    const updateFavBtn = () => {
      const inFav = isChannelInFavorites(iso, slug);
      favBtn.classList.toggle("is-favorite", inFav);
      favBtn.setAttribute("aria-label", inFav ? "Remove from favorites" : "Add to favorites");
      favBtn.title = inFav ? "Remove from favorites" : "Add to favorites";
    };
    updateFavBtn();
    favBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isChannelInFavorites(iso, slug)) removeChannelFromFavorites(iso, slug);
      else addChannelToFavorites(channel);
      updateFavBtn();
    };
  }

  const trashBtn = document.getElementById("player-modal-trash");
  if (trashBtn) {
    const inTrash = isChannelInTrash(iso, slug);
    trashBtn.hidden = false;
    trashBtn.classList.toggle("in-trash", inTrash);
    trashBtn.setAttribute("aria-label", inTrash ? "Remove from trash" : "Add to trash");
    trashBtn.title = inTrash ? "Remove from trash" : "Add to trash";
    trashBtn.textContent = "🗑";
    trashBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isChannelInTrash(iso, slug)) {
        removeChannelFromTrash(iso, slug);
        trashBtn.classList.remove("in-trash");
        trashBtn.setAttribute("aria-label", "Add to trash");
        trashBtn.title = "Add to trash";
      } else {
        addChannelToTrash(channel);
        closePlayerModal();
      }
    };
  }

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");

  const selectedPath = document.querySelector(".country.selected");
  const iso2 = selectedPath?.getAttribute("data-iso2");
  if (iso2) setUrlState({ country: iso2, channel: channelSlug(channel) });
}

/**
 * Close the player modal and stop playback.
 */
function closePlayerModal() {
  currentPlayerChannel = null;
  const modal = document.getElementById("player-modal");
  const videoEl = document.getElementById("player-video");
  const audioEl = document.getElementById("player-audio");
  const youtubeIframe = document.getElementById("player-youtube-iframe");
  const webcamImage = document.getElementById("player-webcam-image");
  const webcamIframe = document.getElementById("player-webcam-iframe");
  const seoEl = document.getElementById("player-modal-seo");
  if (seoEl) {
    seoEl.textContent = "";
    seoEl.hidden = true;
  }
  if (!modal || !videoEl || !audioEl) return;
  if (playerHls) {
    playerHls.destroy();
    playerHls = null;
  }
  videoEl.pause();
  audioEl.pause();
  videoEl.removeAttribute("src");
  videoEl.load();
  audioEl.removeAttribute("src");
  audioEl.load();
  if (youtubeIframe) youtubeIframe.removeAttribute("src");
  if (webcamImage) webcamImage.removeAttribute("src");
  if (webcamIframe) {
    webcamIframe.removeAttribute("src");
    webcamIframe.hidden = true;
  }
  if (webcamImage) webcamImage.hidden = false;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");

  const selectedPath = document.querySelector(".country.selected");
  const iso2 = selectedPath?.getAttribute("data-iso2");
  if (iso2) setUrlState({ country: iso2 });
}

/** Build single-select (radio) buttons for type or source filter; one option always selected. */
function buildChannelFilterToggles(containerId, values, kind) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", kind === "type" ? "Filter by type" : "Filter by source");
  const typeLabels = { tv: "TV", radio: "Radio", youtube: "YouTube", webcam: "Webcam" };
  const allValue = "";
  const options = [allValue, ...values.filter((v) => v !== allValue)];
  options.forEach((val, index) => {
    const label = val === allValue ? "All" : (kind === "type" ? (typeLabels[val] || val.charAt(0).toUpperCase() + val.slice(1)) : val);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-toggle" + (index === 0 ? " active" : "");
    btn.textContent = label;
    btn.setAttribute("data-filter-kind", kind);
    btn.setAttribute("data-filter-value", val);
    btn.setAttribute("aria-pressed", String(index === 0));
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(index === 0));
    btn.addEventListener("click", () => {
      container.querySelectorAll(".filter-toggle").forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-pressed", String(isActive));
        b.setAttribute("aria-checked", String(isActive));
      });
      applyChannelFilters();
    });
    container.appendChild(btn);
  });
}

function refreshFavoriteStarsInList() {
  const listEl = document.getElementById("channel-list");
  if (!listEl) return;
  listEl.querySelectorAll(".channel-item").forEach((li) => {
    const iso = li.getAttribute("data-iso") || "";
    const slug = li.getAttribute("data-slug") || "";
    const favBtn = li.querySelector(".channel-item-fav");
    if (favBtn) {
      const inFav = isChannelInFavorites(iso, slug);
      favBtn.classList.toggle("is-favorite", inFav);
      favBtn.setAttribute("aria-label", inFav ? "Remove from favorites" : "Add to favorites");
      favBtn.title = inFav ? "Remove from favorites" : "Add to favorites";
    }
  });
}

/** Show/hide channel list items based on selected type, source, and text search. */
function applyChannelFilters() {
  const listEl = document.getElementById("channel-list");
  const typeContainer = document.getElementById("filter-type");
  const sourceContainer = document.getElementById("filter-source");
  const filterTextEl = document.getElementById("filter-text");
  if (!listEl) return;
  let selectedType = "";
  let selectedSource = "";
  const activeTypeBtn = typeContainer?.querySelector(".filter-toggle.active");
  const activeSourceBtn = sourceContainer?.querySelector(".filter-toggle.active");
  if (activeTypeBtn) selectedType = activeTypeBtn.getAttribute("data-filter-value") ?? "";
  if (activeSourceBtn) selectedSource = activeSourceBtn.getAttribute("data-filter-value") ?? "";
  const searchRaw = (filterTextEl && filterTextEl.value) ? filterTextEl.value.trim() : "";
  const search = searchRaw.toLowerCase();
  listEl.querySelectorAll(".channel-item").forEach((li) => {
    const type = li.getAttribute("data-type") || "";
    const source = li.getAttribute("data-source") || "";
    const typeOk = selectedType === "" || type === selectedType;
    const sourceOk = selectedSource === "" || (source && source === selectedSource);
    const nameEl = li.querySelector(".channel-item-name");
    const sourceEl = li.querySelector(".channel-item-source");
    const nameStr = (nameEl && nameEl.textContent) ? nameEl.textContent.toLowerCase() : "";
    const sourceStr = (sourceEl && sourceEl.textContent) ? sourceEl.textContent.toLowerCase() : "";
    const textOk = search === "" || nameStr.includes(search) || sourceStr.includes(search);
    li.classList.toggle("filtered-out", !(typeOk && sourceOk && textOk));
  });
}

/** ISO code used for channels from unknown/unmapped countries. */
const UNKNOWN_COUNTRY_ISO = "XX";

/**
 * Select "Unknown" country in the sidebar (no map path). Loads data/channels/XX/<sourcename>.json.
 */
function selectUnknown(onChannelsLoaded) {
  const selectedCountryEl = document.getElementById("selected-country");
  const countryNameEl = document.getElementById("country-name");
  const countryCodeEl = document.getElementById("country-code");
  const countryFlagEl = document.getElementById("country-flag");
  if (!selectedCountryEl || !countryNameEl || !countryCodeEl) return;
  document.querySelectorAll(".country.selected").forEach((c) => c.classList.remove("selected"));
  selectedCountryEl.hidden = false;
  countryNameEl.textContent = "Unknown";
  countryCodeEl.textContent = "ISO: " + UNKNOWN_COUNTRY_ISO;
  if (countryFlagEl) countryFlagEl.hidden = true;
  setUrlState({ country: UNKNOWN_COUNTRY_ISO });
  loadChannelsForCountry(UNKNOWN_COUNTRY_ISO, onChannelsLoaded);
}

/** Source names (parser names) — only path is data/channels/<country_code>/<sourcename>.json */
const CHANNEL_SOURCE_NAMES = ["iptv-org", "free-tv-iptv", "iprd", "famelack-channels", "m3u-radio-music-playlists", "insecam", "windy"];

/**
 * Return list of country codes to try for loading. Always tries BOTH when we have a mapping:
 * e.g. France → [FR, FRA] so we load data/channels/FR/<sourcename>.json AND data/channels/FRA/<sourcename>.json.
 * Puts 2-letter first (canonical data path), then 3-letter.
 */
function getChannelLoadCodes(countryCode) {
  const code = (countryCode || "").trim().toUpperCase();
  if (!code || (code.length !== 2 && code.length !== 3)) return [];
  const iso2 = code.length === 2 ? code : (ISO3_TO_ISO2_FALLBACK[code] || code);
  const iso3 = code.length === 3 ? code : (ISO2_TO_ISO3[code] || null);
  const out = [iso2];
  if (iso3 && iso3 !== iso2) out.push(iso3);
  return out;
}

/** Load and display channels for a country. ONLY uses data/channels/<country_code>/<sourcename>.json for each code and each source name; merges and dedupes by url. Optional onChannelsLoaded(channels) when list is ready. */
async function loadChannelsForCountry(countryCode, onChannelsLoaded) {
  const loadingEl = document.getElementById("channels-loading");
  const emptyEl = document.getElementById("channels-empty");
  const listEl = document.getElementById("channel-list");
  if (!loadingEl || !emptyEl || !listEl) return;

  loadingEl.hidden = false;
  emptyEl.hidden = true;
  listEl.hidden = true;
  listEl.innerHTML = "";
  emptyEl.textContent = "No channels for this country.";

  const codesToTry = getChannelLoadCodes(countryCode);
  const debugEl = document.getElementById("channels-debug-paths");
  if (debugEl) {
    const paths = [];
    for (const code of codesToTry) {
      for (const sourcename of CHANNEL_SOURCE_NAMES) {
        paths.push(`data/channels/${code}/${sourcename}.json`);
      }
    }
    //debugEl.textContent = paths.length ? "Search paths:\n" + paths.join("\n") : "";
    debugEl.textContent = '';
    debugEl.hidden = paths.length === 0;
  }

  if (codesToTry.length === 0) {
    loadingEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }

  try {
    const allChannels = [];
    const seenUrls = new Set();
    for (const code of codesToTry) {
      for (const sourcename of CHANNEL_SOURCE_NAMES) {
        const res = await fetch(`data/channels/${code}/${sourcename}.json`);
        if (!res.ok) continue;
        const data = await res.json();
        const list = data.channels || [];
        for (const ch of list) {
          const url = ch.url && ch.url.trim();
          if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            allChannels.push(ch);
          } else if (!url) {
            allChannels.push(ch);
          }
        }
      }
    }
    const channels = allChannels.filter((ch) => !isChannelInTrash((ch.iso || "").toUpperCase(), channelSlug(ch)));
    loadingEl.hidden = true;
    if (channels.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    const typeSet = new Set();
    const sourceSet = new Set();
    for (const ch of channels) {
      const typeNorm = String(ch.type || "tv").toLowerCase().trim();
      const sourceNorm = (ch.source_name && String(ch.source_name).trim()) || "";
      typeSet.add(typeNorm);
      if (sourceNorm) sourceSet.add(sourceNorm);

      const li = document.createElement("li");
      li.className = "channel-item";
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-label", `Play ${ch.name || "Channel"}`);
      li.setAttribute("data-type", typeNorm);
      li.setAttribute("data-source", sourceNorm);
      li.setAttribute("data-iso", (ch.iso || "").toUpperCase());
      li.setAttribute("data-slug", channelSlug(ch));
      const body = document.createElement("div");
      body.className = "channel-item-body";
      const nameEl = document.createElement("span");
      nameEl.className = "channel-item-name";
      nameEl.textContent = ch.name || "Channel";
      const typeEl = document.createElement("span");
      typeEl.className = "channel-item-type";
      typeEl.textContent = ch.type || "tv";
      body.append(nameEl, " ", typeEl);
      if (sourceNorm || (ch.source && String(ch.source).trim())) {
        const src = ch.source && String(ch.source).trim();
        const text = sourceNorm || src || "";
        const truncated = text.length > 28 ? text.slice(0, 26) + "…" : text;
        const sourceEl = document.createElement("span");
        sourceEl.className = "channel-item-source";
        sourceEl.textContent = truncated;
        if (src) sourceEl.title = src;
        body.appendChild(document.createElement("br"));
        body.appendChild(sourceEl);
      }
      if (ch.logo) {
        const img = document.createElement("img");
        img.className = "channel-item-logo";
        img.src = ch.logo;
        img.alt = "";
        img.loading = "lazy";
        li.appendChild(img);
      }
      li.appendChild(body);
      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = "channel-item-fav";
      favBtn.setAttribute("aria-label", "Add to favorites");
      favBtn.innerHTML = "★";
      favBtn.title = "Add to favorites";
      const isoUpper = (ch.iso || "").toUpperCase();
      const chSlug = channelSlug(ch);
      function updateFavBtn() {
        const inFav = isChannelInFavorites(isoUpper, chSlug);
        favBtn.classList.toggle("is-favorite", inFav);
        favBtn.setAttribute("aria-label", inFav ? "Remove from favorites" : "Add to favorites");
        favBtn.title = inFav ? "Remove from favorites" : "Add to favorites";
      }
      updateFavBtn();
      favBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isChannelInFavorites(isoUpper, chSlug)) removeChannelFromFavorites(isoUpper, chSlug);
        else addChannelToFavorites(ch);
        updateFavBtn();
      });
      li.appendChild(favBtn);

      li.addEventListener("click", (e) => {
        if (e.target.closest(".channel-item-fav")) return;
        openPlayerModal(ch);
      });
      li.addEventListener("keydown", (e) => {
        if (e.target.closest(".channel-item-fav")) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPlayerModal(ch);
        }
      });
      listEl.appendChild(li);
    }
    refreshFavoriteStarsInList();

    buildChannelFilterToggles("filter-type", Array.from(typeSet), "type");
    buildChannelFilterToggles("filter-source", Array.from(sourceSet).sort(), "source");
    const filtersEl = document.getElementById("channel-filters");
    if (filtersEl) filtersEl.hidden = false;
    applyChannelFilters();

    listEl.hidden = false;
    if (typeof onChannelsLoaded === "function") onChannelsLoaded(channels);
  } catch {
    loadingEl.hidden = true;
    emptyEl.hidden = false;
  }
}

/** Load and display channels for a category. Uses data/cat_channels/<category>/<sourcename>.json; merges and dedupes by url. */
async function loadChannelsForCategory(categoryName, onChannelsLoaded) {
  const loadingEl = document.getElementById("channels-loading");
  const emptyEl = document.getElementById("channels-empty");
  const listEl = document.getElementById("channel-list");
  const selectedCountryEl = document.getElementById("selected-country");
  const countryNameEl = document.getElementById("country-name");
  const countryCodeEl = document.getElementById("country-code");
  const countryFlagEl = document.getElementById("country-flag");
  if (!loadingEl || !emptyEl || !listEl || !selectedCountryEl || !countryNameEl || !countryCodeEl) return;

  document.querySelectorAll(".country.selected").forEach((c) => c.classList.remove("selected"));
  selectedCountryEl.hidden = false;
  countryNameEl.textContent = categoryName;
  countryCodeEl.textContent = "Category";
  if (countryFlagEl) countryFlagEl.hidden = true;

  loadingEl.hidden = false;
  emptyEl.hidden = true;
  listEl.hidden = true;
  listEl.innerHTML = "";
  const debugEl = document.getElementById("channels-debug-paths");
  if (debugEl) debugEl.hidden = true;
  const emptyMsg = document.getElementById("channels-empty");
  if (emptyMsg) emptyMsg.textContent = "No channels for this category.";

  const paths = CHANNEL_SOURCE_NAMES.map((s) => `data/cat_channels/${encodeURIComponent(categoryName)}/${s}.json`);
  try {
    const allChannels = [];
    const seenUrls = new Set();
    for (const url of paths) {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const list = data.channels || [];
      for (const ch of list) {
        const u = ch.url && ch.url.trim();
        if (u && !seenUrls.has(u)) {
          seenUrls.add(u);
          allChannels.push(ch);
        } else if (!u) allChannels.push(ch);
      }
    }
    const channels = allChannels.filter((ch) => !isChannelInTrash((ch.iso || "").toUpperCase(), channelSlug(ch)));
    loadingEl.hidden = true;
    if (channels.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    const typeSet = new Set();
    const sourceSet = new Set();
    for (const ch of channels) {
      const typeNorm = String(ch.type || "tv").toLowerCase().trim();
      const sourceNorm = (ch.source_name && String(ch.source_name).trim()) || "";
      typeSet.add(typeNorm);
      if (sourceNorm) sourceSet.add(sourceNorm);
      const li = document.createElement("li");
      li.className = "channel-item";
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-label", `Play ${ch.name || "Channel"}`);
      li.setAttribute("data-type", typeNorm);
      li.setAttribute("data-source", sourceNorm);
      li.setAttribute("data-iso", (ch.iso || "").toUpperCase());
      li.setAttribute("data-slug", channelSlug(ch));
      const body = document.createElement("div");
      body.className = "channel-item-body";
      const nameEl = document.createElement("span");
      nameEl.className = "channel-item-name";
      nameEl.textContent = ch.name || "Channel";
      const typeEl = document.createElement("span");
      typeEl.className = "channel-item-type";
      typeEl.textContent = ch.type || "tv";
      body.append(nameEl, " ", typeEl);
      if (sourceNorm || (ch.source && String(ch.source).trim())) {
        const src = ch.source && String(ch.source).trim();
        const text = sourceNorm || src || "";
        const truncated = text.length > 28 ? text.slice(0, 26) + "…" : text;
        const sourceEl = document.createElement("span");
        sourceEl.className = "channel-item-source";
        sourceEl.textContent = truncated;
        if (src) sourceEl.title = src;
        body.appendChild(document.createElement("br"));
        body.appendChild(sourceEl);
      }
      if (ch.logo) {
        const img = document.createElement("img");
        img.className = "channel-item-logo";
        img.src = ch.logo;
        img.alt = "";
        img.loading = "lazy";
        li.appendChild(img);
      }
      li.appendChild(body);
      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = "channel-item-fav";
      favBtn.setAttribute("aria-label", "Add to favorites");
      favBtn.innerHTML = "★";
      favBtn.title = "Add to favorites";
      const isoUpper = (ch.iso || "").toUpperCase();
      const chSlug = channelSlug(ch);
      function updateFavBtn() {
        const inFav = isChannelInFavorites(isoUpper, chSlug);
        favBtn.classList.toggle("is-favorite", inFav);
        favBtn.setAttribute("aria-label", inFav ? "Remove from favorites" : "Add to favorites");
        favBtn.title = inFav ? "Remove from favorites" : "Add to favorites";
      }
      updateFavBtn();
      favBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isChannelInFavorites(isoUpper, chSlug)) removeChannelFromFavorites(isoUpper, chSlug);
        else addChannelToFavorites(ch);
        updateFavBtn();
      });
      li.appendChild(favBtn);
      li.addEventListener("click", (e) => {
        if (e.target.closest(".channel-item-fav")) return;
        openPlayerModal(ch);
      });
      li.addEventListener("keydown", (e) => {
        if (e.target.closest(".channel-item-fav")) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPlayerModal(ch);
        }
      });
      listEl.appendChild(li);
    }
    refreshFavoriteStarsInList();
    buildChannelFilterToggles("filter-type", Array.from(typeSet), "type");
    buildChannelFilterToggles("filter-source", Array.from(sourceSet).sort(), "source");
    const filtersEl = document.getElementById("channel-filters");
    if (filtersEl) filtersEl.hidden = false;
    applyChannelFilters();
    listEl.hidden = false;
    if (typeof onChannelsLoaded === "function") onChannelsLoaded(channels);
  } catch {
    loadingEl.hidden = true;
    emptyEl.hidden = false;
  }
}

/**
 * Pan & zoom state and apply transform to #map-pan-zoom.
 * Zoom toward cursor; supports wheel, pinch, and external setScale (e.g. zoom slider).
 * Returns { setScale(scale), getScale() } and calls opts.onScaleChange(scale) when scale changes.
 */
function initPanZoom(opts = {}) {
  const viewport = document.getElementById("map-container");
  const panZoom = document.getElementById("map-pan-zoom");
  if (!viewport || !panZoom) return null;

  const onScaleChange = opts.onScaleChange || (() => {});
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let lastNotifiedScale = null;
  let pointerDown = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;
  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  let pinchStartTx = 0;
  let pinchStartTy = 0;
  let pinchCenterX = 0;
  let pinchCenterY = 0;

  function applyTransform() {
    panZoom.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    if (lastNotifiedScale !== scale) {
      lastNotifiedScale = scale;
      onScaleChange(scale);
    }
  }

  function viewportPoint(e) {
    const r = viewport.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x, y };
  }

  function centerMap() {
    const r = viewport.getBoundingClientRect();
    tx = (r.width - DISPLAY_WIDTH) / 2;
    ty = (r.height - DISPLAY_HEIGHT) / 2;
    scale = 1;
    applyTransform();
  }

  /** Re-center pan (tx, ty) to keep the map centered in the viewport without resetting zoom. */
  function recenterPanOnly() {
    const r = viewport.getBoundingClientRect();
    tx = (r.width - DISPLAY_WIDTH * scale) / 2;
    ty = (r.height - DISPLAY_HEIGHT * scale) / 2;
    applyTransform();
  }

  function zoomAt(viewportX, viewportY, newScale) {
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    const sRatio = newScale / scale;
    tx = viewportX - (viewportX - tx) * sRatio;
    ty = viewportY - (viewportY - ty) * sRatio;
    scale = newScale;
    applyTransform();
  }

  /** Set zoom from slider: zoom toward viewport center so the map doesn’t jump. */
  function setScale(newScale) {
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    const r = viewport.getBoundingClientRect();
    const centerX = r.width / 2;
    const centerY = r.height / 2;
    const sRatio = newScale / scale;
    tx = centerX - (centerX - tx) * sRatio;
    ty = centerY - (centerY - ty) * sRatio;
    scale = newScale;
    applyTransform();
  }

  function getScale() {
    return scale;
  }

  centerMap();

  // —— Wheel zoom (zoom toward cursor) ——
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const delta = -e.deltaY * ZOOM_SENSITIVITY;
    zoomAt(x, y, scale * (1 + delta));
  }, { passive: false });

  // —— Pointer pan (mouse + touch), including when starting on a country ——
  viewport.addEventListener("pointerdown", (e) => {
    pointerDown = true;
    pointerMovedDuringPan = false;
    const p = viewportPoint(e);
    startX = p.x;
    startY = p.y;
    startTx = tx;
    startTy = ty;
    e.target.setPointerCapture?.(e.pointerId);
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!pointerDown) return;
    const p = viewportPoint(e);
    const dx = p.x - startX;
    const dy = p.y - startY;
    if (Math.abs(dx) > PAN_CLICK_THRESHOLD || Math.abs(dy) > PAN_CLICK_THRESHOLD) {
      pointerMovedDuringPan = true;
    }
    tx = startTx + dx;
    ty = startTy + dy;
    applyTransform();
  });

  viewport.addEventListener("pointerup", (e) => {
    if (e.target.hasPointerCapture?.(e.pointerId)) e.target.releasePointerCapture?.(e.pointerId);
    pointerDown = false;
  });

  viewport.addEventListener("pointercancel", () => {
    pointerDown = false;
  });

  // —— Pinch zoom (two fingers) ——
  function distance(touches) {
    const a = touches[0];
    const b = touches[1];
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }
  function center(touches, viewportRect) {
    return {
      x: ((touches[0].clientX + touches[1].clientX) / 2) - viewportRect.left,
      y: ((touches[0].clientY + touches[1].clientY) / 2) - viewportRect.top,
    };
  }

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      pinchStartDistance = distance(e.touches);
      pinchStartScale = scale;
      pinchStartTx = tx;
      pinchStartTy = ty;
      const c = center(e.touches, r);
      pinchCenterX = c.x;
      pinchCenterY = c.y;
    }
  }, { passive: false });

  viewport.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      pointerMovedDuringPan = true;
      const r = viewport.getBoundingClientRect();
      const d = distance(e.touches);
      const c = center(e.touches, r);
      const ratio = d / pinchStartDistance;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale * ratio));
      // Keep the content point under the pinch center fixed under the new center
      tx = c.x - (pinchCenterX - pinchStartTx) * (newScale / pinchStartScale);
      ty = c.y - (pinchCenterY - pinchStartTy) * (newScale / pinchStartScale);
      pinchCenterX = c.x;
      pinchCenterY = c.y;
      pinchStartTx = tx;
      pinchStartTy = ty;
      pinchStartScale = newScale;
      pinchStartDistance = d;
      scale = newScale;
      applyTransform();
    }
  }, { passive: false });

  // On resize: keep current zoom, only re-center pan so the map doesn’t jump
  const ro = new ResizeObserver(recenterPanOnly);
  ro.observe(viewport);

  return { setScale, getScale };
}

/**
 * Add SVG pattern definitions for country flags (one per iso2 with valid flag URL).
 * Inserts into the map SVG's existing <defs>.
 */
function addFlagPatternsToMap(svgCountries, features) {
  const svg = svgCountries.parentElement;
  if (!svg || svg.tagName !== "svg") return;
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  const seen = new Set();
  const iso2List = [];
  features.forEach((f) => {
    const rawA2 = f.properties?.ISO_A2 ?? "";
    const rawA3 = f.properties?.ISO_A3 ?? "";
    const name = f.properties?.NAME ?? f.properties?.ADMIN ?? "";
    const iso2 = normalizeIso2(rawA2, rawA3, name);
    if (iso2 && !seen.has(iso2) && getFlagUrl(iso2)) {
      seen.add(iso2);
      iso2List.push(iso2);
    }
  });
  iso2List.forEach((iso2) => {
    const id = "flag-" + iso2;
    if (defs.querySelector("#" + id)) return;
    const flagUrl = getFlagUrl(iso2, 80);
    if (!flagUrl) return;
    const pattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
    pattern.setAttribute("id", id);
    pattern.setAttribute("patternUnits", "objectBoundingBox");
    pattern.setAttribute("width", "1");
    pattern.setAttribute("height", "1");
    pattern.setAttribute("preserveAspectRatio", "xMidYMid slice");
    const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
    img.setAttribute("href", flagUrl);
    img.setAttribute("x", "0");
    img.setAttribute("y", "0");
    img.setAttribute("width", "1");
    img.setAttribute("height", "1");
    img.setAttribute("preserveAspectRatio", "xMidYMid slice");
    pattern.appendChild(img);
    defs.appendChild(pattern);
  });
}

/**
 * Render GeoJSON features as country paths into #countries.
 * Returns selectByIso2(iso2, onChannelsLoaded) for URL-driven selection.
 */
function renderCountries(geojson, svgCountries, selectedCountryEl, countryNameEl, countryCodeEl) {
  svgCountries.innerHTML = "";
  const features = geojson.features || [];

  addFlagPatternsToMap(svgCountries, features);

  function selectCountry(el, toggle, onChannelsLoaded) {
    const isSelected = el.classList.contains("selected");
    document.querySelectorAll(".country.selected").forEach((n) => n.classList.remove("selected"));
    if (toggle && isSelected) {
      selectedCountryEl.hidden = true;
      setUrlState({});
      return;
    }
    el.classList.add("selected");
    countryNameEl.textContent = el.getAttribute("data-name");
    const iso2 = el.getAttribute("data-iso2");
    const iso3 = iso2 && ISO2_TO_ISO3[iso2];
    countryCodeEl.textContent = iso2 ? (iso3 ? `ISO: ${iso2}/${iso3}` : `ISO: ${iso2}`) : (el.getAttribute("data-iso") ? `ISO: ${el.getAttribute("data-iso")}` : "");
    const countryFlagEl = document.getElementById("country-flag");
    if (countryFlagEl) {
      const flagUrl = getFlagUrl(iso2, 80);
      if (flagUrl) {
        countryFlagEl.src = flagUrl;
        countryFlagEl.alt = "";
        countryFlagEl.hidden = false;
      } else {
        countryFlagEl.hidden = true;
      }
    }
    selectedCountryEl.hidden = false;
    setUrlState({ country: iso2 });
    loadChannelsForCountry(iso2, onChannelsLoaded);
  }

  features.forEach((feature, index) => {
    const geom = feature.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) return;

    const path = geometryToPath(geom);
    const name = feature.properties?.NAME ?? feature.properties?.ADMIN ?? `Country ${index + 1}`;
    const rawA3 = feature.properties?.ISO_A3 ?? "";
    const rawA2 = feature.properties?.ISO_A2 ?? "";
    const iso = normalizeIsoDisplay(rawA3, rawA2, name);
    const iso2 = normalizeIso2(rawA2, rawA3, name);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", path);
    pathEl.setAttribute("class", "country");
    if (iso2 && getFlagUrl(iso2)) {
      pathEl.setAttribute("fill", "url(#flag-" + iso2 + ")");
    } else {
      pathEl.setAttribute("fill", "transparent");
    }
    pathEl.setAttribute("data-name", name);
    pathEl.setAttribute("data-iso", iso);
    if (iso2) pathEl.setAttribute("data-iso2", iso2);
    pathEl.setAttribute("data-index", String(index));
    pathEl.setAttribute("tabindex", "0");
    pathEl.setAttribute("role", "button");
    pathEl.setAttribute("aria-label", `Select ${name}`);

    pathEl.addEventListener("click", (e) => {
      if (pointerMovedDuringPan) return;
      selectCountry(pathEl, true);
    });
    pathEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectCountry(pathEl, true);
      }
    });

    // Infobubble on hover
    pathEl.addEventListener("mouseenter", (e) => showTooltip(e, pathEl));
    pathEl.addEventListener("mousemove", (e) => moveTooltip(e));
    pathEl.addEventListener("mouseleave", () => hideTooltip());

    svgCountries.appendChild(pathEl);
  });

  return function selectByIso2(iso2, onChannelsLoaded) {
    const norm = (iso2 || "").trim().toUpperCase();
    if (norm.length !== 2) return;
    const el = svgCountries.querySelector(`.country[data-iso2="${norm}"]`);
    if (el) selectCountry(el, false, onChannelsLoaded);
  };
}

/** Apply ?country=XX&channel=slug from URL (e.g. on load or after re-render). Country can be ISO2 or ISO3; map uses ISO2 so we normalize for selection. */
function applyUrlState(selectByIso2) {
  const { country, channel } = getUrlState();
  if (!country) return;
  if (country === UNKNOWN_COUNTRY_ISO) {
    selectUnknown((channels) => {
      if (channel && channels) {
        const ch = findChannelBySlug(channels, channel);
        if (ch) openPlayerModal(ch);
      }
    });
    return;
  }
  if (typeof selectByIso2 !== "function") return;
  const iso2ForMap = country.length === 3 ? (ISO3_TO_ISO2_FALLBACK[country] || country) : country;
  selectByIso2(iso2ForMap, (channels) => {
    if (channel && channels) {
      const ch = findChannelBySlug(channels, channel);
      if (ch) openPlayerModal(ch);
    }
  });
}

/**
 * Fetch GeoJSON from URL and render countries. Shows loading overlay.
 * Returns a promise that resolves to selectByIso2(iso2, onChannelsLoaded) for URL-driven selection.
 */
async function loadAndRenderCountries(geojsonUrl) {
  const svgCountries = document.getElementById("countries");
  const loading = document.getElementById("map-loading");
  const selectedCountryEl = document.getElementById("selected-country");
  const countryNameEl = document.getElementById("country-name");
  const countryCodeEl = document.getElementById("country-code");

  loading.classList.remove("hidden");
  loading.textContent = "Loading map…";
  selectedCountryEl.hidden = true;

  try {
    const res = await fetch(geojsonUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();
    const selectByIso2 = renderCountries(geojson, svgCountries, selectedCountryEl, countryNameEl, countryCodeEl);
    loading.classList.add("hidden");
    return selectByIso2;
  } catch (err) {
    loading.textContent = "Failed to load map. Try again or choose another quality.";
    loading.classList.remove("hidden");
    console.error("Map load error:", err);
    return null;
  }
}

/**
 * Favorites panel: list, resolve from data/channels.json, play/remove/reorder/folders.
 */
function initFavoritesPanel() {
  const toggle = document.getElementById("favorites-toggle");
  const panel = document.getElementById("favorites-panel");
  const listEl = document.getElementById("favorites-list");
  const emptyEl = document.getElementById("favorites-empty");
  const addFolderBtn = document.getElementById("favorites-add-folder");
  const backdrop = document.getElementById("favorites-sidebar-backdrop");
  const closeBtn = document.getElementById("favorites-sidebar-close");

  if (!toggle || !panel || !listEl) return;

  function openPanel() {
    panel.classList.remove("favorites-sidebar--closed");
    panel.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    loadAllChannels().then(() => renderFavoritesList());
  }

  function closePanel() {
    panel.classList.add("favorites-sidebar--closed");
    panel.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", () => {
    if (panel.classList.contains("favorites-sidebar--closed")) openPanel();
    else closePanel();
  });

  backdrop?.addEventListener("click", closePanel);
  closeBtn?.addEventListener("click", closePanel);

  addFolderBtn?.addEventListener("click", () => {
    const name = prompt("Folder name", "New folder");
    if (name != null && name.trim()) {
      addFolder(name.trim());
      renderFavoritesList();
    }
  });

  function renderFavoritesList() {
    const { items } = getFavorites();
    emptyEl.hidden = items.length > 0;
    listEl.innerHTML = "";

    const folders = getFavoriteFolders();

    function addChannelRow(entry, container, parentFolderId) {
      const ch = resolveFavoriteChannel(entry);
      const name = entry.name || "Channel";
      const iso = entry.iso || "";
      const row = document.createElement("div");
      row.className = "favorites-row favorites-row--channel";
      row.setAttribute("role", "listitem");
      row.setAttribute("data-id", entry.id);

      const order = document.createElement("div");
      order.className = "favorites-order";
      const up = document.createElement("button");
      up.type = "button";
      up.className = "favorites-order-btn";
      up.textContent = "↑";
      up.title = "Move up";
      up.addEventListener("click", (e) => {
        e.stopPropagation();
        moveFavoriteUpDown(entry.id, "up");
        renderFavoritesList();
      });
      const down = document.createElement("button");
      down.type = "button";
      down.className = "favorites-order-btn";
      down.textContent = "↓";
      down.title = "Move down";
      down.addEventListener("click", (e) => {
        e.stopPropagation();
        moveFavoriteUpDown(entry.id, "down");
        renderFavoritesList();
      });
      order.append(up, down);

      const main = document.createElement("div");
      main.className = "favorites-row-main";
      if (ch) {
        const play = document.createElement("button");
        play.type = "button";
        play.className = "favorites-play";
        play.textContent = "Play";
        play.title = "Play channel";
        play.addEventListener("click", (e) => {
          e.stopPropagation();
          if (currentSelectByIso2) {
            currentSelectByIso2(iso, (channels) => {
              const found = findChannelBySlug(channels, entry.slug);
              if (found) openPlayerModal(found);
            });
          } else {
            loadChannelsForCountry(iso, (channels) => {
              const found = findChannelBySlug(channels, entry.slug);
              if (found) openPlayerModal(found);
            });
          }
        });
        main.appendChild(play);
      }
      const label = document.createElement("span");
      label.className = "favorites-row-label";
      label.textContent = name;
      if (!ch) {
        const warn = document.createElement("span");
        warn.className = "favorites-row-warning";
        warn.textContent = " (no longer available)";
        label.appendChild(warn);
      }
      main.appendChild(label);
      const meta = document.createElement("span");
      meta.className = "favorites-row-meta";
      meta.textContent = iso;
      main.appendChild(meta);

      if (folders.length > 0) {
        const folderSelect = document.createElement("select");
        folderSelect.className = "favorites-folder-select";
        folderSelect.title = "Move to folder";
        const optTop = document.createElement("option");
        optTop.value = "";
        optTop.textContent = "— None —";
        folderSelect.appendChild(optTop);
        folders.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.textContent = f.name;
          folderSelect.appendChild(opt);
        });
        folderSelect.value = parentFolderId || "";
        folderSelect.addEventListener("change", () => {
          const val = folderSelect.value;
          if (val) moveFavoriteToFolder(entry.id, val);
          else moveFavoriteToTopLevel(entry.id);
          renderFavoritesList();
        });
        main.appendChild(folderSelect);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "favorites-remove";
      remove.textContent = "✕";
      remove.title = "Remove from favorites";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFavoriteById(entry.id);
        renderFavoritesList();
      });

      row.append(order, main, remove);
      container.appendChild(row);
    }

    function addFolderBlock(folder, container) {
      const block = document.createElement("div");
      block.className = "favorites-folder";
      block.setAttribute("data-id", folder.id);
      const head = document.createElement("div");
      head.className = "favorites-folder-head";
      const toggleFold = document.createElement("button");
      toggleFold.type = "button";
      toggleFold.className = "favorites-folder-toggle";
      toggleFold.textContent = "▼";
      toggleFold.setAttribute("aria-label", "Expand or collapse folder");
      const title = document.createElement("span");
      title.className = "favorites-folder-title";
      title.textContent = folder.name || "Folder";
      const removeFolder = document.createElement("button");
      removeFolder.type = "button";
      removeFolder.className = "favorites-remove";
      removeFolder.textContent = "✕";
      removeFolder.title = "Remove folder";
      removeFolder.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFavoriteById(folder.id);
        renderFavoritesList();
      });
      head.append(toggleFold, title, removeFolder);
      const body = document.createElement("div");
      body.className = "favorites-folder-body";
      (folder.children || []).forEach((child) => {
        if (child.type === "channel") addChannelRow(child, body, folder.id);
        else if (child.type === "folder") addFolderBlock(child, body);
      });
      head.addEventListener("click", (e) => {
        if (!e.target.closest(".favorites-remove")) body.classList.toggle("favorites-folder-body--collapsed");
      });
      toggleFold.addEventListener("click", (e) => {
        e.stopPropagation();
        body.classList.toggle("favorites-folder-body--collapsed");
      });
      block.append(head, body);
      container.appendChild(block);
    }

    items.forEach((it) => {
      if (it.type === "channel") addChannelRow(it, listEl, null);
      else if (it.type === "folder") addFolderBlock(it, listEl);
    });
  }

  addEventListener("worldmedia-favorites-changed", () => {
    if (!panel.classList.contains("favorites-sidebar--closed")) renderFavoritesList();
  });
}

/**
 * Set up About toggle and map quality selector; load initial map.
 */
function initMap() {
  const aboutToggle = document.getElementById("about-toggle");
  const aboutSection = document.getElementById("about");
  const qualitySelect = document.getElementById("map-quality");

  // About toggle
  if (aboutToggle && aboutSection) {
    aboutToggle.addEventListener("click", () => {
      const hidden = aboutSection.classList.toggle("about--hidden");
      aboutSection.setAttribute("aria-hidden", hidden);
      aboutToggle.setAttribute("aria-expanded", !hidden);
    });
  }

  // Map quality: load on change and re-apply URL state
  if (qualitySelect) {
    qualitySelect.addEventListener("change", () => {
      const url = GEOJSON_BY_QUALITY[qualitySelect.value];
      if (url) loadAndRenderCountries(url).then((selectByIso2) => applyUrlState(selectByIso2));
    });
  }

  // Initial load (medium = 50m), then pan/zoom and URL state
  const initialUrl = GEOJSON_BY_QUALITY[qualitySelect?.value || "medium"];
  loadAndRenderCountries(initialUrl).then((selectByIso2) => {
    currentSelectByIso2 = selectByIso2;
    const zoomSlider = document.getElementById("zoom-slider");
    const zoomValue = document.getElementById("zoom-value");

    const panZoomApi = initPanZoom({
      onScaleChange(scale) {
        if (zoomSlider) zoomSlider.value = scale;
        if (zoomValue) zoomValue.textContent = Math.round(scale * 100) + "%";
      },
    });

    if (panZoomApi && zoomSlider) {
      zoomSlider.addEventListener("input", () => {
        panZoomApi.setScale(parseFloat(zoomSlider.value));
      });
    }

    applyUrlState(selectByIso2);

    const unknownBtn = document.getElementById("map-unknown-btn");
    if (unknownBtn) {
      unknownBtn.addEventListener("click", () => selectUnknown());
    }
  });
}

function initPlayerModal() {
  const modal = document.getElementById("player-modal");
  const closeBtn = document.getElementById("player-modal-close");
  const backdrop = document.getElementById("player-modal-backdrop");
  if (!modal || !closeBtn || !backdrop) return;
  closeBtn.addEventListener("click", closePlayerModal);
  backdrop.addEventListener("click", closePlayerModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false") {
      closePlayerModal();
    }
  });
}

document.addEventListener("worldmedia-favorites-changed", refreshFavoriteStarsInList);

function refreshChannelsAfterTrashChange() {
  const selectedCountryEl = document.getElementById("selected-country");
  const countryNameEl = document.getElementById("country-name");
  const countryCodeEl = document.getElementById("country-code");
  if (!selectedCountryEl || selectedCountryEl.hidden) return;
  if (countryCodeEl && countryCodeEl.textContent === "Category" && countryNameEl) {
    loadChannelsForCategory(countryNameEl.textContent.trim());
  } else {
    const { country } = getUrlState();
    if (country) loadChannelsForCountry(country);
    else {
      const sel = document.querySelector(".country.selected");
      if (sel) loadChannelsForCountry(sel.getAttribute("data-iso2") || "");
      else loadChannelsForCountry(UNKNOWN_COUNTRY_ISO);
    }
  }
}

document.addEventListener("worldmedia-trash-changed", () => {
  refreshChannelsAfterTrashChange();
});

/** Trash panel: list trashed channels, Restore and Empty trash. */
function initTrashPanel() {
  const toggle = document.getElementById("trash-toggle");
  const panel = document.getElementById("trash-panel");
  const listEl = document.getElementById("trash-list");
  const emptyEl = document.getElementById("trash-empty");
  const emptyBtn = document.getElementById("trash-empty-btn");
  const backdrop = document.getElementById("trash-sidebar-backdrop");
  const closeBtn = document.getElementById("trash-sidebar-close");
  if (!toggle || !panel || !listEl) return;

  function openPanel() {
    panel.classList.remove("favorites-sidebar--closed");
    panel.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    renderTrashList();
  }

  function closePanel() {
    panel.classList.add("favorites-sidebar--closed");
    panel.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
  }

  function renderTrashList() {
    const list = getTrash();
    emptyEl.hidden = list.length > 0;
    listEl.innerHTML = "";
    list.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "favorites-row favorites-row--channel trash-row";
      const main = document.createElement("div");
      main.className = "favorites-row-main";
      main.textContent = entry.name || "Channel";
      const meta = document.createElement("span");
      meta.className = "favorites-row-meta";
      meta.textContent = entry.iso || "";
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "favorites-play";
      restoreBtn.textContent = "Restore";
      restoreBtn.title = "Remove from trash and show in lists again";
      restoreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeChannelFromTrash(entry.iso, entry.slug);
        renderTrashList();
      });
      row.append(main, meta, restoreBtn);
      listEl.appendChild(row);
    });
  }

  toggle.addEventListener("click", () => {
    if (panel.classList.contains("favorites-sidebar--closed")) openPanel();
    else closePanel();
  });
  backdrop?.addEventListener("click", closePanel);
  closeBtn?.addEventListener("click", closePanel);
  emptyBtn?.addEventListener("click", () => {
    emptyTrash();
    renderTrashList();
  });
  addEventListener("worldmedia-trash-changed", () => {
    if (!panel.classList.contains("favorites-sidebar--closed")) renderTrashList();
  });
}

/** Categories modal: open/close and populate list. By country / By categories header buttons. */
function initViewMode() {
  const byCountryBtn = document.getElementById("by-country-btn");
  const byCategoriesBtn = document.getElementById("by-categories-btn");
  const categoriesModal = document.getElementById("categories-modal");
  const categoriesList = document.getElementById("categories-list");
  const categoriesModalClose = document.getElementById("categories-modal-close");
  const categoriesModalBackdrop = document.getElementById("categories-modal-backdrop");
  const selectedCountryEl = document.getElementById("selected-country");
  if (!byCountryBtn || !byCategoriesBtn || !categoriesModal || !categoriesList || !selectedCountryEl) return;

  const categoriesSearchInput = document.getElementById("categories-search");
  let categoriesCache = [];

  function renderCategoryList(filter) {
    const q = (filter || "").trim().toLowerCase();
    categoriesList.innerHTML = "";
    const toShow = q ? categoriesCache.filter((name) => name.toLowerCase().includes(q)) : categoriesCache;
    toShow.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-btn";
      btn.textContent = name;
      btn.addEventListener("click", () => {
        closeCategoriesModal();
        selectedCountryEl.hidden = false;
        loadChannelsForCategory(name);
      });
      const li = document.createElement("div");
      li.className = "category-item";
      li.appendChild(btn);
      categoriesList.appendChild(li);
    });
  }

  function openCategoriesModal() {
    byCountryBtn.setAttribute("aria-pressed", "false");
    byCategoriesBtn.setAttribute("aria-pressed", "true");
    categoriesModal.hidden = false;
    categoriesModal.setAttribute("aria-hidden", "false");
    if (categoriesSearchInput) categoriesSearchInput.value = "";
    categoriesList.innerHTML = "";
    categoriesCache = [];
    fetch("data/cat_channels/categories.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((arr) => {
        if (!Array.isArray(arr)) return;
        categoriesCache = arr;
        renderCategoryList("");
      })
      .catch(() => {});
  }

  if (categoriesSearchInput) {
    categoriesSearchInput.addEventListener("input", () => renderCategoryList(categoriesSearchInput.value));
  }

  function closeCategoriesModal() {
    categoriesModal.hidden = true;
    categoriesModal.setAttribute("aria-hidden", "true");
  }

  byCategoriesBtn.addEventListener("click", () => {
    if (categoriesModal.hidden) openCategoriesModal();
  });
  byCountryBtn.addEventListener("click", () => {
    byCountryBtn.setAttribute("aria-pressed", "true");
    byCategoriesBtn.setAttribute("aria-pressed", "false");
    if (!categoriesModal.hidden) closeCategoriesModal();
  });
  if (categoriesModalClose) {
    categoriesModalClose.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeCategoriesModal();
    });
  }
  if (categoriesModalBackdrop) {
    categoriesModalBackdrop.addEventListener("click", closeCategoriesModal);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && categoriesModal && !categoriesModal.hidden) closeCategoriesModal();
  });
}

initMap();
initPlayerModal();
initFavoritesPanel();
initTrashPanel();
initViewMode();

const filterTextEl = document.getElementById("filter-text");
if (filterTextEl) filterTextEl.addEventListener("input", applyChannelFilters);
