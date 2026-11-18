// Grades de randonneur et dodo qui évolue avec eux.
export const GRADES = [
  { at: 0, name: 'Promeneur du dimanche', dodo: 0 },
  { at: 3, name: 'Baladeur', dodo: 1 },
  { at: 10, name: 'Marcheur', dodo: 2 },
  { at: 20, name: 'Randonneur', dodo: 3 },
  { at: 30, name: 'Arpenteur', dodo: 4 },
  { at: 50, name: 'Crapahuteur', dodo: 5 },
  { at: 75, name: 'Coureur de crêtes', dodo: 6 },
  { at: 100, name: 'Grand randonneur', dodo: 7 },
  { at: 150, name: 'Baroudeur', dodo: 8 },
  { at: 200, name: 'Légende des sentiers', dodo: 9 },
];
// Ce que montre le dodo à chaque grade.
export const DODO_STAGES = ['Un œuf', "L'œuf se fêle", 'Le poussin sort', 'Jeune dodo', 'Sac au dos', 'Bâtons de marche', 'Sur la crête', 'Drapeau planté', 'Il plane', 'Il vole'];

export function gradeOf(n) {
  let i = 0;
  while (i + 1 < GRADES.length && n >= GRADES[i + 1].at) i++;
  const g = GRADES[i], next = GRADES[i + 1] || null;
  const pct = next ? (n - g.at) / (next.at - g.at) : 1;
  return { i, ...g, next, pct, left: next ? next.at - n : 0 };
}

