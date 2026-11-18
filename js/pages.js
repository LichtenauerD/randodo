// Pages : traces, historique (mes randos, communauté, envies), réglages, diagnostic, envie du jour, saisie d'une rando.
import { shareApp } from './share.js';
import { startTour, maybeTour } from './tour.js';
import { CONFIG, TYPES, VERSION } from './config.js';
import { store, want, saveWant, wantActive, DEFAULT_WISH, bus } from './state.js';
import { openHike, openPlace, frDate } from './sheet.js';
import { renderObjectifs, SECTORS, sectorOf } from './objectifs.js';
import { glyph } from './map.js';
import { needsOnboarding, openOnboarding } from './onboard.js';
import { gradeOf, dodoSvg } from './grades.js';
import { startGuide } from './guide.js';
import { fromGpx } from './hikes.js';
import { parseGpx, shareGpx } from './gpx.js';
import { overpassState } from './overpass.js';
import { renderHome, setHomeNavigator, GROUPS } from './home.js';
import { kv, settings, esc, fmtKm, fmtDur, toast, uid, fetchJson, slugOf } from './util.js';
import { SITES } from './places.js';

const $ = (s, r = document) => r.querySelector(s);
const page = () => document.getElementById('page');
const LVC = { facile: 'var(--facile)', moyenne: 'var(--moyenne)', difficile: 'var(--difficile)' };
let tab = 'carte';
let histTab = 'mes';
let goTab = () => {};
export function setNavigator(fn) { goTab = fn; setHomeNavigator(fn); }
export const navigate = (t) => goTab && goTab(t);

// ---------- Fenêtre ----------
export function openModal(html) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  return m.firstChild;
}
export function closeModal() { const m = document.getElementById('modal'); m.hidden = true; m.innerHTML = ''; }

// ---------- Envie du jour (filtres) ----------
export function openWant() {
  const lim = (v, max, unit) => (v >= max ? 'Sans limite' : String(v).replace('.', ',') + ' ' + unit);
  const box = openModal(`<h2>Mon envie du jour</h2><p class="note">Les propositions qui ne correspondent pas sont grisées, et la carte ne garde que les types choisis.</p>
    <div class="field"><span>Niveau</span><div class="checks" id="w-lv">${CONFIG.levels.map((l) => `<button type="button" class="chip${want.levels.includes(l.id) ? ' on' : ''}" data-v="${l.id}"><i class="lvdot" style="background:${LVC[l.id]};margin:0"></i>${l.label}</button>`).join('')}</div></div>
    <label class="field"><span>Distance maximale <b class="val" id="v-km"></b></span><input type="range" id="w-km" min="3" max="25" step="1" value="${want.maxKm}"></label>
    <label class="field"><span>Montée maximale <b class="val" id="v-up"></b></span><input type="range" id="w-up" min="100" max="1500" step="50" value="${want.maxUp}"></label>
    <label class="field"><span>Durée maximale <b class="val" id="v-h"></b></span><input type="range" id="w-h" min="1" max="9" step="0.5" value="${want.maxH}"></label>
    <div class="field"><span>Types de lieux</span><div class="checks" id="w-ty">${Object.entries(TYPES).filter(([k]) => k !== 'lieu').map(([k, t]) => `<button type="button" class="chip${want.types.includes(k) ? ' on' : ''}" data-v="${k}">${t.label}</button>`).join('')}</div></div>
    <label class="switch"><span>Masquer les lieux déjà faits</span><input type="checkbox" id="w-done"${want.hideDone ? ' checked' : ''}></label>
    <div class="foot"><button type="button" class="btn" id="w-reset">Tout remettre à zéro</button><button type="button" class="btn main" id="w-ok">Voir la carte</button></div>`);
  const sync = () => {
    $('#v-km', box).textContent = lim(+$('#w-km', box).value, 25, 'km');
    $('#v-up', box).textContent = lim(+$('#w-up', box).value, 1500, 'm');
    $('#v-h', box).textContent = lim(+$('#w-h', box).value, 9, 'h');
  };
  sync();
  box.querySelectorAll('input[type=range]').forEach((i) => { i.oninput = sync; });
  box.querySelectorAll('.checks .chip').forEach((b) => { b.onclick = () => b.classList.toggle('on'); });
  $('#w-reset', box).onclick = () => { Object.assign(want, JSON.parse(JSON.stringify(DEFAULT_WISH))); saveWant(); closeModal(); };
  $('#w-ok', box).onclick = () => {
    want.levels = [...box.querySelectorAll('#w-lv .on')].map((b) => b.dataset.v);
    want.types = [...box.querySelectorAll('#w-ty .on')].map((b) => b.dataset.v);
    want.maxKm = +$('#w-km', box).value; want.maxUp = +$('#w-up', box).value; want.maxH = +$('#w-h', box).value;
    want.hideDone = $('#w-done', box).checked;
    saveWant(); closeModal();
  };
}
export function wantLabel() {
  if (!wantActive()) return 'Mon envie';
  const bits = [];
  if (want.levels.length) bits.push(want.levels.map((l) => l[0].toUpperCase() + l.slice(1)).join(', '));
  if (want.maxKm < 25) bits.push('≤ ' + want.maxKm + ' km');
  if (!bits.length) bits.push('Filtres actifs');
  return bits.join(' ').slice(0, 22);
}

