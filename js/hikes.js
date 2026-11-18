// Propositions de randonnées pour un lieu : réseau de sentiers, boucles, dénivelé, niveau.
import { CONFIG, levelOf } from './config.js';
import { overpass, qGraph, qRelation, qWays } from './overpass.js';
import { buildGraph, proposeHikes, markedCircuits, corridor, stitch } from './router.js';
import { profile, summarize } from './elev.js';
import { knownPlaces } from './places.js';
import { kv, settings, dist, simplify, walkMinutes, lineLength, bboxOf, uid, cumulative, slugOf, projector } from './util.js';

const TTL = 30 * 86400000;
const FORMAT = 5;

// Carnet de route : tronçons de balisage (marks : [début, fin, symbole, nom], en mètres le long de la trace)
// et intersections (turns : [mètres, code]) recalés sur la trace simplifiée.
function roadbook(h, c) {
  const cum = cumulative(h.pts), total = cum[cum.length - 1];
  if (c.source === 'balise') { h.marks = c.symbol ? [[0, Math.round(total), c.symbol, c.name || '']] : []; h.turns = []; return; }
  const k = c.meters ? total / c.meters : 1;
  h.marks = (c.marks || []).map(([a, b, s, n]) => [Math.round(a * k), Math.round(b * k), s, n]);
  h.unsureRuns = (c.unsureRuns || []).map(([a, b]) => [Math.round(a * k), Math.round(b * k)]);
  // Chaque intersection est projetée sur la trace, en avançant toujours : une boucle qui se recroise ne revient pas en arrière.
  h.turns = [];
  for (const [la, lo, code, at0] of c.turns || []) {
    // On cherche autour de la distance prévue : un carrefour traversé deux fois garde ses deux consignes.
    const hint = at0 != null ? at0 * k : null;
    const proj = projector(la);
    const [px, py] = proj([la, lo]);
    let best = { d: Infinity, at: 0 };
    for (let i = 0; i < h.pts.length - 1; i++) {
      if (hint != null && (cum[i + 1] < hint - 150 || cum[i] > hint + 150)) continue;
      const [ax, ay] = proj(h.pts[i]), [bx, by] = proj(h.pts[i + 1]);
      const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
      const d = Math.hypot(ax + t * vx - px, ay + t * vy - py);
      if (d < best.d) best = { d, at: cum[i] + (cum[i + 1] - cum[i]) * t };
    }
    if (best.d < 15) h.turns.push([Math.round(best.at), code]);
  }
  h.turns.sort((a, b) => a[0] - b[0]);
}

// Écarte les randos trop routières (plus de 35 % sur route) quand le même niveau a une autre proposition.
export function tidy(hikes) {
  const roady = (h) => (h.road || 0) > 0.35;
  const out = hikes.filter((h) => !roady(h) || !hikes.some((o) => o !== h && o.level === h.level && !roady(o)));
  // À niveau égal, la moins routière d'abord.
  return out.sort((a, b) => (a.level === b.level ? (a.road || 0) - (b.road || 0) : 0));
}
const tick = () => new Promise((r) => setTimeout(r, 30));

function scoreOf(c) {
  const km = c.meters / 1000;
  const target = km <= 8 ? 5.5 : km <= 15 ? 11 : 18;
  return -(c.overlap || 0) * 1.5 - (c.road || 0) * 3 + (c.marked ?? 0.8) + (c.source === 'balise' ? 1.5 : 0) - Math.abs(km - target) / target - (c.alpine ? 3 : 0);
}

function preselect(cands) {
  const bands = [[], [], []];
  for (const c of cands) {
    const km = c.meters / 1000;
    if (km > 27 || km < 3) continue; // ni expédition, ni simple promenade (circuits balisés compris)
    c.score = scoreOf(c);
    bands[km <= 8 ? 0 : km <= 15 ? 1 : 2].push(c);
  }
  const out = [];
  for (const b of bands) { b.sort((x, y) => y.score - x.score); out.push(...b.slice(0, 3)); }
  return out.slice(0, 8);
}

function titleOf(c) {
  if (c.source === 'balise') return c.name;
  const from = c.start.name || (c.start.kind === 'parking' ? 'le parking' : c.start.kind === 'gare' ? 'la gare' : c.start.kind === 'village' ? 'le village' : 'la route');
  return (c.kind === 'boucle' ? 'Boucle depuis ' : 'Aller-retour depuis ') + from + (c.via ? ' par ' + c.via.name : '');
}

