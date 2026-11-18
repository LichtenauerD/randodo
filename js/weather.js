// Météo d'une rando : trois modèles de prévision (Open-Meteo), au départ et au point haut, de J à J+7.
import { CONFIG } from './config.js';
import { fetchJson, cumulative, esc } from './util.js';

// Modèles interrogés : centre européen, service allemand, Météo-France (qui couvre aussi la Suisse).
const MODELS = [['ecmwf_ifs025', 'ECMWF'], ['icon_seamless', 'DWD'], ['meteofrance_seamless', 'Météo-France']];
const cache = new Map();

// Codes météo de l'OMS regroupés en cinq familles, du plus clément au plus mauvais.
function family(code) {
  if (code == null) return null;
  if (code <= 1) return 0; // ciel clair
  if (code <= 3) return 1; // nuages
  if (code <= 48) return 2; // brouillard
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return 4; // neige
  if (code >= 95) return 5; // orage
  return 3; // pluie, bruine, averses
}
const LABELS = ['Grand beau', 'Éclaircies', 'Brouillard', 'Pluie', 'Neige', 'Orages'];
const ICONS = [
  '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  '<circle cx="8" cy="9" r="3.2"/><path d="M8 3v1.3M3 9H1.7M3.8 4.8l.9.9"/><path d="M8.5 19h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 8.5 19z"/>',
  '<path d="M3 9h18M5 13h14M3 17h18"/>',
  '<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  '<path d="M7 14h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/>',
  '<path d="M7 14h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z"/><path d="M12 14l-2 4h3l-2 4"/>',
];
const icon = (f) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[f]}</svg>`;

// Départ et point haut de la trace, avec leur altitude.
function points(h) {
  const s = h.pts[0];
  let top = null;
  if (h.prof && h.prof.length) {
    const best = h.prof.reduce((a, b) => (b[1] > a[1] ? b : a));
    const cum = cumulative(h.pts);
    let i = cum.findIndex((d) => d >= best[0]);
    if (i < 0) i = h.pts.length - 1;
    const startEle = h.prof[0][1];
    if (best[1] - startEle >= 150) top = { lat: h.pts[i][0], lon: h.pts[i][1], ele: best[1] };
    return [{ lat: s[0], lon: s[1], ele: startEle }, top];
  }
  return [{ lat: s[0], lon: s[1], ele: null }, null];
}

async function forecast(pts) {
  const key = pts.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join(';');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60000) return hit.data;
  const u = new URL(CONFIG.forecast);
  u.search = new URLSearchParams({
    latitude: pts.map((p) => p.lat.toFixed(4)).join(','),
    longitude: pts.map((p) => p.lon.toFixed(4)).join(','),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max',
    models: MODELS.map((m) => m[0]).join(','),
    timezone: 'Europe/Paris', forecast_days: '8',
  });
  if (pts.every((p) => p.ele != null)) u.searchParams.set('elevation', pts.map((p) => Math.round(p.ele)).join(','));
  let data = await fetchJson(u.toString(), {}, 15000);
  if (!Array.isArray(data)) data = [data];
  cache.set(key, { t: Date.now(), data });
  return data;
}

// Valeurs des trois modèles pour un jour donné ; on ne garde que les modèles qui ont répondu.
function pick(loc, day, v) {
  return MODELS.map(([m]) => { const a = loc.daily[`${v}_${m}`]; return a ? a[day] : null; }).filter((x) => x != null && !Number.isNaN(x));
}
const range = (xs, unit, round = Math.round) => {
  if (!xs.length) return '—';
  const lo = round(Math.min(...xs)), hi = round(Math.max(...xs));
  return lo === hi ? `${lo} ${unit}` : `${lo} à ${hi} ${unit}`;
};

function summary(loc, day) {
  const codes = pick(loc, day, 'weather_code').map(family);
  const tmin = pick(loc, day, 'temperature_2m_min'), tmax = pick(loc, day, 'temperature_2m_max');
  const rain = pick(loc, day, 'precipitation_sum'), wind = pick(loc, day, 'wind_speed_10m_max');
  if (!codes.length) return null;
  // Le temps le plus défavorable l'emporte : mieux vaut prévoir la veste pour rien.
  const worst = Math.max(...codes), best = Math.min(...codes);
  const agree = worst - best <= 1 && (Math.max(...rain) - Math.min(...rain) < 4);
  return { fam: worst, codes, tmin, tmax, rain, wind, agree, n: codes.length };
}

export function dayLabels() {
  const out = [], d = new Date();
  for (let i = 0; i < 8; i++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const wd = x.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
    out.push({ i, top: i === 0 ? "Auj." : i === 1 ? 'Dem.' : wd, num: x.getDate() });
  }
  return out;
}

// Bloc météo de la fiche ; le jour choisi est gardé d'une fiche à l'autre (remis à aujourd'hui chaque jour).
export function weatherHtml() {
  return `<section class="wx" id="wx"><div class="wx-head"><h3>Météo</h3><span class="wx-src">3 modèles</span></div>
    <div class="wx-days" role="tablist">${dayLabels().map((d) => `<button type="button" role="tab" data-d="${d.i}"><span>${d.top}</span><b>${d.num}</b></button>`).join('')}</div>
    <div class="wx-body" id="wx-body"><div class="loading"><span class="spin"></span>Prévisions…</div></div></section>`;
}

export async function bindWeather(h, root, storeDay) {
  const box = root.querySelector('#wx');
  if (!box) return;
  const [start, top] = points(h);
  const pts = top ? [start, top] : [start];
  let day = Math.max(0, Math.min(7, storeDay.get()));
  const days = [...box.querySelectorAll('.wx-days button')];
  const paint = (data) => {
    days.forEach((b) => b.classList.toggle('on', +b.dataset.d === day));
    const s0 = summary(data[0], day), s1 = data[1] ? summary(data[1], day) : null;
    if (!s0) { box.querySelector('#wx-body').innerHTML = '<p class="note">Pas de prévision pour ce jour.</p>'; return; }
    const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    const line = (label, s, ele) => `<div class="wx-row"><span class="wx-where">${label}${ele != null ? ` <small>${Math.round(ele)} m</small>` : ''}</span><span class="wx-t"><i>${avg(s.tmin)}°</i><span class="wx-bar"></span><b>${avg(s.tmax)}°</b></span></div>`;
    const rainMax = Math.max(...s0.rain, ...(s1 ? s1.rain : []));
    const windMax = Math.max(...s0.wind, ...(s1 ? s1.wind : []));
    const fam = s1 ? Math.max(s0.fam, s1.fam) : s0.fam;
    const tips = [];
    if (rainMax >= 2) tips.push(`${fam === 4 ? 'neige' : 'pluie'} : ${range([...s0.rain, ...(s1 ? s1.rain : [])], 'mm', (x) => Math.round(x))}`);
    if (windMax >= 40) tips.push(`vent jusqu'à ${Math.round(windMax)} km/h${s1 ? ' en hauteur' : ''}`);
    if (s1 && Math.min(...s1.tmin) <= 0) tips.push('gel possible en haut');
    const agree = s0.agree && (!s1 || s1.agree);
    box.querySelector('#wx-body').innerHTML = `<div class="wx-main f${fam}"><span class="wx-ic">${icon(fam)}</span><b>${LABELS[fam]}</b></div>
      ${line('Au départ', s0, pts[0].ele)}${s1 ? line('Au point haut', s1, pts[1].ele) : ''}
      ${tips.length ? `<p class="wx-tips">${esc(tips.join(' · ').replace(/^./, (c) => c.toUpperCase()))}</p>` : ''}
      <p class="wx-agree ${agree ? 'ok' : 'warn'}">${agree ? `Les ${s0.n} modèles sont d'accord.` : 'Les modèles ne sont pas d\'accord : à revérifier la veille.'}${day >= 4 ? ' Au-delà de 3 jours, la prévision reste indicative.' : ''}</p>`;
  };
  try {
    const data = await forecast(pts);
    days.forEach((b) => { b.onclick = () => { day = +b.dataset.d; storeDay.set(day); paint(data); }; });
    paint(data);
  } catch {
    box.querySelector('#wx-body').innerHTML = '<p class="note">Météo indisponible pour le moment (pas de réseau ?).</p>';
  }
}
