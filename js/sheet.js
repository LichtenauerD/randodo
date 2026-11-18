// Fiche d'un lieu et fiche d'une randonnée (feuille basse).
import { weatherHtml, bindWeather } from './weather.js';
import { CONFIG, TYPES } from './config.js';
import { hikesFor, loadCircuit, ensureCorridor } from './hikes.js';
import { imageOf } from './places.js';
import { store, want, fits, wantActive, bus } from './state.js';
import { showTrace, clearTrace, glyph, focus, map } from './map.js';
import { shareGpx } from './gpx.js';
import { startGuide } from './guide.js';
import { openLogForm } from './pages.js';
import { esc, fmtKm, fmtDur, toast, settings } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const el = () => document.getElementById('sheet');
let current = { place: null, data: null, hike: null, more: false, back: null };
let token = 0;

const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const IC = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.500-7 10-7 10z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  go: '<svg viewBox="0 0 24 24"><path d="M12 3l7 18-7-4-7 4 7-18z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>',
};
const LV = { facile: 'Facile', moyenne: 'Moyenne', difficile: 'Difficile' };

function frame(inner) {
  const s = el();
  s.classList.remove('half');
  s.innerHTML = `<div class="grip" role="button" aria-label="Réduire ou agrandir la fiche"></div><button class="close" type="button" aria-label="Fermer">${X}</button><div class="body">${inner}</div>`;
  s.hidden = false;
  $('.close', s).onclick = closeSheet;
  $('.grip', s).onclick = () => s.classList.toggle('peek');
  document.getElementById('fabs').style.transform = 'translateY(-9999px)';
}

export function closeSheet() {
  token++;
  const s = el();
  s.hidden = true; s.classList.remove('peek', 'half');
  s.innerHTML = '';
  clearTrace();
  current = { place: null, data: null, hike: null, more: false, back: null };
  document.getElementById('fabs').style.transform = '';
  bus.emit('sheet', false);
}

function nums(h) {
  return `<span>${fmtKm(h.meters)}</span><span>${h.up === null ? '—' : h.up + ' m'}<small>montée</small></span><span>${fmtDur(h.minutes)}</span>`;
}
function signHtml(h, extra = '') {
  const kind = h.source === 'balise' ? 'Circuit balisé' : h.source === 'import' ? 'Trace importée' : h.kind === 'boucle' ? 'Boucle' : 'Aller-retour';
  const off = wantActive() && !fits(h) ? ' off' : '';
  return `<button type="button" class="sign ${h.level}${off}${extra}" data-hike="${h.id}">
    <span class="blaze"><i></i></span>
    <span class="txt"><span class="lv">${LV[h.level]} · ${kind}</span><span class="ttl">${esc(h.title)}</span><span class="nums">${nums(h)}</span></span>
  </button>`;
}

