// Lecture et écriture de traces GPX, partage vers Organic Maps ou téléchargement.
import { cumulative, esc } from './util.js';
import { eleAt } from './elev.js';

export function buildGpx(hike) {
  const cum = cumulative(hike.pts);
  const name = esc(hike.title || 'Randonnée');
  const seg = hike.pts.map((p, i) => {
    const e = hike.prof ? eleAt(hike.prof, cum[i]) : null;
    return `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${e === null ? '' : `<ele>${e.toFixed(0)}</ele>`}</trkpt>`;
  }).join('\n      ');
  const wpts = [];
  if (hike.start) wpts.push(`<wpt lat="${hike.start.lat.toFixed(6)}" lon="${hike.start.lon.toFixed(6)}"><name>Départ${hike.start.name ? ' : ' + esc(hike.start.name) : ''}</name></wpt>`);
  if (hike.place) wpts.push(`<wpt lat="${hike.place.lat.toFixed(6)}" lon="${hike.place.lon.toFixed(6)}"><name>${esc(hike.place.name)}</name></wpt>`);
  if (hike.via) wpts.push(`<wpt lat="${hike.via.lat.toFixed(6)}" lon="${hike.via.lon.toFixed(6)}"><name>${esc(hike.via.name)}</name></wpt>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Randodo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name><desc>Tracé établi à partir des données OpenStreetMap (ODbL).</desc></metadata>
  ${wpts.join('\n  ')}
  <trk>
    <name>${name}</name>
    <trkseg>
      ${seg}
    </trkseg>
  </trk>
</gpx>
`;
}

// Lit un GPX : première piste trouvée, sinon l'itinéraire (rte).
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ce fichier n\'est pas un GPX lisible.');
  let nodes = [...doc.getElementsByTagName('trkpt')];
  if (!nodes.length) nodes = [...doc.getElementsByTagName('rtept')];
  if (nodes.length < 2) throw new Error('Ce GPX ne contient pas de trace.');
  const pts = [], eles = [];
  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute('lat')), lon = parseFloat(n.getAttribute('lon'));
    if (!isFinite(lat) || !isFinite(lon)) continue;
    pts.push([lat, lon]);
    const e = n.getElementsByTagName('ele')[0];
    eles.push(e ? parseFloat(e.textContent) : NaN);
  }
  const nameEl = doc.querySelector('trk > name') || doc.querySelector('metadata > name') || doc.querySelector('rte > name');
  const hasEle = eles.filter((e) => isFinite(e)).length > pts.length * 0.9;
  return { pts, eles: hasEle ? eles : null, name: nameEl ? nameEl.textContent.trim() : '' };
}

export function fileName(title) {
  const base = (title || 'rando').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return (base || 'rando') + '.gpx';
}

// Propose la feuille de partage (pour « Ouvrir dans Organic Maps » sur iPhone), sinon télécharge le fichier.
export async function shareGpx(hike, preferShare = true) {
  const text = buildGpx(hike);
  const name = fileName(hike.title);
  const file = new File([text], name, { type: 'application/gpx+xml' });
  if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: hike.title });
      return 'partage';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'annule';
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'telechargement';
}
