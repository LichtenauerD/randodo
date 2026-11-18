// Lieux d'intérêt : sélection embarquée + OpenStreetMap chargé à la volée, avec photos libres.
import { CONFIG } from './config.js';
import { overpass, qPlaces, qNotable } from './overpass.js';
import { kv, dist, norm, fetchJson } from './util.js';
import { SITES } from '../data/sites.js';

const CELL = 0.2;
const TTL = 30 * 86400000;
const mem = new Map(); // cellule -> lieux
const images = new Map(); // id du lieu -> url ('' si aucune)
export const placeState = { loading: false, error: null };

export function classify(t) {
  if (t.natural === 'peak' || t.natural === 'volcano') return 'sommet';
  if (t.waterway === 'waterfall' || t.natural === 'waterfall') return 'cascade';
  if (t.natural === 'water') return 'lac';
  if (t.natural === 'cave_entrance') return 'grotte';
  if (t.natural === 'gorge') return 'gorge';
  if (/^(rock|stone|cliff|arch)$/.test(t.natural || '')) return 'rocher';
  if (t.tourism === 'viewpoint' || t.man_made === 'tower') return 'vue';
  if (t.historic) return 'chateau';
  if (/hut$/.test(t.tourism || '')) return 'refuge';
  return 'lieu';
}

const WEIGHT = { cascade: 12, lac: 10, tourbiere: 6, chateau: 9, grotte: 7, gorge: 9, vue: 6, sommet: 5, rocher: 4, refuge: 2, lieu: 1 };

function toPlace(el) {
  const t = el.tags || {};
  const lat = el.lat ?? (el.center && el.center.lat);
  const lon = el.lon ?? (el.center && el.center.lon);
  if (lat == null || !t.name) return null;
  const type = classify(t);
  const ele = parseFloat(t.ele);
  let score = WEIGHT[type] || 0;
  if (t.wikidata) score += 30;
  if (t.wikipedia) score += 15;
  if (t.wikimedia_commons || t.image) score += 4;
  if (type === 'sommet' && isFinite(ele)) score += Math.min(25, ele / 80);
  if (t.historic === 'castle') score += 4;
  if (t.tourism === 'attraction') score += 5;
  const p = { id: el.type[0] + el.id, name: t.name, type, lat, lon, score };
  if (isFinite(ele)) p.ele = Math.round(ele);
  if (t.wikidata) p.wd = t.wikidata;
  if (t.wikimedia_commons && /^File:/i.test(t.wikimedia_commons)) p.file = t.wikimedia_commons.replace(/^File:/i, '');
  return p;
}

const cellKey = (la, lo) => Math.floor(la / CELL) + '_' + Math.floor(lo / CELL);

// Renvoie les lieux OpenStreetMap du cadre (en charge ce qui manque). `b` : {s, w, n, e}.
export async function loadPlaces(b) {
  const y0 = Math.floor(b.s / CELL), y1 = Math.floor(b.n / CELL), x0 = Math.floor(b.w / CELL), x1 = Math.floor(b.e / CELL);
  if ((y1 - y0 + 1) * (x1 - x0 + 1) > 16) return null; // trop large : il faut zoomer
  const missing = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const k = y + '_' + x;
      if (mem.has(k)) continue;
      const cached = await kv.get('pl:' + k);
      if (cached && Date.now() - cached.t < TTL) mem.set(k, cached.items);
      else missing.push([y, x]);
    }
  }
  if (missing.length) {
    const ys = missing.map((m) => m[0]), xs = missing.map((m) => m[1]);
    const box = { s: Math.min(...ys) * CELL, n: (Math.max(...ys) + 1) * CELL, w: Math.min(...xs) * CELL, e: (Math.max(...xs) + 1) * CELL };
    placeState.loading = true;
    try {
      const els = await overpass(qPlaces(box));
      const buckets = new Map();
      for (let y = Math.min(...ys); y <= Math.max(...ys); y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) buckets.set(y + '_' + x, []);
      const seen = new Set();
      for (const el of els) {
        const p = toPlace(el);
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        const k = cellKey(p.lat, p.lon);
        if (buckets.has(k)) buckets.get(k).push(p);
      }
      for (const [k, items] of buckets) {
        mem.set(k, items);
        kv.set('pl:' + k, { t: Date.now(), items });
      }
      placeState.error = null;
    } catch (err) {
      placeState.error = err.message;
      // Sans réseau : on se rabat sur d'anciennes données, même périmées.
      for (const [y, x] of missing) {
        const old = await kv.get('pl:' + y + '_' + x);
        if (old) mem.set(y + '_' + x, old.items);
      }
    } finally {
      placeState.loading = false;
    }
  }
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    for (const p of mem.get(y + '_' + x) || []) {
      if (p.lat >= b.s && p.lat <= b.n && p.lon >= b.w && p.lon <= b.e && !shadowed(p)) out.push(p);
    }
  }
  return out;
}

