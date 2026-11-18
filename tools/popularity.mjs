// Notoriété de chaque lieu : vues des articles Wikipédia (fr, de, en) sur les 12 derniers mois.
// Un lieu sans article, ou presque jamais consulté, est un lieu dont personne ne parle : idéal en baroudeur.
// Sortie : data/popularity.js
import { writeFile } from 'node:fs/promises';

globalThis.location = new URL('http://localhost/');
const { SITES } = await import('../data/sites.js');
const { slugOf } = await import('../js/util.js');
const UA = 'Randodo/1.6 (+https://github.com/LichtenauerD/randodo; dorian)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => {
  for (let k = 0; k < 3; k++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (r.ok) return r.json(); if (r.status === 404) return null; } catch { /* nouvel essai */ }
    await sleep(1500 * (k + 1));
  }
  return null;
};
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'lac', 'col', 'see', 'der', 'die', 'das', 'am', 'im', 'von', 'zu', 'et', 'chateau', 'burg', 'ruine', 'cascade', 'wasserfall', 'grotte', 'rocher', 'roche', 'tourbiere', 'moor', 'sentier', 'the', 'of', 'mont', 'berg', 'saut', 'gorges', 'schlucht']);
const words = (s) => norm(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const km = (a, b) => { const r = Math.PI / 180; const x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.hypot(x, y) * 6371; };

const end = new Date(); end.setUTCDate(1); end.setUTCDate(0); // dernier jour du mois écoulé
const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 11); start.setUTCDate(1);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

async function articleOn(lang, p) {
  const api = `https://${lang}.wikipedia.org/w/api.php?format=json&origin=*`;
  const want = words(p.name);
  // 1. Le titre exact (avec redirections), s'il est situé près du lieu.
  const t = await get(`${api}&action=query&redirects=1&prop=coordinates&titles=${encodeURIComponent(p.name)}`);
  const pg = t && t.query && Object.values(t.query.pages || {})[0];
  if (pg && !('missing' in pg) && pg.coordinates && km(p, pg.coordinates[0]) < 6) return pg.title;
  // 2. Les articles situés à moins de 2 km, dont le titre partage un mot fort avec le nom.
  const g = await get(`${api}&action=query&list=geosearch&gsradius=2000&gslimit=15&gscoord=${p.lat}|${p.lon}`);
  for (const a of (g && g.query && g.query.geosearch) || []) {
    const w = words(a.title);
    if (want.some((x) => w.includes(x))) return a.title;
  }
  return null;
}

async function views(lang, title) {
  const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${ymd(start)}00/${ymd(end)}00`;
  const j = await get(u);
  return j && j.items ? j.items.reduce((s, i) => s + i.views, 0) : 0;
}

const out = {}, found = {};
for (const p of SITES) {
  let total = 0; const arts = [];
  for (const lang of ['fr', 'de', 'en']) {
    const t = await articleOn(lang, p);
    if (t) { const v = await views(lang, t); total += v; arts.push(`${lang}:${t}=${v}`); }
    await sleep(120);
  }
  out[slugOf(p.name)] = total; found[p.name] = arts;
  console.log(`${p.name} : ${total}  ${arts.join(' | ')}`);
}
const sorted = Object.values(out).sort((a, b) => a - b);
const cut = sorted[Math.floor(sorted.length * 0.3)];
await writeFile('data/popularity.js', `// Vues Wikipédia (fr, de, en) sur 12 mois, ${ymd(start)}–${ymd(end)}. Généré par tools/popularity.mjs.\n// Sous le seuil LOW (30 % des lieux les moins vus) : lieu peu connu.\nexport const LOW = ${cut};\nexport const POP = ${JSON.stringify(out)};\n`);
console.log(`seuil : ${cut} vues ; ${sorted.filter((v) => v <= cut).length} lieux peu connus sur ${sorted.length}`);
