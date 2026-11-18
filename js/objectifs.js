// Onglet Objectifs : grade global, progression par secteur, carte schématique et lieux à cocher.
import { SITES } from './places.js';
import { TYPES } from './config.js';
import { store, bus } from './state.js';
import { glyph } from './map.js';
import { esc, kv, settings, slugOf, toast, modalChrome } from './util.js';
import { prefetchPlace } from './hikes.js';
import { GRADES, DODO_STAGES, gradeOf, dodoSvg, climbSvg, placeClimbers, animateClimber, MASCOT } from './grades.js';

export const SECTORS = [
  { id: 'vosges', name: 'Vosges', massifs: ['Vosges', 'Vosges du Nord'] },
  { id: 'foret-noire', name: 'Forêt-Noire', massifs: ['Forêt-Noire', 'Kaiserstuhl'] },
  { id: 'jura', name: 'Jura', massifs: ['Jura', 'Jura alsacien'] },
  { id: 'suisse', name: 'Suisse', massifs: ['Suisse'] },
];
export const sectorOf = (p) => (SECTORS.find((s) => s.massifs.includes(p.massif)) || {}).id;

// Villes repères, en petits points gris.
const TOWNS = [
  ['Strasbourg', 48.5734, 7.7521], ['Haguenau', 48.8156, 7.7906], ['Saverne', 48.7414, 7.3628], ['Molsheim', 48.5417, 7.4925], ['Sélestat', 48.2594, 7.4542],
  ['Colmar', 48.0794, 7.3585], ['Mulhouse', 47.7508, 7.3359], ['Munster', 48.0406, 7.135], ['Gérardmer', 48.0705, 6.8775], ['Saint-Dié', 48.2847, 6.9492],
  ['Épinal', 48.1724, 6.4496], ['Belfort', 47.6383, 6.8628], ['Wissembourg', 49.037, 7.945], ['Bitche', 49.052, 7.429], ['Schirmeck', 48.483, 7.22], ['Thann', 47.808, 7.103],
  ['Baden-Baden', 48.7606, 8.2398], ['Karlsruhe', 49.0069, 8.4037], ['Fribourg-en-Brisgau', 47.999, 7.8421], ['Offenburg', 48.4721, 7.9408], ['Rastatt', 48.858, 8.204],
  ['Freudenstadt', 48.4637, 8.4113], ['Villingen', 48.06, 8.46], ['Titisee-Neustadt', 47.92, 8.21], ['Lörrach', 47.615, 7.661], ['Bâle', 47.5596, 7.5886],
  ['Berne', 46.948, 7.4474], ['Zurich', 47.3769, 8.5417], ['Lucerne', 47.0502, 8.3093], ['Interlaken', 46.6863, 7.8632], ['Lausanne', 46.5197, 6.6323],
  ['Genève', 46.2044, 6.1432], ['Neuchâtel', 46.99, 6.9293], ['Bienne', 47.1368, 7.2468], ['Delémont', 47.3649, 7.3445], ['Saint-Gall', 47.4245, 9.3767], ['Thoune', 46.758, 7.628],
  ['Besançon', 47.2378, 6.0241], ['Pontarlier', 46.9036, 6.3554], ['Lons-le-Saunier', 46.6744, 5.5547], ['Saint-Claude', 46.3872, 5.8636], ['Champagnole', 46.7464, 5.91], ['Morez', 46.5251, 6.061],
];

let sector = settings.get('objSector', 'vosges');
let filter = 'todo';
let gmap = null, layers = null;
const geoCache = {};

const placesOf = (sid) => SITES.filter((p) => sectorOf(p) === sid);
const doneCount = (list) => list.filter((p) => store.isDone(p)).length;