// Dodo dessiné à la main, en aplats : corps brun, gros bec crochu, œil rond.
const C = { body: '#8a6a4a', belly: '#c9a77c', beak: '#e2b04a', beakTip: '#b5812a', dark: '#3a2b1f', egg: '#f3ead8', eggLine: '#c9b48e', sky: '#e8f0e4', violet: '#8a1fd1', flag: '#f5b700' };
const bodyBase = (x = 0, y = 0, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="30" cy="40" rx="15" ry="13" fill="${C.body}"/>
  <ellipse cx="33" cy="44" rx="9" ry="8" fill="${C.belly}"/>
  <path d="M15 37c-5 1-7 5-5 8 3-2 5-3 7-3z" fill="${C.dark}" opacity=".55"/>
  <circle cx="38" cy="25" r="9" fill="${C.body}"/>
  <path d="M44 22c8 0 12 3 12 7 0 3-3 4-6 3l-6-2z" fill="${C.beak}"/>
  <path d="M53 29c2 1 3 3 1 4-2 0-3-1-4-2z" fill="${C.beakTip}"/>
  <circle cx="40" cy="22.5" r="2.1" fill="${C.dark}"/><circle cx="40.7" cy="21.8" r=".7" fill="#fff"/>
  <path d="M26 52v6M34 52v6M23 58h6M31 58h6" stroke="${C.dark}" stroke-width="2.2" stroke-linecap="round"/>
</g>`;

export function dodoSvg(stage, size = 56) {
  let art = '';
  switch (stage) {
    case 0: art = `<ellipse cx="32" cy="33" rx="15" ry="19" fill="${C.egg}" stroke="${C.eggLine}" stroke-width="2"/><circle cx="27" cy="26" r="2" fill="${C.eggLine}"/><circle cx="36" cy="37" r="2.5" fill="${C.eggLine}"/>`; break;
    case 1: art = `<ellipse cx="32" cy="33" rx="15" ry="19" fill="${C.egg}" stroke="${C.eggLine}" stroke-width="2"/><path d="M19 28l5 3 4-4 4 5 5-4 4 3 3-2" fill="none" stroke="${C.dark}" stroke-width="1.6" stroke-linejoin="round"/>`; break;
    case 2: art = `<circle cx="32" cy="26" r="9" fill="${C.body}"/><path d="M38 23c6 0 9 2 9 5 0 2-2 3-4 2l-5-1z" fill="${C.beak}"/><circle cx="34" cy="23" r="1.8" fill="${C.dark}"/>
      <path d="M17 36l5 3 4-4 4 5 5-4 4 3 4-3v8c0 10-7 15-15 15S17 54 17 44z" fill="${C.egg}" stroke="${C.eggLine}" stroke-width="2" stroke-linejoin="round"/>`; break;
    case 3: art = bodyBase(-2, 2, 0.95); break;
    case 4: art = `<rect x="11" y="31" width="11" height="15" rx="3" fill="#2f6b4f"/><path d="M14 31c0-4 6-4 6 0" fill="none" stroke="#2f6b4f" stroke-width="2"/>${bodyBase(0, 2, 0.95)}`; break;
    case 5: art = `<rect x="11" y="31" width="11" height="15" rx="3" fill="#2f6b4f"/>${bodyBase(0, 2, 0.95)}<path d="M50 30l-4 30" stroke="${C.dark}" stroke-width="2" stroke-linecap="round"/><path d="M13 34l-4 26" stroke="${C.dark}" stroke-width="2" stroke-linecap="round"/>`; break;
    case 6: art = `<path d="M0 64l20-22 10 8 14-18 20 32z" fill="#c8763a" opacity=".7"/><path d="M44 32l6 8-4-1-4 4-3-4z" fill="#fff"/>${bodyBase(24, -6, 0.66)}`; break;
    case 7: art = `<path d="M0 64l20-22 10 8 14-18 20 32z" fill="#c8763a" opacity=".7"/><path d="M20 20v22" stroke="${C.dark}" stroke-width="2"/><path d="M20 20l11 4-11 4z" fill="${C.flag}"/>${bodyBase(24, -6, 0.66)}`; break;
    case 8: art = `<path d="M4 34c8-12 18-14 24-6M60 34c-8-12-18-14-24-6" fill="${C.body}" stroke="${C.dark}" stroke-width="1.2"/>${bodyBase(2, 0, 0.9)}<path d="M2 58c10-3 20-3 30 0s20 3 30 0" fill="none" stroke="#9cc3e6" stroke-width="2" stroke-dasharray="3 4"/>`; break;
    default: art = `<path d="M2 24c10-16 22-16 28-6M62 24c-10-16-22-16-28-6" fill="${C.body}" stroke="${C.dark}" stroke-width="1.2"/>${bodyBase(2, -6, 0.85)}<path d="M4 50h10M2 56h14M6 62h8" stroke="${C.violet}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return `<svg class="dodo-art" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="${C.sky}"/>${art}</svg>`;
}

// Progression d'un secteur : le dodo grimpe la montagne ; à 100 %, drapeau planté et il s'envole.
export function climbSvg(pct, w = 120, h = 70) {
  const p = Math.max(0, Math.min(1, pct));
  const path = 'M8 64 C 24 60, 26 50, 40 47 S 56 38, 60 30 S 74 20, 80 10';
  const top = p >= 1;
  return `<svg class="climb-art" viewBox="0 0 100 70" width="${w}" height="${h}" aria-hidden="true">
    <path d="M0 70 L38 30 L50 40 L80 6 L100 30 L100 70 Z" fill="#c8763a" opacity=".22"/>
    <path d="M72 15 L80 6 L88 16 L84 15 L80 19 L76 15 Z" fill="#fff" opacity=".9"/>
    <path d="${path}" fill="none" stroke="#c9d3cb" stroke-width="2.4" stroke-dasharray="1 4" stroke-linecap="round"/>
    <path d="${path}" fill="none" stroke="${C.violet}" stroke-width="2.8" stroke-linecap="round" pathLength="1" stroke-dasharray="${p} 1"/>
    ${top ? `<path d="M84 4v14" stroke="${C.dark}" stroke-width="1.6"/><path d="M84 4l10 3-10 3z" fill="${C.flag}"/>` : ''}
    <path class="climb-route" d="${path}" fill="none" stroke="none"/>
    <g class="climb-dodo" data-p="${p}">
      <g transform="translate(-13 -23) scale(.42)">${top ? '<path d="M2 24c10-16 22-16 28-6M62 24c-10-16-22-16-28-6" fill="#8a6a4a"/>' : ''}${bodyBase(0, 0, 1)}</g>
    </g>
  </svg>`;
}

