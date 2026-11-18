// Visite guidée du premier lancement : un voile sombre, une bulle de lumière sur l'endroit présenté,
// et le dodo qui commente. Chaque étape prépare l'écran elle-même, « Suivant » marche toujours.
import { SITES } from '../data/sites.js';
import { store } from './state.js';
import { settings } from './util.js';
import { walkerSvg, dodoSvg } from './grades.js';
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

// Lieu de démonstration : un classique dont les randos sont calculées d'avance.
const DEMO = ['Lac Blanc', 'Lac de Gérardmer', 'Cascade du Hohwald'];
let T = null;

const STEPS = [
  {
    id: 'hello', center: true,
    text: 'Je te fais faire le tour de l\'appli ? Ça prend deux minutes, et tu pourras la revoir quand tu veux dans Réglages.',
    dodo: 'Salut ! Moi c\'est le dodo. Je ne vole pas, mais je connais les sentiers du coin.',
    next: 'C\'est parti', skip: 'Plus tard',
  },
  {
    id: 'finder', before: () => navigate('accueil'), target: '#hm-finder .fq',
    text: 'Tout commence ici : d\'où tu pars. Juste dessous, le temps de route que tu acceptes pour aller marcher.',
    dodo: 'Moi, je ferais trois heures de route pour une belle cascade. Mais je suis un dodo.',
  },
  {
    id: 'level', target: '#hm-finder .flv',
    text: 'Tu peux choisir un niveau. Facile, c\'est une balade tranquille ; Difficile, ça grimpe pour de vrai.',
    dodo: 'Pour commencer, je conseille Facile. Mes petites pattes aussi.',
  },
  {
    id: 'search', target: '#hm-search',
    text: 'Puis « Afficher les lieux » : les idées de sortie près de chez toi s\'affichent, avec leur temps de route.',
    dodo: 'Et en général, il y en a plus que de week-ends dans l\'année.',
  },
  {
    id: 'signs', before: async () => { navigate('carte'); await openPlace(T.place); }, target: () => $('#sheet .signs'),
    text: 'Chaque lieu propose plusieurs boucles, rangées par niveau, avec leur distance et leur durée. Je t\'en ouvre une.',
    dodo: 'Le lac Blanc, un grand classique. Même moi j\'y suis allé à pied.',
  },
  {
    id: 'facts', before: async () => { if (T.hike) openHike(T.hike, { place: T.place }); await wait(500); }, target: () => $('#sheet .facts'),
    text: 'La fiche de la rando : distance, montée, durée de marche. Juste dessous, le profil se colore selon la pente : vert, ça roule ; rouge, ça pique.',
    dodo: 'Dans le rouge, je fais semblant d\'admirer la vue pour reprendre mon souffle.',
  },
  {
    id: 'roadbook', skipIf: () => !$('#roadbook'), target: '#roadbook',
    text: 'Le carnet de route : les balises à suivre, dans l\'ordre, avec leurs distances. Un coup d\'œil avant de partir, et le téléphone peut rester dans le sac.',
    dodo: 'Rectangle rouge, anneau bleu, croix jaune… Je les connais tous. Enfin, presque.',
  },
  {
    id: 'start', skipIf: () => !$('.start-box'), target: '.start-box',
    text: 'Ici, tu sais d\'où part la boucle : un parking, une gare ou un bord de route. Le bouton t\'y emmène avec ton GPS habituel.',
    dodo: 'Moi, j\'y vais à pied. Évidemment.',
  },
  {
    id: 'save', target: '#a-save', interactive: true,
    text: '« Garder hors ligne » range la rando dans ton téléphone, carte comprise : elle restera disponible même sans réseau, en pleine forêt. Tu peux essayer.',
    dodo: 'Vas-y, appuie ! Je la retirerai avec toi à la fin, promis.',
    done: () => T.hike && store.isSaved(T.hike.id),
    after: async () => { if (T.hike && !store.isSaved(T.hike.id)) await store.saveHike(T.hike); },
  },
  {
    id: 'gpx', target: '#a-gpx',
    text: 'Petit aparté : un GPX, c\'est le format universel des traces de rando. Un petit fichier que presque toutes les applis GPS et les montres savent lire. Ce bouton te l\'envoie, par exemple vers Organic Maps.',
    dodo: 'GPX, pour « GPS Exchange Format ». Je le ressors en soirée, ça impressionne toujours.',
  },
  {
    id: 'share', target: '#a-share',
    text: 'Et pour proposer la sortie à tes amis, « Envoyer à un pote » leur envoie un lien qui ouvre directement cette rando.',
    dodo: 'Marcher à plusieurs, c\'est meilleur. Surtout quand c\'est quelqu\'un d\'autre qui porte le pique-nique.',
  },
  {
    id: 'go', target: '#a-go',
    text: 'Le jour J, « Lancer la rando » te guide sur le terrain. Je te montre, en faisant marcher un randonneur imaginaire.',
    dodo: 'Le randonneur imaginaire, c\'est moi. Je m\'entraîne.',
  },
  {
    id: 'hud', before: async () => { if (T.hike) { startGuide(T.hike, { sim: true }); } await wait(1600); }, target: '.hud-top',
    text: 'En haut : le chrono, les kilomètres et la montée qui restent. Quand un carrefour approche, la direction à prendre s\'affiche juste dessous.',
    dodo: '« Dans 60 m, à gauche. » Oui, je parle comme un GPS maintenant.',
  },
  {
    id: 'panel', target: '.hud-panel',
    text: 'En bas : la balise que tu suis, et ton profil en direct. Tu sais ce qui t\'attend : « 800 m de montée raide », puis « 1,2 km de plat ».',
    dodo: 'Je te préviens avant les montées. C\'est ça, l\'amitié.',
  },
  {
    id: 'stop', target: '#hud-stop',
    text: 'Arrivé au bout, « Terminer » : tu notes ta sortie, et elle rejoint ton historique.',
    dodo: 'Je recommande de terminer par une tarte aux myrtilles. C\'est scientifique.',
    after: () => { if (isGuiding()) stopGuide(); closeSheet(); },
  },
  {
    id: 'week', before: () => { if (isGuiding()) stopGuide(); closeSheet(); navigate('accueil'); }, target: '#hm-picks',
    text: 'Chaque lundi, l\'accueil te propose de nouvelles idées de sortie. Celles que tu as déjà faites sont grisées, avec une coche.',
    dodo: 'C\'est moi qui les choisis. Avec mon bec.',
  },
  {
    id: 'map', before: () => navigate('carte'), target: '#map', pad: -40,
    text: 'La carte se parcourt librement : chaque pastille est un lieu de la sélection. Un appui long n\'importe où calcule des boucles autour de ce point.',
    dodo: 'Je me suis perdu une fois sur cette carte. C\'était formidable.',
  },
  {
    id: 'grade', before: () => navigate('objectifs'), target: '.grade-card', grow: true,
    text: 'La Conquête : coche les lieux que tu as faits, ton territoire se colore en rouge sur la carte du massif, et ton dodo grandit avec toi.',
    dodo: 'Regarde-moi grandir ! Bon, au début, je suis un œuf.',
  },
  {
    id: 'sectors', target: '.sectors',
    text: 'Pour chaque massif, le petit dodo grimpe sa montagne à mesure que tu avances. Il plante son drapeau quand tout est fait.',
    dodo: 'Le Jura, c\'est mon préféré. Ne le dis pas aux Vosges.',
  },
  {
    id: 'traces', before: async () => { navigate('traces'); await wait(300); }, target: () => (T.hike && document.querySelector(`#page .card[data-id="${CSS.escape(T.hike.id)}"] [data-a=del]`)) || $('#page .card [data-a=del]'),
    interactive: true,
    text: 'Dans Traces, tes randos gardées hors ligne. Celle de tout à l\'heure est là : tu peux la supprimer avec ce bouton, c\'est comme ça qu\'on fait le ménage.',
    dodo: 'Ne t\'inquiète pas, la rando, elle, ne bouge pas. Tu la retrouveras sur la carte.',
    done: () => T.hike && !store.isSaved(T.hike.id),
    after: async () => { if (T.hike && store.isSaved(T.hike.id) && !T.hadSaved) await store.removeHike(T.hike.id); },
  },
  {
    id: 'history', before: async () => { navigate('historique'); await wait(300); }, target: '#page', pad: -10,
    text: 'Et l\'historique : toutes tes sorties, avec la date, la durée et tes notes. De quoi te souvenir du lac croisé il y a deux ans.',
    dodo: 'Moi, je me souviens de tout. Sauf de l\'endroit où j\'ai garé la voiture.',
  },
  {
    id: 'bye', center: true, before: () => navigate('accueil'),
    text: 'La visite est finie. Tu peux la revoir à tout moment dans Réglages. Bonne marche !',
    dodo: 'Allez, on y va ? À pied, bien sûr.',
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