async function loadGeo(sid) {
  if (geoCache[sid]) return geoCache[sid];
  try {
    const r = await fetch(`data/geo/${sid}.json`);
    if (!r.ok) throw new Error();
    const d = await r.json();
    kv.set('geo:' + sid, d);
    return (geoCache[sid] = d);
  } catch {
    const d = await kv.get('geo:' + sid);
    if (d) return (geoCache[sid] = d);
    return null;
  }
}

// Re-rendu en gardant la position de lecture : cocher un lieu ne renvoie pas en haut de la page.
function rerender(root) {
  const page = root.closest('#page') || root;
  const boxes = [page, document.scrollingElement].filter(Boolean);
  const ys = boxes.map((b) => b.scrollTop);
  renderObjectifs(page);
  const back = () => boxes.forEach((b, i) => { b.scrollTop = ys[i]; });
  back(); requestAnimationFrame(back); setTimeout(back, 120);
}

// Passage de grade : Didou évolue, on le fête une fois. Au tout premier passage, on retient le grade sans fête.
export function checkGradeUp() {
  const g = gradeOf(doneCount(SITES));
  const last = settings.get('lastGrade', null);
  settings.set('lastGrade', g.i);
  if (last == null || g.i <= last || document.getElementById('tour')) return;
  const box = document.createElement('div');
  box.className = 'gradeup';
  box.innerHTML = `<div class="gu-card" role="dialog" aria-live="polite">
    <div class="gu-art">${dodoSvg(g.dodo, 110)}</div>
    <h2>${MASCOT} a évolué !</h2>
    <p>Tu es maintenant <b>${esc(g.name)}</b>. ${esc(DODO_STAGES[g.dodo])}, et ${MASCOT} le dodo n'en revient pas.</p>
    <button type="button" class="btn main">Bravo ${MASCOT}</button></div>`;
  document.body.appendChild(box);
  if (navigator.vibrate) navigator.vibrate([60, 60, 120]);
  const close = () => box.remove();
  box.querySelector('button').onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
}

export function renderObjectifs(root) {
  checkGradeUp();
  const all = SITES;
  const n = doneCount(all);
  const g = gradeOf(n);
  const sec = SECTORS.map((s) => { const l = placesOf(s.id); const d = doneCount(l); return { ...s, total: l.length, done: d, pct: l.length ? d / l.length : 0 }; });
  root.innerHTML = `<div class="obj">
    <section class="grade-card">
      <figure class="gc-dodo">${dodoSvg(g.dodo, 76)}<figcaption>${MASCOT} le dodo</figcaption></figure>
      <div class="gc-text"><span class="gc-lab">Ton grade</span><h2>${esc(g.name)}</h2>
        <p class="gc-n"><b>${n}</b> lieu${n > 1 ? 'x' : ''} fait${n > 1 ? 's' : ''} sur ${all.length}</p>
        <div class="gc-bar"><i style="width:${Math.round(g.pct * 100)}%"></i></div>
        <p class="gc-next">${g.next ? `Encore <b>${g.left}</b> pour devenir <b>${esc(g.next.name)}</b>` : 'Grade le plus haut atteint. Didou le dodo vole !'}</p></div>
    </section>
    <div class="sectors" role="tablist">${sec.map((s) => `<button type="button" role="tab" class="sec${s.id === sector ? ' on' : ''}" data-s="${s.id}">${climbSvg(s.pct, 92, 54)}<b>${s.name}</b><span>${s.done} / ${s.total}</span></button>`).join('')}</div>
    <section class="geo-box"><div id="geo-map" class="geo-map"></div>
      <div class="geo-legend"><span><i class="lg done"></i>fait</span><span><i class="lg todo"></i>à faire</span><span><i class="lg red"></i>territoire conquis</span><span><i class="lg forest"></i>forêt</span><span><i class="lg meadow"></i>prés</span><span><i class="lg field"></i>cultures</span><span><i class="lg town"></i>villes</span></div></section>
    <button type="button" class="btn wide offline-sec" id="obj-dl">${dlLabel()}</button>
    <section class="geo-list"><div class="seg" role="tablist">
      <button type="button" data-f="todo" class="${filter === 'todo' ? 'on' : ''}">À faire</button><button type="button" data-f="done" class="${filter === 'done' ? 'on' : ''}">Faits</button><button type="button" data-f="all" class="${filter === 'all' ? 'on' : ''}">Tous</button></div>
      <ul class="checklist" id="obj-list"></ul></section>
    <button type="button" class="help-q" id="obj-help" aria-label="Les grades et leurs paliers">?</button>
  </div>`;
  placeClimbers(root);
  root.querySelectorAll('.sec').forEach((b) => { b.onclick = () => { sector = b.dataset.s; settings.set('objSector', sector); renderObjectifs(root); }; });
  root.querySelectorAll('.seg button').forEach((b) => { b.onclick = () => { filter = b.dataset.f; root.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b)); paintList(root); }; });
  root.querySelector('#obj-help').onclick = openHelp;
  root.querySelector('#obj-dl').onclick = () => downloadSector(root.querySelector('#obj-dl'));
  paintList(root);
  drawMap(root);
}

