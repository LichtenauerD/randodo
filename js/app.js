// Démarrage, onglets, recherche.
import { CONFIG } from './config.js';
import { store, bus, wantActive } from './state.js';
import { initMap, map, layers, currentLayer, setLayer, trailsOn, setTrails, showMe, mapState, focus } from './map.js';
import { openPlace, closeSheet, sheetOpen } from './sheet.js';
import { showTab, setNavigator, openWant, wantLabel, importGpxFile, openModal, closeModal, askName } from './pages.js';
import { isGuiding, recenter } from './guide.js';
import { searchLocal, searchRemote } from './places.js';
import { TYPES } from './config.js';
import { debounce, esc, toast } from './util.js';

const $ = (s) => document.querySelector(s);

function go(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const onMap = tab === 'carte';
  $('#top').hidden = !onMap;
  $('#fabs').hidden = !onMap;
  if (!onMap && sheetOpen()) closeSheet();
  showTab(tab);
  if (onMap) setTimeout(() => map.invalidateSize(), 50);
}

function updateWant() {
  $('#filter-label').textContent = wantLabel();
  $('#btn-filter').classList.toggle('set', wantActive());
}

function setStatus(text, warn) {
  const s = $('#status');
  s.hidden = !text; s.textContent = text || ''; s.classList.toggle('warn', !!warn);
}

// ---------- Recherche ----------
let searchSeq = 0;
function renderResults(local, remote, pending) {
  const ul = $('#results');
  const item = (p, sub) => `<li><button type="button" data-id="${esc(p.id)}"><span><b>${esc(p.name)}</b><br><span class="sub">${esc(sub)}</span></span></button></li>`;
  const seen = new Set(local.map((p) => p.name.toLowerCase()));
  const rem = remote.filter((p) => !seen.has(p.name.toLowerCase()));
  const html = local.map((p) => item(p, (TYPES[p.type] || TYPES.lieu).one + (p.massif ? ', ' + p.massif : ''))).join('')
    + rem.map((p) => item(p, [(TYPES[p.type] || TYPES.lieu).one, p.where].filter(Boolean).join(', '))).join('');
  ul.innerHTML = html || `<li class="hint">${pending ? 'Recherche en cours' : 'Aucun lieu trouvé. Essaie un autre nom, ou appuie longuement sur la carte pour partir d\'un point.'}</li>`;
  ul.hidden = false;
  const all = local.concat(rem);
  ul.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const p = all.find((x) => x.id === b.dataset.id);
      ul.hidden = true; $('#search').value = ''; $('#search').blur();
      if (p) openPlace(p);
    };
  });
}
const doSearch = debounce(async () => {
  const q = $('#search').value.trim();
  const my = ++searchSeq;
  if (q.length < 2) { $('#results').hidden = true; return; }
  const local = searchLocal(q, 6);
  renderResults(local, [], true);
  try {
    const remote = await searchRemote(q);
    if (my === searchSeq) renderResults(local, remote, false);
  } catch {
    if (my === searchSeq) renderResults(local, [], false);
  }
}, 320);

// Choix du fond de carte.
function openLayers() {
  const list = layers();
  const box = openModal(`<h2>Fond de carte</h2>
    <div class="layerlist">${list.map((t) => `<button type="button" class="layer${t.id === currentLayer() ? ' on' : ''}" data-id="${t.id}"><b>${esc(t.label)}</b><span>${esc(t.note || '')}</span></button>`).join('')}</div>
    ${CONFIG.trailsOverlay ? `<label class="switch"><span>Afficher les itinéraires balisés</span><input type="checkbox" id="ly-trails"${trailsOn() ? ' checked' : ''}></label>` : ''}
    <p class="note" style="margin-top:12px">La carte IGN au 1:25 000 demande une clé d'accès, à saisir dans Réglages.</p>
    <div class="foot" style="grid-template-columns:1fr"><button type="button" class="btn main" id="ly-ok">Fermer</button></div>`);
  box.querySelectorAll('.layer').forEach((b) => {
    b.onclick = () => { setLayer(b.dataset.id); box.querySelectorAll('.layer').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const tr = box.querySelector('#ly-trails');
  if (tr) tr.onchange = () => setTrails(tr.checked);
  box.querySelector('#ly-ok').onclick = closeModal;
}

async function boot() {
  await store.load();
  initMap((p) => { $('#results').hidden = true; openPlace(p, { focus: true }); });
  setNavigator(go);
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
  $('#btn-filter').onclick = openWant;
  bus.on('want', updateWant);
  updateWant();
  bus.on('maphint', (h) => setStatus(h, /indisponible/.test(h)));
  bus.on('sheet', (open) => { if (open) $('#results').hidden = true; });
  $('#search').addEventListener('input', doSearch);
  $('#search').addEventListener('focus', () => { if ($('#search').value.trim().length >= 2) doSearch(); });
  map.on('click', () => { $('#results').hidden = true; $('#search').blur(); });

  $('#btn-layer').onclick = openLayers;
  bus.on('layerfail', (label) => toast(`Le fond « ${label} » ne répond pas : retour au plan général.`, 5000));
  $('#btn-locate').onclick = () => {
    if (isGuiding()) { recenter(); return; }
    if (!('geolocation' in navigator)) { toast('La localisation n\'est pas disponible ici.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { showMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); focus(pos.coords.latitude, pos.coords.longitude, Math.max(map.getZoom(), 12)); },
      (err) => toast(err.code === 1 ? 'Localisation refusée : autorise-la dans les réglages du téléphone.' : 'Position introuvable pour l\'instant.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };
  $('#gpx-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importGpxFile(f); };

  if ('serviceWorker' in navigator && !CONFIG.mock) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.addEventListener('offline', () => toast('Hors ligne : les traces gardées et les lieux déjà vus restent disponibles.', 4500));
  window.__cairn = { go, openPlace, store, mapState, map };
  go(new URLSearchParams(location.search).get('tab') || 'accueil');
  askName();
}

boot().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:auto 10px 80px;z-index:999;background:#c23a2b;color:#fff;padding:12px 14px;border-radius:12px">Randodo n'a pas pu démarrer : ${esc(err.message)}</div>`);
  console.error(err);
});