// Place chaque dodo sur son sentier (après insertion dans la page).
export function placeClimbers(root) {
  root.querySelectorAll('.climb-art').forEach((svg) => {
    const route = svg.querySelector('.climb-route'), d = svg.querySelector('.climb-dodo');
    if (!route || !d || !route.getTotalLength) return;
    const pt = route.getPointAtLength(route.getTotalLength() * +d.dataset.p);
    d.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
  });
}

// Dodo qui gravit sa montagne en boucle (aide des grades). Sans animation si l'utilisateur la refuse.
export function animateClimber(svg, ms = 4200) {
  const route = svg.querySelector('.climb-route'), d = svg.querySelector('.climb-dodo'), line = svg.querySelectorAll('path[pathLength]')[0];
  if (!route || !d) return () => {};
  const total = route.getTotalLength();
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, t0 = 0;
  const step = (t) => {
    if (!svg.isConnected) return;
    if (!t0) t0 = t;
    const k = ((t - t0) % (ms + 900)) / ms, p = Math.min(1, k);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const pt = route.getPointAtLength(total * e);
    const hop = Math.abs(Math.sin(e * Math.PI * 14)) * 1.6 * (p < 1 ? 1 : 0);
    d.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${(pt.y - hop).toFixed(1)})`);
    if (line) line.setAttribute('stroke-dasharray', `${e.toFixed(3)} 1`);
    raf = requestAnimationFrame(step);
  };
  if (still) { const pt = route.getPointAtLength(total * 0.6); d.setAttribute('transform', `translate(${pt.x} ${pt.y})`); if (line) line.setAttribute('stroke-dasharray', '0.6 1'); }
  else raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

// Dodo marcheur de l'accueil, de profil, chapeau de rando sur la tête. Pattes séparées pour l'animation.
export function walkerSvg(size = 46) {
  return `<svg class="walker-art" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <g class="w-body">
      <ellipse cx="30" cy="40" rx="15" ry="13" fill="${C.body}"/>
      <ellipse cx="33" cy="44" rx="9" ry="8" fill="${C.belly}"/>
      <path class="w-wing" d="M15 37c-5 1-7 5-5 8 3-2 5-3 7-3z" fill="${C.dark}" opacity=".55"/>
      <rect x="10" y="33" width="9" height="13" rx="3" fill="#2f6b4f"/>
      <circle cx="38" cy="25" r="9" fill="${C.body}"/>
      <path d="M44 22c8 0 12 3 12 7 0 3-3 4-6 3l-6-2z" fill="${C.beak}"/>
      <path d="M53 29c2 1 3 3 1 4-2 0-3-1-4-2z" fill="${C.beakTip}"/>
      <g class="w-eye"><circle cx="40" cy="22.5" r="2.1" fill="${C.dark}"/><circle cx="40.7" cy="21.8" r=".7" fill="#fff"/></g>
      <path d="M28 18c0-6 4-9 10-9s10 3 10 9z" fill="#6b5132"/><path d="M25 18h26" stroke="#4a3822" stroke-width="2.6" stroke-linecap="round"/>
    </g>
    <g class="w-leg w-leg-a"><path d="M27 52v6M24 58h6" stroke="${C.dark}" stroke-width="2.2" stroke-linecap="round"/></g>
    <g class="w-leg w-leg-b"><path d="M34 52v6M31 58h6" stroke="${C.dark}" stroke-width="2.2" stroke-linecap="round"/></g>
  </svg>`;
}
