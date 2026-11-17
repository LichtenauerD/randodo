// Altitudes le long d'un tracé (modèle de terrain à 90 m, donc valeurs approchées).
import { CONFIG } from './config.js';
import { resample, cumulative, fetchJson, walkMinutes } from './util.js';

export async function profile(pts) {
  const total = cumulative(pts);
  const len = total[total.length - 1];
  const step = Math.max(70, len / 300);
  const samples = resample(pts, step);
  const ele = [];
  for (let i = 0; i < samples.length; i += 100) {
    const chunk = samples.slice(i, i + 100);
    const url = CONFIG.elevation + '?latitude=' + chunk.map((p) => p[0].toFixed(5)).join(',') + '&longitude=' + chunk.map((p) => p[1].toFixed(5)).join(',');
    let json, err;
    // Le service d'altitude répond parfois 429 ou 503 quand il est chargé : trois essais espacés.
    for (const wait of [0, 2500, 6000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try { json = await fetchJson(url, {}, 20000); break; } catch (e) { err = e; }
    }
    if (!json) throw err;
    if (!json || !Array.isArray(json.elevation)) throw new Error('altitudes indisponibles');
    ele.push(...json.elevation);
  }
  return summarize(samples, ele, len);
}

export function summarize(samples, ele, len) {
  // Lissage léger puis seuil de 4 m : évite de compter le bruit du modèle de terrain comme du dénivelé.
  const sm = ele.map((_, i) => {
    const a = ele[Math.max(0, i - 1)], b = ele[i], c = ele[Math.min(ele.length - 1, i + 1)];
    return (a + 2 * b + c) / 4;
  });
  let up = 0, down = 0, ref = sm[0], min = Infinity, max = -Infinity;
  for (const e of sm) {
    if (e < min) min = e;
    if (e > max) max = e;
    const d = e - ref;
    if (d > 4) { up += d; ref = e; } else if (d < -4) { down -= d; ref = e; }
  }
  const cum = cumulative(samples);
  return {
    up: Math.round(up), down: Math.round(down), min: Math.round(min), max: Math.round(max),
    minutes: walkMinutes(len, up, down), meters: len,
    // Profil compact : distance cumulée (m) et altitude (m).
    prof: sm.map((e, i) => [Math.round(cum[i]), Math.round(e)]),
  };
}

// Altitude interpolée à une distance donnée le long du tracé.
export function eleAt(prof, along) {
  if (!prof || !prof.length) return null;
  let lo = 0, hi = prof.length - 1;
  if (along <= prof[0][0]) return prof[0][1];
  if (along >= prof[hi][0]) return prof[hi][1];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (prof[mid][0] <= along) lo = mid; else hi = mid;
  }
  const t = (along - prof[lo][0]) / (prof[hi][0] - prof[lo][0] || 1);
  return prof[lo][1] + (prof[hi][1] - prof[lo][1]) * t;
}

// Montée restante à partir d'une distance donnée.
export function upAfter(prof, along) {
  let up = 0, ref = null;
  for (const [d, e] of prof) {
    if (d < along) continue;
    if (ref === null) { ref = e; continue; }
    if (e - ref > 4) { up += e - ref; ref = e; } else if (e - ref < -4) ref = e;
  }
  return Math.round(up);
}
