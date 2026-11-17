// Accès aux données OpenStreetMap par Overpass, avec bascule entre serveurs.
import { CONFIG } from './config.js';

let preferred = 0;
export const overpassState = { last: null, error: null };

async function ask(idx, query, timeoutMs, outer) {
  const servers = CONFIG.overpass;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  if (outer) outer.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(servers[idx], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'data=' + encodeURIComponent(query),
      signal: ctl.signal,
    });
    if (res.status === 429 || res.status >= 500) await res.text().catch(() => {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json || !Array.isArray(json.elements)) throw new Error('réponse inattendue');
    // Overpass signale un dépassement de temps dans « remark » tout en répondant 200.
    if (json.remark && /timed out|out of memory/i.test(json.remark) && !json.elements.length) throw new Error('délai dépassé côté serveur');
    return { idx, elements: json.elements };
  } finally {
    clearTimeout(timer);
  }
}

export async function overpass(query, timeoutMs = 70000) {
  const servers = CONFIG.overpass;
  const n = servers.length;
  let lastErr;
  const win = (r) => { preferred = r.idx; overpassState.last = servers[r.idx]; overpassState.error = null; return r.elements; };
  // Premier tour : le serveur habituel et le suivant en même temps ; le plus rapide gagne, l'autre est coupé.
  if (n > 1) {
    const stop = new AbortController();
    try {
      const r = await Promise.any([ask(preferred % n, query, timeoutMs, stop.signal), ask((preferred + 1) % n, query, timeoutMs, stop.signal)]);
      stop.abort();
      return win(r);
    } catch (err) { lastErr = err.errors ? err.errors[0] : err; }
  }
  // Ensuite, les autres serveurs un par un, puis un second tour après une pause.
  for (let k = n > 1 ? 2 : 0; k < n * 2; k++) {
    if (k === n) await new Promise((r) => setTimeout(r, 4000));
    try { return win(await ask((preferred + k) % n, query, timeoutMs)); } catch (err) { lastErr = err; }
  }
  overpassState.error = String(lastErr && lastErr.message || lastErr);
  throw new Error('Les serveurs de données ne répondent pas (' + overpassState.error + ')');
}

const f = (x) => x.toFixed(5);

// Lieux d'intérêt dans un cadre.
export function qPlaces(b) {
  const bb = `(${f(b.s)},${f(b.w)},${f(b.n)},${f(b.e)})`;
  return `[out:json][timeout:50];
(
  node["natural"="peak"]["name"]${bb};
  node["natural"="volcano"]["name"]${bb};
  nwr["waterway"="waterfall"]["name"]${bb};
  nwr["natural"="waterfall"]["name"]${bb};
  nwr["natural"="water"]["name"]["water"~"^(lake|reservoir|pond|lagoon)$"]${bb};
  nwr["natural"="water"]["name"]["wikidata"]${bb};
  nwr["tourism"="viewpoint"]["name"]${bb};
  nwr["historic"~"^(castle|ruins|fort|archaeological_site|monastery|tower)$"]["name"]${bb};
  nwr["man_made"="tower"]["tower:type"="observation"]["name"]${bb};
  nwr["natural"="cave_entrance"]["name"]${bb};
  nwr["natural"~"^(rock|stone|cliff|arch)$"]["name"]${bb};
  nwr["natural"="gorge"]["name"]${bb};
  nwr["tourism"~"^(alpine_hut|wilderness_hut)$"]["name"]${bb};
);
out center tags qt;`;
}

// Réseau de sentiers, balisage, parkings et repères autour d'un point.
export function qGraph(lat, lon, radius) {
  const a = `(around:${Math.round(radius)},${f(lat)},${f(lon)})`;
  return `[out:json][timeout:60];
way["highway"~"^(path|footway|track|steps|bridleway|pedestrian|cycleway|living_street|residential|unclassified|service|tertiary|secondary|road)$"]["access"!~"^(private|no)$"]["foot"!~"^(private|no)$"]${a}->.w;
.w out geom qt;
rel["route"~"^(hiking|foot)$"](bw.w);
out body qt;
(
  nwr["amenity"="parking"]["access"!~"^(private|no|customers|permit|delivery)$"]${a};
  node["railway"~"^(station|halt)$"]${a};
  node["place"~"^(village|hamlet|town|locality|isolated_dwelling)$"]["name"]${a};
  node["natural"="saddle"]["name"]${a};
  node["tourism"="information"]["information"="guidepost"]["name"]${a};
);
out center tags qt;`;
}

// Sentiers dans un cadre (carte de terrain hors ligne autour d'une trace importée).
export function qWays(b) {
  const bb = `(${f(b.s)},${f(b.w)},${f(b.n)},${f(b.e)})`;
  return `[out:json][timeout:60];
way["highway"~"^(path|footway|track|steps|bridleway|pedestrian|cycleway|living_street|residential|unclassified|service|tertiary|secondary|road)$"]${bb};
out geom qt;`;
}

// Géométrie complète d'un circuit balisé.
export function qRelation(id) {
  return `[out:json][timeout:60];
relation(${Number(id)});
out body;
way(r);
out geom qt;`;
}

// Lieux notables d'un ou plusieurs types dans un rayon (recherche guidée). `types` : clés de TYPES.
export function qNotable(lat, lon, radius, types) {
  const a = `(around:${Math.round(radius)},${f(lat)},${f(lon)})`;
  const want = (t) => !types.length || types.includes(t);
  const parts = [];
  if (want('cascade')) parts.push(`nwr["waterway"="waterfall"]["name"]${a};`, `nwr["natural"="waterfall"]["name"]${a};`);
  if (want('gorge')) parts.push(`nwr["natural"="gorge"]["name"]${a};`);
  if (want('lac')) parts.push(`nwr["natural"="water"]["name"]["wikidata"]${a};`);
  if (want('sommet')) parts.push(`node["natural"="peak"]["name"]["wikidata"]${a};`);
  if (want('vue')) parts.push(`nwr["tourism"="viewpoint"]["name"]["wikidata"]${a};`, `nwr["man_made"="tower"]["tower:type"="observation"]["name"]["wikidata"]${a};`);
  if (want('chateau')) parts.push(`nwr["historic"~"^(castle|ruins|fort|monastery)$"]["name"]["wikidata"]${a};`);
  if (want('grotte')) parts.push(`nwr["natural"="cave_entrance"]["name"]${a};`);
  if (want('rocher')) parts.push(`nwr["natural"~"^(rock|stone|cliff|arch)$"]["name"]["wikidata"]${a};`);
  if (want('refuge')) parts.push(`nwr["tourism"~"^(alpine_hut|wilderness_hut)$"]["name"]${a};`);
  return `[out:json][timeout:60];
(
  ${parts.join('\n  ')}
);
out center tags qt;`;
}
