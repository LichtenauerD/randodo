// Données de l'onglet Géographie, une fois par secteur : relief (800 m / 1 500 m), lacs, rivières, vallées,
// intercommunalités qui contiennent un lieu du catalogue. Sortie : data/geo/<secteur>.json (coordonnées [lon, lat]).
import { mkdir, writeFile } from 'node:fs/promises';
import { contours } from 'd3-contour';
import { elevationAt } from './dem.mjs';
import { readFile } from 'node:fs/promises';
import { paintSector } from './landcover.mjs';

globalThis.location = new URL('http://localhost/');
const { SITES } = await import('../data/sites.js');
const { slugOf } = await import('../js/util.js');
const UA = 'Randodo/1.6 (+https://github.com/LichtenauerD/randodo)';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R4 = (x) => Math.round(x * 1e4) / 1e4;

export const SECTOR_OF = { 'Vosges': 'vosges', 'Vosges du Nord': 'vosges', 'Forêt-Noire': 'foret-noire', 'Kaiserstuhl': 'foret-noire', 'Jura': 'jura', 'Jura alsacien': 'jura', 'Suisse': 'suisse' };
const RIVERS = {
  vosges: { major: ['Rhin', 'Rhein', 'Ill', 'Moselle', 'Meurthe', 'Sarre'], minor: ['Bruche', 'Fecht', 'Thur', 'Doller', 'Lauch', 'Zorn', 'Moder', 'Vologne', 'Moselotte', 'Weiss', 'Sauer', 'Zinsel du Nord', 'Andlau', 'Liepvrette', 'Giessen'] },
  'foret-noire': { major: ['Rhein', 'Rhin', 'Neckar', 'Donau'], minor: ['Kinzig', 'Murg', 'Dreisam', 'Elz', 'Wutach', 'Enz', 'Nagold', 'Gutach', 'Wiese', 'Alb', 'Rench', 'Acher', 'Schutter', 'Wilde Gutach', 'Rotbach'] },
  jura: { major: ['Doubs', 'Ain', 'Rhône', 'Rhin', 'Aar', 'Aare'], minor: ['Loue', 'Valserine', 'Hérisson', 'Orbe', 'Areuse', 'Birse', 'Saine', 'Bienne', 'Lison', 'Dessoubre', 'Suran', 'Sorne', 'Allaine'] },
  suisse: { major: ['Rhein', 'Aare', 'Reuss', 'Limmat', 'Rhône', 'Rhin'], minor: ['Kander', 'Simme', 'Saane', 'Sarine', 'Lütschine', 'Emme', 'Thur', 'Sitter', 'Linth', 'Lorze'] },
};
// Vallées connues : une rivière, dans un cadre [ouest, sud, est, nord].
const VALLEYS = {
  vosges: [['Vallée de Munster', 'Fecht', [7.05, 48.00, 7.30, 48.10]], ['Vallée de la Wormsa', 'Fecht', [6.98, 47.98, 7.10, 48.03]], ['Vallée de la Petite Fecht', 'Petite Fecht', [6.98, 48.02, 7.15, 48.08]], ['Vallée de la Doller', 'Doller', [6.85, 47.74, 7.10, 47.83]], ['Vallée de la Bruche', 'Bruche', [7.10, 48.40, 7.50, 48.55]]],
  'foret-noire': [['Vallée de la Kinzig', 'Kinzig', [7.95, 48.20, 8.35, 48.42]], ['Vallée de la Gutach', 'Gutach', [8.15, 48.15, 8.28, 48.30]], ['Simonswälder Tal', 'Wilde Gutach', [8.03, 48.03, 8.18, 48.12]], ['Vallée de l\'Enz', 'Enz', [8.40, 48.60, 8.62, 48.80]], ['Höllental', 'Rotbach', [7.95, 47.90, 8.10, 47.96]], ['Vallée de la Murg', 'Murg', [8.25, 48.55, 8.40, 48.80]]],
  jura: [['Vallée de la Loue', 'Loue', [6.05, 46.98, 6.30, 47.10]], ['Vallée du Hérisson', 'Hérisson', [5.80, 46.58, 5.95, 46.66]], ['Vallée de la Valserine', 'Valserine', [5.80, 46.10, 5.98, 46.35]]],
  suisse: [],
};