let pendingRender = 0;
function paintList(root) {
  clearTimeout(pendingRender);
  const ul = root.querySelector('#obj-list');
  let list = placesOf(sector).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (filter === 'todo') list = list.filter((p) => !store.isDone(p));
  if (filter === 'done') list = list.filter((p) => store.isDone(p));
  ul.innerHTML = list.map((p) => {
    const done = store.isDone(p), viaLog = done && !store.isVisited(p);
    const t = TYPES[p.type] || TYPES.lieu;
    return `<li><label class="chk${done ? ' on' : ''}"><input type="checkbox" data-k="${slugOf(p.name)}" ${done ? 'checked' : ''} ${viaLog ? 'disabled' : ''}>
      <span class="box"></span><span class="ic" style="color:${t.color}">${glyph(p.type)}</span><span class="nm">${esc(p.name)}<small>${esc(t.one || t.label)}${viaLog ? ' · dans ton historique' : ''}</small></span></label>
      <button type="button" class="see" data-k="${slugOf(p.name)}" aria-label="Voir ${esc(p.name)} sur la carte">Voir</button></li>`;
  }).join('') || `<li class="note">${filter === 'done' ? 'Rien de coché ici pour l\'instant.' : 'Tout est fait dans ce secteur. Chapeau.'}</li>`;
  const bySlug = (k) => SITES.find((p) => slugOf(p.name) === k);
  // Comme dans Rappels : la ligne cochée reste quelques secondes, barrée, le temps de se raviser, puis s'efface.
  ul.querySelectorAll('input').forEach((c) => {
    c.onchange = async () => {
      const li = c.closest('li'), on = c.checked;
      await store.setVisited(bySlug(c.dataset.k), on);
      c.closest('.chk').classList.toggle('on', on);
      const leaves = (on && filter === 'todo') || (!on && filter === 'done');
      li.classList.toggle('leaving', leaves);
      clearTimeout(pendingRender);
      pendingRender = setTimeout(() => { if (root.isConnected) rerender(root); }, 3200);
    };
  });
  ul.querySelectorAll('.see').forEach((b) => { b.onclick = () => bus.emit('openPlace', bySlug(b.dataset.k)); });
}

