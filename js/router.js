// Moteur d'itinéraires : construit le réseau de sentiers autour d'un lieu et propose des boucles.
// Aucune dépendance au navigateur : ce fichier se teste seul.
import { dist, lineLength } from './util.js';

const FACTOR = {
  path: 1.0, footway: 1.0, bridleway: 1.0, steps: 1.15, track: 1.05, pedestrian: 1.1,
  cycleway: 1.4, living_street: 1.6, residential: 1.7, service: 1.7, road: 2.0,
  unclassified: 2.0, tertiary: 2.8, secondary: 4.5,
};
const ROADS = new Set(['living_street', 'residential', 'service', 'road', 'unclassified', 'tertiary', 'secondary', 'cycleway']);
const ALPINE = new Set(['alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking']);

function wayFactor(tags, marked) {
  let f = FACTOR[tags.highway] ?? 2.5;
  if (marked) f *= 0.75;
  const sac = tags.sac_scale;
  if (sac === 'mountain_hiking') f *= 1.1;
  else if (sac === 'demanding_mountain_hiking') f *= 1.7;
  else if (ALPINE.has(sac)) f *= 6;
  if (/^(bad|horrible|no)$/.test(tags.trail_visibility || '')) f *= 2;
  if (tags.via_ferrata_scale || tags.highway === 'via_ferrata') f *= 20;
  return f;
}

export function buildGraph(elements) {
  const ways = [];
  const relations = [];
  const extras = [];
  for (const el of elements) {
    if (el.type === 'way' && el.geometry && el.nodes && el.tags && el.tags.highway) ways.push(el);
    else if (el.type === 'relation' && el.members && el.tags && /^(hiking|foot)$/.test(el.tags.route || '')) relations.push(el);
    else if (el.tags) extras.push(el);
  }
  // Voies balisées : celles qui appartiennent à un itinéraire de randonnée.
  const markedBy = new Map();
  for (const r of relations) {
    for (const m of r.members) {
      if (m.type !== 'way') continue;
      if (!markedBy.has(m.ref)) markedBy.set(m.ref, []);
      markedBy.get(m.ref).push(r.id);
    }
  }
  const idx = new Map();
  const lat = [], lon = [];
  const eFrom = [], eTo = [], eLen = [], eFac = [], eWay = [];
  const wayInfo = [];
  ways.forEach((w, wi) => {
    const marked = markedBy.has(w.id);
    const fac = wayFactor(w.tags, marked);
    wayInfo.push({
      id: w.id, highway: w.tags.highway, name: w.tags.name || '', marked,
      road: ROADS.has(w.tags.highway), alpine: ALPINE.has(w.tags.sac_scale), demanding: w.tags.sac_scale === 'demanding_mountain_hiking',
      nodes: w.nodes, first: -1,
    });
    let prev = -1;
    const n = Math.min(w.nodes.length, w.geometry.length);
    for (let k = 0; k < n; k++) {
      const g = w.geometry[k];
      if (!g) { prev = -1; continue; }
      let v = idx.get(w.nodes[k]);
      if (v === undefined) { v = lat.length; idx.set(w.nodes[k], v); lat.push(g.lat); lon.push(g.lon); }
      if (prev >= 0 && prev !== v) {
        const len = dist([lat[prev], lon[prev]], [lat[v], lon[v]]);
        eFrom.push(prev); eTo.push(v); eLen.push(len); eFac.push(fac); eWay.push(wi);
      }
      prev = v;
    }
  });
  const n = lat.length, m = eFrom.length;
  const start = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) { start[eFrom[e] + 1]++; start[eTo[e] + 1]++; }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = start.slice(0, n);
  const adjTo = new Int32Array(2 * m), adjEdge = new Int32Array(2 * m);
  for (let e = 0; e < m; e++) {
    adjTo[fill[eFrom[e]]] = eTo[e]; adjEdge[fill[eFrom[e]]++] = e;
    adjTo[fill[eTo[e]]] = eFrom[e]; adjEdge[fill[eTo[e]]++] = e;
  }
  // Grille de recherche du sommet le plus proche (cases d'environ 110 m).
  const grid = new Map();
  const cell = (la, lo) => Math.floor(la * 1000) + ':' + Math.floor(lo * 1000 * 0.67);
  for (let i = 0; i < n; i++) {
    const k = cell(lat[i], lon[i]);
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }
  // Composantes connexes : sert à éviter d'accrocher un lieu à un bout de sentier isolé.
  const comp = new Int32Array(n).fill(-1);
  const compSize = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue;
    const c = compSize.length;
    let size = 0;
    const stack = [i];
    comp[i] = c;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (let a = start[u]; a < start[u + 1]; a++) {
        const v = adjTo[a];
        if (comp[v] < 0) { comp[v] = c; stack.push(v); }
      }
    }
    compSize.push(size);
  }
  return {
    comp, compSize,
    n, m, lat, lon, start, adjTo, adjEdge,
    eLen: Float64Array.from(eLen), eFac: Float32Array.from(eFac), eWay: Int32Array.from(eWay),
    ways: wayInfo, relations, extras, idx, grid, markedBy,
  };
}