async function overpass(q) {
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(300000) });
      if (r.ok) return (await r.json()).elements;
      console.log('  overpass', r.status);
    } catch (e) { console.log('  overpass', e.message); }
    await sleep(20000 * (k + 1));
  }
  throw new Error('Overpass indisponible');
}

// Douglas-Peucker sur [lon, lat], tolérance en degrés.
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i]; let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const ring = (pts, tol) => { const s = simplify(pts, tol).map(([x, y]) => [R4(x), R4(y)]); return s.length >= 4 ? s : null; };
const areaKm2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); const lat = r[0][1] * Math.PI / 180; return Math.abs(a / 2) * 111.32 * 111.32 * Math.cos(lat); };

// Assemble les anneaux d'une relation à partir de ses chemins (géométrie Overpass « out geom »).
function rings(rel, role = 'outer') {
  const segs = rel.members.filter((m) => m.type === 'way' && (m.role === role || (role === 'outer' && m.role === '')) && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  const out = [];
  while (segs.length) {
    let cur = segs.shift();
    let grown = true;
    while (grown && !(cur.length > 3 && cur[0][0] === cur[cur.length - 1][0] && cur[0][1] === cur[cur.length - 1][1])) {
      grown = false;
      const end = cur[cur.length - 1];
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], a = s[0], b = s[s.length - 1];
        if (a[0] === end[0] && a[1] === end[1]) { cur = cur.concat(s.slice(1)); segs.splice(i, 1); grown = true; break; }
        if (b[0] === end[0] && b[1] === end[1]) { cur = cur.concat(s.slice(0, -1).reverse()); segs.splice(i, 1); grown = true; break; }
      }
    }
    if (cur.length > 3) out.push(cur);
  }
  return out;
}
const inRing = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };

async function relief(b) {
  const step = 0.006; const nx = Math.ceil((b[2] - b[0]) / step), ny = Math.ceil((b[3] - b[1]) / step);
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const e = await elevationAt(b[3] - (j + 0.5) * step, b[0] + (i + 0.5) * step);
    v[j * nx + i] = e == null || !isFinite(e) ? 0 : e;
  }
  const cs = contours().size([nx, ny]).thresholds([800, 1500])(Array.from(v));
  const toLL = ([x, y]) => [b[0] + x * step, b[3] - y * step];
  return cs.map((c) => c.coordinates.map((poly) => poly.map((r) => ring(r.map(toLL), 0.004)).filter(Boolean)).filter((p) => p.length && areaKm2(p[0]) > 2));
}

