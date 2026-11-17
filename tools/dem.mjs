// Altitudes tirées du modèle de terrain Copernicus GLO-30 (30 m), dalles publiques sur AWS.
// Utilisé par le calcul hebdomadaire à la place du service en ligne, qui bride les serveurs de GitHub.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fromFile } from 'geotiff';

const DIR = process.env.DEM_DIR || 'dem';
const BASE = process.env.DEM_BASE || 'https://copernicus-dem-30m.s3.amazonaws.com';
const tiles = new Map(); // nom -> Promise<{ data, w, h, x0, y0, dx, dy } | null>
const order = [];

function tileName(lat, lon) {
  const la = Math.floor(lat), lo = Math.floor(lon);
  const ns = (la >= 0 ? 'N' : 'S') + String(Math.abs(la)).padStart(2, '0');
  const ew = (lo >= 0 ? 'E' : 'W') + String(Math.abs(lo)).padStart(3, '0');
  return `Copernicus_DSM_COG_10_${ns}_00_${ew}_00_DEM`;
}

async function load(name) {
  const file = join(DIR, name + '.tif');
  try { await access(file); } catch {
    await mkdir(DIR, { recursive: true });
    const res = await fetch(`${BASE}/${name}/${name}.tif`);
    if (!res.ok) throw new Error(`dalle ${name} : HTTP ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const tiff = await fromFile(file);
  const img = await tiff.getImage();
  const [x0, , , y1] = img.getBoundingBox();
  const w = img.getWidth(), h = img.getHeight();
  const [dx, dy] = img.getResolution();
  const [data] = await img.readRasters();
  return { data, w, h, x0, y0: y1, dx, dy: Math.abs(dy) };
}

function tile(name) {
  if (!tiles.has(name)) {
    tiles.set(name, load(name).catch((e) => { console.log('  ' + e.message); return null; }));
    order.push(name);
    // Trois dalles en mémoire au plus (≈ 50 Mo chacune).
    while (order.length > 3) tiles.delete(order.shift());
  }
  return tiles.get(name);
}

// Altitude par interpolation bilinéaire ; null hors dalle.
export async function elevationAt(lat, lon) {
  const t = await tile(tileName(lat, lon));
  if (!t) return null;
  const fx = (lon - t.x0) / t.dx - 0.5, fy = (t.y0 - lat) / t.dy - 0.5;
  const x = Math.max(0, Math.min(t.w - 2, Math.floor(fx))), y = Math.max(0, Math.min(t.h - 2, Math.floor(fy)));
  const ax = Math.min(1, Math.max(0, fx - x)), ay = Math.min(1, Math.max(0, fy - y));
  const v = (i, j) => t.data[j * t.w + i];
  const top = v(x, y) * (1 - ax) + v(x + 1, y) * ax, bot = v(x, y + 1) * (1 - ax) + v(x + 1, y + 1) * ax;
  return top * (1 - ay) + bot * ay;
}

export async function elevations(points) {
  const out = [];
  for (const [la, lo] of points) out.push(await elevationAt(la, lo));
  if (out.some((e) => e === null || !isFinite(e))) throw new Error('altitudes indisponibles (modèle de terrain)');
  return out.map((e) => Math.round(e * 10) / 10);
}
