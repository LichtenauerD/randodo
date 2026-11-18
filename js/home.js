// Accueil : suggestions de la semaine, idées repérées sur le web, recherche guidée par temps de route.
import { CONFIG, TYPES } from './config.js';
import { SITES, imageOf, fetchImages, searchRemote } from './places.js';
import { store, want, saveWant } from './state.js';
import { openPlace } from './sheet.js';
import { prefetchPlace, hikesFor } from './hikes.js';
import { glyph } from './map.js';
import { kv, settings, dist, esc, fetchJson, toast, fmtKm, slugOf } from './util.js';
import { AUDIENCES, idealPlace, idealLabel } from './ideal.js';
import { walkerSvg } from './grades.js';
import { checkGradeUp } from './objectifs.js';

const $ = (s, r = document) => r.querySelector(s);
const LVC = { facile: 'var(--facile)', moyenne: 'var(--moyenne)', difficile: 'var(--difficile)' };
const LVL = { facile: 'Facile', moyenne: 'Moyenne', difficile: 'Difficile' };

// Les six envies de la recherche, chacune regroupant des types de lieux.
export const GROUPS = [
  { id: 'eau', short: 'Cascades', phrase: 'des cascades et des gorges', label: 'Cascades et gorges', types: ['cascade', 'gorge'], icon: 'cascade' },
  { id: 'lac', short: 'Lacs', phrase: 'des lacs', label: 'Lacs', types: ['lac'], icon: 'lac' },
  { id: 'vue', short: 'Sommets', phrase: 'des sommets et des points de vue', label: 'Sommets et points de vue', types: ['sommet', 'vue'], icon: 'sommet' },
  { id: 'ruine', short: 'Châteaux', phrase: 'des châteaux et des ruines', label: 'Châteaux et ruines', types: ['chateau'], icon: 'chateau' },
  { id: 'roche', short: 'Grottes & Rochers', phrase: 'des grottes et des rochers', label: 'Grottes et rochers', types: ['rocher', 'grotte'], icon: 'rocher' },
  { id: 'nature', short: 'Forêts & marais', phrase: 'des forêts et des marais', label: 'Forêts et marais', types: ['tourbiere'], icon: 'tourbiere' },
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
// Idées de la semaine : tirées une fois le lundi puis gardées telles quelles jusqu'au lundi suivant,
// quels que soient les réglages touchés entre-temps. Les semaines passées sont gardées pour l'historique.
function mondayOf(d = new Date()) { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }
function weeklyPicks(origin) {
  const week = isoWeek();
  const saved = settings.get('weekPicks', null);
  if (saved && saved.week === week && (saved.hasOrigin || !origin)) {
    const picks = saved.names.map((n) => SITES.find((s) => s.name === n)).filter(Boolean);
    if (origin) for (const p of picks) p._min = estMinutes(dist([origin.lat, origin.lon], [p.lat, p.lon]) / 1000);
    if (picks.length) return { picks, winter: saved.winter };
  }
  const fresh = drawPicks(origin);
  if (saved && saved.week !== week) settings.set('pastPicks', [{ week: saved.week, monday: saved.monday, names: saved.names }, ...settings.get('pastPicks', []).filter((x) => x.week !== saved.week)].slice(0, 4));
  settings.set('weekPicks', { week, monday: mondayOf().toISOString().slice(0, 10), hasOrigin: !!origin, winter: fresh.winter, names: fresh.picks.map((p) => p.name) });
  return fresh;
}

function pastHtml() {
  const past = settings.get('pastPicks', []).filter((w) => w.names && w.names.length);
  if (!past.length) return '';
  const fmt = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `<section class="past"><h4>Les idées des semaines passées</h4>${past.map((w) => `<p><span>Semaine du ${fmt(w.monday)}</span> ${w.names.map((n) => { const p = SITES.find((s) => s.name === n); return p ? `<button type="button" class="past-l" data-id="${esc(p.id)}">${esc(n)}</button>` : esc(n); }).join(', ')}</p>`).join('')}</section>`;
}

function drawPicks(origin) {
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

// Le dodo de l'accueil : il suit le fil violet jusqu'à la balise (une fois par session), puis attend.
// Un toucher le fait sauter et parler.
const WALK_SAYS = ['Moi c\'est Didou. On y va ?', 'Le dodo ne vole pas. Il marche.', 'Une cascade, ça te dit ?', 'Prends de l\'eau !', 'Encore un sommet ?', 'Je connais un coin calme…'];
function startWalker(hello) {
  if (!hello) return;
  const path = hello.querySelector('.walk path');
  if (!path || !path.getTotalLength) return;
  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'walker';
  box.setAttribute('aria-label', 'Didou, le dodo de Randodo');
  box.innerHTML = walkerSvg(56) + '<span class="walker-say" hidden></span>';
  hello.appendChild(box);
  const total = path.getTotalLength();
  let p = 0.03;
  const place = () => {
    const pt = path.getPointAtLength(total * p);
    const m = path.getScreenCTM(), r = hello.getBoundingClientRect();
    if (!m) return;
    const sp = new DOMPoint(pt.x, pt.y).matrixTransform(m);
    box.style.transform = `translate(${(sp.x - r.left - 28).toFixed(1)}px, ${(sp.y - r.top - 51).toFixed(1)}px)`;
  };
  const end = 0.9;
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false; try { seen = sessionStorage.getItem('randodo.walked') === '1'; } catch { /* sans stockage */ }
  if (still || seen) { p = end; place(); box.classList.add('idle'); }
  else {
    place();
    box.classList.add('waiting');
    setTimeout(() => {
      box.classList.remove('waiting'); box.classList.add('walking');
      const t0 = performance.now(), dur = 11000;
      const step = (t) => {
        if (!box.isConnected) return;
        const k = Math.min(1, (t - t0) / dur);
        p = 0.03 + (end - 0.03) * k;
        place();
        if (k < 1) requestAnimationFrame(step);
        else {
          // Arrivé à la balise : il tente de s'envoler, bat des ailes… et retombe.
          box.classList.remove('walking'); box.classList.add('tryfly');
          setTimeout(() => { box.classList.remove('tryfly'); box.classList.add('idle'); }, 2400);
          try { sessionStorage.setItem('randodo.walked', '1'); } catch { /* rien */ }
        }
      };
      requestAnimationFrame(step);
    }, 1900);
  }
  addEventListener('resize', place);
  const say = box.querySelector('.walker-say');
  let n = Math.floor(Math.random() * WALK_SAYS.length), tm = 0;
  box.onclick = () => {
    box.classList.remove('hop'); void box.offsetWidth; box.classList.add('hop');
    say.textContent = WALK_SAYS[n++ % WALK_SAYS.length]; say.hidden = false;
    clearTimeout(tm); tm = setTimeout(() => { say.hidden = true; }, 2600);
  };
}

async function warmPicks(picks) {
  for (const p of picks) {
    try { if (!(await prefetchPlace(p))) await hikesFor(p); } catch { /* lieu suivant */ }
  }
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

const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const TOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V10l5-4 5 4v11M15 21v-7h4v7"/></svg>';
const LVSUB = { facile: "jusqu'à 8 km", moyenne: '8 à 15 km', difficile: 'plus long, plus raide' };
const getQ = () => ({ minutes: 60, groups: [], levels: [], ideal: [], ...settings.get('search', {}) });
// Le lieu convient-il à au moins une des envies « Idéal… » cochées ?
const fitsIdeal = (q, s, idx) => !q.ideal || !q.ideal.length || [...idealPlace(s, idx[slugOf(s.name)])].some((a) => q.ideal.includes(a));

// Panneau de recherche : tous les choix visibles, un appui suffit.
function finderHtml() {
  const q = getQ(), o = getOrigin();
  const town = o && o.name !== 'Ma position';
  return `<h2>Trouve ta prochaine rando</h2>
    <div class="fq"><span class="fl">Je pars de</span><div class="fo">
      <button type="button" class="fbtn${o && !town ? ' on' : ''}" data-o="me">${PIN}<span>Ma position</span></button>
      <button type="button" class="fbtn${town ? ' on' : ''}" data-o="town">${TOWN}<span>${town ? esc(o.name) : 'Une commune'}</span></button></div></div>
    <div class="fq"><span class="fl">Jusqu'à <b id="f-dv">${DURATIONS.find((d) => d[0] === q.minutes)[1]}</b> de voiture</span>
      <div class="fdrive" style="--n:${DURATIONS.length};--i:${Math.max(0, DURATIONS.findIndex((d) => d[0] === q.minutes))}"><span class="thumb"></span>${DURATIONS.map(([v, l]) => `<button type="button" data-v="${v}" class="${q.minutes === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="fq"><span class="fl">J'ai envie de voir <small>${q.groups.length ? '' : 'rien de choisi : tout est proposé'}</small></span>
      <div class="fgrid">${GROUPS.map((g) => `<button type="button" data-v="${g.id}" class="${q.groups.includes(g.id) ? 'on' : ''}" style="--c:${(TYPES[g.types[0]] || TYPES.lieu).color}"><span class="ic">${glyph(g.icon)}</span>${g.short}</button>`).join('')}</div></div>
    <div class="fq"><span class="fl">Niveau <small>${q.levels.length ? '' : 'tous les niveaux'}</small></span>
      <div class="flv">${CONFIG.levels.map((l) => `<button type="button" data-v="${l.id}" class="${q.levels.includes(l.id) ? 'on' : ''}" style="--c:${LVC[l.id]}"><b>${l.label}</b><span>${LVSUB[l.id]}</span></button>`).join('')}</div></div>
    <div class="fq"><span class="fl">Idéal… <small>${q.ideal.length ? '' : 'pour tout le monde'}</small></span>
      <div class="fideal">${AUDIENCES.map((a) => `<button type="button" data-v="${a.id}" class="${q.ideal.includes(a.id) ? 'on' : ''}"><b>${a.label}</b><span>${a.sub}</span></button>`).join('')}</div></div>
    <button type="button" class="btn main big find" id="hm-search"><span id="f-count">Afficher les lieux</span></button>`;
}
function bindFinder() {
  const box = host && $('#hm-finder', host);
  if (!box) return;
  box.innerHTML = finderHtml();
  const save = (q) => { settings.set('search', q); countPreview(); };
  box.querySelectorAll('.fo .fbtn').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.o === 'town') return openOrigin();
      b.classList.add('wait');
      try { await locateMe(); bindFinder(); } catch (err) { toast(err.message, 4500); openOrigin(); }
      b.classList.remove('wait');
    };
  });
  const drive = $('.fdrive', box);
  drive.querySelectorAll('button').forEach((b, i) => {
    b.onclick = () => {
      drive.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      drive.style.setProperty('--i', i);
      $('#f-dv', box).textContent = b.textContent;
      save({ ...getQ(), minutes: +b.dataset.v });
    };
  });
  const multi = (sel, key, hintEmpty) => box.querySelectorAll(sel + ' button').forEach((b) => {
    b.onclick = () => {
      b.classList.toggle('on'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      const vals = [...box.querySelectorAll(sel + ' button.on')].map((x) => x.dataset.v);
      const small = b.closest('.fq').querySelector('.fl small'); if (small) small.textContent = vals.length ? '' : hintEmpty;
      save({ ...getQ(), [key]: vals });
    };
  });
  multi('.fgrid', 'groups', 'rien de choisi : tout est proposé');
  multi('.flv', 'levels', 'tous les niveaux');
  multi('.fideal', 'ideal', 'pour tout le monde');
  $('#hm-search', box).onclick = async () => {
    let o = getOrigin();
    if (!o) { try { o = await locateMe(); bindFinder(); } catch (err) { toast(err.message, 4500); openOrigin(); return; } }
    runSearch(getQ(), o);
    setTimeout(() => { const r = $('#hm-results', host); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  };
  countPreview();
}

// Aperçu du nombre de lieux, recalculé à chaque choix (lieux de la sélection, distance à vol d'oiseau).
// Bouton de recherche : libellé fixe, le nombre de lieux s'affiche avec les résultats.
// On profite du choix du départ pour demander les temps de route, la recherche est ensuite immédiate.
async function countPreview() {
  const lab = host && $('#f-count', host);
  if (!lab) return;
  lab.textContent = 'Afficher les lieux';
  const o = getOrigin();
  if (o && !driveKnown(o)) driveMap(o);
}

// Choix du point de départ : une commune.
function openOrigin() {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h2>D'où pars-tu ?</h2>
    <input type="text" id="sr-q" placeholder="Nom de la commune" autocomplete="off"><ul id="sr-list" class="townlist"></ul>
    <div class="foot"><button type="button" class="btn" id="sr-cancel">Annuler</button></div></div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = (e) => { if (e.target === m) close(); };
  $('#sr-cancel', m).onclick = close;
  setTimeout(() => $('#sr-q', m).focus(), 50);
  let t;
  $('#sr-q', m).oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const qs = $('#sr-q', m).value.trim();
      if (qs.length < 3) return;
      try {
        const res = (await searchRemote(qs)).slice(0, 6);
        $('#sr-list', m).innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}"><b>${esc(r.name)}</b> <span class="sub">${esc(r.where || '')}</span></button></li>`).join('') || '<li class="note">Aucune commune trouvée.</li>';
        $('#sr-list', m).querySelectorAll('button').forEach((b) => {
          b.onclick = () => { const r = res[+b.dataset.i]; settings.set('origin', { lat: +r.lat.toFixed(4), lon: +r.lon.toFixed(4), name: r.name }); close(); bindFinder(); };
        });
      } catch { $('#sr-list', m).innerHTML = '<li class="note">Recherche de communes indisponible sans réseau.</li>'; }
    }, 350);
  };
}