const only = (process.env.ONLY || '').split(',').filter(Boolean);
await mkdir('data/geo', { recursive: true });
for (const sector of ['vosges', 'foret-noire', 'jura', 'suisse']) {
  if (only.length && !only.includes(sector)) continue;
  const places = SITES.filter((s) => SECTOR_OF[s.massif] === sector);
  const lats = places.map((p) => p.lat), lons = places.map((p) => p.lon);
  const b = [Math.min(...lons) - 0.25, Math.min(...lats) - 0.2, Math.max(...lons) + 0.25, Math.max(...lats) + 0.2].map((x) => +x.toFixed(2));
  console.log(`== ${sector} : ${places.length} lieux, cadre ${b.join(', ')}`);
  // PARTS=fond : refait seulement le fond peint et le contour de zone, en gardant le reste du fichier.
  if (process.env.PARTS === 'fond') {
    const data = JSON.parse(await readFile(`data/geo/${sector}.json`, 'utf8'));
    Object.assign(data, await paintSector(sector, data.bbox, places, ring));
    await writeFile(`data/geo/${sector}.json`, JSON.stringify(data));
    continue;
  }
  const bb = `${b[1]},${b[0]},${b[3]},${b[2]}`;

  // 1. Relief
  const [mid, high] = await relief(b);
  console.log(`  relief : ${mid.length} zones > 800 m, ${high.length} > 1 500 m`);

  // 2. Lacs nommés et rivières principales
  const water = await overpass(`[out:json][timeout:240];(way["natural"="water"]["name"]["water"~"lake|reservoir|pond"](${bb});relation["natural"="water"]["name"](${bb}););out geom;`);
  const lakes = [];
  for (const e of water) {
    const rs = e.type === 'way' ? [e.geometry.map((p) => [p.lon, p.lat])] : rings(e);
    for (const r of rs) { if (areaKm2(r) < 0.04) continue; const s = ring(r, 0.0006); if (s) lakes.push(s); }
  }
  const names = [...RIVERS[sector].major, ...RIVERS[sector].minor, ...VALLEYS[sector].map((v) => v[1])];
  // En France, les noms de rivières portent leur article dans OpenStreetMap (« La Bruche », « L'Ill »).
  const rv = await overpass(`[out:json][timeout:240];way["waterway"="river"]["name"~"^((La|Le|Les) |L'|L’)?(${[...new Set(names)].join('|')})$"](${bb});out geom;`);
  const rivers = {};
  for (const w of rv) { const n = w.tags.name.replace(/^((La|Le|Les) |L'|L’)/, ''); (rivers[n] = rivers[n] || []).push(simplify(w.geometry.map((p) => [p.lon, p.lat]), 0.002).map(([x, y]) => [R4(x), R4(y)])); }
  const riverOut = Object.entries(rivers).map(([name, lines]) => ({ name, major: RIVERS[sector].major.includes(name), lines }));
  const valleys = VALLEYS[sector].map(([name, river, vb]) => ({ name, lines: (rivers[river] || []).map((l) => l.filter(([x, y]) => x >= vb[0] && x <= vb[2] && y >= vb[1] && y <= vb[3])).filter((l) => l.length > 1) })).filter((v) => v.lines.length);
  console.log(`  eau : ${lakes.length} lacs, ${riverOut.length} rivières, ${valleys.length} vallées`);

  // 3. Intercommunalité de chaque lieu (France : EPCI ; Allemagne : Verwaltungsverband, sinon commune ; Suisse : district, sinon commune)
  let q = '[out:json][timeout:240];';
  for (const p of places) q += `is_in(${p.lat},${p.lon})->.a;rel(pivot.a)[~"^boundary$"~"administrative|local_authority"];out ids tags;make lieu slug="${slugOf(p.name)}";out;`;
  const iss = await overpass(q);
  const placeUnit = {}, pending = [];
  for (const e of iss) {
    if (e.type === 'lieu') { placeUnit[e.tags.slug] = pick(pending.splice(0)); continue; }
    pending.push(e);
  }
  function pick(rels) {
    const t = (r) => r.tags || {};
    return (rels.find((r) => t(r)['local_authority:FR'] && t(r).boundary === 'local_authority')
      || rels.find((r) => t(r).admin_level === '7' && !t(r)['ref:INSEE'])
      || rels.find((r) => t(r).admin_level === '6' && (t(r)['ref:bfs'] || t(r)['swisstopo:BEZIRKSNUM'] || /^(District|Bezirk|Verwaltungskreis|Arrondissement administratif)/.test(t(r).name || '')))
      || rels.find((r) => t(r).admin_level === '8') || {}).id || null;
  }
  const ids = [...new Set(Object.values(placeUnit).filter(Boolean))];
  const units = {};
  for (let i = 0; i < ids.length; i += 25) {
    const els = await overpass(`[out:json][timeout:240];rel(id:${ids.slice(i, i + 25).join(',')});out geom;`);
    for (const r of els) {
      const rs = rings(r).map((x) => ring(x, 0.0015)).filter(Boolean);
      if (rs.length) units[r.id] = { name: r.tags.name, rings: rs };
    }
    await sleep(3000);
  }
  // Contrôle : le lieu est bien dans le polygone retenu.
  let bad = 0;
  for (const p of places) { const u = units[placeUnit[slugOf(p.name)]]; if (!u || !u.rings.some((r) => inRing([p.lon, p.lat], r))) { bad++; placeUnit[slugOf(p.name)] = u ? placeUnit[slugOf(p.name)] : null; } }
  console.log(`  intercommunalités : ${Object.keys(units).length} ; lieux hors polygone : ${bad}`);

  let painted = {};
  try { painted = await paintSector(sector, b, places, ring); } catch (e) { console.log('  fond peint impossible : ' + e.message); }
  const data = { sector, bbox: b, relief: { mid, high }, lakes, rivers: riverOut, valleys, units, placeUnit, ...painted };
  const json = JSON.stringify(data);
  await writeFile(`data/geo/${sector}.json`, json);
  console.log(`  écrit : ${(json.length / 1024).toFixed(0)} Ko`);
}