async function measure(h) {
  try {
    const p = await profile(h.pts);
    Object.assign(h, { up: p.up, down: p.down, min: p.min, max: p.max, minutes: Math.round(p.minutes), prof: p.prof });
  } catch {
    h.up = null; h.prof = null;
    h.minutes = Math.round(walkMinutes(h.meters, 0, 0));
  }
  h.level = levelOf(h.meters / 1000, h.up || 0);
  return h;
}

// Télécharge et garde les randos précalculées d'un lieu de la sélection. Renvoie true si c'est fait.
export async function prefetchPlace(place) {
  const key = 'rt:' + place.id;
  const cached = await kv.get(key);
  if (cached && cached.v === FORMAT && cached.pre) return true;
  const res = await fetch('data/hikes/' + slugOf(place.name) + '.json', { cache: 'no-cache' });
  if (!res.ok) return false;
  const pre = await res.json();
  if (pre.v !== FORMAT || !pre.hikes || !pre.hikes.length) return false;
  for (const h of pre.hikes) h.placeId = place.id;
  pre.hikes = tidy(pre.hikes);
  await kv.set(key, { ...pre, t: Date.now(), pre: true });
  return true;
}

export async function hikesFor(place, onStep = () => {}, force = false) {
  const key = 'rt:' + place.id;
  let stale = null;
  if (!force) {
    const cached = await kv.get(key);
    if (cached && cached.v === FORMAT && Date.now() - cached.t < (cached.noEle ? 15 * 60000 : TTL)) return cached;
    if (cached && cached.v === FORMAT) stale = cached;
  }
  // Sans réseau, une ancienne version gardée vaut mieux que rien.
  if (stale && typeof navigator !== 'undefined' && navigator.onLine === false) return stale;
  // Lieux du catalogue : randos précalculées chaque semaine, servies avec l'appli (instantané).
  if (place.curated && !force) {
    try {
      const res = await fetch('data/hikes/' + slugOf(place.name) + '.json', { cache: 'no-cache' });
      if (res.ok) {
        const pre = await res.json();
        if (pre.v === FORMAT && pre.hikes && pre.hikes.length) {
          for (const h of pre.hikes) h.placeId = place.id;
          pre.hikes = tidy(pre.hikes);
          const out = { ...pre, t: Date.now(), pre: true };
          await kv.set(key, out);
          return out;
        }
      }
    } catch { /* pas de fichier : on calcule sur place */ }
  }
  onStep('Chargement des sentiers autour du lieu');
  let els;
  try { els = await overpass(qGraph(place.lat, place.lon, CONFIG.graphRadius)); } catch (err) { if (stale) return stale; throw err; }
  onStep('Recherche des boucles possibles');
  await tick();
  const raw = els.filter((e) => e.type === 'way' && e.geometry && e.tags && e.tags.highway);
  const g = buildGraph(els);
  const others = knownPlaces().filter((p) => p.id !== place.id && Math.abs(p.lat - place.lat) < 0.05 && Math.abs(p.lon - place.lon) < 0.07);
  const res = proposeHikes(g, place, others);
  const circ = markedCircuits(g, place, raw);
  const picked = preselect([...circ.complete, ...res.candidates]);
  onStep('Calcul du dénivelé');
  const hikes = [];
  for (const c of picked) {
    const h = {
      id: uid(), kind: c.kind, source: c.source, title: titleOf(c), score: c.score,
      placeId: place.id, place: { name: place.name, lat: place.lat, lon: place.lon, type: place.type },
      start: c.start ? { name: c.start.name, lat: c.start.lat, lon: c.start.lon, kind: c.start.kind } : { name: '', lat: c.pts[0][0], lon: c.pts[0][1], kind: 'balise' },
      via: c.via || null, pts: simplify(c.pts, 2), meters: c.meters,
      road: c.road || 0, marked: c.marked ?? 1, alpine: !!c.alpine, demanding: !!c.demanding,
      unsure: c.unsure || 0, maxUnsure: c.maxUnsure || 0,
      relId: c.source === 'balise' ? c.id : null, symbol: c.symbol || '', website: c.website || '',
    };
    roadbook(h, c);
    await measure(h);
    h.corridor = corridor(raw, h.pts, 450);
    hikes.push(h);
  }
  const lv = { facile: 0, moyenne: 1, difficile: 2 };
  hikes.sort((a, b) => lv[a.level] - lv[b.level] || b.score - a.score);
  const seen = new Set();
  const passing = circ.passing.filter((p) => p.name && !seen.has(p.name) && seen.add(p.name)).slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, symbol: p.symbol }));
  const partial = circ.partial.filter((p) => !hikes.some((h) => h.relId === p.id)).slice(0, 5).map((p) => ({ id: p.id, name: p.name, symbol: p.symbol }));
  const out = {
    v: FORMAT, t: Date.now(), hikes: tidy(hikes), passing, partial,
    reason: hikes.length ? '' : (res.reason || 'Aucune boucle raisonnable trouvée sur les sentiers cartographiés.'),
    noEle: hikes.some((h) => h.up === null),
  };
  await kv.set(key, out);
  // On ne garde que les 40 derniers lieux calculés.
  const idx = settings.get('rtIndex', []).filter((k) => k !== key);
  idx.unshift(key);
  for (const old of idx.splice(40)) kv.del(old);
  settings.set('rtIndex', idx);
  return out;
}

