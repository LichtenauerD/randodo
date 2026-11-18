// Fond de carte peint d'un secteur, façon carte de jeu : occupation du sol ESA WorldCover (10 m, lue à environ 120 m),
// ombrage du relief tiré du modèle de terrain, zone du secteur mise en valeur. Sortie : une image WebP et le contour de la zone.
import { fromUrl } from 'geotiff';
import { contours } from 'd3-contour';
import sharp from 'sharp';
import { elevationAt } from './dem.mjs';

const WC = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif';
// Couleurs par classe WorldCover : aplats francs, sans désert.
const PAL = {
  0: [176, 208, 120], 10: [86, 140, 64], 20: [140, 178, 92], 30: [174, 210, 112], 40: [214, 214, 140], 50: [205, 190, 172],
  60: [186, 178, 166], 70: [244, 247, 250], 80: [111, 178, 220], 90: [126, 172, 140], 95: [86, 140, 64], 100: [184, 196, 154],
};
const wcTile = (lat, lon) => { const la = Math.floor(lat / 3) * 3, lo = Math.floor(lon / 3) * 3; return `${la >= 0 ? 'N' : 'S'}${String(Math.abs(la)).padStart(2, '0')}${lo >= 0 ? 'E' : 'W'}${String(Math.abs(lo)).padStart(3, '0')}`; };
const demTile = (lat, lon) => `${Math.floor(lat)}_${Math.floor(lon)}`;

async function landClasses(b, W, H, dx, dy) {
  const cls = new Uint8Array(W * H);
  const tiles = new Set();
  for (let la = Math.floor(b[1] / 3) * 3; la < b[3]; la += 3) for (let lo = Math.floor(b[0] / 3) * 3; lo < b[2]; lo += 3) tiles.add([la, lo]);
  for (const [la, lo] of tiles) {
    const i0 = Math.max(0, Math.ceil((lo - b[0]) / dx - 0.5)), i1 = Math.min(W, Math.ceil((lo + 3 - b[0]) / dx - 0.5));
    const j0 = Math.max(0, Math.ceil((b[3] - (la + 3)) / dy - 0.5)), j1 = Math.min(H, Math.ceil((b[3] - la) / dy - 0.5));
    if (i1 <= i0 || j1 <= j0) continue;
    const name = wcTile(la + 1, lo + 1);
    try {
      const tiff = await fromUrl(WC.replace('{t}', name), { allowFullFile: false });
      const bbox = [b[0] + i0 * dx, b[3] - j1 * dy, b[0] + i1 * dx, b[3] - j0 * dy];
      const [r] = await tiff.readRasters({ bbox, width: i1 - i0, height: j1 - j0, resampleMethod: 'nearest' });
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) cls[j * W + i] = r[(j - j0) * (i1 - i0) + (i - i0)];
      console.log(`  occupation du sol ${name} : ${(i1 - i0) * (j1 - j0)} points`);
    } catch (e) { console.log(`  occupation du sol ${name} indisponible : ${e.message}`); }
  }
  // Filtre majoritaire 5 × 5 : des taches franches plutôt qu'un bruit de pixels.
  const out = new Uint8Array(W * H);
  const cnt = new Map();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    cnt.clear(); let best = cls[j * W + i], bn = 0;
    for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) {
      const x = i + u, y = j + v; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const c = cls[y * W + x]; const n = (cnt.get(c) || 0) + 1; cnt.set(c, n); if (n > bn) { bn = n; best = c; }
    }
    // L'eau et le bâti restent nets même petits.
    const c0 = cls[j * W + i];
    out[j * W + i] = (c0 === 80 || c0 === 50) && (cnt.get(c0) || 0) >= 6 ? c0 : best;
  }
  return out;
}

async function heights(b, W, H, dx, dy) {
  const z = new Float32Array(W * H);
  const groups = new Map();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = demTile(b[3] - (j + 0.5) * dy, b[0] + (i + 0.5) * dx);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(j * W + i);
  }
  for (const idx of groups.values()) for (const p of idx) {
    const i = p % W, j = (p - i) / W;
    const e = await elevationAt(b[3] - (j + 0.5) * dy, b[0] + (i + 0.5) * dx);
    z[p] = e == null || !isFinite(e) ? 0 : e;
  }
  return z;
}

