// Vérifie que les liens de sortie de l'appli mènent à de vraies pages.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const P = { q: 'Hohneck', lat: 48.0367, lon: 7.0175, n: 48.06, s: 48.01, w: 6.98, e: 7.05 };
const urls = {
  komoot: `https://www.komoot.com/fr-fr/discover/${P.q}/@${P.lat},${P.lon}/tours?sport=hike&map=true&max_distance=10000`,
  komootDiscover: `https://www.komoot.com/fr-fr/discover/${P.q}/hike`,
  alltrails: `https://www.alltrails.com/fr/explore?b_tl_lat=${P.n}&b_tl_lng=${P.w}&b_br_lat=${P.s}&b_br_lng=${P.e}`,
  alltrailsNoLang: `https://www.alltrails.com/explore?b_tl_lat=${P.n}&b_tl_lng=${P.w}&b_br_lat=${P.s}&b_br_lng=${P.e}`,
  google: 'https://www.google.com/search?q=site%3Avisorando.com+Hohneck+randonn%C3%A9e',
  waymarked: `https://hiking.waymarkedtrails.org/#?map=14.0/${P.lat}/${P.lon}`,
  wmtGpx: 'https://hiking.waymarkedtrails.org/api/v1/details/relation/' + (process.env.REL || '2690930') + '/gpx',
  visorandoSearch: 'https://www.visorando.com/?component=rando&task=searchCircuitV2&loc=Hohneck',
  ignTile: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=12&TILEROW=1418&TILECOL=2127&FORMAT=image/png',
  appleMaps: 'https://maps.apple.com/?daddr=48.03670,7.01750',
};
for (const [k, u] of Object.entries(urls)) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    const title = (t.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
    const hits = (t.match(/hike|randonn|trail|tour/gi) || []).length;
    console.log(k.padEnd(16), r.status, r.url.slice(0, 110), '| titre:', title.trim().slice(0, 80), '| mots-clés:', hits, '| début:', t.slice(0, 60).replace(/\s+/g, ' '));
  } catch (e) { console.log(k.padEnd(16), 'ERREUR', e.message); }
}
