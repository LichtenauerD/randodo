// Visite guidée du premier lancement : un voile sombre, une bulle de lumière sur l'endroit présenté,
// et le dodo qui commente. Chaque étape prépare l'écran elle-même, « Suivant » marche toujours.
import { SITES } from '../data/sites.js';
import { store } from './state.js';
import { settings } from './util.js';
import { walkerSvg, dodoSvg, MASCOT } from './grades.js';
import { navigate } from './pages.js';
import { openPlace, openHike, closeSheet } from './sheet.js';
import { hikesFor } from './hikes.js';
import { startGuide, stopGuide, isGuiding } from './guide.js';

const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(sel, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const el = typeof sel === 'function' ? sel() : $(sel); if (el && el.getBoundingClientRect().height > 0) return el; await wait(120); }
  return null;
}

// Plusieurs éléments mis en lumière ensemble : une cible virtuelle qui les englobe.
function union(sel, n) {
  const els = [...document.querySelectorAll(sel)].slice(0, n);
  if (!els.length) return null;
  return {
    get isConnected() { return els.every((e) => e.isConnected); },
    scrollIntoView: (o) => els[0].scrollIntoView(o),
    getBoundingClientRect() {
      const r = els.map((e) => e.getBoundingClientRect());
      const left = Math.min(...r.map((x) => x.left)), top = Math.min(...r.map((x) => x.top));
      const right = Math.max(...r.map((x) => x.right)), bottom = Math.max(...r.map((x) => x.bottom));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    },
  };
}

// Lieu de démonstration : un classique dont les randos sont calculées d'avance.
const DEMO = ['Lac Blanc', 'Lac de Gérardmer', 'Cascade du Hohwald'];
let T = null;

const STEPS = [
  {
    id: 'hello', center: true,
    dodo: `Salut, moi c'est ${MASCOT} le dodo ! Je ne vole pas, mais je connais tous les sentiers.`,
    text: 'Petit tour de l\'appli ? Deux minutes, promis.',
    next: 'C\'est parti', skip: 'Plus tard',
  },
  {
    id: 'finder', before: () => navigate('accueil'), target: () => union('#hm-finder .fq', 2),
    text: 'D\'où tu pars, combien de route, ton niveau : tout se règle ici.',
    dodo: 'Trois heures de route pour une cascade ? Je l\'ai déjà fait.',
  },
  {
    id: 'search', target: '#hm-search',
    text: '« Afficher les lieux », et les idées tombent.',
    dodo: 'Ouah, douze idées pour un seul week-end ?!',
  },
  {
    id: 'signs', before: async () => { navigate('carte'); await openPlace(T.place); }, target: () => $('#sheet .signs'),
    text: 'Chaque lieu propose plusieurs boucles, rangées par niveau.',
    dodo: 'Moi, je prends toujours celle qui passe par la ferme-auberge.',
  },
  {
    id: 'facts', before: async () => { if (T.hike) openHike(T.hike, { place: T.place }); await wait(500); }, target: () => $('#sheet .facts'),
    text: 'Distance, montée, durée. Juste dessous, le profil se colore selon la pente.',
    dodo: 'Dans le rouge, je fais semblant d\'admirer la vue pour reprendre mon souffle.',
  },
  {
    id: 'roadbook', skipIf: () => !$('#roadbook'), target: '#roadbook',
    text: 'Les balises à suivre, dans l\'ordre. Un coup d\'œil, et le téléphone reste dans le sac.',
    dodo: 'Rectangle rouge, anneau bleu… J\'ai mes préférés.',
  },
  {
    id: 'save', target: '#a-save', interactive: true,
    text: 'La rando se range dans le téléphone et marche sans réseau. Essaie !',
    dodo: 'En forêt, la 4G, c\'est comme moi en vol : inexistante.',
    done: () => T.hike && store.isSaved(T.hike.id),
    after: async () => { if (T.hike && !store.isSaved(T.hike.id)) await store.saveHike(T.hike); },
  },
  {
    id: 'gpx', target: '#a-gpx',
    text: 'Un GPX, c\'est le format universel des traces de rando : presque toutes les applis GPS et les montres le lisent.',
    dodo: '« GPS Exchange Format ». Je le place en soirée, effet garanti.',
  },
  {
    id: 'hud', before: async () => { if (T.hike) startGuide(T.hike, { sim: true }); await wait(1600); }, target: '.hud-top',
    text: '« Lancer la rando » : chrono, distance restante, et la direction à chaque carrefour.',
    dodo: '« Dans 60 m, à gauche. » Je parle GPS couramment.',
  },
  {
    id: 'panel', target: '.hud-panel',
    text: 'La balise à suivre et ce qui t\'attend. Le petit bouton montagne déplie le profil.',
    dodo: 'Astuce : si ça monte trop, refais tes lacets. Personne ne saura.',
  },
  {
    id: 'stop', target: '#hud-stop',
    text: '« Terminer », et ta sortie rejoint l\'historique.',
    dodo: 'Je recommande de terminer par une tarte aux myrtilles. C\'est scientifique.',
    after: () => { if (isGuiding()) stopGuide(); closeSheet(); },
  },
  {
    id: 'week', before: () => { if (isGuiding()) stopGuide(); closeSheet(); navigate('accueil'); }, target: '#hm-picks',
    text: 'Chaque lundi, de nouvelles idées. Celles déjà faites sont cochées.',
    dodo: 'Choisies à vue de bec, rien que pour toi.',
  },
  {
    id: 'map', before: () => navigate('carte'), target: '#map', pad: -40,
    text: 'La carte se parcourt librement. Un appui long n\'importe où : des boucles autour.',
    dodo: 'Je me suis perdu une fois sur cette carte. C\'était formidable.',
  },
  {
    id: 'grade', before: () => navigate('objectifs'), target: '.grade-card', grow: true,
    text: `Coche les lieux faits : ton territoire rougit, et ${MASCOT} grandit avec toi.`,
    dodo: 'Ohh… Je ressemblais à ça, avant. Un petit œuf.',
  },
  {
    id: 'traces', before: async () => { navigate('traces'); await wait(300); }, target: () => (T.hike && document.querySelector(`#page .card[data-id="${CSS.escape(T.hike.id)}"] [data-a=del]`)) || $('#page .card [data-a=del]'),
    interactive: true,
    text: 'Tes traces gardées. Celle de tout à l\'heure est là : tu peux la supprimer.',
    dodo: 'Le ménage, c\'est un peu de la rando. Enfin, presque.',
    done: () => T.hike && !store.isSaved(T.hike.id),
    after: async () => { if (T.hike && store.isSaved(T.hike.id) && !T.hadSaved) await store.removeHike(T.hike.id); },
  },
  {
    id: 'history', before: async () => { navigate('historique'); await wait(300); }, target: '#page', pad: -10,
    text: 'Toutes tes sorties, avec la date, la durée et tes notes.',
    dodo: 'Moi, je me souviens de tout. Sauf de l\'endroit où j\'ai garé la voiture.',
  },
  {
    id: 'bye', center: true, before: () => navigate('accueil'),
    text: 'C\'est tout ! La visite se rejoue dans Réglages.',
    dodo: `Allez, on y va ? À pied, bien sûr. Signé ${MASCOT} le dodo.`,
    next: 'Terminer',
  },
];

