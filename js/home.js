// Accueil : suggestions de la semaine, idées repérées sur le web, recherche guidée par temps de route.
import { CONFIG, TYPES } from './config.js';
import { SITES, notablePlaces, imageOf, fetchImages, searchRemote } from './places.js';
import { store, want, saveWant } from './state.js';
import { openPlace } from './sheet.js';
import { glyph } from './map.js';
import { kv, settings, dist, esc, fetchJson, toast, fmtKm, slugOf } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const LVC = { facile: 'var(--facile)', moyenne: 'var(--moyenne)', difficile: 'var(--difficile)' };
const LVL = { facile: 'Facile', moyenne: 'Moyenne', difficile: 'Difficile' };

// Les six envies de la recherche, chacune regroupant des types de lieux.
export const GROUPS = [
  { id: 'eau', phrase: 'des cascades et des gorges', label: 'Cascades et gorges', types: ['cascade', 'gorge'], icon: 'cascade' },
  { id: 'lac', phrase: 'des lacs', label: 'Lacs', types: ['lac'], icon: 'lac' },
  { id: 'vue', phrase: 'des sommets et des points de vue', label: 'Sommets et points de vue', types: ['sommet', 'vue'], icon: 'sommet' },
  { id: 'ruine', phrase: 'des châteaux et des ruines', label: 'Châteaux et ruines', types: ['chateau'], icon: 'chateau' },
  { id: 'roche', phrase: 'des rochers et des grottes', label: 'Rochers et grottes', types: ['rocher', 'grotte'], icon: 'rocher' },
  { id: 'abri', phrase: 'des refuges isolés', label: 'Refuges et bâtiments isolés', types: ['refuge'], icon: 'refuge' },
];
const DURATIONS = [[30, '30 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h'], [180, '3 h']];
// Sites d'altitude, écartés des suggestions de novembre à avril.
const HIGH = new Set(['Säntis', 'Bachalpsee', 'Oeschinensee', 'Niesen', 'Pilatus', 'Grosser Mythen', 'Fronalpstock', 'Moléson', 'Rigi', 'Seealpsee', 'Ebenalp et Aescher', 'Schwarzsee', 'Sentier des Roches', 'Chasseral', 'Chasseron', 'Lac des Perches']);

let goTab = () => {};
let host = null;
let lastSearch = null; // { q, origin, results, approx }
let runId = 0;
export function setHomeNavigator(fn) { goTab = fn; }

// Estimation du temps de route sans service : distance à vol d'oiseau majorée de 35 %, à 60 km/h de moyenne.
const estMinutes = (km) => km * 1.35;
export function fmtDrive(min) {
  const m = Math.max(5, Math.round(min / 5) * 5);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '');
}

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() * 100 + Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const getOrigin = () => settings.get('origin', null);
function locateMe() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Localisation indisponible sur cet appareil.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => { const o = { lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4), name: 'Ma position' }; settings.set('origin', o); resolve(o); },
      (err) => reject(new Error(err.code === 1 ? 'Localisation refusée. Choisis une commune de départ.' : 'Position introuvable. Choisis une commune de départ.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
    );
  });
}