function headHtml(p) {
  const img = imageOf(p);
  const t = TYPES[p.type] || TYPES.lieu;
  const meta = [t.one, p.ele ? p.ele + ' m' : '', p.massif || p.where || ''].filter(Boolean).join(', ');
  const done = store.doneEntry(p);
  return `<div class="place-head">
    <div class="photo" style="${img ? `background-image:url('${img.replace(/'/g, '%27')}')` : `color:${t.color}`}">${img ? '' : glyph(p.type)}</div>
    <div><h2>${esc(p.name)}</h2><p class="meta">${esc(meta)}</p>${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}${p.local && p.local.credit ? `<p class="credit">Photo : ${p.local.url ? `<a href="${esc(p.local.url)}" target="_blank" rel="noopener">${esc(p.local.credit)}</a>` : esc(p.local.credit)}</p>` : ''}</div>
  </div>
  <div class="quick">
    <button type="button" class="chip heart${store.isWished(p) ? ' on' : ''}" id="q-wish">${IC.heart}${store.isWished(p) ? 'Dans mes envies' : 'Ajouter à mes envies'}</button>
    <button type="button" class="chip${done ? ' on' : ''}" id="q-done">${IC.check}${done ? 'Faite le ' + frDate(done.date) : 'Déjà faite'}</button>
  </div>`;
}
export const frDate = (iso) => { const [y, m, d] = (iso || '').split('-'); return d ? `${d}/${m}/${y}` : iso || ''; };

function fill(tpl, p) {
  const dLat = 0.035, dLon = 0.05;
  return tpl.replace('{q}', encodeURIComponent(p.adhoc ? 'Lieu' : p.name))
    .replace('{lat}', p.lat.toFixed(5)).replace('{lon}', p.lon.toFixed(5))
    .replace('{s}', (p.lat - dLat).toFixed(4)).replace('{n}', (p.lat + dLat).toFixed(4))
    .replace('{w}', (p.lon - dLon).toFixed(4)).replace('{e}', (p.lon + dLon).toFixed(4));
}
function inSwitzerland(p) {
  if (p.country) return p.country === 'CH';
  return p.lat > 45.8 && p.lat < 47.81 && p.lon > 5.95 && p.lon < 10.5 && !(p.lat > 47.6 && p.lon < 7.5);
}
function linksHtml(p) {
  const direct = settings.get('directLinks', true);
  const out = [];
  for (const pf of CONFIG.platforms) {
    if (pf.onlyCH && !inSwitzerland(p)) continue;
    const tpl = (direct && pf.direct) || (p.adhoc ? pf.direct : pf.web) || pf.direct;
    if (!tpl) continue;
    out.push(`<a href="${esc(fill(tpl, p))}" target="_blank" rel="noopener"${pf.main ? ' class="main"' : ''}>${pf.label}</a>`);
  }
  return `<div class="links">${out.join('')}</div>`;
}

const COL = { red: '#d9342b', blue: '#1f62b0', yellow: '#f5c400', green: '#2e8b57', white: '#ffffff', black: '#151515', orange: '#f08a24', brown: '#7a4b2a', purple: '#7b3fa0', gray: '#8a8f8c', grey: '#8a8f8c' };
export function symHtml(symbol) {
  const parts = (symbol || '').split(':');
  if (parts.length < 2) return '<span class="sym"></span>';
  const bg = COL[(parts[1] || 'white').split('_')[0]] || '#fff';
  const [fc, ...shapeParts] = (parts[2] || '').split('_');
  const color = COL[fc] || COL[parts[0]] || '#888';
  const shape = shapeParts.join('_');
  let st = `width:12px;height:12px;background:${color}`;
  if (shape === 'bar' || shape === 'rectangle' || shape === 'lower' || shape === 'upper') st = `width:20px;height:9px;background:${color}`;
  else if (shape === 'stripe') st = `width:8px;height:18px;background:${color}`;
  else if (shape === 'dot') st = `width:12px;height:12px;border-radius:50%;background:${color}`;
  else if (shape === 'circle') st = `width:14px;height:14px;border-radius:50%;border:3.5px solid ${color}`;
  else if (shape === 'triangle') st = `width:16px;height:14px;background:${color};clip-path:polygon(50% 0,100% 100%,0 100%)`;
  else if (shape === 'diamond') st = `width:13px;height:13px;background:${color};transform:rotate(45deg) scale(.85)`;
  else if (shape === 'cross') st = `width:16px;height:16px;background:${color};clip-path:polygon(38% 0,62% 0,62% 38%,100% 38%,100% 62%,62% 62%,62% 100%,38% 100%,38% 62%,0 62%,0 38%,38% 38%)`;
  else if (shape === 'x') st = `width:16px;height:16px;background:${color};clip-path:polygon(15% 0,50% 35%,85% 0,100% 15%,65% 50%,100% 85%,85% 100%,50% 65%,15% 100%,0 85%,35% 50%,0 15%)`;
  return `<span class="sym" style="background:${bg}"><i style="${st}"></i></span>`;
}

// ---------- Fiche d'un lieu ----------
export async function openPlace(place, opts = {}) {
  const my = ++token;
  current = { place, data: null, hike: null, more: false, back: null };
  bus.emit('sheet', true);
  frame(headHtml(place) + `<div class="section"><h3>Randonnées</h3><div id="hikes"><div class="loading"><span class="spin"></span><span id="step">Préparation</span></div><p class="note" id="slowhint" hidden>Les serveurs gratuits de sentiers sont chargés en ce moment : ça arrive. Les lieux de la sélection, cerclés de jaune sur la carte, s'ouvrent tout de suite.</p></div></div>
    <div class="section"><h3>Sur les plateformes</h3>${linksHtml(place)}<p class="note" style="margin-top:8px">Pour lire les avis, les photos et les variantes de la communauté.</p></div>`);
  bindHead(place);
  if (opts.focus !== false) focus(place.lat, place.lon, Math.max(map.getZoom(), 13), 120);
  // Compteur de secondes pendant le calcul, et un mot d'explication s'il traîne.
  const t0 = Date.now(); let stepText = 'Préparation';
  const tick = setInterval(() => {
    if (my !== token || !$('#step')) return clearInterval(tick);
    const s = Math.round((Date.now() - t0) / 1000);
    $('#step').textContent = stepText + (s >= 3 ? ` · ${s} s` : '');
    if (s >= 12 && $('#slowhint')) $('#slowhint').hidden = false;
  }, 1000);
  try {
    const data = await hikesFor(place, (s) => { stepText = s; if (my === token && $('#step')) $('#step').textContent = s; }, opts.force);
    clearInterval(tick);
    if (my !== token) return;
    current.data = data;
    renderHikes();
  } catch (err) {
    clearInterval(tick);
    if (my !== token) return;
    $('#hikes').innerHTML = `<div class="sign-empty">${esc(err.message)}. Vérifie le réseau puis réessaie.</div><button type="button" class="more" id="retry">Réessayer</button>`;
    $('#retry').onclick = () => openPlace(place, { focus: false, force: true });
  }
}

function bindHead(place) {
  $('#q-wish').onclick = async () => { await store.toggleWish(place); refreshHead(); };
  $('#q-done').onclick = () => openLogForm({ place, onSaved: refreshHead });
}
function refreshHead() {
  if (!current.place || current.hike) return;
  const body = $('.body', el());
  const tmp = document.createElement('div');
  tmp.innerHTML = headHtml(current.place);
  body.querySelector('.place-head').replaceWith(tmp.querySelector('.place-head'));
  body.querySelector('.quick').replaceWith(tmp.querySelector('.quick'));
  bindHead(current.place);
}

function renderHikes() {
  const { data, place } = current;
  const box = $('#hikes');
  if (!box) return;
  if (!data.hikes.length) {
    box.innerHTML = `<div class="sign-empty">${esc(data.reason)}</div>`;
  } else {
    const firsts = [], rest = [];
    const html = CONFIG.levels.map((l) => {
      const list = data.hikes.filter((h) => h.level === l.id);
      // À niveau égal, on met en avant la proposition qui colle à l'envie du jour.
      const pick = list.find((h) => fits(h)) || list[0];
      if (!pick) return `<div class="sign-empty">Pas de proposition ${l.label.toLowerCase()} autour de ce lieu.</div>`;
      firsts.push(pick.id);
      rest.push(...list.filter((h) => h !== pick));
      return signHtml(pick);
    }).join('');
    const more = rest.length ? (current.more
      ? `<div class="signs" style="margin-top:10px">${rest.map((h) => signHtml(h)).join('')}</div>`
      : `<button type="button" class="more" id="more">${rest.length > 1 ? `Voir les ${rest.length} autres propositions` : 'Voir l\'autre proposition'}</button>`) : '';
    const hidden = wantActive() && data.hikes.every((h) => !fits(h)) ? '<p class="note" style="margin-bottom:8px">Aucune proposition ne correspond à ton envie du jour. Les voici quand même, en grisé.</p>' : '';
    box.innerHTML = hidden + `<div class="signs">${html}</div>${more}`;
  }
  const way = [];
  if (data.partial.length || data.passing.length) {
    const rows = data.partial.map((p) => `<li>${symHtml(p.symbol)}<span>${esc(p.name)}</span><button type="button" data-rel="${p.id}">Charger ce circuit</button></li>`)
      .concat(data.passing.filter((p) => !data.partial.some((q) => q.id === p.id)).map((p) => `<li>${symHtml(p.symbol)}<span>${esc(p.name)}</span></li>`));
    way.push(`<div class="section" id="waysec"><h3>Balisage sur place</h3><ul class="waymarks">${rows.join('')}</ul></div>`);
  }
  const foot = `<p class="note" style="margin-top:16px">Tracés calculés sur les sentiers d'OpenStreetMap, dénivelé approché${data.noEle ? ' (altitudes indisponibles pour certaines propositions)' : ''}. <button type="button" class="more" id="recalc" style="margin:0;font-size:inherit">Recalculer</button></p>`;
  const old = document.getElementById('waysec'); if (old) old.remove();
  const oldFoot = document.getElementById('foot'); if (oldFoot) oldFoot.remove();
  $('.body', el()).insertAdjacentHTML('beforeend', way.join('') + `<div id="foot">${foot}</div>`);
  box.querySelectorAll('[data-hike]').forEach((b) => { b.onclick = () => openHike(data.hikes.find((h) => h.id === b.dataset.hike), { place }); });
  if ($('#more')) $('#more').onclick = () => { current.more = true; renderHikes(); };
  $('#recalc').onclick = () => openPlace(place, { focus: false, force: true });
  document.querySelectorAll('#waysec [data-rel]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Chargement';
      try {
        const meta = data.partial.find((p) => String(p.id) === b.dataset.rel);
        const h = await loadCircuit(meta, place);
        data.hikes.push(h);
        openHike(h, { place });
      } catch (err) { toast(err.message, 5000); b.disabled = false; b.textContent = 'Charger ce circuit'; }
    };
  });
}