export function nearestVertex(g, la, lo, maxM = 400, minComp = 0) {
  const cy = Math.floor(la * 1000), cx = Math.floor(lo * 1000 * 0.67);
  const rings = Math.ceil(maxM / 100) + 1;
  let best = -1, bd = maxM;
  for (let r = 0; r <= rings; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(y - cy), Math.abs(x - cx)) !== r) continue;
        const a = g.grid.get(y + ':' + x);
        if (!a) continue;
        for (const v of a) {
          if (minComp && g.compSize[g.comp[v]] < minComp) continue;
          const d = dist([la, lo], [g.lat[v], g.lon[v]]);
          if (d < bd) { bd = d; best = v; }
        }
      }
    }
    if (best >= 0 && bd < (r - 0.5) * 100) break;
  }
  return best < 0 ? null : { v: best, d: bd };
}

// Dijkstra avec tas binaire. `pen` : multiplicateur de coût par arête (Float32Array) ou null.
export function shortest(g, src, pen = null, maxCost = Infinity) {
  const n = g.n;
  const cost = new Float64Array(n).fill(Infinity);
  const meters = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge = new Int32Array(n).fill(-1);
  const hk = [], hv = [];
  const push = (k, v) => {
    let i = hk.length; hk.push(k); hv.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= k) break;
      hk[i] = hk[p]; hv[i] = hv[p]; i = p;
    }
    hk[i] = k; hv[i] = v;
  };
  const pop = () => {
    const k0 = hk[0], v0 = hv[0];
    const k = hk.pop(), v = hv.pop();
    const len = hk.length;
    if (len) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= k) break;
        hk[i] = hk[c]; hv[i] = hv[c]; i = c;
      }
      hk[i] = k; hv[i] = v;
    }
    return [k0, v0];
  };
  cost[src] = 0;
  push(0, src);
  while (hk.length) {
    const [c, u] = pop();
    if (c > cost[u]) continue;
    if (c > maxCost) break;
    for (let a = g.start[u]; a < g.start[u + 1]; a++) {
      const e = g.adjEdge[a], v = g.adjTo[a];
      const nc = c + g.eLen[e] * g.eFac[e] * (pen ? pen[e] : 1);
      if (nc < cost[v]) {
        cost[v] = nc; meters[v] = meters[u] + g.eLen[e]; prev[v] = u; prevEdge[v] = e;
        push(nc, v);
      }
    }
  }
  return { cost, meters, prev, prevEdge, src };
}

// Chemin de la source de `res` jusqu'à `target` : sommets et arêtes dans l'ordre.
export function pathTo(res, target) {
  if (res.prev[target] < 0 && target !== res.src) return null;
  const verts = [], edges = [];
  for (let v = target; v !== -1; v = res.prev[v]) {
    verts.push(v);
    if (res.prevEdge[v] >= 0) edges.push(res.prevEdge[v]);
  }
  verts.reverse(); edges.reverse();
  return { verts, edges };
}

const coords = (g, verts) => verts.map((v) => [g.lat[v], g.lon[v]]);