// Un lieu OpenStreetMap déjà présent dans la sélection n'est pas affiché deux fois.
function shadowed(p) {
  const a = norm(p.name).split(' ').filter((w) => w.length > 3);
  for (const s of SITES) {
    if (Math.abs(s.lat - p.lat) > 0.012 || Math.abs(s.lon - p.lon) > 0.018) continue;
    if (dist([s.lat, s.lon], [p.lat, p.lon]) > 900) continue;
    const b = norm(s.name);
    if (a.some((w) => b.includes(w))) {
      // On en profite pour récupérer l'altitude et l'identifiant Wikidata du lieu réel.
      if (p.ele && !s.ele) s.ele = p.ele;
      if (p.wd && !s.wd) s.wd = p.wd;
      return true;
    }
  }
  return false;
}

export function sitesIn(b) {
  return SITES.filter((s) => s.lat >= b.s && s.lat <= b.n && s.lon >= b.w && s.lon <= b.e);
}

// Tous les lieux connus en mémoire (pour la recherche et pour allonger les boucles).
export function knownPlaces() {
  const out = SITES.slice();
  const seen = new Set();
  for (const items of mem.values()) for (const p of items) if (!seen.has(p.id) && !shadowed(p)) { seen.add(p.id); out.push(p); }
  return out;
}

export function searchLocal(q, limit = 8) {
  const n = norm(q);
  if (n.length < 2) return [];
  return knownPlaces()
    .map((p) => ({ p, k: norm(p.name) }))
    .filter((x) => x.k.includes(n))
    .sort((a, b) => (a.k.startsWith(n) ? 0 : 1) - (b.k.startsWith(n) ? 0 : 1) || b.p.score - a.p.score)
    .slice(0, limit)
    .map((x) => x.p);
}

export async function searchRemote(q) {
  const z = CONFIG.zone;
  const url = `${CONFIG.photon}?q=${encodeURIComponent(q)}&limit=8&lang=fr&bbox=${z.west},${z.south},${z.east},${z.north}`;
  const json = await fetchJson(url, {}, 12000);
  return (json.features || []).map((f) => {
    const pr = f.properties || {};
    const tags = { name: pr.name, [pr.osm_key]: pr.osm_value };
    let type = classify(tags);
    if (pr.osm_key === 'natural' && pr.osm_value === 'water') type = 'lac';
    return {
      id: 'x' + (pr.osm_type || '') + (pr.osm_id || Math.random().toString(36).slice(2)),
      name: pr.name || q, type, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], score: 0,
      where: [pr.city, pr.county, pr.state, pr.country].filter(Boolean).slice(0, 2).join(', '),
    };
  }).filter((p) => p.name);
}

// ---------- Photos ----------
const fileUrl = (name, w = 360) => CONFIG.commonsFile + encodeURIComponent(name.replace(/ /g, '_')) + '?width=' + w;

export function imageOf(p) {
  if (p.local) return p.local.file;
  if (p.img) return p.img;
  if (images.has(p.id)) return images.get(p.id) || null;
  if (p.file) { const u = fileUrl(p.file); images.set(p.id, u); return u; }
  return undefined; // inconnu : à chercher
}