// Charge un circuit balisé complet à partir de son numéro de relation OpenStreetMap.
export async function loadCircuit(meta, place) {
  const els = await overpass(qRelation(meta.id));
  const rel = els.find((e) => e.type === 'relation');
  const ways = els.filter((e) => e.type === 'way' && e.geometry);
  if (!rel || !ways.length) throw new Error('Circuit introuvable.');
  const order = rel.members.filter((m) => m.type === 'way').map((m) => ways.find((w) => w.id === m.ref)).filter(Boolean);
  const st = stitch(order.map((w) => ({ nodes: w.nodes, pts: w.geometry.map((p) => [p.lat, p.lon]) })));
  if (st.coverage < 0.85 || st.pts.length < 5) throw new Error('Ce circuit comporte des variantes : sa trace ne peut pas être assemblée automatiquement.');
  const h = {
    id: uid(), kind: st.closed ? 'circuit' : 'itinéraire', source: 'balise', title: meta.name, score: 0,
    placeId: place.id, place: { name: place.name, lat: place.lat, lon: place.lon, type: place.type },
    start: { name: '', lat: st.pts[0][0], lon: st.pts[0][1], kind: 'balise' }, via: null,
    pts: simplify(st.pts, 2), meters: lineLength(st.pts), road: 0, marked: 1, alpine: false, demanding: false,
    relId: meta.id, symbol: meta.symbol || '', website: meta.website || (rel.tags && /^https?:\/\//i.test(rel.tags.website || '') ? rel.tags.website : ''), corridor: null,
  };
  roadbook(h, { source: 'balise', symbol: meta.symbol || '', name: meta.name });
  return measure(h);
}

// Trace importée depuis un fichier GPX.
export async function fromGpx(parsed, fileLabel) {
  const pts = simplify(parsed.pts, 2);
  const h = {
    id: uid(), kind: dist(pts[0], pts[pts.length - 1]) < 150 ? 'boucle' : 'itinéraire', source: 'import',
    title: parsed.name || fileLabel || 'Trace importée', score: 0, placeId: null,
    place: null, start: { name: '', lat: pts[0][0], lon: pts[0][1], kind: 'import' }, via: null,
    pts, meters: lineLength(pts), road: 0, marked: 0, alpine: false, demanding: false, relId: null, symbol: '', corridor: null,
  };
  if (parsed.eles) {
    const s = summarize(parsed.pts, parsed.eles.map((e, i, a) => (isFinite(e) ? e : a[i - 1] || 0)), lineLength(parsed.pts));
    Object.assign(h, { up: s.up, down: s.down, min: s.min, max: s.max, minutes: Math.round(s.minutes), prof: thin(s.prof, 320) });
    h.level = levelOf(h.meters / 1000, h.up);
  } else {
    await measure(h);
  }
  return h;
}

function thin(prof, max) {
  if (prof.length <= max) return prof;
  const k = Math.ceil(prof.length / max);
  return prof.filter((_, i) => i % k === 0 || i === prof.length - 1);
}

// Carte de terrain autour de la trace, pour le guidage hors ligne.
export async function ensureCorridor(h) {
  if (h.corridor && h.corridor.length) return h;
  const els = await overpass(qWays(bboxOf(h.pts, 450)));
  h.corridor = corridor(els.filter((e) => e.type === 'way' && e.geometry && e.tags), h.pts, 450);
  return h;
}

export { cumulative };