function describe(g, edges) {
  let total = 0, road = 0, marked = 0, alpine = 0, demanding = 0;
  const names = new Map();
  for (const e of edges) {
    const w = g.ways[g.eWay[e]], len = g.eLen[e];
    total += len;
    if (w.road) road += len;
    if (w.marked) marked += len;
    if (w.alpine) alpine += len;
    if (w.demanding) demanding += len;
    if (w.name) names.set(w.name, (names.get(w.name) || 0) + len);
  }
  return {
    meters: total, road: total ? road / total : 0, marked: total ? marked / total : 0,
    alpine: alpine > 30, demanding: demanding > 100,
  };
}

function label(el) {
  const t = el.tags || {};
  return t.name || '';
}
function center(el) {
  if (el.type === 'node') return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  return null;
}

// Points de départ possibles : parkings d'abord, gares, puis hameaux en dernier recours.
export function startPoints(g) {
  const out = [];
  const seen = new Map();
  const add = (el, kind, rank) => {
    const c = center(el);
    if (!c) return;
    const s = nearestVertex(g, c[0], c[1], kind === 'parking' ? 160 : 300, Math.min(200, Math.max(...g.compSize, 0)));
    if (!s) return;
    const key = Math.round(c[0] * 400) + ':' + Math.round(c[1] * 270); // regroupe à ~250 m
    const cur = seen.get(key);
    const item = { v: s.v, lat: c[0], lon: c[1], kind, name: label(el), rank: rank + (label(el) ? 1 : 0) };
    if (!cur || item.rank > cur.rank) seen.set(key, item);
  };
  for (const el of g.extras) {
    const t = el.tags;
    if (t.amenity === 'parking') {
      if (t.parking === 'underground' || t.parking === 'multi-storey') continue;
      add(el, 'parking', 3 + (t.capacity && Number(t.capacity) >= 10 ? 1 : 0) + (t.fee === 'no' ? 0.5 : 0));
    } else if (t.railway === 'station' || t.railway === 'halt') add(el, 'gare', 2);
  }
  for (const v of seen.values()) out.push(v);
  if (out.length < 3) {
    for (const el of g.extras) {
      const t = el.tags;
      if (t.place && /^(village|hamlet|town)$/.test(t.place)) add(el, 'village', 1);
    }
    out.length = 0;
    for (const v of seen.values()) out.push(v);
  }
  return out;
}

