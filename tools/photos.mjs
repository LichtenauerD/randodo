// Photos candidates pour chaque lieu du catalogue, prises sur Wikimedia Commons (licences libres).
// Jusqu'à 3 par lieu : l'image principale Wikidata, puis les photos géolocalisées les plus proches du lieu.
// Sortie : photo-candidates/<slug>-<n>.jpg (800 px) et photo-candidates/index.json (auteur, licence, lien).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

globalThis.location = new URL('http://localhost/');
const { SITES } = await import('../data/sites.js');
const { slugOf } = await import('../js/util.js');
const UA = 'Randodo/1.6 (+https://github.com/LichtenauerD/randodo)';
const OUT = 'photo-candidates';
await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const api = (host, params) => get(`https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', origin: '*', ...params }));
const strip = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

async function mainImage(site) {
  // Article Wikipédia le plus proche dont le titre ressemble au nom, puis son image Wikidata (P18).
  for (const lang of site.country === 'DE' ? ['de', 'fr'] : ['fr', 'de']) {
    const g = await api(`${lang}.wikipedia.org`, { action: 'query', list: 'geosearch', gscoord: `${site.lat}|${site.lon}`, gsradius: '1500', gslimit: '15' }).catch(() => null);
    const words = site.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !['cascade', 'cascades', 'chateau', 'rocher', 'rochers', 'gorges', 'belvedere', 'tourbiere'].includes(w));
    const hit = (g && g.query ? g.query.geosearch : []).find((p) => { const t = p.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return words.some((w) => t.includes(w)); });
    if (!hit) continue;
    const pp = await api(`${lang}.wikipedia.org`, { action: 'query', prop: 'pageprops', pageids: String(hit.pageid) }).catch(() => null);
    const qid = pp && pp.query.pages[hit.pageid].pageprops && pp.query.pages[hit.pageid].pageprops.wikibase_item;
    if (!qid) continue;
    const wd = await get(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`).catch(() => null);
    const p18 = wd && wd.entities[qid].claims.P18;
    if (p18) return { file: 'File:' + p18[0].mainsnak.datavalue.value, from: `wikidata ${qid} (${lang}: ${hit.title})` };
  }
  return null;
}

async function nearbyFiles(site, n) {
  const g = await api('commons.wikimedia.org', { action: 'query', list: 'geosearch', gscoord: `${site.lat}|${site.lon}`, gsradius: '700', gslimit: '30', gsnamespace: '6' }).catch(() => null);
  const list = g && g.query ? g.query.geosearch : [];
  return list.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.title)).slice(0, n).map((f) => ({ file: f.title, from: `proche (${Math.round(f.dist)} m)` }));
}

async function info(file) {
  const r = await api('commons.wikimedia.org', { action: 'query', titles: file, prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '800' });
  const page = Object.values(r.query.pages)[0];
  const ii = page.imageinfo && page.imageinfo[0];
  if (!ii) return null;
  const m = ii.extmetadata || {};
  return { thumb: ii.thumburl, page: ii.descriptionurl, w: ii.width, h: ii.height, author: strip(m.Artist && m.Artist.value), license: strip(m.LicenseShortName && m.LicenseShortName.value), licenseUrl: (m.LicenseUrl && m.LicenseUrl.value) || '' };
}

const index = {};
for (const site of SITES) {
  if (only.length && !only.includes(site.name)) continue;
  const slug = slugOf(site.name);
  const cands = [];
  try {
    const main = await mainImage(site);
    if (main) cands.push(main);
    for (const f of await nearbyFiles(site, 4)) if (!cands.some((c) => c.file === f.file) && cands.length < 3) cands.push(f);
  } catch (e) { console.log('raté', site.name, e.message); }
  index[slug] = { name: site.name, cands: [] };
  let k = 0;
  for (const c of cands) {
    try {
      const i = await info(c.file);
      if (!i || !i.thumb || i.w < 500) continue;
      const img = await fetch(i.thumb, { headers: { 'User-Agent': UA } });
      if (!img.ok) continue;
      k++;
      await writeFile(join(OUT, `${slug}-${k}.jpg`), Buffer.from(await img.arrayBuffer()));
      index[slug].cands.push({ n: k, file: c.file, from: c.from, ...i });
    } catch { /* candidat suivant */ }
    await sleep(300);
  }
  console.log(`${site.name} : ${k} photo(s)`);
  await sleep(400);
}
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 1));
