// Précalcule les randos des lieux du catalogue (data/sites.js) dans data/hikes/.
// Lancé chaque semaine par GitHub Actions (.github/workflows/randos.yml), ou à la main : node tools/precompute.mjs
// Variables : MOCK=http://127.0.0.1:8765 (tests), ONLY=nom1,nom2, LIMIT=5, PAUSE=6000 (ms entre deux lieux).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.location = new URL(process.env.MOCK ? `http://localhost/?mock=${process.env.MOCK}` : 'http://localhost/');
if (!process.env.MOCK && process.env.DEM !== '0') {
  const { elevations } = await import('./dem.mjs');
  globalThis.__elevations = elevations;
}
const { SITES } = await import('../data/sites.js');
const { hikesFor } = await import('../js/hikes.js');
const { slugOf } = await import('../js/util.js');

const outDir = join(root, 'data', 'hikes');
await mkdir(outDir, { recursive: true });
const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const limit = +process.env.LIMIT || Infinity;
const pause = process.env.PAUSE ? +process.env.PAUSE : 6000;
// Budget de temps : on s'arrête proprement avant la limite de GitHub, pour que le travail fait soit enregistré.
const budget = (process.env.BUDGET_MIN ? +process.env.BUDGET_MIN : 300) * 60000;
const started = Date.now();
const round = (pts) => pts.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);

let index = {};
try { index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8')); } catch { /* premier passage */ }

let done = 0, failed = 0;
// Les lieux sans fichier passent d'abord, puis les plus anciens : chaque passage avance là où le précédent s'est arrêté.
let dates = {};
try { dates = JSON.parse(await readFile(join(outDir, 'dates.json'), 'utf8')); } catch { /* premier passage */ }
const age = (s) => dates[slugOf(s.name)] || '';
const order = SITES.slice().sort((a, b) => (age(a) < age(b) ? -1 : age(a) > age(b) ? 1 : 0));
for (const site of order) {
  if (Date.now() - started > budget) { console.log('Budget de temps atteint : la suite au prochain passage.'); break; }
  if (only.length && !only.includes(site.name)) continue;
  if (done + failed >= limit) break;
  const slug = slugOf(site.name);
  const t0 = Date.now();
  try {
    const r = await hikesFor(site, () => {}, true);
    if (!r.hikes.length || r.noEle) throw new Error(r.reason || 'altitudes indisponibles');
    // Sortie identique d'une semaine à l'autre si les sentiers n'ont pas changé : GitHub ne garde alors rien de nouveau.
    r.hikes.forEach((h, i) => { h.id = `${slug}-${i + 1}`; });
    for (const h of r.hikes) {
      h.pts = round(h.pts);
      h.corridor = null; // les sentiers voisins se chargent à la demande (Garder hors ligne, Suivre)
    }
    const data = { v: r.v, hikes: r.hikes, passing: r.passing, partial: r.partial, reason: r.reason, noEle: false };
    await writeFile(join(outDir, slug + '.json'), JSON.stringify(data));
    dates[slug] = new Date().toISOString().slice(0, 10);
    index[slug] = r.hikes.map((h) => ({ level: h.level, km: +(h.meters / 1000).toFixed(1), up: h.up, min: h.minutes }));
    done++;
    console.log(`ok   ${site.name} : ${r.hikes.length} randos (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } catch (e) {
    failed++;
    console.log(`raté ${site.name} : ${e.message}${e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''}`);
  }
  if (pause) await new Promise((res) => setTimeout(res, pause));
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index));
  await writeFile(join(outDir, 'dates.json'), JSON.stringify(dates));
}
await writeFile(join(outDir, 'index.json'), JSON.stringify(index));
console.log(`${done} lieux calculés, ${failed} ratés.`);