async function drawMap(root) {
  const el = root.querySelector('#geo-map');
  if (gmap) { gmap.remove(); gmap = null; }
  const data = await loadGeo(sector);
  if (!el.isConnected) return;
  const places = placesOf(sector);
  // Hauteur de la carte calée sur les proportions du secteur : le fond peint remplit tout le cadre.
  if (data && data.bbox) {
    const bx = data.bbox, k = Math.cos(((bx[1] + bx[3]) / 2) * Math.PI / 180);
    const ratio = (bx[3] - bx[1]) / ((bx[2] - bx[0]) * k);
    el.style.height = Math.round(Math.max(260, Math.min(560, el.clientWidth * ratio))) + 'px';
  }
  gmap = L.map(el, { zoomControl: false, attributionControl: false, zoomSnap: 0.25, preferCanvas: false });
  const svg = L.svg({ padding: 0.3 }).addTo(gmap);
  const b = data ? data.bbox : null;
  const bounds = b ? L.latLngBounds([b[1], b[0]], [b[3], b[2]]) : L.latLngBounds(places.map((p) => [p.lat, p.lon]));
  gmap.fitBounds(bounds, { padding: [0, 0] });
  gmap.setMaxBounds(bounds.pad(0.15));
  gmap.setMinZoom(gmap.getZoom() - 0.5);
  const ll = (r) => r.map(([x, y]) => [y, x]);
  if (data) {
    const poly = (rings, o) => L.polygon(rings.map(ll), { renderer: svg, interactive: false, ...o }).addTo(gmap);
    if (data.image) {
      // Fond peint (occupation du sol et ombrage du relief), calculé une fois par semaine.
      L.imageOverlay(data.image, [[b[1], b[0]], [b[3], b[2]]], { interactive: false, className: 'geo-paint' }).addTo(gmap);
    } else {
      for (const p of data.relief.mid) poly(p, { stroke: false, fillColor: '#c96a2b', fillOpacity: 0.45 });
      for (const p of data.relief.high) poly(p, { stroke: false, fillColor: '#6b3f22', fillOpacity: 0.6 });
    }
    // Intercommunalités où au moins un lieu est fait : rouge pastel plein.
    const doneUnits = new Set(places.filter((p) => store.isDone(p)).map((p) => data.placeUnit[slugOf(p.name)]).filter(Boolean));
    for (const id of doneUnits) { const u = data.units[id]; if (u) L.polygon(u.rings.map(ll), { renderer: svg, color: '#d9605a', weight: 1.4, opacity: 0.9, fillColor: '#f2a29b', fillOpacity: 0.72, interactive: false, className: 'unit-done' }).addTo(gmap); }
    for (const v of data.valleys) for (const l of v.lines) L.polyline(ll(l), { renderer: svg, color: '#f5b700', weight: 12, opacity: data.image ? 0.22 : 0.3, lineCap: 'round', interactive: false }).addTo(gmap);
    for (const r of data.rivers) for (const l of r.lines) L.polyline(ll(l), { renderer: svg, color: '#3f8fc7', weight: r.major ? 4.5 : 2.2, opacity: 0.95, interactive: false }).addTo(gmap);
    for (const lk of data.lakes) L.polygon(ll(lk), { renderer: svg, stroke: true, color: '#3f8fc7', weight: 1, fillColor: '#7dbbe3', fillOpacity: 1, interactive: false }).addTo(gmap);
    // Contour de la zone du secteur : liseré blanc puis trait foncé, comme une frontière de carte de jeu.
    if (data.outline) for (const p of data.outline) {
      poly(p, { fill: false, color: '#fff', weight: 6, opacity: 0.9 });
      poly(p, { fill: false, color: '#24463a', weight: 2.4, opacity: 1, dashArray: '9 5' });
    }
    for (const v of data.valleys) { const l = v.lines[Math.floor(v.lines.length / 2)]; const m = l[Math.floor(l.length / 2)]; L.marker([m[1], m[0]], { icon: L.divIcon({ className: 'valley-lab', html: esc(v.name), iconSize: null }), interactive: false }).addTo(gmap); }
  }
  for (const [name, la, lo] of TOWNS) {
    if (!bounds.contains([la, lo])) continue;
    L.circleMarker([la, lo], { renderer: svg, radius: 3, color: '#fff', weight: 1, fillColor: '#7b8580', fillOpacity: 1, interactive: false }).addTo(gmap);
    L.marker([la, lo], { icon: L.divIcon({ className: 'town-lab', html: esc(name), iconSize: null, iconAnchor: [-5, 7] }), interactive: false }).addTo(gmap);
  }
  for (const p of places) {
    const done = store.isDone(p), t = TYPES[p.type] || TYPES.lieu;
    const m = L.circleMarker([p.lat, p.lon], { renderer: svg, radius: done ? 6 : 5, color: done ? '#fff' : t.color, weight: done ? 2 : 2.2, fillColor: done ? '#8a1fd1' : '#fff', fillOpacity: 1 }).addTo(gmap);
    m.bindPopup(`<div class="geo-pop"><b>${esc(p.name)}</b><small>${esc(t.one || t.label)}</small>
      <button type="button" class="btn small ${done ? '' : 'main'}" data-act="tog">${done ? 'Décocher' : "J'y suis allé"}</button>
      <button type="button" class="btn small" data-act="see">Voir les randos</button></div>`, { closeButton: false });
    m.on('popupopen', (e) => {
      const box = e.popup.getElement();
      box.querySelector('[data-act=tog]').onclick = async () => { if (!store.isVisited(p) && store.isDone(p)) return; await store.setVisited(p, !store.isDone(p)); rerender(root); };
      box.querySelector('[data-act=see]').onclick = () => bus.emit('openPlace', p);
    });
  }
}