// ---------- Suggestions de la semaine (tirées de la sélection, renouvelées chaque lundi) ----------
function weeklyPicks(origin) {
  const month = new Date().getMonth() + 1;
  const winter = month >= 11 || month <= 4;
  const maxMin = settings.get('search', {}).minutes || 120;
  let pool = SITES.filter((s) => !store.isDone(s) && !(winter && HIGH.has(s.name)));
  if (origin) pool = pool.map((s) => ({ s, min: estMinutes(dist([origin.lat, origin.lon], [s.lat, s.lon]) / 1000) })).filter((x) => x.min <= Math.max(maxMin, 90)).map((x) => Object.assign(x.s, { _min: x.min }));
  const rnd = seeded(isoWeek());
  const shuffled = pool.map((s) => [rnd(), s]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const out = [], types = new Set();
  for (const s of shuffled) { if (out.length >= 4) break; if (types.has(s.type)) continue; types.add(s.type); out.push(s); }
  for (const s of shuffled) { if (out.length >= 4) break; if (!out.includes(s)) out.push(s); }
  return { picks: out, winter };
}

function thumb(p) {
  const img = imageOf(p);
  const t = TYPES[p.type] || TYPES.lieu;
  return img ? `<span class="th" style="background-image:url('${img.replace(/'/g, '%27')}')"></span>` : `<span class="th" style="color:${t.color}">${glyph(p.type)}</span>`;
}
function placeCard(p, extra = '') {
  const t = TYPES[p.type] || TYPES.lieu;
  const drive = p._min != null ? `, ${p._approx === false ? '' : 'environ '}${fmtDrive(p._min)} de route` : '';
  return `<button type="button" class="pcard" data-id="${esc(p.id)}">${thumb(p)}<span class="tx"><b>${esc(p.name)}</b><span class="sub">${t.one}${p.massif ? ', ' + esc(p.massif) : ''}${drive}</span>${p.desc ? `<span class="ds">${esc(p.desc)}</span>` : ''}<span class="lv" id="lv-${esc(p.id)}">${extra}</span></span></button>`;
}

// ---------- Idées repérées sur le web (onglet « Suggestions » de la feuille du groupe) ----------
async function webIdeas(refresh) {
  const cached = await kv.get('websugg');
  if (!refresh || !communityUrl()) return cached ? cached.items : [];
  if (cached && Date.now() - cached.t < 6 * 3600000) return cached.items;
  try {
    const url = communityUrl();
    const j = await fetchJson(url + (url.includes('?') ? '&' : '?') + 'action=list', { redirect: 'follow' }, 20000);
    const items = (j.suggestions || []).filter((x) => x && x.title);
    await kv.set('websugg', { t: Date.now(), items });
    return items;
  } catch { return cached ? cached.items : []; }
}
const communityUrl = () => (settings.get('communityUrl', '') || CONFIG.communityUrl || '').trim();
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

function webHtml(items) {
  if (!items.length) return '';
  const latest = items.slice().sort((a, b) => String(b.week || '').localeCompare(String(a.week || ''))).slice(0, 5);
  return '<h3>Lu ailleurs</h3>' + latest.map((x, i) => {
    const meta = [x.place, LVL[x.level] || '', x.km ? String(x.km).replace('.', ',') + ' km' : ''].filter(Boolean).join(', ');
    const src = safeUrl(x.url);
    return `<article class="read" data-i="${i}"><b>${esc(x.title)}</b>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}${x.why ? `<p>${esc(x.why)}</p>` : ''}
      <span class="acts">${x.lat != null && x.lon != null ? '<button type="button" class="more" data-a="map">Voir les randos sur place</button>' : ''}${src ? `<a class="more" href="${esc(src)}" target="_blank" rel="noopener">${esc(x.source || new URL(src).hostname.replace(/^www\./, ''))}</a>` : ''}</span></article>`;
  }).join('');
}

// ---------- Rendu de l'accueil ----------
const SEASON = ['Janvier : neige probable sur les crêtes. Vise bas, ou sors les raquettes.', 'Février : les jours rallongent, les sommets restent blancs.', 'Mars : sentiers boueux, cascades au plus fort.',
  'Avril : la neige tient encore au-dessus de 1 000 m.', 'Mai : les chaumes reverdissent, c\'est le moment des crêtes.', 'Juin : les plus longues journées de l\'année.',
  'Juillet : pars tôt, et vise un lac.', 'Août : pars tôt, les crêtes chauffent vite.', 'Septembre : lumière douce, sentiers calmes.',
  'Octobre : les forêts changent de couleur.', 'Novembre : la nuit tombe tôt, pars le matin.', 'Décembre : jours courts, sorties courtes.'];

function sentence() {
  const q = { minutes: 60, groups: [], levels: [], ...settings.get('search', {}) };
  const o = getOrigin();
  const tok = (t) => `<button type="button" class="tok">${esc(t)}</button>`;
  const what = q.groups.length ? GROUPS.filter((g) => q.groups.includes(g.id)).map((g) => g.phrase).join(', ') : 'un peu de tout';
  const lv = q.levels.length ? q.levels.map((l) => LVL[l].toLowerCase()).join(' ou ') : 'peu importe';
  return `Depuis ${tok(o ? (o.name === 'Ma position' ? 'ma position' : o.name) : 'un départ à choisir')}, à ${tok(DURATIONS.find((d) => d[0] === q.minutes)[1])} de route au plus, j'ai envie de voir ${tok(what)}. Niveau : ${tok(lv)}.`;
}
function paintSentence() {
  const box = host && $('#hm-sentence', host);
  if (!box) return;
  box.innerHTML = sentence();
  box.querySelectorAll('.tok').forEach((b) => { b.onclick = openSearch; });
}

function heroHtml(p) {
  const img = imageOf(p);
  const t = TYPES[p.type] || TYPES.lieu;
  const drive = p._min != null ? `, environ ${fmtDrive(p._min)} de route` : '';
  return `<button type="button" class="hero pcard-like" data-id="${esc(p.id)}" style="${img ? `background-image:url('${img.replace(/'/g, '%27')}')` : `background:${t.color}`}">
      ${img ? '' : `<span class="hero-glyph">${glyph(p.type)}</span>`}<span class="hero-tx"><b>${esc(p.name)}</b><span>${t.one}${p.massif ? ', ' + esc(p.massif) : ''}${drive}</span></span></button>
    ${p.desc ? `<p class="hero-desc">${esc(p.desc)}</p>` : ''}`;
}
function tileHtml(p) {
  const img = imageOf(p);
  const t = TYPES[p.type] || TYPES.lieu;
  return `<button type="button" class="tile pcard-like" data-id="${esc(p.id)}"><span class="ph" style="${img ? `background-image:url('${img.replace(/'/g, '%27')}')` : `color:${t.color}`}">${img ? '' : glyph(p.type)}</span><b>${esc(p.name)}</b><span>${t.one}${p._min != null ? ', ' + fmtDrive(p._min) : ''}</span></button>`;
}
function picksHtml(picks) {
  if (!picks.length) return '<p class="note">Tu as fait tous les sites proches. Allonge le temps de route dans la phrase du haut.</p>';
  return `<h3>L'idée de la semaine</h3>${heroHtml(picks[0])}${picks.length > 1 ? `<h3 class="sub-h">Et ${picks.length - 1 === 3 ? 'trois' : picks.length - 1 === 2 ? 'deux' : 'une'} autre${picks.length > 2 ? 's' : ''}</h3><div class="strip">${picks.slice(1).map(tileHtml).join('')}</div>` : ''}`;
}
function mineHtml() {
  const lines = [];
  const last = store.log[0];
  if (last) {
    const days = Math.round((Date.now() - new Date(last.date).getTime()) / 86400000);
    lines.push(`Ta dernière sortie : ${esc(last.placeName)}, ${days <= 0 ? 'aujourd\'hui' : days === 1 ? 'hier' : 'il y a ' + days + ' jours'}.`);
  }
  if (store.wish.length) lines.push(`${store.wish.length} envie${store.wish.length > 1 ? 's' : ''} en attente : ${esc(store.wish.slice(0, 3).map((w) => w.name).join(', '))}${store.wish.length > 3 ? '…' : ''}.`);
  return lines.length ? `<div class="mine">${lines.map((l) => `<p>${l}</p>`).join('')}<button type="button" class="more" id="hm-hist">Ouvrir l'historique</button></div>` : '';
}