// ---------- Saisie d'une rando faite ----------
export function openLogForm({ place, hike, walked, walkedMinutes, onSaved, entry }) {
  const e = entry || {};
  const km = e.km ?? (walked && hike && walked > 300 ? walked / 1000 : hike ? hike.meters / 1000 : '');
  const up = e.up ?? (hike && hike.up != null ? hike.up : '');
  const canShare = !!communityUrl();
  let rating = e.rating || 0;
  const box = openModal(`<h2>${entry ? 'Modifier la rando' : 'Rando faite'}</h2>
    <label class="field"><span>Lieu</span><input type="text" id="l-place" value="${esc(e.placeName ?? (place ? place.name : hike ? hike.title : ''))}" placeholder="Nom du lieu"></label>
    ${hike ? `<p class="note" style="margin-top:6px">${esc(hike.title)}</p>` : ''}
    <label class="field"><span>Date</span><input type="date" id="l-date" value="${e.date || new Date().toISOString().slice(0, 10)}"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label class="field"><span>Distance (km)</span><input type="text" inputmode="decimal" id="l-km" value="${km === '' ? '' : String(Math.round(km * 10) / 10).replace('.', ',')}"></label>
      <label class="field"><span>Montée (m)</span><input type="text" inputmode="numeric" id="l-up" value="${up}"></label>
    </div>
    <div class="field"><span>Ma note</span><div class="stars" id="l-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${n <= rating ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <label class="field"><span>Avec qui</span><input type="text" id="l-with" value="${esc(e.with || '')}" placeholder="Facultatif"></label>
    <label class="field"><span>Commentaire</span><textarea id="l-note" placeholder="Ce qu'il faut retenir pour la prochaine fois">${esc(e.note || '')}</textarea></label>
    ${canShare ? `<label class="switch"><span>Partager avec le groupe</span><input type="checkbox" id="l-share"${e.shared === false ? '' : ' checked'}></label>` : ''}
    <div class="foot"><button type="button" class="btn" id="l-cancel">Annuler</button><button type="button" class="btn main" id="l-ok">Enregistrer</button></div>`);
  box.querySelectorAll('#l-stars button').forEach((b) => {
    b.onclick = () => { rating = +b.dataset.n; box.querySelectorAll('#l-stars button').forEach((x) => x.classList.toggle('on', +x.dataset.n <= rating)); };
  });
  $('#l-cancel', box).onclick = closeModal;
  $('#l-ok', box).onclick = async () => {
    const name = $('#l-place', box).value.trim();
    if (!name) { toast('Indique au moins le nom du lieu.'); return; }
    const num = (s) => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : null; };
    const src = place || (hike && hike.place) || {};
    const saved = await store.addLog({
      ...(entry ? { id: entry.id } : {}),
      date: $('#l-date', box).value || new Date().toISOString().slice(0, 10),
      placeId: e.placeId ?? src.id ?? (hike ? hike.placeId : null), placeName: name,
      lat: e.lat ?? src.lat ?? (hike ? hike.pts[0][0] : null), lon: e.lon ?? src.lon ?? (hike ? hike.pts[0][1] : null),
      title: e.title ?? (hike ? hike.title : ''), km: num($('#l-km', box).value), up: num($('#l-up', box).value),
      minutes: e.minutes ?? (walkedMinutes && walkedMinutes > 20 ? walkedMinutes : hike ? hike.minutes : null),
      level: e.level ?? (hike ? hike.level : null), rating, with: $('#l-with', box).value.trim(), note: $('#l-note', box).value.trim(),
      shared: canShare ? $('#l-share', box).checked : false,
    });
    closeModal();
    toast('Rando ajoutée à ton historique.');
    if (saved.shared) pushCommunity(saved);
    if (onSaved) onSaved(saved);
    if (tab === 'historique') render();
  };
}

