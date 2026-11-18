// Guidage le long d'une trace : position, progression, alerte de sortie de tracé. Fonctionne sans réseau.
import { CONFIG } from './config.js';
import { map, showTrace, clearTrace, showMe, hideMe, setMarkersVisible } from './map.js';
import { closeSheet } from './sheet.js';
import { openLogForm } from './pages.js';
import { upAfter } from './elev.js';
import { cumulative, dist, projector, fmtKm, fmtM, fmtDur, esc, toast, settings } from './util.js';
import { slopeRuns, slopeProfileSvg, upcoming, SLOPE } from './slope.js';
import { symHtml, symName, turnText } from './sheet.js';

// Flèche de direction : angle par consigne.
const ARROW = { G: -90, D: 90, LG: -45, LD: 45, TD: 0, DG: -150, DD: 150 };
const arrowSvg = (code) => `<svg viewBox="0 0 40 40" class="turn-arrow" style="transform:rotate(${ARROW[code] || 0}deg)" aria-hidden="true"><path d="M20 4l11 13h-7v19h-8V17H9z" fill="currentColor"/></svg>`;
const PROF_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 19l6-9 4 5 3-4 7 8z"/></svg>';
const clock = (ms) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };

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
  live();
  if (left < 40 && g.walked > total * 0.5 && !g.arrived) {
    g.arrived = true;
    alertBox('Arrivée. Tu peux terminer et noter la rando.', 'info');
    beep();
  }
  if (g.follow) map.panTo(p, { animate: true, duration: 0.5 });
}

// Panneau du bas et consigne d'intersection : recalculés à chaque position.
function live() {
  if (!g) return;
  const along = g.along;
  // Profil coloré, position marquée.
  const pr = document.getElementById('hud-prof');
  if (pr && g.hike.prof) {
    const bucket = Math.round(along / 25);
    if (bucket !== g.profBucket) { g.profBucket = bucket; pr.innerHTML = slopeProfileSvg(g.hike.prof, { pos: along, height: 58, cls: 'hud-profile' }); }
    const u = upcoming(g.runs, along);
    document.getElementById('hud-now').innerHTML = u.now ? `<i style="background:${SLOPE[u.cls].color}"></i>Maintenant : ${esc(u.now)}` : '';
    document.getElementById('hud-next').innerHTML = u.next ? `<i style="background:${SLOPE[u.nextCls].color}"></i>Ensuite : ${esc(u.next)}` : '';
  }
  // Balisage en cours et suivant.
  const mk = document.getElementById('hud-mark');
  if (mk) {
    const marks = g.hike.marks || [];
    const i = marks.findIndex(([a, b]) => along >= a && along < b);
    const m = marks[i];
    if (!m) mk.innerHTML = '';
    else {
      const left = m[1] - along, nx = marks[i + 1];
      const lenTxt = left >= 1000 ? fmtKm(left) : fmtM(Math.max(10, Math.round(left / 10) * 10));
      const then = nx ? (nx[2] ? `, puis ${symName(nx[2])}` : ', puis plus de balisage') : '';
      mk.innerHTML = m[2] ? `${symHtml(m[2])}<span>Suis <b>${symName(m[2])}</b> encore ${lenTxt}${then}</span>` : `<span class="sym rb-none"></span><span>Pas de balisage encore ${lenTxt}${then}</span>`;
    }
  }
  // Prochaine intersection : affichée à moins de 250 m, signal à 60 m.
  const tc = document.getElementById('hud-turn');
  if (tc) {
    const next = g.started && !g.off ? (g.hike.turns || []).find(([at]) => at > along - 8) : null;
    const d = next ? next[0] - along : Infinity;
    if (!next || d > 250) { tc.hidden = true; }
    else {
      tc.hidden = false;
      const txt = turnText(next[1]);
      tc.innerHTML = `${arrowSvg(next[1])}<div><b>${d < 20 ? txt.charAt(0).toUpperCase() + txt.slice(1) : 'Dans ' + fmtM(Math.max(10, Math.round(d / 10) * 10))}</b><span>${d < 20 ? 'maintenant' : txt}</span></div>`;
      if (d < 60 && g.warned !== next[0]) { g.warned = next[0]; if (navigator.vibrate) navigator.vibrate(120); }
    }
  }
  place();
}

// L'alerte se place sous le bandeau du haut, quelle que soit sa hauteur.
function place() {
  const top = document.querySelector('.hud-top'), a = document.getElementById('hud-alert');
  if (top && a) a.style.top = (top.getBoundingClientRect().bottom + 8) + 'px';
}

function tickClock() {
  if (!g) return;
  const now = Date.now();
  if (!g.paused) g.elapsed += now - g.tick;
  g.tick = now;
  const c = document.getElementById('hud-clock');
  if (c) c.textContent = clock(g.elapsed);
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
  g = { hike: h, pts: h.pts, cum: cumulative(h.pts), along: 0, walked: 0, track: [], last: null, off: false, offCount: 0, started: false, arrived: false, follow: true, paused: false, t0: Date.now(), sim: !!opts.sim,
    elapsed: 0, tick: Date.now(), runs: slopeRuns(h.prof), profBucket: -1, warned: null };
  try { g.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { g.audio = null; }
  document.body.classList.add('guiding');
  setMarkersVisible(false);
  map.invalidateSize();
  showTrace(h, { corridor: true, pad: { top: 170, bottom: 250 } });
  const total = g.cum[g.cum.length - 1];
  hud().hidden = false;
  hud().innerHTML = `<div class="hud-top">
      <p class="name">${esc(h.title)}</p>
      <div class="row">
        <div><b id="hud-clock">0:00</b><span>chrono</span></div>
        <div><b id="hud-left">${fmtKm(total).replace(' km', '')}</b><span>km restants</span></div>
        <div><b id="hud-up">${h.up == null ? '—' : h.up}</b><span>m à monter</span></div>
        <div><b id="hud-eta">${fmtDur(h.minutes || 0)}</b><span>encore</span></div>
      </div>
      <div class="hud-bar"><i id="hud-fill"></i></div>
      <div id="hud-turn" class="hud-turn" hidden></div>
    </div>
    <div id="hud-alert" class="hud-alert info" hidden></div>
    <div class="hud-panel${settings.get('hudProfile', false) ? ' open' : ''}">
      <button type="button" class="hud-ptog" id="hud-ptog" aria-label="Afficher ou masquer le profil">${PROF_IC}</button>
      <div id="hud-mark" class="hud-mark"></div>
      <div id="hud-prof"></div>
      <p id="hud-now" class="hud-run"></p>
      <p id="hud-next" class="hud-run soft"></p>
    </div>
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
  document.getElementById('hud-ptog').onclick = () => {
    const panel = document.querySelector('.hud-panel');
    const open = !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    settings.set('hudProfile', open);
    g.profBucket = -1; live();
  };
  g.clock = setInterval(tickClock, 1000);
  live();
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
  if (g.clock) clearInterval(g.clock);
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
  tickClock();
  const done = { hike: g.hike, walked: g.walked, minutes: Math.round(g.elapsed / 60000), ratio: g.along / g.cum[g.cum.length - 1] };
  if (done.ratio < 0.15 && done.walked < 300) {
    stopGuide();
    toast('Guidage arrêté.');
    return;
  }
  stopGuide();
  // Parcours terminé : on retient la longueur de la trace, plus fiable que la somme des positions GPS.
  openLogForm({ place: done.hike.place, hike: done.hike, walked: done.ratio > 0.9 ? null : done.walked, walkedMinutes: done.minutes });
}