// Hors ligne par secteur : randos précalculées de chaque lieu et carte du secteur, gardées sur le téléphone.
const dlKey = () => 'offline:' + sector;
function dlLabel() {
  const d = settings.get(dlKey(), '');
  const name = (SECTORS.find((s) => s.id === sector) || {}).name;
  return d ? `${name} gardé hors ligne (le ${d.split('-').reverse().slice(0, 2).join('/')}) · mettre à jour` : `Garder ${name} hors ligne`;
}
async function downloadSector(btn) {
  const list = placesOf(sector);
  btn.disabled = true;
  let ok = 0, k = 0;
  const g = await loadGeo(sector);
  if (g && g.image) await fetch(g.image).catch(() => {});
  for (const p of list) {
    k++;
    btn.textContent = `Téléchargement… ${k} / ${list.length}`;
    try { if (await prefetchPlace(p)) ok++; } catch { /* lieu suivant */ }
  }
  settings.set(dlKey(), new Date().toISOString().slice(0, 10));
  btn.disabled = false;
  btn.textContent = dlLabel();
  toast(`${ok} lieux sur ${list.length} gardés hors ligne. Les fonds de carte se gardent rando par rando (« Garder hors ligne »).`, 5000);
}

function openHelp() {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h2>Les grades</h2>
    <p class="note">Chaque lieu fait compte, qu'il soit coché ici ou noté dans ton historique. Le dodo grandit avec toi.</p>
    <ol class="grades">${GRADES.map((g, i) => `<li>${dodoSvg(g.dodo, 40)}<span><b>${esc(g.name)}</b><small>${g.at === 0 ? 'Au départ' : `À partir de ${g.at} lieu${g.at > 1 ? 'x' : ''}`} · ${DODO_STAGES[i]}</small></span></li>`).join('')}</ol>
    <div class="help-climb">${climbSvg(0, 220, 154)}</div>
    <p class="note">Par secteur, Didou le dodo gravit sa montagne à mesure que tu fais les lieux ; il plante son drapeau quand tout est fait. Sur la carte, chaque intercommunalité où tu as fait un lieu passe en rouge : ton territoire.</p>
    <div class="foot"><button type="button" class="btn main" id="gh-ok">Compris</button></div></div>`;
  m.hidden = false;
  const stop = animateClimber(m.querySelector('.help-climb svg'));
  const close = () => { stop(); m.hidden = true; m.innerHTML = ''; };
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector('#gh-ok').onclick = close;
  modalChrome(m.firstChild, close);
}
