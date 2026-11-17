// Réglages de Randodo. Tout ce qui peut avoir besoin d'être corrigé sans toucher au reste est ici.

const params = new URLSearchParams(location.search);
// Mode test : ?mock=http://localhost:8765 remplace tous les services par un serveur local.
const MOCK = params.get('mock') || '';

export const VERSION = '1.5.3';

export const CONFIG = {
  mock: MOCK,

  // Vue de départ : entre Vosges et Forêt-Noire.
  home: { lat: 48.05, lon: 7.55, zoom: 9 },
  // Zone couverte par la sélection (l'appli fonctionne aussi en dehors).
  zone: { south: 45.8, west: 5.4, north: 49.4, east: 10.7 },

  // Niveaux validés : facile ≤ 8 km et 300 m, moyenne ≤ 15 km et 700 m, difficile au-delà.
  levels: [
    { id: 'facile', label: 'Facile', maxKm: 8, maxUp: 300 },
    { id: 'moyenne', label: 'Moyenne', maxKm: 15, maxUp: 700 },
    { id: 'difficile', label: 'Difficile', maxKm: Infinity, maxUp: Infinity },
  ],

  // Services de données ouvertes. Plusieurs serveurs Overpass : le suivant prend le relais si le premier échoue.
  overpass: MOCK ? [MOCK + '/overpass'] : [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ],
  // Temps de route (serveur de démonstration OSRM). En cas d'échec, l'appli estime la durée à partir de la distance.
  osrm: MOCK ? MOCK + '/osrm/' : 'https://router.project-osrm.org/table/v1/driving/',
  elevation: MOCK ? MOCK + '/elevation' : 'https://api.open-meteo.com/v1/elevation',
  photon: MOCK ? MOCK + '/photon' : 'https://photon.komoot.io/api/',
  wikipedia: MOCK ? MOCK + '/wikipedia' : 'https://fr.wikipedia.org/w/api.php',
  wikidataSparql: MOCK ? MOCK + '/sparql' : 'https://query.wikidata.org/sparql',
  commonsFile: MOCK ? MOCK + '/photo/' : 'https://commons.wikimedia.org/wiki/Special:FilePath/',

  // Fonds de carte. Les tuiles ne sont jamais téléchargées d'avance : seules celles déjà vues restent en cache.
  // « probe » : tuile d'essai utilisée par le diagnostic (zoom, colonne, ligne).
  tiles: MOCK ? [
    { id: 'rando', label: 'Rando', note: 'Tuiles de test', url: MOCK + '/tiles/{z}/{x}/{y}.png', maxZoom: 19, attribution: 'Tuiles de test', probe: [10, 516, 377] },
    { id: 'osm', label: 'Plan', note: 'Tuiles de test', url: MOCK + '/tiles/{z}/{x}/{y}.png?plan', maxZoom: 19, attribution: 'Tuiles de test', probe: [10, 516, 377] },
  ] : [
    { id: 'rando', label: 'Rando', note: 'Relief, courbes de niveau et sentiers, tous pays', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17,
      attribution: '© contributeurs OpenStreetMap, SRTM | style © OpenTopoMap (CC-BY-SA)', probe: [10, 532, 355] },
    { id: 'ign', label: 'IGN', note: 'Plan IGN, France seulement', maxZoom: 18, attribution: '© IGN', probe: [10, 532, 355],
      url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' },
    { id: 'ign25', label: 'IGN 1:25 000', note: 'Carte de randonnée, France seulement', needsKey: true, maxZoom: 16, attribution: '© IGN', probe: [12, 2128, 1422],
      url: 'https://data.geopf.fr/private/wmts?apikey={key}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.MAPS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' },
    { id: 'swiss', label: 'Swisstopo', note: 'Carte nationale, Suisse seulement', maxZoom: 18, attribution: '© swisstopo', probe: [10, 533, 360],
      url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg' },
    { id: 'osm', label: 'Plan', note: 'Carte générale OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
      attribution: '© contributeurs OpenStreetMap', probe: [10, 532, 355] },
  ],
  // Surcouche des itinéraires balisés (Waymarked Trails), affichable sur n'importe quel fond.
  trailsOverlay: MOCK ? '' : 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
  // Clé d'accès aux cartes IGN au 1:25 000 (accès restreint). Peut aussi se saisir dans Réglages.
  ignScanKey: '',

  // Rayon de recherche des sentiers autour d'un lieu, en mètres.
  graphRadius: 5000,
  // Écart au tracé qui déclenche l'alerte, en mètres.
  offRoute: 50,

  // Adresse du groupe pour les randos communautaires (script Google, voir LISEZMOI).
  // Laisse vide pour la saisir dans Réglages ; remplis-la ici pour que tes proches l'aient d'office.
  communityUrl: '',

  // Liens vers les plateformes. {q} = nom du lieu, {lat} {lon} = coordonnées, {s} {w} {n} {e} = cadre autour du lieu.
  // Les deux premiers sont des liens directs à confirmer en conditions réelles ; « web » est une recherche qui marche toujours.
  platforms: [
    { id: 'komoot', label: 'Komoot', main: true,
      direct: 'https://www.komoot.com/fr-fr/discover/{q}/@{lat},{lon}/tours?sport=hike&map=true&max_distance=10000',
      web: 'https://www.google.com/search?q=site%3Akomoot.com+{q}+randonn%C3%A9e' },
    { id: 'alltrails', label: 'AllTrails', main: true,
      direct: 'https://www.alltrails.com/fr/explore?b_tl_lat={n}&b_tl_lng={w}&b_br_lat={s}&b_br_lng={e}',
      web: 'https://www.google.com/search?q=site%3Aalltrails.com+{q}' },
    { id: 'visorando', label: 'Visorando',
      web: 'https://www.google.com/search?q=site%3Avisorando.com+{q}+randonn%C3%A9e' },
    { id: 'bergfex', label: 'Bergfex',
      web: 'https://www.google.com/search?q=site%3Abergfex.fr+OR+site%3Abergfex.com+{q}' },
    { id: 'outdooractive', label: 'Outdooractive',
      web: 'https://www.google.com/search?q=site%3Aoutdooractive.com+{q}+randonn%C3%A9e' },
    { id: 'schweizmobil', label: 'SuisseMobile', onlyCH: true,
      web: 'https://www.google.com/search?q=site%3Aschweizmobil.ch+{q}' },
    { id: 'waymarked', label: 'Waymarked Trails',
      direct: 'https://hiking.waymarkedtrails.org/#?map=14.0/{lat}/{lon}' },
  ],
  // Trace GPX d'un circuit balisé OpenStreetMap, par son numéro de relation.
  // Page du circuit sur Waymarked Trails : carte, profil et bouton GPX (l'export direct échoue sur les circuits mal ordonnés).
  waymarkedGpx: 'https://hiking.waymarkedtrails.org/#route?id={id}&type=relation',
};

export function levelOf(km, up) {
  for (const l of CONFIG.levels) if (km <= l.maxKm && up <= l.maxUp) return l.id;
  return 'difficile';
}

export const TYPES = {
  sommet: { label: 'Sommets', one: 'Sommet', color: '#7a5a3a' },
  vue: { label: 'Points de vue', one: 'Point de vue', color: '#b0762a' },
  lac: { label: 'Lacs', one: 'Lac', color: '#2f7fb3' },
  cascade: { label: 'Cascades', one: 'Cascade', color: '#2a9c9c' },
  rocher: { label: 'Rochers', one: 'Rocher', color: '#77706a' },
  chateau: { label: 'Châteaux et ruines', one: 'Château ou ruine', color: '#a04a5b' },
  grotte: { label: 'Grottes', one: 'Grotte', color: '#4d4a63' },
  gorge: { label: 'Gorges', one: 'Gorge', color: '#3d7d5c' },
  refuge: { label: 'Refuges', one: 'Refuge', color: '#8a6a1f' },
  lieu: { label: 'Autres lieux', one: 'Lieu', color: '#55606a' },
};