// Idée de la semaine déjà faite : photo grisée, coche verte et un mot du dodo.
const DONE_SAYS = ['Déjà conquis, tu connais le coin.', 'Celle-là, tu l\'as déjà dans les jambes.', 'Déjà faite : à refaire en d\'autres saisons ?', 'Cochée ! Didou est fier de toi.'];
const doneSay = (p) => DONE_SAYS[[...p.name].reduce((a, c) => a + c.charCodeAt(0), 0) % DONE_SAYS.length];
const tick = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function heroHtml(p) {
  const img = imageOf(p);
  const t = TYPES[p.type] || TYPES.lieu;
  const drive = p._min != null ? `, environ ${fmtDrive(p._min)} de route` : '';
  const done = store.isDone(p);
  return `<button type="button" class="hero pcard-like${done ? ' done' : ''}" data-id="${esc(p.id)}" style="${img ? `background-image:url('${img.replace(/'/g, '%27')}')` : `background:${t.color}`}">
      ${done ? `<span class="done-say">${walkerSvg(34)}<span>${doneSay(p)}</span></span><span class="done-tick">${tick}</span>` : ''}
      ${img ? '' : `<span class="hero-glyph">${glyph(p.type)}</span>`}<span class="hero-tx"><b>${esc(p.name)}</b><span>${t.one}${p.massif ? ', ' + esc(p.massif) : ''}${drive}</span></span></button>
    ${p.desc ? `<p class="hero-desc">${esc(p.desc)}</p>` : ''}`;
}
function tileHtml(p) {
  const img = imageOf(p);
  const t = TYPES[p.type] || TYPES.lieu;
  const done = store.isDone(p);
  return `<button type="button" class="tile pcard-like${done ? ' done' : ''}" data-id="${esc(p.id)}"><span class="ph" style="${img ? `background-image:url('${img.replace(/'/g, '%27')}')` : `color:${t.color}`}">${img ? '' : glyph(p.type)}${done ? `<span class="done-tick">${tick}</span>` : ''}</span><b>${esc(p.name)}</b><span>${done ? '<em class="done-txt">Déjà faite</em>' : t.one + (p._min != null ? ', ' + fmtDrive(p._min) : '')}</span></button>`;
}
function picksHtml(picks) {
  if (!picks.length) return '<p class="note">Tu as fait tous les sites proches. Allonge le temps de route dans la recherche du haut.</p>';
  return `<h3>L'idée de la semaine</h3><p class="note season">${SEASON[new Date().getMonth()]}</p>${heroHtml(picks[0])}${picks.length > 1 ? `<h3 class="sub-h">Et ${picks.length - 1 === 3 ? 'trois' : picks.length - 1 === 2 ? 'deux' : 'une'} autre${picks.length > 2 ? 's' : ''}</h3><div class="strip">${picks.slice(1).map(tileHtml).join('')}</div>` : ''}`;
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
  checkGradeUp();
  host = el;
  const origin = getOrigin();
  const { picks } = weeklyPicks(origin);
  const web = await webIdeas(false);
  const name = settings.get('pseudo', '').trim();
  el.innerHTML = `<div class="home">
    <header class="hello"><img src="icons/icon-192.png" alt="" width="56" height="56"><h1>Salut${name ? ' ' + esc(name) : ''}</h1><p class="slogan">Le dodo ne vole pas. Il marche. Et toi ?</p>
      <svg class="mts" viewBox="0 0 400 110" preserveAspectRatio="none" aria-hidden="true">
        <path fill="#9fb8a6" d="M0 70 L30 52 L58 62 L92 30 L120 50 L150 38 L178 56 L214 18 L246 46 L270 36 L300 58 L336 24 L368 48 L400 34 V110 H0Z"/>
        <path fill="#2c5a47" d="M0 84 L40 58 L72 72 L112 40 L150 66 L196 34 L236 70 L270 54 L308 78 L348 46 L400 68 V110 H0Z"/>
        <path fill="#e9efe9" d="M112 40 L122 50 L116 49 L110 54 L104 48Z M196 34 L207 45 L200 44 L193 49 L188 43Z M348 46 L357 55 L351 54 L345 58 L341 53Z"/>
        <path fill="#173b2f" d="M0 98 L52 80 L96 90 L150 72 L204 92 L256 78 L314 96 L360 82 L400 92 V110 H0Z"/>
      </svg><svg class="walk" viewBox="0 0 320 34" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M3 27 C 40 27, 52 9, 92 12 S 142 31, 182 21 S 240 5, 272 10 S 300 20, 312 9"/><path class="ants" pathLength="100" d="M3 27 C 40 27, 52 9, 92 12 S 142 31, 182 21 S 240 5, 272 10 S 300 20, 312 9"/><circle class="halo" cx="312" cy="9" r="5"/><circle cx="312" cy="9" r="5"/></svg></header>
    <section class="finder" id="hm-finder"></section>
    <div id="hm-results"></div>
    <section class="week" id="hm-picks">${picksHtml(picks)}</section>
    <section class="webs" id="hm-web"${web.length ? '' : ' hidden'}>${webHtml(web)}</section>
    ${mineHtml()}
    ${pastHtml()}
  </div>`;
  bindFinder();
  if ($('#hm-hist', el)) $('#hm-hist', el).onclick = () => goTab('historique');
  bindPlaces($('#hm-picks', el), picks);
  el.querySelectorAll('.past-l').forEach((b) => { b.onclick = () => { const p = SITES.find((x) => x.id === b.dataset.id); if (p) openPlace(p); }; });
  // Idées de la semaine rangées sur le téléphone dès l'accueil : randos précalculées si elles existent,
  // sinon calculées en arrière-plan une fois pour toutes. La fiche s'ouvre ensuite sans attente.
  warmPicks(picks);
  startWalker($('.hello', el));
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
// Temps de route réels depuis un départ vers tous les lieux du catalogue (OSRM, par paquets),
// gardés 30 jours par départ. Sans réponse : estimation à partir de la distance.
const driveMem = new Map();
const driveKey = (o) => 'drive:' + o.lat.toFixed(3) + ',' + o.lon.toFixed(3);
function driveKnown(o) { return driveMem.get(driveKey(o)) || null; }
async function driveMap(o) {
  const key = driveKey(o);
  if (driveMem.has(key)) return driveMem.get(key);
  const saved = await kv.get(key);
  if (saved && Date.now() - saved.t < 30 * 86400000) { driveMem.set(key, saved.min); return saved.min; }
  const list = SITES.filter((s) => dist([o.lat, o.lon], [s.lat, s.lon]) / 1000 < 260);
  const min = {};
  try {
    for (let i = 0; i < list.length; i += 90) {
      const part = list.slice(i, i + 90);
      const coords = [o, ...part].map((p) => p.lon.toFixed(5) + ',' + p.lat.toFixed(5)).join(';');
      const j = await fetchJson(CONFIG.osrm + coords + '?sources=0&annotations=duration', {}, 15000);
      if (!j || j.code !== 'Ok' || !j.durations || !j.durations[0]) throw new Error('réponse inattendue');
      part.forEach((p, k) => { const v = j.durations[0][k + 1]; if (v != null) min[slugOf(p.name)] = v / 60; });
    }
  } catch { return null; }
  driveMem.set(key, min);
  kv.set(key, { t: Date.now(), min });
  return min;
}