// ---------- Premier lancement : prénom, puis inscription dans la feuille du groupe ----------
export function askName() {
  pingUsage();
  if (settings.get('pseudo', '').trim()) { register(); if (needsOnboarding()) openOnboarding(() => { if (tab === 'accueil') render(); maybeTour(); }); else maybeTour(); return; }
  const box = openModal(`<div class="welcome"><img src="icons/icon-192.png" alt="" width="84" height="84"><h2>Bienvenue sur Randodo</h2><p class="motto">Le dodo ne vole pas. Il marche. Et toi ?</p>
    <p>Moi, c'est Didou le dodo : je t'accompagne sur les sentiers. Et toi, c'est quoi ton prénom ? Il sert à signer tes randos quand tu les partages.</p>
    <label class="field"><input type="text" id="wn-name" placeholder="Ton prénom" maxlength="24" autocomplete="given-name" autocapitalize="words"></label>
    <button type="button" class="btn main" id="wn-ok" style="width:100%;margin-top:14px">C'est parti</button></div>`);
  document.getElementById('modal').onclick = null; // on ne ferme pas cette fenêtre en touchant à côté
  $('#wn-name', box).oninput = (e) => markField(e.target, '');
  const ok = async () => {
    const input = $('#wn-name', box), name = input.value.trim();
    if (name.length < 2) { markField(input, 'Écris ton prénom pour continuer.'); return; }
    if (await nameTaken(name)) { markField(input, TAKEN); return; }
    settings.set('pseudo', name);
    closeModal();
    register();
    if (tab === 'accueil') render();
    if (needsOnboarding()) openOnboarding(() => { if (tab === 'accueil' || tab === 'objectifs') render(); maybeTour(); });
    else maybeTour();
  };
  $('#wn-ok', box).onclick = ok;
  $('#wn-name', box).onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  setTimeout(() => $('#wn-name', box).focus(), 100);
}
// ---------- Prénoms uniques dans la communauté ----------
const normName = (n) => String(n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
// Vrai si un autre membre porte déjà ce prénom. En cas de réseau absent, on laisse passer (le script vérifie aussi).
export async function nameTaken(name) {
  const url = groupAddress();
  if (!url || !normName(name)) return false;
  try {
    const j = await fetchJson(url + (url.includes('?') ? '&' : '?') + 'action=list', { redirect: 'follow' }, 10000);
    const me = await myPid();
    return (j.members || []).some((m) => normName(m.who) === normName(name) && (!me || m.pid !== me));
  } catch { return false; }
}
const TAKEN = 'Nom déjà pris, veuillez en choisir un autre.';
function markField(input, msg) {
  input.classList.toggle('bad', !!msg);
  let hint = input.parentElement.querySelector('.field-err');
  if (!hint) { hint = document.createElement('small'); hint.className = 'field-err'; input.insertAdjacentElement('afterend', hint); }
  hint.textContent = msg || '';
  hint.hidden = !msg;
}
// Demande un autre prénom quand celui-ci est pris (au moment de rejoindre la communauté).
function askOtherName() {
  return new Promise((resolve) => {
    const box = openModal(`<h2>Ce prénom est déjà pris</h2><p class="meta">Un autre membre de la communauté s'appelle déjà ${esc(settings.get('pseudo', ''))}. Choisis un prénom ou un surnom différent, par exemple avec l'initiale de ton nom.</p>
      <label class="field"><input type="text" id="on-name" maxlength="24" value="${esc(settings.get('pseudo', ''))}" autocapitalize="words"></label>
      <div class="foot"><button type="button" class="btn" id="on-no">Annuler</button><button type="button" class="btn main" id="on-ok">Valider</button></div>`);
    document.getElementById('modal').classList.add('over');
    const input = $('#on-name', box);
    markField(input, TAKEN);
    input.oninput = () => markField(input, '');
    const done = (v) => { document.getElementById('modal').classList.remove('over'); closeModal(); resolve(v); };
    $('#on-no', box).onclick = () => done(null);
    $('#on-ok', box).onclick = async () => {
      const n = input.value.trim();
      if (n.length < 2) { markField(input, 'Écris au moins deux lettres.'); return; }
      if (await nameTaken(n)) { markField(input, TAKEN); return; }
      settings.set('pseudo', n); done(n);
    };
  });
}

// Inscrit ce téléphone dans l'onglet « Membres » de la feuille du groupe (une fois par prénom et par adresse).
export async function register(strict) {
  const who = settings.get('pseudo', '').trim(), url = communityUrl();
  if (!who || !url) return;
  const mark = who + '|' + url;
  if (settings.get('joined', '') === mark) return;
  try { await post({ action: 'join', owner: deviceKey(), who }); settings.set('joined', mark); } catch (err) { if (strict) throw err; }
}

// ---------- Communauté ----------
export const groupAddress = () => (settings.get('communityUrl', '') || (CONFIG.mock ? '' : CONFIG.communityUrl) || '').trim();
// Choix fait au tutoriel ou dans Réglages : 'oui' (membre), 'non' (solo), vide (pas encore choisi).
export const communityChoice = () => settings.get('community', '');
export const communityUrl = () => (communityChoice() === 'oui' ? groupAddress() : '');
const deviceKey = () => { let k = settings.get('deviceKey', ''); if (!k) { k = uid() + uid(); settings.set('deviceKey', k); } return k; };
async function post(payload) {
  const res = await fetch(groupAddress(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'refus du serveur');
  return j;
}
// Progression envoyée au groupe (grade, nombre de lieux, lieux faits), au plus une fois toutes les 20 secondes.
let progressTimer = null;
export function pushProgress(now) {
  if (!communityUrl() || !settings.get('pseudo', '').trim()) return;
  clearTimeout(progressTimer);
  return new Promise((fin) => { progressTimer = setTimeout(async () => {
    const done = SITES.filter((p) => store.isDone(p));
    const sig = done.length + ':' + done.map((p) => p.id).join(',');
    if (settings.get('progressSent', '') === sig) { fin(); return; }
    try {
      await post({ action: 'progress', owner: deviceKey(), grade: gradeOf(done.length).name, lieux: done.length, faits: done.map((p) => slugOf(p.name)).join(',') });
      settings.set('progressSent', sig);
    } catch { /* nouvel essai au prochain changement */ }
    fin();
  }, now ? 0 : 20000); });
}

// Adhésion : inscription, puis envoi des lieux cochés et de toutes les randos de l'historique.
export async function joinCommunity() {
  if (!groupAddress()) { toast('La communauté n\'est pas reliée sur cette version.'); return false; }
  if (!settings.get('pseudo', '').trim()) { toast('Indique d\'abord ton prénom dans Réglages.'); return false; }
  if (await nameTaken(settings.get('pseudo', '')) && !(await askOtherName())) { toast('Tu restes en solo pour l\'instant.'); if (!communityChoice()) settings.set('community', 'non'); return false; }
  settings.set('community', 'oui');
  settings.set('joined', ''); settings.set('progressSent', '');
  pingUsage(true);
  try {
    await register(true);
    await pushProgress(true);
    let n = 0;
    for (const e of store.log) {
      if (e.shared === true && e.sent) continue;
      e.shared = true;
      try { await pushCommunity(e, true); e.sent = true; n++; } catch { e.shared = false; }
    }
    await kv.set('log', store.log);
    toast(n ? `Bienvenue dans la communauté ! ${n} rando${n > 1 ? 's' : ''} partagée${n > 1 ? 's' : ''}.` : 'Bienvenue dans la communauté !', 4000);
  } catch (err) { toast('Adhésion enregistrée, l\'envoi reprendra au prochain lancement (' + err.message + ').', 5000); }
  if (tab === 'historique' || tab === 'reglages') render();
  return true;
}
// Départ : tes randos partagées et ta ligne de membre sont effacées de la feuille du groupe.
export async function leaveCommunity() {
  try { if (groupAddress()) await post({ action: 'leave', owner: deviceKey() }); }
  catch (err) { toast('Le groupe ne répond pas, réessaie plus tard (' + err.message + ').', 5000); return false; }
  settings.set('community', 'non'); settings.set('joined', ''); settings.set('progressSent', '');
  pingUsage(true);
  store.log.forEach((e) => { e.shared = false; e.sent = false; });
  await kv.set('log', store.log);
  await kv.set('community', null); await kv.set('members', []);
  toast('Tu randonnes en solo. Tes données ont été retirées du groupe.', 4500);
  if (tab === 'historique' || tab === 'reglages') render();
  return true;
}
export function soloCommunity() { settings.set('community', 'non'); pingUsage(true); }

// Compteur anonyme d'utilisateurs : un identifiant au hasard, renouvelé chaque année, sans prénom ni lien
// avec l'identifiant du groupe. Il sert seulement à afficher combien de personnes utilisent l'appli.
export async function pingUsage(force) {
  if (!groupAddress() || !communityChoice()) return;
  let a = settings.get('anon', null);
  if (!a || Date.now() - a.t > 365 * 864e5) { a = { id: uid() + uid(), t: Date.now() }; settings.set('anon', a); }
  const last = settings.get('pinged', 0), solo = communityChoice() !== 'oui';
  if (!force && Date.now() - last < 7 * 864e5 && settings.get('pingedSolo', null) === solo) return;
  try { await post({ action: 'ping', anon: a.id, solo }); settings.set('pinged', Date.now()); settings.set('pingedSolo', solo); } catch { /* prochain lancement */ }
}

// Pour ceux qui avaient déjà fait la visite avant la 1.8 : la question est posée une fois.
export function askCommunity(after) {
  if (!groupAddress()) { if (after) after(); return; }
  const box = openModal(`<div class="welcome">${dodoSvg(3, 84)}<h2>Rejoindre la communauté ?</h2>
    <p>Tes randos et tes lieux cochés seront visibles par les autres membres, et tu verras les leurs, avec le profil de chacun.</p>
    <p class="note">Ou alors, tu randonnes en solo : ni ton prénom ni tes sorties ne quittent ton téléphone. Tu pourras changer d'avis dans Réglages.</p>
    <button type="button" class="btn main" id="cm-yes" style="width:100%;margin-top:14px">Je rejoins la communauté</button>
    <button type="button" class="btn" id="cm-no" style="width:100%;margin-top:8px">Je reste en solo</button></div>`);
  document.getElementById('modal').onclick = null;
  $('#cm-yes', box).onclick = async () => { closeModal(); await joinCommunity(); if (after) after(); };
  $('#cm-no', box).onclick = () => { closeModal(); soloCommunity(); if (after) after(); };
}
bus.on('log', () => pushProgress());

export async function pushCommunity(e, quiet) {
  const who = settings.get('pseudo', '').trim();
  if (!communityUrl()) return;
  if (!who) { toast('Indique ton prénom dans Réglages pour partager avec le groupe.', 4500); return; }
  try {
    await post({ action: 'add', owner: deviceKey(), entry: { id: e.id, who, date: e.date, placeName: e.placeName, lat: e.lat, lon: e.lon, title: e.title, km: e.km, up: e.up, minutes: e.minutes, level: e.level, rating: e.rating, note: e.note } });
    if (quiet) return;
    toast('Partagée avec le groupe.');
  } catch (err) {
    if (quiet) throw err;
    toast('Partage impossible pour l\'instant (' + err.message + '). Réessaie depuis l\'historique.', 5000);
    const x = store.log.find((l) => l.id === e.id);
    if (x) { x.shared = false; kv.set('log', store.log); }
  }
}
// Retrait d'une rando du groupe. En cas d'échec (réseau), la demande est gardée et refaite plus tard.
async function unshare(id) {
  const todo = new Set(settings.get('pendingDel', [])); todo.add(id); settings.set('pendingDel', [...todo]);
  await flushDeletes();
}
async function flushDeletes() {
  const todo = settings.get('pendingDel', []);
  if (!todo.length || !communityUrl()) return;
  const left = [];
  for (const id of todo) { try { await post({ action: 'delete', owner: deviceKey(), id }); } catch { left.push(id); } }
  settings.set('pendingDel', left);
}
// Empreinte publique de ce téléphone, calculée comme le script du groupe.
async function myPid() {
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('randodo:' + deviceKey())));
    return [...h.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
async function loadCommunity() {
  const url = communityUrl();
  await flushDeletes();
  const j = await fetchJson(url + (url.includes('?') ? '&' : '?') + 'action=list', { redirect: 'follow' }, 20000);
  if (!j.ok) throw new Error(j.error || 'réponse inattendue');
  // Mes randos encore dans le groupe mais supprimées de mon historique : on les retire.
  const me = await myPid(), mine = new Set(store.log.map((e) => e.id));
  const orphans = me ? (j.entries || []).filter((e) => e.pid === me && !mine.has(String(e.id))) : [];
  if (orphans.length) {
    for (const e of orphans) await unshare(String(e.id));
    j.entries = j.entries.filter((e) => !orphans.includes(e));
  }
  const entries = (j.entries || []).sort((a, b) => (a.date < b.date ? 1 : -1));
  await kv.set('community', { t: Date.now(), entries });
  await kv.set('members', Array.isArray(j.members) ? j.members : []);
  await kv.set('soloCount', Number.isFinite(j.solo) ? j.solo : null);
  if (Array.isArray(j.suggestions)) await kv.set('websugg', { t: Date.now(), items: j.suggestions.filter((x) => x && x.title) });
  return entries;
}

// ---------- Rendu des pages ----------
export function showTab(t) {
  tab = t;
  const p = page();
  if (t === 'carte') { p.hidden = true; p.innerHTML = ''; return; }
  p.hidden = false;
  p.scrollTop = 0;
  render();
}
function render() {
  page().dataset.view = tab;
  if (tab === 'accueil') renderHome(page());
  else if (tab === 'objectifs') renderObjectifs(page());
  else if (tab === 'traces') renderTraces();
  else if (tab === 'historique') renderHistory();
  else if (tab === 'reglages') renderSettings();
}
bus.on('hikes', () => { if (tab === 'traces') render(); });
bus.on('log', () => { if (tab === 'historique' || tab === 'accueil') render(); });
bus.on('wish', () => { if (tab === 'historique') render(); });

const numsLine = (o) => `<div class="nums">${o.km != null ? `<span>${String(Math.round(o.km * 10) / 10).replace('.', ',')} km</span>` : ''}${o.up != null ? `<span>${Math.round(o.up)} m de montée</span>` : ''}${o.minutes ? `<span>${fmtDur(o.minutes)}</span>` : ''}</div>`;
const lvDot = (l) => (l ? `<i class="lvdot" style="background:${LVC[l]}"></i>` : '');

function renderTraces() {
  const p = page();
  const cards = store.hikes.map((h) => `<div class="card" data-id="${h.id}">
      <h3>${lvDot(h.level)}${esc(h.title)}</h3>
      <p class="meta">${h.place ? esc(h.place.name) + ', ' : ''}${h.source === 'import' ? 'trace importée' : h.source === 'balise' ? 'circuit balisé' : 'tracé calculé'}${h.corridor && h.corridor.length ? ', carte de terrain incluse' : ''}</p>
      ${numsLine({ km: h.meters / 1000, up: h.up, minutes: h.minutes })}
      <div class="row"><button type="button" class="btn small go" data-a="go">Lancer</button><button type="button" class="btn small" data-a="see">Voir</button><button type="button" class="btn small" data-a="gpx">GPX</button><button type="button" class="btn small" data-a="del">Supprimer</button></div>
    </div>`).join('');
  p.innerHTML = `<h2>Traces</h2><p class="lead">Les randonnées gardées sur ce téléphone. Elles se suivent sans réseau.</p>
    <button type="button" class="btn main wide" id="t-import" style="width:100%;margin-bottom:14px">Importer un fichier GPX</button>
    ${cards || '<div class="empty"><b>Aucune trace gardée</b>Ouvre un lieu sur la carte, choisis une proposition, puis « Garder hors ligne ». Tu peux aussi importer un GPX venu de Komoot ou d\'ailleurs.</div>'}`;
  $('#t-import', p).onclick = () => document.getElementById('gpx-file').click();
  p.querySelectorAll('.card [data-a]').forEach((b) => {
    b.onclick = async () => {
      const h = store.hikes.find((x) => x.id === b.closest('.card').dataset.id);
      if (!h) return;
      if (b.dataset.a === 'go') { goTab('carte'); startGuide(h); }
      else if (b.dataset.a === 'see') { goTab('carte'); openHike(h, {}); }
      else if (b.dataset.a === 'gpx') { const r = await shareGpx(h); if (r === 'telechargement') toast('Trace téléchargée.'); }
      else if (b.dataset.a === 'del') { if (confirm('Supprimer cette trace du téléphone ?')) store.removeHike(h.id); }
    };
  });
}

export async function importGpxFile(file) {
  try {
    const text = await file.text();
    toast('Lecture de la trace');
    const h = await fromGpx(parseGpx(text), file.name.replace(/\.gpx$/i, ''));
    await store.saveHike(h);
    goTab('carte');
    openHike(h, {});
    toast('Trace importée et gardée hors ligne.');
  } catch (err) { toast(err.message, 5000); }
}

function renderHistory() {
  const p = page();
  const seg = `<div class="seg">${[['mes', 'Mes randos'], ['groupe', 'Communauté'], ['envies', 'Envies']].map(([k, l]) => `<button type="button" data-k="${k}" class="${histTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  p.innerHTML = `<h2>Historique</h2>${seg}<div id="h-body"></div>`;
  p.querySelectorAll('.seg button').forEach((b) => { b.onclick = () => { histTab = b.dataset.k; renderHistory(); }; });
  const body = $('#h-body', p);
  if (histTab === 'mes') {
    const km = store.log.reduce((s, e) => s + (e.km || 0), 0), up = store.log.reduce((s, e) => s + (e.up || 0), 0);
    body.innerHTML = (store.log.length ? `<div class="totals"><div><b>${store.log.length}</b><span>${store.log.length > 1 ? 'sorties' : 'sortie'}</span></div><div><b>${Math.round(km)}</b><span>km</span></div><div><b>${Math.round(up)}</b><span>m de montée</span></div></div>` : '')
      + (store.log.map((e) => `<div class="card" data-id="${e.id}">
        <h3>${lvDot(e.level)}${esc(e.placeName)}</h3>
        <p class="meta">${frDate(e.date)}${e.title && e.title !== e.placeName ? ', ' + esc(e.title) : ''}${e.with ? ', avec ' + esc(e.with) : ''}${e.rating ? ', note ' + e.rating + '/5' : ''}</p>
        ${numsLine(e)}${e.note ? `<p style="margin-top:6px;font-size:.92rem">${esc(e.note)}</p>` : ''}
        <div class="row">${e.lat != null ? '<button type="button" class="btn small" data-a="map">Voir sur la carte</button>' : ''}<button type="button" class="btn small" data-a="edit">Modifier</button>${communityUrl() && !e.shared ? '<button type="button" class="btn small" data-a="share">Partager au groupe</button>' : ''}<button type="button" class="btn small" data-a="del">Supprimer</button></div>
      </div>`).join('') || '<div class="empty"><b>Aucune rando notée</b>Après une sortie, touche « Je l\'ai faite » sur la fiche de la rando, ou « Déjà faite » sur un lieu. Les lieux faits sont cochés sur la carte.</div>')
      + '<button type="button" class="btn wide" id="h-add" style="width:100%">Ajouter une rando à la main</button>';
    $('#h-add', body).onclick = () => openLogForm({});
    body.querySelectorAll('.card [data-a]').forEach((b) => {
      b.onclick = async () => {
        const e = store.log.find((x) => x.id === b.closest('.card').dataset.id);
        if (!e) return;
        if (b.dataset.a === 'map') { goTab('carte'); openPlace({ id: e.placeId || 'h' + e.id, name: e.placeName, type: 'lieu', lat: e.lat, lon: e.lon, score: 0 }); }
        else if (b.dataset.a === 'edit') openLogForm({ entry: e });
        else if (b.dataset.a === 'share') { e.shared = true; await kv.set('log', store.log); await pushCommunity(e); renderHistory(); }
        else if (b.dataset.a === 'del') {
          if (!confirm('Supprimer cette rando de ton historique ?')) return;
          await store.removeLog(e.id);
          if (communityUrl()) unshare(e.id);
        }
      };
    });
  } else if (histTab === 'envies') {
    body.innerHTML = store.wish.map((w) => `<div class="card" data-id="${esc(w.id)}"><h3>${esc(w.name)}</h3><p class="meta">${(TYPES[w.type] || TYPES.lieu).one}</p>
      <div class="row"><button type="button" class="btn small main" data-a="open">Voir les randos</button><button type="button" class="btn small" data-a="del">Retirer</button></div></div>`).join('')
      || '<div class="empty"><b>Aucune envie pour l\'instant</b>Sur la fiche d\'un lieu, touche « Ajouter à mes envies » pour le retrouver ici. Les envies sont cerclées de rouge sur la carte.</div>';
    body.querySelectorAll('.card [data-a]').forEach((b) => {
      b.onclick = () => {
        const w = store.wish.find((x) => x.id === b.closest('.card').dataset.id);
        if (!w) return;
        if (b.dataset.a === 'open') { goTab('carte'); openPlace({ ...w, score: 0 }); } else store.toggleWish(w);
      };
    });
  } else {
    renderCommunity(body);
  }
}

let whoFilter = '';
async function renderCommunity(body) {
  if (!communityUrl()) {
    if (!groupAddress()) { body.innerHTML = '<div class="empty"><b>Pas de communauté reliée</b>Cette version de l\'appli n\'est reliée à aucun groupe.</div>'; return; }
    body.innerHTML = '<div class="empty"><b>Tu randonnes en solo</b>Rejoins la communauté pour voir les randos et la progression des autres. Tes randos et tes lieux cochés seront partagés avec eux.</div><button type="button" class="btn main" id="c-join" style="width:100%">Rejoindre la communauté</button>';
    $('#c-join', body).onclick = () => joinCommunity();
    return;
  }
  let members = (await kv.get('members')) || [];
  const me = await myPid();
  const paint = (entries, stale) => {
    const solo = soloNow;
    const people = [...new Set(entries.map((e) => e.who).filter(Boolean))].sort();
    const names = [...new Set(members.map((m) => m.who).filter(Boolean))];
    const list = whoFilter ? entries.filter((e) => e.who === whoFilter) : entries;
    const crew = members.filter((m) => m.who).sort((a, b) => (b.lieux || 0) - (a.lieux || 0) || a.who.localeCompare(b.who));
    const mineSet = myDoneSlugs();
    const crewHtml = crew.map((m) => {
      const g = gradeOf(m.lieux || 0), self = me && m.pid === me;
      const common = self ? 0 : faitsOf(m).filter((k) => mineSet.has(k)).length;
      const tag = self ? '<em class="mate-me">toi</em>' : common ? `<em class="mate-common">${common} lieu${common > 1 ? 'x' : ''} en commun</em>` : '';
      return `<button type="button" class="mate" data-pid="${esc(m.pid || '')}" data-who="${esc(m.who)}">${dodoSvg(g.dodo, 42)}<span><b>${esc(m.who)}</b><small>${esc(m.grade || g.name)} · ${m.lieux || 0} lieu${(m.lieux || 0) > 1 ? 'x' : ''}</small>${tag}</span><i class="mate-go">›</i></button>`;
    }).join('');
    body.innerHTML = `${stale ? `<p class="note" style="margin-bottom:10px">${esc(stale)}</p>` : ''}<div class="crew-count"><b>${crew.length}</b> membre${crew.length > 1 ? 's' : ''} dans la communauté</div>${crew.length ? `<div class="crew">${crewHtml}</div>` : ''}
      <div class="checks" style="margin-bottom:12px"><button type="button" class="chip${whoFilter ? '' : ' on'}" data-w="">Tout le monde</button>${people.map((w) => `<button type="button" class="chip${whoFilter === w ? ' on' : ''}" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>
      ${list.map((e, i) => `<div class="card" data-i="${i}"><h3>${lvDot(e.level)}${esc(e.placeName)}</h3>
        <p class="meta"><span class="who">${esc(e.who || '?')}</span>${frDate(e.date)}${e.rating ? ', note ' + e.rating + '/5' : ''}</p>${numsLine(e)}${e.note ? `<p style="margin-top:6px;font-size:.92rem">${esc(e.note)}</p>` : ''}
        ${e.lat != null ? '<div class="row"><button type="button" class="btn small" data-a="map">Voir sur la carte</button></div>' : ''}</div>`).join('') || '<div class="empty"><b>Rien de partagé pour l\'instant</b>La première rando partagée apparaîtra ici.</div>'}
      ${solo ? `<p class="solo-count">+ ${solo} utilisateur${solo > 1 ? 's' : ''} ne souhaitant pas faire partie de la communauté</p>` : ''}`;
    body.querySelectorAll('[data-w]').forEach((b) => { b.onclick = () => { whoFilter = b.dataset.w; paint(entries, stale); }; });
    body.querySelectorAll('.mate').forEach((b) => { b.onclick = () => openProfile(crew.find((m) => (m.pid || '') === b.dataset.pid && m.who === b.dataset.who), entries, me); });
    body.querySelectorAll('[data-a=map]').forEach((b) => {
      b.onclick = () => { const e = list[+b.closest('.card').dataset.i]; goTab('carte'); openPlace({ id: 'g' + e.id, name: e.placeName, type: 'lieu', lat: e.lat, lon: e.lon, score: 0 }); };
    });
  };
  let soloNow = await kv.get('soloCount');
  const cached = await kv.get('community');
  if (cached) paint(cached.entries, ''); else body.innerHTML = '<div class="loading"><span class="spin"></span>Chargement des randos du groupe</div>';
  try { const fresh = await loadCommunity(); members = (await kv.get('members')) || []; soloNow = await kv.get('soloCount'); paint(fresh, ''); } catch (err) {
    if (histTab !== 'groupe') return;
    if (cached) paint(cached.entries, 'Liste non actualisée, le groupe est injoignable (' + err.message + ').');
    else body.innerHTML = `<div class="empty"><b>Le groupe est injoignable</b>${esc(err.message)}. Vérifie le réseau et l'adresse du groupe dans Réglages.</div>`;
  }
}

const SITE_BY_SLUG = new Map(SITES.map((x) => [slugOf(x.name), x]));
const faitsOf = (m) => String(m.faits || '').split(',').map((k) => k.trim()).filter((k) => SITE_BY_SLUG.has(k));
const myDoneSlugs = () => new Set(SITES.filter((p) => store.isDone(p)).map((p) => slugOf(p.name)));

// Lieux d'un membre, rangés dans les mêmes catégories que la recherche, avec les lieux en commun en vert.
function placesByGroup(places, common) {
  const html = GROUPS.map((g) => {
    const list = places.filter((p) => g.types.includes(p.type));
    if (!list.length) return '';
    const c = (TYPES[g.types[0]] || TYPES.lieu).color;
    return `<div class="pf-group" style="--c:${c}"><div class="pf-gh"><span class="ic">${glyph(g.icon)}</span><b>${esc(g.label)}</b><small>${list.length}</small></div>
      <div class="pf-pills">${list.map((p) => `<span class="pf-pill${common.has(slugOf(p.name)) ? ' common' : ''}">${common.has(slugOf(p.name)) ? '✓ ' : ''}${esc(p.name)}</span>`).join('')}</div></div>`;
  }).join('');
  const rest = places.filter((p) => !GROUPS.some((g) => g.types.includes(p.type)));
  return html + (rest.length ? `<div class="pf-group" style="--c:${TYPES.lieu.color}"><div class="pf-gh"><span class="ic">${glyph('lieu')}</span><b>Autres lieux</b><small>${rest.length}</small></div><div class="pf-pills">${rest.map((p) => `<span class="pf-pill${common.has(slugOf(p.name)) ? ' common' : ''}">${esc(p.name)}</span>`).join('')}</div></div>` : '');
}

// Profil d'un membre : progression par secteur, randos partagées, lieux faits (en commun en vert).
function openProfile(m, entries, me) {
  if (!m) return;
  const g = gradeOf(m.lieux || 0), self = me && m.pid === me;
  const mine = entries.filter((e) => (m.pid && e.pid ? e.pid === m.pid : e.who === m.who));
  const places = faitsOf(m).map((k) => SITE_BY_SLUG.get(k)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const mySet = self ? new Set() : myDoneSlugs();
  const common = new Set(places.map((p) => slugOf(p.name)).filter((k) => mySet.has(k)));
  const km = mine.reduce((s2, e) => s2 + (Number(e.km) || 0), 0);
  const sectors = SECTORS.map((sec) => {
    const total = SITES.filter((p) => sectorOf(p) === sec.id).length;
    const done = places.filter((p) => sectorOf(p) === sec.id).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `<div class="pf-sec"><span>${esc(sec.name)}</span><div class="pf-bar"><i style="width:${Math.max(pct, done ? 3 : 0)}%"></i></div><b>${pct} %</b></div>`;
  }).join('');
  const box = openModal(`<div class="profile"><div class="pf-head">${dodoSvg(g.dodo, 76)}<div><h2>${esc(m.who)}${self ? ' <small class="mate-me">toi</small>' : ''}</h2><p class="meta">${esc(m.grade || g.name)}${m.since ? ', membre depuis le ' + frDate(m.since) : ''}</p></div></div>
    <div class="pf-secs"><h3>Exploré</h3>${sectors}</div>
    <div class="totals"><div><b>${m.lieux || 0}</b><span>lieu${(m.lieux || 0) > 1 ? 'x' : ''} fait${(m.lieux || 0) > 1 ? 's' : ''}</span></div><div><b>${mine.length}</b><span>rando${mine.length > 1 ? 's' : ''}</span></div><div><b>${Math.round(km)}</b><span>km</span></div></div>
    <h3>Ses randos</h3>
    ${mine.map((e, i) => `<div class="pf-row" data-i="${i}"><b>${lvDot(e.level)}${esc(e.placeName)}</b><small>${frDate(e.date)}${e.km ? ', ' + String(Math.round(e.km * 10) / 10).replace('.', ',') + ' km' : ''}${e.rating ? ', ' + e.rating + '/5' : ''}</small>${e.note ? `<p>${esc(e.note)}</p>` : ''}${e.lat != null ? '<button type="button" class="btn small" data-a="map">Voir sur la carte</button>' : ''}</div>`).join('') || '<p class="meta">Aucune rando partagée pour l\'instant.</p>'}
    ${places.length ? `<h3>Ses lieux cochés</h3>${common.size ? `<p class="pf-legend"><span class="pf-pill common">✓ en vert</span> ${common.size} lieu${common.size > 1 ? 'x' : ''} que tu as fait${common.size > 1 ? 's' : ''} aussi</p>` : ''}${placesByGroup(places, common)}` : ''}
    <div class="foot"><button type="button" class="btn main" id="pf-close">Fermer</button></div></div>`);
  box.classList.add('tall');
  $('#pf-close', box).onclick = closeModal;
  box.querySelectorAll('[data-a=map]').forEach((b) => {
    b.onclick = () => { const e = mine[+b.closest('.pf-row').dataset.i]; closeModal(); goTab('carte'); openPlace({ id: 'g' + e.id, name: e.placeName, type: 'lieu', lat: e.lat, lon: e.lon, score: 0 }); };
  });
}

function renderSettings() {
  const p = page();
  p.innerHTML = `<h2>Réglages</h2>
    <div class="card"><h3>Visite guidée</h3><p class="meta">Le petit tour de l'appli du premier lancement, avec Didou le dodo.</p>
      <div class="row"><button type="button" class="btn small main" id="s-tuto">Rejouer le tutoriel</button></div></div>
    <div class="card"><h3>Un souci, une idée ?</h3><p class="meta">Un bug, un lieu à ajouter, une remarque : ton message arrive directement à Dorian.</p>
      <label class="field"><textarea id="s-fb" rows="3" maxlength="2000" placeholder="Ce qui ne marche pas, ou ce qui manque"></textarea></label>
      <div class="row"><button type="button" class="btn small main" id="s-fb-send">Envoyer</button></div></div>
    <div class="card"><h3>Faire découvrir Randodo</h3><p class="meta">Envoie le lien de l'appli à tes amis.</p>
      <div class="row"><button type="button" class="btn small main" id="s-share">Partager Randodo</button></div></div>
    <div class="card"><h3>Communauté</h3><p class="meta">${communityChoice() === 'oui' ? 'Tu fais partie de la communauté : tes randos et tes lieux cochés sont visibles par les autres membres.' : 'Tu randonnes en solo : ni ton prénom ni tes sorties ne quittent ton téléphone. En rejoignant la communauté, tes randos et tes lieux cochés sont partagés, et tu vois ceux des autres.'}</p>
      <div class="row">${communityChoice() === 'oui' ? '<button type="button" class="btn small" id="s-leave">Quitter la communauté</button>' : '<button type="button" class="btn small main" id="s-join">Rejoindre la communauté</button>'}</div>
      <label class="field"><span>Mon prénom</span><input type="text" id="s-pseudo" value="${esc(settings.get('pseudo', ''))}" placeholder="Affiché à côté de tes randos" maxlength="24"></label>
      <details class="adv"><summary>Adresse du groupe (avancé)</summary>
      <label class="field"><input type="url" id="s-url" value="${esc(settings.get('communityUrl', '') || CONFIG.communityUrl)}" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocorrect="off"></label>
      <div class="row"><button type="button" class="btn small" id="s-test">Vérifier que le groupe répond</button></div></details></div>
    <div class="card"><h3>Liens vers les plateformes</h3>
      <label class="switch" style="margin-top:6px"><span>Liens directs Komoot et AllTrails</span><input type="checkbox" id="s-direct"${settings.get('directLinks', true) ? ' checked' : ''}></label>
      <p class="meta" style="margin-top:6px">Si un lien direct n'ouvre pas la bonne page, décoche : les boutons lanceront une recherche web limitée au site.</p></div>
    <div class="card"><h3>Carte IGN au 1:25 000</h3><p class="meta">La carte de randonnée de l'IGN est en accès restreint. Si tu disposes d'une clé d'accès Géoplateforme, colle-la ici : le fond « IGN 1:25 000 » s'ajoute au choix des cartes.</p>
      <label class="field"><input type="text" id="s-ign" value="${esc(settings.get('ignScanKey', '') || CONFIG.ignScanKey)}" placeholder="Clé d'accès" autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>
    <div class="card"><h3>Sauvegarde</h3><p class="meta">Historique, envies et traces dans un seul fichier, pour changer de téléphone ou garder une copie.</p>
      <div class="row"><button type="button" class="btn small" id="s-export">Exporter</button><button type="button" class="btn small" id="s-import">Importer</button></div><input type="file" id="s-file" accept=".json,application/json" hidden></div>
    <div class="card"><h3>Diagnostic</h3><p class="meta">Vérifie en conditions réelles que chaque service répond.</p>
      <div class="row"><button type="button" class="btn small main" id="s-diag">Lancer le diagnostic</button><button type="button" class="btn small" id="s-demo">Démonstration du guidage</button></div><ul class="diag" id="diag" style="margin-top:8px"></ul></div>
    <div class="card"><h3>Sources</h3><p class="meta">Lieux, sentiers, balisage et tracés : © contributeurs OpenStreetMap (ODbL). Altitudes : Copernicus DEM GLO-30 (© DLR, © Airbus, fourni par l'Union européenne et l'ESA). Occupation du sol : © ESA WorldCover 2021 (CC BY 4.0). Météo : Open-Meteo.com (CC BY 4.0). Photos : Wikimedia Commons et Wikipédia. Recherche de lieux : Photon. Temps de route : OSRM. Les « Circuits balisés » sont des itinéraires officiels, tels qu'ils sont enregistrés dans OpenStreetMap. Les « Boucles » sont assemblées par l'appli sur de vrais sentiers cartographiés, en privilégiant les chemins balisés ou bien décrits ; un bout de sentier peu décrit apparaît en pointillés orange. Ni l'un ni l'autre ne remplace ton jugement sur le terrain.</p>
      <p class="meta" style="margin-top:8px"><a href="mentions.html">Mentions légales et confidentialité</a></p>
      <p class="meta" style="margin-top:8px">Randodo ${VERSION}</p></div>
    <p class="signature">Le dodo ne vole pas. Il marche. Et toi ?<br>Par Dorian Lichtenauer</p>`;
  $('#s-share', p).onclick = () => shareApp();
  $('#s-fb-send', p).onclick = async () => {
    const t = $('#s-fb', p).value.trim();
    if (t.length < 3) { toast('Écris quelques mots d\'abord.'); return; }
    const info = { message: t, who: settings.get('pseudo', ''), version: VERSION, screen: 'réglages', device: navigator.userAgent.slice(0, 200) };
    if (!groupAddress()) { location.href = 'mailto:?subject=' + encodeURIComponent('Randodo ' + VERSION) + '&body=' + encodeURIComponent(t); return; }
    try { await post({ action: 'feedback', owner: deviceKey(), ...info }); $('#s-fb', p).value = ''; toast('Merci ! Message bien envoyé.'); }
    catch (err) { toast('Envoi impossible : ' + err.message, 5000); }
  };
  $('#s-tuto', p).onclick = () => startTour();
  if ($('#s-join', p)) $('#s-join', p).onclick = () => joinCommunity();
  if ($('#s-leave', p)) $('#s-leave', p).onclick = () => { if (confirm('Quitter la communauté ? Tes randos partagées et ta progression seront retirées du groupe. Rien n\'est effacé sur ton téléphone.')) leaveCommunity(); };
  $('#s-pseudo', p).oninput = (e) => markField(e.target, '');
  $('#s-pseudo', p).onchange = async (e) => {
    const n = e.target.value.trim();
    if (n.length < 2) { markField(e.target, 'Écris au moins deux lettres.'); return; }
    if (communityChoice() === 'oui' && await nameTaken(n)) { markField(e.target, TAKEN); return; }
    settings.set('pseudo', n); settings.set('joined', ''); register(); toast('Prénom enregistré.');
  };
  $('#s-url', p).onchange = (e) => { settings.set('communityUrl', e.target.value.trim()); register(); };
  $('#s-ign', p).onchange = (e) => { settings.set('ignScanKey', e.target.value.trim()); toast(e.target.value.trim() ? 'Clé enregistrée : le fond « IGN 1:25 000 » est disponible sur la carte.' : 'Clé retirée.'); };
  $('#s-direct', p).onchange = (e) => settings.set('directLinks', e.target.checked);
  $('#s-test', p).onclick = async () => {
    settings.set('communityUrl', $('#s-url', p).value.trim());
    if (!groupAddress()) { toast('Colle d\'abord l\'adresse du groupe.'); return; }
    if (!communityUrl()) { toast('Rejoins d\'abord la communauté.'); return; }
    try { const n = (await loadCommunity()).length; register(); toast(`Le groupe répond : ${n} rando${n > 1 ? 's' : ''} partagée${n > 1 ? 's' : ''}.`); } catch (err) { toast('Le groupe ne répond pas : ' + err.message, 5000); }
  };
  $('#s-export', p).onclick = async () => {
    const blob = new Blob([await store.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'randodo-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('#s-import', p).onclick = () => $('#s-file', p).click();
  $('#s-file', p).onchange = async (e) => {
    try { const r = await store.importAll(await e.target.files[0].text()); toast(`Sauvegarde importée : ${r.log} randos, ${r.hikes} traces.`); } catch (err) { toast(err.message, 5000); }
  };
  $('#s-diag', p).onclick = () => runDiag($('#diag', p));
  $('#s-demo', p).onclick = () => {
    const h = store.hikes[0];
    if (!h) { toast('Garde d\'abord une trace hors ligne : la démonstration la parcourt.', 4500); return; }
    goTab('carte'); startGuide(h, { sim: true });
  };
}

// ---------- Diagnostic ----------
async function runDiag(ul) {
  const rows = [];
  const add = (label) => { const r = { label, state: '', detail: 'en cours' }; rows.push(r); paint(); return r; };
  const paint = () => {
    ul.innerHTML = rows.map((r) => `<li><i class="${r.state}"></i><span>${esc(r.label)}</span><span class="d">${esc(r.detail)}</span></li>`).join('')
      + (rows.every((r) => r.state) ? '<li style="border:0"><button type="button" class="btn small" id="d-copy">Copier le rapport</button></li>' : '');
    const c = document.getElementById('d-copy');
    if (c) c.onclick = async () => {
      const txt = 'Randodo ' + VERSION + ' — diagnostic du ' + new Date().toLocaleString('fr-FR') + '\n' + rows.map((r) => (r.state === 'ok' ? 'OK  ' : 'KO  ') + r.label + ' : ' + r.detail).join('\n') + '\n' + navigator.userAgent;
      try { await navigator.clipboard.writeText(txt); toast('Rapport copié.'); } catch { prompt('Copie ce rapport :', txt); }
    };
  };
  const run = async (label, fn) => {
    const r = add(label), t0 = performance.now();
    try { const d = await fn(); r.state = 'ok'; r.detail = (d ? d + ', ' : '') + Math.round(performance.now() - t0) + ' ms'; } catch (err) { r.state = 'ko'; r.detail = String(err && err.message || err).slice(0, 80); }
    paint();
  };
  const img = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(); i.onerror = () => ko(new Error('image refusée')); i.src = src; setTimeout(() => ko(new Error('délai dépassé')), 12000); });
  await run('Écran', async () => {
    const st = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe), ins = parseInt(cs.paddingTop) + '/' + parseInt(cs.paddingBottom);
    probe.remove();
    const meta = (document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]') || {}).content;
    return `${st ? 'installée' : 'navigateur'}, fenêtre ${innerHeight}/${screen.height} px, marges ${ins}, barre ${meta}`;
  });
  for (const url of CONFIG.overpass) {
    await run('Sentiers et lieux : ' + new URL(url).host, async () => {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: 'data=' + encodeURIComponent('[out:json][timeout:15];node["natural"="peak"]["name"](48.02,7.00,48.05,7.04);out 3;') });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return ((await res.json()).elements || []).length + ' sommets';
    });
  }
  await run('Altitudes (Open-Meteo)', async () => { const j = await fetchJson(CONFIG.elevation + '?latitude=48.0375&longitude=7.0178', {}, 12000); return Math.round(j.elevation[0]) + ' m au Hohneck'; });
  await run('Temps de route (OSRM)', async () => { const j = await fetchJson(CONFIG.osrm + '7.7521,48.5734;7.0178,48.0375?sources=0&annotations=duration', {}, 12000); if (j.code !== 'Ok') throw new Error('réponse inattendue'); return Math.round(j.durations[0][1] / 60) + ' min de Strasbourg au Hohneck'; });
  await run('Recherche de lieux (Photon)', async () => { const j = await fetchJson(CONFIG.photon + '?q=Hohneck&limit=1&lang=fr', {}, 12000); return (j.features || []).length ? 'trouvé' : 'aucun résultat'; });
  await run('Photos (Wikipédia)', async () => {
    const j = await fetchJson(CONFIG.wikipedia + '?action=query&generator=geosearch&ggscoord=48.0375%7C7.0178&ggsradius=1500&ggslimit=5&prop=pageimages&piprop=thumbnail&pithumbsize=200&format=json&origin=*', {}, 12000);
    return Object.keys((j.query && j.query.pages) || {}).length + ' articles';
  });
  await run('Photos (Wikidata)', async () => {
    const j = await fetchJson(CONFIG.wikidataSparql + '?format=json&query=' + encodeURIComponent('SELECT ?img WHERE { wd:Q64 wdt:P18 ?img }'), { headers: { Accept: 'application/sparql-results+json' } }, 12000);
    return j.results.bindings.length ? 'image trouvée' : 'aucune image';
  });
  const key = (settings.get('ignScanKey', '') || CONFIG.ignScanKey || '').trim();
  for (const t of CONFIG.tiles) {
    if (t.needsKey && !key) continue;
    const [z, x, y] = t.probe || [10, 532, 355];
    const u = t.url.replace('{key}', encodeURIComponent(key)).replace('{s}', 'a').replace('{z}', z).replace('{x}', x).replace('{y}', y);
    await run('Fond de carte : ' + t.label, () => img(u + (u.includes('?') ? '&' : '?') + 'd=' + Date.now()).then(() => ''));
  }
  if (CONFIG.trailsOverlay) await run('Itinéraires balisés (surcouche)', () => img(CONFIG.trailsOverlay.replace('{z}', 10).replace('{x}', 532).replace('{y}', 355) + '?d=' + Date.now()).then(() => ''));
  await run('Stockage sur le téléphone', async () => {
    await kv.set('diag', 1); if ((await kv.get('diag')) !== 1) throw new Error('lecture impossible');
    const persisted = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false;
    return persisted ? 'durable' : 'ordinaire';
  });
  await run('Mode hors ligne', async () => { if (!('serviceWorker' in navigator)) throw new Error('non pris en charge'); const reg = await navigator.serviceWorker.getRegistration(); if (!reg) throw new Error('pas encore installé, recharge la page'); return navigator.serviceWorker.controller ? 'actif' : 'actif au prochain lancement'; });
  await run('Partage de fichier GPX', async () => { const f = new File(['x'], 'a.gpx', { type: 'application/gpx+xml' }); if (!(navigator.canShare && navigator.canShare({ files: [f] }))) throw new Error('indisponible ici, la trace sera téléchargée'); return 'feuille de partage disponible'; });
  await run('Localisation', async () => {
    if (!('geolocation' in navigator)) throw new Error('indisponible');
    if (navigator.permissions) { try { const s = await navigator.permissions.query({ name: 'geolocation' }); return s.state === 'granted' ? 'autorisée' : s.state === 'denied' ? 'refusée dans les réglages' : 'sera demandée au premier guidage'; } catch { /* ci-dessous */ } }
    return 'sera demandée au premier guidage';
  });
  if (communityUrl()) await run('Groupe', async () => (await loadCommunity()).length + ' randos partagées');
  if (overpassState.last) rows.push({ label: 'Serveur de données utilisé', state: 'ok', detail: new URL(overpassState.last, location.href).host });
  paint();
}
