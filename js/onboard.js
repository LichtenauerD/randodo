// Premier lancement : on coche les lieux déjà faits, à la manière des artistes qu'on choisit en ouvrant une appli de musique.
// Seuls les lieux qui ont une vraie photo, vérifiée, sont proposés.
import { SITES } from './places.js';
import { store } from './state.js';
import { esc, settings, slugOf, toast } from './util.js';
import { SECTORS, sectorOf } from './objectifs.js';
import { gradeOf } from './grades.js';

export function needsOnboarding() {
  return !settings.get('onboarded', false) && SITES.some((p) => p.local);
}

export function openOnboarding(onDone = () => {}) {
  const pool = SITES.filter((p) => p.local);
  if (!pool.length) { settings.set('onboarded', true); onDone(); return; }
  const picked = new Set(pool.filter((p) => store.isDone(p)).map((p) => slugOf(p.name)));
  let sec = 'all';
  const host = document.createElement('div');
  host.className = 'onboard';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  document.body.appendChild(host);
  const count = () => {
    const n = picked.size, g = gradeOf(SITES.filter((p) => store.isDone(p) && !picked.has(slugOf(p.name))).length + n);
    host.querySelector('#ob-ok').textContent = n ? `C'est noté (${n})` : 'Je découvre tout';
    host.querySelector('#ob-grade').textContent = n ? `Tu démarres au grade ${g.name}` : '';
  };
  const grid = () => {
    const list = pool.filter((p) => sec === 'all' || sectorOf(p) === sec);
    host.querySelector('.ob-grid').innerHTML = list.map((p) => {
      const k = slugOf(p.name);
      return `<button type="button" class="ob-card${picked.has(k) ? ' on' : ''}" data-k="${k}" aria-pressed="${picked.has(k)}">
        <img src="${esc(p.local.file)}" alt="" loading="lazy"><span class="ob-name">${esc(p.name)}<small>${esc(p.local.credit.split(',')[0])}</small></span><span class="ob-tick" aria-hidden="true"></span></button>`;
    }).join('');
    host.querySelectorAll('.ob-card').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.k;
        if (picked.has(k)) picked.delete(k); else picked.add(k);
        b.classList.toggle('on', picked.has(k)); b.setAttribute('aria-pressed', picked.has(k));
        b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
        count();
      };
    });
  };
  host.innerHTML = `<div class="ob-head"><h2>Où as-tu déjà marché ?</h2>
      <p>Touche les lieux que tu as déjà faits. Ils comptent pour ton grade, et l'appli te proposera plutôt du neuf.</p>
      <div class="ob-tabs">${[{ id: 'all', name: 'Tout' }, ...SECTORS].map((s) => `<button type="button" data-s="${s.id}" class="${s.id === sec ? 'on' : ''}">${s.name}</button>`).join('')}</div></div>
    <div class="ob-grid"></div>
    <div class="ob-foot"><span id="ob-grade"></span><button type="button" class="btn main big" id="ob-ok"></button><button type="button" class="ob-skip" id="ob-skip">Plus tard</button></div>`;
  host.querySelectorAll('.ob-tabs button').forEach((b) => { b.onclick = () => { sec = b.dataset.s; host.querySelectorAll('.ob-tabs button').forEach((x) => x.classList.toggle('on', x === b)); grid(); }; });
  const finish = async (save) => {
    if (save) {
      for (const p of pool) {
        const k = slugOf(p.name), on = picked.has(k);
        if (on !== store.isVisited(p) && !(store.isDone(p) && !store.isVisited(p))) await store.setVisited(p, on);
      }
      if (picked.size) toast(`${picked.size} lieu${picked.size > 1 ? 'x' : ''} noté${picked.size > 1 ? 's' : ''}. Ton grade est dans l'onglet Objectifs.`, 4500);
    }
    settings.set('onboarded', true);
    host.classList.add('out');
    setTimeout(() => host.remove(), 260);
    onDone();
  };
  host.querySelector('#ob-ok').onclick = () => finish(true);
  host.querySelector('#ob-skip').onclick = () => finish(false);
  grid();
  count();
}
