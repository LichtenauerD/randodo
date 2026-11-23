// Retrouve la position des nouveaux lieux (OpenStreetMap / Nominatim), 1 requête par seconde.
import { readFile } from 'node:fs/promises';
const UA = 'Randodo/1.6 (+https://github.com/LichtenauerD/randodo)';
const BOX = { // ouest, nord, est, sud
  'Vosges': [5.8, 49.2, 7.9, 47.6], 'Vosges du Nord': [7.0, 49.4, 8.2, 48.6], 'Forêt-Noire': [7.6, 49.0, 8.9, 47.5], 'Jura': [5.2, 47.8, 7.9, 45.7], 'Suisse': [5.9, 47.9, 10.6, 45.8],
};
const rows = (await readFile(new URL('./' + (process.env.FILE || 'new-places.tsv'), import.meta.url), 'utf8')).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
const out = [];
for (const [name, type, massif, country, q] of rows) {
  const b = BOX[massif];
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q, format: 'jsonv2', limit: '3', countrycodes: country.toLowerCase(), viewbox: b.join(','), bounded: '1', 'accept-language': 'fr' });
  let res = [];
  try { res = await (await fetch(u, { headers: { 'User-Agent': UA } })).json(); } catch (e) { res = [{ error: e.message }]; }
  if (!res.length) {
    const u2 = new URL(u); u2.searchParams.set('q', name); res = await (await fetch(u2, { headers: { 'User-Agent': UA } })).json().catch(() => []);
    await new Promise((r) => setTimeout(r, 1100));
  }
  out.push({ name, q, hits: res.map((r) => ({ lat: +(+r.lat).toFixed(5), lon: +(+r.lon).toFixed(5), cls: r.category + '/' + r.type, label: (r.display_name || r.error || '').slice(0, 110) })) });
  await new Promise((r) => setTimeout(r, 1100));
}
console.log('@@GEO@@' + JSON.stringify(out));