// ---------- Fiche d'une randonnée ----------
export function profileSvg(prof) {
  if (!prof || prof.length < 3) return '';
  const W = 320, H = 74, total = prof[prof.length - 1][0] || 1;
  let lo = Infinity, hi = -Infinity;
  for (const [, e] of prof) { if (e < lo) lo = e; if (e > hi) hi = e; }
  const span = Math.max(hi - lo, 40);
  const x = (d) => (d / total) * W, y = (e) => H - 14 - ((e - lo) / span) * (H - 26);
  const line = prof.map(([d, e], i) => (i ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(e).toFixed(1)).join('');
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Profil altimétrique, de ${Math.round(lo)} à ${Math.round(hi)} mètres">
    <path d="${line}L${W} ${H}L0 ${H}Z" fill="rgba(47,107,79,.18)" stroke="none"/><path d="${line}" stroke="#2f6b4f" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg><p class="note" style="display:flex;justify-content:space-between"><span>Point bas ${Math.round(lo)} m</span><span>Point haut ${Math.round(hi)} m</span></p>`;
}

export function warnsOf(h) {
  const w = [];
  if (h.alpine) w.push('Passage de niveau alpin sur le tracé : réservé aux randonneurs expérimentés et équipés.');
  else if (h.demanding) w.push('Passage exigeant sur le tracé (pied sûr nécessaire).');
  if (h.road > 0.25) w.push(`Environ ${Math.round(h.road * 100)} % du parcours sur route ou rue.`);
  if (h.source === 'calcul' && h.marked < 0.4) w.push('Peu de sentiers balisés sur ce tracé : garde la trace sous les yeux.');
  if (h.up === null) w.push('Altitudes indisponibles : le niveau est estimé sur la distance seule.');
  if (h.kind === 'itinéraire') w.push('Itinéraire en ligne : prévois le retour depuis l\'arrivée.');
  return w;
}

export function openHike(h, ctx = {}) {
  if (!h) return;
  token++;
  current.hike = h;
  if (ctx.place) current.place = ctx.place;
  bus.emit('sheet', true);
  const saved = store.isSaved(h.id);
  const back = ctx.place ? `<button type="button" class="more" id="back" style="margin:0 0 10px">Retour à ${esc(ctx.place.name)}</button>` : '';
  const warns = warnsOf(h);
  const startTxt = h.start && h.start.kind !== 'balise' && h.start.kind !== 'import'
    ? `<p class="note">Départ : ${esc(h.start.name || (h.start.kind === 'parking' ? 'parking' : h.start.kind === 'gare' ? 'gare' : 'bord de route'))}. <a href="https://www.google.com/maps/dir/?api=1&destination=${h.start.lat.toFixed(5)},${h.start.lon.toFixed(5)}" target="_blank" rel="noopener">Itinéraire jusqu'au départ</a></p>` : '';
  const wmt = h.relId ? `<a class="btn small wide" href="${CONFIG.waymarkedGpx.replace('{id}', h.relId)}" target="_blank" rel="noopener">Fiche officielle du circuit (Waymarked Trails)</a>` : '';
  const site = h.website ? `<a class="btn small wide" href="${esc(h.website)}" target="_blank" rel="noopener">Page officielle du circuit</a>` : '';
  frame(`${back}${signHtml(h, ' sel')}
    <div class="hike-card">
      <div class="facts">
        <div><b>${fmtKm(h.meters)}</b><span>distance</span></div>
        <div><b>${h.up === null ? '—' : h.up + ' m'}</b><span>montée</span></div>
        <div><b>${h.down == null ? '—' : h.down + ' m'}</b><span>descente</span></div>
        <div><b>${fmtDur(h.minutes)}</b><span>de marche</span></div>
      </div>
      ${profileSvg(h.prof)}
      ${weatherHtml()}
      ${startTxt}
      ${warns.length ? `<ul class="warns">${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="actions">
        <button type="button" class="btn go wide" id="a-go">${IC.go}Suivre cette trace</button>
        <button type="button" class="btn main" id="a-gpx">${IC.down}Trace GPX</button>
        <button type="button" class="btn" id="a-save">${IC.save}${saved ? 'Gardée hors ligne' : 'Garder hors ligne'}</button>
        <button type="button" class="btn wide" id="a-done">${IC.check}Je l'ai faite</button>
        ${site}${wmt}
      </div>
    </div>
    <p class="note" style="margin-top:12px">Le bouton « Trace GPX » ouvre le partage de l'iPhone : choisis Organic Maps pour l'y importer.</p>`);
  el().classList.remove('peek');
  el().classList.add('half');
  showTrace(h, { corridor: true, pad: { top: 84, bottom: Math.round((window.innerHeight - 58) * 0.54) + 10 } });
  if ($('#back')) $('#back').onclick = () => { clearTrace(); reopenPlace(); };
  // Jour de rando choisi : gardé en date réelle, ramené à aujourd'hui une fois passé.
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  bindWeather(h, el(), {
    get: () => { const s = settings.get('hikeDay', null); if (!s) return 0; const [y, m, d] = s.split('-').map(Number); return Math.max(0, Math.round((new Date(y, m - 1, d) - today()) / 86400000)); },
    set: (i) => { const d = today(); d.setDate(d.getDate() + i); settings.set('hikeDay', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); },
  });
  $('.sign.sel', el()).onclick = () => el().classList.toggle('peek');
  $('#a-gpx').onclick = async () => {
    const r = await shareGpx(h);
    if (r === 'telechargement') toast('Trace téléchargée : ouvre le fichier avec Organic Maps.');
  };
  // Les sentiers voisins (carte de terrain hors ligne) se chargent en arrière-plan : on n'attend pas les serveurs.
  const corridorLater = () => ensureCorridor(h).then(() => store.saveHike(h)).catch(() => {});
  $('#a-save').onclick = async () => {
    const b = $('#a-save');
    await store.saveHike(h);
    b.innerHTML = IC.save + 'Gardée hors ligne';
    toast('Trace gardée dans l\'onglet Traces, utilisable sans réseau.');
    corridorLater();
  };
  $('#a-go').onclick = async () => {
    await store.saveHike(h);
    startGuide(h);
    corridorLater();
  };
  $('#a-done').onclick = () => openLogForm({ place: ctx.place || h.place, hike: h });
}

function reopenPlace() {
  const p = current.place, data = current.data;
  if (!p) return closeSheet();
  if (!data) return openPlace(p, { focus: false });
  current.hike = null;
  frame(headHtml(p) + `<div class="section"><h3>Randonnées</h3><div id="hikes"></div></div>
    <div class="section"><h3>Sur les plateformes</h3>${linksHtml(p)}<p class="note" style="margin-top:8px">Pour lire les avis, les photos et les variantes de la communauté.</p></div>`);
  bindHead(p);
  renderHikes();
}

bus.on('want', () => { if (current.place && current.data && !current.hike && !el().hidden) renderHikes(); });
bus.on('log', () => { if (current.place && !current.hike && !el().hidden) refreshHead(); });
export const sheetOpen = () => !el().hidden;