export async function renderHome(el) {
  host = el;
  const origin = getOrigin();
  const { picks } = weeklyPicks(origin);
  const web = await webIdeas(false);
  const name = settings.get('pseudo', '').trim();
  el.innerHTML = `<div class="home">
    <header class="hello"><img src="icons/icon-192.png" alt="" width="56" height="56"><h1>Salut${name ? ' ' + esc(name) : ''}</h1><p>${SEASON[new Date().getMonth()]}</p></header>
    <section class="ask"><p class="sentence" id="hm-sentence"></p><button type="button" class="btn main big" id="hm-search">Trouver</button></section>
    <div id="hm-results"></div>
    <section class="week" id="hm-picks">${picksHtml(picks)}</section>
    <section class="webs" id="hm-web"${web.length ? '' : ' hidden'}>${webHtml(web)}</section>
    ${mineHtml()}
  </div>`;
  paintSentence();
  $('#hm-search', el).onclick = () => {
    const o = getOrigin();
    if (!o) { openSearch(); return; }
    runSearch({ minutes: 60, groups: [], levels: [], ...settings.get('search', {}) }, o);
  };
  if ($('#hm-hist', el)) $('#hm-hist', el).onclick = () => goTab('historique');
  bindPlaces($('#hm-picks', el), picks);
  bindWeb(web);
  if (lastSearch) paintResults();
  fetchImages(picks, () => { if (host === el && !el.hidden && $('#hm-picks', el)) { $('#hm-picks', el).innerHTML = picksHtml(picks); bindPlaces($('#hm-picks', el), picks); } });
  webIdeas(true).then((fresh) => {
    if (host === el && $('#hm-web', el) && JSON.stringify(fresh) !== JSON.stringify(web)) { $('#hm-web', el).hidden = !fresh.length; $('#hm-web', el).innerHTML = webHtml(fresh); bindWeb(fresh); }
  });
}

