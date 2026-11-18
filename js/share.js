// Partage : un lien vers une rando (ou vers l'appli) qui s'ouvre directement sur la bonne fiche.
// Sur iPhone, un lien s'ouvre dans Safari : Randodo y fonctionne pareil, avec une invitation à l'installer.
import { SITES } from '../data/sites.js';
import { slugOf, esc, toast, fmtKm, settings } from './util.js';
import { walkerSvg } from './grades.js';

const base = () => new URL('./', location.href).href;
export const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

// Numéro de la rando dans la liste du lieu : stable pour les randos précalculées (« slug-3 »).
function hikeNumber(place, hike, list) {
  const m = /-(\d+)$/.exec(hike.id || '');
  if (m && hike.id.startsWith(slugOf(place.name) + '-')) return +m[1];
  const i = (list || []).findIndex((h) => h.id === hike.id);
  return i >= 0 ? i + 1 : null;
}

export function linkFor(place, hike = null, list = null) {
  if (!place || !SITES.some((s) => s.name === place.name)) return base();
  const u = new URL(base());
  u.searchParams.set('lieu', slugOf(place.name));
  const n = hike ? hikeNumber(place, hike, list) : null;
  if (n) u.searchParams.set('rando', String(n));
  return u.href;
}

async function send(url, title, text) {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Lien copié : colle-le dans ta conversation.'); }
  catch { prompt('Copie ce lien :', url); }
}

export function shareHike(place, hike, list) {
  const url = linkFor(place, hike, list);
  const bits = [fmtKm(hike.meters), hike.up != null ? `${hike.up} m de montée` : ''].filter(Boolean).join(', ');
  return send(url, hike.title, `On y va ? ${hike.title} (${bits}), vers ${place.name}. Sur Randodo :`);
}

export function shareApp() {
  return send(base(), 'Randodo', 'Le dodo ne vole pas. Il marche. Et toi ? Des randos près de chez toi, même sans réseau :');
}

// Lien reçu : ?lieu=slug&rando=n. Renvoie le lieu et le numéro, ou null.
export function incoming() {
  const q = new URLSearchParams(location.search);
  const slug = q.get('lieu');
  if (!slug) return null;
  const place = SITES.find((s) => slugOf(s.name) === slug);
  if (!place) return null;
  return { place, n: +q.get('rando') || null };
}

// Bandeau pour qui ouvre un lien sans avoir installé l'appli.
export function inviteBanner() {
  if (isStandalone() || settings.get('inviteSeen', false)) return;
  const b = document.createElement('div');
  b.className = 'invite';
  b.innerHTML = `${walkerSvg(42)}<div><b>Un pote t'a envoyé cette rando</b><span>Randodo s'installe en une minute sur ton écran d'accueil, sans passer par l'App Store.</span>
    <p><a class="btn main small" href="${esc(base())}bienvenue.html#installer">Voir comment</a><button type="button" class="btn small">Plus tard</button></p></div>`;
  document.body.appendChild(b);
  b.querySelector('button').onclick = () => { settings.set('inviteSeen', true); b.remove(); };
}