const DRIVE = new Set(['living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'service']);
// Accès routiers : sommets où un sentier ou un chemin rejoint une route carrossable.
function roadAccess(g, fromP) {
  const seen = new Map();
  for (let v = 0; v < g.n; v++) {
    if (fromP.cost[v] === Infinity || fromP.meters[v] < 500) continue;
    let drive = false, trail = false;
    for (let a = g.start[v]; a < g.start[v + 1]; a++) {
      const w = g.ways[g.eWay[g.adjEdge[a]]];
      if (DRIVE.has(w.highway)) drive = true; else if (!w.road) trail = true;
    }
    if (!drive || !trail) continue;
    const key = Math.round(g.lat[v] * 330) + ':' + Math.round(g.lon[v] * 220); // regroupe à ~300 m
    const cur = seen.get(key);
    if (!cur || fromP.meters[v] < fromP.meters[cur.v]) seen.set(key, { v, lat: g.lat[v], lon: g.lon[v], kind: 'route', name: '', rank: 0 });
  }
  return [...seen.values()];
}

// Nom lisible le plus proche d'un point (hameau, col, poteau indicateur, village).
export function nearestName(g, la, lo, maxM = 2500) {
  let best = '', bd = maxM;
  for (const el of g.extras) {
    const t = el.tags;
    if (!t.name) continue;
    if (!(t.place || t.natural === 'saddle' || t.information === 'guidepost')) continue;
    const c = center(el);
    if (!c) continue;
    const d = dist([la, lo], c) * (t.place === 'locality' ? 1.3 : 1);
    if (d < bd) { bd = d; best = t.name; }
  }
  return best;
}

function bearing(a, b) {
  const y = Math.sin(((b[1] - a[1]) * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180);
  const x = Math.cos((a[0] * Math.PI) / 180) * Math.sin((b[0] * Math.PI) / 180) -
    Math.sin((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.cos(((b[1] - a[1]) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const BANDS = [
  { id: 'proche', min: 500, max: 2400 },
  { id: 'moyen', min: 2400, max: 4800 },
  { id: 'loin', min: 4800, max: 8500 },
];

// Propose des randonnées vers le lieu `place` ({lat, lon, name}). `others` : autres lieux notables pour allonger une boucle.
export function proposeHikes(g, place, others = []) {
  const big = Math.min(200, Math.max(...g.compSize, 0));
  const snap = nearestVertex(g, place.lat, place.lon, 800, big) || nearestVertex(g, place.lat, place.lon, 800);
  if (!snap) return { candidates: [], reason: 'Aucun sentier cartographié à moins de 800 m de ce lieu.' };
  const P = snap.v;
  const fromP = shortest(g, P);
  let starts = startPoints(g).filter((s) => fromP.cost[s.v] < Infinity);
  // Peu de parkings cartographiés : on part des endroits où un sentier rejoint une route carrossable.
  if (starts.length < 2) starts = starts.concat(roadAccess(g, fromP));
  if (!starts.length) return { candidates: [], reason: 'Aucun parking ni accès routier relié à ce lieu par des sentiers.' };

  // Choix des départs : jusqu'à trois par tranche de distance, dans des directions différentes.
  const picked = [];
  for (const band of BANDS) {
    const inBand = starts
      .map((s) => ({ ...s, oneWay: fromP.meters[s.v], brg: bearing([place.lat, place.lon], [s.lat, s.lon]) }))
      .filter((s) => s.oneWay >= band.min && s.oneWay < band.max)
      .sort((a, b) => b.rank - a.rank || a.oneWay - b.oneWay);
    const used = [];
    for (const s of inBand) {
      if (used.length >= 3) break;
      if (used.some((u) => Math.abs(((s.brg - u.brg + 540) % 360) - 180) < 50)) continue;
      used.push(s);
    }
    picked.push(...used.map((s) => ({ ...s, band: band.id })));
  }
  // Rien dans les tranches : on prend les départs les plus proches, quels qu'ils soient.
  if (!picked.length) {
    starts.map((s) => ({ ...s, oneWay: fromP.meters[s.v], band: 'proche' }))
      .sort((a, b) => a.oneWay - b.oneWay).slice(0, 2).forEach((s) => picked.push(s));
  }

  const candidates = [];
  const pen = new Float32Array(g.m);
  for (const s of picked) {
    const outPath = pathTo(fromP, s.v); // P -> S dans l'arbre, donc S -> P à l'envers
    if (!outPath) continue;
    const outVerts = outPath.verts.slice().reverse();
    const outEdges = outPath.edges.slice().reverse();
    pen.fill(1);
    for (const e of outEdges) pen[e] = 3.5;
    const back = pathTo(shortest(g, P, pen), s.v);
    let cand = null;
    if (back) {
      const outSet = new Set(outEdges);
      let shared = 0, backLen = 0;
      for (const e of back.edges) { backLen += g.eLen[e]; if (outSet.has(e)) shared += g.eLen[e]; }
      const overlap = backLen ? shared / backLen : 1;
      if (overlap < 0.55) {
        const edges = outEdges.concat(back.edges);
        cand = { kind: 'boucle', verts: outVerts.concat(back.verts.slice(1)), edges, overlap };
      }
    }
    if (!cand) {
      cand = { kind: 'aller-retour', verts: outVerts.concat(outVerts.slice(0, -1).reverse()), edges: outEdges.concat(outEdges.slice().reverse()), overlap: 1 };
    }
    candidates.push(finish(g, cand, s, place, null));

    // Variante plus longue par un second lieu notable, pour les départs moyens et lointains.
    if (s.band !== 'proche' || s.oneWay > 1500) {
      const q = pickSecond(g, place, others, outVerts);
      if (q) {
        const leg1 = { verts: outVerts, edges: outEdges };
        pen.fill(1);
        for (const e of leg1.edges) pen[e] = 3.5;
        const resP = shortest(g, P, pen);
        const leg2 = pathTo(resP, q.v);
        if (leg2) {
          for (const e of leg2.edges) pen[e] = 3.5;
          const resQ = shortest(g, q.v, pen);
          const leg3 = pathTo(resQ, s.v);
          if (leg3) {
            const edges = leg1.edges.concat(leg2.edges, leg3.edges);
            const set1 = new Set(leg1.edges.concat(leg2.edges));
            let shared = 0, l3 = 0;
            for (const e of leg3.edges) { l3 += g.eLen[e]; if (set1.has(e)) shared += g.eLen[e]; }
            const overlap = l3 ? shared / l3 : 1;
            if (overlap < 0.6) {
              candidates.push(finish(g, { kind: 'boucle', verts: leg1.verts.concat(leg2.verts.slice(1), leg3.verts.slice(1)), edges, overlap }, s, place, q));
            }
          }
        }
      }
    }
  }
  // Écarte les doublons (même longueur à 150 m près et même départ) et les tracés trop routiers.
  const uniq = [];
  for (const c of candidates.sort((a, b) => a.meters - b.meters)) {
    if (c.meters < 3000) continue; // en dessous de 3 km, c'est une promenade, pas une rando
    if (c.road > 0.5 && candidates.length > 2) continue;
    if (uniq.some((u) => Math.abs(u.meters - c.meters) < 150 && u.start.v === c.start.v)) continue;
    uniq.push(c);
  }
  return { candidates: uniq, snapDistance: snap.d, starts: starts.length };
}

function pickSecond(g, place, others, outVerts) {
  let best = null, bs = -Infinity;
  const sample = outVerts.filter((_, i) => i % 8 === 0).map((v) => [g.lat[v], g.lon[v]]);
  for (const o of others) {
    const d = dist([place.lat, place.lon], [o.lat, o.lon]);
    if (d < 700 || d > 3200) continue;
    let near = Infinity;
    for (const p of sample) near = Math.min(near, dist(p, [o.lat, o.lon]));
    if (near < 350) continue;
    const s = nearestVertex(g, o.lat, o.lon, 250);
    if (!s) continue;
    const score = (o.score || 0) - Math.abs(d - 1800) / 600;
    if (score > bs) { bs = score; best = { ...o, v: s.v }; }
  }
  return best;
}

// ---------- Carnet de route : balisage suivi et intersections ----------

// Tronçons de balisage le long du parcours : [début (m), fin (m), osmc:symbol, nom de l'itinéraire].
function markRuns(g, edges) {
  if (!g.relById) g.relById = new Map(g.relations.map((r) => [r.id, r]));
  const runs = [];
  let along = 0, cur = null;
  for (const e of edges) {
    const w = g.ways[g.eWay[e]], len = g.eLen[e];
    const rels = (g.markedBy.get(w.id) || []).map((id) => g.relById.get(id)).filter((r) => r && r.tags && r.tags['osmc:symbol']);
    // On garde l'itinéraire en cours tant qu'il continue, sinon le premier balisé qui passe là.
    let r = cur && cur.rel && rels.find((x) => x.id === cur.rel.id);
    if (!r && cur && cur.rel) r = rels.find((x) => x.tags['osmc:symbol'] === cur.rel.tags['osmc:symbol']);
    if (!r) r = rels[0] || null;
    const key = r ? r.tags['osmc:symbol'] : '';
    if (!cur || cur.key !== key) { cur = { key, rel: r, from: along, to: along + len }; runs.push(cur); }
    else { cur.to += len; if (r) cur.rel = r; }
    along += len;
  }
  // Les bouts de moins de 120 m entre deux tronçons identiques sont absorbés (petit raccord, pont, carrefour).
  const out = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && (prev.key === r.key || r.to - r.from < 120)) { prev.to = r.to; continue; }
    if (prev && prev.to - prev.from < 120 && out.length > 1 && out[out.length - 2].key === r.key) { out.pop(); out[out.length - 1].to = r.to; continue; }
    out.push({ ...r });
  }
  // Un bout de moins de 150 m au départ ou à l'arrivée (accès au parking) rejoint le tronçon voisin.
  if (out.length > 1 && out[0].to - out[0].from < 150) { out[1].from = 0; out.shift(); }
  if (out.length > 1 && out[out.length - 1].to - out[out.length - 1].from < 150) { out[out.length - 2].to = out[out.length - 1].to; out.pop(); }
  return out.map((r) => [Math.round(r.from), Math.round(r.to), r.key, r.rel ? (r.rel.tags.name || r.rel.tags.ref || '') : '']);
}

const turnAngle = (a, b) => ((b - a + 540) % 360) - 180; // positif : vers la droite

// Intersections du parcours où il faut choisir : [lat, lon, code]. Codes : G/D à gauche/droite,
// LG/LD légèrement, TD tout droit (quand une autre branche part presque tout droit), DG/DD virage en épingle.
function junctionTurns(g, verts) {
  const P = (v) => [g.lat[v], g.lon[v]];
  const cum = [0];
  for (let i = 1; i < verts.length; i++) cum.push(cum[i - 1] + dist(P(verts[i - 1]), P(verts[i])));
  const total = cum[cum.length - 1];
  const turns = [];
  for (let i = 1; i < verts.length - 1; i++) {
    const v = verts[i];
    if (cum[i] < 30 || total - cum[i] < 30) continue;
    const nb = new Set();
    for (let a = g.start[v]; a < g.start[v + 1]; a++) nb.add(g.adjTo[a]);
    if (nb.size < 3) continue;
    // Directions d'arrivée et de départ mesurées sur une vingtaine de mètres.
    let j = i - 1; while (j > 0 && cum[i] - cum[j] < 20) j--;
    let k = i + 1; while (k < verts.length - 1 && cum[k] - cum[i] < 20) k++;
    const bin = bearing(P(verts[j]), P(v)), bout = bearing(P(v), P(verts[k]));
    const a = turnAngle(bin, bout);
    const others = [...nb].filter((u) => u !== verts[i - 1] && u !== verts[i + 1]).map((u) => turnAngle(bin, bearing(P(v), P(u))));
    if (!others.length) continue;
    const obvious = Math.abs(a) < 25 && others.every((b) => Math.abs(b) > 55);
    if (obvious) continue;
    const s = a >= 0 ? 'D' : 'G';
    const code = Math.abs(a) < 25 ? 'TD' : Math.abs(a) < 60 ? 'L' + s : Math.abs(a) < 140 ? s : 'D' + s;
    // Deux intersections à moins de 15 m : un seul carrefour, on garde la dernière consigne.
    if (turns.length && cum[i] - turns[turns.length - 1].at < 15) turns.pop();
    turns.push({ at: cum[i], lat: g.lat[v], lon: g.lon[v], code });
  }
  return turns.map((t) => [+t.lat.toFixed(5), +t.lon.toFixed(5), t.code, Math.round(t.at)]);
}

function finish(g, cand, start, place, via) {
  const info = describe(g, cand.edges);
  const pts = coords(g, cand.verts);
  const startName = start.name || nearestName(g, start.lat, start.lon) || '';
  return {
    kind: cand.kind, pts, meters: info.meters, road: info.road, marked: info.marked,
    alpine: info.alpine, demanding: info.demanding, overlap: cand.overlap,
    start: { v: start.v, lat: start.lat, lon: start.lon, kind: start.kind, name: startName },
    via: via ? { name: via.name, lat: via.lat, lon: via.lon } : null,
    source: 'calcul',
    marks: markRuns(g, cand.edges), turns: junctionTurns(g, cand.verts),
  };
}

// ---------- Circuits balisés (relations OpenStreetMap) ----------

// Assemble des voies en une ligne continue. ways : [{ nodes: [ids], pts: [[lat, lon]] }].
export function stitch(ways) {
  if (!ways.length) return { pts: [], coverage: 0, closed: false };
  const ends = new Map();
  ways.forEach((w, i) => {
    for (const nd of [w.nodes[0], w.nodes[w.nodes.length - 1]]) {
      if (!ends.has(nd)) ends.set(nd, []);
      ends.get(nd).push(i);
    }
  });
  const total = ways.reduce((s, w) => s + lineLength(w.pts), 0);
  // Départ : une extrémité libre s'il y en a une (itinéraire linéaire), sinon la première voie.
  let first = 0, flip = false;
  for (let i = 0; i < ways.length; i++) {
    const w = ways[i];
    const a = ends.get(w.nodes[0]).length, b = ends.get(w.nodes[w.nodes.length - 1]).length;
    if (a === 1 || b === 1) { first = i; flip = a !== 1; break; }
  }
  const used = new Uint8Array(ways.length);
  const pts = [];
  let cur = first, usedLen = 0, endNode;
  const take = (i, reversed) => {
    const w = ways[i];
    used[i] = 1; usedLen += lineLength(w.pts);
    const seg = reversed ? w.pts.slice().reverse() : w.pts;
    pts.push(...(pts.length ? seg.slice(1) : seg));
    endNode = reversed ? w.nodes[0] : w.nodes[w.nodes.length - 1];
  };
  take(cur, flip);
  for (;;) {
    const next = (ends.get(endNode) || []).find((i) => !used[i]);
    if (next !== undefined) { take(next, ways[next].nodes[0] !== endNode); continue; }
    // Petite coupure dans le balisage cartographié : on reprend à la voie dont une extrémité est à moins de 60 m.
    const tail = pts[pts.length - 1];
    let jump = -1, rev = false, bd = 60;
    for (let i = 0; i < ways.length; i++) {
      if (used[i]) continue;
      const a = dist(tail, ways[i].pts[0]), b = dist(tail, ways[i].pts[ways[i].pts.length - 1]);
      if (a < bd) { bd = a; jump = i; rev = false; }
      if (b < bd) { bd = b; jump = i; rev = true; }
    }
    if (jump < 0) break;
    take(jump, rev);
  }
  const closed = pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 60;
  return { pts, coverage: total ? usedLen / total : 0, closed };
}

const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '');

// Circuits balisés contenus dans le réseau chargé et passant près du lieu.
export function markedCircuits(g, place, rawWays) {
  const byId = new Map(rawWays.map((w) => [w.id, w]));
  const complete = [], partial = [], passing = [];
  for (const r of g.relations) {
    const t = r.tags;
    const members = r.members.filter((m) => m.type === 'way');
    if (!members.length) continue;
    const present = members.map((m) => byId.get(m.ref)).filter(Boolean);
    let near = Infinity;
    for (const w of present) {
      for (let k = 0; k < w.geometry.length; k += 3) {
        const d = dist([place.lat, place.lon], [w.geometry[k].lat, w.geometry[k].lon]);
        if (d < near) near = d;
      }
    }
    const name = t.name || t.ref || '';
    const meta = { id: r.id, name, symbol: t['osmc:symbol'] || '', network: t.network || '', operator: t.operator || '', website: safeUrl(t.website || t.url || t['contact:website'] || ''), roundtrip: t.roundtrip === 'yes', near };
    if (near < 200) passing.push(meta);
    if (near > 500 || !name) continue;
    if (present.length === members.length) {
      const st = stitch(present.map((w) => ({ nodes: w.nodes, pts: w.geometry.map((p) => [p.lat, p.lon]) })));
      const meters = lineLength(st.pts);
      if (st.coverage > 0.9 && (st.closed || meta.roundtrip) && meters > 1200 && meters < 32000) {
        complete.push({ ...meta, kind: 'circuit', pts: st.pts, meters, source: 'balise' });
        continue;
      }
    }
    if (meta.roundtrip || (t.distance && parseFloat(t.distance) <= 30)) partial.push(meta);
  }
  return { complete, partial, passing };
}

// Voies proches d'une trace, pour dessiner une carte de terrain hors ligne. Renvoie des polylignes légères.
export function corridor(rawWays, pts, meters = 450) {
  const cells = new Set();
  const key = (la, lo) => Math.floor(la * 250) + ':' + Math.floor(lo * 170);
  const r = Math.ceil(meters / 440);
  for (let i = 0; i < pts.length; i += 2) {
    const cy = Math.floor(pts[i][0] * 250), cx = Math.floor(pts[i][1] * 170);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) cells.add(y + ':' + x);
  }
  const out = [];
  for (const w of rawWays) {
    if (!w.geometry) continue;
    let hit = false;
    for (let k = 0; k < w.geometry.length; k += 2) {
      if (cells.has(key(w.geometry[k].lat, w.geometry[k].lon))) { hit = true; break; }
    }
    if (!hit) continue;
    const h = w.tags.highway;
    const cls = ROADS.has(h) ? 'r' : h === 'track' ? 't' : 'p';
    out.push({ c: cls, n: w.tags.name || '', p: w.geometry.map((q) => [Math.round(q.lat * 1e5) / 1e5, Math.round(q.lon * 1e5) / 1e5]) });
  }
  return out;
}
