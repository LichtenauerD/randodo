// Diagnostic réseau depuis GitHub Actions : serveurs de sentiers et d'altitude.
const q = '[out:json][timeout:20];node["natural"="peak"]["name"="Hohneck"](47.9,6.9,48.2,7.2);out;';
const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.osm.jp/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const UA = 'Randodo/1.4 (+https://github.com/LichtenauerD/randodo)';
async function probe(label, url, opts) {
  const t = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
    const txt = await r.text();
    console.log(label, r.status, `${Date.now() - t} ms`, txt.slice(0, 90).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(label, 'ERREUR', e.message, e.cause ? `${e.cause.code || ''} ${e.cause.message || ''}` : '', `${Date.now() - t} ms`);
  }
}
for (const s of servers) {
  const body = 'data=' + encodeURIComponent(q);
  await probe('sans UA ' + s, s, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  await probe('avec UA ' + s, s, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body });
}
await probe('status overpass-api.de', 'https://overpass-api.de/api/status', { headers: { 'User-Agent': UA } });
const pts = Array.from({ length: 100 }, (_, i) => [48.03 + i * 0.001, 7.0]);
const em = 'https://api.open-meteo.com/v1/elevation?latitude=' + pts.map((p) => p[0].toFixed(5)).join(',') + '&longitude=' + pts.map((p) => p[1].toFixed(5)).join(',');
for (let i = 0; i < 3; i++) await probe('open-meteo ' + i, em, { headers: { 'User-Agent': UA } });
