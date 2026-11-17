// Guidage le long d'une trace : position, progression, alerte de sortie de tracé. Fonctionne sans réseau.
import { CONFIG } from './config.js';
import { map, showTrace, clearTrace, showMe, hideMe, setMarkersVisible } from './map.js';
import { closeSheet } from './sheet.js';
import { openLogForm } from './pages.js';
import { upAfter } from './elev.js';
import { cumulative, dist, projector, fmtKm, fmtM, fmtDur, esc, toast } from './util.js';

let g = null;
const hud = () => document.getElementById('hud');
export const isGuiding = () => !!g;

// Point du tracé le plus proche, cherché d'abord autour de la progression connue :
// sur un aller-retour ou une boucle qui se recroise, cela évite de sauter d'un passage à l'autre.
function locate(p) {
  const { pts, cum } = g;
  const total = cum[cum.length - 1];
  const scan = (from, to) => {
    const proj = projector(p[0]);
    const [px, py] = proj(p);
    let best = { d: Infinity, along: 0 };
    for (let i = 0; i < pts.length - 1; i++) {
      if (cum[i + 1] < from || cum[i] > to) continue;
      const [ax, ay] = proj(pts[i]), [bx, by] = proj(pts[i + 1]);
      const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
      let t = len2 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * vx - px, ay + t * vy - py);
      if (d < best.d) best = { d, along: cum[i] + (cum[i + 1] - cum[i]) * t };
    }
    return best;
  };
  const near = scan(g.along - 120, g.along + 700);
  if (near.d <= 60) return near;
  const all = scan(0, total);
  // On ne quitte la fenêtre que si le reste du tracé est nettement plus proche.
  return all.d < near.d - 40 ? all : near;
}

function beep() {
  try {
    if (!g.audio) return;
    const t = g.audio.currentTime;
    for (const dt of [0, 0.28]) {
      const o = g.audio.createOscillator(), a = g.audio.createGain();
      o.frequency.value = 880; o.connect(a); a.connect(g.audio.destination);
      a.gain.setValueAtTime(0.25, t + dt); a.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.22);
      o.start(t + dt); o.stop(t + dt + 0.24);
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch { /* son indisponible */ }
}

function alertBox(text, kind, actions = '') {
  const a = document.getElementById('hud-alert');
  if (!a) return;
  if (!text) { a.hidden = true; a.dataset.k = ''; return; }
  a.hidden = false; a.className = 'hud-alert' + (kind ? ' ' + kind : '');
  // On ne reconstruit les boutons que si le contenu change, pour qu'un appui ne tombe pas entre deux positions GPS.
  const k = text + '|' + actions;
  if (a.dataset.k === k) return;
  a.dataset.k = k;
  a.innerHTML = `<span>${esc(text)}</span>${actions ? `<div class="hud-actions">${actions}</div>` : ''}`;
}

// Montre le départ de la trace sur la carte, sans que le suivi GPS ne ramène la vue sur soi.
function showStart() {
  if (!g) return;
  g.follow = false;
  map.setView(g.pts[0], Math.max(map.getZoom(), 15), { animate: true });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#hud-start')) showStart();
});

function onPos(lat, lon, acc) {
  if (!g || g.paused) return;
  const p = [lat, lon];
  showMe(lat, lon, acc);
  const total = g.cum[g.cum.length - 1];
  const loc = locate(p);
  // Trace réellement parcourue.
  if (!g.last || dist(g.last, p) > 8) {
    if (g.last && dist(g.last, p) < 400) g.walked += dist(g.last, p);
    g.last = p; g.track.push([+lat.toFixed(5), +lon.toFixed(5)]);
  }
  const precise = !acc || acc < 45;
  if (loc.d > 300 && g.along < 80 && !g.started) {
    const s = g.pts[0];
    alertBox(`Rejoins le départ : tu es à ${fmtM(dist(p, s))} à vol d'oiseau.`, 'info',
      `<button type="button" id="hud-start">Voir le départ</button><a href="https://maps.apple.com/?daddr=${s[0].toFixed(5)},${s[1].toFixed(5)}" target="_blank" rel="noopener">Itinéraire</a>`);
  } else if (loc.d > CONFIG.offRoute && precise) {
    g.offCount++;
    if (g.offCount >= 2) {
      alertBox(`Tu t'écartes du tracé : il est à ${fmtM(loc.d)}.`);
      if (!g.off) { g.off = true; beep(); }
    }
  } else if (loc.d <= CONFIG.offRoute * 0.6) {
    g.offCount = 0;
    if (g.off || !g.started) alertBox('');
    g.off = false; g.started = true;
    g.along = loc.along;
  } else if (loc.d <= CONFIG.offRoute) {
    g.started = true; g.along = loc.along; g.offCount = 0;
  }
  const left = Math.max(0, total - g.along);
  const upLeft = g.hike.prof ? upAfter(g.hike.prof, g.along) : null;
  document.getElementById('hud-left').textContent = fmtKm(left).replace(' km', '');
  document.getElementById('hud-up').textContent = upLeft === null ? '—' : upLeft;
  document.getElementById('hud-eta').textContent = fmtDur((g.hike.minutes || 0) * (left / total));
  document.getElementById('hud-fill').style.width = Math.round((g.along / total) * 100) + '%';
  if (left < 40 && g.walked > total * 0.5 && !g.arrived) {
    g.arrived = true;
    alertBox('Arrivée. Tu peux terminer et noter la rando.', 'info');
    beep();
  }
  if (g.follow) map.panTo(p, { animate: true, duration: 0.5 });
}

