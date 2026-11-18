// Carte : fonds, bulles de lieux, tracés.
/* global L */
import { CONFIG, TYPES } from './config.js';
import { loadPlaces, sitesIn, imageOf, fetchImages, placeState } from './places.js';
import { store, want, bus } from './state.js';
import { settings, debounce, esc } from './util.js';

export const GLYPH = {
  sommet: '<path d="M3 19l6-11 4 6 2-3 6 8z"/>',
  vue: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  lac: '<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  // Deux parois, trois filets d'eau qui tombent, et le remous en bas.
  // Touffes d'herbe et miroir d'eau : tourbières et vallons.
  tourbiere: '<path d="M3 20h18"/><path d="M7 17c0-3-1.5-5-3-6M7 17c0-3 1.5-5 3-6M7 17V9"/><path d="M16 17c0-2.5-1-4-2.5-5M16 17c0-2.5 1-4 2.5-5M16 17v-6"/>',
  cascade: '<path d="M4 3v15M20 3v15"/><path d="M9 3v11M12 3v13M15 3v11"/><path d="M6 20c2-1.6 4-1.6 6 0s4 1.6 6 0"/>',
  rocher: '<path d="M4 19l3-9 5-4 6 5 2 8z"/>',
  chateau: '<path d="M4 20V8h3V5h3v3h4V5h3v3h3v12zM10 20v-5h4v5"/>',
  grotte: '<path d="M3 20c0-9 4-14 9-14s9 5 9 14M9 20c0-4 1.2-6 3-6s3 2 3 6"/>',
  gorge: '<path d="M3 4l6 7-2 9M21 4l-6 7 2 9M12 13v7"/>',
  refuge: '<path d="M3 12l9-7 9 7M6 10v9h12v-9M10 19v-5h4v5"/>',
  lieu: '<path d="M12 21s-6-6-6-11a6 6 0 0112 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
};
export const glyph = (type) => `<svg viewBox="0 0 24 24">${GLYPH[type] || GLYPH.lieu}</svg>`;
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

export let map;
let base, markers, traceLayer, corridorLayer, meMarker, meCircle, extra;
const shown = new Map(); // id -> { marker, sig }
let onPick = () => {};
export const mapState = { visible: [], hint: '' };

export function initMap(pick) {
  onPick = pick;
  const view = settings.get('view', CONFIG.home);
  map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true, zoomSnap: 0.5, maxBoundsViscosity: 0.6 })
    .setView([view.lat, view.lon], view.zoom);
  map.attributionControl.setPrefix(false);
  setLayer(settings.get('layerId', 'rando'), true);
  corridorLayer = L.layerGroup().addTo(map);
  traceLayer = L.layerGroup().addTo(map);
  markers = L.layerGroup().addTo(map);
  extra = L.layerGroup().addTo(map);
  map.on('moveend', debounce(() => {
    const c = map.getCenter();
    settings.set('view', { lat: +c.lat.toFixed(4), lon: +c.lng.toFixed(4), zoom: map.getZoom() });
    refresh();
  }, 250));
  // Appui long : randonner autour d'un point quelconque.
  map.on('contextmenu', (e) => {
    onPick({ id: 'p' + e.latlng.lat.toFixed(4) + '_' + e.latlng.lng.toFixed(4), name: 'Point choisi sur la carte', type: 'lieu', lat: e.latlng.lat, lon: e.latlng.lng, score: 0, adhoc: true });
  });
  bus.on('want', refresh); bus.on('log', refresh); bus.on('wish', refresh);
  refresh();
  return map;
}

// ---------- Fonds de carte ----------
export function layers() {
  const key = (settings.get('ignScanKey', '') || CONFIG.ignScanKey || '').trim();
  return CONFIG.tiles.filter((t) => !t.needsKey || key).map((t) => (t.needsKey ? { ...t, url: t.url.replace('{key}', encodeURIComponent(key)) } : t));
}
export const currentLayer = () => layerId;
export const trailsOn = () => !!CONFIG.trailsOverlay && settings.get('trails', true);
let layerId = '', overlay = null, tileOk = 0, tileKo = 0;

export function setLayer(id, auto = false) {
  const list = layers();
  const t = list.find((x) => x.id === id) || list[0];
  if (base) map.removeLayer(base);
  tileOk = 0; tileKo = 0;
  base = L.tileLayer(t.url, { maxZoom: 19, maxNativeZoom: t.maxZoom, attribution: t.attribution, subdomains: 'abc', crossOrigin: false }).addTo(map);
  base.on('tileload', () => { tileOk++; });
  // Fond injoignable : on bascule sur le plan général plutôt que de laisser une carte vide.
  base.on('tileerror', () => {
    tileKo++;
    if (tileKo >= 8 && tileOk === 0 && t.id !== 'osm' && navigator.onLine !== false && layerId === t.id) {
      setLayer('osm', true);
      bus.emit('layerfail', t.label);
    }
  });
  base.bringToBack();
  layerId = t.id;
  if (!auto) settings.set('layerId', t.id);
  setTrails(trailsOn());
  return t;
}
export function setTrails(on) {
  if (overlay) { map.removeLayer(overlay); overlay = null; }
  if (CONFIG.trailsOverlay) settings.set('trails', !!on);
  if (on && CONFIG.trailsOverlay) {
    overlay = L.tileLayer(CONFIG.trailsOverlay, { maxZoom: 19, maxNativeZoom: 17, opacity: 0.75, attribution: 'balisage © Waymarked Trails' }).addTo(map);
  }
}

