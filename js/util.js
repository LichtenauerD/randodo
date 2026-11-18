// Outils communs : géométrie, réseau, stockage.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function dist(a, b) {
  // a, b : [lat, lon] ; distance en mètres.
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function lineLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
  return d;
}

export function bboxOf(pts, padMeters = 0) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const p of pts) {
    if (p[0] < s) s = p[0];
    if (p[0] > n) n = p[0];
    if (p[1] < w) w = p[1];
    if (p[1] > e) e = p[1];
  }
  if (padMeters) {
    const dLat = padMeters / 111320;
    const dLon = padMeters / (111320 * Math.cos(rad((s + n) / 2)));
    s -= dLat; n += dLat; w -= dLon; e += dLon;
  }
  return { s, w, n, e };
}

export function aroundBox(lat, lon, meters) {
  return bboxOf([[lat, lon]], meters);
}

// Projection locale en mètres autour d'un point de référence (suffisant à l'échelle d'une rando).
export function projector(lat0) {
  const kx = 111320 * Math.cos(rad(lat0));
  const ky = 110574;
  return (p) => [p[1] * kx, p[0] * ky];
}

// Point le plus proche sur un tracé. Renvoie { d, i, t, along, point }.
export function nearestOnLine(pts, cum, p) {
  const proj = projector(p[0]);
  const [px, py] = proj(p);
  let best = { d: Infinity, i: 0, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = proj(pts[i]);
    const [bx, by] = proj(pts[i + 1]);
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = ax + t * vx - px, dy = ay + t * vy - py;
    const d = Math.hypot(dx, dy);
    if (d < best.d) best = { d, i, t };
  }
  const a = pts[best.i], b = pts[Math.min(best.i + 1, pts.length - 1)];
  best.point = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t];
  best.along = cum ? cum[best.i] + (cum[Math.min(best.i + 1, cum.length - 1)] - cum[best.i]) * best.t : 0;
  return best;
}

export function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return cum;
}

// Rééchantillonne un tracé tous les `step` mètres (garde le premier et le dernier point).
export function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = dist(a, b);
    if (d === 0) continue;
    let pos = step - carry;
    while (pos < d) {
      const t = pos / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      pos += step;
    }
    carry = d - (pos - step);
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  if (prev[0] !== last[0] || prev[1] !== last[1]) out.push(last);
  return out;
}

// Simplification Douglas-Peucker, tolérance en mètres.
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const proj = projector(pts[0][0]);
  const xy = pts.map(proj);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const vx = bx - ax, vy = by - ay;
    const len = Math.hypot(vx, vy);
    for (let i = a + 1; i < b; i++) {
      // Boucle ou aller-retour : les deux extrémités se confondent, on mesure alors l'éloignement au point de départ.
      const d = len < 0.5 ? Math.hypot(xy[i][0] - ax, xy[i][1] - ay) : Math.abs((xy[i][0] - ax) * vy - (xy[i][1] - ay) * vx) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function fmtKm(m) {
  const km = m / 1000;
  return (km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace('.', ',') + ' km';
}
export function fmtM(m) {
  return m < 1000 ? Math.round(m / 10) * 10 + ' m' : fmtKm(m);
}
export function fmtDur(min) {
  const h = Math.floor(min / 60), m = Math.round((min % 60) / 5) * 5;
  if (m === 60) return h + 1 + ' h';
  if (!h) return m + ' min';
  return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
}
// Temps de marche : formule des panneaux de randonnée (4 km/h à plat, 300 m/h en montée, 500 m/h en descente).
// Temps de marche sans les pauses : 4 km/h à plat, 400 m/h en montée, 800 m/h en descente.
export function walkMinutes(meters, up, down) {
  const horiz = meters / 4000;
  const vert = up / 400 + down / 800;
  return (Math.max(horiz, vert) + Math.min(horiz, vert) / 2) * 60;
}

export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function fetchJson(url, opts = {}, timeout = 30000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Stockage : IndexedDB en clé/valeur, avec repli en mémoire ----------
let dbPromise;
const mem = new Map();
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open('randodo', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}
function tx(mode, fn) {
  return openDb().then((db) => {
    if (!db) { const r = fn(null); return r ? r.result : undefined; }
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', mode);
      const store = t.objectStore('kv');
      const req = fn(store);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  });
}
export const kv = {
  async get(key) {
    try { return await tx('readonly', (s) => (s ? s.get(key) : { result: mem.get(key) })); } catch { return mem.get(key); }
  },
  async set(key, val) {
    try { await tx('readwrite', (s) => (s ? s.put(val, key) : (mem.set(key, val), null))); } catch { mem.set(key, val); }
  },
  async del(key) {
    try { await tx('readwrite', (s) => (s ? s.delete(key) : (mem.delete(key), null))); } catch { mem.delete(key); }
  },
  async keys(prefix = '') {
    try {
      const all = await tx('readonly', (s) => (s ? s.getAllKeys() : { result: [...mem.keys()] }));
      return (all || []).filter((k) => String(k).startsWith(prefix));
    } catch { return [...mem.keys()].filter((k) => String(k).startsWith(prefix)); }
  },
};

export const settings = {
  get(key, def) {
    try { const v = localStorage.getItem('randodo.' + key); return v === null ? def : JSON.parse(v); } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('randodo.' + key, JSON.stringify(val)); } catch { /* stockage indisponible */ }
  },
};

export function toast(msg, ms = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('on'), ms);
}

// Nom de fichier stable pour un lieu du catalogue (randos précalculées).
export function slugOf(name) {
  return norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Fenêtre du bas : croix en haut à gauche et glisser vers le bas pour fermer.
export function modalChrome(box, close) {
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'mx'; x.setAttribute('aria-label', 'Fermer');
  x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  x.onclick = close;
  box.prepend(x);
  box.classList.add('has-x');
  let y0 = null, dy = 0;
  const scroller = (t) => (t.closest && t.closest('.profile')) || box;
  box.addEventListener('touchstart', (e) => { y0 = scroller(e.target).scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { box.style.transform = `translateY(${dy}px)`; box.style.transition = 'none'; if (e.cancelable) e.preventDefault(); } else { y0 = null; box.style.transform = ''; }
  }, { passive: false });
  box.addEventListener('touchend', () => {
    if (y0 == null) return;
    box.style.transition = 'transform .2s';
    if (dy > 110) { box.style.transform = 'translateY(100%)'; setTimeout(close, 180); } else box.style.transform = '';
    y0 = null;
  });
}