function build() {
  const root = document.createElement('div');
  root.id = 'tour';
  root.innerHTML = `<div class="tb tb-t"></div><div class="tb tb-b"></div><div class="tb tb-l"></div><div class="tb tb-r"></div><div class="tb tb-h"></div>
    <div class="tour-hole"></div>
    <div class="tour-card" role="dialog" aria-live="polite">
      <div class="tour-dodo">${walkerSvg(58)}</div>
      <p class="tour-say"></p>
      <p class="tour-text"></p>
      <div class="tour-foot"><span class="tour-dots"></span><button type="button" class="tour-skip"></button><button type="button" class="btn main small tour-next"></button></div>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function placeHole(el, pad = 8) {
  const R = T.root;
  // L'écran a pu se redessiner : on retrouve la cible.
  if (el && !el.isConnected && T.find) { el = T.find(); T.el = el; }
  const hole = R.querySelector('.tour-hole');
  const W = innerWidth, H = innerHeight;
  let r = el ? el.getBoundingClientRect() : null;
  if (r && (r.width === 0 || r.height === 0)) r = null;
  const x = r ? Math.max(4, r.left - pad) : W / 2, y = r ? Math.max(4, r.top - pad) : H / 2;
  const w = r ? Math.min(W - 8, r.width + 2 * pad) : 0, h = r ? Math.min(H - y - 4, r.height + 2 * pad) : 0;
  Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  hole.classList.toggle('none', !r);
  // Quatre volets autour de la bulle bloquent les touchers ; un cinquième couvre la bulle sauf aux étapes à essayer.
  const set = (c, s) => Object.assign(R.querySelector(c).style, s);
  set('.tb-t', { left: 0, top: 0, width: W + 'px', height: y + 'px' });
  set('.tb-b', { left: 0, top: y + h + 'px', width: W + 'px', height: Math.max(0, H - y - h) + 'px' });
  set('.tb-l', { left: 0, top: y + 'px', width: x + 'px', height: h + 'px' });
  set('.tb-r', { left: x + w + 'px', top: y + 'px', width: Math.max(0, W - x - w) + 'px', height: h + 'px' });
  set('.tb-h', { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', display: T.step.interactive ? 'none' : 'block' });
  // La carte se met au-dessus ou au-dessous de la bulle, là où il y a de la place.
  const card = R.querySelector('.tour-card');
  const ch = card.offsetHeight;
  card.classList.toggle('center', !r);
  if (!r) { card.style.top = Math.max(20, (H - ch) / 2) + 'px'; return; }
  const below = H - (y + h), above = y;
  const top = below >= ch + 24 || below > above ? Math.min(H - ch - 12, y + h + 14) : Math.max(12, y - ch - 14);
  card.style.top = top + 'px';
  card.classList.toggle('up', top < y);
}

async function show(i) {
  if (!T) return;
  T.i = i;
  const st = STEPS[i];
  T.step = st;
  if (!st) return end(true);
  T.root.classList.add('busy');
  try { if (st.before) await st.before(); } catch { /* l'étape s'affiche quand même */ }
  if (st.skipIf && st.skipIf()) { T.root.classList.remove('busy'); return show(i + 1); }
  let el = null;
  T.find = st.target ? (typeof st.target === 'function' ? st.target : () => $(st.target)) : null;
  if (!st.center && st.target) {
    el = await until(T.find, 5000);
    if (el && !el.isConnected) el = T.find();
    if (el && st.id !== 'map' && st.id !== 'history') { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); await wait(450); }
  }
  if (!T) return;
  T.el = el;
  const R = T.root;
  R.classList.remove('busy');
  R.querySelector('.tour-say').textContent = st.dodo;
  R.querySelector('.tour-text').textContent = st.text;
  R.querySelector('.tour-next').textContent = st.next || (i === STEPS.length - 1 ? 'Terminer' : 'Suivant');
  const skip = R.querySelector('.tour-skip');
  skip.textContent = st.skip || 'Passer la visite';
  skip.hidden = i === STEPS.length - 1;
  const shown = STEPS.filter((s) => !s.center).length, pos = STEPS.slice(0, i + 1).filter((s) => !s.center).length;
  R.querySelector('.tour-dots').textContent = st.center ? '' : `${pos} / ${shown}`;
  const d = R.querySelector('.tour-dodo');
  d.classList.remove('hop'); void d.offsetWidth; d.classList.add('hop');
  placeHole(el, st.pad != null ? st.pad : 8);
  // Étape à essayer : on passe à la suite dès que c'est fait.
  clearInterval(T.poll);
  if (st.done) T.poll = setInterval(() => { if (T && T.step === st && st.done()) { clearInterval(T.poll); setTimeout(() => next(), 700); } }, 300);
  // Le dodo de la carte de grade grandit, étape après étape, pendant la présentation.
  clearInterval(T.grow);
  if (st.grow && el) {
    const art = el.querySelector('.dodo-art');
    if (art) {
      const real = art.outerHTML, size = +art.getAttribute('width') || 64;
      let k = 0;
      T.grow = setInterval(() => {
        const cur = el.querySelector('.dodo-art');
        if (!cur || !T || T.step !== st) { clearInterval(T && T.grow); return; }
        if (k > 9) { cur.outerHTML = real; clearInterval(T.grow); return; }
        cur.outerHTML = dodoSvg(k, size).replace('class="dodo-art"', 'class="dodo-art grow-pop"');
        k++;
      }, 650);
    }
  }
}

async function next() {
  if (!T || T.moving) return;
  T.moving = true;
  clearInterval(T.poll);
  try { if (T.step && T.step.after) await T.step.after(); } catch { /* on continue */ }
  T.moving = false;
  show(T.i + 1);
}

function end(finished) {
  if (!T) return;
  clearInterval(T.poll); clearInterval(T.grow);
  removeEventListener('resize', T.onResize);
  document.removeEventListener('scroll', T.onResize, true);
  T.root.remove();
  if (isGuiding()) stopGuide();
  if (T.hike && store.isSaved(T.hike.id) && !T.hadSaved) store.removeHike(T.hike.id);
  T = null;
  settings.set('tourDone', true);
  if (finished) navigate('accueil');
}

export async function startTour() {
  if (T) return;
  const place = DEMO.map((n) => SITES.find((s) => s.name === n)).find(Boolean) || SITES[0];
  T = { i: 0, place, hike: null, hadSaved: false };
  T.root = build();
  T.root.querySelector('.tour-next').onclick = () => next();
  T.root.querySelector('.tour-skip').onclick = () => end(T.i > 0);
  T.onResize = () => { if (T && T.step) placeHole(T.el, T.step.pad != null ? T.step.pad : 8); };
  addEventListener('resize', T.onResize);
  document.addEventListener('scroll', T.onResize, true);
  // La rando de démonstration est préparée pendant le mot d'accueil.
  hikesFor(place).then((d) => { if (T && d && d.hikes && d.hikes.length) { T.hike = d.hikes.find((h) => h.level === 'facile') || d.hikes[0]; T.hadSaved = store.isSaved(T.hike.id); } }).catch(() => {});
  show(0);
}

// Proposée une seule fois, après le prénom et le questionnaire du premier lancement.
export function maybeTour() {
  if (settings.get('tourDone', false) || T) return;
  setTimeout(() => startTour(), 500);
}

export const touring = () => !!T;
// Pour les tests.
window.__tour = { start: startTour, next: () => next(), end: () => end(false), step: () => T && T.step && T.step.id };