// Zone du secteur : tout ce qui est à moins de R km d'un lieu, lissé.
function zoneMask(b, W, H, dx, dy, places, km = 9) {
  const m = new Float64Array(W * H);
  const kx = 111.32 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180), ky = 111.32;
  for (const p of places) {
    const ci = (p.lon - b[0]) / dx, cj = (b[3] - p.lat) / dy, ri = Math.ceil(km / (kx * dx)) + 1, rj = Math.ceil(km / (ky * dy)) + 1;
    for (let j = Math.max(0, Math.floor(cj - rj)); j < Math.min(H, cj + rj); j++) for (let i = Math.max(0, Math.floor(ci - ri)); i < Math.min(W, ci + ri); i++) {
      const d = Math.hypot((i + 0.5 - ci) * dx * kx, (j + 0.5 - cj) * dy * ky);
      if (d < km) m[j * W + i] = Math.max(m[j * W + i], 1 - d / km * 0.5);
    }
  }
  return m;
}

export async function paintSector(sector, b, places, ring) {
  const maxPx = 1600;
  const kx = Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180);
  const wKm = (b[2] - b[0]) * kx, hKm = b[3] - b[1];
  const W = wKm >= hKm ? maxPx : Math.round(maxPx * wKm / hKm), H = wKm >= hKm ? Math.round(maxPx * hKm / wKm) : maxPx;
  const dx = (b[2] - b[0]) / W, dy = (b[3] - b[1]) / H;
  console.log(`  fond peint : ${W} × ${H} px (${Math.round(dy * 111320)} m par point)`);
  const cls = await landClasses(b, W, H, dx, dy);
  const z = await heights(b, W, H, dx, dy);
  const zone = zoneMask(b, W, H, dx, dy, places);
  // Ombrage : lumière du nord-ouest, relief un peu exagéré pour la lecture.
  const cell = dy * 111320, ex = 1.6, az = 135 * Math.PI / 180 /* azimut 315°, converti en angle mathématique */, alt = 45 * Math.PI / 180;
  const rgb = Buffer.alloc(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    const zz = (x, y) => z[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    const gx = ((zz(i + 1, j - 1) + 2 * zz(i + 1, j) + zz(i + 1, j + 1)) - (zz(i - 1, j - 1) + 2 * zz(i - 1, j) + zz(i - 1, j + 1))) / (8 * cell) * ex;
    const gy = ((zz(i - 1, j + 1) + 2 * zz(i, j + 1) + zz(i + 1, j + 1)) - (zz(i - 1, j - 1) + 2 * zz(i, j - 1) + zz(i + 1, j - 1))) / (8 * cell) * ex;
    const slope = Math.atan(Math.hypot(gx, gy)), aspect = Math.atan2(gy, -gx);
    let hs = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect);
    hs = Math.max(0, hs);
    let c = PAL[cls[p]] || PAL[0];
    // Neige sur les plus hauts sommets seulement (au-dessus de 2 600 m), roche au-dessus de 2 200 m.
    if (z[p] > 2600 && cls[p] !== 80) c = PAL[70]; else if (z[p] > 2200 && cls[p] !== 80 && cls[p] !== 70) c = PAL[60];
    const shade = cls[p] === 80 ? 1 : 0.62 + 0.58 * hs;
    const zf = zone[p] > 0 ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      let v = c[k] * shade;
      if (!zf) v = v * 0.55 + 236 * 0.45; // hors zone : voilé
      rgb[p * 3 + k] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  const file = `data/geo/${sector}.webp`;
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 74, effort: 6 }).toFile(file);
  // Contour de la zone, en [lon, lat].
  const [c] = contours().size([W, H]).thresholds([0.25])(Array.from(zone));
  const toLL = ([x, y]) => [b[0] + x * dx, b[3] - y * dy];
  const outline = c.coordinates.map((poly) => poly.map((r) => ring(r.map(toLL), 0.003)).filter(Boolean)).filter((p) => p.length);
  return { image: `data/geo/${sector}.webp`, outline };
}