function bindPlaces(box, list, levels) {
  if (!box) return;
  box.querySelectorAll('.pcard, .pcard-like').forEach((b) => {
    b.onclick = () => {
      const p = list.find((x) => x.id === b.dataset.id);
      if (!p) return;
      if (levels && levels.length) { want.levels = levels.slice(); saveWant(); }
      goTab('carte');
      openPlace(p);
    };
  });
}
function bindWeb(items) {
  const latest = items.slice().sort((a, b) => String(b.week || '').localeCompare(String(a.week || ''))).slice(0, 5);
  document.querySelectorAll('#hm-web .read [data-a=map]').forEach((b) => {
    b.onclick = () => {
      const x = latest[+b.closest('.read').dataset.i];
      goTab('carte');
      openPlace({ id: 'w' + Number(x.lat).toFixed(4) + '_' + Number(x.lon).toFixed(4), name: x.place || x.title, type: TYPES[x.type] ? x.type : 'lieu', lat: Number(x.lat), lon: Number(x.lon), score: 0 });
    };
  });
}

// ---------- Recherche guidée ----------
function openSearch() {
  const saved = { minutes: 60, groups: [], levels: [], ...settings.get('search', {}) };
  let origin = getOrigin();
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h2>Chercher une rando</h2>
    <div class="field"><span>Point de départ</span>
      <p id="sr-origin" style="font-weight:600"></p>
      <div class="row" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn small" id="sr-me">Ma position actuelle</button><button type="button" class="btn small" id="sr-town">Choisir une commune</button></div>
      <div id="sr-townbox" hidden><input type="text" id="sr-q" placeholder="Nom de la commune" style="margin-top:8px" autocomplete="off"><ul id="sr-list" class="townlist"></ul></div></div>
    <div class="field"><span>Temps de route maximal</span><div class="checks" id="sr-min">${DURATIONS.map(([v, l]) => `<button type="button" class="chip${saved.minutes === v ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="field"><span>Ce que tu veux voir</span><div class="checks" id="sr-grp">${GROUPS.map((g) => `<button type="button" class="chip${saved.groups.includes(g.id) ? ' on' : ''}" data-v="${g.id}">${glyph(g.icon)}${g.label}</button>`).join('')}</div><p class="note" style="margin-top:6px">Rien de coché : tout est proposé.</p></div>
    <div class="field"><span>Niveau</span><div class="checks" id="sr-lv">${CONFIG.levels.map((l) => `<button type="button" class="chip${saved.levels.includes(l.id) ? ' on' : ''}" data-v="${l.id}"><i class="lvdot" style="background:${LVC[l.id]};margin:0"></i>${l.label}</button>`).join('')}</div></div>
    <div class="foot"><button type="button" class="btn" id="sr-cancel">Annuler</button><button type="button" class="btn main" id="sr-ok">Voir les résultats</button></div></div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = (e) => { if (e.target === m) close(); };
  const showOrigin = () => { $('#sr-origin', m).textContent = origin ? origin.name : 'Pas encore défini'; };
  showOrigin();
  $('#sr-min', m).querySelectorAll('.chip').forEach((b) => { b.onclick = () => { $('#sr-min', m).querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); }; });
  m.querySelectorAll('#sr-grp .chip, #sr-lv .chip').forEach((b) => { b.onclick = () => b.classList.toggle('on'); });
  $('#sr-me', m).onclick = async () => {
    $('#sr-me', m).disabled = true;
    try { origin = await locateMe(); showOrigin(); } catch (err) { toast(err.message, 4500); $('#sr-townbox', m).hidden = false; }
    $('#sr-me', m).disabled = false;
  };
  $('#sr-town', m).onclick = () => { $('#sr-townbox', m).hidden = false; $('#sr-q', m).focus(); };
  let t;
  $('#sr-q', m).oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = $('#sr-q', m).value.trim();
      if (q.length < 3) return;
      try {
        const res = (await searchRemote(q)).slice(0, 5);
        $('#sr-list', m).innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}"><b>${esc(r.name)}</b> <span class="sub">${esc(r.where || '')}</span></button></li>`).join('') || '<li class="note">Aucune commune trouvée.</li>';
        $('#sr-list', m).querySelectorAll('button').forEach((b) => {
          b.onclick = () => { const r = res[+b.dataset.i]; origin = { lat: +r.lat.toFixed(4), lon: +r.lon.toFixed(4), name: r.name }; settings.set('origin', origin); showOrigin(); $('#sr-townbox', m).hidden = true; };
        });
      } catch { $('#sr-list', m).innerHTML = '<li class="note">Recherche de communes indisponible sans réseau.</li>'; }
    }, 350);
  };
  $('#sr-cancel', m).onclick = close;
  $('#sr-ok', m).onclick = async () => {
    const q = {
      minutes: +($('#sr-min .on', m) || { dataset: { v: 60 } }).dataset.v,
      groups: [...m.querySelectorAll('#sr-grp .on')].map((b) => b.dataset.v),
      levels: [...m.querySelectorAll('#sr-lv .on')].map((b) => b.dataset.v),
    };
    if (!origin) {
      try { origin = await locateMe(); } catch (err) { toast(err.message, 4500); $('#sr-townbox', m).hidden = false; return; }
    }
    settings.set('search', q);
    close();
    paintSentence();
    runSearch(q, origin);
  };
}