function iconFor(p, big) {
  const img = imageOf(p);
  const color = (TYPES[p.type] || TYPES.lieu).color;
  const done = store.isDone(p), wish = store.isWished(p);
  const size = p.curated ? 54 : 46;
  if (!big) {
    return { sig: 'd' + done, icon: L.divIcon({ className: '', html: `<div class="dot" style="background:${done ? '#9aa39d' : color}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }) };
  }
  const label = map.getZoom() >= (p.curated ? 10.5 : 13) ? `<span class="bubble-label">${esc(p.name)}</span>` : '';
  const cls = 'bubble' + (p.curated ? ' star' : '') + (done ? ' done' : '') + (wish ? ' wish' : '');
  const inner = img
    ? `<span class="tag" style="background:${color}">${glyph(p.type)}</span>`
    : `<span style="color:${color};display:grid">${glyph(p.type)}</span>`;
  const style = img ? ` style="background-image:url('${img.replace(/'/g, '%27')}')"` : '';
  const html = `<div class="${cls}"${style}>${inner}${done ? `<span class="ok">${CHECK}</span>` : ''}${label}</div>`;
  return { sig: 'b' + (img || '') + done + wish + (label ? 1 : 0), icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) };
}

let seq = 0;
export async function refresh() {
  if (!map) return;
  const my = ++seq;
  const b = map.getBounds().pad(0.08);
  const box = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
  const zoom = map.getZoom();
  let list = sitesIn(box);
  let hint = '';
  if (zoom >= 10.5) {
    draw(list, zoom); // la sélection s'affiche tout de suite, le reste arrive ensuite
    const osm = await loadPlaces(box);
    if (my !== seq) return;
    if (osm) list = list.concat(osm);
    if (placeState.error && !(osm && osm.length)) hint = 'Lieux détaillés indisponibles sans réseau';
  } else if (zoom >= 8.5) {
    hint = 'Zoome pour voir tous les lieux';
  }
  mapState.hint = hint;
  draw(list, zoom);
  bus.emit('maphint', hint);
}

function draw(list, zoom) {
  let items = list;
  if (want.types.length) items = items.filter((p) => want.types.includes(p.type));
  if (want.hideDone) items = items.filter((p) => !store.isDone(p));
  items = items.slice().sort((a, b) => b.score - a.score);
  // Désencombrement : une bulle ne recouvre pas une bulle mieux classée.
  const placed = [];
  const big = new Set();
  const maxBubbles = 45;
  for (const p of items) {
    if (big.size >= maxBubbles) break;
    if (!p.curated && zoom < 11.5 && p.score < 30) continue;
    const pt = map.latLngToContainerPoint([p.lat, p.lon]);
    if (placed.some((q) => Math.abs(q.x - pt.x) < 50 && Math.abs(q.y - pt.y) < 54)) continue;
    placed.push(pt);
    big.add(p.id);
  }
  const dots = items.filter((p) => !big.has(p.id)).slice(0, zoom >= 12.5 ? 160 : 70);
  const visible = items.filter((p) => big.has(p.id)).concat(dots);
  const keep = new Set();
  for (const p of visible) {
    keep.add(p.id);
    const { sig, icon } = iconFor(p, big.has(p.id));
    const cur = shown.get(p.id);
    if (cur && cur.sig === sig && cur.lat === p.lat) continue;
    if (cur) markers.removeLayer(cur.marker);
    const m = L.marker([p.lat, p.lon], { icon, keyboard: false, zIndexOffset: big.has(p.id) ? Math.round(p.score * 10) : -500, title: p.name });
    m.on('click', () => onPick(p));
    m.addTo(markers);
    shown.set(p.id, { marker: m, sig, lat: p.lat });
  }
  for (const [id, cur] of shown) if (!keep.has(id)) { markers.removeLayer(cur.marker); shown.delete(id); }
  mapState.visible = visible;
  fetchImages(items.filter((p) => big.has(p.id)), () => refresh());
}

// ---------- Tracés ----------
// Violet : la seule teinte absente des cartes topographiques (routes rouges, courbes brunes, eau bleue, forêt verte).
export const TRACE = '#8a1fd1';
let traceSvg = null;
// Flèches de sens de marche, posées à intervalle régulier le long du tracé.
function arrows(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += map.distance(pts[i - 1], pts[i]);
  const gap = Math.max(350, total / 14);
  let acc = gap / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = map.distance(pts[i - 1], pts[i]);
    if (acc + d >= gap && d > 1) {
      const t = (gap - acc) / d;
      const lat = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, lon = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      const ang = Math.atan2((pts[i][1] - pts[i - 1][1]) * Math.cos((lat * Math.PI) / 180), pts[i][0] - pts[i - 1][0]) * 180 / Math.PI;
      L.marker([lat, lon], { interactive: false, keyboard: false, zIndexOffset: -200, icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: `<div class="arrow" style="transform:rotate(${ang.toFixed(0)}deg)"></div>` }) }).addTo(traceLayer);
      acc = 0;
    } else acc += d;
  }
}
export function showTrace(h, opts = {}) {
  traceLayer.clearLayers();
  corridorLayer.clearLayers();
  if (!h) return;
  if (opts.corridor && h.corridor) {
    for (const w of h.corridor) {
      const style = w.c === 'r' ? { color: '#ffffff', weight: 4, opacity: 0.9 } : w.c === 't' ? { color: '#8a6d4b', weight: 2, opacity: 0.8 } : { color: '#8a6d4b', weight: 1.6, opacity: 0.85, dashArray: '5 4' };
      L.polyline(w.p, { ...style, interactive: false }).addTo(corridorLayer);
    }
  }
  // Le tracé passe en SVG (le reste de la carte reste en canvas, plus léger) pour pouvoir l'animer.
  if (!traceSvg) traceSvg = L.svg({ padding: 0.6 });
  const R = { renderer: traceSvg };
  const halo = L.polyline(h.pts, { ...R, color: '#ffffff', weight: 10, opacity: 0.95, interactive: false }).addTo(traceLayer);
  const line = L.polyline(h.pts, { ...R, color: TRACE, weight: 5.5, opacity: 1, interactive: false }).addTo(traceLayer);
  // Fil lumineux qui court dans le sens de marche.
  const flow = L.polyline(h.pts, { ...R, color: '#ffffff', weight: 2.4, opacity: 0.9, interactive: false, className: 'trace-flow' }).addTo(traceLayer);
  arrows(h.pts);
  // Le tracé (et son liseré blanc) se dessine à l'apparition, une fois la carte posée sur le tracé.
  if (opts.animate !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const paths = [halo, line].map((l) => l._path).filter((x) => x && x.getTotalLength);
    paths.forEach((x) => { x.style.opacity = '0'; });
    if (flow._path) flow._path.style.opacity = '0';
    const start = () => {
      paths.forEach((path) => {
        path.style.opacity = '';
        const len = path.getTotalLength();
        if (!len) return;
        path.style.setProperty('--len', len);
        path.classList.add('trace-draw');
        const done = () => { path.classList.remove('trace-draw'); path.style.removeProperty('--len'); if (flow._path) flow._path.style.opacity = ''; };
        path.addEventListener('animationend', done, { once: true });
        setTimeout(() => map.once('zoomstart', done), 50);
      });
    };
    let fired = false;
    const go = () => { if (!fired) { fired = true; requestAnimationFrame(start); } };
    map.once('moveend', go);
    setTimeout(go, 450);
  }
  const s = h.start || { lat: h.pts[0][0], lon: h.pts[0][1] };
  L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="pin-start">D</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false }).addTo(traceLayer);
  if (opts.fit !== false) {
    const pad = opts.pad || { top: 90, bottom: 180 };
    map.fitBounds(L.latLngBounds(h.pts), { paddingTopLeft: [30, pad.top], paddingBottomRight: [30, pad.bottom], maxZoom: 16 });
  }
}
export function clearTrace() { traceLayer.clearLayers(); corridorLayer.clearLayers(); }

export function showMe(lat, lon, acc) {
  if (!meMarker) {
    meCircle = L.circle([lat, lon], { radius: acc || 20, color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(extra);
    meMarker = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="me"><i class="me-ring"></i></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, zIndexOffset: 2000 }).addTo(extra);
  } else {
    meMarker.setLatLng([lat, lon]);
    meCircle.setLatLng([lat, lon]).setRadius(acc || 20);
  }
}
export function hideMe() {
  if (meMarker) { extra.removeLayer(meMarker); extra.removeLayer(meCircle); meMarker = meCircle = null; }
}
export function setMarkersVisible(v) {
  if (v && !map.hasLayer(markers)) map.addLayer(markers);
  if (!v && map.hasLayer(markers)) map.removeLayer(markers);
}
export function focus(lat, lon, zoom = 13, offsetY = 0) {
  const target = map.project([lat, lon], zoom).add([0, offsetY]);
  map.setView(map.unproject(target, zoom), zoom, { animate: true });
}