let busy = false;
let wikiPause = 0;
// Cherche les photos manquantes d'une liste de lieux. Appelle `done` si au moins une a été trouvée.
export async function fetchImages(list, done) {
  if (busy) return;
  busy = true;
  let found = false, more = false;
  try {
    const need = list.filter((p) => imageOf(p) === undefined);
    // 1) cache local
    for (const p of need) {
      const c = await kv.get('img:' + p.id);
      if (c !== undefined) { images.set(p.id, c.u || ''); if (c.lat && p.curated) { p.lat = c.lat; p.lon = c.lon; } if (c.u) found = true; }
    }
    // 2) Wikidata, par lots
    const wd = need.filter((p) => !images.has(p.id) && p.wd && /^Q\d+$/.test(p.wd)).slice(0, 40);
    if (wd.length) {
      const q = `SELECT ?item ?img WHERE { VALUES ?item { ${wd.map((p) => 'wd:' + p.wd).join(' ')} } ?item wdt:P18 ?img }`;
      try {
        const json = await fetchJson(CONFIG.wikidataSparql + '?format=json&query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } }, 15000);
        const map = new Map();
        for (const r of json.results.bindings) {
          const id = r.item.value.split('/').pop();
          const file = decodeURIComponent(r.img.value.split('Special:FilePath/').pop());
          if (!map.has(id)) map.set(id, file);
        }
        for (const p of wd) {
          const u = map.has(p.wd) ? fileUrl(map.get(p.wd)) : '';
          images.set(p.id, u); kv.set('img:' + p.id, { u });
          if (u) found = true;
        }
      } catch { /* on réessaiera au prochain déplacement de carte */ }
    }
    // 3) Sélection : article Wikipédia géolocalisé le plus pertinent (affine aussi les coordonnées)
    const cur = Date.now() < wikiPause ? [] : need.filter((p) => !images.has(p.id) && p.curated).slice(0, 12);
    for (const p of cur) {
      const r = await wikiNear(p).catch(() => null);
      if (r === null) { wikiPause = Date.now() + 60000; break; } // réseau indisponible : on ne mémorise rien et on attend une minute
      more = true;
      images.set(p.id, r.u || '');
      kv.set('img:' + p.id, r);
      if (r.lat) { p.lat = r.lat; p.lon = r.lon; }
      if (r.u) found = true;
    }
    // Lieux sans identifiant ni photo : on note l'absence pour ne pas les redemander.
    for (const p of need) if (!images.has(p.id) && !p.curated && !p.wd) images.set(p.id, '');
  } finally {
    busy = false;
  }
  if ((found || more) && done) done();
}

async function wikiNear(p) {
  const words = norm(p.name).split(' ').filter((w) => w.length > 3);
  for (const base of [CONFIG.wikipedia, CONFIG.wikipedia.replace('//fr.', '//de.')]) {
    const url = `${base}?action=query&generator=geosearch&ggscoord=${p.lat}%7C${p.lon}&ggsradius=1800&ggslimit=10&prop=pageimages%7Ccoordinates&piprop=thumbnail&pithumbsize=640&pilimit=10&colimit=10&format=json&origin=*`;
    const json = await fetchJson(url, {}, 12000);
    const pages = Object.values((json.query && json.query.pages) || {});
    let best = null, bs = -Infinity;
    for (const pg of pages) {
      if (!pg.thumbnail) continue;
      const c = pg.coordinates && pg.coordinates[0];
      const d = c ? dist([p.lat, p.lon], [c.lat, c.lon]) : 1500;
      const title = norm(pg.title);
      const match = words.filter((w) => title.includes(w)).length;
      const s = match * 3 - d / 600;
      if (s > bs) { bs = s; best = { pg, c, match, d }; }
    }
    if (best && best.match > 0) {
      const r = { u: best.pg.thumbnail.source };
      if (best.c && best.match > 0 && best.d < 1800) { r.lat = best.c.lat; r.lon = best.c.lon; }
      return r;
    }
    if (base === CONFIG.wikipedia.replace('//fr.', '//de.')) break;
  }
  return { u: '' };
}

// Lieux notables autour d'un point, pour la recherche guidée (résultat gardé 14 jours).
const notable = new Map();
export async function notablePlaces(lat, lon, radius, types) {
  const key = 'nb:' + lat.toFixed(1) + '_' + lon.toFixed(1) + '_' + Math.round(radius / 1000) + '_' + types.slice().sort().join('');
  let items = notable.get(key);
  if (!items) {
    const cached = await kv.get(key);
    if (cached && Date.now() - cached.t < 14 * 86400000) items = cached.items;
  }
  if (!items) {
    const els = await overpass(qNotable(lat, lon, radius, types));
    const seen = new Set();
    items = [];
    for (const el of els) {
      const p = toPlace(el);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      items.push(p);
    }
    kv.set(key, { t: Date.now(), items });
  }
  notable.set(key, items);
  // Ces lieux rejoignent la mémoire commune : la recherche par nom et la carte les connaissent ensuite.
  mem.set('nb_' + key, items);
  return items.filter((p) => !shadowed(p));
}
export { SITES };