async function driveTimes(origin, list) {
  // Un seul appel pour tous les lieux ; en cas d'échec on garde l'estimation.
  const coords = [origin, ...list].map((p) => p.lon.toFixed(5) + ',' + p.lat.toFixed(5)).join(';');
  const j = await fetchJson(CONFIG.osrm + coords + '?sources=0&annotations=duration', {}, 15000);
  if (!j || j.code !== 'Ok' || !j.durations || !j.durations[0]) throw new Error('réponse inattendue');
  list.forEach((p, i) => { const s = j.durations[0][i + 1]; if (s != null) { p._min = s / 60; p._approx = false; } });
}

export async function runSearch(q, origin) {
  const my = ++runId;
  lastSearch = { q, origin, results: null, note: '', busy: true };
  paintResults();
  const types = q.groups.length ? GROUPS.filter((g) => q.groups.includes(g.id)).flatMap((g) => g.types) : [];
  const kmMax = (q.minutes / 1.35) * 1.2; // marge : l'autoroute fait mieux que l'estimation
  const near = (p) => { const km = dist([origin.lat, origin.lon], [p.lat, p.lon]) / 1000; return km <= kmMax ? km : null; };
  let cands = [];
  for (const s of SITES) { if (types.length && !types.includes(s.type)) continue; const km = near(s); if (km !== null) cands.push(Object.assign(s, { _min: estMinutes(km), _approx: true })); }
  let note = '';
  if (q.minutes <= 90) {
    try {
      const extra = await notablePlaces(origin.lat, origin.lon, kmMax * 1000, types);
      if (my !== runId) return;
      for (const p of extra) { const km = near(p); if (km !== null) cands.push(Object.assign(p, { _min: estMinutes(km), _approx: true })); }
    } catch { note = 'Lieux détaillés indisponibles pour l\'instant : seuls les sites de la sélection sont proposés.'; }
  } else {
    note = 'Au-delà de 1 h 30 de route, la recherche se limite aux sites de la sélection.';
  }
  if (want.hideDone) cands = cands.filter((p) => !store.isDone(p));
  // Temps de route réels pour les 90 candidats les mieux placés.
  cands.sort((a, b) => (b.curated ? 40 : 0) + b.score - b._min / 4 - ((a.curated ? 40 : 0) + a.score - a._min / 4));
  const top = cands.slice(0, 90);
  let approx = true;
  try { await driveTimes(origin, top); approx = false; } catch { /* estimation conservée */ }
  if (my !== runId) return;
  const results = top.filter((p) => p._min <= q.minutes * 1.05).sort((a, b) => (b.curated ? 40 : 0) + b.score - b._min / 4 - ((a.curated ? 40 : 0) + a.score - a._min / 4)).slice(0, 30);
  // Niveaux des lieux du catalogue : lus dans l'index précalculé, sans interroger les serveurs de sentiers.
  const idx = await hikeIndex();
  if (my !== runId) return;
  const levels = {};
  for (const p of results) {
    const e = p.curated && idx[slugOf(p.name)];
    if (e) levels[p.id] = e.map((h) => ({ level: h.level, meters: h.km * 1000 }));
  }
  // Le niveau demandé passe devant : d'abord les lieux qui ont une boucle de ce niveau.
  if (q.levels.length) {
    const fit = (p) => (levels[p.id] ? (levels[p.id].some((h) => q.levels.includes(h.level)) ? 0 : 2) : 1);
    results.sort((a, b) => fit(a) - fit(b));
  }
  lastSearch = { q, origin, results, note, approx, busy: false, levels };
  paintResults();
  fetchImages(results.slice(0, 14), () => { if (my === runId) paintResults(); });
}