// La sélection, commune au compteur du bouton et à la liste de résultats.
function selectPlaces(q, origin, idx, drive) {
  const types = q.groups.length ? GROUPS.filter((g) => q.groups.includes(g.id)).flatMap((g) => g.types) : [];
  let out = [];
  for (const s of SITES) {
    if (types.length && !types.includes(s.type)) continue;
    if (!fitsIdeal(q, s, idx)) continue;
    const e = idx[slugOf(s.name)];
    if (q.levels.length && e && !e.some((h) => q.levels.includes(h.level))) continue;
    const real = drive && drive[slugOf(s.name)];
    const min = real != null ? real : estMinutes(dist([origin.lat, origin.lon], [s.lat, s.lon]) / 1000);
    if (min > q.minutes * 1.05) continue;
    out.push(Object.assign(s, { _min: min, _approx: real == null }));
  }
  // Lieux déjà faits : écartés, sauf s'il n'y a plus rien à proposer.
  const fresh = out.filter((p) => !store.isDone(p));
  if (fresh.length >= 3 || want.hideDone) out = fresh;
  return out.sort((a, b) => (b.curated ? 40 : 0) + b.score - b._min / 4 - ((a.curated ? 40 : 0) + a.score - a._min / 4));
}

export async function runSearch(q, origin) {
  const my = ++runId;
  lastSearch = { q, origin, results: null, note: '', busy: true };
  paintResults();
  const idx = await hikeIndex();
  const drive = await driveMap(origin);
  if (my !== runId) return;
  const note = '';
  const approx = !drive;
  const results = selectPlaces(q, origin, idx, drive);
  // Niveaux des lieux du catalogue : lus dans l'index précalculé, sans interroger les serveurs de sentiers.
  const levels = {};
  for (const p of results) {
    const e = p.curated && idx[slugOf(p.name)];
    if (e) levels[p.id] = e.map((h) => ({ level: h.level, meters: h.km * 1000, up: h.up }));
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
  const id = idealLabel([...idealPlace(p, list.map((h) => ({ km: h.meters / 1000, up: h.up })))]);
  const miss = q.levels.length && !q.levels.some((l) => best[l]);
  return html + (id ? `<span class="ideal-tag">${esc(id)}</span>` : '') + (miss ? `<span class="note" style="display:block">Pas de proposition ${q.levels.map((l) => LVL[l].toLowerCase()).join(' ou ')} ici</span>` : '');
}

function paintResults() {
  const box = host && $('#hm-results', host);
  if (!box || !lastSearch) return;
  const { q, origin, results, note, approx, busy } = lastSearch;
  const where = `à ${DURATIONS.find((d) => d[0] === q.minutes)[1]} au plus de ${esc(origin.name === 'Ma position' ? 'ta position' : origin.name)}`;
  const crit = [q.groups.length ? GROUPS.filter((g) => q.groups.includes(g.id)).map((g) => g.label.toLowerCase()).join(', ') : '', q.levels.length ? 'niveau ' + q.levels.map((l) => LVL[l].toLowerCase()).join(' ou ') : '', q.ideal && q.ideal.length ? idealLabel(q.ideal).toLowerCase() : ''].filter(Boolean).join(', ');
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
  const e = document.getElementById('hm-edit'); if (e) e.onclick = () => $('#hm-finder', host).scrollIntoView({ behavior: 'smooth', block: 'start' });
  const c = document.getElementById('hm-clear'); if (c) c.onclick = () => { runId++; lastSearch = null; $('#hm-results', host).innerHTML = ''; };
}