async function wake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') g.wake = await navigator.wakeLock.request('screen');
  } catch { /* le téléphone gérera sa mise en veille */ }
}
function onVisible() { if (g && document.visibilityState === 'visible') wake(); }

export function startGuide(h, opts = {}) {
  if (g) stopGuide(false);
  closeSheet();
  document.querySelector('#page').hidden = true;
  g = { hike: h, pts: h.pts, cum: cumulative(h.pts), along: 0, walked: 0, track: [], last: null, off: false, offCount: 0, started: false, arrived: false, follow: true, paused: false, t0: Date.now(), sim: !!opts.sim };
  try { g.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { g.audio = null; }
  document.body.classList.add('guiding');
  setMarkersVisible(false);
  map.invalidateSize();
  showTrace(h, { corridor: true, pad: { top: 150, bottom: 90 } });
  const total = g.cum[g.cum.length - 1];
  hud().hidden = false;
  hud().innerHTML = `<div class="hud-top">
      <p class="name">${esc(h.title)}</p>
      <div class="row">
        <div><b id="hud-left">${fmtKm(total).replace(' km', '')}</b><span>km restants</span></div>
        <div><b id="hud-up">${h.up == null ? '—' : h.up}</b><span>m à monter</span></div>
        <div><b id="hud-eta">${fmtDur(h.minutes || 0)}</b><span>de marche</span></div>
      </div>
      <div class="hud-bar"><i id="hud-fill"></i></div>
    </div>
    <div id="hud-alert" class="hud-alert info" hidden></div>
    <div class="hud-bottom">
      <button type="button" class="btn" id="hud-pause">Pause</button>
      <button type="button" class="btn go" id="hud-stop">Terminer</button>
    </div>`;
  document.getElementById('hud-pause').onclick = () => {
    g.paused = !g.paused;
    document.getElementById('hud-pause').textContent = g.paused ? 'Reprendre' : 'Pause';
    alertBox(g.paused ? 'Guidage en pause.' : '', 'info');
  };
  document.getElementById('hud-stop').onclick = () => finish();
  map.on('dragstart', unfollow);
  document.addEventListener('visibilitychange', onVisible);
  wake();
  if (g.sim) {
    // Démonstration : un marcheur virtuel parcourt la trace.
    let i = 0;
    const step = Math.max(1, Math.round(h.pts.length / 140));
    g.timer = setInterval(() => {
      if (!g || g.paused) return;
      i = Math.min(i + step, h.pts.length - 1);
      onPos(h.pts[i][0], h.pts[i][1], 8);
      if (i >= h.pts.length - 1) clearInterval(g.timer);
    }, 350);
    alertBox('Démonstration : la position est simulée.', 'info');
  } else if (!('geolocation' in navigator)) {
    alertBox('La localisation n\'est pas disponible sur cet appareil.', 'info');
  } else {
    alertBox('Recherche de ta position.', 'info');
    g.watch = navigator.geolocation.watchPosition(
      (pos) => { if (!g.started && !g.off) alertBox(''); onPos(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); },
      (err) => {
        // Une alerte de sortie de tracé ne doit pas être remplacée par une erreur passagère de localisation.
        if (!g || g.off || (g.last && err.code !== 1)) return;
        alertBox(err.code === 1 ? 'Localisation refusée : autorise-la pour ce site dans les réglages du téléphone.' : 'Position introuvable pour l\'instant. Dégage la vue du ciel.', 'info');
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 25000 },
    );
  }
  // Crochet de test : permet d'injecter une position.
  window.__cairnPos = (la, lo, acc = 8) => onPos(la, lo, acc);
}

function unfollow() { if (g) g.follow = false; }
export function recenter() {
  if (!g) return;
  g.follow = true;
  if (g.last) map.setView(g.last, Math.max(map.getZoom(), 16));
}

export function stopGuide(restoreUi = true) {
  if (!g) return;
  if (g.watch != null) navigator.geolocation.clearWatch(g.watch);
  if (g.timer) clearInterval(g.timer);
  if (g.wake) g.wake.release().catch(() => {});
  if (g.audio) g.audio.close().catch(() => {});
  map.off('dragstart', unfollow);
  document.removeEventListener('visibilitychange', onVisible);
  g = null;
  hud().hidden = true; hud().innerHTML = '';
  document.body.classList.remove('guiding');
  if (restoreUi) { clearTrace(); hideMe(); setMarkersVisible(true); map.invalidateSize(); }
}

function finish() {
  const done = { hike: g.hike, walked: g.walked, minutes: Math.round((Date.now() - g.t0) / 60000), ratio: g.along / g.cum[g.cum.length - 1] };
  if (done.ratio < 0.15 && done.walked < 300) {
    stopGuide();
    toast('Guidage arrêté.');
    return;
  }
  stopGuide();
  // Parcours terminé : on retient la longueur de la trace, plus fiable que la somme des positions GPS.
  openLogForm({ place: done.hike.place, hike: done.hike, walked: done.ratio > 0.9 ? null : done.walked, walkedMinutes: done.minutes });
}
