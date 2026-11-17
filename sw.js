// Mode hors ligne de Randodo. Le stockage de cache est commun à toutes les applis du même site GitHub Pages :
// seuls les caches préfixés « randodo- » sont touchés.
// L'appli elle-même est mise en cache, les tuiles déjà vues aussi (jamais téléchargées d'avance).
const VERSION = 'randodo-1.5.3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/config.js', 'js/util.js', 'js/state.js', 'js/overpass.js', 'js/places.js', 'js/router.js',
  'js/elev.js', 'js/gpx.js', 'js/hikes.js', 'js/map.js', 'js/sheet.js', 'js/guide.js', 'js/pages.js', 'js/home.js', 'data/sites.js', 'data/photos.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'vendor/fonts/bsc-500.woff2', 'vendor/fonts/bsc-600.woff2', 'vendor/fonts/bsc-700.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/icon-96.png',
];
const TILES = 'randodo-tuiles';
const PHOTOS = 'randodo-photos';
const TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$|(^|\.)tile\.opentopomap\.org$|^tile\.waymarkedtrails\.org$|^data\.geopf\.fr$|^wmts\.geo\.admin\.ch$/;
const PHOTO_HOSTS = /(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => /^(randodo|cairn)-/.test(k) && k !== VERSION && k !== TILES && k !== PHOTOS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
}

async function cacheFirst(req, name, max) {
  const c = await caches.open(name);
  const hit = await c.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    c.put(req, res.clone()).then(() => { if (Math.random() < 0.03) trim(name, max); }).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // L'appli : réseau d'abord pour recevoir les mises à jour, cache si le réseau manque.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())).catch(() => {});
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
    return;
  }
  if (TILE_HOSTS.test(url.hostname) && (req.destination === 'image' || /wmts|tile/.test(url.href))) { e.respondWith(cacheFirst(req, TILES, 2500).catch(() => new Response('', { status: 504 }))); return; }
  if (PHOTO_HOSTS.test(url.hostname) && req.destination === 'image') { e.respondWith(cacheFirst(req, PHOTOS, 400).catch(() => new Response('', { status: 504 }))); }
});