let INDEX = null;
function hikeIndex() {
  if (!INDEX) INDEX = fetch('data/hikes/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return INDEX;
}

function levelBadges(p) {
  const { q, levels } = lastSearch;
  if (!levels || !(p.id in levels)) return '';
  const list = levels[p.id];
  if (list === null) return '<span class="note">Niveaux à calculer en ouvrant le lieu</span>';
  const best = {};
  for (const h of list) if (!best[h.level] || h.meters < best[h.level]) best[h.level] = h.meters;
  const html = CONFIG.levels.filter((l) => best[l.id]).map((l) => `<span class="lvb${q.levels.length && !q.levels.includes(l.id) ? ' dim' : ''}"><i class="lvdot" style="background:${LVC[l.id]}"></i>${l.label} ${fmtKm(best[l.id])}</span>`).join('');
  if (!html) return '<span class="note">Pas de boucle trouvée ici</span>';
  const miss = q.levels.length && !q.levels.some((l) => best[l]);
  return html + (miss ? `<span class="note" style="display:block">Pas de proposition ${q.levels.map((l) => LVL[l].toLowerCase()).join(' ou ')} ici</span>` : '');
}

function paintResults() {
  const box = host && $('#hm-results', host);
  if (!box || !lastSearch) return;
  const { q, origin, results, note, approx, busy } = lastSearch;
  const where = `à ${DURATIONS.find((d) => d[0] === q.minutes)[1]} au plus de ${esc(origin.name === 'Ma position' ? 'ta position' : origin.name)}`;
  const crit = [q.groups.length ? GROUPS.filter((g) => q.groups.includes(g.id)).map((g) => g.label.toLowerCase()).join(', ') : '', q.levels.length ? 'niveau ' + q.levels.map((l) => LVL[l].toLowerCase()).join(' ou ') : ''].filter(Boolean).join(', ');
  const title = busy ? 'Je cherche ' + where : results.length ? `${results.length} lieu${results.length > 1 ? 'x' : ''} ${where}` : 'Rien ' + where;
  const head = `<section class="found"><h3>${title}</h3><p class="note">${crit ? esc(crit[0].toUpperCase() + crit.slice(1)) + '. ' : ''}<button type="button" class="more" id="hm-edit" style="margin:0;font-size:inherit">Changer</button> <button type="button" class="more" id="hm-clear" style="margin:0 0 0 8px;font-size:inherit">Effacer</button></p>`;
  if (busy) { box.innerHTML = head + '<div class="loading"><span class="spin"></span>Lieux et temps de route</div></section>'; bindHead(); return; }
  const info = [note, approx && results.length ? 'Temps de route estimés à partir de la distance.' : ''].filter(Boolean).map((t) => `<p class="note" style="margin:6px 0">${esc(t)}</p>`).join('');
  box.innerHTML = head + info + (results.length
    ? `<div class="plist">${results.map((p) => placeCard(p, levelBadges(p))).join('')}</div>`
    : '<div class="sign-empty" style="margin-top:8px">Allonge le temps de route, ou coche d\'autres envies.</div>') + '</section>';
  bindHead();
  bindPlaces(box, results, q.levels);
}
function bindHead() {
  const e = document.getElementById('hm-edit'); if (e) e.onclick = openSearch;
  const c = document.getElementById('hm-clear'); if (c) c.onclick = () => { runId++; lastSearch = null; $('#hm-results', host).innerHTML = ''; };
}
