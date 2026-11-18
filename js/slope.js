// Pente le long d'une trace : profil coloré (vert, jaune, orange, rouge) et annonce des tronçons à venir.
import { fmtKm, fmtM } from './util.js';

export const SLOPE = [
  { max: 4, color: '#4f9d5d', name: 'plat' },
  { max: 9, color: '#e3bd2f', name: 'pente douce' },
  { max: 15, color: '#ec8a2c', name: 'pente raide' },
  { max: Infinity, color: '#d4483c', name: 'très raide' },
];
const classOf = (pct) => SLOPE.findIndex((c) => Math.abs(pct) < c.max);

// Tronçons de pente homogène, lissés sur une centaine de mètres pour ne pas réagir au moindre bosselé.
export function slopeRuns(prof) {
  if (!prof || prof.length < 3) return [];
  const total = prof[prof.length - 1][0];
  const eleAt = (d) => {
    let i = 1;
    while (i < prof.length - 1 && prof[i][0] < d) i++;
    const [d0, e0] = prof[i - 1], [d1, e1] = prof[i];
    return d1 > d0 ? e0 + ((e1 - e0) * (d - d0)) / (d1 - d0) : e1;
  };
  const step = Math.max(100, Math.min(250, total / 45));
  const raw = [];
  for (let d = 0; d < total; d += step) {
    const e = Math.min(total, d + step);
    const de = eleAt(e) - eleAt(d);
    const pct = (de / (e - d)) * 100;
    raw.push({ from: d, to: e, pct, cls: classOf(pct), dir: Math.abs(pct) < 4 ? 0 : Math.sign(pct), de });
  }
  // Regroupe les pas consécutifs de même classe et de même sens ; un pas isolé rejoint ses voisins.
  const runs = [];
  for (const r of raw) {
    const p = runs[runs.length - 1];
    if (p && p.cls === r.cls && p.dir === r.dir) { p.to = r.to; p.de += r.de; }
    else runs.push({ ...r });
  }
  for (let i = 1; i < runs.length - 1; i++) {
    const r = runs[i];
    if (r.to - r.from <= step && runs[i - 1].cls === runs[i + 1].cls && runs[i - 1].dir === runs[i + 1].dir) {
      runs[i - 1].to = runs[i + 1].to; runs[i - 1].de += r.de + runs[i + 1].de;
      runs.splice(i, 2); i--;
    }
  }
  // Tronçons trop courts (un seul pas) : rattachés au voisin le plus proche en pente.
  for (let i = 0; i < runs.length && runs.length > 1; i++) {
    const r = runs[i];
    if (r.to - r.from > step * 1.01) continue;
    const L = runs[i - 1], R = runs[i + 1];
    const t = !L ? R : !R ? L : Math.abs(L.cls - r.cls) <= Math.abs(R.cls - r.cls) ? L : R;
    t.from = Math.min(t.from, r.from); t.to = Math.max(t.to, r.to); t.de += r.de;
    runs.splice(i, 1); i = Math.max(-1, i - 2);
  }
  for (const r of runs) { r.pct = (r.de / Math.max(1, r.to - r.from)) * 100; r.cls = classOf(r.pct); r.dir = Math.abs(r.pct) < 4 ? 0 : Math.sign(r.pct); }
  return runs;
}

// Profil en couleurs de pente. pos : mètres déjà parcourus (trait vertical et partie parcourue estompée).
export function slopeProfileSvg(prof, { pos = null, height = 74, cls = 'profile' } = {}) {
  if (!prof || prof.length < 3) return '';
  const W = 320, H = height, total = prof[prof.length - 1][0] || 1;
  let lo = Infinity, hi = -Infinity;
  for (const [, e] of prof) { if (e < lo) lo = e; if (e > hi) hi = e; }
  const span = Math.max(hi - lo, 40);
  const x = (d) => (d / total) * W, y = (e) => H - 12 - ((e - lo) / span) * (H - 22);
  const runs = slopeRuns(prof);
  const area = (from, to) => {
    const pts = prof.filter(([d]) => d >= from && d <= to);
    const at = (d) => { let i = 1; while (i < prof.length - 1 && prof[i][0] < d) i++; const [d0, e0] = prof[i - 1], [d1, e1] = prof[i]; return d1 > d0 ? e0 + ((e1 - e0) * (d - d0)) / (d1 - d0) : e1; };
    const all = [[from, at(from)], ...pts, [to, at(to)]];
    return all.map(([d, e], i) => (i ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(e).toFixed(1)).join('') + `L${x(to).toFixed(1)} ${H}L${x(from).toFixed(1)} ${H}Z`;
  };
  const fills = runs.map((r) => `<path d="${area(r.from, r.to)}" fill="${SLOPE[r.cls].color}" stroke="${SLOPE[r.cls].color}" stroke-width="1.2"/>`).join('');
  const line = prof.map(([d, e], i) => (i ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(e).toFixed(1)).join('');
  let mark = '';
  if (pos != null) {
    const px = x(Math.max(0, Math.min(total, pos)));
    mark = `<rect x="0" y="0" width="${px.toFixed(1)}" height="${H}" fill="rgba(255,255,255,.55)"/><line x1="${px.toFixed(1)}" y1="0" x2="${px.toFixed(1)}" y2="${H}" stroke="#14211b" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Profil altimétrique, de ${Math.round(lo)} à ${Math.round(hi)} mètres">${fills}<path d="${line}" fill="none" stroke="rgba(20,33,27,.65)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>${mark}</svg>`;
}

export const slopeLegend = () => `<p class="slope-legend">${SLOPE.map((c) => `<span><i style="background:${c.color}"></i>${c.name}</span>`).join('')}</p>`;

// Phrase pour un tronçon : « 1,2 km de montée raide (+140 m) ».
export function runText(r, len = r.to - r.from) {
  const l = len >= 1000 ? fmtKm(len) : fmtM(Math.round(len / 10) * 10);
  if (r.dir === 0) return `${l} de plat`;
  const kind = r.dir > 0 ? 'montée' : 'descente';
  const adj = r.cls >= 3 ? ' très raide' : r.cls === 2 ? ' raide' : ' douce';
  return `${l} de ${kind}${adj} (${r.dir > 0 ? '+' : '−'}${Math.round(Math.abs(r.de))} m)`;
}

// Ce qui vient à partir de `along` : le tronçon en cours (reste) et le suivant.
export function upcoming(runs, along) {
  const i = runs.findIndex((r) => r.to > along);
  if (i < 0) return { now: '', next: '' };
  const r = runs[i];
  const left = r.to - Math.max(along, r.from);
  const frac = left / Math.max(1, r.to - r.from);
  return {
    now: runText({ ...r, de: r.de * frac }, left),
    next: runs[i + 1] ? runText(runs[i + 1]) : '',
    cls: r.cls, nextCls: runs[i + 1] ? runs[i + 1].cls : null,
  };
}
